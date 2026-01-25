<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLTableSectionElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<tfoot class="table-footer {className}" {...restProps}>
  {@render children()}
</tfoot>

<style>
  .table-footer {
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-neutral-50);
    font-weight: var(--font-medium);
  }

  .table-footer :global(tr:last-child) {
    border-bottom: 0;
  }
</style>
