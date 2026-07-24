<!--
  @component InCoursePracticePage

  The in-course player (SPEC §8.3 / §8.6): playlist rail + working pane. The
  SAME content item renders differently INSIDE a course (stage context, next/
  prev, progress, completion) than standalone — route context selects this UI.
  Client-rendered (ssr=false); the server gate enforced canEnterCourse + canView.

  Completion + playback read the SINGLE progress store (F19): the working pane
  auto-marks media on genuine 100% finish and writes explicit completions for
  written practices; both update the playlist + dashboard reactively.
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
  const currentIndex = $derived(
    practiceData.playlist.findIndex((e) => e.contentId === current.contentId)
  );
  function hrefFor(index: number): string | null {
    const entry = practiceData.playlist[index];
    if (!entry) return null;
    return `/journeys/${courseSlug}/practice/${entry.slug ?? entry.contentId}`;
  }
  const prevHref = $derived(hrefFor(currentIndex - 1));
  const nextHref = $derived(hrefFor(currentIndex + 1));
</script>

<svelte:head>
  <title>{current.title} · {practiceData.course.title}</title>
</svelte:head>

<div class="player">
  <aside class="player__rail">
    <a class="player__back" href={dashboardHref}>
      <ArrowLeftIcon />
      {practiceData.course.title}
    </a>
    <PracticePlaylist
      playlist={practiceData.playlist}
      {completedIds}
      currentContentId={current.contentId}
      {courseSlug}
    />
  </aside>

  <main class="player__main">
    <PracticeWorkingPane
      practice={current}
      streamingUrl={practiceData.streamingUrl}
      waveformUrl={practiceData.waveformUrl}
      bodyHtml={practiceData.bodyHtml}
      initialProgressSeconds={practiceData.initialProgressSeconds}
      {isComplete}
      {playbackPercent}
      {prevHref}
      {nextHref}
    />
  </main>
</div>

<style>
  .player {
    display: grid;
    grid-template-columns: minmax(0, 18rem) minmax(0, 1fr);
    gap: var(--space-8);
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    align-items: start;
  }

  .player__rail {
    position: sticky;
    top: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .player__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .player__back:hover {
    color: var(--color-heading);
  }

  .player__back:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
    border-radius: var(--radius-sm);
  }

  .player__main {
    min-width: 0;
  }

  /* Rail drops above the working pane on narrow viewports. */
  @media (max-width: 48rem) {
    .player {
      grid-template-columns: minmax(0, 1fr);
    }

    .player__rail {
      position: static;
    }
  }
</style>
