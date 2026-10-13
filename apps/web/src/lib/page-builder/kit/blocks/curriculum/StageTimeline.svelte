<!--
  @component StageTimeline

  The timeline layout: the stages as the real sequence they are — a numbered
  marker for each, joined by a spine — and each stage ONE row under its own
  rule: its name and line, with its practices beside them on a wide band and
  under them on a phone, each practice saying what it is and how long it
  takes. The rule spans the row's words and practices, never the spine.
  Bold's markers are solid ink blocks on an ink spine; Soft's are tinted
  discs; Cinematic's glow.

  ON A PHONE THE STAGES FOLD (03 X57): each stage's name opens and closes its
  line and practices, the first stage open, so the section is about half the
  height. It is the ARIA accordion the expandable list uses, on the same
  disclosure model; a stage with nothing inside stays a plain row. It is
  served open at every width, so a visitor without JavaScript reads every
  stage, and folds only once the section is still ahead of the visitor, as
  the before and after's toggle does, so nothing they are looking at
  re-lays out. Phone width is the width at which the row stacks, read from
  this stylesheet's own container query (`--_phone`).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { JourneyStageView } from '$lib/page-builder';
  import Heading from '../../primitives/Heading.svelte';
  import { phoneWidth, whenAhead } from '../../primitives/swap';
  import { Disclosures, stepFocus } from '../faq/disclosure.svelte';
  import Sign from '../faq/Sign.svelte';
  import { CURRICULUM_COPY } from './copy';
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
  const panels = new Disclosures(stages.filter(opens).slice(0, 1).map((s) => s.id));

  const ahead = whenAhead(() => {
    panels.enhance();
    ready = true;
  });

  const atPhoneWidth = phoneWidth((next, root) => {
    const focused = folds && !next ? focusedStage(root) : -1;
    phone = next;
    if (focused >= 0) void tick().then(() => keepPlace(root, focused));
  });

  /** Which stage holds the visitor's focus, if any. */
  function focusedStage(root: HTMLElement): number {
    const active = document.activeElement;
    const stage = active && root.contains(active) ? active.closest('.timeline__stage') : null;
    return stage ? [...root.querySelectorAll('.timeline__stage')].indexOf(stage) : -1;
  }

  /** The fold gave way under a visitor's focus: their stage's words take it. */
  function keepPlace(root: HTMLElement, index: number) {
    const words = root.querySelectorAll<HTMLElement>('.timeline__stage')[index];
    const target = words?.querySelector<HTMLElement>('.timeline__words') ?? words;
    if (!target) return;
    target.tabIndex = -1;
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    target.focus({ preventScroll: true });
  }
</script>

<ol
  class="timeline"
  data-folds={folds ? '' : undefined}
  data-lp-disclosures
  {@attach ahead}
  {@attach atPhoneWidth}
