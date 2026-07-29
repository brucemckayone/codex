<!--
  @component JourneyDashboardPage

  The authed course dashboard (SPEC §8.3) — the member "journey portal": the
  map + the single threshold back in. It does NOT play (the player is its own
  surface); it shows the whole arc, how far you are, and ONE way to resume.
  Client-rendered (ssr=false); the server gate already enforced `canEnterCourse`.

  Progress reads the SINGLE progress store (F19): the store hydrates from the
  server's known completions, and completing a practice in the player updates it
  reactively here (cross-tab + cross-device via `initProgressSync`).

  Surface (prototype `course-dashboard.html`): the "descent" portal. Its palette
  comes from the SHARED journey palette (`$lib/page-builder/journey-palette.css`,
  Codex-gfg50) — the same derivation the sales page and the checkout use — so the
  member area follows the creator's background AND the visitor's light/dark
  choice. The `--portal-*` names survive as aliases over that ladder; see the
  `<style>` block. It previously carried a third private derivation anchored on
  the brand PRIMARY at forced lightnesses, which honoured neither (Codex-4i8x5).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/page-builder/journey-palette.css';
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

<div class="journey-portal journey-palette">
  <!--
    `journey-palette--page` MUST sit on this inner element, not on
    `.journey-portal`. `--jp-ink` falls back to `--color-background`, so
    re-pointing `--color-background: var(--jp-ink)` on the SAME element is a
    custom-property cycle and the page paints nothing. A descendant merely
    inherits an already-resolved `--jp-ink`.
    See `$lib/page-builder/journey-palette.css`.
  -->
  <div class="journey-portal__inner journey-palette--page">
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
    /* ── The `--portal-*` names are now ALIASES over the shared journey palette ─
       (Codex-a1tz6, closing Codex-4i8x5.) This block used to be a THIRD private
       derivation: it anchored on the brand PRIMARY and then FORCED lightness
       (0.15 bg / 0.94 text) for a guaranteed dark space on any org colour. Two
       consequences made that wrong:

         1. It ignored the visitor's light/dark choice — the values were
            identical in both themes, so a dark-mode-off visitor still got a
            dark member area. Worse, it was DISCARDING a per-theme background
            that already resolves correctly one element up: on this very page
            `[data-org-bg]` gives #FFFBEB in light and #1A1207 in dark.
         2. It anchored on `--brand-color` (the org PRIMARY) where the sales page
            anchors on the brand BACKGROUND, so one journey rendered purple on
            its sales page and orange once you were inside it.

       `journey-palette.css` is the ONE derivation (Codex-gfg50) and already
       auto-contrasts every rung off the ink's own lightness, in either theme.
       The token NAMES are kept because `CurriculumMap.svelte` and
       `JourneyContinueCard.svelte` read them ~30 times between them; only the
       derivation changes, so no consumer moves.

       Surface ladder: the palette's insets lift TOWARD the contrast colour, so
       they go lighter on a dark ink and subtly darker on a light one — which is
       the direction "deeper / raised" wants in BOTH themes. `--portal-bg-deep`
       therefore means "one step off the paper" rather than the old literal
       "darker"; that reversal is exactly what makes it theme-correct. */
    --portal-bg: var(--jp-ink);
    --portal-bg-deep: var(--jp-ink-2);
    --portal-surface: var(--jp-ink-3);
    --portal-surface-2: var(--jp-ink-4);

    /* Text ladder, most → least prominent, all measured off the shared anchors
       so they follow the ink in either theme.

       The faint rung is NOT `--jp-faint`: it carries 13px meta text
       (`.lrow__meta`), and both `--jp-faint` (50%) and `--jp-dim` (70%) measure
       under AA there — 70% lands at 4.41:1 on the dark ink. 76% is the weakest
       mix that clears 4.5 on both poles, so the rung is pinned there rather than
       borrowed from a shared name that is tuned for larger text. */
    --portal-text: var(--jp-heading);
    --portal-text-dim: var(--jp-text);
    --portal-text-faint: color-mix(in oklab, var(--jp-heading) 76%, var(--jp-ink));

    /* The accent, its on-accent ink, and the accent AS TEXT. The last is a
       separate token because the raw ember measured 2.98:1 (dark) / 2.46:1
       (light) behind `Resume →` and the eyebrows — a pre-existing failure that
       enabling light mode would otherwise have deepened. */
    --portal-ember: var(--jp-ember);
    --portal-ember-soft: oklch(from var(--jp-ember) calc(l - 0.1) c h);
    --portal-ember-ink: var(--jp-on-ember);
    --portal-ember-text: var(--jp-ember-text);

    /* The semantic TEXT tokens are re-pointed by `.journey-palette` itself, at
       (0,3,0) — higher than this rule — so restating them here would be dead
       weight that could silently drift out of step with the shared ladder. */

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
    color: var(--portal-ember-text);
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
