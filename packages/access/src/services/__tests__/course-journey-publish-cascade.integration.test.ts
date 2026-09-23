/**
 * Journey PUBLISH/UNPUBLISH CASCADE + slug-sync integration tests (Codex-xzwl5).
 *
 * REAL Neon coverage for the two write-path invariants `saveJourneyPage` was
 * missing:
 *
 *   1. STATUS CASCADE — publishing a course page published its subject course,
 *      but unpublishing it left `courses.status = 'published'`. Since
 *      `courses.status` is the ONLY gate on `listPublishedCourses` (the /explore
 *      rail) and `getCourseBySlug` (the public by-slug read), an "unpublished"
 *      journey stayed listed and reachable — a journey that could not be taken
 *      down. These tests assert the journey disappears from EVERY public listing
 *      AND from both public by-slug reads, and that a course fronted by a second
 *      published page is NOT taken down with it.
 *
 *   2. SLUG/TITLE SYNC — the course kept its creation-time slug, so the /explore
 *      link (course slug) and the org-landing link (page slug) resolved to
 *      different URLs after a rename. These tests round-trip a rename and assert
 *      the two link-derivation paths agree.
 *
 * Runs against live Postgres so every FK, CHECK and partial-unique index (both
 * `uq_landing_pages_org_slug` and `uq_courses_org_slug`) is exercised. Each test
 * seeds its own unique org, so the shared branch needs no inter-test cleanup.
 * Every assertion is UNCONDITIONAL and each negative case seeds a real row and
 * asserts its ABSENCE, so the tests can fail if the cascade regresses.
 */

import { randomUUID } from 'node:crypto';
import {
  courseEnrollments,
  courses,
  landingPages,
  organizations,
} from '@codex/database/schema';
import { ConflictError } from '@codex/service-errors';
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

function uniqueTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe('Journey publish/unpublish cascade (Codex-xzwl5)', () => {
  let db: Database;
  let service: CourseJourneyService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CourseJourneyService({ db, environment: 'test' });
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

  /** Create a course journey and PUBLISH it (page + subject course). */
  async function seedLiveJourney(orgId: string): Promise<{
    pageId: string;
    courseId: string;
    slug: string;
    title: string;
  }> {
    const title = uniqueTitle('Rootwork');
    const { id: pageId, slug } = await service.createJourney(orgId, creatorId, {
      title,
      pageType: 'course',
    });
    const loaded = await service.getJourneyForBuilder(orgId, pageId);
    if (!loaded?.subjectId) throw new Error('course subject missing');

    await service.saveJourneyPage(orgId, {
      id: pageId,
      title,
      slug,
      status: 'published',
      sections: [],
      brandOverrides: null,
    });

    return { pageId, courseId: loaded.subjectId, slug, title };
  }

  async function readCourse(courseId: string) {
    const [row] = await db
      .select({
        status: courses.status,
        slug: courses.slug,
        title: courses.title,
      })
      .from(courses)
      .where(eq(courses.id, courseId));
    return row;
  }

  describe('publish cascade (the behaviour the unpublish path has to mirror)', () => {
    it('publishing the page publishes the subject course and puts the journey on every public surface', async () => {
      const orgId = await makeOrg('cascade-pub');
      const { courseId, slug } = await seedLiveJourney(orgId);

      expect((await readCourse(courseId))?.status).toBe('published');
      expect(await service.getCoursePage(orgId, slug)).not.toBeNull();
      expect(await service.getCourseBySlug(orgId, slug)).not.toBeNull();
      expect(
        (await service.listPublishedJourneys(orgId)).map((j) => j.courseId)
      ).toEqual([courseId]);
      expect(
        (await service.listPublishedCourses(orgId)).map((c) => c.id)
      ).toEqual([courseId]);
    });
  });

  describe('unpublish cascade', () => {
    it('removes the journey from every public listing AND both public by-slug reads', async () => {
      const orgId = await makeOrg('cascade-unpub');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      });

      // The course row itself must come down — it is what gates the reads below.
      expect((await readCourse(courseId))?.status).toBe('draft');

      // Public by-slug reads: the sales page AND the course read.
      expect(await service.getCoursePage(orgId, slug)).toBeNull();
      expect(await service.getCourseBySlug(orgId, slug)).toBeNull();

      // Public listings: the org-landing/explore journeys rail AND the courses
      // rail that filters on `courses.status` alone (the leak).
      expect(await service.listPublishedJourneys(orgId)).toEqual([]);
      expect(await service.listPublishedCourses(orgId)).toEqual([]);
    });

    it('archiving the page archives the subject course (status is mirrored, not just cleared)', async () => {
      const orgId = await makeOrg('cascade-arch');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'archived',
        sections: [],
        brandOverrides: null,
      });

      expect((await readCourse(courseId))?.status).toBe('archived');
      expect(await service.listPublishedCourses(orgId)).toEqual([]);
      expect(await service.getCourseBySlug(orgId, slug)).toBeNull();
    });

    it('re-publishing puts it back (the cascade is not one-way)', async () => {
      const orgId = await makeOrg('cascade-re');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);

      const draft = {
        id: pageId,
        title,
        slug,
        sections: [],
        brandOverrides: null,
      };
      await service.saveJourneyPage(orgId, { ...draft, status: 'draft' });
      expect(await service.listPublishedCourses(orgId)).toEqual([]);

      await service.saveJourneyPage(orgId, { ...draft, status: 'published' });

      expect((await readCourse(courseId))?.status).toBe('published');
      expect(
        (await service.listPublishedCourses(orgId)).map((c) => c.id)
      ).toEqual([courseId]);
      expect(await service.getCoursePage(orgId, slug)).not.toBeNull();
    });

    it('keeps the course published when ANOTHER published page still sells it', async () => {
      const orgId = await makeOrg('cascade-multi');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);

      // A second published page bound to the SAME subject course. Nothing
      // enforces 1:1, so unpublishing one must not take the other's course down.
      const secondSlug = createUniqueSlug('second-door');
      const [secondPage] = await db
        .insert(landingPages)
        .values({
          organizationId: orgId,
          creatorId,
          pageType: 'course',
          slug: secondSlug,
          title: uniqueTitle('Second door'),
          status: 'published',
          publishedAt: new Date(),
          subjectType: 'course',
          subjectId: courseId,
          sections: [],
        })
        .returning({ id: landingPages.id });
      if (!secondPage) throw new Error('failed to seed the second page');

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      });

      // The course stays live because a live page still sells it…
      expect((await readCourse(courseId))?.status).toBe('published');
      // …and the journey surfaces under the SURVIVING page's slug only.
      const journeySlugs = (await service.listPublishedJourneys(orgId)).map(
        (j) => j.slug
      );
      expect(journeySlugs).toEqual([secondSlug]);
      expect(journeySlugs).not.toContain(slug);
      expect(await service.getCoursePage(orgId, slug)).toBeNull();
      expect(await service.getCoursePage(orgId, secondSlug)).not.toBeNull();

      // Unpublishing the survivor too finally takes the course down.
      await db
        .update(landingPages)
        .set({ status: 'draft' })
        .where(eq(landingPages.id, secondPage.id));
      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      });
      expect((await readCourse(courseId))?.status).toBe('draft');
    });

    it('does not touch another org course when a page is unpublished (cross-org)', async () => {
      const orgA = await makeOrg('cascade-iso-a');
      const orgB = await makeOrg('cascade-iso-b');
      const a = await seedLiveJourney(orgA);
      const b = await seedLiveJourney(orgB);

      await service.saveJourneyPage(orgA, {
        id: a.pageId,
        title: a.title,
        slug: a.slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      });

      expect((await readCourse(a.courseId))?.status).toBe('draft');
      expect((await readCourse(b.courseId))?.status).toBe('published');
      expect(
        (await service.listPublishedCourses(orgB)).map((c) => c.id)
      ).toEqual([b.courseId]);
    });
  });

  describe('slug/title sync', () => {
    it('round-trips a rename onto the subject course, so both by-slug reads follow', async () => {
      const orgId = await makeOrg('sync-rename');
      const { pageId, courseId, slug } = await seedLiveJourney(orgId);
      const nextSlug = createUniqueSlug('renamed-door');
      const nextTitle = uniqueTitle('Renamed door');

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title: nextTitle,
        slug: nextSlug,
        status: 'published',
        sections: [],
        brandOverrides: null,
      });

      const course = await readCourse(courseId);
      expect(course?.slug).toBe(nextSlug);
      expect(course?.title).toBe(nextTitle);

      // Both public by-slug reads move to the new slug and leave the old behind.
      expect(await service.getCoursePage(orgId, nextSlug)).not.toBeNull();
      expect(await service.getCoursePage(orgId, slug)).toBeNull();
      expect((await service.getCourseBySlug(orgId, nextSlug))?.id).toBe(
        courseId
      );
      expect(await service.getCourseBySlug(orgId, slug)).toBeNull();
    });

    it('makes the /explore and org-landing link derivations agree after a rename', async () => {
      const orgId = await makeOrg('sync-links');
      const { pageId, courseId } = await seedLiveJourney(orgId);
      const nextSlug = createUniqueSlug('one-true-slug');

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title: uniqueTitle('One true slug'),
        slug: nextSlug,
        status: 'published',
        sections: [],
        brandOverrides: null,
      });

      // org landing → listPublishedJourneys (links by the PAGE)
      const [journeyCard] = await service.listPublishedJourneys(orgId);
      // /explore → listPublishedCourses (used to link by the COURSE slug)
      const [courseCard] = await service.listPublishedCourses(orgId);

      expect(journeyCard?.slug).toBe(nextSlug);
      expect(courseCard?.pageSlug).toBe(nextSlug);
      expect(courseCard?.pageId).toBe(pageId);
      // The reconciled identity: both surfaces build the same /journeys/:slug.
      expect(courseCard?.pageSlug).toBe(journeyCard?.slug);
      // And the URL resolves — the by-slug read that serves it finds the course.
      expect((await service.getCourseBySlug(orgId, nextSlug))?.id).toBe(
        courseId
      );
    });

    it('rejects a rename that collides with ANOTHER course slug (409, nothing written)', async () => {
      const orgId = await makeOrg('sync-clash');
      const first = await seedLiveJourney(orgId);
      const second = await seedLiveJourney(orgId);

      await expect(
        service.saveJourneyPage(orgId, {
          id: second.pageId,
          title: second.title,
          slug: first.slug,
          status: 'published',
          sections: [],
          brandOverrides: null,
        })
      ).rejects.toBeInstanceOf(ConflictError);

      // The whole save rolled back — page AND course keep their slugs.
      const [page] = await db
        .select({ slug: landingPages.slug })
        .from(landingPages)
        .where(eq(landingPages.id, second.pageId));
      expect(page?.slug).toBe(second.slug);
      expect((await readCourse(second.courseId))?.slug).toBe(second.slug);
      expect((await readCourse(first.courseId))?.slug).toBe(first.slug);
    });

    it('allows re-saving the page under its OWN slug (the subject course is not a clash)', async () => {
      const orgId = await makeOrg('sync-self');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);

      // The course already holds this slug after the create + publish; the guard
      // must exclude the subject course or every no-op save would 409.
      await expect(
        service.saveJourneyPage(orgId, {
          id: pageId,
          title: `${title} II`,
          slug,
          status: 'published',
          sections: [],
          brandOverrides: null,
        })
      ).resolves.toBeUndefined();

      expect((await readCourse(courseId))?.title).toBe(`${title} II`);
    });
  });

  describe('listPublishedCourses sell-page identity', () => {
    it('carries the published page id + slug for the sales-page link', async () => {
      const orgId = await makeOrg('sell-id');
      const { pageId, courseId, slug } = await seedLiveJourney(orgId);

      const [card] = await service.listPublishedCourses(orgId);

      expect(card?.id).toBe(courseId);
      expect(card?.pageId).toBe(pageId);
      expect(card?.pageSlug).toBe(slug);
    });

    it('reports null page identity (and still lists) for a legacy course with no live page', async () => {
      const orgId = await makeOrg('sell-legacy');
      const { pageId, courseId } = await seedLiveJourney(orgId);

      // The pre-cascade state this bead closes at the write path: a published
      // course whose page is not published. The LEFT join must NOT filter it out
      // — the list read stays a pure read; only the link degrades.
      await db
        .update(landingPages)
        .set({ status: 'draft' })
        .where(eq(landingPages.id, pageId));

      const [card] = await service.listPublishedCourses(orgId);

      expect(card?.id).toBe(courseId);
      expect(card?.pageId).toBeNull();
      expect(card?.pageSlug).toBeNull();
    });

    it('emits ONE card per course even when two published pages sell it', async () => {
      const orgId = await makeOrg('sell-dedupe');
      const { courseId } = await seedLiveJourney(orgId);

      await db.insert(landingPages).values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: createUniqueSlug('sell-dedupe-b'),
        title: uniqueTitle('Another door'),
        status: 'published',
        publishedAt: new Date(),
        subjectType: 'course',
        subjectId: courseId,
        sections: [],
      });

      const cards = await service.listPublishedCourses(orgId);

      expect(cards).toHaveLength(1);
      expect(cards[0]?.id).toBe(courseId);
      expect(cards[0]?.pageSlug).not.toBeNull();
    });
  });
  /**
   * Codex-yo4px — the cascade above is CORRECT, and it made a latent bug
   * reachable: the same `status` predicate that (rightly) hides an unpublished
   * journey from the PUBLIC surfaces was also sitting in the two PER-USER
   * enrolled reads, so unpublishing a sales page silently emptied the library
   * shelf of everyone who had already paid.
   *
   * These cases are the counterweight to the `unpublish cascade` block above:
   * the same action must remove the journey from every PUBLIC surface and leave
   * it on the BUYER's shelf. They are written here rather than in
   * course-discovery.integration.test.ts precisely so the two halves of the
   * invariant sit side by side and a future change cannot satisfy one while
   * breaking the other.
   *
   * Severity was discoverability, not lockout — `canEnterCourse` /
   * `hasCourseEntitlement` read entitlements only and are NOT status-gated, so
   * a buyer always kept access by direct URL. What they lost was any way to
   * FIND it, silently, after paying.
   */
  describe("unpublishing must NOT empty a buyer's library (Codex-yo4px)", () => {
    /** Enrol `userId` in `courseId` as a purchaser. */
    async function enrol(userId: string, courseId: string): Promise<void> {
      await db.insert(courseEnrollments).values({
        userId,
        courseId,
        enrolledAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: null,
        source: 'course_purchase',
      });
    }

    /** Take the page (and, via the cascade, the course) out of publication. */
    async function unpublish(
      orgId: string,
      pageId: string,
      title: string,
      slug: string
    ): Promise<void> {
      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'draft',
        sections: [],
        brandOverrides: null,
      });
    }

    it('keeps an unpublished-but-owned journey on the enrolled shelf', async () => {
      const orgId = await makeOrg('yo4px-journeys');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);
      const [buyerId] = await seedTestUsers(db, 1);
      await enrol(buyerId, courseId);

      // Pre-condition: it is on the shelf while published. Without this the
      // post-condition could pass for the wrong reason (a read that returns
      // everything, or a mis-seeded enrollment).
      expect(
        (await service.listEnrolledJourneys(buyerId, orgId)).map(
          (j) => j.courseId
        )
      ).toEqual([courseId]);

      await unpublish(orgId, pageId, title, slug);

      // The cascade DID fire — this is the same action the block above asserts
      // removes the journey from every public surface.
      expect((await readCourse(courseId))?.status).toBe('draft');
      expect(await service.listPublishedJourneys(orgId)).toEqual([]);

      // ...and the buyer still has it.
      expect(
        (await service.listEnrolledJourneys(buyerId, orgId)).map(
          (j) => j.courseId
        )
      ).toEqual([courseId]);
    });

    it('keeps an unpublished-but-owned course on the enrolled-courses shelf', async () => {
      const orgId = await makeOrg('yo4px-courses');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);
      const [buyerId] = await seedTestUsers(db, 1);
      await enrol(buyerId, courseId);

      expect(
        (await service.listEnrolledCourses(buyerId, orgId)).map(
          (c) => c.course.id
        )
      ).toEqual([courseId]);

      await unpublish(orgId, pageId, title, slug);

      expect(
        (await service.listEnrolledCourses(buyerId, orgId)).map(
          (c) => c.course.id
        )
      ).toEqual([courseId]);
    });

    it('keeps it after the page is ARCHIVED, not just drafted', async () => {
      const orgId = await makeOrg('yo4px-archived');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);
      const [buyerId] = await seedTestUsers(db, 1);
      await enrol(buyerId, courseId);

      await service.saveJourneyPage(orgId, {
        id: pageId,
        title,
        slug,
        status: 'archived',
        sections: [],
        brandOverrides: null,
      });

      expect(
        (await service.listEnrolledJourneys(buyerId, orgId)).map(
          (j) => j.courseId
        )
      ).toEqual([courseId]);
      expect(
        (await service.listEnrolledCourses(buyerId, orgId)).map(
          (c) => c.course.id
        )
      ).toEqual([courseId]);
    });

    it('still shows NOTHING to a user with no enrollment, published or not', async () => {
      // The whole fix is the removal of a filter, so the negative case is what
      // proves the remaining scoping still holds. Without it, a read that
      // returned every course in the org would pass every case above.
      const orgId = await makeOrg('yo4px-stranger');
      const { pageId, courseId, slug, title } = await seedLiveJourney(orgId);
      const [strangerId] = await seedTestUsers(db, 1);

      expect(await service.listEnrolledJourneys(strangerId, orgId)).toEqual([]);
      expect(await service.listEnrolledCourses(strangerId, orgId)).toEqual([]);

      await unpublish(orgId, pageId, title, slug);

      expect(await service.listEnrolledJourneys(strangerId, orgId)).toEqual([]);
      expect(await service.listEnrolledCourses(strangerId, orgId)).toEqual([]);
      expect(courseId).toBeTruthy();
    });

    it('a soft-DELETED course still leaves the shelf — deleted is not withdrawn', async () => {
      // `deletedAt` was deliberately KEPT when the status predicate went, so
      // this pins the distinction rather than leaving it to the comment.
      const orgId = await makeOrg('yo4px-deleted');
      const { courseId } = await seedLiveJourney(orgId);
      const [buyerId] = await seedTestUsers(db, 1);
      await enrol(buyerId, courseId);

      await db
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(eq(courses.id, courseId));

      expect(await service.listEnrolledJourneys(buyerId, orgId)).toEqual([]);
      expect(await service.listEnrolledCourses(buyerId, orgId)).toEqual([]);
    });

    it('prefers the PUBLISHED page when a course has both a draft and a live one', async () => {
      // Dropping the `landingPages.status` predicate widened the dedupe from
      // ">1 published page" to ">1 page in any state", and the rows for one
      // course share `lastActivityAt`, so the ORDER BY is no tiebreak. Without
      // the explicit preference a DRAFT slug could win and the card would link
      // to a page the public cannot open.
      const orgId = await makeOrg('yo4px-pagepref');
      const { courseId, slug: liveSlug } = await seedLiveJourney(orgId);
      const [buyerId] = await seedTestUsers(db, 1);
      await enrol(buyerId, courseId);

      await db.insert(landingPages).values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: createUniqueSlug('yo4px-draft-door'),
        title: uniqueTitle('Draft door'),
        status: 'draft',
        subjectType: 'course',
        subjectId: courseId,
        sections: [],
      });

      const cards = await service.listEnrolledJourneys(buyerId, orgId);

      expect(cards).toHaveLength(1);
      expect(cards[0]?.slug).toBe(liveSlug);
    });
  });
});
