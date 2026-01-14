<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="dialog-content {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .dialog-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
