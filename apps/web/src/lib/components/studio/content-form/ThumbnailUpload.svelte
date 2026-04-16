<!--
  @component ThumbnailUpload

  Content thumbnail with drag-and-drop file upload, media auto-extract, or URL fallback.
  File upload uses native FormData via form() remote function (edit mode only — needs content ID).
  In create mode, only URL input is available.

  @prop {ContentForm} form - The active form instance
  @prop {string | null} [mediaThumbnailUrl] - Auto-extracted thumbnail URL from media
  @prop {string | null} [contentId] - Content ID (required for file upload, null in create mode)
-->
<script lang="ts">
  import { ImageIcon, UploadIcon } from '$lib/components/ui/Icon';
  import { Button } from '$lib/components/ui';
  import { useDropZone } from '$lib/utils/use-drop-zone.svelte';
  import { uploadThumbnailForm, deleteThumbnailCommand } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    mediaThumbnailUrl?: string | null;
    contentId?: string | null;
  }

  const { form, mediaThumbnailUrl = null, contentId = null }: Props = $props();

  let showUrlInput = $state(false);
  let uploading = $state(false);
  let validationError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let uploadFormEl: HTMLFormElement | undefined = $state();

  const thumbnailValue = $derived(form.fields.thumbnailUrl?.value() ?? '');
  const hasCustomThumbnail = $derived(!!thumbnailValue);
  const canUploadFile = $derived(!!contentId);

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_SIZE_BYTES = 10 * 1024 * 1024;

  const dropZone = useDropZone({
    onDrop: (files) => {
      const file = files[0];
      if (file) handleFile(file);
    },
  });

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Thumbnail must be PNG, JPEG, or WebP';
    }
    if (file.size > MAX_SIZE_BYTES) {
      return 'File must be less than 10MB';
    }
    return null;
  }

  function handleFile(file: File) {
    const error = validateFile(file);
    if (error) {
      validationError = error;
      return;
    }
    validationError = null;

    if (fileInput && uploadFormEl) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      uploading = true;
      uploadFormEl.requestSubmit();
    }
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) handleFile(file);
  }

  function handleBrowseClick() {
    fileInput?.click();
  }

  // Watch for upload result
  $effect(() => {
    const result = uploadThumbnailForm.result;
    if (!result) return;

    uploading = false;
    if (result.success && result.thumbnailUrl) {
      form.fields.thumbnailUrl.set(result.thumbnailUrl);
      toast.success('Thumbnail uploaded');
    } else if (!result.success && result.error) {
      toast.error(result.error);
    }
  });

  function useMediaThumbnail() {
    if (mediaThumbnailUrl) {
      form.fields.thumbnailUrl.set(mediaThumbnailUrl);
    }
  }

  async function clearThumbnail() {
    if (contentId && hasCustomThumbnail) {
      try {
        await deleteThumbnailCommand(contentId);
      } catch {
        // Non-critical — clear locally even if server delete fails
      }
    }
    form.fields.thumbnailUrl.set('');
    showUrlInput = false;
  }
</script>

