<!--
  @component StageAccordion

  The accordion layout: one numbered row per stage — its name and how many
  practices it holds — opening to its line and its practices. The ARIA
  accordion pattern, sharing the questions' disclosure model: every stage is
  open until the page's script runs, then the first stays open as an example
  of what is inside. A stage with nothing inside is a plain row, not a button.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { JourneyStageView } from '$lib/page-builder';
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

  const opens = (stage: JourneyStageView) => stage.practices.length > 0 || !!stage.gloss;
  // The initial stage is read once: later edits must not re-open a row the
  // visitor closed.
  // svelte-ignore state_referenced_locally
  const panels = new Disclosures(stages.filter(opens).slice(0, 1).map((s) => s.id));
  onMount(() => panels.enhance());
</script>

{#snippet summary(stage: JourneyStageView, index: number)}
  <span class="stages__num"><span class="sr-only">{`${CURRICULUM_COPY.stage} `}</span>{index + 1}</span>
  <span class="stages__name">{stage.name}</span>
  {#if stage.practices.length > 0}
    <span class="stages__count">{CURRICULUM_COPY.practices(stage.practices.length)}</span>
  {/if}
{/snippet}

<ol class="stages" data-lp-disclosures>
  {#each stages as stage, index (stage.id)}
    {@const open = panels.isOpen(stage.id)}
    <li class="stages__item">
      <svelte:element this={`h${level}`} class="stages__head">
        {#if opens(stage)}
          <button
            type="button"
            class="stages__row"
            id="{anchor}-stage{index + 1}"
            aria-expanded={open}
            aria-controls="{anchor}-inside{index + 1}"
            data-lp-toggle
            onclick={() => panels.toggle(stage.id)}
            onkeydown={stepFocus}
          >
            {@render summary(stage, index)}
            <Sign {open} />
          </button>
        {:else}
          <span class="stages__row">{@render summary(stage, index)}</span>
        {/if}
      </svelte:element>
      {#if opens(stage)}
        <div
          class="stages__panel"
          id="{anchor}-inside{index + 1}"
          hidden={open ? undefined : 'until-found'}
          onbeforematch={() => panels.reveal(stage.id)}
        >
          <div class="stages__inside">
            {#if stage.gloss}<p class="stages__gloss">{stage.gloss}</p>{/if}
            {#if stage.practices.length > 0}<Practices practices={stage.practices} ruled />{/if}
          </div>
        </div>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .stages {
    --_num: var(--space-10);
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* base.css spaces every `li` but the last. */
  .stages__item {
    margin: 0;
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* A real heading for the outline; its size and colour are the row's. */
  .stages__head {
    margin: 0;
    color: var(--lp-ink);
    font-size: inherit;
    line-height: inherit;
  }

  .stages__row {
    display: grid;
    grid-template-columns: var(--_num) minmax(0, 1fr) auto var(--space-5);
    align-items: center;
    column-gap: var(--space-4);
    inline-size: 100%;
    min-block-size: var(--tap-target-min);
    padding-block: var(--space-5);
    color: var(--lp-ink);
    text-align: start;
  }

  span.stages__row {
    grid-template-columns: var(--_num) minmax(0, 1fr) auto;
  }

  .stages__num {
    color: var(--lp-accent);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-title);
  }

  .stages__name {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
  }

  .stages__count {
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    white-space: nowrap;
  }

  @media (hover: hover) {
    button.stages__row:hover .stages__name {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  .stages__row:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--focus-offset);
  }

  /* `until-found` hides by content-visibility, not display: the panel's own
     box stays, so every inset lives on the inner block. */
  .stages__inside {
    display: grid;
    gap: var(--space-4);
    padding-block-end: var(--space-6);
    padding-inline-start: calc(var(--_num) + var(--space-4));
  }

  .stages__gloss {
    max-inline-size: var(--lp-measure);
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  /* A phone: the count drops under the name. */
  @container (max-width: 30rem) {
    .stages__row {
      grid-template-columns: var(--_num) minmax(0, 1fr) var(--space-5);
      row-gap: var(--space-1);
    }

    .stages__count {
      grid-column: 2;
      grid-row: 2;
    }

    .stages__inside {
      padding-inline-start: 0;
    }
  }

  /* Bold: the list opens under a hard ink rule. */
  :global(.lp[data-lp-style='bold']) .stages {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* Soft: each stage its own rounded tile. */
  :global(.lp[data-lp-style='soft']) .stages {
    gap: var(--space-3);
    border-block-start: none;
  }

  :global(.lp[data-lp-style='soft']) .stages__item {
    padding-inline: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }
</style>
