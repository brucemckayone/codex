# 01 — CSS Foundation

## Scope

The cross-cutting CSS loaded by the root `+layout.svelte`:

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/lib/styles/global.css` | 89 | Entry — imports everything, plus base element styles |
| `apps/web/src/lib/styles/utilities.css` | 138 | Shared utility classes + shared keyframes |
| `apps/web/src/lib/styles/view-transitions.css` | 57 | Named view transitions + reduced-motion fallback |
| `apps/web/src/lib/styles/tokens/*.css` | ~13 files | Design tokens (colours, spacing, typography, motion…) |
| `apps/web/src/lib/styles/themes/{light,dark}.css` | — | Semantic theme overlays |
| `apps/web/src/lib/theme/reset.css` | 108 | Modern CSS reset (still canonical, imported by global.css:4) |
| `apps/web/src/lib/theme/base.css` | 344 | Base element styling (imported by global.css:28) |
| `apps/web/src/lib/theme/tokens/org-brand.css` | — | OKLCH relative-colour overrides gated by `[data-org-brand]` |
| `apps/web/src/lib/theme/utilities.css` | **311** | **Dead — not imported anywhere** |
| `apps/web/postcss.config.js` | — | `postcss-custom-media` + `postcss-global-data` |

## CSS modernity

### In use — good

- **Custom media queries** (`@custom-media --breakpoint-sm (min-width: 40rem)`) defined in `tokens/breakpoints.css`, loaded globally via `postcssGlobalData`, and consumed as `@media (--breakpoint-sm)` in 22+ files. Pipeline verified (`postcss.config.js:2-9`).
- **`:has()` pseudo-class** driving the featured-grid layout variant (`utilities.css:50-60`): `.content-grid--featured:has(> :nth-child(4)) > :first-child { grid-column: span 2; }`. Elegant use — guards against awkward layouts when there are fewer than 4 items, no JS needed.
- **Container queries** — every content-grid cell becomes `container-type: inline-size` (`utilities.css:65-67`), so `ContentCard` can adapt to its cell rather than the viewport. This is exactly the pattern the feature is for.
- **View Transitions API** — named transitions for the sidebar morph (org rail ↔ studio sidebar) and page-content dissolve, with a `prefers-reduced-motion` kill switch (`view-transitions.css:49-57`).
- **`text-wrap: pretty`** on paragraphs (`global.css:74`) and `text-wrap: balance` on headings (`theme/reset.css:60`). Both ship in modern browsers.
- **Modern colour notation** — `rgb(0 0 0 / 0.5)` in themes (no commas, slash alpha).
- **Relative colour syntax** (OKLCH) in `org-brand.css` for per-org palette derivation.

### Missing — adoption candidates

- **No `@layer` cascade layers**. Zero occurrences in `src/`. Today the import order + `:root`/`[data-theme="light"]` selectors are doing the cascade work. Adopting `@layer reset, tokens, base, utilities, components` would:
  - Make it explicit that utilities beat base which beats reset.
  - Let the org-brand overlay sit in its own layer so its `[data-org-brand]`-gated rules never need specificity bumps.
  - Eliminate the need for future `!important` bandaids when component styles clash with base styles.
- **No `@property` declarations**. Useful for typed animatable custom props (e.g. animating `--brand-color` via OKLCH interpolation). Not urgent — flag for the brand-editor audit.
- **No `color-mix()`** in the authored CSS (relative-colour syntax is used instead). `color-mix()` would be a simpler fit for 60/40 tints than the current mix of `-50`/`-100`/`-200` semitones.

## Inheritance & reuse

### Import graph is clean

`global.css` is the single entry — SvelteKit's root layout imports it once (`+layout.svelte:10`). Downstream imports are a simple tree:

```
global.css
├── theme/reset.css                (1 import, canonical reset)
├── tokens/*.css                   (12 files, each adds :root vars)
├── themes/{light,dark}.css        (semantic overlays)
├── theme/tokens/org-brand.css     (per-org overrides)
├── theme/base.css                 (base element styles)
├── view-transitions.css
└── utilities.css
```

One entry, no circular imports, no runtime CSS-in-JS. Good.

### Token layering

Three well-separated tiers:

1. **Primitive** (`tokens/colors.css:3-25`) — `--color-primary-500`, `--color-neutral-*` — raw hex values.
2. **Semantic** (`themes/light.css:1-51`) — `--color-text`, `--color-surface`, `--color-interactive` — reference primitives.
3. **Component** — each Svelte component's `<style>` references semantic tokens.

This is the layering a design-system should have. The 2026-04-03 audit's TM-1 violation class (`--color-primary-N` direct references) is the remaining migration task for tier 3 → tier 2.

## Wasted code

### `theme/utilities.css` — 311 lines, completely dead

Verified: no import, no grep hit anywhere in `apps/web/src`, `tests/`, `e2e/`, or other packages. The only references are in `design/frontend/STYLING.md:811` (a stale guide) and agent worktrees under `.claude/`. **Delete target**.

### `.sr-only` defined three times

| File | Lines | Identical? |
|---|---:|---|
| `styles/global.css` | 79-89 | Yes |
| `styles/utilities.css` | 128-138 | Yes |
| `theme/base.css` | `.sr-only` selector | Yes |

Three copies of the same 9-declaration block. Last import wins — the definition in `utilities.css` is the effective one. Two copies are bloat. **Keep one** (utilities.css makes the most sense).

### `global.css` duplicates base element rules

Lines 37-76 of `global.css` redefine styles for `html`, `body`, `a`, `button`, `h1-h6`, `p` — **but `theme/base.css` (344 lines) is already imported two lines earlier** (`global.css:28`). This is historical overlap from a consolidation comment on line 3 that was never completed (`/* Reset (consolidated from lib/theme/reset.css) */`). Audit point for Section 02.

### Two parallel style trees

`lib/styles/` (canonical) and `lib/theme/` (legacy) coexist. After deleting `theme/utilities.css`, `theme/` would still hold `reset.css`, `base.css`, and `tokens/org-brand.css` — all actively imported. Long-term simplification: move the three surviving files into `styles/` and drop `theme/` entirely.

## Simplification opportunities

Ranked by impact/effort:

1. **Delete `theme/utilities.css`** — 311 lines, zero callers. One-commit win. Impact: -311 lines of maintenance surface.
2. **Dedupe `.sr-only`** — keep only the `utilities.css` copy, remove from `global.css` and `theme/base.css`. Impact: kills two copy-paste landmines.
3. **Collapse `global.css` base rules into `theme/base.css`** — the `a`, `button`, `h1-h6`, `p`, `html`, `body` blocks (lines 37-76) all overlap with `theme/base.css`. Move the delta (e.g. `color: var(--color-text)` on `html`) into `base.css` and remove the duplication. `global.css` becomes pure import manifest + app-wide element defaults.
4. **Adopt `@layer`** — wrap reset/tokens/base/utilities in named layers so future overrides don't fight the cascade. Low effort (wrap existing `@import`s), medium payoff.
5. **Rationalise `theme/` → `styles/`** — once (1) and (3) land, `theme/` only contains `base.css`, `reset.css`, and `tokens/org-brand.css`. Move them to mirror `styles/base.css`, `styles/reset.css`, `styles/tokens/org-brand.css`. Single CSS root directory.
6. **Define `--color-white`/`--color-black` tokens** — `themes/light.css` hardcodes `#ffffff` for `--color-surface`, `--color-surface-elevated`, `--color-surface-card`, `--color-text-inverse`, `--color-text-on-brand`. Add two primitives so dark-mode parity is trivial.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 1.1 | High | `theme/utilities.css` (311 lines) is unreferenced | Delete the file |
| 1.2 | Medium | `.sr-only` defined in 3 separate stylesheets | Keep only `styles/utilities.css:128-138`; remove from `global.css` and `theme/base.css` |
| 1.3 | Medium | `global.css:37-76` re-defines base element styles already owned by `theme/base.css` | Move the delta into `base.css`; `global.css` stays an import manifest |
| 1.4 | Medium | `lib/styles/` and `lib/theme/` are two parallel CSS roots | After deduping, relocate surviving `theme/*` files into `styles/` and delete `theme/` |
| 1.5 | Low | No `@layer` cascade layers | Wrap reset/tokens/themes/base/utilities in named `@layer`s for explicit cascade ordering |
| 1.6 | Low | `--color-white` / `--color-black` primitives missing; `#ffffff` hardcoded in themes | Introduce the two primitives, reference them from semantic tokens |
| 1.7 | Low | `global.css:3` comment claims reset was consolidated but both files still exist | Fix the comment after the file consolidation lands |

## Quantitative summary

- Dead code identified: **311 lines** (1 file) + ~20 duplicate lines (scattered) = **~330 lines to remove** with zero behaviour change.
- Modern-CSS adoption: **strong** (custom media, `:has`, container queries, view transitions) with one notable gap (cascade layers).
- Token architecture: **healthy** tiering; residual tier-3 migration tracked by the 2026-04-03 audit.

## Next section

02 — Base elements (`theme/base.css` — 344 lines governing h1-h6, forms, tables, code, lists, focus).
