/**
 * Codex-p3m5j — a one-off PURCHASE outlives unpublication; a relationship does not.
 *
 * Owner decision, 2026-09-23: "those who have purchased as a one off should be
 * able to keep [it]". The principle: a one-off payment BUYS that item, whereas
 * a subscription, a follow, a free listing or a staff role grants access *while
 * the item is on offer*. Unpublishing withdraws the offer; it does not undo a
 * sale.
 *
 * ## What was wrong
 *
 * `resolveHasContentAccess` and `getStreamingUrl` both self-fetched the content
 * row with `eq(content.status, PUBLISHED)` and treated a miss as "no such
 * content", so unpublishing revoked playback from everyone — including a buyer
 * with a completed purchase.
 *
 * The sharp edge: `library.ts`'s purchased arm NEVER filtered on
 * `content.status`, so the item stayed on the buyer's library shelf and then
 * 404'd when opened. The platform was showing people something they had paid
 * for and refusing to play it.
 *
 * ## Why these tests matter more than most
 *
 * The change REMOVES a predicate from an access path, which is how a paywall
 * reopens (cf. Codex-0biug, a P0 bypass from an access flag never being set).
 * So the negative cases here are the real product: every non-purchase arm, and
 * the anonymous caller, must still be denied unpublished content. A suite that
 * only proved the buyer gets in would be worthless.
 *
 * DB-free by construction — the stub harness mirrors
 * content-access-service-followers-subscription.test.ts, so this runs locally
 * rather than first executing in CI (Codex-bsbf8).
 */

import { content } from '@codex/database/schema';
import type { PurchaseService } from '@codex/purchase';
import type { ServiceConfig } from '@codex/service-errors';
import { createMockObservability } from '@codex/test-utils';
import type { GetStreamingUrlInput } from '@codex/validation';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import { ContentAccessService } from '../ContentAccessService';

type FindFirstFn = ReturnType<typeof vi.fn>;

interface QueryMocks {
  content: { findFirst: FindFirstFn };
  organizationMemberships: { findFirst: FindFirstFn };
  organizationFollowers: { findFirst: FindFirstFn };
  subscriptions: { findFirst: FindFirstFn };
  subscriptionTiers: { findFirst: FindFirstFn };
}

/** Chainable empty `.select()` — the additive entitlement/course reads. */
function emptySelect() {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    limit: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mimics Drizzle's awaitable query builder so `await db.select()...` resolves to [].
    then: (resolve: (rows: never[]) => unknown) => resolve([]),
  };
  return builder;
}

function createStubDb() {
  const mocks: QueryMocks = {
    content: { findFirst: vi.fn() },
    organizationMemberships: { findFirst: vi.fn() },
    organizationFollowers: { findFirst: vi.fn() },
    subscriptions: { findFirst: vi.fn() },
    subscriptionTiers: { findFirst: vi.fn() },
  };
  const tx = { query: mocks, select: emptySelect };
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));
  return { mocks, transaction };
}

function buildService(stub: ReturnType<typeof createStubDb>) {
  const { obs } = createMockObservability();
  const dbForService = {
    query: stub.mocks,
    transaction: stub.transaction,
    select: emptySelect,
  } as unknown as ServiceConfig['db'];

  const verifyPurchase = vi.fn(async () => false);
  const service = new ContentAccessService({
    db: dbForService,
    environment: 'test',
    r2: {
      generateSignedUrl: vi.fn(async () => 'https://signed.example/stub'),
      getObjectText: vi.fn(async () => null),
    },
    purchaseService: { verifyPurchase } as unknown as PurchaseService,
    contentApiBaseUrl: 'https://api.revelations.studio',
    hlsTokenSecret: 'test-worker-shared-secret',
  });
  (service as unknown as { obs: typeof obs }).obs = obs;
  return { service, verifyPurchase };
}

