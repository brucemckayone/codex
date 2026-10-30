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
  contentTierAccess,
  courseSubscriptions,
  courses,
  courseTierAccess,
  creatorOrganizationAgreements,
  organizationMemberships,
  subscriptions,
} from '@codex/database/schema';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

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
  // behind the tier switch is in exactly the tiers ticked for it
  // (`content_tier_access`, Codex-2hxff.91; no tier implies another), the same
  // shape as the course arm below. Content that is course-only, team-only or
  // follower-gated never reaches the tier arm, so it is left out.
  const tiersReachingTheirContent = db
    .select({ tierId: contentTierAccess.tierId })
    .from(contentTierAccess)
    .where(
      inArray(
        contentTierAccess.contentId,
        db
          .select({ id: content.id })
          .from(content)
          .where(
            and(
              contentOnSale,
              eq(content.isTierGated, true),
              eq(content.courseOnly, false),
              eq(content.isTeamOnly, false),
              eq(content.isFollowerGated, false)
            )
          )
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
