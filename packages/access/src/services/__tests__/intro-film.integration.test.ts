/**
 * An org's intro film under the sales-film rule (Codex-376dl): `resolveIntroFilm`
 * and the public minter `getOrgFilmStream`.
 *
 * REAL database rows, one org per case (an org holds one intro). It runs the
 * same predicates as the course films (`sales-films.integration.test.ts` covers
 * each content gate one by one), so this file proves the org's slot reads them:
 *   - a ready video by a team member, unused or used only by plainly free
 *     content, may stream in full;
 *   - a paid use cuts it to the preview, and the film still comes back so the
 *     landing can draw that preview;
 *   - unready, deleted or audio media, and a creator who left or is only a
 *     customer, refuse with the reason the studio names;
 *   - an empty slot, a deleted org and an unknown org refuse with no film;
 *   - the minter signs an ORG film token for this org and media, which neither
 *     the course film proxies nor the content proxies accept.
 */

import {
  brandingSettings,
  content,
  mediaItems,
  organizationMemberships,
  organizations,
  platformSettings,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import { PurchaseService } from '@codex/purchase';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  verifyFilmToken,
  verifyHlsToken,
  verifyOrgFilmToken,
} from '../../hls-token';
import { ContentAccessService } from '../ContentAccessService';
import { resolveIntroFilm } from '../sales-films';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];
type NewMedia = Parameters<typeof createTestMediaItemInput>[1];
type Role = 'owner' | 'admin' | 'creator' | 'member' | 'subscriber';

const obsOf = (service: ContentAccessService) =>
  (service as unknown as { obs: ObservabilityClient }).obs;

const API = 'https://api.example.test';
const SECRET = 'test-org-film-secret';

