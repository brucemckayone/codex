/**
 * Entitlement + enrollment WRITE seam (Codex-2pryk · WP-6).
 *
 * The write side of the greenfield access core: on a completed course/content
 * acquisition these functions INSERT the `entitlements` grant row that the WP-2
 * resolver (`@codex/access` `entitlements-resolver.ts`) READS, closing the
 * buy → grant-written → resolver-grants round-trip.
 *
 * Placement: `@codex/purchase` is upstream of `@codex/subscription` (which
 * depends on it) and of `@codex/access`, so BOTH the one-off purchase path
 * (`PurchaseService`) and the course-subscription path (`CourseSubscriptionService`)
 * reuse ONE grant writer without a dependency cycle — `PurchaseService` cannot
 * import `@codex/access`, and duplicating money-adjacent inserts would drift.
 *
 * ## Idempotency
 * Every INSERT is `ON CONFLICT DO NOTHING` against the partial unique indexes
 * `uq_entitlement_live_content` / `uq_entitlement_live_course` (one LIVE grant
 * per user × resource × source). A Stripe webhook redelivery is therefore a
 * no-op, never a duplicate grant. The indexes are scoped to `revokedAt IS NULL`,
 * so a lawful re-purchase AFTER revocation still writes a fresh grant.
 *
 * ## Auto-enrollment (D-G)
 * A course grant also creates a `course_enrollments` side-record (idempotent via
 * `uq_course_enrollment_user_course`). Enrollment is NOT a gate — `canEnterCourse`
 * gates on the entitlement — it is the library/progress shelf, so it is written
 * best-effort alongside the grant, in the SAME transaction where one is passed.
 */

import type { DatabaseClient } from '@codex/database';
import { courseEnrollments, entitlements } from '@codex/database/schema';
import type { StoredEntitlementSource } from '@codex/shared-types';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * A write-capable query client. Both the base `DatabaseClient` and a transaction
 * client expose `.insert` / `.update`, so a grant write runs identically under
 * either without an `as any` cast (mirrors the resolver's `AccessQueryClient`).
 */
type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
export type EntitlementWriteClient = DatabaseClient | Tx;

/**
 * Grant a CONTENT entitlement for a completed one-off purchase (SPEC §6.2,
 * `source='content_purchase'`). Additive to the authoritative `contentAccess`
 * row + `verifyPurchase` — the resolver unions the two, so this is the
 * forward-compatible grant the resolver reads directly.
 *
 * `organizationId` is REQUIRED (the `entitlements` table's org FK is NOT NULL,
 * and the frozen `Entitlement.organizationId` is non-nullable). Orgless
 * (bi-party) content purchases therefore write NO entitlement row and rely on
 * `verifyPurchase` alone — the caller must skip this write when org is null.
 */
export async function writeContentPurchaseEntitlement(
  client: EntitlementWriteClient,
  params: {
    userId: string;
    organizationId: string;
    contentId: string;
    purchaseId: string;
  }
): Promise<void> {
  await client
    .insert(entitlements)
    .values({
      userId: params.userId,
      organizationId: params.organizationId,
      contentId: params.contentId,
      source: 'content_purchase',
      sourceRef: params.purchaseId,
    })
    .onConflictDoNothing();
}

/**
 * Grant a COURSE entitlement for a completed one-off course purchase (permanent,
 * `source='course_purchase'`) and auto-enroll (D-G).
 */
export async function writeCoursePurchaseEntitlement(
  client: EntitlementWriteClient,
  params: {
    userId: string;
    organizationId: string;
    courseId: string;
    purchaseId: string;
  }
): Promise<void> {
  await client
    .insert(entitlements)
    .values({
      userId: params.userId,
      organizationId: params.organizationId,
      courseId: params.courseId,
      source: 'course_purchase',
      sourceRef: params.purchaseId,
    })
    .onConflictDoNothing();
  await autoEnroll(client, {
    userId: params.userId,
    courseId: params.courseId,
    source: 'course_purchase',
  });
}

/**
 * Grant a COURSE entitlement for an active course-specific subscription
 * (`source='course_subscription'`) and auto-enroll (D-G).
 *
 * `expiresAt` is the subscription's `currentPeriodEnd`: the stored grant is
 * fail-closed — if a renewal is missed the grant lapses on its own (the resolver
 * filters `expiresAt > now`), even before a `customer.subscription.deleted`
 * webhook lands. Renewals bump it via {@link refreshCourseSubscriptionEntitlementExpiry}.
 */
export async function writeCourseSubscriptionEntitlement(
  client: EntitlementWriteClient,
  params: {
    userId: string;
    organizationId: string;
    courseId: string;
    courseSubscriptionId: string;
    expiresAt: Date;
  }
): Promise<void> {
  await client
    .insert(entitlements)
    .values({
      userId: params.userId,
      organizationId: params.organizationId,
      courseId: params.courseId,
      source: 'course_subscription',
      sourceRef: params.courseSubscriptionId,
      expiresAt: params.expiresAt,
    })
    .onConflictDoNothing();
  await autoEnroll(client, {
    userId: params.userId,
    courseId: params.courseId,
    source: 'course_subscription',
  });
}

/**
 * Extend the live course-subscription grant's `expiresAt` on a renewal
 * (`invoice.payment_succeeded`). No-op when no live grant exists (self-heal
 * writes it first). Idempotent — replaying the same invoice just re-sets the
 * same period end.
 */
export async function refreshCourseSubscriptionEntitlementExpiry(
  client: EntitlementWriteClient,
  params: { userId: string; courseId: string; expiresAt: Date }
): Promise<void> {
  await client
    .update(entitlements)
    .set({ expiresAt: params.expiresAt })
    .where(
      and(
        eq(entitlements.userId, params.userId),
        eq(entitlements.courseId, params.courseId),
        eq(entitlements.source, 'course_subscription'),
        isNull(entitlements.revokedAt)
      )
    );
}

/**
 * Revoke the live course-subscription grant immediately (subscription deleted /
 * unpaid). Sets `revokedAt` so the resolver stops granting on the next read —
 * this is the hard cut-off for an access-reducing lifecycle event, distinct from
 * the soft `expiresAt` lapse used for missed renewals. Idempotent.
 */
export async function revokeCourseSubscriptionEntitlement(
  client: EntitlementWriteClient,
  params: { userId: string; courseId: string }
): Promise<void> {
  await client
    .update(entitlements)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(entitlements.userId, params.userId),
        eq(entitlements.courseId, params.courseId),
        eq(entitlements.source, 'course_subscription'),
        isNull(entitlements.revokedAt)
      )
    );
}

/**
 * Auto-create the `course_enrollments` side-record for a course grant (D-G).
 * Idempotent via `uq_course_enrollment_user_course`. Enrollment is the
 * library/progress shelf, NOT the access gate.
 */
export async function autoEnroll(
  client: EntitlementWriteClient,
  params: {
    userId: string;
    courseId: string;
    source: StoredEntitlementSource | 'tier_subscription' | 'first_access';
  }
): Promise<void> {
  await client
    .insert(courseEnrollments)
    .values({
      userId: params.userId,
      courseId: params.courseId,
      source: params.source,
    })
    .onConflictDoNothing();
}
