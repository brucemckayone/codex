# Content Detail UX — Implementation Spec

## Summary

Five related improvements to the content detail page that collectively transform it from a flat metadata-and-player view into a conversion-optimized, context-rich experience:

1. **Shared ContentDetailView component** (1.33) — Extract the ~95% identical markup shared between the org and creator content detail pages into a single reusable component. This is the foundation for all other changes.
2. **Two-state layout** (1.22) — Distinct visual treatment for preview (not purchased) vs full-access (purchased) state. Uses the existing `hasAccess` boolean from page data.
3. **Content detail preview state** (1.40) — For preview: auto-play preview clip (muted), gradient overlay on thumbnail, prominent purchase CTA, trust signals.
4. **"What you'll get" section** (1.23) — Static template below purchase CTA: "HD video", "Lifetime access", "Progress tracking", "Watch on any device". No API needed.
5. **Related content by same creator** (1.24) — Show 3-4 other content items by the same creator. Uses `getPublicContent(orgId, sort=newest)` and client-side filter by `creator.id`.

**Effort estimate**: ~6-8 hours. The shared component extraction (step 1) is the bulk of the work; the remaining features are additive markup/CSS within that component.

---

## Feasibility

### Pros

- **No backend changes required.** All data is already available: `hasAccess`, `streamingUrl`, `previewUrl`, `priceCents`, `content.creator`, `content.organization`. The related content feature uses the existing `getPublicContent()` remote function.
- **PreviewPlayer already exists and works.** The `$lib/components/player/PreviewPlayer.svelte` component handles HLS preview playback with a 30-second time limit, CTA overlay, and access state. It already supports muted auto-play (just needs the `autoplay muted` attributes wired through).
- **AccessState system is proven.** The `deriveAccessState()` utility and `AccessState` type already model the exact states needed: `unlocked`, `preview`, `locked` (with `auth_required` / `purchase_required` reasons).
- **ContentCard component is reusable.** The existing `ContentCard` component in `ui/ContentCard/` accepts all the props needed for the related content grid (thumbnail, title, duration, price, creator, href).
- **i18n is in place.** Both pages already import `$paraglide/messages` and use message keys for all user-facing strings. New static strings ("HD video", "Lifetime access", etc.) just need new message keys.

### Gotchas & Risks

- **Key difference: org vs creator pages are nearly identical but not quite.** The two pages differ in three specific ways that the shared component must accommodate via props:
  1. **Page title**: Org uses `data.org?.name ?? 'Codex'`, creator uses `creatorName` (derived from `data.creatorProfile?.name ?? data.username`).
  2. **Creator display**: Org page shows a plain text "By {creator}" line. Creator page wraps it in a link (`<a href="/{data.username}">`).
  3. **Checkout success URL**: Org includes `contentSlug` only. Creator includes both `contentSlug` and `username`. This difference lives in the `+page.server.ts` form actions, not the Svelte template, so it does not affect the shared component.

  Extracting the shared component is the foundation for all other changes. Getting the prop interface right is critical.

- **Related content fetch adds one API call per page load.** The `getPublicContent()` call fetches published content for the org. On the org content detail page, `org.id` is available from parent layout data. On the creator content detail page, `content.organization?.id` may be null for personal (non-org) content. The related section must gracefully handle the null case by not rendering.
- **Preview auto-play and browser policies.** Browsers block auto-play of unmuted video. The preview clip must start muted with `autoplay muted playsinline` attributes. The PreviewPlayer component already uses `playsinline` but does not currently auto-play. Adding `autoplay muted` to the `<video>` element is straightforward, but some browsers may still block auto-play if the user has not interacted with the page. A play button fallback is needed.
- **"What you'll get" content is static but should be i18n-ready.** The four items (HD video, Lifetime access, Progress tracking, Watch on any device) need paraglide message keys even though they are currently English-only.

---

## Current State

### Both Pages Side-by-Side

| Aspect | Org Page | Creator Page |
|--------|----------|--------------|
| **Path** | `_org/[slug]/(space)/content/[contentSlug]/` | `_creators/[username]/content/[contentSlug]/` |
| **Lines of Svelte** | ~503 (template + scoped CSS) | ~505 (template + scoped CSS) |
| **Lines of CSS** | ~260 | ~265 |
| **Imports** | `VideoPlayer`, `PreviewPlayer`, `deriveAccessState`, `hydrateIfNeeded`, `formatPrice`, `formatDurationHuman`, `LockIcon` | Identical, plus `page` from `$app/state` |
| **Props** | `data: PageData`, `form` | `data: PageData`, `form` |
| **Reactive state** | `purchasing`, `contentTypeBadge`, `creatorName`, `description`, `thumbnailUrl`, `duration`, `priceCents`, `isPaid`, `isFree`, `needsPurchase`, `previewUrl`, `accessState` | Identical |

