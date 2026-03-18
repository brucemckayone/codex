<!--
  @component ActivityFeed

  Displays a list of recent activity events for the studio dashboard.
  Supports purchase, content_published, and member_joined event types.

  @prop {ActivityItem[]} activities - List of activity events to display
  @prop {boolean} [loading=false] - Whether the feed is in loading state
-->
<script lang="ts">
  import type { ActivityItem, ActivityItemType } from '@codex/shared-types';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/Card';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    activities: ActivityItem[];
    loading?: boolean;
  }

  const { activities, loading = false }: Props = $props();

  const typeConfig: Record<ActivityItemType, { icon: string; colorClass: string }> = {
    purchase: { icon: 'purchase-icon', colorClass: 'event-purchase' },
    content_published: { icon: 'publish-icon', colorClass: 'event-publish' },
    member_joined: { icon: 'signup-icon', colorClass: 'event-signup' },
  };

  function formatRelativeTime(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
</script>

<Card>
  <CardHeader>
    <CardTitle level={2}>{m.studio_activity_title()}</CardTitle>
  </CardHeader>
  <CardContent>
    <div class="activity-list" aria-live="polite">
      {#if loading}
        {#each Array(3) as _, i (i)}
          <div class="activity-item">
            <Skeleton width="2rem" height="2rem" class="skeleton-circle" />
            <div class="activity-text">
              <Skeleton width="70%" height="0.875rem" />
              <Skeleton width="40%" height="0.75rem" />
            </div>
          </div>
        {/each}
      {:else if activities.length === 0}
        <p class="empty-state">{m.studio_activity_empty()}</p>
      {:else}
        {#each activities as activity (activity.id)}
          {@const config = typeConfig[activity.type]}
          <div class="activity-item">
            <span class="activity-icon {config.colorClass}" aria-hidden="true">
              {#if activity.type === 'purchase'}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              {:else if activity.type === 'content_published'}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
              {/if}
            </span>
            <div class="activity-text">
              <p class="activity-title">{activity.title}</p>
              {#if activity.description}
                <p class="activity-description">{activity.description}</p>
              {/if}
              <time class="activity-time" datetime={activity.timestamp}>
                {formatRelativeTime(activity.timestamp)}
              </time>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </CardContent>
</Card>

<style>
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .activity-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .activity-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .activity-icon.event-purchase {
    background-color: var(--color-success-50);
    color: var(--color-success-700);
  }

  .activity-icon.event-publish {
    background-color: var(--color-primary-50, hsl(210, 100%, 95%));
    color: var(--color-primary-700, hsl(210, 80%, 40%));
  }

  .activity-icon.event-signup {
    background-color: var(--color-neutral-100);
    color: var(--color-neutral-700);
  }

  .activity-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
    min-width: 0;
    flex: 1;
  }

  .activity-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .activity-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .activity-time {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
  }

  .empty-state {
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    padding: var(--space-8) 0;
    margin: 0;
  }

  /* Dark mode */
  :global([data-theme='dark']) .activity-icon.event-purchase {
    background-color: color-mix(in srgb, var(--color-success-700) 20%, transparent);
    color: var(--color-success-400, var(--color-success-700));
  }

  :global([data-theme='dark']) .activity-icon.event-publish {
    background-color: color-mix(in srgb, var(--color-primary-700, hsl(210, 80%, 40%)) 20%, transparent);
    color: var(--color-primary-400, hsl(210, 80%, 60%));
  }

  :global([data-theme='dark']) .activity-icon.event-signup {
    background-color: var(--color-neutral-800, hsl(210, 10%, 20%));
    color: var(--color-neutral-300);
  }
</style>
