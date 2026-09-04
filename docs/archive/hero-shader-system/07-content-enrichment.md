# 07 — Hero Content Enrichment (Non-Shader)

**Purpose**: Enhance the hero section with richer content using data already available in the API, independent of the shader system. These changes can ship separately.

---

## 1. Current Hero Content

```svelte
<section class="hero">
  <div class="hero__inner">
    <img class="hero__logo" />     <!-- Org logo -->
    <h1 class="hero__title" />     <!-- Org name -->
    <p class="hero__description" /> <!-- Org description -->
    <div class="hero__actions">
      <a class="hero__cta" />       <!-- "Explore" -->
      <a class="hero__cta" />       <!-- "Browse Creators" -->
    </div>
  </div>
</section>
```

**Problems**:
- No social proof (how many creators? how much content?)
- No social links (API has them, hero doesn't render them)
- Generic CTA text (doesn't respond to org feature flags)
- No personality (every org hero looks the same except colors)

---

## 2. Proposed Enhanced Layout

```
┌──────────────────────────────────────────────────┐
│                 (shader canvas)                   │
│                                                   │
│              ┌──────────┐                        │
│              │   LOGO   │                        │
│              └──────────┘                        │
│                                                   │
│           Organization Name                       │
│                                                   │
│        A brief description of what               │
│         this organization does                    │
│                                                   │
│       ┌──────────┐  ┌──────────────┐            │
│       │ Explore  │  │ Browse Creators│            │  ← Smart CTAs
│       └──────────┘  └──────────────┘            │
│                                                   │
│     👤 👤 👤 👤 👤 +3 more                      │  ← Creator avatar strip
│     12 Creators · 47 Titles                      │  ← Stats bar
│                                                   │
│       🐦  ▶  📷  🎵                             │  ← Social links
│                                                   │
└──────────────────────────────────────────────────┘
```

---

## 3. Creator Avatar Strip

### Data Source

`data.creators` is already streamed on the org landing page (from `getPublicCreators`). Currently used only in the "Creator Preview" section below the hero. We can also render a compact strip inside the hero.

### Implementation

```svelte
{#await data.creators then creators}
  {#if creators.items.length > 0}
    <div class="hero__creators">
      <div class="hero__avatar-strip">
        {#each creators.items.slice(0, 5) as creator}
          <Avatar size="xs" class="hero__avatar">
            <AvatarImage src={creator.avatarUrl} alt={creator.name} />
            <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
          </Avatar>
        {/each}
        {#if creators.total > 5}
          <span class="hero__avatar-overflow">+{creators.total - 5}</span>
        {/if}
      </div>
    </div>
  {/if}
{/await}
```

### Styling

```css
.hero__avatar-strip {
  display: flex;
  justify-content: center;
}

:global(.hero__avatar) {
  width: var(--space-8);
  height: var(--space-8);
  border: 2px solid color-mix(in srgb, white 40%, transparent);
  margin-left: calc(-1 * var(--space-2)); /* Overlap */
}

:global(.hero__avatar:first-child) {
  margin-left: 0;
}

.hero__avatar-overflow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-8);
  height: var(--space-8);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, white 20%, transparent);
  border: 2px solid color-mix(in srgb, white 40%, transparent);
  color: var(--color-text-on-brand);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  margin-left: calc(-1 * var(--space-2));
}
```

---

## 4. Stats Bar

### Data Sources

- **Creator count**: `data.creators.total` (streamed, from pagination)
- **Content count**: `data.newReleases.length` is capped at 6 — for the real total, we'd need `pagination.total` from the content response

**Option A**: Extend `getPublicContent` to return pagination (currently returns only items).
**Option B**: Add `total` to the `creatorsPromise` response (already available).
**Option C**: Use the counts we have: `creators.total` (accurate) + `newReleases.length` (capped, display as "6+ titles").

Recommended: **Option A** — return pagination from `getPublicContent` so we have accurate counts.

### Implementation

```svelte
{#await data.creators then creators}
  {#if creators.items.length > 0 || newReleases.length > 0}
    <p class="hero__stats">
      {#if creators.total > 0}
        <span>{creators.total} {creators.total === 1 ? 'Creator' : 'Creators'}</span>
      {/if}
      {#if creators.total > 0 && newReleases.length > 0}
        <span class="hero__stats-separator" aria-hidden="true">·</span>
      {/if}
      {#if newReleases.length > 0}
        <span>{contentTotal} Titles</span>
      {/if}
    </p>
  {/if}
{/await}
```

### Styling

```css
.hero__stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-on-brand);
  opacity: var(--opacity-70);
  margin-top: var(--space-2);
}

.hero__stats-separator {
  opacity: var(--opacity-50);
}
```

---

## 5. Social Links

### Data Source

Contact settings from `GET /api/organizations/:id/settings/contact`:
```typescript
{
  twitterUrl: string | null;
  youtubeUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}
```

**Problem**: This data is NOT currently loaded on the org landing page. It's loaded in studio settings.

### Solution: Extend Public Info Endpoint

The cleanest approach is to include social URLs in the existing `GET /api/organizations/public/:slug/info` response. This endpoint is already called by the org layout server load. Benefits:
- One API call (no additional fetch)
- Data cached alongside branding (30min TTL)
- Available to every page in the org layout, not just the landing page

**API change**: Add to the `fetchPublicOrgInfo` function in `workers/organization-api/src/routes/organizations.ts`:
```typescript
// Extend response to include social URLs from contact settings
socialLinks: {
  twitter: contactSettings?.twitterUrl ?? null,
  youtube: contactSettings?.youtubeUrl ?? null,
  instagram: contactSettings?.instagramUrl ?? null,
  tiktok: contactSettings?.tiktokUrl ?? null,
}
```

**Alternative**: If extending the public endpoint is too broad, add a separate `data.socialLinks` to the page server load that fetches contact settings directly.

### Implementation (Assuming Data Available)

```svelte
{#if data.org.socialLinks}
  {@const links = data.org.socialLinks}
  {@const hasSocial = links.twitter || links.youtube || links.instagram || links.tiktok}
  {#if hasSocial}
    <div class="hero__social">
      {#if links.twitter}
        <a href={links.twitter} target="_blank" rel="noopener" class="hero__social-link" aria-label="Twitter">
          <TwitterIcon size={18} />
        </a>
      {/if}
      {#if links.youtube}
        <a href={links.youtube} target="_blank" rel="noopener" class="hero__social-link" aria-label="YouTube">
          <YoutubeIcon size={18} />
        </a>
      {/if}
      {#if links.instagram}
        <a href={links.instagram} target="_blank" rel="noopener" class="hero__social-link" aria-label="Instagram">
          <InstagramIcon size={18} />
        </a>
      {/if}
      {#if links.tiktok}
        <a href={links.tiktok} target="_blank" rel="noopener" class="hero__social-link" aria-label="TikTok">
          <TiktokIcon size={18} />
        </a>
      {/if}
    </div>
  {/if}
{/if}
```

### Styling

```css
.hero__social {
  display: flex;
  justify-content: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.hero__social-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-9);
  height: var(--space-9);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, white 15%, transparent);
  color: var(--color-text-on-brand);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.hero__social-link:hover {
  background: color-mix(in srgb, white 30%, transparent);
}
```

---

## 6. Smart CTAs

### Feature Flag Integration

If `enableSubscriptions` is true, change the primary CTA:

```svelte
<div class="hero__actions">
  {#if data.org.features?.enableSubscriptions}
    <a href="/pricing" class="hero__cta">{m.org_hero_subscribe()}</a>
  {:else}
    <a href="/explore" class="hero__cta">{m.org_hero_explore()}</a>
  {/if}
  <a href="/creators" class="hero__cta hero__cta--secondary">
    {m.org_creators_preview_view_all()}
  </a>
</div>
```

### Data Source

Feature settings from `GET /api/organizations/:id/settings/features`. Same options as social links:
- Extend public info endpoint (preferred)
- Separate fetch on the landing page

---

## 7. i18n Keys Needed

```typescript
// New i18n message keys (add to paraglide messages)
org_hero_subscribe: 'Subscribe',
org_hero_stats_creators: '{count} Creators',
org_hero_stats_titles: '{count} Titles',
```

---

## 8. Loading States

Since creator data is streamed, the avatar strip and stats bar need skeleton states:

```svelte
{#await data.creators}
  <div class="hero__creators hero__creators--skeleton">
    <div class="hero__avatar-strip">
      {#each Array(3) as _}
        <div class="skeleton hero__avatar-skeleton"></div>
      {/each}
    </div>
    <div class="skeleton hero__stats-skeleton"></div>
  </div>
{:then creators}
  <!-- ... actual content ... -->
{/await}
```

The skeletons use the existing shimmer animation from the page's `@keyframes shimmer`.

---

## 9. Dependencies on Shader System

These content enrichments are **completely independent** of the shader system. They can be implemented in any order:

| Enhancement | Depends On Shader? | Depends on API Change? |
|------------|-------------------|----------------------|
| Creator avatar strip | No | No (data already streamed) |
| Stats bar | No | Minor (need pagination total from content API) |
| Social links | No | Yes (extend public info or separate fetch) |
| Smart CTAs | No | Yes (extend public info or separate fetch) |

**Recommendation**: Ship content enrichment first (Phase 1), then shader system (Phase 2-3). This gives immediate visual improvement with minimal risk.
