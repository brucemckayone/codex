# WP-01: Foundation — Blind Spots, New Tokens & Heading Color

## Goal

Fix the 6 "blind spot" tokens that ignore org branding, introduce new token categories (player, glass, heading, easing, tracking, text-transform, card interaction), and establish the token foundation that all subsequent work packets depend on.

## Background

### The Blind Spots

Six tokens defined in `light.css`/`dark.css` are NOT re-derived by `org-brand.css`. They remain hardcoded neutral grays regardless of what the org brand editor sets:

| Token | light.css value | dark.css value | Impact |
|---|---|---|---|
| `--color-text-tertiary` | `neutral-500` | `neutral-400` | Nav labels, footer hints, sidebar — stays gray on branded orgs |
| `--color-text-disabled` | `neutral-400` | `neutral-600` | Disabled form elements — stays gray |
| `--color-text-inverse` | `#ffffff` | `neutral-900` | `::selection` highlight, inverted text — stays fixed |
| `--color-border-hover` | `neutral-300` | `neutral-500` | Input `:hover` borders — stays gray |
| `--color-surface-overlay` | `rgb(0 0 0 / 0.5)` | `rgb(0 0 0 / 0.7)` | Modal backdrops — always black |
| `--color-surface-variant` | `neutral-100` | `#3a3a3a` | Alt containers (CreatorCard) — stays gray |

### Missing Token Categories

The token system lacks definitions for:
- **Player chrome** — video/audio player controls (currently all hardcoded `white`/`hsl(0 0% 100% / ...)`)
- **Glass tint** — base color for glass morphism effects (currently hardcoded `white`/`black`)
- **Heading color** — independent from body text (currently shares `--color-text-primary`)
- **Easing** — two custom cubic-bezier curves used across multiple components but not tokenized
- **Letter spacing** — missing `--tracking-tighter: -0.03em` used in pricing
- **Text transform** — `uppercase` hardcoded in 30+ places, should be brandable
- **Card interaction** — hover scale, image zoom scale

---

## Instructions

### Step 1: Fix blind spot tokens in org-brand.css

**File**: `apps/web/src/lib/theme/tokens/org-brand.css`

Add to the EXISTING `[data-org-brand]` block (after the `--shadow-color` line, before the closing `}`):

```css
/* ─── BLIND SPOT FIXES ─────────────────────────────────────────── */
/* These tokens were NOT re-derived from brand inputs. They stayed
   hardcoded neutral-gray regardless of org branding. */
--color-text-tertiary: oklch(from var(--brand-color, var(--color-primary-500)) calc(l * 0.6 + 0.2) calc(c * 0.1) h);
--color-text-disabled: oklch(from var(--brand-bg, white) clamp(0.4, abs(0.45 - l) + 0.4, 0.7) calc(c * 0.05) h);
--color-border-hover: oklch(from var(--brand-bg, white) calc(l - 0.15) calc(c * 0.3) h);
--color-surface-variant: oklch(from var(--brand-bg, white) calc(l - 0.04) calc(c * 0.4) h);

/* ─── HEADING COLOR ─────────────────────────────────────────────── */
--color-heading: var(--brand-heading-color, var(--color-text-primary));
```

Add to the EXISTING `[data-org-bg]` block (after `--color-border-subtle`):

```css
/* ─── BLIND SPOT FIXES (BG-DERIVED) ────────────────────────────── */
--color-text-tertiary: oklch(from var(--brand-bg, white) clamp(0.35, abs(0.5 - l) + 0.35, 0.6) 0 0);
--color-text-disabled: oklch(from var(--brand-bg, white) clamp(0.4, abs(0.45 - l) + 0.4, 0.65) 0 0);
--color-text-inverse: oklch(from var(--brand-bg, white) clamp(0, (l - 0.5) * 1000, 1) 0 0);
--color-border-hover: oklch(from var(--brand-bg, white) calc(l - 0.15) calc(c * 0.3) h);
--color-surface-overlay: oklch(from var(--brand-bg, white) clamp(0, (0.5 - l) * 2, 0.15) 0 0 / 0.6);
--color-surface-variant: oklch(from var(--brand-bg, white) calc(l - 0.04) calc(c * 0.4) h);
```

Add dark mode derivations to the `.dark [data-org-brand]` block:

