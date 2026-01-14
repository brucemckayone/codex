<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="card {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .card {
    background-color: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm); /* Assuming shadow token exists, need to verify */
    overflow: hidden;
  }

  :global([data-theme="dark"]) .card {
    background-color: var(--color-surface);
  }
</style>
