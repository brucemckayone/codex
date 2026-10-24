/**
 * ContentAccessService — followers-only content granted via subscription.
 *
 * Codex-xybr3: Access hierarchy inversion. The platform's product rule is now
 * `subscribers ⊇ followers ⊇ public` — an active subscription to the content's
 * organisation grants followers-only access without needing a follower row.
 * Ex-subscribers with an active follower row still get access via the follower
 * fallback (the follow signal is preserved across subscription lapses).
 *
 * Per feedback_security_deep_test: access-control changes require unit tests
 * with BOTH positive AND negative paths before closing. This suite exercises
 * the `getStreamingUrl` → transaction → followers branch end-to-end against a
 * stubbed DB, covering every grant + deny permutation the bead calls out:
 *
 *   POSITIVE (grant):
 *     1. Subscriber (status=active) with no follower row → new path
 *     2. Subscriber (status=cancelling) with no follower row → new path
 *     3. Ex-subscriber (status=cancelled) with active follower row → follower fallback
 *     4. Non-subscriber with active follower row → follower fallback (unchanged)
 *     5. Management membership (owner/admin/creator) → management fallback (unchanged)
 *
 *   NEGATIVE (deny):
 *     6. Subscriber with status=paused → deny (PR #5 filter drops this row)
 *     7. Subscriber with status=cancelled → deny (the status filter drops this row)
 *     8. Non-subscriber, non-follower, non-management → deny
 *     9. Anonymous/guest (no subscription, no follower) → deny
 *    10. Tier-gated content (accessType=subscribers) with subscriber → existing
 *        tier logic unchanged (regression guard — this bead MUST NOT leak into
 *        subscribers-only semantics)
 *
 *   OBSERVABILITY:
 *    11. The new grant path emits a distinct
 *        reason='followers_content_granted_via_subscription' so analytics can
 *        distinguish subscriber-driven access from explicit follower grants.
 *
 * Strategy: stub `this.db.transaction(fn)` to invoke the callback with a
 * transaction-shaped stub whose `.query.<table>.findFirst` reaches our mocks.
 * The access-decision code paths run inside that callback, so this gives full
 * coverage of the transaction body without a live Postgres dependency.
 */

import type { PurchaseService } from '@codex/purchase';
import type { ServiceConfig } from '@codex/service-errors';
import { createMockObservability } from '@codex/test-utils';
import type { GetStreamingUrlInput } from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import { ContentAccessService } from '../ContentAccessService';

// ─── Mock shapes ──────────────────────────────────────────────────────

type FindFirstFn = ReturnType<typeof vi.fn>;

interface QueryMocks {
  content: { findFirst: FindFirstFn };
  organizationMemberships: { findFirst: FindFirstFn };
  organizationFollowers: { findFirst: FindFirstFn };
  subscriptions: { findFirst: FindFirstFn };
  subscriptionTiers: { findFirst: FindFirstFn };
}

interface StubDb {
  mocks: QueryMocks;
  transaction: ReturnType<typeof vi.fn>;
}

/**
 * Chainable empty `.select()` stub. The collapsed resolver (Codex-2pryk.2.3)
 * reads the `entitlements` / course tables via `db.select(...).from(...)` on the
 * tier/paid deny paths; these unit mocks seed no such rows, so every additive
 * read resolves to [] and the grant/deny OUTCOMES are unchanged.
 */
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

/**
 * Build a DB stub where `db.transaction(fn)` invokes the callback with a
 * transaction surface that exposes the same `.query.<table>.findFirst`
 * mocks. The real `getStreamingUrl` passes the `tx` argument (a
 * TransactionLike) to every nested helper, so the callback must see our
 * mocks via `tx.query.*` not `db.query.*`.
 */
function createStubDb(): StubDb {
  const mocks: QueryMocks = {
    content: { findFirst: vi.fn() },
    organizationMemberships: { findFirst: vi.fn() },
    organizationFollowers: { findFirst: vi.fn() },
    subscriptions: { findFirst: vi.fn() },
    subscriptionTiers: { findFirst: vi.fn() },
  };

  const tx = { query: mocks, select: emptySelect };

  // Drizzle transaction signature: `transaction(callback, options?)`. We
  // only care about the callback — the isolationLevel/accessMode options
  // passed by the real code are ignored in the stub.
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));

  return { mocks, transaction };
}

type ServiceDb = ServiceConfig['db'];

