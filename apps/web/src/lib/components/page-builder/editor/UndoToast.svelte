<!--
  @component UndoToast

  "Hero deleted · Undo". The app's toaster has no action slot, so the editor
  carries this one itself. It waits while the pointer or focus is on it, so
  the Undo stays reachable for anyone who needs longer than the timeout.
-->
<script lang="ts">
  import { XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    message: string | null;
    onUndo: () => void;
    onDismiss: () => void;
  }

  const { message, onUndo, onDismiss }: Props = $props();

  const VISIBLE_MS = 6000;
  let paused = $state(false);

  $effect(() => {
    if (!message || paused) return;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  });
</script>

<div class="undo-region" role="status" aria-live="polite">
  {#if message}
    <div
      class="undo"
      role="group"
      aria-label={message}
      onpointerenter={() => (paused = true)}
      onpointerleave={() => (paused = false)}
      onfocusin={() => (paused = true)}
      onfocusout={() => (paused = false)}
    >
      <span class="undo__message">{message}</span>
      <button type="button" class="undo__action" onclick={onUndo}>
        {m.studio_page_editor_undo_delete()}
      </button>
      <button
        type="button"
        class="undo__dismiss"
        aria-label={m.studio_page_editor_dismiss()}
        onclick={onDismiss}
      >
        <XIcon size={16} />
      </button>
    </div>
  {/if}
</div>

<style>
  .undo-region {
    position: absolute;
    inset-inline: 0;
    inset-block-end: var(--space-6);
    display: grid;
    justify-items: center;
    pointer-events: none;
  }

  .undo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-text);
    color: var(--color-background);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-sm);
    pointer-events: auto;
  }

  .undo__action,
  .undo__dismiss {
    display: inline-grid;
    place-items: center;
    min-block-size: var(--space-8);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .undo__action {
    padding-inline: var(--space-3);
    font-weight: var(--font-semibold);
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }

  .undo__dismiss {
    inline-size: var(--space-8);
  }

  .undo__action:hover,
  .undo__dismiss:hover {
    background: color-mix(in oklab, var(--color-background) 14%, transparent);
  }

  .undo__action:focus-visible,
  .undo__dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-background);
    outline-offset: calc(var(--focus-offset) * -1);
  }
</style>