const userId = 'user_abc';
const orgId = 'org_xyz';
const contentId = 'content_123';
const streamingInput: GetStreamingUrlInput = { contentId, expirySeconds: 600 };

const mediaItem = {
  id: 'media_123',
  creatorId: 'creator_abc',
  status: 'ready',
  mediaType: 'video',
  hlsMasterPlaylistKey: 'hls/abc/master.m3u8',
  waveformKey: null,
  readyVariants: ['1080p', '720p'],
};

/** A PAID item, `status` overridable — the shape the tx self-fetch returns. */
function paidRow(status: string) {
  return {
    id: contentId,
    organizationId: orgId,
    status,
    isFree: false,
    isPurchasable: true,
    priceCents: 2499,
    includedInTierId: null,
    isFollowerGated: false,
    isTeamOnly: false,
    courseOnly: false,
    mediaItem,
  };
}

/** A FREE item — the arm an anonymous visitor would otherwise reach. */
function freeRow(status: string) {
  return {
    ...paidRow(status),
    isFree: true,
    isPurchasable: false,
    priceCents: null,
  };
}

/** A TIER-GATED item — the subscription arm. */
function tierRow(status: string) {
  return { ...paidRow(status), includedInTierId: 'tier_pro' };
}

/** A FOLLOWER-GATED item. */
function followerRow(status: string) {
  return { ...freeRow(status), isFollowerGated: true };
}

function noRelationships(stub: ReturnType<typeof createStubDb>) {
  stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
  stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
  stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);
}

