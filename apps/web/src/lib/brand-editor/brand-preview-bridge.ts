/**
 * Brand preview bridge (Codex-cijzb · WP-1.4)
 *
 * The live edit → preview channel between the `/studio/brand` workspace (the
 * SENDER, running in the studio document) and the org's real public page loaded
 * same-origin inside the preview iframe (the APPLIER, running in the framed
 * document). While an admin drags a colour / picks a font / nudges radius, the
 * framed page reflects it INSTANTLY, with NO reload.
 *
 * Why the payload is the pending BRAND STATE, not a pre-derived CSS-var map:
 * the framed page's org layout (`_org/[slug]/+layout.svelte`) applies branding
 * through the WP-1.1 injection seam — the store's `injectBrandVars` $effect
 * emits the `--brand-*` custom properties onto `.org-layout`, and the layout's
 * own `brandEditor.isOpen ? pending : server` bindings drive the *structural*
 * bits (logo, hero-layout mode, hero-visibility toggles, shader-active gate).
 * Feeding the iframe's store the full pending state re-runs that exact machinery
 * inside the frame, so colours / typography / radius / density AND logo AND hero
 * layout all go live with no reload — reusing the seam rather than fighting the
 * inline styles with fragile direct `setProperty` (which a layout re-render
 * would reset) or a separate injected `<style>` (which inline styles override).
 *
 * Security: same-origin only. The sender always targets an explicit origin
 * (never `'*'`); the applier is inert unless embedded and accepts a message only
 * when source + origin + type all match. Treat as a security boundary.
 *
 * Bundle boundary: this module lives under `$lib/brand-editor` (NOT
 * `$lib/components/brand-editor`) so the public org layout can import the
 * applier without tripping the WP-0.2 public-bundle guard. It reuses the store
 * + helpers already shipped to the public chunk; it adds no heavy editor code.
 */
import { browser } from '$app/environment';
import { brandEditor } from './brand-editor-store.svelte';
import type { BrandEditorState } from './types';

/** Versioned message type — bump the `:vN` suffix on any breaking payload change. */
export const BRAND_PREVIEW_MESSAGE_TYPE = 'codex:brand-preview:v1';

/**
 * Parent → iframe preview message.
 *
 * `vars` is the editor's *pending* {@link BrandEditorState} — the brand
 * variables being previewed. See the module header for why this is the state
 * and not a `--brand-*` property map.
 */
export interface BrandPreviewMessage {
  readonly type: typeof BRAND_PREVIEW_MESSAGE_TYPE;
  readonly vars: BrandEditorState;
}

/**
 * Shallow, runtime type-tag check for an inbound message. This is a trusted
 * same-origin admin channel (both ends are our own code on the same subdomain),
 * so we verify the discriminating tag + that `vars` is a non-null object rather
 * than deep-validating every {@link BrandEditorState} field.
 */
function isBrandPreviewMessage(data: unknown): data is BrandPreviewMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { type?: unknown; vars?: unknown };
  return (
    msg.type === BRAND_PREVIEW_MESSAGE_TYPE &&
    typeof msg.vars === 'object' &&
    msg.vars !== null
  );
}

// ── Parent side: sender ─────────────────────────────────────────────────────

export interface BrandPreviewSender {
  /**
   * Track a preview frame and immediately sync it to the latest pending state.
   * Call from `onframeload` on every (re)load — a route change or reload swaps
   * the framed document, which must re-reflect in-progress edits at once.
   */
  register(element: HTMLIFrameElement, targetOrigin: string): void;
  /** Debounced broadcast of the latest pending state to every tracked frame. */
  send(vars: BrandEditorState): void;
  /** Flush a pending debounced broadcast immediately (no-op if none queued). */
  flush(): void;
  /** Stop the debounce timer and forget all tracked frames. */
  destroy(): void;
}

export interface BrandPreviewSenderOptions {
  /**
   * Debounce window (ms) for coalescing rapid edits (slider drags). Defaults to
   * ~50ms ≈ one animation frame.
   */
  readonly debounceMs?: number;
}

/**
 * Create a sender that broadcasts the editor's pending state to one or more
 * preview iframes over `postMessage`. Frames are keyed by element so a
 * route-change navigation (same element, new document) re-registers idempotently
 * and an unmounted split frame is pruned on next send.
 */
export function createBrandPreviewSender(
  options: BrandPreviewSenderOptions = {}
): BrandPreviewSender {
  const debounceMs = options.debounceMs ?? 50;
  const frames = new Map<HTMLIFrameElement, string>();
  let latest: BrandEditorState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function postTo(
    element: HTMLIFrameElement,
    targetOrigin: string,
    vars: BrandEditorState
  ): void {
    // A detached (unmounted split) frame is dropped rather than posted to.
    if (!element.isConnected) {
      frames.delete(element);
      return;
    }
    const win = element.contentWindow;
    if (!win) return;
    const message: BrandPreviewMessage = {
      type: BRAND_PREVIEW_MESSAGE_TYPE,
      vars,
    };
    try {
      // Explicit targetOrigin — NEVER '*'. Studio and framed page are same-origin.
      win.postMessage(message, targetOrigin);
    } catch {
      // Frame detached / navigating mid-post — drop it; the next onframeload
      // re-registers a fresh handle.
      frames.delete(element);
    }
  }

  function broadcast(vars: BrandEditorState): void {
    for (const [element, targetOrigin] of frames) {
      postTo(element, targetOrigin, vars);
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
    send(vars) {
      latest = vars;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (latest) broadcast(latest);
      }, debounceMs);
    },
    flush() {
      clearTimer();
      if (latest) broadcast(latest);
    },
    destroy() {
      clearTimer();
      frames.clear();
      latest = null;
    },
  };
}

// ── Iframe side: applier / listener ──────────────────────────────────────────

/**
 * Attach the preview applier inside a framed public page.
 *
 * INERT unless embedded — on a standalone visit (`window.parent === window`,
 * i.e. a normal visitor) it adds NO listener and returns a no-op teardown, so
 * this ships harmlessly in the public bundle.
 *
 * When embedded, it accepts a message only when ALL hold: the message comes
 * from the direct parent frame (the studio document), it is same-origin as this
 * document, and it carries the versioned preview type. Anything else is ignored.
 * An accepted message drives the store's pending state (see module header) — no
 * reload. The applier NEVER posts a message, so it cannot bounce an echo back to
 * the sender.
 *
 * @param target Window to bind to; defaults to the ambient window. Injectable for tests.
 * @returns teardown that removes the listener (no-op when not embedded).
 */
export function initBrandPreviewBridge(
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
    if (!isBrandPreviewMessage(event.data)) return; // only our versioned type
    brandEditor.applyPreviewVars(event.data.vars);
  }

  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}
