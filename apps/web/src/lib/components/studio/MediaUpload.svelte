<!--
  @component MediaUpload

  Drag-and-drop upload zone with multi-file queue support and per-file progress tracking.
  Upload flow: createMedia -> PUT to presigned URL -> completeUpload.

  @prop {(media: { id: string }) => void} [onUploadComplete] - Callback when a single upload finishes
-->
<script lang="ts">
  import { createMedia, completeUpload, uploadMedia } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import { UploadIcon, XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface UploadItem {
    file: File;
    id: string | null;
    progress: number;
    status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
    error: string | null;
  }

  interface Props {
    onUploadComplete?: (media: { id: string }) => void;
  }

  const { onUploadComplete }: Props = $props();

  let queue: UploadItem[] = $state([]);
  let isDragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const hasItems = $derived(queue.length > 0);
  const activeUploads = $derived(
    queue.filter((item) => item.status === 'uploading' || item.status === 'completing')
  );

  /**
   * Accepted MIME types for media uploads
   */
  const ACCEPTED_TYPES = [
    // MIME types
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    // File extensions (some browsers need these instead of MIME types)
    '.mp4',
    '.mov',
    '.avi',
    '.webm',
    '.mp3',
    '.m4a',
    '.wav',
    '.ogg',
  ];

  /**
   * Max concurrent uploads
   */
  const MAX_CONCURRENT = 2;

  /**
   * Determine media type from MIME type
   */
  function getMediaType(mimeType: string): 'video' | 'audio' {
    return mimeType.startsWith('video/') ? 'video' : 'audio';
  }

  /**
   * Validate a file is an accepted type
   */
  function isValidFile(file: File): boolean {
    return ACCEPTED_TYPES.includes(file.type);
  }

  /**
   * Add files to the upload queue and start processing
   */
  function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(isValidFile);

    for (const file of validFiles) {
      queue.push({
        file,
        id: null,
        progress: 0,
        status: 'queued',
        error: null,
      });
    }

    processQueue();
  }

  /**
   * Process queued uploads up to MAX_CONCURRENT
   */
  function processQueue() {
    const pending = queue.filter((item) => item.status === 'queued');
    const slotsAvailable = MAX_CONCURRENT - activeUploads.length;

    for (let i = 0; i < Math.min(slotsAvailable, pending.length); i++) {
      uploadFile(pending[i]);
    }
  }

  /**
   * Upload a single file: createMedia → PUT to presigned URL → completeUpload
   */
  async function uploadFile(item: UploadItem) {
    item.status = 'uploading';
    item.progress = 0;

    try {
      // Step 1: Create media item — server generates r2Key and returns presigned upload URL
      const result = await createMedia({
        title: item.file.name.replace(/\.[^/.]+$/, ''),
        mediaType: getMediaType(item.file.type),
        mimeType: item.file.type,
        fileSizeBytes: item.file.size,
      });

      // API client unwraps { data: T } → T, so result IS the MediaItem
      const mediaId = result.id;
      const presignedUrl = result.presignedUrl;
      item.id = mediaId;

      // Step 2: PUT file directly to R2 via presigned URL with progress tracking.
      // Falls back to worker upload if presigned URL fails (e.g. CORS in local dev
      // where R2 creds exist but browser can't reach the real R2 endpoint).
      if (presignedUrl) {
        try {
          await uploadToR2(item, presignedUrl);
        } catch (error) {
          logger.warn('Presigned URL upload failed, falling back to worker upload', {
            error: error instanceof Error ? error.message : String(error),
          });
          await uploadViaWorker(item, mediaId);
        }
      } else {
        await uploadViaWorker(item, mediaId);
      }

      // Step 3: Mark upload complete and trigger transcoding
      item.status = 'completing';
      await completeUpload(mediaId);

      item.status = 'done';
      item.progress = 100;
      onUploadComplete?.({ id: mediaId });
    } catch (error) {
      item.status = 'error';
      item.error =
        error instanceof Error ? error.message : 'Upload failed';
    }

    // Process next in queue
    processQueue();
  }

  /**
   * PUT file directly to R2 via presigned URL with XHR progress tracking
   */
  function uploadToR2(item: UploadItem, presignedUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          item.progress = Math.round((e.loaded / e.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', item.file.type);
      xhr.send(item.file);
    });
  }

  /**
   * Fallback: upload file directly to content-api → R2 binding via XHR.
   * Used when presigned URLs are unavailable or fail (CORS in local dev).
   * Cannot use command() because File objects aren't serializable.
   */
  async function uploadViaWorker(item: UploadItem, mediaId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          item.progress = Math.round((e.loaded / e.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Worker upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during worker upload'));
      // POST binary body to content-api binaryUploadProcedure endpoint
      xhr.open('POST', `/api/media/${mediaId}/upload`);
      xhr.setRequestHeader('Content-Type', item.file.type);
      xhr.withCredentials = true;
      xhr.send(item.file);
    });
  }

  /**
   * Remove an item from the queue
   */
  function removeItem(index: number) {
    queue.splice(index, 1);
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
    if (e.dataTransfer?.files) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      addFiles(target.files);
      target.value = '';
    }
  }

  function handleBrowseClick() {
    fileInput?.click();
  }