### Template Sections (identical in both)

1. `<svelte:head>` — OG meta tags (title differs)
2. Player section — VideoPlayer (access), PreviewPlayer (preview), thumbnail+lock (locked)
3. Info section: title, content type badge, duration, creator name
4. Completed badge
5. Purchase section (paid CTA / free CTA)
6. Description
7. Written content body (`contentBodyHtml`)

### Differences (exhaustive)

| # | Difference | Org | Creator |
|---|-----------|-----|---------|
| 1 | `<title>` suffix | `data.org?.name ?? 'Codex'` | `creatorName` |
| 2 | `creatorName` derivation | `data.content.creator?.name ?? data.content.creator?.email ?? ''` | `data.creatorProfile?.name ?? data.username` |
| 3 | Creator line | `<p>` with plain text | `<p><a href="/{data.username}">` with link |
| 4 | CSS for creator link | None | `.content-detail__creator-link` + `:hover` styles |
| 5 | `page` import | Not imported | `import { page } from '$app/state'` (not used in template) |

All CSS is identical between the two files except for the 6 extra lines for the creator link hover styles.

### How Access State Is Determined

Both `+page.server.ts` loaders follow the same pattern:

```
1. Fetch content (public endpoint, no auth)
2. If unauthenticated → return hasAccess: false, streamingUrl: null
3. If authenticated → Promise.all([getStreamingUrl, getProgress])
   - getStreamingUrl succeeds → hasAccess: true, streamingUrl: url
   - getStreamingUrl 403/fails → hasAccess: false, streamingUrl: null
```

The template then uses `hasAccess` + `previewUrl` (from `content.mediaItem.hlsPreviewUrl`) + `data.user` to call `deriveAccessState()`, which returns one of: `unlocked`, `preview`, `locked { auth_required }`, `locked { purchase_required }`.

---

## Design Spec

### 1. Shared ContentDetailView Component

Extract all shared markup and CSS into a single component at `$lib/components/content/ContentDetailView.svelte`.

#### Props Interface

```typescript
interface Props {
  /** The content item with all relations */
  content: ContentWithRelations;
  /** Rendered HTML for written content body (from server) */
  contentBodyHtml: string | null;
  /** Whether the current user has full access */
  hasAccess: boolean;
  /** HLS streaming URL (null if no access) */
  streamingUrl: string | null;
  /** Playback progress (null if no progress or unauthenticated) */
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
  } | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Form state from SvelteKit form actions (checkout errors, session URL) */
  formResult: { sessionUrl?: string; checkoutError?: string } | null;
  /** Purchasing in-flight state (controlled by parent for form enhance) */
  purchasing: boolean;
  /** Display name for the creator */
  creatorName: string;
  /** Suffix for the <title> tag (org name or creator name) */
  titleSuffix: string;
  /** Optional: snippet for custom creator attribution line */
  creatorAttribution?: Snippet;
  /** Optional: related content items for "More from this creator" */
  relatedContent?: ContentWithRelations[];
  /** Optional: href builder for related content cards */
  buildRelatedHref?: (item: ContentWithRelations) => string;
}
```

#### What Moves Into the Shared Component

Everything that is currently duplicated:

- `<svelte:head>` block (parameterized by `titleSuffix`)
- Player section (VideoPlayer / PreviewPlayer / locked thumbnail)
- Info section (title, badge, duration)
- Completed badge
- Purchase section (paid CTA, free CTA) -- the `<form>` element stays in the parent page because it needs `use:enhance` with the page-specific `handlePurchase` callback and the form `action` URL. The shared component renders a `purchaseForm` snippet slot instead.
- Description
- Written content body
- "What you'll get" section (new)
- Related content section (new)
- All scoped CSS

#### What Stays Page-Specific

Each `+page.svelte` retains:

1. **The `<form>` for checkout** — because `use:enhance` and form actions are page-specific. The page passes a `purchaseForm` snippet to the shared component.
2. **`onMount` hydration** — `hydrateIfNeeded('content', [data.content])` stays in the page because it references page-specific data.
3. **`handlePurchase` callback** — the enhance handler with redirect logic.
4. **Data derivations specific to context** — `creatorName` derivation differs, so each page computes it and passes it as a prop.

