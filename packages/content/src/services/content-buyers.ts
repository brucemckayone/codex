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
 * Entitlement sources a buyer holds a piece by (owner 2026-11-13: course
 * buyers count): the piece's own purchase or a manual grant of it, and a
 * course's purchase or manual grant. A course subscription is a subscriber,
 * not a buyer, as a tier subscription is. The access decision reads the
 * same rows (`hasStoredContentEntitlement`, `contentReachableViaOwnedCourse`).
 */
const CONTENT_HELD_BY: string[] = ['content_purchase', 'grant'];
const COURSE_HELD_BY: string[] = ['course_purchase', 'grant'];

/**
 * How many people would lose a piece they paid for, or were given, if it
 * went (a bulk delete, owner D-b4) or moved to Followers or Team only (R1):
 * its buyers, anyone with a live stored grant of it, and anyone who bought
 * or was given a course one of whose live stages holds it. Counted as
 * people, once each however many ways they hold it. Read inside the
 * caller's transaction, after its lock on the piece, so the refusal is
 * judged on the server, never on a number the list showed.
 */
export async function countHolders(
  db: Database | DatabaseTransaction,
  contentId: string
): Promise<number> {
  const now = new Date();
  const live = and(
    isNull(entitlements.revokedAt),
    or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now))
  );
  const coursesHolding = db
    .select({ courseId: courseStages.courseId })
    .from(stagePractices)
    .innerJoin(courseStages, eq(stagePractices.stageId, courseStages.id))
    .where(
      and(
        eq(stagePractices.contentId, contentId),
        isNull(courseStages.deletedAt)
      )
    );
  const holders = db
    .select({ userId: purchases.customerId })
    .from(purchases)
    .where(boughtBy(contentId))
    .union(
      db
        .select({ userId: entitlements.userId })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.contentId, contentId),
            inArray(entitlements.source, CONTENT_HELD_BY),
            live
          )
        )
    )
    .union(
      db
        .select({ userId: entitlements.userId })
        .from(entitlements)
        .where(
          and(
            inArray(entitlements.courseId, coursesHolding),
            inArray(entitlements.source, COURSE_HELD_BY),
            live
          )
        )
    )
    .as('holders');
  const [row] = await db.select({ people: count() }).from(holders);
  return row?.people ?? 0;
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
