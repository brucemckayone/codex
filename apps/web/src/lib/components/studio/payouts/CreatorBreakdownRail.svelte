<!--
  @component CreatorBreakdownRail (Codex-6nt4l)

  Persistent right rail on `/studio/payouts` that surfaces a per-creator
  aggregate alongside the main transaction table. Honours the page's
  filter chips (status / source / date) — the same args feed both the
  table query and this rail's breakdown query, so toggling a chip
  reshapes both surfaces consistently.

  The rail itself doesn't issue the query — the page wires the result of
  `getPayoutsByCreatorBreakdown()` in. This keeps the component reusable
  and the data lifecycle co-located with the page's other queries.

  @prop breakdown     - Pre-fetched CreatorPayoutBreakdown rows (sorted desc by totalPaidCents)
  @prop loading       - Show skeleton tiles while the rail's query is in flight
  @prop activeFilters - Optional filter-state hint (display only)
-->
<script lang="ts">
  import { Skeleton } from '$lib/components/ui';
  import type {
    CreatorPayoutBreakdown,
    PayoutSourceFilter,
    PayoutStatusFilter,
  } from '@codex/subscription';
  import type { DateRange } from '@codex/shared-types';
  import CreatorBreakdownCard from './CreatorBreakdownCard.svelte';

  interface Props {
    breakdown: CreatorPayoutBreakdown[];
    loading: boolean;
    activeFilters?: {
      status: PayoutStatusFilter;
      source: PayoutSourceFilter;
      range: DateRange;
    };
  }

  const { breakdown, loading, activeFilters }: Props = $props();

  // "Filtered by …" hint — surfaced only when at least one filter is
  // off-default. Reads cleaner than the URL params and reminds the
  // operator why the rail's totals might be smaller than they expect.
  const filterHint = $derived.by(() => {
    if (!activeFilters) return null;
    const parts: string[] = [];
    if (activeFilters.status !== 'all') parts.push(activeFilters.status);
    if (activeFilters.source !== 'all') parts.push(activeFilters.source);
    if (activeFilters.range !== '30')
      parts.push(activeFilters.range === 'all' ? 'all time' : `${activeFilters.range}d`);
    return parts.length > 0 ? parts.join(' · ') : null;
  });
</script>

<aside class="rail" aria-label="Payouts by creator">
  <header class="rail__header">
    <h2 class="rail__title">By creator</h2>
    {#if filterHint}
      <span class="rail__hint">Filtered: {filterHint}</span>
    {/if}
  </header>

  {#if loading}
    <div class="rail__list" aria-busy="true">
      {#each Array.from({ length: 3 }) as _, i (i)}
        <div class="rail__skeleton">
          <Skeleton width="60%" height="var(--space-5)" />
          <Skeleton width="40%" height="var(--space-7)" />
          <Skeleton width="80%" height="var(--space-4)" />
        </div>
      {/each}
    </div>
  {:else if breakdown.length === 0}
    <p class="rail__empty">
      This breaks payouts down by creator. No creators have been paid under
      these filters yet — as the sole creator you're your own beneficiary, so
      your share lands here once your first invoice is paid. Invite other
      creators via revenue-share to see the split across the team.
    </p>
  {:else}
    <div class="rail__list">
      {#each breakdown as row (row.userId)}
        <CreatorBreakdownCard breakdown={row} />
      {/each}
    </div>
  {/if}
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .rail__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .rail__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .rail__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .rail__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .rail__skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background-color: var(--color-surface-card);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .rail__empty {
    margin: 0;
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }
</style>
