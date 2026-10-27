/**
 * The success pages' verify reads for a DUPLICATE subscription (Codex-o4jvw).
 * Real DB, mocked Stripe session. A second subscription the user already had
 * (Codex-2hxff.15, "Keep the first") is cancelled and refunded, so the page
 * must not confirm it: verify names the subscription the user keeps instead.
 *
 * Rows are written directly, as the webhook would have recorded them: the kept
 * subscription live, the duplicate `cancelled` and pointing at it. Each
 * duplicate is written already SETTLED, so no other suite's
 * `settleOwedDuplicates` sweep (global by design) picks it up, and every row is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, inArray, isNotNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../errors';
import { CourseSubscriptionService } from '../course-subscription-service';
import { SubscriptionService } from '../subscription-service';

const DAY_MS = 24 * 3600 * 1000;

/** A Stripe client whose `checkout.sessions.retrieve` answers `session`. */
function stripeReturning(session: Record<string, unknown>): Stripe {
  const stripe = createMockStripe();
  (
    stripe.checkout.sessions as unknown as {
      retrieve: ReturnType<typeof vi.fn>;
    }
  ).retrieve = vi.fn().mockResolvedValue(session);
  return stripe;
}

/** A complete subscription-mode session, owned by `userId`. */
function completeSession(userId: string, stripeSubscriptionId: string) {
  return {
    id: `cs_${randomUUID().slice(0, 8)}`,
    status: 'complete',
    subscription: stripeSubscriptionId,
    metadata: { codex_user_id: userId },
  };
}

