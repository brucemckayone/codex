# 03 — Global Utilities

## Scope

Two utility stylesheets shipped as part of the foundation:

| File | Lines | Status |
|---|---:|---|
| `apps/web/src/lib/styles/utilities.css` | 138 | Live — imported via `global.css:34` |
| `apps/web/src/lib/theme/utilities.css` | 311 | **Dead** — zero imports across the repo (first flagged in Section 01) |

`styles/utilities.css` is a small, intentional grab-bag:
- 3 text-alignment utilities
- 5 flex utilities
- 1 grid utility
- `.content-grid` + 3 modifiers (the hero layout engine)
- `.field-input` / `.field-label` / `.field-textarea` (shared form styling)
- `@keyframes spin` + `@keyframes pulse` + two `.animate-*` wrappers
- `.sr-only`

`theme/utilities.css` is a full Tailwind-style system: flex, grid-cols, gaps, margin/padding, sizing, typography, colour, border, shadow, display, position, overflow, opacity, z-index, container, plus media-query variants. None of it runs.

## CSS modernity

### In use — good

- **`:has()` + container queries** in `.content-grid` / `.content-grid--featured` / `.content-grid[data-view='list']` (`utilities.css:40-67`). The pattern — make each grid child an `inline-size` container and drive child layout from the viewport *and* the cell — is exactly what the feature was designed for.
- **Custom media queries** (`@media (--breakpoint-sm)` etc.) drive the responsive column counts.
- **`grid-column: span N` + `grid-row: span N`** with `:has()` fallback when there are <4 items.
- **Shared `@keyframes`** at the root level, referenced by name from 5+ components. Conceptually clean — keyframes are the one thing Svelte's `<style>` scoping actively rewrites, so hoisting shared animations into a global file is correct.

### Gaps

- No `@layer` — utilities happily live in the flat cascade. If they ever conflict with a component, the component has to raise specificity, which is exactly what utilities are supposed to prevent.
- `.content-grid` uses `gap: var(--space-6)` by default, then `.content-grid--compact` overrides to `--space-4`. A `@container`-based selector could drop the modifier entirely in favour of the container width — but that's future polish, not a current issue.
- No `@scope` usage — the `.content-grid > *` child selector could be `@scope (.content-grid) to (.nested-grid)` for future nesting robustness. Purely a stylistic suggestion.

## Inheritance & reuse

### What components actually consume

Grep across `src/**/*.svelte`:

| Utility class | Svelte files using it |
|---|---:|
| `.sr-only` | 10 (plus reset/base/utilities all defining it) |
| `.content-grid` | 8 |
| `.content-grid--compact` | 2 |
| `.field-input` | 17 |
| `.field-label` | 17 |
| `.field-textarea` | 2 |
| `.text-center` / `-left` / `-right` | 0 |
| `.flex` / `.flex-col` / `.items-center` / `.justify-center` / `.justify-between` | 0 |
| `.grid` (the utility) | 0 (the 44 raw matches are `display: grid` in scoped CSS) |
| `.content-grid--featured` | 0 |
| `.animate-spin` / `.animate-pulse` | 0 |

The **architectural signal** is clear: Codex uses component-scoped CSS, not utilities. The only utilities that caught on are the ones with semantic meaning (`.content-grid`, `.field-*`, `.sr-only`) and the anonymous keyframes. The atomic Tailwind-style stubs never got used — developers reach for scoped `display: flex` inside the component's `<style>` every time.

### Global keyframes are ambient state

5 components reference `animation: spin ...` or `animation: pulse ...` by name without defining `@keyframes` locally:

| Component | Line | Relies on |
|---|---|---|
| `Spinner.svelte` | 19 | global `@keyframes spin` |
| `Button.svelte` | 177 | global `@keyframes spin` |
| `CheckoutSuccess.svelte` | 266 | global `@keyframes spin` |
| `MemberTable.svelte` | 272 | global `@keyframes pulse` |
| `TopContentTable.svelte` | 89 | global `@keyframes pulse` |

Two components define their own local copies (`CreateOrganizationDialog.svelte`, `BrandEditorIntroVideo.svelte`) — inconsistent. And `NavigationProgress.svelte`, `RevenueChart.svelte`, `Spinner.svelte`'s reduced-motion branch each define local `@keyframes pulse` that shadow the global one — 1.5s duration identical, just redundant.

The ambient dependency is fragile: deleting `utilities.css` would silently break five components because Svelte's `<style>` scoping leaves undefined keyframe names unchanged. Users would see broken spinners with no error. A comment in `utilities.css` flags this (lines 106-109), but there's no enforcement.

**Two paths forward** — both are fine:

