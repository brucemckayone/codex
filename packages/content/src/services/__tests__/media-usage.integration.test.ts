/**
 * Media in use (Codex-6sbn1, Codex-vmi6m), against a real Postgres: locks,
 * jsonb and the foreign keys can't be faked.
 *
 * - the lookup, one case per source and state, and who sees what named;
 * - the library's counts, in one statement per page;
 * - the delete guard (MEDIA_IN_USE, MEDIA_USAGE_CHANGED) and the 30 days;
 * - the race, both orders, on the content attach path;
 * - publish refusing a deleted item, and PATCH checking what it attaches;
 * - the daily purge (both buckets: the posters are in ASSETS_BUCKET) and
 *   support's restore;
 * - content whose thumbnail is the item's frame, as a use (Codex-9seq3).
 *
 * DB-backed. Every row it writes is its own and is deleted in afterAll.
 */

import type { CdnPurgeResult, R2Service } from '@codex/cloudflare-clients';
import {
  brandingSettings,
  content,
  courses,
  courseTestimonials,
  landingPages,
  mediaItems,
  organizationMemberships,
  organizations,
  platformSettings,
} from '@codex/database/schema';
import { ConflictError } from '@codex/service-errors';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getHlsPrefix, getMediaThumbnailPrefix } from '@codex/transcoding';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ContentTypeMismatchError,
  MediaDeletedError,
  MediaInUseError,
  MediaNotFoundError,
  MediaNotReadyError,
  MediaUsageChangedError,
  ThumbnailMediaDeletedError,
} from '../../errors';
import { ContentService } from '../content-service';
import { MediaItemService } from '../media-service';
import {
  readMediaUses,
  type SqlExecutor,
  summariseMediaUsage,
} from '../media-usage';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('media in use (Codex-6sbn1)', () => {
  let db: Database;
  let media: MediaItemService;
  let contents: ContentService;

  /** The media owner: owner of org A, a plain creator in org B. */
  let ownerId: string;
  /** Another creator: owner of org B. */
  let otherId: string;
  /** An admin of org B. */
  let adminBId: string;

  let orgAId: string;
  let orgASlug: string;
  let orgBId: string;
  let deletedOrgId: string;
  const orgIds: string[] = [];
  const mediaIds: string[] = [];

  async function seedMedia(
    creatorId: string,
    overrides: Partial<typeof mediaItems.$inferInsert> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, { status: 'ready', ...overrides })
        )
        .returning({ id: mediaItems.id })
    );
    mediaIds.push(row.id);
    return row.id;
  }

  async function seedContent(
    creatorId: string,
    overrides: Partial<typeof content.$inferInsert>
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(content)
        .values(createTestContentInput(creatorId, overrides))
        .returning({ id: content.id })
    ).id;
  }

  async function seedCourse(
    organizationId: string,
    creatorId: string,
    overrides: Partial<typeof courses.$inferInsert>,
    opts: { page?: boolean } = {}
  ): Promise<{ courseId: string; pageId: string | null }> {
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId,
          creatorId,
          slug: createUniqueSlug('mu-course'),
          title: 'A course',
          status: 'draft',
          ...overrides,
        })
        .returning({ id: courses.id })
    );
    if (opts.page === false) return { courseId: course.id, pageId: null };
    const page = takeFirst(
      await db
        .insert(landingPages)
        .values({
          organizationId,
          creatorId,
          pageType: 'course',
          slug: createUniqueSlug('mu-page'),
          title: 'A course page',
          subjectType: 'course',
          subjectId: course.id,
          sections: [],
        })
        .returning({ id: landingPages.id })
    );
    return { courseId: course.id, pageId: page.id };
  }

  async function seedOrg(label: string, deleted = false) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: `Media use ${label}`,
          slug: createUniqueSlug(`mu-${label}`),
          ...(deleted ? { deletedAt: new Date() } : {}),
        })
        .returning({ id: organizations.id, slug: organizations.slug })
    );
    orgIds.push(org.id);
    return org;
  }

  async function setIntro(organizationId: string, mediaItemId: string | null) {
    await db
      .insert(platformSettings)
      .values({ organizationId })
      .onConflictDoNothing();
    await db
      .insert(brandingSettings)
      .values({ organizationId, introVideoMediaItemId: mediaItemId })
      .onConflictDoUpdate({
        target: brandingSettings.organizationId,
        set: { introVideoMediaItemId: mediaItemId },
      });
  }

  async function mediaRow(id: string) {
    const [row] = await db
      .select({
        deletedAt: mediaItems.deletedAt,
        filesPurgeAfter: mediaItems.filesPurgeAfter,
        filesPurgeStartedAt: mediaItems.filesPurgeStartedAt,
        filesPurgedAt: mediaItems.filesPurgedAt,
      })
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    return row;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    media = new MediaItemService({ db, environment: 'test' });
    contents = new ContentService({ db, environment: 'test' });
    [ownerId, otherId, adminBId] = await seedTestUsers(db, 3);

    const orgA = await seedOrg('a');
    const orgB = await seedOrg('b');
    const gone = await seedOrg('gone', true);
    orgAId = orgA.id;
    orgASlug = orgA.slug;
    orgBId = orgB.id;
    deletedOrgId = gone.id;
    await db.insert(organizationMemberships).values([
      {
        organizationId: orgAId,
        userId: ownerId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: orgBId,
        userId: ownerId,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: orgBId,
        userId: otherId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: orgBId,
        userId: adminBId,
        role: 'admin',
        status: 'active',
      },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(content).where(inArray(content.organizationId, orgIds));
      await db
        .delete(content)
        .where(inArray(content.creatorId, [ownerId, otherId]));
      await db
        .delete(landingPages)
        .where(inArray(landingPages.organizationId, orgIds));
      await db.delete(courses).where(inArray(courses.organizationId, orgIds));
      await db
        .delete(brandingSettings)
        .where(inArray(brandingSettings.organizationId, orgIds));
      await db
        .delete(platformSettings)
        .where(inArray(platformSettings.organizationId, orgIds));
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
      if (mediaIds.length > 0) {
        await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
      }
    }
    await teardownTestDatabase();
  });

  describe('the lookup', () => {
    let filmId: string;
    let introCoursePageId: string | null;

    beforeAll(async () => {
      filmId = await seedMedia(ownerId);
      const otherFilm = await seedMedia(ownerId);
      const now = new Date();

      // Content: published, released then unpublished, draft, deleted, and
      // a draft of another creator's in an org the owner only creates in.
      await seedContent(ownerId, {
        organizationId: orgAId,
        mediaItemId: filmId,
        title: 'B published',
        status: 'published',
        publishedAt: now,
      });
      await seedContent(ownerId, {
        organizationId: orgAId,
        mediaItemId: filmId,
        title: 'A bought',
        status: 'draft',
        publishedAt: now,
      });
      await seedContent(ownerId, {
        organizationId: orgAId,
        mediaItemId: filmId,
        title: 'My draft',
      });
      await seedContent(ownerId, {
        mediaItemId: filmId,
        title: 'Deleted',
        deletedAt: now,
      });
      await seedContent(otherId, {
        organizationId: orgBId,
        mediaItemId: filmId,
        title: 'Their hidden draft',
      });

      // Courses: published (two slots, one the jsonb portrait), a draft in
      // org B, deleted, in a deleted org, a malformed portrait, and the two
      // ignored references.
      introCoursePageId = (
        await seedCourse(orgAId, ownerId, {
          title: 'Published course',
          status: 'published',
          publishedAt: now,
          introVideoMediaId: filmId,
          guide: { name: 'Guide', portraitMediaId: filmId },
        })
      ).pageId;
      await seedCourse(orgBId, otherId, {
        title: 'Their draft course',
        previewVideoMediaId: filmId,
      });
      await seedCourse(orgAId, ownerId, {
        title: 'Deleted course',
        status: 'published',
        heroMediaId: filmId,
        deletedAt: now,
      });
      await seedCourse(deletedOrgId, ownerId, {
        title: 'Course of a deleted org',
        status: 'published',
        heroMediaId: filmId,
      });
      await seedCourse(orgAId, ownerId, {
        title: 'Malformed portrait',
        guide: { name: 'Guide', portraitMediaId: 'not-a-uuid' },
        signatureMediaId: filmId,
      });
      const { courseId } = await seedCourse(
        orgAId,
        ownerId,
        { title: 'Testimonial', previewVideoMediaId: otherFilm },
        { page: false }
      );
      await db.insert(courseTestimonials).values({
        courseId,
        quote: 'Great',
        authorName: 'A student',
        avatarMediaId: filmId,
      });

      // Org intros: org A (live, always), and a deleted org's (absent).
      await setIntro(orgAId, filmId);
      await setIntro(deletedOrgId, filmId);
    });

    it('counts every live and draft use, and names what the owner can see', async () => {
      const usage = await media.getUsage(filmId, ownerId);

      expect(usage).toMatchObject({ total: 8, live: 5, drafts: 3, hidden: 2 });
      expect(
        usage.uses.map((use) => [use.slot, use.title, use.liveReason, use.link])
      ).toEqual([
        [
          'media',
          'A bought',
          'bought',
          expect.objectContaining({ to: 'content' }),
        ],
        [
          'media',
          'B published',
          'published',
          expect.objectContaining({ to: 'content' }),
        ],
        [
          'guide_portrait',
          'Published course',
          'published',
          { to: 'journey', pageId: introCoursePageId, orgSlug: orgASlug },
        ],
        [
          'intro',
          'Published course',
          'published',
          { to: 'journey', pageId: introCoursePageId, orgSlug: orgASlug },
        ],
        [
          'org_intro',
          expect.stringContaining('Media use a'),
          'always',
          { to: 'brand', orgSlug: orgASlug },
        ],
        [
          'media',
          'My draft',
          null,
          expect.objectContaining({ to: 'content', orgSlug: orgASlug }),
        ],
      ]);
      expect(JSON.stringify(usage)).not.toContain('hidden draft');
      expect(JSON.stringify(usage)).not.toContain('Their draft course');
    });

    it("names a draft to its org's admin, but links it only to who can change it", async () => {
      const usage = await summariseMediaUsage(
        await readMediaUses(db, [filmId], adminBId),
        adminBId
      );
      const named = usage.uses.filter((use) => !use.live);
      expect(named.map((use) => [use.title, use.link?.to ?? null])).toEqual([
        ['Their hidden draft', null],
        ['Their draft course', 'journey'],
      ]);
    });

    it('gives the library one count per item, from one statement for the page', async () => {
      let statements = 0;
      const counting = new Proxy(db, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          if (prop === 'execute') {
            return (...args: Parameters<typeof target.execute>) => {
              statements++;
              return target.execute(...args);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const unused = await seedMedia(ownerId, { title: 'Unused' });
      const listing = await new MediaItemService({
        db: counting,
        environment: 'test',
      }).list(ownerId, {}, { page: 1, limit: 100 });

      const byId = new Map(listing.items.map((item) => [item.id, item.usage]));
      expect(byId.get(filmId)).toEqual({ total: 8, live: 5 });
      expect(byId.get(unused)).toEqual({ total: 0, live: 0 });
      expect(statements).toBe(1);
    });

    // "Use the video's frame" saves the poster's URL as the thumbnail, and
    // the purge deletes the posters (Codex-9seq3).
    it("counts content whose thumbnail is the item's frame, once, and a live one blocks the delete", async () => {
      const poster = await seedMedia(ownerId);
      const playing = await seedMedia(ownerId);
      const cdn = 'https://cdn-assets.example';
      const frame = (folder: string) =>
        `${cdn}/${ownerId}/media-thumbnails/${poster}/${folder}lg.webp`;
      const now = new Date();
      await seedContent(ownerId, {
        organizationId: orgAId,
        mediaItemId: playing,
        title: 'Swapped film',
        status: 'published',
        publishedAt: now,
        thumbnailUrl: frame('1920x1080-0a1b2c3d/'),
      });
      // The flat poster layout, on a draft with no media yet.
      await seedContent(ownerId, {
        title: 'Flat frame',
        thumbnailUrl: frame(''),
      });
      // Its own item's frame: that is already its `media` use.
      await seedContent(ownerId, {
        mediaItemId: poster,
        title: 'Own frame',
        thumbnailUrl: frame('1920x1080-0a1b2c3d/'),
      });
      // Not uses: deleted content, and an uploaded thumbnail.
      await seedContent(ownerId, {
        mediaItemId: playing,
        title: 'Deleted',
        thumbnailUrl: frame(''),
        deletedAt: now,
      });
      await seedContent(ownerId, {
        title: 'Uploaded',
        thumbnailUrl: `${cdn}/${ownerId}/content-thumbnails/c1/1920x1080-0a1b2c3d/lg.webp`,
      });
      // Nor another creator's published film holding the poster's URL (any
      // CDN URL passes the thumbnail check): it would make the owner's video
      // undeletable. Nor a URL naming the id under another creator's folder,
      // which isn't the folder the purge deletes.
      await seedContent(otherId, {
        organizationId: orgBId,
        title: 'Their film, my frame',
        status: 'published',
        publishedAt: now,
        thumbnailUrl: frame(''),
      });
      await seedContent(ownerId, {
        title: 'Wrong folder',
        thumbnailUrl: `${cdn}/${otherId}/media-thumbnails/${poster}/lg.webp`,
      });

      const usage = await media.getUsage(poster, ownerId);

      expect(usage).toMatchObject({ total: 3, live: 1, drafts: 2 });
      expect(
        usage.uses.map((use) => [use.slot, use.title, use.live, use.link?.to])
      ).toEqual([
        ['thumbnail', 'Swapped film', true, 'content'],
        ['thumbnail', 'Flat frame', false, 'content'],
        ['media', 'Own frame', false, 'content'],
      ]);
      await expect(
        media.delete(poster, ownerId, usage.fingerprint)
      ).rejects.toBeInstanceOf(MediaInUseError);
    });
  });

  describe('the delete guard', () => {
    it('refuses MEDIA_IN_USE while anything live uses it, with two counts', async () => {
      const film = await seedMedia(ownerId);
      await seedContent(ownerId, {
        mediaItemId: film,
        status: 'published',
        publishedAt: new Date(),
      });
      await seedContent(ownerId, { mediaItemId: film });
      const { fingerprint } = await media.getUsage(film, ownerId);

      const refusal = await media
        .delete(film, ownerId, fingerprint)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(MediaInUseError);
      expect((refusal as MediaInUseError).context).toEqual({
        live: 1,
        drafts: 1,
      });
      expect((await mediaRow(film))?.deletedAt).toBeNull();
    });

    it('deletes past drafts with the fingerprint, keeps their link and the files 30 days', async () => {
      const film = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, { mediaItemId: film });

      for (const sent of [undefined, 'stale-fingerprint']) {
        const refusal = await media
          .delete(film, ownerId, sent)
          .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(MediaUsageChangedError);
        expect((refusal as MediaUsageChangedError).context).toEqual({
          live: 0,
          drafts: 1,
        });
      }

      const { fingerprint } = await media.getUsage(film, ownerId);
      expect(await media.delete(film, ownerId, fingerprint)).toEqual({
        drafts: 1,
      });

      const row = await mediaRow(film);
      expect(row?.filesPurgedAt).toBeNull();
      expect(
        (row?.filesPurgeAfter?.getTime() ?? 0) -
          (row?.deletedAt?.getTime() ?? 0)
      ).toBe(30 * DAY_MS);
      const [kept] = await db
        .select({ mediaItemId: content.mediaItemId })
        .from(content)
        .where(eq(content.id, draft));
      expect(kept?.mediaItemId).toBe(film);
    });

    it('refuses MEDIA_USAGE_CHANGED when a draft started using it after the read', async () => {
      const film = await seedMedia(ownerId);
      const { fingerprint } = await media.getUsage(film, ownerId);
      await seedContent(ownerId, { mediaItemId: film });

      await expect(
        media.delete(film, ownerId, fingerprint)
      ).rejects.toBeInstanceOf(MediaUsageChangedError);
    });
  });

  describe('the race (content attach path)', () => {
    /** The backend id of the connection running `tx`. */
    async function backendPid(tx: SqlExecutor): Promise<number> {
      const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      return Number((result.rows[0] as { pid: number }).pid);
    }

    /**
     * Wait until some backend is blocked BY `holder` (a probe, not a timer),
     * or `work` settles first. A wait for a pool connection is not a lock
     * wait, so only this proves the work reached the lock.
     */
    async function untilBlockedBy(
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

    it('an attach that starts while a delete holds the row waits on its locking read, then refuses', async () => {
      const film = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, { mediaItemId: null });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });

      // The delete's shape: the row locked FOR UPDATE, then soft-deleted.
      const deleting = db.transaction(async (tx) => {
        await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(eq(mediaItems.id, film))
          .for('update');
        holding(await backendPid(tx));
        await released;
        await tx
          .update(mediaItems)
          .set({ deletedAt: new Date() })
          .where(eq(mediaItems.id, film));
      });
      const deleter = await held;

      const attaching = contents.update(draft, { mediaItemId: film }, ownerId);
      const early = await untilBlockedBy(deleter, attaching);
      release();
      await deleting;

      expect(early).toBe('waiting');
      // With a plain read the check passes on the row as it was, the
      // foreign key's FOR KEY SHARE waits instead, and the attach lands on
      // the deleted item once the delete commits.
      await expect(attaching).rejects.toBeInstanceOf(MediaNotFoundError);
      const [row] = await db
        .select({ mediaItemId: content.mediaItemId })
        .from(content)
        .where(eq(content.id, draft));
      expect(row?.mediaItemId).toBeNull();
    });

    it('a delete that starts while an attach is open waits on its lock, then refuses MEDIA_IN_USE', async () => {
      const film = await seedMedia(ownerId);
      const published = await seedContent(ownerId, {
        status: 'published',
        publishedAt: new Date(),
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });

      // An attach's shape: the locking read, then the write, still open.
      const attaching = db.transaction(async (tx) => {
        await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(eq(mediaItems.id, film))
          .for('key share');
        await tx
          .update(content)
          .set({ mediaItemId: film })
          .where(eq(content.id, published));
        holding(await backendPid(tx));
        await released;
      });
      const attacher = await held;

      const deleting = media.delete(film, ownerId);
      const early = await untilBlockedBy(attacher, deleting);
      release();
      await attaching;

      expect(early).toBe('waiting');
      // Without FOR UPDATE the delete's read doesn't wait: it sees no use,
      // and its UPDATE (FOR NO KEY UPDATE) never conflicts with the attach.
      await expect(deleting).rejects.toBeInstanceOf(MediaInUseError);
      expect((await mediaRow(film))?.deletedAt).toBeNull();
    });

    // Codex-tqvmx. Publish's shape: the frame's video locked FOR KEY SHARE, then the row
    // written live, still open. The delete's FOR UPDATE waits; once publish
    // commits, the usage lookup finds a live use of the frame, and refuses.
    it('a delete that starts while a publish holds the frame waits, then refuses MEDIA_IN_USE', async () => {
      const playing = await seedMedia(ownerId);
      const frame = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, {
        mediaItemId: playing,
        thumbnailUrl: `https://cdn-assets.example/${getMediaThumbnailPrefix(ownerId, frame)}lg.webp`,
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });

      const publishing = db.transaction(async (tx) => {
        await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(eq(mediaItems.id, frame))
          .for('key share');
        await tx
          .update(content)
          .set({ status: 'published', publishedAt: new Date() })
          .where(eq(content.id, draft));
        holding(await backendPid(tx));
        await released;
      });
      const publisher = await held;

      const deleting = media.delete(frame, ownerId);
      const early = await untilBlockedBy(publisher, deleting);
      release();
      await publishing;

      expect(early).toBe('waiting');
      await expect(deleting).rejects.toBeInstanceOf(MediaInUseError);
      expect((await mediaRow(frame))?.deletedAt).toBeNull();
    });

    // Publish locks its row before it reads the media, as update() does. An
    // unlocked read let a PATCH that swapped the media in between make the
    // publish go live on the new item, checked only as a draft attach.
    it('a publish that starts while a save holds the row waits for it, then checks the media the save left', async () => {
      const film = await seedMedia(ownerId);
      const deleted = await seedMedia(ownerId, { deletedAt: new Date() });
      const draft = await seedContent(ownerId, { mediaItemId: film });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });

      // A save's shape: the row locked by its write, still open.
      const saving = db.transaction(async (tx) => {
        await tx
          .update(content)
          .set({ mediaItemId: deleted })
          .where(eq(content.id, draft));
        holding(await backendPid(tx));
        await released;
      });
      const saver = await held;

      const publishing = contents.publish(draft, ownerId);
      const early = await untilBlockedBy(saver, publishing);
      release();
      await saving;

      expect(early).toBe('waiting');
      await expect(publishing).rejects.toBeInstanceOf(MediaDeletedError);
      const [row] = await db
        .select({ status: content.status })
        .from(content)
        .where(eq(content.id, draft));
      expect(row?.status).toBe('draft');
    });
  });

  describe('publish and PATCH (Codex-vmi6m)', () => {
    it('refuses to publish a draft whose media was deleted', async () => {
      const film = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, { mediaItemId: film });
      await db
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, film));

      const refusal = await contents
        .publish(draft, ownerId)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(MediaDeletedError);
      expect((refusal as MediaDeletedError).context).toEqual({
        contentId: draft,
        code: 'MEDIA_DELETED',
      });
    });

    // Codex-vmi6m: a row that took another creator's item through the old
    // PATCH hole keeps it (an unchanged id isn't re-checked), but must not go
    // live streaming their file.
    it("refuses to publish a row already holding another creator's media", async () => {
      const theirs = await seedMedia(otherId);
      const draft = await seedContent(ownerId, { mediaItemId: theirs });

      await expect(contents.publish(draft, ownerId)).rejects.toBeInstanceOf(
        MediaNotFoundError
      );
      const [row] = await db
        .select({ status: content.status })
        .from(content)
        .where(eq(content.id, draft));
      expect(row?.status).toBe('draft');
    });

    it("refuses to attach another creator's media, or a deleted one, and writes nothing", async () => {
      const theirs = await seedMedia(otherId);
      const deleted = await seedMedia(ownerId, { deletedAt: new Date() });
      const draft = await seedContent(ownerId, { mediaItemId: null });

      for (const mediaItemId of [theirs, deleted]) {
        await expect(
          contents.update(draft, { mediaItemId, title: 'Renamed' }, ownerId)
        ).rejects.toBeInstanceOf(MediaNotFoundError);
      }
      const [row] = await db
        .select({ mediaItemId: content.mediaItemId, title: content.title })
        .from(content)
        .where(eq(content.id, draft));
      expect(row?.mediaItemId).toBeNull();
      expect(row?.title).not.toBe('Renamed');
    });

    it('checks the type, and readiness once the content is live', async () => {
      const audio = await seedMedia(ownerId, { mediaType: 'audio' });
      const processing = await seedMedia(ownerId, { status: 'transcoding' });
      const draft = await seedContent(ownerId, { mediaItemId: null });
      const live = await seedContent(ownerId, {
        status: 'published',
        publishedAt: new Date(),
      });

      await expect(
        contents.update(draft, { mediaItemId: audio }, ownerId)
      ).rejects.toBeInstanceOf(ContentTypeMismatchError);
      await expect(
        contents.update(live, { mediaItemId: processing }, ownerId)
      ).rejects.toBeInstanceOf(MediaNotReadyError);
      // Released and taken off sale: its buyers still watch it, so it is
      // live as the usage lookup counts it, and needs a playable item too.
      const bought = await seedContent(ownerId, {
        status: 'draft',
        publishedAt: new Date(),
      });
      await expect(
        contents.update(bought, { mediaItemId: processing }, ownerId)
      ).rejects.toBeInstanceOf(MediaNotReadyError);
      const saved = await contents.update(
        draft,
        { mediaItemId: processing },
        ownerId
      );
      expect(saved.mediaItemId).toBe(processing);
    });

    it('still saves a draft that sends back its deleted media unchanged', async () => {
      const film = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, { mediaItemId: film });
      await db
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, film));

      const saved = await contents.update(
        draft,
        { title: 'Still mine', mediaItemId: film },
        ownerId
      );
      expect(saved.title).toBe('Still mine');
      expect(saved.mediaItemId).toBe(film);
    });
  });

  describe("a thumbnail that is a deleted video's frame (Codex-tqvmx)", () => {
    const cdn = 'https://cdn-assets.example';
    const frameOf = (creatorId: string, mediaId: string) =>
      `${cdn}/${getMediaThumbnailPrefix(creatorId, mediaId)}1920x1080-0a1b2c3d/lg.webp`;

    async function markDeleted(id: string) {
      await db
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, id));
    }

    it('refuses to publish it, for any content type', async () => {
      const playing = await seedMedia(ownerId);
      const gone = await seedMedia(ownerId);
      await markDeleted(gone);
      const film = await seedContent(ownerId, {
        mediaItemId: playing,
        thumbnailUrl: frameOf(ownerId, gone),
      });
      const essay = await seedContent(ownerId, {
        contentType: 'written',
        thumbnailUrl: frameOf(ownerId, gone),
      });

      for (const id of [film, essay]) {
        const refusal = await contents
          .publish(id, ownerId)
          .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ThumbnailMediaDeletedError);
        expect((refusal as ThumbnailMediaDeletedError).context).toEqual({
          contentId: id,
          code: 'THUMBNAIL_MEDIA_DELETED',
        });
      }
    });

    it('publishes a frame of a video still in the library, of the one it plays, or of another creator', async () => {
      const playing = await seedMedia(ownerId);
      const kept = await seedMedia(ownerId);
      // Another creator's poster URL isn't this check's (Codex-p0uuc).
      const theirs = await seedMedia(otherId);
      await markDeleted(theirs);
      for (const thumbnailUrl of [
        frameOf(ownerId, kept),
        frameOf(ownerId, playing),
        frameOf(otherId, theirs),
        // Their video's id under this creator's folder: not this creator's.
        frameOf(ownerId, theirs),
      ]) {
        const id = await seedContent(ownerId, {
          mediaItemId: playing,
          thumbnailUrl,
        });
        expect((await contents.publish(id, ownerId)).status).toBe('published');
      }
    });

    it('refuses a save that gives live content such a frame; a draft can save it', async () => {
      const editor = new ContentService({
        db,
        environment: 'test',
        r2PublicUrlBase: cdn,
      });
      const playing = await seedMedia(ownerId);
      const gone = await seedMedia(ownerId);
      await markDeleted(gone);
      const live = await seedContent(ownerId, {
        mediaItemId: playing,
        status: 'published',
        publishedAt: new Date(),
      });
      const draft = await seedContent(ownerId, { mediaItemId: playing });
      const thumbnailOf = async (id: string) =>
        (
          await db
            .select({ thumbnailUrl: content.thumbnailUrl })
            .from(content)
            .where(eq(content.id, id))
        )[0]?.thumbnailUrl;

      const refusal = await editor
        .update(live, { thumbnailUrl: frameOf(ownerId, gone) }, ownerId)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ThumbnailMediaDeletedError);
      expect(await thumbnailOf(live)).toBeNull();

      await editor.update(
        draft,
        { thumbnailUrl: frameOf(ownerId, gone) },
        ownerId
      );
      expect(await thumbnailOf(draft)).toBe(frameOf(ownerId, gone));
    });

    it('the studio read names the other video the thumbnail is a frame of', async () => {
      const playing = await seedMedia(ownerId);
      const gone = await seedMedia(ownerId, { title: 'First cut' });
      await markDeleted(gone);
      const draft = await seedContent(ownerId, {
        mediaItemId: playing,
        thumbnailUrl: frameOf(ownerId, gone),
      });

      const read = await contents.get(draft, ownerId);
      expect(read?.thumbnailFrame).toMatchObject({
        mediaItemId: gone,
        title: 'First cut',
      });
      expect(read?.thumbnailFrame?.deletedAt).toBeInstanceOf(Date);

      // Its own video's frame, another creator's video's id under this
      // creator's folder (whose title it must not read), or no thumbnail:
      // none.
      const theirs = await seedMedia(otherId, { title: 'Their cut' });
      await markDeleted(theirs);
      for (const thumbnailUrl of [
        frameOf(ownerId, playing),
        frameOf(ownerId, theirs),
        null,
      ]) {
        const id = await seedContent(ownerId, {
          mediaItemId: playing,
          thumbnailUrl,
        });
        expect((await contents.get(id, ownerId))?.thumbnailFrame).toBeNull();
      }
    });
  });

  describe('the purge and restore', () => {
    function stubR2(
      files: Record<string, string[]>,
      failing = new Set<string>(),
      onList: (prefix: string) => Promise<void> = async () => {}
    ) {
      const deleted: string[][] = [];
      const listed: string[] = [];
      const r2 = {
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
          listed.push(prefix);
          await onList(prefix);
          if (failing.has(prefix)) throw new Error('R2 is down');
          return {
            objects: (files[prefix] ?? []).map((key) => ({ key })),
            truncated: false,
          };
        }),
        delete: vi.fn(async (keys: string[]) => {
          deleted.push(keys);
        }),
      };
      return { r2: r2 as unknown as R2Service, deleted, listed };
    }

    /** The edge-cache purge's stand-in: records each request's prefixes. */
    function stubEdge(result: CdnPurgeResult = { ok: true }) {
      const requests: string[][] = [];
      return {
        requests,
        purgePrefixes: vi.fn(async (prefixes: readonly string[]) => {
          requests.push([...prefixes]);
          return result;
        }),
      };
    }

    /**
     * The purge, over a media bucket and the posters' (ASSETS_BUCKET), and the
     * edge cache in front of the posters' CDN.
     */
    function purger(
      r2: R2Service,
      assets: R2Service = stubR2({}).r2,
      edge: ReturnType<typeof stubEdge> = stubEdge()
    ) {
      return new MediaItemService({
        db,
        environment: 'test',
        r2,
        assets,
        cdnPurger: edge,
        assetsPublicUrlBase: 'https://cdn-assets.example/',
      });
    }

    async function seedDeleted(
      overrides: Partial<typeof mediaItems.$inferInsert> = {}
    ): Promise<string> {
      return seedMedia(ownerId, {
        deletedAt: new Date(Date.now() - 31 * DAY_MS),
        filesPurgeAfter: new Date(Date.now() - DAY_MS),
        ...overrides,
      });
    }

    it('removes a due item’s files, prefix by prefix in batches, and claims it once', async () => {
      const due = await seedDeleted();
      const hls = getHlsPrefix(ownerId, due);
      const posters = getMediaThumbnailPrefix(ownerId, due);
      const { r2, deleted, listed } = stubR2({
        [`${ownerId}/originals/${due}/`]: [
          `${ownerId}/originals/${due}/media.mp4`,
        ],
        [hls]: [`${hls}master.m3u8`, `${hls}1080p/segment_001.ts`],
      });
      const assets = stubR2({
        [posters]: [
          `${posters}sm.webp`,
          `${posters}2160x3840-7ae9d61f/sm.webp`,
          `${posters}2160x3840-7ae9d61f/xl.webp`,
        ],
      });
      const edge = stubEdge();
      const svc = purger(r2, assets.r2, edge);

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      const mine = (prefixes: string[]) =>
        prefixes.filter((prefix) => prefix.includes(due));
      expect(mine(listed)).toEqual([
        `${ownerId}/originals/${due}/`,
        hls,
        `${ownerId}/waveforms/${due}/`,
      ]);
      expect(deleted).toContainEqual([
        `${hls}master.m3u8`,
        `${hls}1080p/segment_001.ts`,
      ]);
      // Its posters are in the public bucket, both layouts (Codex-9seq3).
      expect(mine(assets.listed)).toEqual([posters]);
      expect(assets.deleted).toContainEqual([
        `${posters}sm.webp`,
        `${posters}2160x3840-7ae9d61f/sm.webp`,
        `${posters}2160x3840-7ae9d61f/xl.webp`,
      ]);
      expect(report.purged).toBeGreaterThanOrEqual(1);
      // Then off the edge: one request for the run, no scheme, both layouts.
      expect(edge.requests).toHaveLength(1);
      expect(edge.requests[0]).toContain(
        `cdn-assets.example/${ownerId}/media-thumbnails/${due}`
      );
      const row = await mediaRow(due);
      expect(row?.filesPurgeStartedAt).toBeInstanceOf(Date);
      expect(row?.filesPurgedAt).toBeInstanceOf(Date);

      // A second run lists nothing of it.
      const again = stubR2({});
      await purger(again.r2).purgeDueFiles({
        deadline: Date.now() + 60_000,
      });
      expect(again.listed.some((prefix) => prefix.includes(due))).toBe(false);
    });

    it('never touches an item something live uses, nor one deleted before files were kept, nor a restored one', async () => {
      const inUse = await seedDeleted();
      await seedContent(ownerId, {
        mediaItemId: inUse,
        status: 'published',
        publishedAt: new Date(),
      });
      const legacy = await seedDeleted({ filesPurgeAfter: null });
      const restored = await seedDeleted({ deletedAt: null });
      const { r2, listed } = stubR2({});
      const svc = purger(r2);
      // `obs` is protected: reached through a structural cast.
      const { obs } = svc as unknown as {
        obs: { error: (event: string, data: unknown) => void };
      };
      const errors = vi.spyOn(obs, 'error');

      await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      for (const id of [inUse, legacy, restored]) {
        expect(listed.some((prefix) => prefix.includes(id))).toBe(false);
        expect((await mediaRow(id))?.filesPurgedAt).toBeNull();
      }
      expect(errors).toHaveBeenCalledWith('media.files_purge_skipped_in_use', {
        mediaItemId: inUse,
        live: 1,
      });
      // Moved a week down the queue, so it doesn't hold the head of it.
      const inAWeek =
        ((await mediaRow(inUse))?.filesPurgeAfter?.getTime() ?? 0) - Date.now();
      expect(inAWeek).toBeGreaterThan(7 * DAY_MS - 60_000);
    });

    it('never touches an item whose frame a live film shows as its thumbnail (Codex-9seq3)', async () => {
      const shown = await seedDeleted();
      await seedContent(ownerId, {
        mediaItemId: await seedMedia(ownerId),
        status: 'published',
        publishedAt: new Date(),
        thumbnailUrl: `https://cdn-assets.example/${getMediaThumbnailPrefix(ownerId, shown)}1920x1080-0a1b2c3d/lg.webp`,
      });
      const mediaBucket = stubR2({});
      const assets = stubR2({});
      const svc = purger(mediaBucket.r2, assets.r2);
      const { obs } = svc as unknown as {
        obs: { error: (event: string, data: unknown) => void };
      };
      const errors = vi.spyOn(obs, 'error');

      await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      // Reached and skipped, not merely left out of the run's 25.
      expect(errors).toHaveBeenCalledWith('media.files_purge_skipped_in_use', {
        mediaItemId: shown,
        live: 1,
      });
      for (const listed of [mediaBucket.listed, assets.listed]) {
        expect(listed.some((prefix) => prefix.includes(shown))).toBe(false);
      }
      expect(await mediaRow(shown)).toMatchObject({
        filesPurgeStartedAt: null,
        filesPurgedAt: null,
      });
    });

    it('keeps an item purged when the edge purge fails, or is not configured, and says so', async () => {
      const failing = await seedDeleted();
      const svc = purger(
        stubR2({}).r2,
        stubR2({}).r2,
        stubEdge({ ok: false, reason: 'HTTP 403' })
      );
      const { obs } = svc as unknown as {
        obs: {
          error: (event: string, data: unknown) => void;
          warn: (event: string, data: unknown) => void;
        };
      };
      const errors = vi.spyOn(obs, 'error');

      await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect((await mediaRow(failing))?.filesPurgedAt).toBeInstanceOf(Date);
      expect(errors).toHaveBeenCalledWith(
        'media.files_edge_purge_skipped',
        expect.objectContaining({ reason: 'HTTP 403' })
      );

      // No purger at all (local, or the token not yet set): logged, at warn
      // outside production, and the item is still purged.
      const unconfigured = await seedDeleted();
      const bare = new MediaItemService({
        db,
        environment: 'test',
        r2: stubR2({}).r2,
        assets: stubR2({}).r2,
      });
      const warns = vi.spyOn(
        (bare as unknown as { obs: typeof obs }).obs,
        'warn'
      );

      await bare.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect((await mediaRow(unconfigured))?.filesPurgedAt).toBeInstanceOf(
        Date
      );
      expect(warns).toHaveBeenCalledWith(
        'media.files_edge_purge_skipped',
        expect.objectContaining({ reason: 'no CDN purge configured' })
      );
    });

    it('removes nothing without the posters’ bucket: no claim, and the item stays due', async () => {
      const due = await seedDeleted();
      const { r2, listed } = stubR2({});
      const svc = new MediaItemService({ db, environment: 'test', r2 });
      const { obs } = svc as unknown as {
        obs: { error: (event: string, data: unknown) => void };
      };
      const errors = vi.spyOn(obs, 'error');

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect(errors).toHaveBeenCalledWith('media.files_purge_unavailable', {
        reason: 'no assets bucket',
      });
      expect(report).toMatchObject({ due: 0, purged: 0 });
      expect(listed).toEqual([]);
      expect(await mediaRow(due)).toMatchObject({
        filesPurgeStartedAt: null,
        filesPurgedAt: null,
      });
      // Leave nothing due for a later run.
      await db
        .update(mediaItems)
        .set({ filesPurgedAt: new Date() })
        .where(eq(mediaItems.id, due));
    });

    it('does not stall behind 25 items something live uses: the 26th is purged on the next run', async () => {
      const longAgo = Date.now() - 400 * DAY_MS;
      const stuck: string[] = [];
      for (let i = 0; i < 25; i++) {
        const id = await seedDeleted({
          filesPurgeAfter: new Date(longAgo + i * 1000),
        });
        await seedContent(ownerId, {
          mediaItemId: id,
          status: 'published',
          publishedAt: new Date(),
        });
        stuck.push(id);
      }
      const twentySixth = await seedDeleted({
        filesPurgeAfter: new Date(longAgo + 60_000),
      });
      const svc = () => purger(stubR2({}).r2);

      const first = await svc().purgeDueFiles({
        deadline: Date.now() + 60_000,
      });
      expect(first.skippedInUse).toBe(25);
      expect((await mediaRow(twentySixth))?.filesPurgedAt).toBeNull();

      await svc().purgeDueFiles({ deadline: Date.now() + 60_000 });
      expect((await mediaRow(twentySixth))?.filesPurgedAt).toBeInstanceOf(Date);
      for (const id of stuck) {
        expect((await mediaRow(id))?.filesPurgeStartedAt).toBeNull();
      }
    });

    it('gives the claim back when no file was deleted: the item is whole, and restorable', async () => {
      const whole = await seedDeleted();
      const { r2 } = stubR2(
        {},
        new Set([`${ownerId}/originals/${whole}/`]) // the first prefix
      );
      const svc = purger(r2);

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect(report.failed).toBeGreaterThanOrEqual(1);
      const row = await mediaRow(whole);
      expect(row?.filesPurgeStartedAt).toBeNull();
      expect(row?.filesPurgedAt).toBeNull();
      const inADay = (row?.filesPurgeAfter?.getTime() ?? 0) - Date.now();
      expect(inADay).toBeGreaterThan(DAY_MS - 60_000);
      expect(inADay).toBeLessThanOrEqual(DAY_MS);
      expect((await media.restore(whole)).deletedAt).toBeNull();
    });

    // A failure after a delete was sent leaves the item half removed (its
    // original gone, say). Giving the claim back would let support "restore"
    // it as ready with files missing, and the film would be broken; so it
    // keeps the claim, restore refuses it, and a later run finishes it.
    it('keeps the claim on an item half removed, refuses its restore, and finishes it later', async () => {
      const half = await seedDeleted();
      const original = `${ownerId}/originals/${half}/media.mp4`;
      const { r2, deleted } = stubR2(
        { [`${ownerId}/originals/${half}/`]: [original] },
        new Set([getHlsPrefix(ownerId, half)])
      );
      const svc = purger(r2);

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect(report.failed).toBeGreaterThanOrEqual(1);
      expect(deleted).toContainEqual([original]);
      const row = await mediaRow(half);
      const claimedAt = row?.filesPurgeStartedAt;
      expect(claimedAt).toBeInstanceOf(Date);
      expect(row?.filesPurgedAt).toBeNull();
      const inADay = (row?.filesPurgeAfter?.getTime() ?? 0) - Date.now();
      expect(inADay).toBeGreaterThan(DAY_MS - 60_000);
      const refusal = await media
        .restore(half)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ConflictError);

      // A day on, R2 healthy: the next run finishes it.
      await db
        .update(mediaItems)
        .set({ filesPurgeAfter: new Date(Date.now() - 1000) })
        .where(eq(mediaItems.id, half));
      await purger(stubR2({}).r2).purgeDueFiles({
        deadline: Date.now() + 60_000,
      });
      const finished = await mediaRow(half);
      expect(finished?.filesPurgedAt).toBeInstanceOf(Date);
      expect(finished?.filesPurgeStartedAt).toEqual(claimedAt);
    });

    it('does not claim an item restored and deleted again while the run was going', async () => {
      const first = await seedDeleted({
        filesPurgeAfter: new Date(Date.now() - 300 * DAY_MS),
      });
      const again = await seedDeleted({
        filesPurgeAfter: new Date(Date.now() - 299 * DAY_MS),
      });
      // Support restores `again` and the creator deletes it once more while
      // the run is on `first`: a new delete, with its own 30 days.
      const { r2, listed } = stubR2({}, new Set(), async (prefix) => {
        if (!prefix.includes(first)) return;
        await db
          .update(mediaItems)
          .set({
            deletedAt: new Date(),
            filesPurgeAfter: new Date(Date.now() + 30 * DAY_MS),
          })
          .where(eq(mediaItems.id, again));
      });

      await purger(r2).purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect((await mediaRow(first))?.filesPurgedAt).toBeInstanceOf(Date);
      expect(listed.some((prefix) => prefix.includes(again))).toBe(false);
      expect(await mediaRow(again)).toMatchObject({
        filesPurgeStartedAt: null,
        filesPurgedAt: null,
      });
    });

    it('claims nothing once the deadline has passed', async () => {
      const due = await seedDeleted();
      const { r2, listed } = stubR2({});
      await purger(r2).purgeDueFiles({
        deadline: Date.now() - 1,
      });
      expect(listed).toEqual([]);
      expect((await mediaRow(due))?.filesPurgedAt).toBeNull();
      // Leave nothing due for a later run.
      await db
        .update(mediaItems)
        .set({ filesPurgedAt: new Date() })
        .where(eq(mediaItems.id, due));
    });

    it('restores inside the window, and heals the draft that kept its link', async () => {
      const film = await seedMedia(ownerId);
      const draft = await seedContent(ownerId, { mediaItemId: film });
      const { fingerprint } = await media.getUsage(film, ownerId);
      await media.delete(film, ownerId, fingerprint);

      const restored = await media.restore(film);

      expect(restored.id).toBe(film);
      expect(restored.deletedAt).toBeNull();
      expect(await mediaRow(film)).toMatchObject({
        deletedAt: null,
        filesPurgeAfter: null,
      });
      const got = await contents.get(draft, ownerId);
      expect(got?.mediaItem?.id).toBe(film);
      expect(got?.mediaItem?.deletedAt).toBeNull();
    });

    it('refuses a restore once the purge has started or finished, or of an item not deleted', async () => {
      const started = await seedDeleted({ filesPurgeStartedAt: new Date() });
      const purged = await seedDeleted({
        filesPurgeStartedAt: new Date(),
        filesPurgedAt: new Date(),
      });
      const legacy = await seedDeleted({ filesPurgeAfter: null });
      const live = await seedMedia(ownerId);

      for (const [id, reason] of [
        [started, 'FILES_GONE'],
        [purged, 'FILES_GONE'],
        [legacy, 'FILES_GONE'],
        [live, 'NOT_DELETED'],
      ] as const) {
        const refusal = await media
          .restore(id)
          .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ConflictError);
        expect((refusal as ConflictError).context).toEqual({
          mediaItemId: id,
          reason,
        });
      }
      await expect(media.restore(crypto.randomUUID())).rejects.toBeInstanceOf(
        MediaNotFoundError
      );
    });
  });
});
