<!--
  @component UploadTray

  The studio's upload tray (Codex-a6ofh.1.2; mockup media.html M4b). Mounted
  in both studio layouts, so it stays on screen, and the uploads keep going,
  while the creator moves between studio pages. Everything it shows comes from
  the `uploadQueue` store; nothing here starts or owns a transfer.

  Each row: an editable title, the file size, and what is happening now: the
  % with time left, "Finishing upload" (the client's own last step, not to be
  confused with transcoding), or, once the bytes are up, the next steps and
  the item's real state. That state is live only where the media page has the
  status socket open (Processing, Ready or Failed); anywhere else the row says
  "Uploaded", which stays true. The tray never opens a socket of its own.
-->
<script lang="ts">
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { uploadQueue, type UploadItem } from '$lib/client/upload-queue.svelte';
  import { Button } from '$lib/components/ui';
  import {
    AlertTriangleIcon,
    CheckIcon,
    RefreshCwIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import { formatFileSize } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import { newContentHref } from './library-url';
  import { rejectionReason } from './tile-copy';

  const items = $derived(uploadQueue.items);
  const rejections = $derived(uploadQueue.rejections);
  const counts = $derived(uploadQueue.counts);
  const visible = $derived(items.length > 0 || rejections.length > 0);

  /** A finished upload's state: live where the media page's socket knows it. */
  function uploadedState(item: UploadItem): 'processing' | 'ready' | 'failed' | 'uploaded' {
    const lifecycle = item.id ? mediaStatus.items.get(item.id)?.lifecycle : undefined;
    if (lifecycle === 'ready') return 'ready';
    if (lifecycle === 'failed') return 'failed';
    if (lifecycle === 'uploaded' || lifecycle === 'transcoding') return 'processing';
    return 'uploaded';
  }

  const UPLOADED_LABEL = {
    processing: () => m.media_tray_processing(),
    ready: () => m.media_status_ready(),
    failed: () => m.media_status_failed(),
    uploaded: () => m.media_status_uploaded(),
  } as const;

  function timeLeft(item: UploadItem): string | null {
    const seconds = uploadQueue.secondsLeft(item);
    if (seconds === null) return null;
    if (seconds < 60) return m.media_tray_time_left_soon();
    return m.media_tray_time_left_minutes({ count: String(Math.ceil(seconds / 60)) });
  }

  function commitTitle(item: UploadItem, input: HTMLInputElement) {
    uploadQueue.rename(item.key, input.value);
    // A blank or unchanged title is ignored: show the one the row keeps.
    input.value = item.title;
  }

  function handleTitleKey(item: UploadItem, event: KeyboardEvent) {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      input.value = item.title;
      input.blur();
    }
  }
</script>

