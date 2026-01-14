<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTdAttributes } from 'svelte/elements';

  interface Props extends HTMLTdAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<td class="table-cell {className}" {...restProps}>
  {@render children()}
</td>

<style>
  .table-cell {
    padding: var(--space-4);
    vertical-align: middle;
  }

  .table-cell:has([role=checkbox]) {
    padding-right: 0;
  }
</style>
