/**
 * ContentService — "Needs you" (Codex-a6ofh.3.4)
 *
 * `attentionCounts` counts a creator's pieces by what they need, and the
 * list's `needs` filter lists them by the same rule, so a chip shows the
 * pieces it counted. Covered:
 * - each kind, a piece in one kind at most, in the row line's order;
 * - the filter lists exactly what each count counted;
 * - where the counts look (one org, personal, everywhere), and that another
 *   creator's pieces never count;
 * - `ready` mirrors the publish gate: each rule refuses in turn, and a parity
 *   check runs the real `assertPublishable` on every draft in hand.
 *
 * Each test seeds its own creator, so its counts are exact.
 */

import {
  CONTENT_ATTENTION_KINDS,
  CONTENT_STATUS,
  CONTENT_TYPES,
  type ContentAttentionKind,
  ERROR_CODES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  MEDIA_UPLOAD_STALLED_AFTER_MS,
  ORGANIZATION_STATUS,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  content,
  contentTierAccess,
  mediaItems,
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMediaItemInput,
  createTestMembershipInput,
  createTestOrganizationInput,
  createTestTierInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DatabaseTransaction,
  NewContent,
  NewMediaItem,
} from '../../types';
import { ContentService } from '../content-service';
import { assertPublishable } from '../publish-gate';

const LIVE = {
  status: CONTENT_STATUS.PUBLISHED,
  publishedAt: new Date('2026-10-01T00:00:00Z'),
} as const;

