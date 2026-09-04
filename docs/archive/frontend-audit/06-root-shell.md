# 06 — Root Shell

## Scope

The app's outermost chrome:

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/routes/+layout.svelte` | 86 | Thin shell — global CSS, view transitions, cross-subdomain auth sync, 3 chrome components |
| `apps/web/src/routes/+layout.server.ts` | 15 | Session + `depends('app:auth')` for cross-subdomain invalidation |
| `apps/web/src/lib/components/ui/SkipLink/SkipLink.svelte` | 39 | A11y skip-to-main link |
| `apps/web/src/lib/components/ui/Feedback/NavigationProgress/NavigationProgress.svelte` | 90 | Fake-progress nav bar |
| `apps/web/src/lib/components/ui/Toast/Toaster.svelte` | 102 | Melt UI toast container |
| `apps/web/src/lib/components/ui/Toast/toast-store.ts` | 55 | `toast.success()` / `.error()` / `.warning()` / `.info()` helpers |

The root layout is intentionally minimal — per the file comment, *"each route group (platform, org, creators) owns its own header/footer chrome"*. All three route-group layouts provide `<main id="main-content">` (verified), so `<SkipLink />` has a valid target everywhere.

## CSS modernity

### In use — good

- **View Transitions API** wired with a safety valve (`+layout.svelte:41-68`). Several tasteful details:
  - **Skip same-path transitions** (line 46) — query/hash changes don't trigger a visual transition. Avoids jarring flashes on filter-state URL updates.
  - **800ms safety timeout** (line 58) — if a DOM update takes too long, `skipTransition()` completes instantly rather than waiting for Chrome's 4s default timeout.
  - **`try/catch` around `startViewTransition`** — catches the `DOMException` thrown when a transition is already active, resolves immediately to let SvelteKit proceed.
  - Named view transitions (`sidebar-nav`, `page-content`) are defined in `styles/view-transitions.css` (audited in Section 01) and activated via `view-transition-name` CSS on child elements.
- **Cross-subdomain auth sync** via `visibilitychange` (`+layout.svelte:20-39`). Watches for `codex-session` cookie changes between tab blur/visible — if the cookie state diverges, calls `invalidate('app:auth')` to re-run the layout's server load. Matches the pattern in `CLAUDE.md` for subdomain-agnostic auth.
- **SkipLink** uses the modern *"absolutely positioned, transform off-screen, shift into view on focus"* pattern (`SkipLink.svelte:17-38`). Fully token-driven — `--space-*`, `--color-interactive`, `--z-modal`, `--shadow-md`, `--ease-out`, `--duration-normal`.
- **Toaster** leverages Melt UI headless primitives (`melt={$content(t.id)}` etc.) rather than a hand-rolled implementation. `flip` + `fade` Svelte animations for list reordering.
- **Reduced-motion branch** in NavigationProgress (`NavigationProgress.svelte:69-89`) swaps the trickle animation for a slow pulse.

### Gaps

- **NavigationProgress `:focus` ≠ `:focus-visible`**. Not relevant for the progress bar (it's not focusable). But SkipLink uses `:focus` (line 34) — the modern convention is `:focus-visible`, which only reveals the link on keyboard focus. On `:focus`, a mouse-click inside the link area (unlikely but possible given `position: absolute`) reveals it too. Minor.
- **No `@starting-style`** on SkipLink or Toasts. `@starting-style { transform: translate(-50%, -200%); }` could replace the initial `transform` declaration and let the SkipLink slide in from off-screen using CSS-only state. Minor future polish.

## Inheritance & reuse

### Token adoption

SkipLink: 100% token compliant. Every colour, space, radius, shadow, duration, and easing references a token.

Toaster:
- 90% token compliant.
- **Two hardcoded widths**: `min-width: 300px` + `max-width: 400px` (lines 51-52) violate the CLAUDE.md "no hardcoded values" rule. These are classic toast dimensions, but the project has a layout token system — add `--toast-min-width: 18.75rem; --toast-max-width: 25rem;` (or generic `--toast-width` in `tokens/layout.css`) and reference them.

NavigationProgress:
- 70% token compliant. Several hardcoded values:

| Line | Value | Why | Recommendation |
|---|---|---|---|
| 36 | `height: 3px` | Progress-bar thickness | Add `--progress-height: 3px` or `var(--border-width-thick) + 1px` |
| 44 | `box-shadow: 0 0 8px var(--color-focus)` | Glow around the bar | Offset spread is hardcoded; more subtly, **`--color-focus` is a focus-ring token**, not a glow token. Semantic mismatch. |
| 45 | `animation: trickle 4s` | Fake-progress duration | 4s doesn't fit the `--duration-*` scale (max is `--duration-slower: 500ms`). Either accept as a one-off or add `--duration-progress: 4s` |
| 50 | `animation: complete 0.2s` | Snap-to-100% on finish | `200ms === var(--duration-normal)` — should just use the token |

### Keyframes in NavigationProgress

Lines 80-88 redefine `@keyframes pulse` locally inside a `@media (prefers-reduced-motion: reduce)` block. Already flagged in Section 3.4 — collision with global `@keyframes pulse` in `styles/utilities.css`. Svelte scopes the local definition so it doesn't actually conflict, but it's redundant with a global one that's intentionally shared.

Same file defines `@keyframes trickle` + `@keyframes complete` locally — those are genuinely component-specific (no other use), so they belong here.

### Toaster variants

Three variants via `[data-variant="…"]` (lines 93-101) each set `border-left: var(--border-width-toast) var(--border-style) var(--color-<status>)`. Uses the new `--border-width-toast: 4px` token from `borders.css` — one of only three consumers of that token (confirmed in Section 04). Adoption looks healthy.

**Gap: no `neutral` variant style.** The `toast-store.ts` declares `neutral | success | warning | error`, and `toast.info(…)` passes `variant: 'neutral'`. But `Toaster.svelte` only has selectors for `success`, `error`, `warning`. Neutral toasts render with no coloured border-left — no visual error, but `info` toasts look identical to the default. Probably intentional, but worth flagging.

### Close button icon

Line 28: `<button …>✕</button>`. Uses a Unicode literal for the close icon. Elsewhere in the codebase, buttons use Lucide icons (verify in Section 21). Visual inconsistency — the `✕` (U+2715) is a heavier stroke than Lucide's `X` glyph.

## Wasted code

### `NavigationProgress` pulse keyframe duplicates global (shared finding)

Tracked in Section 03 finding 3.4. Component-local `@keyframes pulse` (lines 80-88) repeats the global one. Either deduplicate by relying on global (covered in Section 03's Option A) or accept the local one as reduced-motion-specific.

No other dead code found in this section. The root shell itself is already tight — every line earns its keep.

## Simplification opportunities

Ranked by impact/effort:

1. **Token-ify Toaster widths** — add `--toast-min-width` / `--toast-max-width` to `tokens/layout.css`, replace the two hardcoded `px` values in `Toaster.svelte:51-52`. Two-line change, removes two hardcoded-value violations.
2. **Fix NavigationProgress glow semantic** — `box-shadow: 0 0 8px var(--color-focus)` uses a focus-ring colour for a glow. Either introduce `--color-progress-glow: var(--color-interactive)` and use it, or just swap to `var(--color-interactive)` directly. Small but correct.
3. **Use `--duration-normal` for `complete` animation** — `NavigationProgress.svelte:50` hardcodes `0.2s`, which is exactly `--duration-normal`. Use the token.
4. **Replace `✕` with Lucide `<X />`** in Toast close button — consistency with the rest of the icon system.
5. **`:focus-visible` on SkipLink** — minor semantic upgrade.
6. **Consider `@starting-style` on SkipLink** — modern alternative to the `transform: translate(-50%, -200%)` initial state. Future polish, not urgent.
7. **Document the "neutral vs no-variant" behaviour** for toasts or add a subtle treatment (e.g., `border-left: var(--border-width-toast) var(--border-style) var(--color-border-strong)`).

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 6.1 | Medium | `Toaster.svelte:51-52` hardcodes `min-width: 300px` and `max-width: 400px` | Add `--toast-min-width` / `--toast-max-width` to `tokens/layout.css`; reference them |
| 6.2 | Medium | `NavigationProgress.svelte:44` uses `--color-focus` as a glow spread colour — semantic mismatch | Use `--color-interactive` (which most of the file already uses) or introduce `--color-progress-glow` |
| 6.3 | Low | `NavigationProgress.svelte:36` hardcodes `height: 3px` | Either `--progress-height: 3px` or use `calc(var(--border-width-thick) + 1px)` |
| 6.4 | Low | `NavigationProgress.svelte:45` hardcodes `4s` animation duration | Accept as one-off or add `--duration-progress` |
| 6.5 | Low | `NavigationProgress.svelte:50` hardcodes `0.2s` — exactly matches `--duration-normal` | Use the token |
| 6.6 | Low | Toast close button uses `✕` Unicode literal; rest of the app uses Lucide icons | Swap to `<X size={16} />` from `lucide-svelte` |
| 6.7 | Low | Toast `neutral` variant has no styling; renders identical to default | Decide: document the intent, or add a subtle border treatment |
| 6.8 | Low | `SkipLink.svelte:34` uses `:focus` not `:focus-visible` | Swap to `:focus-visible` |
| 6.9 | Low | `NavigationProgress` defines local `@keyframes pulse` that shadows the global | Already tracked in 3.4; resolve via the chosen keyframes contract |

## Quantitative summary

- **Chrome surface area**: 4 Svelte components, 1 store, 1 server load — about 287 lines of TS+CSS total. Exceptionally small for an app of this size.
- **Modern-CSS adoption**: high. View Transitions API correctly wrapped, Melt UI used for complex primitives, `prefers-reduced-motion` respected.
- **Hardcoded-value count**: 4 in NavigationProgress + 2 in Toaster = **6 violations** of the token-only rule in root shell. All are low-churn single-line fixes.
- **Architecture**: the root layout is genuinely thin. Each route group owns its own heavy chrome — audited in Section 22 (layout primitives).

## Next section

07 — Platform home: `(platform)/+page.svelte` + its landing sections.
