<script lang="ts">
  import type { createDialog } from '@melt-ui/svelte';
  import { melt } from '@melt-ui/svelte';
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLParagraphElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  const {
    elements: { description },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');
</script>

<p use:melt={$description} class="dialog-description {className ?? ''}" {...restProps}>
  {@render children()}
</p>

<style>
  .dialog-description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    margin: 0;
  }
</style>
