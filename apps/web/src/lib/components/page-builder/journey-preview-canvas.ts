/**
 * Journey builder live-preview canvas — shared types + device/theme model
 * (Codex-2pryk.3.3 · WP-5).
 *
 * Cloned from `brand-studio/preview-canvas.ts` (NOT reused — HARDENING §B18[H]:
 * `BrandStudioCanvas` binds the brand-editor store + a fixed 4-member brand
 * preview-route catalogue, so the stable-iframe pattern is cloned, not the
 * component). The journey builder previews ONE surface — the org's real public
 * journey sales page — so there is no route switcher; the model keeps only the
 * device + theme presets and the `onframeload` seam the WP-5 preview bridge
 * attaches to.
 *
 * EDITOR-TREE placement: lives under `$lib/components/page-builder`, behind the
 * CE-4 import boundary — never pulled into the public chunk. Co-located in a
 * `.ts` (not a `<script module>`) so the exported types cross the Svelte/tsc
 * boundary cleanly.
 */

/** A device-width preset the canvas constrains the iframe to. */
export type JourneyPreviewDeviceId = 'desktop' | 'tablet' | 'mobile';

/** Theme control: a single frame in light/dark, or two frames side-by-side. */
export type JourneyPreviewThemeMode = 'light' | 'dark' | 'split';

/** The concrete theme a single rendered frame paints in (`split` resolves per-frame). */
export type JourneyPreviewFrameTheme = 'light' | 'dark';

export interface JourneyPreviewDevice {
  readonly id: JourneyPreviewDeviceId;
  readonly label: string;
  /** Human-readable width shown in the toolbar (the CSS width lives in tokens). */
  readonly widthLabel: string;
}

/**
 * Device presets. The actual widths come from the same brand-studio tokens
 * (`--brand-studio-preview-mobile` / `--brand-studio-preview-tablet`) applied via
 * the viewport's `data-device` attribute; `widthLabel` here is display text only.
 */
export const JOURNEY_PREVIEW_DEVICES: readonly JourneyPreviewDevice[] = [
  { id: 'desktop', label: 'Desktop', widthLabel: 'Fluid' },
  { id: 'tablet', label: 'Tablet', widthLabel: '768px' },
  { id: 'mobile', label: 'Mobile', widthLabel: '375px' },
];

/**
 * Resolve the ROOT-RELATIVE public path for a journey's sales page.
 *
 * The builder is served from `studio/journeys/[id]/page` on the org subdomain,
 * so the org's real public journey page is reached with a root-relative path
 * (the org slug lives in the hostname, never the path). The framed page mounts
 * the {@link ../../page-builder/page-preview-bridge} applier and re-renders the
 * builder's pending draft — so an unpublished draft still previews live.
 *
 * @param slug the page's slug (`PageBuilderState.slug`).
 */
export function resolveJourneyPreviewPath(slug: string): string {
  return `/journeys/${encodeURIComponent(slug)}`;
}

/**
 * WP-5 PREVIEW SEAM — payload handed to the parent each time a preview iframe
 * loads. The preview wiring (`preview-wiring.ts`) captures `element` + `origin`
 * and registers the frame with the {@link PagePreviewSender}, which posts the
 * builder's pending draft to `origin` (an explicit targetOrigin, never `'*'`).
 */
export interface JourneyPreviewFrameLoad {
  /** The framed page's window (the postMessage target). */
  readonly window: Window;
  /** The iframe element itself (stable across pending-edit re-renders). */
  readonly element: HTMLIFrameElement;
  /** Exact origin for postMessage `targetOrigin` (same-origin as the studio). */
  readonly origin: string;
  /** Which theme this frame is rendering. */
  readonly theme: JourneyPreviewFrameTheme;
}
