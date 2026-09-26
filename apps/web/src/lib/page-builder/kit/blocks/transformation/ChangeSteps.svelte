<!--
  @component ChangeSteps

  The `steps` layout: one change per row, each before joined to its after by a
  drawn connector. Wide, the key and every row share one set of columns, the
  before column fitted to its longest line, so each row reads "this, then
  that"; on a phone each pair stacks and the connector turns downward.

  Screen readers hear each line with its side's label, since the visual key
  above the rows is not announced alongside them.
-->
<script lang="ts">
  import type { BlockEdit } from '../../model/types';
  import type { Side, SideLabels, SideLines } from './change';
  import Connector from './Connector.svelte';
  import SideLabel from './SideLabel.svelte';

  interface Props {
    lines: SideLines;
    labels: SideLabels;
    anchor: string;
    edit: BlockEdit | null;
  }

  const { lines, labels, anchor, edit }: Props = $props();

  const pairs = $derived(
    Array.from({ length: Math.max(lines.before.length, lines.after.length) }, (_, index) => ({
      from: lines.before[index],
      to: lines.after[index],
    }))
  );
</script>

<!-- The trailing space is data: Svelte strips it at the end of a tag. -->
{#snippet spoken(side: Side)}
  {#if labels[side]}<span class="sr-only">{`${labels[side]}: `}</span>{/if}
{/snippet}

<div class="tf-steps">
  {#if labels.before || labels.after}
    <div class="tf-steps__key">
      {#if labels.before}<SideLabel side="before" text={labels.before} {anchor} {edit} />{/if}
      {#if labels.before && labels.after}<Connector />{/if}
      {#if labels.after}<SideLabel side="after" text={labels.after} {anchor} {edit} />{/if}
    </div>
  {/if}
  <ul class="tf-steps__rows">
    {#each pairs as pair, index (index)}
      <li class="tf-step">
        {#if pair.from}<p class="tf-step__from">{@render spoken('before')}{pair.from}</p>{/if}
        {#if pair.from && pair.to}<Connector direction="auto" />{/if}
        {#if pair.to}<p class="tf-step__to">{@render spoken('after')}{pair.to}</p>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .tf-steps {
    --_link: clamp(var(--space-10), 7cqi, var(--space-20));
    display: grid;
    gap: var(--space-4);
  }

  .tf-steps__key {
    display: grid;
    grid-template-columns: auto var(--space-10) auto;
    justify-content: start;
    align-items: center;
    column-gap: var(--space-3);
  }

  .tf-steps__key:has(> :global(.tf-link)) > :global(.tf-label[data-side='after']) {
    grid-column: 3;
  }

  .tf-steps__rows {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens the rows. */
  .tf-step {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-block: var(--space-5);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .tf-step:last-child {
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .tf-step p {
    margin: 0;
    text-wrap: pretty;
  }

  .tf-step__from {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .tf-step__to {
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  @container (min-width: 44rem) {
    .tf-steps {
      grid-template-columns: fit-content(42%) var(--_link) minmax(0, 1fr);
      column-gap: var(--space-5);
    }

    /* `normal` hands each subgrid the parent's gap; its own would shift it. */
    .tf-steps__key,
    .tf-steps__rows,
    .tf-step {
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      column-gap: normal;
    }

    .tf-step__from {
      grid-column: 1;
    }

    .tf-step__to,
    .tf-steps__key > :global(.tf-label[data-side='after']) {
      grid-column: 3;
    }
  }

  /* Bold: the first row opens under a hard ink rule. */
  :global(.lp[data-lp-style='bold']) .tf-step:first-child {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* Soft: the rows sit in one rounded group; the key takes the same inset so
     the shared columns still line up. */
  :global(.lp[data-lp-style='soft']) :is(.tf-steps__key, .tf-steps__rows) {
    padding-inline: var(--space-6);
  }

  :global(.lp[data-lp-style='soft']) .tf-steps__rows {
    border-radius: var(--lp-radius-card);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-line);
  }

  :global(.lp[data-lp-style='soft']) .tf-step:first-child {
    border-block-start: none;
  }

  :global(.lp[data-lp-style='soft']) .tf-step:last-child {
    border-block-end: none;
  }
</style>
