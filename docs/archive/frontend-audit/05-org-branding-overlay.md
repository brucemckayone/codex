# 05 — Org Branding Overlay

## Scope

`apps/web/src/lib/theme/tokens/org-brand.css` (266 lines). Imported by `global.css:25`. Derives a full per-org palette from ~7 input variables (`--brand-color`, `--brand-secondary`, `--brand-accent`, `--brand-bg`, `--brand-radius`, `--brand-density`, `--brand-font-*`) using **CSS relative colour syntax** (`oklch(from …)`).

Activation is two-gated:

| Selector | When active | Governs |
|---|---|---|
| `[data-org-brand]` | Any org branding exists | Primary/secondary/accent, radius, density, typography, shadow, player chrome, heading colour, card interaction scales |
| `[data-org-bg]` | Org explicitly sets a background colour | Surface/text/border tokens (keeps platform default theme untouched if only colour is set) |

Applied at `apps/web/src/routes/_org/[slug]/+layout.svelte:360-361`:
```svelte
data-org-brand={hasBranding ? '' : undefined}
data-org-bg={brandBackground ? '' : undefined}
```

## CSS modernity

### This file is the modern-CSS centrepiece of the codebase

- **`oklch(from <color> …)` relative colour syntax** appears 40+ times. This is the 2024 feature that makes the whole design derivable from one input — every subtle/hover/active/focus tint is computed from `--brand-color` by mutating L/C/H directly.
  ```css
  --color-brand-primary-hover: oklch(from var(--brand-color, …) calc(l - 0.08) c h);
  ```
- **Step-function auto-contrast for text-on-brand** (line 37):
  ```css
  oklch(from var(--brand-color, …) clamp(0, (0.62 - l) * 1000, 1) 0 0)
  ```
  The `* 1000` forces the clamp into a binary output — if `l < 0.62` the result is 1 (white text), else 0 (black text). Entire contrast-switching logic expressed in one declaration, no JS. **Lovely.**
- **Nuanced perceptual formulas** — not just "darker = luminance minus constant" but things like `abs(0.55 - l) + 0.25` (line 192) which give *distance-from-midtone*-based secondary-text luminance. This is someone who understands OKLCH.
- **Scoped cascade via `data-*` attribute** rather than a class — nicely composable and greppable.
- **Every `var()` has a fallback** — no ghost references here (unlike the `--color-neutral-750` issue in Section 04).

### Browser support

Line 11 correctly flags Chrome 119+, Firefox 128+, Safari 16.4+. No fallback for older browsers — at this point (April 2026) that's the right call for a modern B2B product. `@supports` guard around the file is unnecessary.

### Missing

- No `@property` typing on the inputs (`--brand-color` as `<color>`, `--brand-density` as `<number>`, `--brand-radius` as `<length>`). Adding them would:
  - Enable CSS transitions between theme switches (users see brand colour animate during editor preview).
  - Provide validation — a malformed input would fall back to the initial value instead of breaking downstream `oklch(from …)` calculations silently.

## Inheritance & reuse

### The scale re-declarations are load-bearing

Lines 55-91 re-declare the **entire radius and spacing scale** inside `[data-org-brand]`. That looks like duplication of the base `tokens/radius.css` and `tokens/spacing.css` — but it's not. It's fundamental:

CSS custom properties inherit, but the **result of `calc()` freezes at the scope where the calc is written**. If `--space-unit` is updated inside `[data-org-brand]` to `calc(0.25rem * 1.15)`, child elements that reference `--space-4` (defined on `:root` as `calc(var(--space-unit) * 4)` resolved at :root) get the *old* value. The only way to refresh the whole scale is to re-declare it inside the new scope.

This is a subtlety of CSS that surprises most engineers. The file handles it correctly.

### But the spacing scale grows

Base `tokens/spacing.css` defines 14 sizes: `0, 0-5, 1, 2, 3, 4, 5, 5-5, 6, 7, 8, 10, 11, 12, 16, 20, 24`.

Org scope redeclares 19 sizes, adding `1-5, 2-5, 3-5, 9, 14` (lines 73-88).

**Consequences:**
- Components under `[data-org-brand]` can reference `--space-1-5` etc. and get a valid density-scaled value.
- Components anywhere else (platform home, auth pages) reference `--space-1-5` and get `undefined` → rule dropped.
- This is a silent "works on org pages, breaks on platform" trap if anyone reaches for a halfstep value in shared code.

**Recommendation:** hoist the halfstep sizes into base `spacing.css` so the full scale is available everywhere.

### Dark-mode `--color-primary-600` is missing

Line 41 (light) redefines `--color-primary-500`, `-600`, `-100`, `-50`. Dark-mode block (lines 218, 227, 228) redefines `-500`, `-100`, `-50` but **not `-600`**. A component referencing `--color-primary-600` directly in dark mode gets the light-mode-brand-derived value, not a dark-brand-derived one.

Given the 2026-04-03 audit found 383 references to `--color-primary-N` across 78 files (TM-1), this silent asymmetry is an actual risk.

### Two `[data-org-brand]` blocks

Lines 18-155 and 160-163. Separated by a comment. The second block only redefines `--font-bold` and `--font-normal` — could simply fold into the first block. Minor.

### Cross-cutting content-card rule

Lines 170-175:
```css
[data-org-brand] .content-card { box-shadow: var(--shadow-sm); }
[data-org-brand] .content-card:hover { box-shadow: var(--shadow-lg); }
```

Application CSS (component styling) in a token file. The reason is noted in the inline comment: *"Apply baseline shadows to content cards so shadow controls have visible effect"*. It exists because `ContentCard` doesn't apply its own shadow, so the shadow-intensity slider in the brand editor would otherwise do nothing visible.

