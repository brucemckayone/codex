/**
 * Brand Studio live-preview canvas — shared types + route/device/theme model
 * (Codex-cijzb · WP-1.3).
 *
 * The canvas embeds the org's REAL public pages in a same-origin <iframe> and
 * lets an admin flip it between routes, device widths, and light/dark. This
 * module holds the pure, framework-free contract those Svelte components share
 * so the behaviour is unit-testable without mounting anything.
 *
 * Co-located in a `.ts` (not a `<script module>`) so the exported types cross
 * the Svelte/tsc boundary cleanly.
 */

/** A preview target. Maps to a root-relative public path (see resolvePreviewPath). */
export type PreviewRouteId = 'landing' | 'grid' | 'detail' | 'player';

/** A device-width preset the canvas constrains the iframe to. */
export type PreviewDeviceId = 'desktop' | 'tablet' | 'mobile';

/** Theme control: a single frame in light/dark, or two frames side-by-side. */
export type PreviewThemeMode = 'light' | 'dark' | 'split';

/** The concrete theme a single rendered frame paints in (`split` resolves per-frame). */
export type PreviewFrameTheme = 'light' | 'dark';

export interface PreviewRoute {
  readonly id: PreviewRouteId;
  readonly label: string;
  /**
   * Content routes (detail/player) need ONE published content slug to resolve.
   * With no published content the tab is disabled (see resolvePreviewPath →
   * null and CanvasToolbar's disabled gate).
   */
  readonly requiresContent: boolean;
}

/**
 * Route switcher entries. Confirmed against the real public route tree under
 * `_org/[slug]/(space)`:
 *   - landing → `/`          (the org landing page)
 *   - grid    → `/explore`   (the content grid)
 *   - detail  → `/content/<slug>`
 *   - player  → `/brand-preview/player` — a self-contained demo surface that
 *               renders the audio + video players in fixed states, so the
 *               player's branded chrome always previews regardless of what
 *               content (audio/video/none) the org has published.
 *
 * (Nav was retired: it aliased `/` — identical to Landing — and the nav chrome
 * already shows in every route, so a dedicated lens was redundant.)
 */
export const PREVIEW_ROUTES: readonly PreviewRoute[] = [
  { id: 'landing', label: 'Landing', requiresContent: false },
  { id: 'grid', label: 'Grid', requiresContent: false },
  { id: 'detail', label: 'Detail', requiresContent: true },
  // The player demo is synthetic — it never needs a published content slug.
  { id: 'player', label: 'Player', requiresContent: false },
];

export interface PreviewDevice {
  readonly id: PreviewDeviceId;
  readonly label: string;
  /** Human-readable width shown in the toolbar status (the CSS width lives in tokens). */
  readonly widthLabel: string;
}

/**
 * Device presets. The actual widths come from tokens
 * (`--brand-studio-preview-mobile` / `--brand-studio-preview-tablet` in
 * layout.css) applied via the viewport's `data-device` attribute; the
 * `widthLabel` here is display text only.
 */
export const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  { id: 'desktop', label: 'Desktop', widthLabel: 'Fluid' },
  { id: 'tablet', label: 'Tablet', widthLabel: '768px' },
  { id: 'mobile', label: 'Mobile', widthLabel: '375px' },
];

/**
 * Resolve a preview route to its ROOT-RELATIVE public path.
 *
 * The canvas is served from `/studio/brand` on the org subdomain, so the org's
 * real public pages are reached with root-relative paths (the slug lives in the
 * hostname, never the path). Returns `null` when a content route has no slug —
 * the caller renders an empty state / disables the tab instead of loading a
 * broken URL.
 */
export function resolvePreviewPath(
  id: PreviewRouteId,
  contentSlug?: string
): string | null {
  switch (id) {
    case 'landing':
      return '/';
    case 'grid':
      return '/explore';
    case 'detail':
      return contentSlug ? `/content/${encodeURIComponent(contentSlug)}` : null;
    case 'player':
      // Synthetic demo surface — always available, no content slug needed.
      return '/brand-preview/player';
  }
}

/**
 * WP-1.4 SEAM — payload handed to the parent each time a preview iframe loads.
 *
 * WP-1.4's postMessage bridge attaches via BrandStudioCanvas' `onframeload`
 * prop: it captures `window`, waits for this load signal, and posts brand
 * `pending` state to `origin` (an explicit targetOrigin). WP-1.3 only LOADS the
 * page and surfaces this handle — it never sends or receives postMessage.
 */
export interface PreviewFrameLoad {
  /** The framed page's window — WP-1.4's postMessage target. */
  readonly window: Window;
  /** The iframe element itself (stable across brand-edit re-renders). */
  readonly element: HTMLIFrameElement;
  /** Exact origin for postMessage `targetOrigin` (same-origin as the studio). */
  readonly origin: string;
  /** Which route is currently loaded in this frame. */
  readonly route: PreviewRouteId;
  /** Which theme this frame is rendering. */
  readonly theme: PreviewFrameTheme;
}
