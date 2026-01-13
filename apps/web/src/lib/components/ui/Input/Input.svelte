<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  // Use interface extension properly for Svelte 5 props
  interface Props extends HTMLInputAttributes {
    error?: string;
  }

  const { class: className, error, value = $bindable(), ...rest }: Props = $props();
</script>

<div class="input-wrapper">
  <input
    class:error={!!error}
    class={className}
    bind:value
    {...rest}
  />
  {#if error}
    <span class="error-text">{error}</span>
  {/if}
</div>

<style>
  .input-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-base);
    transition: all 0.2s;
  }

  input:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 2px var(--color-primary-100);
  }

  input.error {
    border-color: var(--color-error);
  }

  input.error:focus {
    box-shadow: 0 0 0 2px var(--color-error-100);
  }

  input::placeholder {
    color: var(--color-text-muted);
  }

  .error-text {
    font-size: var(--text-xs);
    color: var(--color-error);
    margin-top: var(--space-1);
  }
</style>
