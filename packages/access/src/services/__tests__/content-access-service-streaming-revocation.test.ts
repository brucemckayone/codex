/**
 * ContentAccessService.getStreamingUrl — revocation short-circuit tests.
 *
 * Covers Phase 3 of docs/subscription-cache-audit/phase-2-followup.md:
 * when a revocation key is present for (userId, orgId), `getStreamingUrl`
 * MUST reject with `AccessDeniedError` BEFORE opening the DB transaction.
 * Cryptographic presigned URLs cannot be invalidated once issued, so the
 * block list exists to close the window where a cancelled/refunded user
 * could otherwise mint a fresh signed URL using DB data that has not yet
 * been updated.
 *
 * Strategy: stub `this.db` with two surfaces:
 *   - `db.query.content.findFirst` — served by the pre-transaction orgId
 *     lookup (revocation gate) and, in the happy path, by the transaction
 *     callback when it runs (here we short-circuit before it does).
 *   - `db.transaction(fn)` — we assert this is NOT called on the revoked
 *     path, and IS called on the non-revoked path.
 *
 * Per feedback_security_deep_test: positive + negative paths mandatory.
 * This suite covers:
 *   1. Revoked user → AccessDeniedError (no transaction opened)
 *   2. Non-revoked user → method reaches the DB transaction path
 *   3. Ordering: revocation throw short-circuits BEFORE the transaction
 *   4. No revocation service injected → no crash, DB path still runs
 *   5. Each RevocationReason propagates into the error's context
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { PurchaseService } from '@codex/purchase';
import type { ServiceConfig } from '@codex/service-errors';
import type { GetStreamingUrlInput } from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import {
  AccessRevocation,
  type Revocation,
  type RevocationReason,
} from '../access-revocation';
import { ContentAccessService } from '../ContentAccessService';

// ─── Stub shapes ──────────────────────────────────────────────────────

type FindFirstFn = ReturnType<typeof vi.fn>;

interface StubDb {
  contentFindFirst: FindFirstFn;
  transaction: ReturnType<typeof vi.fn>;
  /** Timestamps (monotonic) captured at each call site to verify ordering. */
  callLog: string[];
}

/**
 * Build a stub db that captures call ordering. The transaction stub returns
 * a pre-verified payload (simulating what `getStreamingUrl`'s callback
 * returns on success) without actually invoking the callback — the
 * access-decision branches are covered by integration tests.
 */
function createStubDb(): StubDb {
  const callLog: string[] = [];

  const contentFindFirst = vi.fn(async () => {
    callLog.push('content.findFirst');
    return { organizationId: 'org_xyz' };
  });

  const transaction = vi.fn(async (_fn: unknown) => {
    callLog.push('db.transaction');
    // Return shape matches the happy-path payload the real callback
    // produces; any fields outside r2Key/mediaType/waveformKey are
    // ignored by getStreamingUrl's post-transaction code.
    return {
      r2Key: 'hls/abc/master.m3u8',
      mediaType: 'video' as const,
      waveformKey: null,
    };
  });

  return { contentFindFirst, transaction, callLog };
}

type ServiceDb = ServiceConfig['db'];

function buildService(stub: StubDb, revocation?: AccessRevocation) {
  const dbForService = {
    query: {
      content: { findFirst: stub.contentFindFirst },
    },
    transaction: stub.transaction,
  } as unknown as ServiceDb;

  const signer = {
    generateSignedUrl: vi.fn(async () => 'https://signed.example/stub'),
  };

  const purchaseService = {
    verifyPurchase: vi.fn(async () => false),
  } as unknown as PurchaseService;

  const service = new ContentAccessService({
    db: dbForService,
    environment: 'test',
    r2: signer,
    purchaseService,
    revocation,
  });

  return { service, signer };
}

