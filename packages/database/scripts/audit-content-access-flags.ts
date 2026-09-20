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
 * ── CHECK 2 · isFree=true alongside ANY gate (Codex-al9ft) ────────────────
 *
 * `@codex/access` never reads `isFree` — it branches on the gates — while
 * apps/web decided publicness from `isFree` alone. So a row with `isFree` AND a
 * gate is denied by one and advertised as public by the other. Four places that
 * computed or validated `isFree` omitted `priceCents`; a fifth
 * (`course-journey-service.ts`) sets `courseOnly` and leaves `isFree` alone on
 * purpose. Those paths are fixed or now fail closed, but a code fix cannot reach
 * rows already written — which is what this checks.
 *
 * Usage — DB_METHOD is REQUIRED, because the client routes on it and not on
 * DATABASE_URL (see {@link assertTargetIsExplicit}; getting this wrong silently
 * audits the wrong database):
 *   DB_METHOD=PRODUCTION DATABASE_URL=<url> pnpm --filter @codex/database audit:content-flags
 *   DB_METHOD=LOCAL_PROXY                   pnpm --filter @codex/database audit:content-flags
 *
 * Exit codes: 0 = both checks clean, 1 = findings, 2 = could not run.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq, isNull, lt } from 'drizzle-orm';

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
  isFollowerGated: schema.content.isFollowerGated,
  isTeamOnly: schema.content.isTeamOnly,
  courseOnly: schema.content.courseOnly,
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

/**
 * CHECK 2 — `isFree = true` alongside ANY gate. That is a contradiction: the
 * gate denies the content while `isFree` advertises it as public.
 *
 * Originally this looked only for `priceCents > 0 AND isFree`, which is the
 * shape Codex-al9ft was filed for. Too narrow — the first production run
 * reported clean while `embodiement-meditation` sat there published with
 * `isFree = true` AND `courseOnly = true`, reaching the identical divergence
 * through a different flag. `courseOnly` is checked FIRST by the resolver and
 * suppresses every standalone path, so the row was denied by the gate and
 * simultaneously served its full body to anonymous visitors by the old
 * `isPublicContent(isFree)`.
 *
 * It is produced deliberately: `course-journey-service.ts:3188-3230` gates
 * default-policy practices by setting `courseOnly` and leaving `isFree`
 * untouched, reasoning that `isFree` "can no longer grant access once
 * `courseOnly` wins" — true of the resolver, false of the body-render path.
 *
 * So this now asserts the whole invariant `isPublicContent()` encodes, rather
 * than the one instance of it that happened to get filed.
 */
async function checkFreeWithAGate(): Promise<number> {
  console.log('── CHECK 2 · isFree=true alongside a gate (Codex-al9ft) ──');

  // Soft-deleted rows excluded here: this check is about what is being SERVED,
  // and a deleted row serves no page. Drafts ARE included — a draft published
  // later carries the same flags, so it is the same latent leak.
  // (Check 1 deliberately does NOT filter deletedAt; see its comment.)
  const free = await dbHttp
    .select(POLICY_COLUMNS)
    .from(schema.content)
    .where(
      and(eq(schema.content.isFree, true), isNull(schema.content.deletedAt))
    );

  // Mirrors isPublicContent() in apps/web/src/lib/server/content-detail.ts —
  // keep the two in step, and keep both in step with decideContentAccess.
  const gateOf = (r: (typeof free)[number]): string | null => {
    if (r.isPurchasable) return 'isPurchasable';
    if ((r.priceCents ?? 0) > 0) return `priceCents=${r.priceCents}`;
    if (r.includedInTierId !== null) return 'includedInTierId';
    if (r.isFollowerGated) return 'isFollowerGated';
    if (r.isTeamOnly) return 'isTeamOnly';
    if (r.courseOnly) return 'courseOnly';
    return null;
  };

  const contradictory = free
    .map((r) => ({ row: r, gate: gateOf(r) }))
    .filter((x): x is { row: (typeof free)[number]; gate: string } =>
      Boolean(x.gate)
    );

  if (contradictory.length === 0) {
    console.log(
      `✓ ${free.length} row(s) have isFree=true and none carries a gate.\n`
    );
    return 0;
  }

  const published = contradictory.filter((x) => x.row.status === 'published');
  console.error(
    `\n✗ ${contradictory.length} row(s) are isFree=true WITH a gate set (${published.length} published) — denied by @codex/access, advertised as public by isFree:\n`
  );
  for (const { row, gate } of contradictory) {
    console.error(
      `  - ${row.status.padEnd(9)} "${row.slug}" gate=${gate} org=${row.organizationId ?? 'none'} id=${row.id}`
    );
  }
  console.error(
    '\nSince #524 these are no longer SERVED publicly — isPublicContent() reads the whole\n' +
      'policy and fails closed — so this is a data-hygiene finding, not a live leak.\n' +
      'Remediation is a judgement call per row, which is why this script does NOT write:\n' +
      '  - the gate is intended  -> set isFree = false\n' +
      '  - the content is free   -> clear the gate (priceCents = NULL, or the flag)\n' +
      'A priced-and-free row can no longer be created; a courseOnly-and-free one still can,\n' +
      'by design — see course-journey-service.ts.\n'
  );
  return 1;
}

