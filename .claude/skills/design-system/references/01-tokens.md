# Reference 01 — Design Tokens

Single source of truth for every CSS token, how tokens cascade, and how to add a new one.

## 1. The Three-Layer Cascade

```
Layer 1  Raw tokens         13 files in apps/web/src/lib/styles/tokens/    (:root)
  ↓ overridden by
Layer 2  Semantic themes    lib/styles/themes/{light,dark}.css              ([data-theme])
  ↓ overridden by
Layer 3  Org-brand          lib/theme/tokens/org-brand.css                  ([data-org-brand])
  ↓ overridden by
Layer 4  Inline injection   .org-layout style:--brand-* + injectTokenOverrides()
```

Layer 3 uses **CSS relative color syntax** (`oklch(from var(--brand-color) calc(l - 0.08) c h)`)
to derive a full brand palette from a single hex. See `lib/theme/tokens/org-brand.css:18-54`.

## 2. Raw Token Files (13 total)

| File | Prefix | What it holds |
|---|---|---|
| `colors.css` | `--color-*` | Raw palette (primary-50 → 900), neutrals, glass tints, semantic statuses |
| `typography.css` | `--font-*`, `--text-*`, `--leading-*`, `--tracking-*` | Font stacks, `clamp()` fluid sizes, weights, line-heights |
| `spacing.css` | `--space-*` | 0.25rem base × density scale; 0–24 |
| `radius.css` | `--radius-*` | none/xs/sm/md/lg/xl/full + semantic (button/input/card/modal) |
| `borders.css` | `--border-*` | Widths, styles, compound `--border-default`/`--border-focus` |
| `shadows.css` | `--shadow-*` | HSL-based with strength calc; dark mode override |
| `materials.css` | `--material-*`, `--color-overlay*`, `--blur-*` | Glass morphism, blurs |
| `z-index.css` | `--z-*` | hide/auto/0/dropdown/sticky/fixed/modal-backdrop/modal/popover/tooltip/toast |
| `motion.css` | `--duration-*`, `--ease-*`, `--transition-*` | See [04-motion.md](04-motion.md) — reduced-motion collapses durations |
| `layout.css` | `--breakpoint-*`, `--container-*` | Custom-property versions of the breakpoint scale |
| `breakpoints.css` | `@custom-media --*` | postcss-custom-media aliases — sm (40rem), md (48rem), lg (64rem), xl (80rem), 2xl (96rem) + below-xs/sm/md/lg |
| `opacity.css` | `--opacity-*`, `--media-*` | 0–100 scale + video player chrome |
| `player.css` | `--color-player-*` | Inverse (white-on-dark) video/audio chrome |

Full import order: `apps/web/src/lib/styles/global.css:4-34` (line 1 is the file comment; imports begin at line 4).

### ⚠ Spacing scale asymmetry — `:root` vs `[data-org-brand]`

The raw `tokens/spacing.css` file defines whole steps (`--space-0` … `--space-24`) plus a few halves (`--space-0-5`, `--space-5-5`). `org-brand.css` re-declares the scale **inside `[data-org-brand]`** with a denser set of half-steps (`--space-1-5`, `--space-2-5`, `--space-3-5`, etc.) multiplied by `--brand-density-scale`.

**Consequence:** components rendered **outside `.org-layout`** (the brand editor panel mount, global chrome like SidebarRail, auth pages, the `+error.svelte` fallbacks) have access to the raw `:root` scale only. A naked `var(--space-1-5)` in those components resolves to *nothing* → the CSS property becomes invalid → silent visual bug.

**Fix-forward rule:** when you touch a component that renders outside `.org-layout`, use whole steps (`--space-1` / `--space-2`) or supply a fallback (`var(--space-1-5, 6px)` — but then consider promoting the half-step to the raw scale instead). The brand editor panel is the canonical example (`BrandEditorMount` lives in `_org/[slug]/+layout.svelte` but outside `.org-layout`).

## 3. Semantic Theme Tokens

**Location:** `lib/styles/themes/light.css`, `dark.css`.

