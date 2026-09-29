<!--
  @component StatsBlock

  A few numbers at a glance: the course's own counts when `live` is on (from
  the curriculum the page renders), then the creator's. Two layouts:
    row  — the heading, then the figures side by side, divided by fine rules
           (Bold's are hard ink)
    grid — the heading on one side, the figures in tiles on the other

  Big figures in tabular numerals over quiet labels. Every figure in a block
  is set at one size — the largest at which its longest value fits its cell —
  so "4,000+" and "6" stand at the same height. No figures: the public page
  shows only the words; the canvas says how to add some.
-->
<script lang="ts">
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { STATS_PROMPT, statsDefinition } from './definition';
  import { statFigures } from './figures';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(statsDefinition.coerce(props));
  const figures = $derived(statFigures(content, context.stages));
  const longest = $derived(Math.max(1, ...figures.map((figure) => figure.value.length)));
  const grid = $derived(section.layout === 'grid');
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const hasHead = $derived(Boolean(content.eyebrow || content.heading || content.body));
</script>

{#snippet actions()}
  {#if hasCta}
    <div class="stats__actions">
      <ButtonRow
        {context}
        section="stats"
        label={content.ctaLabel}
        note={content.note}
        size="md"
        {edit}
      />
    </div>
  {/if}
{/snippet}

<div class="stats" data-layout={grid ? 'grid' : 'row'}>
  {#if hasHead || (grid && hasCta)}
    <div class="stats__head">
      {#if content.eyebrow || content.heading}
        <div class="stats__top">
          {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="stats" {edit} />{/if}
          {#if content.heading}
            <Heading
              level={section.headingLevel}
              text={content.heading}
              type="stats"
              field="heading"
              {edit}
            />
          {/if}
        </div>
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="stats" field="body" {edit} />
      {/if}
      {#if grid}{@render actions()}{/if}
    </div>
  {/if}

  {#if figures.length > 0}
    <ul class="stats__list" data-count={figures.length} style:--_chars={longest}>
      {#each figures as figure (figure.key)}
        <li class="stat">
          <span class="stat__value">{figure.value}</span>
          <span class="stat__label">{figure.label}</span>
        </li>
      {/each}
    </ul>
  {:else if edit}
    <p class="stats__prompt" data-lp-edit-only>{STATS_PROMPT}</p>
  {/if}

  {#if !grid}{@render actions()}{/if}
</div>

<style>
  .stats,
  .stats__head,
  .stats__top {
    display: grid;
    gap: var(--lp-stack);
  }

  .stats {
    gap: var(--lp-gap);
  }

  /* ── the figures ───────────────────────────────────────────────────────── */
  /* Always the column's full width: its cells are size containers, so they
     have no width of their own, and a centred (shrink-to-fit) list would
     collapse to nothing. */
  .stats__list {
    --_cols: 2;
    --_gap: var(--space-8);
    justify-self: stretch;
    display: grid;
    grid-template-columns: repeat(var(--_cols), minmax(0, 1fr));
    gap: var(--space-10) var(--_gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stats__list[data-count='1'] {
    --_cols: 1;
  }

  /* Each cell is a query container: the figure's size is `1em` (the layout's
     largest) or whatever fits the longest value in the cell, if smaller. */
  .stat {
    container-type: inline-size;
    position: relative;
    display: grid;
    align-content: start;
    gap: var(--space-4);
    margin: 0;
    font-size: var(--_figure, var(--lp-size-price));
  }

  .stat__value {
    font-family: var(--lp-font-display);
    font-size: min(1em, 100cqi / (var(--_chars) * 0.62));
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
    white-space: nowrap;
    color: var(--lp-ink);
  }

  .stat__label {
    max-inline-size: 26ch;
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    color: var(--lp-ink-soft);
  }

  .stats__prompt {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-8);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* ── row ───────────────────────────────────────────────────────────────── */
  .stats[data-layout='row'] {
    --_figure: var(--lp-size-display);
  }

  /* A rule in the gap before every cell; the first of each line falls outside
     the list and is clipped, however the figures wrap. */
  .stats[data-layout='row'] .stats__list {
    overflow-x: clip;
  }

  .stats[data-layout='row'] .stat::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(var(--_gap) / -2);
    border-inline-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  :global(.lp[data-lp-style='bold']) .stats[data-layout='row'] .stat::before {
    border-inline-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  @container (min-width: 48rem) {
    .stats[data-layout='row'] .stats__list:is([data-count='3'], [data-count='5'], [data-count='6']) {
      --_cols: 3;
    }

    .stats[data-layout='row'] .stats__list[data-count='4'] {
      --_cols: 4;
    }

    .stats[data-layout='row'] .stats__list {
      --_gap: var(--space-12);
    }
  }

  /* Soft centres the whole band. */
  :global(.lp[data-lp-style='soft']) .stats[data-layout='row'],
  :global(.lp[data-lp-style='soft']) .stats[data-layout='row'] :is(.stats__head, .stats__top, .stat) {
    justify-items: center;
    text-align: center;
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .stats[data-layout='row'] :global(.lp-eyebrow) {
    justify-self: center;
  }

  /* ── grid ──────────────────────────────────────────────────────────────── */
  .stats[data-layout='grid'] .stat {
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  .stats[data-layout='grid'] .stats__list {
    --_gap: var(--space-4);
    row-gap: var(--_gap);
  }

  /* Bold: open tiles under a hard ink rule, as its offer cards are. */
  :global(.lp[data-lp-style='bold']) .stats[data-layout='grid'] .stat {
    padding: var(--space-4) 0 0;
    border: none;
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
    border-radius: 0;
  }

  :global(.lp[data-lp-style='bold']) .stats[data-layout='grid'] .stats__list {
    --_gap: var(--space-8);
  }

  :global(.lp[data-lp-style='soft']) .stats[data-layout='grid'] .stat {
    justify-items: center;
    text-align: center;
    padding-block: var(--space-8);
  }

  @container (min-width: 56rem) {
    .stats[data-layout='grid']:has(> .stats__head):has(> .stats__list) {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      align-items: start;
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .stats[data-layout='grid'] .stats__list:is([data-count='3'], [data-count='5'], [data-count='6']) {
      --_cols: 3;
    }
  }
</style>
