# WP-04: Overlay Component Cleanup

## Goal

Replace all hardcoded color values in HeroInlineVideo, IntroVideoModal, ContentDetailView, and CreatorProfileDrawer with semantic tokens.

## Depends On

- WP-01 (Foundation) — player tokens, glass-tint token, text-inverse token must exist
- WP-03 (Player Chrome) — player token patterns established

## Background

These four components render content over dark backgrounds (video, shader, or image overlays). They share the same hardcoded patterns as the player components: `white`/`black`/`color-mix(black X%)` for text and overlays. They should consume the same `--color-player-*` semantic tokens plus `--color-text-inverse` for creator/content contexts.

---

## Instructions

### Step 1: HeroInlineVideo.svelte

**File**: `apps/web/src/lib/components/ui/HeroInlineVideo/HeroInlineVideo.svelte`

~10 replacements:

| Line | Current | Replacement |
|---|---|---|
| 258 | `background: black` | `background: var(--color-neutral-950, black)` |
| 268 | `color-mix(in srgb, black 20%, transparent)` | `var(--color-player-surface)` |
| 275 | `color-mix(in srgb, black 30%, transparent)` | `var(--color-player-surface-active)` |
| 289 | `color-mix(in srgb, black 40%, transparent)` | `var(--color-player-overlay)` (reduced) |
| 290 | `white` (in SVG fill/color) | `var(--color-player-text)` |
| 297 | `color-mix(in srgb, black 60%, transparent)` | `var(--color-player-overlay)` |
| 304 | `white` | `var(--color-player-text)` |
| 316 | `color-mix(in srgb, black 50%, transparent)` | `var(--color-player-overlay)` |
| 317 | `white` | `var(--color-player-text)` |
| 324 | `color-mix(in srgb, black 70%, transparent)` | `var(--color-player-overlay-heavy)` |

Also replace hardcoded animation timings:
- Line 215: `800ms` → `var(--duration-slower)` (if close enough) or `calc(var(--duration-slow) * 2.5)`
- Line 216: `700ms` delay → `var(--duration-slower)` or keep as choreography constant

### Step 2: IntroVideoModal.svelte

**File**: `apps/web/src/lib/components/ui/IntroVideoModal/IntroVideoModal.svelte`

~10 replacements:

| Line | Current | Replacement |
|---|---|---|
| 206 | `color-mix(in srgb, black 30%, transparent)` | `var(--color-player-surface-active)` |
| 230 | `color-mix(in srgb, black 40%, transparent)` | `var(--color-player-overlay)` (reduced) |
| 231 | `white` | `var(--color-player-text)` |
| 238 | `color-mix(in srgb, black 60%, transparent)` | `var(--color-player-overlay)` |
| 274 | `black` | `var(--color-neutral-950, black)` |
| 283 | `color-mix(in srgb, black 20%, transparent)` | `var(--color-player-surface-hover)` |
| 290 | `color-mix(in srgb, black 30%, transparent)` | `var(--color-player-surface-active)` |
| 303 | `color-mix(in srgb, black 50%, transparent)` | `var(--color-player-overlay)` |
| 304 | `white` | `var(--color-player-text)` |
| 311 | `color-mix(in srgb, black 70%, transparent)` | `var(--color-player-overlay-heavy)` |

Radial gradient mask (line 256): `radial-gradient(ellipse 92% 92% at center, black 60%, transparent 100%)` — this is an alpha mask. **Exception: keep `black` as-is** (mask channel, not visual color).

Text shadow (line 479): `0 1px 3px oklch(0 0 0 / 0.3)` → `0 1px 3px var(--color-player-overlay)` or a dedicated shadow token

### Step 3: ContentDetailView.svelte

**File**: `apps/web/src/lib/components/content/ContentDetailView.svelte`

~8 replacements:

| Line | Current | Replacement |
|---|---|---|
| 258 | `color: black` | `color: var(--color-text)` (this is page text, not overlay text) |
| 477 | `color: white` | `color: var(--color-text-inverse)` |
| 490-492 | `oklch(0 0 0 / 0.7)`, `oklch(0 0 0 / 0.4)`, `oklch(0 0 0 / 0)` in gradient | `var(--color-player-overlay)`, `var(--color-player-overlay) / adjusted`, `transparent` |
| 602-604 | `color-mix(in srgb, black 80/40/20%, transparent)` gradient | Use `var(--color-player-overlay-heavy)` for 80%, `var(--color-player-overlay)` for others |
| 695 | `text-transform: uppercase` | `text-transform: var(--text-transform-label, uppercase)` |

Animation durations:
- Line 577: `1.5s infinite` — shimmer animation, keep as choreography constant
- Line 621: `2s ease-in-out infinite` — keep as choreography constant

### Step 4: CreatorProfileDrawer.svelte

**File**: `apps/web/src/lib/components/ui/CreatorCard/CreatorProfileDrawer.svelte`

~6 replacements:

| Line | Current | Replacement |
|---|---|---|
| 446 | `font-size: 6rem` | `font-size: var(--text-4xl)` or `clamp(3rem, 8vw, 6rem)` |
| 460-465 | `oklch(0 0 0 / 0.7)`, `oklch(0 0 0 / 0.4)`, `oklch(0 0 0 / 0)` gradient | Use `var(--color-player-overlay)` for 0.7, gradient to transparent |
| 477 | `color: white` | `color: var(--color-text-inverse)` |
| 479 | `text-shadow: 0 1px 3px oklch(0 0 0 / 0.3)` | `text-shadow: 0 1px 3px var(--color-player-overlay)` |
| 490 | `oklch(1 0 0 / 0.8)` | `var(--color-player-text-secondary)` or `hsl(0 0% 100% / var(--opacity-80))` |
| 491 | `text-shadow: 0 1px 2px oklch(0 0 0 / 0.3)` | `text-shadow: 0 1px 2px var(--color-player-overlay)` |
| 603 | `scale(1.08)` | `scale(var(--card-image-hover-scale, 1.08))` |

Also:
- Line 450: `var(--opacity-40, 0.4)` — remove hardcoded fallback, use `var(--opacity-40)`

---

## Verification Steps

### V1: HeroInlineVideo visual regression

1. Navigate to org landing page with intro video
2. On desktop (>768px), click the play button to trigger inline video
3. Verify: video appears with correct dark overlay, white controls
4. Verify: close button works and looks correct
5. Verify: animation/transition feels the same

### V2: IntroVideoModal visual regression

1. On mobile viewport, click the "Watch Intro" button
2. Verify: modal opens with correct backdrop
3. Verify: play button overlay renders correctly
4. Verify: close button renders correctly
5. Close modal → verify animation is smooth

### V3: ContentDetailView visual regression

1. Navigate to a content detail page (e.g., `/content/some-slug`)
2. Verify: gradient overlays on thumbnail/hero are correct
3. Verify: text colors are correct (body text, labels)
4. Verify: text-transform on labels uses token (visually unchanged)
5. Play content → verify player overlay integrates correctly

### V4: CreatorProfileDrawer visual regression

1. Navigate to creators page
2. Click a creator card to open the profile drawer
3. Verify: large text displays correctly (font-size not broken)
4. Verify: overlay gradient on image is correct
5. Verify: white text on dark overlay is readable
6. Verify: hover scale on image works
7. Close drawer → verify animation is smooth

### V5: Token override test

1. On `.org-layout`, set `--brand-player-text: #00ff00`
2. Verify: HeroInlineVideo controls turn green
3. Verify: IntroVideoModal close/play buttons turn green
4. Verify: CreatorProfileDrawer text stays white (uses `--color-text-inverse`, not player token)
5. Set `--color-text-inverse: #ff0000` via tokenOverrides
6. Verify: CreatorProfileDrawer text turns red
