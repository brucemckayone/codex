<!--
  @component MediaSlot

  The Write canvas's player (Codex-a6ofh.2.3, mockups W2/W3): the media field
  drawn at the size and place of the public page's player. Empty, it is the
  drop zone: "Choose from library" or a file, uploaded or dropped, whose id
  is attached the moment its media row exists while the bytes carry on in the
  upload tray. Chosen, it shows the item as it is: uploading or preparing
  (writing carries on), ready to play, failed, or gone.

  Every rule is the shared picker's (`MediaPickerDialog`'s `field`): the read
  by id, the upload it follows, the status watch and the stall clock. This
  only draws them. Each state has an element with the field's trigger id,
  so focus has somewhere to go when the control that held it goes.

  @prop {'video' | 'audio'} mediaType - The content's type: what the slot takes
  @prop {string | null} value - The chosen media id
  @prop {(mediaId: string | null) => void} onchange - The creator chose, removed, or an upload got its id
  @prop {(pending: boolean, failed: boolean) => void} [onpending] - A file here has no media row yet, so nothing else would attach it; failed once a file here ended without its media: its upload failed, or it was cancelled before it had a row
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { uploadQueue } from '$lib/client/upload-queue.svelte';
  import { Button } from '$lib/components/ui';
  import { ArrowLeftRightIcon, FilmIcon, MusicIcon, UploadIcon, XIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import MediaPickerDialog from '../media-library/MediaPickerDialog.svelte';
  import MediaPreviewPlayer from '../media-library/MediaPreviewPlayer.svelte';
  import MediaStatusPill from '../media-library/MediaStatusPill.svelte';
  import type { PickerField } from '../media-library/picker-state';
  import { tileReason } from '../media-library/tile-copy';
  import { tilePill } from '../media-library/tile-state';

  interface Props {
    mediaType: 'video' | 'audio';
    value: string | null;
    onchange: (mediaId: string | null) => void;
    onpending?: (pending: boolean, failed: boolean) => void;
  }

  const { mediaType, value, onchange, onpending }: Props = $props();

  /**
   * The canvas column's width: 58rem once the screen holds it, else the
   * viewport less the studio rail and the gutters. Plain lengths only: a
   * `min()` here reads as 100vw on older Safari.
   */
  const POSTER_SIZES = '(min-width: 68rem) 58rem, (min-width: 64rem) calc(100vw - 10rem), calc(100vw - 2rem)';

  const ADD = { video: m.studio_editor_media_add_video, audio: m.studio_editor_media_add_audio };
  const PREPARING = { video: m.studio_editor_media_preparing_video, audio: m.studio_editor_media_preparing_audio };

  let dragging = $state(false);

  /**
   * Says while a file here waits for its media row (the queue runs two at a
   * time), and when a file here ended without its media: an upload that
   * failed, with or without its row (the picker undoes the attach either
   * way), or one cancelled before it had a row, which then never comes.
   */
  function reportsPending(field: PickerField): Attachment<HTMLElement> {
    /** The rowless upload this slot was waiting on, until it has its row. */
    let waitingOn: string | null = null;
    return () => {
      const row = field.uploading;
      const failed = row !== null && row.status === 'error';
      const pending = row !== null && row.id === null && !failed;
      // Gone before its row came: cancelled (a failure stays, saying so).
      const cancelled = row === null && waitingOn !== null;
      waitingOn = pending ? row.key : null;
      onpending?.(pending, failed || cancelled);
      return () => onpending?.(false, false);
    };
  }

  /** The stage takes a dropped file as the dialog's Upload row would. */
  function dropTarget(field: PickerField): Attachment<HTMLElement> {
    return (node) => {
      const over = (event: DragEvent) => {
        event.preventDefault();
        dragging = true;
      };
      const leave = (event: DragEvent) => {
        if (!(event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) dragging = false;
      };
      const drop = (event: DragEvent) => {
        event.preventDefault();
        dragging = false;
        const file = event.dataTransfer?.files[0];
        if (file) field.upload(file);
      };
      node.addEventListener('dragover', over);
      node.addEventListener('dragleave', leave);
      node.addEventListener('drop', drop);
      return () => {
        node.removeEventListener('dragover', over);
        node.removeEventListener('dragleave', leave);
        node.removeEventListener('drop', drop);
        dragging = false;
      };
    };
  }
</script>

<MediaPickerDialog
  {value}
  {onchange}
  mediaTypes={[mediaType]}
  allowProcessing
  ariaLabel={ADD[mediaType]()}
  field={stage}
/>

{#snippet stage(field: PickerField)}
  <div class="slot-wrap">
    <div
      class="slot"
      data-type={mediaType}
      data-empty={(value === null && !field.uploading) || undefined}
      data-dragging={dragging || undefined}
      {@attach dropTarget(field)}
      {@attach reportsPending(field)}
    >
      {#if field.uploading}
        {@const row = field.uploading}
        {#if row.status === 'error'}
          <div class="slot-message" role="alert">
            <p class="slot-heading" id={field.triggerId} tabindex="-1" {@attach field.keepsFocus}>{row.title}</p>
            <p>{row.failure === 'direct' ? m.media_upload_error_direct() : m.media_upload_error()}</p>
            <div class="slot-actions">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={m.media_upload_try_again_named({ name: row.title })}
                onclick={() => uploadQueue.retry(row.key)}
                {@attach field.keepsFocus}
              >
                {m.common_try_again()}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={m.media_picker_upload_discard_named({ name: row.title })}
                onclick={() => uploadQueue.remove(row.key)}
                {@attach field.keepsFocus}
              >
                {m.media_picker_upload_discard()}
              </Button>
            </div>
          </div>
        {:else}
          <div class="slot-veil">
            {#if row.status !== 'queued'}<p class="slot-pct">{row.progress}%</p>{/if}
            <p role="status" id={field.triggerId} tabindex="-1" {@attach field.keepsFocus}>
              {row.status === 'queued' ? m.media_picker_upload_waiting() : m.studio_editor_media_uploading({ name: row.title })}
            </p>
          </div>
          {#if row.status !== 'queued'}
            <span class="slot-bar" aria-hidden="true"><span style:inline-size="{row.progress}%"></span></span>
          {/if}
          {#if row.status === 'queued' || row.status === 'uploading'}
            <div class="slot-chips">
              <button
                type="button"
                class="slot-chip"
                aria-label={m.media_tray_cancel_named({ name: row.title })}
                onclick={() => uploadQueue.cancel(row.key)}
                {@attach field.keepsFocus}
              >
                <XIcon size={14} />
                {m.media_tray_cancel()}
              </button>
            </div>
          {/if}
        {/if}
      {:else if value !== null}
        {#if field.chosenFailed}
          <div class="slot-message" role="alert">
            <p
              class="slot-heading"
              id={field.chosenGone ? undefined : field.triggerId}
              tabindex="-1"
              {@attach field.keepsFocus}
            >
              {field.chosenGone ? m.media_picker_chosen_gone() : m.media_picker_chosen_failed()}
            </p>
            <div class="slot-actions">
              {#if field.chosenGone}
                <Button id={field.triggerId} type="button" size="sm" onclick={field.open}>
                  {m.studio_editor_media_choose_another()}
                </Button>
              {:else}
                <Button type="button" size="sm" variant="secondary" onclick={field.reread} {@attach field.keepsFocus}>
                  {m.common_try_again()}
                </Button>
              {/if}
            </div>
          </div>
        {:else if field.chosen && field.view}
          {@const item = field.chosen}
          {@const view = field.view}
          {#if view.kind === 'ready'}
            <MediaPreviewPlayer
              mediaId={item.id}
              {mediaType}
              title={item.title}
              poster={item.thumbnailUrl ?? null}
              sizes={POSTER_SIZES}
            />
          {:else if view.kind === 'failed' || view.kind === 'stopped'}
            <div class="slot-message" role="alert">
              <p class="slot-heading">{item.title}</p>
              <p><MediaStatusPill pill={tilePill(view)} /> {tileReason(view)}</p>
              <div class="slot-actions">
                <Button id={field.triggerId} type="button" size="sm" onclick={field.open}>
                  {m.studio_editor_media_choose_another()}
                </Button>
              </div>
            </div>
          {:else}
            {#if item.thumbnailUrl}
              <img
                class="slot-poster"
                src={item.thumbnailUrl}
                srcset={getThumbnailSrcset(item.thumbnailUrl) || undefined}
                sizes={POSTER_SIZES}
                alt=""
              />
            {/if}
            <div class="slot-veil">
              {#if (view.kind === 'processing' || view.kind === 'uploading') && view.pct !== null}
                <p class="slot-pct">{view.pct}%</p>
              {/if}
              <p>{PREPARING[mediaType]()}</p>
              <MediaStatusPill pill={tilePill(view)} />
            </div>
          {/if}
          <div class="slot-chips">
            {#if view.kind !== 'failed' && view.kind !== 'stopped'}
              <button
                id={field.triggerId}
                type="button"
                class="slot-chip"
                aria-label={m.media_picker_change_named({ name: item.title })}
                onclick={field.open}
              >
                <ArrowLeftRightIcon size={14} />
                {m.media_picker_change()}
              </button>
            {/if}
            <button
              type="button"
              class="slot-chip"
              aria-label={m.media_tray_remove_named({ name: item.title })}
              onclick={field.remove}
              {@attach field.keepsFocus}
            >
              <XIcon size={14} />
            </button>
          </div>
        {:else}
          <!-- Focus lands here from Attach while the item is read, and moves on when it has been. -->
          <div class="slot-loading" id={field.triggerId} tabindex="-1" {@attach field.keepsFocus}>
            <span class="sr-only">{m.studio_editor_media_loading()}</span>
            <Skeleton width="100%" height="100%" />
          </div>
        {/if}
      {:else}
        <div class="slot-empty">
          <span class="slot-icon" aria-hidden="true">
            {#if mediaType === 'video'}<FilmIcon size={32} />{:else}<MusicIcon size={32} />{/if}
          </span>
          <p class="slot-heading">{dragging ? m.studio_editor_media_drop() : ADD[mediaType]()}</p>
          <p class="slot-hint">{m.studio_editor_media_hint()}</p>
          <div class="slot-actions">
            <Button id={field.triggerId} type="button" size="sm" onclick={field.open}>
              {m.studio_editor_media_choose()}
            </Button>
            <Button type="button" size="sm" variant="secondary" onclick={field.chooseFile} {@attach field.keepsFocus}>
              <UploadIcon size={16} />
              {m.studio_editor_media_upload()}
            </Button>
          </div>
        </div>
      {/if}
    </div>

    {#if field.uploadNote}
      <p class="slot-note" role="alert">{field.uploadNote}</p>
    {/if}
    <!-- Mounted while anything is chosen, so a change of words is announced
         and a focused status outlives its item reaching ready. -->
    {#if value !== null}
      <p class="slot-watch">
        <span role="status" tabindex="-1" {@attach field.statusNote}
          >{field.watchWords}<span class="sr-only">{field.readyWords}</span></span
        >
        {#if field.watchPaused}
          <Button type="button" size="xs" variant="ghost" onclick={field.resumeWatch} {@attach field.keepsFocus}>
            {m.media_live_resume()}
          </Button>
        {/if}
      </p>
    {/if}
  </div>
{/snippet}

<style>
  .slot-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The public page's player box (ContentDetailView `.content-detail__player`). */
  .slot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-tertiary);
  }

  .slot[data-type='audio'] {
    aspect-ratio: auto;
    min-height: var(--space-32);
  }

  .slot > :global(.preview) {
    width: 100%;
    height: 100%;
  }

  .slot[data-empty] {
    border: var(--border-width-thick) dashed var(--color-border-strong);
    background: var(--color-surface-secondary);
    transition: var(--transition-colors);
  }

  .slot[data-dragging] {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .slot-empty,
  .slot-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    text-align: center;
    color: var(--color-text-secondary);
  }

  .slot-empty p,
  .slot-message p {
    margin: 0;
  }

  .slot-icon {
    color: var(--color-interactive);
  }

  .slot-heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .slot-hint {
    font-size: var(--text-sm);
  }

  .slot-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .slot-loading {
    position: absolute;
    inset: 0;
  }

  .slot-poster {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Over the video, the player's own colours: legible on any poster. */
  .slot-veil {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-player-text);
    background: var(--color-player-overlay);
  }

  .slot-veil p {
    margin: 0;
  }

  .slot-pct {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
  }

  .slot-bar {
    position: absolute;
    inset-inline: var(--space-2);
    inset-block-end: var(--space-2);
    block-size: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-player-surface);
    overflow: hidden;
  }

  .slot-bar span {
    display: block;
    block-size: 100%;
    background: var(--color-player-text);
    transition: inline-size var(--duration-normal) var(--ease-default);
  }

  .slot-chips {
    position: absolute;
    inset-block-start: var(--space-3);
    inset-inline-end: var(--space-3);
    display: flex;
    gap: var(--space-2);
  }

  .slot-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: var(--space-8);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-player-border);
    border-radius: var(--radius-md);
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .slot-chip:hover {
    background: var(--color-player-surface-hover);
  }

  .slot-chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .slot-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-error-700);
  }

  .slot-watch {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
