/**
 * Publish when ready (Codex-a6ofh.2.8): media-api tells content-api that a
 * media item changed, so the drafts scheduled to publish when it is ready
 * settle by its state there. content-api decides everything (ready, gone,
 * failed for good, or still to wait); this side only names the item.
 */

export interface ContentReadyNotifier {
  /**
   * After a write that left the item ready or failed for good.
   * Fire-and-forget and never throws: a lost call is logged, and the
   * maintenance run makes it again.
   */
  mediaChanged(mediaItemId: string): void;
  /**
   * The maintenance run's call, awaited so its report counts a failed one.
   * Resolves once content-api has taken the item (it settles after
   * answering); throws if it would not.
   */
  settle(mediaItemId: string): Promise<void>;
}
