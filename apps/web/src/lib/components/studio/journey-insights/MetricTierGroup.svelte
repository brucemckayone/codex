<!--
  @component MetricTierGroup

  One provenance tier rendered as a section: a heading carrying the tier's
  provenance Badge + source description, then a KPICard grid of that tier's
  metrics. Reuses the studio analytics `KPICard` (money = GBP pence).

  Provenance is STRUCTURAL here — the whole section is one tier, badged and
  described, so the reader always knows where these numbers come from.

  @prop {MetricTierGroupModel} group        Tier meta + its tagged metrics.
  @prop {boolean} [loading=false]           Render skeleton tiles instead of data.
  @prop {number}  [skeletonCount=3]         How many skeleton tiles when loading.
-->
<script lang="ts">
  import { KPICard } from '$lib/components/studio/analytics';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import type { MetricTierGroupModel } from './metric-model';

  interface Props {
    group: MetricTierGroupModel;
    loading?: boolean;
    skeletonCount?: number;
  }

  const { group, loading = false, skeletonCount = 3 }: Props = $props();

  // `live` reads as an active/derivable source → info; `course` is neutral.
  const badgeVariant = $derived(group.tier === 'live' ? 'info' : 'neutral');
  const headingId = $derived(`insights-tier-${group.tier}`);
  const skeletonKeys = $derived(
    Array.from({ length: skeletonCount }, (_, i) => `skeleton-${i}`)
  );
</script>

<section class="tier-group" aria-labelledby={headingId}>
  <header class="tier-group__header">
    <h2 id={headingId} class="tier-group__title">{group.meta.label}</h2>
    <Badge variant={badgeVariant}>{group.meta.label}</Badge>
  </header>
  <p class="tier-group__desc">{group.meta.description}</p>

  <div class="tier-group__grid">
    {#if loading}
      {#each skeletonKeys as key (key)}
        <KPICard label="" value={0} loading />
      {/each}
    {:else}
      {#each group.metrics as metric (metric.key)}
        {@const kpiFormat = metric.format === 'money' ? 'money' : 'number'}
        {@const kpiUnit = metric.format === 'percent' ? '%' : metric.unit}
        <KPICard
          label={metric.label}
          value={metric.value}
          format={kpiFormat}
          previousValue={metric.previousValue}
          sparkline={metric.trend}
          unit={kpiUnit}
        />
      {/each}
    {/if}
  </div>
</section>

<style>
  .tier-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .tier-group__header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .tier-group__title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
  }

  .tier-group__desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin: 0;
  }

  /* KPI grid: 4-up desktop, 2-up tablet, 1-up mobile — mirrors studio analytics. */
  .tier-group__grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }

  @media (--below-lg) {
    .tier-group__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (--below-sm) {
    .tier-group__grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