- **Option A (less churn)** — keep the global keyframes, delete the `.animate-*` classes, add a linter rule or doc line saying "components may reference `spin`/`pulse` by name — don't rename the keyframes in utilities.css".
- **Option B (purer)** — move `@keyframes spin`/`pulse` into each consuming component's `<style>`. Seven components touched, but every animation is now self-contained and there's no ambient dependency.

## Wasted code

### `theme/utilities.css` — 311 lines, 0 imports

Already flagged in Section 01.1 as a High-severity delete. No new evidence — confirming here as the primary find of Section 03.

### Dead utility classes in live `styles/utilities.css`

| Line(s) | Rule | Grep callers |
|---|---|---:|
| 2-4 | `.text-center`, `.text-left`, `.text-right` | 0 |
| 6-10 | `.flex`, `.flex-col`, `.items-center`, `.justify-center`, `.justify-between` | 0 |
| 12 | `.grid` (utility) | 0 |
| 45-60 | `.content-grid--featured` (including 2 `@media` branches) | 0 |
| 115-117 | `.animate-spin` class selector | 0 (keyframe stays — see above) |
| 124-126 | `.animate-pulse` class selector | 0 (keyframe stays) |

~30 lines of dead stubs, verified by grep across `apps/web`, `e2e/`, `tests/`, plus Svelte-class-attribute, Svelte-class-directive, and template-literal patterns.

### Duplicate `.sr-only`

Already covered in Section 01.2 and Section 02.3. For completeness: the `utilities.css:128-138` copy is the effective one (last import wins) and the one the 10 component callers target. Keep this copy, delete the other two.

### Redundant `.transition-*` utilities in `theme/utilities.css`

Lines 262-266 define `.transition-colors`, `.transition-opacity`, `.transition-transform`, `.transition-all`, `.transition-none`. Even if `theme/utilities.css` were live, the CSS custom properties from `tokens/motion.css` (e.g. `var(--transition-colors)`) are a better surface — you compose them directly in scoped CSS and they compose with other declarations. Moot, since the file is dead, but worth noting if anyone tries to revive it.

## Simplification opportunities

Ranked by impact/effort:

1. **Delete `theme/utilities.css`** — 311 lines, zero callers. Simplest high-impact win in the entire audit so far.
2. **Delete dead stubs from `styles/utilities.css`** — 6 selectors / ~30 lines. Effectively collapses the file from 138 → ~110 lines. Keep: `.content-grid` family, `.field-*`, `.sr-only`, and both `@keyframes` blocks.
3. **Decide the keyframes contract** — pick Option A or B above. Document whichever choice, so future contributors know whether to rely on global keyframes or define them locally. Recommend Option A (smaller churn) with a one-line comment in `utilities.css` making the contract explicit.
4. **Rationalise `.sr-only`** — drop from `global.css` and `theme/base.css`, keep one copy in `utilities.css`. (Already tracked in 1.2/2.3.)
5. **Consider `@layer`** — once the file slims, wrap it in `@layer utilities { … }` so the small remaining surface sits at a predictable cascade tier. Low risk, future-proofs the file.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 3.1 | High | `theme/utilities.css` (311 lines) unreferenced | Delete the file (same finding as 1.1, scoped here) |
| 3.2 | Medium | ~30 lines of never-used utility stubs in `styles/utilities.css` (text-*, flex*, items-center, justify-*, content-grid--featured, animate-spin/pulse) | Delete the unused rules; keep `@keyframes spin`/`pulse` + `.content-grid` + `.field-*` + `.sr-only` |
| 3.3 | Medium | 5 components depend on global `@keyframes spin`/`pulse` by name; 2 others define local copies | Document the contract in `utilities.css` (Option A) OR move keyframes into each component (Option B) |
| 3.4 | Low | Duplicate `@keyframes pulse` definitions in NavigationProgress, RevenueChart, Spinner (reduced-motion branch) | Collapse per the chosen option |
| 3.5 | Low | No `@layer` scoping | Wrap utilities in `@layer utilities` once the file slims |
| 3.6 | Low | `@scope` unused — `.content-grid > *` container-type rule could be clearer as `@scope (.content-grid)` | Consider when nested grids appear |

## Quantitative summary

- **Dead code to remove this section**: 311 (theme/utilities.css) + ~30 (styles/utilities.css stubs) = **~341 lines** with zero behaviour change.
- **Live utility surface after cleanup**: ~110 lines, purpose-built: `.content-grid` family, `.field-*`, `.sr-only`, 2 keyframes. Healthy.
- **Architectural clarity**: codebase convention is component-scoped CSS; atomic utility classes never caught on. The remaining "utilities" are really reusable layout primitives, not atomic helpers — maybe renaming the file (`primitives.css`?) would better describe it.

## Next section

04 — Design tokens (colour system, spacing scale, typography, motion, radius, z-index, materials). The 13-file `tokens/` tree is the base everything else references.
