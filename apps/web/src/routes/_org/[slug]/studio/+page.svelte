<!--
  @component StudioDashboard

  The main studio dashboard page showing key metrics and recent activity.
  Revenue and customer stats are only visible to admins and owners.
  Content count and views are visible to all studio roles.
-->
<script lang="ts">
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import ActivityFeed from '$lib/components/studio/ActivityFeed.svelte';
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
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | {data.org.name} Studio</title>
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

  .activity-section {
    margin-top: var(--space-2);
  }

  /* Tablet: 2 columns */
  @media (min-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* Desktop: 4 columns */
  @media (min-width: 1024px) {
    .stats-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
