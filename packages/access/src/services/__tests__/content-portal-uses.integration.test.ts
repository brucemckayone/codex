/**
 * `CourseJourneyService.getContentPortalUses` integration tests
 * (Codex-a6ofh.2.5, mockup W5).
 *
 * The creator's own read of the portals a piece is a practice in, for the
 * live editor's "Also in the portal X · stage 2" line. Unlike the public
 * `getContentCourses` it counts a draft portal. Every scoping case seeds the
 * row it must leave out and asserts its absence: a deleted course or stage,
 * a course in another org, a piece that is not the asker's, and an org the
 * asker is no longer an active member of.
 */

import {
  content,
  courseStages,
  courses,
  landingPages,
  organizationMemberships,
  organizations,
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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

async function createOrg(db: Database): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Org portals', slug: createUniqueSlug('org-pu') })
    .returning({ id: organizations.id });
  if (!org) throw new Error('failed to create org');
  return org.id;
}

/** On the org's team by default: an audience role is a case of its own. */
async function joinOrg(
  db: Database,
  orgId: string,
  userId: string,
  status: 'active' | 'inactive' = 'active',
  role: 'creator' | 'subscriber' = 'creator'
): Promise<void> {
  await db
    .insert(organizationMemberships)
    .values({ organizationId: orgId, userId, status, role });
}

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string,
  overrides: { title?: string; status?: string; deletedAt?: Date | null } = {}
): Promise<string> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: createUniqueSlug('course'),
      title: overrides.title ?? 'Test Course',
      status: overrides.status ?? 'draft',
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: courses.id });
  if (!row) throw new Error('failed to create course');
  return row.id;
}

async function createStage(
  db: Database,
  courseId: string,
  sortOrder: number,
  deletedAt: Date | null = null
): Promise<string> {
  const [row] = await db
    .insert(courseStages)
    .values({ courseId, name: `Stage ${sortOrder}`, sortOrder, deletedAt })
    .returning({ id: courseStages.id });
  if (!row) throw new Error('failed to create stage');
  return row.id;
}

async function createPage(
  db: Database,
  opts: {
    orgId: string;
    creatorId: string;
    courseId: string;
    title: string;
    deletedAt?: Date | null;
    status?: 'draft' | 'published';
    createdAt?: Date;
  }
): Promise<string> {
  const [row] = await db
    .insert(landingPages)
    .values({
      organizationId: opts.orgId,
      creatorId: opts.creatorId,
      pageType: 'course',
      slug: createUniqueSlug('page'),
      title: opts.title,
      status: opts.status ?? 'draft',
      ...(opts.createdAt && { createdAt: opts.createdAt }),
      subjectType: 'course',
      subjectId: opts.courseId,
      sections: [],
      deletedAt: opts.deletedAt ?? null,
    })
    .returning({ id: landingPages.id });
  if (!row) throw new Error('failed to create landing page');
  return row.id;
}

async function createContent(
  db: Database,
  creatorId: string,
  organizationId: string | null
): Promise<string> {
  const [row] = await db
    .insert(content)
    .values(
      createTestContentInput(creatorId, {
        organizationId,
        status: 'published',
      })
    )
    .returning({ id: content.id });
  if (!row) throw new Error('failed to create content');
  return row.id;
}

async function joinPractice(
  db: Database,
  stageId: string,
  contentId: string
): Promise<void> {
  await db.insert(stagePractices).values({ stageId, contentId });
}

