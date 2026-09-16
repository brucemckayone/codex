# Reference 02 — CSS Architecture

How CSS is structured today in `apps/web/`, which modern features are in use, and which
Baseline-Widely features to propose adopting when you touch relevant code.

## 1. Global Import Order

`apps/web/src/lib/styles/global.css` is the single CSS entry — imported once from
`apps/web/src/routes/+layout.svelte`. Order is load-bearing:

```
1. Reset                       lib/theme/reset.css
2. Raw tokens (13 files)       lib/styles/tokens/*.css
3. Semantic themes             lib/styles/themes/{light,dark}.css
4. Org-brand derivations       lib/theme/tokens/org-brand.css
5. Base element styles         lib/theme/base.css
6. View transitions            lib/styles/view-transitions.css
7. Utilities                   lib/styles/utilities.css
8. App base styles             (inline in global.css — html, body, a, button, h1-h6, p)
```

**No `@layer` in use today** (see §6 for the proposal). Specificity cascade is driven by
attribute selectors: `:root` → `[data-theme]` → `[data-org-brand]` → `[data-org-bg]` →
component scoped styles.

## 2. Modern Features CURRENTLY In Use

| Feature | Where | Pattern |
|---|---|---|
| `@custom-media` | `tokens/breakpoints.css` | `@media (--breakpoint-md)`, `@media (--below-md)` via postcss-custom-media |
| Container queries | `ContentCard.svelte`, `utilities.css` | `container-type: inline-size` on grid children; `@container (min-width: 400px)` |
| `:has()` | `utilities.css`, `ContentCard.svelte` | `content-grid--featured:has(> :nth-child(4))` — guard layouts |
| `color-mix()` | 31+ files (pricing page heaviest) | `color-mix(in srgb, var(--color-surface-card) 96%, transparent)` |
| OKLCH | `org-brand.css`, `brand-editor/oklch-math.ts` | Relative color syntax: `oklch(from var(--brand-color) calc(l - 0.08) c h)` |
| `clamp()` | `tokens/typography.css` | Fluid type: `clamp(1rem, 0.9rem + 0.5vw, 1.0625rem)` |
| `text-wrap: balance/pretty` | `reset.css` (headings), `global.css` (paragraphs) | Widow prevention |
| View Transitions | `view-transitions.css` | `::view-transition-old(sidebar-nav)`, `::view-transition-new(page-content)` — respects `prefers-reduced-motion` |
| `aspect-ratio` | 30+ components | `16 / 9`, `4 / 5`, `3 / 4`, responsive via `@media` |
| `backdrop-filter` | 10+ components | Always with `-webkit-backdrop-filter` + `@supports not (backdrop-filter: blur(1px))` fallback |
| `prefers-reduced-motion` | `tokens/motion.css`, `reset.css`, `view-transitions.css` | Collapses duration tokens to `0.01ms` |

**Not in use** (propose-only per §6): `@layer`, `@property`, `@starting-style`, `subgrid`,
`anchor-name`, `light-dark()`, `interpolate-size`, `calc-size()`, `content-visibility`,
`contain`, native CSS nesting.

## 3. Breakpoint Tokens — `@custom-media`

Source: `apps/web/src/lib/styles/tokens/breakpoints.css` (11 tokens).

```css
/* Mobile-first min-width */
@custom-media --breakpoint-sm  (min-width: 40rem);  /* 640px */
@custom-media --breakpoint-md  (min-width: 48rem);  /* 768px */
@custom-media --breakpoint-lg  (min-width: 64rem);  /* 1024px */
@custom-media --breakpoint-xl  (min-width: 80rem);  /* 1280px */
@custom-media --breakpoint-2xl (min-width: 96rem);  /* 1536px */

/* Max-width (mobile-specific overrides) */
@custom-media --below-xs (max-width: 29.9375rem);
@custom-media --below-sm (max-width: 39.9375rem);
@custom-media --below-md (max-width: 47.9375rem);
@custom-media --below-lg (max-width: 63.9375rem);
```

