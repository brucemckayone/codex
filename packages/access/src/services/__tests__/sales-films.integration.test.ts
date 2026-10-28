/**
 * Which course sales films may stream in FULL (owner P10, "Full film unless
 * it's paid"): `sales-films.ts` and its three readers.
 *
 * REAL Neon coverage on freshly-seeded, uniquely-slugged rows:
 *   - every one of the seven gates on a content row that uses a film cuts it to
 *     the preview, each alone, and agrees with `isPublicContent`, the rule it
 *     mirrors; a plainly free use, a deleted use and no use leave it full;
 *   - a draft paid practice cuts it too, as does a paid use in another org;
 *   - a film that is not ready, deleted, or has no HLS master is never full;
 *   - the minter's course read (`resolveCourseFilm`): a draft course, a deleted
 *     course, a deleted org, another org's id and an empty slot all answer null;
 *   - the sell preview flags each film, and never the hero's loop;
 *   - `getCourseFilmStream` signs a film token for that course and media that
 *     the content proxies would refuse;
 *   - the studio's set names an active member's paid-use media only.
 */

import { isPublicContent } from '@codex/constants';
import {
  content,
  courses,
  landingPages,
  mediaItems,
  organizationMemberships,
  organizations,
  subscriptionTiers,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyFilmToken, verifyHlsToken } from '../../hls-token';
import { ContentAccessService } from '../ContentAccessService';
import { CourseJourneyService } from '../course-journey-service';
import {
  findFullFilmMedia,
  findPaidMediaInOrg,
  resolveCourseFilm,
} from '../sales-films';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];
type NewMedia = Parameters<typeof createTestMediaItemInput>[1];
type NewContent = Parameters<typeof createTestContentInput>[1];

const CDN = 'https://cdn.example.test';
const API = 'https://api.example.test';
const SECRET = 'test-film-secret';

