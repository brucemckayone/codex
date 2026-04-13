# Audio Player Component Specification

## Component: `AudioPlayer.svelte`

**Location**: `apps/web/src/lib/components/AudioPlayer/AudioPlayer.svelte`

### Props

```typescript
interface Props {
  src: string;                // HLS manifest URL (signed R2)
  contentId: string;          // For progress tracking
  initialProgress?: number;   // Resume position in seconds
  waveformUrl?: string | null;  // Signed R2 URL to waveform.json
  poster?: string | null;     // Cover art / thumbnail URL
  shaderPreset?: string | null;       // Phase 2: shader for immersive mode
  shaderConfig?: Record<string, number | boolean> | null;  // Phase 2: preset params
}
```

### Architecture

```
AudioPlayer.svelte
  ├── <audio> element (hidden, HLS.js attached)
  ├── Cover art / thumbnail (left side)
  ├── Waveform.svelte (centre, acts as seekbar)
  ├── Controls bar (below waveform)
  │   ├── Play / Pause button
  │   ├── Current time / Duration
  │   ├── Volume slider + Mute toggle
  │   ├── Playback speed selector (0.5x, 1x, 1.5x, 2x)
  │   └── Immersive Mode button (Phase 2, when shaderPreset set)
  └── Mini-player (fixed bottom bar, shown on scroll)
```

### HLS Integration

Reuses the existing `createHlsPlayer()` from `VideoPlayer/hls.ts`, refactored to accept `HTMLMediaElement`:

```typescript
const audioEl: HTMLAudioElement;  // bind:this
const hls = await createHlsPlayer({ media: audioEl, src, onError });
```

The `<audio>` element must have `crossorigin="anonymous"` for CORS compatibility with R2 signed URLs and for Phase 2 `createMediaElementSource()`.

### Progress Tracking

Reuses `createProgressTracker()` from `VideoPlayer/progress.svelte.ts` (refactored to `HTMLMediaElement`):

```typescript
const tracker = createProgressTracker({
  contentId,
  media: audioEl,
  initialProgress
});
```

Progress syncs to server via the existing progress-sync system (30s interval + beforeunload beacon).

### Controls

All controls built with design tokens — no media-chrome dependency.

| Control | Behaviour |
|---------|-----------|
| **Play/Pause** | Toggle `audioEl.play()` / `audioEl.pause()`. Icon switches. |
| **Time display** | `formatTime(currentTime)` / `formatTime(duration)` |
| **Volume** | Range input `0-1` → `audioEl.volume`. Uses `--color-primary-500` for fill. |
| **Mute** | Toggle `audioEl.muted`. Icon switches between volume/mute. |
| **Speed** | Dropdown: 0.5x, 1x, 1.5x, 2x → `audioEl.playbackRate` |
| **Immersive** | Phase 2 only. Visible when `shaderPreset` is set. Opens `ImmersiveShaderPlayer`. |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/pause |
| Arrow Left | Seek -10s |
| Arrow Right | Seek +10s |
| M | Toggle mute |

---

## Component: `Waveform.svelte`

**Location**: `apps/web/src/lib/components/AudioPlayer/Waveform.svelte`

### Props

```typescript
interface Props {
  data: number[] | null;   // Normalized 0-1 amplitude samples
  currentTime: number;
  duration: number;
  onseek: (time: number) => void;
}
```

### Rendering

- **Canvas 2D** — not WebGL (simple 2D bars, saves a WebGL context)
- **Bars**: Each sample drawn as a vertical bar. Width = canvas width / sample count.
- **Played region**: `--color-primary-500` (from computed style)
- **Unplayed region**: `--color-neutral-300`
- **Playhead**: Thin vertical line at current position, `--color-primary-700`
- **Background**: `transparent` (inherits parent background)

### Interaction

