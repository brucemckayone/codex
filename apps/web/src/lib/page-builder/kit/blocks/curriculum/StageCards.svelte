<!--
  @component StageCards

  The cards layout: each stage its own tile, in reading order — a big number,
  the name, its line, then its practices. Transparent: outlined tiles, open
  columns under a hard ink rule in Bold, rounded outlines in Soft.

  ON A PHONE THE STAGES FOLD (Codex-61zsk.73), as the timeline's do (03 X57):
  each card's head (its number, its name and how many practices) opens and
  closes its line and practices, the first stage with practices open, so the
  section is a fraction of the height. It is the timeline's accordion on the
  same disclosure model; a stage with nothing inside stays a plain card. It
  is served open at every width, so a visitor without JavaScript reads every
  stage, and folds only once the section is still ahead of the visitor, so
  nothing they are looking at re-lays out. Phone width is the width at which
  the cards stack to one column, read from this stylesheet's own container
  query (`--_phone`): wider, two or three across, every practice stays listed.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { JourneyStageView } from '$lib/page-builder';
  import Heading from '../../primitives/Heading.svelte';
  import { phoneWidth, whenAhead } from '../../primitives/swap';
  import { Disclosures, stepFocus } from '../faq/disclosure.svelte';
  import Sign from '../faq/Sign.svelte';
  import { CURRICULUM_COPY } from './copy';
  import { focusedStage, keepPlace } from './fold-focus';
  import Practices from './Practices.svelte';

  interface Props {
    stages: readonly JourneyStageView[];
    level: 2 | 3;
    /** The section's anchor, so every id on the page is unique and stable. */
    anchor: string;
  }

  const { stages, level, anchor }: Props = $props();

  let ready = $state(false);
  let phone = $state(false);
  const folds = $derived(ready && phone);

  const opens = (stage: JourneyStageView) => stage.practices.length > 0 || !!stage.gloss;
  // The initial stage is read once: later edits must not re-open a stage the
  // visitor closed.
  // svelte-ignore state_referenced_locally
  const panels = new Disclosures(
    stages
      .filter((stage) => stage.practices.length > 0)
      .slice(0, 1)
      .map((stage) => stage.id)
  );

  const ahead = whenAhead(() => {
    panels.enhance();
    ready = true;
  });

  // When the fold gives way under the visitor's focus, their stage's name
  // takes it (`fold-focus.ts`, shared with the timeline).
  const atPhoneWidth = phoneWidth((next, root) => {
    const focused = folds && !next ? focusedStage(root, '.card') : -1;
    phone = next;
    if (focused >= 0) void tick().then(() => keepPlace(root, focused, '.card', '.lp-heading'));
  });
</script>

<ol
  class="cards"
  data-count={stages.length}
  data-folds={folds ? '' : undefined}
  data-lp-disclosures
  {@attach ahead}
  {@attach atPhoneWidth}
>
  {#each stages as stage, index (stage.id)}
    {@const open = panels.isOpen(stage.id)}
    <li class="card">
      {#if folds && opens(stage)}
        <svelte:element this={`h${level}`} class="card__head">
          <button
            type="button"
            class="card__toggle"
            id="{anchor}-stage{index + 1}"
            aria-expanded={open}
            aria-controls="{anchor}-inside{index + 1}"
            data-lp-toggle
            onclick={() => panels.toggle(stage.id)}
            onkeydown={stepFocus}
          >
            <span class="card__num"><span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}</span>
            <span class="card__name">{stage.name}</span>
            {#if stage.practices.length > 0}
              <span class="card__count">{CURRICULUM_COPY.practices(stage.practices.length)}</span>
            {/if}
            <Sign {open} />
          </button>
        </svelte:element>
        <div
          class="card__panel"
          id="{anchor}-inside{index + 1}"
          hidden={open ? undefined : 'until-found'}
          onbeforematch={() => panels.reveal(stage.id)}
        >
          <div class="card__inside">
            {#if stage.gloss}<p class="card__gloss">{stage.gloss}</p>{/if}
            {#if stage.practices.length > 0}
              <div class="card__practices"><Practices practices={stage.practices} /></div>
            {/if}
          </div>
        </div>
      {:else}
        <span class="card__num"><span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}</span>
        <Heading {level} size="title" text={stage.name} type="curriculum" />
        {#if stage.gloss}<p class="card__gloss">{stage.gloss}</p>{/if}
        {#if stage.practices.length > 0}
          <div class="card__practices"><Practices practices={stage.practices} /></div>
        {/if}
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

  /* Phone width: the width at which the cards stack (below), its complement. */
  @container not (min-width: 36rem) {
    .cards {
      --_phone: 1;
    }
  }

  /* base.css spaces every `li` but the last, which unevens a row.
     Its name's room (03 X71): its share of the column, `--_n` across, less
     its inset, its padding and border (Bold opens it, below). A lone card's
     measure is in the body's `0`s, which no title can read, so its room is
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
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
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

  /* ── folded, on a phone ───────────────────────────────────────────────── */
  /* A closed panel keeps its box (`until-found`), so the card's gap would
     still stand under the head: the space moves inside the panel. A stage
     with nothing inside stays a plain card, and keeps its gap. */
  .cards[data-folds] .card:has(> .card__head) {
    gap: 0;
  }

  /* A real heading for the outline; its size and colour are the button's. */
  .card__head {
    margin: 0;
    color: var(--lp-ink);
    font-size: inherit;
    line-height: inherit;
  }

  /* The number down the side of the name and its count, the sign at the end. */
  .card__toggle {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) var(--space-5);
    align-items: center;
    column-gap: var(--space-4);
    row-gap: var(--space-1);
    inline-size: 100%;
    min-block-size: var(--tap-target-min);
    color: var(--lp-ink);
    text-align: start;
  }

  .card__toggle .card__num {
    grid-row: 1 / span 2;
  }

  /* The name as the open card sets it: a title, in the title's own ink. */
  .card__name {
    color: var(--lp-title-ink, currentColor);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
  }

  .card__count {
    grid-column: 2;
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
  }

  .card__toggle :global(.lp-sign) {
    grid-column: 3;
    grid-row: 1 / span 2;
  }

  @media (hover: hover) {
    .card__toggle:hover .card__name {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  .card__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--focus-offset);
  }

  /* `until-found` hides by content-visibility, not display: the panel's own
     box stays, so every inset lives on the inner block. */
  .card__inside {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block-start: var(--space-3);
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
