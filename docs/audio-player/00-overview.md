# Audio Player + Immersive Shader Mode — Overview

## Vision

The content detail page currently treats audio content as a second-class citizen — it renders through the VideoPlayer with no waveform, no audio-specific controls, and no visual experience. This feature adds two capabilities:

1. **A dedicated audio player** with waveform visualization, seek-on-waveform, and a sticky mini-player
2. **An immersive shader mode** where audio frequency data drives the existing 40-preset WebGL shader system in a fullscreen reactive visual experience

Together, these transform audio content from "video player without the video" into a first-class, visually rich listening experience that leverages the platform's unique shader infrastructure.

---

## Two Phases

### Phase 1: Audio Player with Waveform

A dedicated `AudioPlayer` component replaces `VideoPlayer` for audio content on the content detail page. Key features:

- **Waveform visualization** — Canvas 2D rendering of amplitude data (already stored in R2 by the transcoding pipeline)
- **Waveform-as-seekbar** — Click/drag on the waveform to seek; played region fills with primary colour
- **Mini-player** — Sticky bottom bar when the main player scrolls out of view during playback
- **Shared HLS infrastructure** — Reuses `hls.ts` and progress tracking from VideoPlayer (refactored to `HTMLMediaElement`)
- **Custom controls** — Play/pause, volume, mute, playback speed, time display (no media-chrome dependency)

### Phase 2: Immersive Audio-Reactive Shader Mode

A fullscreen overlay where one of the 40 shader presets renders driven by real-time audio frequency data:

- **Audio analyser** — Web Audio API `AnalyserNode` extracts bass/mids/treble/amplitude per frame
- **Shader integration** — New `AudioState` interface on `ShaderRenderer.render()` (backward-compatible optional parameter)
- **Creator shader picker** — Creators select a shader preset per audio content item via the studio form
- **Fullscreen experience** — `ImmersiveShaderPlayer` component with audio controls overlaid on the shader canvas
- **Lazy init** — AudioContext only created when user clicks "Immersive Mode" (no overhead during standard playback)

---

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │         Content Detail Page             │
                         │  (_org/[slug]/(space)/content/[slug])   │
                         └────────────────┬────────────────────────┘
                                          │
                          contentType === 'audio'?
                         ┌────────────────┼────────────────┐
                         │ YES                             │ NO
                    ┌────▼────┐                      ┌─────▼─────┐
                    │AudioPlayer│                     │VideoPlayer │
                    └────┬────┘                      └───────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼───┐ ┌───▼────┐ ┌──▼──────────────────┐
         │Waveform│ │Mini-   │ │ImmersiveShaderPlayer │
         │.svelte │ │Player  │ │(Phase 2, fullscreen) │
         └────────┘ └────────┘ └──────────┬───────────┘
                                          │
                               ┌──────────┼──────────┐
                               │          │          │
                          ┌────▼───┐ ┌───▼────┐ ┌──▼────────┐
                          │Audio   │ │Shader  │ │Overlay    │
                          │Analyser│ │Renderer│ │Controls   │
                          └────────┘ └────────┘ └───────────┘
```

---

## Data Flow

### Standard Playback (Phase 1)

```
Server Load
  ├── content.contentType === 'audio'
  ├── streamingUrl (signed R2 → HLS manifest)
  ├── waveformUrl (signed R2 → waveform.json)  ← NEW
  └── progress (positionSeconds, durationSeconds)
         │
    AudioPlayer
      ├── <audio> element + HLS.js (via shared hls.ts)
      ├── Waveform.svelte (Canvas 2D, static amplitude data from JSON)
      ├── createProgressTracker() (shared from VideoPlayer)
      └── IntersectionObserver → mini-player toggle
```

### Immersive Mode (Phase 2)

```
User clicks "Immersive Mode" button
  │
  ├── createAudioAnalyser(audioElement)
  │     └── AudioContext → MediaElementSource → AnalyserNode → speakers
  │
  ├── loadRenderer(shaderPreset) — same factory as ShaderHero
  │
  └── Render loop (60fps):
        getAnalysis() → { bass, mids, treble, amplitude }
        renderer.render(gl, time, mouse, config, w, h, audioState)
```

---

## Schema Changes

Two new nullable columns on the `content` table:

| Column | Type | Purpose |
|--------|------|---------|
| `shader_preset` | `varchar(50)` | Which shader preset to use for immersive mode (null = none) |
| `shader_config` | `jsonb` | Per-preset parameter overrides (intensity, grain, etc.) |

Validated at the Zod layer only (no DB CHECK constraint) — the preset list evolves with new shaders.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extend `render()` vs map audio→mouse | New `AudioState` param | Clean, typed, each shader decides how to use frequency data |
| New component vs modify ShaderHero | New `ImmersiveShaderPlayer` | ShaderHero is tightly coupled to CSS var polling + org layout |
| Shared `hls.ts` vs separate audio HLS | Refactor shared to `HTMLMediaElement` | HLS.js works identically; avoid duplication |
| DB constraint vs Zod-only validation | Zod-only for preset enum | Preset list evolves — avoids migration churn |
| Waveform rendering | Canvas 2D (not WebGL) | Simple 2D bars; WebGL would be overkill and waste a context |
| Analyser init timing | Lazy (on immersive click) | No Web Audio overhead during standard playback |

---

## Related Documentation

- Content detail page spec: `docs/page-ideation/05-org-content-detail.md` (lines 135-139)
- Content detail UX spec: `docs/page-ideation/specs/07-content-detail-ux.md`
- Hero shader system: `docs/hero-shader-system/`
- Content card audit (waveformKey): `docs/content-card-audit/README.md`
