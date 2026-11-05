/**
 * The studio's upload queue (Codex-a6ofh.1.2), as one module store.
 *
 * It used to live inside MediaUpload.svelte, so leaving the media page, or a
 * background `invalidate()` that swapped in +error.svelte, unmounted every
 * running upload. Here the queue outlives any page: the tray in both studio
 * layouts draws it, the media page reads it for its ghost tiles, and the
 * transfers carry on while the creator moves around the studio.
 *
 * The flow is the one MediaUpload ran, two at a time: createMedia, then a
 * presigned PUT straight to R2 (falling back through the worker for files the
 * worker can take), then completeUpload with the runtime measured here. New:
 * a stable row key, an editable title, cancel, and a time-left estimate.
 *
 * The STORE owns the beforeunload guard, not a component: the tray unmounts
 * when the creator leaves the studio, but the uploads do not stop.
 *
 * Every collaborator is injected, so `upload-queue.svelte.test.ts` drives the
 * whole flow with fakes; {@link uploadQueue} is the one wired to the real ones.
 */
import { FILE_SIZES } from '@codex/constants';
import { mediaStatus } from '$lib/client/media-status.svelte';
import { registerUserScopedReset } from '$lib/client/user-scoped-state';
import { checkMediaFile } from '$lib/components/studio/media-upload-file';
import { logger } from '$lib/observability';
import { guardUnload } from '$lib/page-builder/autosave.svelte';
import {
  completeUpload,
  createMedia,
  deleteMedia,
  getMediaUsage,
  updateMedia,
} from '$lib/remote/media.remote';
import { readFreshQuery } from '$lib/remote/query-result';
import { measureMediaDuration } from '$lib/utils/media-duration';

export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'error';

/** Why a row failed; the tray words it. `direct`: the file is too big to retry through the worker. */
export type UploadFailure = 'upload' | 'direct';

export interface UploadItem {
  /** Stable for the row's life: the tray and the media grid key on it. */
  readonly key: string;
  readonly file: File;
  /** The platform's MIME type for it, which may not be `file.type`. */
  readonly mimeType: string;
  readonly mediaType: 'video' | 'audio';
  /** Editable while it uploads; it becomes the media item's title. */
  title: string;
  id: string | null;
  progress: number;
  status: UploadStatus;
  failure: UploadFailure | null;
  /** The last rename was refused, and the title went back to the saved one. */
  renameFailed: boolean;
  /** When the bytes started going up, for {@link UploadQueue.secondsLeft}. */
  startedAt: number | null;
}

interface UploadRejection {
  readonly key: string;
  readonly name: string;
  readonly reason: 'type' | 'empty' | 'too_large';
}

/** One transfer of the file's bytes; `done` rejects with {@link UploadCancelled} after `abort()`. */
export interface UploadTransfer {
  done: Promise<void>;
  abort: () => void;
}

export interface UploadRequest {
  url: string;
  method: 'PUT' | 'POST';
  file: File;
  /** The type createMedia was given: a presigned PUT is signed for it. */
  mimeType: string;
  withCredentials?: boolean;
  /** Names the transfer in its error: 'Upload' or 'Worker upload'. */
  label: string;
  onProgress: (percent: number) => void;
}

export interface UploadQueueDeps {
  createMedia: (input: {
    title: string;
    mediaType: 'video' | 'audio';
    mimeType: string;
    fileSizeBytes: number;
  }) => Promise<{ id: string; presignedUrl: string | null }>;
  completeUpload: (input: {
    id: string;
    durationSeconds?: number;
  }) => Promise<unknown>;
  deleteMedia: (input: { id: string; usage?: string }) => Promise<unknown>;
  /** The item's usage fingerprint, read fresh: a delete sends it back. */
  readUsage: (id: string) => Promise<{ fingerprint: string }>;
  renameMedia: (id: string, title: string) => Promise<unknown>;
  send: (request: UploadRequest) => UploadTransfer;
  measureDuration: (file: File) => Promise<number | null>;
  live: {
    beginUpload: (mediaId: string) => void;
    reportUpload: (mediaId: string, pct: number) => void;
    endUpload: (mediaId: string) => void;
  };
  guard: (shouldBlock: () => boolean) => () => void;
  now: () => number;
  makeKey: () => string;
}

/** The transfer was aborted by {@link UploadQueue.cancel}; not a failure. */
export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelled';
  }
}

const MAX_CONCURRENT = 2;

/** `media_items.title` is 1-255 characters (updateMediaItemSchema). */
const TITLE_MAX = 255;

