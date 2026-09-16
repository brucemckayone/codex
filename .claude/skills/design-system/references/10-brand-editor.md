# Reference 10 — Brand Editor

> **Part of `/design-system`.** Any base-property path also requires context from
> [`01-tokens.md`](01-tokens.md) and [`02-css-architecture.md`](02-css-architecture.md).
> New UI controls follow [`03-components.md`](03-components.md). Pre-close verification
> follows [`09-mcp-verification.md`](09-mcp-verification.md).

# Brand Editor — Full-Chain Implementation Guide

Use this skill when adding, modifying, or removing anything in the brand editor system.
The system has **6 distinct paths** depending on what you're changing, each touching different
files. Missing any one touchpoint breaks the chain silently.

---

## 0. Before You Start — Read These

Read the files relevant to the change you're making. Do not assume field names, JSON shapes,
or CSS variable prefixes from memory — read the source of truth.

```
# Core brand editor
apps/web/src/lib/brand-editor/types.ts                  — BrandEditorState, LevelId, CssVarMapping
apps/web/src/lib/brand-editor/css-injection.ts           — BRAND_PREFIX_KEYS, CSS_VAR_MAPPINGS, inject fns
apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts — Module-level $state, $effect CSS injection
apps/web/src/lib/brand-editor/levels.ts                  — LEVELS registry, HOME_CATEGORIES

# CSS architecture
apps/web/src/lib/theme/tokens/org-brand.css              — [data-org-brand] OKLCH derivation rules
apps/web/src/lib/styles/tokens/                          — 13 token definition files (:root)
apps/web/src/lib/styles/themes/light.css                 — Light theme semantic mappings
apps/web/src/lib/styles/themes/dark.css                  — Dark theme overrides

# Layout + hero rendering
apps/web/src/routes/_org/[slug]/+layout.svelte           — .org-layout: data attrs, style bindings, hero flags
apps/web/src/routes/_org/[slug]/+layout.server.ts        — Server load: org branding → data.org
apps/web/src/routes/_org/[slug]/(space)/+page.svelte     — Hero markup + ALL hero layout CSS (lines 960-1290)

# Backend chain
workers/organization-api/src/routes/organizations.ts     — Public org info adapter (DB → API shape)
packages/database/src/schema/settings.ts                 — branding_settings table
packages/validation/src/schemas/settings.ts              — updateBrandingSchema, DEFAULT_BRANDING
packages/platform-settings/src/.../branding-settings-service.ts — fieldMap, mapRow, upsert
packages/shared-types/src/api-responses.ts               — BrandingSettingsResponse, PublicBrandingResponse
apps/web/src/lib/remote/branding.remote.ts               — updateBrandingCommand schema + handler

# UI components
apps/web/src/lib/components/brand-editor/levels/         — All editor level panels
```

---

## 1. Architecture Overview

### The Four-Layer CSS Cascade

```
Layer 1: Token Foundation (:root)              — 13 files in styles/tokens/
    ↓ overridden by
Layer 2: Theme (light.css/dark.css)            — [data-theme="light|dark"]
    ↓ overridden by
Layer 3: Org Branding (org-brand.css)          — [data-org-brand] OKLCH derivation
    ↓ overridden by
Layer 4: Inline JS injection                   — el.style.setProperty() via layout + editor
```

### The Hero System

The hero is a **multi-layer composition**:

```
Fixed canvas:  ShaderHero WebGL (z-index: 0, rendered in +layout.svelte)
Hero content:  .hero section (z-index: 3, rendered in (space)/+page.svelte)
  ├── .hero__title       — outside .hero__content for mix-blend-mode reach
  ├── .hero__play-center — absolute centered play button (desktop)
  └── .hero__content     — flex column
      ├── .hero__logo-wrap
      ├── .hero__description
      ├── .hero__pills     — content type + category badges
      ├── .hero__actions   — CTA buttons (primary + glass variants)
      └── .hero__stats     — big numbers row
```

**Key design principle:** Layouts control POSITIONING only (flex alignment, padding, font-size).
Visibility is controlled SEPARATELY via `data-hero-hide-*` attributes. These are independent
systems — a layout never hides elements, and a visibility flag never moves them.

### Data Attribute System on `.org-layout`

The layout component sets these attributes that drive all CSS:

```svelte
<div class="org-layout"
  data-org-brand={hasBranding ? '' : undefined}
  data-org-bg={brandBackground ? '' : undefined}
  data-hero-layout="centered"
  data-hero-hide-stats
  data-hero-hide-pills
  data-hero-hide-description
  data-hero-hide-logo
  data-hero-hide-title
  style:--brand-color={...}
  style:--brand-secondary={...}
  ...
>
```

### Data Flow: Save + Load

