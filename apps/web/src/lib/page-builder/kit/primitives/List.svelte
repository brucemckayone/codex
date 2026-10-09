<!--
  @component List

  A short list of plain strings. `number` is for REAL sequences only (steps,
  stages) — numbering an unordered set is decoration the kit does not do.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';

  interface Props {
    items: readonly string[];
    marker?: 'check' | 'bar' | 'number';
    size?: 'body' | 'small';
    class?: string;
  }

  const { items, marker = 'check', size = 'body', class: className }: Props = $props();
</script>

<svelte:element
  this={marker === 'number' ? 'ol' : 'ul'}
  class="lp-list {className ?? ''}"
  data-marker={marker}
  data-size={size}
>
  {#each items as item, index (index)}
    <li>
      {#if marker === 'check'}
        <span class="lp-list__mark" aria-hidden="true"><CheckIcon size="1em" /></span>
      {:else}
        <span class="lp-list__mark" aria-hidden="true"></span>
      {/if}
      <span>{item}</span>
    </li>
  {/each}
</svelte:element>

<style>
  .lp-list {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: lp-list;
  }

  .lp-list[data-size='body'] {
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .lp-list[data-size='small'] {
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  .lp-list li {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-2);
    counter-increment: lp-list;
  }

  .lp-list__mark {
    display: inline-flex;
    align-self: center;
    color: var(--lp-accent);
  }

  .lp-list[data-marker='bar'] .lp-list__mark {
    align-self: center;
    inline-size: var(--space-3);
    block-size: var(--lp-rule);
    background: currentColor;
  }

  .lp-list[data-marker='number'] .lp-list__mark::before {
    content: counter(lp-list, decimal-leading-zero);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-small);
    font-weight: var(--lp-weight-title);
    font-variant-numeric: tabular-nums;
  }
</style>
