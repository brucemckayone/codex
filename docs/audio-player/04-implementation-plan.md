# Implementation Plan — Work Packets

## Phase 1: Audio Player with Waveform

### WP-1: Database Migration

**Scope**: Add `shader_preset` and `shader_config` columns to content table
**Files**:
- `packages/database/src/schema/content.ts`
- Generated migration file
**Depends on**: Nothing
**Blocks**: WP-2, WP-8

### WP-2: Validation Schema

**Scope**: Add `shaderPresetEnum`, `shaderPreset`, `shaderConfig` to content Zod schemas
**Files**:
- `packages/validation/src/content/content-schemas.ts`
**Depends on**: WP-1
**Blocks**: WP-8

### WP-3: Waveform URL in Access Service

**Scope**: Extend `getStreamingUrl()` to return signed `waveformUrl` for audio content
**Files**:
- `packages/access/src/services/ContentAccessService.ts`
- `packages/access/src/types.ts` (if return type separately defined)
- `apps/web/src/lib/server/content-detail.ts`
**Depends on**: Nothing
**Blocks**: WP-7

### WP-4: Refactor HLS + Progress to HTMLMediaElement

**Scope**: Widen `HTMLVideoElement` → `HTMLMediaElement` in shared utilities
**Files**:
- `apps/web/src/lib/components/VideoPlayer/hls.ts`
- `apps/web/src/lib/components/VideoPlayer/progress.svelte.ts`
- `apps/web/src/lib/components/VideoPlayer/VideoPlayer.svelte`
**Depends on**: Nothing
**Blocks**: WP-5

### WP-5: AudioPlayer Component

**Scope**: Build `AudioPlayer.svelte` with HLS playback, custom controls, mini-player
**Files**:
- `apps/web/src/lib/components/AudioPlayer/AudioPlayer.svelte` (new)
- `apps/web/src/lib/components/AudioPlayer/index.ts` (new)
**Depends on**: WP-4, WP-6
**Blocks**: WP-7

### WP-6: Waveform Component

**Scope**: Build `Waveform.svelte` with Canvas 2D rendering, seek interaction
**Files**:
- `apps/web/src/lib/components/AudioPlayer/Waveform.svelte` (new)
**Depends on**: Nothing
**Blocks**: WP-5

### WP-7: Content Detail Page Integration

**Scope**: Add audio/video branching in ContentDetailView, thread waveformUrl through
**Files**:
- `apps/web/src/lib/components/content/ContentDetailView.svelte`
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte`
**Depends on**: WP-3, WP-5
**Blocks**: Nothing (Phase 1 complete)

### WP-8: Studio Shader Picker

**Scope**: Build ShaderPicker for content form, wire to create/update form state
**Files**:
- `apps/web/src/lib/components/studio/content-form/ShaderPicker.svelte` (new)
- `apps/web/src/lib/components/studio/ContentForm.svelte`
**Depends on**: WP-1, WP-2
**Blocks**: WP-11 (Phase 2 needs presets in DB)

---

## Phase 2: Immersive Audio-Reactive Shader Mode

### WP-9: Audio Analyser Utility

**Scope**: Build `createAudioAnalyser()` — Web Audio API bridge with bass/mids/treble extraction
**Files**:
- `apps/web/src/lib/components/AudioPlayer/audio-analyser.ts` (new)
**Depends on**: Nothing
**Blocks**: WP-11

### WP-10: AudioState on ShaderRenderer

**Scope**: Add `AudioState` interface, extend `render()` signature with optional parameter
**Files**:
- `apps/web/src/lib/components/ui/ShaderHero/renderer-types.ts`
**Depends on**: Nothing
**Blocks**: WP-11, WP-12

### WP-11: ImmersiveShaderPlayer Component

**Scope**: Build fullscreen shader overlay driven by audio frequency data
**Files**:
- `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte` (new)
- `apps/web/src/lib/components/AudioPlayer/AudioPlayer.svelte` (add immersive toggle)
**Depends on**: WP-5, WP-9, WP-10, WP-8
**Blocks**: Nothing

### WP-12: Audio-Reactive Shader Presets

**Scope**: Add audio uniforms to 8 shader renderers + fragment shaders
**Presets**: pulse, aurora, nebula, plasma, ripple, silk, caustic, flux
**Files** (per preset, 2 files each):
- `apps/web/src/lib/components/ui/ShaderHero/renderers/{preset}-renderer.ts`
- `apps/web/src/lib/components/ui/ShaderHero/shaders/{preset}-sim.frag.ts` or `{preset}-display.frag.ts`
**Depends on**: WP-10
**Blocks**: Nothing

---

## Dependency Graph

```
Phase 1:
  WP-1 (DB migration) ─────────────→ WP-2 (Validation) ──→ WP-8 (Shader Picker)
  WP-3 (Waveform URL) ──────────────────────────────────────→ WP-7 (Page Integration)
  WP-4 (HTMLMediaElement refactor) ──→ WP-5 (AudioPlayer) ──→ WP-7
  WP-6 (Waveform.svelte) ───────────→ WP-5

Phase 2:
  WP-9  (Audio Analyser) ───────────→ WP-11 (Immersive Player)
  WP-10 (AudioState interface) ─────→ WP-11
  WP-10 ────────────────────────────→ WP-12 (Reactive Presets)
  WP-5  ────────────────────────────→ WP-11
  WP-8  ────────────────────────────→ WP-11
```

## Parallel Execution Groups

Work that can proceed simultaneously:

**Group A** (no dependencies): WP-1, WP-3, WP-4, WP-6, WP-9, WP-10
**Group B** (after Group A): WP-2, WP-5
**Group C** (after Group B): WP-7, WP-8, WP-12
**Group D** (after Group C): WP-11

---

## Verification Plan

### Phase 1 Verification
- [ ] Navigate to audio content detail page → AudioPlayer renders (not VideoPlayer)
- [ ] Waveform loads and displays from signed R2 URL
- [ ] Click/drag on waveform seeks audio correctly
- [ ] Progress tracking persists across page reloads
- [ ] Mini-player appears when scrolling past main player during playback
- [ ] Mini-player disappears when main player scrolls back into view
- [ ] HLS audio streams on Chrome (HLS.js) and Safari (native HLS)
- [ ] Studio content form shows shader picker for audio content type only
- [ ] Shader preset saves to DB via create/update and loads on edit
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes

### Phase 2 Verification
- [ ] "Immersive Mode" button visible on audio content that has a shader preset
- [ ] Button hidden when no shader preset is set
- [ ] Clicking enters fullscreen canvas with selected shader rendering
- [ ] Shader visuals respond to audio frequency data (bass/mids/treble visible)
- [ ] Mouse interaction still works on fullscreen canvas
- [ ] Audio controls (play/pause/seek/volume) work in immersive overlay
- [ ] Escape key and close button exit cleanly
- [ ] No WebGL resource leaks after exit (check DevTools memory)
- [ ] No audio glitches when entering/exiting immersive mode
- [ ] Background ShaderHero pauses while immersive overlay is active
- [ ] Maintains 60fps on mid-range hardware
- [ ] Re-entering immersive mode works (AudioContext reused, not recreated)

### Cross-Cutting
- [ ] No hardcoded CSS values — all design tokens
- [ ] Svelte 5 runes throughout (`$props`, `$state`, `$derived`, `$effect`)
- [ ] Currency displays as GBP (£) where relevant
- [ ] `crossorigin="anonymous"` on `<audio>` element