```
Save: UI → store.$state.pending → $effect → injectBrandVars() [live preview]
      User clicks Save → handleSave() → updateBrandingCommand() [remote]
      → org-api PUT /settings/branding → BrandingSettingsService.update() [upsert]
      → DB branding_settings → waitUntil: invalidateBrandAndCache()

Load: Browser → +layout.server.ts → api.org.getPublicInfo(slug) [KV cached]
      → org-api fetchPublicOrgInfo() → BrandingSettingsService.get()
      → +layout.svelte derives brandPrimary, heroHideFlags, etc.
      → Inline style:--brand-* bindings on .org-layout
      → $effect calls injectTokenOverrides(el, parsedJSON) for fine-tune tokens
      → org-brand.css [data-org-brand] rules activate → OKLCH palette derived
      → Components read var(--color-*) — no component changes needed
```

---

## 2. Decision: Which Path?

```
What are you adding/changing?
│
├── New DB column (color, font, scale, etc.)
│   → Path A: Base Property (11 touchpoints)
│
├── New fine-tune slider/picker stored in tokenOverrides JSON
│   → Path B: Token Override (3 touchpoints)
│
├── New panel in the brand editor navigation
│   → Path C: New Editor Level (4 touchpoints)
│
├── New hero layout variant (positioning arrangement)
│   → Path D: New Hero Layout (5 touchpoints)
│
├── New hero element visibility toggle
│   → Path E: New Visibility Flag (5 touchpoints)
│
└── New hero element (new markup in the hero section)
    → Path F: New Hero Element (3-5 touchpoints)
```

**Heuristic:**
- Needs own DB column for querying/indexing → Path A
- Fine-tune slider, consumed via CSS var() → Path B
- Needs its own navigation panel → Path C (combine with A or B)
- New way to arrange hero elements → Path D
- Show/hide an existing hero element → Path E
- Entirely new DOM element in the hero → Path F

---

## 3. Path A — Adding a Base Property

Full chain: 11+ files. Each step depends on the previous.

### A1. Database Schema

**File:** `packages/database/src/schema/settings.ts` — `brandingSettings` table (~line 39)

```typescript
letterSpacing: varchar('letter_spacing', { length: 10 }).default('0'),
```

Then: `pnpm db:generate` — NEVER hand-write migration SQL.

### A2. Shared Types

**File:** `packages/shared-types/src/api-responses.ts`

Add to `BrandingSettingsResponse` (~line 188):
```typescript
letterSpacing: string | null;
```

If public (needed on unauthenticated org pages), also add to `PublicBrandingResponse` (~line 270).

### A3. Validation Schema

**File:** `packages/validation/src/schemas/settings.ts`

Add to `updateBrandingSchema` (~line 112):
```typescript
letterSpacing: z.string().max(10).nullable().optional(),
```

Add default to `DEFAULT_BRANDING` if applicable.

### A4. Service Layer

**File:** `packages/platform-settings/src/services/branding-settings-service.ts`

Add to `fieldMap` (~line 165):
```typescript
letterSpacing: 'letterSpacing',
```

Add to `mapRow()` input type + return object (~line 107).

### A5. API Adapter

**File:** `workers/organization-api/src/routes/organizations.ts`

In `fetchPublicOrgInfo()` (~line 303), add to the response. Decide placement:
- Top-level → for SSR inline style binding (e.g., `brandLetterSpacing: branding.letterSpacing`)
- Inside `brandFineTune` → for client-side token override injection

### A6. Frontend Types

**File:** `apps/web/src/lib/brand-editor/types.ts`

Add to `BrandEditorState` (~line 23). If saved separately from tokenOverrides, also add to
`BrandEditorPayload` (~line 42).

### A7. CSS Injection

**File:** `apps/web/src/lib/brand-editor/css-injection.ts`

Add to `CSS_VAR_MAPPINGS` (~line 323):
```typescript
{ property: '--brand-letter-spacing', getValue: (s) => s.letterSpacing != null ? `${s.letterSpacing}em` : undefined },
```

If dark mode variant, add to `DARK_VAR_PROPS` (~line 362).

### A8. CSS Derivation

**File:** `apps/web/src/lib/theme/tokens/org-brand.css`

Add rule inside `[data-org-brand]`:
```css
--tracking-normal: var(--brand-letter-spacing, 0em);
```

### A9. Layout Server

**File:** `apps/web/src/routes/_org/[slug]/+layout.server.ts`

Verify `data.org` return type includes your field (~line 49 type annotation).

### A10. Layout Component

**Files:** `apps/web/src/routes/_org/[slug]/+layout.svelte` **AND** `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte`

The editor state reconstruction + save path were hoisted out of the layout into `BrandEditorMount.svelte` for bundle-split perf. So this step touches **two files**:

**`+layout.svelte`** (DOM bindings only):
1. Derive: `const brandLetterSpacing = $derived(data.org?.brandLetterSpacing ?? null);`
2. Bind: `style:--brand-letter-spacing={brandLetterSpacing}` on `.org-layout`

**`BrandEditorMount.svelte`** (state + save):
3. Reconstruct: Add to the `BrandEditorState` object in the editor-open `$effect` (~line 38)
4. Save: Add to `handleSave()` → `updateBrandingCommand()` call (~line 47-68). Be careful: the current shape double-writes top-level fields *and* stuffs the same data into `tokenOverrides` JSON — follow the existing field's pattern rather than inventing a new one. (Tracked cleanup: `Codex-2nl7`.)

### A11. Remote Function

**File:** `apps/web/src/lib/remote/branding.remote.ts`

Add to `updateBrandingCommandSchema` (~line 158) and pass through in command handler (~line 213).

### A12. UI Component

Create or modify a level component in `apps/web/src/lib/components/brand-editor/levels/`.

---

## 4. Path B — Adding a Token Override

**3 touchpoints.** No database migration, no validation changes, no service changes.

### B1. CSS Injection — Prefix Decision

**File:** `apps/web/src/lib/brand-editor/css-injection.ts`
**Set:** `BRAND_PREFIX_KEYS` (~line 23)

Decide prefix:
- Add to `BRAND_PREFIX_KEYS` → becomes `--brand-{key}` (consumed by org-brand.css or getComputedStyle)
- Don't add → becomes `--color-{key}` (directly replaces a design token)

**Prefix rules:**
| Type | Prefix | Example |
|------|--------|---------|
| Shader parameters | `--brand-` | `shader-intensity` → `--brand-shader-intensity` |
| UI scale/weight values | `--brand-` | `text-scale` → `--brand-text-scale` |
| Hero text/color tokens | `--brand-` | `hero-text` → `--brand-hero-text` |
| Hero visibility flags | `--brand-` | `hero-hide-stats` → `--brand-hero-hide-stats` |
| Direct color replacement | `--color-` | `interactive` → `--color-interactive` |
| Surface/border overrides | `--color-` | `surface-card` → `--color-surface-card` |

### B2. CSS Derivation Rule

**File:** `apps/web/src/lib/theme/tokens/org-brand.css`

```css
[data-org-brand] {
  --material-glass-opacity: var(--brand-glass-opacity, 0.7);
}
```

The `var(--brand-glass-opacity, 0.7)` fallback ensures default works without the override.

### B3. UI Component

Add slider/picker to an existing fine-tune panel or create new one. Pattern:

```svelte
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  const key = 'glass-opacity';
  const value = $derived(parseFloat(brandEditor.pending?.tokenOverrides?.[key] ?? '0.7'));

  function handleChange(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    const newOverrides = { ...brandEditor.pending?.tokenOverrides };
    if (val === '0.7') delete newOverrides[key]; // Reset to default = remove key
    else newOverrides[key] = val;
    brandEditor.updateField('tokenOverrides', newOverrides);
  }
</script>
```

**That's it.** Save/load is automatic via the `tokenOverrides` JSON column.

---

## 5. Path C — Adding a New Editor Level

### C1. Type System

**File:** `apps/web/src/lib/brand-editor/types.ts` — add to `LevelId` union (~line 64)

### C2. Level Registry

**File:** `apps/web/src/lib/brand-editor/levels.ts` — add to `LEVELS` record + `HOME_CATEGORIES`

```typescript
'glass-effects': {
  id: 'glass-effects',
  depth: 1,                // 1 = category, 2 = sub-panel
  label: 'Glass Effects',
  parent: 'home',
  icon: '◇',
  description: 'Glassmorphism and blur',
},
```

### C3. Create Component

`apps/web/src/lib/components/brand-editor/levels/BrandEditorGlassEffects.svelte`

Follow existing level component patterns.

### C4. Wire in the Mount component

**File:** `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte` — add a render branch in the level-router block (~lines 95-119):

```svelte
{:else if brandEditor.level === 'glass-effects'}
  <BrandEditorGlassEffects />
```

> **Note:** The render tree was hoisted out of `+layout.svelte` into `BrandEditorMount.svelte` (see
> iter-004 findings). The layout file now contains only `<BrandEditorMount />` at ~line 425-427.
> Adding a render branch to the layout file is a no-op; the skill caught this drift at iter-04.

---

## 6. Path D — Adding a New Hero Layout Variant

**Example:** Adding a `cinematic` layout with letterboxed content.

### D1. Validation — Layout Enum

**File:** `packages/validation/src/schemas/settings.ts` — `updateBrandingSchema` (~line 130)

Add to the `heroLayout` enum:
```typescript
heroLayout: z.enum([
  'default', 'centered', 'logo-hero', 'minimal', 'split',
  'magazine', 'asymmetric', 'portrait', 'gallery', 'stacked',
  'cinematic',  // NEW
]).optional(),
```

