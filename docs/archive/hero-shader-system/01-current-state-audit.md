# 01 — Current State Audit

**Purpose**: Document exactly what exists today — every file, every data field, every CSS token — so the shader system integrates cleanly with zero regressions.

---

## 1. Hero Section

### File: `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`

**Lines 52-76**: The `<section class="hero">` renders:

```svelte
<section class="hero">
  <div class="hero__inner">
    {#if logoUrl}
      <img src={logoUrl} alt="{orgName} logo" class="hero__logo" loading="eager" />
    {/if}
    <h1 class="hero__title">{orgName}</h1>
    {#if orgDescription}
      <p class="hero__description">{orgDescription}</p>
    {/if}
    <div class="hero__actions">
      <a href="/explore" class="hero__cta">{m.org_hero_explore()}</a>
      <a href="/creators" class="hero__cta hero__cta--secondary">{m.org_creators_preview_view_all()}</a>
    </div>
  </div>
</section>
```

### CSS (Lines 222-438)

```css
.hero {
  position: relative;
  padding: var(--space-20) var(--space-6);
  background: linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary));
  color: var(--color-text-on-brand);
  text-align: center;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, white 15%, transparent) 0%, transparent 70%);
  pointer-events: none;
}
```

Key tokens consumed:
- `--color-brand-primary`, `--color-brand-secondary` (gradient)
- `--color-text-on-brand` (auto-contrasting text color from OKLCH)
- `--space-20`, `--space-6` (padding)
- `--shadow-lg` (logo shadow)
- `--radius-full` (logo border-radius)
- `--radius-button`, `--radius-lg` (CTA border-radius)
- `--text-4xl`, `--text-lg`, `--text-base` (font sizes)
- `--font-bold`, `--font-semibold` (font weights)
- `--tracking-tight` (letter spacing)
- `--border-width-thick` (CTA border)
- `--duration-normal`, `--duration-fast`, `--ease-default` (transitions)

Mobile breakpoint `@media (--below-sm)`:
- Padding: `--space-10` / `--space-4`
- Title: `--text-2xl`
- Logo: `--space-20` × `--space-20`
- CTAs: stack vertically, full width

### What the Hero Does NOT Do

- No animation of any kind
- No scroll-linked effects
- No mouse/touch interactivity
- No social links (data exists but not rendered)
- No creator avatars (streamed but displayed below hero only)
- No stats (content count, creator count)
- No dynamic CTA text (hardcoded Explore / Browse Creators)

---

## 2. Server Load

### File: `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts`

**Data fetched**:

| Promise | Source | Await/Stream | Used In Hero? |
|---------|--------|-------------|---------------|
| `contentPromise` | `getPublicContent({ orgId, limit: 6, sort: 'newest' })` | Awaited | No (used in "New Releases" section below) |
| `creatorsPromise` | `getPublicCreators({ slug, limit: 3 })` | Streamed | No (used in "Creators Preview" section below) |
| `continueWatchingPromise` | `api.access.getUserLibrary({ filter: 'in_progress' })` | Streamed (auth only) | No |

**Cache headers**: `CACHE_HEADERS.PRIVATE` for auth users, `CACHE_HEADERS.DYNAMIC_PUBLIC` for guests.

**Note**: Contact settings (social URLs) and feature settings (enableSubscriptions) are NOT currently fetched on this page. They would need to be added for hero content enrichment.

---

## 3. Org Layout (Branding Injection)

### File: `apps/web/src/routes/_org/[slug]/+layout.svelte`

**Branding data** flows from `data.org` (type: `OrganizationData`):

```typescript
interface OrganizationData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColors?: {
    primary?: string;         // e.g., '#C24129'
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
  };
  brandFonts?: { body?: string | null; heading?: string | null };
  brandRadius?: number;       // 0-2 (rem)
  brandDensity?: number;      // 0.75-1.25
  brandFineTune?: {
    tokenOverrides?: string | null;    // JSON string — THE EXTENSIBILITY HOOK
    darkModeOverrides?: string | null; // JSON string
    shadowScale?: string | null;
    shadowColor?: string | null;
    textScale?: string | null;
    headingWeight?: string | null;
    bodyWeight?: string | null;
  };
}
```

**Injection** (lines 287-304): CSS custom properties set on `.org-layout`:

```svelte
<div
  class="org-layout"
  data-org-brand={hasBranding ? '' : undefined}
  data-org-bg={brandBackground ? '' : undefined}
  style:--brand-color={brandPrimary}
  style:--brand-secondary={brandSecondary}
  style:--brand-accent={brandAccent}
  style:--brand-bg={brandBackground}
  style:--brand-density={brandDensity}
  style:--brand-radius={brandRadius}
  style:--brand-font-body={...}
  style:--brand-font-heading={...}
  style:--brand-shadow-scale={brandShadowScale}
  style:--brand-shadow-color={brandShadowColor}
  style:--brand-text-scale={brandTextScale}
  style:--brand-heading-weight={brandHeadingWeight}
  style:--brand-body-weight={brandBodyWeight}
>
```

