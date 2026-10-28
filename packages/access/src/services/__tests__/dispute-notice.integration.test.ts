/**
 * Paused by a payment dispute: the library and the refused stream
 * (Codex-2hxff.60).
 *
 * While a chargeback is open the buyer's access is paused, not ended. Two
 * readers must say so:
 *
 *   - the library keeps a disputed purchase on the shelf, with
 *     `purchase.disputedAt` set, so the card shows "Paused: payment dispute".
 *     A win clears the mark; a loss refunds the purchase, and it leaves;
 *   - a refused stream carries `reason: 'purchase_dispute'` or
 *     `'subscription_dispute'` from the DATABASE (`disputeHold`), so the
 *     content page's notice outlasts the 20-minute KV block, and shows when
 *     the hourly reconcile opened the chargeback and wrote no block at all.
 *     The KV block still answers first.
 *
 * Both read one predicate, `resolveDisputePause`, so the card is dimmed
 * exactly when the page shows the notice, course lessons included (owner
 * decision 2026-10-24).
 *
 * Real DB and a real `PurchaseService`, so `verifyPurchase` reads the mark.
 * Every row hangs off this file's own users and organisation, and is deleted
 * in afterAll.
 */

import { randomUUID } from 'node:crypto';
import type { KVNamespace } from '@cloudflare/workers-types';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import { isUniqueViolation } from '@codex/database';
import {
  content,
  courseEnrollments,
  courseStages,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  courseTierAccess,
  entitlements,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  stagePractices,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import { PurchaseService } from '@codex/purchase';
import {
  createTestConnectAccountInput,
  createTestMoneyDeps,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getOriginalKey } from '@codex/transcoding';
import type { ListUserLibraryInput } from '@codex/validation';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import { AccessRevocation } from '../access-revocation';
import { ContentAccessService } from '../ContentAccessService';
import { resolveDisputePause } from '../content-access/access-decision';
import { CourseJourneyService } from '../course-journey-service';

describe('paused by a payment dispute (Codex-2hxff.60)', () => {
  let db: Database;
  let purchaseService: PurchaseService;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let creatorId: string;
  let organizationId: string;
  /** sortOrder 1 */
  let tierId: string;
  /** sortOrder 2 */
  let upperTierId: string;
  const userIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };
    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    purchaseService = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      {} as never
    );
    accessService = new ContentAccessService({
      db,
      environment: 'test',
      r2: createR2SigningClientFromEnv(),
      purchaseService,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });

    const [creator] = await seedTestUsers(db, 1);
    creatorId = creator;
    userIds.push(creatorId);

    // Publishing paid content needs a payout-ready Connect account.
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();

    organizationId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Dispute Notice Org',
          slug: createUniqueSlug('dispute-notice'),
        })
        .returning()
    ).id;
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(organizationId, { sortOrder: 1 }))
        .returning()
    ).id;
    upperTierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(organizationId, { sortOrder: 2 }))
        .returning()
    ).id;
  });

  // Children first: a duplicate restricts its original, and purchases,
  // subscriptions and follows restrict their users and organisation.
  afterAll(async () => {
    await db
      .delete(purchases)
      .where(
        and(
          inArray(purchases.customerId, userIds),
          isNotNull(purchases.duplicateOfPurchaseId)
        )
      );
    await db.delete(purchases).where(inArray(purchases.customerId, userIds));
    await db.delete(entitlements).where(inArray(entitlements.userId, userIds));
    if (courseIds.length > 0) {
      await db
        .delete(courseEnrollments)
        .where(inArray(courseEnrollments.courseId, courseIds));
      await db
        .delete(courseSubscriptions)
        .where(inArray(courseSubscriptions.courseId, courseIds));
      await db
        .delete(courseSubscriptionPlans)
        .where(inArray(courseSubscriptionPlans.courseId, courseIds));
      await db
        .delete(courseTierAccess)
        .where(inArray(courseTierAccess.courseId, courseIds));
      const stageIds = db
        .select({ id: courseStages.id })
        .from(courseStages)
        .where(inArray(courseStages.courseId, courseIds));
      await db
        .delete(stagePractices)
        .where(inArray(stagePractices.stageId, stageIds));
      await db
        .delete(courseStages)
        .where(inArray(courseStages.courseId, courseIds));
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    await db
      .delete(subscriptions)
      .where(inArray(subscriptions.userId, userIds));
    await db
      .delete(organizationFollowers)
      .where(inArray(organizationFollowers.userId, userIds));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.userId, userIds));
    await db.delete(content).where(eq(content.creatorId, creatorId));
    await db.delete(mediaItems).where(eq(mediaItems.creatorId, creatorId));
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, organizationId));
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(inArray(users.id, userIds));
    await teardownTestDatabase();
  });

  async function newUser(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    userIds.push(id);
    return id;
  }

  type Shape = 'paid' | 'tier' | 'upper-tier' | 'followers';

  /** A published video in this org, ready to stream. */
  async function createItem(slugSuffix: string, shape: Shape = 'paid') {
    const media = await mediaService.create(
      {
        title: slugSuffix,
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: getOriginalKey(creatorId, randomUUID(), `${slugSuffix}.mp4`),
        fileSizeBytes: 1024,
      },
      creatorId
    );
    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
        thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
        durationSeconds: 120,
      },
      creatorId
    );
    const item = await contentService.create(
      {
        organizationId,
        title: slugSuffix,
        slug: createUniqueSlug(slugSuffix),
        contentType: 'video',
        mediaItemId: media.id,
        priceCents: 1500,
        tags: [],
      },
      creatorId
    );
    await contentService.publish(item.id, creatorId);

    if (shape === 'tier' || shape === 'upper-tier') {
      await db
        .update(content)
        .set({ includedInTierId: shape === 'tier' ? tierId : upperTierId })
        .where(eq(content.id, item.id));
    }
    if (shape === 'followers') {
      await db
        .update(content)
        .set({
          isFollowerGated: true,
          isPurchasable: false,
          priceCents: null,
        })
        .where(eq(content.id, item.id));
    }
    return item;
  }

  /**
   * A completed purchase, as the checkout webhook records it. A course
   * purchase passes `null` and its `courseId` in the overrides.
   */
  async function buy(
    customerId: string,
    contentId: string | null,
    overrides: Partial<typeof purchases.$inferInsert> = {}
  ) {
    return takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId,
          contentId,
          organizationId,
          amountPaidCents: 1500,
          currency: 'gbp',
          platformFeeCents: 150,
          organizationFeeCents: 0,
          creatorPayoutCents: 1350,
          stripePaymentIntentId: `pi_test_${randomUUID()}`,
          status: 'completed',
          purchasedAt: new Date(),
          ...overrides,
        })
        .returning()
    );
  }

  async function subscribe(
    userId: string,
    tier: string,
    disputed: boolean,
    overrides: Partial<typeof subscriptions.$inferInsert> = {}
  ): Promise<void> {
    await db.insert(subscriptions).values(
      createTestSubscriptionInput(userId, organizationId, tier, {
        disputedAt: disputed ? new Date() : null,
        ...overrides,
      })
    );
  }

  async function library(userId: string, service = accessService) {
    const input: ListUserLibraryInput = {
      page: 1,
      limit: 50,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType: 'all',
      search: '',
    };
    return service.listUserLibrary(userId, input);
  }

  /** The refused stream's error, or the result when it was granted. */
  async function stream(
    userId: string,
    contentId: string,
    service = accessService
  ) {
    return service
      .getStreamingUrl(userId, { contentId, expirySeconds: 600 })
      .catch((error: unknown) => error);
  }

  function deniedReason(outcome: unknown): unknown {
    expect(outcome).toBeInstanceOf(AccessDeniedError);
    return (outcome as AccessDeniedError).context?.reason;
  }

  describe('library', () => {
    it('an open dispute stays on the shelf, with purchase.disputedAt set', async () => {
      const buyer = await newUser();
      const item = await createItem('lib-open-dispute');
      const disputedAt = new Date('2026-10-20T08:30:00.000Z');
      await buy(buyer, item.id, { disputedAt });

      const shelf = await library(buyer);
      expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
      expect(shelf.items[0]?.purchase?.disputedAt).toBe(
        disputedAt.toISOString()
      );
    });

    // The mark is judged per item: another item's live purchase clears nothing.
    it('an open dispute stays listed beside an undisputed purchase of another item', async () => {
      const buyer = await newUser();
      const disputedItem = await createItem('lib-disputed-beside');
      const otherItem = await createItem('lib-undisputed-beside');
      await buy(buyer, disputedItem.id, { disputedAt: new Date() });
      await buy(buyer, otherItem.id);

      const shelf = await library(buyer);
      const byId = new Map(
        shelf.items.map((i) => [i.content.id, i.purchase?.disputedAt])
      );
      expect(byId.size).toBe(2);
      expect(byId.get(disputedItem.id)).toEqual(expect.any(String));
      expect(byId.get(otherItem.id)).toBeNull();
    });

    it('a won dispute (the mark cleared) is listed with null', async () => {
      const buyer = await newUser();
      const item = await createItem('lib-won-dispute');
      const purchase = await buy(buyer, item.id, {
        disputedAt: new Date(),
        stripeDisputeId: `dp_test_${randomUUID()}`,
      });
      // What `restoreDisputedPurchase` writes on a win.
      await db
        .update(purchases)
        .set({ disputedAt: null })
        .where(eq(purchases.id, purchase.id));

      const shelf = await library(buyer);
      expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
      expect(shelf.items[0]?.purchase?.disputedAt).toBeNull();
    });

    it('a lost dispute (refunded, the mark kept) leaves the shelf', async () => {
      const buyer = await newUser();
      const item = await createItem('lib-lost-dispute');
      await buy(buyer, item.id, {
        status: 'refunded',
        disputedAt: new Date(),
      });

      const shelf = await library(buyer);
      expect(shelf.items).toHaveLength(0);
      expect(shelf.pagination.total).toBe(0);
    });

    // uq_purchases_completed_customer_content (migration 0109, Codex-2hxff.14)
    // allows one completed copy of an item, so a duplicate payment is written
    // `pending`, and a chargeback can land on it. These two pin why the
    // purchased arm needs no second-copy check.
    it('a disputed duplicate payment next to the completed original is one row, with null', async () => {
      const buyer = await newUser();
      const item = await createItem('lib-disputed-duplicate');
      const original = await buy(buyer, item.id, {
        purchasedAt: new Date(Date.now() - 60_000),
      });
      await buy(buyer, item.id, {
        status: 'pending',
        duplicateOfPurchaseId: original.id,
        disputedAt: new Date(),
      });

      const shelf = await library(buyer);
      expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
      expect(shelf.items[0]?.purchase?.disputedAt).toBeNull();
      expect(shelf.pagination.total).toBe(1);
    });

    it('a second completed copy of one item is refused, so no disputed copy sits beside an undisputed one', async () => {
      const buyer = await newUser();
      const item = await createItem('lib-second-completed');
      await buy(buyer, item.id);

      const refused = await buy(buyer, item.id, {
        disputedAt: new Date(),
      }).catch((error: unknown) => error);
      expect(isUniqueViolation(refused)).toBe(true);
    });

    it('a support grant is listed with null', async () => {
      const customer = await newUser();
      const support = await newUser();
      const item = await createItem('lib-granted');
      await db.insert(entitlements).values({
        userId: customer,
        organizationId,
        contentId: item.id,
        source: 'grant',
        grantedByUserId: support,
      });

      const shelf = await library(customer);
      expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
      expect(shelf.items[0]?.purchase).toMatchObject({
        priceCents: 0,
        disputedAt: null,
      });
    });
  });

  // The card is dimmed only while the stream is refused: the stream's own
  // decision answers for each disputed row. The org's other items reach some
  // of these users through other arms, so each test reads its own item's rows.
  describe('a disputed purchase is dimmed only while nothing else opens the item', () => {
    async function rowsFor(userId: string, contentId: string) {
      const shelf = await library(userId);
      return shelf.items.filter((i) => i.content.id === contentId);
    }

    it('with a covering active subscription: one row, not dimmed', async () => {
      const buyer = await newUser();
      const item = await createItem('dim-covered-by-sub', 'tier');
      await buy(buyer, item.id, { disputedAt: new Date() });
      await subscribe(buyer, tierId, false);

      const rows = await rowsFor(buyer, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.accessType).toBe('purchased');
      expect(rows[0]?.purchase?.disputedAt).toBeNull();
    });

    it('with a live support grant: one row, not dimmed, at the price paid', async () => {
      const buyer = await newUser();
      const support = await newUser();
      const item = await createItem('dim-covered-by-grant');
      await buy(buyer, item.id, { disputedAt: new Date() });
      await db.insert(entitlements).values({
        userId: buyer,
        organizationId,
        contentId: item.id,
        source: 'grant',
        grantedByUserId: support,
      });

      const rows = await rowsFor(buyer, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.purchase).toMatchObject({
        priceCents: 1500,
        disputedAt: null,
      });
    });

    it('alone: dimmed', async () => {
      const buyer = await newUser();
      const item = await createItem('dim-alone');
      await buy(buyer, item.id, { disputedAt: new Date() });

      const rows = await rowsFor(buyer, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.purchase?.disputedAt).toEqual(expect.any(String));
    });

    it('with a management role in the org: one row, not dimmed', async () => {
      const buyer = await newUser();
      const item = await createItem('dim-covered-by-role');
      await buy(buyer, item.id, { disputedAt: new Date() });
      await db.insert(organizationMemberships).values({
        userId: buyer,
        organizationId,
        role: 'admin',
        status: 'active',
      });

      const rows = await rowsFor(buyer, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.accessType).toBe('purchased');
      expect(rows[0]?.purchase?.disputedAt).toBeNull();
    });

    it('a decision that throws keeps the row dimmed, loads the page, and logs the cause at error', async () => {
      const buyer = await newUser();
      const item = await createItem('dim-decision-throws');
      await buy(buyer, item.id, { disputedAt: new Date() });
      const failing = new ContentAccessService({
        db,
        environment: 'test',
        r2: createR2SigningClientFromEnv(),
        purchaseService: {
          verifyPurchase: async () => {
            throw new Error('decision failed (test)');
          },
        } as unknown as PurchaseService,
      });
      const error = vi.spyOn(ObservabilityClient.prototype, 'error');

      try {
        const shelf = await library(buyer, failing);
        expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
        expect(shelf.items[0]?.purchase?.disputedAt).toEqual(
          expect.any(String)
        );
        expect(error).toHaveBeenCalledWith(
          'Library: access check failed for a disputed purchase; shown paused',
          expect.objectContaining({
            userId: buyer,
            contentId: item.id,
            error: 'decision failed (test)',
          })
        );
      } finally {
        error.mockRestore();
      }
    });
  });

  describe('a refused stream, with no KV block', () => {
    it("a disputed buyer is refused with reason 'purchase_dispute'", async () => {
      const buyer = await newUser();
      const item = await createItem('stream-disputed-buyer');
      await buy(buyer, item.id, { disputedAt: new Date() });

      expect(deniedReason(await stream(buyer, item.id))).toBe(
        'purchase_dispute'
      );
    });

    it("a disputed subscriber on tier content is refused with reason 'subscription_dispute'", async () => {
      const subscriber = await newUser();
      const item = await createItem('stream-disputed-tier', 'tier');
      await subscribe(subscriber, tierId, true);

      expect(deniedReason(await stream(subscriber, item.id))).toBe(
        'subscription_dispute'
      );
    });

    it("a disputed subscriber on followers content they do not follow is refused with 'subscription_dispute'", async () => {
      const subscriber = await newUser();
      const item = await createItem('stream-disputed-followers', 'followers');
      await subscribe(subscriber, tierId, true);

      expect(deniedReason(await stream(subscriber, item.id))).toBe(
        'subscription_dispute'
      );
    });

    it('the same disputed subscriber on followers content they follow is granted', async () => {
      const subscriber = await newUser();
      const item = await createItem('stream-disputed-follower', 'followers');
      await subscribe(subscriber, tierId, true);
      await db
        .insert(organizationFollowers)
        .values({ organizationId, userId: subscriber });

      const result = await stream(subscriber, item.id);
      expect(result).not.toBeInstanceOf(Error);
      expect(
        (result as { streamingUrl: string | null }).streamingUrl
      ).toContain('/hls/master.m3u8?token=');
    });

    it('a disputed buyer who also holds a covering active subscription is granted', async () => {
      const buyer = await newUser();
      const item = await createItem('stream-disputed-covered', 'tier');
      await buy(buyer, item.id, { disputedAt: new Date() });
      await subscribe(buyer, tierId, false);

      const result = await stream(buyer, item.id);
      expect(result).not.toBeInstanceOf(Error);
    });

    it("an ordinary denial keeps its own reason ('paid')", async () => {
      const stranger = await newUser();
      const item = await createItem('stream-ordinary-denial');

      expect(deniedReason(await stream(stranger, item.id))).toBe('paid');
    });

    it('a disputed subscription below the content tier explains nothing: a win would not open it', async () => {
      const subscriber = await newUser();
      const item = await createItem('stream-disputed-low-tier', 'upper-tier');
      await subscribe(subscriber, tierId, true);

      expect(deniedReason(await stream(subscriber, item.id))).toBe(
        'subscribers_only'
      );
    });
  });

  // One predicate, `resolveDisputePause`, names the stream's refusal and
  // decides the library's dim. Each case reads the stream and the predicate
  // (`verdict` checks they agree), and the library where it lists the item.
  describe('the library and the stream agree, through resolveDisputePause', () => {
    const day = 24 * 60 * 60 * 1000;

    /** The stream's refusal reason, or `'granted'`; checked against the predicate. */
    async function verdict(userId: string, contentId: string) {
      const outcome = await stream(userId, contentId);
      const reason =
        outcome instanceof AccessDeniedError
          ? outcome.context?.reason
          : outcome instanceof Error
            ? outcome.message
            : 'granted';
      const pause = await resolveDisputePause(
        { db, purchaseService },
        userId,
        contentId
      );
      if (pause == null) {
        expect(['purchase_dispute', 'subscription_dispute']).not.toContain(
          reason
        );
      } else {
        expect(reason).toBe(pause);
      }
      return reason;
    }

    /** Whether the library dims the item's one row (`undefined`: no row). */
    async function dimmed(userId: string, contentId: string) {
      const rows = (await library(userId)).items.filter(
        (i) => i.content.id === contentId
      );
      expect(rows.length).toBeLessThanOrEqual(1);
      return rows[0] && rows[0].purchase?.disputedAt != null;
    }

    /** A course in this org whose one stage holds `contentId`. */
    async function courseHolding(contentId: string): Promise<string> {
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId,
            creatorId,
            slug: createUniqueSlug('dispute-course'),
            title: 'Dispute Course',
            status: 'published',
          })
          .returning({ id: courses.id })
      );
      courseIds.push(course.id);
      const stage = takeFirst(
        await db
          .insert(courseStages)
          .values({ courseId: course.id, name: 'Stage One', sortOrder: 1 })
          .returning({ id: courseStages.id })
      );
      await db
        .insert(stagePractices)
        .values({ stageId: stage.id, contentId, sortOrder: 0 });
      return course.id;
    }

    /** A lesson reachable only through its course. */
    async function courseOnlyLesson(slugSuffix: string) {
      const item = await createItem(slugSuffix);
      await db
        .update(content)
        .set({ courseOnly: true })
        .where(eq(content.id, item.id));
      return { item, courseId: await courseHolding(item.id) };
    }

    /**
     * A completed course purchase with a chargeback open, and the grant the
     * chargeback revoked (what `processDispute` writes).
     */
    async function disputedCoursePurchase(buyerId: string, courseId: string) {
      const purchase = await buy(buyerId, null, {
        courseId,
        disputedAt: new Date(),
      });
      const grant = takeFirst(
        await db
          .insert(entitlements)
          .values({
            userId: buyerId,
            organizationId,
            courseId,
            source: 'course_purchase',
            sourceRef: purchase.id,
            revokedAt: new Date(),
          })
          .returning({ id: entitlements.id })
      );
      return { purchaseId: purchase.id, grantId: grant.id };
    }

    /** A live course subscription, with its plan and its stored grant. */
    async function courseSubscriber(
      userId: string,
      courseId: string,
      disputed: boolean
    ): Promise<string> {
      const plan = takeFirst(
        await db
          .insert(courseSubscriptionPlans)
          .values({
            courseId,
            priceMonthly: 5000,
            priceAnnual: 50000,
            stripeProductId: `prod_${randomUUID()}`,
            stripePriceMonthlyId: `price_m_${randomUUID()}`,
            stripePriceAnnualId: `price_a_${randomUUID()}`,
          })
          .returning({ id: courseSubscriptionPlans.id })
      );
      const periodEnd = new Date(Date.now() + 30 * day);
      const subscription = takeFirst(
        await db
          .insert(courseSubscriptions)
          .values({
            userId,
            courseId,
            planId: plan.id,
            organizationId,
            stripeSubscriptionId: `sub_course_${randomUUID()}`,
            stripeCustomerId: `cus_${randomUUID()}`,
            status: 'active',
            billingInterval: 'month',
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            disputedAt: disputed ? new Date() : null,
          })
          .returning({ id: courseSubscriptions.id })
      );
      await db.insert(entitlements).values({
        userId,
        organizationId,
        courseId,
        source: 'course_subscription',
        sourceRef: subscription.id,
        expiresAt: periodEnd,
      });
      return subscription.id;
    }

    it('an orgless disputed purchase (no KV block can exist): paused in both', async () => {
      const buyer = await newUser();
      const item = await createItem('agree-orgless');
      await db
        .update(content)
        .set({ organizationId: null })
        .where(eq(content.id, item.id));
      // Detaching the org fires trigger_unpublish_on_org_delete (migration
      // 0004), which sets status draft AND nulls publishedAt. A row never
      // released opens to no arm (Codex-nacky), so republish: this models a
      // released personal piece, not a draft.
      await db
        .update(content)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(content.id, item.id));
      await buy(buyer, item.id, {
        organizationId: null,
        disputedAt: new Date(),
      });

      expect(await verdict(buyer, item.id)).toBe('purchase_dispute');
      expect(await dimmed(buyer, item.id)).toBe(true);
    });

    it("an item taken off sale within a held subscription's period is explained by its dispute; one taken off before the period is not", async () => {
      const within = await createItem('agree-off-sale-within', 'tier');
      const before = await createItem('agree-off-sale-before', 'tier');
      await db
        .update(content)
        .set({ status: 'archived', offSaleAt: new Date(Date.now() - day) })
        .where(eq(content.id, within.id));
      await db
        .update(content)
        .set({ status: 'archived', offSaleAt: new Date(Date.now() - 20 * day) })
        .where(eq(content.id, before.id));
      const subscriber = await newUser();
      await subscribe(subscriber, tierId, true, {
        currentPeriodStart: new Date(Date.now() - 10 * day),
      });

      expect(await verdict(subscriber, within.id)).toBe('subscription_dispute');
      expect(await verdict(subscriber, before.id)).toBe('subscribers_only');
    });

    it('a course-only lesson of a disputed course purchase is paused; after a win it plays', async () => {
      const buyer = await newUser();
      const { item, courseId } = await courseOnlyLesson('agree-course-won');
      const { purchaseId, grantId } = await disputedCoursePurchase(
        buyer,
        courseId
      );

      expect(await verdict(buyer, item.id)).toBe('purchase_dispute');

      // What `restoreDisputedPurchase` writes on a win.
      await db
        .update(purchases)
        .set({ disputedAt: null })
        .where(eq(purchases.id, purchaseId));
      await db
        .update(entitlements)
        .set({ revokedAt: null })
        .where(eq(entitlements.id, grantId));
      expect(await verdict(buyer, item.id)).toBe('granted');
    });

    it('a course-only lesson of a LOST course purchase (refunded, the mark kept) shows the course gate', async () => {
      const buyer = await newUser();
      const { item, courseId } = await courseOnlyLesson('agree-course-lost');
      const { purchaseId } = await disputedCoursePurchase(buyer, courseId);
      await db
        .update(purchases)
        .set({ status: 'refunded' })
        .where(eq(purchases.id, purchaseId));

      expect(await verdict(buyer, item.id)).toBe('course_only');
    });

    it('a course-only lesson of a disputed course subscription is paused; after a win it plays', async () => {
      const subscriber = await newUser();
      const { item, courseId } = await courseOnlyLesson('agree-course-sub');
      const subscriptionId = await courseSubscriber(subscriber, courseId, true);

      expect(await verdict(subscriber, item.id)).toBe('subscription_dispute');

      await db
        .update(courseSubscriptions)
        .set({ disputedAt: null })
        .where(eq(courseSubscriptions.id, subscriptionId));
      expect(await verdict(subscriber, item.id)).toBe('granted');
    });

    it("a course-only lesson that a disputed tier subscription's course access would open is paused", async () => {
      const subscriber = await newUser();
      const { item, courseId } = await courseOnlyLesson('agree-course-tier');
      await db
        .insert(courseTierAccess)
        .values({ courseId, tierId, organizationId });
      await subscribe(subscriber, tierId, true);

      expect(await verdict(subscriber, item.id)).toBe('subscription_dispute');
    });

    it('a course-only lesson with no course grant held back keeps its own gate', async () => {
      const stranger = await newUser();
      const { item } = await courseOnlyLesson('agree-course-stranger');

      expect(await verdict(stranger, item.id)).toBe('course_only');
    });

    it('a paid lesson the buyer holds only through a disputed course purchase is paused', async () => {
      const buyer = await newUser();
      const item = await createItem('agree-paid-lesson');
      await disputedCoursePurchase(buyer, await courseHolding(item.id));

      expect(await verdict(buyer, item.id)).toBe('purchase_dispute');
    });

    // The course shelf (`listEnrolledCourses`) reads paused exactly when the
    // course's course-only lessons show the notice.
    describe('the course shelf', () => {
      async function enrol(userId: string, courseId: string, source: string) {
        await db.insert(courseEnrollments).values({ userId, courseId, source });
      }

      /** The shelf entry's hold, checked against the lesson's verdict. */
      async function shelfAgrees(
        userId: string,
        courseId: string,
        lessonId: string
      ) {
        const shelf = await new CourseJourneyService({
          db,
          environment: 'test',
        }).listEnrolledCourses(userId, organizationId);
        const entry = shelf.find((e) => e.course.id === courseId);
        expect(entry).toBeDefined();
        const hold = entry?.disputeHold;
        const reason = await verdict(userId, lessonId);
        if (hold == null) {
          expect(['purchase_dispute', 'subscription_dispute']).not.toContain(
            reason
          );
        } else {
          expect(reason).toBe(hold);
        }
        return hold;
      }

      it('a disputed course purchase reads paused; after a win it does not', async () => {
        const buyer = await newUser();
        const { item, courseId } = await courseOnlyLesson('shelf-purchase');
        await enrol(buyer, courseId, 'course_purchase');
        const { purchaseId, grantId } = await disputedCoursePurchase(
          buyer,
          courseId
        );

        expect(await shelfAgrees(buyer, courseId, item.id)).toBe(
          'purchase_dispute'
        );

        await db
          .update(purchases)
          .set({ disputedAt: null })
          .where(eq(purchases.id, purchaseId));
        await db
          .update(entitlements)
          .set({ revokedAt: null })
          .where(eq(entitlements.id, grantId));
        expect(await shelfAgrees(buyer, courseId, item.id)).toBeNull();
      });

      it('a disputed course subscription, and a disputed tier subscription with course access, read paused', async () => {
        const subscriber = await newUser();
        const bySub = await courseOnlyLesson('shelf-course-sub');
        await enrol(subscriber, bySub.courseId, 'course_subscription');
        await courseSubscriber(subscriber, bySub.courseId, true);

        const tierSubscriber = await newUser();
        const byTier = await courseOnlyLesson('shelf-tier');
        await enrol(tierSubscriber, byTier.courseId, 'tier_subscription');
        await db
          .insert(courseTierAccess)
          .values({ courseId: byTier.courseId, tierId, organizationId });
        await subscribe(tierSubscriber, tierId, true);

        expect(
          await shelfAgrees(subscriber, bySub.courseId, bySub.item.id)
        ).toBe('subscription_dispute');
        expect(
          await shelfAgrees(tierSubscriber, byTier.courseId, byTier.item.id)
        ).toBe('subscription_dispute');
      });

      it('a disputed course that a live support grant still opens does not read paused', async () => {
        const buyer = await newUser();
        const support = await newUser();
        const { item, courseId } = await courseOnlyLesson('shelf-granted');
        await enrol(buyer, courseId, 'course_purchase');
        await disputedCoursePurchase(buyer, courseId);
        await db.insert(entitlements).values({
          userId: buyer,
          organizationId,
          courseId,
          source: 'grant',
          grantedByUserId: support,
        });

        expect(await shelfAgrees(buyer, courseId, item.id)).toBeNull();
      });

      it('a disputed course of a staff member does not read paused', async () => {
        const buyer = await newUser();
        const { item, courseId } = await courseOnlyLesson('shelf-staff');
        await enrol(buyer, courseId, 'course_purchase');
        await disputedCoursePurchase(buyer, courseId);
        await db.insert(organizationMemberships).values({
          userId: buyer,
          organizationId,
          role: 'creator',
          status: 'active',
        });

        expect(await shelfAgrees(buyer, courseId, item.id)).toBeNull();
      });

      it('an undisputed course, and a lost one, do not read paused', async () => {
        const owner = await newUser();
        const owned = await courseOnlyLesson('shelf-owned');
        await enrol(owner, owned.courseId, 'course_purchase');
        const purchase = await buy(owner, null, { courseId: owned.courseId });
        await db.insert(entitlements).values({
          userId: owner,
          organizationId,
          courseId: owned.courseId,
          source: 'course_purchase',
          sourceRef: purchase.id,
        });

        const loser = await newUser();
        const lost = await courseOnlyLesson('shelf-lost');
        await enrol(loser, lost.courseId, 'course_purchase');
        const { purchaseId } = await disputedCoursePurchase(
          loser,
          lost.courseId
        );
        await db
          .update(purchases)
          .set({ status: 'refunded' })
          .where(eq(purchases.id, purchaseId));

        expect(
          await shelfAgrees(owner, owned.courseId, owned.item.id)
        ).toBeNull();
        expect(
          await shelfAgrees(loser, lost.courseId, lost.item.id)
        ).toBeNull();
      });
    });

    // GET /courses/:courseId/can-enter (`getCourseEntry`): the shelf's
    // predicate, asked only when the course is refused.
    describe("the course page's can-enter answer", () => {
      /**
       * An access service over a `db` whose `select` calls are counted, and
       * handed to `onSelect` first (which may throw). The test `db` is a
       * proxy, so `vi.spyOn(db, 'select')` cannot reach it.
       */
      function serviceOverSelects(
        onSelect: (fields: unknown) => void = () => {}
      ) {
        let selects = 0;
        const counted = new Proxy(db, {
          get(target, prop) {
            const value = Reflect.get(target, prop);
            if (prop === 'select') {
              return (fields?: unknown) => {
                selects += 1;
                onSelect(fields);
                return (value as (f?: unknown) => unknown).call(target, fields);
              };
            }
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const service = new ContentAccessService({
          db: counted,
          environment: 'test',
          r2: createR2SigningClientFromEnv(),
          purchaseService,
        });
        return { service, selects: () => selects };
      }

      it('granted: no hold, and not one query more than canEnterCourse', async () => {
        const owner = await newUser();
        const { courseId } = await courseOnlyLesson('entry-granted');
        const purchase = await buy(owner, null, { courseId });
        await db.insert(entitlements).values({
          userId: owner,
          organizationId,
          courseId,
          source: 'course_purchase',
          sourceRef: purchase.id,
        });

        const gate = serviceOverSelects();
        const entry = serviceOverSelects();
        expect(await gate.service.canEnterCourse(owner, courseId)).toBe(true);
        expect(await entry.service.getCourseEntry(owner, courseId)).toEqual({
          canEnter: true,
          disputeHold: null,
        });
        // The counter sees the gate's own reads, and nothing more is read.
        expect(gate.selects()).toBeGreaterThan(0);
        expect(entry.selects()).toBe(gate.selects());
      });

      it('a disputed course purchase: refused, with purchase_dispute', async () => {
        const buyer = await newUser();
        const { courseId } = await courseOnlyLesson('entry-purchase');
        await disputedCoursePurchase(buyer, courseId);

        expect(await accessService.getCourseEntry(buyer, courseId)).toEqual({
          canEnter: false,
          disputeHold: 'purchase_dispute',
        });
      });

      it('a disputed course subscription: refused, with subscription_dispute', async () => {
        const subscriber = await newUser();
        const { courseId } = await courseOnlyLesson('entry-course-sub');
        await courseSubscriber(subscriber, courseId, true);

        expect(
          await accessService.getCourseEntry(subscriber, courseId)
        ).toEqual({ canEnter: false, disputeHold: 'subscription_dispute' });
      });

      it('a staff member with a disputed course purchase is never shown paused (canEnter is unchanged: no staff bypass)', async () => {
        const buyer = await newUser();
        const { courseId } = await courseOnlyLesson('entry-staff');
        await disputedCoursePurchase(buyer, courseId);
        await db.insert(organizationMemberships).values({
          userId: buyer,
          organizationId,
          role: 'creator',
          status: 'active',
        });

        expect(await accessService.getCourseEntry(buyer, courseId)).toEqual({
          canEnter: await accessService.canEnterCourse(buyer, courseId),
          disputeHold: null,
        });
      });

      it('a lookup that throws: the refusal stands with no hold, and the failure is logged at error', async () => {
        const buyer = await newUser();
        const { courseId } = await courseOnlyLesson('entry-throws');
        await disputedCoursePurchase(buyer, courseId);
        // Fail only the held-purchase read, so canEnterCourse still answers.
        const { service } = serviceOverSelects((fields) => {
          if (
            (fields as Record<string, unknown> | undefined)?.courseId ===
            purchases.courseId
          ) {
            throw new Error('hold lookup failed (test)');
          }
        });
        const error = vi.spyOn(ObservabilityClient.prototype, 'error');

        try {
          expect(await service.getCourseEntry(buyer, courseId)).toEqual({
            canEnter: false,
            disputeHold: null,
          });
          expect(error).toHaveBeenCalledWith(
            'Course entry: the dispute lookup failed; no hold shown',
            { userId: buyer, courseId, error: 'hold lookup failed (test)' }
          );
        } finally {
          error.mockRestore();
        }
      });
    });

    it('an item bought on its own and since made course-only is dimmed only while a dispute on its course holds it back', async () => {
      const buyer = await newUser();
      const { item, courseId } = await courseOnlyLesson('agree-lib-course');
      await buy(buyer, item.id, { disputedAt: new Date() });

      // Its own purchase opens nothing now, so its own dispute explains nothing.
      expect(await verdict(buyer, item.id)).toBe('course_only');
      expect(await dimmed(buyer, item.id)).toBe(false);

      await disputedCoursePurchase(buyer, courseId);
      expect(await verdict(buyer, item.id)).toBe('purchase_dispute');
      expect(await dimmed(buyer, item.id)).toBe(true);
    });

    it('an item bought on its own and since made team-only: not dimmed, and its own gate', async () => {
      const buyer = await newUser();
      const item = await createItem('agree-team-only');
      await db
        .update(content)
        .set({ isTeamOnly: true })
        .where(eq(content.id, item.id));
      await buy(buyer, item.id, { disputedAt: new Date() });

      expect(await verdict(buyer, item.id)).toBe('team_only');
      expect(await dimmed(buyer, item.id)).toBe(false);
    });
  });

  it("with a KV block present, the block's reason answers first", async () => {
    const buyer = await newUser();
    const item = await createItem('stream-kv-first');
    await buy(buyer, item.id, { disputedAt: new Date() });

    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    } as unknown as KVNamespace;
    const revocation = new AccessRevocation(kv);
    await revocation.revoke(buyer, organizationId, 'refund');

    const withBlock = new ContentAccessService({
      db,
      environment: 'test',
      r2: createR2SigningClientFromEnv(),
      purchaseService: new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        {} as never
      ),
      revocation,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });

    expect(deniedReason(await stream(buyer, item.id, withBlock))).toBe(
      'refund'
    );
    // Without the block, the database says why.
    expect(deniedReason(await stream(buyer, item.id))).toBe('purchase_dispute');
  });
});
