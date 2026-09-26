<!--
  @component StageTimeline

  The timeline layout: the stages as the real sequence they are — a numbered
  marker for each, joined by a spine — with each stage's name and line beside
  its practices on a wide band, and above them on a phone. Bold's markers are
  solid ink blocks on an ink spine; Soft's are tinted discs; Cinematic's glow.
-->
<script lang="ts">
  import type { JourneyStageView } from '$lib/page-builder';
  import Heading from '../../primitives/Heading.svelte';
  import { CURRICULUM_COPY } from './copy';
  import Practices from './Practices.svelte';

  interface Props {
    stages: readonly JourneyStageView[];
    level: 2 | 3;
  }

  const { stages, level }: Props = $props();
</script>

<ol class="timeline">
  {#each stages as stage, index (stage.id)}
    <li class="timeline__stage">
      <span class="timeline__marker">
        <span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}
      </span>
      <div class="timeline__words">
        <Heading {level} size="title" text={stage.name} type="curriculum" />
        {#if stage.gloss}<p class="timeline__gloss">{stage.gloss}</p>{/if}
      </div>
      {#if stage.practices.length > 0}
        <div class="timeline__practices"><Practices practices={stage.practices} ruled /></div>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .timeline {
    --_marker: var(--space-12);
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .timeline__stage {
    position: relative;
    display: grid;
    grid-template-columns: var(--_marker) minmax(0, 1fr);
    column-gap: var(--space-5);
    row-gap: var(--space-4);
    margin: 0;
    padding-block-end: var(--space-12);
  }

  .timeline__stage:last-child {
    padding-block-end: 0;
  }

  /* The spine: from under this marker down to the next one. */
  .timeline__stage:not(:last-child)::before {
    content: '';
    position: absolute;
    inset-block: calc(var(--_marker) + var(--space-2)) var(--space-2);
    inset-inline-start: calc(var(--_marker) / 2 - var(--lp-rule) / 2);
    border-inline-start: var(--lp-rule) var(--border-style) var(--lp-line);
  }

  .timeline__marker {
    grid-row: 1 / span 2;
    display: grid;
    place-items: center;
    inline-size: var(--_marker);
    block-size: var(--_marker);
    border: var(--lp-border) var(--border-style) var(--lp-accent);
    border-radius: var(--lp-radius-chip);
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-body);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: 1;
  }

  .timeline__words {
    display: grid;
    align-content: start;
    gap: var(--space-2);
  }

  /* The name's first line sits level with the marker's middle (`lh` is the
     heading's own line). */
  .timeline__words :global(.lp-heading) {
    padding-block-start: max(var(--space-0), calc((var(--_marker) - 1lh) / 2));
  }

  .timeline__gloss {
    max-inline-size: 40ch;
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  .timeline__practices {
    grid-column: 2;
  }

  @container (min-width: 52rem) {
    .timeline__stage {
      grid-template-columns: var(--_marker) minmax(0, 5fr) minmax(0, 7fr);
      column-gap: var(--space-6);
    }

    .timeline__practices {
      grid-column: 3;
      grid-row: 1 / span 2;
    }
  }

  /* Bold: solid ink blocks on a hard ink spine. */
  :global(.lp[data-lp-style='bold']) .timeline__marker {
    border-color: var(--lp-ink);
    background: var(--lp-ink);
    color: var(--lp-bg);
  }

  :global(.lp[data-lp-style='bold']) .timeline__stage::before {
    border-color: var(--lp-ink);
  }

  /* Soft: tinted discs, no ring. */
  :global(.lp[data-lp-style='soft']) .timeline__marker {
    border-color: var(--lp-panel);
    background: var(--lp-panel);
    color: var(--lp-panel-ink);
  }

  /* Cinematic: the markers catch the light. */
  :global(.lp[data-lp-style='cinematic']) .timeline__marker {
    box-shadow: 0 0 var(--space-5) color-mix(in oklab, var(--lp-accent) 45%, transparent);
  }
</style>
