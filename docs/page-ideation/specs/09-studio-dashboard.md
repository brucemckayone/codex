# Studio Dashboard Upgrades — Implementation Spec

## Summary

Three improvements to the studio dashboard page (`_org/[slug]/studio/+page.svelte`):

1. **Quick actions grid** (1.26) — Six icon+label cards linking to common studio tasks: Create Content, Upload Media, View Analytics, Manage Team, Edit Branding, View Public Site. Purely presentational — no API changes needed. Some cards are role-gated (admin/owner only).
2. **Revenue time series chart** (1.34a) — The `RevenueChart` component already exists and is in use on the analytics page. Wire it into the dashboard with compact date range controls, sourcing data from the revenue endpoint that `getDashboardStats` already calls internally.
3. **Dashboard stats from single endpoint** (1.34b) — Replace the current `getDashboardStats` remote function (which makes 3 parallel API calls to revenue, customers, and top-content endpoints) with a single call to `GET /api/admin/analytics/dashboard-stats`. This endpoint already exists in admin-api and returns `{ revenue: RevenueStats, customers: CustomerStats, topContent: PaginatedListResponse<TopContentItem> }` in one response.

---

## Feasibility

### Pros

- **Quick actions** are pure frontend — zero API work. All target routes already exist in the sidebar navigation config (`$lib/config/navigation.ts`), and icon components exist for every action.
- **RevenueChart already works.** The analytics page (`studio/analytics/+page.svelte`) demonstrates the full pattern: server load fetches `revenueByDay[]`, maps to `{ date, revenue }[]`, and passes it to `RevenueChart`. The dashboard just needs a smaller version of this.
- **The `dashboard-stats` endpoint already exists** in admin-api (`GET /api/admin/analytics/dashboard-stats`) with `requireOrgManagement` policy. The `AdminAnalyticsService.getDashboardStats()` method composes revenue, customer, and top-content queries server-side via `Promise.all`, which is strictly better than the current frontend approach of making 3 separate API calls from the remote function.
- **The `DashboardStats` response shape** (`packages/admin/src/types.ts`) directly contains `revenue.revenueByDay[]` — the exact data the `RevenueChart` component needs. No transformation layer required beyond the existing `{ date, revenue: revenueCents }` mapping.
- The dashboard already has role checks (`isAdmin` derived from `data.userRole`), so gating quick action cards and the revenue chart behind admin/owner roles follows an established pattern.

### Gotchas & Risks

