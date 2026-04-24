/**
 * ContentAccessService.savePlaybackProgress — access gate tests.
 *
 * Covers Phase 4.1 of docs/subscription-cache-audit/phase-2-followup.md:
 * the progress-save path MUST reject users without current access OR
 * with a revocation key present, before touching videoPlayback.
 *
 * Strategy: stub `this.db` with just enough shape to exercise the two
 * gates without a real Postgres/Neon dependency. The access-decision
 * queries (content row, subscriptions, memberships, followers) all flow
 * through `db.query.<table>.findFirst` and `purchaseService.verifyPurchase`,
 * so we intercept those with vitest mocks and assert the gate outcomes.
 *
 * Per feedback_security_deep_test: positive and negative paths both
 * required — this suite covers:
 *   1. Positive — active user saves progress → write runs
 *   2. Negative: cancelled — no active subscription → ForbiddenError
 *   3. Negative: revoked — revocation key present → ForbiddenError
 *   4. Negative: expired — currentPeriodEnd in past → ForbiddenError
 *   5. Boundary: revocation set AND no DB access → each gate can trigger
 *      independently (two sub-tests, one isolating each path)
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { PurchaseService } from '@codex/purchase';
import {
  BaseService as _BaseService,
  ForbiddenError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { SavePlaybackProgressInput } from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessRevocation, type Revocation } from '../access-revocation';
import { ContentAccessService } from '../ContentAccessService';

// Silence the BaseService import-lint; it's used transitively by the service.
void _BaseService;

// ─── Mock shapes ──────────────────────────────────────────────────────

type FindFirstFn = ReturnType<typeof vi.fn>;

interface QueryMocks {
  content: { findFirst: FindFirstFn };
  organizationMemberships: { findFirst: FindFirstFn };
  organizationFollowers: { findFirst: FindFirstFn };
  subscriptions: { findFirst: FindFirstFn };
  subscriptionTiers: { findFirst: FindFirstFn };
}

interface InsertSpy {
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
}

interface StubDb {
  mocks: QueryMocks;
  insert: ReturnType<typeof vi.fn>;
  insertSpy: InsertSpy;
}

function createStubDb(): StubDb {
  const mocks: QueryMocks = {
    content: { findFirst: vi.fn() },
    organizationMemberships: { findFirst: vi.fn() },
    organizationFollowers: { findFirst: vi.fn() },
    subscriptions: { findFirst: vi.fn() },
    subscriptionTiers: { findFirst: vi.fn() },
  };

  // `.insert(table).values(...).onConflictDoUpdate(...)` — chainable,
  // but we only need to know it was invoked. The final .onConflictDoUpdate
  // returns a promise-like so `await` resolves cleanly.
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  return {
    mocks,
    insert,
    insertSpy: { values, onConflictDoUpdate },
  };
}

type ServiceDb = ServiceConfig['db'];

function buildService(stub: StubDb, revocation?: AccessRevocation) {
  const dbForService = {
    query: stub.mocks,
    insert: stub.insert,
  } as unknown as ServiceDb;

  const verifyPurchase = vi.fn(async () => false);
  const purchaseService = {
    verifyPurchase,
  } as unknown as PurchaseService;

  const service = new ContentAccessService({
    db: dbForService,
    environment: 'test',
    r2: { generateSignedUrl: vi.fn() },
    purchaseService,
    revocation,
  });

  return { service, verifyPurchase };
}

function createStubKv(initial: Record<string, string> = {}): {
  kv: KVNamespace;
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const put = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  const del = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const kv = { get, put, delete: del } as unknown as KVNamespace;
  return { kv, store, get };
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const userId = 'user_abc';
const orgId = 'org_xyz';
const contentId = 'content_123';
const revocationKey = `revoked:user:${userId}:${orgId}`;

const subscribersContent = {
  id: contentId,
  organizationId: orgId,
  accessType: 'subscribers',
  priceCents: null,
  minimumTierId: null,
};

const progressInput: SavePlaybackProgressInput = {
  contentId,
  positionSeconds: 42,
  durationSeconds: 600,
  completed: false,
};

const activeSub = {
  userId,
  organizationId: orgId,
  status: 'active',
  currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  tier: { name: 'pro', sortOrder: 10 },
};

// ─── Tests ────────────────────────────────────────────────────────────

describe('ContentAccessService.savePlaybackProgress — access gate', () => {
  let stub: StubDb;

  beforeEach(() => {
    stub = createStubDb();
  });

  it('allows a user with an active subscription to save progress', async () => {
    // content row — subscriber-gated, in org
    stub.mocks.content.findFirst.mockResolvedValue(subscribersContent);
    // active subscription exists (any tier ok because minimumTierId = null)
    stub.mocks.subscriptions.findFirst.mockResolvedValue(activeSub);

    const { service } = buildService(stub);

    await expect(
      service.savePlaybackProgress(userId, progressInput)
    ).resolves.toBeUndefined();

    // The upsert must run exactly once — access gate passed.
    expect(stub.insert).toHaveBeenCalledTimes(1);
    expect(stub.insertSpy.values).toHaveBeenCalledTimes(1);
    expect(stub.insertSpy.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects a cancelled user (no active subscription, no purchase)', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(subscribersContent);
    // No active subscription row returned — user cancelled and it's lapsed.
    stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
    // No management membership either.
    stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

    const { service, verifyPurchase } = buildService(stub);
    verifyPurchase.mockResolvedValue(false);

    await expect(
      service.savePlaybackProgress(userId, progressInput)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Upsert must NOT run — the gate short-circuits before the DB write.
    expect(stub.insert).not.toHaveBeenCalled();
  });

  it('rejects when a revocation key is present (even with a live sub record)', async () => {
    // Write a revocation key BEFORE the save.
    const revocationPayload: Revocation = {
      revokedAt: new Date().toISOString(),
      reason: 'refund',
    };
    const { kv } = createStubKv({
      [revocationKey]: JSON.stringify(revocationPayload),
    });
    const revocation = new AccessRevocation(kv);

    // Content row for the orgId lookup at top of savePlaybackProgress.
    stub.mocks.content.findFirst.mockResolvedValue({ organizationId: orgId });

    const { service } = buildService(stub, revocation);

    const err = await service
      .savePlaybackProgress(userId, progressInput)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).message).toBe('Access revoked');
    expect((err as ForbiddenError).context).toMatchObject({
      reason: 'refund',
      contentId,
      organizationId: orgId,
    });

    // DB access check never runs because revocation short-circuits first.
    expect(stub.insert).not.toHaveBeenCalled();
  });

  it('rejects when subscription.currentPeriodEnd is in the past (expired)', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(subscribersContent);
    // The SQL WHERE clause filters out subscriptions with
    // currentPeriodEnd <= now(); simulate that by returning undefined
    // (the DB returns no row matching the live-period predicate).
    stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
    stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

    const { service, verifyPurchase } = buildService(stub);
    verifyPurchase.mockResolvedValue(false);

    await expect(
      service.savePlaybackProgress(userId, progressInput)
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(stub.insert).not.toHaveBeenCalled();
  });

  describe('boundary — revocation + DB access are independent gates', () => {
    it('revocation alone triggers rejection (DB would grant access)', async () => {
      // DB would grant: active subscription present. Revocation still wins.
      const { kv } = createStubKv({
        [revocationKey]: JSON.stringify({
          revokedAt: new Date().toISOString(),
          reason: 'subscription_deleted',
        } satisfies Revocation),
      });
      const revocation = new AccessRevocation(kv);

      stub.mocks.content.findFirst.mockResolvedValue({
        organizationId: orgId,
      });
      stub.mocks.subscriptions.findFirst.mockResolvedValue(activeSub);

      const { service } = buildService(stub, revocation);

      await expect(
        service.savePlaybackProgress(userId, progressInput)
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(stub.insert).not.toHaveBeenCalled();
    });

    it('DB access denial alone triggers rejection (no revocation set)', async () => {
      // No revocation helper wired — simulate KV unavailable.
      stub.mocks.content.findFirst.mockResolvedValue(subscribersContent);
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service, verifyPurchase } = buildService(stub /* no rev */);
      verifyPurchase.mockResolvedValue(false);

      await expect(
        service.savePlaybackProgress(userId, progressInput)
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(stub.insert).not.toHaveBeenCalled();
    });
  });

  describe('follower-only content — subscribers ⊇ followers hierarchy (Codex-xybr3)', () => {
    // The access hierarchy was inverted in Codex-xybr3: an active
    // subscription to the content's org now grants followers-only access
    // without needing a follower row. The follower row remains as a
    // fallback so ex-subscribers (cancelled) who are still following
    // continue to see the content.
    const followersContent = {
      id: contentId,
      organizationId: orgId,
      accessType: 'followers',
      priceCents: null,
      minimumTierId: null,
    };

    it('allows a subscriber who has NOT followed the org (new grant path)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContent);
      // User has an active subscription…
      stub.mocks.subscriptions.findFirst.mockResolvedValue(activeSub);
      // …but has never followed the org.
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      // …and isn't in management either.
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      await expect(
        service.savePlaybackProgress(userId, progressInput)
      ).resolves.toBeUndefined();

      // Upsert ran — subscription alone now grants followers-only access.
      expect(stub.insert).toHaveBeenCalledTimes(1);
    });

    it('allows a subscriber who IS also a follower (follower fallback still works)', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContent);
      // Follower lookup hits — the primary gate. Subscription state is
      // irrelevant once the follower check passes.
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
        id: 'follower_row',
      });

      const { service } = buildService(stub);

      await expect(
        service.savePlaybackProgress(userId, progressInput)
      ).resolves.toBeUndefined();

      expect(stub.insert).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-subscriber, non-follower, non-management user', async () => {
      stub.mocks.content.findFirst.mockResolvedValue(followersContent);
      // No subscription, no follower row, no membership.
      stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
      stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);

      const { service } = buildService(stub);

      await expect(
        service.savePlaybackProgress(userId, progressInput)
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(stub.insert).not.toHaveBeenCalled();
    });
  });
});