#### Snippet Approach for Purchase Form

The purchase section in the shared component uses a `purchaseForm` snippet slot:

```svelte
<!-- In ContentDetailView.svelte -->
{#if needsPurchase}
  <div class="content-detail__purchase">
    <div class="content-detail__price">
      <span class="content-detail__price-amount">{displayPrice(priceCents)}</span>
      <span class="content-detail__price-label">{m.content_detail_purchase_cta_description()}</span>
    </div>

    {#if formResult?.checkoutError}
      <p class="content-detail__purchase-error" role="alert">{formResult.checkoutError}</p>
    {/if}

    {#if isAuthenticated}
      {@render purchaseForm()}
    {:else}
      <a href="/login" class="content-detail__purchase-btn content-detail__purchase-btn--link">
        {m.checkout_signin_to_purchase()}
      </a>
    {/if}

    <!-- "What you'll get" section renders here (see section 4) -->
  </div>
{/if}
```

#### Snippet Approach for Creator Attribution

The creator line differs between org (plain text) and creator (linked). The shared component accepts an optional `creatorAttribution` snippet, falling back to a default plain-text rendering:

```svelte
<!-- In ContentDetailView.svelte -->
{#if creatorAttribution}
  {@render creatorAttribution()}
{:else if creatorName}
  <p class="content-detail__creator">
    {m.content_detail_by_creator({ creator: creatorName })}
  </p>
{/if}
```

The creator page passes a snippet:

```svelte
<!-- In creator +page.svelte -->
<ContentDetailView {content} ...>
  {#snippet creatorAttribution()}
    <p class="content-detail__creator">
      <a href="/{data.username}" class="content-detail__creator-link">
        {m.content_detail_by_creator({ creator: creatorName })}
      </a>
    </p>
  {/snippet}
  ...
</ContentDetailView>
```

#### File Location

```
apps/web/src/lib/components/content/
  ContentDetailView.svelte   — Shared component (new)
  index.ts                   — Barrel export (new)
```

Using `content/` as the directory name (not `ui/`) because this is a domain-specific composite component, not a generic UI primitive.

---

### 2. Two-State Layout

The page presents two visually distinct experiences based on `hasAccess`:

#### Full-Access State (hasAccess === true)

When the user owns the content:

- **Player area**: Full VideoPlayer with media-chrome controls, progress tracking, keyboard shortcuts.
- **Info section**: Standard layout -- title, badge, duration, creator, description.
- **No purchase section**: The purchase card is not rendered.
- **Progress badge**: Shows "Completed" badge if `progress.completed` is true.
- **Related content**: Still shown at the bottom (encourages further browsing).

This is the current behavior and does not change significantly.

#### Preview State (hasAccess === false)

When the user has not purchased or is not authenticated:

- **Player area**: One of three sub-states (see section 3 for preview enhancement details):
  - **Preview available** (`accessState.status === 'preview'`): PreviewPlayer with muted auto-play, "Preview" badge, gradient overlay after 30s, CTA overlay.
  - **No preview, has thumbnail** (`accessState.status === 'locked'`): Static thumbnail with dark overlay, lock icon, purchase CTA text.
  - **No preview, no thumbnail**: Placeholder with lock icon and CTA.
- **Info section**: Same layout as full-access.
- **Purchase card**: Prominent card with price, CTA button, and "What you'll get" section.
- **Related content**: Shown at the bottom.

#### Visual Differentiation

The two states are differentiated by a `data-access` attribute on the root element:

```svelte
<div class="content-detail" data-access={hasAccess ? 'full' : 'preview'}>
```

This enables CSS targeting for state-specific styles without duplicating markup:

```css
/* Preview state: tighter spacing above purchase card to create visual urgency */
.content-detail[data-access="preview"] .content-detail__purchase {
  margin-top: var(--space-2);
}

/* Full-access state: more relaxed spacing */
.content-detail[data-access="full"] .content-detail__info {
  gap: var(--space-5);
}
```

---

### 3. Preview State Enhancement

Enhancements to the preview/locked player area for users without access.

#### Auto-Play Preview Clip

When `accessState.status === 'preview'` (an HLS preview URL exists):

