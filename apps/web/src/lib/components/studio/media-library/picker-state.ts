/**
 * The media picker's two pieces of state logic (Codex-a6ofh.1.8), apart from
 * the dialog so each rule is tested on its own: following an upload the
 * field started, and what the chosen item's status line says.
 */
import type { MediaItemState } from '@codex/validation';
import type { Attachment } from 'svelte/attachments';
import type { UploadItem } from '$lib/client/upload-queue.svelte';
import type { getMediaItem } from '$lib/remote/media.remote';
import { describeTile, type TileMedia, type TileView } from './tile-state';

/**
 * What the picker hands a caller that draws its own field (its `field`
 * snippet): the content editor's media slot draws it at the player's size
 * (Codex-a6ofh.2.3). The picker keeps every rule, the by-id read, the upload
 * it follows, the status watch and the stall clock, so a field drawn
 * elsewhere cannot drift from them.
 */
export interface PickerField {
  /** Give it to the control that opens the dialog: focus returns there on close. */
  readonly triggerId: string;
  /** An upload started here, until it is done. */
  readonly uploading: UploadItem | null;
  /** The chosen item, once read; null with nothing chosen or while it reads. */
  readonly chosen: Awaited<ReturnType<typeof getMediaItem>> | null;
  /** The chosen item's read failed: gone (404), or an outage. */
  readonly chosenFailed: boolean;
  readonly chosenGone: boolean;
  /** The chosen item by the library's rules: a failed or stopped item never reads as processing. */
  readonly view: TileView | null;
  /** Why the last file was not taken here, or null. */
  readonly uploadNote: string | null;
  /** How the watch on a processing item falls back, in the library's words. */
  readonly watchWords: string;
  /** Heard, not shown: the item watched here reached ready. */
  readonly readyWords: string;
  /** The watch paused: offer {@link PickerField.resumeWatch} beside its status. */
  readonly watchPaused: boolean;
  open(): void;
  remove(): void;
  /** Take a file dropped on the field, as the dialog's Upload row does. */
  upload(file: File): void;
  /** Open the file chooser the dialog's Upload row opens: the file goes up the same way. */
  chooseFile(): void;
  reread(): void;
  resumeWatch(): void;
  /** On the element that says the watch's words: Refresh moves focus to it. */
  readonly statusNote: Attachment<HTMLElement>;
  /** On a control that can leave while focused: focus goes to the field's trigger. */
  readonly keepsFocus: Attachment<HTMLElement>;
}

/** An upload this field started, as it moves through the studio's queue. */
export interface Following {
  key: string;
  /** The id the field took from it, once createMedia gave one. */
  id: string | null;
  /** What the field held before: a cancel or a failure puts it back. */
  before: string | null;
  done: boolean;
}

/** The queue row's two fields the follow acts on, read as they are now. */
export interface FollowedRow {
  id: string | null;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
}

/** What the field follows next, and the value it reports (when `report` is present). */
export interface FollowStep {
  following: Following | null;
  report?: string | null;
}

/**
 * One step of following an upload. The field takes the id the moment
 * createMedia returns it (data-design §1.4: the bytes carry on in the tray).
 * A cancel deletes that media row, and a failed attempt's row is deleted on
 * its retry or removal, so either way the field goes back to what it held
 * before; a retry is a new media item, attached again. Nothing changes a
 * value the creator has since replaced with another: a new id is attached
 * only while the field still holds what it held before, or this upload.
 */
export function followUpload(
  followed: Following,
  row: FollowedRow | null,
  value: string | null
): FollowStep {
  const holdsIt = followed.id !== null && value === followed.id;
  if (row === null) {
    // Left the queue: finished, or cancelled or removed (its row deleted).
    if (followed.done || !holdsIt) return { following: null };
    return { following: null, report: followed.before };
  }
  if (row.status === 'error') {
    if (followed.id === null) return { following: followed };
    const following = { ...followed, id: null };
    return holdsIt ? { following, report: followed.before } : { following };
  }
  if (row.id !== null && row.id !== followed.id) {
    // The creator chose something else meanwhile: the upload goes on to the
    // library, and this field stops following it.
    if (value !== followed.before && value !== followed.id) {
      return { following: null };
    }
    return {
      following: { ...followed, id: row.id, done: row.status === 'done' },
      report: row.id,
    };
  }
  if (row.status === 'done' && !followed.done) {
    return { following: { ...followed, done: true } };
  }
  return { following: followed };
}

/**
 * The chosen item's state, by the library's own rules (`describeTile`), so a
 * failed or stopped item reads as it does on its tile, never as processing.
 * The dialog's `now` is a real clock (its one stall timer), so it is also the
 * clock the stall rule reads.
 */
export function chosenView(
  media: TileMedia,
  live: MediaItemState | undefined,
  now: number
): TileView {
  return describeTile(media, live, now, now);
}
