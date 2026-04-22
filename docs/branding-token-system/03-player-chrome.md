# WP-03: Player Chrome Tokenization

## Goal

Replace all ~70 hardcoded color/opacity values across the 4 player components with the semantic `--color-player-*` tokens defined in WP-01. Make player chrome fully brandable per-org.

## Depends On

- WP-01 (Foundation) — player.css must exist, org-brand.css overrides must be in place

## Background

The video player, audio player, immersive shader player, and preview player all use hardcoded `white`, `#fff`, `hsl(0 0% 100% / X)`, `rgba(0,0,0,X)`, and `rgba(255,255,255,X)` values for their controls. These sit on dark backgrounds (video/shader canvas) so light-on-dark is the right default — but orgs should be able to customize the tint.

## Token Consumption Map

| Player Token | Replaces | Pattern |
|---|---|---|
| `--color-player-text` | `white`, `#fff`, `color: white` | Primary text, icons, active controls |
| `--color-player-text-secondary` | `hsl(0 0% 100% / 0.8)`, `rgba(255,255,255,0.8)` | Secondary labels, timestamps |
| `--color-player-text-muted` | `hsl(0 0% 100% / 0.5-0.7)`, `rgba(255,255,255,0.5-0.7)` | Tertiary info, inactive controls |
| `--color-player-surface` | `hsl(0 0% 100% / 0.1)`, `hsl(0 0% 100% / var(--opacity-10))` | Button backgrounds, track bg |
| `--color-player-surface-hover` | `hsl(0 0% 100% / 0.2)`, `hsl(0 0% 100% / var(--opacity-20))` | Hover states |
| `--color-player-surface-active` | `hsl(0 0% 100% / 0.3)`, `hsl(0 0% 100% / var(--opacity-30))` | Active/pressed states |
| `--color-player-border` | `hsl(0 0% 100% / 0.2)`, `1px solid hsl(0 0% 100% / 0.1-0.3)` | Borders, dividers |
| `--color-player-overlay` | `rgba(0,0,0,0.6)`, `hsl(0 0% 0% / var(--opacity-60))` | Dark overlay bg |
| `--color-player-overlay-heavy` | `rgba(0,0,0,0.8)`, `hsl(0 0% 0% / var(--opacity-80))` | Heavy dark overlay |
| `--color-player-gradient-bottom` | `hsl(0 0% 0% / var(--media-overlay-bottom-opacity))` | Bottom gradient for controls |

---

## Instructions

### Step 1: VideoPlayer/styles.css

**File**: `apps/web/src/lib/components/VideoPlayer/styles.css`

This is a Media Chrome component that uses custom properties. Replace ~23 instances:

**Replacements by pattern:**

Every `white` used as a color value → `var(--color-player-text)`:
- Line 108: `color: white` → `color: var(--color-player-text)`
- Line 134: `--media-primary-color: white` → `--media-primary-color: var(--color-player-text)`
- Line 135: `--media-text-color: white` → `--media-text-color: var(--color-player-text)`
- Line 245: `color: white` → `color: var(--color-player-text)`
- Line 329: `color: white` → `color: var(--color-player-text)`
- Line 522: `color: white` → `color: var(--color-player-text)`
- Line 677: `color: white` → `color: var(--color-player-text)`

Every `hsl(0 0% 100% / var(--opacity-10))` → `var(--color-player-surface)`:
- Lines 504, 532, 569: `background: hsl(0 0% 100% / var(--opacity-10))` → `background: var(--color-player-surface)`

Every `hsl(0 0% 100% / var(--opacity-20))` → `var(--color-player-surface-hover)`:
- Lines 214, 221, 227, 311, 431, 590: `background: hsl(0 0% 100% / var(--opacity-20))` → `background: var(--color-player-surface-hover)`

Every `hsl(0 0% 100% / var(--opacity-30))` → `var(--color-player-surface-active)`:
- Line 593: `background: hsl(0 0% 100% / var(--opacity-30))` → `background: var(--color-player-surface-active)`

Secondary text color:
- Line 135: `--media-secondary-color: hsl(0 0% 100% / var(--media-control-secondary-opacity))` → `--media-secondary-color: var(--color-player-text-secondary)`

Dark overlays:
- Line 176: gradient with `hsl(0 0% 0% / var(--media-overlay-bottom-opacity))` → gradient with `var(--color-player-gradient-bottom)`
- Line 676: `background: hsl(0 0% 0% / var(--opacity-60))` → `background: var(--color-player-overlay)`

Track/range backgrounds:
- Line 138: `--media-range-track-background: hsl(0 0% 100% / var(--opacity-20))` → `--media-range-track-background: var(--color-player-surface-hover)`
- Line 142: `--media-time-range-buffered-color: hsl(0 0% 100% / var(--media-range-buffered-opacity))` → keep as-is (uses existing media token) OR create `--color-player-track-buffered`

Loading spinner border:
- Line 59: `border: ... hsl(0 0% 100% / var(--media-loading-spinner-bg))` → `border: ... var(--color-player-surface-hover)` (or keep media token)

### Step 2: AudioPlayer.svelte

**File**: `apps/web/src/lib/components/AudioPlayer/AudioPlayer.svelte`

Replace ~25 instances in the `<style>` block:

Every `#fff` → `var(--color-player-text)`:
- Lines 615, 630, 735, 775, 788

Every `hsl(0 0% 100% / 0.8)` → `var(--color-player-text-secondary)`:
- Lines 607, 771

Every `hsl(0 0% 100% / 0.7)` → `var(--color-player-text-muted)`:
- Lines 658, 722

Every `hsl(0 0% 100% / 0.5)` → `var(--color-player-text-muted)`:
- Line 761

