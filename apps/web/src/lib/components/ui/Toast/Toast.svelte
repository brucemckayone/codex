<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { type Toast, toast } from './toast-store.js';

  interface Props {
    toast: Toast;
  }

  const { toast: t }: Props = $props();

</script>

<div
  class="toast"
  data-variant={t.variant}
  role="alert"
  in:fly={{ y: 20, duration: 300 }}
  out:fade={{ duration: 200 }}
>
  <div class="toast-content">
    {#if t.title}
      <div class="toast-title">{t.title}</div>
    {/if}
    {#if t.description}
      <div class="toast-description">{t.description}</div>
    {/if}
  </div>
  <button class="toast-close" onclick={() => toast.dismiss(t.id)} aria-label="Close">
    ✕
  </button>
</div>

<style>
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
    border: 1px solid var(--color-border);
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
    border-left: 4px solid var(--color-success);
  }
  .toast[data-variant="error"] {
    border-left: 4px solid var(--color-error);
  }
  .toast[data-variant="warning"] {
    border-left: 4px solid var(--color-warning);
  }
</style>
