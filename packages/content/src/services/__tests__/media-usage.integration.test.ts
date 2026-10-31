/**
 * Media in use (Codex-6sbn1, Codex-vmi6m), against a real Postgres: locks,
 * jsonb and the foreign keys can't be faked.
 *
 * - the lookup, one case per source and state, and who sees what named;
 * - the library's counts, in one statement per page;
 * - the delete guard (MEDIA_IN_USE, MEDIA_USAGE_CHANGED) and the 30 days;
 * - the race, both orders, on the content attach path;
 * - publish refusing a deleted item, and PATCH checking what it attaches;
 * - the daily purge and support's restore.
 *
 * DB-backed. Every row it writes is its own and is deleted in afterAll.
 */

import type { R2Service } from '@codex/cloudflare-clients';
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
import { getHlsPrefix } from '@codex/transcoding';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ContentTypeMismatchError,
  MediaDeletedError,
  MediaInUseError,
  MediaNotFoundError,
  MediaNotReadyError,
  MediaUsageChangedError,
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

  describe('the purge and restore', () => {
    function stubR2(
      files: Record<string, string[]>,
      failing = new Set<string>()
    ) {
      const deleted: string[][] = [];
      const listed: string[] = [];
      const r2 = {
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
          listed.push(prefix);
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
      const { r2, deleted, listed } = stubR2({
        [`${ownerId}/originals/${due}/`]: [
          `${ownerId}/originals/${due}/media.mp4`,
        ],
        [hls]: [`${hls}master.m3u8`, `${hls}1080p/segment_001.ts`],
      });
      const svc = new MediaItemService({ db, environment: 'test', r2 });

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect(listed).toEqual(
        expect.arrayContaining([
          `${ownerId}/originals/${due}/`,
          hls,
          `${ownerId}/thumbnails/${due}/`,
          `${ownerId}/waveforms/${due}/`,
        ])
      );
      expect(deleted).toContainEqual([
        `${hls}master.m3u8`,
        `${hls}1080p/segment_001.ts`,
      ]);
      expect(report.purged).toBeGreaterThanOrEqual(1);
      expect((await mediaRow(due))?.filesPurgedAt).toBeInstanceOf(Date);

      // A second run lists nothing of it.
      const again = stubR2({});
      await new MediaItemService({
        db,
        environment: 'test',
        r2: again.r2,
      }).purgeDueFiles({
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
      const svc = new MediaItemService({ db, environment: 'test', r2 });
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
    });

    it('gives the claim back on a failure, due again in a day', async () => {
      const failing = await seedDeleted();
      const { r2 } = stubR2({}, new Set([getHlsPrefix(ownerId, failing)]));
      const svc = new MediaItemService({ db, environment: 'test', r2 });

      const report = await svc.purgeDueFiles({ deadline: Date.now() + 60_000 });

      expect(report.failed).toBeGreaterThanOrEqual(1);
      const row = await mediaRow(failing);
      expect(row?.filesPurgedAt).toBeNull();
      const inADay = (row?.filesPurgeAfter?.getTime() ?? 0) - Date.now();
      expect(inADay).toBeGreaterThan(DAY_MS - 60_000);
      expect(inADay).toBeLessThanOrEqual(DAY_MS);
    });

    it('claims nothing once the deadline has passed', async () => {
      const due = await seedDeleted();
      const { r2, listed } = stubR2({});
      await new MediaItemService({ db, environment: 'test', r2 }).purgeDueFiles(
        {
          deadline: Date.now() - 1,
        }
      );
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

    it('refuses a restore once the files are gone, or of an item not deleted', async () => {
      const claimed = await seedDeleted({ filesPurgedAt: new Date() });
      const legacy = await seedDeleted({ filesPurgeAfter: null });
      const live = await seedMedia(ownerId);

      for (const [id, reason] of [
        [claimed, 'FILES_GONE'],
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
