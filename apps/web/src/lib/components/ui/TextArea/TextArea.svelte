<!--
  @component Textarea

  A flexible textarea component with auto-resize support and error handling.

  Features:
  - Auto-resizes to fit content by default
  - Error states visually indicated via data-error attribute
  - Consistent focus and disabled styles

  @prop {string} [value] - Bindable textarea value
  @prop {boolean} [autoResize=true] - Whether to automatically adjust height
  @prop {string} [error] - Optional error message to display

  @example
  <Textarea bind:value={bio} error={errorMessage} rows={4} />
-->
<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends HTMLTextareaAttributes {
    value?: string | number;
    autoResize?: boolean;
    error?: string;
  }

  let {
    value = $bindable(''),
    autoResize = true,
    error,
    class: className,
    id,
    ...restProps
  }: Props = $props();

  const errorId = id ? `${id}-error` : 'textarea-error';

  let textarea: HTMLTextAreaElement;
  // Internal state prevents resize loop when autoResize updates textarea height
  let internalValue = $state(value);

  // Sync external prop changes to internal state
  $effect(() => {
    if (value !== internalValue) {
      internalValue = value;
    }
  });

  // Auto-resize effect
  $effect(() => {
    if (autoResize && textarea && internalValue !== undefined) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  });

  // Sync internal state changes back to the bindable prop
  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    internalValue = target.value;
    value = target.value;
  }
</script>

<div class="textarea-container {className ?? ''}">
  <textarea
    bind:this={textarea}
    value={internalValue}
    oninput={handleInput}
    class="textarea"
    data-error={!!error}
    aria-invalid={!!error}
    aria-describedby={error ? errorId : undefined}
    {id}
    {...restProps}
  ></textarea>
  {#if error}
    <span class="error-text" id={errorId} role="alert">{error}</span>
  {/if}
</div>

<style>
  .textarea-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .textarea {
    width: 100%;
    min-height: var(--space-24);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    transition: var(--transition-colors);
    resize: vertical;
  }

  .textarea:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 2px var(--color-primary-100);
  }

  .textarea[data-error="true"] {
    border-color: var(--color-error);
  }

  .textarea[data-error="true"]:focus {
    box-shadow: 0 0 0 2px var(--color-error-50);
  }

  .textarea:disabled {
    cursor: not-allowed;
    background-color: var(--color-surface-secondary);
    opacity: 0.7;
  }

  .textarea::placeholder {
    color: var(--color-text-muted);
  }

  .error-text {
    font-size: var(--text-xs);
    color: var(--color-error);
  }
</style>
