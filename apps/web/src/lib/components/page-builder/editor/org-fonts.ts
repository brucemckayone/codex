/**
 * The organisation's own heading and body fonts, as the org layout sets them:
 * `--brand-font-heading` / `--brand-font-body` inline on `.org-layout`
 * (`_org/[slug]/+layout.svelte`), absent when the organisation chose none —
 * and then the platform's Inter renders (`styles/tokens/typography.css`).
 *
 * READ IT BEFORE A FONT PICKER OPENS. The brand editor's `FontPicker` previews
 * a hovered family by writing these same properties (see `BrandFontField`),
 * so a read while one is open would see the preview, not the organisation.
 */

import {
  brandFontProperty,
  firstFamily,
} from '$lib/brand-editor/font-fallbacks';

/** What renders when the organisation has not chosen a font. */
export const PLATFORM_FONT = 'Inter';

export interface FontPair {
  heading: string;
  body: string;
}

/** The face itself: a value may name the face's own fallback after it (`withFallback`). */
function familyOf(layout: HTMLElement | null, property: string): string {
  return firstFamily(layout?.style.getPropertyValue(property) ?? '');
}

function orgLayout(): HTMLElement | null {
  return typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.org-layout');
}

/** One of the organisation's families, or '' when it chose none. */
export function orgFontFamily(which: keyof FontPair): string {
  return familyOf(orgLayout(), brandFontProperty(which));
}

/** The organisation's two families, each falling back to the platform's. */
export function orgFonts(): FontPair {
  return {
    heading: orgFontFamily('heading') || PLATFORM_FONT,
    body: orgFontFamily('body') || PLATFORM_FONT,
  };
}
