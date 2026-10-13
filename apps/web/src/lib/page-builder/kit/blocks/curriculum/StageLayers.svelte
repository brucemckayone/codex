<!--
  @component StageLayers

  Layered stages (Codex-61zsk.55): each stage its own row of the course's
  practices as picture-led cards, the same cards as "What's inside"
  (`PracticeCard`), with the stage line left off because the row's heading
  names the stage. Each row is a `ScrollStrip`: the browser's own scrolling,
  snapping card by card, never moving by itself, a labelled region with its
  previous and next buttons in the stage's heading line. A pure showcase: no
  links.

  The heading says "Stage 2 · 5 practices", the stage's name (a title lifted
  0.4 toward the heading's size) and its line. A stage of one practice is a
  plain card: nothing to scroll, so no region, no buttons and no tab stop. A
  stage with none shows its heading alone, and while editing a prompt under
  it points to the Curriculum tab.

  The rows run to the band's edges while the words keep the content column:
  the section's tracks are inherited through the list and each stage. Every
  picture loads lazily, with What's inside's `sizes`, so none competes with
  the hero and a picture both sections show is fetched once.
-->
<script lang="ts">
  import type { JourneyStageView } from '$lib/page-builder';
  import Heading from '../../primitives/Heading.svelte';
  import ScrollStrip from '../../primitives/ScrollStrip.svelte';
  import PracticeCard from '../inside/PracticeCard.svelte';
  import { PRACTICE_CARD_SIZES, practiceCard } from '../inside/practice-card';
  import { CURRICULUM_COPY } from './copy';
  import { CURRICULUM_EMPTY_STAGE } from './definition';

  interface Props {
    stages: readonly JourneyStageView[];
    level: 2 | 3;
    /** The section's anchor: each row's id is built from it. */
    anchor: string;
    /** The ground a missing picture's tile draws on (`practiceTileGround`). */
    tile: 'brand' | 'panel';
    edit: boolean;
  }

  const { stages, level, anchor, tile, edit }: Props = $props();
</script>

<ol class="layers">
  {#each stages as stage, index (stage.id)}
    {@const count = stage.practices.length}
    {@const number = index + 1}
    {#snippet head()}
      <div class="layers__head">
        <p class="layers__label">
          <span class="layers__number">{`${CURRICULUM_COPY.stage} ${number}`}</span
          >{#if count > 0}<span class="layers__count">{` · ${CURRICULUM_COPY.practices(count)}`}</span>{/if}
        </p>
        <Heading {level} size="title" text={stage.name} type="curriculum" class="layers__name" />
        {#if stage.gloss}<p class="layers__gloss">{stage.gloss}</p>{/if}
      </div>
    {/snippet}
    <li class="layers__stage" data-count={count}>
      {#if count > 1}
        <ScrollStrip
          id={`${anchor}-stage-${number}-practices`}
          label={CURRICULUM_COPY.stageLine(number, stage.name)}
          previousLabel={CURRICULUM_COPY.previousIn(number)}
          nextLabel={CURRICULUM_COPY.nextIn(number)}
          {count}
          ordered
          {head}
          class="layers__strip"
        >
          {#each stage.practices as practice, at (at)}
            <li class="layers__item">
              <PracticeCard card={practiceCard(practice)} {tile} sizes={PRACTICE_CARD_SIZES} />
            </li>
          {/each}
        </ScrollStrip>
      {:else}
        {@render head()}
        {#if count === 1}
          <ol class="layers__single">
            <li class="layers__item">
              <PracticeCard card={practiceCard(stage.practices[0])} {tile} sizes={PRACTICE_CARD_SIZES} />
            </li>
          </ol>
        {:else if edit}
          <p class="layers__empty" data-lp-edit-only>{CURRICULUM_EMPTY_STAGE}</p>
        {/if}
      {/if}
    </li>
  {/each}
</ol>

<style>
  /* The section's tracks, through the list and each stage, so a row runs to
     the band's edges while every word keeps the content column. */
  .layers {
    display: grid;
    grid-template-columns: inherit;
    row-gap: var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .layers__stage {
    display: grid;
    grid-template-columns: inherit;
    grid-column: bleed;
    row-gap: var(--space-4);
    margin: 0;
  }

  .layers__stage > :global(*) {
    grid-column: content;
    min-inline-size: 0;
  }

  /* A Style's rule above a stage (style-*.css) is the stage's first row, on
     the content column, so it spans the heading's whole line, its buttons
     too. It is drawn only where a Style gives it content: an empty row would
     still take a gap. */
  .layers__stage::before {
    grid-column: content;
  }

  .layers__stage > :global(.layers__strip) {
    --lp-strip-item: var(--lp-practice-card);
    --lp-strip-gap: var(--lp-practice-gap);
    grid-column: bleed;
  }

  /* The stage's heading: its number and count, its name, its line. */
  .layers__head {
    --lp-title-lift: 0.4;
    display: grid;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  /* global.css caps every `p` at 65ch and spaces it. */
  .layers__head > p {
    margin: 0;
  }

  .layers__label {
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-label);
    font-variant-numeric: lining-nums tabular-nums;
    font-weight: var(--lp-weight-label);
    letter-spacing: var(--lp-tracking-label);
    line-height: var(--lp-leading-title);
    text-transform: var(--lp-case-label);
  }

  /* The number is a label, drawn with the eyebrow's dials: a chip in a Style
     that fills its eyebrow (Soft), the plain word everywhere else. */
  .layers__number {
    display: inline-block;
    padding: var(--lp-eyebrow-pad);
    border-radius: var(--lp-eyebrow-radius);
    background: color-mix(
      in oklab,
      var(--lp-panel) calc(var(--lp-eyebrow-fill) * 100%),
      transparent
    );
    color: var(--lp-accent);
  }

  .layers__gloss {
    max-inline-size: var(--lp-measure);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* One practice: a plain card at a row's card width, nothing to scroll. */
  .layers__single {
    display: grid;
    margin: 0;
    padding: var(--space-1) 0 var(--space-5);
    list-style: none;
  }

  .layers__item {
    margin: 0;
  }

  .layers__single > .layers__item {
    inline-size: var(--lp-practice-card);
    max-inline-size: 100%;
  }

  .layers__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-5) var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }
</style>
