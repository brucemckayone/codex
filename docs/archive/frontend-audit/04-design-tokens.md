# 04 — Design Tokens

## Scope

The 13-file `apps/web/src/lib/styles/tokens/` tree plus the two theme overlays `themes/{light,dark}.css`. These declare every primitive and semantic CSS custom property the rest of the app composes from.

| File | Lines | Role |
|---|---:|---|
| `colors.css` | 59 | Primitive palette (primary, neutral, success/warning/error/info, glass-tint bases) |
| `spacing.css` | 23 | Density-aware spacing scale `--space-0` → `--space-24` |
| `typography.css` | 52 | Font stacks, fluid `clamp()` sizes, weights, line heights, tracking, plus `Inter-fallback` `@font-face` |
| `motion.css` | 42 | Durations, easings, composite transitions, reduced-motion branch |
| `radius.css` | 19 | Radius scale + semantic aliases (`--radius-button` etc.) |
| `shadows.css` | 34 | HSL-component shadows, dark-mode shadow intensity override |
| `borders.css` | 16 | Widths, styles, compound tokens |
| `z-index.css` | 15 | Stacking layers |
| `opacity.css` | 40 | Opacity scale + media-player semantic aliases |
| `materials.css` | 34 | Glass material + blurs + a `.glass` class |
| `player.css` | 16 | Inverse-theme tokens for video/audio player chrome |
| `layout.css` | 28 | Breakpoint widths (as custom properties) + container widths |
| `breakpoints.css` | 22 | PostCSS `@custom-media` declarations (build-time) |

Plus `themes/light.css` (51 lines) and `themes/dark.css` (51 lines) that apply semantic overlays onto the primitives.

## CSS modernity

### In use — genuinely impressive

- **Density-scaled spacing** (`spacing.css:4`): `--space-unit: calc(0.25rem * var(--brand-density-scale, 1))`. Every spacing token becomes a calc() over a single density multiplier. An org setting `--brand-density-scale: 1.15` can globally loosen the UI — rare capability, well executed.
- **Radius scaled from `--radius-base`** (`radius.css:4`): same pattern. One knob drives the whole radius scale per org.
- **Fluid typography with `clamp()`** (`typography.css:9-16`): every `--text-*` is `clamp(min, preferred, max)` — responsive without media queries. Standard practice in 2026 but it's present and consistent here.
- **`Inter-fallback` with size-adjust** (`typography.css:44-51`): a metrics-matched fallback using `size-adjust: 107%`, `ascent-override: 90%` etc. to prevent CLS during web-font swap. Sophisticated detail.
- **HSL-component shadow composition** (`shadows.css`): shadows are composed from `hsl(var(--shadow-color) / calc(var(--shadow-strength) + N%))`. Dark mode redefines both components (line 32-33) and the entire shadow scale recomposes automatically. Elegant.
- **`hsl(0 0% 100% / var(--opacity-80, 0.8))`** in `player.css`: opacity tokens compose with colour-space notation — a rare case of fully-tokenised alpha.
- **`@custom-media` + `postcssGlobalData`**: build-time custom media queries make `@media (--breakpoint-md)` available everywhere (documented in Section 01).
- **Reduced-motion branch** (`motion.css:30-42`): both redefines the duration tokens and applies `!important` overrides belt-and-braces.

### Missing — adoption candidates

- **No `@property` declarations**. Tokens like `--brand-density-scale`, `--radius-base`, `--shadow-color`, `--shadow-strength` are custom properties that would benefit from `@property` typing:
  ```css
  @property --brand-density-scale { syntax: '<number>'; inherits: true; initial-value: 1; }
  @property --shadow-color { syntax: '<string>'; inherits: true; initial-value: '220 3% 15%'; }
  ```
  This enables CSS-level animation of these values (OKLCH tween between theme changes, density change transitions), AND prevents cascade-inherit bugs if a component forgets to set them.
- **OKLCH only used in `org-brand.css`**. Primitive palette (`colors.css:3-25`) is all sRGB hex. The primary ramp `#fef2f0 → #792b1e` has predictable OKLCH spacing on paper but no enforcement. Migrating primitives to `oklch(…)` would enable perceptually-uniform tint math with `color-mix()`/relative colours across the board.
- **No `color-mix()` usage**. Typical need — tints like `--color-interactive-subtle` — currently get hand-picked hex values from the `-50`/`-100` rung. `color-mix(in oklch, var(--color-interactive) 10%, transparent)` would derive them automatically.