>
  {#each stages as stage, index (stage.id)}
    {@const open = panels.isOpen(stage.id)}
    <li class="timeline__stage">
      <span class="timeline__marker">
        <span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}
      </span>
      {#if folds && opens(stage)}
        <svelte:element this={`h${level}`} class="timeline__head">
          <button
            type="button"
            class="timeline__toggle"
            id="{anchor}-stage{index + 1}"
            aria-expanded={open}
            aria-controls="{anchor}-inside{index + 1}"
            data-lp-toggle
            onclick={() => panels.toggle(stage.id)}
            onkeydown={stepFocus}
          >
            <span class="timeline__name">{stage.name}</span>
            {#if stage.practices.length > 0}
              <span class="timeline__count">{CURRICULUM_COPY.practices(stage.practices.length)}</span>
            {/if}
            <Sign {open} />
          </button>
        </svelte:element>
        <div
          class="timeline__panel"
          id="{anchor}-inside{index + 1}"
          hidden={open ? undefined : 'until-found'}
          onbeforematch={() => panels.reveal(stage.id)}
        >
          <div class="timeline__inside">
            {#if stage.gloss}<p class="timeline__gloss">{stage.gloss}</p>{/if}
            {#if stage.practices.length > 0}<Practices practices={stage.practices} />{/if}
          </div>
        </div>
      {:else}
        <div class="timeline__words">
          <Heading {level} size="title" text={stage.name} type="curriculum" />
          {#if stage.gloss}<p class="timeline__gloss">{stage.gloss}</p>{/if}
        </div>
        {#if stage.practices.length > 0}
          <div class="timeline__practices"><Practices practices={stage.practices} /></div>
        {/if}
      {/if}
    </li>
  {/each}
</ol>

<style>
  /* A stage's name has the row past its marker (03 X71): the column, and how
     far a Style reaches the list past its start (`--_reach`, Path's route),
     less the marker and its gap. */
  .timeline {
    --_marker: var(--space-12);
    --_gap: var(--space-5);
    --_reach: 0px;
    /* From a row's rule down to its marker. */
    --_rise: var(--space-5);
    --lp-title-column: calc(var(--lp-column) + var(--_reach) - var(--_marker) - var(--_gap));
    display: grid;
    margin: 0;
    margin-inline-start: calc(-1 * var(--_reach));
    padding: 0;
    list-style: none;
  }

  /* Phone width: the width at which the row stacks (below), its complement. */
  @container not (min-width: 52rem) {
    .timeline {
      --_phone: 1;
    }
  }

  /* base.css spaces every `li` but the last. */
  .timeline__stage {
    position: relative;
    display: grid;
    grid-template-columns: var(--_marker) minmax(0, 1fr);
    column-gap: var(--_gap);
    row-gap: var(--space-4);
    margin: 0;
    padding-block: var(--_rise) var(--space-8);
  }

  .timeline__stage:last-child {
    padding-block-end: 0;
  }

  /* The row's rule: over its words and practices, clear of the spine. */
  .timeline__stage::after {
    content: '';
    position: absolute;
    inset-block-start: 0;
    inset-inline: calc(var(--_marker) + var(--_gap)) 0;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* The spine: from under this marker down to the next one. */
  .timeline__stage:not(:last-child)::before {
    content: '';
    position: absolute;
    inset-block: calc(var(--_rise) + var(--_marker) + var(--space-2))
      calc(var(--space-2) - var(--_rise));
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
    /* The name's share of that row, beside its practices. */
    .timeline {
      --_gap: var(--space-6);
      --lp-title-column: calc(
        (var(--lp-column) + var(--_reach) - var(--_marker) - 2 * var(--_gap)) * 5 / 12
      );
    }

    .timeline__stage {
      grid-template-columns: var(--_marker) minmax(0, 5fr) minmax(0, 7fr);
    }

    /* Beside the name, its first practice level with it: both lines sit on
       the marker's middle (`lh` is a practice's line). */
    .timeline__practices {
      grid-column: 3;
      grid-row: 1 / span 2;
      padding-block-start: max(var(--space-0), calc((var(--_marker) - 1lh) / 2));
      font-size: var(--lp-size-body);
      line-height: var(--lp-leading-title);
    }
  }

  /* ── folded, on a phone ───────────────────────────────────────────────── */
  .timeline[data-folds] .timeline__stage {
    row-gap: 0;
    padding-block-end: var(--space-5);
  }

  .timeline[data-folds] .timeline__stage:last-child {
    padding-block-end: 0;
  }

  /* A real heading for the outline; its size and colour are the button's. */
  .timeline__head {
    grid-column: 2;
    margin: 0;
    color: var(--lp-ink);
    font-size: inherit;
    line-height: inherit;
  }

  .timeline__toggle {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--space-5);
    align-items: center;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
    inline-size: 100%;
    min-block-size: var(--_marker);
    color: var(--lp-ink);
    text-align: start;
  }

  /* The name as the open rows set it: a title, in the title's own ink. */
  .timeline__name {
    color: var(--lp-title-ink, currentColor);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
  }

  .timeline__count {
    grid-row: 2;
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
  }

  .timeline__toggle :global(.lp-sign) {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  @media (hover: hover) {
    .timeline__toggle:hover .timeline__name {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  .timeline__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--focus-offset);
  }

  .timeline__panel {
    grid-column: 2;
  }

  /* `until-found` hides by content-visibility, not display: the panel's own
     box stays, so every inset lives on the inner block. */
  .timeline__inside {
    display: grid;
    gap: var(--space-4);
    padding-block-start: var(--space-3);
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
