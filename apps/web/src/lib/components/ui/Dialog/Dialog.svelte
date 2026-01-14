<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLDialogAttributes } from 'svelte/elements';

  interface Props extends HTMLDialogAttributes {
    children: Snippet;
    open?: boolean;
    onclose?: () => void;
  }

  let { children, open = $bindable(false), class: className, onclose, ...restProps }: Props = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog && dialog.open) {
      dialog.close();
    }
  });

  function handleClose() {
    open = false;
    onclose?.();
  }

  function handleClick(e: MouseEvent) {
    if (e.target === dialog) {
      handleClose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="dialog {className}"
  onclose={handleClose}
  onclick={handleClick}
  {...restProps}
>
  <div class="dialog-content-wrapper" onclick={(e) => e.stopPropagation()} role="document">
    {@render children()}
  </div>
</dialog>

<style>
  .dialog {
    border: none;
    border-radius: var(--radius-lg);
    padding: 0;
    max-width: 90vw;
    max-height: 90vh;
    background: transparent;
    color: var(--color-text);
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    animation: fade-in 0.2s ease-out;
  }

  .dialog-content-wrapper {
    background: var(--color-surface);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    border: 1px solid var(--color-border);
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
