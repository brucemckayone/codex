/**
 * READ-ONLY audit of the `content` access-policy flags. Makes NO writes.
 *
 * Two independent checks, both asking "are the flag columns correct for rows
 * that ALREADY EXIST" — which is why they share one script and one connection.
 *
 * ── CHECK 1 · the 0079 reset signature (Codex-se5rc) ──────────────────────
 *
 * Migration `0079_foamy_bishop.sql` hard-replaced `content.access_type` and
 * `content.minimum_tier_id` with the seven policy flags. It ADDs the columns
 * with static defaults (`is_free` DEFAULT **true**, every gate false,
 * `included_in_tier_id` NULL) at :159-164 and then DROPs both source columns at
 * :227-228 — with **no backfill UPDATE anywhere between them**. That is
 * authorised for a greenfield table. Against a NON-EMPTY one, every
 * paid/subscribers/followers/team row silently becomes `is_free = true` with
 * all gates off, which `access-decision.ts` resolves as PUBLIC.
 *
 * Production was NOT greenfield at cutover: deploys succeeded 2026-07-15/17/18,
 * all before 0079 landed in the repo (2026-07-23). The deploy that applied it is
 * run 32975698926 at {@link MIGRATION_0079_APPLIED_AT}.
 *
 * **The original intent is unrecoverable.** `codex-production`'s Neon history
 * retention is 21600s — SIX HOURS — so PITR back past the migration expired on
 * 2026-08-26 and the dropped columns are gone for good. If this check reports
 * rows, remediation is per-row human judgement or reconstruction from indirect
 * evidence (Stripe prices, `purchases`, `subscription_tiers` references), never
 * a mechanical backfill.
 *
 * ── CHECK 2 · priced but free (Codex-al9ft) ───────────────────────────────
 *
 * `@codex/access`'s paid arm is `(priceCents ?? 0) > 0` and never reads
 * `isFree`, while apps/web decided publicness from `isFree`. Four places that
 * computed or validated `isFree` omitted `priceCents`, so a price-only create
 * persisted `{ isFree: true, priceCents: > 0 }` and — worse — a PATCH clearing
 * `isPurchasable` REWROTE a correctly-gated row into that shape. Those paths are
 * fixed, but a code fix cannot reach rows already written.
 *
 * Usage (read-only, no flags):
 *   pnpm --filter @codex/database audit:content-flags
 *
 * Reads DATABASE_URL from ../../../.env.dev like the other scripts here; point
 * it at whichever environment you are auditing.
 *
 * Exit codes: 0 = both checks clean, 1 = findings, 2 = could not run.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbHttp, schema } from '../src';

/**
 * When migration 0079 was applied to production: the first successful
 * `deploy-production.yml` run after the migration landed in the repo — run
 * 32975698926, head 31caf24c. Rows created BEFORE this could have been reset;
 * rows created after legitimately carry app-set flags, which is why check 1 is
 * bounded by it. Re-derive with:
 *   gh run list --workflow deploy-production.yml --json databaseId,conclusion,createdAt
 */
const MIGRATION_0079_APPLIED_AT = new Date('2026-08-26T13:41:26Z');

const POLICY_COLUMNS = {
  id: schema.content.id,
  slug: schema.content.slug,
  status: schema.content.status,
  createdAt: schema.content.createdAt,
  isFree: schema.content.isFree,
  isPurchasable: schema.content.isPurchasable,
  priceCents: schema.content.priceCents,
  includedInTierId: schema.content.includedInTierId,
  organizationId: schema.content.organizationId,
} as const;

