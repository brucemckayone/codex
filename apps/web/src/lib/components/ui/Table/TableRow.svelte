<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLTableRowElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<tr class="table-row {className}" {...restProps}>
  {@render children()}
</tr>

<style>
  .table-row {
    border-bottom: 1px solid var(--color-border);
    transition: var(--transition-colors);
  }

  .table-row:hover {
    background-color: var(--color-surface-secondary);
  }

  .table-row[data-state="selected"] {
    background-color: var(--color-surface-secondary);
  }
</style>
