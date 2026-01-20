<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="card-content {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .card-content {
    padding: var(--space-6);
  }

  /* Only remove top padding when following a header */
  :global(.card-header) + .card-content {
    padding-top: 0;
  }
</style>
