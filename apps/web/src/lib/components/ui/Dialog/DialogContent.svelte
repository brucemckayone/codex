<script lang="ts">
  import { type createDialog, melt } from '@melt-ui/svelte';
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  const {
    elements: { portalled, overlay, content, close },
    states: { open },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');
</script>

{#if $open}
  <div use:melt={$portalled}>
    <div use:melt={$overlay} class="dialog-overlay"></div>
    <div class="dialog-content-wrapper">
      <div use:melt={$content} class="dialog-content {className}" {...restProps}>
        {@render children()}
        <button use:melt={$close} class="dialog-close" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-backdrop);
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  .dialog-content-wrapper {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .dialog-content {
    position: relative;
    background: var(--color-surface);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    border: var(--border-width) var(--border-style) var(--color-border);
    max-width: 32rem;
    width: 100%;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .dialog-close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .dialog-close:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }
</style>
