/**
 * The awaited course view says which films the streamed preview can carry
 * (Codex-61zsk.40), so the sales page draws without a film from the first
 * paint instead of folding or re-framing once the stream settles.
 *
 * REAL Neon coverage on freshly-seeded, uniquely-slugged rows:
 *   - a published course with an intro film and a hero video, no reel, reads
 *     `{ intro: true, reel: false, hero: true }` on `getCoursePage`;
 *   - with no CDN base configured every flag is false (no film can resolve);
 *   - the flags agree with `getCourseSellPreview` in the direction that
 *     matters: a `false` film is null on the stream;
 *   - the draft preview (`getCoursePagePreview`) of a DRAFT course reads all
 *     false, because the stream serves published courses only, while a
 *     published course behind a draft page reads its films.
 */

import {
  courses,
  landingPages,
  mediaItems,
  organizations,
} from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

const CDN = 'https://cdn.example.test';

describe('JourneyCourseView.filmsAttached (Codex-61zsk.40)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgId: string;
  let liveSlug: string;
  let liveCourseId: string;
  let draftSlug: string;
  let draftPageOverLiveSlug: string;

  async function seedFilm(): Promise<string> {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'video',
          status: 'ready',
          // A transcoded preview, so the stream can resolve it to a clip.
          hlsPreviewKey: `previews/${createUniqueSlug('film')}/preview.m3u8`,
          thumbnailKey: `thumbs/${createUniqueSlug('film')}/poster.webp`,
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error('failed to seed a film');
    return row.id;
  }

  async function seedCourse(
    status: 'published' | 'draft',
    films: { intro?: string; hero?: string }
  ): Promise<string> {
    const [row] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('films-course'),
        title: 'Films course',
        status,
        publishedAt: status === 'published' ? new Date() : null,
        introVideoMediaId: films.intro ?? null,
        heroMediaId: films.hero ?? null,
      })
      .returning({ id: courses.id });
    if (!row) throw new Error('failed to seed a course');
    return row.id;
  }

  async function seedPage(
    courseId: string,
    status: 'published' | 'draft'
  ): Promise<string> {
    const slug = createUniqueSlug('films-page');
    const [row] = await db
      .insert(landingPages)
      .values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug,
        title: 'Films page',
        status,
        publishedAt: status === 'published' ? new Date() : null,
        subjectType: 'course',
        subjectId: courseId,
        sections: [],
      })
      .returning({ id: landingPages.id });
    if (!row) throw new Error('failed to seed a page');
    return slug;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    const [seeded] = await seedTestUsers(db, 1);
    if (!seeded) throw new Error('failed to seed a test user');
    creatorId = seeded;

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Films org', slug: createUniqueSlug('films') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;

    const films = { intro: await seedFilm(), hero: await seedFilm() };
    liveCourseId = await seedCourse('published', films);
    liveSlug = await seedPage(liveCourseId, 'published');
    draftPageOverLiveSlug = await seedPage(
      await seedCourse('published', films),
      'draft'
    );
    draftSlug = await seedPage(await seedCourse('draft', films), 'draft');
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('reads the films a published course has attached', async () => {
    const page = await svc.getCoursePage(orgId, liveSlug, CDN);
    expect(page?.course.filmsAttached).toEqual({
      intro: true,
      reel: false,
      hero: true,
    });
  });

  it('reads no films when no CDN base is configured', async () => {
    const page = await svc.getCoursePage(orgId, liveSlug, undefined);
    expect(page?.course.filmsAttached).toEqual({
      intro: false,
      reel: false,
      hero: false,
    });
  });

  it('agrees with the stream: a film it says is absent never arrives', async () => {
    const page = await svc.getCoursePage(orgId, liveSlug, CDN);
    const stream = await svc.getCourseSellPreview(liveCourseId, CDN);
    const flags = page?.course.filmsAttached;
    expect(flags).toBeDefined();
    expect(stream).not.toBeNull();
    // `false` is certain; here every `true` also resolves, as the seeded
    // films are transcoded.
    expect(stream?.intro !== null).toBe(flags?.intro);
    expect(stream?.reel !== null).toBe(flags?.reel);
    expect(stream?.heroClip !== null).toBe(flags?.hero);
  });

  it('a draft course previews with no films, as the stream serves it none', async () => {
    const page = await svc.getCoursePagePreview(orgId, draftSlug, CDN);
    expect(page).not.toBeNull();
    expect(page?.course.filmsAttached).toEqual({
      intro: false,
      reel: false,
      hero: false,
    });
  });

  it('a published course behind a draft page previews with its films', async () => {
    const page = await svc.getCoursePagePreview(
      orgId,
      draftPageOverLiveSlug,
      CDN
    );
    expect(page?.course.filmsAttached).toEqual({
      intro: true,
      reel: false,
      hero: true,
    });
  });
});
