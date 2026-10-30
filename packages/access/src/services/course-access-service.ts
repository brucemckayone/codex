/**
 * CourseAccessService (Codex-2pryk · WP-6 · SPEC §7).
 *
 * The course-monetization surface that is neither purchase (`@codex/purchase`)
 * nor course-subscription (`@codex/subscription`):
 *   - {@link setTierAccess} — manage the EXACT set of org tiers that unlock a
 *     course (SPEC §7 tier-access, "not just min-tier"), with the N1 write-path
 *     guard that a tier must belong to the course's org.
 *   - {@link getCourseOffer} — the read that composes all three §7 paths + the
 *     viewer's entitlement into the frozen {@link CourseOffer} the sales/landing
 *     surfaces render.
 *
 * Placement: `@codex/access` is downstream of purchase + subscription and is
 * where the entitlement READ side (`EntitlementsService`, the resolver) already
 * lives, so the offer read reuses `hasCourseEntitlement` directly.
 */

import { CONTENT_STATUS } from '@codex/constants';
import {
  courseSubscriptionPlans,
  courses,
  courseTierAccess,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  BaseService,
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';
import type {
  CourseAccessPath,
  CourseOffer,
  CourseTierOffer,
} from '@codex/shared-types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { hasCourseEntitlement } from './content-access/entitlements-resolver';
import { assertCourseCreatorCanBePaid } from './course-payouts';

export class CourseAccessService extends BaseService {
  /** WebSocket-capable client for the delete+insert replace transaction. */
  private get txDb(): typeof import('@codex/database').dbWs {
    return this.db as typeof import('@codex/database').dbWs;
  }

  /**
   * Replace the set of org tiers that grant access to `courseId` with `tierIds`
   * (exact grants, SPEC §7). Passing an empty array clears all tier access.
   *
   * ORG SCOPE (`organizationId` first, the codebase's scoping idiom): the course
   * is resolved by `(id, organizationId)`, so a caller who manages org A can
   * never reach org B's course. Callers hold org management over
   * `organizationId` ONLY — the course id arrives from a client path segment and
   * is therefore untrusted. A course in another org reads as `NotFoundError`,
   * not `ForbiddenError`, so this never confirms that a foreign course exists.
   *
   * N1 GUARD: every tier MUST belong to that same organization. This is the
   * write-path defence; the `course_tier_access` composite FKs are the durable
   * DB backstop (a cross-org row is rejected at INSERT regardless of caller).
   *
   * PAYOUTS (Codex-2hxff.14): adding a tier to a course that is already LIVE
   * opens a way to pay, so it needs the course creator to be payable — as
   * publishing a tier-included course does — else `CreatorPayoutsRequiredError`
   * and nothing is written. Removing tiers is never refused, and a draft is
   * left to the publish check (`CourseJourneyService.saveJourneyPage`).
   *
   * LOCKS (review round 2): every check runs inside the write's transaction,
   * in the plan-access lock order (@codex/subscription tier-service.ts, file
   * header): the tiers FOR SHARE by id, then the course row FOR NO KEY
   * UPDATE, then the ticks. A tier `deleteTier` holds is waited for and then
   * re-read, so a tier deleted meanwhile is refused here instead of ticked,
   * and the delete's sweep never meets this save's half-written ticks (the
   * unlocked check outside the transaction could deadlock with it, 40P01).
   * The course row orders this save with a delete or a copy that holds it,
   * and with another save of the same course.
   */
  async setTierAccess(
    organizationId: string,
    courseId: string,
    tierIds: string[]
  ): Promise<void> {
    try {
      const uniqueTierIds = [...new Set(tierIds)];

      await this.txDb.transaction(async (tx) => {
        // N1: only live tiers in the course's org are found (and locked).
        const validTiers =
          uniqueTierIds.length > 0
            ? await tx
                .select({ id: subscriptionTiers.id })
                .from(subscriptionTiers)
                .where(
                  and(
                    inArray(subscriptionTiers.id, uniqueTierIds),
                    eq(subscriptionTiers.organizationId, organizationId),
                    isNull(subscriptionTiers.deletedAt)
                  )
                )
                .orderBy(asc(subscriptionTiers.id))
                .for('share')
            : [];
        const [course] = await tx
          .select({
            id: courses.id,
            status: courses.status,
            creatorId: courses.creatorId,
          })
          .from(courses)
          .where(
            and(
              eq(courses.id, courseId),
              eq(courses.organizationId, organizationId),
              isNull(courses.deletedAt)
            )
          )
          .for('no key update');
        // The course first: a foreign course reads as not found, whatever
        // the tiers are, so this never confirms that it exists.
        if (!course) {
          throw new NotFoundError('Course not found', {
            courseId,
            organizationId,
          });
        }
        if (validTiers.length !== uniqueTierIds.length) {
          throw new ForbiddenError(
            'Tier access grants must reference tiers in the same organization as the course',
            { courseId, organizationId }
          );
        }

        if (
          uniqueTierIds.length > 0 &&
          course.status === CONTENT_STATUS.PUBLISHED
        ) {
          const granted = await tx
            .select({ tierId: courseTierAccess.tierId })
            .from(courseTierAccess)
            .where(
              and(
                eq(courseTierAccess.courseId, courseId),
                eq(courseTierAccess.organizationId, organizationId)
              )
            );
          const alreadyGranted = new Set(granted.map((row) => row.tierId));
          if (uniqueTierIds.some((tierId) => !alreadyGranted.has(tierId))) {
            await assertCourseCreatorCanBePaid(tx, course.creatorId);
          }
        }

        await tx
          .delete(courseTierAccess)
          .where(eq(courseTierAccess.courseId, courseId));
        if (uniqueTierIds.length > 0) {
          await tx
            .insert(courseTierAccess)
            .values(
              uniqueTierIds.map((tierId) => ({
                courseId,
                tierId,
                organizationId,
              }))
            )
            .onConflictDoNothing();
        }
      });
    } catch (error) {
      this.handleError(error, 'setTierAccess');
    }
  }

  /**
   * Build the complete monetization offer for a course (SPEC §7): every
   * available acquisition path + whether the viewer already holds access.
   */
  async getCourseOffer(
    courseId: string,
    userId: string | null
  ): Promise<CourseOffer> {
    try {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, courseId), isNull(courses.deletedAt)),
        columns: { id: true, organizationId: true, priceCents: true },
      });
      if (!course) {
        throw new NotFoundError('Course not found', { courseId });
      }

      const [plan, tierRows, entitled] = await Promise.all([
        this.db.query.courseSubscriptionPlans.findFirst({
          where: and(
            eq(courseSubscriptionPlans.courseId, courseId),
            eq(courseSubscriptionPlans.isActive, true),
            isNull(courseSubscriptionPlans.deletedAt)
          ),
        }),
        this.db
          .select({
            tierId: subscriptionTiers.id,
            tierName: subscriptionTiers.name,
            priceMonthly: subscriptionTiers.priceMonthly,
            priceAnnual: subscriptionTiers.priceAnnual,
          })
          .from(courseTierAccess)
          .innerJoin(
            subscriptionTiers,
            eq(subscriptionTiers.id, courseTierAccess.tierId)
          )
          .where(
            and(
              eq(courseTierAccess.courseId, courseId),
              isNull(subscriptionTiers.deletedAt)
            )
          ),
        userId
          ? hasCourseEntitlement(this.db, userId, courseId)
          : Promise.resolve(false),
      ]);

      const paths: CourseAccessPath[] = [];

      const purchase =
        course.priceCents != null && course.priceCents > 0
          ? { priceCents: course.priceCents }
          : null;
      if (purchase) paths.push('purchase');

      const subscription = plan
        ? {
            planId: plan.id,
            priceMonthly: plan.priceMonthly,
            priceAnnual: plan.priceAnnual,
          }
        : null;
      if (subscription) paths.push('subscription');

      const tiers: CourseTierOffer[] = tierRows.map((t) => ({
        tierId: t.tierId,
        tierName: t.tierName,
        priceMonthly: t.priceMonthly,
        priceAnnual: t.priceAnnual,
      }));
      if (tiers.length > 0) paths.push('tier');

      return {
        courseId: course.id,
        organizationId: course.organizationId,
        paths,
        purchase,
        subscription,
        tiers,
        entitled,
      };
    } catch (error) {
      this.handleError(error, 'getCourseOffer');
    }
  }
}
