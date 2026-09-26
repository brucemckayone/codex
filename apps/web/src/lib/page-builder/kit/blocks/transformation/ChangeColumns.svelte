<!--
  @component ChangeColumns

  The `columns` layout: before and after side by side. Wide, the two sides
  share row tracks (subgrid), so each before line sits level with its after
  line however either wraps. The after side is the section's one filled panel,
  in its own nested scheme, so its ink and accent contrast with the PANEL.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import type { ColourSchemeId } from '../../model/ids';
  import type { BlockEdit } from '../../model/types';
  import { SIDES, type SideLabels, type SideLines, sideLabelId } from './change';
  import SideLabel from './SideLabel.svelte';

  interface Props {
    lines: SideLines;
    labels: SideLabels;
    anchor: string;
    featured: ColourSchemeId;
    edit: BlockEdit | null;
  }

  const { lines, labels, anchor, featured, edit }: Props = $props();

  const items = $derived(Math.max(lines.before.length, lines.after.length));
  const labelled = $derived(Boolean(labels.before || labels.after));
</script>

<div class="tf-cols" style:--_rows={items + (labelled ? 1 : 0)} style:--_items={items}>
  {#each SIDES as side (side)}
    {@const label = labels[side]}
    {#if lines[side].length > 0}
      <div
        class="tf-col"
        data-side={side}
        data-lp-scheme={side === 'after' ? featured : undefined}
      >
        {#if label}<SideLabel {side} text={label} {anchor} {edit} />{/if}
        <ul aria-labelledby={label ? sideLabelId(anchor, side) : undefined}>
          {#each lines[side] as line, index (index)}
            <li>
              <span class="tf-col__mark" aria-hidden="true">
                {#if side === 'after'}<CheckIcon size="1em" />{/if}
              </span>
              <span>{line}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/each}
</div>

<style>
  .tf-cols {
    --_pad: clamp(var(--space-5), var(--space-3) + 2cqi, var(--space-10));
    display: grid;
    gap: var(--space-4);
  }

  .tf-col {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    padding-block: var(--_pad);
    color: var(--lp-ink-soft);
  }

  .tf-col[data-side='after'] {
    padding-inline: var(--_pad);
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a grid row. */
  li {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr);
    gap: var(--space-2);
    margin: 0;
    padding-block: var(--space-3);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* Both marks sit on the FIRST line, however the line wraps. */
  .tf-col__mark {
    display: inline-flex;
    margin-block-start: calc((1lh - 1em) / 2);
    color: var(--lp-accent);
  }

  .tf-col[data-side='before'] .tf-col__mark {
    margin-block-start: calc(0.5lh - var(--border-width-thick) / 2);
    inline-size: var(--space-3);
    block-size: var(--border-width-thick);
    background: var(--lp-ink-soft);
  }

  @container (min-width: 44rem) {
    .tf-cols {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(var(--_rows), auto);
      column-gap: var(--lp-gap);
      row-gap: 0;
    }

    .tf-col,
    ul {
      grid-template-rows: subgrid;
      row-gap: 0;
    }

    .tf-col {
      grid-row: 1 / -1;
    }

    /* Counted from the END, so a side without a label still lines up. */
    ul {
      grid-row: span var(--_items) / -1;
    }

    .tf-col :global(.tf-label) {
      grid-row: 1;
      padding-block-end: var(--space-3);
    }
  }

  /* Bold: a hard ink rule over the open side; only the after side is a block.
     An inset shadow, so the rule takes no space from the shared rows. */
  :global(.lp[data-lp-style='bold']) .tf-col[data-side='before'] {
    box-shadow: inset 0 var(--lp-rule) 0 0 var(--lp-ink);
  }

  /* Soft: the before side is an outlined card, never a bare column. */
  :global(.lp[data-lp-style='soft']) .tf-col[data-side='before'] {
    padding-inline: var(--_pad);
    border-radius: var(--lp-radius-card);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-line);
  }
</style>
