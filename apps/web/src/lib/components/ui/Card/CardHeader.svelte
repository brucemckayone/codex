<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="card-header {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .card-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-6);
  }
</style>