## Inheritance & reuse

### Three-tier composition is working

**Primitive (`colors.css`) → Semantic (`themes/light.css`, `dark.css`) → Component CSS.** Dark mode is a near-complete mirror of light — every semantic key rebound. Two exceptions to note:

- `--color-text-on-brand: #ffffff` in **both** themes (`light.css:21`, `dark.css:21`). Always white regardless of theme. Could be a single declaration in `:root`.
- `--color-surface-variant: var(--color-neutral-750, #3a3a3a)` in `dark.css:11` — `--color-neutral-750` is **not defined anywhere** in the primitive palette (which jumps 700 → 800). The hex fallback `#3a3a3a` always wins. **Either define `--color-neutral-750` in `colors.css` or drop the pretence and write `#3a3a3a` directly** (but prefer the former — keeps the scale complete).

### Semantic aliases most components ignore

`radius.css:14-18` declares four semantic aliases:

| Alias | Points to | Grep consumers |
|---|---|---:|
| `--radius-button` | `--radius-md` | **0** |
| `--radius-input` | `--radius-md` | 3 |
| `--radius-card` | `--radius-lg` | **0** |
| `--radius-modal` | `--radius-xl` | 2 |

Components reach for `--radius-md` / `--radius-lg` directly. The semantic layer exists but didn't catch on. Either:
1. Migrate components to the semantic names (preserves future flexibility — e.g. if modals later want smaller corners than other xl-scale surfaces).
2. Delete the aliases and rely on the numeric scale.

Same pattern for **opacity tokens**: `--opacity-50` etc. is well-adopted, but the `--media-*` semantic opacity aliases (`opacity.css:28-39`) give each value a name specific to media chrome. Check if the VideoPlayer audit (Section 25) actually uses those semantic names or reaches past them.

### Token name collisions & redundancy

Several near-duplicates worth cleaning:

| Redundancy | Files | Note |
|---|---|---|
| `--ease-default` = `--ease-in-out` (identical `cubic-bezier(0.4, 0, 0.2, 1)`) | `motion.css:10, 13` | Pick one name |
| `--leading-tight: 1.25` vs `--leading-snug: 1.3` | `typography.css:26-27` | 0.05 apart — visually indistinguishable; pick one |
| `--tracking-tighter: -0.03em` vs `--tracking-tight: -0.025em` | `typography.css:32-33` | 0.005em = one-eighth of a pixel at 16px base |
| `--color-text` vs `--color-text-primary` | `themes/{light,dark}.css` | Already flagged in 2.6 — identical, 351 vs 30 refs |

## Wasted code

Verified by grep across `apps/web/src/**/*.svelte`, `*.css`, `*.ts`, excluding the `tokens/` and `themes/` definition files and agent worktrees:

| Token | Consumers | Status |
|---|---:|---|
| `--text-transform-meta` | 0 | Unused |
| `--shadow-xs` | 0 | Unused |
| `--shadow-inner` | 0 | Unused |
| `--radius-button` | 0 | Unused alias |
| `--radius-card` | 0 | Unused alias |
| `--z-popover` | 0 | Unused |
| `--z-hide` | 0 | Unused |
| `--color-neutral-750` | **Referenced but undefined** | Hex fallback masks the missing token |
| `.glass` class (`materials.css:29-34`) | 0 | Class never applied; the `--material-glass` custom property itself IS used (8 callers) |

**Unused but probably intentional (design-system completeness)**: `--space-5-5` (1 caller), `--tracking-normal` (1 caller), `--opacity-0/100` (the endpoints). These might stay for API symmetry even if rarely consumed.

### Dead class: `.glass`

`materials.css:29-34` defines a utility class that applies the glass material. Zero grep hits across the whole `apps/web/` tree. The *variable* `--material-glass` is consumed in 8 places, so the token stays. The *class* can go.

## Simplification opportunities

Ranked by impact/effort:

