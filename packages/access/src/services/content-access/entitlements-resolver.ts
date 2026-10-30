/**
 * Entitlement read-resolution for the access decision (Codex-2pryk.2.3 · WP-2).
 *
 * The greenfield access core (SPEC §6.2 / §6.3, HARDENING §C). These are the
 * DB-backed reads the {@link import('@codex/shared-types').EntitlementResolver}
 * composes over: stored `entitlements` grants + the DERIVED tier-subscription
 * grant. They are PURE functions taking a query client so they run identically
 * against the base `db` (boolean `canView` path) and against a read-only `tx`
 * (the `getStreamingUrl` transaction) — mirroring the `access-decision.ts`
 * collaborator style.
 *
 * ## Stored vs derived (SPEC §6.2 [H])
 * - **Stored** grants live in `entitlements` (`content_purchase` / `course_purchase`
 *   / `course_subscription` / `grant`). WP-6 writes them; until then the table is
 *   sparsely populated, so these reads simply return no rows and the existing
 *   purchase/subscription sources in `access-decision.ts` still decide — the
 *   forward-compatible UNION the WP-2 brief mandates.
 * - **Derived** tier-subscription access is computed LIVE from the user's active
 *   `subscriptions` row ∩ the explicit `course_tier_access(courseId, tierId)` join
 *   — never materialised, so a tier change (or lapse) takes effect instantly and
 *   can never strand a stale grant. `course_tier_access` is an EXACT tier→course
 *   grant (SPEC §7: "not just min-tier"), so membership is by explicit `tierId`,
 *   the same as content (`content_tier_access`, Codex-2hxff.91): no tier
 *   implies another.
 *
 * ## No N+1 on Neon HTTP (HARDENING §D / §E / §12)
 * {@link resolveCourseEntitlementsBatch} answers N courses in a BOUNDED number of
 * round-trips (two `SELECT`s) regardless of N — the dashboard/library grid gate.
 * Every user-scoped grant read is a `revokedAt IS NULL` + not-expired filter, so
 * revocation is instant.
 */

import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  PURCHASE_STATUS,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  courseStages,
  courseSubscriptions,
  courses,
  courseTierAccess,
  entitlements,
  purchases,
  stagePractices,
  subscriptions,
} from '@codex/database/schema';
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

/**
 * Read-only query client. Both the base `DatabaseClient` and the transaction
 * client expose `.select` / `.query`, so a resolver read runs under either
 * without an `as any` cast (`feedback_tx_callback_type_derivation`).
 */
type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
export type AccessQueryClient = DatabaseClient | Tx;

/**
 * `entitlements.source` values that grant a CONTENT resource (SPEC §6.2). Course
 * purchases/subscriptions never target content; `tier_subscription` is derived,
 * never stored. `grant` is the manual admin grant.
 */
const CONTENT_GRANT_SOURCES: string[] = ['content_purchase', 'grant'];

/**
 * `entitlements.source` values that grant a COURSE resource (SPEC §6.2). Note
 * `course_subscription` is STORED (WP-6 writes it in the self-heal helper) — so
 * a live course-subscription grant is read here, not derived. `grant` is manual.
 */
const COURSE_GRANT_SOURCES: string[] = [
  'course_purchase',
  'course_subscription',
  'grant',
];

/**
 * A course subscription's grant is paused while a chargeback on one of its
 * invoices is open (`course_subscriptions.disputed_at`). Read here rather than
 * revoking the grant: the subscription's own lifecycle rewrites the grant, and
 * would re-grant it (Codex-2hxff.9, docs/payments/subscription-disputes.md).
 *
 * Matched by buyer and course, not by the grant's `source_ref`
 * (Codex-2hxff.59): a grant that outlived its subscription can be carried on
 * by the next one without its `source_ref` changing. Only a subscription that
 * has not ended pauses it, so a re-subscription after a lost dispute (whose
 * ended row keeps `disputed_at`) is not paused. A duplicate subscription
 * grants nothing (Codex-2hxff.15), so its dispute pauses nothing either.
 */
