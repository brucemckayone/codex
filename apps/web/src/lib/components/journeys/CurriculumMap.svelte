<!--
  @component CurriculumMap

  "The whole arc" — the course curriculum as a stage accordion (SPEC §8.3,
  prototype `course-dashboard.html` `.map`). One `<details>` per ordered stage:
  the CURRENT stage (the one holding the resume target) is open; DONE stages
  (every practice complete) and upcoming stages collapse. Each lesson row shows
  its completion state (done ✓ / current ● / upcoming medium glyph) and links
  into the in-course player.

  Presentational: completion + rollup + the resume pointer are supplied by the
  dashboard root; colours read the re-pointed portal palette so the map stays
  legible on the warm/dark surface.
-->
<script lang="ts">
  import {
    CheckIcon,
    ChevronRightIcon,
    FileTextIcon,
    MusicIcon,
    VideoIcon,
  } from '$lib/components/ui/Icon';
  import type { CourseRollup } from '$lib/journeys/rollup';
  import {
    countWord,
    practiceKindLabel,
    practiceMinutes,
    stageNumeral,
  } from '$lib/journeys/practice-display';
  import type {
    JourneyStage,
    PracticeContentType,
  } from '$lib/journeys/types';

  interface Props {
    stages: JourneyStage[];
    completedIds: ReadonlySet<string>;
    rollup: CourseRollup;
    courseSlug: string;
    /** Content id of the resume target — its row renders as "current" (●). */
    currentContentId: string | null;
    /** Stage that owns the resume target — auto-opened. */
    currentStageId: string | null;
  }

  const {
    stages,
    completedIds,
    rollup,
    courseSlug,
    currentContentId,
    currentStageId,
  }: Props = $props();

  const orderedStages = $derived(
    [...stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  const EMPTY_COUNTS = { done: 0, total: 0, percent: 0 };

  function iconFor(type: PracticeContentType) {
    if (type === 'audio') return MusicIcon;
    if (type === 'written') return FileTextIcon;
    return VideoIcon;
  }

  function practiceHref(slug: string | null, contentId: string): string {
    return `/journeys/${courseSlug}/practice/${slug ?? contentId}`;
  }
</script>

<section class="map">
  <p class="map__kicker">
    The whole arc — {countWord(orderedStages.length)}
    {orderedStages.length === 1 ? 'stage' : 'stages'}
  </p>

  <div class="map__stages">
    {#each orderedStages as stage, stageIndex (stage.id)}
      {@const counts = rollup.byStage.get(stage.id) ?? EMPTY_COUNTS}
      {@const allDone = counts.total > 0 && counts.done === counts.total}
      {@const isCurrent = stage.id === currentStageId}
      {@const orderedPractices = [...stage.practices].sort(
        (a, b) => a.sortOrder - b.sortOrder
      )}
      <details
        class="stage"
        class:stage--current={isCurrent}
        class:stage--done={!isCurrent && allDone}
        open={isCurrent}
      >
        <summary class="stage__head">
          <span class="stage__numeral">{stageNumeral(stageIndex)}</span>
          <span class="stage__labels">
            <span class="stage__name">{stage.name}</span>
            {#if stage.gloss}
              <span class="stage__gloss">{stage.gloss}</span>
            {/if}
          </span>
          <span class="stage__count">{counts.done}/{counts.total}</span>
          <span class="stage__chevron"><ChevronRightIcon size={18} /></span>
        </summary>

        <div class="stage__lessons">
          {#each orderedPractices as practice (practice.contentId)}
            {@const done = completedIds.has(practice.contentId)}
            {@const isCur = practice.contentId === currentContentId}
            {@const minutes = practiceMinutes(practice.durationSeconds)}
            {@const TypeIcon = iconFor(practice.contentType)}
            <a
              class="lrow"
              class:lrow--done={done}
              class:lrow--current={isCur}
              href={practiceHref(practice.slug, practice.contentId)}
            >
              <span
                class="lrow__icon"
                class:lrow__icon--done={done}
                class:lrow__icon--current={isCur}
                aria-hidden="true"
              >
                {#if done}
                  <CheckIcon size={13} />
                {:else if isCur}
                  <span class="lrow__dot"></span>
                {:else}
                  <TypeIcon size={13} />
                {/if}
              </span>
              <span class="lrow__labels">
                <span class="lrow__title">{practice.title}</span>
                <span class="lrow__meta">
                  {practiceKindLabel(practice.contentType)}{minutes
                    ? ` · ${minutes} min`
                    : ''}
                </span>
              </span>
              <span class="lrow__go">{isCur ? 'Resume →' : 'Open →'}</span>
            </a>
          {/each}
        </div>
      </details>
    {/each}
  </div>
</section>

<style>
  .map__kicker {
    margin: 0 0 var(--space-4);
    font-size: var(--text-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--portal-text-faint);
  }

  .map__stages {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* ── stage (accordion) ─────────────────────────────────────────────────── */
  .stage {
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--portal-text) 10%, transparent);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: color-mix(in oklab, var(--portal-surface) 45%, transparent);
  }

  .stage[open] {
    border-color: color-mix(in oklab, var(--portal-text) 16%, transparent);
    background: color-mix(in oklab, var(--portal-surface-2) 55%, transparent);
  }

  .stage--current {
    border-color: color-mix(in oklab, var(--portal-ember) 34%, transparent);
  }

  .stage__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4);
    cursor: pointer;
    list-style: none;
  }

  .stage__head::-webkit-details-marker {
    display: none;
  }

  .stage__head:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .stage__numeral {
    flex: none;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    font-family: var(--font-heading);
    font-style: italic;
    font-size: var(--text-sm);
    color: var(--portal-text-dim);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--portal-text) 18%, transparent);
  }

  .stage--done .stage__numeral {
    background: color-mix(in oklab, var(--portal-ember) 20%, transparent);
    border-color: transparent;
    color: var(--portal-ember-text);
  }

  .stage--current .stage__numeral {
    border-color: var(--portal-ember);
    color: var(--portal-ember-text);
    box-shadow: 0 0 var(--space-3) calc(var(--border-width) * 1)
      color-mix(in oklab, var(--portal-ember) 35%, transparent);
  }

  .stage__labels {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .stage__name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    color: var(--portal-text);
  }

  .stage__gloss {
    margin-top: var(--space-0-5);
    font-size: var(--text-sm);
    color: var(--portal-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stage__count {
    flex: none;
    font-size: var(--text-sm);
    color: var(--portal-text-faint);
    font-variant-numeric: tabular-nums;
  }

  .stage__chevron {
    flex: none;
    display: inline-flex;
    color: var(--portal-text-faint);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .stage[open] .stage__chevron {
    transform: rotate(90deg);
  }

  /* ── lesson rows ───────────────────────────────────────────────────────── */
  .stage__lessons {
    padding: 0 var(--space-2) var(--space-2);
    display: flex;
    flex-direction: column;
  }

  .lrow {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2-5) var(--space-2-5);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .lrow:hover {
    background: color-mix(in oklab, var(--portal-text) 6%, transparent);
  }

  .lrow--current {
    background: color-mix(in oklab, var(--portal-ember) 12%, transparent);
  }

  .lrow:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .lrow__icon {
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: var(--portal-text-faint);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--portal-text) 26%, transparent);
  }

  .lrow__icon--done {
    background: var(--portal-ember);
    border-color: var(--portal-ember);
    color: var(--portal-ember-ink);
  }

  .lrow__icon--current {
    border-color: var(--portal-ember);
    color: var(--portal-ember-text);
    box-shadow: 0 0 var(--space-2-5) calc(var(--border-width) * 1)
      color-mix(in oklab, var(--portal-ember) 40%, transparent);
  }

  .lrow__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--portal-ember);
  }

  .lrow__labels {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .lrow__title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    line-height: var(--leading-snug);
    color: var(--portal-text);
  }

  .lrow--done .lrow__title {
    color: var(--portal-text-dim);
  }

  .lrow__meta {
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--portal-text-faint);
  }

  .lrow__go {
    flex: none;
    font-size: var(--text-sm);
    color: var(--portal-ember-text);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .lrow:hover .lrow__go,
  .lrow--current .lrow__go {
    opacity: 1;
  }

  @media (--below-sm) {
    .stage__gloss {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage__chevron,
    .lrow,
    .lrow__go {
      transition: none;
    }
  }
</style>