Every `hsl(0 0% 100% / 0.1)` → `var(--color-player-surface)`:
- Lines 580, 614, 736, 770, 782

Every `hsl(0 0% 100% / 0.15)` → `var(--color-player-surface)` (close to 0.1, same semantic):
- Lines 629, 675

Every `hsl(0 0% 100% / 0.25)` → `var(--color-player-surface-hover)`:
- Line 637

Every `hsl(0 0% 100% / 0.05)` → lower-opacity surface variant:
- Lines 579, 580 — use `var(--color-player-surface)` with reduced opacity or define `--color-player-surface-faint`

Border patterns:
- Line 597: `1px solid hsl(0 0% 100% / 0.1)` → `1px solid var(--color-player-border)`
- Lines 724, 737, 776: `hsl(0 0% 100% / 0.2-0.3)` borders → `var(--color-player-border)`

Raw opacity values:
- Line 619: `opacity: 0.4` → `opacity: var(--opacity-40)`
- Line 649: `opacity: 0.6` → `opacity: var(--opacity-60)`

Fallback patterns:
- Line 810: `var(--color-text-on-primary, #fff)` → `var(--color-text-on-primary, var(--color-player-text))`

### Step 3: ImmersiveShaderPlayer.svelte

**File**: `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte`

Replace ~13 instances:

- Line 357: `background: #000` → `background: var(--color-neutral-950, #000)` (this is the full-screen canvas bg)
- Line 395: `rgba(0, 0, 0, 0.6)` → `var(--color-player-overlay)`
- Line 398: `#fff` → `var(--color-player-text)`
- Line 405: `rgba(0, 0, 0, 0.8)` → `var(--color-player-overlay-heavy)`
- Line 410: `linear-gradient(transparent, rgba(0, 0, 0, 0.7))` → `linear-gradient(transparent, var(--color-player-overlay))`
- Line 417: `rgba(255, 255, 255, 0.2)` → `var(--color-player-surface-hover)`
- Line 418: `border-radius: 3px` → `border-radius: var(--radius-xs)`
- Line 426: `var(--color-primary-500, #6366f1)` — remove hardcoded fallback, use `var(--color-brand-primary, var(--color-primary-500))`
- Line 427: `border-radius: 3px` → `border-radius: var(--radius-xs)`
- Line 442: `rgba(255, 255, 255, 0.15)` → `var(--color-player-surface)`
- Line 445: `#fff` → `var(--color-player-text)`
- Line 452: `rgba(255, 255, 255, 0.3)` → `var(--color-player-surface-active)`
- Line 464: `rgba(255, 255, 255, 0.8)` → `var(--color-player-text-secondary)`

### Step 4: PreviewPlayer.svelte

**File**: `apps/web/src/lib/components/player/PreviewPlayer.svelte`

Replace ~8 instances:

- Line 266: `color-mix(in srgb, white 20%, transparent)` border → `var(--color-player-border)`
- Line 267: `color-mix(in srgb, white 80%, transparent)` → `var(--color-player-text-secondary)`
- Line 321: `linear-gradient(to top, color-mix(in srgb, black 70%, transparent) 0%, transparent 100%)` → `linear-gradient(to top, var(--color-player-overlay) 0%, transparent 100%)`
- Line 341: `color-mix(in srgb, white 15%, transparent)` → `var(--color-player-surface)`
- Line 360: `color-mix(in srgb, black 60%, transparent)` → `var(--color-player-overlay)`
- Line 384: `color-mix(in srgb, black 70%, transparent)` → `var(--color-player-overlay)`
- Line 407: `color-mix(in srgb, white 80%, transparent)` → `var(--color-player-text-secondary)`
- Line 460: `color-mix(in srgb, black 70%, transparent)` → `var(--color-player-overlay)`

---

## Verification Steps

### V1: VideoPlayer visual regression

1. Navigate to any org content page with a video
2. Play the video
3. Verify: all player controls (play/pause, volume, timeline, fullscreen) look identical to before
4. Verify: hover states on controls work
5. Verify: loading spinner appears correctly
6. Verify: bottom gradient overlay is still visible
7. Check cinema mode if applicable

### V2: AudioPlayer visual regression

1. Navigate to any org content page with audio
2. Play audio
3. Verify: all audio player controls look identical
4. Verify: hover states, active states work
5. Verify: progress bar renders correctly
6. Verify: volume controls work

### V3: ImmersiveShaderPlayer visual regression

1. Navigate to audio content with shader mode active
2. Verify: full-screen shader background is correct
3. Verify: overlay controls are visible and functional
4. Verify: progress bar renders with correct brand primary color
5. Verify: border-radius on progress bar uses token (rounded, not square)

### V4: PreviewPlayer visual regression

1. Find a content card with preview capability
2. Hover to trigger preview
3. Verify: overlay gradient is correct
4. Verify: play button and text are visible
5. Verify: badge backgrounds render correctly

### V5: Token override test

1. Open DevTools on a page with a video player visible
2. On `.org-layout`, set `--brand-player-text: #ff0000`
3. Verify: player control text/icons turn red
4. Set `--brand-player-surface: rgba(255, 0, 0, 0.2)`
5. Verify: player button backgrounds have a red tint
6. Set `--brand-player-overlay: rgba(0, 0, 255, 0.6)`
7. Verify: dark overlays have a blue tint
8. Remove all overrides → verify player returns to white-on-dark defaults

### V6: Cross-browser

1. Test in Chrome, Firefox, Safari
2. Verify all `var()` fallbacks resolve correctly
3. Pay special attention to `hsl()` values with opacity tokens

### V7: Dark mode

1. Toggle to dark theme
2. Verify player still looks correct (player is always dark bg, theme shouldn't matter)
