<!--
  @component LogoUpload

  Drag-and-drop logo upload zone with preview, delete, and client-side validation.
  Supports PNG, JPEG, WebP, and SVG files up to 5MB.

  @prop {string | null} [logoUrl] - Current logo URL for preview
  @prop {boolean} [loading] - Whether an upload/delete is in progress
  @prop {(file: File) => void} onUpload - Callback when a valid file is selected
  @prop {() => void} onDelete - Callback to delete the current logo
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    logoUrl?: string | null;
    loading?: boolean;
    onUpload: (file: File) => void;
    onDelete: () => void;
  }

  const { logoUrl = null, loading = false, onUpload, onDelete }: Props = $props();

  let isDragging = $state(false);
  let validationError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  /**
   * Allowed MIME types for logo uploads
   */
  const ALLOWED_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ];

  /**
   * Maximum file size: 5MB
   */
  const MAX_SIZE_BYTES = 5 * 1024 * 1024;

  const hasLogo = $derived(!!logoUrl);

  /**
   * Validate a file against MIME type and size constraints
   */
  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Logo must be PNG, JPEG, WebP, or SVG';
    }
    if (file.size > MAX_SIZE_BYTES) {
      return 'File must be less than 5MB';
    }
    return null;
  }

  /**
   * Handle file selection from input or drop
   */
  function handleFile(file: File) {
    const error = validateFile(file);
    if (error) {
      validationError = error;
      return;
    }
    validationError = null;
    onUpload(file);
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
    target.value = '';
  }

  function handleBrowseClick() {
    fileInput?.click();
  }

  function handleDeleteClick() {
    validationError = null;
    onDelete();
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
        onclick={handleDeleteClick}
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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="upload-icon"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>

      <p class="drop-text">
        {m.branding_logo_upload()}
      </p>
      <p class="drop-hint">PNG, JPEG, WebP, or SVG. Max 5MB.</p>
    </div>
  {/if}

  <!-- Hidden file input -->
  <input
    bind:this={fileInput}
    type="file"
    accept={ALLOWED_TYPES.join(',')}
    class="file-input"
    onchange={handleFileSelect}
    tabindex="-1"
    aria-hidden="true"
  />

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
    border-color: var(--color-primary-400);
    background-color: var(--color-primary-50, var(--color-surface-secondary));
  }

  .drop-zone.dragging {
    border-color: var(--color-primary-500);
    background-color: var(--color-primary-50, var(--color-surface-secondary));
  }

  .drop-zone.disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .drop-zone:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .upload-icon {
    color: var(--color-text-secondary);
  }

  .drop-text {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-primary-500);
    margin: 0;
    text-align: center;
  }

  .drop-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
  }

  .file-input {
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
    border-color: var(--color-primary-400);
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
