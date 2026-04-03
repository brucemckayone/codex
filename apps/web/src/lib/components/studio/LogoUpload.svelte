<!--
  @component LogoUpload

  Form-based logo upload with drag-and-drop, preview, and delete.
  Uses native FormData submission via form() remote functions so File
  objects are sent correctly (command()/devalue cannot serialize Files).

  Supports PNG, JPEG, WebP, and SVG files up to 5MB.

  @prop {string | null} [logoUrl] - Current logo URL for preview
  @prop {boolean} [loading] - Whether an upload/delete is in progress
  @prop {string} orgId - Organization ID (sent as hidden field)
  @prop {object} uploadFormAttrs - Spread attrs from uploadLogoForm
  @prop {object} deleteFormAttrs - Spread attrs from deleteLogoForm
-->
<script lang="ts">
  import { UploadIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    logoUrl?: string | null;
    loading?: boolean;
    orgId: string;
    uploadFormAttrs: Record<string, unknown>;
    onDelete: () => void;
  }

  const {
    logoUrl = null,
    loading = false,
    orgId,
    uploadFormAttrs,
    onDelete,
  }: Props = $props();

  let isDragging = $state(false);
  let validationError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let uploadFormEl: HTMLFormElement | undefined = $state();

  const ALLOWED_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ];

  const MAX_SIZE_BYTES = 5 * 1024 * 1024;

  const hasLogo = $derived(!!logoUrl);

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Logo must be PNG, JPEG, WebP, or SVG';
    }
    if (file.size > MAX_SIZE_BYTES) {
      return 'File must be less than 5MB';
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

    // Set the file on the hidden input and submit the form
    if (fileInput && uploadFormEl) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      uploadFormEl.requestSubmit();
    }
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleBrowseClick() {
    fileInput?.click();
  }
</script>

<div class="logo-upload">
  {#if hasLogo}
    <!-- Logo Preview -->
    <div class="logo-preview">
      <img
        src={logoUrl}
        alt={m.branding_logo_title()}
        class="logo-image"
      />
    </div>

    <div class="logo-actions">
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={handleBrowseClick}
        disabled={loading}
      >
        {m.branding_logo_upload()}
      </button>
      <button
        type="button"
        class="btn btn-danger btn-sm"
        onclick={onDelete}
        disabled={loading}
      >
        {m.branding_logo_delete()}
      </button>
    </div>
  {:else}
    <!-- Upload Zone -->
    <div
      class="drop-zone"
      class:dragging={isDragging}
      class:disabled={loading}
      role="button"
      tabindex="0"
      aria-label={m.branding_logo_upload()}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      onclick={handleBrowseClick}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleBrowseClick();
        }
      }}
    >
      <UploadIcon size={32} stroke-width="1.5" class="upload-icon" />

      <p class="drop-text">
        {m.branding_logo_upload()}
      </p>
      <p class="drop-hint">PNG, JPEG, WebP, or SVG. Max 5MB.</p>
    </div>
  {/if}

  <!-- Hidden upload form (native FormData for File serialization) -->
  <form
    bind:this={uploadFormEl}
    {...uploadFormAttrs}
    enctype="multipart/form-data"
    class="hidden-form"
  >
    <input type="hidden" name="orgId" value={orgId} />
    <input
      bind:this={fileInput}
      type="file"
      name="logo"
      accept={ALLOWED_TYPES.join(',')}
      onchange={handleFileSelect}
      tabindex="-1"
      aria-hidden="true"
    />
  </form>

  <!-- Loading indicator -->
  {#if loading}
    <p class="status-text">{m.common_loading()}</p>
  {/if}

  <!-- Validation error -->
  {#if validationError}
    <p class="error-text" role="alert">{validationError}</p>
  {/if}
</div>

<style>
  .logo-upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .logo-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 160px;
    height: 160px;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    overflow: hidden;
  }

  .logo-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .logo-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    max-width: 320px;
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
    opacity: 0.6;
    pointer-events: none;
  }

  .drop-zone:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .upload-icon {
    color: var(--color-text-secondary);
  }

  .drop-text {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    margin: 0;
    text-align: center;
  }

  .drop-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
  }

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

  .status-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .error-text {
    font-size: var(--text-sm);
    color: var(--color-error-700);
    margin: 0;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    border: var(--border-width) var(--border-style) transparent;
    text-decoration: none;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-sm {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }

  .btn-outline {
    background-color: transparent;
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .btn-outline:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  .btn-danger {
    background-color: transparent;
    border-color: var(--color-error-300);
    color: var(--color-error-700);
  }

  .btn-danger:hover:not(:disabled) {
    background-color: var(--color-error-50, rgba(239, 68, 68, 0.05));
  }

  /* Dark mode */
  :global([data-theme='dark']) .logo-preview {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .drop-zone {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .drop-zone:hover,
  :global([data-theme='dark']) .drop-zone:focus-visible,
  :global([data-theme='dark']) .drop-zone.dragging {
    border-color: var(--color-focus);
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .upload-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .btn-outline {
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .btn-outline:hover:not(:disabled) {
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .btn-danger {
    border-color: var(--color-error-400);
    color: var(--color-error-400);
  }

  :global([data-theme='dark']) .error-text {
    color: var(--color-error-400);
  }
</style>
