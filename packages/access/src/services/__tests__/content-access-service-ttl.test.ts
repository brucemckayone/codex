/**
 * ContentAccessService — streaming URL TTL defaults.
 *
 * Narrow unit tests that verify the default TTL applied when callers
 * invoke `getStreamingUrl` programmatically (without going through the
 * Zod schema layer at the HTTP boundary). These tests deliberately
 * sidestep the access-control branches by stubbing `db.transaction` to
 * return a pre-verified payload — we are only asserting the value
 * forwarded to the R2 signer.
 *
 * See docs/subscription-cache-audit/phase-2-followup.md — Phase 3.
 */

import type { PurchaseService } from '@codex/purchase';
import type { ServiceConfig } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import {
  ContentAccessService,
  DEFAULT_STREAMING_URL_TTL_SECONDS,
} from '../ContentAccessService';

type StubDb = ServiceConfig['db'];

interface StubbedSigner {
  generateSignedUrl: ReturnType<typeof vi.fn>;
  getObjectText: ReturnType<typeof vi.fn>;
}

interface TxReturn {
  r2Key: string | null;
  creatorId: string | null;
  mediaId: string | null;
  mediaType: 'video' | 'audio' | 'written';
  waveformKey: string | null;
}

/**
 * Construct a ContentAccessService with db.transaction stubbed to return
 * a fixed access-verified payload. This skips the access-decision logic
 * entirely — covered by the integration suite — and lets us observe the
 * argument passed to the R2 signer in isolation.
 *
 * The stub deliberately does not invoke the callback; a real transaction
 * callback would issue many queries against `tx.query.*` which have no
 * meaning against a plain object. Bypassing invocation is the simplest
 * safe way to isolate the TTL path.
 */
function buildService(tx: TxReturn) {
  const signer: StubbedSigner = {
    generateSignedUrl: vi.fn(async (_key: string, _expiry: number) => {
      return 'https://signed.example/stub';
    }),
    getObjectText: vi.fn(async () => null),
  };

  const stubDb = {
    transaction: vi.fn(async (_fn: unknown) => tx),
  } as unknown as StubDb;

  // PurchaseService is not exercised because access-decision logic is
  // bypassed via the transaction stub — any shape satisfies construction.
  const stubPurchase = {
    verifyPurchase: vi.fn(),
  } as unknown as PurchaseService;

  const service = new ContentAccessService({
    db: stubDb,
    environment: 'test',
    r2: signer,
    purchaseService: stubPurchase,
    // WP-14: getStreamingUrl now returns a master-proxy URL signed with the
    // HLS token secret; both must be wired for the stream path to run.
    contentApiBaseUrl: 'https://api.revelations.studio',
    hlsTokenSecret: 'test-worker-shared-secret',
  });

  return { service, signer };
}

const contentId = 'a1b2c3d4-e5f6-4a90-b234-567890abcdef';
const videoTx: TxReturn = {
  r2Key: 'hls/abc/master.m3u8',
  creatorId: 'creator-1',
  mediaId: '550e8400-e29b-41d4-a716-446655440000',
  mediaType: 'video',
  waveformKey: null,
};

describe('ContentAccessService — default streaming URL TTL', () => {
  it('exports the documented constant value of 600 seconds', () => {
    // Guards against a future edit silently changing the product decision.
    // Any adjustment to this number requires explicit product sign-off;
    // see docs/subscription-cache-audit/phase-2-followup.md Phase 3.
    expect(DEFAULT_STREAMING_URL_TTL_SECONDS).toBe(600);
  });

  it('reflects 600s (not 3600s) in expiresAt when expirySeconds is omitted (WP-14: master is proxied, not presigned)', async () => {
    const { service, signer } = buildService(videoTx);

    // expirySeconds intentionally omitted — simulates a programmatic
    // caller that constructs GetStreamingUrlInput directly, bypassing
    // the Zod schema default. The service-level fallback must apply.
    // The Zod-inferred input type treats expirySeconds as required (due
    // to .default()), so we satisfy the signature by routing through a
    // widened local type that marks it optional.
    type InputArg = Parameters<ContentAccessService['getStreamingUrl']>[1];
    const inputWithoutTtl: Omit<InputArg, 'expirySeconds'> & {
      expirySeconds?: number;
    } = { contentId };
    const result = await service.getStreamingUrl(
      'user-1',
      inputWithoutTtl as InputArg
    );

    // Video master is now a token-bearing proxy URL — NOT a presigned R2 URL.
    // The signer is never invoked for video (no waveform either).
    expect(signer.generateSignedUrl).not.toHaveBeenCalled();
    expect(result.streamingUrl).toContain('/hls/master.m3u8?token=');

    // expiresAt should reflect the TTL actually used, not a stale default.
    const windowMs = result.expiresAt.getTime() - Date.now();
    // Allow generous slop for CI timing jitter — we're checking order of
    // magnitude (600s ≈ 600_000ms, well under 1h ≈ 3_600_000ms).
    expect(windowMs).toBeGreaterThan(500_000);
    expect(windowMs).toBeLessThan(650_000);
  });

  it('honours an explicit expirySeconds override (1800 → expiresAt window ≈ 1800s)', async () => {
    const { service } = buildService(videoTx);

    const result = await service.getStreamingUrl('user-1', {
      contentId,
      expirySeconds: 1800,
    });

    const windowMs = result.expiresAt.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(1_700_000);
    expect(windowMs).toBeLessThan(1_850_000);
  });

  it('signs the waveform with the resolved TTL for audio content (master stays proxied)', async () => {
    // Audio: the master playlist is still proxied (no presign), but the
    // waveform is a single static file presigned directly with the same TTL.
    const audioTx: TxReturn = {
      r2Key: 'hls/aud/master.m3u8',
      creatorId: 'creator-1',
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
      mediaType: 'audio',
      waveformKey: 'waveforms/aud.json',
    };
    const { service, signer } = buildService(audioTx);

    const result = await service.getStreamingUrl('user-1', {
      contentId,
      expirySeconds: 900,
    });

    // Exactly one signing call — the waveform. The master is the proxy URL.
    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(1);
    const [waveformKey, waveformExpiry] = signer.generateSignedUrl.mock
      .calls[0] as [string, number];
    expect(waveformKey).toBe('waveforms/aud.json');
    expect(waveformExpiry).toBe(900);
    expect(result.streamingUrl).toContain('/hls/master.m3u8?token=');

    const windowMs = result.expiresAt.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(800_000);
    expect(windowMs).toBeLessThan(950_000);
  });
});
