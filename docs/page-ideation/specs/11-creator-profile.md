# Creator Profile Enhancements -- Implementation Spec

## Summary

Two medium-effort improvements to the public creator profile page (`_creators/[username]/+page.svelte`) that elevate the hero section and org affiliations display. Both improvements work entirely with data that is already loaded on the page -- no new API endpoints are required. The implementation must handle two runtime scenarios: the identity API's public profile endpoint being available (full profile data) and the endpoint being unavailable (graceful degradation to content-derived data).

**Scope IDs**: 1.31 (Hero Improvements), 1.32 (Org Affiliations Upgrade)

---

## Feasibility

### Pros

- **No new API endpoints required.** All data sources already exist. The server loader fetches the creator profile from identity API (best-effort) and content items from content API. Organizations are derived from content items in the server loader.
- **Graceful degradation already implemented.** The `+page.server.ts` wraps the profile fetch in try/catch and sets `creatorProfile = null` on failure. The page template already has `$derived` accessors that fall back to username and default bio.
- **All icon components already exist.** `GlobeIcon`, `TwitterIcon`, `YoutubeIcon`, `InstagramIcon`, `FileIcon`, `UsersIcon` are already imported in the current page component.
- **Badge component is available.** `Badge` from `$lib/components/ui/Badge` supports `neutral`, `success`, `info`, and `accent` variants -- suitable for role labels.
- **Avatar component accepts class overrides.** The Avatar component uses `class: className` prop spreading, so size can be controlled via a scoped CSS class without modifying the component.
- **`buildOrgUrl()` is already imported.** The page already uses it for org card links, so linking to org subdomains is already wired.
- **Design tokens cover all styling needs.** Spacing scale, typography scale, color tokens, border tokens, and responsive breakpoints are all available.

### Gotchas & Risks

- **CRITICAL: Public profile endpoint may not exist.** The identity API endpoint `GET /api/user/public/:username` is called but not guaranteed to be deployed. The server loader catches the error and returns `creatorProfile = null`. Every enhancement that uses profile data (bio, social links, avatar) MUST have a fallback path that works when `creatorProfile` is null. The hero section must still look complete and intentional when displaying only the username and content-derived information.
- **Org data is derived from content items, not from a membership API.** The `organizations` array is built by deduplicating `item.organization` from content results. This means: (a) organizations only appear if the creator has published content in them, (b) there is no role/membership data available -- the loader does not fetch membership info, and (c) if the creator has no content, the organizations array is empty. Role badges must use a generic label (e.g., "Creator") since actual roles are not available from this data source.
- **Content count requires client-side computation.** There is no `contentCount` field returned from the API for this page. The count must be derived from `contentItems.length`, which is capped at `CONTENT_LIMIT` (12). The displayed count should say "12+" when the result hits the limit, or show the exact number otherwise. Alternatively, show the exact count without a "total" qualifier since we do not have the full total.
- **Org content count per org requires grouping.** To show how many content items belong to each org, the page must count content items grouped by `organization.id`. This is a client-side derivation from the already-loaded `contentItems` array.
- **Avatar size is hardcoded in Avatar.svelte.** The Avatar component defaults to `--space-10` (40px) via its internal `.avatar` class. Enlarging it requires a CSS class override (e.g., `.profile-hero__avatar :global(.avatar)`) to set width/height to the desired token value.
- **Social links are only available when profile endpoint works.** When the profile endpoint fails, `socialLinks` is null. The social links row must be entirely hidden in this case -- not shown as an empty row.
- **No dedicated "org count" stat.** Org count is derived from the `organizations` array, which itself is derived from content. This is fine for a stats strip, but the value may be zero if the creator has no content with org associations.

---

## Current State

### `+page.server.ts`

The server loader performs two fetches:

1. **Profile fetch (best-effort):** Calls `GET /api/user/public/:username` via the identity API. On success, returns `{ id, name, image, bio, socialLinks }`. On failure (endpoint missing, 404, network error), silently sets `creatorProfile = null`.
2. **Content fetch (conditional):** If the profile returned an `id`, fetches published content filtered by `creatorId` with `limit: 12`, sorted by `publishedAt desc`. If no profile ID is available, `contentItems` remains an empty array.

After fetching, the loader derives `organizations` by deduplicating `item.organization` from content items into a Map keyed by org ID. Each org entry has `{ id, name, slug, logoUrl }`.

Returns: `{ username, user, creatorProfile, contentItems, organizations }`.

Sets `CACHE_HEADERS.DYNAMIC_PUBLIC`.

### `+page.svelte`

Three sections:

