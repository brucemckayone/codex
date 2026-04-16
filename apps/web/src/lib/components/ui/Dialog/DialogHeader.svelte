<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="dialog-header {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .dialog-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    text-align: left;
    padding: var(--space-6) var(--space-6) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }
</style>
