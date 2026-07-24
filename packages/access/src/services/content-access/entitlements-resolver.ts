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
 *   NOT by `sortOrder ≥` (that "and above" semantic is content-only, via
 *   `content.includedInTierId`).
 *
 * ## No N+1 on Neon HTTP (HARDENING §D / §E / §12)
 * {@link resolveCourseEntitlementsBatch} answers N courses in a BOUNDED number of
 * round-trips (two `SELECT`s) regardless of N — the dashboard/library grid gate.
 * Every user-scoped grant read is a `revokedAt IS NULL` + not-expired filter, so
 * revocation is instant.
 */

import { SUBSCRIPTION_STATUS } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  courseStages,
  courseTierAccess,
  entitlements,
  stagePractices,
  subscriptions,
} from '@codex/database/schema';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

/**
 * Read-only query client. Both the base `DatabaseClient` and the transaction
 * client expose `.select` / `.query`, so a resolver read runs under either
 * without an `as any` cast (`feedback_tx_callback_type_derivation`).
 */
type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
export type AccessQueryClient = DatabaseClient | Tx;

/** Subscription statuses that currently grant access (mirrors access-decision.ts). */
const GRANTING_SUBSCRIPTION_STATUSES: string[] = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.CANCELLING,
];

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

/** A stored grant is live when not revoked and not past its optional expiry. */
function liveGrant(now: Date) {
  return and(
    isNull(entitlements.revokedAt),
    or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now))
  );
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
    .where(
      and(
        eq(courseTierAccess.courseId, courseId),
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, GRANTING_SUBSCRIPTION_STATUSES),
        gt(subscriptions.currentPeriodEnd, new Date())
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
    .where(
      and(
        inArray(courseTierAccess.courseId, ids),
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, GRANTING_SUBSCRIPTION_STATUSES),
        gt(subscriptions.currentPeriodEnd, now)
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

  const courseIds = [
    ...new Set(courseRows.map((row) => row.courseId).filter(Boolean)),
  ];
  if (courseIds.length === 0) return false;

  const entitled = await resolveCourseEntitlementsBatch(db, userId, courseIds);
  return entitled.size > 0;
}
