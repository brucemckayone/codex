/**
 * Changes carried from a draft's editor to the live editor (Codex-a6ofh.2,
 * owner 2026-11-09). The piece went live while the creator was writing (its
 * schedule fired, an admin, another tab). The server refused the draft's
 * save, so what was typed since is on no row. "Open it to update" hands
 * those changes here, and the live editor's session takes them once, as
 * changes waiting for Update.
 *
 * Kept in memory across one move, keyed by the piece. The studio renders in
 * the browser only (`ssr = false`), so nothing is ever shared between
 * requests.
 *
 * A hand-off is taken once, and only while fresh. kit's `goto` can resolve
 * before the editor swaps to the live one, so the hand-off is never dropped
 * as the move ends; a move that failed withdraws it. One found past its
 * window is never applied, and is said: logged here, and told by the live
 * editor (`expired`), never lost without a word.
 */

import { logger } from '$lib/observability';
import type { DraftValues } from './draft-session.svelte';

/** How long a hand-off waits for the live editor: one move, never a later visit. */
export const LIVE_HANDOFF_FRESH_MS = 30_000;

const waiting = new Map<
  string,
  { changes: Partial<DraftValues>; at: number }
>();

/** What the live editor of a piece finds: changes to start from, or that they came too late. */
export type LiveHandoff = { changes: Partial<DraftValues> } | { expired: true };

/** Leave these changes for the live editor of `contentId`. */
export function handOffToLive(
  contentId: string,
  changes: Partial<DraftValues>
): void {
  waiting.set(contentId, { changes, at: Date.now() });
}

/** The move did not go: the next live editor of `contentId` starts from the row. */
export function withdrawLiveHandoff(contentId: string): void {
  waiting.delete(contentId);
}

/** What was left for `contentId`, taken once; null when nothing was. */
export function takeLiveHandoff(contentId: string): LiveHandoff | null {
  const left = waiting.get(contentId);
  waiting.delete(contentId);
  if (!left) return null;
  const ageMs = Date.now() - left.at;
  if (ageMs > LIVE_HANDOFF_FRESH_MS) {
    logger.warn('studio_editor.live_handoff_expired', {
      contentId,
      ageMs,
      keys: Object.keys(left.changes),
    });
    return { expired: true };
  }
  return { changes: left.changes };
}
