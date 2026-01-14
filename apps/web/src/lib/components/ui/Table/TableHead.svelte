<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLThAttributes } from 'svelte/elements';

  interface Props extends HTMLThAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<th class="table-head {className}" {...restProps}>
  {@render children()}
</th>

<style>
  .table-head {
    height: var(--space-10);
    padding: 0 var(--space-4);
    text-align: left;
    vertical-align: middle;
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .table-head:has([role=checkbox]) {
    padding-right: 0;
  }
</style>
