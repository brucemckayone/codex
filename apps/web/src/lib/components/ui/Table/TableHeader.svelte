<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLTableSectionElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<thead class="table-header {className}" {...restProps}>
  {@render children()}
</thead>

<style>
  .table-header {
    border-bottom: 1px solid var(--color-border);
  }

  .table-header :global(tr) {
    border-bottom: none;
  }
</style>
