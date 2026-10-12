/**
 * Every curriculum read hands its practices' pictures out as URLs a browser can
 * load (Codex-61zsk.52, Codex-e140e).
 *
 * REAL Neon coverage, against freshly-seeded, uniquely-slugged rows:
 *   - the PUBLIC sales read (`getCoursePage`) now carries a picture per
 *     practice, for the "What's inside" carousel: the creator's own thumbnail,
 *     else the transcode's frame resolved against the CDN base, else null;
 *   - a soft-deleted media item lends no picture, and a draft practice is not
 *     on the public page at all;
 *   - with no CDN base configured, a bare key is never handed out;
 *   - the member dashboard, the in-course player and the studio curriculum
 *     editor resolve the frame the same way. Before Codex-e140e they handed
 *     out the RAW key (`row.thumbnailUrl ?? row.mediaThumbnailKey`).
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

const BASE = 'https://cdn-assets.example.test';

describe('CourseJourneyService practice thumbnails (Codex-61zsk.52, Codex-e140e)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgId: string;
  let courseId: string;
  let pageSlug: string;
  const ids = { framed: '', custom: '', written: '', gone: '', draft: '' };
  const keys = { framed: '', gone: '', draft: '' };
  let framedSlug = '';
  let customUrl = '';

  async function seedMedia(
    deleted = false
  ): Promise<{ id: string; key: string }> {
    const input = createTestMediaItemInput(creatorId, {
      mediaType: 'video',
      status: 'ready',
      durationSeconds: 600,
      ...(deleted ? { deletedAt: new Date() } : {}),
    });
    const key = `${creatorId}/media-thumbnails/${crypto.randomUUID()}/lg.webp`;
    const [row] = await db
      .insert(mediaItems)
      .values({ ...input, thumbnailKey: key })
      .returning({ id: mediaItems.id });
    if (!row) throw new Error('failed to seed media');
    return { id: row.id, key };
  }

  async function seedPractice(
    contentType: 'video' | 'written',
    mediaItemId: string | null,
    extra: { thumbnailUrl?: string; status?: 'draft' | 'published' } = {}
  ): Promise<{ id: string; slug: string }> {
    const published = (extra.status ?? 'published') === 'published';
    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: orgId,
          contentType,
          mediaItemId,
          status: extra.status ?? 'published',
          publishedAt: published ? new Date() : null,
          thumbnailUrl: extra.thumbnailUrl ?? null,
        })
      )
      .returning({ id: content.id, slug: content.slug });
    if (!row) throw new Error(`failed to seed ${contentType} content`);
    return { id: row.id, slug: row.slug ?? '' };
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    const [seeded] = await seedTestUsers(db, 1);
    if (!seeded) throw new Error('failed to seed a test user');
    creatorId = seeded;

    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Practice thumbnail org',
        slug: createUniqueSlug('pthumb'),
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;

    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('pthumb-course'),
        title: 'Practice thumbnail course',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed to create course');
    courseId = course.id;

    pageSlug = createUniqueSlug('pthumb-page');
    const [page] = await db
      .insert(landingPages)
      .values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: pageSlug,
        title: 'Practice thumbnail page',
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

    const framedMedia = await seedMedia();
    keys.framed = framedMedia.key;
    const framed = await seedPractice('video', framedMedia.id);
    ids.framed = framed.id;
    framedSlug = framed.slug;

    customUrl = `${BASE}/${creatorId}/content-thumbnails/${crypto.randomUUID()}/lg.webp`;
    ids.custom = (
      await seedPractice('video', (await seedMedia()).id, {
        thumbnailUrl: customUrl,
      })
    ).id;
    ids.written = (await seedPractice('written', null)).id;
    const goneMedia = await seedMedia(true);
    keys.gone = goneMedia.key;
    ids.gone = (await seedPractice('video', goneMedia.id)).id;
    const draftMedia = await seedMedia();
    keys.draft = draftMedia.key;
    ids.draft = (
      await seedPractice('video', draftMedia.id, { status: 'draft' })
    ).id;

    await db.insert(stagePractices).values([
      { stageId: stage.id, contentId: ids.framed, sortOrder: 0 },
      { stageId: stage.id, contentId: ids.custom, sortOrder: 1 },
      { stageId: stage.id, contentId: ids.written, sortOrder: 2 },
      { stageId: stage.id, contentId: ids.gone, sortOrder: 3 },
      { stageId: stage.id, contentId: ids.draft, sortOrder: 4 },
    ]);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('the public sales read carries each practice’s picture: custom, else the resolved frame, else null', async () => {
    const page = await svc.getCoursePage(orgId, pageSlug, BASE);
    const practices = page?.stages[0]?.practices ?? [];
    expect(practices.map((p) => [p.contentId, p.thumbnailUrl])).toEqual([
      [ids.framed, `${BASE}/${keys.framed}`],
      [ids.custom, customUrl],
      [ids.written, null],
      // Its media item is soft-deleted: the practice stays, without a picture.
      [ids.gone, null],
      // The draft practice is not on the public page at all.
    ]);
  });

  it('the public sales read never hands out a bare key when no CDN base is configured', async () => {
    const page = await svc.getCoursePage(orgId, pageSlug);
    const urls = (page?.stages[0]?.practices ?? []).map((p) => p.thumbnailUrl);
    expect(urls).toEqual([null, customUrl, null, null]);
  });

  it('the member dashboard resolves the frame against the CDN base (Codex-e140e)', async () => {
    const dashboard = await svc.getCourseDashboard(creatorId, courseId, BASE);
    const practices = dashboard?.stages[0]?.practices ?? [];
    expect(
      practices.find((p) => p.contentId === ids.framed)?.thumbnailUrl
    ).toBe(`${BASE}/${keys.framed}`);
    expect(
      practices.find((p) => p.contentId === ids.custom)?.thumbnailUrl
    ).toBe(customUrl);
    for (const p of practices) expect(p.thumbnailUrl).not.toBe(keys.framed);
  });

  it('the in-course player resolves the frame on its practice (Codex-e140e)', async () => {
    const data = await svc.getInCoursePractice(
      creatorId,
      courseId,
      framedSlug,
      BASE
    );
    expect(data?.practice.thumbnailUrl).toBe(`${BASE}/${keys.framed}`);
  });

  it('the studio curriculum editor resolves the frame, drafts included (Codex-e140e)', async () => {
    const curriculum = await svc.getCourseCurriculumForEditor(
      orgId,
      courseId,
      BASE
    );
    const byId = new Map(
      (curriculum.stages[0]?.practices ?? []).map((p) => [
        p.contentId,
        p.thumbnailUrl,
      ])
    );
    expect(byId.get(ids.framed)).toBe(`${BASE}/${keys.framed}`);
    expect(byId.get(ids.custom)).toBe(customUrl);
    expect(byId.get(ids.written)).toBeNull();
    expect(byId.get(ids.draft)).toBe(`${BASE}/${keys.draft}`);
  });
});
