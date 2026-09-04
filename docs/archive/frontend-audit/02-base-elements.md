# 02 — Base Elements

## Scope

`apps/web/src/lib/theme/base.css` (344 lines). Loaded from `global.css:28` after tokens and themes, before view-transitions and utilities. Owns the default styling for: html/body, typography (h1-h6, p, small, strong/em), links, code/kbd/samp/pre, lists, blockquote, hr, tables, forms (native inputs + labels), buttons, focus, selection, images/figure, plus two utility classes (`.sr-only`, `.not-sr-only`).

## CSS modernity

### In use — good

- **`:focus-visible`** (lines 282-290) is the global focus convention for keyboard nav, plus a `:focus:not(:focus-visible)` opt-out for mouse — exactly the modern a11y pattern.
- **`::selection`** (lines 295-298) branded to `--color-brand-primary`.
- **Semantic tokens everywhere** — colour, spacing, typography, radius, border, motion all reference `var(--…)`. Very few hardcoded values (see Wasted code for the stragglers).
- **`text-underline-offset: 2px`** (line 101) — modern link underline spacing.
- **`cursor: not-allowed`** + `opacity` on `:disabled` (line 277) follows current conventions.

### Missing — adoption candidates

- **No `:where()` / `:is()`**. Every rule in this file contributes specificity like `h1, h2, h3, h4, h5, h6 { … }`, which means component `<style>` blocks that want to override a heading need at least the same specificity. Wrapping the heading group in `:where(h1, h2, h3, h4, h5, h6)` drops its specificity to `(0,0,0)` and makes component overrides Just Work. Same for the input-type group (lines 215-223): `:where(input[type="text"], input[type="email"], …)`.
- **No logical properties** — `padding-left`, `margin-left`, `margin-right` on blockquote/lists. Switching to `padding-inline-start` / `margin-inline` would make the stylesheet RTL-ready for future i18n (Paraglide is already wired up).
- **No `@supports`** — fine for the features currently used, but worth noting as the app pushes into `color-mix()` / `@property` later.

## Inheritance & reuse

### Token adoption — strong, with nits

Base element rules reference semantic tokens almost universally. Five hardcoded values found:

| Line | Rule | Value | Token it should use |
|---|---|---|---|
| 12 | `html { font-size }` | `16px` | Intentional root — the `rem` anchor, OK to keep |
| 123 | `code { font-size }` | `0.875em` | `em`-relative is pragmatic, but could be `--text-sm` calc |
| 162 | `blockquote { border-left }` | `4px solid var(--color-brand-primary)` | `var(--border-width-thick)` + `var(--border-style)` |
| 175 | `hr { border-top }` | `1px solid var(--color-border)` | `var(--border-width) var(--border-style) var(--color-border)` — matches the tables pattern on line 191 |
| 252 | `input:focus { box-shadow }` | `0 0 0 3px var(--color-focus-ring)` | Needs a `--focus-ring` shadow token, or migrate to outline |
| 277 | `button:disabled { opacity }` | `0.5` | `var(--opacity-50)` — flagged in the 2026-04-03 audit (AU-1) |

### Duplicate / conflicting rules with `global.css`

`global.css:37-76` re-declares base element styles (h1-h6, a, button, p, html, body) **after** importing `base.css`. Because last-in-wins:

| Element | `base.css` says | `global.css` override | Net effect |
|---|---|---|---|
| `html` font-family | `var(--font-sans)` (line 11) | `var(--font-sans)` (line 39) | Same, duplicated |
| `html` color | `var(--color-text-primary)` (line 14) | `var(--color-text)` (line 42) | **`--color-text` wins** — two different token names race |
| `h1-h6` font-family | `var(--font-heading)` (line 37) | `var(--font-heading)` (line 68) | Same, duplicated |
| `body` font-size | `var(--text-base)` (line 26) | unset | `base.css` wins |
| `a` color | `var(--color-interactive)` (line 99) | `inherit` (line 54) | **`global.css` breaks the brand link colour** |

The third row is an actual bug-risk: the `global.css` `a { color: inherit }` rule wipes out the `--color-interactive` assignment from `base.css`. Every `<a>` on the site is now coloured by its parent, not the brand. Components compensate with their own `color` declarations, but the hundreds of plain anchors in body prose silently lose brand colour.

### Two names for one token: `--color-text` vs `--color-text-primary`

Both defined in `themes/light.css` with the same value (`var(--color-neutral-900)`). Usage split:
- `--color-text` — **351 references across 154 files**
- `--color-text-primary` — 30 references across 12 files

Community preference is clear: `--color-text` wins by 11×. Having two aliases is a papercut for new contributors and auto-complete. Pick one (recommendation: `--color-text`) and collapse the other into a deprecation alias, or deprecate outright.

### Form focus architecture is inconsistent

- Native inputs/textareas/selects (lines 247-253) use `outline: none; border-color: …; box-shadow: 0 0 0 3px …`.
- Every other focusable element (lines 282-290) uses `outline: var(--border-width-thick) solid var(--color-focus); outline-offset: 2px`.

