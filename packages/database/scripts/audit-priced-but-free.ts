/**
 * READ-ONLY audit: content rows that carry a PRICE but are marked FREE.
 *
 * Codex-al9ft. `@codex/access`'s paid arm is `(priceCents ?? 0) > 0` and never
 * reads `isFree` (`packages/access/src/services/content-access/access-decision.ts`),
 * while apps/web's `isPublicContent()` decided publicness from `isFree` alone.
 * `ContentService.create`'s `isFree` derivation and `update`'s `effHasGate`
 * clamp both omitted `priceCents`, so:
 *
 *   - a price-only create persisted `{ isFree: true, priceCents: > 0 }`, and
 *   - a PATCH clearing `isPurchasable` REWROTE a correctly-gated row into it.
 *
 * Such a row is denied by the gate on every stream request while the content
 * page renders its full body into the ANONYMOUS SSR payload. The code paths are
 * fixed, but a fix cannot reach rows already written — hence this audit.
 *
 * Usage (read-only; makes no writes and takes no flags):
 *   pnpm --filter @codex/database audit:priced-but-free
 *
 * Reads DATABASE_URL from ../../../.env.dev, like the other scripts here. Point
 * it at whichever environment you are auditing.
 *
 * Exit codes: 0 = no divergent rows, 1 = divergent rows found (so it can gate
 * a deploy), 2 = the audit could not run.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbHttp, schema } from '../src';

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set — cannot audit. Populate .env.dev or export it.'
    );
    return 2;
  }

  // The divergent shape: a positive price AND isFree. Soft-deleted rows are
  // excluded (they serve no page), but DRAFTS are NOT — a draft published later
  // carries the same flags, so it is the same latent leak.
  const rows = await dbHttp
    .select({
      id: schema.content.id,
      slug: schema.content.slug,
      title: schema.content.title,
      status: schema.content.status,
      priceCents: schema.content.priceCents,
      isPurchasable: schema.content.isPurchasable,
      organizationId: schema.content.organizationId,
    })
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
    console.log('✓ No rows with priceCents > 0 AND isFree = true.');
    return 0;
  }

  const published = rows.filter((r) => r.status === 'published');
  console.error(
    `✗ ${rows.length} row(s) are PRICED but marked FREE (${published.length} published — those are serving their body anonymously RIGHT NOW):\n`
  );
  for (const r of rows) {
    console.error(
      `  - ${r.status.padEnd(9)} "${r.slug}" price=${r.priceCents} isPurchasable=${r.isPurchasable} org=${r.organizationId ?? 'none'} id=${r.id}`
    );
  }
  console.error(
    '\nRemediation is a judgement call per row, which is why this script does NOT write:\n' +
      '  - meant to be PAID   -> set isFree = false (and isPurchasable = true to match the price)\n' +
      '  - meant to be FREE   -> set priceCents = NULL\n' +
      'Both are now rejected at the input boundary, so the row cannot be re-created either way.'
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Audit failed:', err);
    process.exit(2);
  });
