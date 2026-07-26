/**
 * Studio journey MANAGEMENT integration tests (Codex-2pryk · Codex-isr02).
 *
 * REAL Neon coverage for the creator WRITE path added to CourseJourneyService —
 * the seam the studio index + builder now call instead of `journey-queries.mock`:
 *
 *   • createJourney        — the TWO-ROW transactional create (course +
 *     landing_page for a course page; page-only for a landing page) + org-unique
 *     slug resolution across BOTH tables.
 *   • getJourneyForBuilder — org-scoped page load; a foreign-org id → null (IDOR).
 *   • saveJourneyPage      — persists sections/title/status; publishing a course
 *     page publishes its subject course; foreign id → NotFoundError; a colliding
 *     slug → ConflictError.
 *   • listJourneysForOrg   — the org's pages only (cross-org isolation) + live
 *     course rollups (stage / practice / enrolment counts).
 *
 * Runs against live Postgres so every FK, CHECK and partial-unique index is
 * exercised. Data is scoped to freshly-created unique orgs/titles per test
 * (matching course-round-d.integration.test.ts), so the shared branch needs no
 * inter-test cleanup and the seeded demo data is untouched. Every assertion is
 * UNCONDITIONAL and the IDOR/isolation tests seed a real foreign row and assert
 * its ABSENCE, so each test can fail if scoping regresses
 * (bd memory implement/tests-must-be-able-to-fail).
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courseEnrollments,
  courseStages,
  courses,
  landingPages,
  organizations,
  stagePractices,
} from '@codex/database/schema';
import { ConflictError, NotFoundError } from '@codex/service-errors';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

/** A unique journey title → a unique derived slug per test. */
function uniqueTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe('Studio journey management (Codex-isr02)', () => {
  let db: Database;
  let service: CourseJourneyService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Studio Mgmt Org A', slug: createUniqueSlug('mgmt-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Studio Mgmt Org B', slug: createUniqueSlug('mgmt-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create test orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('createJourney', () => {
    it('course page: creates a course + a landing_page bound to it, both draft, same slug', async () => {
      const title = uniqueTitle('Rooted');
      const { id: pageId, slug } = await service.createJourney(
        orgAId,
        creatorId,
        { title, pageType: 'course' }
      );

      const [page] = await db
        .select()
        .from(landingPages)
        .where(eq(landingPages.id, pageId));
      expect(page).toBeDefined();
      expect(page?.organizationId).toBe(orgAId);
      expect(page?.creatorId).toBe(creatorId);
      expect(page?.pageType).toBe('course');
      expect(page?.status).toBe('draft');
      expect(page?.slug).toBe(slug);
      expect(page?.subjectType).toBe('course');
      expect(page?.subjectId).not.toBeNull();
      expect(page?.sections).toEqual([]);

      // The subject course exists, is scoped to the same org, and shares the slug.
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, page?.subjectId ?? ''));
      expect(course).toBeDefined();
      expect(course?.organizationId).toBe(orgAId);
      expect(course?.creatorId).toBe(creatorId);
      expect(course?.status).toBe('draft');
      expect(course?.slug).toBe(slug);
    });

    it('landing page: creates only the page row (no course, no subject)', async () => {
      const { id: pageId } = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('Welcome'),
        pageType: 'landing',
      });
      const [page] = await db
        .select()
        .from(landingPages)
        .where(eq(landingPages.id, pageId));
      expect(page?.pageType).toBe('landing');
      expect(page?.subjectType).toBeNull();
      expect(page?.subjectId).toBeNull();
    });

    it('resolves an org-unique slug (a repeat title gets a -2 suffix)', async () => {
      const title = uniqueTitle('Clash');
      const first = await service.createJourney(orgAId, creatorId, {
        title,
        pageType: 'course',
      });
      const second = await service.createJourney(orgAId, creatorId, {
        title,
        pageType: 'course',
      });
      expect(second.slug).toBe(`${first.slug}-2`);
      expect(second.slug).not.toBe(first.slug);
    });
  });

  describe('getJourneyForBuilder', () => {
    it('returns the org-scoped page, and null for a foreign-org caller (IDOR)', async () => {
      const { id: pageId } = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('Builder'),
        pageType: 'course',
      });

      const owned = await service.getJourneyForBuilder(orgAId, pageId);
      expect(owned).not.toBeNull();
      expect(owned?.id).toBe(pageId);
      expect(owned?.organizationId).toBe(orgAId);

      // Org B must NEVER see org A's page — the foreign row exists, so a
      // non-null result would be a real leak.
      const foreign = await service.getJourneyForBuilder(orgBId, pageId);
      expect(foreign).toBeNull();
    });
  });

  describe('saveJourneyPage', () => {
    it('persists sections + title + status, and publishing a course page publishes the course', async () => {
      const { id: pageId } = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('Publish'),
        pageType: 'course',
      });
      const loaded = await service.getJourneyForBuilder(orgAId, pageId);
      if (!loaded) throw new Error('page not found after create');

      const sections = [
        { id: 's1', type: 'hero', enabled: true, props: { headline: 'Hi' } },
      ];
      await service.saveJourneyPage(orgAId, {
        id: loaded.id,
        title: 'Renamed Journey',
        slug: loaded.slug,
        status: 'published',
        sections,
        brandOverrides: null,
      });

      const [page] = await db
        .select()
        .from(landingPages)
        .where(eq(landingPages.id, pageId));
      expect(page?.title).toBe('Renamed Journey');
      expect(page?.status).toBe('published');
      expect(page?.publishedAt).not.toBeNull();
      expect(page?.sections).toEqual(sections);

      // Publishing the course PAGE must publish its subject COURSE too, else the
      // public sales page (getCoursePage requires BOTH published) stays 404.
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, loaded.subjectId ?? ''));
      expect(course?.status).toBe('published');
      expect(course?.publishedAt).not.toBeNull();
    });

    it('throws NotFoundError for a foreign-org page (no silent cross-org write)', async () => {
      const { id: pageId } = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('Foreign'),
        pageType: 'course',
      });
      const loaded = await service.getJourneyForBuilder(orgAId, pageId);
      if (!loaded) throw new Error('page not found after create');

      await expect(
        service.saveJourneyPage(orgBId, {
          id: loaded.id,
          title: 'Hijacked',
          slug: loaded.slug,
          status: 'draft',
          sections: [],
          brandOverrides: null,
        })
      ).rejects.toBeInstanceOf(NotFoundError);

      // The row is untouched — the foreign write never landed.
      const [page] = await db
        .select()
        .from(landingPages)
        .where(eq(landingPages.id, pageId));
      expect(page?.title).not.toBe('Hijacked');
    });

    it('throws ConflictError when renaming to a slug another page already holds', async () => {
      const a = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('SlugA'),
        pageType: 'course',
      });
      const b = await service.createJourney(orgAId, creatorId, {
        title: uniqueTitle('SlugB'),
        pageType: 'course',
      });
      const loadedB = await service.getJourneyForBuilder(orgAId, b.id);
      if (!loadedB) throw new Error('page B not found');

      await expect(
        service.saveJourneyPage(orgAId, {
          id: loadedB.id,
          title: 'Move onto A slug',
          slug: a.slug, // collides with page A
          status: 'draft',
          sections: [],
          brandOverrides: null,
        })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('listJourneysForOrg', () => {
    it('lists only the org own pages with live course rollups (cross-org isolation)', async () => {
      // A fresh org so the counts assert exactly (isolated from other tests).
      const [org] = await db
        .insert(organizations)
        .values({ name: 'List Org', slug: createUniqueSlug('mgmt-list') })
        .returning({ id: organizations.id });
      if (!org) throw new Error('failed to create list org');

      const { id: pageId } = await service.createJourney(org.id, creatorId, {
        title: uniqueTitle('Listed'),
        pageType: 'course',
      });
      const loaded = await service.getJourneyForBuilder(org.id, pageId);
      if (!loaded?.subjectId) throw new Error('course subject missing');
      const courseId = loaded.subjectId;

      // Curriculum + an enrolment → rollups.
      const [stage] = await db
        .insert(courseStages)
        .values({ courseId, name: 'Stage 1', sortOrder: 0 })
        .returning({ id: courseStages.id });
      if (!stage) throw new Error('stage insert failed');
      const [practice] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: org.id,
            status: 'published',
          })
        )
        .returning({ id: content.id });
      if (!practice) throw new Error('practice insert failed');
      await db
        .insert(stagePractices)
        .values({ stageId: stage.id, contentId: practice.id, sortOrder: 0 });
      await db.insert(courseEnrollments).values({
        userId: creatorId,
        courseId,
        enrolledAt: new Date(),
        source: 'course_purchase',
      });

      // A foreign-org page that must NEVER appear in org's list.
      const foreign = await service.createJourney(orgBId, creatorId, {
        title: uniqueTitle('ForeignListed'),
        pageType: 'course',
      });

      const list = await service.listJourneysForOrg(org.id);
      const ids = list.map((j) => j.id);
      expect(ids).toContain(pageId);
      expect(ids).not.toContain(foreign.id);

      const row = list.find((j) => j.id === pageId);
      expect(row?.stageCount).toBe(1);
      expect(row?.practiceCount).toBe(1);
      expect(row?.enrolledCount).toBe(1);
    });
  });
});