1. **Profile Header** -- Center-aligned column with Avatar (40px, `--space-10`), display name (h1, `--text-3xl`), @username, bio paragraph, social links as icon buttons in a flex row, and a "Follow" button for unauthenticated visitors. Social links render conditionally per-platform (website, twitter, youtube, instagram).
2. **Organizations Section** -- Heading "Organizations", flex-wrap grid of org cards. Each card is an `<a>` tag linking to `buildOrgUrl(page.url, org.slug, '/')` with an icon area (logo image or initial letter), and org name.
3. **Content Section** -- Heading "Latest Content", responsive 1/2/3-column grid of `ContentCard` components. Empty state via `EmptyState` component when no content items.

### Data Flow When Profile Endpoint Fails

When the profile endpoint is unavailable:

| Field | Source | Fallback |
|---|---|---|
| `displayName` | `profile?.name` | `username` (from URL) |
| `avatar` | `profile?.image` | `null` (shows initial letter) |
| `bio` | `profile?.bio` | i18n default: "Independent creator sharing transformative content" |
| `socialLinks` | `profile?.socialLinks` | `null` (row hidden entirely) |
| `contentItems` | Requires `profile.id` for fetch | Empty array (no content shown) |
| `organizations` | Derived from `contentItems` | Empty array (section hidden) |

Note: When the profile endpoint fails, the page shows only the username, default bio, and no content or orgs. This is the worst-case scenario and the redesigned hero must still present well in this state.

### Data Flow When Profile Endpoint Succeeds

All fields are populated. `contentItems` is fetched filtered by `creatorId`. Organizations are derived from content. Social links render when present. Avatar shows the profile image.

---

## Design Spec

### 1. Hero Section Redesign

**Goal**: Transform the profile header from a simple centered stack into a more substantial hero with a larger avatar, clearer visual hierarchy, a stats strip, and better social link presentation.

#### Layout

The hero remains a center-aligned column layout but gains visual weight and structure:

```
[Avatar -- 96px circle]
[Display Name -- h1, prominent]
[@username -- muted]
[Bio -- secondary text, max-width constrained]
[Stats Strip -- content count | org count, inline]
[Social Links -- icon row]
[Follow Button -- for unauthenticated only]
```

#### Avatar Enlargement

Increase the avatar from `--space-10` (40px) to `--space-24` (96px). Since the Avatar component uses internal sizing, override via a scoped CSS class:

```css
.profile-hero__avatar :global(.avatar) {
  width: var(--space-24);
  height: var(--space-24);
}
```

The `AvatarFallback` letter should also scale. Override its font size:

```css
.profile-hero__avatar :global(.avatar) {
  font-size: var(--text-2xl);
}
```

On mobile (`--below-sm`), reduce to `--space-20` (80px):

```css
@media (--below-sm) {
  .profile-hero__avatar :global(.avatar) {
    width: var(--space-20);
    height: var(--space-20);
    font-size: var(--text-xl);
  }
}
```

**Fallback (no profile endpoint):** Avatar shows the initial letter of the username in the `AvatarFallback`. This already works -- no change needed.

#### Name and Username

- Display name: `--text-4xl` on desktop (up from `--text-3xl`), `--text-2xl` on mobile. Font weight `--font-bold`.
- @username: `--text-base`, `--color-text-muted`. No change from current.

**Fallback (no profile endpoint):** `displayName` falls back to the raw username. The @username line shows the same value. Both lines still render -- this is acceptable since the username is the best identifier available.

#### Bio Display

- `--text-base`, `--color-text-secondary`, `line-height: var(--leading-relaxed)`.
- `max-width: 560px` (current value, keep as-is).
- Constrain to 3 lines with CSS line-clamp for very long bios:

```css
.profile-hero__bio {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

**Fallback (no profile endpoint):** Shows the i18n default bio (`creator_profile_bio_default`). This is already implemented and continues to work.

#### Stats Strip

A horizontal inline row showing key metrics, separated by a subtle divider:

```
[FileIcon] {count} Content Items   |   [UsersIcon] {orgCount} Organizations
```

Implementation:

```svelte
<div class="profile-hero__stats">
  <div class="stat-item">
    <FileIcon size={16} />
    <span>{m.creator_profile_stat_content({ count: String(contentItems.length) })}</span>
  </div>
  {#if organizations.length > 0}
    <span class="stat-divider" aria-hidden="true"></span>
    <div class="stat-item">
      <UsersIcon size={16} />
      <span>{m.creator_profile_stat_orgs({ count: String(organizations.length) })}</span>
    </div>
  {/if}
</div>
```

CSS:

```css
.profile-hero__stats {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.stat-divider {
  width: var(--border-width);
  height: var(--space-4);
  background: var(--color-border);
}
```

**Fallback (no profile endpoint):** `contentItems` is empty, so content count shows "0 Content Items". `organizations` is empty, so the org stat and divider do not render. The stats strip shows only the content count at zero. This is acceptable -- it communicates that this creator has no published content visible through this page.

**Alternative consideration:** If both counts are zero, hide the stats strip entirely:

```svelte
{#if contentItems.length > 0 || organizations.length > 0}
  <div class="profile-hero__stats">...</div>
{/if}
```

This is the recommended approach -- avoids showing a meaningless "0 Content Items" stat.

#### Social Links Row

The current implementation is already an icon row and is well-structured. Improvements:

- Increase icon button size from `--space-10` (40px) to `--space-11` (44px) for better touch targets.
- Add a subtle tooltip via `title` attribute on each link (reuse existing aria-label text).
- Add `gap: var(--space-3)` (up from `--space-2`) for more breathing room.

```css
.social-link {
  width: var(--space-11);
  height: var(--space-11);
  /* rest unchanged */
}

.profile-hero__social {
  gap: var(--space-3);
  /* rest unchanged */
}
```

**Fallback (no profile endpoint):** `socialLinks` is null, `hasSocialLinks` is false. The entire social links row is hidden. No empty placeholder is shown.

#### Follow Button

No changes. Remains visible only when `!data.user` (unauthenticated visitors).

#### Section Border

Keep the bottom border (`border-bottom`) that separates the hero from the content sections below. This provides visual separation.

#### Responsive Behavior

| Breakpoint | Avatar | Title | Stats | Social |
|---|---|---|---|---|
| `--below-sm` (<640px) | `--space-20` (80px) | `--text-2xl` | Stack vertically | `--space-2` gap |
| `--breakpoint-sm`+ | `--space-24` (96px) | `--text-4xl` | Inline row | `--space-3` gap |

On mobile, the stats strip should wrap naturally. If it gets too tight, switch to a vertical stack:

```css
@media (--below-sm) {
  .profile-hero__stats {
    flex-direction: column;
    gap: var(--space-2);
  }

  .stat-divider {
    display: none;
  }
}
```

---

### 2. Org Affiliations Visual Upgrade

**Goal**: Upgrade the organizations section from a minimal flex-wrap list into a richer card-based display with larger logos, role labels, content counts per org, and direct "View on {Org}" links.

#### Section Title Update

Change from "Organizations" to a more descriptive subtitle approach:

```svelte
<h2 class="orgs-section__title">{m.creator_profile_organizations()}</h2>
<p class="orgs-section__subtitle">{m.creator_profile_organizations_subtitle()}</p>
```

The subtitle i18n key already exists: `creator_profile_organizations_subtitle` = "Creates content for these organizations".

#### Org Card Redesign

Each org card becomes a richer surface:

```
+-----------------------------------------------+
|  [Logo/Initial 48px]                          |
|  Org Name                                     |
|  [Creator badge]                              |
|  {n} content items                            |
|  View on {OrgName} ->                         |
+-----------------------------------------------+
```

Markup structure:

```svelte
{#each organizations as org (org.id)}
  {@const orgContentCount = contentItems.filter(
    (item) => item.organization?.id === org.id
  ).length}
  <div class="org-card">
    <div class="org-card__header">
      <div class="org-card__icon">
        {#if org.logoUrl}
          <img src={org.logoUrl} alt="" class="org-card__logo" />
        {:else}
          <span class="org-card__initial">{org.name[0]}</span>
        {/if}
      </div>
      <div class="org-card__info">
        <span class="org-card__name">{org.name}</span>
        <Badge variant="neutral">{m.creator_profile_role_creator()}</Badge>
      </div>
    </div>
    {#if orgContentCount > 0}
      <span class="org-card__content-count">
        {m.creator_profile_org_content_count({ count: String(orgContentCount) })}
      </span>
    {/if}
    <a
      href={buildOrgUrl(page.url, org.slug, '/')}
      class="org-card__link"
    >
      {m.creator_profile_view_on_org({ name: org.name })} &rarr;
    </a>
  </div>
{/each}
```

#### Org Logo Enlargement

Increase the org icon area from `--space-10` (40px) to `--space-12` (48px):

```css
.org-card__icon {
  width: var(--space-12);
  height: var(--space-12);
  border-radius: var(--radius-lg);
  /* rest unchanged */
}
```

#### Role Badge

Since the data source (content items) does not include membership role information, use a generic "Creator" label for all orgs. This is the only honest representation given the available data:

```svelte
<Badge variant="neutral">{m.creator_profile_role_creator()}</Badge>
```

New i18n key: `creator_profile_role_creator` = "Creator".

If the profile endpoint is enhanced in the future to include org membership with roles, this can be updated to use the actual role value.

#### Content Count Per Org

Compute per-org content count as a derived value from the already-loaded `contentItems` array:

```typescript
// In <script> block
const orgContentCounts = $derived(
  organizations.reduce<Record<string, number>>((acc, org) => {
    acc[org.id] = contentItems.filter(
      (item) => item.organization?.id === org.id
    ).length;
    return acc;
  }, {})
);
```

Alternatively, compute inline in the `{#each}` block using `{@const}` as shown in the markup above. Either approach works; the inline `{@const}` is simpler for this use case.

#### "View on {Org}" Link

Each card has a link that navigates to the org's landing page on its subdomain:

```svelte
<a href={buildOrgUrl(page.url, org.slug, '/')} class="org-card__link">
  {m.creator_profile_view_on_org({ name: org.name })} &rarr;
</a>
```

`buildOrgUrl` already handles constructing the full cross-origin URL for the org's subdomain (e.g., `https://bruce-studio.lvh.me:3000/`).

#### Card CSS

Rework the card from a horizontal inline element to a vertical card:

```css
.org-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: var(--border-width) var(--border-style) var(--color-border);
  text-decoration: none;
  transition: var(--transition-shadow);
  min-width: 220px;
  max-width: 300px;
}

.org-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-brand-primary-subtle);
}

.org-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.org-card__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.org-card__name {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--color-text);
}

.org-card__content-count {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.org-card__link {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-interactive);
  text-decoration: none;
  transition: var(--transition-colors);
}

.org-card__link:hover {
  color: var(--color-interactive-hover);
}
```

#### Grid Layout

Change from flex-wrap to a responsive grid for consistent card sizing:

```css
.orgs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (--breakpoint-sm) {
  .orgs-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (--breakpoint-lg) {
  .orgs-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

Remove `min-width` and `max-width` from `.org-card` when using the grid (the grid columns handle sizing). Keep them as fallbacks if the grid is not supported.

#### Dark Theme Support

The current page has a `:global([data-theme='dark'])` override for `.org-card:hover`. Update this to match the redesigned card:

```css
:global([data-theme='dark']) .org-card:hover {
  border-color: var(--color-interactive-active);
  background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface));
  box-shadow: var(--shadow-md);
}
```

#### Responsive Behavior

| Breakpoint | Grid | Card Min Width | Logo |
|---|---|---|---|
| `--below-sm` (<640px) | 1 column | Full width | `--space-12` (48px) |
| `--breakpoint-sm` | 2 columns | Auto (grid controlled) | `--space-12` (48px) |
| `--breakpoint-lg` | 3 columns | Auto (grid controlled) | `--space-12` (48px) |

#### Empty State

No change. When `organizations.length === 0`, the entire section is not rendered (existing `{#if organizations.length > 0}` guard).

---

## Implementation Plan

### Files to Create

None. All changes are to existing files.

### Files to Modify

#### 1. `apps/web/src/routes/_creators/[username]/+page.svelte`

This is the primary file. Changes:

**Script block:**
- Add import for `Badge` from `$lib/components/ui/Badge`.
- Add `orgContentCounts` derived value for per-org content counts.
- No changes to existing derived values (`username`, `profile`, `displayName`, `avatar`, `bio`, `socialLinks`, `contentItems`, `organizations`, `initial`, `hasSocialLinks`).

**Template:**
- **Hero section**: Rename class from `profile-header` to `profile-hero` for semantic clarity. Enlarge avatar via wrapper class. Increase name font size. Add stats strip below bio (content count + org count). Add `title` attributes to social links. Keep follow button.
- **Orgs section**: Replace the simple org cards with richer card markup. Add `org-card__header` wrapper with logo and info column. Add `Badge` for role. Add per-org content count. Add "View on {OrgName}" link as a separate `<a>` element. Change grid from flex-wrap to CSS grid.
- **Content section**: No changes to content grid or ContentCard usage.

**Style block:**
- Update `.profile-header` to `.profile-hero` (optional rename for clarity, or keep existing class name).
- Add avatar size override via `:global(.avatar)`.
- Update name font size to `--text-4xl` desktop.
- Add `.profile-hero__stats`, `.stat-item`, `.stat-divider` classes.
- Update social link sizing.
- Rework `.org-card` from horizontal inline to vertical card layout.
- Add `.org-card__header`, `.org-card__info`, `.org-card__content-count`, `.org-card__link` classes.
- Change `.orgs-grid` from flex-wrap to CSS grid.
- Update dark theme override.
- Update responsive breakpoint rules.

#### 2. `apps/web/messages/en.json`

Add new i18n keys:

```json
{
  "creator_profile_stat_content": "{count} Content Items",
  "creator_profile_stat_orgs": "{count} Organizations",
  "creator_profile_role_creator": "Creator",
  "creator_profile_org_content_count": "{count} content items",
  "creator_profile_view_on_org": "View on {name}"
}
```

Existing keys that are already correct and do not need changes:
- `creator_profile_organizations` = "Organizations"
- `creator_profile_organizations_subtitle` = "Creates content for these organizations"
- `creator_visit_website`, `creator_visit_twitter`, `creator_visit_youtube`, `creator_visit_instagram`
- `creator_profile_title`, `creator_profile_bio_default`, `creator_profile_latest_content`, `creator_profile_no_content`, `creator_profile_follow`

### Files NOT Modified

- **`+page.server.ts`**: No changes. The data shape and loading logic remain identical. The profile fetch with try/catch degradation is already correct. The org derivation from content items is unchanged.
- **`+layout.svelte`**: No changes. The creator layout shell (header, nav, footer) is unaffected.
- **Avatar component**: No changes. Size override is handled via scoped CSS in the page component.
- **Badge component**: No changes. Used as-is with `variant="neutral"`.
- **Icon components**: No changes. Already imported in the page.

---

## Testing Notes

### Scenario Matrix

| Scenario | Hero Avatar | Hero Name | Bio | Stats Strip | Social Links | Orgs Section | Content Section |
|---|---|---|---|---|---|---|---|
| Profile endpoint available, has content + orgs | Profile image | Profile name | Profile bio | Shows counts | Shows icons | Org cards with counts | Content grid |
| Profile endpoint available, no content | Profile image | Profile name | Profile bio | Hidden (both zero) | Shows icons | Hidden (no orgs derived) | EmptyState |
| Profile endpoint fails, no content possible | Initial letter | Username | Default i18n bio | Hidden (both zero) | Hidden | Hidden (no orgs derived) | EmptyState |
| Profile endpoint available, has content, no orgs on content | Profile image | Profile name | Profile bio | Content count only, no divider | Shows icons | Hidden | Content grid |
| Profile endpoint available, no social links | Profile image | Profile name | Profile bio | Shows counts | Hidden | Org cards | Content grid |

### Specific Test Cases

1. **Profile endpoint available with full data**: Verify avatar is 96px, name is `--text-4xl`, bio is displayed and clamped at 3 lines, stats show correct content count and org count, social links render for each populated platform, org cards show logo, name, "Creator" badge, content count, and "View on {Org}" link.

2. **Profile endpoint fails (503/404/network error)**: Verify page still renders. Avatar shows initial letter of username at 96px. Name shows the raw username. Bio shows "Independent creator sharing transformative content". Stats strip is hidden. Social links row is hidden. Orgs section is hidden. Content section shows "No content published yet" EmptyState.

3. **No content items (profile available)**: Stats strip is hidden (both counts zero). Orgs section is hidden (derived from content). Content section shows EmptyState.

4. **Single org affiliation**: Orgs grid shows one card at full width on mobile, single card in grid on desktop. "View on {Org}" link navigates to correct subdomain URL.

5. **Multiple org affiliations (3+)**: Grid renders 1/2/3 columns at respective breakpoints. Each card shows correct per-org content count.

6. **Org with logo vs without logo**: Card with `logoUrl` shows the image. Card without shows the initial letter fallback.

7. **Social links partial**: Only populated social platforms show icons. e.g., if only `twitter` and `website` are set, only those two icons appear.

8. **Mobile (< 640px)**: Avatar reduces to 80px. Name font reduces to `--text-2xl`. Stats strip stacks vertically (no divider). Org cards grid becomes single column. Content grid becomes single column.

9. **Tablet (640-1024px)**: Org cards grid shows 2 columns. Content grid shows 2 columns.

10. **Desktop (> 1024px)**: Org cards grid shows 3 columns. Content grid shows 3 columns. Avatar is 96px.

11. **Dark theme**: Org cards on hover use the `color-mix` background tint. Social link buttons show correct secondary surface colors. Badge renders correctly on dark background.

12. **"View on {Org}" link navigation**: Clicking the link navigates to the org's subdomain landing page. Verify `buildOrgUrl` produces the correct URL for both `lvh.me` (dev) and production domains.
