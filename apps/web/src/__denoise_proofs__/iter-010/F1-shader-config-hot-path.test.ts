/**
 * Proof test for F1 — performance:hot-path-shader-config-getcomputedstyle
 *
 * Static / instrumentation-style proof per SKILL.md §6 Catalogue:
 *   "A hard-to-mock side effect (file I/O, network)" → "Contract test at the
 *    boundary — assert the public function calls a known interface; mock the
 *    interface".
 *
 * Substituted: instrument `getShaderConfig` to count `getComputedStyle` calls,
 * drive the render loops, and assert the per-frame call rate stays bounded.
 *
 * The bug:
 *   apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:171
 *   apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte:80
 *   call `getShaderConfig(null, ...)` every animation frame (~60 Hz). Each
 *   call invokes `getComputedStyle(.org-layout)` and reads 8+ CSS variables.
 *   ShaderHero.svelte already amortises this via a 30-frame poll counter
 *   (apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte:135-146).
 *
 * The proof: drive the render loop for N frames; assert
 *   `getComputedStyle` calls <= ceil(N / 30) + 2 (matches ShaderHero's
 *   amortised cadence; +2 tolerates init + final).
 *
 * Currently SKIPPED — un-skip in the same PR as the fix (lift the
 * `pollConfig` cadence from ShaderHero into a shared helper and reuse it
 * in ImmersiveShaderPlayer + ShaderPreview).
 *
 * MCP gate (R6): chrome-devtools `performance_start_trace` on the
 *   immersive overlay route — captures forced-style-recalc count before/after.
 */

import { describe, it } from 'vitest';

describe.skip('performance:hot-path-shader-config-getcomputedstyle', () => {
  it('ImmersiveShaderPlayer reads CSS vars at most once per ~30 frames', () => {
    // SKETCH (un-skip and flesh out in the fix PR):
    // 1. Mount ImmersiveShaderPlayer with a stubbed audio element.
    // 2. Spy on `window.getComputedStyle` (or the shared `pollConfig` helper
    //    once extracted) and count invocations.
    // 3. Drive `requestAnimationFrame` for 120 frames via vitest fake timers
    //    (vi.useFakeTimers + vi.advanceTimersByTime).
    // 4. Expect spy.mock.calls.length <= Math.ceil(120 / 30) + 2  (i.e. <= 6).
    //
    // Pre-fix: spy is invoked 120 times (once per frame).
    // Post-fix: spy is invoked <= 6 times (init + ~one per 30 frames).
  });

  it('ShaderPreview reads CSS vars at most once per ~30 frames', () => {
    // Same instrumentation pattern applied to
    // apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte
    // — driving its own `renderFrame()` loop.
  });
});
