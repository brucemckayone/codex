<!--
  @component StudioJourneyInsights

  Studio reporting surface for one journey/course (WP-7, Codex-2pryk.3.4 ·
  FRONTEND-MAP §5.3). Sits under the `ssr=false` studio subtree, so it loads
  client-side via the `getJourneyInsights` remote query and mirrors the
  studio/analytics auth-guard + URL-param pattern.

  `[id]` is the course id. The reporting window is driven by `?period=`.
  Data is provenance-tagged: `live` (financial) + `course` (engagement). The
  data source is the single Round-D seam — see journey-insights.remote.ts.

  @prop data - Inherited studio layout data: { org, userRole, ... }.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    JourneyInsightsPanel,
    type InsightsPeriod,
  } from '$lib/components/studio/journey-insights';
  import { getJourneyInsights } from '$lib/remote/journey-insights.remote';

  let { data } = $props();

  // ─── Auth / role guard ────────────────────────────────────────────────
  // Owner + admin only, matching studio/analytics. ssr=false means the first
  // client render has data.userRole === undefined — wait for it to populate
  // before redirecting, or we'd bounce authorised users.
  $effect(() => {
    if (
      data.userRole !== undefined &&
      data.userRole !== 'admin' &&
      data.userRole !== 'owner'
    ) {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );

  const courseId = $derived(page.params.id ?? '');

  // ─── URL → period ─────────────────────────────────────────────────────
  const VALID_PERIODS: InsightsPeriod[] = ['7d', '30d', '90d', 'all'];
  const period = $derived.by<InsightsPeriod>(() => {
    const raw = page.url.searchParams.get('period');
    return VALID_PERIODS.includes(raw as InsightsPeriod)
      ? (raw as InsightsPeriod)
      : '30d';
  });

  // ─── Remote query ─────────────────────────────────────────────────────
  // Re-keys off (orgId, courseId, period) so period changes refetch.
  const insightsQuery = $derived(
    isAuthorized && courseId
      ? getJourneyInsights({
          organizationId: data.org.id,
          courseId,
          period,
        })
      : null
  );

  const insights = $derived(insightsQuery?.current);

  function setPeriod(next: InsightsPeriod) {
    const url = new URL(page.url);
    url.searchParams.set('period', next);
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

{#if isAuthorized}
  <JourneyInsightsPanel data={insights} {period} onPeriodChange={setPeriod} />
{/if}
