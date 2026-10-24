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
  entitlements,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import { PurchaseService } from '@codex/purchase';
import {
  createTestConnectAccountInput,
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

describe('paused by a payment dispute (Codex-2hxff.60)', () => {
  let db: Database;
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

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };
    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    const purchaseService = new PurchaseService(
      { db, environment: 'test' },
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

  /** A completed purchase, as the checkout webhook records it. */
  async function buy(
    customerId: string,
    contentId: string,
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
    disputed: boolean
  ): Promise<void> {
    await db.insert(subscriptions).values(
      createTestSubscriptionInput(userId, organizationId, tier, {
        disputedAt: disputed ? new Date() : null,
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

    it('a decision that throws keeps the row dimmed, loads the page, and warns with the content id only', async () => {
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
      const warn = vi.spyOn(ObservabilityClient.prototype, 'warn');

      try {
        const shelf = await library(buyer, failing);
        expect(shelf.items.map((i) => i.content.id)).toEqual([item.id]);
        expect(shelf.items[0]?.purchase?.disputedAt).toEqual(
          expect.any(String)
        );
        expect(warn).toHaveBeenCalledWith(
          'Library: access check failed for a disputed purchase; shown paused',
          { contentId: item.id }
        );
      } finally {
        warn.mockRestore();
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
        { db, environment: 'test' },
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
