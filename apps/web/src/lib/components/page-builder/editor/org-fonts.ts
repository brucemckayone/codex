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

/** What renders when the organisation has not chosen a font. */
export const PLATFORM_FONT = 'Inter';

export interface FontPair {
  heading: string;
  body: string;
}

function familyOf(layout: HTMLElement | null, property: string): string {
  const raw = layout?.style.getPropertyValue(property) ?? '';
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

/** The organisation's two families, each falling back to the platform's. */
export function orgFonts(): FontPair {
  const layout =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>('.org-layout');
  return {
    heading: familyOf(layout, '--brand-font-heading') || PLATFORM_FONT,
    body: familyOf(layout, '--brand-font-body') || PLATFORM_FONT,
  };
}