/**
 * Refuse to run unless the caller has said, explicitly, WHICH database this is.
 *
 * `@codex/database`'s client does NOT route on `DATABASE_URL` — it routes on
 * `DB_METHOD` (`DbEnvConfig.getDbUrl` + `applyNeonConfig`, client.ts). In
 * `LOCAL_PROXY` mode it returns `DATABASE_URL_LOCAL_PROXY` and repoints
 * `neonConfig`'s fetch endpoint at the local proxy, so a `DATABASE_URL` passed
 * on the command line is SILENTLY IGNORED. `.env.dev` — which this script loads
 * — sets `DB_METHOD=LOCAL_PROXY`.
 *
 * That bit me: two runs against production quietly targeted `db.localtest.me`.
 * They only *failed* because the local proxy happened to be down. Had it been
 * up, this script would have audited the local dev database and printed a clean
 * bill of health about production — a false negative on a security audit,
 * caused by a precondition that checked a different variable than its consumer
 * reads. (Which is, with some irony, the exact defect class this script audits.)
 *
 * So: require DB_METHOD, and echo the host actually resolved, so the operator
 * can see which database the verdict is about.
 */
function assertTargetIsExplicit(): string | null {
  const method = process.env.DB_METHOD;

  // THE ACTUAL FOOTGUN, and it is not an unset DB_METHOD. `.env.dev` — loaded
  // above, before this runs — sets `DB_METHOD=LOCAL_PROXY` and
  // `DATABASE_URL_LOCAL_PROXY`, but NOT `DATABASE_URL`. So:
  //   - DB_METHOD is never observably "unset" in this repo, and
  //   - a set `DATABASE_URL` can ONLY have come from the caller's command line.
  // Which means `DATABASE_URL=<prod> pnpm … audit:content-flags`, the obvious
  // way to run this, is ALSO the broken way: LOCAL_PROXY wins, the caller's URL
  // is discarded, and the script audits db.localtest.me while the caller
  // believes it audited production. Verified: that combination reports
  // `host=db.localtest.me:5432`. It failed here only because the local proxy was
  // down; with it up, the output would have been a clean bill of health about the
  // wrong database. Refuse the contradiction rather than rely on the host echo
  // being read.
  if (method === 'LOCAL_PROXY' && process.env.DATABASE_URL) {
    return (
      'CONTRADICTION: DATABASE_URL is set but DB_METHOD=LOCAL_PROXY, so the client will\n' +
      'IGNORE your DATABASE_URL and query DATABASE_URL_LOCAL_PROXY instead — auditing the\n' +
      'local dev database while reporting on it as though it were yours.\n' +
      '  Meant production? add DB_METHOD=PRODUCTION.\n' +
      '  Meant local dev?  drop DATABASE_URL.\n' +
      '(DB_METHOD=LOCAL_PROXY most likely came from .env.dev, not from you.)'
    );
  }

  if (!method) {
    return (
      'DB_METHOD is not set and this script will NOT guess:\n' +
      '  production: DB_METHOD=PRODUCTION DATABASE_URL=<url> pnpm --filter @codex/database audit:content-flags\n' +
      '  local dev:  DB_METHOD=LOCAL_PROXY pnpm --filter @codex/database audit:content-flags'
    );
  }
  if (method !== 'LOCAL_PROXY' && !process.env.DATABASE_URL) {
    return `DB_METHOD=${method} requires DATABASE_URL, which is not set.`;
  }
  return null;
}

/** Host of the URL the client will actually use — reported, never the credentials. */
function resolvedHost(): string {
  const url =
    process.env.DB_METHOD === 'LOCAL_PROXY'
      ? process.env.DATABASE_URL_LOCAL_PROXY
      : process.env.DATABASE_URL;
  if (!url) return '(unresolved)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<number> {
  const problem = assertTargetIsExplicit();
  if (problem) {
    console.error(problem);
    return 2;
  }
  console.log(
    `Auditing DB_METHOD=${process.env.DB_METHOD} host=${resolvedHost()}\n`
  );

  // Both checks always run, so one invocation gives the whole picture; the exit
  // code is the max so a finding in either fails the run.
  const one = await checkResetSignature();
  const two = await checkFreeWithAGate();
  return Math.max(one, two);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Audit failed:', err);
    process.exit(2);
  });
