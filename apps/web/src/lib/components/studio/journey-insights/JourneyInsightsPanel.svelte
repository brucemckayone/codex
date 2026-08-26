<!--
  @component JourneyInsightsPanel

  The studio journey/course insights surface (FRONTEND-MAP §5.3). Composes:
  header (course title + period toggle) → provenance legend → one section per
  provenance tier of KPICards. Presentation only: it takes the seam's data and
  the pure metric model does the tier grouping.

  Three states: `error` (a failed read), `data` (metrics), and neither — the
  loading skeletons. Skeletons render until the first data arrives (the studio
  subtree is an `ssr=false` SPA, so first client paint has no data yet).

  `error` takes precedence over the skeletons, because a failed read leaves
  `data` undefined and would otherwise be INDISTINGUISHABLE from still-loading —
  the surface then waits forever on a request that already came back (Codex-xo3bl).
  The error replaces only the metric groups: the header and period toggle stay
  live so a failed window can be switched away from without a reload.

  @prop {JourneyInsightsData | undefined} data   Resolved insights, or undefined while loading.
  @prop {InsightsPeriod} period                  Current reporting window.
  @prop {(p: InsightsPeriod) => void} onPeriodChange  Period change handler.
  @prop {string | null} [error]                  Failure text, or null when the read is healthy.
-->
<script lang="ts">
  import { Alert } from '$lib/components/ui';
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
    error?: string | null;
  }

  const { data, period, onPeriodChange, error = null }: Props = $props();

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
    {#if error}
      <Alert variant="error">
        <p class="insights__error-title">Could not load insights</p>
        <p class="insights__error-detail">{error}</p>
      </Alert>
    {:else if groups}
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

  .insights__error-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    line-height: var(--leading-normal);
    margin: 0;
  }

  .insights__error-detail {
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    margin: var(--space-1) 0 0;
  }
</style>
