<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Body is mounted on its own.
  const variant = getContext<{ current: 'dialog' | 'drawer' } | undefined>('DIALOG_VARIANT');
</script>

<div class="dialog-body {className ?? ''}" data-variant={variant?.current} {...restProps}>
  {@render children()}
</div>

<style>
  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* In a drawer the whole panel scrolls and spaces its children, so Body
     adds no box of its own: its children are the panel's. */
  .dialog-body[data-variant='drawer'] {
    display: contents;
  }
</style>