- **The server API client (`api.ts`) does not yet have a method for `dashboard-stats`.** The `analytics` namespace currently only exposes `getRevenue()` and `getTopContent()`. A new `getDashboardStats()` method must be added to `api.ts` targeting `/api/admin/analytics/dashboard-stats`.
- **The current `getDashboardStats` remote function** (`admin.remote.ts`) manually assembles stats from 3 separate endpoints and computes `revenueChange` client-side from `revenueByDay` slicing. Switching to the single endpoint means the change calculation must either move to the backend or remain as a derived computation on the frontend from the returned `revenueByDay` data. The current approach of slicing days 0-6 vs 7-13 for week-over-week change is sound and should be preserved as a frontend derivation.
- **Revenue chart on dashboard needs to be compact.** The existing `RevenueChart` renders at 200px height which works for the analytics page but may feel large on a dashboard that also has stats, quick actions, and activity feed. Consider constraining it inside a Card with a fixed max-height, or adding a `compact` prop to RevenueChart.
- **Date range for dashboard revenue chart.** The analytics page uses URL-driven date range controls. The dashboard should default to last 14 days with no URL state — simpler UX appropriate for a glanceable overview. A "View full analytics" link sends users to the dedicated page for date range exploration.
- **Quick actions "View Public Site" opens a different origin** (the org's public subdomain). This needs `target="_blank"` and `rel="noopener"` since it navigates away from the studio.
- **Quick actions role gating**: "Manage Team" and "Edit Branding" are admin-only sidebar links. "View Analytics" is in `SIDEBAR_BASE_LINKS` (all roles). The quick actions grid should match these same role gates.

---

## Current State

### Dashboard Layout

The studio dashboard (`+page.svelte`) currently renders three sections in a vertical column:

1. **Header** — Title ("Dashboard") and subtitle from i18n messages.
2. **Stats grid** — 2-4 `StatCard` components in a responsive grid (1 col mobile, 2 col tablet, 4 col desktop). Revenue and Customers cards are admin/owner-only. Content Count and Views are visible to all studio roles.
3. **Activity feed** — `ActivityFeed` component showing recent purchases, publishes, and member joins.

### Data Loading

`+page.server.ts` calls two remote functions in parallel:
- `getDashboardStats(org.id)` — returns `{ revenue, customers, contentCount, views }` each with `{ value, change }`.
- `getActivityFeed({ organizationId, limit: 10 })` — returns `{ items }`.

The `getDashboardStats` remote function (`admin.remote.ts`, lines 37-108) makes **3 parallel API calls** internally:
1. `api.analytics.getRevenue(searchParamsRev)` — gets `RevenueAnalyticsResponse` including `revenueByDay[]`.
2. `api.admin.getCustomers(searchParamsCust)` — gets customer list with `pagination.total`.
3. `api.analytics.getTopContent(searchParamsContent)` — gets top content with `pagination.total`.

It then derives stat values and a week-over-week revenue change percentage from the `revenueByDay` array (slicing days 0-6 vs 7-13).

### Role Model

The studio layout server load (`studio/+layout.server.ts`) resolves `userRole` from the membership. Valid studio roles are `creator`, `admin`, and `owner` (members are redirected away). The dashboard page derives `isAdmin` as `role === 'admin' || role === 'owner'`.

### Existing Components

| Component | Path | Props |
|-----------|------|-------|
| `StatCard` | `$lib/components/studio/StatCard.svelte` | `label`, `value`, `change?`, `loading?` |
| `ActivityFeed` | `$lib/components/studio/ActivityFeed.svelte` | `activities`, `loading?` |
| `RevenueChart` | `$lib/components/studio/RevenueChart.svelte` | `data: { date, revenue }[]`, `loading?` |
| `Card`, `CardContent`, `CardHeader`, `CardTitle` | `$lib/components/ui/Card` | Standard card wrappers |

### Existing API Infrastructure

| Piece | Status | Location |
|-------|--------|----------|
| `GET /api/admin/analytics/dashboard-stats` endpoint | Exists | `workers/admin-api/src/index.ts` line 151 |
| `AdminAnalyticsService.getDashboardStats()` | Exists | `packages/admin/src/services/analytics-service.ts` |
| `adminDashboardStatsQuerySchema` (Zod) | Exists | `packages/validation/src/admin/admin-schemas.ts` |
| `DashboardStats` type | Exists | `packages/admin/src/types.ts` |
| `api.analytics.getDashboardStats()` client method | **Missing** | `apps/web/src/lib/server/api.ts` |

---

## Design Spec

### 1. Quick Actions Grid

A 2x3 responsive grid of icon+label cards placed between the stats grid and the activity feed. Each card is a navigational link to a common studio task.

#### Card Definitions

| # | Label | Icon | Href | Role Gate |
|---|-------|------|------|-----------|
| 1 | Create Content | `PlusIcon` | `/studio/content?action=create` | All studio roles |
| 2 | Upload Media | `UploadIcon` | `/studio/media` | All studio roles |
| 3 | View Analytics | `TrendingUpIcon` | `/studio/analytics` | All studio roles |
| 4 | Manage Team | `UsersIcon` | `/studio/team` | Admin/Owner only |
| 5 | Edit Branding | `EditIcon` | `/studio/settings/branding` | Admin/Owner only |
| 6 | View Public Site | `GlobeIcon` | `/` (org root) | All studio roles |

"View Public Site" links to the org's public homepage (root-relative `/` on the org subdomain). Since this navigates away from studio, it opens in a new tab.

#### Action List Construction

```typescript
import {
  PlusIcon, UploadIcon, TrendingUpIcon,
  UsersIcon, EditIcon, GlobeIcon,
} from '$lib/components/ui/Icon';
import type { Component } from 'svelte';

interface QuickAction {
  label: string;
  icon: Component<any>;
  href: string;
  adminOnly: boolean;
  external?: boolean;
}

const quickActions: QuickAction[] = [
  { label: m.studio_action_create_content(), icon: PlusIcon, href: '/studio/content?action=create', adminOnly: false },
  { label: m.studio_action_upload_media(),   icon: UploadIcon, href: '/studio/media', adminOnly: false },
  { label: m.studio_action_analytics(),      icon: TrendingUpIcon, href: '/studio/analytics', adminOnly: false },
  { label: m.studio_action_manage_team(),    icon: UsersIcon, href: '/studio/team', adminOnly: true },
  { label: m.studio_action_edit_branding(),  icon: EditIcon, href: '/studio/settings/branding', adminOnly: true },
  { label: m.studio_action_view_site(),      icon: GlobeIcon, href: '/', adminOnly: false, external: true },
];

const visibleActions = $derived(
  quickActions.filter((a) => !a.adminOnly || isAdmin)
);
```

When `isAdmin` is false, only 4 actions are visible (grid becomes 2x2).

#### Visual Design

Each action card is a clickable anchor wrapping an icon and label inside a `Card` component. On hover, the card elevates slightly with a shadow transition and the icon shifts to `--color-interactive`.

```css
.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-3);
}

@media (--breakpoint-sm) {
  .quick-actions {
    grid-template-columns: repeat(3, 1fr);
  }
}

.quick-action-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3);
  text-decoration: none;
  border-radius: var(--radius-md);
  border: var(--border-width) var(--border-style) var(--color-border);
  background: var(--color-surface);
  transition: var(--transition-shadow), var(--transition-colors);
  cursor: pointer;
}

.quick-action-link:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-interactive);
}

.quick-action-link:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: 2px;
}

.quick-action-icon {
  color: var(--color-text-secondary);
  transition: color var(--duration-fast) var(--ease-default);
}

.quick-action-link:hover .quick-action-icon {
  color: var(--color-interactive);
}

.quick-action-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
  text-align: center;
  line-height: var(--leading-normal);
}
```

#### Markup

```svelte
<section class="quick-actions" aria-label={m.studio_quick_actions()}>
  {#each visibleActions as action (action.href)}
    <a
      class="quick-action-link"
      href={action.href}
      target={action.external ? '_blank' : undefined}
      rel={action.external ? 'noopener' : undefined}
    >
      <action.icon size={24} class="quick-action-icon" />
      <span class="quick-action-label">{action.label}</span>
    </a>
  {/each}
</section>
```

#### Accessibility

- Each card is a native `<a>` element, focusable and keyboard-navigable.
- External links include `target="_blank"` and `rel="noopener"`.
- The section has an `aria-label` for screen readers.
- Focus-visible outlines use `--color-focus`.

---

### 2. Revenue Chart Integration

A compact revenue bar chart in a Card, placed between the stats grid and quick actions, visible only to admin/owner roles. Shows the last 14 days of revenue data with a link to the full analytics page.

#### Data Source

After migrating to the single `dashboard-stats` endpoint (section 3), the `DashboardStats` response includes `revenue.revenueByDay: DailyRevenue[]` where each entry has `{ date: string, revenueCents: number, purchaseCount: number }`. The chart data is derived directly:

```typescript
const chartData = $derived(
  (data.stats?.revenue?.revenueByDay ?? [])
    .slice(-14) // Last 14 days
    .map((d) => ({ date: d.date, revenue: d.revenueCents }))
);
```

The `slice(-14)` ensures the dashboard chart stays compact even if the backend returns a full 30-day range.

#### Chart Card Layout

The chart is wrapped in a `Card` with a header containing the title and a "View Analytics" link:

```svelte
{#if isAdmin}
  <section class="revenue-section">
    <Card>
      <CardHeader>
        <div class="revenue-header">
          <CardTitle level={2}>{m.studio_revenue_chart_title()}</CardTitle>
          <a href="/studio/analytics" class="revenue-link">
            {m.studio_view_analytics()}
          </a>
        </div>
      </CardHeader>
      <CardContent>
        <RevenueChart data={chartData} loading={!data.stats} />
      </CardContent>
    </Card>
  </section>
{/if}
```

No date range controls on the dashboard. The chart is glanceable — users who want date filtering go to `/studio/analytics`.

#### CSS

```css
.revenue-section {
  /* Uses the same max-width as the dashboard container */
}

.revenue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.revenue-link {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-interactive);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-default);
}

.revenue-link:hover {
  color: var(--color-interactive-hover);
  text-decoration: underline;
  text-underline-offset: var(--space-0-5, 2px);
}
```

#### RevenueChart Sizing

The existing `RevenueChart` has `min-height: 200px; max-height: 280px`. Within the dashboard card context these dimensions work — the card constrains width and the chart fills it. No changes to `RevenueChart.svelte` are needed for this integration. If the chart feels tall in the dashboard context during visual review, a future enhancement could add a `compact` variant prop that reduces `height` to 160px.

---

### 3. Single Endpoint Migration

Replace the current multi-call `getDashboardStats` remote function with a single call to the `dashboard-stats` endpoint.

#### API Client Addition

Add a `getDashboardStats` method to the `analytics` namespace in `api.ts`:

```typescript
// In the analytics section of createServerApi
getDashboardStats: (params?: URLSearchParams) =>
  request<DashboardStats>(
    'admin',
    `/api/admin/analytics/dashboard-stats${params ? `?${params}` : ''}`
  ),
```

The `DashboardStats` type is imported from `@codex/admin` (or re-exported via `@codex/shared-types`). Its shape is:

```typescript
interface DashboardStats {
  revenue: RevenueStats;      // includes revenueByDay[]
  customers: CustomerStats;   // totalCustomers, newCustomersLast30Days
  topContent: PaginatedListResponse<TopContentItem>;
}
```

Where `RevenueStats` contains:
- `totalRevenueCents: number`
- `totalPurchases: number`
- `averageOrderValueCents: number`
- `revenueByDay: DailyRevenue[]` (each: `{ date, revenueCents, purchaseCount }`)

And `CustomerStats` contains:
- `totalCustomers: number`
- `newCustomersLast30Days: number`

#### Remote Function Rewrite

The `getDashboardStats` remote function in `admin.remote.ts` is replaced:

```typescript
export const getDashboardStats = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', orgId);

  const stats = await api.analytics.getDashboardStats(searchParams);

  // Derive week-over-week revenue change (same logic as before)
  const revenueByDay = stats.revenue.revenueByDay ?? [];
  const recentRevenue = revenueByDay
    .slice(0, 7)
    .reduce((sum, day) => sum + day.revenueCents, 0);
  const previousRevenue = revenueByDay
    .slice(7, 14)
    .reduce((sum, day) => sum + day.revenueCents, 0);
  const revenueChange =
    previousRevenue > 0
      ? Math.round(((recentRevenue - previousRevenue) / previousRevenue) * 100)
      : 0;

  return {
    revenue: {
      value: stats.revenue.totalRevenueCents,
      change: revenueChange,
      revenueByDay: stats.revenue.revenueByDay,
    },
    customers: {
      value: stats.customers.totalCustomers,
      change: 0, // Change % not provided by backend
    },
    contentCount: {
      value: stats.topContent?.pagination?.total ?? 0,
      change: 0,
    },
    views: {
      value: 0, // Views not tracked by current backend
      change: 0,
    },
  };
});
```

Key differences from the current implementation:
- **One API call** instead of three, reducing latency and error surface.
- **Same return shape** — the page component does not need to change how it reads `data.stats.revenue.value`, `data.stats.customers.value`, etc.
- **New `revenueByDay` field** on the revenue object, used by the dashboard chart.
- `customerStats.totalCustomers` replaces the previous `pagination.total` proxy for customer count.

#### Server Load Changes

`+page.server.ts` remains structurally the same — it still calls `getDashboardStats(org.id)` and `getActivityFeed(...)` in parallel. The remote function internal change is transparent to the loader.

#### Type Updates

The return type of `getDashboardStats` gains a `revenueByDay` field on the revenue object. The dashboard page reads this for the chart:

```typescript
// In +page.svelte
const chartData = $derived(
  (data.stats?.revenue?.revenueByDay ?? [])
    .slice(-14)
    .map((d) => ({ date: d.date, revenue: d.revenueCents }))
);
```

---

## Implementation Plan

### Files to Create

None. All changes modify existing files. The quick actions grid, revenue chart integration, and stat cards are inline in the dashboard page.

### Files to Modify

#### 1. `apps/web/src/lib/server/api.ts`

- Add `getDashboardStats` method to the `analytics` namespace.
- Import `DashboardStats` type (from `@codex/admin` types or define a local response type).

#### 2. `apps/web/src/lib/remote/admin.remote.ts`

- Rewrite `getDashboardStats` remote function body to use `api.analytics.getDashboardStats()` instead of 3 separate calls.
- Preserve the week-over-week change derivation logic.
- Add `revenueByDay` to the return shape.

#### 3. `apps/web/src/routes/_org/[slug]/studio/+page.svelte`

- **Imports**: Add `RevenueChart`, `Card`/`CardHeader`/`CardContent`/`CardTitle`, and icon components (`PlusIcon`, `UploadIcon`, `TrendingUpIcon`, `UsersIcon`, `EditIcon`, `GlobeIcon`).
- **Quick actions**: Add the `quickActions` array, `visibleActions` derived state, and the grid markup between the stats grid and activity feed.
- **Revenue chart**: Add the chart section (admin-gated) between stats grid and quick actions.
- **Chart data derivation**: Add `chartData` derived from `data.stats?.revenue?.revenueByDay`.
- **Styles**: Add CSS for `.quick-actions`, `.quick-action-link`, `.quick-action-icon`, `.quick-action-label`, `.revenue-section`, `.revenue-header`, `.revenue-link`.

#### 4. `apps/web/src/routes/_org/[slug]/studio/+page.server.ts`

No structural changes needed. The server load already calls `getDashboardStats(org.id)` which will transparently use the new single-endpoint implementation after the remote function is updated.

### Section Order on Dashboard (top to bottom)

1. Header (title + subtitle) — unchanged
2. Stats grid (StatCards) — unchanged
3. Revenue chart card (admin only) — **new**
4. Quick actions grid — **new**
5. Activity feed — unchanged

### i18n Messages to Add

| Key | English Value |
|-----|---------------|
| `studio_quick_actions` | `"Quick Actions"` |
| `studio_action_create_content` | `"Create Content"` |
| `studio_action_upload_media` | `"Upload Media"` |
| `studio_action_analytics` | `"View Analytics"` |
| `studio_action_manage_team` | `"Manage Team"` |
| `studio_action_edit_branding` | `"Edit Branding"` |
| `studio_action_view_site` | `"View Public Site"` |
| `studio_revenue_chart_title` | `"Revenue (Last 14 Days)"` |
| `studio_view_analytics` | `"View all analytics"` |

Existing keys reused: `studio_dashboard_title`, `studio_dashboard_subtitle`, `studio_stat_revenue`, `studio_stat_customers`, `studio_stat_content`, `studio_stat_views`, `studio_activity_title`.

---

## Testing Notes

### Manual Testing

1. **Quick actions (all roles)**: Log in as a `creator` role. Navigate to `/studio`. Verify 4 quick action cards appear (Create Content, Upload Media, View Analytics, View Public Site). Verify "Manage Team" and "Edit Branding" are not visible.
2. **Quick actions (admin)**: Log in as an `admin` or `owner`. Verify all 6 quick action cards appear.
3. **Quick action navigation**: Click each card. Verify it navigates to the correct route. Verify "View Public Site" opens in a new tab.
4. **Revenue chart (admin)**: As admin/owner, verify the revenue bar chart appears in a Card between the stats and quick actions. Verify it shows up to 14 bars. Verify hover tooltips show date and amount in GBP.
5. **Revenue chart (non-admin)**: As a creator, verify the revenue chart section is not rendered.
6. **Revenue chart loading**: On initial load (before stats resolve), verify the chart shows its skeleton state (animated placeholder bars).
7. **Revenue chart empty**: For an org with no revenue, verify the chart shows the empty state message.
8. **"View all analytics" link**: Click the link in the chart card header. Verify it navigates to `/studio/analytics`.
9. **Dashboard stats single endpoint**: Open browser dev tools Network tab. Load the dashboard. Verify only one request goes to `/api/admin/analytics/dashboard-stats` (plus one for activity), not three separate analytics/customer/content requests.
10. **StatCard values**: Verify revenue shows in GBP format, customer count is correct, content count matches. Verify change badges appear for revenue (week-over-week).
11. **Graceful degradation**: Stop the admin-api worker. Load the dashboard. Verify stats show `--` placeholders, chart shows loading/empty, and activity feed loads independently (it uses a separate call).
12. **Responsive layout**: Test on mobile viewport. Verify quick actions grid is 2 columns. Verify stats grid is 1 column. Verify the revenue chart card spans full width.
13. **Keyboard accessibility**: Tab through all quick action cards. Verify focus ring is visible. Verify Enter activates the link.

### Edge Cases

- Org with zero revenue: chart empty state, revenue StatCard shows "0".
- Org with zero customers: customers StatCard shows "0".
- New org with no content: content count is "0", activity feed shows empty state.
- `revenueByDay` array shorter than 14 days (new org): chart shows fewer bars, no errors.
- `revenueByDay` array empty: chart shows empty state message.
- Admin-api unreachable: `getDashboardStats` returns null/error, all stat cards show `--`, chart shows loading skeleton. Activity feed is independent and may still load.
- Creator role with no admin access to analytics endpoint: the dashboard-stats endpoint requires `requireOrgManagement`. The remote function will fail for creators. The page already handles this by showing `--` for null stats. Revenue chart and admin-only StatCards are gated behind `isAdmin` so they will not attempt to render data that does not exist.
