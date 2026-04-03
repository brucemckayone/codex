<!--
  @component EditMediaDialog

  Dialog for editing media item metadata (title and description).
  Uses the standard Dialog component for consistency and accessibility.

  @prop {boolean} open - Whether the dialog is open
  @prop {(open: boolean) => void} [onOpenChange] - Callback for open state change
  @prop {MediaItemWithRelations | null} media - The media item being edited
  @prop {(id: string, data: { title?: string; description?: string | null }) => Promise<void>} onSave - Callback when save is submitted
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import type { MediaItemWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    media: MediaItemWithRelations | null;
    onSave: (id: string, data: { title?: string; description?: string | null }) => Promise<void>;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    media,
    onSave,
  }: Props = $props();

  let title = $state('');
  let description = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Sync form fields when media changes
  $effect(() => {
    if (media) {
      title = media.title ?? '';
      description = media.description ?? '';
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!title.trim()) {
      error = 'Title is required';
      return;
    }

    if (!media) return;

    submitting = true;
    try {
      await onSave(media.id, {
        title: title.trim(),
        description: description.trim() || null,
      });
      open = false;
      onOpenChange?.(false);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update media';
    } finally {
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
    if (!isOpen) {
      error = null;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.media_edit_title()}</Dialog.Title>
    </Dialog.Header>

    <form onsubmit={handleSubmit} class="edit-form">
      {#if error}
        <div class="form-error" role="alert">{error}</div>
      {/if}

      <div class="form-field">
        <label class="field-label" for="edit-media-title">
          {m.media_edit_title_label()}
        </label>
        <input
          type="text"
          id="edit-media-title"
          class="field-input"
          bind:value={title}
          maxlength={255}
          required
          disabled={submitting}
        />
      </div>

      <div class="form-field">
        <label class="field-label" for="edit-media-description">
          {m.media_edit_description_label()}
        </label>
        <textarea
          id="edit-media-description"
          class="field-input field-textarea"
          bind:value={description}
          maxlength={2000}
          placeholder={m.media_edit_description_placeholder()}
          rows={3}
          disabled={submitting}
        ></textarea>
      </div>

      <Dialog.Footer>
        <button
          type="button"
          class="btn btn-secondary"
          onclick={() => handleOpenChange(false)}
          disabled={submitting}
        >
          {m.common_cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={submitting}>
          {#if submitting}
            {m.common_loading()}
          {:else}
            {m.media_edit_save()}
          {/if}
        </button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .field-textarea {
    resize: vertical;
    min-height: calc(var(--space-6) * 3);
    font-family: inherit;
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    border: none;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .btn-primary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .btn-secondary {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--color-surface);
  }

  /* Dark mode */
  :global([data-theme='dark']) .field-label {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .field-input {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .form-error {
    background-color: var(--color-error-900);
    border-color: var(--color-error-700);
    color: var(--color-error-100);
  }

  :global([data-theme='dark']) .btn-secondary {
    background-color: var(--color-surface-dark);
    color: var(--color-text-dark);
    border-color: var(--color-border-dark);
  }
</style>
