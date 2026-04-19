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
  import { useDropZone } from '$lib/utils/use-drop-zone.svelte';
  import * as m from '$paraglide/messages';

  interface UploadItem {
    file: File;
    id: string | null;
    progress: number;
    status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
    error: string | null;
  }

  interface Rejection {
    name: string;
    reason: string;
  }

  interface Props {
    onUploadComplete?: (media: { id: string }) => void;
  }

  const { onUploadComplete }: Props = $props();

  let queue: UploadItem[] = $state([]);
  let rejections: Rejection[] = $state([]);

  const dropZone = useDropZone({
    onDrop: (files) => addFiles(files),
  });

  const hasItems = $derived(queue.length > 0);
  const hasRejections = $derived(rejections.length > 0);
  const activeUploads = $derived(
    queue.filter((item) => item.status === 'uploading' || item.status === 'completing')
  );
  const activeCount = $derived(activeUploads.length);

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
   * Add files to the upload queue and start processing.
   * Invalid files are recorded in `rejections` so the live region announces them.
   */
  function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    const newRejections: Rejection[] = [];

    for (const file of fileArray) {
      if (!isValidFile(file)) {
        newRejections.push({
          name: file.name,
          reason: m.media_upload_rejected_type({ name: file.name }),
        });
        continue;
      }
      queue.push({
        file,
        id: null,
        progress: 0,
        status: 'queued',
        error: null,
      });
    }

    if (newRejections.length > 0) {
      rejections = [...rejections, ...newRejections];
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
      // Never echo provider/network errors — they may contain presigned URL
      // fragments, internal paths, or other leakage. Surface a generic i18n
      // message to the user; log the full error via ObservabilityClient.
      logger.error('Media upload failed', {
        error: error instanceof Error ? error.message : String(error),
        mediaId: item.id,
        fileName: item.file.name,
      });
      item.error = m.media_upload_error();
    }

    // Process next in queue
    processQueue();
  }

  /**
   * Generic XHR upload with progress tracking.
   * Both presigned-URL and worker-fallback paths use this.
   */
  function xhrUpload(opts: {
    url: string;
    method: 'PUT' | 'POST';
    file: File;
    onProgress: (percent: number) => void;
    withCredentials?: boolean;
    errorPrefix?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`${opts.errorPrefix ?? 'Upload'} failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error(`Network error during ${opts.errorPrefix?.toLowerCase() ?? 'upload'}`));
      xhr.open(opts.method, opts.url);
      xhr.setRequestHeader('Content-Type', opts.file.type);
      if (opts.withCredentials) xhr.withCredentials = true;
      xhr.send(opts.file);
    });
  }

  /**
   * PUT file directly to R2 via presigned URL with XHR progress tracking
   */
  function uploadToR2(item: UploadItem, presignedUrl: string): Promise<void> {
    return xhrUpload({
      url: presignedUrl,
      method: 'PUT',
      file: item.file,
      onProgress: (percent) => { item.progress = percent; },
      errorPrefix: 'Upload',
    });
  }

  /**
   * Fallback: upload file directly to content-api -> R2 binding via XHR.
   * Used when presigned URLs are unavailable or fail (CORS in local dev).
   * Cannot use command() because File objects aren't serializable.
   */
  function uploadViaWorker(item: UploadItem, mediaId: string): Promise<void> {
    return xhrUpload({
      url: `/api/media/${mediaId}/upload`,
      method: 'POST',
      file: item.file,
      onProgress: (percent) => { item.progress = percent; },
      withCredentials: true,
      errorPrefix: 'Worker upload',
    });
  }

  /**
   * Remove an item from the queue
   */
  function removeItem(index: number) {
    queue.splice(index, 1);
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      addFiles(target.files);
      target.value = '';
    }
  }

  function dismissRejection(index: number) {
    rejections.splice(index, 1);
  }
</script>

<div class="upload-section">
  <h2 class="upload-heading">{m.media_upload_title()}</h2>

  <!-- Drop Zone — label wraps hidden file input so keyboard / AT users reach the native file picker -->
  <label
    class="drop-zone"
    class:dragging={dropZone.isDragging}
    for="media-file-input"
    ondragover={dropZone.handlers.dragover}
    ondragleave={dropZone.handlers.dragleave}
    ondrop={dropZone.handlers.drop}
  >
    <UploadIcon size={40} stroke-width="1.5" class="upload-icon" />

    <span class="drop-text">
      {m.media_upload_drop()}
      <span class="browse-link">{m.media_upload_browse()}</span>
    </span>
    <span class="drop-hint">{m.media_upload_hint()}</span>

    <input
      id="media-file-input"
      type="file"
      accept={ACCEPTED_TYPES.join(',')}
      multiple
      class="sr-only"
      onchange={handleFileInputChange}
    />
  </label>

  <!-- Upload Queue + rejections share a single polite live region so AT users
       hear queue mutations, per-item progress, completions, and rejections. -->
  <div
    class="upload-queue"
    role="status"
    aria-live="polite"
    aria-busy={activeCount > 0}
  >
    {#if hasRejections}
      <ul class="rejection-list" aria-label="Rejected files">
        {#each rejections as rejection, index (rejection.name + index)}
          <li class="rejection-item">
            <span role="alert">{rejection.reason}</span>
            <button
              type="button"
              class="rejection-dismiss"
              aria-label={`Dismiss rejection for ${rejection.name}`}
              onclick={() => dismissRejection(index)}
            >
              <XIcon size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if hasItems}
      <div class="queue" role="list" aria-label={m.media_upload_queued({ count: String(queue.length) })}>
        {#each queue as item, index (item.file.name + index)}
          <div
            class="queue-item"
            role="listitem"
            aria-busy={item.status === 'uploading' || item.status === 'completing'}
          >
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
                  <span role="alert">{item.error ?? m.media_status_failed()}</span>
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
                type="button"
                class="queue-item-remove"
                aria-label={`Remove ${item.file.name}`}
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
    border: var(--border-width-thick) var(--border-style-dashed) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .drop-zone:hover {
    border-color: var(--color-focus);
    background-color: var(--color-interactive-subtle);
  }

  .drop-zone.dragging {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
  }

  /* :focus-within surfaces the label's native focus-visible state when the
     hidden file input inside receives keyboard focus (Tab). */
  .drop-zone:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-color: var(--color-focus);
    background-color: var(--color-interactive-subtle);
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

  /* Queue + rejection live region */
  .upload-queue {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .rejection-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .rejection-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  .rejection-item > span {
    flex: 1;
    min-width: 0;
  }

  .rejection-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    background: none;
    color: var(--color-error-600);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .rejection-dismiss:hover {
    background-color: var(--color-error-100);
  }

  .rejection-dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

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
    height: var(--space-1);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    border-radius: var(--radius-full);
    transition: width var(--duration-normal) var(--ease-default);
  }

  .queue-item-remove {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
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

  .queue-item-remove:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

</style>