1. **Fix `--color-neutral-750` ghost reference** — either add it to `colors.css` (`#3a3a3a` sits naturally between 700 and 800) or inline the hex in `dark.css`. Right now the token API lies about what's defined.
2. **Delete 7 confirmed-unused tokens** — `--text-transform-meta`, `--shadow-xs`, `--shadow-inner`, `--radius-button`, `--radius-card`, `--z-popover`, `--z-hide`. Single-commit cleanup.
3. **Delete `.glass` utility class** (lines 29-34 of `materials.css`). Token survives; class goes.
4. **Collapse duplicated easings** — `--ease-default` and `--ease-in-out` are literally the same cubic-bezier. Pick one (I'd keep `--ease-in-out`, it's the web-standard name) and `var(--ease-in-out)`-alias the other for one release before removing.
5. **Collapse near-duplicate leading/tracking** — `--leading-tight` vs `--leading-snug`, `--tracking-tight` vs `--tracking-tighter`. Differences are below the human discrimination threshold. Keep one of each pair.
6. **Hoist `--color-text-on-brand: #ffffff` to `:root`** — redundant in both theme files.
7. **Define `--color-white` / `--color-black` primitives** (noted in 1.6). Once primitives exist, replace the five `#ffffff` occurrences in themes with `var(--color-white)`.
8. **Migrate primitives to OKLCH + `color-mix()`** — larger refactor, future work. The infrastructure (`org-brand.css` already uses relative OKLCH) proves the codebase can handle it. Consider as a dedicated project.
9. **Add `@property` declarations for animatable custom props** — particularly `--brand-density-scale`, `--radius-base`, `--shadow-color`, `--shadow-strength`. Would unlock smooth transitions between theme/density changes.
10. **Decide on radius semantic aliases** — either migrate components to `--radius-{button,card,modal}` (flexible but invasive) or delete the aliases and standardise on the numeric scale (simpler).

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 4.1 | High | `dark.css:11` references `--color-neutral-750` which is not defined in `colors.css`; hex fallback always wins | Define `--color-neutral-750: #3a3a3a` in `colors.css` |
| 4.2 | Medium | Seven tokens have zero consumers (`--text-transform-meta`, `--shadow-xs`, `--shadow-inner`, `--radius-button`, `--radius-card`, `--z-popover`, `--z-hide`) | Delete from token files |
| 4.3 | Medium | `.glass` utility class in `materials.css:29-34` has zero callers; the `--material-glass` token survives | Delete the class only |
| 4.4 | Medium | `--ease-default` and `--ease-in-out` have identical cubic-bezier values | Collapse to one; alias the other for a release |
| 4.5 | Medium | `--color-text-on-brand: #ffffff` duplicated across `light.css` and `dark.css` | Hoist to `:root` |
| 4.6 | Low | `--leading-tight` (1.25) vs `--leading-snug` (1.3) — 0.05 difference is visually imperceptible | Keep one |
| 4.7 | Low | `--tracking-tighter` (-0.03em) vs `--tracking-tight` (-0.025em) — 0.005em delta | Keep one |
| 4.8 | Low | Semantic radius aliases (`--radius-button`, `--radius-card`) either unused or shadowed by numeric scale | Pick a convention — migrate components OR delete aliases |
| 4.9 | Low | Primitives are sRGB hex; org-brand uses OKLCH — inconsistent colour-space story | Plan migration of primitives to OKLCH + `color-mix()` derivation |
| 4.10 | Low | No `@property` typing on `--brand-density-scale`, `--radius-base`, `--shadow-color`/`--shadow-strength` | Add `@property` declarations to enable CSS animation of theme changes |
| 4.11 | Low | `--color-white` / `--color-black` primitives don't exist; `#ffffff` hardcoded five times in themes | Add primitives, reference them (overlaps with 1.6) |

## Quantitative summary

- **Token files**: 13 primitive/scale files + 2 theme files = 15 files, ~420 total lines. Tight.
- **Unused tokens identified**: 7 CSS custom properties + 1 utility class (`.glass`) + 1 ghost reference (`--color-neutral-750`). Roughly 20 lines removable.
- **Modern CSS usage score**: high. Fluid clamp typography, HSL-component shadows, density multiplier, radius multiplier, metric-adjusted fallback font, custom media queries. Notable *missing* primitives: `@property` typing and OKLCH in primitives.
- **Three-tier token architecture** (primitive → semantic → component) is sound; component tier's adoption of semantic aliases (`--radius-button`, `--radius-card`) is partial — remaining TM-1 / TM-4 migration work tracked in the 2026-04-03 audit covers the component tier directly.

## Next section

05 — Org branding overlay (`theme/tokens/org-brand.css`). Uses OKLCH relative colour syntax to derive a full per-org palette from a single `--brand-color` input.
