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
}

interface TxReturn {
  r2Key: string | null;
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
  });

  return { service, signer };
}

const contentId = 'a1b2c3d4-e5f6-4a90-b234-567890abcdef';
const videoTx: TxReturn = {
  r2Key: 'hls/abc/master.m3u8',
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

  it('forwards 600s (not 3600s) to the R2 signer when expirySeconds is omitted', async () => {
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

    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(1);
    const [, passedExpiry] = signer.generateSignedUrl.mock.calls[0] as [
      string,
      number,
    ];
    expect(passedExpiry).toBe(600);
    expect(passedExpiry).not.toBe(3600);

    // expiresAt should reflect the TTL actually used, not a stale default.
    const windowMs = result.expiresAt.getTime() - Date.now();
    // Allow generous slop for CI timing jitter — we're checking order of
    // magnitude (600s ≈ 600_000ms, well under 1h ≈ 3_600_000ms).
    expect(windowMs).toBeGreaterThan(500_000);
    expect(windowMs).toBeLessThan(650_000);
  });

  it('honours an explicit expirySeconds override (1800 → signer receives 1800)', async () => {
    const { service, signer } = buildService(videoTx);

    await service.getStreamingUrl('user-1', {
      contentId,
      expirySeconds: 1800,
    });

    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(1);
    const [, passedExpiry] = signer.generateSignedUrl.mock.calls[0] as [
      string,
      number,
    ];
    expect(passedExpiry).toBe(1800);
  });

  it('signs both stream and waveform with the same resolved TTL for audio content', async () => {
    // Audio branch issues two signing calls; both must use the same TTL —
    // a divergence would cause the waveform to expire at a different time
    // from the player and break mid-playback rendering.
    const audioTx: TxReturn = {
      r2Key: 'hls/aud/master.m3u8',
      mediaType: 'audio',
      waveformKey: 'waveforms/aud.json',
    };
    const { service, signer } = buildService(audioTx);

    await service.getStreamingUrl('user-1', {
      contentId,
      expirySeconds: 900,
    });

    expect(signer.generateSignedUrl).toHaveBeenCalledTimes(2);
    const callOneExpiry = signer.generateSignedUrl.mock.calls[0][1];
    const callTwoExpiry = signer.generateSignedUrl.mock.calls[1][1];
    expect(callOneExpiry).toBe(900);
    expect(callTwoExpiry).toBe(900);
  });
});
