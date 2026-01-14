<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends HTMLTextareaAttributes {
    value?: string;
    autoResize?: boolean;
  }

  const {
    value = $bindable(''),
    autoResize = true,
    class: className,
    ...restProps
  }: Props = $props();

  let textarea: HTMLTextAreaElement;

  $effect(() => {
    if (autoResize && textarea) {
      // Trigger resize on value change
      const _ = value;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  });
</script>

<textarea
  bind:this={textarea}
  bind:value
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
