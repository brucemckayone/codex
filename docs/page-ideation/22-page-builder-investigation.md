# Page Builder System — Technical Investigation

**Date**: 2026-04-04
**Scope**: End-to-end analysis of how to implement configurable org landing pages in Codex
**Status**: Investigation complete — ready for option selection

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Core Architecture Pattern](#2-core-architecture-pattern)
3. [Option A: Section Picker (Recommended Starting Point)](#3-option-a-section-picker)
4. [Option B: Block-Based Builder](#4-option-b-block-based-builder)
5. [Option C: Full Visual Editor](#5-option-c-full-visual-editor)
6. [Data Model](#6-data-model)
7. [SSR & Performance on Cloudflare Workers](#7-ssr--performance-on-cloudflare-workers)
8. [CSS Variable Scoping Per Section](#8-css-variable-scoping-per-section)
9. [Svelte 5 Component Resolution](#9-svelte-5-component-resolution)
10. [Comparison Matrix](#10-comparison-matrix)
11. [Recommended Phased Approach](#11-recommended-phased-approach)

---

## 1. Current State

### What Exists

**Branding system** (fully operational):
- CSS variables injected at `.org-layout` div via `data-org-brand` attribute
- 7 input variables → ~50 derived tokens via OKLCH relative colors in `org-brand.css`
- Data flows: Neon → KV cache (`brand:{slug}`) → server load → inline `style:` bindings → SSR
- Brand editor: floating panel with live preview, saves via remote function → API → DB + KV invalidation
- Supports: primary/secondary/accent/background colors, fonts, radius, density, shadows, dark mode
- Full SSR — branding is in the initial HTML, no flash of unstyled content

**Landing page** (hardcoded, not configurable):
- Route: `_org/[slug]/(space)/+page.svelte`
- Two sections: hero (logo + name + description + CTA) and featured content grid (6 items)
- All styling uses design tokens — no hardcoded values
- All orgs get the identical layout

**Existing reusable components**:
- ContentCard, Card (with Header/Footer/Content), Button, PageContainer
- EmptyState, Badge, Avatar, Pagination, Tabs, Alert, Dialog, Popover
- Layout helpers: Stack, Cluster, OrgHeader, Footer
- No "section" or "block" type components exist yet

### The Gap

The branding system controls **appearance** (colours, fonts, spacing). There is no system for controlling **structure** (which sections appear, in what order, with what content). Every org sees the same two-section layout regardless of their content volume, audience, or goals.

---

## 2. Core Architecture Pattern

All three options share a common rendering pattern. The only difference is the **editor UI complexity** and **schema flexibility**.

```
[Database]  page_layouts.layout JSONB
     │
     ▼
[Server Load]  +page.server.ts fetches layout JSON (KV-cached)
     │
     ▼
[+page.svelte]  Iterates sections, resolves components from static registry
     │
     ▼
[SSR HTML]  Each section rendered with inline CSS variables
     │
     ▼
[Client Hydration]  SvelteKit hydrates, interactive elements become live
```

### Component Registry (Svelte 5 Pattern)

Svelte 5 made dynamic components first-class — `<svelte:component>` is no longer needed. A capitalized variable used as a tag is inherently reactive:

```svelte
<script>
  import Hero from '$lib/sections/Hero.svelte';
  import ContentGrid from '$lib/sections/ContentGrid.svelte';
  import CreatorSpotlight from '$lib/sections/CreatorSpotlight.svelte';
  // ... all section components

  const sectionMap = {
    hero: Hero,
    content_grid: ContentGrid,
    creator_spotlight: CreatorSpotlight,
    // ...
  };

  let { data } = $props();
</script>

{#each data.layout.sections as section}
  {@const Component = sectionMap[section.type]}
  {#if Component}
    <section class="page-section" style={cssVarsFromStyles(section.styles)}>
      <Component data={section.data} />
    </section>
  {/if}
{/each}
```

This pattern:
- Works identically on server and client (full SSR)
- All imports are static — Vite tree-shakes at build time
- No async/dynamic imports needed (Workers-safe)
- `{@const}` in Svelte 5 template blocks is synchronous
- For 10-15 section types, bundle overhead is negligible (Svelte compiles small)

### Alternative: Build-Time Discovery

Instead of manually maintaining the import list, use Vite's `import.meta.glob`:

```typescript
// $lib/sections/registry.ts
const modules = import.meta.glob('./*.svelte', { eager: true });

export const sectionMap: Record<string, Component> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => {
    const name = path.split('/').pop()!.replace('.svelte', '')
      .replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [name, (mod as any).default];
  })
);
```

The `{ eager: true }` flag is essential — without it, you get async imports that break SSR on Workers.

---

## 3. Option A: Section Picker

**Model**: Carrd / Linktree / Shopify Online Store 2.0 (simplified)
**Complexity**: Low-Medium
**User control**: Select sections, configure settings, reorder — no custom layout/positioning

### How It Works

Org admins see a "Page Editor" in their studio with a list of available section types. They:
1. Pick sections from a catalog (e.g., "Add Hero", "Add Content Grid", "Add CTA")
2. Configure each section's settings via a form panel (text, content source, colour overrides)
3. Reorder sections by dragging or moving up/down
4. Preview live (the page re-renders with their changes)
5. Publish (snapshots the config, invalidates cache)

### Section Types (Initial Set for Content Platform)

| Section Type | Purpose | Settings |
|---|---|---|
| `hero` | Brand introduction | Heading, subheading, CTA text/link, background style (gradient/image/solid), layout (centered/split/minimal) |
| `content_grid` | Display content items | Title, source (latest/featured/category), columns (2/3/4), limit, show prices, show creator |
| `content_carousel` | Horizontal scrollable content | Same as grid but scrollable layout |
| `creator_spotlight` | Showcase creators | Title, limit (1-6), layout (cards/avatars/featured) |
| `categories` | Navigation by category | Style (pills/cards/icons), show counts |
| `text_block` | Rich text section | Heading, body text (markdown/HTML), alignment, max-width |
| `cta_banner` | Call to action | Heading, subheading, button text/link, background colour |
| `pricing_table` | Plans/pricing | Future: pulls from Stripe products |
| `faq` | Expandable Q&A | Array of { question, answer } pairs |
| `testimonials` | Social proof | Array of { quote, author, role } |
| `spacer` | Visual breathing room | Height (small/medium/large) |

### Editor UI

The editor lives in the studio at `/{slug}.*/studio/pages` or extends the existing brand editor panel:

```
┌─────────────────────────────────────────┐
│  Page Editor — Landing Page             │
├─────────────────────────────────────────┤
│  [⊕ Add Section]                        │
│                                         │
│  ┌─── Hero ──────────────── ≡ ✕ ──┐    │
│  │ Heading: [Welcome to Yoga...]   │    │
│  │ Background: [● Gradient ...]    │    │
│  │ Layout: [Centered ▼]           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─── Content Grid ───────── ≡ ✕ ──┐   │
│  │ Title: [Latest Releases]        │   │
│  │ Source: [Newest ▼]              │   │
│  │ Columns: [3 ▼]                  │   │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─── Creator Spotlight ──── ≡ ✕ ──┐   │
│  │ Title: [Meet Our Teachers]      │   │
│  │ Limit: [3]                      │   │
│  └─────────────────────────────────┘    │
│                                         │
│  [Discard]              [Save Draft]    │
│                         [Publish ▲]     │
└─────────────────────────────────────────┘
```

### Variant System

Each section type can ship with 2-4 visual variants. The variant is a setting on the section:

```typescript
interface Section {
  id: string;
  type: 'hero';
  order: number;
  data: {
    heading: string;
    subheading: string;
    ctaText: string;
    ctaLink: string;
  };
  variant: 'centered' | 'split' | 'minimal' | 'cinematic';
  styles?: {
    cssVariables?: Record<string, string>;
    containerWidth?: 'narrow' | 'wide' | 'full';
  };
}
```

The component internally switches rendering based on variant:

```svelte
<!-- Hero.svelte -->
<script>
  let { data, variant = 'centered' } = $props();
</script>

{#if variant === 'cinematic'}
  <div class="hero-cinematic"><!-- full-width background video style --></div>
{:else if variant === 'split'}
  <div class="hero-split"><!-- left text, right image --></div>
{:else}
  <div class="hero-centered"><!-- centered stack --></div>
{/if}
```

### Pros

- Simple mental model for non-technical org admins
- Flat section array — no recursive rendering, trivial to SSR
- Each section is a self-contained Svelte component with scoped styles
- The variant system gives visual variety without exposing CSS
- Very cacheable — the JSON config is small (1-5KB), changes rarely
- Aligns perfectly with existing branding system (sections consume design tokens)
- New section types are added by developers as discrete components
- Works on mobile (the editor is a simple form, not a canvas)

### Cons

- Limited flexibility — admins can't create layouts that weren't pre-designed
- No nesting — can't put a grid inside a card inside a section
- Every new section type requires developer work
- Variant count can explode (N sections × M variants = N×M components to maintain)
- No custom CSS or positional control — what you see in the variant is what you get

### Effort Estimate

- Database schema + migration: 1 session
- Section component library (10 types × ~2 variants): 3-4 sessions
- Studio editor UI (list, reorder, settings panels): 2-3 sessions
- API (CRUD + publish + cache): 1-2 sessions
- KV caching integration: 1 session
- **Total: ~8-11 sessions**

---

## 4. Option B: Block-Based Builder

**Model**: WordPress Gutenberg / Storyblok / Notion
**Complexity**: Medium-High
**User control**: Sections contain blocks, blocks can nest, richer layout options

### How It Works

Like Option A but with a second layer: sections contain **blocks**, and blocks can nest. This enables layouts like "two-column section where left column has a text block and right column has a content card block."

### Data Structure

```typescript
interface Section {
  id: string;
  type: string;
  order: number;
  data: Record<string, unknown>;
  variant?: string;
  styles?: SectionStyles;
  blocks?: Block[];  // NEW: nested content
}

interface Block {
  id: string;
  type: string;  // 'text' | 'image' | 'content_card' | 'button' | 'spacer' | 'columns'
  data: Record<string, unknown>;
  children?: Block[];  // Recursive nesting (for columns, groups)
}
```

### What This Enables

```
┌─────────────────────────────────────────┐
│ Hero Section (variant: split)           │
│ ┌─────────────┬─────────────────────┐   │
│ │ Text Block  │ Image Block         │   │
│ │ "Welcome"   │ [hero-image.jpg]    │   │
│ │ Button: CTA │                     │   │
│ └─────────────┴─────────────────────┘   │
├─────────────────────────────────────────┤
│ Content Section                         │
│ ┌──────┬──────┬──────┐                  │
│ │ Card │ Card │ Card │  (auto-filled)   │
│ └──────┴──────┴──────┘                  │
├─────────────────────────────────────────┤
│ Columns Section (2-column)              │
│ ┌─────────────┬─────────────────────┐   │
│ │ FAQ Block   │ Testimonial Block   │   │
│ │ Q1: ...     │ "Great course..."   │   │
│ │ Q2: ...     │ — Jane D.           │   │
│ └─────────────┴─────────────────────┘   │
└─────────────────────────────────────────┘
```

### Rendering (Recursive)

```svelte
<!-- BlockRenderer.svelte -->
<script>
  import { blockMap } from '$lib/blocks/registry';

  let { block } = $props();
  const Component = $derived(blockMap[block.type]);
</script>

{#if Component}
  <Component data={block.data}>
    {#if block.children}
      {#each block.children as child}
        <svelte:self block={child} />
      {/each}
    {/if}
  </Component>
{/if}
```

### Editor UI

More complex than Option A. Each section expands to show its blocks, and blocks have their own add/remove/configure UI. Think Notion's block-based editing:

- Click "+" between blocks to insert
- Drag blocks to reorder
- Block type picker: text, image, button, spacer, columns
- Columns block splits into sub-block areas
- Each block has a settings popover

### Pros

- Much more flexible than section-only — admins can compose unique layouts
- Nesting enables multi-column, card-in-card, and grouped content patterns
- The block model is well-understood (WordPress, Notion, Storyblok all use it)
- Blocks are more granular and reusable than sections
- Can evolve toward Option C without a full rewrite

### Cons

- Recursive rendering adds SSR complexity (though still works with static imports)
- The editor UI is significantly more complex — drag-and-drop in nested containers is hard
- Deeply nested blocks can cause layout bugs (what happens with 5 levels of nesting?)
- Need to cap recursion depth (Shopify caps at 2 levels: sections → blocks)
- Performance: recursive component instantiation is slower than flat iteration
- Risk of "blank page syndrome" — too many choices, admins don't know where to start
- Testing matrix grows combinatorially (every block must work inside every container)

### Effort Estimate

- Everything from Option A, plus:
- Recursive block renderer: 1 session
- Block component library (8-10 types): 2-3 sessions
- Nested editor UI with drag-and-drop: 4-6 sessions (this is the hard part)
- Block nesting validation/limits: 1 session
- **Total: ~16-22 sessions**

---

## 5. Option C: Full Visual Editor

**Model**: Webflow / Builder.io / GrapesJS
**Complexity**: Very High
**User control**: Near-complete — position elements, edit CSS properties, responsive breakpoints

### How It Works

The page loads in an iframe within the studio. Admins click on any element to select it, then use side panels to edit content, styles, layout properties. Similar to the Storyblok "visual editing" approach where the real site is rendered in a preview frame and a bridge script connects click events to editor panels.

### Architecture

```
┌──────────────────────────────────────────────┐
│ Studio Page Editor                            │
│ ┌────────────┬──────────────┬──────────────┐ │
│ │ Component  │              │  Properties  │ │
│ │ Palette    │   [iframe]   │  Panel       │ │
│ │            │              │              │ │
│ │ ○ Hero     │  ┌────────┐  │ Heading:     │ │
│ │ ○ Grid     │  │Selected│  │ [Welcome]    │ │
│ │ ○ Text     │  │Element │  │              │ │
│ │ ○ Button   │  │        │  │ Font size:   │ │
│ │ ○ Image    │  └────────┘  │ [2.5rem]     │ │
│ │ ○ Columns  │              │              │ │
│ │            │              │ Background:  │ │
│ │            │              │ [#1a1a2e]    │ │
│ └────────────┴──────────────┴──────────────┘ │
│                                              │
│ [Mobile ▼]  [Tablet ▼]  [Desktop ▼]         │
└──────────────────────────────────────────────┘
```

### Implementation Approaches

**Approach 1: GrapesJS + SvelteKit wrapper**
- GrapesJS is a framework-agnostic page builder that operates on HTML/CSS
- Embed it in a SvelteKit route, use it to generate HTML output
- Store generated HTML as the page content, render it as `{@html}` on the public page
- Problem: output is raw HTML, not Svelte components — loses reactivity, design tokens, interactivity

**Approach 2: Builder.io SDK**
- Use Builder.io as a headless visual editor (SaaS dependency)
- Their Svelte SDK renders Builder content blocks as real Svelte components
- You register your components, they provide the drag-and-drop editor
- Problem: external dependency, monthly cost, vendor lock-in

**Approach 3: Custom iframe bridge (Storyblok-style)**
- Render the actual org page in an iframe
- Inject a bridge script that maps click events to section/block IDs
- The editor panel outside the iframe shows settings for the clicked element
- Save writes back to the page config JSON
- This is achievable but complex — the iframe/parent communication and selection highlighting require careful engineering

### Pros

- Maximum creative freedom for org admins
- "What you see is what you get" — edits are immediately visible
- Can handle any layout: asymmetric grids, overlapping elements, custom spacing
- Premium feel — differentiator from simpler platforms
- Per-section responsive overrides possible

### Cons

- **Massive engineering effort** — the editor alone is a product
- Iframe bridge introduces latency and communication complexity
- Responsive design becomes the admin's problem (they can create layouts that break on mobile)
- Performance: storing per-element CSS means larger page configs and more variables to parse
- Output can be messy — unlike structured sections, freeform layouts are harder to cache and optimize
- Accessibility becomes harder to enforce — admins can create non-accessible layouts
- The editor itself needs to be responsive and work on tablets/mobile
- Risk: you end up maintaining a page builder instead of a content platform

### Effort Estimate

- Everything from Options A + B, plus:
- Iframe bridge and selection system: 4-6 sessions
- Properties panel (CSS, content, responsive): 6-8 sessions
- Drag-and-drop canvas with snap/grid: 6-8 sessions
- Responsive breakpoint editor: 3-4 sessions
- Undo/redo system: 2-3 sessions
- Template gallery and preview: 2-3 sessions
- **Total: ~40-55 sessions**

---

## 6. Data Model

### Schema (Shared Across All Options)

```sql
-- Page layout configurations
CREATE TABLE page_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  creator_id UUID NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL,                   -- 'home', 'about', 'custom-page'
  title TEXT NOT NULL,
  layout JSONB NOT NULL,                -- the sections array (working draft)
  published_layout JSONB,               -- snapshot when published (what visitors see)
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,               -- soft delete
  UNIQUE(org_id, slug) WHERE deleted_at IS NULL
);

-- Version history for rollback
CREATE TABLE page_layout_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_layout_id UUID NOT NULL REFERENCES page_layouts(id),
  version INTEGER NOT NULL,
  layout JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_summary TEXT
);

-- Pre-built templates
CREATE TABLE page_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                   -- 'Minimal Creator', 'Course Platform'
  description TEXT,
  thumbnail_url TEXT,
  layout JSONB NOT NULL,                -- pre-configured sections
  category TEXT NOT NULL,               -- 'creator', 'educator', 'podcaster'
  is_system BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Why JSONB Over Normalized Tables

The page layout is **always read and written as a whole unit**. You never query "find all pages using the hero section" in the render path. JSONB in Neon:
- Single query fetches the entire config
- No JOINs on the hot read path
- The entire layout JSON can be cached in KV as one value
- Versioning is trivial — copy the JSONB column
- PostgreSQL JSONB supports indexing on paths if needed later
- Typical layout size: 1-5KB (well within KV value limits)

### Layout JSON Structure

```typescript
interface PageLayout {
  sections: Section[];
  metadata?: {
    template?: string;      // which template this started from
    lastEditedBy?: string;
  };
}

interface Section {
  id: string;               // UUID for editor targeting
  type: string;             // maps to component registry key
  order: number;
  variant?: string;         // visual variant within the type
  data: Record<string, unknown>;  // component-specific props
  styles?: SectionStyles;
  blocks?: Block[];         // Option B/C only
}

interface SectionStyles {
  cssVariables?: Record<string, string>;  // per-section overrides
  containerWidth?: 'narrow' | 'wide' | 'full';
  paddingY?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  background?: 'transparent' | 'surface' | 'muted' | 'brand' | 'custom';
}
```

### Draft/Published Separation

- `layout` column = working draft (what the editor shows)
- `published_layout` column = what visitors see
- "Publish" copies `layout` → `published_layout`, bumps `version`, sets `published_at`
- The public page server load reads `published_layout` (or falls back to a default if null)
- The editor reads `layout` (the draft)

### Default Page (No Config Yet)

When an org has no `page_layouts` record for slug `'home'`, the server load returns a hardcoded default layout. This is the current landing page structure encoded as JSON:

```json
{
  "sections": [
    {
      "id": "default-hero",
      "type": "hero",
      "order": 0,
      "variant": "centered",
      "data": {
        "useOrgName": true,
        "useOrgDescription": true,
        "ctaText": "Explore Content",
        "ctaLink": "/explore"
      }
    },
    {
      "id": "default-grid",
      "type": "content_grid",
      "order": 1,
      "data": {
        "title": "Featured Content",
        "source": "newest",
        "limit": 6,
        "columns": 3
      }
    }
  ]
}
```

This means the migration is non-breaking — existing orgs see their current page, and the system is backwards compatible.

---

## 7. SSR & Performance on Cloudflare Workers

### The Challenge

Workers have constraints:
- No persistent process (cold starts on every request)
- CPU time limits (10ms free, 30ms paid per request)
- No filesystem access at runtime
- Limited dynamic import support

### Caching Strategy (Extends Existing Pattern)

The page builder integrates with your existing `@codex/cache` `VersionedCache` system:

```
Creator publishes page layout
  → API persists to Neon (page_layouts.published_layout)
  → Background: cache page layout JSON in KV (key: page:{orgId}:{slug})
  → Background: bump version key (same pattern as brand cache invalidation)

Visitor requests org landing page
  → Server load checks KV for cached layout JSON
  → If KV hit: use cached layout (sub-millisecond, no DB round-trip)
  → If KV miss: fetch from Neon, cache in KV for next request
  → Pass layout JSON to +page.svelte
  → Component registry resolves sections → full SSR HTML
  → HTML is CDN-cacheable (DYNAMIC_PUBLIC headers, same as current landing page)
```

### Three Cache Layers

1. **CDN** (Cloudflare edge): 5-minute cache on public org pages (existing `DYNAMIC_PUBLIC` headers)
2. **KV** (Cloudflare): Layout JSON cached per org, invalidated on publish (sub-millisecond reads)
3. **Client** (SvelteKit): `depends('cache:page-layout')` + visibility change invalidation (existing pattern)

### Performance Budget

For 10-15 sections per page:
- Layout JSON parse: <1ms (JSON.parse of 1-5KB is trivial)
- Component resolution: <1ms (object property lookup in static map)
- Svelte SSR rendering: 2-5ms for 10-15 sections (Svelte compiles to very efficient render functions)
- **Total SSR overhead: <10ms** — well within Workers CPU budget

The key insight: **the section list is flat (Option A) or shallow (Option B, max 2-3 levels)**. This is not a deep recursive tree. The rendering is effectively a single `for` loop over an array, instantiating known components with known props.

### What NOT to Do

- Don't use dynamic `import()` for section components on Workers — use static imports
- Don't store rendered HTML in KV (it's large and hard to invalidate per-section)
- Don't pre-render at deploy time — layouts change per-org, not per-deploy
- Don't fetch section data inside section components — all data comes from the server load function

### Data Fetching Pattern

The server load function is responsible for fetching ALL data that sections need:

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ parent, locals, depends }) => {
  const { org } = await parent();
  depends('cache:page-layout');

  // 1. Fetch layout config (KV-cached)
  const layout = await getPublishedLayout(org.id, 'home');

  // 2. Fetch data for data-driven sections (content grids, creator lists)
  const sectionData = await fetchSectionData(layout.sections, org.id, locals.user?.id);

  return { layout, sectionData };
};

async function fetchSectionData(sections: Section[], orgId: string, userId?: string) {
  const fetches: Record<string, Promise<unknown>> = {};

  for (const section of sections) {
    if (section.type === 'content_grid') {
      fetches[section.id] = api.content.getPublicContent(orgId, {
        sort: section.data.source,
        limit: section.data.limit,
      });
    }
    if (section.type === 'creator_spotlight') {
      fetches[section.id] = api.org.getPublicCreators(orgId, {
        limit: section.data.limit,
      });
    }
    // ... other data-driven sections
  }

  const results = await Promise.all(
    Object.entries(fetches).map(async ([id, promise]) => [id, await promise])
  );
  return Object.fromEntries(results);
}
```

This way:
- All API calls happen in parallel (`Promise.all`)
- Section components receive pre-fetched data as props (no client-side fetching)
- The server load function is the single source of data — section components are pure renderers
- Non-data sections (hero, text, CTA, spacer) need no API calls

---

## 8. CSS Variable Scoping Per Section

### How It Works

CSS custom properties inherit through the DOM tree. Setting them on a `<section>` wrapper scopes them to that subtree. This is pure CSS cascade — no JavaScript needed, and it works in SSR:

```html
<!-- SSR output -->
<section style="--section-bg: var(--color-brand-primary); --section-padding: var(--space-16)">
  <div class="hero">
    <h1>Welcome</h1>  <!-- inherits --section-bg and --section-padding -->
  </div>
</section>

<section style="--section-bg: var(--color-surface-muted); --section-padding: var(--space-8)">
  <div class="content-grid">
    <p>Content here</p>  <!-- inherits different values -->
  </div>
</section>
```

### Integration with Existing Branding

Section CSS variables can reference org-level brand tokens:

```typescript
// Section config in database
{
  type: "hero",
  styles: {
    cssVariables: {
      "--section-bg": "var(--color-brand-primary)",      // references org brand token
      "--section-text": "var(--color-text-on-brand)",     // auto-contrast from OKLCH
      "--section-accent": "var(--color-brand-accent)"     // references accent token
    },
    background: "brand"  // semantic shorthand
  }
}
```

Or override with section-specific values:

```typescript
{
  styles: {
    cssVariables: {
      "--section-bg": "#1a1a2e",         // section-specific override
      "--section-text": "#eeeeee"
    },
    background: "custom"
  }
}
```

### Semantic Background Presets

Rather than exposing raw CSS variables to admins, provide semantic presets that map to the org's design tokens:

| Preset | Resolves To |
|---|---|
| `transparent` | No background |
| `surface` | `var(--color-surface)` |
| `muted` | `var(--color-surface-muted)` |
| `brand` | `var(--color-brand-primary)` with auto text contrast |
| `accent` | `var(--color-brand-accent)` with auto text contrast |
| `dark` | `var(--color-surface-inverse)` with light text |
| `custom` | Admin picks a hex colour |

This keeps the editor simple (dropdown, not CSS input) while leveraging the full OKLCH derivation system.

### Svelte Implementation

```svelte
<!-- SectionWrapper.svelte -->
<script lang="ts">
  import type { Section, SectionStyles } from '$lib/types/page-builder';

  interface Props {
    section: Section;
    children: import('svelte').Snippet;
  }

  let { section, children }: Props = $props();

  const styleString = $derived(buildSectionStyles(section.styles));

  function buildSectionStyles(styles?: SectionStyles): string {
    if (!styles?.cssVariables) return '';
    return Object.entries(styles.cssVariables)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');
  }
</script>

<section
  class="page-section"
  class:narrow={section.styles?.containerWidth === 'narrow'}
  class:full={section.styles?.containerWidth === 'full'}
  class:pad-sm={section.styles?.paddingY === 'sm'}
  class:pad-md={section.styles?.paddingY === 'md'}
  class:pad-lg={section.styles?.paddingY === 'lg'}
  style={styleString}
>
  {@render children()}
</section>
```

---

## 9. Svelte 5 Component Resolution

### Key Svelte 5 Changes

1. **Dynamic components are first-class**: `<Component />` where `Component` is a variable just works. No `<svelte:component>` needed.

2. **`{@const}` in template blocks**: Allows synchronous variable declaration inside `{#each}`:
   ```svelte
   {#each sections as section}
     {@const Component = sectionMap[section.type]}
     <Component data={section.data} />
   {/each}
   ```

3. **`$derived` for reactive resolution**:
   ```svelte
   const Component = $derived(sectionMap[selectedType]);
   ```

4. **Snippets for render delegates**: `{@render snippet(data)}` can be used for consumer-customizable section templates, but full components are better for isolated blocks.

### Known SSR Gotcha

There is a Svelte 5 hydration issue (GitHub #13517) where `$derived` component swaps may not update after SSR. The workaround is to use `{@const}` inside template blocks (which works) rather than `$derived` at the script level for component resolution. For the page builder, this is a non-issue because the component resolution happens inside `{#each}` via `{@const}`.

### Recommended Pattern (Final)

```svelte
<!-- PageRenderer.svelte -->
<script lang="ts">
  import { sectionMap } from '$lib/sections/registry';
  import SectionWrapper from './SectionWrapper.svelte';
  import type { PageLayout, SectionData } from '$lib/types/page-builder';

  interface Props {
    layout: PageLayout;
    sectionData: Record<string, unknown>;
  }

  let { layout, sectionData }: Props = $props();
</script>

{#each layout.sections as section (section.id)}
  {@const Component = sectionMap[section.type]}
  {#if Component}
    <SectionWrapper {section}>
      <Component
        data={section.data}
        variant={section.variant}
        serverData={sectionData[section.id]}
      />
    </SectionWrapper>
  {:else}
    <!-- Unknown section type — skip silently in production, warn in dev -->
  {/if}
{/each}
```

---

## 10. Comparison Matrix

| Dimension | Option A: Section Picker | Option B: Block Builder | Option C: Visual Editor |
|---|---|---|---|
| **User skill required** | None (pick & configure) | Low (understand nesting) | Medium (understand layout) |
| **Layout flexibility** | Low — predefined variants | Medium — nested blocks | High — freeform positioning |
| **Effort to build** | ~8-11 sessions | ~16-22 sessions | ~40-55 sessions |
| **Effort to maintain** | Low — isolated components | Medium — block interactions | High — editor + canvas + bridge |
| **SSR performance** | Excellent — flat iteration | Good — shallow recursion | Depends on output complexity |
| **Edge caching** | Excellent — small JSON | Good — larger JSON | Fair — CSS-heavy configs |
| **Mobile editing** | Easy — form-based UI | Hard — nested drag-and-drop | Very hard — canvas interaction |
| **Backwards compatibility** | 100% — default layout fallback | 100% — same fallback | 100% — same fallback |
| **Extensibility** | Add new section types | Add section types + block types | Add component types + CSS properties |
| **Risk of bad output** | None — variants are tested | Low — nesting is capped | High — admins can break responsive |
| **Real-world analogues** | Carrd, Linktree, Shopify sections | WordPress Gutenberg, Notion | Webflow, Builder.io, Wix |
| **Best for this platform?** | **Yes — content platform** | Maybe — if demand grows | Overkill — not a website builder |

### Recommendation

**Start with Option A (Section Picker)**. The landing page for a content streaming platform has a predictable structure: hero → content showcase → creator info → CTA → social proof. The section picker gives org admins meaningful customization without the complexity of a block builder or visual editor.

**Evolve to Option B** only if there's strong demand for layouts the section picker can't handle. The data model supports this — sections already have a `blocks` field that can be populated later without migration.

**Don't build Option C** unless Codex pivots to being a website builder platform. The ROI is negative for a content streaming product.

---

## 11. Recommended Phased Approach

### Phase 1: Foundation (3-4 sessions)

**Goal**: Data model + rendering pipeline. The landing page becomes data-driven but uses a hardcoded default layout (visually identical to today).

1. Add `page_layouts` + `page_layout_versions` tables via Drizzle migration
2. Create `PageLayoutService` in a new `@codex/page-layout` package (or extend `@codex/identity`)
3. Add KV caching for layout JSON (pattern: `page:{orgId}:{slug}`)
4. Create the section component registry (`$lib/sections/registry.ts`)
5. Build `PageRenderer.svelte` and `SectionWrapper.svelte`
6. Create initial section components: `Hero.svelte`, `ContentGrid.svelte`, `CreatorSpotlight.svelte`
7. Refactor `+page.svelte` to use PageRenderer with a default layout config
8. Add API endpoints for layout CRUD to `organization-api` worker

**Outcome**: The page renders identically to today, but the structure is now driven by JSON config. No editor yet — admins can't change anything.

### Phase 2: Section Library (3-4 sessions)

**Goal**: Build out the full set of section components with 2-3 variants each.

1. Build remaining section types: `TextBlock`, `CtaBanner`, `Categories`, `FAQ`, `Testimonials`, `Spacer`, `ContentCarousel`, `PricingTable`
2. Design 2-3 variants per section type (centered/split/minimal for hero, cards/avatars for creators, etc.)
3. Build the `SectionStyles` → CSS variable mapping with semantic presets
4. Create page templates (system templates for different org types)
5. Write integration tests for each section type rendering via SSR

**Outcome**: A rich library of sections ready to be composed, but still no editor.

### Phase 3: Studio Editor (3-4 sessions)

**Goal**: The editor UI that org admins use to compose their landing page.

1. Build `studio/pages/+page.svelte` route
2. Section list with add/remove/reorder
3. Section settings panels (one per section type)
4. Live preview (the page re-renders as settings change, same pattern as brand editor)
5. Draft/publish flow with version history
6. Template picker for starting from a pre-built layout
7. Cache invalidation on publish

**Outcome**: Org admins can customise their landing page from their studio.

### Phase 4: Polish & Extend (2-3 sessions)

**Goal**: Refinements based on real usage.

1. Mobile editor optimization
2. Section variant thumbnails in the picker
3. Undo/redo
4. Analytics integration (which sections drive engagement)
5. Additional section types based on demand
6. Consider Option B block nesting if needed

---

## Appendix: Industry Reference

### How Existing Platforms Store Page Config

| Platform | Storage | Format | Nesting |
|---|---|---|---|
| Shopify | JSON files in theme repo | Sections + blocks, max 25 sections / 50 blocks | 2 levels (sections → blocks) |
| WordPress | `wp_posts.post_content` column | HTML with JSON comment delimiters | Unlimited nesting |
| Storyblok | SaaS API | JSON tree with typed `component` fields | Unlimited nesting |
| Builder.io | SaaS API | JSON tree with `@type`, `responsiveStyles`, `children` | Unlimited nesting |
| Contentful | SaaS API | Content references (not a page builder per se) | Via references |
| Carrd | SaaS storage | Flat section list | None (flat only) |
| Notion | SaaS storage | Block tree with typed blocks | Unlimited nesting |

### SvelteKit + Headless CMS Patterns

The Storyblok and Directus patterns for SvelteKit all follow the same core pattern:
1. Component map registered at init time
2. JSON fetched in load function
3. Recursive or flat renderer in `.svelte` file
4. Full SSR works with static imports + `{ eager: true }` glob

This is a well-trodden path in the Svelte ecosystem. There are no novel architectural risks.

### Sources

- Svelte 5 Migration Guide: `svelte:component` no longer necessary
- SvelteKit SSR Dynamic Component Imports: GitHub issue #9775
- Svelte 5 Dynamic Components SSR Bug: GitHub issue #13517
- Storyblok SvelteKit Integration with Svelte 5
- Directus: Rendering Dynamic Blocks Using SvelteKit
- Builder.io Svelte SDK
- Shopify Theme Architecture: Sections and Blocks
- WordPress Block Editor Handbook and Serialization Parser
- SvelteKit Loading Data and Performance Documentation
- Vite Glob Import Features
- Cloudflare Workers Edge Rendering Patterns