describe('Codex-p3m5j: a one-off purchase outlives unpublication', () => {
  let stub: ReturnType<typeof createStubDb>;

  beforeEach(() => {
    stub = createStubDb();
  });

  describe('the purchase survives', () => {
    for (const status of ['draft', 'archived']) {
      it(`grants a completed purchaser playback of ${status} content`, async () => {
        stub.mocks.content.findFirst.mockResolvedValue(paidRow(status));
        noRelationships(stub);
        const { service, verifyPurchase } = buildService(stub);
        verifyPurchase.mockResolvedValue(true);

        const result = await service.getStreamingUrl(userId, streamingInput);

        expect(result.streamingUrl).toBeTruthy();
        // The purchase must be what was consulted — not an accidental
        // fallthrough to the free arm because a flag was misread.
        expect(verifyPurchase).toHaveBeenCalled();
      });
    }

    it('still grants a purchaser PUBLISHED content — no regression', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(paidRow('published'));
      noRelationships(stub);
      const { service, verifyPurchase } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({ streamingUrl: expect.any(String) });
    });
  });

  describe('every NON-purchase arm is still denied — the real product here', () => {
    it('DENIES a subscriber unpublished tier-gated content', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(tierRow('draft'));
      stub.mocks.subscriptions.findFirst.mockResolvedValue({
        userId,
        organizationId: orgId,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 7 * 864e5),
        tier: { name: 'pro', sortOrder: 10 },
      });
      stub.mocks.subscriptionTiers.findFirst.mockResolvedValue({
        sortOrder: 10,
      });
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);
      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toThrow(AccessDeniedError);
    });

    it('DENIES a follower unpublished follower-gated content', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followerRow('draft'));
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follow_1',
      });
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);
      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toThrow(AccessDeniedError);
    });

    it('DENIES a management member unpublished content — unchanged from before', async () => {
      // Streaming an unpublished item already 404'd for staff, because the
      // status predicate applied to everyone. Keeping `*_management` out of
      // the survivors preserves that rather than quietly widening it: drafts
      // are previewed through the studio, not through a signed stream.
      stub.mocks.content.findFirst.mockResolvedValue(paidRow('draft'));
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue({
        id: 'member_1',
        role: 'owner',
      });
      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toThrow(AccessDeniedError);
    });

    it('DENIES unpublished FREE content to a user with no purchase', async () => {
      // The most dangerous case. Free content grants via the `free`
      // fallthrough, which every caller reaches — so if `free` had been
      // classified as surviving, every draft on the platform would have become
      // readable by anyone with the id.
      stub.mocks.content.findFirst.mockResolvedValue(freeRow('draft'));
      noRelationships(stub);
      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toThrow(AccessDeniedError);
    });

    it('still GRANTS free content while it is published — the control', async () => {
      // Without this the previous case could pass because free content is
      // broken outright rather than because the publication rule works.
      stub.mocks.content.findFirst.mockResolvedValue(freeRow('published'));
      noRelationships(stub);
      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({ streamingUrl: expect.any(String) });
    });
  });

  describe('deletion is not withdrawal', () => {
    it('a soft-deleted row is unreachable even WITH a purchase', async () => {
      // `isNull(deletedAt)` was deliberately kept in both self-fetches, so a
      // deleted item never reaches the decision at all — the fetch misses and
      // the caller sees "not found", not "denied".
      stub.mocks.content.findFirst.mockResolvedValue(undefined);
      noRelationships(stub);
      const { service, verifyPurchase } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toThrow();
      // The purchase is never consulted, because there is nothing to consult
      // it about — proving the deletedAt filter runs ahead of the rule.
      expect(verifyPurchase).not.toHaveBeenCalled();
    });
  });
  /**
   * The predicate removal itself — the half the stub CANNOT otherwise see.
   *
   * `findFirst` here is a `vi.fn()` that ignores its `where`, so it hands back
   * a draft row whether or not the production code filters on status. That is
   * why the grant cases above pass against pre-fix source too: they prove the
   * RULE, not the FETCH. Re-adding `eq(content.status, PUBLISHED)` to either
   * self-fetch would make the rule dead code and no test above would notice.
   *
   * So this inspects the actual SQL the code built and asserts which COLUMNS
   * its WHERE constrains. Not a source grep — the real drizzle object the
   * consumer receives.
   */
  describe('the fetch must not re-acquire a status predicate', () => {
    /** Column names referenced anywhere in a drizzle SQL condition. */
    function columnsIn(sql: unknown): string[] {
      const out: string[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as {
          name?: string;
          table?: unknown;
          queryChunks?: unknown[];
        };
        if (n.name && n.table) {
          out.push(n.name);
          return;
        }
        for (const chunk of n.queryChunks ?? []) walk(chunk);
        if (Array.isArray(node)) node.forEach(walk);
      };
      walk(sql);
      return out;
    }

    it('CALIBRATION: columnsIn detects a status predicate when one is present', () => {
      // Without this the assertions below could pass because the walker
      // returns nothing at all, which is the vacuity this guard exists to
      // avoid.
      expect(
        columnsIn(and(eq(content.id, 'x'), isNull(content.deletedAt)))
      ).toEqual(['id', 'deleted_at']);
      expect(
        columnsIn(
          and(
            eq(content.id, 'x'),
            eq(content.status, 'published'),
            isNull(content.deletedAt)
          )
        )
      ).toContain('status');
    });

    it('getStreamingUrl filters on deletedAt but NOT on status', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(paidRow('published'));
      noRelationships(stub);
      const { service, verifyPurchase } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);

      await service.getStreamingUrl(userId, streamingInput);

      const call = stub.mocks.content.findFirst.mock.calls[0]?.[0] as {
        where: unknown;
      };
      const cols = columnsIn(call.where);
      expect(cols).toContain('deleted_at');
      expect(cols).not.toContain('status');
    });

    it('hasContentAccess filters on deletedAt but NOT on status', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(paidRow('published'));
      noRelationships(stub);
      const { service, verifyPurchase } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);

      await service.hasContentAccess(userId, contentId);

      const call = stub.mocks.content.findFirst.mock.calls[0]?.[0] as {
        where: unknown;
      };
      const cols = columnsIn(call.where);
      expect(cols).toContain('deleted_at');
      expect(cols).not.toContain('status');
    });
  });
});