/** A file's default title: its name without the extension. */
export function titleFromFileName(name: string): string {
  const bare = name.replace(/\.[^/.]+$/, '').trim();
  return (bare || name).slice(0, TITLE_MAX);
}

/**
 * Seconds left at the rate so far, or null while there is too little to go
 * on (under 3% or 2 seconds in): an early guess swings by minutes.
 */
export function estimateSecondsLeft(
  startedAt: number | null,
  now: number,
  percent: number
): number | null {
  if (startedAt === null || percent < 3 || percent >= 100) return null;
  const elapsed = (now - startedAt) / 1000;
  if (elapsed < 2) return null;
  return Math.round((elapsed * (100 - percent)) / percent);
}

const PENDING: ReadonlySet<UploadStatus> = new Set([
  'queued',
  'uploading',
  'completing',
]);

export class UploadQueue {
  items = $state<UploadItem[]>([]);
  rejections = $state<UploadRejection[]>([]);

  readonly #deps: UploadQueueDeps;
  /** The running transfer for each row key, so cancel can abort it. */
  readonly #transfers = new Map<string, UploadTransfer>();
  /** Rows cancelled while their createMedia or transfer was still running. */
  readonly #cancelled = new Set<string>();
  /** Each row's title saves, run one after another so the last one wins. */
  readonly #titleSaves = new Map<string, Promise<void>>();
  /** The title the server last confirmed for each row: what a refused rename goes back to. */
  readonly #savedTitles = new Map<string, string>();
  readonly #listeners = new Set<(mediaId: string) => void>();
  /**
   * Rows whose upload has not settled, including one cancelled while its
   * createMedia ran: that row has left the tray, but its media row is still
   * being made and then deleted, so closing the tab must still be guarded.
   */
  readonly #running = new Set<string>();
  /**
   * Deletes of let-go media rows still on their way (a usage read, then the
   * delete): closing the tab now would leave the row behind, so the guard holds.
   */
  readonly #discarding = new Set<Promise<void>>();
  /** Bumped by {@link reset}: an upload begun before it belongs to the last user. */
  #generation = 0;
  #releaseGuard: (() => void) | null = null;

  constructor(deps: UploadQueueDeps) {
    this.#deps = deps;
  }

  /** Anything still to finish: closing the tab now would lose it. */
  get pending(): boolean {
    return (
      this.#running.size > 0 ||
      this.#discarding.size > 0 ||
      this.items.some((item) => PENDING.has(item.status))
    );
  }

  get counts(): { active: number; done: number; failed: number } {
    let active = 0;
    let done = 0;
    let failed = 0;
    for (const item of this.items) {
      if (item.status === 'done') done++;
      else if (item.status === 'error') failed++;
      else active++;
    }
    return { active, done, failed };
  }

