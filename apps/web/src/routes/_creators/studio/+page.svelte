<!--
  @component CreatorStudioDashboard

  Personal studio dashboard showing content/media stats,
  quick actions, and recent activity feed.

  Mirrors the org studio dashboard structure but scoped to
  personal creator content (no org-specific revenue/customer stats).
-->
<script lang="ts">
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import ActivityFeed from '$lib/components/studio/ActivityFeed.svelte';
  import {
    PlusIcon,
    UploadIcon,
    TrendingUpIcon,
    GlobeIcon,
  } from '$lib/components/ui/Icon';
  import { listContent } from '$lib/remote/content.remote';
  import { listMedia } from '$lib/remote/media.remote';
  import { getActivityFeed } from '$lib/remote/admin.remote';
  import type { Component } from 'svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  // Query-based data fetching — page shell renders immediately,
  // data loads in background with skeleton states.
  // No organizationId = personal creator content only.
  const contentQuery = $derived(listContent({ limit: 1 }));
  const mediaQuery = $derived(listMedia({ limit: 1 }));
  const activitiesQuery = $derived(getActivityFeed({ limit: 10 }));

  // Derive loading state: both stat queries must resolve
  const statsLoading = $derived(contentQuery?.loading || mediaQuery?.loading);

  // ── Quick Actions ──────────────────────────────────────────────────────────

  interface QuickAction {
    label: string;
    icon: Component<{ size?: number | string; class?: string }>;
    href: string;
    external?: boolean;
  }

  const quickActions: QuickAction[] = [
    { label: m.studio_action_create_content(), icon: PlusIcon, href: '/studio/content?action=create' },
    { label: m.studio_action_upload_media(), icon: UploadIcon, href: '/studio/media' },
    { label: m.studio_action_analytics(), icon: TrendingUpIcon, href: '/studio/analytics' },
    { label: m.studio_action_view_site(), icon: GlobeIcon, href: '/', external: true },
  ];
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | My Studio</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header">
    <h1 class="dashboard-title">{m.studio_dashboard_title()}</h1>
    <p class="dashboard-subtitle">{m.studio_creator_dashboard_subtitle()}</p>
  </header>

  {#if statsLoading}
    <section class="stats-grid" aria-label="Dashboard statistics">
      {#each Array(2) as _}
        <div class="stat-card-skeleton">
          <div class="skeleton" style="width: 80px; height: var(--text-sm); margin-bottom: var(--space-2);"></div>
          <div class="skeleton" style="width: 120px; height: var(--text-3xl);"></div>
        </div>
      {/each}
    </section>
  {:else}
    <section class="stats-grid" aria-label="Dashboard statistics">
      <StatCard
        label={m.studio_stat_content()}
        value={contentQuery?.current?.pagination?.total ?? '--'}
        loading={!contentQuery?.current}
      />
      <StatCard
        label={m.studio_stat_media()}
        value={mediaQuery?.current?.pagination?.total ?? '--'}
        loading={!mediaQuery?.current}
      />
    </section>
  {/if}

  <section class="quick-actions" aria-label={m.studio_quick_actions()}>
    {#each quickActions as action (action.href)}
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
    {#if activitiesQuery?.loading}
      <div class="activity-skeleton">
        {#each Array(5) as _}
          <div class="skeleton" style="width: 100%; height: var(--space-10); margin-bottom: var(--space-2);"></div>
        {/each}
      </div>
    {:else}
      <ActivityFeed
        activities={activitiesQuery?.current?.items ?? []}
        loading={false}
      />
    {/if}
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
    outline-offset: var(--space-0-5);
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

  /* ── Skeleton Loading States ─────────────────────────────────────────── */

  .stat-card-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .activity-skeleton {
    display: flex;
    flex-direction: column;
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Responsive ───────────────────────────────────────────────────────── */

  @media (--breakpoint-sm) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .quick-actions {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .quick-actions {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
