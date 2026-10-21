/**
 * Access to a removed creator's catalogue (Codex-2hxff.64).
 *
 * When a creator is removed from an organisation, their published content and
 * courses there are archived and stamped `off_sale_at`. Owner decisions,
 * 2026-10-21:
 *   - a one-off BUYER keeps what they bought (the Codex-p3m5j rule, unchanged);
 *   - a TIER SUBSCRIBER keeps that creator's content — and the courses their
 *     tier reaches — only UNTIL THEIR NEXT RENEWAL: access holds while
 *     `off_sale_at >= current_period_start` of the granting subscription;
 *   - a FOLLOWER who does not subscribe loses it, as on any unpublication;
 *   - an ordinary unpublished item (no `off_sale_at`) behaves exactly as before.
 *
 * REAL Postgres, so the `off_sale_at` comparisons run as SQL where they are SQL
 * (course entry, the library) and as the decision core where they are not
 * (canView, getStreamingUrl). Two subscribers bracket the stamp:
 *   - IN PERIOD: the period began 20 days ago, the item went off sale 5 days ago;
 *   - RENEWED:   the period began 2 days ago, AFTER the item went off sale.
 *
 * Every row this file writes is deleted in `afterAll` — subscriptions and
 * purchases are tables whole-table jobs read.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courses,
  courseTierAccess,
  organizationFollowers,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import {
  createTestContentInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { ListUserLibraryInput } from '@codex/validation';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessDeniedError } from '../../errors';
import { ContentAccessService } from '../ContentAccessService';
import { CourseAccessService } from '../course-access-service';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY);

/** When the creator was removed and their catalogue went off sale. */
const OFF_SALE_AT = daysAgo(5);

