/**
 * ContentAccessService.listUserLibrary — engaged-free + engaged-followers buckets.
 *
 * The library universe extends to two new arms:
 *   - `accessType='free'` content the user has *engaged* with (videoPlayback row exists)
 *   - `accessType='followers'` content the user can access (follower row OR
 *     active subscription) AND has engaged with
 *
 * The integration tests below verify both the membership rule (engagement is
 * required) AND the access-decision rules (followers arm requires follower
 * row OR active subscription). They also exercise the new accessType filter
 * values on `ListUserLibraryInput` so single-bucket queries return only the
 * intended rows.
 *
 * Strategy: real Postgres via setupTestDatabase + seedTestUsers, with direct
 * `db.update(content)` to flip `accessType` after publish (mirrors the helper
 * pattern in ContentAccessService.integration.test.ts).
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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';

describe('ContentAccessService.listUserLibrary — engagement buckets', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let creatorUserId: string;
  let viewerUserId: string;
  let organizationId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);
    r2Client = createR2SigningClientFromEnv();

    const obs = new ObservabilityClient('engagement-library-test', 'test');
    accessService = new ContentAccessService({
      db,
      r2: r2Client,
      obs,
      purchaseService: {
        verifyPurchase: vi.fn(async () => false),
      } as unknown as PurchaseService,
    });

    const [creator, viewer] = await seedTestUsers(db, 2);
    creatorUserId = creator;
    viewerUserId = viewer;

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
   * Creates published content + flips accessType to the desired value.
   * Mirrors the helper used in the existing follower-access tests.
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
    await db.update(content).set({ accessType }).where(eq(content.id, item.id));
    return item;
  }

  /** Inserts a videoPlayback row directly — engagement signal for the user. */
  async function seedEngagement(userId: string, contentId: string) {
    await db.insert(videoPlayback).values({
      userId,
      contentId,
      positionSeconds: 30,
      durationSeconds: 120,
      completed: false,
    });
  }

  describe('engaged-free bucket', () => {
    it('returns engaged free content tagged free', async () => {
      const [freshViewer] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType('free', 'engaged-free-1');
      await seedEngagement(freshViewer, item.id);

      const result = await accessService.listUserLibrary(freshViewer, {
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

    it('does NOT return free content without engagement', async () => {
      const [freshViewer] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType('free', 'free-no-engage');

      const result = await accessService.listUserLibrary(freshViewer, {
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
      expect(row).toBeUndefined();
    });

    it('respects organizationId scoping', async () => {
      const [freshViewer] = await seedTestUsers(db, 1);
      const otherOrgFree = await createContentWithAccessType(
        'free',
        'free-other-org',
        otherOrgId
      );
      await seedEngagement(freshViewer, otherOrgFree.id);

      const scopedToPrimary = await accessService.listUserLibrary(freshViewer, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
        organizationId, // primary org only
      });

      // Other-org engaged free content is correctly excluded when the caller
      // scopes to the primary org.
      expect(
        scopedToPrimary.items.find((i) => i.content.id === otherOrgFree.id)
      ).toBeUndefined();
    });

    it('returns only free-tagged rows when accessType=free', async () => {
      const [freshViewer] = await seedTestUsers(db, 1);
      const freeItem = await createContentWithAccessType(
        'free',
        'filter-free-only'
      );
      await seedEngagement(freshViewer, freeItem.id);

      const result = await accessService.listUserLibrary(freshViewer, {
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
    });
  });

  describe('engaged-followers bucket', () => {
    it('returns followers content for follower with engagement', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });

      const item = await createContentWithAccessType(
        'followers',
        'follower-engage'
      );
      await seedEngagement(follower, item.id);

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

    it('returns followers content for active subscriber with engagement (no follower row)', async () => {
      const [subscriber] = await seedTestUsers(db, 1);

      // Seed a tier + subscription on the primary org via test factories so
      // NOT-NULL columns (priceMonthly, billingInterval, fee splits) are
      // satisfied without duplicating schema knowledge here.
      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(organizationId, { name: 'Standard' }))
        .returning();
      if (!tier) throw new Error('Failed to seed tier');

      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriber, organizationId, tier.id)
        );

      const item = await createContentWithAccessType(
        'followers',
        'subscriber-no-follow'
      );
      await seedEngagement(subscriber, item.id);

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

    it('does NOT return followers content for engaged user without follower row or subscription', async () => {
      const [stranger] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType(
        'followers',
        'stranger-engage'
      );
      // Engagement exists but neither follower nor subscriber.
      await seedEngagement(stranger, item.id);

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

    it('does NOT return followers content without engagement (engagement gate)', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });
      const item = await createContentWithAccessType(
        'followers',
        'follower-no-engage'
      );
      // No videoPlayback row inserted.

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

      expect(
        result.items.find((i) => i.content.id === item.id)
      ).toBeUndefined();
    });

    it('returns only followers-tagged rows when accessType=followers', async () => {
      const [follower] = await seedTestUsers(db, 1);
      await db
        .insert(organizationFollowers)
        .values({ userId: follower, organizationId });

      const followersItem = await createContentWithAccessType(
        'followers',
        'filter-follower-only'
      );
      const freeItem = await createContentWithAccessType(
        'free',
        'filter-follower-only-free-bystander'
      );
      await seedEngagement(follower, followersItem.id);
      await seedEngagement(follower, freeItem.id);

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
      // Free engagement must NOT leak through the followers filter.
      expect(
        result.items.find((i) => i.content.id === freeItem.id)
      ).toBeUndefined();
    });
  });

  describe('savePlaybackProgress firstEngagement signal', () => {
    it('returns firstEngagement: true on initial save and false on subsequent', async () => {
      const [user] = await seedTestUsers(db, 1);
      const item = await createContentWithAccessType('free', 'first-engage');

      const initial = await accessService.savePlaybackProgress(user, {
        contentId: item.id,
        positionSeconds: 10,
        durationSeconds: 120,
        completed: false,
      });
      expect(initial.firstEngagement).toBe(true);

      const heartbeat = await accessService.savePlaybackProgress(user, {
        contentId: item.id,
        positionSeconds: 60,
        durationSeconds: 120,
        completed: false,
      });
      expect(heartbeat.firstEngagement).toBe(false);

      // Sanity: row actually exists
      const row = await db.query.videoPlayback.findFirst({
        where: and(
          eq(videoPlayback.userId, user),
          eq(videoPlayback.contentId, item.id)
        ),
      });
      expect(row).toBeDefined();
    });
  });
});