**Rules:**
- Always use the tokens. `@media (min-width: 768px)` is a bug — use `@media (--breakpoint-md)`.
- Prefer mobile-first (`--breakpoint-*`) for layout progression; use `--below-*` only for mobile-specific collapses.
- Need a new tier? Add to `breakpoints.css` — don't inline a raw `min-width`.

## 4. `@media` vs `@container` Decision Tree

```
Is the responsive decision about "where the component lives" (parent width) or "how big the viewport is"?
├─ Viewport, always (e.g., global layout shift, hero sizing, site-wide density)
│  → @media (--breakpoint-*)
│
├─ Depends on the slot/cell the component is placed in (e.g., ContentCard in a 2-col grid vs 4-col grid)
│  → @container  (requires container-type: inline-size on a parent)
│
└─ Both are viable?
   → Prefer @container. It survives layout refactors; components stay portable.
```

Reference: `ContentCard.svelte:787-806` + `utilities.css:34-39` (the grid sets
`container-type: inline-size` on children; the card adapts).

## 5. `color-mix()` Patterns

Used everywhere. Standard recipes:

```css
/* Opacity layering — prefer this over rgba() since tokens stay consumed */
background: color-mix(in srgb, var(--color-surface-card) 96%, transparent);

/* Tinted border using a brand token */
border-color: color-mix(in srgb, var(--color-brand-primary) 40%, var(--color-border));

/* Glass morphism tint */
background: color-mix(in srgb, var(--color-glass-tint) 14%, transparent);

/* Gradient chain (pricing page heavy) */
background: linear-gradient(
  135deg,
  color-mix(in oklch, var(--color-brand-primary) 72%, transparent) 0%,
  color-mix(in oklch, var(--color-brand-primary-hover) 40%, transparent) 100%
);
```

**Rules:**
- Use `in srgb` for straight opacity; use `in oklch` for perceptually-uniform gradients.
- Always mix tokens, never hex literals.
- No wrapper utilities — `color-mix` is inline in scoped styles.

## 6. Baseline-Widely Feature Adoption Framework

**The rule (applies to `@layer`, `@property`, `@starting-style`, `subgrid`, `anchor-name`,
`light-dark()`, `interpolate-size`, `content-visibility`, native nesting):**

> When editing a file where a Baseline-Widely feature would genuinely simplify or improve it:
> 1. Verify current Baseline status via Context7 MCP (MDN / caniuse).
> 2. Leave the existing code working.
> 3. Add a comment: `/* TODO(design-system): consider <feature> here once repo-wide migration tracked */`
>    OR flag in the PR description.
> 4. **Never silently migrate one file.** Migrations are all-or-nothing per repo to avoid
>    cascade surprises — especially `@layer`, which behaves differently depending on whether
>    *any* CSS in the project uses it.

### Proposal matrix

| Feature | What it buys | What it replaces | Risk if partial |
|---|---|---|---|
| `@layer` | Explicit cascade control; no selector-specificity wars | Import-order specificity | High — partial adoption reorders the cascade |
| `@property` | Typed custom props; animatable non-colour vars (e.g. gradient stops) | Untyped `var(--x)` | Low — additive |
| `@starting-style` | Enter animations for elements that weren't previously in the DOM | JS timers / `onmount` animations | Low — additive |
| `subgrid` | Aligning grid tracks across nested components | Manual column measurement | Medium — requires all descendants to cooperate |
| `anchor-name` / `position-anchor` | Replace Melt UI Floating positioning for simple cases | Melt positioning builder | Medium — Melt UI still needed for complex cases |
| `light-dark()` | `color: light-dark(black, white)` single declaration | Two `[data-theme]` rules | **High** — we use explicit `[data-theme]` toggle, not `prefers-color-scheme`. Do NOT migrate until theme system is reviewed. |
| `interpolate-size` / `calc-size()` | Animate `height: auto`, `width: auto` | JS measure + animate workarounds | Low — additive |
| `content-visibility: auto` | Skip rendering off-screen; huge perf win on long pages | No equivalent | Medium — requires `contain-intrinsic-size` to prevent scroll jumps |
| Native CSS nesting | Ergonomics; less repetition in scoped styles | Current flat selectors | Low — but verify Svelte compiler + PostCSS order produce stable output |

