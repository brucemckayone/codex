/**
 * Journey preview wiring (Codex-2pryk.3.3 · WP-5).
 *
 * The seam between the page-builder store and the live-preview sender, lifted
 * out of the `studio/journeys/[id]/page` route so it can be unit-tested in
 * isolation — cloned from `brand-studio/preview-wiring.ts`. When wiring lives
 * only inside a `.svelte` `$effect`, a dropped `register` / `send` ships green;
 * this names + tests it. Pure + framework-free, so the route stays a thin caller.
 */
import type { PageBuilderState } from '@codex/shared-types';
import type { PagePreviewSender } from '$lib/page-builder';
import type { JourneyPreviewFrameLoad } from './journey-preview-canvas';

export interface JourneyPreviewWiring {
  /** Register a (re)loaded preview frame so it receives pending-draft updates. */
  registerFrame(detail: JourneyPreviewFrameLoad): void;
  /** Broadcast the builder's pending page draft to every tracked frame. */
  pushSnapshot(page: PageBuilderState): void;
}

/**
 * Bind a {@link PagePreviewSender} to the two operations the route drives:
 * registering each framed preview on load, and pushing the pending draft on
 * every edit. Preserves the frozen protocol's security semantics — the sender
 * posts to each frame's explicit `origin` (never `'*'`) and debounces; this only
 * names + tests the seam.
 */
export function createJourneyPreviewWiring(
  sender: PagePreviewSender
): JourneyPreviewWiring {
  return {
    registerFrame(detail) {
      sender.register(detail.element, detail.origin);
    },
    pushSnapshot(page) {
      sender.send(page);
    },
  };
}
