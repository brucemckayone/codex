/**
 * Page-builder live-preview PROTOCOL (Codex-2pryk.2.1 · WP-0).
 *
 * The frozen postMessage contract between the studio page builder (the SENDER,
 * in the studio document) and the org's real journey page loaded same-origin in
 * the preview `<iframe>` (the APPLIER, in the framed document). Mirrors
 * `$lib/brand-editor/brand-preview-bridge.ts` — the same versioned-type + guard
 * shape — but carries the pending PAGE DRAFT instead of brand vars (SPEC §9).
 *
 * WP-0 freezes the PROTOCOL only: the versioned message type, the message shape,
 * the inbound type-guard, and the SENDER interface. The sender/applier RUNTIME
 * (the `createPagePreviewSender` clone + the framed-page applier) is WP-5 — it
 * implements {@link PagePreviewSender} and drives a page-builder store's pending
 * state, exactly as `createBrandPreviewSender` / `initBrandPreviewBridge` do.
 *
 * INERT + public-bundle safe: types + a pure guard only, no component imports —
 * lives under `$lib/page-builder` (CE-4 boundary gate scanned root).
 *
 * Security (WP-5 must preserve): same-origin ONLY. The sender always targets an
 * explicit origin (NEVER `'*'`); the applier is inert unless embedded and accepts
 * a message only when source + origin + type all match. Treat as a security
 * boundary.
 */
import type { PageBuilderState } from '@codex/shared-types';

/**
 * Versioned message type — bump the `:vN` suffix on any breaking payload change
 * (mirrors `BRAND_PREVIEW_MESSAGE_TYPE = 'codex:brand-preview:v1'`).
 */
export const PAGE_PREVIEW_MESSAGE_TYPE = 'codex:page-preview:v1';

/**
 * Studio → iframe preview message.
 *
 * `page` is the builder's PENDING {@link PageBuilderState} — the page draft being
 * previewed (sections + brandOverrides + meta). The framed page re-derives its
 * render from this, so copy / order / toggle / theme edits go live with NO reload
 * (SPEC §9). It is the full pending draft, not a pre-derived DOM patch, so the
 * framed page reuses its own render + branding-injection machinery.
 */
export interface PagePreviewMessage {
  readonly type: typeof PAGE_PREVIEW_MESSAGE_TYPE;
  readonly page: PageBuilderState;
}

/**
 * Shallow, runtime type-tag check for an inbound message. This is a trusted
 * same-origin admin channel (both ends are our own code on the same subdomain),
 * so it verifies the discriminating tag + that `page` is a non-null object,
 * rather than deep-validating every {@link PageBuilderState} field. Mirrors
 * `brand-preview-bridge.ts` `isBrandPreviewMessage`.
 */
export function isPagePreviewMessage(
  data: unknown
): data is PagePreviewMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { type?: unknown; page?: unknown };
  return (
    msg.type === PAGE_PREVIEW_MESSAGE_TYPE &&
    typeof msg.page === 'object' &&
    msg.page !== null
  );
}

/**
 * Parent-side sender contract — WP-5 implements this (clone of
 * `BrandPreviewSender`). Frozen here so the studio builder and the framed applier
 * compose against one shape.
 */
export interface PagePreviewSender {
  /**
   * Track a preview frame and immediately sync it to the latest pending draft.
   * Call from `onframeload` on every (re)load — a route change or reload swaps
   * the framed document, which must re-reflect in-progress edits at once.
   */
  register(element: HTMLIFrameElement, targetOrigin: string): void;
  /** Debounced broadcast of the latest pending draft to every tracked frame. */
  send(page: PageBuilderState): void;
  /** Stop the debounce timer and forget all tracked frames. */
  destroy(): void;
}