- **Click**: Map `clientX` to normalised position `(clientX - rect.left) / rect.width` → `onseek(pos * duration)`
- **Drag**: On `pointerdown`, begin tracking. On `pointermove`, update preview position + seek. On `pointerup`, commit seek.
- **Hover**: Show time tooltip at cursor position

### Responsive

- `ResizeObserver` on the canvas container
- Re-render on resize (adjust bar count to avoid sub-pixel rendering)
- Canvas DPR-aware: `canvas.width = rect.width * devicePixelRatio`

### Fallback

If `data` is null/empty (waveform JSON failed to load), render a simple linear progress bar using the same colour tokens.

---

## Mini-Player

### Trigger

`IntersectionObserver` watches the main player container:

```typescript
let miniMode = $state(false);
let isPlaying = $state(false);

$effect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      miniMode = !entry.isIntersecting && isPlaying;
    },
    { threshold: 0 }
  );
  observer.observe(playerContainer);
  return () => observer.disconnect();
});
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Thumbnail] Title - Creator     ▶ ━━━━━━━━━━━━━━ ✕     │
│             (mini progress bar underneath)              │
└─────────────────────────────────────────────────────────┘
```

- `position: fixed; bottom: 0; left: 0; right: 0;`
- `z-index: var(--z-sticky)`
- `background: var(--color-surface); border-top: var(--border-default);`
- `padding: var(--space-2) var(--space-4);`

### Controls (Mini)

- Thumbnail (small, left)
- Title + creator name (truncated)
- Play/pause button
- Thin progress bar (full width, underneath — `--color-primary-500`)
- Close button (dismisses mini-player, does NOT pause)

### Behaviour

- Same `<audio>` element — mini-player is a different view of the same playback
- Mini progress bar is not interactive (seek only via main waveform)
- Clicking the title/thumbnail scrolls back to the main player
- Entrance/exit animated with `transition: transform var(--transition-transform)`

---

## File Structure

```
apps/web/src/lib/components/AudioPlayer/
  ├── AudioPlayer.svelte    — Main component
  ├── Waveform.svelte       — Canvas waveform + seek
  ├── audio-analyser.ts     — Phase 2: Web Audio API bridge
  ├── ImmersiveShaderPlayer.svelte  — Phase 2: fullscreen shader
  └── index.ts              — Barrel export
```

---

## Waveform Data

### Source

The transcoding pipeline already generates waveform data for audio media items:

- `mediaItems.waveformKey` → R2 path to `waveform.json`
- `mediaItems.waveformImageKey` → R2 path to `waveform.png` (fallback)

The `status_ready_requires_keys` DB constraint enforces that audio media items have `waveformKey` before reaching `ready` status.

### Serving

`ContentAccessService.getStreamingUrl()` will be extended to return a signed `waveformUrl` alongside the `streamingUrl` for audio content. Same access control — only users who can stream the audio see the waveform.

### Format

The waveform JSON is expected to be an array of normalised amplitude values (0-1), typically 1000-2000 samples covering the full duration. The `Waveform.svelte` component normalises whatever it receives to fit the canvas width.

---

## Integration Point

**File**: `apps/web/src/lib/components/content/ContentDetailView.svelte`

Replace the current unified player section (line ~184) with content type branching:

```svelte
{#if hasAccess && streamingUrl}
  {#if content.contentType === 'audio'}
    <AudioPlayer
      src={streamingUrl}
      contentId={content.id}
      initialProgress={progress?.positionSeconds ?? 0}
      waveformUrl={waveformUrl}
      poster={thumbnailUrl}
      shaderPreset={content.shaderPreset}
      shaderConfig={content.shaderConfig}
    />
  {:else}
    <VideoPlayer
      src={streamingUrl}
      contentId={content.id}
      initialProgress={progress?.positionSeconds ?? 0}
      poster={thumbnailUrl}
    />
  {/if}
{/if}
```

The `waveformUrl` is threaded from server load → `AccessAndProgress` → `ContentDetailView` props.
