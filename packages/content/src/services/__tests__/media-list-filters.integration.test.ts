/**
 * The media library list's filters (Codex-a6ofh.1.4, data-design §1.1),
 * against a real database: search, the status groups, the usage filter and
 * the new sorts, each inside the creator's own scope, with the total counting
 * exactly the rows the filter keeps.
 *
 * Each test seeds a creator of its own, so their library is exactly what the
 * test put in it and every total can be asserted whole.
 *
 * The usage filter must agree with the library chip: it is the chip's own
 * reference set (`usesQuery`) fed every id the creator owns. So the usage
 * test seeds one use through EVERY blocking column of
 * `MEDIA_REFERENCE_COLUMNS`, and fails when a new one is added without a case
 * here.
 */

import { MEDIA_UPLOAD_STALLED_AFTER_MS } from '@codex/constants';
import {
  brandingSettings,
  content,
  courses,
  mediaItems,
  organizationMemberships,
  organizations,
  platformSettings,
} from '@codex/database/schema';
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
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItemFilters } from '../../types';
import { MediaItemService } from '../media-service';
import { listUsedMediaIds, MEDIA_REFERENCE_COLUMNS } from '../media-usage';

type NewMedia = Partial<typeof mediaItems.$inferInsert>;

describe('media library list filters (Codex-a6ofh.1.4)', () => {
  let db: Database;
  let media: MediaItemService;
  const userIds: string[] = [];
  const orgIds: string[] = [];

  async function newCreator(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    if (!id) throw new Error('failed to seed a creator');
    userIds.push(id);
    return id;
  }

  async function seedMedia(creatorId: string, overrides: NewMedia = {}) {
    return takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, { status: 'ready', ...overrides })
        )
        .returning({ id: mediaItems.id })
    ).id;
  }

  async function seedOrg(ownerId: string): Promise<string> {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Media list org',
          slug: createUniqueSlug('ml-org'),
        })
        .returning({ id: organizations.id })
    );
    orgIds.push(org.id);
    await db.insert(organizationMemberships).values({
      organizationId: org.id,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
    return org.id;
  }

  /** The ids `list` returns for these filters, and its total. */
  async function listed(
    creatorId: string,
    filters: MediaItemFilters,
    limit = 100
  ): Promise<{ ids: string[]; total: number }> {
    const page = await media.list(creatorId, filters, { page: 1, limit });
    return {
      ids: page.items.map((item) => item.id),
      total: page.pagination.total,
    };
  }

  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    db = setupTestDatabase();
    media = new MediaItemService({ db, environment: 'test' });
  });

  afterAll(async () => {
    if (db && userIds.length > 0) {
      await db.delete(content).where(inArray(content.creatorId, userIds));
      await db.delete(courses).where(inArray(courses.creatorId, userIds));
      if (orgIds.length > 0) {
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
      }
      await db.delete(mediaItems).where(inArray(mediaItems.creatorId, userIds));
    }
    await teardownTestDatabase();
  });

  describe('search', () => {
    it('matches the title or the description, ignoring case, and treats % _ and \\ as themselves', async () => {
      const creatorId = await newCreator();
      const percent = await seedMedia(creatorId, { title: 'Spring 50% sale' });
      await seedMedia(creatorId, { title: 'Spring 500 sale' });
      const underscore = await seedMedia(creatorId, {
        title: 'snake_case notes',
      });
      await seedMedia(creatorId, { title: 'snakeXcase notes' });
      const backslash = await seedMedia(creatorId, { title: 'back\\slash' });
      await seedMedia(creatorId, { title: 'backslash' });
      const described = await seedMedia(creatorId, {
        title: 'Take 3',
        description: 'The INTERVIEW with Priya',
      });

      expect((await listed(creatorId, { search: '50%' })).ids).toEqual([
        percent,
      ]);
      expect((await listed(creatorId, { search: 'e_c' })).ids).toEqual([
        underscore,
      ]);
      expect((await listed(creatorId, { search: '\\' })).ids).toEqual([
        backslash,
      ]);
      expect(await listed(creatorId, { search: 'interview' })).toEqual({
        ids: [described],
        total: 1,
      });
      // Empty is no search at all.
      expect((await listed(creatorId, { search: '' })).total).toBe(7);
    });

    it("never finds another creator's media", async () => {
      const creatorId = await newCreator();
      const other = await newCreator();
      await seedMedia(other, { title: 'Shared word' });
      const mine = await seedMedia(creatorId, { title: 'Shared word' });

      expect(await listed(creatorId, { search: 'shared' })).toEqual({
        ids: [mine],
        total: 1,
      });
    });
  });

  describe('status groups', () => {
    it('processing is uploaded or transcoding; attention is failed, or an upload stalled past the threshold', async () => {
      const creatorId = await newCreator();
      const now = Date.now();
      const fresh = await seedMedia(creatorId, { status: 'uploading' });
      const nearlyStalled = await seedMedia(creatorId, {
        status: 'uploading',
        createdAt: new Date(now - MEDIA_UPLOAD_STALLED_AFTER_MS + 60_000),
      });
      const stalled = await seedMedia(creatorId, {
        status: 'uploading',
        createdAt: new Date(now - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000),
        // A rename in flight moves updatedAt: the stall reads creation.
        updatedAt: new Date(now),
      });
      const uploaded = await seedMedia(creatorId, { status: 'uploaded' });
      const transcoding = await seedMedia(creatorId, { status: 'transcoding' });
      await seedMedia(creatorId, { status: 'ready' });
      const failed = await seedMedia(creatorId, { status: 'failed' });

      const processing = await listed(creatorId, { status: 'processing' });
      expect(sorted(processing.ids)).toEqual(sorted([uploaded, transcoding]));
      expect(processing.total).toBe(2);

      const attention = await listed(creatorId, { status: 'attention' });
      expect(sorted(attention.ids)).toEqual(sorted([failed, stalled]));
      expect(attention.total).toBe(2);

      // A raw status still means only itself.
      expect(
        sorted((await listed(creatorId, { status: 'uploading' })).ids)
      ).toEqual(sorted([fresh, nearlyStalled, stalled]));
    });

    it('counts the whole filter in the total, not the page', async () => {
      const creatorId = await newCreator();
      await seedMedia(creatorId, { status: 'failed' });
      await seedMedia(creatorId, { status: 'failed' });
      await seedMedia(creatorId, { status: 'ready' });

      const page = await listed(creatorId, { status: 'attention' }, 1);
      expect(page.ids).toHaveLength(1);
      expect(page.total).toBe(2);
    });
  });

  describe('usage', () => {
    it('agrees with the chip: a use through every blocking reference is used, nothing else is', async () => {
      const creatorId = await newCreator();
      const orgId = await seedOrg(creatorId);
      const cdn = 'https://cdn-assets.example';

      const viaContent = await seedMedia(creatorId);
      const viaThumbnail = await seedMedia(creatorId);
      const viaIntro = await seedMedia(creatorId);
      const viaReel = await seedMedia(creatorId);
      const viaGuideVideo = await seedMedia(creatorId);
      const viaHero = await seedMedia(creatorId);
      const viaOrgIntro = await seedMedia(creatorId);
      const viaPortrait = await seedMedia(creatorId);
      const unused = await seedMedia(creatorId);
      const onlyDeletedUse = await seedMedia(creatorId);
      const onlyIgnoredUse = await seedMedia(creatorId);

      // The blocking columns this test covers. A new one fails here until it
      // gets a use below: the filter must never miss a kind of use.
      const covered = [
        'content.media_item_id',
        'courses.intro_video_media_id',
        'courses.preview_video_media_id',
        'courses.guide_video_media_id',
        'courses.hero_media_id',
        'branding_settings.intro_video_media_item_id',
      ];
      const blocking = Object.entries(MEDIA_REFERENCE_COLUMNS)
        .filter(([, rule]) => rule === 'blocking')
        .map(([column]) => column);
      expect(sorted(blocking)).toEqual(sorted(covered));

      await db.insert(content).values([
        createTestContentInput(creatorId, { mediaItemId: viaContent }),
        // Its poster is a frame of `viaThumbnail`: a use of that item too.
        createTestContentInput(creatorId, {
          title: 'Poster from another item',
          thumbnailUrl: `${cdn}/${creatorId}/media-thumbnails/${viaThumbnail}/lg.webp`,
        }),
        createTestContentInput(creatorId, {
          mediaItemId: onlyDeletedUse,
          deletedAt: new Date(),
        }),
      ]);
      await db.insert(courses).values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('ml-course'),
        title: 'A course',
        status: 'draft',
        introVideoMediaId: viaIntro,
        previewVideoMediaId: viaReel,
        guideVideoMediaId: viaGuideVideo,
        heroMediaId: viaHero,
        guide: { name: 'Guide', portraitMediaId: viaPortrait },
        // Retired slot: ignored by the guard, so not a use.
        signatureMediaId: onlyIgnoredUse,
      });
      await db.insert(platformSettings).values({ organizationId: orgId });
      await db
        .insert(brandingSettings)
        .values({ organizationId: orgId, introVideoMediaItemId: viaOrgIntro });

      const used = [
        viaContent,
        viaThumbnail,
        viaIntro,
        viaReel,
        viaGuideVideo,
        viaHero,
        viaOrgIntro,
        viaPortrait,
      ];
      const notUsed = [unused, onlyDeletedUse, onlyIgnoredUse];

      const usedList = await listed(creatorId, { usage: 'used' });
      expect(sorted(usedList.ids)).toEqual(sorted(used));
      expect(usedList.total).toBe(used.length);

      const unusedList = await listed(creatorId, { usage: 'unused' });
      expect(sorted(unusedList.ids)).toEqual(sorted(notUsed));
      expect(unusedList.total).toBe(notUsed.length);

      expect((await listed(creatorId, { usage: 'any' })).total).toBe(
        used.length + notUsed.length
      );

      // The same truth as each row's chip.
      const page = await media.list(creatorId, {}, { page: 1, limit: 100 });
      for (const item of page.items) {
        expect(item.usage.total > 0).toBe(used.includes(item.id));
      }
    });

    it("lists another creator's use of my media as a use, and keeps their media out", async () => {
      const creatorId = await newCreator();
      const other = await newCreator();
      const mine = await seedMedia(creatorId);
      const theirs = await seedMedia(other);
      await db
        .insert(content)
        .values([
          createTestContentInput(other, { mediaItemId: mine }),
          createTestContentInput(other, { mediaItemId: theirs }),
        ]);

      expect(await listed(creatorId, { usage: 'used' })).toEqual({
        ids: [mine],
        total: 1,
      });
      expect(await listed(creatorId, { usage: 'unused' })).toEqual({
        ids: [],
        total: 0,
      });
    });

    // The outer list's scope would hide a scope lost INSIDE the helper, so it
    // is asserted directly: its cost must follow one creator, not the platform.
    it("reads only this creator's live media: never another's, never a deleted one", async () => {
      const creatorId = await newCreator();
      const other = await newCreator();
      const mine = await seedMedia(creatorId);
      const mineDeleted = await seedMedia(creatorId, { deletedAt: new Date() });
      const theirs = await seedMedia(other);
      await db
        .insert(content)
        .values([
          createTestContentInput(creatorId, { mediaItemId: mine }),
          createTestContentInput(creatorId, { mediaItemId: mineDeleted }),
          createTestContentInput(other, { mediaItemId: theirs }),
        ]);

      expect(await listUsedMediaIds(db, creatorId)).toEqual([mine]);
    });

    it('a creator with nothing used lists nothing used and everything unused', async () => {
      const creatorId = await newCreator();
      const a = await seedMedia(creatorId);
      const b = await seedMedia(creatorId);

      expect((await listed(creatorId, { usage: 'used' })).total).toBe(0);
      expect(
        sorted((await listed(creatorId, { usage: 'unused' })).ids)
      ).toEqual(sorted([a, b]));
    });
  });

  describe('sorts', () => {
    it('sorts by duration and by size, an unmeasured item last either way', async () => {
      const creatorId = await newCreator();
      const short = await seedMedia(creatorId, {
        durationSeconds: 30,
        fileSizeBytes: 9_000,
      });
      const long = await seedMedia(creatorId, {
        durationSeconds: 300,
        fileSizeBytes: 1_000,
      });
      const unmeasured = await seedMedia(creatorId, {
        status: 'uploading',
        fileSizeBytes: 5_000,
      });

      const by = async (
        sortBy: MediaItemFilters['sortBy'],
        sortOrder: 'asc' | 'desc'
      ) => (await listed(creatorId, { sortBy, sortOrder })).ids;

      expect(await by('durationSeconds', 'desc')).toEqual([
        long,
        short,
        unmeasured,
      ]);
      expect(await by('durationSeconds', 'asc')).toEqual([
        short,
        long,
        unmeasured,
      ]);
      expect(await by('fileSizeBytes', 'asc')).toEqual([
        long,
        unmeasured,
        short,
      ]);
    });

    it('keeps rows that tie on the sort in one order across pages', async () => {
      const creatorId = await newCreator();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await seedMedia(creatorId, { durationSeconds: 120 }));
      }

      const pages: string[] = [];
      for (let page = 1; page <= 5; page++) {
        const result = await media.list(
          creatorId,
          { sortBy: 'durationSeconds' },
          { page, limit: 1 }
        );
        pages.push(...result.items.map((item) => item.id));
      }
      // The id order exactly, not just five distinct rows: without the
      // tiebreak, Postgres may hand back five distinct rows by luck. A uuid
      // compares bytewise, which for lowercase hex is string order.
      expect(pages).toEqual(sorted(ids).reverse());

      const ascending: string[] = [];
      for (let page = 1; page <= 5; page++) {
        const result = await media.list(
          creatorId,
          { sortBy: 'durationSeconds', sortOrder: 'asc' },
          { page, limit: 1 }
        );
        ascending.push(...result.items.map((item) => item.id));
      }
      expect(ascending).toEqual(sorted(ids));
    });
  });
});