Two mental models for the same a11y feature. A keyboard user tabbing through a form sees one style on inputs and a different style on buttons/links — visually inconsistent. Standardising on `:focus-visible` + outline for inputs (removing the `box-shadow` branch) would unify the system and let the `:focus-visible` rule do the work.

## Wasted code

### `.not-sr-only` — dead class

Lines 335-344. Grep hit: only in `base.css` itself and agent worktrees. Zero callers in `src/`. **Delete.**

### `a.no-underline` — dead class

Lines 113-116. Grep hit: only in `base.css`. Zero callers. **Delete.**

### `.sr-only` — third copy

Lines 322-332. Identical to copies in `styles/global.css:79-89` and `styles/utilities.css:128-138`. Already flagged in Section 01 finding 1.2 — keep `utilities.css`'s copy only.

### Redundant transition declaration

Line 233: `transition: var(--transition-colors), border-color var(--duration-fast) var(--ease-in-out);`

`--transition-colors` (defined in `tokens/motion.css`) already transitions `color`, `background-color`, `border-color`, `outline-color`, and friends. The second clause re-animates `border-color` with slightly different timing — subtle dissonance where hover colour and hover border speed diverge by a few ms.

Simpler: just `transition: var(--transition-colors);`.

## Simplification opportunities

Ranked by impact/effort:

1. **Reconcile `global.css:37-76` with `theme/base.css`** (Section 01 finding 1.3). Move the delta into `base.css`, delete the duplication in `global.css`. Bonus: fixes the `a { color: inherit }` regression that's silently unbranding links.
2. **Delete dead classes** — `.not-sr-only` and `a.no-underline`. Two fewer API surfaces to document.
3. **Wrap element groups in `:where()`** — headings, inputs, and links. Low-specificity base rules mean component overrides become trivial and we stop reaching for `!important`.
4. **Standardise form focus on outlines** — replace the `box-shadow` focus ring on inputs with the same `:focus-visible` outline everything else uses. One focus style across the app.
5. **Deprecate `--color-text-primary`** or `--color-text` — pick one canonical name. Auto-migratable with a single find-replace.
6. **Token-ify the 5 hardcoded values** (`4px`, `3px`, `1px solid`, `0.5`, `0.875em`). Two are trivially replaceable (`blockquote`, `hr`), the others need small token additions.
7. **Move to logical properties** (`padding-inline-start`, `margin-inline`) in blockquote/lists/forms — future RTL readiness.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 2.1 | High | `global.css:54` sets `a { color: inherit }`, overriding `base.css:99`'s brand link colour. All unstyled `<a>` tags render as currentColor instead of `--color-interactive` | Remove the `a` rule from `global.css` and keep `base.css:98-111` as sole owner |
| 2.2 | Medium | Heading, html, and button rules are defined in both `global.css` and `base.css` with silent last-in-wins cascade | Consolidate into `base.css`; `global.css` keeps only true app-wide overrides (or none) |
| 2.3 | Medium | `.not-sr-only` (lines 335-344) is unused | Delete |
| 2.4 | Medium | `a.no-underline` (lines 113-116) is unused | Delete |
| 2.5 | Medium | Form inputs use `box-shadow` focus ring; other elements use outline `:focus-visible` | Unify on `:focus-visible` outline; remove lines 250-252 box-shadow branch |
| 2.6 | Medium | `--color-text` (351 refs) and `--color-text-primary` (30 refs) are aliases with identical value | Deprecate `--color-text-primary`; run find-replace |
| 2.7 | Low | `blockquote` hardcodes `4px`, `hr` hardcodes `1px solid` | Use `var(--border-width-thick)` and `var(--border-width) var(--border-style)` respectively |
| 2.8 | Low | `button:disabled { opacity: 0.5 }` | Use `var(--opacity-50)` — already tracked in 2026-04-03 AU-1 inventory |
| 2.9 | Low | `input` transition declaration double-animates `border-color` | Replace with just `transition: var(--transition-colors)` |
| 2.10 | Low | No `:where()` / `:is()` wrapping on element groups | Wrap headings/inputs/links in `:where()` to make overrides easy |
| 2.11 | Low | LTR-only `margin-left` / `padding-left` in blockquote, lists, forms | Switch to `margin-inline`, `padding-inline-start` for future RTL |

## Quantitative summary

- Dead code: **~18 lines** (two unused utility classes) plus the `.sr-only` duplicate already counted in Section 01.
- One probable regression: `a { color: inherit }` in `global.css` silently strips brand colour from unstyled anchors.
- Token compliance: **>95%** of declarations reference semantic tokens. Six hardcoded values identified.
- Focus system: one high-specificity override (native form inputs) diverging from the otherwise-unified `:focus-visible` pattern.

## Next section

03 — Global utilities (`styles/utilities.css` + dead `theme/utilities.css`).
