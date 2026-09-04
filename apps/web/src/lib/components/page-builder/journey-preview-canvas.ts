/**
 * Journey builder live-preview canvas — shared types + device/theme model
 * (Codex-2pryk.3.3 · WP-5).
 *
 * Cloned from `brand-studio/preview-canvas.ts` (NOT reused — HARDENING §B18[H]:
 * `BrandStudioCanvas` binds the brand-editor store + a fixed 4-member brand
 * preview-route catalogue, so the stable-iframe pattern is cloned, not the
 * component). The journey builder previews ONE surface — the org's real public
 * journey sales page — so there is no route switcher; the model is the device
 * geometry the inline canvas scales to fit its column.
 *
 * EDITOR-TREE placement: lives under `$lib/components/page-builder`, behind the
 * CE-4 import boundary — never pulled into the public chunk. Co-located in a
 * `.ts` (not a `<script module>`) so the exported types cross the Svelte/tsc
 * boundary cleanly.
 */

/** A device-width preset the canvas renders the page at. */
export type JourneyPreviewDeviceId = 'desktop' | 'tablet' | 'mobile';

export interface JourneyPreviewDevice {
  readonly id: JourneyPreviewDeviceId;
  readonly label: string;
  /** Human-readable width shown in the toolbar. Derived from {@link width}. */
  readonly widthLabel: string;
  /**
   * The CSS-pixel width the canvas RENDERS at — a real device width, not a
   * column width. Load-bearing, not decoration: `.jp-sec` carries
   * `container-type: inline-size`, so this number is the width every one of the
   * journey CSS's `@container` rules resolves against.
   */
  readonly width: number;
  /**
   * The device's viewport HEIGHT, for re-pointing the sections' `svh` basis
   * (`--jp-stage-vh`). `null` on desktop deliberately: there the studio window
   * IS a desktop viewport, so the real `svh` is the honest answer and pinning a
   * number would make a tall or short monitor preview wrongly.
   */
  readonly height: number | null;
}

/**
 * Device presets — REAL device widths, and the canvas scales to fit them into
 * whatever column it has (see `journeyPreviewScale`).
 *
 * THEY USED TO BE LABELS OVER ONE FIXED COLUMN, and that was the O7 defect: the
 * canvas was `width: 100%; max-width: 1080px` inside a 708px studio column, so
 * at a 1440 viewport `.jp-sec` measured 674px while the published page's measured
 * 1376px — and the toggle still said "Desktop". Of the 19 `@container` rules in
 * the journey CSS, 8 resolved to the OPPOSITE branch, including
 * `HeroSection.svelte:980`'s `@container (max-width: 48rem)`, which stacks
 * `hero.split-media` into one column and lifts the media above the copy. Two of
 * the six hero compositions an author picks from were therefore authored as one
 * composition and published as another. Measured before the fix, both at a 1440
 * viewport: `grid-template-columns` on `.hero__inner` read `593.125px` in the
 * canvas and `506.094px 457.898px` on the page.
 *
 * The widths are the conventional device presets every page builder ships
 * (1440 desktop / 834 iPad Air / 390 iPhone), not the old 768/375 token pair —
 * 768 sat exactly ON `@container (max-width: 48rem)`, the single most consulted
 * breakpoint in the section CSS, which is the worst possible place for a preview
 * width to sit.
 */
export const JOURNEY_PREVIEW_DEVICES: readonly JourneyPreviewDevice[] = [
  {
    id: 'desktop',
    label: 'Desktop',
    widthLabel: '1440px',
    width: 1440,
    height: null,
  },
  {
    id: 'tablet',
    label: 'Tablet',
    widthLabel: '834px',
    width: 834,
    height: 1112,
  },
  {
    id: 'mobile',
    label: 'Mobile',
    widthLabel: '390px',
    width: 390,
    height: 844,
  },
];

/** The preset for an id, falling back to desktop rather than to `undefined`. */
export function journeyPreviewDevice(
  id: JourneyPreviewDeviceId
): JourneyPreviewDevice {
  return (
    JOURNEY_PREVIEW_DEVICES.find((d) => d.id === id) ??
    JOURNEY_PREVIEW_DEVICES[0]
  );
}

/**
 * The scale factor that fits `deviceWidth` into `availableWidth`.
 *
 * CLAMPED AT 1 so a wide monitor never MAGNIFIES the page — an author on a
 * 2560px display would otherwise edit a 1440 design blown up to 178%, which is
 * a different lie from the one this replaces.
 *
 * Returns 1 for a non-positive available width, which is the pre-measurement
 * state: a `ResizeObserver`'s first callback lands after layout, so one frame
 * renders before the real column width is known and 1 is the value that cannot
 * produce a divide-by-zero or a collapsed frame.
 */
export function journeyPreviewScale(
  availableWidth: number,
  deviceWidth: number
): number {
  if (!(availableWidth > 0) || !(deviceWidth > 0)) return 1;
  return Math.min(1, availableWidth / deviceWidth);
}