describe('CourseJourneyService.getContentPortalUses (Codex-a6ofh.2.5)', () => {
  let db: Database;
  let creatorId: string;
  let otherCreatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, otherCreatorId] = await seedTestUsers(db, 2);
    orgId = await createOrg(db);
    await joinOrg(db, orgId, creatorId);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  const svc = () => new CourseJourneyService({ db, environment: 'test' });

  it('lists a draft portal by its page, with the stage’s place in it', async () => {
    const courseId = await createCourse(db, orgId, creatorId, {
      title: 'Course title',
    });
    await createStage(db, courseId, 0);
    const second = await createStage(db, courseId, 1);
    const pageId = await createPage(db, {
      orgId,
      creatorId,
      courseId,
      title: 'Svelte Mastery',
    });
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, second, contentId);

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toEqual([
      { courseId, pageId, title: 'Svelte Mastery', stageNumbers: [2] },
    ]);
  });

  it('counts only the stages that are not deleted, and lists each stage it is in once', async () => {
    const courseId = await createCourse(db, orgId, creatorId);
    await createStage(db, courseId, 0, new Date());
    const first = await createStage(db, courseId, 3);
    await createStage(db, courseId, 4);
    const third = await createStage(db, courseId, 7);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, first, contentId);
    await joinPractice(db, third, contentId);

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toHaveLength(1);
    expect(result.uses[0]?.stageNumbers).toEqual([1, 3]);
  });

  it('names the course, with no page to link, when no live page presents it', async () => {
    const bare = await createCourse(db, orgId, creatorId, {
      title: 'No page',
    });
    const withDeletedPage = await createCourse(db, orgId, creatorId, {
      title: 'Page deleted',
    });
    await createPage(db, {
      orgId,
      creatorId,
      courseId: withDeletedPage,
      title: 'Gone',
      deletedAt: new Date(),
    });
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, await createStage(db, bare, 0), contentId);
    await joinPractice(
      db,
      await createStage(db, withDeletedPage, 0),
      contentId
    );

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toEqual([
      { courseId: bare, pageId: null, title: 'No page', stageNumbers: [1] },
      {
        courseId: withDeletedPage,
        pageId: null,
        title: 'Page deleted',
        stageNumbers: [1],
      },
    ]);
  });

  it('leaves out a deleted course and a deleted stage', async () => {
    const deletedCourse = await createCourse(db, orgId, creatorId, {
      deletedAt: new Date(),
    });
    const liveCourse = await createCourse(db, orgId, creatorId);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, await createStage(db, deletedCourse, 0), contentId);
    await joinPractice(
      db,
      await createStage(db, liveCourse, 0, new Date()),
      contentId
    );

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toEqual([]);
  });

  it('leaves out a course in another org', async () => {
    const otherOrg = await createOrg(db);
    // Seeded past the service's space guard, which would refuse it.
    const foreign = await createCourse(db, otherOrg, creatorId);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, await createStage(db, foreign, 0), contentId);

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toEqual([]);
  });

  it('answers nothing about a piece that is not the asker’s', async () => {
    const courseId = await createCourse(db, orgId, creatorId);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, await createStage(db, courseId, 0), contentId);

    const mine = await svc().getContentPortalUses(contentId, creatorId);
    const theirs = await svc().getContentPortalUses(contentId, otherCreatorId);

    // Really in a portal, so the empty answer is the scope's.
    expect(mine.uses).toHaveLength(1);
    expect(theirs.uses).toEqual([]);
  });

  it('answers nothing to a creator who is no longer an active member of the org', async () => {
    const leftOrg = await createOrg(db);
    await joinOrg(db, leftOrg, creatorId, 'inactive');
    const courseId = await createCourse(db, leftOrg, creatorId);
    const contentId = await createContent(db, creatorId, leftOrg);
    await joinPractice(db, await createStage(db, courseId, 0), contentId);

    const gone = await svc().getContentPortalUses(contentId, creatorId);
    await db
      .update(organizationMemberships)
      .set({ status: 'active' })
      .where(eq(organizationMemberships.organizationId, leftOrg));
    const back = await svc().getContentPortalUses(contentId, creatorId);

    expect(gone.uses).toEqual([]);
    // The same rows answer once the membership is active again.
    expect(back.uses).toHaveLength(1);
  });

  // Leaving sets the row inactive; subscribing later reactivates that same
  // row as a subscriber. Active is not on the team.
  it('answers nothing to a creator who came back as a subscriber', async () => {
    const audienceOrg = await createOrg(db);
    await joinOrg(db, audienceOrg, creatorId, 'active', 'subscriber');
    const courseId = await createCourse(db, audienceOrg, creatorId);
    const contentId = await createContent(db, creatorId, audienceOrg);
    await joinPractice(db, await createStage(db, courseId, 0), contentId);

    const audience = await svc().getContentPortalUses(contentId, creatorId);
    await db
      .update(organizationMemberships)
      .set({ role: 'creator' })
      .where(eq(organizationMemberships.organizationId, audienceOrg));
    const team = await svc().getContentPortalUses(contentId, creatorId);

    expect(audience.uses).toEqual([]);
    // The same rows answer once the role is a team one.
    expect(team.uses).toHaveLength(1);
  });

  it('names a course with two pages by its published one, else its oldest, every time', async () => {
    const publishedLater = await createCourse(db, orgId, creatorId);
    await createPage(db, {
      orgId,
      creatorId,
      courseId: publishedLater,
      title: 'Older draft',
      createdAt: new Date(Date.now() - 60_000),
    });
    const published = await createPage(db, {
      orgId,
      creatorId,
      courseId: publishedLater,
      title: 'Published copy',
      status: 'published',
    });
    const bothDrafts = await createCourse(db, orgId, creatorId);
    const oldest = await createPage(db, {
      orgId,
      creatorId,
      courseId: bothDrafts,
      title: 'Original',
      createdAt: new Date(Date.now() - 60_000),
    });
    await createPage(db, {
      orgId,
      creatorId,
      courseId: bothDrafts,
      title: 'Original (copy)',
    });
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, await createStage(db, publishedLater, 0), contentId);
    await joinPractice(db, await createStage(db, bothDrafts, 0), contentId);

    const result = await svc().getContentPortalUses(contentId, creatorId);

    const byCourse = new Map(result.uses.map((use) => [use.courseId, use]));
    expect(byCourse.get(publishedLater)).toMatchObject({
      pageId: published,
      title: 'Published copy',
      stageNumbers: [1],
    });
    expect(byCourse.get(bothDrafts)).toMatchObject({
      pageId: oldest,
      title: 'Original',
      stageNumbers: [1],
    });
  });

  it('answers nothing for a personal piece: a course always has an org', async () => {
    const courseId = await createCourse(db, orgId, creatorId);
    const contentId = await createContent(db, creatorId, null);
    await joinPractice(db, await createStage(db, courseId, 0), contentId);

    const result = await svc().getContentPortalUses(contentId, creatorId);

    expect(result.uses).toEqual([]);
  });
});
