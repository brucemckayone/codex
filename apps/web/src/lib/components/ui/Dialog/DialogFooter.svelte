<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="dialog-footer {className ?? ''}" {...restProps}>
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

  @media (--breakpoint-sm) {
    .dialog-footer {
      flex-direction: row;
      justify-content: flex-end;
    }
  }
</style>