  /** Seconds left for `item`'s transfer, read against the clock now. */
  secondsLeft(item: UploadItem): number | null {
    if (item.status !== 'uploading') return null;
    return estimateSecondsLeft(item.startedAt, this.#deps.now(), item.progress);
  }

  /** Called with the media id each time an upload finishes. */
  onComplete(listener: (mediaId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * A different user signed in on this tab: the rows were the last user's.
   * Running transfers are aborted and the queue is emptied. Their half-made
   * media rows are left for the hourly check to fail: deleting them now would
   * run as the new user, who does not own them.
   */
  reset(): void {
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'uploading') {
        this.#cancelled.add(item.key);
        this.#transfers.get(item.key)?.abort();
      }
    }
    this.#generation++;
    this.items = [];
    this.rejections = [];
    this.#savedTitles.clear();
    this.#titleSaves.clear();
    this.#syncGuard();
  }

  /**
   * Queue the files the platform takes; the rest become rejections. Returns
   * the queued rows' keys, so a caller can follow its own upload (the media
   * picker attaches the id the moment createMedia returns it).
   */
  add(files: FileList | File[]): string[] {
    const queued: string[] = [];
    for (const file of Array.from(files)) {
      const check = checkMediaFile(file);
      if (check.ok === false) {
        this.rejections.push({
          key: this.#deps.makeKey(),
          name: file.name,
          reason: check.reason,
        });
        continue;
      }
      const key = this.#deps.makeKey();
      queued.push(key);
      this.items.push({
        key,
        file,
        mimeType: check.mimeType,
        mediaType: check.mediaType,
        title: titleFromFileName(file.name),
        id: null,
        progress: 0,
        status: 'queued',
        failure: null,
        renameFailed: false,
        startedAt: null,
      });
    }
    this.#syncGuard();
    this.#process();
    return queued;
  }

  /**
   * Stop a row. A queued one just leaves. An uploading one has its transfer
   * aborted and its half-made media row deleted, as Try again already does.
   * Not offered while completing: completeUpload is already under way.
   */
  cancel(key: string): void {
    const item = this.#find(key);
    if (!item || (item.status !== 'queued' && item.status !== 'uploading')) {
      return;
    }
    if (item.status === 'uploading') {
      this.#cancelled.add(key);
      this.#transfers.get(key)?.abort();
      if (item.id) {
        this.#deps.live.endUpload(item.id);
        this.#discard(item.id);
      }
    }
    this.#drop(key);
    this.#syncGuard();
    this.#process();
  }

  /** Try a failed row again, as a new media item; the failed attempt's row is deleted. */
  retry(key: string): void {
    const item = this.#find(key);
    if (!item || item.status !== 'error') return;
    const failedAttempt = item.id;
    item.id = null;
    item.progress = 0;
    item.failure = null;
    item.startedAt = null;
    item.status = 'queued';
    this.#discard(failedAttempt);
    this.#syncGuard();
    this.#process();
  }

  /** Let go of a finished or failed row; a failed one's media row is deleted. */
  remove(key: string): void {
    const item = this.#find(key);
    if (!item || (item.status !== 'done' && item.status !== 'error')) return;
    if (item.status === 'error') this.#discard(item.id);
    this.#drop(key);
    // A discard just begun holds the unload guard until its delete lands.
    this.#syncGuard();
  }

  clearCompleted(): void {
    for (const item of this.items) {
      if (item.status === 'done') this.#savedTitles.delete(item.key);
    }
    this.items = this.items.filter((item) => item.status !== 'done');
  }

  dismissRejection(key: string): void {
    this.rejections = this.rejections.filter((r) => r.key !== key);
  }

  /**
   * Retitle a row. Before it has a media id, the new title simply goes into
   * createMedia (or, if createMedia is already under way, is sent once it
   * returns). After that it is saved with updateMedia; a refused save puts the
   * last saved title back and says so.
   */
  rename(key: string, title: string): void {
    const item = this.#find(key);
    if (!item) return;
    const next = title.trim().slice(0, TITLE_MAX);
    if (!next || next === item.title) return;
    item.title = next;
    item.renameFailed = false;
    // A failed row is created again on retry, with this title.
    if (item.id && item.status !== 'error') this.#saveTitle(item);
  }

  #find(key: string): UploadItem | undefined {
    return this.items.find((item) => item.key === key);
  }

