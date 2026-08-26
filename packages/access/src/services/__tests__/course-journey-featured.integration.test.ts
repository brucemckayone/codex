/**
 * CourseJourneyService.setJourneyFeatured — the journey FEATURED write path.
 *
 * Runs against live Postgres so the scoped UPDATE is exercised for real.
 * `landing_pages.featured` has been READ since `listPublishedJourneys` shipped —
 * it filters on the column for the org-homepage rail and orders featured-first —
 * but nothing ever wrote it. The column was reachable only by raw SQL or a seed,
 * so every org's "featured" rail was permanently whatever the seed happened to
 * set. This method is that write.
 *
 * The invariants under test:
 *   1. `featured: true` PERSISTS — asserted by re-reading the column, not by the
 *      method resolving (a no-op update resolves happily).
 *   2. `featured: false` persists too — un-featuring must be expressible.
 *   3. A FOREIGN page is `NotFoundError` AND is left untouched, in both
 *      directions (org B naming org A's page, and org A naming org B's page).
 *      Dropping the `organizationId` predicate from the UPDATE's WHERE clause
 *      makes an id-only match succeed and silently re-curate another org's
 *      homepage — so a real foreign row is seeded and re-read.
 *   4. A soft-deleted page is `NotFoundError`, and stays as it was.
 *   5. The write is visible to the EXISTING public read: after featuring one of
 *      two published journeys, `listPublishedJourneys(org, { featured: true })`
 *      returns exactly that one. This is the end-to-end link.
 *   6. `listJourneysForOrg` surfaces `featured`, so the studio toggle can render
 *      its current state instead of guessing.
 *
 * Falsifiability: every assertion re-reads persisted state, so dropping any
 * clause of the scope — org, id, or `deletedAt IS NULL` — or the zero-row guard
 * fails a test rather than passing vacuously.
 */

import { courses, landingPages, organizations } from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

