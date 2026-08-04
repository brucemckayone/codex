/**
 * `ContentAccessService.listUserLibrary` — course purchases and portal
 * provenance.
 *
 * ## Why this suite exists
 *
 * Every non-purchase arm of the library (membership, subscription, free,
 * followers) excludes content the caller already bought, so `queryPurchased`
 * stays the single owner of those rows. That exclusion used to be written as
 *
 *     content.id NOT IN (SELECT purchases.content_id FROM purchases WHERE …)
 *
 * and `purchases.content_id` is NULL for COURSE purchases — those rows point at
 * `course_id` instead. SQL's three-valued logic then collapses
 * `x NOT IN (NULL)` → `NOT (x = NULL)` → `NULL`, which is never TRUE, so the
 * predicate filtered out EVERY row. One journey purchase blanked a member's
 * entire owned-content library across all four arms simultaneously, while the
 * portals shelf (a different endpoint) kept working — which is what made it
 * present as "journeys load but my content doesn't".
 *
 * The first test is the regression lock: it is the minimum reproduction of that
 * bug and fails loudly against the `NOT IN` form. The rest cover the provenance
 * field the library grid badges with ("part of <portal>").
 */

import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import {
  content,
  courseStages,
  courses,
  organizationMemberships,
  organizations,
  purchases,
  stagePractices,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import {
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

describe('listUserLibrary — course purchase + portal provenance', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let ownerUserId: string;
  let organizationId: string;
  let courseId: string;
  let stageId: string;
  /** Published, standalone, and NOT attached to any portal. */
  let soloContentId: string;
  /** Published and attached to the portal's only stage. */
  let portalContentId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);
    r2Client = createR2SigningClientFromEnv();

    accessService = new ContentAccessService({
      db,
      r2: r2Client,
      obs: new ObservabilityClient('library-course-purchase-test', 'test'),
      purchaseService: {
        verifyPurchase: vi.fn(async () => false),
      } as unknown as PurchaseService,
    });

    const [owner] = await seedTestUsers(db, 1);
    if (!owner) throw new Error('Failed to seed user');
    ownerUserId = owner;

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Portal Org', slug: createUniqueSlug('portal-org') })
      .returning();
    if (!org) throw new Error('Failed to seed org');
    organizationId = org.id;

    // An OWNER membership is what puts content in the `membership` arm — the
    // arm the NOT IN bug silently emptied.
    await db.insert(organizationMemberships).values({
      userId: ownerUserId,
      organizationId,
      role: 'owner',
      status: 'active',
    });

    soloContentId = (await createPublishedContent('solo-practice')).id;
    portalContentId = (await createPublishedContent('portal-practice')).id;

    const [course] = await db
      .insert(courses)
      .values({
        organizationId,
        creatorId: ownerUserId,
        slug: createUniqueSlug('the-descent'),
        title: 'The Descent',
        status: 'published',
      })
      .returning();
    if (!course) throw new Error('Failed to seed course');
    courseId = course.id;

    const [stage] = await db
      .insert(courseStages)
      .values({ courseId, name: 'Stage One', sortOrder: 1 })
      .returning();
    if (!stage) throw new Error('Failed to seed stage');
    stageId = stage.id;

    await db
      .insert(stagePractices)
      .values({ stageId, contentId: portalContentId, sortOrder: 0 });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function createPublishedContent(slugSuffix: string) {
    const media = await mediaService.create(
      {
        title: slugSuffix,
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: getOriginalKey(
          ownerUserId,
          crypto.randomUUID(),
          `${slugSuffix}.mp4`
        ),
        fileSizeBytes: 1024,
      },
      ownerUserId
    );
    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
        thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
        durationSeconds: 120,
      },
      ownerUserId
    );
    const item = await contentService.create(
      {
        organizationId,
        title: slugSuffix,
        slug: createUniqueSlug(slugSuffix),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      },
      ownerUserId
    );
    await contentService.publish(item.id, ownerUserId);
    return item;
  }

  /**
   * A purchase row with a balanced revenue split.
   *
   * `purchases` carries `check_revenue_split_equals_total`: platform fee +
   * organization fee + creator payout must equal the amount paid. The columns
   * all default to 0, so any insert that sets `amountPaidCents` without the
   * split violates it.
   */
  function purchaseRow(amountPaidCents: number) {
    const platformFeeCents = Math.round(amountPaidCents * 0.1);
    return {
      customerId: ownerUserId,
      organizationId,
      amountPaidCents,
      currency: 'gbp' as const,
      platformFeeCents,
      organizationFeeCents: 0,
      creatorPayoutCents: amountPaidCents - platformFeeCents,
      stripePaymentIntentId: `pi_test_${crypto.randomUUID()}`,
      status: 'completed' as const,
    };
  }

  /** A COURSE purchase: `course_id` set, `content_id` deliberately NULL. */
  async function seedCoursePurchase() {
    await db
      .insert(purchases)
      .values({ ...purchaseRow(2999), contentId: null, courseId });
  }

  const listAll = () =>
    accessService.listUserLibrary(ownerUserId, {
      organizationId,
      page: 1,
      limit: 50,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType: 'all',
      search: '',
    });

  describe('a course purchase must not empty the library (regression)', () => {
    it('returns membership content when the member has NO purchases at all', async () => {
      const result = await listAll();
      const ids = result.items.map((i) => i.content.id);

      expect(ids).toContain(soloContentId);
      expect(ids).toContain(portalContentId);
    });

    it('STILL returns membership content after a course purchase (content_id IS NULL)', async () => {
      await seedCoursePurchase();

      const result = await listAll();
      const ids = result.items.map((i) => i.content.id);

      // Under the old `NOT IN (SELECT content_id …)` form this array was EMPTY:
      // the subquery yielded a single NULL and every candidate row evaluated to
      // NULL rather than TRUE. Both items must survive.
      expect(ids).toContain(soloContentId);
      expect(ids).toContain(portalContentId);
      expect(result.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('still excludes content bought outright, so the purchased arm owns it', async () => {
      // A CONTENT purchase (content_id set) must keep being excluded from the
      // membership arm — the null-safety fix must not weaken the real exclusion.
      await db
        .insert(purchases)
        .values({ ...purchaseRow(999), contentId: soloContentId });

      const result = await listAll();
      const solo = result.items.filter((i) => i.content.id === soloContentId);

      // Present exactly once, and tagged as purchased rather than membership.
      expect(solo).toHaveLength(1);
      expect(solo[0]?.accessType).toBe('purchased');
    });
  });

  describe('portal provenance', () => {
    it('reports the portal a practice belongs to, and leaves standalone practices empty', async () => {
      const result = await listAll();

      const portalItem = result.items.find(
        (i) => i.content.id === portalContentId
      );
      const soloItem = result.items.find((i) => i.content.id === soloContentId);

      expect(portalItem?.journeys).toEqual([
        { id: courseId, title: 'The Descent', slug: expect.any(String) },
      ]);
      // Provenance is per-practice, not per-org: a practice in no portal must
      // report none rather than inheriting its neighbours'.
      expect(soloItem?.journeys).toEqual([]);
    });

    it('does not attribute a practice to a soft-deleted portal', async () => {
      await db
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(eq(courses.id, courseId));

      try {
        const result = await listAll();
        const portalItem = result.items.find(
          (i) => i.content.id === portalContentId
        );

        // An archived portal must stop branding its practices — otherwise the
        // grid badges a portal the member can no longer open.
        expect(portalItem?.journeys).toEqual([]);
      } finally {
        await db
          .update(courses)
          .set({ deletedAt: null })
          .where(eq(courses.id, courseId));
      }
    });

    it('does not attribute a practice through a soft-deleted stage', async () => {
      await db
        .update(courseStages)
        .set({ deletedAt: new Date() })
        .where(eq(courseStages.id, stageId));

      try {
        const result = await listAll();
        const portalItem = result.items.find(
          (i) => i.content.id === portalContentId
        );

        expect(portalItem?.journeys).toEqual([]);
      } finally {
        await db
          .update(courseStages)
          .set({ deletedAt: null })
          .where(eq(courseStages.id, stageId));
      }
    });

    it('keeps a practice out of the grid entirely once unpublished', async () => {
      // Guards the "published content only" half of the contract the provenance
      // lookup sits behind — provenance must never resurrect a draft.
      await db
        .update(content)
        .set({ status: 'draft' })
        .where(eq(content.id, portalContentId));

      try {
        const result = await listAll();
        const ids = result.items.map((i) => i.content.id);
        expect(ids).not.toContain(portalContentId);
      } finally {
        await db
          .update(content)
          .set({ status: 'published' })
          .where(eq(content.id, portalContentId));
      }
    });
  });
});
