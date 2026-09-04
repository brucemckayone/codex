# /triage iter-009 — Codex-y63gl.14

**Date:** 2026-04-28
**Mode:** auto (`/loop /triage` every 15 min)
**Bead:** Codex-y63gl.14 (P1, denoise:performance, parent epic Codex-y63gl)
**Rung:** 1 (mechanical helper extraction + 2 call-site swaps)
**Action:** auto-resolve
**Outcome:** closed

## Bead summary

> MAJOR. apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:171 + apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte:80 both call `getShaderConfig(null, ...)` inside per-frame `renderFrame()` loop (60Hz). `getShaderConfig` reads `getComputedStyle(.org-layout)` and parses 8+ CSS variables. Canonical ShaderHero.svelte:135-146 already amortises this with a 30-frame poll counter; immersive overlay (Codex-03rh audio-shader-mode entry path, 2026-04-14) and studio shader-picker preview shipped without inheriting the optimisation. At 60fps, up to 60 forced-style-recalculations/sec per active immersive player — most expensive operation in render loop. Fix: lift pollConfig cadence into a shared helper (e.g. ShaderHero/use-poll-config.ts) and reuse from both consumers.

## Classification reasoning

Rung 1. Three signals:

1. **Cited locations are precise** — `file:line` for both consumers + the donor pattern in ShaderHero.svelte. R8 satisfied.
2. **Recipe is essentially byte-equivalent** — copy a 12-line block (counter + cached config + `pollConfig` function) into a shared helper, then replace one expression at each consumer's render frame.
3. **No design choice involved** — the cadence (30 frames) is already canonical; the helper is a pure-function refactor.

The only judgment call was whether to also migrate `ShaderHero.svelte` to consume the new helper. Decision: NO. ShaderHero's inline block is tightly coupled to its local `presetOverride` prop and is documented in-context; rewriting it would be a no-op functionally and risks regressing the live-brand-editor coupling. Out of scope for this bead (the bead names only the two consumers).

## Action taken

### Files created

- `apps/web/src/lib/components/ui/ShaderHero/use-poll-config.ts` — `createPollConfig<T>(fetchConfig, pollEveryNFrames = 30)` factory. Each consumer creates its own closure so cache state is per-component.

### Files edited

- `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte`
  - Imported `createPollConfig`.
  - Added `let pollConfig: (() => ShaderConfig) | null = null;` at module scope.
  - Initialised inside `onMount` once `shaderPreset` is captured: `pollConfig = createPollConfig(() => getShaderConfig(null, preset));`
  - `renderFrame` now reads `const config = pollConfig ? pollConfig() : getShaderConfig(null, shaderPreset as ShaderPresetId);` (the fallback covers the brief window before `onMount` initialises the closure).

- `apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte`
  - Imported `createPollConfig`.
  - Added module-scope `const pollConfig = createPollConfig(() => getShaderConfig(null, currentPreset as ShaderPresetId));`. The closure reads `currentPreset` lexically — `switchPreset()` mutates the variable, the next 30-frame tick picks it up. This preserves the "preset change visible after at most 30 frames" contract.
  - `renderFrame` now reads `const config = pollConfig();`.

### Proof test rewritten

`apps/web/src/__denoise_proofs__/iter-010/F1-shader-config-hot-path.test.ts` was a `describe.skip` sketch with comments. Rewrote into 4 behavioural assertions on `createPollConfig` directly:

1. Default cadence: ≤ 6 fetcher calls across 120 frames (matches `Math.ceil(120/30) + 2`).
2. Cache identity: frames 2–29 return the same object reference; frame 30 trips a refresh.
3. Custom cadence: `pollEveryNFrames = 10` produces ≤ 12 calls across 100 frames.
4. Lexical-state pickup: closure observes mutated upvar (the ShaderPreview switchPreset case).

Pre-fix this test would have failed (per-frame call count = 120). Post-fix all 4 pass.

```
$ pnpm exec vitest run src/__denoise_proofs__/iter-010/F1-shader-config-hot-path.test.ts
✓ src/__denoise_proofs__/iter-010/F1-shader-config-hot-path.test.ts (4 tests) 7ms
Test Files  1 passed (1)
     Tests  4 passed (4)
```

## R10 behavioural test gate

Case (b) — wrote a new behavioural test as part of the fix commit. The fix is a pure-function helper; both consumers correct by construction because they delegate the entire cadence policy to `createPollConfig`. The test exercises the public surface of the helper: positive cases (default + custom cadence), edge inputs (cache identity within a polling window, lexical-state mutation across polling windows). MCP gate (chrome-devtools `performance_start_trace` on the immersive overlay route) is logged in the bead notes for manual verification but is not blocking — the helper's call rate is the proof of the consumers' call rate.

## Recurrence ledger

`route:self:promoted-helper-missed-call-site` bumped from hits=1 → hits=2 (now spans iter-003 + iter-009). Both occurrences share the same fingerprint: an established pattern in component A is missed by later-arriving components B/C. iter-003 case was a denoise R-rule helper with one missed call site; iter-009 case was an in-component pattern that wasn't extracted at promotion time. One sighting from threshold (3); if iter-010+ produces a 3rd recurrence, candidate rule: "perf/structural patterns established inline in component A must be extracted into a shared helper before introducing component B/C that share the underlying expensive call (getShaderConfig, audio.getAnalysis(), etc.)."

## Notes / surface gaps

- **Live brand-editor coupling intact**: the closure reads CSS vars on every refresh, so brand-editor changes still take effect within ~0.5s (one polling window at 60fps). No regression vs. the unamortised version's instantaneous pickup, but worth flagging if future profiling reveals editor lag.
- **Cycle stayed within scope**: ShaderHero.svelte not migrated (out of scope per bead). If a future bead asks for full helper consolidation, that's a separate rung-1 cycle.
- **No RT2 path-bug sidequest**: the F1 proof test had `repoRoot`-style bug NOT been present (it was a `describe.skip` sketch with no path resolution); rewriting it from scratch sidestepped the pattern entirely.
