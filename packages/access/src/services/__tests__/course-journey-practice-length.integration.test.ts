/**
 * `CourseJourneyService.getCoursePage` carries each practice's LENGTH on the
 * public curriculum (Codex-61zsk.46): the sales page's curriculum says
 * what a visitor is signing up to, "Video · 13 min".
 *
 * REAL Neon coverage. Every assertion is UNCONDITIONAL against freshly-seeded,
 * uniquely-slugged rows:
 *   - a video and an audio practice carry their media item's `durationSeconds`;
 *   - a written practice (no media item) carries null;
 *   - a practice whose media item is SOFT-DELETED still shows, with null — the
 *     deleted row lends no length, and the left join never drops the practice.
 */

import {
  content,
  courseStages,
  courses,
  landingPages,
  mediaItems,
  organizations,
  stagePractices,
} from '@codex/database/schema';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

describe('CourseJourneyService.getCoursePage practice lengths (Codex-61zsk.46)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgId: string;
  let pageSlug: string;
  const ids: Record<'video' | 'audio' | 'written' | 'gone', string> = {
    video: '',
    audio: '',
    written: '',
    gone: '',
  };

  async function seedMedia(
    mediaType: 'video' | 'audio',
    durationSeconds: number,
    deleted = false
  ): Promise<string> {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType,
          status: 'ready',
          durationSeconds,
          ...(deleted ? { deletedAt: new Date() } : {}),
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error(`failed to seed ${mediaType} media`);
    return row.id;
  }

  async function seedPractice(
    contentType: 'video' | 'audio' | 'written',
    mediaItemId: string | null
  ): Promise<string> {
    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: orgId,
          contentType,
          mediaItemId,
          status: 'published',
          publishedAt: new Date(),
        })
      )
      .returning({ id: content.id });
    if (!row) throw new Error(`failed to seed ${contentType} content`);
    return row.id;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    const [seeded] = await seedTestUsers(db, 1);
    if (!seeded) throw new Error('failed to seed a test user');
    creatorId = seeded;

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Practice length org', slug: createUniqueSlug('plen') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;

    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('plen-course'),
        title: 'Practice length course',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed to create course');

    pageSlug = createUniqueSlug('plen-page');
    const [page] = await db
      .insert(landingPages)
      .values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: pageSlug,
        title: 'Practice length page',
        status: 'published',
        publishedAt: new Date(),
        subjectType: 'course',
        subjectId: course.id,
        sections: [],
      })
      .returning({ id: landingPages.id });
    if (!page) throw new Error('failed to create page');

    const [stage] = await db
      .insert(courseStages)
      .values({ courseId: course.id, name: 'The near ones', sortOrder: 0 })
      .returning({ id: courseStages.id });
    if (!stage) throw new Error('failed to create stage');

    ids.video = await seedPractice('video', await seedMedia('video', 754));
    ids.audio = await seedPractice('audio', await seedMedia('audio', 1080));
    ids.written = await seedPractice('written', null);
    ids.gone = await seedPractice('video', await seedMedia('video', 300, true));
    await db.insert(stagePractices).values([
      { stageId: stage.id, contentId: ids.video, sortOrder: 0 },
      { stageId: stage.id, contentId: ids.audio, sortOrder: 1 },
      { stageId: stage.id, contentId: ids.written, sortOrder: 2 },
      { stageId: stage.id, contentId: ids.gone, sortOrder: 3 },
    ]);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('carries each practice’s media length, null where there is none to carry', async () => {
    const page = await svc.getCoursePage(orgId, pageSlug);
    expect(page).not.toBeNull();
    const practices = page?.stages[0]?.practices ?? [];
    expect(
      practices.map((p) => [p.contentId, p.contentType, p.durationSeconds])
    ).toEqual([
      [ids.video, 'video', 754],
      [ids.audio, 'audio', 1080],
      [ids.written, 'written', null],
      // Its media item is soft-deleted: the practice stays, without a length.
      [ids.gone, 'video', null],
    ]);
  });
});