export function grantNotPausedByDispute(): SQL {
  return sql`NOT ${grantPausedByDispute()}`;
}

/**
 * The pause itself: a disputed, unended, non-duplicate course subscription of
 * the grant's buyer to the grant's course. {@link courseGrantHeldByDispute}
 * reads it positively, to say why a course-only item is refused.
 */
function grantPausedByDispute(): SQL {
  return sql`EXISTS (SELECT 1 FROM ${courseSubscriptions} WHERE ${entitlements.source} = 'course_subscription' AND ${courseSubscriptions.userId} = ${entitlements.userId} AND ${courseSubscriptions.courseId} = ${entitlements.courseId} AND ${courseSubscriptions.disputedAt} IS NOT NULL AND ${courseSubscriptions.endedAt} IS NULL AND ${courseSubscriptions.duplicateOfCourseSubscriptionId} IS NULL)`;
}

/**
 * A tier subscription still reaches a course that was taken off sale only
 * until the subscriber's next renewal (Codex-2hxff.64, owner decision
 * 2026-10-21). When a creator leaves an organisation their courses there are
 * archived and stamped `off_sale_at`; the subscriber already paid for the
 * period in which that happened, so the derived grant holds while
 * `off_sale_at >= current_period_start` and ends when a renewal moves the
 * period start past the stamp. A course with no stamp is unaffected — this
 * adds no status condition of its own.
 *
 * Raw `sql` rather than drizzle's `or()`, which is typed `SQL | undefined`:
 * `and()` drops an undefined argument without complaint, and losing this
 * predicate would silently keep every off-sale course open.
 */
function courseStillCoveredBySubscription(): SQL {
  return sql`(${courses.offSaleAt} IS NULL OR ${courses.offSaleAt} >= ${subscriptions.currentPeriodStart})`;
}

/**
 * A stored grant is live when not revoked, not past its optional expiry, and
 * not paused by a dispute. `disputed` picks the side of the dispute pause:
 * the access reads `false`; {@link courseGrantHeldByDispute} reads `true`,
 * the grants a dispute holds back.
 */
function liveGrant(now: Date, disputed = false) {
  return and(
    isNull(entitlements.revokedAt),
    or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now)),
    disputed ? grantPausedByDispute() : grantNotPausedByDispute()
  );
}

/**
 * The derived tier grant: an access-granting, unexpired subscription of this
 * user whose tier has explicit access to the course (joined by the caller),
 * still covering it if it went off sale. Paused while a chargeback on one of
 * its invoices is open; `disputed` picks the side of that pause, as in
 * {@link liveGrant}.
 */
