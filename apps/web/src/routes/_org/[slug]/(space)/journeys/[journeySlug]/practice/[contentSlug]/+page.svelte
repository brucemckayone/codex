<!--
  @component InCoursePracticePage

  The in-course player (SPEC §8.3 / §8.6): the WHOLE journey map as a sticky
  rail + the working pane. The SAME content item renders differently INSIDE a
  course (stage context, next/prev, progress, completion, peak-end close) than
  standalone — route context selects this UI. Client-rendered (ssr=false); the
  server gate enforced canEnterCourse + canView.

  The page INHERITS the design-system semantic theme (like the library / explore
  / standalone-viewer surfaces) — no forced palette. Surfaces, text, and borders
  come from the theme tokens; accents use the real `--color-brand-primary` (the
  org brand); the video/audio player keeps its own dark `--color-player-*` chrome.

  Completion + playback read the SINGLE progress store (F19): the working pane
  auto-marks media on genuine 100% finish and writes explicit completions for
  written practices; both update the playlist rail + dashboard reactively.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadCourseCompletionsFromServer,
    type PlaybackProgress,
    progressCollection,
    useLiveQuery,
  } from '$lib/collections';
  import PracticePlaylist from '$lib/components/journeys/PracticePlaylist.svelte';
  import PracticeWorkingPane from '$lib/components/journeys/PracticeWorkingPane.svelte';
  import { ArrowLeftIcon } from '$lib/components/ui/Icon';

  let { data } = $props();

  const practiceData = $derived(data.practice);
  const current = $derived(practiceData.practice);
  const courseTitle = $derived(practiceData.course.title);
  const courseSlug = $derived(
    practiceData.course.slug ?? practiceData.course.id
  );
  const dashboardHref = $derived(`/journeys/${courseSlug}/dashboard`);

  // Hydrate the store with the course's known completions, then live-query it.
  let hydrated = $state(false);
  onMount(() => {
    loadCourseCompletionsFromServer(practiceData.completions);
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
      return new Set(practiceData.completions.map((c) => c.contentId));
    }
    return new Set(
      rows.filter((r) => r.practiceCompletedAt).map((r) => r.contentId)
    );
  });

  // Current practice completion + watch % — drive the working pane's affordance
  // and the D-E media auto-write (fires at 100%).
  const currentRow = $derived(
    rows.find((r) => r.contentId === current.contentId) ?? null
  );
  const isComplete = $derived(completedIds.has(current.contentId));
  const playbackPercent = $derived(currentRow?.percentComplete ?? 0);

  // Prev/next within the flattened course sequence.
  const playlist = $derived(practiceData.playlist);
  const currentIndex = $derived(
    playlist.findIndex((e) => e.contentId === current.contentId)
  );
  function hrefFor(index: number): string | null {
    const entry = playlist[index];
    if (!entry) return null;
    return `/journeys/${courseSlug}/practice/${entry.slug ?? entry.contentId}`;
  }
  const prevEntry = $derived(playlist[currentIndex - 1] ?? null);
  const nextEntry = $derived(playlist[currentIndex + 1] ?? null);
  const currentEntry = $derived(playlist[currentIndex] ?? null);
  const prevHref = $derived(hrefFor(currentIndex - 1));
  const nextHref = $derived(hrefFor(currentIndex + 1));

  // Gate-crossing cue: framing Next as opening the next stage (goal-gradient).
  const nextLabel = $derived(
    nextEntry && currentEntry && nextEntry.stageId !== currentEntry.stageId
      ? `Open ${nextEntry.stageName}`
      : 'Next practice'
  );

  // Rail progress rollup — completions across the whole course sequence.
  const doneCount = $derived(
    playlist.filter((e) => completedIds.has(e.contentId)).length
  );
  const total = $derived(playlist.length);
  const pct = $derived(total ? Math.round((doneCount / total) * 100) : 0);

  // Stage sequence (from the flattened playlist) → the gate note's next stage.
  const stageOrder = $derived.by(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const entry of playlist) {
      if (!seen.has(entry.stageId)) {
        seen.add(entry.stageId);
        out.push({ id: entry.stageId, name: entry.stageName });
      }
    }
    return out;
  });
  const currentStageName = $derived(practiceData.stage.name);
  const nextStageName = $derived.by(() => {
    const idx = stageOrder.findIndex((s) => s.id === practiceData.stage.id);
    return idx >= 0 ? (stageOrder[idx + 1]?.name ?? null) : null;
  });
