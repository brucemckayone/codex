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
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight, 1.25);
    letter-spacing: var(--tracking-tight, -0.01em);
    margin: 0;
    padding-right: var(--space-8);
  }
</style>
