<script lang="ts">
  import { melt } from '@melt-ui/svelte';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { toaster } from './toast-store';

  const { toasts, elements: { content, title, description, close } } = toaster;
</script>

<div class="toaster">
  {#each $toasts as t (t.id)}
    <div
      use:melt={$content(t.id)}
      class="toast"
      data-variant={t.data.variant}
      transition:fade={{ duration: 200 }}
      animate:flip={{ duration: 300 }}
    >
      <div class="toast-content">
        {#if t.data.title}
          <div use:melt={$title(t.id)} class="toast-title">{t.data.title}</div>
        {/if}
        {#if t.data.description}
          <div use:melt={$description(t.id)} class="toast-description">{t.data.description}</div>
        {/if}
      </div>
      <button use:melt={$close(t.id)} class="toast-close" aria-label="Close">
        ✕
      </button>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: var(--z-toast);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-4);
    min-width: 300px;
    max-width: 400px;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
  }

  .toast-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
  }

  .toast-title {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .toast-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .toast-close {
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: 0;
  }

  .toast-close:hover {
    color: var(--color-text);
  }

  /* Variants */
  .toast[data-variant="success"] {
    border-left: var(--border-width-toast) var(--border-style) var(--color-success);
  }
  .toast[data-variant="error"] {
    border-left: var(--border-width-toast) var(--border-style) var(--color-error);
  }
  .toast[data-variant="warning"] {
    border-left: var(--border-width-toast) var(--border-style) var(--color-warning);
  }
</style>
