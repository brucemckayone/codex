<!--
  @component CurriculumMap

  The journey dashboard's curriculum: ordered stages (gates), each with its
  concurrent practice pool and a per-stage progress ring. Practices link into
  the in-course player and show completion state (the `practice_completions`
  row — source of truth). Presentational: completion + rollup are supplied.

  @prop {JourneyStage[]} stages - Ordered curriculum from the server load.
  @prop {ReadonlySet<string>} completedIds - Content ids with a completion row.
  @prop {CourseRollup} rollup - Per-stage + overall counts (computed by caller).
  @prop {string} courseSlug - For building /journeys/{slug}/practice/{slug} hrefs.
-->
<script lang="ts">
  import {
    CheckCircleIcon,
    CircleIcon,
    FileTextIcon,
    MusicIcon,
    VideoIcon,
  } from '$lib/components/ui/Icon';
  import type { CourseRollup } from '$lib/journeys/rollup';
  import type {
    JourneyPractice,
    JourneyStage,
    PracticeContentType,
  } from '$lib/journeys/types';
  import ProgressRing from './ProgressRing.svelte';

  interface Props {
    stages: JourneyStage[];
    completedIds: ReadonlySet<string>;
    rollup: CourseRollup;
    courseSlug: string;
  }

  const { stages, completedIds, rollup, courseSlug }: Props = $props();

  const orderedStages = $derived(
    [...stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  function iconFor(type: PracticeContentType) {
    if (type === 'video') return VideoIcon;
    if (type === 'audio') return MusicIcon;
    return FileTextIcon;
  }

  function practiceHref(practice: JourneyPractice): string {
    return `/journeys/${courseSlug}/practice/${practice.slug ?? practice.contentId}`;
  }

  const EMPTY_COUNTS = { done: 0, total: 0, percent: 0 };
</script>

<div class="curriculum">
  {#each orderedStages as stage, stageIndex (stage.id)}
    {@const counts = rollup.byStage.get(stage.id) ?? EMPTY_COUNTS}
    {@const orderedPractices = [...stage.practices].sort(
      (a, b) => a.sortOrder - b.sortOrder
    )}
    <section class="stage">
      <header class="stage__header">
        <div class="stage__heading">
          <span class="stage__index">Stage {stageIndex + 1}</span>
          <h2 class="stage__name">{stage.name}</h2>
          {#if stage.gloss}
            <p class="stage__gloss">{stage.gloss}</p>
          {/if}
        </div>
        <div class="stage__progress">
          <ProgressRing
            percent={counts.percent}
            size="var(--space-14)"
            ariaLabel="{stage.name}: {counts.done} of {counts.total} practices complete"
          />
          <span class="stage__count">{counts.done}/{counts.total}</span>
        </div>
      </header>

      <ul class="practices">
        {#each orderedPractices as practice (practice.contentId)}
          {@const done = completedIds.has(practice.contentId)}
          {@const Icon = iconFor(practice.contentType)}
          <li class="practice" class:practice--done={done}>
            <a class="practice__link" href={practiceHref(practice)}>
              <span class="practice__status" aria-hidden="true">
                {#if done}
                  <CheckCircleIcon />
                {:else}
                  <CircleIcon />
                {/if}
              </span>
              <span class="practice__type" aria-hidden="true"><Icon /></span>
              <span class="practice__title">{practice.title}</span>
              <span class="practice__meta">
                {#if done}Complete{:else}{practice.contentType}{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .curriculum {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .stage__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .stage__index {
    display: block;
    font-size: var(--text-xs);
    text-transform: var(--text-transform-label);
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .stage__name {
    margin: var(--space-0-5) 0 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    color: var(--color-heading);
  }

  .stage__gloss {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 52ch;
  }

  .stage__progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .stage__count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .practices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .practice__link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-card);
    color: var(--color-text);
    text-decoration: none;
    transition:
      background-color var(--duration-fast) ease,
      transform var(--duration-fast) ease;
  }

  .practice__link:hover {
    background: var(--color-surface-secondary);
  }

  .practice__link:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .practice__status {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .practice--done .practice__status {
    color: var(--color-success);
  }

  .practice__type {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .practice__title {
    flex: 1;
    font-size: var(--text-base);
    color: var(--color-heading);
  }

  .practice--done .practice__title {
    color: var(--color-text-secondary);
  }

  .practice__meta {
    font-size: var(--text-xs);
    text-transform: var(--text-transform-meta);
    color: var(--color-text-muted);
  }

  .practice--done .practice__meta {
    color: var(--color-success);
  }
</style>