Themes **remap** raw tokens to intent-named semantic tokens — they never introduce new raw values.

| Category | Tokens |
|---|---|
| Surfaces | `--color-{background, surface, surface-secondary, surface-tertiary, surface-elevated, surface-card, surface-overlay, surface-variant}` |
| Text | `--color-{text, text-secondary, text-tertiary, text-disabled, text-inverse, text-on-brand}` |
| Borders | `--color-{border, border-hover, border-focus}` |
| Interactive | `--color-{interactive, interactive-hover, interactive-active, focus, focus-ring}` |
| Brand defaults | `--color-{brand-primary, brand-secondary, brand-accent}` (overridden by org-brand) |

**Activation:** light is the default via `:root, [data-theme="light"]`; dark is opt-in via `[data-theme="dark"]`. No `prefers-color-scheme` media rule — themes are explicit.

## 4. Org-Brand Derivation

**Location:** `apps/web/src/lib/theme/tokens/org-brand.css` (267 lines).

Two independent activation attributes on `.org-layout`:
- `[data-org-brand]` — always active when the org has any branding. Derives brand palette states, re-declares spacing/radius/typography at org scope.
- `[data-org-bg]` — active only when the org sets a background colour. Derives surfaces/text/borders from background luminance.

**Inputs** (set inline on `.org-layout`):

| Input | Consumed as |
|---|---|
| `--brand-color` | Full OKLCH palette (primary + 4 derived states + focus glow + text-on-brand) |
| `--brand-secondary`, `--brand-accent` | Secondary/accent palettes |
| `--brand-bg` | Surface/text derivation (only with `[data-org-bg]`) |
| `--brand-radius` | Re-declares the whole `--radius-*` scale |
| `--brand-density` | Multiplies `--space-unit`; recalcs `--space-1` through `--space-24` |
| `--brand-font-body`, `--brand-font-heading` | Re-declares `--font-sans` / `--font-heading` |
| `--brand-color-dark`, `--brand-bg-dark` | Optional dark-mode overrides |

**Derivation pattern** (lines 18–54):
```css
--color-brand-primary-hover:  oklch(from var(--brand-color) calc(l - 0.08) c h);
--color-brand-primary-active: oklch(from var(--brand-color) calc(l - 0.15) c h);
--color-brand-primary-subtle: oklch(from var(--brand-color) 0.96 calc(c * 0.2) h);
--color-text-on-brand:        oklch(from var(--brand-color) clamp(0, (0.62 - l) * 1000, 1) 0 0);
```

The luminance-clamp pattern on `--color-text-on-brand` auto-inverts text between black/white based on `--brand-color` luminance.

## 5. Decision — "Where does my new value live?"

```
Is it a one-off literal used in one component?
├─ YES → inline in the scoped <style>, no token needed
└─ NO → is it used across >1 component?
        ├─ NO → still inline — don't pre-abstract
        └─ YES → is it semantic (intent: "this is a card surface")?
                 ├─ YES → add to themes/light.css + dark.css (new semantic token)
                 └─ NO  → is it a new raw primitive (new colour, new spacing step)?
                          ├─ YES → add to the correct tokens/*.css file
                          └─ NO  → is it org-brandable (varies per org)?
                                   └─ YES → see 10-brand-editor.md (Path A or B)
```

**Rules of thumb:**
- Don't introduce a raw token for a single consumer; inline the `var()` derivation.
- Don't introduce a semantic token without at least 2–3 planned consumers.
- Raw tokens never reference semantic tokens — the arrow points one way.

## 6. How to Add a New Token

### New raw token (e.g. `--space-28`)

1. Add to the correct file in `lib/styles/tokens/` — keep the naming scheme consistent with peers.
2. If it's density-dependent (spacing/radius/typography), verify `org-brand.css` re-declares it in `[data-org-brand]` (spacing/radius do; other scales don't).
3. Run `pnpm dev` and visually verify the value appears in devtools computed styles.

### New semantic token (e.g. `--color-surface-accent`)

