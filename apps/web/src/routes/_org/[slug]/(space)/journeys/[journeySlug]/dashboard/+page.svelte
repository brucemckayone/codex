<!--
  @component JourneyDashboardPage

  The authed course dashboard (SPEC §8.3) — the member "journey portal": the
  map + the single threshold back in. It does NOT play (the player is its own
  surface); it shows the whole arc, how far you are, and ONE way to resume.
  Client-rendered (ssr=false); the server gate already enforced `canEnterCourse`.

  Progress reads the SINGLE progress store (F19): the store hydrates from the
  server's known completions, and completing a practice in the player updates it
  reactively here (cross-tab + cross-device via `initProgressSync`).

  Surface (prototype `course-dashboard.html`): a warm/dark "descent" portal.
  Its palette is SELF-DERIVED from the org brand via OKLCH on `.journey-portal`
  (anchored on `--brand-color`), and the semantic heading/text tokens are
  RE-POINTED there so the org-brand.css `[data-org-brand] :is(h1..h6)` backstop
  resolves to the portal palette instead of the neutral org heading colour.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CurriculumMap from '$lib/components/journeys/CurriculumMap.svelte';
  import JourneyContinueCard from '$lib/components/journeys/JourneyContinueCard.svelte';
  import {
    loadCourseCompletionsFromServer,
    type PlaybackProgress,
    progressCollection,
    useLiveQuery,
  } from '$lib/collections';
  import {
    computeCourseRollup,
    selectContinuePractice,
    toPlaylist,
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

  // The resume target for the map's "current" highlight + auto-open. Null once
  // the whole course is complete (nothing left to resume → no current row).
  const continueEntry = $derived(
    selectContinuePractice(dashboard.stages, completedIds, inProgressIds)
  );

  // Ordered stages once — the numeral in the continue meta + the map agree on it.
  const orderedStages = $derived(
    [...dashboard.stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  // The continue CARD always offers a threshold: mid-journey it points at the
  // resume target; once complete it points back to the very first practice
  // ("Revisit"). Null only when the course has no practices at all.
  const playlist = $derived(toPlaylist(dashboard.stages));
  const resumeEntry = $derived(continueEntry ?? playlist[0] ?? null);

  const resumeContext = $derived.by(() => {
    if (!resumeEntry) return null;
    const stageIndex = orderedStages.findIndex(
      (s) => s.id === resumeEntry.stageId
    );
    const practice = orderedStages
      .find((s) => s.id === resumeEntry.stageId)
      ?.practices.find((p) => p.contentId === resumeEntry.contentId);
    return {
      href: `/journeys/${courseSlug}/practice/${resumeEntry.slug ?? resumeEntry.contentId}`,
      title: resumeEntry.title,
      contentType: practice?.contentType ?? resumeEntry.contentType,
      durationSeconds: practice?.durationSeconds ?? null,
      stageName: resumeEntry.stageName,
      stageIndex: stageIndex < 0 ? 0 : stageIndex,
    };
  });

  const resumeState = $derived(
    rollup.isComplete
      ? ('revisit' as const)
      : rollup.overall.done === 0
        ? ('begin' as const)
        : ('resume' as const)
  );
</script>

<svelte:head>
  <title>{dashboard.course.title} · Your journey</title>
</svelte:head>

<div class="journey-portal">
  <div class="journey-portal__inner">
    <header class="portal-head">
      <p class="portal-head__eyebrow">Your journey</p>
      <h1 class="portal-head__title">{dashboard.course.title}</h1>
      {#if dashboard.course.lede}
        <p class="portal-head__lede">{dashboard.course.lede}</p>
      {/if}

      <div class="portal-prog">
        <div
          class="portal-prog__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rollup.overall.percent}
          aria-label="Overall course progress"
        >
          <i style="width: {rollup.overall.percent}%"></i>
        </div>
        {#if rollup.overall.total > 0}
          <p class="portal-prog__label">
            <strong>{rollup.overall.done} of {rollup.overall.total}</strong>
            practices · {rollup.overall.percent}% through
          </p>
        {:else}
          <p class="portal-prog__label">Your curriculum is being prepared.</p>
        {/if}
      </div>
    </header>

    {#if resumeContext}
      <JourneyContinueCard
        href={resumeContext.href}
        title={resumeContext.title}
        contentType={resumeContext.contentType}
        stageName={resumeContext.stageName}
        stageIndex={resumeContext.stageIndex}
        durationSeconds={resumeContext.durationSeconds}
        percent={rollup.overall.percent}
        state={resumeState}
      />
    {/if}

    {#if orderedStages.length > 0}
      <CurriculumMap
        stages={dashboard.stages}
        {completedIds}
        {rollup}
        {courseSlug}
        currentContentId={continueEntry?.contentId ?? null}
        currentStageId={continueEntry?.stageId ?? null}
      />
    {/if}
  </div>
</div>

<style>
  .journey-portal {
    /* ── Warm/dark "descent" portal, self-derived from the org brand ──────────
       Anchor the whole palette on the brand primary hue, then FORCE lightness
       for guaranteed contrast on any org colour (light-brand orgs still get a
       focused dark space; the hue keeps it on-brand). Chroma is scaled down so
       surfaces read as warm near-neutrals, not saturated blocks. */
    --portal-anchor: var(--brand-color, var(--color-primary-600));

    --portal-bg: oklch(from var(--portal-anchor) 0.15 calc(c * 0.3) h);
    --portal-bg-deep: oklch(from var(--portal-anchor) 0.1 calc(c * 0.3) h);
    --portal-surface: oklch(from var(--portal-anchor) 0.2 calc(c * 0.35) h);
    --portal-surface-2: oklch(from var(--portal-anchor) 0.24 calc(c * 0.42) h);

    --portal-text: oklch(from var(--portal-anchor) 0.94 calc(c * 0.08) h);
    --portal-text-dim: oklch(from var(--portal-anchor) 0.82 calc(c * 0.07) h);
    --portal-text-faint: oklch(from var(--portal-anchor) 0.64 calc(c * 0.07) h);

    /* The glowing accent ("ember") + its dark ink for text on the accent. */
    --portal-ember: oklch(from var(--portal-anchor) 0.72 calc(c * 0.9) h);
    --portal-ember-soft: oklch(from var(--portal-anchor) 0.6 calc(c * 0.9) h);
    --portal-ember-ink: oklch(from var(--portal-anchor) 0.18 calc(c * 0.5) h);

    /* Re-point the semantic tokens so descendants — and the org-brand.css
       `[data-org-brand] :is(h1..h6){color:var(--color-heading)}` backstop —
       resolve to the portal palette instead of fighting its specificity. */
    --color-heading: var(--portal-text);
    --color-text: var(--portal-text-dim);
    --color-text-secondary: var(--portal-text-dim);
    --color-text-muted: var(--portal-text-faint);

    min-height: 100dvh;
    background: var(--portal-bg);
    color: var(--portal-text-dim);
    /* A whisper of warmth at the top edge — never load-bearing for contrast. */
    background-image: radial-gradient(
        120% 80% at 50% -10%,
        color-mix(in oklab, var(--portal-ember) 12%, transparent),
        transparent 55%
      ),
      radial-gradient(
        90% 70% at 90% 108%,
        color-mix(in oklab, var(--portal-ember-soft) 8%, transparent),
        transparent 55%
      );
  }

  .journey-portal__inner {
    max-width: 48.75rem;
    margin: 0 auto;
    padding: clamp(var(--space-8), 5vw, var(--space-16))
      clamp(var(--space-4), 4vw, var(--space-8)) var(--space-20);
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  /* ── header ─────────────────────────────────────────────────────────────── */
  .portal-head__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--portal-ember);
  }

  .portal-head__title {
    margin: var(--space-2) 0 var(--space-3);
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    color: var(--portal-text);
  }

  .portal-head__lede {
    margin: 0;
    max-width: 52ch;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--portal-text-dim);
  }

  .portal-prog {
    margin-top: var(--space-6);
  }

  .portal-prog__bar {
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--portal-text) 12%, transparent);
    overflow: hidden;
  }

  .portal-prog__bar > i {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: linear-gradient(
      90deg,
      var(--portal-ember-soft),
      var(--portal-ember)
    );
    transition: width var(--duration-slow) var(--ease-out);
  }

  .portal-prog__label {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--portal-text-faint);
  }

  .portal-prog__label strong {
    color: var(--portal-text-dim);
    font-weight: var(--font-medium);
  }

  @media (prefers-reduced-motion: reduce) {
    .portal-prog__bar > i {
      transition: none;
    }
  }
</style>
