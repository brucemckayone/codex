<!--
  @component StatsBlock

  A few numbers at a glance: the course's own counts when `live` is on (from
  the curriculum the page renders), then the creator's. Two layouts:
    row  — the heading, then the figures side by side, divided by fine rules
           (Bold's are hard ink)
    grid — the heading, then the figures in tiles across the column

  Figures at display size in tabular numerals, over labels in full ink, in
  either layout; four go as two pairs, never four small ones. Every figure in
  a block is set at one size — the largest at which its longest value fits
  its cell, never past the display size — so "4,000+" and "6" stand at the
  same height. A figure longer than a circle holds is marked `data-long`,
  for a Style that rings its figures (Studio's pill). No figures: the public
  page shows only the words; the canvas says how to add some.

  A figure that is one amount counts up the first time it comes into view
  (`motion/count-up.ts`); its HTML is always the final value.
-->
<script lang="ts">
  import { hasHead } from '../../model/read';
  import type { BlockProps } from '../../model/types';
  import { countUp, parseFigure } from '../../motion/count-up';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { STATS_PROMPT, statsDefinition } from './definition';
  import { isLongFigure, statFigures } from './figures';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(statsDefinition.coerce(props));
  const figures = $derived(statFigures(content, context.stages));
  const longest = $derived(Math.max(1, ...figures.map((figure) => figure.value.length)));
  const grid = $derived(section.layout === 'grid');
  const hasCta = $derived(Boolean(content.ctaLabel || content.note));
  const headed = $derived(hasHead(content));
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
  {#if headed || (grid && hasCta)}
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
          <span
            class="stat__value"
            data-lp-count={parseFigure(figure.value) ? '' : undefined}
            data-long={isLongFigure(figure.value) ? '' : undefined}
            {@attach countUp(figure.value)}>{figure.value}</span
          >
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
  /* A label is a list's item, at the section's item size. Each cell is a
     query container (below), so the token's `cqi` read in a cell would
     measure the cell and hold the size at its floor at every width. The list
     is no container, so it reads the section, and a registered length
     carries what it read down to the labels as a length. */
  @property --_stat-label {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }

  /* Always the column's full width: its cells are size containers, so they
     have no width of their own, and a centred (shrink-to-fit) list would
     collapse to nothing. */
  .stats__list {
    --_stat-label: var(--lp-size-item);
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

  /* Each cell is a query container: the figure's size is `1em` (the display
     size, in either layout) or whatever fits the longest value in the cell,
     if smaller. The cell's own size reads the section, never the cell. */
  .stat {
    container-type: inline-size;
    position: relative;
    display: grid;
    align-content: start;
    gap: var(--space-4);
    margin: 0;
    font-size: var(--_figure, var(--lp-size-display));
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

  /* In full ink: what a figure counts is half the claim. Its measure keeps a
     label of a few words to two lines. */
  .stat__label {
    max-inline-size: calc(26 * var(--lp-measure-unit));
    font-size: var(--_stat-label);
    line-height: var(--lp-leading-body);
    color: var(--lp-ink);
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

  /* Three, five or six go three across; two and four keep two, so four make
     two pairs at the display size instead of four small figures. */
  @container (min-width: 48rem) {
    .stats[data-layout='row'] .stats__list:is([data-count='3'], [data-count='5'], [data-count='6']) {
      --_cols: 3;
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

  /* The head stays above the tiles at every width, and the tiles take the
     column's whole width, so the fit lets a figure reach the display size
     (a seven-twelfths share beside the head held "6 weeks" to about 57px). */
  @container (min-width: 56rem) {
    .stats[data-layout='grid'] .stats__list:is([data-count='3'], [data-count='5'], [data-count='6']) {
      --_cols: 3;
    }
  }
</style>