const ARTICLE_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] }],
};
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('ContentService — Needs you (Codex-a6ofh.3.4)', () => {
  let db: Database;
  let service: ContentService;

  beforeAll(() => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function newCreator(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    return id;
  }

  async function newOrg(memberId?: string): Promise<string> {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    if (memberId) {
      await db
        .insert(organizationMemberships)
        .values(
          createTestMembershipInput(org.id, memberId, { role: 'creator' })
        );
    }
    return org.id;
  }

  async function media(
    creatorId: string,
    overrides: Partial<NewMediaItem> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(createTestMediaItemInput(creatorId, overrides))
        .returning({ id: mediaItems.id })
    );
    return row.id;
  }

  async function piece(
    creatorId: string,
    overrides: Partial<NewContent> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(content)
        .values(createTestContentInput(creatorId, overrides))
        .returning({ id: content.id })
    );
    return row.id;
  }

  /** A video draft playing a new media item of the creator's. */
  async function videoDraft(
    creatorId: string,
    mediaOverrides: Partial<NewMediaItem>,
    overrides: Partial<NewContent> = {}
  ): Promise<string> {
    const mediaItemId = await media(creatorId, mediaOverrides);
    return piece(creatorId, {
      contentType: CONTENT_TYPES.VIDEO,
      mediaItemId,
      ...overrides,
    });
  }

  /** The ids the list's `needs` filter lists, sorted. */
  async function listed(
    creatorId: string,
    needs: ContentAttentionKind,
    organizationId?: string | null
  ): Promise<string[]> {
    const page = await service.list(
      creatorId,
      { needs, ...(organizationId !== undefined ? { organizationId } : {}) },
      { page: 1, limit: 100 }
    );
    return page.items.map((row) => row.id).sort();
  }

  const sorted = (ids: string[]) => [...ids].sort();

  it('counts each kind, a piece in one kind at most, and the filter lists exactly what it counted', async () => {
    const creatorId = await newCreator();
    const otherId = await newCreator();
    const stalledAt = new Date(
      Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
    );

    const expected: Record<ContentAttentionKind, string[]> = {
      'live-media-gone': [
        await videoDraft(
          creatorId,
          { status: MEDIA_STATUS.READY, deletedAt: new Date() },
          LIVE
        ),
        await videoDraft(creatorId, { status: MEDIA_STATUS.FAILED }, LIVE),
      ],
      // A schedule waits on media still processing: scheduled, not processing.
      scheduled: [
        await videoDraft(
          creatorId,
          { status: MEDIA_STATUS.TRANSCODING },
          { publishRequestedAt: new Date() }
        ),
      ],
      'didnt-go-live': [
        await videoDraft(
          creatorId,
          { status: MEDIA_STATUS.FAILED },
          { publishBlockedReason: ERROR_CODES.MEDIA_FAILED }
        ),
      ],
      'media-gone': [
        await videoDraft(creatorId, {
          status: MEDIA_STATUS.READY,
          deletedAt: new Date(),
        }),
        await videoDraft(creatorId, { status: MEDIA_STATUS.FAILED }),
        await videoDraft(creatorId, {
          status: MEDIA_STATUS.UPLOADING,
          createdAt: stalledAt,
        }),
        // Another creator's item, still processing (the old PATCH hole,
        // Codex-vmi6m): the gate refuses it as not found, so it needs new
        // media, and is never on its way.
        await piece(creatorId, {
          contentType: CONTENT_TYPES.VIDEO,
          mediaItemId: await media(otherId, {
            status: MEDIA_STATUS.TRANSCODING,
          }),
        }),
      ],
      processing: [
        await videoDraft(creatorId, { status: MEDIA_STATUS.TRANSCODING }),
        await videoDraft(creatorId, {
          status: MEDIA_STATUS.UPLOADED,
          mediaType: MEDIA_TYPES.AUDIO,
        }),
        await videoDraft(creatorId, { status: MEDIA_STATUS.UPLOADING }),
      ],
      ready: [
        await videoDraft(creatorId, { status: MEDIA_STATUS.READY }),
        await piece(creatorId, {
          contentType: CONTENT_TYPES.WRITTEN,
          contentBodyJson: ARTICLE_DOC,
        }),
      ],
    };
    // In no kind: a video draft with no media, an article with nothing to
    // read, a live piece whose media is fine.
    await piece(creatorId, { contentType: CONTENT_TYPES.VIDEO });
    await piece(creatorId, {
      contentType: CONTENT_TYPES.WRITTEN,
      contentBody: null,
      contentBodyJson: EMPTY_DOC,
    });
    await videoDraft(creatorId, { status: MEDIA_STATUS.READY }, LIVE);

    const counts = await service.attentionCounts(creatorId);
    for (const kind of CONTENT_ATTENTION_KINDS) {
      expect(counts[kind], kind).toBe(expected[kind].length);
      expect(await listed(creatorId, kind), kind).toEqual(
        sorted(expected[kind])
      );
    }
  });

  it('counts where the list looks, and never another creator’s pieces', async () => {
    const creatorId = await newCreator();
    const otherId = await newCreator();
    const orgId = await newOrg(creatorId);
    const ready = { status: MEDIA_STATUS.READY } as const;

    const personal = await videoDraft(creatorId, ready);
    const inOrg = await videoDraft(creatorId, ready, { organizationId: orgId });
    // The other creator has a piece of every kind; none is this creator's.
    const failed = { status: MEDIA_STATUS.FAILED } as const;
    const transcoding = { status: MEDIA_STATUS.TRANSCODING } as const;
    await videoDraft(otherId, failed, LIVE);
    await videoDraft(otherId, transcoding, { publishRequestedAt: new Date() });
    await videoDraft(otherId, failed, {
      publishBlockedReason: ERROR_CODES.MEDIA_FAILED,
    });
    await videoDraft(otherId, failed);
    await videoDraft(otherId, transcoding);
    await videoDraft(otherId, ready);

    const none = Object.fromEntries(
      CONTENT_ATTENTION_KINDS.map((kind) => [kind, 0])
    );
    expect(await service.attentionCounts(creatorId)).toEqual({
      ...none,
      ready: 2,
    });
    for (const kind of CONTENT_ATTENTION_KINDS) {
      expect(await listed(creatorId, kind), kind).toEqual(
        kind === 'ready' ? sorted([personal, inOrg]) : []
      );
    }
    expect(await service.attentionCounts(otherId)).toEqual(
      Object.fromEntries(CONTENT_ATTENTION_KINDS.map((kind) => [kind, 1]))
    );
    expect((await service.attentionCounts(creatorId, null)).ready).toBe(1);
    expect((await service.attentionCounts(creatorId, orgId)).ready).toBe(1);
    expect(await listed(creatorId, 'ready', null)).toEqual([personal]);
    expect(await listed(creatorId, 'ready', orgId)).toEqual([inOrg]);
  });

  it('ready holds every publish rule, and agrees with the publish gate on every draft', async () => {
    const creatorId = await newCreator();
    const otherId = await newCreator();
    const orgId = await newOrg(creatorId);
    const leftOrgId = await newOrg(creatorId);
    await db
      .update(organizationMemberships)
      .set({ status: ORGANIZATION_STATUS.INACTIVE })
      .where(
        and(
          eq(organizationMemberships.organizationId, leftOrgId),
          eq(organizationMemberships.userId, creatorId)
        )
      );
    const ready = { status: MEDIA_STATUS.READY } as const;
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning({ id: subscriptionTiers.id })
    );
    const deletedVideo = await media(creatorId, {
      ...ready,
      deletedAt: new Date(),
    });
    const liveVideo = await media(creatorId, ready);
    const frameOf = (mediaId: string) =>
      `https://cdn.test/${creatorId}/media-thumbnails/${mediaId}/frame-02.webp`;

    // Refused by one rule each, before the creator can be paid.
    const refused = {
      leftTheTeam: await videoDraft(creatorId, ready, {
        organizationId: leftOrgId,
      }),
      othersMedia: await piece(creatorId, {
        contentType: CONTENT_TYPES.VIDEO,
        mediaItemId: await media(otherId, ready),
      }),
      underAPound: await videoDraft(creatorId, ready, {
        isFree: false,
        isPurchasable: true,
        priceCents: 50,
      }),
      inNoTier: await videoDraft(creatorId, ready, {
        organizationId: orgId,
        isFree: false,
        isTierGated: true,
      }),
      forSaleUnpaid: await videoDraft(creatorId, ready, {
        isFree: false,
        isPurchasable: true,
        priceCents: 500,
      }),
      coverFromADeletedVideo: await videoDraft(creatorId, ready, {
        thumbnailUrl: frameOf(deletedVideo),
      }),
      nothingToRead: await piece(creatorId, {
        contentType: CONTENT_TYPES.WRITTEN,
        contentBody: '<p> </p>',
      }),
    };
    const inATier = await videoDraft(creatorId, ready, {
      organizationId: orgId,
      isFree: false,
      isTierGated: true,
    });
    await db
      .insert(contentTierAccess)
      .values({ contentId: inATier, tierId: tier.id, organizationId: orgId });
    const passing = [
      await videoDraft(creatorId, ready, { thumbnailUrl: frameOf(liveVideo) }),
      // An org piece whose creator is on the team.
      await videoDraft(creatorId, ready, { organizationId: orgId }),
      await piece(creatorId, {
        contentType: CONTENT_TYPES.WRITTEN,
        contentBody: 'Legacy text',
      }),
    ];

    expect(await listed(creatorId, 'ready')).toEqual(sorted(passing));

    // Payouts set up: what was refused only for want of them passes now.
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));
    expect(await listed(creatorId, 'ready')).toEqual(
      sorted([...passing, inATier, refused.forSaleUnpaid])
    );

    // Parity: on every draft in hand, ready iff the real gate passes it now.
    const readyIds = new Set(await listed(creatorId, 'ready'));
    const drafts = await db.query.content.findMany({
      where: and(
        eq(content.creatorId, creatorId),
        eq(content.status, CONTENT_STATUS.DRAFT)
      ),
    });
    expect(drafts.length).toBe(
      Object.keys(refused).length + passing.length + 1
    );
    // Held as the service holds its db, the client union (an upcast: the
    // test client is one of its members, and an annotation would narrow it
    // back), whose transaction goes to the gate as content-service.ts's does.
    const client = db as DatabaseClient;
    for (const row of drafts) {
      const gatePasses = await client
        .transaction((tx) =>
          assertPublishable(tx as DatabaseTransaction, {
            ...row,
            mediaItem: row.mediaItemId ? { id: row.mediaItemId } : null,
          })
        )
        .then(
          (readiness) => readiness === 'now',
          () => false
        );
      expect(readyIds.has(row.id), row.id).toBe(gatePasses);
    }
  });

  it('a filter value with nothing to show lists nothing', async () => {
    const creatorId = await newCreator();
    await piece(creatorId, { contentType: CONTENT_TYPES.VIDEO });
    expect(await listed(creatorId, 'ready')).toEqual([]);
    expect((await service.attentionCounts(creatorId)).ready).toBe(0);
  });

  it('refuses needs on a browse list, which spans creators', async () => {
    const creatorId = await newCreator();
    const orgId = await newOrg(creatorId);
    await expect(
      service.list(
        creatorId,
        { organizationId: orgId, needs: 'ready' },
        { page: 1, limit: 10 },
        { scope: 'browse' }
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