```css
--color-text-tertiary: oklch(from var(--brand-color-dark, var(--brand-color, var(--color-primary-400))) calc(l * 0.5 + 0.3) calc(c * 0.1) h);
--color-text-disabled: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) clamp(0.3, abs(0.5 - l) + 0.3, 0.5) 0 0);
--color-border-hover: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) calc(l + 0.15) calc(c * 0.3) h);
--color-surface-variant: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) calc(l + 0.06) calc(c * 0.4) h);
```

Add dark mode derivations to the `.dark [data-org-bg]` block:

```css
--color-text-tertiary: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) clamp(0.35, abs(0.5 - l) + 0.35, 0.6) 0 0);
--color-text-disabled: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) clamp(0.4, abs(0.45 - l) + 0.4, 0.65) 0 0);
--color-text-inverse: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) clamp(0, (l - 0.5) * 1000, 1) 0 0);
--color-border-hover: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) calc(l + 0.15) calc(c * 0.3) h);
--color-surface-overlay: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) clamp(0, (0.5 - l) * 2, 0.15) 0 0 / 0.75);
--color-surface-variant: oklch(from var(--brand-bg-dark, var(--brand-bg, #1a1a2e)) calc(l + 0.06) calc(c * 0.4) h);
```

Add heading selector (after the `[data-org-brand]` typography weight overrides block):

```css
[data-org-brand] :is(h1, h2, h3, h4, h5, h6) {
  color: var(--color-heading);
}
```

### Step 2: Create player.css token file

**File**: `apps/web/src/lib/styles/tokens/player.css` (NEW FILE)

```css
/* player.css — Semantic tokens for video/audio player chrome.
 * Inverse color scheme: light content on dark background.
 * Overridable per-org via [data-org-brand] in org-brand.css. */

:root {
  --color-player-text: white;
  --color-player-text-secondary: hsl(0 0% 100% / var(--opacity-80, 0.8));
  --color-player-text-muted: hsl(0 0% 100% / var(--opacity-60, 0.6));
  --color-player-surface: hsl(0 0% 100% / var(--opacity-10, 0.1));
  --color-player-surface-hover: hsl(0 0% 100% / var(--opacity-20, 0.2));
  --color-player-surface-active: hsl(0 0% 100% / var(--opacity-30, 0.3));
  --color-player-border: hsl(0 0% 100% / var(--opacity-20, 0.2));
  --color-player-overlay: hsl(0 0% 0% / var(--opacity-60, 0.6));
  --color-player-overlay-heavy: hsl(0 0% 0% / var(--opacity-80, 0.8));
  --color-player-gradient-bottom: hsl(0 0% 0% / var(--media-overlay-bottom-opacity, 0.7));
}
```

### Step 3: Add player overrides to org-brand.css

Add to the `[data-org-brand]` block:

```css
/* ─── PLAYER CHROME ─────────────────────────────────────────────── */
--color-player-text: var(--brand-player-text, white);
--color-player-text-secondary: var(--brand-player-text-secondary, hsl(0 0% 100% / var(--opacity-80, 0.8)));
--color-player-text-muted: var(--brand-player-text-muted, hsl(0 0% 100% / var(--opacity-60, 0.6)));
--color-player-surface: var(--brand-player-surface, hsl(0 0% 100% / var(--opacity-10, 0.1)));
--color-player-surface-hover: var(--brand-player-surface-hover, hsl(0 0% 100% / var(--opacity-20, 0.2)));
--color-player-surface-active: var(--brand-player-surface-active, hsl(0 0% 100% / var(--opacity-30, 0.3)));
--color-player-border: var(--brand-player-border, hsl(0 0% 100% / var(--opacity-20, 0.2)));
--color-player-overlay: var(--brand-player-overlay, hsl(0 0% 0% / var(--opacity-60, 0.6)));
--color-player-overlay-heavy: var(--brand-player-overlay-heavy, hsl(0 0% 0% / var(--opacity-80, 0.8)));

/* ─── GLASS TINT ────────────────────────────────────────────────── */
--color-glass-tint: var(--brand-glass-tint, white);

/* ─── TEXT TRANSFORM ────────────────────────────────────────────── */
--text-transform-label: var(--brand-text-transform-label, uppercase);

/* ─── CARD INTERACTION ──────────────────────────────────────────── */
--card-hover-scale: var(--brand-card-hover-scale, 1.02);
--card-image-hover-scale: var(--brand-card-image-hover-scale, 1.05);
```

