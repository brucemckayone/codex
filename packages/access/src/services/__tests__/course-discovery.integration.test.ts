/**
 * Member DISCOVERY integration tests (Codex-2pryk · Codex-oi2w4).
 *
 * REAL Neon coverage for the member-facing discovery reads added to
 * CourseJourneyService — the seam the org home / Explore / Library now call:
 *
 *   • listPublishedJourneys — the PUBLIC browse list (home "featured" rail +
 *     Explore grid): only PUBLISHED course-journeys whose subject course is
 *     PUBLISHED, cross-org isolated, featured-first, member-visible practice
 *     counts, optional `featured` filter.
 *   • listEnrolledJourneys  — the PER-USER library shelf: the user's enrolments
 *     joined to published course + landing page, with a completed/total practice
 *     rollup + derived status; scoped to the user AND the org.
 *
 * Runs against live Postgres so every FK, CHECK and partial-unique index is
 * exercised. Data is scoped to freshly-created unique orgs/titles per test
 * (matching course-studio-management.integration.test.ts), so the shared branch
 * needs no inter-test cleanup and the seeded demo data is untouched. Every
 * assertion is UNCONDITIONAL, and the isolation tests seed a real foreign/other
 * row and assert its ABSENCE, so each test can fail if scoping regresses
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
  practiceCompletions,
  stagePractices,
} from '@codex/database/schema';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

/** A unique journey title → a unique derived slug per test. */
function uniqueTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe('Member discovery (Codex-oi2w4)', () => {
  let db: Database;
  let service: CourseJourneyService;
  let creatorId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CourseJourneyService({ db, environment: 'test' });
    [creatorId, otherUserId] = await seedTestUsers(db, 2);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A fresh org, isolated so per-org list assertions are exact. */
  async function makeOrg(prefix: string): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({ name: `${prefix} Org`, slug: createUniqueSlug(prefix) })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create test org');
    return org.id;
  }

  /**
   * Create + PUBLISH a course-journey (page + subject course both published),
   * attach ONE stage with `published` published practices and `draft` draft
   * practices, and stamp the course kicker/lede/price. Returns the ids the tests
   * assert against.
   */
  async function seedPublishedJourney(
    orgId: string,
    opts: {
      published?: number;
      draft?: number;
      featured?: boolean;
      priceCents?: number | null;
      kicker?: string;
      lede?: string;
    } = {}
  ): Promise<{
    pageId: string;
    slug: string;
    courseId: string;
    practiceIds: string[];
  }> {
    const publishedCount = opts.published ?? 2;
    const draftCount = opts.draft ?? 0;

    const { id: pageId, slug } = await service.createJourney(orgId, creatorId, {
      title: uniqueTitle('Journey'),
      pageType: 'course',
    });
    const loaded = await service.getJourneyForBuilder(orgId, pageId);
    if (!loaded?.subjectId)
      throw new Error('course subject missing after create');
    const courseId = loaded.subjectId;

    // Publish the page → publishes the subject course too.
    await service.saveJourneyPage(orgId, {
      id: pageId,
      title: loaded.title,
      slug: loaded.slug,
      status: 'published',
      sections: [],
      brandOverrides: null,
    });

    // Course presentation fields + optional price.
    await db
      .update(courses)
      .set({
        kicker: opts.kicker ?? 'Foundation course',
        lede: opts.lede ?? 'Teach the body it is safe to settle.',
        priceCents: opts.priceCents ?? null,
      })
      .where(eq(courses.id, courseId));

    // Optional home-rail feature flag.
    if (opts.featured) {
      await db
        .update(landingPages)
        .set({ featured: true })
        .where(eq(landingPages.id, pageId));
    }

    const [stage] = await db
      .insert(courseStages)
      .values({ courseId, name: 'Stage 1', sortOrder: 0 })
      .returning({ id: courseStages.id });
    if (!stage) throw new Error('stage insert failed');

    const practiceIds: string[] = [];
    for (let i = 0; i < publishedCount; i++) {
      const [p] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            status: 'published',
          })
        )
        .returning({ id: content.id });
      if (!p) throw new Error('published practice insert failed');
      await db
        .insert(stagePractices)
        .values({ stageId: stage.id, contentId: p.id, sortOrder: i });
      practiceIds.push(p.id);
    }
    for (let i = 0; i < draftCount; i++) {
      const [p] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            status: 'draft',
          })
        )
        .returning({ id: content.id });
      if (!p) throw new Error('draft practice insert failed');
      await db.insert(stagePractices).values({
        stageId: stage.id,
        contentId: p.id,
        sortOrder: publishedCount + i,
      });
    }

    return { pageId, slug, courseId, practiceIds };
  }

  describe('listPublishedJourneys', () => {
    it('returns a published journey as a card with member-visible counts + course fields', async () => {
      const orgId = await makeOrg('disc-card');
      const { pageId, slug, courseId } = await seedPublishedJourney(orgId, {
        published: 3,
        draft: 2, // draft practices must NOT inflate the count
        priceCents: 1500,
        kicker: 'Foundation course',
        lede: 'Teach the body it is safe to settle.',
      });

      const list = await service.listPublishedJourneys(orgId);
      expect(list).toHaveLength(1);
      const card = list[0];
      expect(card.pageId).toBe(pageId);
      expect(card.slug).toBe(slug);
      expect(card.courseId).toBe(courseId);
      expect(card.courseSlug).toBe(slug);
      expect(card.kicker).toBe('Foundation course');
      expect(card.tagline).toBe('Teach the body it is safe to settle.');
      expect(card.priceCents).toBe(1500);
      expect(card.stageCount).toBe(1);
      // Only the 3 PUBLISHED practices — the 2 drafts are excluded (this is the
      // loadPublishedCurriculumCounts vs loadCourseRollups distinction).
      expect(card.practiceCount).toBe(3);
      expect(card.featured).toBe(false);
    });

    it('excludes a DRAFT journey and a journey whose subject course is unpublished', async () => {
      const orgId = await makeOrg('disc-draft');

      // A draft (never-published) journey.
      const { id: draftPageId } = await service.createJourney(
        orgId,
        creatorId,
        {
          title: uniqueTitle('DraftJourney'),
          pageType: 'course',
        }
      );

      // A published journey whose subject course is then reverted to draft.
      const { pageId: orphanPageId, courseId } =
        await seedPublishedJourney(orgId);
      await db
        .update(courses)
        .set({ status: 'draft' })
        .where(eq(courses.id, courseId));

      const list = await service.listPublishedJourneys(orgId);
      const ids = list.map((c) => c.pageId);
      expect(ids).not.toContain(draftPageId);
      expect(ids).not.toContain(orphanPageId);
    });

    it('is cross-org isolated (org A never surfaces org B journeys)', async () => {
      const orgAId = await makeOrg('disc-iso-a');
      const orgBId = await makeOrg('disc-iso-b');
      const { pageId: aPage } = await seedPublishedJourney(orgAId);
      const { pageId: bPage } = await seedPublishedJourney(orgBId);

      const listA = await service.listPublishedJourneys(orgAId);
      const idsA = listA.map((c) => c.pageId);
      expect(idsA).toContain(aPage);
      expect(idsA).not.toContain(bPage);
    });

    it('featured filter returns only featured journeys; default returns all published', async () => {
      const orgId = await makeOrg('disc-featured');
      const { pageId: featuredPage } = await seedPublishedJourney(orgId, {
        featured: true,
      });
      const { pageId: plainPage } = await seedPublishedJourney(orgId, {
        featured: false,
      });

      const featuredOnly = await service.listPublishedJourneys(orgId, {
        featured: true,
      });
      const featuredIds = featuredOnly.map((c) => c.pageId);
      expect(featuredIds).toContain(featuredPage);
      expect(featuredIds).not.toContain(plainPage);

      const all = await service.listPublishedJourneys(orgId);
      const allIds = all.map((c) => c.pageId);
      expect(allIds).toContain(featuredPage);
      expect(allIds).toContain(plainPage);
      // Featured-first ordering — the featured card leads.
      expect(all[0]?.pageId).toBe(featuredPage);
    });
  });

  describe('listEnrolledJourneys', () => {
    /** Enrol `userId` in `courseId`; optionally stamp completion. */
    async function enrol(
      userId: string,
      courseId: string,
      opts: { completedAt?: Date } = {}
    ): Promise<void> {
      await db.insert(courseEnrollments).values({
        userId,
        courseId,
        enrolledAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: opts.completedAt ?? null,
        source: 'course_purchase',
      });
    }

    /** Mark `userId` complete on `contentId`. */
    async function complete(userId: string, contentId: string): Promise<void> {
      await db
        .insert(practiceCompletions)
        .values({ userId, contentId, source: 'manual' });
    }

    it('returns an enrolled journey with an in-progress rollup (1 of 2 = 50%)', async () => {
      const orgId = await makeOrg('enr-progress');
      const { pageId, courseId, practiceIds } = await seedPublishedJourney(
        orgId,
        {
          published: 2,
        }
      );
      await enrol(creatorId, courseId);
      await complete(creatorId, practiceIds[0]);

      const list = await service.listEnrolledJourneys(creatorId, orgId);
      expect(list).toHaveLength(1);
      const card = list[0];
      expect(card.pageId).toBe(pageId);
      expect(card.courseId).toBe(courseId);
      expect(card.totalPractices).toBe(2);
      expect(card.completedPractices).toBe(1);
      expect(card.percent).toBe(50);
      expect(card.status).toBe('in-progress');
      expect(card.enrolledAt).toBeTruthy();
    });

    it('derives status=completed from the enrolment completedAt, and not-started with no completions', async () => {
      const orgId = await makeOrg('enr-status');

      const done = await seedPublishedJourney(orgId, { published: 1 });
      await enrol(creatorId, done.courseId, { completedAt: new Date() });
      await complete(creatorId, done.practiceIds[0]);

      const fresh = await seedPublishedJourney(orgId, { published: 2 });
      await enrol(creatorId, fresh.courseId);

      const list = await service.listEnrolledJourneys(creatorId, orgId);
      const doneCard = list.find((c) => c.courseId === done.courseId);
      const freshCard = list.find((c) => c.courseId === fresh.courseId);

      expect(doneCard?.status).toBe('completed');
      expect(doneCard?.percent).toBe(100);
      expect(freshCard?.status).toBe('not-started');
      expect(freshCard?.completedPractices).toBe(0);
      expect(freshCard?.percent).toBe(0);
    });

    it('is scoped to the session user and the org (no other-user / cross-org leak)', async () => {
      const orgAId = await makeOrg('enr-scope-a');
      const orgBId = await makeOrg('enr-scope-b');

      // creator enrols in an org-A journey; otherUser enrols in a DIFFERENT org-A
      // journey; creator also enrols in an org-B journey.
      const aMine = await seedPublishedJourney(orgAId);
      const aOther = await seedPublishedJourney(orgAId);
      const bMine = await seedPublishedJourney(orgBId);
      await enrol(creatorId, aMine.courseId);
      await enrol(otherUserId, aOther.courseId);
      await enrol(creatorId, bMine.courseId);

      const list = await service.listEnrolledJourneys(creatorId, orgAId);
      const courseIds = list.map((c) => c.courseId);
      expect(courseIds).toContain(aMine.courseId);
      // otherUser's enrolment must never appear for creator.
      expect(courseIds).not.toContain(aOther.courseId);
      // creator's org-B enrolment must not appear when browsing org A.
      expect(courseIds).not.toContain(bMine.courseId);
    });

    it('excludes an enrolment whose course has been unpublished', async () => {
      const orgId = await makeOrg('enr-unpub');
      const { courseId } = await seedPublishedJourney(orgId);
      await enrol(creatorId, courseId);
      await db
        .update(courses)
        .set({ status: 'draft' })
        .where(eq(courses.id, courseId));

      const list = await service.listEnrolledJourneys(creatorId, orgId);
      expect(list.map((c) => c.courseId)).not.toContain(courseId);
    });

    it('counts only PUBLISHED practices as completions (a draft-practice completion never inflates progress)', async () => {
      const orgId = await makeOrg('enr-clamp');
      const { courseId, practiceIds } = await seedPublishedJourney(orgId, {
        published: 2,
        draft: 1,
      });
      // Find the draft practice id via the stage association.
      const [stageRow] = await db
        .select({ id: courseStages.id })
        .from(courseStages)
        .where(eq(courseStages.courseId, courseId));
      const rows = await db
        .select({ contentId: stagePractices.contentId, status: content.status })
        .from(stagePractices)
        .innerJoin(content, eq(content.id, stagePractices.contentId))
        .where(eq(stagePractices.stageId, stageRow!.id));
      const draftPractice = rows.find((r) => r.status === 'draft');
      expect(draftPractice).toBeDefined();

      await enrol(creatorId, courseId);
      await complete(creatorId, practiceIds[0]); // published → counts
      await complete(creatorId, draftPractice!.contentId); // draft → must NOT count

      const list = await service.listEnrolledJourneys(creatorId, orgId);
      const card = list.find((c) => c.courseId === courseId);
      expect(card?.totalPractices).toBe(2);
      expect(card?.completedPractices).toBe(1);
      expect(card?.percent).toBe(50);
    });
  });
});
