/**
 * ContentAccessService.listUserLibrary — relationship-based free + followers buckets.
 *
 * The library universe extends to two new arms:
 *   - `accessType='free'` content from orgs the user has a follower row OR
 *     active subscription with
 *   - `accessType='followers'` content from orgs where the user has a
 *     follower row OR active subscription
 *
 * No engagement gate. Following or subscribing IS the opt-in — requiring the
 * user to additionally press play before content shows up made follow/subscribe
 * feel empty until the user navigated elsewhere first. The relationship gate
 * keeps volume bounded (no relationship → no rows from non-managed orgs)
 * while matching the user's mental model: "I follow this org → its content
 * shows in my library."
 *
 * Mirrors the access-decision contract in `getStreamingUrl`
 * (subscribers ⊇ followers ⊇ public).
 */

import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import {
  content,
  organizationFollowers,
  organizations,
  subscriptions,
  subscriptionTiers,
  videoPlayback,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import {
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getOriginalKey } from '@codex/transcoding';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';

describe('ContentAccessService.listUserLibrary — relationship buckets', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let creatorUserId: string;
  let organizationId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);
    r2Client = createR2SigningClientFromEnv();

    const obs = new ObservabilityClient('relationship-library-test', 'test');
    accessService = new ContentAccessService({
      db,
      r2: r2Client,
      obs,
      purchaseService: {
        verifyPurchase: vi.fn(async () => false),
      } as unknown as PurchaseService,
    });

    const [creator] = await seedTestUsers(db, 1);
    creatorUserId = creator;

    const [primary] = await db
      .insert(organizations)
      .values({ name: 'Primary Org', slug: createUniqueSlug('primary-org') })
      .returning();
    const [secondary] = await db
      .insert(organizations)
      .values({
        name: 'Secondary Org',
        slug: createUniqueSlug('secondary-org'),
      })
      .returning();
    if (!primary || !secondary) throw new Error('Failed to seed orgs');
    organizationId = primary.id;
    otherOrgId = secondary.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * Creates published content + sets the access-policy flags for the desired
   * KIND. Mirrors the helper used in the existing follower-access tests.
   */
  async function createContentWithAccessType(
    accessType: 'free' | 'followers',
    slugSuffix: string,
    orgIdOverride?: string
  ) {
    const targetOrg = orgIdOverride ?? organizationId;
    const media = await mediaService.create(
      {
        title: `${accessType} ${slugSuffix}`,
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: getOriginalKey(
          creatorUserId,
          crypto.randomUUID(),
          `${slugSuffix}.mp4`
        ),
        fileSizeBytes: 1024,
      },
      creatorUserId
    );
    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
        thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
        durationSeconds: 120,
      },
      creatorUserId
    );
    const item = await contentService.create(
      {
        organizationId: targetOrg,
        title: `${accessType} ${slugSuffix}`,
        slug: createUniqueSlug(slugSuffix),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      },
      creatorUserId
    );
    await contentService.publish(item.id, creatorUserId);
    // Translate the legacy access-KIND arg to the flag policy (full set so no
    // stale gate lingers). This helper only passes 'free'/'followers'.
    await db
      .update(content)
      .set({
        isFree: accessType === 'free',
        isPurchasable: false,
        priceCents: null,
        includedInTierId: null,
        isFollowerGated: accessType === 'followers',
        isTeamOnly: false,
      })
      .where(eq(content.id, item.id));
    return item;
  }

  // Each tier seeded for the same org needs a distinct sort_order — the
  // schema enforces `UNIQUE (organization_id, sort_order)` to keep the
  // listing UI deterministic. Counter scoped to the suite so repeated
  // seedActiveSubscription calls in different `it` blocks don't collide.
  let tierSortCounter = 1;

  /**
   * Seeds an active in-period subscription for `userId` to `orgId` via the
   * shared test factory so NOT-NULL columns (priceMonthly, billingInterval,
   * fee splits) are satisfied without duplicating schema knowledge here.
   */
  async function seedActiveSubscription(userId: string, orgId: string) {
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId, { sortOrder: tierSortCounter++ }))
      .returning();
    if (!tier) throw new Error('Failed to seed tier');
    await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(userId, orgId, tier.id));
  }

  describe('free bucket — relationship gate', () => {
    it('returns free content for a follower (no engagement required)', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });

      const item = await createContentWithAccessType('free', 'follower-free-1');

      const result = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      const row = result.items.find((i) => i.content.id === item.id);
      expect(row).toBeDefined();
      expect(row?.accessType).toBe('free');
    });

    it('returns free content for an active subscriber (no follower row)', async () => {
      const [subscriber] = await seedTestUsers(db, 1);
      await seedActiveSubscription(subscriber, organizationId);

      const item = await createContentWithAccessType(
        'free',
        'subscriber-free-1'
      );

      const result = await accessService.listUserLibrary(subscriber, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'free',
        search: '',
        organizationId,
      });

      const row = result.items.find((i) => i.content.id === item.id);
      expect(row).toBeDefined();
      expect(row?.accessType).toBe('free');
    });

    it('does NOT return free content for a stranger (no follow, no sub)', async () => {
      const [stranger] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType('free', 'stranger-free-1');

      const result = await accessService.listUserLibrary(stranger, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      expect(
        result.items.find((i) => i.content.id === item.id)
      ).toBeUndefined();
    });

    it('respects organizationId scoping (other-org free content excluded)', async () => {
      const [follower] = await seedTestUsers(db, 1);
      // Follow primary; create free content on the OTHER org.
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });
      const otherOrgFree = await createContentWithAccessType(
        'free',
        'free-other-org',
        otherOrgId
      );

      const scopedToPrimary = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId, // primary org only
      });

      // Other-org free content correctly excluded under primary-org scope.
      expect(
        scopedToPrimary.items.find((i) => i.content.id === otherOrgFree.id)
      ).toBeUndefined();
    });

    it('returns only free-tagged rows when accessType=free', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });
      const freeItem = await createContentWithAccessType(
        'free',
        'filter-free-only'
      );
      const followersItem = await createContentWithAccessType(
        'followers',
        'filter-free-only-bystander'
      );

      const result = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'free',
        search: '',
        organizationId,
      });

      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.accessType).toBe('free');
      }
      // Followers content must NOT leak through the free filter.
      expect(
        result.items.find((i) => i.content.id === followersItem.id)
      ).toBeUndefined();
      // Free content IS present.
      expect(
        result.items.find((i) => i.content.id === freeItem.id)
      ).toBeDefined();
    });
  });

  describe('followers bucket — relationship gate', () => {
    it('returns followers content for a follower (no engagement required)', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });

      const item = await createContentWithAccessType(
        'followers',
        'follower-only-1'
      );

      const result = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      const row = result.items.find((i) => i.content.id === item.id);
      expect(row).toBeDefined();
      expect(row?.accessType).toBe('followers');
    });

    it('returns followers content for an active subscriber (no follower row)', async () => {
      const [subscriber] = await seedTestUsers(db, 1);
      await seedActiveSubscription(subscriber, organizationId);

      const item = await createContentWithAccessType(
        'followers',
        'subscriber-only-1'
      );

      const result = await accessService.listUserLibrary(subscriber, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'followers',
        search: '',
        organizationId,
      });

      const row = result.items.find((i) => i.content.id === item.id);
      expect(row).toBeDefined();
      expect(row?.accessType).toBe('followers');
    });

    it('does NOT return followers content for a stranger', async () => {
      const [stranger] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType(
        'followers',
        'stranger-followers-1'
      );

      const result = await accessService.listUserLibrary(stranger, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      expect(
        result.items.find((i) => i.content.id === item.id)
      ).toBeUndefined();
    });

    it('returns content even when the user has NEVER pressed play (regression: fresh@test.com)', async () => {
      // Mirrors the real-world bug: a user who follows + subscribes with no
      // videoPlayback rows previously saw an empty library because the engagement
      // gate suppressed everything. Confirms the gate has been removed.
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });
      await seedActiveSubscription(follower, organizationId);

      const free = await createContentWithAccessType(
        'free',
        'no-engagement-free'
      );
      const followers = await createContentWithAccessType(
        'followers',
        'no-engagement-followers'
      );

      // Sanity: this user has no videoPlayback rows.
      const playback = await db.query.videoPlayback.findMany({
        where: eq(videoPlayback.userId, follower),
      });
      expect(playback).toHaveLength(0);

      const result = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      expect(result.items.find((i) => i.content.id === free.id)).toBeDefined();
      expect(
        result.items.find((i) => i.content.id === followers.id)
      ).toBeDefined();
    });

    it('returns only followers-tagged rows when accessType=followers', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });
      const followersItem = await createContentWithAccessType(
        'followers',
        'filter-follower-only-1'
      );
      const freeItem = await createContentWithAccessType(
        'free',
        'filter-follower-only-bystander'
      );

      const result = await accessService.listUserLibrary(follower, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'followers',
        search: '',
        organizationId,
      });

      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.accessType).toBe('followers');
      }
      expect(
        result.items.find((i) => i.content.id === freeItem.id)
      ).toBeUndefined();
      expect(
        result.items.find((i) => i.content.id === followersItem.id)
      ).toBeDefined();
    });

    it('does NOT return followers content for a cancelled (expired) subscriber', async () => {
      const [exSubscriber] = await seedTestUsers(db, 1);
      // Seed a subscription that has expired (currentPeriodEnd in past).
      const [tier] = await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(organizationId, { sortOrder: tierSortCounter++ })
        )
        .returning();
      if (!tier) throw new Error('Failed to seed tier');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(exSubscriber, organizationId, tier.id, {
          status: 'cancelled',
          currentPeriodEnd: new Date(Date.now() - 1000 * 60 * 60 * 24),
        })
      );

      const item = await createContentWithAccessType(
        'followers',
        'expired-sub-1'
      );

      const result = await accessService.listUserLibrary(exSubscriber, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId,
      });

      expect(
        result.items.find((i) => i.content.id === item.id)
      ).toBeUndefined();
    });
  });
});
