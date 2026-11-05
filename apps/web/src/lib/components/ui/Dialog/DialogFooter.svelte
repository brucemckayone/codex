<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  // Set by Dialog.Content; absent when Footer is mounted on its own.
  const variant = getContext<{ current: 'dialog' | 'drawer' } | undefined>('DIALOG_VARIANT');
</script>

<div class="dialog-footer {className ?? ''}" data-variant={variant?.current} {...restProps}>
  {@render children()}
</div>

<style>
  .dialog-footer {
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6) var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
    background: var(--color-surface-secondary);
    border-radius: 0 0 var(--radius-modal) var(--radius-modal);
    margin-top: auto;
  }

  /* A drawer's footer is ruled off like its panel edge. */
  .dialog-footer[data-variant='drawer'] {
    border-top-color: var(--color-border);
  }

  @media (--breakpoint-sm) {
    .dialog-footer {
      flex-direction: row;
      justify-content: flex-end;
    }
  }
</style>
