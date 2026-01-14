<script lang="ts">
  import type { createDialog } from '@melt-ui/svelte';
  import { melt } from '@melt-ui/svelte';
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLHeadingElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  const {
    elements: { title },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');
</script>

<h2 use:melt={$title} class="dialog-title {className ?? ''}" {...restProps}>
  {@render children()}
</h2>

<style>
  .dialog-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }
</style>