</script>

<svelte:head>
  <title>{current.title} · {courseTitle}</title>
</svelte:head>

<div class="practice">
  <div class="practice__grid">
    <aside class="practice__rail">
      <a class="practice__back" href={dashboardHref}>
        <ArrowLeftIcon size={16} />
        {courseTitle} overview
      </a>

      <div class="practice__prog">
        <div class="practice__prog-top">
          <span class="practice__prog-title">{courseTitle}</span>
          <span class="practice__prog-pct">{doneCount}/{total} · {pct}%</span>
        </div>
        <div
          class="practice__prog-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Course progress"
        >
          <i style:width="{pct}%"></i>
        </div>
      </div>

      <p class="practice__rail-label">The whole journey</p>

      <PracticePlaylist
        {playlist}
        {completedIds}
        currentContentId={current.contentId}
        {courseSlug}
      />

      <p class="practice__gate">
        {#if nextStageName}
          <b>Move at your own pace.</b> The whole path stays open — {nextStageName}
          is here whenever {currentStageName} feels settled.
        {:else}
          <b>The last stage.</b> Move through {currentStageName} as slowly as you
          need. There is no finish line but your own.
        {/if}
      </p>
    </aside>

    <main class="practice__main">
      <PracticeWorkingPane
        practice={current}
        {courseTitle}
        stageName={currentStageName}
        stageGloss={data.stageGloss}
        {dashboardHref}
        streamingUrl={practiceData.streamingUrl}
        waveformUrl={practiceData.waveformUrl}
        bodyHtml={practiceData.bodyHtml}
        initialProgressSeconds={practiceData.initialProgressSeconds}
        {isComplete}
        {playbackPercent}
        {prevHref}
        prevTitle={prevEntry?.title ?? null}
        {nextHref}
        {nextLabel}
      />
    </main>
  </div>
</div>

<style>
  /* Inherit the design-system semantic theme — no forced palette. The wrapper is
     layout-only; surfaces / text / borders resolve from the theme tokens, accents
     from the real `--color-brand-primary`, and the players keep `--color-player-*`. */
  .practice {
    min-height: 100dvh;
  }

  .practice__grid {
    display: grid;
    grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
    grid-template-areas: 'rail main';
    align-items: start;
    min-height: 100dvh;
  }

  .practice__rail {
    grid-area: rail;
    position: sticky;
    top: 0;
    align-self: start;
    max-height: 100dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    border-right: var(--border-width) var(--border-style) var(--color-border-subtle);
    background: color-mix(in oklab, var(--color-surface) 55%, transparent);
  }

  .practice__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .practice__back:hover {
    color: var(--color-brand-primary);
  }

  .practice__back:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
    border-radius: var(--radius-sm);
  }

  /* ── rail progress ── */
  .practice__prog {
    margin-top: var(--space-3);
  }

  .practice__prog-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .practice__prog-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-heading);
    min-width: 0;
  }

  .practice__prog-pct {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .practice__prog-bar {
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    overflow: hidden;
    background: color-mix(in oklab, var(--color-text) 12%, transparent);
  }

  .practice__prog-bar > i {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    transition: width var(--duration-normal) var(--ease-out);
  }

  .practice__rail-label {
    margin: var(--space-2) 0 var(--space-1);
    font-size: var(--text-xs);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  /* ── gate note ── */
  .practice__gate {
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 22%, transparent);
    background: color-mix(in oklab, var(--color-brand-primary) 6%, transparent);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .practice__gate b {
    color: var(--color-brand-primary);
    font-weight: var(--font-semibold);
  }

  .practice__main {
    grid-area: main;
    min-width: 0;
  }

  /* Rail drops below the working pane on narrow viewports (player first). */
  @media (max-width: 54rem) {
    .practice__grid {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'main' 'rail';
    }

    .practice__rail {
      position: static;
      max-height: none;
      overflow: visible;
      border-right: none;
      border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
    }

    .practice__back {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .practice__prog-bar > i,
    .practice__back {
      transition: none;
    }
  }
</style>
