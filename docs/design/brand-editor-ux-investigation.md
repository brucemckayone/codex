# Brand Editor — UX Investigation & Redesign Directions

> Investigation date: 2026-07-18 · Scope: full chain (DB → service → validation → remote → SvelteKit layout → CSS derivation → editor UI → design system)
> **Companion mockups:** [`brand-editor-mockups.html`](./brand-editor-mockups.html) — a self-contained, interactive file (4 concepts + a live OKLCH-derived preview). Published copy: <https://claude.ai/code/artifact/c8a5eda7-7899-4948-bbc8-57e7ead9c59a>

## 0. TL;DR

The brand editor sits on top of a **genuinely powerful derivation engine** — 7 raw inputs fan out into ~50 semantic design tokens via OKLCH relative color, with per-theme (light/dark) support and component-scoped tokens (player, cards, glass, hero) already wired. **The engine is not the problem. The UI that drives it is.**

The current UI is a 360px floating glass panel with a modal-stack (back-button-only) drill-down across ~12 levels — one of which (Hero Effects) is a whole shader sub-application with dozens of presets × 5–8 sliders each. The three biggest UX failures:

1. **The panel occludes the preview it exists to show**, and the preview is only ever the org *landing page* — you can't see your brand on grids, detail pages, the player, nav, or forms without navigating away (which trips the discard-guard).
2. **Navigation is a stack with no map** — no breadcrumb trail, no overview, no search, no jump. Across 12 levels it is easy to lose your place.
3. **The surface is enormous and undifferentiated** — foundational choices (colors, type, shape) sit in the same flat list as a 300-parameter shader lab, so the tool feels equally heavy for "just make it match my logo" and "tune the caustics refraction."

This document maps the system end-to-end, catalogs the full editable surface, names the pain points with evidence, and proposes four UI directions (with working mockups). It also analyzes **per-component editing** as an extensibility target — which the token layer already supports, meaning it is a *UI-surface* problem, not an engine rebuild.

---

## 1. System architecture

### 1.1 The four-layer CSS cascade

Brand theming is a pure-CSS-variable cascade. Nothing re-renders; the browser re-resolves `var()`:

```
Layer 1  Token foundation      :root, 13 files in styles/tokens/     (--space-*, --radius-*, --text-*, --color-primary-*, …)
   ↓ overridden by
Layer 2  Theme                 [data-theme="light|dark"]             (semantic: --color-surface, --color-text, …)
   ↓ overridden by
Layer 3  Org branding          [data-org-brand] / [data-org-bg]      (OKLCH derivation from --brand-* inputs)
   ↓ overridden by
Layer 4  Inline JS injection   .org-layout style + el.setProperty()  (SSR bindings + live editor injection)
```

The engine lives in **`apps/web/src/lib/styles/tokens/org-brand.css`** (367 lines). It takes 7 raw inputs and derives the palette with CSS relative color:

```css
--color-interactive:        var(--brand-color, var(--color-primary-500));
--color-interactive-hover:  oklch(from var(--brand-color) calc(l - 0.08) c h);
--color-text-on-brand:      oklch(from var(--brand-color) clamp(0, (0.62 - l) * 1000, 1) 0 0); /* auto-contrast */
```

**Two activation gates**, so an unbranded org is untouched:
- `[data-org-brand]` — color, shape (radius), density, fonts, and the component-scoped tokens. Active whenever the org has *any* branding.
- `[data-org-bg]` — surface/text/border re-derivation. Active *only* when a background color is explicitly set (so most orgs keep the neutral theme surfaces).

**Per-theme dark** (`Codex-wwedk`): dark values ride `--brand-*-dark` keys, read under `.dark [data-org-brand]`, `[data-theme=dark] [data-org-brand]`, and `[data-editing-theme=dark][data-org-brand]`. The last selector lets the **editor preview dark without mutating `<html data-theme>`** — a nice touch. Each dark token uses `var(--brand-x-dark, var(--brand-x))` so an unset dark value transparently inherits light.

