# Org Landing Page Improvements -- Implementation Spec

## Summary

Four medium-effort improvements to the org landing page (`_org/[slug]/(space)/+page.svelte`) that enrich the visitor experience with a branded hero, personalized continue-watching rail, new releases section, and a creator preview. All data sources already exist -- the work is wiring them into the page server loader and rendering new sections.

**Scope IDs**: 1.14 (Hero), 1.15 (Continue Watching), 1.16 (New Releases), 2.8 (Creator Preview)

---

## Feasibility

### Pros

- **No new API endpoints required.** Every data source (`getPublicContent`, `getPublicCreators`, `api.access.getUserLibrary`) already exists and is used by other pages in the same route group.
- **Branding CSS variables are already injected.** The org layout (`+layout.svelte`) sets `--brand-color`, `--brand-secondary`, `--brand-accent`, `--brand-bg` and the derived `--color-brand-primary`, `--color-brand-secondary`, etc. via `data-org-brand`. The hero section already consumes these.
- **ContentCard component is reusable.** The existing `ContentCard` handles thumbnails, duration, price, progress, and creator info -- covers all four sections.
- **Library API supports org filtering and progress filtering.** The library endpoint accepts `organizationId` and `filter=in_progress` params, already proven in the org library page (`(space)/library/+page.server.ts`).
- **i18n keys for org pages are established.** The `en.json` message file has an `org_*` namespace with existing keys for hero, featured, explore, and creators sections.

### Gotchas & Risks

