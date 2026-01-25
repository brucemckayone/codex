<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLTableSectionElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<tbody class="table-body {className}" {...restProps}>
  {@render children()}
</tbody>

<style>
  .table-body :global(tr:last-child) {
    border-bottom: 0;
  }
</style>
