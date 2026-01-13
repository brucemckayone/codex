<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    loading?: boolean;
    children: Snippet;
  }

  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    ...restProps
  }: Props = $props();
</script>

<button
  class="button"
  data-variant={variant}
  data-size={size}
  disabled={disabled || loading}
  aria-busy={loading}
  {...restProps}
>
  {#if loading}
    <span class="button-spinner" aria-hidden="true"></span>
  {/if}
  <span class="button-content" class:invisible={loading}>
    {@render children()}
  </span>
</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    transition: var(--transition-colors), var(--transition-shadow);
    cursor: pointer;
    white-space: nowrap;
    position: relative;
    user-select: none;
  }

  .button:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Size variants */
  .button[data-size="xs"] {
    height: 1.75rem;
    padding-inline: var(--space-2);
    font-size: var(--text-xs);
  }

  .button[data-size="sm"] {
    height: 2rem;
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .button[data-size="md"] {
    height: 2.5rem;
    padding-inline: var(--space-4);
    font-size: var(--text-base);
  }

  .button[data-size="lg"] {
    height: 2.75rem;
    padding-inline: var(--space-5);
    font-size: var(--text-lg);
  }

  .button[data-size="xl"] {
    height: 3rem;
    padding-inline: var(--space-6);
    font-size: var(--text-lg);
  }

  /* Variant: Primary */
  .button[data-variant="primary"] {
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
    border: none;
  }

  .button[data-variant="primary"]:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  /* Variant: Secondary */
  .button[data-variant="secondary"] {
    background-color: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .button[data-variant="secondary"]:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  /* Variant: Ghost */
  .button[data-variant="ghost"] {
    background-color: transparent;
    color: var(--color-text);
    border: none;
  }

  .button[data-variant="ghost"]:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  /* Variant: Destructive */
  .button[data-variant="destructive"] {
    background-color: var(--color-error);
    color: var(--color-text-inverse);
    border: none;
  }

  .button[data-variant="destructive"]:hover:not(:disabled) {
    background-color: #dc2626;
  }

  /* Loading spinner */
  .button-spinner {
    position: absolute;
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .invisible {
    visibility: hidden;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
