<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'error' | 'success' | 'info' | 'warning';
    children: Snippet;
  }

  const { variant = 'error', children, class: className, ...restProps }: Props = $props();
</script>

<div
  class="alert {className ?? ''}"
  data-variant={variant}
  role={variant === 'error' ? 'alert' : 'status'}
  aria-live={variant === 'success' ? 'polite' : undefined}
  {...restProps}
>
  {@render children()}
</div>

<style>
  .alert {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .alert[data-variant="error"] {
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    color: var(--color-error-700);
  }

  .alert[data-variant="success"] {
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    color: var(--color-success-700);
  }

  .alert[data-variant="info"] {
    background-color: var(--color-info-50);
    border: var(--border-width) var(--border-style) var(--color-info-200);
    color: var(--color-info-700);
  }

  .alert[data-variant="warning"] {
    background-color: var(--color-warning-50);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    color: var(--color-warning-700);
  }
</style>