The correct fix is to move baseline shadow into `ContentCard.svelte` (then the rule works everywhere, not just under `[data-org-brand]`) and delete these four lines from the token file. Flag for ContentCard's dedicated audit in Section 23.

## Wasted code

Verified consumer counts for each novel token introduced in this file:

| Token introduced here | Consumers outside this file |
|---|---|
| `--color-heading` | 0 (only the internal selector on line 166 uses it; no component reaches for it) |
| `--card-hover-scale` | 2 (ContentCard, CreatorProfileDrawer) |
| `--card-image-hover-scale` | 2 (same) |
| `--text-scale`, `--heading-weight`, `--body-weight` | Internal — applied by re-declarations within this file |
| `--brand-bg-dark` | 13 uses within the file, all as fallback targets — hence the `#1a1a2e` literal repetition |

Nothing unused per se, but `--color-heading` is a single-purpose token serving only one selector. Could be inlined.

### The `#1a1a2e` problem

The literal `#1a1a2e` (a muted indigo) is the hardcoded dark-mode brand-bg fallback. It appears **13 times** in the file as the fallback arg inside `var(--brand-bg-dark, var(--brand-bg, #1a1a2e))`. If the default dark brand-bg ever changes, that's 13 edits.

Per CLAUDE.md (*"MUST use design tokens for ALL CSS — NEVER hardcode px, hex, or raw values"*), this is 13 rule violations. Proper fix: a single `--color-default-brand-bg-dark: #1a1a2e` token in `colors.css` or `themes/dark.css`, referenced by the single nested fallback chain.

## Simplification opportunities

Ranked by impact/effort:

1. **Define `--color-default-brand-bg-dark`** in the primitive palette; replace all 13 `#1a1a2e` literals with the token. Single-file edit, kills 13 hex occurrences at once.
2. **Move content-card box-shadow rules into `ContentCard.svelte`** (lines 170-175). Token file should define tokens, not style application classes.
3. **Hoist the halfstep spacing sizes** (`--space-1-5`, `--space-2-5`, `--space-3-5`, `--space-9`, `--space-14`) into `tokens/spacing.css` so they're available platform-wide, not just inside org scope. Prevents silent breakage in shared components.
4. **Fix dark-mode `--color-primary-600` redefinition** (missing on line 218-228). Add `--color-primary-600` to the dark block so legacy `--color-primary-N` references are symmetric between themes.
5. **Merge the two `[data-org-brand]` blocks** (lines 18-155 and 160-163). Minor readability improvement.
6. **Extract repeated OKLCH formulas into CSS custom property helpers** — pattern like `oklch(from X calc(l - 0.08) c h)` appears 7 times. CSS doesn't have functions, but you could define once:
   ```css
   --brand-primary-hover: oklch(from var(--brand-color, …) calc(l - 0.08) c h);
   --color-brand-primary-hover: var(--brand-primary-hover);
   --color-interactive-hover: var(--brand-primary-hover);
   ```
   Seven fewer OKLCH expressions to keep in sync.
7. **Add `@property` declarations for `--brand-color`, `--brand-density`, `--brand-radius`** — enables smooth CSS transitions during brand-editor preview and validates incoming inputs.
8. **Collapse the light/dark `[data-org-bg]` duplication** — lines 182-206 and 242-266 are structurally identical with opposite offset signs. Possibly extract `calc(l - N)` → `calc(l + (var(--theme-direction) * N))` where `--theme-direction` flips between ±1. Less legible but halves the file.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 5.1 | High | `#1a1a2e` hardcoded 13 times as `--brand-bg-dark` fallback, violating the "no hex literals" rule | Define `--color-default-brand-bg-dark: #1a1a2e` in `colors.css`; reference the token |
| 5.2 | Medium | Dark-mode `[data-org-brand]` redefines `--color-primary-500/100/50` but omits `--color-primary-600` | Add `--color-primary-600` to the dark block |
| 5.3 | Medium | Cross-cutting `.content-card` shadow rules live in the token file | Move to `ContentCard.svelte`; delete lines 170-175 here |
| 5.4 | Medium | Halfstep spacing sizes (`--space-1-5/2-5/3-5/9/14`) only exist inside `[data-org-brand]` — shared code can't reference them | Hoist into `tokens/spacing.css` |
| 5.5 | Low | Duplicated OKLCH expressions — `oklch(from x calc(l - 0.08) c h)` appears 7 times | Extract into helper custom properties |
| 5.6 | Low | Light and dark `[data-org-bg]` blocks structurally duplicated (~24 lines each, mirrored offsets) | Consider a direction multiplier, or accept as-is for legibility |
| 5.7 | Low | `[data-org-brand]` split into two non-adjacent blocks | Merge |
| 5.8 | Low | `--color-heading` is a single-use token; only the one selector in this file consumes it | Either document as internal (prefix `_`) or inline the colour into the selector |
| 5.9 | Low | No `@property` typing on brand inputs | Add to enable smooth transitions during brand-editor preview |

## Quantitative summary

- **Lines**: 266 — about half is OKLCH-derived colour tokens, a third is scale re-declarations, the rest is dark mode parity.
- **Modern CSS score**: exceptionally high — this is the codebase's showpiece of `oklch(from …)` relative colours.
- **Hex literals to remove**: 13 (all `#1a1a2e`) → 1 token reference.
- **Dead/unused tokens added here**: 0 (every token added has at least one consumer, direct or via internal re-reference).
- **Cross-cutting leaks**: 1 (content-card rule) — small but worth fixing.
- **Unusual design decisions**: `[data-org-brand]` + `[data-org-bg]` two-gate activation is sophisticated and worth preserving.

## Next section

06 — Root shell (`+layout.svelte`, SkipLink, NavigationProgress, Toaster).
