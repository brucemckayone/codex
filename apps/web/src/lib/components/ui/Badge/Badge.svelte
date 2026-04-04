<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';
  }

  const { children, variant = 'neutral', class: className, ...restProps }: Props = $props();
</script>

<div class="badge {className}" data-variant={variant} {...restProps}>
  {@render children()}
</div>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) transparent;
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  /* Variants */
  .badge[data-variant="neutral"] {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .badge[data-variant="success"] {
    /* background-color is already defined above */
    background-color: var(--color-success-50);
    color: var(--color-success-700);
    border: var(--border-width) var(--border-style) var(--color-success-200);
  }

  .badge[data-variant="warning"] {
    background-color: var(--color-warning-50);
    color: var(--color-warning-700);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
  }

  .badge[data-variant="error"] {
    background-color: var(--color-error-50);
    color: var(--color-error-700);
    border: var(--border-width) var(--border-style) var(--color-error-200);
  }

  .badge[data-variant="info"] {
    background-color: var(--color-info-50);
    color: var(--color-info-700);
    border: var(--border-width) var(--border-style) var(--color-info-200);
  }

  .badge[data-variant="accent"] {
    background-color: var(--color-brand-accent-subtle);
    color: var(--color-brand-accent);
    border: var(--border-width) var(--border-style) var(--color-brand-accent);
  }
</style>