describe('verifyCheckoutSession on a duplicate subscription (Codex-o4jvw)', () => {
  let db: Database;
  let userId: string;
  let creatorId: string;
  const orgIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [userId, creatorId] = await seedTestUsers(db, 2);
  });

  afterAll(async () => {
    if (orgIds.length > 0) {
      // Duplicates first: `duplicate_of_*` is ON DELETE RESTRICT.
      const courseRows = inArray(courseSubscriptions.organizationId, orgIds);
      await db
        .delete(courseSubscriptions)
        .where(
          and(
            courseRows,
            isNotNull(courseSubscriptions.duplicateOfCourseSubscriptionId)
          )
        );
      await db.delete(courseSubscriptions).where(courseRows);
      const tierRows = inArray(subscriptions.organizationId, orgIds);
      await db
        .delete(subscriptions)
        .where(
          and(tierRows, isNotNull(subscriptions.duplicateOfSubscriptionId))
        );
      await db.delete(subscriptions).where(tierRows);
    }
    await teardownTestDatabase();
  });

  describe('organisation tier', () => {
    async function orgWithTiers() {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({ slug: createUniqueSlug('dup-v') })
          )
          .returning(),
        'organization'
      );
      orgIds.push(org.id);
      const basic = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { name: 'Basic', sortOrder: 1 }))
          .returning(),
        'tier'
      );
      const pro = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { name: 'Pro', sortOrder: 2 }))
          .returning(),
        'tier'
      );
      return { org, basic, pro };
    }

    it('names the subscription the user keeps, and its tier', async () => {
      const { org, basic, pro } = await orgWithTiers();
      const kept = takeFirst(
        await db
          .insert(subscriptions)
          .values(createTestSubscriptionInput(userId, org.id, basic.id))
          .returning(),
        'kept subscription'
      );
      const duplicate = takeFirst(
        await db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(userId, org.id, pro.id, {
              status: 'cancelled',
              cancelledAt: new Date(),
              duplicateOfSubscriptionId: kept.id,
              duplicateSettledAt: new Date(),
            })
          )
          .returning(),
        'duplicate subscription'
      );
      const service = new SubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, duplicate.stripeSubscriptionId))
      );

      const result = await service.verifyCheckoutSession('cs_dup', userId);

      expect(result.sessionStatus).toBe('complete');
      // The row itself is still the duplicate's: the page reads its tier as
      // the one the user paid for, and `duplicateOf` as the one they keep.
      expect(result.subscription?.id).toBe(duplicate.id);
      expect(result.subscription?.tierName).toBe('Pro');
      expect(result.subscription?.organizationName).toBe(org.name);
      expect(result.subscription?.duplicateOf).toEqual({
        id: kept.id,
        tierId: basic.id,
        tierName: 'Basic',
      });
    });

    it('carries no duplicateOf for the subscription the user keeps', async () => {
      const { org, basic } = await orgWithTiers();
      const kept = takeFirst(
        await db
          .insert(subscriptions)
          .values(createTestSubscriptionInput(userId, org.id, basic.id))
          .returning(),
        'kept subscription'
      );
      const service = new SubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, kept.stripeSubscriptionId))
      );

      const result = await service.verifyCheckoutSession('cs_kept', userId);

      expect(result.subscription?.id).toBe(kept.id);
      expect(result.subscription?.duplicateOf).toBeUndefined();
    });

    it("does not read another user's row for the session", async () => {
      const { org, basic } = await orgWithTiers();
      const theirs = takeFirst(
        await db
          .insert(subscriptions)
          .values(createTestSubscriptionInput(creatorId, org.id, basic.id))
          .returning(),
        'their subscription'
      );

      // The session's metadata says it is this user's, but the row is not.
      const result = await new SubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, theirs.stripeSubscriptionId))
      ).verifyCheckoutSession('cs_mismatch', userId);

      expect(result).toEqual({ sessionStatus: 'complete' });
    });
  });

  describe('course plan', () => {
    async function courseWithPlan(title: string) {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({ slug: createUniqueSlug('dup-c') })
          )
          .returning(),
        'organization'
      );
      orgIds.push(org.id);
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: org.id,
            creatorId,
            slug: createUniqueSlug('dup-course'),
            title,
            status: 'published',
            priceCents: null,
          })
          .returning(),
        'course'
      );
      const plan = takeFirst(
        await db
          .insert(courseSubscriptionPlans)
          .values({
            courseId: course.id,
            priceMonthly: 5000,
            priceAnnual: 50000,
            stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
            stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
            stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
          })
          .returning(),
        'plan'
      );
      return { org, course, plan };
    }

    async function insertCourseSubscription(
      ids: { orgId: string; courseId: string; planId: string },
      overrides: Partial<typeof courseSubscriptions.$inferInsert> = {}
    ) {
      const now = Date.now();
      return takeFirst(
        await db
          .insert(courseSubscriptions)
          .values({
            userId,
            courseId: ids.courseId,
            planId: ids.planId,
            organizationId: ids.orgId,
            stripeSubscriptionId: `sub_${randomUUID().slice(0, 8)}`,
            stripeCustomerId: `cus_${randomUUID().slice(0, 8)}`,
            status: 'active',
            billingInterval: 'month',
            currentPeriodStart: new Date(now),
            currentPeriodEnd: new Date(now + 30 * DAY_MS),
            ...overrides,
          })
          .returning(),
        'course subscription'
      );
    }

    it('names the course, and for a duplicate the subscription the user keeps', async () => {
      const { org, course, plan } = await courseWithPlan('Rootwork');
      const ids = { orgId: org.id, courseId: course.id, planId: plan.id };
      const kept = await insertCourseSubscription(ids);
      const duplicate = await insertCourseSubscription(ids, {
        status: 'cancelled',
        cancelledAt: new Date(),
        duplicateOfCourseSubscriptionId: kept.id,
        duplicateSettledAt: new Date(),
      });

      const forDuplicate = await new CourseSubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, duplicate.stripeSubscriptionId))
      ).verifyCheckoutSession('cs_dup', userId);

      expect(forDuplicate.sessionStatus).toBe('complete');
      expect(forDuplicate.subscription).toMatchObject({
        id: duplicate.id,
        courseId: course.id,
        courseTitle: 'Rootwork',
        duplicateOf: { id: kept.id },
      });

      const forKept = await new CourseSubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, kept.stripeSubscriptionId))
      ).verifyCheckoutSession('cs_kept', userId);

      expect(forKept.subscription?.id).toBe(kept.id);
      expect(forKept.subscription?.duplicateOf).toBeUndefined();
    });

    it('reports no subscription until our row exists, so the page keeps waiting', async () => {
      const result = await new CourseSubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, 'sub_not_yet_recorded'))
      ).verifyCheckoutSession('cs_race', userId);

      expect(result).toEqual({ sessionStatus: 'complete' });
    });

    it("refuses a session that is not the user's own", async () => {
      const service = new CourseSubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(creatorId, 'sub_someone_else'))
      );

      await expect(
        service.verifyCheckoutSession('cs_other', userId)
      ).rejects.toThrow(ForbiddenError);
    });

    it("does not read another user's row for the session", async () => {
      const { org, course, plan } = await courseWithPlan('Not yours');
      const theirs = await insertCourseSubscription(
        { orgId: org.id, courseId: course.id, planId: plan.id },
        { userId: creatorId }
      );

      // The session's metadata says it is this user's, but the row is not.
      const result = await new CourseSubscriptionService(
        { db, environment: 'test' },
        stripeReturning(completeSession(userId, theirs.stripeSubscriptionId))
      ).verifyCheckoutSession('cs_mismatch', userId);

      expect(result.subscription).toBeUndefined();
    });
  });
});