function derivedTierGrant(userId: string, now: Date, disputed = false): SQL[] {
  return [
    eq(subscriptions.userId, userId),
    inArray(subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
    disputed
      ? isNotNull(subscriptions.disputedAt)
      : isNull(subscriptions.disputedAt),
    gt(subscriptions.currentPeriodEnd, now),
    courseStillCoveredBySubscription(),
  ];
}

/**
 * Does the user hold a live STORED entitlement over this content? (`content_purchase`
 * / `grant`.) Additive to `PurchaseService.verifyPurchase` — the two are unioned by
 * the caller (forward-compatible: purchases still authoritative until WP-6 writes
 * grants).
 */
export async function hasStoredContentEntitlement(
  db: AccessQueryClient,
  userId: string,
  contentId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.contentId, contentId),
        inArray(entitlements.source, CONTENT_GRANT_SOURCES),
        liveGrant(new Date())
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Does the user hold a live STORED entitlement over this course? */
async function hasStoredCourseEntitlement(
  db: AccessQueryClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.courseId, courseId),
        inArray(entitlements.source, COURSE_GRANT_SOURCES),
        liveGrant(new Date())
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Does the user's active subscription unlock this course via an EXPLICIT
 * `course_tier_access(courseId, tierId)` grant? Derived live — never a stored row.
 */
async function hasDerivedCourseTierAccess(
  db: AccessQueryClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const rows = await db
    .select({ courseId: courseTierAccess.courseId })
    .from(courseTierAccess)
    .innerJoin(subscriptions, eq(subscriptions.tierId, courseTierAccess.tierId))
    .innerJoin(courses, eq(courses.id, courseTierAccess.courseId))
    .where(
      and(
        eq(courseTierAccess.courseId, courseId),
        ...derivedTierGrant(userId, new Date())
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Does the user hold ANY course entitlement — stored (purchase / course-sub /
 * grant) OR derived tier (SPEC §6.3 `hasCourseEntitlement`)? Backs
 * `canEnterCourse` and the "via a course you own" content arm. The two reads are
 * independent, so they run in parallel.
 */
export async function hasCourseEntitlement(
  db: AccessQueryClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const [stored, derived] = await Promise.all([
    hasStoredCourseEntitlement(db, userId, courseId),
    hasDerivedCourseTierAccess(db, userId, courseId),
  ]);
  return stored || derived;
}

/**
 * BATCHED course-entitlement resolution — the set of course ids (from `courseIds`)
 * the user may enter, in exactly TWO `SELECT`s regardless of N (no N+1 on Neon
 * HTTP; HARDENING §D/§E/§12). Backs `canEnterCoursesBatch` (dashboard/library grid)
 * and, unioned once, the "via a course you own" content arm.
 */
export async function resolveCourseEntitlementsBatch(
  db: AccessQueryClient,
  userId: string,
  courseIds: readonly string[]
): Promise<ReadonlySet<string>> {
  const entitled = new Set<string>();
  if (courseIds.length === 0) return entitled;

  const ids = [...courseIds];
  const now = new Date();

  // Query 1 — stored grants over any of the requested courses.
  const stored = await db
    .select({ courseId: entitlements.courseId })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        inArray(entitlements.courseId, ids),
        inArray(entitlements.source, COURSE_GRANT_SOURCES),
        liveGrant(now)
      )
    );
  for (const row of stored) {
    if (row.courseId) entitled.add(row.courseId);
  }

  // Query 2 — derived tier grants: any requested course whose explicit tier
  // grant intersects an active subscription of this user.
  const derived = await db
    .select({ courseId: courseTierAccess.courseId })
    .from(courseTierAccess)
    .innerJoin(subscriptions, eq(subscriptions.tierId, courseTierAccess.tierId))
    .innerJoin(courses, eq(courses.id, courseTierAccess.courseId))
    .where(
      and(
        inArray(courseTierAccess.courseId, ids),
        ...derivedTierGrant(userId, now)
      )
    );
  for (const row of derived) {
    if (row.courseId) entitled.add(row.courseId);
  }

  return entitled;
}

/**
 * Is this content reachable through a course the user is entitled to? (SPEC §6.3
 * — the `courseOnly` arm and the standalone "via a course you own" fallthrough.)
 *
 * A practice IS a `content` row joined to a course via `stage_practices ⋈
 * course_stages`; soft-deleted stages are excluded. Bounded: ONE query to find
 * the containing courses, then the batched two-query entitlement resolve — three
 * round-trips total, independent of how many courses share the content.
 */
export async function contentReachableViaOwnedCourse(
  db: AccessQueryClient,
  userId: string,
  contentId: string
): Promise<boolean> {
  const courseIds = await coursesContaining(db, contentId);
  if (courseIds.length === 0) return false;

  const entitled = await resolveCourseEntitlementsBatch(db, userId, courseIds);
  return entitled.size > 0;
}

/** The courses whose live stages hold this content. */
async function coursesContaining(
  db: AccessQueryClient,
  contentId: string
): Promise<string[]> {
  const courseRows = await db
    .select({ courseId: courseStages.courseId })
    .from(stagePractices)
    .innerJoin(courseStages, eq(stagePractices.stageId, courseStages.id))
    .where(
      and(
        eq(stagePractices.contentId, contentId),
        isNull(courseStages.deletedAt)
      )
    );
  return [...new Set(courseRows.map((row) => row.courseId).filter(Boolean))];
}

/** The kind of course grant an open payment dispute holds back. */
export type HeldCourseGrant =
  | 'course_purchase'
  | 'course_subscription'
  | 'tier_subscription';

/**
 * Which of the user's course grants over a course holding this content does
 * an open payment dispute hold back? (Codex-2hxff.60, owner decision
 * 2026-10-24: "Notice for courses too".) Read on the access decision's deny
 * path only, so it mirrors the course arm above. `null` when the content is
 * in no course, or no dispute holds a grant back; a purchase answers before a
 * subscription.
 */
export async function courseGrantHeldByDispute(
  db: AccessQueryClient,
  userId: string,
  contentId: string
): Promise<HeldCourseGrant | null> {
  const courseIds = await coursesContaining(db, contentId);
  const held = [
    ...(await courseGrantsHeldByDispute(db, userId, courseIds)).values(),
  ];
  return held.includes('course_purchase')
    ? 'course_purchase'
    : (held[0] ?? null);
}

/**
 * For each of `courseIds`, the user's grant to it that an open payment
 * dispute holds back, by kind (Codex-2hxff.60). Backs the lesson's dispute
 * notice ({@link courseGrantHeldByDispute}) and the course shelf's paused
 * state, so the two cannot disagree.
 *
 * - `'course_purchase'`: a `completed` purchase of the course carrying
 *   `disputed_at`. Its grant was revoked when the chargeback opened; a win
 *   restores both, and a loss refunds the purchase, which then holds nothing.
 * - `'course_subscription'`: a stored course-subscription grant, live but for
 *   {@link grantPausedByDispute}. A duplicate subscription pauses nothing, so
 *   it explains nothing.
 * - `'tier_subscription'`: the derived tier grant of a disputed subscription.
 *
 * Three reads in parallel, independent of N. Whether the user holds the
 * course some other way is the caller's question. A course with more than
 * one held grant reads as its purchase first.
 */
export async function courseGrantsHeldByDispute(
  db: AccessQueryClient,
  userId: string,
  courseIds: readonly string[]
): Promise<ReadonlyMap<string, HeldCourseGrant>> {
  const held = new Map<string, HeldCourseGrant>();
  if (courseIds.length === 0) return held;
  const ids = [...courseIds];
  const now = new Date();

  const [purchased, stored, derived] = await Promise.all([
    db
      .select({ courseId: purchases.courseId })
      .from(purchases)
      .where(
        and(
          eq(purchases.customerId, userId),
          inArray(purchases.courseId, ids),
          eq(purchases.status, PURCHASE_STATUS.COMPLETED),
          isNotNull(purchases.disputedAt)
        )
      ),
    db
      .select({ courseId: entitlements.courseId })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, userId),
          inArray(entitlements.courseId, ids),
          eq(entitlements.source, 'course_subscription'),
          liveGrant(now, true)
        )
      ),
    db
      .select({ courseId: courseTierAccess.courseId })
      .from(courseTierAccess)
      .innerJoin(
        subscriptions,
        eq(subscriptions.tierId, courseTierAccess.tierId)
      )
      .innerJoin(courses, eq(courses.id, courseTierAccess.courseId))
      .where(
        and(
          inArray(courseTierAccess.courseId, ids),
          ...derivedTierGrant(userId, now, true)
        )
      ),
  ]);

  // Lowest precedence first: a later kind overwrites an earlier one.
  for (const row of derived) held.set(row.courseId, 'tier_subscription');
  for (const row of stored) {
    if (row.courseId) held.set(row.courseId, 'course_subscription');
  }
  for (const row of purchased) {
    if (row.courseId) held.set(row.courseId, 'course_purchase');
  }
  return held;
}
