/**
 * Journey insights — studio reporting surface (WP-7, Codex-2pryk.3.4).
 *
 * Provenance-tagged course reporting: `live` (financial) + `course`
 * (engagement) tiers. The pure metric model does the tier grouping; the data
 * source is the single Round-D seam `$lib/remote/journey-insights.remote.ts`.
 */
export { default as JourneyInsightsPanel } from './JourneyInsightsPanel.svelte';
export { default as MetricTierGroup } from './MetricTierGroup.svelte';
export * from './metric-model';
export { default as PeriodToggle } from './PeriodToggle.svelte';
export { default as ProvenanceLegend } from './ProvenanceLegend.svelte';
