<!--
  @component ContentForm

  Content creation and editing form with progressive enhancement.
  Follows the settings page card-section pattern with native HTML elements.

  @prop {ContentWithRelations} [content] - Existing content (edit mode) or undefined (create mode)
  @prop {string} organizationId - Organization UUID
  @prop {string} orgSlug - Organization slug for URL preview
  @prop {MediaItemOption[]} [mediaItems] - Available media items for picker
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { goto } from '$app/navigation';
  import { ConfirmDialog } from '$lib/components/ui';
  import {
    createContentForm,
    updateContentForm,
    deleteContent,
  } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { ContentWithRelations } from '$lib/types';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
  }

  interface Props {
    content?: ContentWithRelations;
    organizationId: string;
    orgSlug: string;
    mediaItems?: MediaItemOption[];
    onSuccess?: () => void;
  }

  const { content, organizationId, orgSlug, mediaItems = [], onSuccess }: Props = $props();

  const isEdit = $derived(!!content);
  // ── Local UI state ──────────────────────────────────────────────────────
  let slugManuallyEdited = $state(!!content);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);
  let showSuccess = $state(false);
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track content type locally for conditional section rendering
  let currentContentType = $state(content?.contentType ?? 'video');
  // Track visibility locally for description text
  let currentVisibility = $state(content?.visibility ?? 'public');
  // Track slug locally for preview
  let currentSlug = $state(content?.slug ?? '');

  onDestroy(() => {
    if (successTimeout) clearTimeout(successTimeout);
  });

  // ── Populate form fields ──────────────────────────────────────────────
  $effect(() => {
    const fields: Record<string, string> = {
      organizationId,
      title: content?.title ?? '',
      slug: content?.slug ?? '',
      description: content?.description ?? '',
      contentType: content?.contentType ?? 'video',
      mediaItemId: content?.mediaItemId ?? '',
      contentBody: content?.contentBody ?? '',
      visibility: content?.visibility ?? 'public',
      price: content?.priceCents ? (content.priceCents / 100).toFixed(2) : '0.00',
    };
    if (isEdit && content) {
      fields.contentId = content.id;
      updateContentForm.fields.set(fields);
    } else {
      createContentForm.fields.set(fields);
    }
  });

  // SvelteKit form() result is template-reactive but not $effect-trackable.
  // We trigger callbacks from template {#if} blocks, deferred to avoid
  // state_unsafe_mutation errors during render.
  function handleCreateSuccess() {
    tick().then(() => {
      toast.success(m.studio_content_form_create_success());
      onSuccess?.();
      goto('/studio/content');
    });
  }

  function handleUpdateSuccess() {
    tick().then(() => {
      showSuccess = true;
      if (successTimeout) clearTimeout(successTimeout);
      successTimeout = setTimeout(() => (showSuccess = false), 3000);
    });
  }

  // ── Auto-slug from title ──────────────────────────────────────────────
  function handleTitleInput(e: Event) {
    if (!slugManuallyEdited) {
      const title = (e.target as HTMLInputElement).value;
      const generated = title
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      currentSlug = generated;

      // Update the slug input value directly
      const slugInput = document.getElementById('slug') as HTMLInputElement;
      if (slugInput) slugInput.value = generated;
    }
  }

  function handleSlugInput(e: Event) {
    slugManuallyEdited = true;
    currentSlug = (e.target as HTMLInputElement).value;
  }

  function handleContentTypeChange(e: Event) {
    currentContentType = (e.target as HTMLSelectElement).value as 'video' | 'audio' | 'written';
  }

  function handleVisibilityChange(e: Event) {
    currentVisibility = (e.target as HTMLSelectElement).value;
  }

  // ── Visibility descriptions ───────────────────────────────────────────
  const visibilityDescriptions: Record<string, () => string> = {
    public: () => m.studio_content_form_visibility_public_desc(),
    private: () => m.studio_content_form_visibility_private_desc(),
    members_only: () => m.studio_content_form_visibility_members_only_desc(),
    purchased_only: () => m.studio_content_form_visibility_purchased_only_desc(),
  };

  // ── Media helpers ─────────────────────────────────────────────────────
  function formatDuration(seconds: number | null | undefined): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number | null | undefined): string {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  // ── Delete ────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!content) return;
    deleting = true;
    try {
      await deleteContent(content.id);
      toast.success(m.studio_content_form_delete_success());
      goto('/studio/content');
    } catch (err) {
      const message = err instanceof Error ? err.message : m.studio_content_form_delete_error();
      toast.error(message);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="content-page">
  <div class="page-header">
    <a href="/studio/content" class="back-link">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      {m.studio_content_form_back_to_content()}
    </a>
    <h1 class="page-title">
      {isEdit ? m.studio_content_form_edit_title() : m.studio_content_form_create_title()}
    </h1>
  </div>

  <!-- Success message -->
  {#if showSuccess}
    <div class="success-message" role="status" aria-live="polite">
      {m.studio_content_form_update_success()}
    </div>
  {/if}

  <!-- Trigger redirects/toasts when form result changes (template-reactive) -->
  {#if !isEdit && createContentForm.result?.success}
    {@const _ = handleCreateSuccess()}
  {/if}
  {#if isEdit && updateContentForm.result?.success}
    {@const _ = handleUpdateSuccess()}
  {/if}

  <!-- Error message -->
  {#if isEdit && updateContentForm.result?.error}
    <div class="error-message" role="alert">
      {updateContentForm.result.error}
    </div>
  {:else if !isEdit && createContentForm.result?.error}
    <div class="error-message" role="alert">
      {createContentForm.result.error}
    </div>
  {/if}

  <form {...(isEdit ? updateContentForm : createContentForm)} class="content-form" novalidate>
    <input type="hidden" name="organizationId" value={organizationId} />
    {#if isEdit && content}
      <input type="hidden" name="contentId" value={content.id} />
    {/if}

    <!-- Details Section -->
    <section class="form-card">
      <h3 class="card-title">{m.studio_content_form_section_details()}</h3>

      <div class="form-fields">
        <div class="form-field">
          <label class="field-label" for="title">
            {m.studio_content_form_title_label()}
          </label>
          <input
            type="text"
            id="title"
            name="title"
            class="field-input"
            value={content?.title ?? ''}
            placeholder={m.studio_content_form_title_placeholder()}
            required
            oninput={handleTitleInput}
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="slug">
            {m.studio_content_form_slug_label()}
          </label>
          <input
            type="text"
            id="slug"
            name="slug"
            class="field-input"
            value={content?.slug ?? ''}
            placeholder={m.studio_content_form_slug_placeholder()}
            required
            oninput={handleSlugInput}
          />
          {#if currentSlug}
            <span class="field-hint slug-preview">
              {orgSlug}.lvh.me/content/{currentSlug}
            </span>
          {/if}
        </div>

        <div class="form-field">
          <label class="field-label" for="description">
            {m.studio_content_form_description_label()}
          </label>
          <textarea
            id="description"
            name="description"
            class="field-input field-textarea"
            placeholder={m.studio_content_form_description_placeholder()}
            rows="4"
          >{content?.description ?? ''}</textarea>
        </div>

        <div class="form-field">
          <label class="field-label" for="contentType">
            {m.studio_content_form_content_type_label()}
          </label>
          <select
            id="contentType"
            name="contentType"
            class="field-input field-select"
            value={content?.contentType ?? 'video'}
            onchange={handleContentTypeChange}
          >
            <option value="video">{m.studio_content_form_type_video()}</option>
            <option value="audio">{m.studio_content_form_type_audio()}</option>
            <option value="written">{m.studio_content_form_type_article()}</option>
          </select>
        </div>
      </div>
    </section>

    <!-- Media Section (video/audio only) -->
    {#if currentContentType === 'video' || currentContentType === 'audio'}
      <section class="form-card">
        <h3 class="card-title">{m.studio_content_form_section_media()}</h3>
        <p class="card-description">{m.studio_content_form_section_media_desc()}</p>

        <div class="form-fields">
          <div class="form-field">
            <select
              id="mediaItemId"
              name="mediaItemId"
              class="field-input field-select"
            >
              <option value="">— Select media —</option>
              {#each mediaItems as item}
                <option
                  value={item.id}
                  selected={item.id === (content?.mediaItemId ?? '')}
                >
                  [{item.mediaType}] {item.title}
                  {#if item.durationSeconds}({formatDuration(item.durationSeconds)}){/if}
                  {#if item.fileSizeBytes} — {formatFileSize(item.fileSizeBytes)}{/if}
                </option>
              {/each}
            </select>
            {#if mediaItems.length === 0}
              <span class="field-hint">{m.studio_content_form_media_hint()}</span>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <!-- Article Content Section (written only) -->
    {#if currentContentType === 'written'}
      <section class="form-card">
        <h3 class="card-title">{m.studio_content_form_section_body()}</h3>
        <p class="card-description">{m.studio_content_form_section_body_desc()}</p>

        <div class="form-fields">
          <div class="form-field">
            <textarea
              id="contentBody"
              name="contentBody"
              class="field-input field-textarea"
              placeholder={m.studio_content_form_body_placeholder()}
              rows="12"
              required
            >{content?.contentBody ?? ''}</textarea>
          </div>
        </div>
      </section>
    {/if}

    <!-- Publishing Section -->
    <section class="form-card">
      <h3 class="card-title">{m.studio_content_form_section_publishing()}</h3>

      <div class="form-fields">
        <div class="form-field">
          <label class="field-label" for="visibility">
            {m.studio_content_form_visibility_label()}
          </label>
          <select
            id="visibility"
            name="visibility"
            class="field-input field-select"
            value={content?.visibility ?? 'public'}
            onchange={handleVisibilityChange}
          >
            <option value="public">{m.studio_content_form_visibility_public()}</option>
            <option value="private">{m.studio_content_form_visibility_private()}</option>
            <option value="members_only">{m.studio_content_form_visibility_members_only()}</option>
            <option value="purchased_only">{m.studio_content_form_visibility_purchased_only()}</option>
          </select>
          <span class="field-hint">
            {visibilityDescriptions[currentVisibility]?.() ?? ''}
          </span>
        </div>

        <div class="form-field">
          <label class="field-label" for="price">
            {m.studio_content_form_price_label()}
          </label>
          <div class="price-wrapper">
            <span class="price-prefix">£</span>
            <input
              type="number"
              id="price"
              name="price"
              class="field-input price-input"
              value={content?.priceCents ? (content.priceCents / 100).toFixed(2) : '0.00'}
              min="0"
              step="0.01"
              placeholder={m.studio_content_form_price_placeholder()}
            />
          </div>
          <span class="field-hint">{m.studio_content_form_price_help()}</span>
        </div>
      </div>
    </section>

    <!-- Form Actions -->
    <div class="form-actions">
      <button
        type="submit"
        class="btn btn-primary"
        disabled={(isEdit ? updateContentForm : createContentForm).pending > 0 || deleting}
      >
        {#if (isEdit ? updateContentForm : createContentForm).pending > 0}
          {m.studio_content_form_submitting()}
        {:else if isEdit}
          {m.studio_content_form_submit_update()}
        {:else}
          {m.studio_content_form_submit_create()}
        {/if}
      </button>

      {#if isEdit}
        <button
          type="button"
          class="btn btn-destructive"
          disabled={deleting || (isEdit ? updateContentForm : createContentForm).pending > 0}
          onclick={() => (showDeleteConfirm = true)}
        >
          {m.studio_content_form_delete()}
        </button>
      {/if}
    </div>
  </form>
</div>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title={m.studio_content_form_delete_confirm_title()}
  description={m.studio_content_form_delete_confirm_description()}
  confirmText={m.studio_content_form_delete()}
  cancelText={m.common_cancel()}
  variant="destructive"
  onConfirm={handleDelete}
/>

<style>
  .content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 640px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .back-link:hover {
    color: var(--color-text);
  }

  .content-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Card sections — matches settings page pattern */
  .form-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: calc(-1 * var(--space-2)) 0 var(--space-4) 0;
  }

  .form-fields {
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
    font-family: inherit;
  }

  .field-input:focus {
    outline: 2px solid var(--color-primary-500);
    outline-offset: -1px;
    border-color: var(--color-primary-500);
  }

  .field-textarea {
    resize: vertical;
    min-height: calc(var(--space-8) * 2);
  }

  .field-select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    padding-right: var(--space-8);
    cursor: pointer;
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .slug-preview {
    font-family: var(--font-mono, monospace);
  }

  /* Price input with £ prefix */
  .price-wrapper {
    display: flex;
    align-items: stretch;
  }

  .price-prefix {
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-raised, var(--color-surface));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-right: none;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  .price-input {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  /* Form actions */
  .form-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
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
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  .btn-primary:focus-visible {
    outline: var(--border-width-thick, 2px) solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .btn-destructive {
    background-color: var(--color-error-500);
    color: var(--color-text-inverse);
  }

  .btn-destructive:hover:not(:disabled) {
    background-color: var(--color-error-600);
  }

  .btn-destructive:focus-visible {
    outline: var(--border-width-thick, 2px) solid var(--color-error-500);
    outline-offset: 2px;
  }

  /* Success/error messages */
  .success-message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    color: var(--color-success-700);
    font-size: var(--text-sm);
  }

  .error-message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-title,
  :global([data-theme='dark']) .card-title,
  :global([data-theme='dark']) .field-label {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .form-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .field-input {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .price-prefix {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-secondary-dark, var(--color-text-muted));
  }

  :global([data-theme='dark']) .success-message {
    background-color: var(--color-success-900);
    border-color: var(--color-success-700);
    color: var(--color-success-100);
  }

  :global([data-theme='dark']) .error-message {
    background-color: var(--color-error-900);
    border-color: var(--color-error-700);
    color: var(--color-error-100);
  }
</style>