</script>

<div class="upload-section">
  <h2 class="upload-heading">{m.media_upload_title()}</h2>

  <!-- Drop Zone -->
  <div
    class="drop-zone"
    class:dragging={isDragging}
    role="button"
    tabindex="0"
    aria-label={m.media_upload_title()}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onclick={handleBrowseClick}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBrowseClick(); }}}
  >
    <UploadIcon size={40} stroke-width="1.5" class="upload-icon" />

    <p class="drop-text">
      {m.media_upload_drop()}
      <span class="browse-link">{m.media_upload_browse()}</span>
    </p>
    <p class="drop-hint">{m.media_upload_hint()}</p>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept={ACCEPTED_TYPES.join(',')}
    multiple
    class="file-input"
    onchange={handleFileSelect}
    tabindex="-1"
    aria-hidden="true"
  />

  <!-- Upload Queue -->
  {#if hasItems}
    <div class="queue" role="list" aria-label={m.media_upload_queued({ count: String(queue.length) })}>
      {#each queue as item, index (item.file.name + index)}
        <div class="queue-item" role="listitem">
          <div class="queue-item-info">
            <span class="queue-item-name">{item.file.name}</span>
            <span class="queue-item-status" data-status={item.status}>
              {#if item.status === 'queued'}
                Queued
              {:else if item.status === 'uploading'}
                {item.progress}%
              {:else if item.status === 'completing'}
                {m.media_status_processing()}
              {:else if item.status === 'done'}
                {m.media_status_uploaded()}
              {:else if item.status === 'error'}
                {item.error ?? m.media_status_failed()}
              {/if}
            </span>
          </div>

          {#if item.status === 'uploading' || item.status === 'completing'}
            <div class="progress-bar" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
              <div class="progress-fill" style="width: {item.progress}%"></div>
            </div>
          {/if}

          {#if item.status === 'done' || item.status === 'error'}
            <button
              class="queue-item-remove"
              aria-label="Remove"
              onclick={() => removeItem(index)}
            >
              <XIcon size={14} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .upload-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .upload-heading {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4);
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
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

  .drop-zone:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .upload-icon {
    color: var(--color-text-secondary);
  }

  .drop-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    text-align: center;
  }

  .browse-link {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
    text-decoration: underline;
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

  /* Queue */
  .queue {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .queue-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    position: relative;
  }

  .queue-item-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .queue-item-name {
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .queue-item-status {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    flex-shrink: 0;
  }

  .queue-item-status[data-status='queued'] {
    color: var(--color-text-muted);
  }

  .queue-item-status[data-status='uploading'],
  .queue-item-status[data-status='completing'] {
    color: var(--color-interactive);
  }

  .queue-item-status[data-status='done'] {
    color: var(--color-success-700);
  }

  .queue-item-status[data-status='error'] {
    color: var(--color-error-700);
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background-color: var(--color-neutral-100);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    border-radius: var(--radius-full);
    transition: width 0.2s ease;
  }

  .queue-item-remove {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .queue-item-remove:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  /* Dark mode */
  :global([data-theme='dark']) .upload-heading {
    color: var(--color-text-dark);
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

  :global([data-theme='dark']) .drop-text {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .queue-item {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .queue-item-name {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .progress-bar {
    background-color: var(--color-neutral-800);
  }
</style>
