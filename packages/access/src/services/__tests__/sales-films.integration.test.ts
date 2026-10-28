/**
 * Which course sales films may stream in FULL (owner P10, "Full film unless
 * it's paid"): `sales-films.ts` and its three readers.
 *
 * REAL Neon coverage on freshly-seeded, uniquely-slugged rows, every case
 * through the public minter's one statement (`resolveCourseFilm`):
 *   - every one of the seven gates on a content row that uses a film cuts it to
 *     the preview, each alone, and agrees with `isPublicContent`, the rule it
 *     mirrors; a plainly free use, a deleted use and no use leave it full;
 *   - a draft paid practice cuts it too, as does a paid use in another org;
 *   - a film that is not ready, deleted, or has no HLS master is never full,
 *     nor one whose creator is off the org's team: left, never joined, or
 *     holding only a customer-side subscriber or member row;
 *   - a draft course, a deleted course, a deleted org and another org's id
 *     refuse as `no-course`, an empty slot as `empty-slot`, a paid film as
 *     `paid-use`, unready media as `not-ready` and a departed creator's film
 *     as `creator-not-member`;
 *   - the sell preview flags each film with the same predicate, and never the
 *     hero's loop;
 *   - `getCourseFilmStream` signs a film token for that course and media that
 *     the content proxies would refuse;
 *   - the studio's set names only what the pickers can hold: this course's
 *     film slots and the viewer's own library.
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
import type { ObservabilityClient } from '@codex/observability';
import { PurchaseService } from '@codex/purchase';
import { InternalServiceError } from '@codex/service-errors';
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyFilmToken, verifyHlsToken } from '../../hls-token';
import { ContentAccessService } from '../ContentAccessService';
import { CourseJourneyService } from '../course-journey-service';
import {
  type CourseFilmRefusal,
  type CourseFilmResolution,
  findPreviewOnlyMedia,
  resolveCourseFilm,
} from '../sales-films';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];
type NewMedia = Parameters<typeof createTestMediaItemInput>[1];
type NewContent = Parameters<typeof createTestContentInput>[1];
type Films = { intro?: string; reel?: string; guide?: string; hero?: string };

/** A service's own observability client, to spy on what it logs. */
const obsOf = (service: ContentAccessService) =>
  (service as unknown as { obs: ObservabilityClient }).obs;

const CDN = 'https://cdn.example.test';
const API = 'https://api.example.test';
const SECRET = 'test-film-secret';

