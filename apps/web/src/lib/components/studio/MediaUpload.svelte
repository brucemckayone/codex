<!--
  @component MediaUpload

  Upload presentation layer for the Studio media library. All flow logic
  (createMedia → PUT presigned → completeUpload, fallback worker upload,
  XHR progress, MAX_CONCURRENT queue) is preserved verbatim from the
  previous drop-zone implementation — only the presentation has changed.

  New presentation:
  - A full-page drop overlay appears when the user drags files from the OS
    anywhere over the window, replacing the permanent drop-zone block.
  - Queue + rejections render in a floating dock (bottom-right) when any
    item is active/queued/errored so the page body stays clear for the
    library grid underneath.
  - Parent components can read `uploadingItems` (reactive) to render ghost
    tiles inline, and call `triggerPicker()` to open the file picker from
    a separate command-bar button.

  @prop onUploadComplete  Invoked when a single upload finishes (parent
                          can call invalidateAll() to refresh the grid).
  @prop uploadingItems    Bindable — read by parent to interleave ghosts
                          into the grid. Contains every queue item until
                          it finishes or is dismissed.
  @prop triggerPicker     Bindable — parent sets a ref and calls it to
                          open the native file picker.
-->
<script lang="ts">
  import { createMedia, completeUpload } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import { UploadIcon, XIcon, CheckIcon, AlertTriangleIcon } from '$lib/components/ui/Icon';
  import { browser } from '$app/environment';
  import * as m from '$paraglide/messages';

  export interface UploadItem {
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
    /** Bindable read-only — parent reads to render ghost tiles in-grid */
    uploadingItems?: UploadItem[];
    /** Bindable — parent assigns a handle, invokes to open file picker */
    triggerPicker?: (() => void) | null;
  }

  let {
    onUploadComplete,
    uploadingItems = $bindable([]),
    triggerPicker = $bindable(null),
  }: Props = $props();

  let queue: UploadItem[] = $state([]);
  let rejections: Rejection[] = $state([]);
  let isWindowDragging = $state(false);
  let dragDepth = 0; // robust enter/leave tracking across child nodes
  let fileInput: HTMLInputElement | null = $state(null);

  // Keep parent binding in sync without exposing internal queue ref directly.
  // Use a shallow copy so reactivity fires whenever items mutate.
  $effect(() => {
    uploadingItems = queue.slice();
  });

  // Wire the picker handle so the parent command bar can trigger it.
  // Set once on mount — the function closes over fileInput via ref binding.
  $effect(() => {
    if (triggerPicker) return;
    triggerPicker = () => fileInput?.click();
  });

  const hasItems = $derived(queue.length > 0);
  const hasRejections = $derived(rejections.length > 0);
  const hasDockContent = $derived(hasItems || hasRejections);
  const activeUploads = $derived(
    queue.filter((item) => item.status === 'uploading' || item.status === 'completing')
  );
  const activeCount = $derived(activeUploads.length);
  const doneCount = $derived(queue.filter((i) => i.status === 'done').length);
  const errorCount = $derived(queue.filter((i) => i.status === 'error').length);

  // TODO i18n
  //   studio_media_dock_title = "Upload queue"
  //   studio_media_dock_summary = "{active} active · {done} done · {errored} errored"
  //   studio_media_dock_clear = "Clear completed"
  //   studio_media_drop_hero = "Drop to upload"
  //   studio_media_drop_sub = "Video or audio · up to 5 GB each"
  const dockTitle = 'Upload queue';
  const dockClearLabel = 'Clear completed';
  const dropHero = 'Drop to upload';
  const dropSub = 'Video or audio · up to 5 GB each';

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

  function clearCompleted() {
    queue = queue.filter((i) => i.status !== 'done');
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

  // ─── Global drag overlay ─────────────────────────────────────────────────
  // Use window-level drag events so the drop target is the whole viewport.
  // Track depth to avoid flicker when entering child elements.

  function containsFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // DataTransferItemList.types contains 'Files' when files are being dragged
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function handleWindowDragEnter(e: DragEvent) {
    if (!containsFiles(e)) return;
    dragDepth++;
    isWindowDragging = true;
  }

  function handleWindowDragOver(e: DragEvent) {
    if (!containsFiles(e)) return;
    // preventDefault enables drop on the window; otherwise browser navigates
    e.preventDefault();
  }

  function handleWindowDragLeave(e: DragEvent) {
    if (!containsFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isWindowDragging = false;
  }

  function handleWindowDrop(e: DragEvent) {
    if (!containsFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    isWindowDragging = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }
</script>

<svelte:window
  ondragenter={handleWindowDragEnter}
  ondragover={handleWindowDragOver}
  ondragleave={handleWindowDragLeave}
  ondrop={handleWindowDrop}
/>

<!-- Hidden file input — surfaced via parent's Upload button OR OS drop -->
<input
  bind:this={fileInput}
  id="media-file-input"
  type="file"
  accept={ACCEPTED_TYPES.join(',')}
  multiple
  class="sr-only"
  onchange={handleFileInputChange}
/>

<!-- Full-viewport drop overlay — visible only while the OS reports a file drag -->
{#if browser && isWindowDragging}
  <div class="drop-overlay" role="presentation" aria-hidden="true">
    <div class="drop-overlay-panel">
      <span class="drop-overlay-icon">
        <UploadIcon size={44} stroke-width="1.5" />
      </span>
      <p class="drop-overlay-hero">{dropHero}</p>
      <p class="drop-overlay-sub">{dropSub}</p>
    </div>
  </div>
{/if}

<!-- Floating dock — visible whenever queue or rejections are present -->
{#if hasDockContent}
  <aside
    class="upload-dock"
    role="status"
    aria-live="polite"
    aria-busy={activeCount > 0}
    aria-label={dockTitle}
  >
    <header class="dock-header">
      <h3 class="dock-title">{dockTitle}</h3>
      <p class="dock-summary">
        <span class="dock-stat" data-kind="active">
          <span class="dock-stat-num">{activeCount}</span>
          <span class="dock-stat-label">active</span>
        </span>
        <span class="dock-stat" data-kind="done">
          <span class="dock-stat-num">{doneCount}</span>
          <span class="dock-stat-label">done</span>
        </span>
        {#if errorCount > 0}
          <span class="dock-stat" data-kind="error">
            <span class="dock-stat-num">{errorCount}</span>
            <span class="dock-stat-label">errored</span>
          </span>
        {/if}
      </p>
      {#if doneCount > 0}
        <button type="button" class="dock-clear" onclick={clearCompleted}>
          {dockClearLabel}
        </button>
      {/if}
    </header>

    {#if hasRejections}
      <ul class="rejection-list" aria-label="Rejected files">
        {#each rejections as rejection, index (rejection.name + index)}
          <li class="rejection-item">
            <span class="rejection-icon" aria-hidden="true">
              <AlertTriangleIcon size={14} />
            </span>
            <span role="alert">{rejection.reason}</span>
            <button
              type="button"
              class="rejection-dismiss"
              aria-label={`Dismiss rejection for ${rejection.name}`}
              onclick={() => dismissRejection(index)}
            >
              <XIcon size={12} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if hasItems}
      <ul class="queue" aria-label={m.media_upload_queued({ count: String(queue.length) })}>
        {#each queue as item, index (item.file.name + index)}
          <li
            class="queue-item"
            aria-busy={item.status === 'uploading' || item.status === 'completing'}
            data-status={item.status}
          >
            <div class="queue-item-row">
              <span class="queue-item-name" title={item.file.name}>{item.file.name}</span>
              <span class="queue-item-status">
                {#if item.status === 'queued'}
                  queued
                {:else if item.status === 'uploading'}
                  <span class="queue-item-pct">{item.progress}%</span>
                {:else if item.status === 'completing'}
                  {m.media_status_processing()}
                {:else if item.status === 'done'}
                  <span class="queue-item-ok" aria-hidden="true"><CheckIcon size={12} /></span>
                  <span>{m.media_status_uploaded()}</span>
                {:else if item.status === 'error'}
                  <span role="alert">{item.error ?? m.media_status_failed()}</span>
                {/if}
              </span>
              {#if item.status === 'done' || item.status === 'error'}
                <button
                  type="button"
                  class="queue-item-remove"
                  aria-label={`Remove ${item.file.name}`}
                  onclick={() => removeItem(index)}
                >
                  <XIcon size={12} />
                </button>
              {/if}
            </div>

            {#if item.status === 'uploading' || item.status === 'completing'}
              <div
                class="progress-bar"
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div class="progress-fill" style="width: {item.progress}%"></div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  /* ── Full-viewport drop overlay ───────────────────────── */
  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: color-mix(in srgb, var(--color-interactive) 18%, transparent);
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
    pointer-events: none;
    animation: drop-overlay-in var(--duration-fast) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-overlay { animation: none; }
  }

  @keyframes drop-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .drop-overlay-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-xl, var(--radius-lg));
    background: color-mix(in srgb, var(--color-surface) 94%, transparent);
    border: var(--border-width-thick) var(--border-style-dashed, dashed)
      var(--color-interactive);
    box-shadow:
      0 var(--space-4) var(--space-12) color-mix(in srgb, var(--color-text) 18%, transparent);
    max-width: min(32rem, 80vw);
    text-align: center;
  }

  .drop-overlay-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-interactive-subtle);
    color: var(--color-interactive);
  }

  .drop-overlay-hero {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .drop-overlay-sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Floating dock ────────────────────────────────────── */
  .upload-dock {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: var(--z-sticky);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(24rem, calc(100vw - var(--space-8)));
    max-height: min(60vh, 32rem);
    overflow: hidden auto;
    padding: var(--space-3);
    background: color-mix(in srgb, var(--color-surface) 94%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow:
      0 var(--space-3) var(--space-10) color-mix(in srgb, var(--color-text) 14%, transparent);
    animation: dock-in var(--duration-normal) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .upload-dock { animation: none; }
  }

  @keyframes dock-in {
    from { opacity: 0; transform: translateY(var(--space-2)); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (--below-sm) {
    .upload-dock {
      right: var(--space-2);
      left: var(--space-2);
      width: auto;
      bottom: var(--space-2);
    }
  }

  .dock-header {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .dock-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .dock-summary {
    margin: 0;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    justify-self: end;
  }

  .dock-stat {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-0-5);
  }

  .dock-stat-num {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .dock-stat[data-kind='active'] .dock-stat-num { color: var(--color-interactive); }
  .dock-stat[data-kind='error']  .dock-stat-num { color: var(--color-error-700); }

  .dock-stat-label {
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .dock-clear {
    grid-column: 1 / -1;
    justify-self: end;
    appearance: none;
    border: 0;
    background: transparent;
    padding: 2px var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .dock-clear:hover { color: var(--color-text); background: var(--color-surface-secondary); }
  .dock-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* ── Rejections ───────────────────────────────────────── */
  .rejection-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rejection-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    color: var(--color-error-700);
    font-size: var(--text-xs);
  }

  .rejection-icon {
    display: inline-flex;
    color: var(--color-error-600);
  }

  .rejection-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border: none;
    background: none;
    color: var(--color-error-600);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .rejection-dismiss:hover { background-color: var(--color-error-100); }
  .rejection-dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 1px;
  }

  /* ── Queue ────────────────────────────────────────────── */
  .queue {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .queue-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    background: var(--color-surface);
  }

  .queue-item[data-status='uploading'],
  .queue-item[data-status='completing'] {
    border-color: color-mix(in srgb, var(--color-interactive) 30%, transparent);
    background: color-mix(in srgb, var(--color-interactive-subtle) 60%, var(--color-surface));
  }

  .queue-item[data-status='done'] {
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .queue-item[data-status='error'] {
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
    background: var(--color-error-50);
  }

  .queue-item-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-2);
  }

  .queue-item-name {
    font-size: var(--text-xs);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .queue-item-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    white-space: nowrap;
  }

  .queue-item[data-status='uploading'] .queue-item-status,
  .queue-item[data-status='completing'] .queue-item-status {
    color: var(--color-interactive);
  }

  .queue-item[data-status='done'] .queue-item-status { color: var(--color-success-700); }
  .queue-item[data-status='error'] .queue-item-status {
    color: var(--color-error-700);
    text-transform: none;
    letter-spacing: normal;
  }

  .queue-item-pct {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
  }

  .queue-item-ok {
    display: inline-flex;
    align-items: center;
    color: var(--color-success-700);
  }

  .queue-item-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .queue-item-remove:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .queue-item-remove:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 1px;
  }

  .progress-bar {
    width: 100%;
    height: var(--space-1);
    background-color: color-mix(in srgb, var(--color-text) 8%, transparent);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    border-radius: var(--radius-full, 9999px);
    transition: width var(--duration-normal) var(--ease-default);
  }
</style>