- The PreviewPlayer component receives a new `autoplay` prop (default `false`).
- When `autoplay` is true, the `<video>` element gets `autoplay muted` attributes.
- On `initPlayer()`, after HLS attaches, call `videoEl.play().catch(() => {})` as a fallback for browsers that block auto-play even with `muted`.
- The preview badge ("Preview") is already rendered by PreviewPlayer.

```svelte
<!-- In ContentDetailView.svelte, preview branch -->
<PreviewPlayer
  previewUrl={previewUrl}
  poster={thumbnailUrl}
  contentId={content.id}
  contentTitle={content.title}
  {accessState}
  autoplay={true}
/>
```

Changes to `PreviewPlayer.svelte`:

```typescript
interface Props {
  // ... existing props ...
  autoplay?: boolean;  // NEW
}

const { ..., autoplay = false }: Props = $props();
```

In the `<video>` element:

```svelte
<video
  bind:this={videoEl}
  playsinline
  preload="metadata"
  poster={poster}
  muted={autoplay}
  oncanplay={handleCanPlay}
  onerror={handleError}
  ontimeupdate={handleTimeUpdate}
  onended={handleEnded}
></video>
```

In `initPlayer()`, after HLS is created:

```typescript
if (autoplay && videoEl) {
  videoEl.play().catch(() => {
    // Browser blocked auto-play; user must click play manually
  });
}
```

#### Gradient Overlay on Locked Thumbnail

When there is no preview URL and the content is locked, enhance the existing overlay with a bottom-to-top gradient instead of a flat dark overlay. This creates a more cinematic feel:

```css
.content-detail__preview-overlay {
  background: linear-gradient(
    to top,
    color-mix(in srgb, black 80%, transparent) 0%,
    color-mix(in srgb, black 40%, transparent) 50%,
    color-mix(in srgb, black 20%, transparent) 100%
  );
}
```

#### Lock Icon and CTA Prominence

The locked thumbnail overlay already shows a `LockIcon` and CTA text. Enhance with:

- Increase lock icon size from 32 to 40 for better visibility.
- Add a subtle pulsing animation to the lock icon (respects `prefers-reduced-motion`):

```css
.content-detail__lock-icon {
  animation: lock-pulse 2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .content-detail__lock-icon {
    animation: none;
  }
}

@keyframes lock-pulse {
  0%, 100% { opacity: var(--opacity-90); }
  50% { opacity: var(--opacity-60); }
}
```

---

### 4. "What You'll Get" Section

A static list of value propositions displayed inside the purchase card, below the CTA button. This section only renders when `needsPurchase` or (`isFree && !hasAccess`).

#### Layout

```
+------------------------------------------+
| £29.00                                   |
| One-time purchase                        |
|                                          |
| [  Purchase for £29.00  ]               |
|                                          |
| What you'll get                          |
| ✓ HD video                              |
| ✓ Lifetime access                       |
| ✓ Progress tracking                     |
| ✓ Watch on any device                   |
+------------------------------------------+
```

#### Markup

```svelte
<div class="content-detail__benefits">
  <h3 class="content-detail__benefits-heading">{m.content_detail_benefits_heading()}</h3>
  <ul class="content-detail__benefits-list">
    <li class="content-detail__benefits-item">
      <CheckIcon size={16} class="content-detail__benefits-icon" />
      <span>{m.content_detail_benefit_hd_video()}</span>
    </li>
    <li class="content-detail__benefits-item">
      <CheckIcon size={16} class="content-detail__benefits-icon" />
      <span>{m.content_detail_benefit_lifetime_access()}</span>
    </li>
    <li class="content-detail__benefits-item">
      <CheckIcon size={16} class="content-detail__benefits-icon" />
      <span>{m.content_detail_benefit_progress_tracking()}</span>
    </li>
    <li class="content-detail__benefits-item">
      <CheckIcon size={16} class="content-detail__benefits-icon" />
      <span>{m.content_detail_benefit_any_device()}</span>
    </li>
  </ul>
</div>
```

#### Content-Type Awareness

The first benefit item adapts based on `content.contentType`:

| contentType | Benefit text |
|-------------|-------------|
| `video` | "HD video" |
| `audio` | "High-quality audio" |
| `written` | "Full article" |

This is handled with a derived value:

```typescript
const primaryBenefit = $derived(
  content.contentType === 'video'
    ? m.content_detail_benefit_hd_video()
    : content.contentType === 'audio'
      ? m.content_detail_benefit_hq_audio()
      : m.content_detail_benefit_full_article()
);
```

