<!--
  @component JourneyDashboardPage

  The authed course dashboard (SPEC §8.3): enrollment + progress rollup, the
  curriculum map with completion overlay, and continue-where-left-off. Client-
  rendered (ssr=false); the server gate already enforced `canEnterCourse`.

  Progress reads the SINGLE progress store (F19): the store hydrates from the
  server's known completions, and completing a practice in the player updates
  it reactively here (cross-tab + cross-device via `initProgressSync`).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadCourseCompletionsFromServer,
    type PlaybackProgress,
    progressCollection,
    useLiveQuery,
  } from '$lib/collections';
  import CurriculumMap from '$lib/components/journeys/CurriculumMap.svelte';
  import ProgressRing from '$lib/components/journeys/ProgressRing.svelte';
  import { ArrowRightIcon, PlayIcon } from '$lib/components/ui/Icon';
  import {
    computeCourseRollup,
    selectContinuePractice,
  } from '$lib/journeys/rollup';

  let { data } = $props();

  const dashboard = $derived(data.dashboard);
  const courseSlug = $derived(dashboard.course.slug ?? dashboard.course.id);

  // Hydrate the store with the server's known completions, then let the live
  // query drive. Before hydration completes, fall back to the server list so
  // the rollup never flashes empty ([[feedback_uselivequery_empty_array_fallback]]:
  // gate on `hydrated`, not `data ?? ssrData`).
  let hydrated = $state(false);
  onMount(() => {
    loadCourseCompletionsFromServer(dashboard.completions);
    hydrated = true;
  });

  const progressQuery = useLiveQuery(
    (q) => q.from({ item: progressCollection }),
    undefined,
    { ssrData: [] as PlaybackProgress[] }
  );

  const rows = $derived((progressQuery.data ?? []) as PlaybackProgress[]);

  const completedIds = $derived.by(() => {
    if (!hydrated) {
      return new Set(dashboard.completions.map((c) => c.contentId));
    }
    return new Set(
      rows.filter((r) => r.practiceCompletedAt).map((r) => r.contentId)
    );
  });

  const inProgressIds = $derived.by(
    () =>
      new Set(
        rows
          .filter((r) => r.positionSeconds > 0 && !r.practiceCompletedAt)
          .map((r) => r.contentId)
      )
  );

  const rollup = $derived(computeCourseRollup(dashboard.stages, completedIds));
  const continueEntry = $derived(
    selectContinuePractice(dashboard.stages, completedIds, inProgressIds)
  );

  const continueHref = $derived(
    continueEntry
      ? `/journeys/${courseSlug}/practice/${continueEntry.slug ?? continueEntry.contentId}`
      : null
  );

  const isFresh = $derived(rollup.overall.done === 0);
</script>

<svelte:head>
  <title>{dashboard.course.title} · Your journey</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard__hero">
    <div class="dashboard__intro">
      <span class="dashboard__eyebrow">Your journey</span>
      <h1 class="dashboard__title">{dashboard.course.title}</h1>
      <p class="dashboard__status">
        {#if rollup.isComplete}
          You've completed every practice. Revisit anything, anytime.
        {:else if isFresh}
          Begin when you're ready — your first practice is one tap away.
        {:else}
          {rollup.overall.done} of {rollup.overall.total} practices complete.
        {/if}
      </p>

      {#if continueHref}
        <a class="dashboard__continue" href={continueHref}>
          <PlayIcon />
          {isFresh ? 'Begin the journey' : 'Continue where you left off'}
          <ArrowRightIcon />
        </a>
      {/if}
    </div>

    <div class="dashboard__ring" aria-hidden={rollup.overall.total === 0}>
      <ProgressRing
        percent={rollup.overall.percent}
        size="var(--space-24)"
        ariaLabel="Overall course progress: {rollup.overall.percent}%"
      />
    </div>
  </header>

  <CurriculumMap
    stages={dashboard.stages}
    {completedIds}
    {rollup}
    {courseSlug}
  />
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    max-width: 64rem;
    margin: 0 auto;
    padding: var(--space-8) var(--space-4);
  }

  .dashboard__hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .dashboard__intro {
    min-width: 0;
    flex: 1;
  }

  .dashboard__eyebrow {
    font-size: var(--text-xs);
    text-transform: var(--text-transform-label);
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .dashboard__title {
    margin: var(--space-1) 0 var(--space-2);
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    color: var(--color-heading);
  }

  .dashboard__status {
    margin: 0 0 var(--space-4);
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .dashboard__continue {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-button);
    background: var(--color-primary-600);
    color: var(--color-text-on-brand);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    text-decoration: none;
    transition: background-color var(--duration-fast) ease;
  }

  .dashboard__continue:hover {
    background: var(--color-primary-700);
  }

  .dashboard__continue:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .dashboard__ring {
    flex-shrink: 0;
  }
</style>