> **Engine caveat worth knowing (already documented):** ShaderHero reads `--brand-shader-*` via `getComputedStyle`, and the light values are injected *inline* on `.org-layout` (inline beats stylesheet). You cannot rebind `--brand-shader-x` in the dark gate (self-referential `var(--x-dark, var(--x))` cycle). The fix is a stylesheet-only sentinel `--brand-shader-is-dark: 1` that the JS reader honors. (`Codex-d0cr2`, PR #391.)

### 1.2 The backend save/load chain

*(Detail confirmed against the `/design-system` skill reference `references/10-brand-editor.md`, which documents 6 change-paths and the full file matrix.)*

```
SAVE:  editor store.pending ──$effect──▶ injectBrandVars()            (live preview, browser only)
       Save click ─▶ updateBrandingCommand() (remote)
                   ─▶ org-api PUT /settings/branding
                   ─▶ BrandingSettingsService.update() (upsert branding_settings)
                   ─▶ waitUntil: invalidate brand KV cache

LOAD:  +layout.server.ts ─▶ api.org.getPublicInfo(slug)  [VersionedCache KV]
                          ─▶ fetchPublicOrgInfo() (DB row → API shape)
                          ─▶ +layout.svelte derives brandPrimary, heroHideFlags, fine-tune JSON…
                          ─▶ inline style:--brand-* on .org-layout  +  injectTokenOverrides() ($effect)
                          ─▶ org-brand.css [data-org-brand] rules activate → palette derived
                          ─▶ components read var(--color-*) — no component code runs
```

Persistence is a single **`branding_settings`** row per org. Base fields (primary/secondary/accent/background hex, fontBody, fontHeading, radius, density, logoUrl) have dedicated columns; everything else (fine-tune tokens, shader params, hero flags, hero text colors) is serialized into two JSON columns: **`tokenOverrides`** (light) and **`darkTokenOverrides`** (dark), plus **`darkModeOverrides`** for the dark base *colors*.

The full field-by-field contract, exact validation constraints, DB column table, and verified backend gaps are in §9.5. (Confirmed: the entire chain is **organization-api**, despite CLAUDE.md files attributing branding to identity-api.)

### 1.3 How the editor mounts

- Entry: **Studio → Settings → Branding** page renders a read-only brand summary + logo upload + hero-text form, and an **"Edit Brand Live"** button that does `goto('/?brandEditor=true')` — navigating to the org's **public landing page** with a URL param.
- The org layout sees `?brandEditor`, reconstructs saved state from the server JSON, and **dynamically imports `BrandEditorMount.svelte`** (so normal visitors never download the editor JS — good perf hygiene).
- Access is **admin/owner only** (role guard redirects otherwise).
- The panel renders **outside `.org-layout`**, so its own chrome uses *system* tokens while the page behind it live-updates with *brand* tokens. Genuinely clever — but see §4.1.

---

## 2. The editable surface (full inventory)

The state object (`BrandEditorState`) plus the token-override system expose an unusually large surface:

| Group | What's editable | Storage |
|---|---|---|
| **Colors** | primary, secondary, accent, background (+ independent dark variants) | columns + `darkModeOverrides` |
| **Typography** | body font, heading font (+ per-theme), text scale, heading weight, body weight, label text-transform | columns + `tokenOverrides` |
| **Shape** | radius (drives the whole radius scale), density (drives the whole spacing scale) | columns |
| **Shadows** | shadow scale (intensity), shadow color/tint (+ dark) | `tokenOverrides` |
| **Logo** | upload/preview (R2), used in header + hero + shader logo texture | column |
| **Header layout** | 10 hero layout variants + 5 element-visibility flags + hero logo scale | column (`heroLayout`) + `tokenOverrides` |
| **Hero colors (fine-tune)** | hero text/muted/title color + blend mode, CTA bg/text, glass tint/text, border tint | `tokenOverrides` |
| **Hero effects (shaders)** | preset selection + per-preset params — **40 presets, ~215 tunable controls** (3 shared + ~5–6 per preset; `hero-fx-presets.ts` is 2,961 lines) | `tokenOverrides` (`shader-*`) |
| **Intro video** | upload a hero background video | (media) |
| **Player chrome** | player text/surface/border/overlay tokens (+ dark) — *component-scoped* | `tokenOverrides` (`player-*`) |
| **Cards** | hover scale, image hover scale, media scrim/glyph — *component-scoped* | `tokenOverrides` (`card-*`) |
| **Glass** | glass tint (+ dark) | `tokenOverrides` (`glass-tint`) |
| **Presets** | apply a full bundled design system (colors + tokens + hero layout) | — |

**Key structural fact:** the override system already splits into two prefix families in `css-injection.ts`:
- `BRAND_PREFIX_KEYS` → emitted as `--brand-{key}` (consumed by `org-brand.css` rules or `getComputedStyle`).
- everything else → `--color-{key}` (direct semantic-token replacement).

This is the mechanism that makes **per-component theming already possible** (player, cards, glass, hero are all component-scoped token groups). See §7.

---

## 3. Information architecture (current)

`levels.ts` defines a 3-depth tree, surfaced by `BrandEditorHome.svelte` grouped into labeled sections:

```
Home (depth 0)  "Brand Editor"
├─ Colors ▸  (+ Fine-tune Colors, depth 2)         [primary row + swatches]
├─ Generate Palette  (inline expander → palette swatch grid)
├─ Hero:        Header Layout ▸ · Hero Effects ▸ · Intro Video ▸
├─ Customize:   Typography ▸ (+ Fine-tune Typography) · Shape & Spacing ▸
├─ Advanced:    Shadows ▸ · Logo ▸
└─ Browse Presets ▸
```

Navigation is a **stack**: `navigateTo(level)` pushes, `navigateBack()` pops to `parent`. The header shows only a back-arrow + the current level's label. There is **no breadcrumb trail, no overview, no search, no direct jump** between sibling levels — to go Colors → Typography you must go back to Home first.

Control vocabulary is consistent and clean:
- **Row buttons** (icon + name + description + chevron) for navigation.
- **`ControlField`** — a manifest-driven dispatcher rendering a slider / native color input / toggle switch (this replaced 41 hand-written per-preset blocks — good refactor).
- **`BrandSliderField`** — label + mono value read-out + range + min/max hint labels.
- **OKLCH color picker** (custom, no dependency) for the color levels.
- **`FontPicker`** for typography.

Footer is global: **Reset** (discards *all* pending) + an "Unsaved" dot + **Save**. Minimized state collapses to a compact bottom-right pill with a Save shortcut.

---

## 4. UX pain points (evidence-based)

### 4.1 The panel occludes the preview — and the preview is only the landing page
The panel is `position: fixed; bottom/right; width: min(360px, …)` over `.org-layout`. On a laptop it covers ~25–30% of the viewport — exactly the region you're trying to evaluate. Worse, "Edit Brand Live" only ever lands you on `/` (the landing). Brand tokens theme the **entire** org surface — content grids, detail pages, the video player (`--color-player-*`), nav, forms — but there is **no way to preview those** without navigating away, and navigating away while dirty triggers the discard-confirmation. So the tool asks you to commit to changes you can only partially see.

### 4.2 Navigation is a stack with no map
Back-button-only across 12 levels. No breadcrumb, no "where am I," no search, no sibling-jump. The `getBreadcrumb()` helper *exists* in `levels.ts` but the header renders only parent-back + title. Deep spots (Fine-tune Colors, a specific shader's params) are 2–3 pops from anywhere else.

### 4.3 One panel, wildly different task weights
Choosing a brand colour and tuning `shader-caustic-refraction` are the same 360px column. The **Hero Effects** level alone is a shader lab: **40 presets and ~215 tunable controls** (`hero-fx-presets.ts` is 2,961 lines), presented as a **text-only 2-column grid of 40 tiny cards** — no thumbnails, no search/filter — with a generic `ControlField` slider/colour/toggle stack appended below the active preset. It shares an information hierarchy with "upload your logo." There is no separation between **"make it look right in 60 seconds"** and **"tune every parameter"** — and the shader grid, the single densest surface, has no visual preview on the tiles themselves.

### 4.4 Weak visual payoff (user-reported, v2 testing)
Direct user feedback from v2 testing (captured in project memory): *"changes don't make enough of a visual difference … branding tokens aren't consumed broadly enough across components."* The engine has since grown "blind-spot fix" derivations and forces `.content-card` shadows + heading colors, but the breadth of brand-token consumption across product components is the gating factor for perceived impact.

The measured census (§9.3) makes this concrete: the *spine* is broadly wired (`--color-text*` 233 files, `--radius-*` 223, `--color-interactive` 129), but the editor's fine-tune knobs are near-dead — **`--color-heading` has 0 consumers**, `--card-hover-scale` 1, `--media-scrim` 3, `--font-body` 8. The editor exposes more knobs than the component layer reads; that gap *is* the weak-payoff bug.

### 4.5 All-or-nothing save; no change summary; no history
Reset discards everything; there's no per-field revert affordance in the footer, no "here's what you changed" summary before saving, and no undo/redo. For a tool where one slider can shift the whole page, the absence of a change ledger is a confidence problem.

### 4.6 Editing is split across two surfaces
Logo upload and hero-text (org name + description) live on the **static settings page**; everything else lives in the **live editor**. So a first-time admin edits brand identity in two disconnected places with two mental models.

### 4.7 Discoverability of depth
Fine-tune panels, per-component tokens (player/cards/glass), and the 10 hero layouts are real power, but they're buried behind generic rows ("Advanced", "Fine-tune"). Nothing communicates the *range* of what's possible, so most admins likely never find it.

---

## 5. Design principles for a redesign

1. **The preview is the product.** The live org surface should be the largest thing on screen; controls serve it, never cover it.
2. **Preview must span the surface.** Let the admin flip the preview between Landing / Grid / Detail / Player / Nav, across light+dark, at desktop/tablet/mobile — because the brand touches all of them.
3. **Always show the map.** A persistent, navigable structure (breadcrumb or tree) so you always know where you are and can jump anywhere.
4. **Separate "fast" from "deep."** A 60-second happy path (preset or seed-color → full palette → done) distinct from progressive-disclosure power controls.
5. **Make impact obvious.** Surface the component families that respond to each control ("this affects: buttons, cards, player, focus rings") so changes feel consequential.
6. **Give changes a ledger.** A visible summary of pending edits with per-field revert; save is deliberate, not a leap.
7. **Design for per-component editing now, even if you build it later.** The token model already supports it; the IA should have a natural home for it (see §7).

---

## 6. Four UI directions (see mockups)

| # | Direction | Core move | Best for | Risk |
|---|---|---|---|---|
| **A** | **Refined Panel** | Keep the floating panel; add breadcrumb, search, section overview, per-field reset, side-dock to reduce occlusion, change-summary drawer | Shipping an improvement fast without re-architecting | Low |
| **B** | **Studio Canvas** ⭐ | A dedicated workspace: left control rail + **large live-preview canvas** with route / device / theme switchers | The primary near-term target — fixes occlusion + preview-scope + navigation together | Medium |
| **C** | **Inspector** ⭐ | Three-pane Figma/Framer model: navigable **tree** (Foundations → Surfaces → Components) → canvas → **contextual inspector**; click any element in the canvas to edit its tokens | The per-component-editing future, grounded in existing tokens | Higher |
| **D** | **Guided / Presets-first** | Progressive disclosure: preset gallery + seed-color→full-palette + "brand from logo", then "go deeper" reveals | First-run and non-designer admins | Low |

Recommendation: **B for the next iteration, evolving toward C.** A and D are patterns that can fold into either. B and C share the same spine (rail/tree + canvas), so B can be built such that C is an additive step, not a rewrite.

---

## 7. Per-component editing — extensibility analysis

The user asked to *consider* per-component editing "at one point but not now." The important finding: **the hard part is already done.**

- The override system already carries **component-scoped token groups**: `player-*`, `card-*` (hover scales), `glass-tint`, `media-scrim/glyph`, `heading-color`, and the full `hero-*` family. These are honored by `org-brand.css` today.
- Adding a new component-scoped group is a **Path B** change in the skill's taxonomy: add the key's prefix in `css-injection.ts`, add a `var(--brand-x, fallback)` rule in `org-brand.css`, add a control. **No DB migration, no service change.**
- So per-component editing is fundamentally a **UI-surface + IA problem**, not an engine rebuild. The blocker is that the flat level list has nowhere to express "Components → ContentCard → these tokens."

What it would take (future, not now):
1. **A component registry** mapping a component (Button, ContentCard, Nav, Player, Hero, Form) → the set of override keys it honors → sensible controls + safe ranges.
2. **A tree/inspector IA** (Concept C) so "Components" is a first-class branch alongside "Foundations."
3. **Canvas element selection** — click a card in the preview to open its inspector (needs a lightweight `data-brand-component` annotation on component roots).
4. Guardrails: per-component overrides should *layer on* the derived palette (never fork it), and every override needs a visible reset-to-derived.

Concept C's mockup shows this end-state so the near-term IA can be built toward it.

---

## 8. Tech-debt observed during the investigation

Not blockers for a UX redesign, but worth logging. (Verified against current code — several claims in the older `/design-system` skill doc have since been resolved, noted below.)

- **`--color-heading` has zero consumers** (§9.3) — the highest-value, lowest-effort fix: the editor writes a heading colour the page never reads. Wire it.
- **Doc drift (attribution):** `apps/web/CLAUDE.md` and `packages/platform-settings/CLAUDE.md` say identity-api owns branding; it's entirely **organization-api** (§9.5).
- **Skill doc path drift** — `references/10-brand-editor.md` cites `apps/web/src/lib/theme/tokens/org-brand.css`; the file is at `apps/web/src/lib/styles/tokens/org-brand.css`.
- **Stringly-typed fine-tune** — all fine-tune keys live in `text` JSON columns, contract enforced only by the client injector (§9.5). *(Note: the earlier "base fields double-written to columns + JSON" debt is largely resolved — the 6 broken-out fine-tune columns were backfilled in migration `0059` and dropped in `0060`; JSON is now the single source of truth.)*
- **`heroLayout` now has a single source** — `HERO_LAYOUTS` in `@codex/validation`, consumed by both the validation and remote command schemas, so the old "triplication" (`Codex-a4zc`) is substantially resolved; verify whether the inline union cast in `BrandEditorMount.svelte` still lingers. But the **read** path types it as free `z.string()` (§9.5) — worth tightening.
- **`applyPreset` merge semantics** — already fixed to spread-merge (`Codex-oqv3r`); any redesigned preset flow must preserve it.
- **Settings/editor split** (§4.6) — logo + hero-text on the settings page vs. the live editor; consolidating is partly a data-ownership decision, not just UI.

See §9.5 for the full verified gap list (strings-for-numbers, `pricingFaq` public-path gap, redundant schema pipe).

---

## 9. Backend contract & consumption coverage

### 9.1 Save contract — `updateBrandingCommand`

The editor's Save calls `updateBrandingCommand` (`apps/web/src/lib/remote/branding.remote.ts`) with these fields (confirmed against `BrandEditorMount.svelte` `handleSave()`):

| Field | Type | Source in editor | Persistence |
|---|---|---|---|
| `orgId` | string | store.orgId | scope key |
| `primaryColorHex` | hex string | colours | column |
| `secondaryColorHex` | hex / `''` | colours (`''` clears) | column |
| `accentColorHex` | hex / `''` | colours | column |
| `backgroundColorHex` | hex / `''` | colours | column |
| `fontBody` | string / `''` | typography | column |
| `fontHeading` | string / `''` | typography | column |
| `radiusValue` | number | shape | column |
| `densityValue` | number | shape | column |
| `tokenOverrides` | JSON string / `''` | all fine-tune + hero + shader + component keys (light) | `tokenOverrides` JSON column |
| `darkModeOverrides` | JSON string / `''` | dark base *colours* | `darkModeOverrides` column |
| `darkTokenOverrides` | JSON string / `''` | dark fine-tune/token keys | `darkTokenOverrides` JSON column |
| `heroLayout` | enum | header-layout | column |

Empty string is the explicit "clear this" signal (the worker nulls the column); an absent/empty JSON map clears the override column. After save, `invalidate('cache:org-versions')` re-runs the org layout load so the change appears without a manual reload (`Codex-7afgp` + synchronous KV invalidation `Codex-ja9zp`).

### 9.2 The chain, by file (per `/design-system` skill `references/10-brand-editor.md`)

```
validation   packages/validation/src/schemas/settings.ts   → updateBrandingSchema, DEFAULT_BRANDING, heroLayout enum
service      packages/platform-settings/.../branding-settings-service.ts → fieldMap, mapRow, upsert
worker       workers/organization-api/src/routes/organizations.ts → fetchPublicOrgInfo() (DB row → public API shape)
db           packages/database/src/schema/settings.ts       → brandingSettings table
types        packages/shared-types/src/api-responses.ts      → BrandingSettingsResponse, PublicBrandingResponse
load         apps/web/.../_org/[slug]/+layout.server.ts → +layout.svelte  → inline style:--brand-* + injectTokenOverrides()
```

`branding_settings` is one row per org: dedicated columns for the base fields above, plus JSON columns `tokenOverrides` / `darkTokenOverrides` / `darkModeOverrides`. Migrations of note: `0059_backfill_branding_token_overrides.sql` (backfilled dropped fine-tune columns into the JSON — the JSON is now the sole source of truth per `Codex-g49b4`), and `0061`.

Auth: the settings page and update endpoint are **admin/owner-gated**; the public read path (`fetchPublicOrgInfo`) is unauthenticated and KV-cached (`VersionedCache`), which is why a save must invalidate the org-versions cache to surface immediately.

### 9.3 Brand-token consumption coverage — measured census

*This is the crux of the "changes don't make enough visual difference" complaint (§4.4). Grep census over `lib/components` + `routes` (`.svelte`/`.css`/`.ts`), file counts:*

**Well-wired — the brand spine works:**

| Token | Files | |
|---|---:|---|
| `--color-text*` | 233 | body/heading text |
| `--radius-*` | 223 | shape scale (from `--brand-radius`) |
| `--color-surface*` | 196 | surfaces |
| `--color-interactive` | 129 | buttons, links, active, focus |
| `--font-heading` | 74 | heading *family* |
| `--shadow-*` | 66 | elevation |
| `--color-brand-*` | 46 | brand accents |

**Thin — brand knobs barely reach the page:**

| Token | Files | |
|---|---:|---|
| `--color-player-*` | 15 | player chrome |
| `--font-body` | **8** | body *family* |
| `--material-*` | 4 | glass |
| `--media-scrim` | 3 | card media cover |
| `--card-hover-scale` | **1** | card hover |

**Defined by the editor, read by NOTHING (dead knobs):** `--color-heading` → **0** · `--color-text-heading` → 0 · `--card-media-*` → 0.

**The smoking gun.** `org-brand.css` defines `--color-heading` (a heading-*colour* override the editor writes) but **nothing reads it** — headings resolve their colour from `--color-text` (233 files) and use `--font-heading` only for the *family* (74 files). So **editing heading colour in the editor is literally invisible.** Body-font changes reach only 8 files; card hover-scale 1; media-scrim 3. The derivation engine (and the editor UI) *over-produce knobs relative to what the component layer consumes* — that gap is the concrete mechanism behind "changes don't show." (Note: `--brand-*` at 0 consumers is expected — those are OKLCH *inputs*; product reads the *derived* `--color-interactive` / `--color-brand-*`.)

This corroborates the open beads found in the docs (§9.4): `Codex-g49b4` (6 write-orphaned columns — since backfilled into JSON and dropped), `Codex-mdg94` (audit whether fine-tune values actually route to `tokenOverrides`), and `Codex-wcwpw` (token-override FOUC — shader/CSS-var keys arrive post-hydration).

**Family wiring (qualitative):** Button — well-wired (`--color-interactive`). ContentCard — reads brand + media-cover tokens, but those are the *narrow* ones. Hero/Shader — the richest brand surface. Forms (~11 files), Player (6), Footer — wired. Nav (~4 files) — partial.

**Implication for the redesign:** the "Affects: buttons · cards · player · focus rings" chips in Concepts B/C are not decoration — they set honest expectations about which surfaces a control actually moves, *and* double as a punch-list for closing the consumption gap. Two of the highest-leverage fixes are trivial: **wire `--color-heading`** (make headings read it) and either **encourage a background colour** or derive a subtle brand-tinted surface even without one (today, with no explicit bg, the `[data-org-bg]` gate stays off and the largest surfaces keep the neutral theme).

### 9.4 Remaining level components (control inventory)

From `levels/`: **Colours** (an `OklchColorPicker` per role — primary/secondary/accent/background — with add/remove/clear) → **Fine-tune Colours** (568 lines, the largest level — per-token pickers in collapsible accordion groups, incl. a segmented "Adaptive | Light | Custom" blend-mode control for hero-title colour). **Typography** (body/heading `FontPicker` — 492-line searchable dropdown with `IntersectionObserver` lazy font-loading) → **Fine-tune Typography** (text-scale slider; weight sliders historically no-op — see below). **Shape** (radius + density sliders). **Shadows** (intensity slider + tint `ColorInput`). **Logo** (upload/preview). **Header Layout** (10 layout variants + per-element visibility toggles + logo-scale slider). **Hero Effects** — see §4.3, the dominant surface. **Intro Video** (multi-phase upload→transcode→preview). **Presets** (gallery grouped by category; `applyPreset` spread-merges so user fine-tunes survive — `Codex-oqv3r`).

The colour picker is a custom OKLCH stack (no dependency): `OklchColorArea` (2D L/C canvas), `HueSlider`, `ColorInput` (hex), `SwatchRow`, composed by `OklchColorPicker`.

### 9.5 Exact save contract, constraints & verified backend gaps

*From a full trace of the save/load chain. The entire chain is **organization-api** — not identity-api.*

**Route & auth:** `PUT /api/organizations/:id/settings/branding` (`workers/organization-api/src/routes/settings.ts`), `policy:{ auth:'required', requireOrgManagement:true }` (owner/admin). Server-of-record schema: `updateBrandingSchema` (`packages/validation/src/schemas/settings.ts`).

**Constraints:** hex `#RRGGBB` (uppercased); font names ≤50 chars; `radiusValue` 0–2; `densityValue` 0.75–1.25; `heroLayout` ∈ `HERO_LAYOUTS` (a single exported const — `default, centered, logo-hero, minimal, split, magazine, asymmetric, portrait, gallery, stacked`); `DEFAULT_BRANDING` primary `#3B82F6`, radius 0.5, density 1. Primary colour is **NOT NULL**; empty-string on any other field clears it.

**Service:** `BrandingSettingsService.update()` (`packages/platform-settings`) does a **partial upsert** — only fields `!== undefined` are written, spread into *both* `values()` and the `onConflictDoUpdate` set, so omitted fields are never nulled. Cache invalidation is deliberately dual: the slug-keyed `ORG_CONFIG:{slug}` content cache is invalidated **inline/awaited** (fixes a save→reload race, `Codex-ja9zp`); the `orgId` version is bumped fire-and-forget for client staleness.

**Load:** the page reads branding via the **public, unauthenticated** endpoint `GET /public/:slug/info` (`fetchPublicOrgInfo`), wrapped in a 30-min slug-keyed `VersionedCache` (`CacheType.ORG_CONFIG`). All three JSON blobs (`tokenOverrides`, `darkModeOverrides`, `darkTokenOverrides`) confirmed to propagate through this path into `data.org.brandFineTune`.

**Verified gaps / tech-debt (fresh, not from the skill doc):**
1. **Doc drift — branding is organization-api, but `apps/web/CLAUDE.md` and `packages/platform-settings/CLAUDE.md` attribute it to identity-api.** identity-api has no branding code. Actionable one-line doc fix.
2. **`radius_value` / `density_value` are stored as `varchar(10)` strings** — no DB numeric/range guarantee; ranges enforced only by Zod at the edge, then coerced back to number on read.
3. **`heroLayout` is read unvalidated** — the response types it as free `z.string()`, not the `HERO_LAYOUTS` enum, so a stored garbage value passes straight to the client.
4. **`pricingFaq` is validated + persisted but absent from the public read path** and not settable from the brand-editor command schema — a silent split between the two "branding" shapes (also `introVideoMediaItemId` is in the authed shape but dropped from public).
5. **Fine-tune is a stringly-typed JSON bag** — since `Codex-g49b4`, all fine-tune keys live in `token_overrides` / `dark_token_overrides` `text` columns; the key contract (heading-color, shadow-scale, text-scale, weights, shader preset, hero-hide flags) is enforced only by the client injector + a migration comment, not by validation or the DB.
6. **Redundant `brandingSettingsSchema` `.pipe()`** — the 16-field object is declared twice with no meaningful transform.