### D2. Remote Function Enum

**File:** `apps/web/src/lib/remote/branding.remote.ts` — `updateBrandingCommandSchema` (~line 191)

Add to the `heroLayout` enum (must match validation):
```typescript
heroLayout: z.enum([
  'default', 'centered', 'logo-hero', 'minimal', 'split',
  'magazine', 'asymmetric', 'portrait', 'gallery', 'stacked',
  'cinematic',  // NEW
]).optional(),
```

### D2b. BrandEditorMount inline enum (third copy — until consolidated)

**File:** `apps/web/src/lib/components/brand-editor/BrandEditorMount.svelte:65-67`

There is a **third** copy of the `heroLayout` enum as an inline literal union cast in the save payload's type annotation:
```typescript
heroLayout: overrides.heroLayout as 'default' | 'centered' | 'logo-hero' | 'minimal' | 'split'
  | 'magazine' | 'asymmetric' | 'portrait' | 'gallery' | 'stacked' | 'cinematic'  // NEW
```

> **Goal state:** consolidate all three copies into a single `export const HERO_LAYOUTS` in
> `packages/validation/src/schemas/settings.ts`, import into the Zod schema, the remote schema,
> and the inline cast. Tracked: `Codex-a4zc`. Until that lands, every Path D change touches
> *three* files, not two.

### D3. Brand Editor UI

**File:** `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeaderLayout.svelte`

Add to `LAYOUTS` array (~line 11):
```typescript
{ id: 'cinematic', label: 'Cinematic', description: 'Letterboxed widescreen' },
```

### D4. Hero Layout CSS

**File:** `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` (~line 960-1253)

Add CSS rules using the `:global([data-hero-layout="cinematic"])` selector pattern:

```css
/* ── Cinematic ── letterboxed, horizontally centered */
:global([data-hero-layout="cinematic"]) .hero {
  justify-content: center;
  align-items: center;
  padding-top: 15vh;
  padding-bottom: 15vh;
}

:global([data-hero-layout="cinematic"]) .hero__title {
  text-align: center;
  font-size: clamp(3rem, 6vw, 7rem);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

:global([data-hero-layout="cinematic"]) .hero__content {
  align-items: center;
  text-align: center;
}

:global([data-hero-layout="cinematic"]) .hero__pills,
:global([data-hero-layout="cinematic"]) .hero__actions,
:global([data-hero-layout="cinematic"]) .hero__stats {
  justify-content: center;
}
```

**Critical rules for layout CSS:**
- ONLY change positioning (flex, alignment, padding, font-size, text-align)
- NEVER hide elements — that's visibility flags
- ALWAYS use `:global([data-hero-layout="..."])` prefix (attribute is on `.org-layout` ancestor)
- Use `var()` tokens for all values — never hardcode px/hex
- Add mobile overrides in the `@media (--below-md)` block (~line 1189)

### D5. Mobile Responsive Override

Add in the existing `@media (--below-md)` block (~line 1189):
```css
@media (--below-md) {
  :global([data-hero-layout="cinematic"]) .hero {
    padding-top: 5vh;
    padding-bottom: 5vh;
  }
  :global([data-hero-layout="cinematic"]) .hero__actions {
    flex-direction: column;
    width: 100%;
  }
}
```

### Layout CSS Patterns Reference

Each layout variant modifies these CSS properties on hero elements:

| Element | Properties Modified | Used By |
|---------|-------------------|---------|
| `.hero` | `justify-content`, `align-items` | centered, logo-hero, minimal, asymmetric, gallery |
| `.hero__title` | `text-align`, `font-size`, `word-spacing`, `line-height`, `padding-left/right`, `margin-top` | all except default |
| `.hero__content` | `align-items`, `text-align`, `padding-right/left`, `position`, `flex-direction`, `flex-wrap` | centered, logo-hero, minimal, split, portrait, gallery |
| `.hero__logo` | `--_logo-base` (private prop) | logo-hero (sets to `var(--space-48)`) |
| `.hero__pills` | `justify-content` | centered, logo-hero, minimal, portrait |
| `.hero__actions` | `justify-content` | centered, logo-hero, minimal, portrait |
| `.hero__stats` | `justify-content`, `position`, `flex-direction`, `text-align`, `border-*`, `padding-*` | centered, logo-hero, minimal, magazine, portrait, gallery |
| `.hero__description` | `font-variant-caps`, `letter-spacing`, `font-size`, `margin-*`, `max-width` | magazine, centered, logo-hero |

---

## 7. Path E — Adding a New Visibility Flag

**Example:** Adding a `hero-hide-actions` toggle to hide CTAs.

### E1. Brand Editor UI — Toggle Definition

