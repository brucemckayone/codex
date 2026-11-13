/**
 * Who bought a piece (Codex-a6ofh.3.5, owner D-b4 and R2): a `purchases` row
 * for it with `status = completed`, disputed ones included. The access
 * predicate (`verifyPurchase`) leaves a disputed purchase out of playback,
 * but a won dispute gives it back, so a delete would still take it from
 * them. One completed purchase per customer and piece (the partial unique
 * index `uq_purchases_completed_customer_content`) makes a row count a count
 * of people.
 *
 * `content.purchase_count` is not this: nothing but the seed scripts writes
 * it (Codex-r7os5), so every real piece reads 0 there.
 */
import { PURCHASE_STATUS } from '@codex/constants';
import { content, purchases } from '@codex/database/schema';
import { and, count, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../types';

/** A completed purchase of the piece `contentId` names (a column or an id). */
const boughtBy = (contentId: SQL | string | typeof content.id) =>
  and(
    eq(purchases.contentId, contentId),
    eq(purchases.status, PURCHASE_STATUS.COMPLETED)
  );

/**
 * How many people bought one piece. Read inside the caller's transaction,
 * after its lock on the piece, so the refusal is judged on the server, never
 * on a number the list showed.
 */
export async function countBuyers(
  db: Database | DatabaseTransaction,
  contentId: string
): Promise<number> {
  const [row] = await db
    .select({ buyers: count() })
    .from(purchases)
    .where(boughtBy(contentId));
  return row?.buyers ?? 0;
}

/**
 * Each piece's buyers, by id, in one grouped read over the page's ids (the
 * studio list's Sales column). A piece nobody bought has no key.
 */
export async function buyerCountsOf(
  db: Database,
  contentIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contentIds.length === 0) return counts;
  const rows = await db
    .select({ contentId: purchases.contentId, buyers: count() })
    .from(purchases)
    .where(
      and(
        inArray(purchases.contentId, contentIds),
        eq(purchases.status, PURCHASE_STATUS.COMPLETED)
      )
    )
    .groupBy(purchases.contentId);
  for (const { contentId, buyers } of rows) {
    if (contentId) counts.set(contentId, buyers);
  }
  return counts;
}

/**
 * The studio list's "sales" order: each row's buyer count, as a correlated
 * subquery. A query builder renders its own columns, so it is safe inside the
 * relational `findMany` (which re-qualifies a raw `sql` column with its root
 * alias): it reads `"purchases"."content_id" = "content"."id"`.
 */
export function byBuyers(db: Database, direction: 'asc' | 'desc'): SQL {
  const buyers = db
    .select({ buyers: count() })
    .from(purchases)
    .where(boughtBy(content.id));
  return direction === 'desc' ? sql`(${buyers}) DESC` : sql`(${buyers}) ASC`;
}
