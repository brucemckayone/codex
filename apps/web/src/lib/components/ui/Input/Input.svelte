<!--
  @component Input

  A flexible input component with built-in error handling and password visibility toggle.

  Features:
  - Password inputs automatically receive a visibility toggle button
  - Toggle button uses aria-label for accessibility and tabindex="-1" to prevent tab focus
  - Error states visually indicated via data-error attribute

  @prop {string} [error] - Optional error message to display
  @prop {string} [type='text'] - Input type (password type gets auto toggle)
  @prop {any} value - Bindable input value

  @example
  <Input type="password" bind:value={password} error={errorMessage} />
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    error?: string;
  }

  // biome-ignore lint/style/useConst: Svelte 5 $bindable() props require let for reactivity
  let { class: className, error, value = $bindable(''), type = 'text', ...rest }: Props = $props();

  // Password visibility toggle
  // biome-ignore lint/style/useConst: Svelte 5 $state() primitives require let for reactivity
  let showPassword = $state(false);
  const inputType = $derived(
    type === 'password' && showPassword ? 'text' : type
  );
</script>

<div class="input-container {className ?? ''}">
  <div class="input-wrapper">
    <input
      class="input"
      data-error={!!error}
      data-has-toggle={type === 'password'}
      bind:value
      type={inputType}
      {...rest}
    />
    {#if type === 'password'}
      <button
        type="button"
        class="password-toggle"
        onclick={() => showPassword = !showPassword}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        tabindex="-1"
      >
        {#if showPassword}
          <!-- Eye slash icon (hide) -->
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
            <line x1="2" y1="2" x2="22" y2="22"/>
          </svg>
        {:else}
          <!-- Eye icon (show) -->
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>
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

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
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

  .input[data-has-toggle="true"] {
    padding-right: var(--space-10);
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

  .password-toggle {
    position: absolute;
    right: var(--space-2);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .password-toggle:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  .password-toggle:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .error-text {
    font-size: var(--text-xs);
    color: var(--color-error);
  }

  .input::placeholder {
    color: var(--color-text-muted);
  }
</style>