**Critical**: These inline styles set the raw input variables. The CSS engine (`org-brand.css`) then derives ~50 tokens from these 7 inputs using OKLCH relative color syntax.

---

## 4. CSS Token Derivation

### File: `apps/web/src/lib/theme/tokens/org-brand.css`

**Two activation layers**:

1. `[data-org-brand]` — Active when org has any branding. Derives:
   - Primary palette: `--color-brand-primary`, `-hover`, `-active`, `-subtle`
   - Interactive: `--color-interactive`, `-hover`, `-active`, `-subtle`
   - Focus: `--color-focus`, `-ring`, `border-focus`
   - Text on brand: `--color-text-on-brand` (OKLCH auto-contrast: white or black)
   - Secondary palette: `--color-brand-secondary`, `-hover`, `-subtle`
   - Accent palette: `--color-brand-accent`, `-hover`, `-subtle`
   - Radius scale: `--radius-xs` through `--radius-xl` (computed from `--brand-radius`)
   - Density scale: `--space-0-5` through `--space-24` (computed from `--brand-density`)
   - Typography: `--font-body`, `--font-heading`, `--font-sans`, weight overrides
   - Text scale: `--text-xs` through `--text-4xl` (scaled by `--brand-text-scale`)
   - Shadows: `--shadow-strength`, `--shadow-color`

2. `[data-org-bg]` — Active only when background color is explicitly set. Derives:
   - Surface: `--color-background`, `--color-surface`, `-secondary`, `-tertiary`, `-elevated`
   - Text: `--color-text`, `-primary`, `-secondary`, `-muted` (auto-contrasting via OKLCH)
   - Border: `--color-border`, `-strong`, `-subtle`

**Browser support**: Chrome 119+, Firefox 128+, Safari 16.4+ (OKLCH relative color syntax).

---

## 5. Brand Editor Store

### File: `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts`

**State shape**:
```typescript
const state = $state<{
  panel: 'closed' | 'open' | 'minimized';
  orgId: string | null;
  saved: BrandEditorState | null;   // Last server-saved state
  pending: BrandEditorState | null; // Current editor state (live preview)
  level: LevelId;
  originalTheme: string | null;
  editingTheme: 'light' | 'dark';
}>();
```

**BrandEditorState**:
```typescript
interface BrandEditorState {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  fontBody: string | null;
  fontHeading: string | null;
  radius: number;        // 0-2
  density: number;       // 0.75-1.25
  logoUrl: string | null;
  tokenOverrides: Record<string, string | null>;  // ← SHADER CONFIG LIVES HERE
  darkOverrides: Partial<ThemeColors> | null;
}
```

**Live preview mechanism**: `$effect.root()` in the store watches `state.pending` → calls `injectBrandVars(state.pending)` → sets CSS properties on `.org-layout` → `org-brand.css` derives palette → page re-renders instantly.

---

## 6. CSS Injection

### File: `apps/web/src/lib/brand-editor/css-injection.ts`

**tokenOverrides injection** (lines 143-150):
```typescript
const overrides = state.tokenOverrides ?? {};
for (const [key, value] of Object.entries(overrides)) {
  if (value == null) continue;
  const prop = BRAND_PREFIX_KEYS.has(key)
    ? `--brand-${key}`   // e.g., 'shadow-scale' → --brand-shadow-scale
    : `--color-${key}`;  // e.g., 'text' → --color-text
  el.style.setProperty(prop, value);
}
```

**Current `BRAND_PREFIX_KEYS`**:
```typescript
const BRAND_PREFIX_KEYS = new Set([
  'text-scale', 'heading-weight', 'body-weight',
  'shadow-scale', 'shadow-color',
]);
```

**To add shader config**: Expand this set with shader keys:
```typescript
const BRAND_PREFIX_KEYS = new Set([
  'text-scale', 'heading-weight', 'body-weight',
  'shadow-scale', 'shadow-color',
  // Hero shader
  'shader-preset', 'shader-speed', 'shader-intensity',
  'shader-complexity', 'shader-mouse-enabled', 'shader-scroll-fade',
]);
```

This makes them available as `--brand-shader-preset`, `--brand-shader-speed`, etc.

---

## 7. Brand Editor Navigation

### File: `apps/web/src/lib/brand-editor/levels.ts`

**Current levels**:
```
Level 0: home
Level 1: colors, typography, shape, shadows, logo, presets
Level 2: fine-tune-colors, fine-tune-typography
```

