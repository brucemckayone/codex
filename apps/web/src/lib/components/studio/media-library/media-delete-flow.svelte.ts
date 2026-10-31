/**
 * The Studio's delete dialog for one media item (Codex-6sbn1), as state.
 *
 * Every state of the approved mockups (delete-blocked, delete-drafts,
 * delete-unused, failures) is decided here, so a unit test pins them rather
 * than the eye. StudioMediaPage words and draws the result.
 *
 * The rules it keeps:
 * - Delete is enabled ONLY on a usage read that answered and found nothing
 *   published. Checking, a failed read and a re-read under way all keep it
 *   off, so a failed read never reads as "not in use".
 * - The click sends the read's fingerprint. When the worker refuses (409
 *   `MEDIA_IN_USE` or `MEDIA_USAGE_CHANGED`), the dialog reads the uses again
 *   and redraws with a line saying why; it never needs titles from the error
 *   body, which `forwardClientErrors` doesn't pass on.
 * - Any other failure says so (F3). Nothing is ever only logged.
 */

import type {
  MediaUsage,
  MediaUsageCounts,
  MediaUse,
} from '@codex/shared-types';
import { remoteErrorCode, remoteErrorStatus } from '$lib/remote/query-result';
import { firstOpenableDraft, newlyLiveUse } from './media-usage';

/** The item the dialog names (its card), from the library row. */
export interface DeleteTarget {
  id: string;
  title: string;
  mediaType: string;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
  thumbnailUrl?: string | null;
  /** The library's count, for the dialog's width only: never what it trusts. */
  usage?: MediaUsageCounts;
}

export type UsageCheck =
  | { state: 'checking' }
  /** `rateLimited`: a 429, which says "wait a minute" instead. */
  | { state: 'failed'; rateLimited: boolean }
  | { state: 'ready'; usage: MediaUsage };

/** The line on top of the dialog after a click that didn't delete. */
export type DeleteNotice =
  /** R1: something published started using it. `title` when it can be named. */
  | { kind: 'now-live'; title: string | null }
  /** R2: a draft was added since the dialog opened. */
  | { kind: 'new-draft' }
  /** R2, when the change isn't a new draft (one went, or one moved). */
  | { kind: 'changed' }
  /** F3: the delete itself failed; nothing changed. */
  | { kind: 'failed'; rateLimited: boolean };

export type DeleteView =
  | 'checking'
  | 'check-failed'
  /** Something published uses it: Delete stays off (page 2). */
  | 'blocked'
  /** Only drafts use it: allowed, with the warning (page 3). */
  | 'drafts'
  /** Nothing uses it (page 4). */
  | 'unused';

export type DeleteOutcome =
  /** Gone. `drafts` were left without media; `firstDraft` is the toast's link. */
  | { kind: 'deleted'; drafts: number; firstDraft: MediaUse | null }
  /** 404: another tab already deleted it. */
  | { kind: 'gone' }
  /** 409: refused, and the dialog has redrawn. */
  | { kind: 'refused' }
  /** Failed; the dialog says so. `status` undefined: no answer at all. */
  | { kind: 'failed'; status: number | undefined };

export interface MediaDeleteDeps {
  /** A fresh read of `GET /api/media/:id/usage`: never a cached one. */
  readUsage: (id: string) => Promise<MediaUsage>;
  /** `DELETE /api/media/:id?usage=`; rejects with the remote's HttpError. */
  remove: (input: { id: string; usage?: string }) => Promise<unknown>;
}

const REFUSALS = new Set(['MEDIA_IN_USE', 'MEDIA_USAGE_CHANGED']);

/** Content and course titles name what changed; an intro's is an org name. */
function nameOf(use: MediaUse | null): string | null {
  return use && use.kind !== 'intro' ? use.title : null;
}

export class MediaDeleteFlow {
  target = $state<DeleteTarget | null>(null);
  check = $state<UsageCheck>({ state: 'checking' });
  /** A re-read under way while a list is shown: the list stays, Delete is off. */
  rechecking = $state(false);
  deleting = $state(false);
  notice = $state<DeleteNotice | null>(null);

  /** Drops a read that answers for a dialog since closed or re-read. */
  #token = 0;
  readonly #deps: MediaDeleteDeps;

  constructor(deps: MediaDeleteDeps) {
    this.#deps = deps;
  }

  get view(): DeleteView {
    const check = this.check;
    if (check.state === 'checking') return 'checking';
    if (check.state === 'failed') return 'check-failed';
    if (check.usage.live > 0) return 'blocked';
    return check.usage.total > 0 ? 'drafts' : 'unused';
  }

  get canDelete(): boolean {
    return (
      this.check.state === 'ready' &&
      this.check.usage.live === 0 &&
      !this.rechecking &&
      !this.deleting
    );
  }

  /** Open the dialog for an item and read its uses. */
  open(target: DeleteTarget): void {
    this.target = target;
    this.check = { state: 'checking' };
    this.notice = null;
    this.rechecking = false;
    this.deleting = false;
    void this.recheck();
  }

  close(): void {
    this.#token++;
    this.target = null;
    this.check = { state: 'checking' };
    this.notice = null;
    this.rechecking = false;
    this.deleting = false;
  }

  /**
   * Read the uses again: on open, Try again, Check now, a return to this tab
   * (once, never on a timer), and after a refusal. A list already shown stays
   * up while the new one loads.
   */
  async recheck(): Promise<void> {
    const target = this.target;
    if (!target || this.deleting) return;
    const token = ++this.#token;
    if (this.check.state === 'ready') {
      this.rechecking = true;
    } else {
      this.check = { state: 'checking' };
    }
    try {
      const usage = await this.#deps.readUsage(target.id);
      if (token !== this.#token) return;
      this.check = { state: 'ready', usage };
    } catch (error) {
      if (token !== this.#token) return;
      this.check = {
        state: 'failed',
        rateLimited: remoteErrorStatus(error) === 429,
      };
    } finally {
      if (token === this.#token) this.rechecking = false;
    }
  }

  /** The Delete button. Does nothing unless {@link canDelete}. */
  async confirm(): Promise<DeleteOutcome | null> {
    const target = this.target;
    if (!target || !this.canDelete || this.check.state !== 'ready') return null;
    const shown = this.check.usage;
    this.deleting = true;
    this.notice = null;
    let error: unknown;
    try {
      await this.#deps.remove({ id: target.id, usage: shown.fingerprint });
      return {
        kind: 'deleted',
        drafts: shown.drafts,
        firstDraft: firstOpenableDraft(shown),
      };
    } catch (thrown) {
      error = thrown;
    } finally {
      this.deleting = false;
    }

    const status = remoteErrorStatus(error);
    const code = remoteErrorCode(error);
    if (status === 409 && code !== undefined && REFUSALS.has(code)) {
      const inUse = code === 'MEDIA_IN_USE';
      // Said at once; named once the new read lands.
      this.notice = inUse
        ? { kind: 'now-live', title: null }
        : { kind: 'changed' };
      await this.recheck();
      if (this.target?.id !== target.id) return { kind: 'refused' };
      const now = this.check.state === 'ready' ? this.check.usage : null;
      if (inUse) {
        this.notice = {
          kind: 'now-live',
          title: now ? nameOf(newlyLiveUse(shown, now)) : null,
        };
      } else if (now && now.drafts > shown.drafts) {
        this.notice = { kind: 'new-draft' };
      }
      return { kind: 'refused' };
    }
    if (status === 404) return { kind: 'gone' };
    this.notice = { kind: 'failed', rateLimited: status === 429 };
    return { kind: 'failed', status };
  }
}
