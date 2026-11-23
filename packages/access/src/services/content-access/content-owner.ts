/**
 * Who OWNS a piece of content: one answer for playing it after its access
 * moved (D2, Codex-a6ofh.6.3) and for downloading it while it leaves (D5,
 * Codex-a6ofh.6.5), so the two cannot disagree (owner, 2026-11-23: "buyers,
 * gifts, course buyers").
 *
 * An owner holds one of three things:
 * - `'purchase'`: a completed purchase of the piece not under dispute
 *   (`verifyPurchase`, which leaves a disputed purchase out);
 * - `'entitlement'`: a live stored gift or grant of it (`content_purchase` or
 *   `grant`, the access resolver's own read);
 * - `'course'`: a live purchase or grant of a course one of whose live stages
 *   holds it.
 *
 * Owners are narrower than the leaving email list (design section 3):
 * `holderCountsOf` counts a disputing buyer, who can neither play nor
 * download. A subscriber (a tier or a course subscription) never owned the
 * piece, and neither did the team.
 */
import {
  courseStages,
  entitlements,
  stagePractices,
} from '@codex/database/schema';
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { ContentHeldBy } from '../../types';
import type { PurchaseVerifier } from './access-decision';
import {
  type AccessQueryClient,
  hasStoredContentEntitlement,
} from './entitlements-resolver';

/**
 * What makes someone an owner of a piece, in the order it is reported. The
 * withdrawn page's note names the same three (`ContentHeldBy` bar a
 * subscription, which never owns), so the two cannot drift apart.
 */
export type Ownership = Exclude<ContentHeldBy, 'subscription'>;

/**
 * The course grants that make a holder an owner, as `holdersOf` counts them:
 * a course bought or given. A course subscription is a subscriber.
 */
const COURSE_OWNER_SOURCES: string[] = ['course_purchase', 'grant'];

/**
 * How the user owns this piece, or `null` when they do not. The reads are
 * independent, so they run in parallel, and all of them always run: the
 * leaving download relies on that to refuse in uniform time. When more than
 * one holds, the purchase is reported first, then the gift, then the course,
 * as the paid arm grants them.
 *
 * `courses: false` leaves the course read out, for a caller that has already
 * asked a wider question of the same grants: the access decision's
 * course-only arm reads every course grant (`contentReachableViaOwnedCourse`,
 * a superset of the owners' two sources).
 */
export async function ownershipOf(
  db: AccessQueryClient,
  purchaseService: PurchaseVerifier,
  userId: string,
  contentId: string,
  { courses = true }: { courses?: boolean } = {}
): Promise<Ownership | null> {
  const [purchased, given, viaCourse] = await Promise.all([
    purchaseService.verifyPurchase(contentId, userId),
    hasStoredContentEntitlement(db, userId, contentId),
    courses ? ownsACourseHolding(db, userId, contentId) : false,
  ]);
  if (purchased) return 'purchase';
  if (given) return 'entitlement';
  if (viaCourse) return 'course';
  return null;
}

/**
 * The course arm, narrowed to owners: a live `course_purchase` or `grant` of
 * a course whose live stages hold the piece. A disputed course purchase has
 * no live grant (the chargeback revoked it), so it is out, as `verifyPurchase`
 * leaves a disputed purchase of the piece out.
 */
async function ownsACourseHolding(
  db: AccessQueryClient,
  userId: string,
  contentId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .innerJoin(courseStages, eq(courseStages.courseId, entitlements.courseId))
    .innerJoin(stagePractices, eq(stagePractices.stageId, courseStages.id))
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(stagePractices.contentId, contentId),
        isNull(courseStages.deletedAt),
        inArray(entitlements.source, COURSE_OWNER_SOURCES),
        isNull(entitlements.revokedAt),
        notExpired()
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * A grant with no expiry, or one still ahead. Raw `sql` rather than drizzle's
 * `or()`, which is typed `SQL | undefined`: `and()` drops an undefined
 * argument without complaint, and an expired grant would then count.
 */
function notExpired(): SQL {
  return sql`(${entitlements.expiresAt} IS NULL OR ${entitlements.expiresAt} > now())`;
}
