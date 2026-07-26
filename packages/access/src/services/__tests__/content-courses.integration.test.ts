/**
 * `CourseJourneyService.getContentCourses` integration tests
 * (Codex-2pryk.3.10 · standalone content viewer · F19/F20).
 *
 * REAL Neon coverage for the PUBLIC "which published course(s) contain this
 * content" cross-link read. Every assertion is UNCONDITIONAL and every scoping
 * case seeds a real foreign/hidden row and asserts its ABSENCE, so the test
 * fails if the walk (`stage_practices → course_stages → courses`) or the
 * published/non-deleted scoping regresses. Data is scoped to freshly-created,
 * unique ids per test so a shared branch needs no inter-test cleanup.
 */

import {
  content,
  courseStages,
  courses,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string,
  overrides: {
    title?: string;
    slug?: string;
    status?: string;
    deletedAt?: Date | null;
  } = {}
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: overrides.slug ?? createUniqueSlug('course'),
      title: overrides.title ?? 'Test Course',
      status: overrides.status ?? 'published',
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: courses.id, slug: courses.slug });
  if (!row) throw new Error('failed to create course');
  return row;
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

/** Create a standalone `content` row (a practice not yet joined to any stage). */
async function createContent(
  db: Database,
  creatorId: string,
  organizationId: string
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

/** Join an existing content row to a stage as a practice. */
async function joinPractice(
  db: Database,
  stageId: string,
  contentId: string,
  sortOrder = 0
): Promise<void> {
  await db.insert(stagePractices).values({ stageId, contentId, sortOrder });
}

describe('CourseJourneyService.getContentCourses (Codex-2pryk.3.10)', () => {
  let db: Database;
  let creatorId: string;
  let orgId: string;
  let orgSlug: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);

    orgSlug = createUniqueSlug('org-cc');
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Org CC', slug: orgSlug })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  const svc = () => new CourseJourneyService({ db, environment: 'test' });

  it('returns the published course (id, slug, title, organizationSlug) a content item belongs to', async () => {
    const course = await createCourse(db, orgId, creatorId, {
      title: 'Rootwork',
    });
    const stage = await createStage(db, course.id, 0);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, stage, contentId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toEqual([
      {
        id: course.id,
        slug: course.slug,
        title: 'Rootwork',
        organizationSlug: orgSlug,
      },
    ]);
  });

  it('returns an empty list for content that belongs to no course', async () => {
    const contentId = await createContent(db, creatorId, orgId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toEqual([]);
  });

  it('excludes a DRAFT course', async () => {
    const draft = await createCourse(db, orgId, creatorId, { status: 'draft' });
    const stage = await createStage(db, draft.id, 0);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, stage, contentId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toEqual([]);
  });

  it('excludes a soft-deleted course', async () => {
    const deleted = await createCourse(db, orgId, creatorId, {
      deletedAt: new Date(),
    });
    const stage = await createStage(db, deleted.id, 0);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, stage, contentId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toEqual([]);
  });

  it('excludes a practice reached only through a soft-deleted stage', async () => {
    const course = await createCourse(db, orgId, creatorId);
    const deletedStage = await createStage(db, course.id, 0, new Date());
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, deletedStage, contentId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toEqual([]);
  });

  it('dedupes a content item that sits in multiple stages of the same course', async () => {
    const course = await createCourse(db, orgId, creatorId);
    const stageA = await createStage(db, course.id, 0);
    const stageB = await createStage(db, course.id, 1);
    const contentId = await createContent(db, creatorId, orgId);
    await joinPractice(db, stageA, contentId, 0);
    await joinPractice(db, stageB, contentId, 1);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]?.id).toBe(course.id);
  });

  it('returns every published course a shared content item belongs to (title-ordered)', async () => {
    const alpha = await createCourse(db, orgId, creatorId, { title: 'Alpha' });
    const beta = await createCourse(db, orgId, creatorId, { title: 'Beta' });
    const stageAlpha = await createStage(db, alpha.id, 0);
    const stageBeta = await createStage(db, beta.id, 0);
    const contentId = await createContent(db, creatorId, orgId);
    // Join Beta first to prove ordering is by title, not insertion order.
    await joinPractice(db, stageBeta, contentId);
    await joinPractice(db, stageAlpha, contentId);

    const result = await svc().getContentCourses(contentId);

    expect(result.courses.map((c) => c.title)).toEqual(['Alpha', 'Beta']);
  });
});
