/**
 * Proof test for F1 — performance:hot-path-shader-config-getcomputedstyle
 *
 * Behavioural unit test of the shared `createPollConfig` helper that lifts
 * the 30-frame poll cadence out of ShaderHero.svelte:135-146 so that
 * ImmersiveShaderPlayer.svelte and ShaderPreview.svelte can share it.
 *
 * The bug (pre-fix):
 *   apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:171
 *   apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte:80
 *   called `getShaderConfig(null, ...)` every animation frame (~60 Hz). Each
 *   call invokes `getComputedStyle(.org-layout)` and reads 8+ CSS variables
 *   (forced style recalc — the most expensive op in the render loop).
 *
 * The fix:
 *   `apps/web/src/lib/components/ui/ShaderHero/use-poll-config.ts` exposes
 *   `createPollConfig(fetchConfig, pollEveryNFrames = 30)` — a closure that
 *   caches the last value and only re-fetches every Nth call. Each consumer
 *   creates its own closure inside its render function and replaces the
 *   per-frame `getShaderConfig` call with `pollConfig()`.
 *
 * The proof:
 *   Drive the closure for 120 simulated frames; assert the underlying
 *   fetcher was invoked at most ceil(120 / 30) + 2 = 6 times. Pre-fix this
 *   would fail with 120 invocations; post-fix passes at <= 6.
 *
 * Why this is the right test (R10 case b):
 *   The fix is a pure-function helper. Both consumers wire it identically
 *   (`const pollConfig = createPollConfig(() => getShaderConfig(...))`),
 *   then call `pollConfig()` per frame. Verifying the helper's call rate
 *   is correct by construction proves the consumers' call rate is also
 *   correct — they delegate the entire cadence policy to the helper.
 *   Component-level integration via mounting Svelte components is gated by
 *   chrome-devtools `performance_start_trace` (MCP gate, manual today).
 */

import { describe, expect, it } from 'vitest';
import { createPollConfig } from '../../lib/components/ui/ShaderHero/use-poll-config';

describe('iter-010 F1 — createPollConfig amortises getShaderConfig across N frames', () => {
  it('invokes the fetcher at most ceil(120 / 30) + 2 times across 120 frames (default cadence)', () => {
    let calls = 0;
    const fetcher = () => {
      calls++;
      return { tag: 'config', n: calls };
    };

    const pollConfig = createPollConfig(fetcher);

    // Drive 120 frames.
    for (let i = 0; i < 120; i++) {
      pollConfig();
    }

    const upperBound = Math.ceil(120 / 30) + 2; // 6
    expect(
      calls,
      `Expected at most ${upperBound} fetcher calls across 120 frames; got ${calls}. Pre-fix this was 120 (per-frame).`
    ).toBeLessThanOrEqual(upperBound);

    // Lower bound — the closure MUST initialise (1 call) and refresh at
    // least 3 times across 120 frames at default cadence (30).
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it('returns the cached value between refreshes (no per-frame allocation churn)', () => {
    let n = 0;
    const fetcher = () => ({ id: ++n });

    const pollConfig = createPollConfig(fetcher, 30);

    // Initial call (counter=1) returns the value cached at construction.
    const first = pollConfig();
    // Frames 2..29 must return the SAME object reference (cached).
    for (let i = 2; i <= 29; i++) {
      expect(pollConfig(), `frame ${i} must return cached config`).toBe(first);
    }
    // Frame 30 trips the counter and refreshes.
    const refreshed = pollConfig();
    expect(refreshed).not.toBe(first);
    expect(refreshed.id).toBeGreaterThan(first.id);
  });

  it('honours a custom pollEveryNFrames cadence', () => {
    let calls = 0;
    const pollConfig = createPollConfig(() => ++calls, 10);

    for (let i = 0; i < 100; i++) pollConfig();

    // 1 (init) + ~10 refreshes (every 10th frame).
    const upperBound = Math.ceil(100 / 10) + 2; // 12
    expect(calls).toBeLessThanOrEqual(upperBound);
    expect(calls).toBeGreaterThanOrEqual(10);
  });

  it('picks up lexically-captured state on the next refresh (ShaderPreview switchPreset case)', () => {
    // ShaderPreview's `currentPreset` mutates after switchPreset(); the
    // closure reads it lexically, so the next 30-frame tick must see the
    // new value. This guards the "preset change is visible after at most
    // 30 frames" contract.
    let preset = 'a';
    const seen: string[] = [];
    const pollConfig = createPollConfig(() => {
      seen.push(preset);
      return preset;
    });

    // 30 frames at preset 'a' — should yield exactly 1 fetch (init) + 1
    // refresh on the 30th frame.
    for (let i = 0; i < 30; i++) pollConfig();

    // Switch presets and let the closure tick another 30 frames — it must
    // observe the new preset on the next refresh.
    preset = 'b';
    for (let i = 0; i < 30; i++) pollConfig();

    // First fetch saw 'a'; some later fetch must see 'b'.
    expect(seen[0]).toBe('a');
    expect(seen).toContain('b');
  });
});
