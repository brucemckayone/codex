<!--
  @component ChangeStatement

  The `statement` layout: the change told by scale AND face. The before lines
  are plain and quiet, a connector runs down, and the after lines arrive large
  in the display face — still a step under the section heading. Soft and
  Cinematic centre it, like a title card.
-->
<script lang="ts">
  import type { BlockEdit } from '../../model/types';
  import { SIDES, type SideLabels, type SideLines, sideLabelId } from './change';
  import Connector from './Connector.svelte';
  import SideLabel from './SideLabel.svelte';

  interface Props {
    lines: SideLines;
    labels: SideLabels;
    anchor: string;
    edit: BlockEdit | null;
  }

  const { lines, labels, anchor, edit }: Props = $props();
</script>

<div class="tf-statement">
  {#each SIDES as side (side)}
    {@const label = labels[side]}
    {#if side === 'after' && lines.before.length > 0 && lines.after.length > 0}
      <Connector direction="down" />
    {/if}
    {#if lines[side].length > 0}
      <div class="tf-statement__side" data-side={side}>
        {#if label}<SideLabel {side} text={label} {anchor} {edit} />{/if}
        <ul aria-labelledby={label ? sideLabelId(anchor, side) : undefined}>
          {#each lines[side] as line, index (index)}<li>{line}</li>{/each}
        </ul>
      </div>
    {/if}
  {/each}
</div>

<style>
  .tf-statement {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
  }

  .tf-statement__side {
    display: grid;
    gap: var(--space-3);
  }

  /* Wider than the leading, so a wrapped line never runs into the next. */
  ul {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tf-statement__side[data-side='after'] ul {
    gap: var(--space-4);
  }

  /* base.css spaces every `li` but the last. */
  li {
    margin: 0;
    text-wrap: balance;
  }

  .tf-statement__side[data-side='before'] li {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .tf-statement__side[data-side='after'] li {
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: calc(var(--lp-size-title) * 1.45);
    font-weight: var(--lp-weight-heading);
    font-synthesis: none;
    line-height: var(--lp-leading-heading);
    letter-spacing: var(--lp-tracking-heading);
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])) .tf-statement {
    justify-items: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .tf-statement
    > :global(.tf-link) {
    justify-self: center;
    margin-inline-start: 0;
  }
</style>
