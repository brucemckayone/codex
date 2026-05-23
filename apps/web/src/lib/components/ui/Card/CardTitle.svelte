<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLHeadingElement> {
    children: Snippet;
    level?: 1 | 2 | 3 | 4 | 5 | 6;
  }

  const { children, level = 3, class: className, ...restProps }: Props = $props();
</script>

<svelte:element this={`h${level}`} class="card-title {className ?? ''}" {...restProps}>
  {@render children()}
</svelte:element>

<style>
  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    color: var(--color-text);
  }
</style>
