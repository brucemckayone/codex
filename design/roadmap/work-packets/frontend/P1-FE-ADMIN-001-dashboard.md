# P1-FE-ADMIN-001: Admin Dashboard

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 5-7 days
**Beads Task**: Codex-vw8.6

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Studio Layout](#studio-layout)
- [Dashboard Page](#dashboard-page)
- [Content Management](#content-management)
- [Customers Page](#customers-page)
- [Analytics Page](#analytics-page)
- [Role-Based Access](#role-based-access)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements the organization studio dashboard - the admin interface for platform owners and creators to manage content, view revenue, and manage customers. The studio is accessible at `{org}.revelations.studio/studio` with role-gated feature access.

Key features:
- **Dashboard overview**: Quick stats, recent activity, quick actions
- **Content management**: List, create, edit content
- **Customer list**: View customers and their purchases
- **Basic analytics**: Revenue overview, content performance
- **Role-based access**: Creator vs Admin vs Owner permissions

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Admin-API** | Dashboard stats, analytics data |
| **Content-API** | Content CRUD operations |
| **Organization-API** | Org info, member management |
| **P1-FE-FOUNDATION-001** | Project setup, hooks |
| **P1-FE-FOUNDATION-002** | UI components |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **P1-FE-ADMIN-002** | Settings link from sidebar |
| **P1-FE-ECOM-001** | Revenue data displayed |

### Role Hierarchy

```
Platform Owner (special role - platform level)
    │
Organization Roles:
    ├── Owner (billing, all admin, all creator)
    ├── Admin (member management, all creator)
    └── Creator (own content only)
```

---

## Studio Layout

### Route Structure

```
src/routes/(org)/[slug]/studio/
├── +layout.svelte         # Studio layout with sidebar
├── +layout.server.ts      # Role check, org data
├── +page.svelte           # Dashboard
├── +page.server.ts        # Dashboard data
│
├── content/
│   ├── +page.svelte       # Content list
│   ├── +page.server.ts
│   ├── new/
│   │   └── +page.svelte   # Create content
│   └── [id]/
│       ├── +page.svelte   # Edit content
│       └── +page.server.ts
│
├── customers/
│   ├── +page.svelte       # Customer list (Admin+)
│   └── +page.server.ts
│
├── analytics/
│   ├── +page.svelte       # Analytics (Admin+)
│   └── +page.server.ts
│
├── team/
│   ├── +page.svelte       # Member management (Admin+)
│   └── +page.server.ts
│
├── settings/              # → P1-FE-ADMIN-002
└── billing/               # → P1-FE-ADMIN-002
```

### +layout.server.ts

```typescript
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: LayoutServerLoad = async ({ params, locals, platform }) => {
  // Must be authenticated
  if (!locals.user) {
    redirect(302, `/login?redirect=/${params.slug}/studio`);
  }

  const api = createServerApi(platform);
  const sessionCookie = locals.session?.id;

  // Fetch org with user's role
  try {
    const org = await api.fetch<OrgWithRole>(
      'org',
      `/api/organizations/${params.slug}/member-context`,
      sessionCookie
    );

    // Must be at least Creator role
    if (!['owner', 'admin', 'creator'].includes(org.role)) {
      error(403, 'You do not have access to this studio');
    }

    return {
      org,
      user: locals.user,
      role: org.role
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      error(404, 'Organization not found');
    }
    throw e;
  }
};

interface OrgWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'creator';
}
```

### +layout.svelte

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { StudioSidebar } from '$lib/components/studio/StudioSidebar.svelte';
  import { StudioHeader } from '$lib/components/studio/StudioHeader.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    data: { org: OrgWithRole; user: UserData; role: string };
    children: Snippet;
  }

  let { data, children }: Props = $props();
</script>

<div class="studio-layout">
  <StudioSidebar
    org={data.org}
    role={data.role}
    currentPath={$page.url.pathname}
  />

  <div class="studio-main">
    <StudioHeader user={data.user} org={data.org} />

    <main class="studio-content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .studio-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    min-height: 100vh;
    background: var(--color-background);
  }

  .studio-main {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .studio-content {
    flex: 1;
    padding: var(--space-6);
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .studio-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
```

### StudioSidebar.svelte

```svelte
<!-- src/lib/components/studio/StudioSidebar.svelte -->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    org: { name: string; slug: string; logoUrl: string | null };
    role: 'owner' | 'admin' | 'creator';
    currentPath: string;
  }

  let { org, role, currentPath }: Props = $props();

  const isAdmin = $derived(role === 'owner' || role === 'admin');
  const isOwner = $derived(role === 'owner');

  const navItems = $derived([
    { href: `/studio`, label: m.studio_nav_dashboard(), icon: 'dashboard', show: true },
    { href: `/studio/content`, label: m.studio_nav_content(), icon: 'video', show: true },
    { href: `/studio/media`, label: m.studio_nav_media(), icon: 'image', show: true },
    { href: `/studio/analytics`, label: m.studio_nav_analytics(), icon: 'chart', show: isAdmin },
    { href: `/studio/customers`, label: m.studio_nav_customers(), icon: 'users', show: isAdmin },
    { href: `/studio/team`, label: m.studio_nav_team(), icon: 'team', show: isAdmin },
    { href: `/studio/settings`, label: m.studio_nav_settings(), icon: 'settings', show: isAdmin },
    { href: `/studio/billing`, label: m.studio_nav_billing(), icon: 'billing', show: isOwner }
  ].filter(item => item.show));

  function isActive(href: string): boolean {
    if (href === '/studio') {
      return currentPath === `/${org.slug}/studio`;
    }
    return currentPath.startsWith(`/${org.slug}${href}`);
  }
</script>

<aside class="sidebar">
  <div class="org-header">
    {#if org.logoUrl}
      <img src={org.logoUrl} alt={org.name} class="org-logo" />
    {:else}
      <div class="org-logo placeholder">{org.name[0]}</div>
    {/if}
    <span class="org-name">{org.name}</span>
  </div>

  <nav class="nav">
    {#each navItems as item}
      <a
        href={`/${org.slug}${item.href}`}
        class="nav-item"
        class:active={isActive(item.href)}
        aria-current={isActive(item.href) ? 'page' : undefined}
      >
        <span class="nav-icon" data-icon={item.icon}></span>
        <span class="nav-label">{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <a href={`/${org.slug}`} class="view-site">
      {m.studio_view_site()}
      <span class="external-icon">↗</span>
    </a>
  </div>
</aside>

<style>
  .sidebar {
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    height: 100vh;
    position: sticky;
    top: 0;
  }

  .org-header {
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .org-logo {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    object-fit: cover;
  }

  .org-logo.placeholder {
    background: var(--color-primary-500);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: var(--font-bold);
  }

  .org-name {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav {
    flex: 1;
    padding: var(--space-2);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .nav-item:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .nav-item.active {
    background: var(--color-primary-50);
    color: var(--color-primary-600);
    font-weight: var(--font-medium);
  }

  [data-theme="dark"] .nav-item.active {
    background: var(--color-primary-900);
    color: var(--color-primary-300);
  }

  .sidebar-footer {
    padding: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .view-site {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .view-site:hover {
    color: var(--color-primary-500);
  }
</style>
```

---

## Dashboard Page

### +page.server.ts

```typescript
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org, role } = await parent();
  const api = createServerApi(platform);
  const sessionCookie = cookies.get('codex-session');

  // Fetch dashboard stats
  const stats = await api.fetch<DashboardStats>(
    'admin',
    `/api/organizations/${org.id}/stats`,
    sessionCookie
  );

  // Fetch recent activity
  const activity = await api.fetch<ActivityItem[]>(
    'admin',
    `/api/organizations/${org.id}/activity?limit=10`,
    sessionCookie
  );

  return {
    stats,
    activity
  };
};

interface DashboardStats {
  revenue: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    currency: string;
  };
  customers: {
    total: number;
    thisMonth: number;
  };
  content: {
    total: number;
    published: number;
    drafts: number;
  };
  views: {
    total: number;
    thisMonth: number;
  };
}

interface ActivityItem {
  id: string;
  type: 'purchase' | 'publish' | 'signup' | 'view';
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

### +page.svelte

```svelte
<script lang="ts">
  import { DashboardWidget } from '$lib/components/studio/DashboardWidget.svelte';
  import { ActivityFeed } from '$lib/components/studio/ActivityFeed.svelte';
  import { QuickActions } from '$lib/components/studio/QuickActions.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  const { stats, activity, org, role } = data;

  const isAdmin = role === 'owner' || role === 'admin';

  function formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency
    }).format(amount / 100);
  }

  function formatPercentChange(current: number, previous: number): string {
    if (previous === 0) return '+100%';
    const change = ((current - previous) / previous) * 100;
    return change >= 0 ? `+${change.toFixed(0)}%` : `${change.toFixed(0)}%`;
  }
</script>

<svelte:head>
  <title>Dashboard | {org.name} Studio</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header">
    <h1>{m.studio_dashboard_title()}</h1>
    <QuickActions {org} />
  </header>

  {#if isAdmin}
    <section class="stats-grid">
      <DashboardWidget
        title={m.studio_stat_revenue()}
        value={formatCurrency(stats.revenue.thisMonth, stats.revenue.currency)}
        change={formatPercentChange(stats.revenue.thisMonth, stats.revenue.lastMonth)}
        trend={stats.revenue.thisMonth >= stats.revenue.lastMonth ? 'up' : 'down'}
        subtitle={m.studio_stat_this_month()}
      />

      <DashboardWidget
        title={m.studio_stat_customers()}
        value={stats.customers.total.toString()}
        change={`+${stats.customers.thisMonth}`}
        trend="up"
        subtitle={m.studio_stat_this_month()}
      />

      <DashboardWidget
        title={m.studio_stat_content()}
        value={stats.content.published.toString()}
        subtitle={m.studio_stat_published()}
        extra={`${stats.content.drafts} ${m.studio_stat_drafts()}`}
      />

      <DashboardWidget
        title={m.studio_stat_views()}
        value={stats.views.thisMonth.toLocaleString()}
        subtitle={m.studio_stat_this_month()}
      />
    </section>
  {/if}

  <div class="dashboard-body">
    <section class="activity-section">
      <h2>{m.studio_recent_activity()}</h2>
      <ActivityFeed items={activity} />
    </section>

    <section class="quick-links">
      <h2>{m.studio_quick_links()}</h2>
      <nav class="quick-links-nav">
        <a href="/{org.slug}/studio/content/new">{m.studio_create_content()}</a>
        <a href="/{org.slug}/studio/content">{m.studio_manage_content()}</a>
        {#if isAdmin}
          <a href="/{org.slug}/studio/analytics">{m.studio_view_analytics()}</a>
          <a href="/{org.slug}/studio/settings">{m.studio_settings()}</a>
        {/if}
      </nav>
    </section>
  </div>
</div>

<style>
  .dashboard {
    max-width: 1200px;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-6);
  }

  .dashboard-header h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-4);
    margin-bottom: var(--space-8);
  }

  .dashboard-body {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: var(--space-6);
  }

  @media (max-width: 768px) {
    .dashboard-body {
      grid-template-columns: 1fr;
    }
  }

  .activity-section h2,
  .quick-links h2 {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-4);
  }

  .quick-links-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .quick-links-nav a {
    padding: var(--space-3);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    color: var(--color-text);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .quick-links-nav a:hover {
    background: var(--color-surface-secondary);
    color: var(--color-primary-500);
  }
</style>
```

---

## Content Management

### Content List Page

```svelte
<!-- src/routes/(org)/[slug]/studio/content/+page.svelte -->
<script lang="ts">
  import { DataTable } from '$lib/components/studio/DataTable.svelte';
  import { Badge } from '$lib/components/ui/Badge/Badge.svelte';
  import { Button } from '$lib/components/ui/Button/Button.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const columns = [
    { key: 'title', label: m.content_col_title() },
    { key: 'type', label: m.content_col_type() },
    { key: 'status', label: m.content_col_status() },
    { key: 'views', label: m.content_col_views() },
    { key: 'revenue', label: m.content_col_revenue() },
    { key: 'actions', label: '', width: '100px' }
  ];
</script>

<div class="content-page">
  <header class="page-header">
    <h1>{m.studio_content_title()}</h1>
    <Button href="/{data.org.slug}/studio/content/new">
      {m.studio_create_content()}
    </Button>
  </header>

  <DataTable {columns} data={data.content}>
    {#snippet cell(row, column)}
      {#if column.key === 'status'}
        <Badge variant={row.status === 'published' ? 'success' : 'default'}>
          {row.status}
        </Badge>
      {:else if column.key === 'actions'}
        <a href="/{data.org.slug}/studio/content/{row.id}">
          {m.common_edit()}
        </a>
      {:else}
        {row[column.key]}
      {/if}
    {/snippet}
  </DataTable>
</div>
```

---

## Role-Based Access

### Access Control Matrix

| Feature | Creator | Admin | Owner |
|---------|---------|-------|-------|
| Dashboard stats | Limited | Full | Full |
| Own content | ✅ | ✅ | ✅ |
| All content | ❌ | ✅ | ✅ |
| Customers | ❌ | ✅ | ✅ |
| Analytics | ❌ | ✅ | ✅ |
| Team management | ❌ | ✅ | ✅ |
| Settings | ❌ | ✅ | ✅ |
| Billing | ❌ | ❌ | ✅ |

### Role Check Helper

```typescript
// src/lib/utils/roles.ts
export type OrgRole = 'owner' | 'admin' | 'creator';

export function canAccessRoute(role: OrgRole, route: string): boolean {
  const adminRoutes = ['/customers', '/analytics', '/team', '/settings'];
  const ownerRoutes = ['/billing'];

  if (ownerRoutes.some(r => route.includes(r))) {
    return role === 'owner';
  }

  if (adminRoutes.some(r => route.includes(r))) {
    return role === 'owner' || role === 'admin';
  }

  return true;
}

export function canManageContent(role: OrgRole, contentCreatorId: string, userId: string): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return contentCreatorId === userId;
}
```

---

## i18n Messages

```json
{
  "studio_nav_dashboard": "Dashboard",
  "studio_nav_content": "Content",
  "studio_nav_media": "Media",
  "studio_nav_analytics": "Analytics",
  "studio_nav_customers": "Customers",
  "studio_nav_team": "Team",
  "studio_nav_settings": "Settings",
  "studio_nav_billing": "Billing",
  "studio_view_site": "View Site",

  "studio_dashboard_title": "Dashboard",
  "studio_stat_revenue": "Revenue",
  "studio_stat_customers": "Customers",
  "studio_stat_content": "Content",
  "studio_stat_views": "Views",
  "studio_stat_this_month": "This month",
  "studio_stat_published": "Published",
  "studio_stat_drafts": "drafts",

  "studio_recent_activity": "Recent Activity",
  "studio_quick_links": "Quick Links",
  "studio_create_content": "Create Content",
  "studio_manage_content": "Manage Content",
  "studio_view_analytics": "View Analytics",
  "studio_settings": "Settings",

  "studio_content_title": "Content",
  "content_col_title": "Title",
  "content_col_type": "Type",
  "content_col_status": "Status",
  "content_col_views": "Views",
  "content_col_revenue": "Revenue"
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-FOUNDATION-001 | ✅ | Project setup |
| P1-FE-FOUNDATION-002 | ✅ | UI components |
| Admin-API | ✅ | Dashboard stats |
| Content-API | ✅ | Content CRUD |
| Organization-API | ✅ | Role checking |

---

## Implementation Checklist

- [ ] **Studio Layout**
  - [ ] Create +layout.svelte with sidebar
  - [ ] Implement role checking in +layout.server.ts
  - [ ] Build StudioSidebar with role-based nav
  - [ ] Build StudioHeader

- [ ] **Dashboard**
  - [ ] Create dashboard page
  - [ ] Build DashboardWidget component
  - [ ] Build ActivityFeed component
  - [ ] Implement stats fetching

- [ ] **Content Management**
  - [ ] Content list with DataTable
  - [ ] Content create page
  - [ ] Content edit page
  - [ ] Status management (draft, published)

- [ ] **Customers Page**
  - [ ] Customer list with DataTable
  - [ ] Customer detail view
  - [ ] Purchase history

- [ ] **Analytics Page**
  - [ ] Revenue chart
  - [ ] Content performance table
  - [ ] Date range selector

- [ ] **Role Enforcement**
  - [ ] Route-level role checks
  - [ ] UI element hiding
  - [ ] API authorization

---

## Testing Strategy

### Unit Tests

```typescript
describe('Role Access', () => {
  it('creator cannot access admin routes');
  it('admin cannot access billing');
  it('owner can access all routes');
});
```

### Integration Tests

```typescript
describe('Studio Dashboard', () => {
  it('loads stats for admin');
  it('shows limited stats for creator');
  it('redirects unauthenticated users');
});
```

---

## Notes

### Performance

- Aggregate stats on backend
- Cache dashboard data (short TTL)
- Paginate content/customer lists

### Security

- All role checks server-side
- API validates role before operations
- No sensitive data in client store

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