/** CHECK 1 — rows predating 0079, and which of them carry the reset signature. */
async function checkResetSignature(): Promise<number> {
  console.log('── CHECK 1 · migration 0079 reset signature (Codex-se5rc) ──');

  // Deliberately NOT filtered by deletedAt: a soft-deleted row can be restored,
  // and the bead's own query is unfiltered. Status is reported per row instead.
  const predating = await dbHttp
    .select(POLICY_COLUMNS)
    .from(schema.content)
    .where(lt(schema.content.createdAt, MIGRATION_0079_APPLIED_AT));

  if (predating.length === 0) {
    console.log(
      `✓ 0 rows predate ${MIGRATION_0079_APPLIED_AT.toISOString()} — the content table was empty when 0079 ran. Codex-se5rc closes.\n`
    );
    return 0;
  }

  // The signature: every gate at its static default. Indistinguishable from
  // content that was genuinely free — which is the whole problem, and why a
  // hit here is a CANDIDATE for remediation, not proof of one.
  const reset = predating.filter(
    (r) =>
      r.isFree &&
      !r.isPurchasable &&
      r.includedInTierId === null &&
      (r.priceCents ?? 0) === 0
  );

  console.log(
    `  ${predating.length} row(s) predate the migration; ${reset.length} carry the all-defaults reset signature.`
  );

  if (reset.length === 0) {
    console.log(
      '✓ None carry the signature — every pre-migration row has at least one gate set, so nothing was silently reset.\n'
    );
    return 0;
  }

  console.error(
    '\n✗ CANDIDATES for a silently reset gate. Each of these is EITHER genuinely-free content OR a paid/subscribers/followers/team row whose gate 0079 erased — the two are indistinguishable from the row alone, because access_type was dropped in the same migration:\n'
  );
  for (const r of reset) {
    console.error(
      `  - ${r.status.padEnd(9)} "${r.slug}" created=${r.createdAt?.toISOString() ?? 'null'} org=${r.organizationId ?? 'none'} id=${r.id}`
    );
  }
  console.error(
    '\nNeon PITR CANNOT recover the intent: history retention on codex-production is 6 hours\n' +
      'and the migration ran 2026-08-26. Reconstruct from indirect evidence instead —\n' +
      '  - a `purchases` row for the content implies it was PAID (and gives the price),\n' +
      '  - a `subscription_tiers` reference or subscriber-era access implies SUBSCRIBERS,\n' +
      '  - Stripe price objects created alongside the content,\n' +
      '  - failing all that, ask the creator.\n'
  );
  return 1;
}

/** CHECK 2 — a positive price on a row marked free. */
async function checkPricedButFree(): Promise<number> {
  console.log('── CHECK 2 · priced but marked free (Codex-al9ft) ──');

  // Soft-deleted rows excluded here: this check is about what is being SERVED,
  // and a deleted row serves no page. Drafts ARE included — a draft published
  // later carries the same flags, so it is the same latent leak.
  const rows = await dbHttp
    .select(POLICY_COLUMNS)
    .from(schema.content)
    .where(
      and(
        eq(schema.content.isFree, true),
        isNotNull(schema.content.priceCents),
        gt(schema.content.priceCents, 0),
        isNull(schema.content.deletedAt)
      )
    );

  if (rows.length === 0) {
    console.log('✓ No rows with priceCents > 0 AND isFree = true.\n');
    return 0;
  }

  const published = rows.filter((r) => r.status === 'published');
  console.error(
    `\n✗ ${rows.length} row(s) are PRICED but marked FREE (${published.length} published):\n`
  );
  for (const r of rows) {
    console.error(
      `  - ${r.status.padEnd(9)} "${r.slug}" price=${r.priceCents} isPurchasable=${r.isPurchasable} org=${r.organizationId ?? 'none'} id=${r.id}`
    );
  }
  console.error(
    '\nRemediation is a judgement call per row, which is why this script does NOT write:\n' +
      '  - meant to be PAID -> set isFree = false (and isPurchasable = true to match the price)\n' +
      '  - meant to be FREE -> set priceCents = NULL\n' +
      'Both shapes are now rejected at the input boundary, so neither can be re-created.\n'
  );
  return 1;
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set — cannot audit. Populate .env.dev or export it.'
    );
    return 2;
  }

  // Both checks always run, so one invocation gives the whole picture; the exit
  // code is the max so a finding in either fails the run.
  const one = await checkResetSignature();
  const two = await checkPricedButFree();
  return Math.max(one, two);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Audit failed:', err);
    process.exit(2);
  });
