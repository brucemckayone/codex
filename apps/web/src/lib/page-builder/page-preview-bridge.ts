/**
 * Page-builder preview bridge — RUNTIME (Codex-2pryk.3.3 · WP-5).
 *
 * The live edit → preview channel for the journey/page builder, cloned from
 * `$lib/brand-editor/brand-preview-bridge.ts`. It implements the RUNTIME for the
 * frozen `codex:page-preview:v1` PROTOCOL (WP-0, `./preview-protocol`): the
 * SENDER ({@link createPagePreviewSender}, in the studio builder document) and
 * the APPLIER ({@link initPagePreviewBridge}, inside the framed public journey
 * page). While a builder edits copy / toggles a section / reorders the page, the
 * framed `(space)/journeys/[slug]` page reflects it INSTANTLY, no reload.
 *
 * Why the payload is the full pending {@link PageBuilderState} and not a
 * pre-derived DOM patch: the framed page re-derives its render from the draft
 * with its OWN render + branding-injection machinery (the WP-3 renderer + the
 * brand-override seam), so a single message covers section copy, order, toggles,
 * AND per-page brand overrides — reusing the render path rather than fighting it
 * with fragile direct DOM writes. Mirrors the brand bridge's "send the state,
 * not a var map" rationale.
 *
 * Security (per the frozen protocol): same-origin ONLY. The sender always
 * targets an explicit origin (NEVER `'*'`); the applier is inert unless embedded
 * and accepts a message only when source + origin + type all match. Treat as a
 * security boundary.
 *
 * PUBLIC-SAFE PLACEMENT: lives under `$lib/page-builder` (a CE-4 public-lib scan
 * root) so the public journey page can import the applier without tripping the
 * import-boundary gate. It reuses the public-safe {@link pageBuilder} store and
 * adds no heavy editor code — the same placement rule the brand bridge follows.
 */

import type { PageBuilderState } from '@codex/shared-types';
import { browser } from '$app/environment';
import { pageBuilder } from './page-builder-store.svelte';
import {
  isPagePreviewMessage,
  PAGE_PREVIEW_MESSAGE_TYPE,
  type PagePreviewMessage,
  type PagePreviewSender,
} from './preview-protocol';

export interface PagePreviewSenderOptions {
  /**
   * Debounce window (ms) for coalescing rapid edits (e.g. typing into a copy
   * field). Defaults to ~50ms ≈ one animation frame — the brand bridge default.
   */
  readonly debounceMs?: number;
}

/**
 * Create a sender that broadcasts the builder's pending page draft to one or
 * more preview iframes over `postMessage`. Implements the frozen
 * {@link PagePreviewSender}. Frames are keyed by element so a route-change
 * navigation (same element, new document) re-registers idempotently and an
 * unmounted split frame is pruned on the next send.
 */
export function createPagePreviewSender(
  options: PagePreviewSenderOptions = {}
): PagePreviewSender {
  const debounceMs = options.debounceMs ?? 50;
  const frames = new Map<HTMLIFrameElement, string>();
  let latest: PageBuilderState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function postTo(
    element: HTMLIFrameElement,
    targetOrigin: string,
    page: PageBuilderState
  ): void {
    // A detached (unmounted split) frame is dropped rather than posted to.
    if (!element.isConnected) {
      frames.delete(element);
      return;
    }
    const win = element.contentWindow;
    if (!win) return;
    const message: PagePreviewMessage = {
      type: PAGE_PREVIEW_MESSAGE_TYPE,
      page,
    };
    try {
      // Explicit targetOrigin — NEVER '*'. Studio + framed page are same-origin.
      win.postMessage(message, targetOrigin);
    } catch {
      // Frame detached / navigating mid-post — drop it; the next onframeload
      // re-registers a fresh handle.
      frames.delete(element);
    }
  }

  function broadcast(page: PageBuilderState): void {
    for (const [element, targetOrigin] of frames) {
      postTo(element, targetOrigin, page);
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    register(element, targetOrigin) {
      frames.set(element, targetOrigin);
      // A freshly (re)loaded frame must reflect in-progress edits immediately —
      // otherwise a route change / reload would show the un-previewed page until
      // the next edit fires a broadcast.
      if (latest) postTo(element, targetOrigin, latest);
    },
    send(page) {
      latest = page;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (latest) broadcast(latest);
      }, debounceMs);
    },
    destroy() {
      clearTimer();
      frames.clear();
      latest = null;
    },
  };
}

/**
 * Attach the preview applier inside a framed public journey page.
 *
 * INERT unless embedded — on a standalone visit (`window.parent === window`, a
 * normal visitor) it adds NO listener and returns a no-op teardown, so this
 * ships harmlessly in the public bundle.
 *
 * When embedded, it accepts a message only when ALL hold: the message comes from
 * the direct parent frame (the studio builder), it is same-origin as this
 * document, and it carries the versioned `codex:page-preview:v1` type. Anything
 * else is ignored. An accepted message drives {@link pageBuilder.applyPreviewState}
 * — no reload. The applier NEVER posts a message, so it cannot echo back.
 *
 * @param target Window to bind to; defaults to the ambient window. Injectable for tests.
 * @returns teardown that removes the listener (no-op when not embedded).
 */
export function initPagePreviewBridge(
  target: Window = globalThis.window
): () => void {
  if (!browser || !target) return () => {};

  const parentWindow = target.parent;
  // Not embedded → a real visitor's own top window. Do nothing, attach nothing.
  if (parentWindow === target) return () => {};

  const expectedOrigin = target.location.origin;

  function onMessage(event: MessageEvent): void {
    if (event.source !== parentWindow) return; // only our parent studio frame
    if (event.origin !== expectedOrigin) return; // same-origin only
    if (!isPagePreviewMessage(event.data)) return; // only our versioned type
    pageBuilder.applyPreviewState(event.data.page);
  }

  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}
