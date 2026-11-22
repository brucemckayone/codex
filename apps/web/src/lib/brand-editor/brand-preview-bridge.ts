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
import type {
  HeroContentKind,
  HeroOptions,
  HeroSettings,
} from '$lib/org-hero/hero-config';
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

/** Versioned type of the frame's report back to the studio (WP-9). */
export const BRAND_PREVIEW_RESOLVED_TYPE = 'codex:brand-preview-resolved:v1';

/**
 * What the framed landing's hero resolved to: the options it draws once the
 * org's facts have had their say (a Showreel with no featured pieces draws no
 * peek), and the kind of content its words name. The brand editor shows a
 * hint where these differ from the choice, and names the purposes in the
 * org's own kind ("Get people listening").
 *
 * `chosen` is what it resolved FROM (the purpose and the stored options), so
 * the editor can tell a report on its current choices from one still on its
 * way back after an edit, and hints only on the first.
 */
export interface BrandPreviewResolved {
  readonly options: HeroOptions;
  readonly kind: HeroContentKind;
  readonly chosen: HeroSettings;
}

/**
 * Iframe → parent report message. `resolved: null` withdraws the last one:
 * the landing has gone (the preview navigated) or draws no new hero.
 */
interface BrandPreviewResolvedMessage {
  readonly type: typeof BRAND_PREVIEW_RESOLVED_TYPE;
  readonly resolved: BrandPreviewResolved | null;
}

const CONTENT_KINDS: readonly string[] = ['watch', 'listen', 'read'];

/** Shallow tag-and-shape check, as for the preview message. */
function isResolvedMessage(data: unknown): data is BrandPreviewResolvedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { type?: unknown; resolved?: unknown };
  if (msg.type !== BRAND_PREVIEW_RESOLVED_TYPE) return false;
  if (msg.resolved === null) return true;
  const resolved = msg.resolved as {
    options?: unknown;
    kind?: unknown;
    chosen?: { purpose?: unknown; options?: unknown } | null;
  };
  return (
    typeof resolved === 'object' &&
    resolved !== null &&
    typeof resolved.options === 'object' &&
    resolved.options !== null &&
    typeof resolved.kind === 'string' &&
    CONTENT_KINDS.includes(resolved.kind) &&
    typeof resolved.chosen === 'object' &&
    resolved.chosen !== null &&
    (resolved.chosen.purpose === null ||
      typeof resolved.chosen.purpose === 'string') &&
    typeof resolved.chosen.options === 'object' &&
    resolved.chosen.options !== null
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
  /**
   * Hear each tracked frame's report of what its hero resolved to, or null
   * when it withdraws one. Accepted only from a tracked frame's own window,
   * at the origin it was registered with, carrying the versioned report
   * type. Returns a teardown.
   */
  onResolved(
    listener: (resolved: BrandPreviewResolved | null) => void
  ): () => void;
  /** Stop the debounce timer, forget all tracked frames, drop listeners. */
  destroy(): void;
}

export interface BrandPreviewSenderOptions {
  /**
   * Debounce window (ms) for coalescing rapid edits (slider drags). Defaults to
   * ~50ms ≈ one animation frame.
   */
  readonly debounceMs?: number;
  /** The studio window reports arrive at. Injectable for tests. */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
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
  const target = options.target ?? (browser ? globalThis.window : undefined);
  const frames = new Map<HTMLIFrameElement, string>();
  const teardowns = new Set<() => void>();
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
    onResolved(listener) {
      if (!target) return () => {};
      function onMessage(event: MessageEvent): void {
        if (!isResolvedMessage(event.data)) return;
        for (const [element, origin] of frames) {
          if (event.source !== element.contentWindow) continue;
          if (event.origin !== origin) return; // our frame, wrong origin
          listener(event.data.resolved);
          return;
        }
      }
      target.addEventListener('message', onMessage);
      const teardown = () => {
        target.removeEventListener('message', onMessage);
        teardowns.delete(teardown);
      };
      teardowns.add(teardown);
      return teardown;
    },
    destroy() {
      clearTimer();
      frames.clear();
      latest = null;
      for (const teardown of [...teardowns]) teardown();
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
 * reload. The applier never posts a message, so it cannot bounce an echo back
 * to the sender; the one message a framed page sends is its hero's report
 * (`reportPreviewResolved`), a different type the sender never re-broadcasts.
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

/** The last report each window posted, so a repeat is not sent again. */
const reported = new WeakMap<Window, string>();

/**
 * From a framed landing, tell the studio what its hero resolved to (WP-9).
 *
 * INERT unless this page is the studio's live preview: embedded, and showing
 * pending edits (the applier has opened the store). It posts only to the
 * direct parent, at this document's own origin (never `'*'`), so a page
 * embedded anywhere else reaches no one. Repeats of the same report are
 * dropped: the hero re-resolves on every edit. Null withdraws the last
 * report, as the landing leaves (a link followed inside the preview).
 *
 * @param target Window to post from; defaults to the ambient window. Injectable for tests.
 */
export function reportPreviewResolved(
  resolved: BrandPreviewResolved | null,
  target: Window = globalThis.window
): void {
  if (!browser || !target || target.parent === target) return;
  if (!brandEditor.isOpen) return;
  // Plain copies: a reactive proxy does not survive postMessage's clone.
  const message: BrandPreviewResolvedMessage = {
    type: BRAND_PREVIEW_RESOLVED_TYPE,
    resolved: resolved && {
      options: { ...resolved.options },
      kind: resolved.kind,
      chosen: {
        purpose: resolved.chosen.purpose,
        options: { ...resolved.chosen.options },
      },
    },
  };
  const key = JSON.stringify(message.resolved);
  if (reported.get(target) === key) return;
  reported.set(target, key);
  target.parent.postMessage(message, target.location.origin);
}