describe('CourseJourneyService.setJourneyFeatured (journey featured write path)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  /** PUBLISHED course page in org A — the one that gets featured. */
  let pageId: string;
  /** A SECOND published course page in org A, left un-featured (the control:
   * proves the `featured: true` read narrows rather than returning everything). */
  let siblingPageId: string;
  /** Published course page in org B — org A must never be able to feature it. */
  let foreignPageId: string;
  /** Soft-deleted course page in org A. */
  let deletedPageId: string;

  async function seedCoursePage(
    orgId: string,
    label: string,
    opts: { published?: boolean; pageDeleted?: boolean } = {}
  ): Promise<{ pageId: string; courseId: string }> {
    const status = opts.published ? 'published' : 'draft';
    const publishedAt = opts.published ? new Date() : null;

    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug(`${label}-course`),
        title: `${label} course`,
        status,
        publishedAt,
      })
      .returning({ id: courses.id });
    if (!course) throw new Error(`failed to seed course for ${label}`);

    const [page] = await db
      .insert(landingPages)
      .values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: createUniqueSlug(`${label}-page`),
        title: `${label} page`,
        status,
        publishedAt,
        subjectType: 'course',
        subjectId: course.id,
        sections: [],
        ...(opts.pageDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: landingPages.id });
    if (!page) throw new Error(`failed to seed page for ${label}`);

    return { pageId: page.id, courseId: course.id };
  }

  /** Read the column back — the only assertion that proves a write happened. */
  async function readFeatured(id: string): Promise<boolean | undefined> {
    const [row] = await db
      .select({ featured: landingPages.featured })
      .from(landingPages)
      .where(eq(landingPages.id, id))
      .limit(1);
    return row?.featured;
  }

  /** Force a known baseline without going through the method under test. */
  async function forceFeatured(id: string, featured: boolean): Promise<void> {
    await db
      .update(landingPages)
      .set({ featured })
      .where(eq(landingPages.id, id));
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Featured Org A', slug: createUniqueSlug('featured-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Featured Org B', slug: createUniqueSlug('featured-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    ({ pageId } = await seedCoursePage(orgAId, 'hero', { published: true }));
    ({ pageId: siblingPageId } = await seedCoursePage(orgAId, 'sibling', {
      published: true,
    }));
    ({ pageId: foreignPageId } = await seedCoursePage(orgBId, 'foreign', {
      published: true,
    }));
    ({ pageId: deletedPageId } = await seedCoursePage(orgAId, 'gone', {
      published: true,
      pageDeleted: true,
    }));
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('defaults to un-featured, then featuring PERSISTS the column', async () => {
    // The default matters: without it a passing "true" assertion could just be
    // reading a column that was already true.
    expect(await readFeatured(pageId)).toBe(false);

    await svc.setJourneyFeatured(orgAId, pageId, true);

    expect(await readFeatured(pageId)).toBe(true);
  });

  it('un-featuring PERSISTS too — the toggle is two-way', async () => {
    await svc.setJourneyFeatured(orgAId, pageId, true);
    expect(await readFeatured(pageId)).toBe(true);

    await svc.setJourneyFeatured(orgAId, pageId, false);

    expect(await readFeatured(pageId)).toBe(false);
  });

  it('IDOR: org B cannot feature org A’s page, and org A’s row is UNCHANGED', async () => {
    await forceFeatured(pageId, false);

    await expect(
      svc.setJourneyFeatured(orgBId, pageId, true)
    ).rejects.toBeInstanceOf(NotFoundError);

    // Drop the `organizationId` predicate and this flips to true: the refusal
    // must be a refusal to WRITE, not merely a thrown error after the write.
    expect(await readFeatured(pageId)).toBe(false);
  });

  it('IDOR: org A cannot feature org B’s page, and org B’s row is UNCHANGED', async () => {
    await forceFeatured(foreignPageId, false);

    await expect(
      svc.setJourneyFeatured(orgAId, foreignPageId, true)
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await readFeatured(foreignPageId)).toBe(false);
  });

  it('a soft-deleted page is NotFoundError and is left as it was', async () => {
    await forceFeatured(deletedPageId, false);

    await expect(
      svc.setJourneyFeatured(orgAId, deletedPageId, true)
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await readFeatured(deletedPageId)).toBe(false);
  });

  it('a missing page id is NotFoundError, never a silent no-op success', async () => {
    await expect(
      svc.setJourneyFeatured(orgAId, crypto.randomUUID(), true)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the write drives the EXISTING public read: featured:true returns only the featured journey', async () => {
    await svc.setJourneyFeatured(orgAId, pageId, true);
    await svc.setJourneyFeatured(orgAId, siblingPageId, false);

    const featuredOnly = await svc.listPublishedJourneys(orgAId, {
      featured: true,
    });

    expect(featuredOnly.map((c) => c.pageId)).toEqual([pageId]);
    expect(featuredOnly[0]?.featured).toBe(true);

    // Un-narrowed, BOTH published journeys surface — so the single result above
    // is the filter working, not an org with only one publishable page.
    const all = await svc.listPublishedJourneys(orgAId);
    expect(all.map((c) => c.pageId).sort()).toEqual(
      [pageId, siblingPageId].sort()
    );

    // …and un-featuring removes it from the rail again.
    await svc.setJourneyFeatured(orgAId, pageId, false);
    expect(await svc.listPublishedJourneys(orgAId, { featured: true })).toEqual(
      []
    );
  });

  it('listJourneysForOrg surfaces `featured` so the studio toggle can render its state', async () => {
    await svc.setJourneyFeatured(orgAId, pageId, true);
    await svc.setJourneyFeatured(orgAId, siblingPageId, false);

    const rows = await svc.listJourneysForOrg(orgAId);

    const hero = rows.find((r) => r.id === pageId);
    const sibling = rows.find((r) => r.id === siblingPageId);
    expect(hero?.featured).toBe(true);
    expect(sibling?.featured).toBe(false);
  });

  it('featuring is orthogonal to publish status — a DRAFT can be featured, with no public effect', async () => {
    const { pageId: draftPageId } = await seedCoursePage(orgAId, 'draft-feat');

    await svc.setJourneyFeatured(orgAId, draftPageId, true);
    expect(await readFeatured(draftPageId)).toBe(true);

    // The stored intent must not leak onto the public rail while unpublished —
    // `listPublishedJourneys` filters `status` independently of this flag.
    const rail = await svc.listPublishedJourneys(orgAId, { featured: true });
    expect(rail.map((c) => c.pageId)).not.toContain(draftPageId);

    // …but the studio DOES see it, which is what makes the toggle honest.
    const rows = await svc.listJourneysForOrg(orgAId);
    expect(rows.find((r) => r.id === draftPageId)?.featured).toBe(true);
  });
});
