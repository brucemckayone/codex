/**
 * Denoise iter-008 F2 — `dispatchPromise` (RunPod API call) handed to
 * `waitUntil` without a `.catch()` chain (workers:waituntil-no-catch
 * recurrence).
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: major
 * File:Line: workers/media-api/src/routes/transcoding.ts:56
 *
 * Site:
 *
 *   const { dispatchPromise } =
 *     await ctx.services.transcoding.triggerJobInternal(id, priority);
 *   ctx.executionCtx.waitUntil(dispatchPromise);
 *
 * Failure mode: `dispatchPromise` is the live RunPod API call — it
 * rejects on RunPod 5xx, network errors, RUNPOD_API_KEY rotation, or
 * the runpod endpoint going dark. Without `.catch()`, the rejection
 * silently disappears: the media item stays in 'transcoding' state
 * forever (until the cron `runRecoverStuckTranscoding` rescues it
 * after STUCK_MAX_AGE_MINUTES = 120). Every other `waitUntil` in this
 * worker either wraps in `.catch()` (subscription-webhook handlers)
 * OR points at a function with internal try/catch (media-api/index.ts
 * runRecoverStuckTranscoding). This dispatch is unique in being a
 * raw fire-and-forget of an external API promise.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Static-analysis grep over the route
 * file.
 *
 * Fix: either chain `.catch((err) => ctx.obs?.error('Transcoding
 * dispatch failed', { mediaId: id, error: err.message }))` directly, OR
 * have triggerJobInternal return a `dispatchPromise` that itself
 * already chains the catch.
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the fix.
 */
// Vite `?raw` baked-at-build-time import — works under both Node and the
// workerd runtime used by @cloudflare/vitest-pool-workers.

import { describe, expect, it } from 'vitest';
import transcodingSrc from '../../routes/transcoding.ts?raw';

describe('iter-008 F2 — transcoding dispatchPromise missing .catch', () => {
  it('every waitUntil(...) in routes/transcoding.ts has a .catch handler', () => {
    const src = transcodingSrc;

    const waitUntilRegex = /executionCtx\.waitUntil\(\s*([\s\S]*?)\s*\)\s*;/g;

    const offenders: string[] = [];
    const matches = Array.from(src.matchAll(waitUntilRegex));
    matches.forEach((match, i) => {
      const argExpr = match[1] ?? '';
      if (!/\.catch\(/.test(argExpr)) {
        offenders.push(
          `waitUntil #${i + 1} (offset ${match.index}): ${argExpr.slice(0, 120)}…`
        );
      }
    });

    // FAILS on iter-008 main: dispatchPromise at line 56.
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