- **Continue Watching requires auth.** The `getUserLibrary` call needs a session. The page server loader currently sets `CACHE_HEADERS.DYNAMIC_PUBLIC` -- this must remain for unauthenticated visitors. The continue-watching fetch must be conditional on `locals.user` and must not block the page if it fails.
- **Parallel data fetches.** The page currently awaits `parent()` then fetches featured content sequentially. Adding creators and continue-watching means three more fetches. Use `Promise.all` to parallelize, and wrap the authed call in a try/catch so auth failures don't break the public page.
- **Cache header conflict.** The page sets `DYNAMIC_PUBLIC` for edge caching. Continue-watching data is user-specific. The page must keep `DYNAMIC_PUBLIC` headers (the continue-watching section is populated from the server load but the HTTP response itself is public -- the user-specific data is not sensitive catalogue data, it is library progress). Alternatively, if the team decides progress data should not be edge-cached, switch to `PRIVATE` when `locals.user` is present. **Recommended approach**: keep `DYNAMIC_PUBLIC` and conditionally downgrade to `PRIVATE` only when a logged-in user is detected, since the response includes user-specific library data.
- **Empty states.** Each new section needs graceful handling when data is empty (no in-progress content, no creators, new org with no content). The continue-watching section should be entirely absent (not rendered at all) for unauthenticated users and should be hidden when the user has no in-progress items for this org.
- **SSR data hydration.** The continue-watching section uses server-fetched library data, not the localStorage `libraryCollection`. This is correct -- the landing page is a public page that happens to show a personalized section. We do NOT hydrate the library collection here (that is the platform layout's job). We simply render the server data directly.
- **Library item shape.** `UserLibraryResponse.items[].content` has `organizationSlug` but not `organizationId`. The server loader filters via the `organizationId` query param to the API, so the response is already org-scoped.

---

## Current State

### `+page.server.ts`

Fetches `org` from `parent()` (the layout), then calls `getPublicContent({ orgId, limit: 6, sort: 'newest' })`. Returns `{ featuredContent }`. Sets `CACHE_HEADERS.DYNAMIC_PUBLIC`.

### `+page.svelte`

Two sections:

1. **Hero** -- Gradient background using `--color-brand-primary` / `--color-brand-secondary`. Displays org logo (small, 80px circle), org name (h1), org description, and a single "Explore Content" CTA linking to `/explore`.
2. **Featured Content** -- Section heading "Featured Content" with a "View all content" link. Renders up to 6 `ContentCard` components in a responsive 1/2/3-column grid. Empty state if no content.

### Layout data available via `parent()`

From `+layout.server.ts`, the page has access to:

```typescript
{
  org: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    brandColors: { primary?, secondary?, accent?, background? };
    brandFonts?: { body?, heading? };
    brandRadius?: number;
    brandDensity?: number;
    brandFineTune?: { ... };
  };
  user: { id, name, email, ... } | null;
  versions: Record<string, string | null>;
}
```

---

## Design Spec

### 1. Hero Section Redesign

**Goal**: Make the hero more impactful with a larger logo, tagline prominence, and dual CTA buttons.

#### Layout

- Full-width section with the branded gradient background (keep existing `linear-gradient(135deg, --color-brand-primary, --color-brand-secondary)` and the `radial-gradient` overlay).
- Increase vertical padding from `--space-16` to `--space-20` on desktop, keep `--space-10` on mobile.
- Logo: increase from `--space-20` (80px) to `--space-28` (112px) on desktop, `--space-20` on mobile. Keep the circular crop, white border, and shadow.
- Org name: keep `--text-4xl` on desktop, `--text-2xl` on mobile.
- Description/tagline: keep `--text-lg`. Add `max-width: 640px` (use `max-width: 40rem` via a CSS variable if one exists, otherwise use a named custom property scoped to the component).
- **Dual CTAs**: Primary "Explore Content" button (current style, prominent) and secondary "Meet Our Creators" button (ghost-style with semi-transparent border). Both use `<a>` tags with `href="/explore"` and `href="/creators"` respectively.

#### CTA Button Styles

- **Primary CTA** (existing `hero__cta` class): Keep the current white-tinted background with border. This is the "Explore Content" button.
- **Secondary CTA** (new `hero__cta--secondary` modifier): Transparent background, semi-transparent white border, same text color (`--color-text-on-brand`). On hover: subtle white background tint. Rendered only when the org has at least one creator (check `data.creators.length > 0`).

#### CTA Container

Wrap both CTAs in a `hero__actions` flex container with `gap: var(--space-3)`, centering horizontally. On mobile (`--below-sm`), stack vertically with `flex-direction: column` and full-width buttons.

#### Branded Background Approach

No changes needed -- the existing CSS variable approach works. The layout injects `--brand-color`, `--brand-secondary`, etc. as inline styles on `.org-layout`. The hero's `background: linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary))` already picks these up via the `org-brand.css` derivation layer. Unbranded orgs fall back to platform defaults.

#### Responsive Behavior

| Breakpoint | Logo | Title | Padding | CTAs |
|---|---|---|---|---|
| `--below-sm` (<640px) | `--space-20` (80px) | `--text-2xl` | `--space-10` horiz `--space-4` | Stacked, full-width |
| `--breakpoint-sm`+ | `--space-28` (112px) | `--text-4xl` | `--space-20` horiz `--space-6` | Inline, auto-width |

---

### 2. Continue Watching Section

**Goal**: Authenticated users see their in-progress content from this org, encouraging re-engagement.

#### Auth Guard

- Section is only rendered when `data.continueWatching` is defined and has at least one item.
- `data.continueWatching` is only populated in the server loader when `locals.user` is present.
- Unauthenticated visitors see nothing -- no empty state, no "sign in to see progress" prompt. The section simply does not exist in the DOM.

#### Data Source

Server loader fetches from the library API with org and progress filters:

```typescript
// In +page.server.ts
const params = new URLSearchParams();
params.set('organizationId', org.id);
params.set('filter', 'in_progress');
params.set('limit', '6');
params.set('sortBy', 'recent');
params.set('sortOrder', 'desc');

const library = await api.access.getUserLibrary(params);
```

This returns `UserLibraryResponse` with items that have `progress` data (positionSeconds, durationSeconds, completed, percentComplete).

#### Card Layout

- Section heading: "Continue Watching" (new i18n key `org_continue_watching_title`).
- Horizontal scrolling row on mobile, 3-column grid on desktop (same `featured__grid` pattern).
- Each item renders as a `ContentCard` with the `progress` prop populated from the library item's progress data.
- "View Library" link (new i18n key `org_continue_watching_view_library`) pointing to `/library`.

#### Card Data Mapping

Each library item maps to ContentCard props as follows:

```typescript
{
  id: item.content.id,
  title: item.content.title,
  thumbnail: item.content.thumbnailUrl,
  description: item.content.description,
  contentType: item.content.contentType === 'written' ? 'article' : item.content.contentType,
  duration: item.content.durationSeconds,
  href: buildContentUrl(page.url, { slug: item.content.slug, id: item.content.id }),
  progress: item.progress ? {
    positionSeconds: item.progress.positionSeconds,
    durationSeconds: item.progress.durationSeconds,
    completed: item.progress.completed,
    percentComplete: item.progress.percentComplete,
  } : null,
}
```

Note: No `creator` prop on continue-watching cards (the user knows who the creators are -- this is their own org's library). No `price` prop (they already own/have access to this content).

#### Empty State Handling

- If `data.continueWatching` is `undefined` (unauthenticated) or empty array: do not render the section at all.
- No skeleton loading state needed -- this is SSR data, available on first paint.

---

### 3. New Releases Section

**Goal**: Highlight the newest published content separately from "Featured Content", giving visitors a sense of freshness.

#### Data Source

The current `featuredContent` fetch already gets the 6 newest items. The plan is to **rename** the existing fetch to serve as "New Releases" and optionally add a separate "Featured" concept later (curated/pinned). For this spec:

- Rename the existing `featuredContent` data key to `newReleases` in the server return value.
- Keep the same `getPublicContent({ orgId, limit: 6, sort: 'newest' })` call.
- The section heading changes from "Featured Content" to "New Releases" (new i18n key `org_new_releases_title`).

This avoids an additional API call while still achieving the design goal. If a curated "Featured" section is added later, it would be a separate data source with explicit content pinning.

#### Section Heading

- Title: "New Releases" (i18n: `org_new_releases_title`).
- "View All" link to `/explore` (reuse existing i18n key `org_view_all_content` or add `org_new_releases_view_all`).

#### Card Layout

Same responsive grid as current featured section:
- 1 column on mobile (`--below-sm`)
- 2 columns on small screens (`--breakpoint-sm`)
- 3 columns on large screens (`--breakpoint-lg`)

Uses `ContentCard` with the same prop mapping as the current featured grid (title, thumbnail, description, contentType, duration, creator, href, price).

#### Empty State

Same as current: centered muted text "No content available yet" (existing i18n key `org_no_content_yet`).

---

### 4. Creator Preview Section

**Goal**: Surface 2-3 creators with avatars to personalize the org and encourage exploration of the creators directory.

#### Data Source

Server loader calls `getPublicCreators({ slug: org.slug, limit: 3 })` from `$lib/remote/org.remote`. This returns:

```typescript
{
  items: Array<{
    name: string;
    avatarUrl: string | null;
    role: string;
    joinedAt: string;
    contentCount: number;
  }>;
  pagination: { page, limit, total, totalPages };
}
```

#### Section Layout

- Section heading: "Our Creators" (new i18n key `org_creators_preview_title`).
- "Meet All Creators" link (new i18n key `org_creators_preview_view_all`) pointing to `/creators`. Only shown when `pagination.total > 3` (more creators than displayed).
- Horizontal layout: flex row with `gap: var(--space-6)`, centered.

#### Creator Card Design

Each creator renders as a compact card (not a full `ContentCard` -- creators are not content). Use inline markup within the page component (no new component needed for 3 items):

```
[Avatar (48px circle)]
[Name]
[Role badge]
["{count} content items" subtitle]
```

Markup structure:

```svelte
<div class="creator-preview-card">
  <Avatar ...>
    <AvatarImage src={creator.avatarUrl} alt={creator.name} />
    <AvatarFallback>{creator.name.charAt(0).toUpperCase()}</AvatarFallback>
  </Avatar>
  <span class="creator-preview-card__name">{creator.name}</span>
  <Badge variant="neutral">{creator.role}</Badge>
  <span class="creator-preview-card__count">
    {m.org_creators_content_count({ count: String(creator.contentCount) })}
  </span>
</div>
```

#### CSS

```css
.creators-preview {
  padding: var(--space-12) var(--space-6);
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

.creators-preview__grid {
  display: flex;
  justify-content: center;
  gap: var(--space-8);
  flex-wrap: wrap;
}

.creator-preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6);
  background: var(--color-surface);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-lg);
  min-width: 180px;
  max-width: 240px;
  text-align: center;
  transition: var(--transition-shadow);
}

.creator-preview-card:hover {
  box-shadow: var(--shadow-md);
}

.creator-preview-card__name {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--color-text);
}

.creator-preview-card__count {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
```

Avatar size: `--space-12` (48px) -- use the Avatar component with explicit width/height class override.

#### Responsive

On `--below-sm`, stack creator cards vertically with full width. The flex-wrap handles this naturally but add `justify-content: center` to keep cards centered when wrapping.

#### Empty State

If `data.creators.items` is empty, do not render the section. This handles new orgs with no members beyond the owner.

---

## Implementation Plan

### Files to Modify

#### 1. `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts`

Replace the current single-fetch loader with parallel fetches:

```typescript
import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  platform,
  cookies,
  locals,
  setHeaders,
  parent,
}) => {
  const { org } = await parent();

  // Downgrade cache to PRIVATE if user is logged in (continue-watching data is personal)
  setHeaders(locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC);

  // Build parallel fetch promises
  const contentPromise = getPublicContent({
    orgId: org.id,
    limit: 6,
    sort: 'newest',
  });

  const creatorsPromise = getPublicCreators({
    slug: org.slug,
    limit: 3,
  });

  // Continue watching: only for authenticated users
  let continueWatchingPromise: Promise<unknown> | null = null;
  if (locals.user) {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('filter', 'in_progress');
    params.set('limit', '6');
    params.set('sortBy', 'recent');
    params.set('sortOrder', 'desc');
    continueWatchingPromise = api.access.getUserLibrary(params);
  }

  // Await all in parallel
  const [contentResult, creatorsResult, continueWatchingResult] =
    await Promise.all([
      contentPromise.catch(() => null),
      creatorsPromise.catch(() => null),
      continueWatchingPromise?.catch(() => null) ?? Promise.resolve(null),
    ]);

  return {
    newReleases: contentResult?.items ?? [],
    creators: {
      items: creatorsResult?.items ?? [],
      total: creatorsResult?.pagination?.total ?? 0,
    },
    continueWatching: continueWatchingResult?.items ?? undefined,
  };
};
```

Key decisions:
- Each fetch is wrapped in `.catch(() => null)` so one failure does not break the page.
- `continueWatching` returns `undefined` (not empty array) when unauthenticated, so the template can distinguish "not logged in" from "logged in but no progress".
- Cache header is `PRIVATE` when the user is logged in (response contains their library data), `DYNAMIC_PUBLIC` otherwise.

#### 2. `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`

Restructure the template into four sections. Section order from top to bottom:

1. **Hero** (always)
2. **Continue Watching** (auth + has items only)
3. **New Releases** (always, replaces "Featured Content")
4. **Creator Preview** (has creators only)

Changes:
- Import `Avatar`, `AvatarImage`, `AvatarFallback` from `$lib/components/ui/Avatar`.
- Import `Badge` from `$lib/components/ui/Badge`.
- Update `$derived` declarations: rename `featuredContent` to `newReleases`, add `creators`, `continueWatching`.
- Add new i18n message references.
- Add CTA buttons container and secondary CTA in hero.
- Add continue-watching section with progress-enabled ContentCards.
- Rename featured section heading to "New Releases".
- Add creator preview section with Avatar cards and Badge.
- Add new scoped CSS classes for the new sections.
- Update `hydrateIfNeeded` call from `data.featuredContent` to `data.newReleases`.

Template pseudostructure:

```svelte
<div class="org-landing">
  <!-- 1. Hero Section -->
  <section class="hero">
    <div class="hero__inner">
      {#if logoUrl}<img ... class="hero__logo" />{/if}
      <h1 class="hero__title">{orgName}</h1>
      {#if orgDescription}<p class="hero__description">{orgDescription}</p>{/if}
      <div class="hero__actions">
        <a href="/explore" class="hero__cta">{m.org_hero_explore()}</a>
        {#if creators.items.length > 0}
          <a href="/creators" class="hero__cta hero__cta--secondary">
            {m.org_creators_preview_view_all()}
          </a>
        {/if}
      </div>
    </div>
  </section>

  <!-- 2. Continue Watching (auth only, non-empty only) -->
  {#if continueWatching && continueWatching.length > 0}
    <section class="continue-watching">
      <div class="section-header">
        <h2>{m.org_continue_watching_title()}</h2>
        <a href="/library">{m.org_continue_watching_view_library()} &rarr;</a>
      </div>
      <div class="content-grid">
        {#each continueWatching as item (item.content.id)}
          <ContentCard
            id={item.content.id}
            title={item.content.title}
            thumbnail={item.content.thumbnailUrl}
            description={item.content.description}
            contentType={item.content.contentType === 'written' ? 'article' : item.content.contentType}
            duration={item.content.durationSeconds}
            href={buildContentUrl(page.url, { slug: item.content.slug, id: item.content.id })}
            progress={item.progress}
          />
        {/each}
      </div>
    </section>
  {/if}

  <!-- 3. New Releases -->
  <section class="new-releases">
    <div class="section-header">
      <h2>{m.org_new_releases_title()}</h2>
      {#if newReleases.length > 0}
        <a href="/explore">{m.org_view_all_content()} &rarr;</a>
      {/if}
    </div>
    {#if newReleases.length > 0}
      <div class="content-grid">
        {#each newReleases as item (item.id)}
          <ContentCard ... />  <!-- same props as current featured -->
        {/each}
      </div>
    {:else}
      <div class="empty-state"><p>{m.org_no_content_yet()}</p></div>
    {/if}
  </section>

  <!-- 4. Creator Preview -->
  {#if creators.items.length > 0}
    <section class="creators-preview">
      <div class="section-header">
        <h2>{m.org_creators_preview_title()}</h2>
        {#if creators.total > 3}
          <a href="/creators">{m.org_creators_preview_view_all()} &rarr;</a>
        {/if}
      </div>
      <div class="creators-preview__grid">
        {#each creators.items as creator (creator.name)}
          <div class="creator-preview-card">
            <Avatar class="creator-preview-card__avatar">
              <AvatarImage src={creator.avatarUrl} alt={creator.name} />
              <AvatarFallback>{creator.name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span class="creator-preview-card__name">{creator.name}</span>
            <Badge variant="neutral">{creator.role}</Badge>
            <span class="creator-preview-card__count">
              {m.org_creators_content_count({ count: String(creator.contentCount) })}
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
```

#### 3. `apps/web/messages/en.json`

Add new i18n keys:

```json
{
  "org_continue_watching_title": "Continue Watching",
  "org_continue_watching_view_library": "View Library",
  "org_new_releases_title": "New Releases",
  "org_new_releases_view_all": "View all content",
  "org_creators_preview_title": "Our Creators",
  "org_creators_preview_view_all": "Meet All Creators"
}
```

### CSS Refactoring Notes

The current page has two BEM blocks (`.hero` and `.featured`). With four sections, extract shared patterns:

- **`.section-header`**: Reusable flex row for section title + "View All" link. Replaces `.featured__header`, `.featured__title`, `.featured__view-all`.
- **`.content-grid`**: Reusable responsive grid (1/2/3 col). Replaces `.featured__grid`.
- **`.empty-state`**: Reusable centered empty text. Replaces `.featured__empty`.

This keeps the `<style>` block manageable and avoids duplicating grid definitions for continue-watching and new-releases sections.

### Section-Specific CSS

| Section | New CSS classes |
|---|---|
| Hero | `.hero__actions` (flex row for CTAs), `.hero__cta--secondary` (ghost variant) |
| Continue Watching | `.continue-watching` (section wrapper with padding/max-width) |
| New Releases | `.new-releases` (section wrapper, same as continue-watching) |
| Creator Preview | `.creators-preview`, `.creators-preview__grid`, `.creator-preview-card`, `.creator-preview-card__avatar`, `.creator-preview-card__name`, `.creator-preview-card__count` |

All spacing, colors, borders, radii, typography, and shadows MUST use design tokens. No hardcoded values.

---

## Testing Notes

- **Unauthenticated visitor**: Should see Hero, New Releases, Creator Preview. Should NOT see Continue Watching. Page should be edge-cacheable (`Cache-Control: public`).
- **Authenticated visitor with no progress**: Should see Hero, New Releases, Creator Preview. Continue Watching section should be absent (not an empty state).
- **Authenticated visitor with in-progress content**: All four sections visible. Continue Watching shows progress bars on ContentCards.
- **New org with no content or creators**: Hero visible (always). New Releases shows empty state. Creator Preview and Continue Watching both absent.
- **Org with custom branding**: Hero gradient should use the org's brand colors. Verify `--color-brand-primary` and `--color-brand-secondary` are applied. Verify `--color-text-on-brand` contrast.
- **Org with no branding set**: Hero should use platform default colors. No visual breakage.
- **Mobile (< 640px)**: Hero CTAs stack vertically. Content grids collapse to single column. Creator cards wrap and center.
- **Tablet (640-1024px)**: Content grids show 2 columns. Creator cards stay in a row.
- **Desktop (> 1024px)**: Content grids show 3 columns. Creator cards in a centered row.
- **API failure resilience**: If `getPublicCreators` fails, the page should still render without the creator section. If `getUserLibrary` fails, the page should still render without continue-watching. Each fetch is independently error-handled via `.catch(() => null)`.
- **Data staleness**: The org layout's version invalidation system handles content and library staleness. No additional wiring needed for this page since it uses server-fetched data (not live queries from collections).