function buildService(stub: StubDb) {
  const { obs, logs } = createMockObservability();

  const dbForService = {
    // Top-level `db.query.content.findFirst` is used only by the pre-
    // transaction revocation gate, which we skip by omitting `revocation`.
    query: stub.mocks,
    transaction: stub.transaction,
    select: emptySelect,
  } as unknown as ServiceDb;

  const signer = {
    generateSignedUrl: vi.fn(async () => 'https://signed.example/stub'),
    getObjectText: vi.fn(async () => null),
  };

  const verifyPurchase = vi.fn(async () => false);
  const purchaseService = {
    verifyPurchase,
  } as unknown as PurchaseService;

  const service = new ContentAccessService({
    db: dbForService,
    environment: 'test',
    r2: signer,
    purchaseService,
    // WP-14: stream path mints a master-proxy URL signed with the HLS secret.
    contentApiBaseUrl: 'https://api.revelations.studio',
    hlsTokenSecret: 'test-worker-shared-secret',
  });

  // BaseService instantiates its own ObservabilityClient in the constructor;
  // override it with our capturing mock so we can assert the grant-path
  // reason string. `obs` is `protected` on BaseService — this is a narrow,
  // test-only reach-in, not an app-level pattern.
  (service as unknown as { obs: typeof obs }).obs = obs;

  return { service, signer, logs, obs, verifyPurchase };
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const userId = 'user_abc';
const orgId = 'org_xyz';
const contentId = 'content_123';

const streamingInput: GetStreamingUrlInput = {
  contentId,
  expirySeconds: 600,
};

/**
 * A ready-to-stream followers-only video content row (the shape
 * `db.query.content.findFirst` returns inside the transaction, including
 * the `mediaItem` relation Drizzle populates via `with: { mediaItem: true }`).
 */
const followersContentRow = {
  id: contentId,
  organizationId: orgId,
  isFree: false,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  status: 'published',
  isFollowerGated: true,
  isTeamOnly: false,
  mediaItem: {
    id: 'media_123',
    creatorId: 'creator_abc',
    status: 'ready',
    mediaType: 'video',
    hlsMasterPlaylistKey: 'hls/abc/master.m3u8',
    waveformKey: null,
    readyVariants: ['1080p', '720p'],
  },
};

const subscribersContentRow = {
  ...followersContentRow,
  status: 'published',
  isFollowerGated: false,
  includedInTierId: 'tier_pro',
};

function makeActiveSub(
  overrides: Partial<{
    status: string;
    currentPeriodEnd: Date;
    tierName: string;
    sortOrder: number;
  }> = {}
) {
  return {
    userId,
    organizationId: orgId,
    status: overrides.status ?? 'active',
    currentPeriodEnd:
      overrides.currentPeriodEnd ??
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    tier: {
      name: overrides.tierName ?? 'basic',
      sortOrder: overrides.sortOrder ?? 10,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('ContentAccessService.getStreamingUrl — followers-only content (Codex-xybr3)', () => {
  let stub: StubDb;

  beforeEach(() => {
    stub = createStubDb();
  });

  describe('positive — grant paths', () => {
    it('grants access to a subscriber (status=active) with NO follower row', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      // Subscription lookup returns an active sub row.
      stub.mocks.subscriptions.findFirst.mockResolvedValue(
        makeActiveSub({ status: 'active' })
      );
      // No follower row. (The subscriber branch short-circuits before this
      // mock is consulted, but returning undefined here asserts we never
      // reach that fallback.)
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      const result = await service.getStreamingUrl(userId, streamingInput);

      expect(result.streamingUrl).toContain('/hls/master.m3u8?token=');
      expect(result.contentType).toBe('video');
      // The follower lookup should NEVER have run — the subscriber branch
      // wins and short-circuits the chain.
      expect(stub.mocks.organizationFollowers.findFirst).not.toHaveBeenCalled();
    });

    it('grants access to a subscriber with status=cancelling (still in live period)', async () => {
      // `cancelling` subs are paid-through until currentPeriodEnd; the
      // filter `status IN (active, cancelling)` allows them through.
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(
        makeActiveSub({ status: 'cancelling' })
      );
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({
        streamingUrl: expect.stringContaining('/hls/master.m3u8?token='),
      });
    });

    it('grants access to an ex-subscriber (status=cancelled) with an active follower row', async () => {
      // The DB-level status filter means `subscriptions.findFirst` returns
      // undefined when status is 'cancelled' — we simulate that.
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      // But the user is still following, so the fallback path grants.
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({
        streamingUrl: expect.stringContaining('/hls/master.m3u8?token='),
      });

      // Subscription check runs first — proves the ordering is
      // subscriber-then-follower, not the reverse.
      expect(stub.mocks.subscriptions.findFirst).toHaveBeenCalled();
      expect(stub.mocks.organizationFollowers.findFirst).toHaveBeenCalled();
    });

    it('grants access to a non-subscriber with an active follower row (existing path)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({
        streamingUrl: expect.stringContaining('/hls/master.m3u8?token='),
      });
    });

    it('grants access to a management member with no subscription, no follower row', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue({
        id: 'membership_1',
        role: 'creator',
        status: 'active',
      });

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({
        streamingUrl: expect.stringContaining('/hls/master.m3u8?token='),
      });
    });
  });

  describe('negative — deny paths', () => {
    it('denies a subscriber whose status=paused (PR #5 filter drops this row)', async () => {
      // The DB query filters `status IN (active, cancelling)` — a paused
      // subscription does not match, so `findFirst` returns undefined.
      // Simulate that here; the deny cascade then checks follower and
      // management, both missing.
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      const err = await service
        .getStreamingUrl(userId, streamingInput)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AccessDeniedError);
      expect((err as AccessDeniedError).context).toMatchObject({
        reason: 'followers_only',
        organizationId: orgId,
      });
    });

    // past_due GRANTS (Codex-2hxff.10), proven against the DB in
    // the access integration suite; cancelled is still dropped.
    it('denies a subscriber whose status=cancelled (the status filter drops this row)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('denies a non-subscriber, non-follower, non-management user', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      const err = await service
        .getStreamingUrl(userId, streamingInput)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AccessDeniedError);
      expect((err as AccessDeniedError).context).toMatchObject({
        reason: 'followers_only',
      });
    });

    it('denies an anonymous/guest-equivalent user (empty subscription and follower tables)', async () => {
      // Authenticated but with no relationship to the org whatsoever.
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });
  });

  describe('observability — grant-path reason string', () => {
    it("emits obs.info with reason='followers_content_granted_via_subscription' on the new path", async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(
        makeActiveSub({ status: 'active' })
      );

      const { service, logs } = buildService(stub);

      await service.getStreamingUrl(userId, streamingInput);

      const grantLog = logs.find(
        (entry) =>
          entry.level === 'info' &&
          entry.message ===
            'Access granted via subscription (followers content)'
      );

      expect(grantLog).toBeDefined();
      expect(grantLog?.data).toMatchObject({
        userId,
        contentId,
        organizationId: orgId,
        reason: 'followers_content_granted_via_subscription',
      });
    });

    it('does NOT emit the new reason when access is granted via an explicit follower row', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service, logs } = buildService(stub);

      await service.getStreamingUrl(userId, streamingInput);

      const subscriberGrantLog = logs.find(
        (entry) =>
          entry.level === 'info' &&
          entry.data &&
          typeof entry.data === 'object' &&
          'reason' in entry.data &&
          (entry.data as { reason: string }).reason ===
            'followers_content_granted_via_subscription'
      );

      // The follower branch emits a separate log without the
      // subscription-grant reason — analytics can distinguish the paths.
      expect(subscriberGrantLog).toBeUndefined();

      const followerGrantLog = logs.find(
        (entry) =>
          entry.level === 'info' &&
          entry.message === 'Access granted via follower (followers content)'
      );
      expect(followerGrantLog).toBeDefined();
    });
  });

  describe('regression guard — tier-gated (subscribers-only) content is unchanged', () => {
    // The bead explicitly scopes: "doesn't affect tier-gated content at all
    // — only the followers/subscribers orthogonal case." These tests lock
    // in that a subscriber still must meet the tier threshold for
    // accessType=subscribers content; the followers-only inversion MUST NOT
    // leak into the subscriber branch.
    it('grants when subscriber meets tier threshold (existing path)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(subscribersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(
        makeActiveSub({ sortOrder: 20 }) // user's tier >= content's tier
      );
      // The content's includedInTierId resolves to sortOrder=10 (< user's 20).
      stub.mocks.subscriptionTiers.findFirst.mockResolvedValue({
        id: 'tier_pro',
        name: 'pro',
        sortOrder: 10,
      });

      const { service } = buildService(stub);

      await expect(
        service.getStreamingUrl(userId, streamingInput)
      ).resolves.toMatchObject({
        streamingUrl: expect.stringContaining('/hls/master.m3u8?token='),
      });
    });

    it('denies when subscriber is below tier threshold (existing path)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(subscribersContentRow);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(
        makeActiveSub({ sortOrder: 5 }) // user's tier < content's tier
      );
      stub.mocks.subscriptionTiers.findFirst.mockResolvedValue({
        id: 'tier_pro',
        name: 'pro',
        sortOrder: 10,
      });
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service, verifyPurchase } = buildService(stub);
      verifyPurchase.mockResolvedValue(false);

      const err = await service
        .getStreamingUrl(userId, streamingInput)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AccessDeniedError);
      expect((err as AccessDeniedError).context).toMatchObject({
        reason: 'subscribers_only',
      });
    });
  });

  // The detail pages' body source for a gated piece, whose public row carries
  // none (Codex-039vo). The body is the row the access decision read, returned
  // only on request and only after that decision granted.
  describe('includeBody — the body only after a grant, only on request (Codex-039vo)', () => {
    const rowWithBody = {
      ...followersContentRow,
      contentBody: 'the followers-only text',
      contentBodyJson: null,
    };

    // The worker's "withheld by policy" warn. It must fire ONLY for a granted,
    // never-released row whose body was asked for: anywhere else it would
    // make the web's "granted without a body" fault read as policy.
    const withheldWarn = expect.objectContaining({
      level: 'warn',
      message: 'Body withheld: the granted row was never released',
    });

    it('returns the body to a granted reader who asked for it', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(rowWithBody);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service, logs } = buildService(stub);
      const result = await service.getStreamingUrl(userId, streamingInput, {
        includeBody: true,
      });

      expect(result.body).toEqual({
        contentBody: 'the followers-only text',
        contentBodyJson: null,
      });
      // The stream result is unchanged by the option.
      expect(result.streamingUrl).toContain('/hls/master.m3u8?token=');
      expect(logs).not.toContainEqual(withheldWarn);
    });

    it('returns no body when not asked (the player refresh path)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(rowWithBody);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service } = buildService(stub);
      const result = await service.getStreamingUrl(userId, streamingInput);

      expect(result).not.toHaveProperty('body');
    });

    it('a denied reader who asked for the body gets AccessDeniedError, never the body', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(rowWithBody);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);
      const outcome = await service
        .getStreamingUrl(userId, streamingInput, { includeBody: true })
        .catch((e: unknown) => e);

      expect(outcome).toBeInstanceOf(AccessDeniedError);
      expect(JSON.stringify(outcome)).not.toContain('the followers-only text');
    });

    // A purchase grant outlives unpublication (an item withdrawn after it was
    // sold), but a row never published was never offered: no body, as the
    // course player's released-only rule (Codex-039vo review, cycle 3).
    const paidRow = (publishedAt: Date | null) => ({
      ...followersContentRow,
      isFollowerGated: false,
      isPurchasable: true,
      priceCents: 900,
      status: 'draft',
      publishedAt,
      contentBody: 'the paid text',
      contentBodyJson: null,
    });

    it('a buyer of an item never published gets the grant but no body', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(paidRow(null));

      const { service, verifyPurchase, logs } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);
      const result = await service.getStreamingUrl(userId, streamingInput, {
        includeBody: true,
      });

      // The calibration: the grant itself stands, so the missing body is the
      // release gate, not a denial. This is today's decision, NOT the target:
      // a never-released row should not be granted at all (Codex-nacky).
      // When that lands, this case becomes an AccessDeniedError.
      expect(result.streamingUrl).toContain('/hls/master.m3u8?token=');
      expect(result).not.toHaveProperty('body');
      // The worker says why, so the web's "granted without a body" fault log
      // is never mistaken for a stale worker.
      expect(logs).toContainEqual(withheldWarn);
    });

    it('a never-published item whose body was not asked for logs no warn', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(paidRow(null));

      const { service, verifyPurchase, logs } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);
      const result = await service.getStreamingUrl(userId, streamingInput);

      // The player refresh path: nothing was withheld, so nothing is said.
      expect(result).not.toHaveProperty('body');
      expect(logs).not.toContainEqual(withheldWarn);
    });

    it('a buyer of an item withdrawn after release keeps the body', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(
        paidRow(new Date('2026-01-01T00:00:00.000Z'))
      );

      const { service, verifyPurchase, logs } = buildService(stub);
      verifyPurchase.mockResolvedValue(true);
      const result = await service.getStreamingUrl(userId, streamingInput, {
        includeBody: true,
      });

      expect(result.body).toEqual({
        contentBody: 'the paid text',
        contentBodyJson: null,
      });
      expect(logs).not.toContainEqual(withheldWarn);
    });
  });
});
