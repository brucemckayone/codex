<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTableAttributes } from 'svelte/elements';

  interface Props extends HTMLTableAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="table-container">
  <table class="table {className}" {...restProps}>
    {@render children()}
  </table>
</div>

<style>
  .table-container {
    width: 100%;
    overflow: auto;
  }

  .table {
    width: 100%;
    caption-side: bottom;
    font-size: var(--text-sm);
    border-collapse: collapse;
  }
</style>