<section class="form-card">
  <h3 class="card-title">Thumbnail <span class="optional-hint">Optional</span></h3>
  <!-- Always submit the thumbnailUrl value -->
  {#if !showUrlInput}
    <input type="hidden" name="thumbnailUrl" value={thumbnailValue} />
  {/if}

  <div class="thumbnail-zone">
    {#if hasCustomThumbnail}
      <!-- Thumbnail preview with change/remove overlay -->
      <div class="thumbnail-preview">
        <img src={thumbnailValue} alt="Content thumbnail" class="thumbnail-image" />
        <div class="thumbnail-overlay">
          {#if canUploadFile}
            <button type="button" class="overlay-btn" onclick={handleBrowseClick}>
              Change
            </button>
          {:else}
            <button type="button" class="overlay-btn" onclick={() => (showUrlInput = true)}>
              Change
            </button>
          {/if}
          <button type="button" class="overlay-btn overlay-btn-danger" onclick={clearThumbnail}>
            Remove
          </button>
        </div>
      </div>
    {:else if canUploadFile}
      <!-- File upload drop zone (edit mode) -->
      <div
        class="drop-zone"
        class:dragging={dropZone.isDragging}
        class:disabled={uploading}
        role="button"
        tabindex="0"
        aria-label="Upload thumbnail"
        ondragover={dropZone.handlers.dragover}
        ondragleave={dropZone.handlers.dragleave}
        ondrop={dropZone.handlers.drop}
        onclick={handleBrowseClick}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleBrowseClick();
          }
        }}
      >
        <UploadIcon size={32} />
        <span class="drop-text">Drop image or click to upload</span>
        <span class="drop-hint">PNG, JPEG, or WebP. Max 10MB.</span>
        <div class="drop-actions">
          {#if mediaThumbnailUrl}
            <Button type="button" variant="secondary" size="sm" onclick={(e: MouseEvent) => { e.stopPropagation(); useMediaThumbnail(); }}>
              Use media thumbnail
            </Button>
          {/if}
          <Button type="button" variant="ghost" size="sm" onclick={(e: MouseEvent) => { e.stopPropagation(); showUrlInput = true; }}>
            Enter URL instead
          </Button>
        </div>
      </div>
    {:else}
      <!-- URL-only placeholder (create mode) -->
      <div class="thumbnail-placeholder">
        <ImageIcon size={32} />
        <span class="placeholder-text">No thumbnail set</span>
        <div class="placeholder-actions">
          {#if mediaThumbnailUrl}
            <Button type="button" variant="primary" size="sm" onclick={useMediaThumbnail}>
              Use media thumbnail
            </Button>
          {/if}
          <Button type="button" variant="ghost" size="sm" onclick={() => (showUrlInput = true)}>
            Enter URL
          </Button>
        </div>
      </div>
    {/if}
  </div>

  {#if showUrlInput}
    <div class="url-input-row">
      <input
        {...form.fields.thumbnailUrl.as('text')}
        id="thumbnailUrl"
        class="field-input"
        placeholder="https://example.com/thumbnail.jpg"
      />
      <Button type="button" variant="primary" size="sm" onclick={() => (showUrlInput = false)}>
        Done
      </Button>
    </div>
  {/if}

  <!-- Uploading indicator -->
  {#if uploading}
    <p class="status-text">Uploading thumbnail...</p>
  {/if}

  <!-- Validation error -->
  {#if validationError}
    <p class="error-text" role="alert">{validationError}</p>
  {/if}

  <!-- Hidden upload form (native FormData for File serialization) -->
  {#if canUploadFile}
    <form
      bind:this={uploadFormEl}
      {...uploadThumbnailForm}
      enctype="multipart/form-data"
      class="hidden-form"
    >
      <input type="hidden" name="contentId" value={contentId} />
      <input
        bind:this={fileInput}
        type="file"
        name="thumbnail"
        accept={ALLOWED_TYPES.join(',')}
        onchange={handleFileSelect}
        tabindex="-1"
        aria-hidden="true"
      />
    </form>
  {/if}
</section>

<style>
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

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    margin-left: var(--space-1);
  }

  .thumbnail-zone {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    position: relative;
  }

  /* ── Preview with overlay ───────────────────────────────────────── */

  .thumbnail-preview {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .thumbnail-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumbnail-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: var(--color-surface-overlay);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-default);
  }

  .thumbnail-preview:hover .thumbnail-overlay {
    opacity: 1;
  }

  .overlay-btn {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) color-mix(in srgb, white 50%, transparent);
    background: color-mix(in srgb, black 40%, transparent);
    color: var(--color-text-inverse);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .overlay-btn:hover {
    background: color-mix(in srgb, black 60%, transparent);
    border-color: var(--color-text-inverse);
  }

  .overlay-btn-danger:hover {
    background: var(--color-error-500);
    border-color: var(--color-error-500);
  }

  /* ── Drop zone (file upload) ────────────────────────────────────── */

  .drop-zone {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width-thick) dashed var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .drop-zone:hover,
  .drop-zone:focus-visible {
    border-color: var(--color-focus);
    background-color: var(--color-interactive-subtle, var(--color-surface-secondary));
  }

  .drop-zone.dragging {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle, var(--color-surface-secondary));
  }

  .drop-zone.disabled {
    opacity: var(--opacity-60);
    pointer-events: none;
  }

  .drop-zone:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .drop-text {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
  }

  .drop-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .drop-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  /* ── Placeholder (create mode, URL-only) ────────────────────────── */

  .thumbnail-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width-thick) dashed var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
  }

  .placeholder-text {
    font-size: var(--text-sm);
  }

  .placeholder-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  /* ── URL input ──────────────────────────────────────────────────── */

  .url-input-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .url-input-row :global(.field-input) {
    flex: 1;
  }

  /* ── Status / errors ────────────────────────────────────────────── */

  .status-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: var(--space-2) 0 0 0;
  }

  .error-text {
    font-size: var(--text-sm);
    color: var(--color-error-700);
    margin: var(--space-2) 0 0 0;
  }

  /* ── Hidden form ────────────────────────────────────────────────── */

  .hidden-form {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .hidden-form input[type="file"] {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