  #drop(key: string): void {
    this.#savedTitles.delete(key);
    this.items = this.items.filter((item) => item.key !== key);
  }

  #process(): void {
    const running = this.items.filter(
      (item) => item.status === 'uploading' || item.status === 'completing'
    ).length;
    const waiting = this.items.filter((item) => item.status === 'queued');
    for (const item of waiting.slice(
      0,
      Math.max(0, MAX_CONCURRENT - running)
    )) {
      void this.#upload(item);
    }
  }

  async #upload(item: UploadItem): Promise<void> {
    this.#running.add(item.key);
    const generation = this.#generation;
    item.status = 'uploading';
    item.progress = 0;
    item.startedAt = null;
    // Set when a direct upload failed for a file the fallback cannot take.
    let directFailed = false;
    let completedId: string | null = null;

    try {
      const sentTitle = item.title;
      const created = await this.#deps.createMedia({
        title: sentTitle,
        mediaType: item.mediaType,
        mimeType: item.mimeType,
        fileSizeBytes: item.file.size,
      });
      if (this.#cancelled.has(item.key)) {
        // Cancelled while createMedia ran: its row is already out of the
        // tray. The guard holds (#running) until the media row is gone,
        // unless the user changed (reset): the new one cannot delete it.
        if (generation === this.#generation) await this.#discard(created.id);
        return;
      }
      item.id = created.id;
      this.#savedTitles.set(item.key, sentTitle);
      // Shown here as its ghost tile: no list refetch for it.
      this.#deps.live.beginUpload(created.id);
      // Renamed while createMedia ran: save what the creator typed.
      if (item.title !== sentTitle) this.#saveTitle(item);

      item.startedAt = this.#deps.now();
      // Falls back to the worker if the presigned PUT fails (e.g. CORS in
      // local dev, where R2 creds exist but the browser can't reach R2).
      if (created.presignedUrl) {
        try {
          await this.#send(item, {
            url: created.presignedUrl,
            method: 'PUT',
            label: 'Upload',
          });
        } catch (error) {
          if (error instanceof UploadCancelled) throw error;
          if (item.file.size > FILE_SIZES.WORKER_UPLOAD_MAX_BYTES) {
            directFailed = true;
            throw error;
          }
          logger.warn(
            'Presigned URL upload failed, falling back to worker upload',
            { error: error instanceof Error ? error.message : String(error) }
          );
          await this.#sendViaWorker(item, created.id);
        }
      } else if (item.file.size > FILE_SIZES.WORKER_UPLOAD_MAX_BYTES) {
        directFailed = true;
        throw new Error(
          'No direct upload URL, and the file is too large for the worker'
        );
      } else {
        await this.#sendViaWorker(item, created.id);
      }

      // The runtime is measured HERE, on the client, because
      // `media_items.duration_seconds` is otherwise written only by the
      // RunPod completion webhook, so it stayed NULL while the creator built
      // the page right after uploading. `measureDuration` never rejects; it
      // returns null when it cannot tell.
      if (this.#cancelled.has(item.key)) throw new UploadCancelled();
      item.status = 'completing';
      this.#deps.live.endUpload(created.id);
      const durationSeconds = await this.#deps.measureDuration(item.file);
      await this.#deps.completeUpload({
        id: created.id,
        ...(durationSeconds ? { durationSeconds } : {}),
      });

      item.status = 'done';
      item.progress = 100;
      completedId = created.id;
    } catch (error) {
      if (item.id) this.#deps.live.endUpload(item.id);
      // Only a cancel the creator made is quiet. Any other abort (the browser
      // dropping the request) is a failure, or the row would sit in
      // 'uploading' for good, holding a slot and the unload guard.
      if (this.#cancelled.has(item.key)) return;
      item.status = 'error';
      item.failure = directFailed ? 'direct' : 'upload';
      // Never shown to the creator: provider and network errors can carry
      // presigned URL fragments. The tray words `failure` instead.
      logger.error('Media upload failed', {
        error: error instanceof Error ? error.message : String(error),
        mediaId: item.id,
        fileName: item.file.name,
        fileSizeBytes: item.file.size,
        directFailed,
      });
    } finally {
      this.#cancelled.delete(item.key);
      this.#running.delete(item.key);
      this.#syncGuard();
      this.#process();
    }
    // Outside the try: a listener that throws must not turn an upload that
    // finished into a failure, whose Try again would delete the good row.
    if (completedId) this.#notifyComplete(completedId);
  }

  #notifyComplete(mediaId: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(mediaId);
      } catch (error) {
        logger.error('Media upload: a completion listener threw', {
          mediaId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #send(
    item: UploadItem,
    target: Pick<UploadRequest, 'url' | 'method' | 'withCredentials' | 'label'>
  ): Promise<void> {
    // A cancel that landed between two transfers (the presigned PUT failing
    // as the creator pressed Cancel) must not start the fallback.
    if (this.#cancelled.has(item.key)) {
      return Promise.reject(new UploadCancelled());
    }
    const transfer = this.#deps.send({
      ...target,
      file: item.file,
      mimeType: item.mimeType,
      onProgress: (percent) => this.#progress(item, percent),
    });
    this.#transfers.set(item.key, transfer);
    return transfer.done.finally(() => {
      if (this.#transfers.get(item.key) === transfer) {
        this.#transfers.delete(item.key);
      }
    });
  }

  /**
   * The fallback: straight to content-api, which writes through its R2
   * binding. A command() can't carry a File, hence the plain request.
   */
  #sendViaWorker(item: UploadItem, mediaId: string): Promise<void> {
    item.startedAt = this.#deps.now();
    return this.#send(item, {
      url: `/api/media/${mediaId}/upload`,
      method: 'POST',
      withCredentials: true,
      label: 'Worker upload',
    });
  }

  /**
   * Shown here, and on the creator's other tabs and devices through the live
   * status socket (Codex-l2c48.7), which throttles the reports.
   */
  #progress(item: UploadItem, percent: number): void {
    item.progress = percent;
    if (item.id) this.#deps.live.reportUpload(item.id, percent);
  }

  /**
   * Save the row's CURRENT title, after any save already out for it. A save
   * reads the title when it runs, so renames in quick succession collapse into
   * one request for the latest; a title the server already has is skipped.
   */
  #saveTitle(item: UploadItem): void {
    const key = item.key;
    const save = async () => {
      const id = item.id;
      const title = item.title;
      const saved = this.#savedTitles.get(key);
      if (!id || title === saved) return;
      try {
        await this.#deps.renameMedia(id, title);
        // Only for the row and media item it was sent for: a Try again since
        // then made a new media item, and a removed row keeps nothing.
        if (item.id === id && this.#find(key))
          this.#savedTitles.set(key, title);
      } catch (error) {
        logger.warn('Media upload: rename refused', {
          mediaId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Back to what the server has, unless a newer rename replaced it or
        // the save was for a media item this row no longer points at.
        if (
          item.id === id &&
          item.title === title &&
          saved !== undefined &&
          this.#find(key)
        ) {
          item.title = saved;
          item.renameFailed = true;
        }
      }
    };
    const chain = (this.#titleSaves.get(key) ?? Promise.resolve()).then(save);
    this.#titleSaves.set(key, chain);
    void chain.finally(() => {
      if (this.#titleSaves.get(key) === chain) this.#titleSaves.delete(key);
    });
  }

  /**
   * A media row the tray let go of. Left alone it would sit in `uploading`
   * until the hourly check failed it. The delete carries a fresh usage
   * fingerprint (Codex-6sbn1): a draft may use the row already.
   */
  #discard(mediaId: string | null): Promise<void> {
    if (!mediaId) return Promise.resolve();
    // A draft may have saved it by now: the media picker attaches the id the
    // moment createMedia returns it (Codex-a6ofh.1.8), and a delete without
    // the usage fingerprint is refused (409) once anything uses the item. A
    // half-made upload is never live, so with the fingerprint it goes, and
    // that draft says "media missing" (data-design §1.4).
    // Two requests: a user switch (reset()) between them leaves the row for
    // the hourly check, as reset() leaves its own.
    const generation = this.#generation;
    const switched = () => generation !== this.#generation;
    const leftForTheHourlyCheck = (
      stage: 'skipped' | 'failed',
      error?: string
    ) =>
      logger.warn(
        'Media upload: a user switch left a discard to the hourly check',
        {
          mediaId,
          stage,
          ...(error === undefined ? {} : { error }),
        }
      );
    const discard: Promise<void> = this.#deps
      .readUsage(mediaId)
      .then((usage) => {
        if (!switched())
          return this.#deps.deleteMedia({
            id: mediaId,
            usage: usage.fingerprint,
          });
        leftForTheHourlyCheck('skipped');
      })
      .then(() => undefined)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (switched()) {
          leftForTheHourlyCheck('failed', message);
          return;
        }
        // The row now shows in the library as an upload that never finished,
        // until the hourly check fails it: worth an error, not a warning.
        logger.error('Media upload: could not remove the abandoned attempt', {
          mediaId,
          error: message,
        });
      })
      .finally(() => {
        this.#discarding.delete(discard);
        this.#syncGuard();
      });
    // Held until the delete lands or fails: callers sync the guard after.
    this.#discarding.add(discard);
    return discard;
  }

  #syncGuard(): void {
    const pending = this.pending;
    if (pending && !this.#releaseGuard) {
      // Registered only while needed: a beforeunload listener costs the page
      // its back/forward cache.
      this.#releaseGuard = this.#deps.guard(() => this.pending);
    } else if (!pending && this.#releaseGuard) {
      this.#releaseGuard();
      this.#releaseGuard = null;
    }
  }
}