function createStubKv(initial: Record<string, string> = {}): {
  kv: KVNamespace;
  store: Map<string, string>;
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
  return { kv, store };
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const userId = 'user_abc';
const orgId = 'org_xyz';
const contentId = 'a1b2c3d4-e5f6-4a90-b234-567890abcdef';
const revocationKey = `revoked:user:${userId}:${orgId}`;

const streamingInput: GetStreamingUrlInput = {
  contentId,
  expirySeconds: 600,
};

function makeRevocation(reason: RevocationReason): Revocation {
  return {
    revokedAt: new Date().toISOString(),
    reason,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('ContentAccessService.getStreamingUrl — revocation short-circuit', () => {
  let stub: StubDb;

  beforeEach(() => {
    stub = createStubDb();
  });

  it('throws AccessDeniedError BEFORE the DB transaction when user is revoked', async () => {
    const { kv } = createStubKv({
      [revocationKey]: JSON.stringify(makeRevocation('refund')),
    });
    const revocation = new AccessRevocation(kv);

    const { service } = buildService(stub, revocation);

    const err = await service
      .getStreamingUrl(userId, streamingInput)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AccessDeniedError);

    // Transaction MUST NOT have been opened — the revocation check
    // short-circuits before any transactional work. This is the whole
    // point of placing the check before the transaction.
    expect(stub.transaction).not.toHaveBeenCalled();

    // The cheap orgId lookup is the only DB call that should have run.
    expect(stub.contentFindFirst).toHaveBeenCalledTimes(1);

    // Reason propagates as context metadata — callers / logs can surface
    // the "why" even though authorization decisions never branch on it.
    expect((err as AccessDeniedError).context).toMatchObject({
      reason: 'refund',
      organizationId: orgId,
      contentId,
    });
  });

  it('continues to the DB transaction when no revocation key is present', async () => {
    const { kv } = createStubKv(/* empty */);
    const revocation = new AccessRevocation(kv);

    const { service, signer } = buildService(stub, revocation);

    const result = await service.getStreamingUrl(userId, streamingInput);

    // The orgId lookup ran, THEN the transaction ran — the gate was
    // probed and cleared.
    expect(stub.contentFindFirst).toHaveBeenCalledTimes(1);
    expect(stub.transaction).toHaveBeenCalledTimes(1);
    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(1);
    expect(result.streamingUrl).toBe('https://signed.example/stub');
  });

  it('runs the orgId lookup BEFORE the transaction (ordering)', async () => {
    // Non-revoked path — we verify the call sequence via the shared
    // callLog rather than timestamps, which would be flaky.
    const { kv } = createStubKv(/* empty */);
    const revocation = new AccessRevocation(kv);

    const { service } = buildService(stub, revocation);

    await service.getStreamingUrl(userId, streamingInput);

    expect(stub.callLog).toEqual(['content.findFirst', 'db.transaction']);
  });

  it('does not crash and runs the transaction when no revocation service is injected', async () => {
    // Standalone factory case: CACHE_KV not bound, so `revocation` is
    // undefined. The method must skip the check silently; the DB-level
    // gate inside the transaction is what protects in this configuration.
    const { service, signer } = buildService(stub /* no revocation */);

    const result = await service.getStreamingUrl(userId, streamingInput);

    // The pre-transaction orgId lookup is gated on `this.revocation` — so
    // when it is undefined, that query does NOT run.
    expect(stub.contentFindFirst).not.toHaveBeenCalled();

    // Transaction still runs — the DB path is the only gate now.
    expect(stub.transaction).toHaveBeenCalledTimes(1);
    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(1);
    expect(result.streamingUrl).toBe('https://signed.example/stub');
  });

  it('does not run the pre-transaction lookup when content has no org (personal content)', async () => {
    // Personal content (organizationId = null) can't be revoked at org
    // scope; the gate falls through without ever calling isRevoked. This
    // matches the sibling pattern in savePlaybackProgress.
    stub.contentFindFirst.mockResolvedValueOnce({ organizationId: null });

    const { kv } = createStubKv({
      // Even if a stale revocation key exists under some other scope, it
      // must not apply to personal content — we use a key that would
      // never match the skipped lookup.
      'revoked:user:other:other': JSON.stringify(makeRevocation('refund')),
    });
    const revocation = new AccessRevocation(kv);

    const { service } = buildService(stub, revocation);

    await expect(
      service.getStreamingUrl(userId, streamingInput)
    ).resolves.toMatchObject({
      streamingUrl: 'https://signed.example/stub',
    });

    // Transaction still ran because no revocation blocked it.
    expect(stub.transaction).toHaveBeenCalledTimes(1);
  });

  describe('revocation reason propagates to the thrown error', () => {
    const reasons: RevocationReason[] = [
      'subscription_deleted',
      'payment_failed',
      'refund',
      'admin_revoke',
    ];

    for (const reason of reasons) {
      it(`surfaces reason=${reason} in the AccessDeniedError context`, async () => {
        const { kv } = createStubKv({
          [revocationKey]: JSON.stringify(makeRevocation(reason)),
        });
        const revocation = new AccessRevocation(kv);

        const { service } = buildService(stub, revocation);

        const err = await service
          .getStreamingUrl(userId, streamingInput)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(AccessDeniedError);
        expect((err as AccessDeniedError).context).toMatchObject({
          reason,
          organizationId: orgId,
          contentId,
        });
        // Sanity: transaction still must not have opened.
        expect(stub.transaction).not.toHaveBeenCalled();
      });
    }
  });
});
