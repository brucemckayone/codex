/**
 * Preview wiring (Codex-cijzb · WP-1.4 · WP-1.8)
 *
 * The seam between the brand-editor store and the live-preview sender, lifted
 * out of the `/studio/brand` route so it can be unit-tested in isolation. When
 * this only lived inside a `.svelte` `$effect`, a dropped `register` / `send`
 * would ship green — there was no unit covering the wiring itself. Pure +
 * framework-free, so the route stays a thin caller.
 */
import type { BrandEditorState, BrandPreviewSender } from '$lib/brand-editor';
import type { PreviewFrameLoad } from './preview-canvas';

export interface PreviewWiring {
  /** Register a (re)loaded preview frame so it receives brand updates. */
  registerFrame(detail: PreviewFrameLoad): void;
  /** Broadcast the editor's pending brand snapshot to every tracked frame. */
  pushSnapshot(pending: BrandEditorState): void;
}

/**
 * Bind a {@link BrandPreviewSender} to the two operations the route drives:
 * registering each framed preview on load, and pushing the pending snapshot on
 * every edit. Preserves the WP-1.4 security semantics — the sender still posts
 * to each frame's explicit `origin` (never `'*'`) and the debounce is unchanged;
 * this only names + tests the seam.
 */
export function createPreviewWiring(sender: BrandPreviewSender): PreviewWiring {
  return {
    registerFrame(detail) {
      sender.register(detail.element, detail.origin);
    },
    pushSnapshot(pending) {
      sender.send(pending);
    },
  };
}
