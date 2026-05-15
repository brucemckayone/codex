<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTdAttributes } from 'svelte/elements';

  interface Props extends HTMLTdAttributes {
    children?: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<td class="table-cell {className}" {...restProps}>
  {#if children}{@render children()}{/if}
</td>

<style>
  .table-cell {
    padding: var(--space-4);
    vertical-align: middle;
  }
</style>
