<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLParagraphElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<p class="card-description {className}" {...restProps}>
  {@render children()}
</p>

<style>
  .card-description {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
