<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    error?: string;
  }

  const { class: className, error, value = $bindable(), ...rest }: Props = $props();
</script>

<div class="input-container {className ?? ''}">
  <input
    class="input"
    data-error={!!error}
    bind:value
    {...rest}
  />
  {#if error}
    <span class="error-text">{error}</span>
  {/if}
</div>

<style>
  .input-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .input {
    width: 100%;
    height: var(--space-10);
    padding: 0 var(--space-3);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    transition: var(--transition-colors), var(--transition-shadow);
  }

  .input:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 2px var(--color-primary-100);
  }

  .input[data-error="true"] {
    border-color: var(--color-error);
  }

  .input[data-error="true"]:focus {
    box-shadow: 0 0 0 2px var(--color-error-50);
  }

  .input:disabled {
    cursor: not-allowed;
    background-color: var(--color-surface-secondary);
    opacity: 0.7;
  }

  .error-text {
    font-size: var(--text-xs);
    color: var(--color-error);
  }

  .input::placeholder {
    color: var(--color-text-muted);
  }
</style>