**File:** `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeaderLayout.svelte`

Add to `VISIBILITY_TOGGLES` array (~line 29):
```typescript
{ key: 'hero-hide-actions', label: 'Call-to-action buttons' },
```

The existing `toggleElement()` and `isElementVisible()` functions handle it automatically
(they're generic over any `hero-hide-*` key).

### E2. Layout — Parse Flag

**File:** `apps/web/src/routes/_org/[slug]/+layout.svelte`

Add to `heroHideFlags` derived (~line 91):
```typescript
return {
  stats: overrides['hero-hide-stats'] === '1',
  pills: overrides['hero-hide-pills'] === '1',
  description: overrides['hero-hide-description'] === '1',
  logo: overrides['hero-hide-logo'] === '1',
  title: overrides['hero-hide-title'] === '1',
  actions: overrides['hero-hide-actions'] === '1',  // NEW
};
```

### E3. Layout — Set Data Attribute

Same file, on `.org-layout` div (~line 411):
```svelte
data-hero-hide-actions={heroHideFlags.actions ? '' : undefined}
```

### E4. CSS Injection — Prefix

**File:** `apps/web/src/lib/brand-editor/css-injection.ts`

The key `hero-hide-actions` doesn't strictly NEED to be in `BRAND_PREFIX_KEYS` because it's
consumed via data attributes, not CSS variables. But it IS in the tokenOverrides JSON which
gets injected as `--brand-hero-hide-actions`. For consistency with existing flags, you can
add it — it won't hurt.

### E5. Hero CSS — Visibility Rule

**File:** `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` (~line 1255-1290)

Add alongside existing visibility rules:
```css
:global([data-hero-hide-actions]) .hero__actions {
  display: none;
}
```

**Title is special:** It uses `sr-only` positioning instead of `display: none` so screen
readers and SEO still see it. All other flags use `display: none`.

### Visibility Flag Architecture

```
tokenOverrides JSON: { "hero-hide-stats": "1" }
    ↓ parsed in +layout.svelte heroHideFlags derived
heroHideFlags.stats === true
    ↓ bound as data attribute
<div class="org-layout" data-hero-hide-stats>
    ↓ CSS selector in (space)/+page.svelte
:global([data-hero-hide-stats]) .hero__stats { display: none; }
```

Convention: `'1'` = hidden, missing/null = visible.

---

## 8. Path F — Adding a New Hero Element

**Example:** Adding a `.hero__tagline` secondary text below the title.

### F1. Hero Markup

**File:** `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`

Add the element within the hero structure (~line 180-270). Consider placement:
- Outside `.hero__content` → for mix-blend-mode effects (like `.hero__title`)
- Inside `.hero__content` → for standard flex layout participation

```svelte
{#if orgTagline}
  <p class="hero__tagline">{orgTagline}</p>
{/if}
```

### F2. Base CSS

Same file's `<style>` block. Follow token conventions:

```css
.hero__tagline {
  font-size: var(--text-lg);
  color: color-mix(in srgb, var(--brand-hero-text, white) 70%, transparent);
  font-style: italic;
  max-width: 50ch;
  line-height: var(--leading-relaxed);
}
```

### F3. Layout Variant Overrides

Add rules for each layout that needs different positioning:

```css
:global([data-hero-layout="centered"]) .hero__tagline {
  text-align: center;
  margin-left: auto;
  margin-right: auto;
}

:global([data-hero-layout="portrait"]) .hero__tagline {
  text-align: right;
  padding-left: 55%;
}
```

### F4. Visibility Toggle (Optional)

If the element should be toggleable, follow Path E to add a `hero-hide-tagline` flag.

### F5. Color Token (Optional)

If the element needs a customizable color, follow Path B to add a `hero-tagline-color` token
override, then reference it: `color: var(--brand-hero-tagline-color, var(--brand-hero-text, white))`.

---

## 9. Hero Layout Reference

### All 10 Current Layouts

| ID | Label | Key CSS Difference |
|---|---|---|
| `default` | Classic | Bottom-left. `justify-content: flex-end` (base) |
| `centered` | Centered | All centered: `justify-content: center; align-items: center` |
| `logo-hero` | Logo Hero | Centered + `--_logo-base: var(--space-48)` (4x logo) |
| `minimal` | Minimal | Massive title `clamp(4rem, 10vw, 10rem)` + content `position: absolute; bottom: 0` |
| `split` | Split | `padding-right: 50%` on title + content (right half = canvas) |
| `magazine` | Magazine | Stats `position: absolute; top; right; flex-direction: column` (vertical masthead) |
| `asymmetric` | Asymmetric | `justify-content: space-between` + title `text-align: right` |
| `portrait` | Portrait | Title + content `padding-left: 55%; text-align: right` |
| `gallery` | Gallery | Title `clamp(4rem, 10vw, 9rem)` centered + content `flex-direction: row; flex-wrap: wrap` |
| `stacked` | Stacked | Title `word-spacing: 100vw; line-height: 0.9` (Swiss poster) |

### All 5 Current Visibility Flags

| Key | Element | CSS Effect |
|---|---|---|
| `hero-hide-title` | `.hero__title` | `sr-only` (keeps SEO) |
| `hero-hide-logo` | `.hero__logo-wrap` | `display: none` |
| `hero-hide-description` | `.hero__description` | `display: none` |
| `hero-hide-pills` | `.hero__pills` | `display: none` |
| `hero-hide-stats` | `.hero__stats` | `display: none` |

### All Hero CSS Custom Properties

| Variable | Source | Default | Used By |
|---|---|---|---|
| `--brand-hero-text` | Fine-tune colors | `white` | description, pills, stat numbers |
| `--brand-hero-text-muted` | Fine-tune colors | `white` (75% opacity) | stat labels, category pills |
| `--brand-hero-title-color` | Fine-tune colors | `white` | `.hero__title` |
| `--brand-hero-title-blend` | Fine-tune colors | `difference` | `.hero__title` mix-blend-mode |
| `--brand-hero-cta-bg` | Fine-tune colors | `white` | Primary CTA background |
| `--brand-hero-cta-text` | Fine-tune colors | brand primary + black | Primary CTA text |
| `--brand-hero-glass-tint` | Fine-tune colors | `white` | Glass CTA tint (12-25% opacity) |
| `--brand-hero-glass-text` | Fine-tune colors | `white` | Glass CTA text |
| `--brand-hero-border-tint` | Fine-tune colors | `white` | Pill borders, stat separator |
| `--brand-hero-logo-scale` | Header layout slider | `1` | Logo height multiplier |

---

## 10. Common Gotchas

### Token override doesn't appear after save
- **Check:** Is the key in `BRAND_PREFIX_KEYS`? Wrong prefix = CSS rule won't match.
- **Check:** Does `org-brand.css` have a rule reading `var(--brand-{key})`?

### Base property doesn't persist
- **Check:** Is it in `fieldMap` in `branding-settings-service.ts`?
- **Check:** Is it in `updateBrandingSchema` in validation?
- **Check:** Is it passed through in `updateBrandingCommand` remote function?

### Value doesn't show on page load (only in editor)
- **Check:** Is it in `fetchPublicOrgInfo()` response in `organizations.ts`?
- **Check:** Is the layout binding `style:--brand-*` for base properties?
- **Check:** Is `injectTokenOverrides()` being called in the layout `$effect` (~line 133)?

### New hero layout doesn't change anything
- **Check:** CSS uses `:global([data-hero-layout="..."])` prefix? (attribute is on `.org-layout`, not `.hero`)
- **Check:** Added the layout ID to BOTH validation enums (settings.ts AND branding.remote.ts)?
- **Check:** Added to `LAYOUTS` array in `BrandEditorHeaderLayout.svelte`?

### Visibility flag doesn't hide element
- **Check:** Flag parsed in `heroHideFlags` derived in `+layout.svelte`?
- **Check:** Data attribute set on `.org-layout`? (`data-hero-hide-{element}`)
- **Check:** CSS rule uses `:global([data-hero-hide-{element}])` selector?
- **Check:** Convention: `'1'` = hidden, not `'true'` or `true`.

### Brand editor preview works but server-rendered page doesn't
- Editor uses `injectBrandVars()` (full state). Server render uses inline `style:--brand-*`
  (base properties) + `injectTokenOverrides()` (token overrides from JSON). Both paths must
  cover your property.

### Hero title blend-mode not compositing with shader
- `.hero__title` must be OUTSIDE `.hero__content` — it needs no z-index isolation context
  so `mix-blend-mode: difference` can reach through to the ShaderHero canvas.

### Layout looks wrong on mobile
- Every layout variant needs mobile overrides in `@media (--below-md)` block (~line 1189).
  Split and portrait layouts must collapse `padding-right/left` to normal spacing.

---

## 11. Checklists

### Base Property

```
[ ] packages/database/src/schema/settings.ts — add column
[ ] pnpm db:generate — create migration
[ ] packages/shared-types/src/api-responses.ts — BrandingSettingsResponse (+ PublicBrandingResponse if public)
[ ] packages/validation/src/schemas/settings.ts — updateBrandingSchema + DEFAULT_BRANDING
[ ] packages/platform-settings/.../branding-settings-service.ts — fieldMap + mapRow
[ ] workers/organization-api/src/routes/organizations.ts — fetchPublicOrgInfo response shape
[ ] apps/web/src/lib/brand-editor/types.ts — BrandEditorState (+ BrandEditorPayload if needed)
[ ] apps/web/src/lib/brand-editor/css-injection.ts — CSS_VAR_MAPPINGS (+ DARK_VAR_PROPS if dark)
[ ] apps/web/src/lib/theme/tokens/org-brand.css — [data-org-brand] derivation rule
[ ] apps/web/src/routes/_org/[slug]/+layout.server.ts — verify data.org shape
[ ] apps/web/src/routes/_org/[slug]/+layout.svelte — derive + bind + reconstruct + save
[ ] apps/web/src/lib/remote/branding.remote.ts — command schema + handler
[ ] UI component — editor control
[ ] pnpm typecheck
```

### Token Override

```
[ ] apps/web/src/lib/brand-editor/css-injection.ts — BRAND_PREFIX_KEYS (if --brand-)
[ ] apps/web/src/lib/theme/tokens/org-brand.css — CSS rule with var() + fallback
[ ] UI component — slider/picker in fine-tune panel
[ ] Verify: save → reload → value persists
```

### New Hero Layout

```
[ ] packages/validation/src/schemas/settings.ts — heroLayout enum
[ ] apps/web/src/lib/remote/branding.remote.ts — heroLayout enum (must match)
[ ] apps/web/src/lib/components/brand-editor/levels/BrandEditorHeaderLayout.svelte — LAYOUTS array
[ ] apps/web/src/routes/_org/[slug]/(space)/+page.svelte — layout CSS rules (~line 960)
[ ] Same file — mobile override in @media (--below-md) block (~line 1189)
```

### New Visibility Flag

```
[ ] apps/web/.../BrandEditorHeaderLayout.svelte — VISIBILITY_TOGGLES array
[ ] apps/web/src/routes/_org/[slug]/+layout.svelte — heroHideFlags derived + data attribute
[ ] apps/web/src/routes/_org/[slug]/(space)/+page.svelte — :global([data-hero-hide-*]) CSS rule
[ ] (Optional) css-injection.ts — add to BRAND_PREFIX_KEYS for consistency
```

### New Editor Level

```
[ ] apps/web/src/lib/brand-editor/types.ts — LevelId union
[ ] apps/web/src/lib/brand-editor/levels.ts — LEVELS record + HOME_CATEGORIES
[ ] Create component in apps/web/src/lib/components/brand-editor/levels/
[ ] apps/web/src/routes/_org/[slug]/+layout.svelte — render branch
```

---

## 12. File Reference Matrix

| Touchpoint | Path A | Path B | Path C | Path D | Path E | Path F |
|---|---|---|---|---|---|---|
| `database/schema/settings.ts` | ADD column | - | - | - | - | - |
| `shared-types/api-responses.ts` | ADD field | - | - | - | - | - |
| `validation/schemas/settings.ts` | ADD schema | - | - | ADD enum | - | - |
| `platform-settings/branding-settings-service.ts` | ADD fieldMap+mapRow | - | - | - | - | - |
| `org-api/routes/organizations.ts` | ADD response | - | - | - | - | - |
| `brand-editor/types.ts` | ADD State | - | ADD LevelId | - | - | - |
| `brand-editor/css-injection.ts` | ADD mapping | ADD prefix | - | - | optional | optional |
| `brand-editor/levels.ts` | - | - | ADD level | - | - | - |
| `theme/tokens/org-brand.css` | ADD rule | ADD rule | - | - | - | - |
| `_org/[slug]/+layout.server.ts` | verify | - | - | - | - | - |
| `_org/[slug]/+layout.svelte` | derive+bind+save | - | ADD branch | - | ADD flag+attr | - |
| `remote/branding.remote.ts` | ADD schema | - | - | ADD enum | - | - |
| `(space)/+page.svelte` | - | - | - | ADD CSS | ADD CSS | ADD markup+CSS |
| `brand-editor/levels/*.svelte` | ADD control | ADD control | CREATE | ADD option | ADD toggle | - |

---

## 13. Anti-Patterns

Three recurring mis-applications surfaced by iter-019 through iter-025. The first is promoted to hard rule R15 (see SKILL.md §2); the other two are reference-level — graduate to hard rules only on 3+ recurrence per §7.

### 13.1. SVG upload without `sanitizeSvgContent()` — R15

**Rule**: Any upload handler that accepts `image/svg+xml` MUST sanitise before R2 write. Worker-level MIME validation is a string check only — it does not inspect bytes or strip `<script>` / `onload=` / external `xlink:href`.

**✗ Broken pattern** (the shape of `Codex-06ygy` before the fix):

```ts
// workers/foo-api/src/routes/upload-logo.ts
const bytes = await file.arrayBuffer();
await r2.put(key, bytes);   // ← NO sanitisation; MIME says SVG; stored XSS ships
```

**✓ Three acceptable forms**:

```ts
// (a) Direct — when you already have bytes and don't need image-processing
import { sanitizeSvgContent } from '@codex/validation';
const clean = await sanitizeSvgContent(bytes);
await r2.put(key, clean);

// (b) Delegate — preferred when the upload is "an image" (ImageProcessingService
//     dispatches on MIME and sanitises SVGs internally)
await imageProcessingService.upload(bytes, { mimeType, key });

// (c) Validator with sanitisation flag — when you want validation + sanitisation
//     in one step at the boundary
import { validateImageUpload } from '@codex/validation';
const result = await validateImageUpload(bytes, { sanitizeSvg: true });
```

**Canonical fix**: commit `cbd7dbf8` (logo upload) — routed through `ImageProcessingService` which handles SVG sanitisation in its `processImage` branch.

**Reference consumer**: `packages/image-processing/src/service.ts:360-366`.

**Why this is an asymmetric rule**: the other hard rules (R12/R13/R14) earned promotion via 3+ recurrences. R15 earned it via one incident because the failure mode is a stored XSS — shipping the second violation is shipping a second vulnerability, not a second maintenance wart. Don't wait for the third.

**Audit path** (do this BEFORE adding a new upload endpoint):

1. Does `allowedMimeTypes` include `image/svg+xml` (directly or via `image/*` wildcard)?
2. If yes, trace the bytes from `file.arrayBuffer()` to the R2 `put()` call.
3. Every branch in that trace MUST pass through one of (a)/(b)/(c) above. JSDoc claiming "upstream validates" is not sufficient — read the validator source.

---

### 13.2. Partial Record update — merge, don't replace

When a preset, template, or partial config is applied on top of user-configured state stored as `Record<string, unknown>`, **always** merge with spread:

**✗ Broken pattern** (the shape of `Codex-oqv3r` before the fix):

```ts
// Applying a preset wipes every user-tuned key the preset doesn't mention
state.tokens = { ...incoming };
```

**✓ Correct pattern**:

```ts
// Preset author intent wins on conflicts; user fine-tunes on untouched keys survive
state.tokens = { ...existing, ...incoming };
```

**Rule**: Wholesale replacement is only correct when `incoming` is guaranteed to express the **entire** valid state (e.g. a form submission that includes every field). If `incoming` is a `Partial<T>`, a preset, a theme template, or anything assembled from a subset of keys, the merge pattern is the default. Presets browsing, template applications, and feature-flag overrides are all subset sources.

**Canonical fix**: commit `f69d5534` (`applyPreset` in brand editor preset handling).

**Generalises beyond the brand editor**. Candidates to audit:
- User preferences merged with org defaults
- Campaign overrides applied to global content
- Feature flag overrides
- Any `Partial<T>` merge into a concrete `T`

**Promotion criteria**: currently 1 occurrence. Graduate to hard rule R-next on the 3rd recurrence per SKILL.md §7.

---

### 13.3. Every `--brand-*` READ needs a WRITE in `+layout.svelte`

**Observation**: `Codex-lqvyy` happened because four `--brand-*` custom properties were declared as **READ** in `org-brand.css` but never set as **WRITE** in `+layout.svelte` for non-editor visitors. The editor's `injectBrandVars()` path covered them for editor sessions; the SSR layout path did not. Editor users saw correct values; regular visitors got the CSS-var default (often `unset` or a wrong fallback) — silently.

**Rule of thumb**: Every `--brand-*` custom property that is READ by `org-brand.css` (or any stylesheet in `lib/theme/tokens/`) MUST have a corresponding WRITE binding in `+layout.svelte` — either `style:--brand-X={value}` for SSR-rendered values, or via a server-rendered inline `<style>` block.

**Why this is non-obvious**: the editor preview path (`injectBrandVars` + `injectTokenOverrides`) is browser-only. The SSR layout is the authoritative source for non-editor visitors. If a token's *only* writer is `injectBrandVars`, non-editor visitors silently fall back to the CSS var's default — which is often wrong.

**Checklist — when adding a new `--brand-X` token**:

```
[ ] Declare it as READ in org-brand.css (gated by [data-org-brand])
[ ] Add it to DARK_VAR_PROPS in css-injection.ts if per-theme
[ ] Add style:--brand-X={...} binding to .org-layout in +layout.svelte
[ ] Verify in TWO scenarios:
      (1) Editor preview  — injectBrandVars path
      (2) Non-editor reload — SSR layout binding
    Editor-preview working is NOT sufficient. The second scenario is the
    regression-prone one.
```

**Canonical fix**: commit `af423e86` (`Codex-lqvyy`). Patch spec at `docs/brand-editor-investigation/lqvyy-patch.md`.

**Cross-ref**: `01-tokens.md` §9 "Gotchas / Anti-patterns" carries a pointer back to this rule, so changes to the token-add workflow surface it regardless of which reference the agent reads first.

