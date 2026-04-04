<!--
  @component StudioDashboard

  The main studio dashboard page showing key metrics, revenue chart,
  quick actions, and recent activity.

  Revenue/customer stats and revenue chart are only visible to admins and owners.
  Content count, views, quick actions (filtered), and activity feed are
  visible to all studio roles.
-->
<script lang="ts">
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import ActivityFeed from '$lib/components/studio/ActivityFeed.svelte';
  import RevenueChart from '$lib/components/studio/RevenueChart.svelte';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/Card';
  import {
    PlusIcon,
    UploadIcon,
    TrendingUpIcon,
    UsersIcon,
    EditIcon,
    GlobeIcon,
  } from '$lib/components/ui/Icon';
  import type { Component } from 'svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const isAdmin = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );

  /**
   * Format cents to currency string (GBP)
   */
  function formatRevenue(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }

  // ── Quick Actions ──────────────────────────────────────────────────────────

  interface QuickAction {
    label: string;
    icon: Component<{ size?: number | string; class?: string }>;
    href: string;
    adminOnly: boolean;
    external?: boolean;
  }

  const quickActions: QuickAction[] = [
    { label: m.studio_action_create_content(), icon: PlusIcon, href: '/studio/content?action=create', adminOnly: false },
    { label: m.studio_action_upload_media(), icon: UploadIcon, href: '/studio/media', adminOnly: false },
    { label: m.studio_action_analytics(), icon: TrendingUpIcon, href: '/studio/analytics', adminOnly: false },
    { label: m.studio_action_manage_team(), icon: UsersIcon, href: '/studio/team', adminOnly: true },
    { label: m.studio_action_edit_branding(), icon: EditIcon, href: '/studio/settings/branding', adminOnly: true },
    { label: m.studio_action_view_site(), icon: GlobeIcon, href: '/', adminOnly: false, external: true },
  ];

  const visibleActions = $derived(
    quickActions.filter((a) => !a.adminOnly || isAdmin)
  );

  // ── Revenue Chart Data ─────────────────────────────────────────────────────

  const chartData = $derived(
    (data.stats?.revenue?.revenueByDay ?? [])
      .slice(-14)
      .map((d) => ({ date: d.date, revenue: d.revenueCents }))
  );
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | {data.org.name}</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header">
    <h1 class="dashboard-title">{m.studio_dashboard_title()}</h1>
    <p class="dashboard-subtitle">{m.studio_dashboard_subtitle()}</p>
  </header>

  <section class="stats-grid" aria-label="Dashboard statistics">
    {#if isAdmin}
      <StatCard
        label={m.studio_stat_revenue()}
        value={data.stats ? formatRevenue(data.stats.revenue.value) : '--'}
        change={data.stats?.revenue.change}
        loading={!data.stats}
      />
      <StatCard
        label={m.studio_stat_customers()}
        value={data.stats?.customers.value ?? '--'}
        change={data.stats?.customers.change}
        loading={!data.stats}
      />
    {/if}
    <StatCard
      label={m.studio_stat_content()}
      value={data.stats?.contentCount.value ?? '--'}
      change={data.stats?.contentCount.change}
      loading={!data.stats}
    />
    <StatCard
      label={m.studio_stat_views()}
      value={data.stats?.views.value ?? '--'}
      change={data.stats?.views.change}
      loading={!data.stats}
    />
  </section>

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

  <section class="activity-section">
    <ActivityFeed
      activities={data.activities ?? []}
      loading={!data.activities}
    />
  </section>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .dashboard-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .dashboard-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .dashboard-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  /* ── Revenue Chart ────────────────────────────────────────────────────── */

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

  /* ── Quick Actions Grid ───────────────────────────────────────────────── */

  .quick-actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
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

  .quick-action-link :global(.quick-action-icon) {
    color: var(--color-text-secondary);
    transition: color var(--duration-fast) var(--ease-default);
  }

  .quick-action-link:hover :global(.quick-action-icon) {
    color: var(--color-interactive);
  }

  .quick-action-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-align: center;
    line-height: var(--leading-normal);
  }

  .activity-section {
    margin-top: var(--space-2);
  }

  /* ── Responsive ───────────────────────────────────────────────────────── */

  /* Tablet: 2 columns for stats, 3 columns for quick actions */
  @media (--breakpoint-sm) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .quick-actions {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* Desktop: 4 columns for stats */
  @media (--breakpoint-lg) {
    .stats-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