**Home screen layout** (BrandEditorHome.svelte):
```
[Colors row]            ← Primary element (swatches + hex)
[Generate Palette]      ← Expandable palette generator
─ Customize ─
  [Typography ›]
  [Shape & Spacing ›]
─ Advanced ─
  [Shadows ›]
  [Logo ›]
[Browse Presets ›]      ← Bottom link
```

**Insertion point for "Hero Effects"**: Add to Advanced section:
```
─ Advanced ─
  [Shadows ›]
  [Logo ›]
  [Hero Effects ›]      ← NEW
```

---

## 8. Existing Brand Presets

### File: `apps/web/src/lib/brand-editor/presets.ts`

12 presets across 4 categories:

| Category | Presets | Distinctive Traits |
|----------|---------|-------------------|
| Professional | Corporate, Executive, Consulting | Tight spacing, muted colors, serif/sans-serif |
| Creative | Vibrant, Sunset, Ocean | Saturated colors, rounded corners, playful fonts |
| Bold | Dark, Neon, Ember | Dark backgrounds, high contrast, sharp edges |
| Minimal | Minimal, Paper, Mono | No accent, low radius, neutral palette |

**Shader interaction**: Each brand preset creates a different visual when combined with each shader preset. Example:
- "Neon" brand + "aurora" shader = electric cyan/green northern lights on black
- "Paper" brand + "gradient-mesh" shader = warm, subtle peach/amber blobs on off-white
- "Executive" brand + "geometric" shader = dark navy rotating geometry with gold accents

This gives **12 brand presets × 8 shader presets = 96 unique combinations** — significant visual diversity from purely data-driven configuration.

---

## 9. API Surface (Relevant Endpoints)

### Organization Public Info (used by org layout)
```
GET /api/organizations/public/:slug/info
→ { id, slug, name, description, logoUrl, brandColors, brandFonts, brandRadius, brandDensity, brandFineTune }
```
- **Cached**: VersionedCache, 30min TTL
- **Invalidated**: On org/branding update via `cache.invalidate(orgSlug)`

### Branding Update (used by brand editor save)
```
PUT /api/organizations/:id/settings/branding
← { primaryColorHex, ..., tokenOverrides (JSON string), ... }
→ 200 OK
```
- **tokenOverrides**: `z.string().nullable().optional()` — accepts any JSON
- **Invalidates**: Brand KV cache + VersionedCache

### Contact Settings (NOT currently loaded on org landing)
```
GET /api/organizations/:id/settings/contact
→ { platformName, supportEmail, twitterUrl, youtubeUrl, instagramUrl, tiktokUrl, ... }
```
- Needed for social links in enriched hero

### Feature Settings (NOT currently loaded on org landing)
```
GET /api/organizations/:id/settings/features
→ { enableSignups, enablePurchases, enableSubscriptions }
```
- Needed for smart CTA text

---

## 10. Design Token Inventory (Used by Hero)

### From `$lib/styles/tokens/`

| Token File | Tokens Used in Hero | Notes |
|-----------|--------------------|----|
| `colors.css` | `--color-brand-primary`, `--color-brand-secondary`, `--color-text-on-brand` | Via org-brand.css derivation |
| `spacing.css` | `--space-3` through `--space-28` | All hero padding, margins, gaps |
| `typography.css` | `--text-base` through `--text-4xl`, `--font-bold`, `--font-semibold`, `--tracking-tight`, `--leading-tight`, `--leading-normal` | |
| `radius.css` | `--radius-full`, `--radius-lg`, `--radius-button` | Logo and CTA rounding |
| `borders.css` | `--border-width-thick` | CTA border |
| `shadows.css` | `--shadow-lg` | Logo shadow |
| `motion.css` | `--duration-normal`, `--duration-fast`, `--ease-default` | CTA hover transitions |
| `materials.css` | `--blur-xl` (not used in hero, but in SidebarRail) | Potential for glass overlay on shader |
| `z-index.css` | Not used in hero (no stacking) | Canvas will need z-index for layering |
| `opacity.css` | `--opacity-90` | Description text |

### From `org-brand.css` (derived tokens)

| Input Variable | Derived Tokens Used |
|---------------|-------------------|
| `--brand-color` | `--color-brand-primary`, `--color-interactive`, `--color-text-on-brand` |
| `--brand-secondary` | `--color-brand-secondary` |
| `--brand-accent` | `--color-brand-accent-subtle` (CTA background) |
| `--brand-radius` | `--radius-button`, `--radius-lg` |
| `--brand-density` | All `--space-*` tokens (via `--space-unit` multiplier) |
| `--brand-font-heading` | `--font-heading` (title) |
| `--brand-shadow-scale` | Not used in hero currently |