describe('org intro film (Codex-376dl)', () => {
  let db: Database;
  let access: ContentAccessService;
  let creatorId: string;

  async function seedFilm(overrides: NewMedia = {}) {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'video',
          status: 'ready',
          hlsPreviewKey: `previews/${createUniqueSlug('intro')}/preview.m3u8`,
          ...overrides,
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error('failed to seed a film');
    return row.id;
  }

  /**
   * An org whose branding holds `intro` (`null` for a branding row with no
   * intro, `undefined` for no branding row at all), with the creator on its
   * team as `role` (`status` active unless told otherwise).
   */
  async function seedOrg(
    intro: string | null | undefined,
    member: { role?: Role; status?: 'active' | 'inactive' } = {}
  ) {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Intro org', slug: createUniqueSlug('intro-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    await db.insert(organizationMemberships).values({
      organizationId: org.id,
      userId: creatorId,
      role: member.role ?? 'owner',
      status: member.status ?? 'active',
    });
    if (intro !== undefined) {
      await db.insert(platformSettings).values({ organizationId: org.id });
      await db
        .insert(brandingSettings)
        .values({ organizationId: org.id, introVideoMediaItemId: intro });
    }
    return org.id;
  }

  async function useIn(
    mediaItemId: string,
    organizationId: string,
    policy: Parameters<typeof createTestContentInput>[1] = {}
  ) {
    await db.insert(content).values(
      createTestContentInput(creatorId, {
        organizationId,
        mediaItemId,
        ...policy,
      })
    );
  }

  beforeAll(async () => {
    db = setupTestDatabase();
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
        { db, environment: 'test', ...createTestMoneyDeps() },
        {} as Stripe
      ),
      contentApiBaseUrl: API,
      hlsTokenSecret: SECRET,
    });
    const [creator] = await seedTestUsers(db, 1);
    if (!creator) throw new Error('failed to seed the creator');
    creatorId = creator;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('resolveIntroFilm', () => {
    it('streams in full a ready video by a team member that nothing paid uses, and names it', async () => {
      const film = await seedFilm({ title: 'Why we teach' });
      const orgId = await seedOrg(film);

      const resolution = await resolveIntroFilm(db, orgId);

      expect(resolution).toMatchObject({
        ok: true,
        film: { mediaId: film, creatorId, title: 'Why we teach' },
      });
      expect(resolution.film?.hlsPreviewKey).toMatch(/preview\.m3u8$/);
      expect(resolution.film?.thumbnailKey).not.toBeNull();
      expect(resolution.film?.durationSeconds).toBe(120);
    });

    it('still streams in full when only plainly free content uses it', async () => {
      const film = await seedFilm();
      const orgId = await seedOrg(film);
      await useIn(film, orgId);

      expect((await resolveIntroFilm(db, orgId)).ok).toBe(true);
    });

    it('cuts a paid film to the preview, and still returns the film for it', async () => {
      const film = await seedFilm();
      const orgId = await seedOrg(film);
      await useIn(film, orgId, { isPurchasable: true, priceCents: 900 });

      expect(await resolveIntroFilm(db, orgId)).toMatchObject({
        ok: false,
        reason: 'paid-use',
        film: { mediaId: film },
      });
    });

    it('refuses unready, failed and audio media with the reason', async () => {
      const transcoding = await seedFilm({ status: 'transcoding' });
      const failed = await seedFilm({ status: 'failed' });
      const audio = await seedFilm({ mediaType: 'audio' });

      const reasons = await Promise.all(
        [transcoding, failed, audio].map(async (film) => {
          const resolution = await resolveIntroFilm(db, await seedOrg(film));
          return resolution.ok ? 'ok' : resolution.reason;
        })
      );
      // `failed`, not `not-ready`: the studio must not say "wait for it".
      expect(reasons).toEqual(['not-ready', 'failed', 'not-video']);
    });

    it('reads a deleted pick as an empty slot, never naming the deleted film', async () => {
      const deleted = await seedFilm({ deletedAt: new Date() });

      expect(await resolveIntroFilm(db, await seedOrg(deleted))).toEqual({
        ok: false,
        reason: 'empty-slot',
        film: null,
      });
    });

    it("refuses a creator who left, or who is only the org's customer", async () => {
      const left = await seedOrg(await seedFilm(), { status: 'inactive' });
      const subscriber = await seedOrg(await seedFilm(), {
        role: 'subscriber',
      });
      const creator = await seedOrg(await seedFilm(), { role: 'creator' });

      expect(await resolveIntroFilm(db, left)).toMatchObject({
        ok: false,
        reason: 'creator-not-member',
      });
      expect(await resolveIntroFilm(db, subscriber)).toMatchObject({
        ok: false,
        reason: 'creator-not-member',
      });
      expect((await resolveIntroFilm(db, creator)).ok).toBe(true);
    });

    it('answers no film for an empty slot, a deleted org and an unknown org', async () => {
      const noBranding = await seedOrg(undefined);
      const noIntro = await seedOrg(null);
      const gone = await seedOrg(await seedFilm());
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, gone));

      expect(await resolveIntroFilm(db, noBranding)).toEqual({
        ok: false,
        reason: 'empty-slot',
        film: null,
      });
      expect(await resolveIntroFilm(db, noIntro)).toEqual({
        ok: false,
        reason: 'empty-slot',
        film: null,
      });
      expect(await resolveIntroFilm(db, gone)).toEqual({
        ok: false,
        reason: 'no-org',
        film: null,
      });
      expect(
        await resolveIntroFilm(db, '00000000-0000-4000-8000-000000000000')
      ).toEqual({ ok: false, reason: 'no-org', film: null });
    });
  });

  describe('getOrgFilmStream: the public minter', () => {
    it('signs an org film token for this org and media, which no other proxy accepts', async () => {
      const film = await seedFilm();
      const orgId = await seedOrg(film);

      const stream = await access.getOrgFilmStream({ organizationId: orgId });

      expect(stream).not.toBeNull();
      const url = new URL(stream?.playlistUrl ?? '');
      expect(`${url.origin}${url.pathname}`).toBe(
        `${API}/api/access/orgs/${orgId}/film/hls/master.m3u8`
      );
      const token = url.searchParams.get('token') ?? '';
      const check = await verifyOrgFilmToken(token, SECRET);
      expect(check).toMatchObject({
        ok: true,
        payload: { organizationId: orgId, creatorId, mediaId: film },
      });
      const exp = check.ok ? check.payload.exp : 0;
      const lifetime = exp - Math.floor(Date.now() / 1000);
      expect(lifetime).toBeGreaterThan(590);
      expect(lifetime).toBeLessThanOrEqual(600);
      expect(stream?.expiresAt).toBe(new Date(exp * 1000).toISOString());
      // Domain separation: not a course film token, not a content token.
      expect(await verifyFilmToken(token, SECRET)).toEqual({
        ok: false,
        reason: 'signature',
      });
      expect(await verifyHlsToken(token, SECRET)).toBeNull();
    });

    it('answers null, never a URL, for a paid film, and logs why', async () => {
      const film = await seedFilm();
      const orgId = await seedOrg(film);
      await useIn(film, orgId, { isTeamOnly: true });
      const info = vi.spyOn(obsOf(access), 'info');
      try {
        expect(
          await access.getOrgFilmStream({ organizationId: orgId })
        ).toBeNull();
        expect(info).toHaveBeenCalledWith('Org film stream refused', {
          organizationId: orgId,
          reason: 'paid-use',
        });
      } finally {
        info.mockRestore();
      }
    });
  });
});
