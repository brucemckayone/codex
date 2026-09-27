/**
 * Page-image orphan-scan integration tests (Codex-61zsk.10, contract
 * amendment A3).
 *
 * REAL Neon coverage for `CourseJourneyService.saveJourneyPage`'s deep-scan
 * diff: an uploaded page image is referenced from ANYWHERE in `sections` as
 * an `ImageRef = { key, alt? }` (no per-type schema knowledge), so a save
 * that drops the last reference to a key must queue it for the
 * `OrphanedFileCleanupDO` sweep, and a save that keeps — or merely
 * relocates — a reference must NOT. Running against live Postgres also
 * proves the migration that added `page_image` / `landing_page` to
 * `orphaned_image_files`' CHECK constraints actually took: an insert with
 * either value 400s against the OLD constraint, so a passing "queues an
 * orphan" test is end-to-end proof the migration is live, not just that the
 * TypeScript compiled.
 *
 * Each test seeds its own org (mirrors `course-journey-publish-cascade`'s
 * convention), so the shared branch needs no inter-test cleanup.
 */

import { randomUUID } from 'node:crypto';
import {
  landingPages,
  organizations,
  orphanedImageFiles,
} from '@codex/database/schema';
import { OrphanedFileService } from '@codex/image-processing';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

function uniqueTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe('Page image orphan scan (Codex-61zsk.10)', () => {
  let db: Database;
  let serviceWithOrphanTracking: CourseJourneyService;
  let serviceWithoutOrphanTracking: CourseJourneyService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    serviceWithOrphanTracking = new CourseJourneyService({
      db,
      environment: 'test',
      orphanedFileService: new OrphanedFileService({ db, environment: 'test' }),
    });
    // Deliberately NO `orphanedFileService` — exercises the degraded warn-only
    // path a save must still survive.
    serviceWithoutOrphanTracking = new CourseJourneyService({
      db,
      environment: 'test',
    });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function makeOrg(prefix: string): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({ name: `${prefix} Org`, slug: createUniqueSlug(prefix) })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create test org');
    return org.id;
  }

  /** Create a fresh, empty journey page. Returns its id. */
  async function makePage(
    service: CourseJourneyService,
    orgId: string
  ): Promise<{ pageId: string; slug: string; title: string }> {
    const title = uniqueTitle('Page Images');
    const { id: pageId, slug } = await service.createJourney(orgId, creatorId, {
      title,
      pageType: 'course',
    });
    return { pageId, slug, title };
  }

  /** Every pending `page_image` orphan row queued for this page, newest first. */
  async function pendingOrphansFor(pageId: string) {
    return db
      .select()
      .from(orphanedImageFiles)
      .where(
        and(
          eq(orphanedImageFiles.imageType, 'page_image'),
          eq(orphanedImageFiles.originalEntityId, pageId)
        )
      );
  }

  it('queues a removed page-image key once a save drops its last reference', async () => {
    const orgId = await makeOrg('PageImgRemove');
    const { pageId, slug, title } = await makePage(
      serviceWithOrphanTracking,
      orgId
    );
    const key = `landing-pages/${pageId}/images/${randomUUID()}`;

    // Save 1: the key is referenced from an arbitrary block prop.
    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections: [
        {
          id: 'sec-1',
          type: 'hero',
          enabled: true,
          props: { image: { key, alt: 'A rootwork practice' } },
        },
      ],
      brandOverrides: null,
    });
    expect(await pendingOrphansFor(pageId)).toEqual([]);

    // Save 2: the block (and its only reference to `key`) is gone.
    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections: [],
      brandOverrides: null,
    });

    // The three OBJECTS, never the base key: nothing lives at the base key,
    // so a sweep given it deletes nothing and marks the row done.
    const orphans = await pendingOrphansFor(pageId);
    expect(orphans.map((orphan) => orphan.r2Key).sort()).toEqual(
      [`${key}/lg.webp`, `${key}/md.webp`, `${key}/sm.webp`].sort()
    );
    expect(orphans[0]).toMatchObject({
      imageType: 'page_image',
      originalEntityId: pageId,
      originalEntityType: 'landing_page',
      status: 'pending',
    });
  });

  it('does NOT queue a key that is still referenced after the save', async () => {
    const orgId = await makeOrg('PageImgKeep');
    const { pageId, slug, title } = await makePage(
      serviceWithOrphanTracking,
      orgId
    );
    const key = `landing-pages/${pageId}/images/${randomUUID()}`;
    const sections = [
      {
        id: 'sec-1',
        type: 'hero',
        enabled: true,
        props: { image: { key, alt: 'Unchanged' } },
      },
    ];

    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections,
      brandOverrides: null,
    });
    // Re-save the SAME content — a real no-op autosave tick.
    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections,
      brandOverrides: null,
    });

    expect(await pendingOrphansFor(pageId)).toEqual([]);
  });

  it('does NOT queue a key that moves to a different prop or block — no per-type schema knowledge', async () => {
    const orgId = await makeOrg('PageImgRelocate');
    const { pageId, slug, title } = await makePage(
      serviceWithOrphanTracking,
      orgId
    );
    const key = `landing-pages/${pageId}/images/${randomUUID()}`;

    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections: [
        {
          id: 'sec-1',
          type: 'hero',
          enabled: true,
          props: { image: { key, alt: 'On the hero' } },
        },
      ],
      brandOverrides: null,
    });

    // Same key, now nested inside a DIFFERENT block's DIFFERENT prop path
    // (`items[].image`) — proves the scan is a generic string walk, not a
    // lookup keyed on `props.image`.
    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections: [
        {
          id: 'sec-2',
          type: 'gallery',
          enabled: true,
          props: { items: [{ caption: 'x' }, { image: { key } }] },
        },
      ],
      brandOverrides: null,
    });

    expect(await pendingOrphansFor(pageId)).toEqual([]);
  });

  it('never fails the save when no orphanedFileService is configured', async () => {
    const orgId = await makeOrg('PageImgNoService');
    const { pageId, slug, title } = await makePage(
      serviceWithoutOrphanTracking,
      orgId
    );
    const key = `landing-pages/${pageId}/images/${randomUUID()}`;

    await serviceWithoutOrphanTracking.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'draft',
      sections: [
        {
          id: 'sec-1',
          type: 'hero',
          enabled: true,
          props: { image: { key, alt: 'Soon removed' } },
        },
      ],
      brandOverrides: null,
    });

    // Dropping the reference with no orphan service configured must still
    // resolve (the degraded path is a warn log, never a throw) and must still
    // persist the page's new content.
    await expect(
      serviceWithoutOrphanTracking.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      })
    ).resolves.toBeUndefined();

    const loaded = await serviceWithoutOrphanTracking.getJourneyForBuilder(
      orgId,
      pageId
    );
    expect(loaded?.sections).toEqual([]);
  });

  /** Save a page whose only content is one section holding `images`. */
  async function saveImages(
    orgId: string,
    page: { pageId: string; slug: string; title: string },
    images: string[]
  ): Promise<void> {
    await serviceWithOrphanTracking.saveJourneyPage(orgId, {
      id: page.pageId,
      title: page.title,
      slug: page.slug,
      status: 'draft',
      sections:
        images.length === 0
          ? []
          : [
              {
                id: 'sec-1',
                type: 'benefits',
                enabled: true,
                props: { items: images.map((key) => ({ image: { key } })) },
              },
            ],
      brandOverrides: null,
    });
  }

  it('nominates a key a duplicated page drops, though it is under its source page', async () => {
    const orgId = await makeOrg('PageImgDuplicate');
    const source = await makePage(serviceWithOrphanTracking, orgId);
    const copy = await makePage(serviceWithOrphanTracking, orgId);
    // A duplicate renders its source's keys verbatim (duplicateJourneyPage
    // copies `sections`), so the key is under the SOURCE page's prefix.
    const key = `landing-pages/${source.pageId}/images/${randomUUID()}`;

    await saveImages(orgId, copy, [key]);
    await saveImages(orgId, copy, []);

    expect(
      (await pendingOrphansFor(copy.pageId)).map((row) => row.r2Key).sort()
    ).toEqual([`${key}/lg.webp`, `${key}/md.webp`, `${key}/sm.webp`].sort());
  });

  it('ignores a string that only shares the prefix', async () => {
    const orgId = await makeOrg('PageImgShape');
    const page = await makePage(serviceWithOrphanTracking, orgId);

    await saveImages(orgId, page, [
      `landing-pages/${page.pageId}/images/hero-photo`,
    ]);
    await saveImages(orgId, page, []);

    expect(await pendingOrphansFor(page.pageId)).toEqual([]);
  });

  it('nominates at most 100 images from one save', async () => {
    const orgId = await makeOrg('PageImgCap');
    const page = await makePage(serviceWithOrphanTracking, orgId);
    const keys = Array.from(
      { length: 101 },
      () => `landing-pages/${page.pageId}/images/${randomUUID()}`
    );

    await saveImages(orgId, page, keys);
    await saveImages(orgId, page, []);

    expect(await pendingOrphansFor(page.pageId)).toHaveLength(300);
  });

  // The sweep's side of the contract (OrphanedFileService), against the same
  // live Postgres: a nomination above only matters if the sweep then decides
  // correctly. Nested here because `teardownTestDatabase` closes the shared
  // pool, so a second top-level suite would query a closed pool.
  describe('the sweep decisions', () => {
    let journeys: CourseJourneyService;
    let orphans: OrphanedFileService;

    beforeAll(() => {
      orphans = new OrphanedFileService({ db, environment: 'test' });
      // No orphan tracking: these pages only need to EXIST with references.
      journeys = serviceWithoutOrphanTracking;
    });

    /** A page in `orgId` whose sections reference `keys`. Returns its id. */
    async function pageShowing(orgId: string, keys: string[]): Promise<string> {
      const title = uniqueTitle('Sweep');
      const { id, slug } = await journeys.createJourney(orgId, creatorId, {
        title,
        pageType: 'course',
      });
      await journeys.saveJourneyPage(orgId, {
        id,
        title,
        slug,
        status: 'draft',
        sections: [
          {
            id: 'sec-1',
            type: 'hero',
            enabled: true,
            props: { items: keys.map((key) => ({ image: { key } })) },
          },
        ],
        brandOverrides: null,
      });
      return id;
    }

    describe('isPageImageReferenced', () => {
      it('is true while the page itself shows the image', async () => {
        const orgId = await makeOrg('SweepOwn');
        const pageId = await pageShowing(orgId, []);
        const key = `landing-pages/${pageId}/images/${randomUUID()}`;
        await journeys.saveJourneyPage(orgId, {
          id: pageId,
          title: 'Own',
          slug: createUniqueSlug('own'),
          status: 'draft',
          sections: [
            {
              id: 'sec-1',
              type: 'hero',
              enabled: true,
              props: { image: { key } },
            },
          ],
          brandOverrides: null,
        });

        expect(await orphans.isPageImageReferenced(key)).toBe(true);
      });

      it('is true while only a page duplicated from it shows the image', async () => {
        const orgId = await makeOrg('SweepCopy');
        const source = await pageShowing(orgId, []);
        const key = `landing-pages/${source}/images/${randomUUID()}`;
        await pageShowing(orgId, [key]);

        expect(await orphans.isPageImageReferenced(key)).toBe(true);
      });

      it('is true while only a soft-deleted page shows it, because a restore brings it back', async () => {
        const orgId = await makeOrg('SweepDeleted');
        const source = await pageShowing(orgId, []);
        const key = `landing-pages/${source}/images/${randomUUID()}`;
        const holder = await pageShowing(orgId, [key]);
        await db
          .update(landingPages)
          .set({ deletedAt: new Date() })
          .where(eq(landingPages.id, holder));

        expect(await orphans.isPageImageReferenced(key)).toBe(true);
      });

      it("is false when only another org's page shows it — a pasted key cannot keep an image alive", async () => {
        const ownerOrg = await makeOrg('SweepOwner');
        const source = await pageShowing(ownerOrg, []);
        const key = `landing-pages/${source}/images/${randomUUID()}`;
        await pageShowing(await makeOrg('SweepPaster'), [key]);

        expect(await orphans.isPageImageReferenced(key)).toBe(false);
      });

      it('is false once no page shows it', async () => {
        const orgId = await makeOrg('SweepNone');
        const source = await pageShowing(orgId, []);

        expect(
          await orphans.isPageImageReferenced(
            `landing-pages/${source}/images/${randomUUID()}`
          )
        ).toBe(false);
      });

      it('is false for a key under a page that does not exist', async () => {
        expect(
          await orphans.isPageImageReferenced(
            `landing-pages/${randomUUID()}/images/${randomUUID()}`
          )
        ).toBe(false);
      });

      it('keeps a key it cannot place', async () => {
        expect(
          await orphans.isPageImageReferenced('landing-pages/x/images/y')
        ).toBe(true);
      });
    });

    describe('getPendingOrphans', () => {
      const now = new Date('2000-01-10T00:00:00Z');
      const day = 24 * 60 * 60 * 1000;
      const tag = randomUUID();
      const rows = {
        youngPageImage: {
          r2Key: `test-grace/${tag}/young-page-image.webp`,
          imageType: 'page_image' as const,
          orphanedAt: new Date(now.getTime() - 1 * day),
        },
        duePageImage: {
          r2Key: `test-grace/${tag}/due-page-image.webp`,
          imageType: 'page_image' as const,
          orphanedAt: new Date(now.getTime() - 8 * day),
        },
        youngAvatar: {
          r2Key: `test-grace/${tag}/young-avatar.webp`,
          imageType: 'avatar' as const,
          orphanedAt: new Date(now.getTime() - 1 * day),
        },
      };

      afterAll(async () => {
        await db.delete(orphanedImageFiles).where(
          inArray(
            orphanedImageFiles.r2Key,
            Object.values(rows).map((row) => row.r2Key)
          )
        );
      });

      it('holds a page image back for its grace period, and nothing else', async () => {
        await db.insert(orphanedImageFiles).values(Object.values(rows));

        // Dated in the year 2000, so they are the oldest pending rows in a
        // shared database and land in the first batch.
        const due = (await orphans.getPendingOrphans(50, now)).map(
          (row) => row.r2Key
        );

        expect(due).toContain(rows.duePageImage.r2Key);
        expect(due).toContain(rows.youngAvatar.r2Key);
        expect(due).not.toContain(rows.youngPageImage.r2Key);
      });
    });
  });
});
