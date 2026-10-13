<!--
  @component StageCards

  The cards layout: each stage its own tile, in reading order — a big number,
  the name, its line, then its practices. Transparent: outlined tiles, open
  columns under a hard ink rule in Bold, rounded outlines in Soft.
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

<ol class="cards" data-count={stages.length}>
  {#each stages as stage, index (stage.id)}
    <li class="card">
      <span class="card__num"><span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}</span>
      <Heading {level} size="title" text={stage.name} type="curriculum" />
      {#if stage.gloss}<p class="card__gloss">{stage.gloss}</p>{/if}
      {#if stage.practices.length > 0}
        <div class="card__practices"><Practices practices={stage.practices} /></div>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .cards {
    --_n: 1;
    display: grid;
    grid-template-columns: repeat(var(--_n), minmax(0, 1fr));
    gap: var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a row.
     Its name's room (03 X71): its share of the column, `--_n` across, less
     its inset, its padding and border (Bold opens it, below). A lone card's
     measure is in the body's `ch`, which no title can read, so its room is
     the column, which is never narrower. */
  .card {
    --_inset: calc(var(--space-6) + var(--lp-border));
    --lp-title-column: calc(
      (var(--lp-column) - (var(--_n) - 1) * var(--lp-gap)) / var(--_n) - 2 * var(--_inset)
    );
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  .card__num {
    color: var(--lp-accent);
    font-family: var(--lp-font-display);
    font-size: calc(var(--lp-size-heading) * var(--lp-drama-held, 1));
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
  }

  .card__gloss {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  .card__practices {
    padding-block-start: var(--space-4);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .cards[data-count='1'] {
    max-inline-size: var(--lp-measure);
  }

  @container (min-width: 36rem) {
    .cards:not([data-count='1']) {
      --_n: 2;
    }
  }

  /* Wide: three to a row, except where two divides the set evenly. */
  @container (min-width: 60rem) {
    .cards:not([data-count='1'], [data-count='2'], [data-count='4']) {
      --_n: 3;
    }
  }

  /* Bold: open columns under a hard ink rule; the number in ink, huge. */
  :global(.lp[data-lp-style='bold']) .card {
    --_inset: 0px;
    padding-inline: 0;
    border: none;
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
    border-radius: 0;
  }

  :global(.lp[data-lp-style='bold']) .card__num {
    color: var(--lp-ink);
  }
</style>