1. Add to **both** `themes/light.css` and `themes/dark.css` — any missing theme is an a11y regression.
2. Cite the raw token it remaps, not a hex literal (`var(--color-primary-50)`, not `#fef6f3`).
3. If it's org-brandable, add a derivation rule to `org-brand.css` inside `[data-org-brand]` — see [10-brand-editor.md Path A](10-brand-editor.md#3-path-a--adding-a-base-property).

### Consuming a token

```css
/* CORRECT */
.card {
  background: var(--color-surface-card);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: var(--transition-colors);
}

/* WRONG */
.card {
  background: #ffffff;                    /* Hardcoded */
  padding: 16px;                          /* Hardcoded */
  border-radius: 8px;                     /* Hardcoded */
  background: var(--color-neutral-50);    /* Raw token, not semantic */
}
```

## 7. Private Local Tokens (`--_*`)

Scoped component-private tokens using the underscore prefix. Pattern:

```css
/* ContentCard.svelte */
.cc__image {
  --_focal: center 18%;                       /* Private default */
  object-position: var(--_focal);
}
.cc--portrait .cc__image {
  --_focal: center 8%;                        /* Variant override */
}
```

**Rules:**
- Use only for layout-private calculations (focal points, fluid ramps, per-variant offsets)
- Never rely on a `--_*` token being set by a parent — always supply a fallback
- `--_*` tokens are immune to org branding (by design)

## 8. When Token Fallbacks Are Legitimate (and When They're Not)

Fallbacks inside `var()` split cleanly into two categories. Mis-applying the rule costs either correctness or safety.

### ✅ Legitimate — conditionally-defined tokens

When the token is **intentionally overridable** and may genuinely not be set in the current scope, the fallback IS the default value:

```css
/* CORRECT — brand-editor contract allows opacity override but defaults to 0.7 */
--material-glass-opacity: var(--brand-glass-opacity, 0.7);

/* CORRECT — brand letter spacing falls back to 0 when org hasn't branded */
--tracking-normal: var(--brand-letter-spacing, 0em);
```

Rule of thumb: if the token is a `--brand-*` prefix (set only inside `[data-org-brand]`), a fallback is the contract — not a workaround.

### ❌ Anti-pattern — guaranteed-defined tokens

When the token is **always defined** at `:root` (every token under `styles/tokens/*`), fallbacks hide broken wiring:

```css
/* WRONG — --duration-normal is guaranteed by motion.css; the fallback masks a regression */
transition: opacity var(--duration-normal, 200ms) var(--ease-default, ease);

/* CORRECT — let the missing token surface as a visible break */
transition: opacity var(--duration-normal) var(--ease-default);
```

If `motion.css` ever drops `--duration-normal`, the fallback version silently diverges to the literal; the bare version reveals the regression instantly in QA. Same logic for `--color-*`, `--space-*`, `--radius-*`, `--text-*`, `--font-*`, `--shadow-*`, `--z-*`, `--opacity-*`, `--blur-*`, `--tracking-*`, `--leading-*`.

### Fallbacks at consumer sites vs at the declaration

If a token genuinely needs a fallback (platform-vs-org scope), declare the fallback **once at
the token's declaration**, not at every consumer. Example from iter-03 (pricing page had 123
inline fallbacks):

```css
/* WRONG — 50+ call sites inline the same fallback; drifts silently */
color: var(--color-brand-primary, var(--color-interactive));
background: var(--color-brand-primary, var(--color-interactive));
/* ...repeated 50x... */

/* CORRECT — declare the fallback once at :root; consumers stay bare */
:root {
  --color-brand-primary: var(--brand-color, var(--color-interactive));
}

/* then everywhere else: */
color: var(--color-brand-primary);
```

One declaration point = one line to audit. 50 call-site fallbacks = 50 drift points.

### ⚠ Grey area — scope-dependent tokens

Half-step spacing tokens (`--space-1-5`, `--space-2-5`) are declared ONLY inside `[data-org-brand]`. If the consumer renders outside `.org-layout` (brand editor panel mount, auth pages, global chrome), the token is genuinely missing. Two correct choices:

- **Promote to the raw scale** (preferred) — add the half-step to `tokens/spacing.css` so it's `:root`-guaranteed, then drop fallbacks.
- **Supply an explicit fallback** (acceptable interim) — `gap: var(--space-1-5, 6px);` so the gap at least renders; but track the promotion in beads.

See the "Spacing scale asymmetry" warning earlier in this file for the canonical example.

### Spacing scope cheat-sheet

**Available at `:root`** (safe anywhere, including non-org-branded routes):

```
--space-0, --space-0-5, --space-1, --space-2, --space-3, --space-4, --space-5, --space-5-5,
--space-6, --space-7, --space-8, --space-10, --space-11, --space-12, --space-16, --space-20, --space-24
```

**Only under `[data-org-brand]`** — sparse fills:

```
--space-9, --space-13, --space-14, --space-15,
--space-17, --space-18, --space-19, --space-21, --space-22, --space-23
```

<!-- updated iter-07: half-steps moved to :root in iter-06; sparse fills remain -->
**Promotion status:**
- `--space-1-5`, `--space-2-5`, `--space-3-5` were promoted to `:root` in **iter-006** (commit `01deba56`) — system-safe now.
- Sparse fills above remain `[data-org-brand]`-only. **Iter-007 found `--space-9` leaked into a system-scope component** (`BrandEditorShape.svelte:93`) — *partial promotion creates a false sense of closure*. When R12 is "fixed" for one token family, agents can stop auditing and miss cousins. If a system-scope component needs a sparse fill, **promote it in the same PR** rather than adding an inline fallback — fallbacks disguise the scope violation.

Rule: if your component can render outside `.org-layout` (auth pages, platform routes,
global chrome, brand editor panel mount), stay inside the `:root` list or promote the token
you need. `spacing.css` is the source of truth — verify before consuming an unfamiliar step.

## 9. Gotchas / Anti-patterns

- **Don't** consume raw tokens directly in components. `--color-neutral-900` shouldn't appear in a component — use `--color-text` instead. The exception is raw tokens used inside the theme files.
- **Don't** hardcode px, hex, rem, or seconds in a component's `<style>`. If the value doesn't have a token, either add one or use `var()` arithmetic against existing tokens.
- **Don't** define a token in a theme file that has no raw backing — themes remap, they don't invent.
- **Don't** add a `--brand-*` token without an accompanying derivation rule + fallback in `org-brand.css`. Missing fallback = broken page when the brand hasn't set a value.
- **Don't** add a `--brand-*` token whose only WRITE path is the editor's `injectBrandVars()` — that path is browser-only and covers editor sessions only. Non-editor visitors render from SSR, which needs a matching `style:--brand-X={value}` binding on `.org-layout` in `+layout.svelte`. Rule: every `--brand-*` READ in `org-brand.css` MUST have a corresponding WRITE in the SSR layout. See `10-brand-editor.md` §13.3 for the full checklist and the `Codex-lqvyy` canonical fix (commit `af423e86`).
- **Don't** use `color-mix(in srgb, #abc123 50%, transparent)` — use the token (`color-mix(in srgb, var(--color-brand-primary) 50%, transparent)`). If the token isn't brand-aware, the feature isn't truly themable.
- **Don't** rely on `@media (prefers-color-scheme: dark)` for theme detection — the codebase is explicit-toggle via `[data-theme]`. Adding `prefers-color-scheme` creates two sources of truth.
- **Don't** introduce new breakpoints ad-hoc. Use `@media (--breakpoint-md)` etc. If you genuinely need a new tier, add a new `@custom-media` in `breakpoints.css`.

## 10. When to Re-Verify This Reference

Re-read the source of truth after any change to:

- `apps/web/src/lib/styles/global.css` — import order
- `apps/web/src/lib/styles/tokens/*.css` — any new or removed token file
- `apps/web/src/lib/styles/themes/{light,dark}.css` — semantic mappings
- `apps/web/src/lib/theme/tokens/org-brand.css` — derivation rules (especially if Svelte 5 / Vite adds `@property` support and we migrate)

If this reference disagrees with those files, **the code wins** — update the reference.
