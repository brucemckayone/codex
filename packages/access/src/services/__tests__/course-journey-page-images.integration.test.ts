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
import { organizations, orphanedImageFiles } from '@codex/database/schema';
import { OrphanedFileService } from '@codex/image-processing';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
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

    const orphans = await pendingOrphansFor(pageId);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      r2Key: key,
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
});