### Step 4: Add new tokens to existing token files

**File**: `apps/web/src/lib/styles/tokens/colors.css`

Add at the end of the `:root` block:

```css
/* Glass tint base colors (overridden per-org via org-brand.css) */
--color-glass-tint: white;
--color-glass-tint-dark: black;
```

**File**: `apps/web/src/lib/styles/tokens/typography.css`

Add at the end of the `:root` block:

```css
/* Additional tracking */
--tracking-tighter: -0.03em;

/* Text Transform (brandable via org-brand.css) */
--text-transform-label: uppercase;
--text-transform-meta: capitalize;
```

**File**: `apps/web/src/lib/styles/tokens/motion.css`

Add at the end of the `:root` block (BEFORE the `@media (prefers-reduced-motion)` block):

```css
/* Extended Easings */
--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.22, 1.2, 0.36, 1);
```

### Step 5: Import player.css in global.css

**File**: `apps/web/src/lib/styles/global.css`

Add after the `@import './tokens/opacity.css';` line:

```css
@import './tokens/player.css';
```

### Step 6: Add heading-color to BRAND_PREFIX_KEYS

**File**: `apps/web/src/lib/brand-editor/css-injection.ts`

Add `'heading-color'` to the `BRAND_PREFIX_KEYS` set (in the block after the hero layout keys, before the shader keys).

---

## Verification Steps

### V1: Blind spot tokens respond to branding

1. Start `pnpm dev` from monorepo root
2. Navigate to an org page (e.g., `bruce-studio.lvh.me:3000`)
3. Open browser DevTools → Elements → find `.org-layout[data-org-brand]`
4. For each blind spot token (`--color-text-tertiary`, `--color-text-disabled`, `--color-text-inverse`, `--color-border-hover`, `--color-surface-overlay`, `--color-surface-variant`):
   - Check the Computed tab → verify the value is NOT the neutral gray default
   - Verify it's derived from the org's brand color/background
5. Open brand editor → change Background Color to a dark value (e.g., `#1a1a2e`)
6. Re-check all 6 tokens — they should adapt to the dark background
7. Toggle dark mode → verify dark mode derivations also work

### V2: Heading color token

1. Open browser DevTools → verify `--color-heading` exists on `.org-layout[data-org-brand]`
2. Verify headings (h1-h6) on the page use `color: var(--color-heading)`
3. In DevTools, manually set `--brand-heading-color: #0000ff` on `.org-layout` → verify all headings turn blue while body text stays unchanged
4. Remove the manual override → verify headings revert to `--color-text-primary`

### V3: Player tokens exist

1. In DevTools, verify all `--color-player-*` tokens are defined on `:root`
2. Verify they are also re-declared under `.org-layout[data-org-brand]` with `var(--brand-player-*)` wrappers
3. Manually set `--brand-player-text: #ff0000` on `.org-layout` → this should not visually change anything yet (player components haven't been updated to consume these tokens — that's WP-03)

### V4: New token files and values

1. Verify `player.css` is imported (check browser DevTools → Sources/Styles for the file)
2. Verify `--ease-smooth` exists in `:root` (motion.css)
3. Verify `--ease-spring` exists in `:root` (motion.css)
4. Verify `--tracking-tighter` exists in `:root` (typography.css)
5. Verify `--text-transform-label` exists in `:root` (typography.css)
6. Verify `--text-transform-meta` exists in `:root` (typography.css)
7. Verify `--color-glass-tint` exists in `:root` (colors.css)
8. Verify `--card-hover-scale` exists under `[data-org-brand]` (org-brand.css)

### V5: No visual regression

1. Navigate through: org landing, explore, content detail, pricing, library, creators, studio
2. Verify NO visual changes — all new tokens should resolve to the same values as the previous hardcoded defaults
3. Run `pnpm typecheck` — no errors
4. Compare screenshots before/after if possible (Playwright MCP)

### V6: heading-color in BRAND_PREFIX_KEYS

1. Open `css-injection.ts` → verify `'heading-color'` is in the `BRAND_PREFIX_KEYS` set
2. This ensures the brand editor will inject it as `--brand-heading-color` (not `--color-heading-color`)
