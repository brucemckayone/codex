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
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hasCourseEntitlement } from './content-access/entitlements-resolver';

export class CourseAccessService extends BaseService {
  /** WebSocket-capable client for the delete+insert replace transaction. */
  private get txDb(): typeof import('@codex/database').dbWs {
    return this.db as typeof import('@codex/database').dbWs;
  }

  /**
   * Replace the set of org tiers that grant access to `courseId` with `tierIds`
   * (exact grants, SPEC §7). Passing an empty array clears all tier access.
   *
   * N1 GUARD: every tier MUST belong to the course's organization. This is the
   * write-path defence; the `course_tier_access` composite FKs are the durable
   * DB backstop (a cross-org row is rejected at INSERT regardless of caller).
   */
  async setTierAccess(courseId: string, tierIds: string[]): Promise<void> {
    try {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, courseId), isNull(courses.deletedAt)),
        columns: { id: true, organizationId: true },
      });
      if (!course) {
        throw new NotFoundError('Course not found', { courseId });
      }

      const uniqueTierIds = [...new Set(tierIds)];

      if (uniqueTierIds.length > 0) {
        // N1: reject any tier that is not a live tier in the course's org.
        const validTiers = await this.db
          .select({ id: subscriptionTiers.id })
          .from(subscriptionTiers)
          .where(
            and(
              inArray(subscriptionTiers.id, uniqueTierIds),
              eq(subscriptionTiers.organizationId, course.organizationId),
              isNull(subscriptionTiers.deletedAt)
            )
          );
        if (validTiers.length !== uniqueTierIds.length) {
          throw new ForbiddenError(
            'Tier access grants must reference tiers in the same organization as the course',
            { courseId, organizationId: course.organizationId }
          );
        }
      }

      await this.txDb.transaction(async (tx) => {
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
                organizationId: course.organizationId,
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