/** One XHR per transfer, for its upload progress events. */
function xhrTransfer(request: UploadRequest): UploadTransfer {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        request.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(new Error(`${request.label} failed with status ${xhr.status}`));
    };
    xhr.onerror = () =>
      reject(new Error(`Network error during ${request.label.toLowerCase()}`));
    xhr.onabort = () => reject(new UploadCancelled());
    xhr.open(request.method, request.url);
    xhr.setRequestHeader('Content-Type', request.mimeType);
    if (request.withCredentials) xhr.withCredentials = true;
    xhr.send(request.file);
  });
  return { done, abort: () => xhr.abort() };
}

/** The studio's queue, shared by the tray, the media page and the picker. */
export const uploadQueue = new UploadQueue({
  createMedia: (input) => createMedia(input),
  completeUpload: (input) => completeUpload(input),
  deleteMedia: (input) => deleteMedia(input),
  readUsage: (id) => readFreshQuery(getMediaUsage(id)),
  renameMedia: (id, title) => updateMedia({ id, data: { title } }),
  send: xhrTransfer,
  measureDuration: measureMediaDuration,
  live: mediaStatus,
  guard: guardUnload,
  now: () => Date.now(),
  makeKey: () => crypto.randomUUID(),
});

registerUserScopedReset(() => uploadQueue.reset());
