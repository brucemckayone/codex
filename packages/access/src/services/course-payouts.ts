/**
 * Courses follow the content rule "any priced item needs the creator's payouts
 * set up to publish" (owner, 2026-10-22: "Yes, same rule" — Codex-2hxff.14).
 *
 * A course earns money through any of the ways in that
 * `CourseAccessService.getCourseOffer` presents (SPEC §7): a one-off price (`courses.price_cents > 0`), a live
 * course subscription plan (`course_subscription_plans`, active and not
 * deleted), or inclusion in an org tier (`course_tier_access`, any row — an
 * archived tier still lets its subscribers in, as an archived
 * `content.included_in_tier_id` does).
 *
 * The refusal is `@codex/content`'s own `CreatorPayoutsRequiredError`, so the
 * Studio shows the one "set up payouts" message whichever kind of item it was.
 */

import { CreatorPayoutsRequiredError } from '@codex/content';
import {
  courseSubscriptionPlans,
  courseTierAccess,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { AccessQueryClient } from './content-access/entitlements-resolver';

/**
 * Does the course, as stored, earn money through any way in? The caller has
 * already resolved `course.id` inside `organizationId`.
 */
export async function courseEarnsMoney(
  db: AccessQueryClient,
  organizationId: string,
  course: { id: string; priceCents: number | null }
): Promise<boolean> {
  if ((course.priceCents ?? 0) > 0) return true;

  const [plan] = await db
    .select({ id: courseSubscriptionPlans.id })
    .from(courseSubscriptionPlans)
    .where(
      and(
        eq(courseSubscriptionPlans.courseId, course.id),
        eq(courseSubscriptionPlans.isActive, true),
        isNull(courseSubscriptionPlans.deletedAt)
      )
    )
    .limit(1);
  if (plan) return true;

  const [tier] = await db
    .select({ tierId: courseTierAccess.tierId })
    .from(courseTierAccess)
    .where(
      and(
        eq(courseTierAccess.courseId, course.id),
        eq(courseTierAccess.organizationId, organizationId)
      )
    )
    .limit(1);
  return tier !== undefined;
}

/**
 * Throw unless the course creator can be paid. The same DB-only readiness
 * check `ContentService` makes: `stripe_connect_accounts` (one row per user)
 * mirrors Stripe's `charges_enabled` / `payouts_enabled` via `account.updated`.
 *
 * @throws {CreatorPayoutsRequiredError} No account, or one not charges +
 *   payouts enabled
 */
export async function assertCourseCreatorCanBePaid(
  db: AccessQueryClient,
  creatorId: string
): Promise<void> {
  const [account] = await db
    .select({
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.userId, creatorId))
    .limit(1);

  if (account?.chargesEnabled && account.payoutsEnabled) return;
  throw new CreatorPayoutsRequiredError(creatorId, 'course');
}
