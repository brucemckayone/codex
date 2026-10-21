/**
 * What removing a member would unwind, counted before the owner confirms
 * (Codex-2hxff.64, docs/handover/phase3-sources/removal-off-sale/data-design.md
 * §6). The Studio's Remove dialog shows these counts; the removal itself
 * (`OrganizationService.removeMember`) does not read them.
 *
 * Every count is scoped to the one organisation AND the one creator, and each
 * mirrors a step of the removal:
 * - `agreements`: the active agreements `terminateAgreementsOnDeparture` ends;
 * - `contentOnSale` / `coursesOnSale`: the published, undeleted rows
 *   `withdrawCatalogueOnDeparture` archives (drafts were never on sale);
 * - `courseSubscriptions`: the subscriptions to those courses that the
 *   departure cancels at period end. It reads the cancel's own status list
 *   (`OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES`, which includes
 *   `paused`), so the owner is shown exactly what will be cancelled;
 * - `tierSubscribersAffected`: org subscribers who reach the creator's work
 *   through their tier today, and so lose it at their next renewal.
 *
 * Counts only — nothing personal leaves this function. Not cached: it is read
 * once, when the dialog opens, and must be current.
 */

import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  content,
  courseSubscriptions,
  courses,
  courseTierAccess,
  creatorOrganizationAgreements,
  organizationMemberships,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { and, eq, inArray, isNotNull, isNull, min, or, sql } from 'drizzle-orm';

export interface DeparturePreview {
  agreements: number;
  contentOnSale: number;
  coursesOnSale: number;
  courseSubscriptions: number;
  tierSubscribersAffected: number;
}

/**
 * The counts for `creatorId` in `organizationId`, in one round trip: five
 * scalar `count(*)` subqueries, selected against the member's own membership
 * row. `null` when the user has no membership in the organisation (the
 * removal answers that case with `MemberNotFoundError` too).
 */
export async function countDepartureEffects(
  db: DatabaseClient,
  scope: { organizationId: string; creatorId: string }
): Promise<DeparturePreview | null> {
  const { organizationId, creatorId } = scope;
  const grantingStatuses = [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES];

  const contentOnSale = and(
    eq(content.organizationId, organizationId),
    eq(content.creatorId, creatorId),
    eq(content.status, 'published'),
    isNull(content.deletedAt)
  );
  const coursesOnSale = and(
    eq(courses.organizationId, organizationId),
    eq(courses.creatorId, creatorId),
    eq(courses.status, 'published'),
    isNull(courses.deletedAt)
  );
  const courseIdsOnSale = db
    .select({ id: courses.id })
    .from(courses)
    .where(coursesOnSale);

  // Tier reach follows the access decision (`decideContentAccess`): content
  // with `includedInTierId` T is in tier T AND every tier above it by
  // `sortOrder`, so the subscribers who reach the creator's tier content are
  // those on a tier at or above the LOWEST tier any of it sits in. Content that
  // is course-only, team-only or follower-gated never reaches the tier arm,
  // so it is left out. No such content → the minimum is NULL and no tier
  // qualifies.
  const lowestTierWithTheirContent = db
    .select({ sortOrder: min(subscriptionTiers.sortOrder) })
    .from(subscriptionTiers)
    .where(
      inArray(
        subscriptionTiers.id,
        db
          .select({ tierId: content.includedInTierId })
          .from(content)
          .where(
            and(
              contentOnSale,
              isNotNull(content.includedInTierId),
              eq(content.courseOnly, false),
              eq(content.isTeamOnly, false),
              eq(content.isFollowerGated, false)
            )
          )
      )
    );
  const tiersReachingTheirContent = db
    .select({ id: subscriptionTiers.id })
    .from(subscriptionTiers)
    .where(
      and(
        eq(subscriptionTiers.organizationId, organizationId),
        sql`${subscriptionTiers.sortOrder} >= ${lowestTierWithTheirContent}`
      )
    );
  // A tier unlocks a course only by an explicit `course_tier_access` row (no
  // hierarchy), and that access ends at renewal too (owner decision Q2).
  const tiersUnlockingTheirCourses = db
    .select({ tierId: courseTierAccess.tierId })
    .from(courseTierAccess)
    .where(inArray(courseTierAccess.courseId, courseIdsOnSale));

  const [row] = await db
    .select({
      agreements: db.$count(
        creatorOrganizationAgreements,
        and(
          eq(creatorOrganizationAgreements.organizationId, organizationId),
          eq(creatorOrganizationAgreements.creatorId, creatorId),
          eq(creatorOrganizationAgreements.status, 'active')
        )
      ),
      contentOnSale: db.$count(content, contentOnSale),
      coursesOnSale: db.$count(courses, coursesOnSale),
      courseSubscriptions: db.$count(
        courseSubscriptions,
        and(
          inArray(courseSubscriptions.courseId, courseIdsOnSale),
          inArray(courseSubscriptions.status, [
            ...OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES,
          ]),
          eq(courseSubscriptions.cancelAtPeriodEnd, false)
        )
      ),
      tierSubscribersAffected: db.$count(
        subscriptions,
        and(
          eq(subscriptions.organizationId, organizationId),
          inArray(subscriptions.status, grantingStatuses),
          or(
            inArray(subscriptions.tierId, tiersReachingTheirContent),
            inArray(subscriptions.tierId, tiersUnlockingTheirCourses)
          )
        )
      ),
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, creatorId)
      )
    )
    .limit(1);

  return row ?? null;
}
