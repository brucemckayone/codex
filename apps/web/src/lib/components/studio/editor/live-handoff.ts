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
 * as the move ends. One the move never reached is past its window when the
 * piece is next opened, and is never applied.
 */

import type { DraftValues } from './draft-session.svelte';

/** How long a hand-off waits for the live editor: one move, never a later visit. */
export const LIVE_HANDOFF_FRESH_MS = 30_000;

const waiting = new Map<
  string,
  { changes: Partial<DraftValues>; at: number }
>();

/** Leave these changes for the live editor of `contentId`. */
export function handOffToLive(
  contentId: string,
  changes: Partial<DraftValues>
): void {
  waiting.set(contentId, { changes, at: Date.now() });
}

/** The changes left for `contentId`, taken once; null when none, or too old. */
export function takeLiveHandoff(
  contentId: string
): Partial<DraftValues> | null {
  const left = waiting.get(contentId);
  waiting.delete(contentId);
  if (!left || Date.now() - left.at > LIVE_HANDOFF_FRESH_MS) return null;
  return left.changes;
}
