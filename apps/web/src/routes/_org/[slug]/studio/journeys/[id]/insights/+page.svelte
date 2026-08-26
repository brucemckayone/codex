<!--
  @component StudioJourneyInsights

  Studio reporting surface for one journey/course (WP-7, Codex-2pryk.3.4 ·
  FRONTEND-MAP §5.3). Sits under the `ssr=false` studio subtree, so it loads
  client-side via the `getJourneyInsights` remote query and mirrors the
  studio/analytics auth-guard + URL-param pattern.

  `[id]` is the journey's LANDING-PAGE id — the same id `page/` and `curriculum/`
  bind under this route segment, and the id the studio index links with. The
  worker resolves it to the subject course. The reporting window is driven by
  `?period=`. Data is provenance-tagged: `live` (financial) + `course`
  (engagement). The data source is the single Round-D seam — see
  journey-insights.remote.ts.

  @prop data - Inherited studio layout data: { org, userRole, ... }.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    JourneyInsightsPanel,
    type InsightsPeriod,
    type JourneyInsightsData,
  } from '$lib/components/studio/journey-insights';
  import { getJourneyInsights } from '$lib/remote/journey-insights.remote';
  import { queryErrorMessage, type QueryResult } from '$lib/remote/query-result';

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

  // The LANDING-PAGE id, not the course id. This was named `courseId` and passed
  // straight through as one (Codex-xo3bl): both are UUIDs, so validation passed
  // and the worker's `courses.id` lookup 404'd on every single request.
  const pageId = $derived(page.params.id ?? '');

  // ─── URL → period ─────────────────────────────────────────────────────
  const VALID_PERIODS: InsightsPeriod[] = ['7d', '30d', '90d', 'all'];
  const period = $derived.by<InsightsPeriod>(() => {
    const raw = page.url.searchParams.get('period');
    return VALID_PERIODS.includes(raw as InsightsPeriod)
      ? (raw as InsightsPeriod)
      : '30d';
  });

  // ─── Remote query ─────────────────────────────────────────────────────
  // Re-keys off (orgId, pageId, period) so period changes refetch.
  const insightsQuery = $derived(
    isAuthorized && pageId
      ? getJourneyInsights({
          organizationId: data.org.id,
          pageId,
          period,
        })
      : null
  );

  const insights = $derived(
    (insightsQuery as QueryResult<JourneyInsightsData> | null)?.current
  );
  // A failed insights fetch renders an error state rather than sitting on the
  // loading skeletons (the query rejects on a 4xx/5xx from the studio route —
  // e.g. a journey that no longer resolves in this org).
  //
  // MUST go through `queryErrorMessage`: SvelteKit rejects with `HttpError`,
  // whose text lives at `.body.message`. This read was `.error?.message`, which
  // is `undefined` on every HttpError ever thrown — so the branch below was
  // unreachable and the panel showed 7 skeletons forever (Codex-xo3bl).
  const insightsError = $derived(
    queryErrorMessage(
      (insightsQuery as QueryResult<JourneyInsightsData> | null)?.error
    )
  );

  function setPeriod(next: InsightsPeriod) {
    const url = new URL(page.url);
    url.searchParams.set('period', next);
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

{#if isAuthorized}
  <JourneyInsightsPanel
    data={insights}
    {period}
    onPeriodChange={setPeriod}
    error={insightsError}
  />
{/if}