describe('course sales films (owner P10)', () => {
  let db: Database;
  let journeys: CourseJourneyService;
  let access: ContentAccessService;
  let creatorId: string;
  let outsiderId: string;
  let orgId: string;
  let otherOrgId: string;
  let tierId: string;

  async function seedFilm(overrides: NewMedia = {}, owner?: string) {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(owner ?? creatorId, {
          mediaType: 'video',
          status: 'ready',
          hlsPreviewKey: `previews/${createUniqueSlug('film')}/preview.m3u8`,
          ...overrides,
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error('failed to seed a film');
    return row.id;
  }

  async function useIn(mediaItemId: string, policy: NewContent = {}) {
    await db.insert(content).values(
      createTestContentInput(creatorId, {
        organizationId: orgId,
        mediaItemId,
        ...policy,
      })
    );
  }

  async function seedCourse(
    films: { intro?: string; reel?: string; guide?: string; hero?: string },
    overrides: { status?: 'published' | 'draft'; organizationId?: string } = {}
  ) {
    const status = overrides.status ?? 'published';
    const [row] = await db
      .insert(courses)
      .values({
        organizationId: overrides.organizationId ?? orgId,
        creatorId,
        slug: createUniqueSlug('films-course'),
        title: 'Sales films',
        status,
        publishedAt: status === 'published' ? new Date() : null,
        introVideoMediaId: films.intro ?? null,
        previewVideoMediaId: films.reel ?? null,
        guideVideoMediaId: films.guide ?? null,
        heroMediaId: films.hero ?? null,
      })
      .returning({ id: courses.id });
    if (!row) throw new Error('failed to seed a course');
    return row.id;
  }

  async function seedOrg(name: string) {
    const [org] = await db
      .insert(organizations)
      .values({ name, slug: createUniqueSlug('films-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    return org.id;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    journeys = new CourseJourneyService({ db, environment: 'test' });
    const r2 = new Proxy(
      {},
      {
        get: () => {
          throw new Error('signing ran: the film minter signs no R2 URL');
        },
      }
    ) as R2;
    access = new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService: new PurchaseService(
        { db, environment: 'test' },
        {} as Stripe
      ),
      contentApiBaseUrl: API,
      hlsTokenSecret: SECRET,
    });

    const [creator, outsider] = await seedTestUsers(db, 2);
    if (!creator || !outsider) throw new Error('failed to seed test users');
    creatorId = creator;
    outsiderId = outsider;

    orgId = await seedOrg('Films org');
    otherOrgId = await seedOrg('Other films org');
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });

    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    if (!tier) throw new Error('failed to create tier');
    tierId = tier.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('a content row that uses the film (rule b)', () => {
    // Each shape sets ONE gate on an otherwise plainly free row, plus the
    // plainly free row itself.
    const shapes: Array<[string, () => NewContent]> = [
      ['plainly free', () => ({})],
      ['isFree false', () => ({ isFree: false })],
      ['purchasable', () => ({ isPurchasable: true, priceCents: 500 })],
      ['priced but not purchasable', () => ({ priceCents: 500 })],
      ['in a tier', () => ({ includedInTierId: tierId })],
      ['followers only', () => ({ isFollowerGated: true })],
      ['team only', () => ({ isTeamOnly: true })],
      ['course only', () => ({ courseOnly: true })],
    ];

    for (const [name, policy] of shapes) {
      it(`${name}: full exactly when isPublicContent says public`, async () => {
        const film = await seedFilm();
        const row = createTestContentInput(creatorId, policy());
        await useIn(film, policy());

        const full = await findFullFilmMedia(db, [film]);
        const expected = isPublicContent({
          isFree: row.isFree ?? null,
          isPurchasable: row.isPurchasable ?? null,
          priceCents: row.priceCents ?? null,
          includedInTierId: row.includedInTierId ?? null,
          isFollowerGated: row.isFollowerGated ?? null,
          isTeamOnly: row.isTeamOnly ?? null,
          courseOnly: row.courseOnly ?? null,
        });
        expect(full.has(film)).toBe(expected);
        expect(expected).toBe(name === 'plainly free');
      });
    }

    it('a draft paid practice cuts it: it is published later with the same gates', async () => {
      const film = await seedFilm();
      await useIn(film, {
        isPurchasable: true,
        priceCents: 900,
        status: 'draft',
      });
      expect((await findFullFilmMedia(db, [film])).has(film)).toBe(false);
    });

    it('a paid use in ANOTHER org cuts it: a paid lesson anywhere is still paid', async () => {
      const film = await seedFilm();
      await db.insert(content).values(
        createTestContentInput(creatorId, {
          organizationId: otherOrgId,
          mediaItemId: film,
          isPurchasable: true,
          priceCents: 900,
        })
      );
      expect((await findFullFilmMedia(db, [film])).has(film)).toBe(false);
    });

    it('a DELETED paid use does not cut it, and no use leaves it full', async () => {
      const used = await seedFilm();
      await useIn(used, {
        isPurchasable: true,
        priceCents: 900,
        deletedAt: new Date(),
      });
      const unused = await seedFilm();
      const full = await findFullFilmMedia(db, [used, unused]);
      expect(full.get(used)).toBe(creatorId);
      expect(full.get(unused)).toBe(creatorId);
    });

    it('one free use beside one paid use is still cut', async () => {
      const film = await seedFilm();
      await useIn(film);
      await useIn(film, { courseOnly: true });
      expect((await findFullFilmMedia(db, [film])).has(film)).toBe(false);
    });
  });

  describe('the media itself (rule c)', () => {
    it('is never full when not ready, deleted, or without an HLS master', async () => {
      // Everything else a full film needs, so the status alone refuses it.
      const transcoding = await seedFilm({
        status: 'transcoding',
        hlsMasterPlaylistKey: `hls/${createUniqueSlug('film')}/master.m3u8`,
      });
      const deleted = await seedFilm({ deletedAt: new Date() });
      const masterless = await seedFilm({
        status: 'failed',
        hlsMasterPlaylistKey: null,
      });
      const full = await findFullFilmMedia(db, [
        transcoding,
        deleted,
        masterless,
      ]);
      expect(full.size).toBe(0);
    });

    it('answers an empty set for no ids without a query', async () => {
      expect((await findFullFilmMedia(db, [])).size).toBe(0);
    });
  });

  describe('resolveCourseFilm: the minter reads the slot of a published course (rule a)', () => {
    it('names the slot film and its creator', async () => {
      const intro = await seedFilm();
      const reel = await seedFilm();
      const courseId = await seedCourse({ intro, reel });
      expect(
        await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId,
          film: 'reel',
        })
      ).toEqual({ creatorId, mediaId: reel });
    });

    it('answers null for a draft course, another org, an empty slot or a paid film', async () => {
      const film = await seedFilm();
      const paid = await seedFilm();
      await useIn(paid, { isPurchasable: true, priceCents: 900 });
      const draft = await seedCourse({ intro: film }, { status: 'draft' });
      const live = await seedCourse({ intro: film, guide: paid });

      const ask = (courseId: string, organizationId = orgId) =>
        resolveCourseFilm(db, { organizationId, courseId, film: 'intro' });

      expect(await ask(draft)).toBeNull();
      expect(await ask(live, otherOrgId)).toBeNull();
      expect(
        await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId: live,
          film: 'reel',
        })
      ).toBeNull();
      expect(
        await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId: live,
          film: 'guide',
        })
      ).toBeNull();
      expect(await ask(live)).toEqual({ creatorId, mediaId: film });
    });

    it('answers null for a deleted course and a deleted org', async () => {
      const film = await seedFilm();
      const deletedCourse = await seedCourse({ intro: film });
      await db
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(eq(courses.id, deletedCourse));

      const goneOrgId = await seedOrg('Gone films org');
      const orphan = await seedCourse(
        { intro: film },
        { organizationId: goneOrgId }
      );
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, goneOrgId));

      expect(
        await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId: deletedCourse,
          film: 'intro',
        })
      ).toBeNull();
      expect(
        await resolveCourseFilm(db, {
          organizationId: goneOrgId,
          courseId: orphan,
          film: 'intro',
        })
      ).toBeNull();
    });
  });

  describe('the sell preview flags each film (advisory)', () => {
    it('full for a free film, preview for a paid one, and no flag on the hero loop', async () => {
      const intro = await seedFilm();
      const reel = await seedFilm();
      await useIn(reel, { includedInTierId: tierId });
      const hero = await seedFilm();
      const courseId = await seedCourse({ intro, reel, guide: intro, hero });

      const preview = await journeys.getCourseSellPreview(courseId, CDN);
      expect(preview?.intro?.fullFilm).toBe(true);
      expect(preview?.reel?.fullFilm).toBe(false);
      expect(preview?.guideClip?.fullFilm).toBe(true);
      expect(preview?.heroClip).not.toBeNull();
      expect(preview?.heroClip).not.toHaveProperty('fullFilm');
      // The clip itself is still the public 30s preview.
      expect(preview?.intro?.playlistUrl).toMatch(/preview\.m3u8$/);
    });
  });

  describe('getCourseFilmStream: the public minter', () => {
    it('signs a film token for this course and media, which no content proxy accepts', async () => {
      const intro = await seedFilm();
      const courseId = await seedCourse({ intro });

      const stream = await access.getCourseFilmStream({
        organizationId: orgId,
        courseId,
        film: 'intro',
      });
      expect(stream).not.toBeNull();
      const url = new URL(stream?.playlistUrl ?? '');
      expect(`${url.origin}${url.pathname}`).toBe(
        `${API}/api/access/courses/${courseId}/films/hls/master.m3u8`
      );
      const token = url.searchParams.get('token') ?? '';
      const payload = await verifyFilmToken(token, SECRET);
      expect(payload).toMatchObject({ courseId, creatorId, mediaId: intro });
      // About ten minutes, and the response says when.
      const lifetime = (payload?.exp ?? 0) - Math.floor(Date.now() / 1000);
      expect(lifetime).toBeGreaterThan(590);
      expect(lifetime).toBeLessThanOrEqual(600);
      expect(stream?.expiresAt).toBe(
        new Date((payload?.exp ?? 0) * 1000).toISOString()
      );
      // Domain separation: a film token is not a content-stream credential.
      expect(await verifyHlsToken(token, SECRET)).toBeNull();
    });

    it('answers null, never a URL, for a paid film', async () => {
      const intro = await seedFilm();
      await useIn(intro, { isTeamOnly: true });
      const courseId = await seedCourse({ intro });
      expect(
        await access.getCourseFilmStream({
          organizationId: orgId,
          courseId,
          film: 'intro',
        })
      ).toBeNull();
    });
  });

  describe("findPaidMediaInOrg: the studio's note", () => {
    it("names an active member's paid-use media, not their free films or an outsider's", async () => {
      const paid = await seedFilm();
      await useIn(paid, { isFollowerGated: true });
      const free = await seedFilm();
      await useIn(free);
      const outsiders = await seedFilm({}, outsiderId);
      await db.insert(content).values(
        createTestContentInput(outsiderId, {
          mediaItemId: outsiders,
          isPurchasable: true,
          priceCents: 900,
        })
      );

      const ids = await findPaidMediaInOrg(db, orgId);
      expect(ids).toContain(paid);
      expect(ids).not.toContain(free);
      expect(ids).not.toContain(outsiders);
    });

    it('rides on the studio sell-media read', async () => {
      const paid = await seedFilm();
      await useIn(paid, { courseOnly: true });
      const courseId = await seedCourse({ intro: paid });
      const [page] = await db
        .insert(landingPages)
        .values({
          organizationId: orgId,
          creatorId,
          pageType: 'course',
          slug: createUniqueSlug('films-page'),
          title: 'Films page',
          status: 'draft',
          subjectType: 'course',
          subjectId: courseId,
          sections: [],
        })
        .returning({ id: landingPages.id });
      if (!page) throw new Error('failed to seed a page');

      const media = await journeys.getJourneySellMedia(orgId, page.id, CDN);
      expect(media.previewOnlyMediaIds).toContain(paid);
    });
  });
});
