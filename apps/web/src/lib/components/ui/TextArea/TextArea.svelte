<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends HTMLTextareaAttributes {
    value?: string;
    autoResize?: boolean;
  }

  let {
    value = $bindable(''),
    autoResize = true,
    class: className,
    ...restProps
  }: Props = $props();

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

<textarea
  bind:this={textarea}
  value={internalValue}
  oninput={handleInput}
  class="textarea {className ?? ''}"
  {...restProps}
></textarea>

<style>
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

  .textarea:disabled {
    cursor: not-allowed;
    background-color: var(--color-surface-secondary);
    opacity: 0.7;
  }

  .textarea::placeholder {
    color: var(--color-text-muted);
  }
</style>
