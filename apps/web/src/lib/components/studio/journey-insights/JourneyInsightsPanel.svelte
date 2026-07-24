<!--
  @component JourneyInsightsPanel

  The studio journey/course insights surface (FRONTEND-MAP §5.3). Composes:
  header (course title + period toggle) → provenance legend → one section per
  provenance tier of KPICards. Presentation only: it takes the seam's data and
  the pure metric model does the tier grouping.

  Skeletons render until the first data arrives (the studio subtree is an
  `ssr=false` SPA, so first client paint has no data yet).

  @prop {JourneyInsightsData | undefined} data   Resolved insights, or undefined while loading.
  @prop {InsightsPeriod} period                  Current reporting window.
  @prop {(p: InsightsPeriod) => void} onPeriodChange  Period change handler.
-->
<script lang="ts">
  import MetricTierGroup from './MetricTierGroup.svelte';
  import PeriodToggle from './PeriodToggle.svelte';
  import ProvenanceLegend from './ProvenanceLegend.svelte';
  import {
    buildJourneyMetricGroups,
    METRIC_TIERS,
    type InsightsPeriod,
    type JourneyInsightsData,
    type MetricTierGroupModel,
  } from './metric-model';

  interface Props {
    data: JourneyInsightsData | undefined;
    period: InsightsPeriod;
    onPeriodChange: (period: InsightsPeriod) => void;
  }

  const { data, period, onPeriodChange }: Props = $props();

  const groups = $derived(data ? buildJourneyMetricGroups(data) : null);

  // Empty skeleton groups keep the tier layout stable during first load.
  const liveSkeleton: MetricTierGroupModel = {
    tier: 'live',
    meta: METRIC_TIERS.live,
    metrics: [],
  };
  const courseSkeleton: MetricTierGroupModel = {
    tier: 'course',
    meta: METRIC_TIERS.course,
    metrics: [],
  };
</script>

<section class="insights">
  <header class="insights__header">
    <div class="insights__titles">
      <h1 class="insights__title">{data?.courseTitle ?? 'Insights'}</h1>
      <p class="insights__subtitle">
        Revenue and engagement for this journey.
      </p>
    </div>
    <PeriodToggle value={period} onChange={onPeriodChange} />
  </header>

  <ProvenanceLegend />

  <div class="insights__groups">
    {#if groups}
      {#each groups as group (group.tier)}
        <MetricTierGroup {group} />
      {/each}
    {:else}
      <MetricTierGroup group={liveSkeleton} loading skeletonCount={3} />
      <MetricTierGroup group={courseSkeleton} loading skeletonCount={4} />
    {/if}
  </div>
</section>

<style>
  .insights {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  .insights__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .insights__titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .insights__title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
  }

  .insights__subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin: 0;
  }

  .insights__groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
</style>