#### Styles

```css
.content-detail__benefits {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-width) var(--border-style) var(--color-border);
}

.content-detail__benefits-heading {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  margin: 0 0 var(--space-3);
}

.content-detail__benefits-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.content-detail__benefits-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.content-detail__benefits-icon {
  color: var(--color-success-600);
  flex-shrink: 0;
}
```

#### New i18n Message Keys

| Key | English value |
|-----|---------------|
| `content_detail_benefits_heading` | "What you'll get" |
| `content_detail_benefit_hd_video` | "HD video" |
| `content_detail_benefit_hq_audio` | "High-quality audio" |
| `content_detail_benefit_full_article` | "Full article" |
| `content_detail_benefit_lifetime_access` | "Lifetime access" |
| `content_detail_benefit_progress_tracking` | "Progress tracking" |
| `content_detail_benefit_any_device` | "Watch on any device" |

---

### 5. Related Content Section

A "More from {creator}" section at the bottom of the page showing 3-4 other published content items by the same creator.

#### Data Source

The org content detail page's `+page.server.ts` already fetches content via `getPublicContent({ orgId, slug, limit: 1 })`. To get related content, add a parallel fetch:

```typescript
// In +page.server.ts, after content is fetched
const relatedPromise = getPublicContent({
  orgId: org.id,
  sort: 'newest',
  limit: 5,  // Fetch 5 to have room after filtering out current item
}).catch(() => null);
```

The creator content detail page works similarly, but must guard against `content.organization?.id` being null:

```typescript
const relatedPromise = content.organization?.id
  ? getPublicContent({
      orgId: content.organization.id,
      sort: 'newest',
      limit: 5,
    }).catch(() => null)
  : Promise.resolve(null);
```

#### Client-Side Filtering

The shared component receives `relatedContent` as a prop and filters in a derived:

```typescript
const filteredRelated = $derived(
  (relatedContent ?? [])
    .filter((item) =>
      item.id !== content.id &&
      item.creator?.id === content.creator?.id
    )
    .slice(0, 4)
);
```

Filtering by `creator.id` ensures we show content by the same creator, not just any content in the org. Capping at 4 keeps the section compact.

#### Layout

The section renders below the description/body, separated by a horizontal rule:

```
───────────────────────────────────────────
More from {creatorName}

[Card 1]  [Card 2]  [Card 3]  [Card 4]
```

On mobile, the cards stack in a single column. On tablet+, they form a 2-column grid. On desktop, 4-column.

#### Markup

```svelte
{#if filteredRelated.length > 0}
  <section class="content-detail__related">
    <h2 class="content-detail__related-heading">
      {m.content_detail_more_from_creator({ creator: creatorName })}
    </h2>
    <div class="content-detail__related-grid">
      {#each filteredRelated as item (item.id)}
        <ContentCard
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailUrl}
          description={item.description}
          contentType={item.contentType === 'written' ? 'article' : item.contentType}
          duration={item.mediaItem?.durationSeconds}
          href={buildRelatedHref?.(item) ?? `/content/${item.slug ?? item.id}`}
          price={item.priceCents != null
            ? { amount: item.priceCents, currency: 'GBP' }
            : null}
        />
      {/each}
    </div>
  </section>
{/if}
```

#### buildRelatedHref

Each page provides a `buildRelatedHref` function as a prop, because link construction differs:

- **Org page**: Uses `buildContentUrl(page.url, item)` which handles org subdomain routing.
- **Creator page**: Uses `/${data.username}/content/${item.slug ?? item.id}` for same-creator links.

```svelte
<!-- Org page -->
<ContentDetailView
  buildRelatedHref={(item) => buildContentUrl(page.url, item)}
  ...
/>

<!-- Creator page -->
<ContentDetailView
  buildRelatedHref={(item) => `/${data.username}/content/${item.slug ?? item.id}`}
  ...
/>
```

#### Styles

```css
.content-detail__related {
  margin-top: var(--space-8);
  padding-top: var(--space-6);
  border-top: var(--border-width) var(--border-style) var(--color-border);
}

.content-detail__related-heading {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  margin: 0 0 var(--space-4);
}

.content-detail__related-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (--breakpoint-sm) {
  .content-detail__related-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (--breakpoint-lg) {
  .content-detail__related-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

#### New i18n Message Key

| Key | English value |
|-----|---------------|
| `content_detail_more_from_creator` | "More from {creator}" |

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/content/ContentDetailView.svelte` | Shared content detail component (~350 lines template + CSS) |
| `apps/web/src/lib/components/content/index.ts` | Barrel export: `export { default as ContentDetailView } from './ContentDetailView.svelte'` |