describe('course sales films (owner P10)', () => {
  let db: Database;
  let journeys: CourseJourneyService;
  let access: ContentAccessService;
  /** An active owner of `orgId`; the default creator of every film. */
  let creatorId: string;
  /** An active member of `orgId` beside the creator. */
  let colleagueId: string;
  /** A member of `orgId` who has left (`inactive`). */
  let leaverId: string;
  /** Never a member of `orgId`. */
  let outsiderId: string;
  /** Customer-side rows in `orgId`: an active subscriber, an active member. */
  let subscriberId: string;
  let memberId: string;
  /** A creator who left `orgId`, then subscribed to it. */
  let returnerId: string;
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
    films: Films,
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

  async function join(
    organizationId: string,
    userId: string,
    status: 'active' | 'inactive' = 'active',
    role: 'owner' | 'admin' | 'creator' | 'member' | 'subscriber' = 'creator'
  ) {
    await db
      .insert(organizationMemberships)
      .values({ organizationId, userId, role, status });
  }

  const refused = (reason: CourseFilmRefusal) => ({ ok: false, reason });

  /** The minter's answer for this film in a published course's intro slot. */
  async function mint(film: string): Promise<CourseFilmResolution> {
    const courseId = await seedCourse({ intro: film });
    return resolveCourseFilm(db, {
      organizationId: orgId,
      courseId,
      film: 'intro',
    });
  }

  /** Would the minter stream this film in full? */
  async function isFull(film: string): Promise<boolean> {
    return (await mint(film)).ok;
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

    const [creator, colleague, leaver, outsider, subscriber, member, returner] =
      await seedTestUsers(db, 7);
    if (
      !creator ||
      !colleague ||
      !leaver ||
      !outsider ||
      !subscriber ||
      !member ||
      !returner
    ) {
      throw new Error('failed to seed test users');
    }
    creatorId = creator;
    colleagueId = colleague;
    leaverId = leaver;
    outsiderId = outsider;
    subscriberId = subscriber;
    memberId = member;
    returnerId = returner;

    orgId = await seedOrg('Films org');
    otherOrgId = await seedOrg('Other films org');
    await join(orgId, creatorId);
    await join(orgId, colleagueId);
    await join(orgId, leaverId, 'inactive');
    await join(orgId, subscriberId, 'active', 'subscriber');
    await join(orgId, memberId, 'active', 'member');
    await join(orgId, returnerId, 'inactive');

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

        const expected = isPublicContent({
          isFree: row.isFree ?? null,
          isPurchasable: row.isPurchasable ?? null,
          priceCents: row.priceCents ?? null,
          includedInTierId: row.includedInTierId ?? null,
          isFollowerGated: row.isFollowerGated ?? null,
          isTeamOnly: row.isTeamOnly ?? null,
          courseOnly: row.courseOnly ?? null,
        });
        expect(await mint(film)).toEqual(
          expected ? expect.objectContaining({ ok: true }) : refused('paid-use')
        );
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
      expect(await mint(film)).toEqual(refused('paid-use'));
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
      expect(await mint(film)).toEqual(refused('paid-use'));
    });

    it('a DELETED paid use does not cut it, and no use leaves it full', async () => {
      const used = await seedFilm();
      await useIn(used, {
        isPurchasable: true,
        priceCents: 900,
        deletedAt: new Date(),
      });
      expect(await isFull(used)).toBe(true);
      expect(await isFull(await seedFilm())).toBe(true);
    });

    it('one free use beside one paid use is still cut', async () => {
      const film = await seedFilm();
      await useIn(film);
      await useIn(film, { courseOnly: true });
      expect(await mint(film)).toEqual(refused('paid-use'));
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
      expect(await mint(transcoding)).toEqual(refused('not-ready'));
      expect(await mint(deleted)).toEqual(refused('not-ready'));
      expect(await mint(masterless)).toEqual(refused('not-ready'));
    });

    it("is never full once its creator has LEFT the course's org, or never joined it", async () => {
      // Nothing clears a slot when a member leaves, so the read asks again.
      expect(await mint(await seedFilm({}, leaverId))).toEqual(
        refused('creator-not-member')
      );
      expect(await mint(await seedFilm({}, outsiderId))).toEqual(
        refused('creator-not-member')
      );
      expect(await isFull(await seedFilm({}, colleagueId))).toBe(true);
    });
  });

  describe("the creator must be on the org's TEAM, not a customer", () => {
    it('an active subscriber or member creator is refused: those rows are customer-side', async () => {
      expect(await mint(await seedFilm({}, subscriberId))).toEqual(
        refused('creator-not-member')
      );
      expect(await mint(await seedFilm({}, memberId))).toEqual(
        refused('creator-not-member')
      );
    });

    it('a creator who left and then SUBSCRIBED stays refused', async () => {
      const film = await seedFilm({}, returnerId);
      expect(await mint(film)).toEqual(refused('creator-not-member'));
      // What `upsertSubscriberMembership` does to a removed member's row.
      await db
        .update(organizationMemberships)
        .set({ status: 'active', role: 'subscriber' })
        .where(eq(organizationMemberships.userId, returnerId));
      expect(await mint(film)).toEqual(refused('creator-not-member'));
    });

    it('an active owner, admin or creator passes, and the sell preview agrees', async () => {
      const [owner, admin] = await seedTestUsers(db, 2);
      if (!owner || !admin) throw new Error('failed to seed test users');
      await join(orgId, owner, 'active', 'owner');
      await join(orgId, admin, 'active', 'admin');
      for (const userId of [owner, admin, colleagueId]) {
        expect(await isFull(await seedFilm({}, userId))).toBe(true);
      }

      const intro = await seedFilm({}, colleagueId);
      const reel = await seedFilm({}, subscriberId);
      const courseId = await seedCourse({ intro, reel });
      const preview = await journeys.getCourseSellPreview(courseId, CDN);
      expect(preview?.intro?.fullFilm).toBe(true);
      expect(preview?.reel?.fullFilm).toBe(false);
    });
  });

  describe('resolveCourseFilm: the slot of a published course (rule a)', () => {
    it('names the slot film and its creator', async () => {
      const intro = await seedFilm();
      const reel = await seedFilm({}, colleagueId);
      const courseId = await seedCourse({ intro, reel });
      expect(
        await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId,
          film: 'reel',
        })
      ).toEqual({ ok: true, creatorId: colleagueId, mediaId: reel });
    });

    it('answers null for a draft course, another org, an empty slot or a paid film', async () => {
      const film = await seedFilm();
      const paid = await seedFilm();
      await useIn(paid, { isPurchasable: true, priceCents: 900 });
      const draft = await seedCourse({ intro: film }, { status: 'draft' });
      const live = await seedCourse({ intro: film, guide: paid });

      const ask = (
        courseId: string,
        film: 'intro' | 'reel' | 'guide' = 'intro',
        organizationId = orgId
      ) => resolveCourseFilm(db, { organizationId, courseId, film });

      expect(await ask(draft)).toEqual(refused('no-course'));
      // The browser's org id only narrows: naming another org finds nothing.
      expect(await ask(live, 'intro', otherOrgId)).toEqual(
        refused('no-course')
      );
      expect(await ask(live, 'reel')).toEqual(refused('empty-slot'));
      expect(await ask(live, 'guide')).toEqual(refused('paid-use'));
      expect(await ask(live)).toEqual({ ok: true, creatorId, mediaId: film });
    });

    it('answers null for a deleted course and a deleted org', async () => {
      const film = await seedFilm();
      const deletedCourse = await seedCourse({ intro: film });
      await db
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(eq(courses.id, deletedCourse));

      // The creator IS an active member there, so only the org's own deletion
      // can refuse it.
      const goneOrgId = await seedOrg('Gone films org');
      await join(goneOrgId, creatorId);
      const orphan = await seedCourse(
        { intro: film },
        { organizationId: goneOrgId }
      );
      expect(
        await resolveCourseFilm(db, {
          organizationId: goneOrgId,
          courseId: orphan,
          film: 'intro',
        })
      ).toEqual({ ok: true, creatorId, mediaId: film });
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
      ).toEqual(refused('no-course'));
      expect(
        await resolveCourseFilm(db, {
          organizationId: goneOrgId,
          courseId: orphan,
          film: 'intro',
        })
      ).toEqual(refused('no-course'));
    });
  });

  describe('the sell preview flags each film with the same predicate (advisory)', () => {
    it('full for a free film, preview for a paid one or a leaver’s, and no flag on the hero loop', async () => {
      const intro = await seedFilm();
      const reel = await seedFilm();
      await useIn(reel, { includedInTierId: tierId });
      const guide = await seedFilm({}, leaverId);
      const hero = await seedFilm();
      const courseId = await seedCourse({ intro, reel, guide, hero });

      const preview = await journeys.getCourseSellPreview(courseId, CDN);
      expect(preview?.intro?.fullFilm).toBe(true);
      expect(preview?.reel?.fullFilm).toBe(false);
      expect(preview?.guideClip?.fullFilm).toBe(false);
      expect(preview?.heroClip).not.toBeNull();
      expect(preview?.heroClip).not.toHaveProperty('fullFilm');
      // The clip itself is still the public 30s preview.
      expect(preview?.intro?.playlistUrl).toMatch(/preview\.m3u8$/);

      // And the flag agrees with the gate, film for film.
      for (const [film, clip] of [
        ['intro', preview?.intro],
        ['reel', preview?.reel],
        ['guide', preview?.guideClip],
      ] as const) {
        const minted = await resolveCourseFilm(db, {
          organizationId: orgId,
          courseId,
          film,
        });
        expect(minted.ok, film).toBe(clip?.fullFilm);
      }
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
      const check = await verifyFilmToken(token, SECRET);
      expect(check).toMatchObject({
        ok: true,
        payload: { courseId, creatorId, mediaId: intro },
      });
      const exp = check.ok ? check.payload.exp : 0;
      // About ten minutes, and the response says when.
      const lifetime = exp - Math.floor(Date.now() / 1000);
      expect(lifetime).toBeGreaterThan(590);
      expect(lifetime).toBeLessThanOrEqual(600);
      expect(stream?.expiresAt).toBe(new Date(exp * 1000).toISOString());
      // Domain separation: a film token is not a content-stream credential.
      expect(await verifyHlsToken(token, SECRET)).toBeNull();
    });

    it('answers null, never a URL, for a paid film, and logs why', async () => {
      const intro = await seedFilm();
      await useIn(intro, { isTeamOnly: true });
      const courseId = await seedCourse({ intro });
      const info = vi.spyOn(obsOf(access), 'info');
      try {
        expect(
          await access.getCourseFilmStream({
            organizationId: orgId,
            courseId,
            film: 'intro',
          })
        ).toBeNull();
        expect(info).toHaveBeenCalledWith('Course film stream refused', {
          organizationId: orgId,
          courseId,
          film: 'intro',
          reason: 'paid-use',
        });
      } finally {
        info.mockRestore();
      }
    });

    it('a misconfigured minter fails LOUDLY: logged, and a generic 500, never a null', async () => {
      const intro = await seedFilm();
      const courseId = await seedCourse({ intro });
      const unsigned = new ContentAccessService({
        db,
        environment: 'test',
        r2: {} as R2,
        purchaseService: new PurchaseService(
          { db, environment: 'test' },
          {} as Stripe
        ),
        contentApiBaseUrl: API,
      });
      const error = vi.spyOn(obsOf(unsigned), 'error');

      const failure = await unsigned
        .getCourseFilmStream({ organizationId: orgId, courseId, film: 'intro' })
        .then(
          () => null,
          (err: unknown) => err
        );
      // The class name is minified in dist, so the type is asserted, not read.
      expect(failure).toBeInstanceOf(InternalServiceError);
      expect(failure).toMatchObject({
        statusCode: 500,
        message: 'Streaming is unavailable',
        context: undefined,
      });
      expect(error).toHaveBeenCalledWith(
        'Failed to mint course film stream',
        expect.objectContaining({
          courseId,
          mediaItemId: intro,
          errorMessage: 'missing hlsTokenSecret',
        })
      );
    });
  });

  describe("findPreviewOnlyMedia: the studio's note", () => {
    it("names only what the pickers can hold: this course's film slots and the viewer's own library", async () => {
      const ownPaid = await seedFilm();
      await useIn(ownPaid, { isFollowerGated: true });
      const ownFree = await seedFilm();
      await useIn(ownFree);
      // A colleague's paid film in this course's reel slot: named.
      const slotPaid = await seedFilm({}, colleagueId);
      await useIn(slotPaid, { isPurchasable: true, priceCents: 900 });
      // The same colleague's paid film nowhere in this course: not named.
      const elsewherePaid = await seedFilm({}, colleagueId);
      await useIn(elsewherePaid, { isPurchasable: true, priceCents: 900 });
      // A paid film in the hero slot, which never plays in full: not named.
      const heroPaid = await seedFilm({}, colleagueId);
      await useIn(heroPaid, { courseOnly: true });
      const courseId = await seedCourse({ reel: slotPaid, hero: heroPaid });

      const ids = await findPreviewOnlyMedia(db, {
        organizationId: orgId,
        courseId,
        viewerId: creatorId,
      });
      expect(ids).toContain(ownPaid);
      expect(ids).toContain(slotPaid);
      expect(ids).not.toContain(ownFree);
      expect(ids).not.toContain(elsewherePaid);
      expect(ids).not.toContain(heroPaid);

      // With no viewer, the slots alone.
      const slotsOnly = await findPreviewOnlyMedia(db, {
        organizationId: orgId,
        courseId,
      });
      expect(slotsOnly).toEqual([slotPaid]);

      // Another org's id finds no course, so names no slot.
      expect(
        await findPreviewOnlyMedia(db, { organizationId: otherOrgId, courseId })
      ).toEqual([]);
    });

    it('rides on the studio sell-media read, with the viewer', async () => {
      const paid = await seedFilm();
      await useIn(paid, { courseOnly: true });
      const ownPaid = await seedFilm();
      await useIn(ownPaid, { isTeamOnly: true });
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

      const media = await journeys.getJourneySellMedia(
        orgId,
        page.id,
        CDN,
        creatorId
      );
      expect(media.previewOnlyMediaIds).toEqual(
        expect.arrayContaining([paid, ownPaid])
      );
    });
  });
});
