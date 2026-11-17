/**
 * Who has a piece (Codex-a6ofh.3.5). Two counts:
 *
 * - Its buyers (owner R2, the studio list's Sales): `purchases` rows for it
 *   with `status = completed`, disputed ones included. The access predicate
 *   (`verifyPurchase`) leaves a disputed purchase out of playback, but a won
 *   dispute gives it back. One completed purchase per customer and piece
 *   (`uq_purchases_completed_customer_content`) makes a row count people.
 * - Its holders (owner D-b4, R1, 2026-11-13): everyone who would lose it,
 *   paid for or given, through the piece or a course that holds it. What a
 *   bulk delete, or a move to Followers or Team only, leaves alone.
 *
 * `content.purchase_count` is neither: nothing but the seed scripts writes
 * it (Codex-r7os5), so every real piece reads 0 there.
 */
import { PURCHASE_STATUS } from '@codex/constants';
import {
  content,
  courseStages,
  entitlements,
  purchases,
  stagePractices,
} from '@codex/database/schema';
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../types';

/** A completed purchase of the piece `contentId` names (a column or an id). */
const boughtBy = (contentId: SQL | string | typeof content.id) =>
  and(
    eq(purchases.contentId, contentId),
    eq(purchases.status, PURCHASE_STATUS.COMPLETED)
  );

/**
 * Entitlement sources a holder holds a piece by (owner 2026-11-13: course
 * buyers count): the piece's own purchase or a manual grant of it, and a
 * course's purchase or manual grant. A course subscription is a subscriber,
 * not a buyer, as a tier subscription is. The access decision reads the
 * same rows (`hasStoredContentEntitlement`, `contentReachableViaOwnedCourse`).
 */
const CONTENT_HELD_BY: string[] = ['content_purchase', 'grant'];
const COURSE_HELD_BY: string[] = ['course_purchase', 'grant'];

/**
 * How many people would lose each piece, paid for or given, if it went (a
 * bulk delete, owner D-b4) or moved to Followers or Team only (R1), by id,
 * in one read: its buyers, anyone with a live stored grant of it, and anyone
 * who bought or was given a course one of whose live stages holds it. A
 * course buyer whose purchase is under dispute counts, as a disputed buyer
 * of the piece does: the dispute revoked the course's grant, and a win gives
 * it back. Each person once per piece, however many ways they hold it. A
 * piece nobody holds has no key.
 */
export async function holderCountsOf(
  db: Database | DatabaseTransaction,
  contentIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contentIds.length === 0) return counts;
  const now = new Date();
  const live = and(
    isNull(entitlements.revokedAt),
    or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now))
  );
  // Each piece's courses: those whose live stages hold it.
  const held = db
    .select({
      contentId: stagePractices.contentId,
      courseId: courseStages.courseId,
    })
    .from(stagePractices)
    .innerJoin(courseStages, eq(stagePractices.stageId, courseStages.id))
    .where(
      and(
        inArray(stagePractices.contentId, contentIds),
        isNull(courseStages.deletedAt)
      )
    )
    .as('held');
  const holders = db
    .select({ contentId: purchases.contentId, userId: purchases.customerId })
    .from(purchases)
    .where(
      and(
        inArray(purchases.contentId, contentIds),
        eq(purchases.status, PURCHASE_STATUS.COMPLETED)
      )
    )
    .union(
      db
        .select({
          contentId: entitlements.contentId,
          userId: entitlements.userId,
        })
        .from(entitlements)
        .where(
          and(
            inArray(entitlements.contentId, contentIds),
            inArray(entitlements.source, CONTENT_HELD_BY),
            live
          )
        )
    )
    .union(
      db
        .select({ contentId: held.contentId, userId: entitlements.userId })
        .from(entitlements)
        .innerJoin(held, eq(entitlements.courseId, held.courseId))
        .where(and(inArray(entitlements.source, COURSE_HELD_BY), live))
    )
    .union(
      db
        .select({ contentId: held.contentId, userId: purchases.customerId })
        .from(purchases)
        .innerJoin(held, eq(purchases.courseId, held.courseId))
        .where(eq(purchases.status, PURCHASE_STATUS.COMPLETED))
    )
    .as('holders');
  const rows = await db
    .select({ contentId: holders.contentId, people: count() })
    .from(holders)
    .groupBy(holders.contentId);
  for (const { contentId, people } of rows) {
    if (contentId) counts.set(contentId, people);
  }
  return counts;
}

/**
 * One piece's holders ({@link holderCountsOf}), read inside the caller's
 * transaction, after its lock on the piece, so a refusal is judged on the
 * server, never on a number the list showed.
 */
export async function countHolders(
  db: Database | DatabaseTransaction,
  contentId: string
): Promise<number> {
  return (await holderCountsOf(db, [contentId])).get(contentId) ?? 0;
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
