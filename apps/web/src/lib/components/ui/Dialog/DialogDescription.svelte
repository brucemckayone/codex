<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLParagraphElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<p class="dialog-description {className}" {...restProps}>
  {@render children()}
</p>

<style>
  .dialog-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