### Files to Modify

| File | Changes |
|------|---------|
| **`apps/web/src/lib/components/player/PreviewPlayer.svelte`** | Add `autoplay` prop (default `false`). When true, add `muted` to `<video>`, call `videoEl.play().catch(noop)` after HLS init. ~10 lines changed. |
| **`_org/[slug]/(space)/content/[contentSlug]/+page.svelte`** | Replace ~400 lines of template/CSS with ~60 lines: imports, data derivations, `<ContentDetailView>` with snippets for `purchaseForm` and `creatorAttribution`. |
| **`_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`** | Add parallel `getPublicContent()` call for related content (~8 lines). Return `relatedContent` in load result. |
| **`_creators/[username]/content/[contentSlug]/+page.svelte`** | Same reduction as org page. Replace ~400 lines with ~65 lines. Creator-specific: `creatorAttribution` snippet with `<a>` link, different `buildRelatedHref`. |
| **`_creators/[username]/content/[contentSlug]/+page.server.ts`** | Add parallel `getPublicContent()` call for related content (~10 lines, with null guard on `organization.id`). Return `relatedContent` in load result. |
| **Paraglide messages** | Add 8 new message keys (see sections 4 and 5 above). |

### Recommended Implementation Order

1. **Create `ContentDetailView.svelte`** — Copy org page template and CSS wholesale, then parameterize the three differences via props/snippets. This is a mechanical extraction.
2. **Refactor org page** — Import `ContentDetailView`, wire props, verify identical rendering.
3. **Refactor creator page** — Same, with creator-specific snippets. Verify identical rendering.
4. **Add `autoplay` to PreviewPlayer** — Small prop addition + play() call.
5. **Add two-state layout** — Add `data-access` attribute, adjust spacing CSS.
6. **Add "What you'll get"** — Static markup inside the purchase card section of `ContentDetailView`. Add i18n keys.
7. **Add related content** — Modify both `+page.server.ts` loaders to fetch related content. Add section markup and CSS to `ContentDetailView`. Add i18n key.

Steps 1-3 can be verified independently before proceeding. Steps 4-7 are additive and can be done in any order after 1-3.

---

## Testing Notes

- **Shared component extraction (steps 1-3)**: The goal is pixel-perfect visual parity. After refactoring, both pages should render identically to their pre-refactor state. Verify:
  - Org content detail page with full access (VideoPlayer renders, no purchase card).
  - Org content detail page without access, paid content (purchase card renders, PreviewPlayer or locked thumbnail).
  - Org content detail page without access, free content ("Free" badge, sign-in link).
  - Creator content detail page with all three states above.
  - Written content type (no player section, `contentBodyHtml` renders).
  - Creator link is plain text on org page, clickable link on creator page.
  - OG meta tags render correctly for both pages.
  - Checkout form still works: clicking purchase redirects to Stripe.

- **Preview auto-play (step 4)**: Navigate to a content detail page with preview available while unauthenticated. The preview clip should begin playing muted. Verify it stops at 30 seconds and shows the CTA overlay. Verify the play/pause/mute controls still work.

- **Two-state layout (step 5)**: Compare the page with and without access. The preview state should feel more conversion-focused (tighter spacing above purchase card). The full-access state should feel relaxed and reading-focused.

- **"What you'll get" (step 6)**: Verify the section appears inside the purchase card for paid content. Verify the first item changes based on content type (video/audio/written). Verify it does not appear when the user has access.

- **Related content (step 7)**: Verify 3-4 cards appear at the bottom. Verify the current content item is excluded. Verify cards link to the correct URLs. Verify the section does not render when there are no other items by the same creator. Verify the section does not render for personal (non-org) content on the creator page where `organization.id` is null.

- **Responsive**: All new sections must look correct at mobile (< 640px), tablet (640-1024px), and desktop (> 1024px) breakpoints. The related content grid should collapse from 4 columns to 2 to 1.

- **Accessibility**: The "What you'll get" list uses semantic `<ul>/<li>`. The related content section uses a `<section>` with an `<h2>` heading. Check icon contrast against the surface background. Verify `prefers-reduced-motion` disables the lock icon pulse animation.