describe('a removed creator’s catalogue (Codex-2hxff.64)', () => {
  let db: Database;
  let svc: ContentAccessService;

  let orgId: string;
  let tierId: string;

  let purchaserId: string;
  let inPeriodSubId: string;
  let renewedSubId: string;
  let followerId: string;

  let paidOffSaleId: string;
  let tierOffSaleId: string;
  let tierDraftId: string;
  let tierPublishedId: string;
  let followerOffSaleId: string;

  let courseOffSaleId: string;
  let coursePublishedId: string;

  const contentIds: string[] = [];
  const courseIds: string[] = [];
  let purchaseId: string;

  async function insertContent(
    creatorId: string,
    overrides: Parameters<typeof createTestContentInput>[1]
  ): Promise<string> {
    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: orgId,
          // Written: getStreamingUrl returns a null URL after the decision,
          // so no media or signing is involved.
          contentType: 'written',
          isFree: false,
          ...overrides,
        })
      )
      .returning({ id: content.id });
    if (!row) throw new Error('failed to seed content');
    contentIds.push(row.id);
    return row.id;
  }

  async function insertCourse(
    creatorId: string,
    overrides: { status: string; offSaleAt: Date | null }
  ): Promise<string> {
    const [row] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('course'),
        title: 'Off-sale course',
        priceCents: null,
        publishedAt: daysAgo(30),
        ...overrides,
      })
      .returning({ id: courses.id });
    if (!row) throw new Error('failed to seed course');
    courseIds.push(row.id);
    return row.id;
  }

  function library(
    accessType: ListUserLibraryInput['accessType']
  ): ListUserLibraryInput {
    return {
      page: 1,
      limit: 50,
      organizationId: orgId,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType,
      search: '',
    };
  }

  async function libraryIds(
    userId: string,
    accessType: ListUserLibraryInput['accessType']
  ): Promise<string[]> {
    const result = await svc.listUserLibrary(userId, library(accessType));
    return result.items.map((item) => item.content.id);
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creatorId, purchaser, inPeriodSub, renewedSub, follower] =
      await seedTestUsers(db, 5);
    if (!creatorId || !purchaser || !inPeriodSub || !renewedSub || !follower) {
      throw new Error('failed to seed test users');
    }
    purchaserId = purchaser;
    inPeriodSubId = inPeriodSub;
    renewedSubId = renewedSub;
    followerId = follower;

    // Real verifyPurchase against the purchases table; Stripe is never reached.
    const purchaseService = new PurchaseService(
      { db, environment: 'test' },
      {} as Stripe
    );
    const r2 = new Proxy(
      {},
      {
        get: () => {
          throw new Error('signing ran: written content has nothing to sign');
        },
      }
    ) as R2;
    svc = new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Off-sale org', slug: createUniqueSlug('offsale') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;

    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    if (!tier) throw new Error('failed to create tier');
    tierId = tier.id;

    await db.insert(subscriptions).values([
      createTestSubscriptionInput(inPeriodSubId, orgId, tierId, {
        currentPeriodStart: daysAgo(20),
        currentPeriodEnd: daysFromNow(10),
      }),
      createTestSubscriptionInput(renewedSubId, orgId, tierId, {
        currentPeriodStart: daysAgo(2),
        currentPeriodEnd: daysFromNow(28),
      }),
    ]);
    await db
      .insert(organizationFollowers)
      .values({ organizationId: orgId, userId: followerId });

    const offSale = {
      status: 'archived',
      publishedAt: daysAgo(30),
      offSaleAt: OFF_SALE_AT,
    };
    paidOffSaleId = await insertContent(creatorId, {
      isPurchasable: true,
      priceCents: 900,
      ...offSale,
    });
    tierOffSaleId = await insertContent(creatorId, {
      includedInTierId: tierId,
      ...offSale,
    });
    tierDraftId = await insertContent(creatorId, {
      includedInTierId: tierId,
      status: 'draft',
      offSaleAt: null,
    });
    tierPublishedId = await insertContent(creatorId, {
      includedInTierId: tierId,
      status: 'published',
      publishedAt: daysAgo(30),
      offSaleAt: null,
    });
    followerOffSaleId = await insertContent(creatorId, {
      isFollowerGated: true,
      ...offSale,
    });

    const [purchase] = await db
      .insert(purchases)
      .values({
        customerId: purchaserId,
        contentId: paidOffSaleId,
        organizationId: orgId,
        amountPaidCents: 900,
        currency: 'gbp',
        platformFeeCents: 0,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_${randomUUID()}`,
        status: 'completed',
        purchasedAt: daysAgo(40),
        createdAt: daysAgo(40),
      })
      .returning({ id: purchases.id });
    if (!purchase) throw new Error('failed to seed purchase');
    purchaseId = purchase.id;

    courseOffSaleId = await insertCourse(creatorId, {
      status: 'archived',
      offSaleAt: OFF_SALE_AT,
    });
    coursePublishedId = await insertCourse(creatorId, {
      status: 'published',
      offSaleAt: null,
    });
    const courseAccess = new CourseAccessService({ db, environment: 'test' });
    await courseAccess.setTierAccess(orgId, courseOffSaleId, [tierId]);
    await courseAccess.setTierAccess(orgId, coursePublishedId, [tierId]);
  });

  afterAll(async () => {
    if (db && orgId) {
      if (purchaseId) {
        await db.delete(purchases).where(eq(purchases.id, purchaseId));
      }
      if (courseIds.length > 0) {
        await db
          .delete(courseTierAccess)
          .where(inArray(courseTierAccess.courseId, courseIds));
        await db.delete(courses).where(inArray(courses.id, courseIds));
      }
      if (contentIds.length > 0) {
        await db.delete(content).where(inArray(content.id, contentIds));
      }
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.organizationId, orgId));
      await db
        .delete(organizationFollowers)
        .where(eq(organizationFollowers.organizationId, orgId));
      await db
        .delete(subscriptionTiers)
        .where(eq(subscriptionTiers.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await teardownTestDatabase();
  });

  describe('a one-off buyer keeps what they bought', () => {
    it('grants the purchaser off-sale paid content (canView)', async () => {
      expect(await svc.canView(purchaserId, paidOffSaleId)).toBe(true);
    });

    it('grants the purchaser off-sale paid content (getStreamingUrl)', async () => {
      const result = await svc.getStreamingUrl(purchaserId, {
        contentId: paidOffSaleId,
        expirySeconds: 600,
      });
      expect(result.streamingUrl).toBeNull();
    });

    it('CONTROL: a subscriber who did not buy it is denied the paid item', async () => {
      expect(await svc.canView(inPeriodSubId, paidOffSaleId)).toBe(false);
    });
  });

  describe('a tier subscriber keeps it until their next renewal', () => {
    it('grants a subscriber whose period began before the item went off sale', async () => {
      expect(await svc.canView(inPeriodSubId, tierOffSaleId)).toBe(true);
      const result = await svc.getStreamingUrl(inPeriodSubId, {
        contentId: tierOffSaleId,
        expirySeconds: 600,
      });
      expect(result.streamingUrl).toBeNull();
    });

    it('denies a subscriber who has renewed since it went off sale', async () => {
      expect(await svc.canView(renewedSubId, tierOffSaleId)).toBe(false);
      await expect(
        svc.getStreamingUrl(renewedSubId, {
          contentId: tierOffSaleId,
          expirySeconds: 600,
        })
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('CONTROL: the renewed subscriber still reaches the tier’s published content', async () => {
      expect(await svc.canView(renewedSubId, tierPublishedId)).toBe(true);
    });
  });

  // A subscriber who ALSO bought the item: once it is off offer the purchase
  // must answer before the subscription, or the renewal rule would take away
  // something they own (Codex-2hxff.64; "one-off buyers keep what they bought").
  it('keeps the item for a renewed subscriber who also bought it', async () => {
    const [bought] = await db
      .insert(purchases)
      .values({
        customerId: renewedSubId,
        contentId: tierOffSaleId,
        organizationId: orgId,
        amountPaidCents: 900,
        currency: 'gbp',
        platformFeeCents: 0,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_${randomUUID()}`,
        status: 'completed',
        purchasedAt: daysAgo(40),
        createdAt: daysAgo(40),
      })
      .returning({ id: purchases.id });
    if (!bought) throw new Error('failed to seed purchase');
    try {
      expect(await svc.canView(renewedSubId, tierOffSaleId)).toBe(true);
    } finally {
      await db.delete(purchases).where(eq(purchases.id, bought.id));
    }
    // Without the purchase the renewal rule applies again.
    expect(await svc.canView(renewedSubId, tierOffSaleId)).toBe(false);
  });

  describe('follower-gated content follows the same rule for subscribers only', () => {
    it('grants a subscriber within the period', async () => {
      expect(await svc.canView(inPeriodSubId, followerOffSaleId)).toBe(true);
    });

    it('denies a subscriber who has renewed since', async () => {
      expect(await svc.canView(renewedSubId, followerOffSaleId)).toBe(false);
    });

    it('denies a follower with no subscription — a follow is not a payment', async () => {
      expect(await svc.canView(followerId, followerOffSaleId)).toBe(false);
      await expect(
        svc.getStreamingUrl(followerId, {
          contentId: followerOffSaleId,
          expirySeconds: 600,
        })
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });
  });

  describe('an ordinary unpublished item is unchanged', () => {
    it('denies a draft with no off_sale_at to a subscriber in period', async () => {
      expect(await svc.canView(inPeriodSubId, tierDraftId)).toBe(false);
      await expect(
        svc.getStreamingUrl(inPeriodSubId, {
          contentId: tierDraftId,
          expirySeconds: 600,
        })
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });
  });

  describe('a course the tier reaches', () => {
    it('opens for a subscriber within the period', async () => {
      expect(await svc.canEnterCourse(inPeriodSubId, courseOffSaleId)).toBe(
        true
      );
    });

    it('closes for a subscriber who has renewed since', async () => {
      expect(await svc.canEnterCourse(renewedSubId, courseOffSaleId)).toBe(
        false
      );
    });

    it('applies the same rule in the batch read', async () => {
      const inPeriod = await svc.canEnterCoursesBatch(inPeriodSubId, [
        courseOffSaleId,
        coursePublishedId,
      ]);
      expect(inPeriod.get(courseOffSaleId)).toBe(true);
      expect(inPeriod.get(coursePublishedId)).toBe(true);

      const renewed = await svc.canEnterCoursesBatch(renewedSubId, [
        courseOffSaleId,
        coursePublishedId,
      ]);
      expect(renewed.get(courseOffSaleId)).toBe(false);
      expect(renewed.get(coursePublishedId)).toBe(true);
    });

    it('CONTROL: a published course is unchanged for both subscribers', async () => {
      expect(await svc.canEnterCourse(inPeriodSubId, coursePublishedId)).toBe(
        true
      );
      expect(await svc.canEnterCourse(renewedSubId, coursePublishedId)).toBe(
        true
      );
    });
  });

  describe('the library matches the player', () => {
    it('lists the off-sale tier item for a subscriber within the period', async () => {
      const ids = await libraryIds(inPeriodSubId, 'subscription');
      expect(ids).toContain(tierOffSaleId);
      expect(ids).toContain(tierPublishedId);
      expect(ids).not.toContain(tierDraftId);
    });

    it('drops it for a subscriber who has renewed since', async () => {
      const ids = await libraryIds(renewedSubId, 'subscription');
      expect(ids).not.toContain(tierOffSaleId);
      expect(ids).toContain(tierPublishedId);
      expect(ids).not.toContain(tierDraftId);
    });

    it('lists off-sale follower-gated content for a subscriber within the period only', async () => {
      expect(await libraryIds(inPeriodSubId, 'followers')).toContain(
        followerOffSaleId
      );
      expect(await libraryIds(renewedSubId, 'followers')).not.toContain(
        followerOffSaleId
      );
      expect(await libraryIds(followerId, 'followers')).not.toContain(
        followerOffSaleId
      );
    });

    it('keeps the bought item on the purchaser’s shelf', async () => {
      expect(await libraryIds(purchaserId, 'purchased')).toContain(
        paidOffSaleId
      );
    });
  });
});
