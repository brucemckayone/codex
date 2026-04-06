<!--
  @component EditMediaDialog

  Dialog for editing media item metadata (title and description).
  Uses DialogForm for the shared dialog + form boilerplate.

  @prop {boolean} open - Whether the dialog is open
  @prop {(open: boolean) => void} [onOpenChange] - Callback for open state change
  @prop {MediaItemWithRelations | null} media - The media item being edited
  @prop {(id: string, data: { title?: string; description?: string | null }) => Promise<void>} onSave - Callback when save is submitted
-->
<script lang="ts">
  import { DialogForm } from '$lib/components/ui/DialogForm';
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
    if (!isOpen) {
      error = null;
    }
    onOpenChange?.(isOpen);
  }
</script>

<DialogForm
  title={m.media_edit_title()}
  bind:open
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel={m.media_edit_save()}
>
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
</DialogForm>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
