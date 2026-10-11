/**
 * `getStreamingUrl` decides ACCESS before it looks at the media (Codex-h3ipg).
 *
 * The web content page reads a 422 `MEDIA_NOT_READY` as "granted, nothing
 * playable yet": it renders the body and an "isn't ready to play" state instead
 * of a paywall. That is only sound while the media check runs AFTER
 * `assertStreamingAccess`. If the order ever flipped, a viewer with no access
 * would get the 422 and the page would treat it as a grant, failing OPEN.
 *
 * REAL Neon coverage on a paid video whose media is still transcoding:
 *   - a viewer who has not bought it gets `AccessDeniedError`, NEVER the 422;
 *   - a buyer gets `MediaNotReadyForStreamingError`.
 * Signing never runs, because both calls throw before it, so R2 is a stub
 * that fails the test if it is touched.
 */

import { content, mediaItems, organizations } from '@codex/database/schema';
import type { PurchaseService } from '@codex/purchase';
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
import {
  AccessDeniedError,
  MediaNotReadyForStreamingError,
} from '../../errors';
import { ContentAccessService } from '../ContentAccessService';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];

describe('getStreamingUrl checks access before media readiness (Codex-h3ipg)', () => {
  let db: Database;
  let svc: ContentAccessService;
  let buyerId: string;
  let strangerId: string;
  let contentId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creatorId, buyer, stranger] = await seedTestUsers(db, 3);
    if (!creatorId || !buyer || !stranger) {
      throw new Error('failed to seed test users');
    }
    buyerId = buyer;
    strangerId = stranger;

    const purchaseService = {
      verifyPurchase: async (_contentId: string, userId: string) =>
        userId === buyerId,
    } as unknown as PurchaseService;
    const r2 = new Proxy(
      {},
      {
        get: () => {
          throw new Error('signing ran: the stream call got past both checks');
        },
      }
    ) as R2;
    svc = new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Not ready org', slug: createUniqueSlug('notready') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');

    const [media] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'video',
          status: 'transcoding',
        })
      )
      .returning({ id: mediaItems.id });
    if (!media) throw new Error('failed to seed media');

    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: org.id,
          contentType: 'video',
          mediaItemId: media.id,
          isFree: false,
          isPurchasable: true,
          priceCents: 900,
          status: 'published',
          publishedAt: new Date(),
        })
      )
      .returning({ id: content.id });
    if (!row) throw new Error('failed to seed content');
    contentId = row.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('denies a viewer who has not bought it, never reporting the media state', async () => {
    const call = svc.getStreamingUrl(strangerId, { contentId });
    await expect(call).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(call).rejects.not.toBeInstanceOf(
      MediaNotReadyForStreamingError
    );
  });

  it('tells a buyer the media is not ready', async () => {
    await expect(
      svc.getStreamingUrl(buyerId, { contentId })
    ).rejects.toBeInstanceOf(MediaNotReadyForStreamingError);
  });
});