### Example proposal comment

```css
/* 02-css-architecture.md §6: candidate for @layer adoption alongside global.css.
   Don't migrate this file alone — whole-repo migration tracked separately. */
```

## 7. Svelte Scoped Styles — `:global()` Rules

Scoped `<style>` blocks are the default. `:global()` is the exception. Use it only for:

1. **Melt UI state attributes** injected at runtime:
   ```css
   .checkbox-root:global([data-state="checked"]) { ... }
   .tabs-trigger:global([data-state="active"]) { ... }
   .select-option:global([data-highlighted]) { ... }
   ```
2. **Ancestor data attributes** on `.org-layout` (the brand editor contract):
   ```css
   :global([data-hero-layout="centered"]) .hero__title { ... }
   :global([data-hero-hide-stats]) .hero__stats { display: none; }
   ```
3. **Deeply nested descendant targeting** where structure is owned by another component
   (sparingly — prefer props + data attributes).

Every other use of `:global()` is an anti-pattern. Scoped classes are cheap.

## 8. Specificity & Selector Depth

- Keep selectors **shallow** — max 3 levels. `.cc__title a:hover` is fine; `.cc .body .title a` is not.
- Prefer `data-*` attributes over class concatenation (`data-variant="primary"` beats `.btn.btn--primary`).
- Don't use IDs for styling — specificity ratchet with no upside.
- Avoid the `*` universal selector except in `reset.css` (box-sizing, reduced-motion override).

## 9. Backdrop Filter with Fallback

```css
.glass-card {
  background: color-mix(in srgb, var(--color-surface-card) 70%, transparent);
  backdrop-filter: blur(var(--blur-xl));
  -webkit-backdrop-filter: blur(var(--blur-xl));
}

@supports not (backdrop-filter: blur(1px)) {
  .glass-card {
    background: color-mix(in srgb, var(--color-surface-card) 96%, transparent);
  }
}
```

Ship both `backdrop-filter` and `-webkit-backdrop-filter` — Safari still required the prefix
into 2024+. Always provide the `@supports not (...)` fallback with a higher opacity.

## 10. Gotchas / Anti-patterns

- **Don't** add `@layer` to one file. `@layer` behaviour is global — any layered rule ranks
  below unlayered rules, which silently changes specificity across unrelated files.
- **Don't** ship `content-visibility: auto` on elements whose intrinsic height the layout
  depends on — pair it with `contain-intrinsic-size` or the page will scroll-jump on reveal.
- **Don't** use `light-dark()` until the theme switching strategy is migrated. We use
  explicit `[data-theme]` toggle, not `prefers-color-scheme`. `light-dark()` reads the latter.
- **Don't** nest past two levels. Svelte scoped CSS already localizes selectors; deep nesting
  hurts readability without helping scope.
- **Don't** inline `min-width: 768px` — use `@media (--breakpoint-md)`. A raw breakpoint means
  "we might accidentally add a 10th breakpoint tier", which is a maintenance crisis.
- **Don't** use `transition: all` — ever. It animates properties you didn't intend to animate
  (notably layout), causing jank. List the properties explicitly or use the `--transition-*`
  compound tokens.
- **Don't** use `:global()` to target something you could target with a scoped class + prop.
  Every `:global()` is a future refactor landmine.
- **Don't** hand-author `-webkit-*` prefixes except for `backdrop-filter`. Autoprefixer is not
  configured for any other vendor prefix in this project.
- **Don't** ship a new modern feature without confirming Baseline-Widely via Context7 MCP.
  Training-data knowledge of Baseline status goes stale quickly.

## 11. When to Re-Verify This Reference

- `apps/web/src/lib/styles/global.css` — import order changes
- `apps/web/src/lib/styles/tokens/breakpoints.css` — breakpoint tokens
- `apps/web/postcss.config.*` / `svelte.config.js` — plugin changes affecting `@custom-media`
- `apps/web/src/lib/styles/utilities.css` — container-query / `:has()` usage
- The first PR that adopts `@layer` anywhere — every open assumption in §6 changes

If this reference disagrees with those files, **the code wins** — update the reference.
