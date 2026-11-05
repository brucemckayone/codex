/**
 * The list view's bulk delete (Codex-a6ofh.1.7, mockup M2; data-design
 * §1.3): the per-item delete, one item at a time. Each item gets a fresh
 * usage read and its fingerprint goes back with the DELETE, exactly as the
 * single delete dialog does, so nothing a published piece uses is removed.
 *
 * Capped at MEDIA_BULK_DELETE_MAX: DELETE /api/media/:id is on the `strict`
 * limiter (20 a minute per session), and a usage read precedes each one.
 */

import type { MediaUsage } from '@codex/shared-types';
import { remoteErrorCode, remoteErrorStatus } from '$lib/remote/query-result';

export const MEDIA_BULK_DELETE_MAX = 15;

export interface BulkDeleteDeps {
  readUsage: (id: string) => Promise<MediaUsage>;
  remove: (input: { id: string; usage: string }) => Promise<unknown>;
  /** A delete that failed for a reason other than a published use. */
  onFailure?: (id: string, error: unknown) => void;
}

export interface BulkDeleteResult {
  deleted: string[];
  /** Kept because something published uses them (MEDIA_IN_USE, or read live). */
  blocked: string[];
  /** Refused because their uses changed between the read and the delete. */
  changed: string[];
  failed: string[];
  /** Not tried: the strict limiter refused one, so the loop stopped there. */
  rateLimited: string[];
  /** Drafts that lost their media to the deletes (owner round 2, decision 6). */
  draftsAffected: number;
}

export async function runBulkDelete(
  ids: readonly string[],
  deps: BulkDeleteDeps
): Promise<BulkDeleteResult> {
  if (ids.length > MEDIA_BULK_DELETE_MAX) {
    throw new RangeError(
      `bulk delete takes at most ${MEDIA_BULK_DELETE_MAX} items, got ${ids.length}`
    );
  }
  const result: BulkDeleteResult = {
    deleted: [],
    blocked: [],
    changed: [],
    failed: [],
    rateLimited: [],
    draftsAffected: 0,
  };
  for (const [index, id] of ids.entries()) {
    try {
      const usage = await deps.readUsage(id);
      if (usage.live > 0) {
        result.blocked.push(id);
        continue;
      }
      await deps.remove({ id, usage: usage.fingerprint });
      result.deleted.push(id);
      result.draftsAffected += usage.drafts;
    } catch (error) {
      const status = remoteErrorStatus(error);
      if (status === 429) {
        // Every further request would be refused too: stop, and say how many.
        result.rateLimited = ids.slice(index);
        break;
      }
      if (status === 409) {
        // MEDIA_IN_USE: published, the guard doing its job. MEDIA_USAGE_CHANGED:
        // the uses moved since the read, so a second look may still delete it.
        if (remoteErrorCode(error) === 'MEDIA_USAGE_CHANGED')
          result.changed.push(id);
        else result.blocked.push(id);
      } else if (status === 404) {
        // Already gone (another tab): what the creator asked for.
        result.deleted.push(id);
      } else {
        result.failed.push(id);
        deps.onFailure?.(id, error);
      }
    }
  }
  return result;
}
