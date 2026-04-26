/**
 * Proof test for F2 — performance:hot-path-allocation-render-loop
 *
 * Static / `bench()`-style proof per SKILL.md §6 Catalogue + ref 04 §7
 * (Hot-path allocation):
 *   - Pattern: object literal allocated each frame inside a 60Hz render loop.
 *   - Catalogue match: "A perf regression visible only at scale" → bench()
 *     with explicit threshold.
 *
 * The bug:
 *   apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:153-168
 *   builds a fresh `audioState` object literal (10 keys) every animation
 *   frame; combined with audio-analyser.ts:176-187 returning a fresh 10-key
 *   `AudioAnalysis` object per `getAnalysis()` call (also 60Hz). Two fresh
 *   objects per frame * 60Hz = 120 ambient allocations/sec per active
 *   immersive player.
 *
 * The proof: bench the render-loop body and assert
 *   p99 < (a calibrated threshold based on a recycled-buffer baseline).
 *   The simpler form is a ref-equality assertion: a recycled buffer pattern
 *   would return the SAME object across frames (only mutate fields) — easy
 *   to assert.
 *
 * Currently SKIPPED — un-skip in the same PR as the fix (recycle a single
 * `AudioAnalysis` instance inside the analyser; mutate fields instead of
 * returning a new object literal; same recycling pattern in
 * ImmersiveShaderPlayer's renderFrame).
 *
 * MCP gate (R6): chrome-devtools `take_memory_snapshot` before/after a
 *   60-second immersive playback session — assert minor-GC count drops.
 */

import { describe, it } from 'vitest';

describe.skip('performance:hot-path-allocation-render-loop', () => {
  it('audio-analyser.getAnalysis returns the SAME object instance across frames (recycled buffer)', () => {
    // SKETCH (un-skip and flesh out in the fix PR):
    // const handle = createAudioAnalyser(stubbedAudioEl);
    // const a = handle.getAnalysis();
    // const b = handle.getAnalysis();
    // expect(a).toBe(b);  // ref-equality — proves recycling
    //
    // Pre-fix: a !== b (each call creates a new object literal).
    // Post-fix: a === b (same buffer mutated each frame).
  });

  it('ImmersiveShaderPlayer renderFrame allocates 0 audioState objects per frame in steady state', () => {
    // SKETCH:
    // Drive renderFrame for N frames with a Proxy on Object.assign / literal
    // construction OR using bench() to compare per-iteration heap delta.
    // Expect heap delta per frame < calibrated threshold.
  });
});
