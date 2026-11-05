/**
 * A creator's preview of their own media (Codex-a6ofh.1.5), against a real
 * database: `getMediaPreviewStream` is creator-scoped, and that read is the
 * whole gate. Media is personal (no org column), so only its creator may play
 * it here, whatever uses it, paid content included.
 *
 * Pinned here because only a real query proves the scoping: another creator's
 * media id, a deleted item and an unknown id must be the SAME 404, so an id
 * probe learns nothing. The proxies that open the minted URL are pinned in
 * workers/content-api content-access-media-preview.test.ts.
 */

import { mediaItems } from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import { PurchaseService } from '@codex/purchase';
import {
  createTestMediaItemInput,
  createTestMoneyDeps,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyHlsToken, verifyMediaPreviewToken } from '../../hls-token';
import {
  ContentAccessService,
  MEDIA_PREVIEW_TTL_SECONDS,
} from '../ContentAccessService';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];

const obsOf = (service: ContentAccessService) =>
  (service as unknown as { obs: ObservabilityClient }).obs;
type NewMedia = Parameters<typeof createTestMediaItemInput>[1];

const API = 'https://api.example.test';
const SECRET = 'test-media-preview-secret';

describe('media preview (Codex-a6ofh.1.5)', () => {
  let db: Database;
  let creatorId: string;
  let otherCreatorId: string;

  /** The waveform is the only thing the minter presigns: a marked URL. */
  const r2 = {
    generateSignedUrl: async (key: string, ttl: number) =>
      `https://r2.example.test/${key}?ttl=${ttl}`,
    getObjectText: async () => {
      throw new Error('the minter reads no playlist');
    },
  } as unknown as R2;

  function accessWith(config: { hlsTokenSecret?: string } = {}) {
    return new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService: new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        {} as Stripe
      ),
      contentApiBaseUrl: API,
      hlsTokenSecret:
        'hlsTokenSecret' in config ? config.hlsTokenSecret : SECRET,
    });
  }

  async function seedMedia(owner: string, overrides: NewMedia = {}) {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(owner, {
          mediaType: 'video',
          status: 'ready',
          ...overrides,
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error('failed to seed media');
    return row.id;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creator, other] = await seedTestUsers(db, 2);
    if (!creator || !other) throw new Error('failed to seed the creators');
    creatorId = creator;
    otherCreatorId = other;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it("mints a preview of the creator's own ready video: the preview proxy URL, its token bound to the media", async () => {
    const mediaId = await seedMedia(creatorId, {
      readyVariants: ['720p', '480p'],
    });
    const before = Math.floor(Date.now() / 1000);

    const preview = await accessWith().getMediaPreviewStream(
      creatorId,
      mediaId
    );

    const url = new URL(preview.playlistUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${API}/api/access/media/${mediaId}/hls/master.m3u8`
    );
    const token = url.searchParams.get('token') ?? '';
    const check = await verifyMediaPreviewToken(token, SECRET);
    expect(check).toMatchObject({
      ok: true,
      payload: { creatorId, mediaId },
    });
    // 15 minutes, and the response says when.
    const exp = check.ok ? check.payload.exp : 0;
    expect(exp - before).toBeGreaterThanOrEqual(MEDIA_PREVIEW_TTL_SECONDS);
    expect(exp - before).toBeLessThanOrEqual(MEDIA_PREVIEW_TTL_SECONDS + 2);
    expect(preview.expiresAt).toBe(new Date(exp * 1000).toISOString());
    // A preview token is no content-stream credential.
    expect(await verifyHlsToken(token, SECRET)).toBeNull();

    expect(preview).toMatchObject({
      mediaType: 'video',
      waveformUrl: null,
      readyVariants: ['720p', '480p'],
    });
  });

  it("presigns an audio item's waveform for the token's life", async () => {
    const mediaId = await seedMedia(creatorId, { mediaType: 'audio' });

    const preview = await accessWith().getMediaPreviewStream(
      creatorId,
      mediaId
    );

    expect(preview.mediaType).toBe('audio');
    expect(preview.waveformUrl).toMatch(
      new RegExp(
        `^https://r2\\.example\\.test/waveforms/.+\\?ttl=${MEDIA_PREVIEW_TTL_SECONDS}$`
      )
    );
  });

  it("is the same 404 for another creator's media, a deleted item and an unknown id", async () => {
    const theirs = await seedMedia(otherCreatorId);
    const deleted = await seedMedia(creatorId, { deletedAt: new Date() });
    const unknown = '9f000000-0000-4000-8000-000000000000';

    for (const mediaId of [theirs, deleted, unknown]) {
      const access = accessWith();
      const info = vi.spyOn(obsOf(access), 'info');
      await expect(
        access.getMediaPreviewStream(creatorId, mediaId)
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
        // MediaNotFoundError's shape: the same 404 as every /api/media/:id.
        context: { mediaItemId: mediaId },
      });
      // A 4xx reaches no log by itself: the probe leaves this line.
      expect(info).toHaveBeenCalledWith('Media preview refused', {
        creatorId,
        mediaItemId: mediaId,
        reason: 'not-found',
      });
    }
    // Their own creator still gets it: the 404 above is the scope, not the row.
    await expect(
      accessWith().getMediaPreviewStream(otherCreatorId, theirs)
    ).resolves.toMatchObject({ mediaType: 'video' });
  });

  it('refuses media that is not ready, naming its status', async () => {
    const mediaId = await seedMedia(creatorId, { status: 'transcoding' });

    await expect(
      accessWith().getMediaPreviewStream(creatorId, mediaId)
    ).rejects.toMatchObject({
      code: 'MEDIA_NOT_READY',
      statusCode: 422,
      context: { mediaId, status: 'transcoding' },
    });
  });

  it('fails closed, with no URL, when the signing secret is unbound, and says which setting', async () => {
    const mediaId = await seedMedia(creatorId);
    const access = accessWith({ hlsTokenSecret: undefined });
    const error = vi.spyOn(obsOf(access), 'error');

    await expect(
      access.getMediaPreviewStream(creatorId, mediaId)
    ).rejects.toMatchObject({
      statusCode: 500,
      // The misconfiguration branch, not a signing failure caught later.
      cause: { message: 'HLS streaming proxy is not configured' },
    });
    expect(error).toHaveBeenCalledWith('Failed to mint media preview', {
      mediaItemId: mediaId,
      errorName: 'MisconfiguredStreamingProxy',
      errorMessage: 'missing hlsTokenSecret',
    });
  });
});
