/**
 * The course page's sell-media write as an ATTACH path of the media delete
 * guard (Codex-6sbn1).
 *
 * - An attach that starts while a media delete holds the row FOR UPDATE waits
 *   on its locking read, finds the item deleted and refuses, writing nothing.
 *   A plain read would pass, and the foreign key check (FOR KEY SHARE) would
 *   wait and then succeed on the soft-deleted row.
 * - A stored item deleted since (a delete goes ahead when only drafts use
 *   it) never blocks a save of the other slots: only a CHANGED id is checked.
 * - Publishing the page refuses to take the course live on a deleted slot
 *   item (the move into published only), under a locking read that a delete
 *   holding the row makes wait.
 *
 * DB-backed; every row it writes is its own and is deleted in afterAll.
 */

import {
  courses,
  landingPages,
  mediaItems,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import { ForbiddenError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseMediaDeletedError } from '../../errors';
import { CourseJourneyService } from '../course-journey-service';

/**
 * Wait until some backend is blocked BY `holder` (a probe, not a timer), or
 * `work` settles first. A wait for a pool connection is not a lock wait, so
 * only this proves the work reached the lock.
 */
async function untilBlockedBy(
  db: Database,
  holder: number,
  work: Promise<unknown>
): Promise<'waiting' | 'finished' | 'neither after 10 s'> {
  let settled = false;
  work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  for (let i = 0; i < 400; i++) {
    const blocked = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE ${holder} = ANY(pg_blocking_pids(pid))`);
    if (settled) return 'finished';
    if (Number((blocked.rows[0] as { n: number }).n) > 0) return 'waiting';
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return 'neither after 10 s';
}

function mediaBag(
  overrides: Partial<{
    introVideoMediaId: string | null;
    previewVideoMediaId: string | null;
    guideVideoMediaId: string | null;
    guidePortraitMediaId: string | null;
    heroMediaId: string | null;
    signatureMediaId: string | null;
  }> = {}
) {
  return {
    introVideoMediaId: null,
    previewVideoMediaId: null,
    guideVideoMediaId: null,
    guidePortraitMediaId: null,
    heroMediaId: null,
    signatureMediaId: null,
    ...overrides,
  };
}

describe('CourseJourneyService.updateJourneySellMedia as an attach path', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgId: string;
  let courseId: string;
  let pageId: string;
  const mediaIds: string[] = [];

  async function seedMedia(): Promise<string> {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(createTestMediaItemInput(creatorId, { status: 'ready' }))
        .returning({ id: mediaItems.id })
    );
    mediaIds.push(row.id);
    return row.id;
  }

  async function readCourse() {
    const [row] = await db
      .select({
        introVideoMediaId: courses.introVideoMediaId,
        heroMediaId: courses.heroMediaId,
        guide: courses.guide,
      })
      .from(courses)
      .where(eq(courses.id, courseId));
    return row;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Attach org', slug: createUniqueSlug('attach') })
        .returning({ id: organizations.id })
    ).id;
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });
    courseId = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('attach-course'),
          title: 'Attach course',
          status: 'draft',
        })
        .returning({ id: courses.id })
    ).id;
    pageId = takeFirst(
      await db
        .insert(landingPages)
        .values({
          organizationId: orgId,
          creatorId,
          pageType: 'course',
          slug: createUniqueSlug('attach-page'),
          title: 'Attach page',
          subjectType: 'course',
          subjectId: courseId,
          sections: [],
        })
        .returning({ id: landingPages.id })
    ).id;
  });

  afterAll(async () => {
    if (db) {
      await db
        .delete(landingPages)
        .where(eq(landingPages.organizationId, orgId));
      await db.delete(courses).where(eq(courses.organizationId, orgId));
      await db
        .delete(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
      if (mediaIds.length > 0) {
        await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
      }
    }
    await teardownTestDatabase();
  });

  it('an attach that starts while a delete holds the row waits on its locking read, then refuses and writes nothing', async () => {
    const film = await seedMedia();
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = (_pid: number) => {};
    const held = new Promise<number>((resolve) => {
      holding = resolve;
    });

    // MediaItemService.delete's shape: the row FOR UPDATE, then soft-deleted.
    const deleting = db.transaction(async (tx) => {
      await tx
        .select({ id: mediaItems.id })
        .from(mediaItems)
        .where(eq(mediaItems.id, film))
        .for('update');
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      holding(Number((pid.rows[0] as { pid: number }).pid));
      await released;
      await tx
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, film));
    });
    const deleter = await held;

    const attaching = svc.updateJourneySellMedia(
      orgId,
      pageId,
      mediaBag({ introVideoMediaId: film })
    );
    const early = await untilBlockedBy(db, deleter, attaching);
    release();
    await deleting;

    expect(early).toBe('waiting');
    await expect(attaching).rejects.toBeInstanceOf(ForbiddenError);
    expect((await readCourse())?.introVideoMediaId).toBeNull();
  });

  it('saves the other slots while a stored item deleted since is sent back unchanged', async () => {
    const hero = await seedMedia();
    const portrait = await seedMedia();
    const intro = await seedMedia();
    await svc.updateJourneySellMedia(
      orgId,
      pageId,
      mediaBag({ heroMediaId: hero, guidePortraitMediaId: portrait })
    );
    await db
      .update(mediaItems)
      .set({ deletedAt: new Date() })
      .where(inArray(mediaItems.id, [hero, portrait]));

    const saved = await svc.updateJourneySellMedia(
      orgId,
      pageId,
      mediaBag({
        heroMediaId: hero,
        guidePortraitMediaId: portrait,
        introVideoMediaId: intro,
      })
    );

    expect(saved).toMatchObject({
      heroMediaId: hero,
      guidePortraitMediaId: portrait,
      introVideoMediaId: intro,
    });
    // A deleted item is still refused where it would be NEWLY attached.
    await expect(
      svc.updateJourneySellMedia(
        orgId,
        pageId,
        mediaBag({ introVideoMediaId: hero })
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe('the publish cascade', () => {
    async function seedJourney() {
      const title = `Cascade ${crypto.randomUUID().slice(0, 8)}`;
      const { id, slug } = await svc.createJourney(orgId, creatorId, {
        title,
        pageType: 'course',
      });
      const loaded = await svc.getJourneyForBuilder(orgId, id);
      if (!loaded?.subjectId) throw new Error('course subject missing');
      return { pageId: id, courseId: loaded.subjectId, slug, title };
    }

    function save(
      journey: { pageId: string; slug: string; title: string },
      status: 'draft' | 'published'
    ) {
      return svc.saveJourneyPage(orgId, {
        id: journey.pageId,
        title: journey.title,
        slug: journey.slug,
        status,
        sections: [],
        brandOverrides: null,
      });
    }

    async function statusOf(journey: { pageId: string; courseId: string }) {
      const [course] = await db
        .select({ status: courses.status })
        .from(courses)
        .where(eq(courses.id, journey.courseId));
      const [page] = await db
        .select({ status: landingPages.status })
        .from(landingPages)
        .where(eq(landingPages.id, journey.pageId));
      return { course: course?.status, page: page?.status };
    }

    it('refuses to take a course live on a deleted slot item, naming the slots, and writes nothing', async () => {
      const journey = await seedJourney();
      const intro = await seedMedia();
      const hero = await seedMedia();
      const reel = await seedMedia();
      await svc.updateJourneySellMedia(
        orgId,
        journey.pageId,
        mediaBag({
          introVideoMediaId: intro,
          heroMediaId: hero,
          previewVideoMediaId: reel,
        })
      );
      await db
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(inArray(mediaItems.id, [intro, hero]));

      const refusal = await save(journey, 'published').catch(
        (error: unknown) => error
      );

      expect(refusal).toBeInstanceOf(CourseMediaDeletedError);
      expect((refusal as CourseMediaDeletedError).context).toEqual({
        code: 'MEDIA_DELETED',
        slots: ['intro', 'hero'],
      });
      expect(await statusOf(journey)).toEqual({
        course: 'draft',
        page: 'draft',
      });
    });

    it('never refuses an autosave of a page that is already live', async () => {
      const journey = await seedJourney();
      const hero = await seedMedia();
      await svc.updateJourneySellMedia(
        orgId,
        journey.pageId,
        mediaBag({ heroMediaId: hero })
      );
      await save(journey, 'published');
      // As an item deleted before the guard existed left it.
      await db
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, hero));

      await expect(save(journey, 'published')).resolves.toBeDefined();
      expect((await statusOf(journey)).course).toBe('published');
    });

    it('a publish that starts while a media delete holds a slot item waits on its locking read, then refuses', async () => {
      const journey = await seedJourney();
      const hero = await seedMedia();
      await svc.updateJourneySellMedia(
        orgId,
        journey.pageId,
        mediaBag({ heroMediaId: hero })
      );
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });
      const deleting = db.transaction(async (tx) => {
        await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(eq(mediaItems.id, hero))
          .for('update');
        const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        holding(Number((pid.rows[0] as { pid: number }).pid));
        await released;
        await tx
          .update(mediaItems)
          .set({ deletedAt: new Date() })
          .where(eq(mediaItems.id, hero));
      });
      const deleter = await held;

      const publishing = save(journey, 'published');
      const early = await untilBlockedBy(db, deleter, publishing);
      release();
      await deleting;

      expect(early).toBe('waiting');
      await expect(publishing).rejects.toBeInstanceOf(CourseMediaDeletedError);
      expect((await statusOf(journey)).course).toBe('draft');
    });
  });
});