{#if visible}
  <aside class="upload-dock" aria-labelledby="upload-tray-title">
    <header class="dock-header">
      <h2 id="upload-tray-title" class="dock-title">{m.media_tray_title()}</h2>
      <!-- Announced as counts change; each row's % is its own progressbar. -->
      <p class="dock-summary" role="status">
        <span class="dock-stat" data-kind="active">{m.media_tray_active({ count: String(counts.active) })}</span>
        <span class="dock-stat" data-kind="done">{m.media_tray_done({ count: String(counts.done) })}</span>
        {#if counts.failed > 0}
          <span class="dock-stat" data-kind="error">{m.media_tray_failed({ count: String(counts.failed) })}</span>
        {/if}
      </p>
      {#if counts.done > 0}
        <button type="button" class="dock-clear" onclick={() => uploadQueue.clearCompleted()}>
          {m.media_tray_clear()}
        </button>
      {/if}
    </header>

    {#if rejections.length > 0}
      <ul class="rejection-list" aria-label={m.media_tray_unsupported()}>
        {#each rejections as rejection (rejection.key)}
          <li class="rejection-item">
            <span class="rejection-icon" aria-hidden="true">
              <AlertTriangleIcon size={14} />
            </span>
            <span class="rejection-text">
              <span class="rejection-name">{rejection.name}</span>
              <span role="alert">{rejectionReason(rejection.name, rejection.reason)}</span>
            </span>
            <button
              type="button"
              class="icon-button"
              aria-label={m.media_tray_dismiss_named({ name: rejection.name })}
              onclick={() => uploadQueue.dismissRejection(rejection.key)}
            >
              <XIcon size={12} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if items.length > 0}
      <ul class="queue" aria-label={m.media_upload_queued({ count: String(items.length) })}>
        {#each items as item (item.key)}
          <li
            class="queue-item"
            data-status={item.status}
            aria-busy={item.status === 'uploading' || item.status === 'completing'}
          >
            <div class="queue-item-row">
              <input
                class="queue-item-title"
                type="text"
                maxlength="255"
                value={item.title}
                aria-label={m.media_tray_rename_label({ name: item.file.name })}
                onblur={(event) => commitTitle(item, event.currentTarget)}
                onkeydown={(event) => handleTitleKey(item, event)}
              />
              {#if item.status === 'queued' || item.status === 'uploading'}
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={m.media_tray_cancel_named({ name: item.title })}
                  onclick={() => uploadQueue.cancel(item.key)}
                >
                  {m.media_tray_cancel()}
                </Button>
              {:else if item.status === 'done' || item.status === 'error'}
                <button
                  type="button"
                  class="icon-button"
                  aria-label={m.media_tray_remove_named({ name: item.title })}
                  onclick={() => uploadQueue.remove(item.key)}
                >
                  <XIcon size={12} />
                </button>
              {/if}
            </div>

            <p class="queue-item-meta">
              <span class="queue-item-size">{formatFileSize(item.file.size)}</span>
              <span class="queue-item-status">
                {#if item.status === 'queued'}
                  {m.media_tray_queued()}
                {:else if item.status === 'uploading'}
                  <span class="queue-item-pct">{item.progress}%</span>
                  {#if timeLeft(item)}<span>· {timeLeft(item)}</span>{/if}
                {:else if item.status === 'completing'}
                  {m.media_tray_finishing()}
                {:else if item.status === 'done'}
                  {@const state = uploadedState(item)}
                  {#if state !== 'failed'}
                    <span class="queue-item-ok" aria-hidden="true"><CheckIcon size={12} /></span>
                  {/if}
                  <span data-uploaded={state}>{UPLOADED_LABEL[state]()}</span>
                {:else}
                  {m.media_status_failed()}
                {/if}
              </span>
            </p>

            {#if item.renameFailed}
              <p class="queue-item-note" role="alert">{m.media_tray_rename_failed()}</p>
            {/if}

            {#if item.status === 'uploading' || item.status === 'completing'}
              <div
                class="progress-bar"
                role="progressbar"
                aria-label={item.title}
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div class="progress-fill" style="width: {item.progress}%"></div>
              </div>
            {/if}

            {#if item.status === 'done' && item.id}
              <div class="queue-item-next">
                <!-- Not for media whose processing failed: nothing could play it. -->
                {#if uploadedState(item) !== 'failed'}
                  <a href={newContentHref({ id: item.id, mediaType: item.mediaType })}>{m.media_tray_create_content()}</a>
                {/if}
                <a href="/studio/media">{m.media_tray_view()}</a>
              </div>
            {/if}

            {#if item.status === 'error'}
              <!-- Its own line: beside the title, it squeezed the title to nothing at 390 px. -->
              <div class="queue-item-error">
                <span role="alert">
                  {item.failure === 'direct' ? m.media_upload_error_direct() : m.media_upload_error()}
                </span>
                <Button
                  size="xs"
                  aria-label={m.media_upload_try_again_named({ name: item.title })}
                  onclick={() => uploadQueue.retry(item.key)}
                >
                  <RefreshCwIcon size={12} />
                  {m.media_tile_try_again()}
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
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
    .progress-fill { transition: none; }
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
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: end;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    justify-self: end;
  }

  .dock-stat {
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
  }

  .dock-stat[data-kind='active'] { color: var(--color-interactive); }
  .dock-stat[data-kind='error'] { color: var(--color-error-700); }

  .dock-clear {
    grid-column: 1 / -1;
    justify-self: end;
    appearance: none;
    border: 0;
    background: transparent;
    padding: var(--space-0-5) var(--space-2);
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
    outline-offset: var(--space-0-5);
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
    align-items: start;
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
    padding-top: var(--space-0-5);
    color: var(--color-error-600);
  }

  .rejection-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .rejection-name {
    font-weight: var(--font-semibold);
    overflow-wrap: anywhere;
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
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  /* Reads as text until focused, then as the field it is. */
  .queue-item-title {
    min-width: 0;
    width: 100%;
    padding: var(--space-0-5) var(--space-1);
    margin-left: calc(-1 * var(--space-1));
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    background: transparent;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-sm);
    text-overflow: ellipsis;
    transition: var(--transition-colors);
  }

  .queue-item-title:hover { border-color: var(--color-border); }
  .queue-item-title:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 0;
    background: var(--color-surface);
  }

  .queue-item-meta {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .queue-item-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: var(--font-medium);
  }

  .queue-item[data-status='uploading'] .queue-item-status,
  .queue-item[data-status='completing'] .queue-item-status {
    color: var(--color-interactive);
  }

  .queue-item[data-status='done'] .queue-item-status { color: var(--color-success-700); }
  .queue-item-status [data-uploaded='failed'] { color: var(--color-error-700); }
  .queue-item[data-status='error'] .queue-item-status { color: var(--color-error-700); }

  .queue-item-pct {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
  }

  .queue-item-ok {
    display: inline-flex;
    align-items: center;
  }

  .queue-item-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-700);
  }

  .queue-item-next {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .queue-item-next a {
    color: var(--color-interactive);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .queue-item-next a:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .queue-item-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-error-700);
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .icon-button:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .icon-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
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
