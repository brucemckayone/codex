/**
 * Section resolution (contract §3): every choice a creator left unset is read
 * from the page's Style, so changing the Style re-composes the whole page while
 * anything the creator picked stays put.
 *
 *   layout  = section.variant (if valid for the type) → Style default → first layout
 *   scheme  = section.design.scheme → Style default → 'base'
 *   spacing = section.design.spacing → 'regular'
 *   style   = page.design.style → 'bold'
 */
import {
  type ColourSchemeId,
  DEFAULT_PAGE_STYLE,
  DEFAULT_SECTION_SPACING,
  isColourSchemeId,
  isLayoutOf,
  isPageStyleId,
  isSectionSpacingId,
  isSectionTypeId,
  type PageStyleId,
  SECTION_LAYOUTS,
  type SectionSpacingId,
  type SectionTypeId,
} from './ids';
import { STYLES } from './styles';
import type {
  KitPage,
  KitSection,
  PageDesign,
  ResolvedSection,
  SectionStyle,
} from './types';

export function resolveStyle(
  design: PageDesign | null | undefined
): PageStyleId {
  return isPageStyleId(design?.style) ? design.style : DEFAULT_PAGE_STYLE;
}

export function resolveLayout(
  type: SectionTypeId,
  variant: string | null | undefined,
  style: PageStyleId
): string {
  if (isLayoutOf(type, variant)) return variant;
  const styled = STYLES[style].layouts[type];
  return isLayoutOf(type, styled) ? styled : SECTION_LAYOUTS[type][0];
}

export function resolveScheme(
  type: SectionTypeId,
  design: SectionStyle | null | undefined,
  style: PageStyleId
): ColourSchemeId {
  if (isColourSchemeId(design?.scheme)) return design.scheme;
  return STYLES[style].schemes[type] ?? 'base';
}

/** A chosen spacing wins; otherwise a `compact` layout sits in compact bands. */
export function resolveSpacing(
  design: SectionStyle | null | undefined,
  layout?: string
): SectionSpacingId {
  if (isSectionSpacingId(design?.spacing)) return design.spacing;
  return layout === 'compact' ? 'compact' : DEFAULT_SECTION_SPACING;
}

/** The sections a page actually renders: enabled, and of a known type. */
export function renderableSections(page: KitPage): KitSection[] {
  return page.sections.filter(
    (section) => section.enabled !== false && isSectionTypeId(section.type)
  );
}

/**
 * Resolve every rendered section once. Hidden sections take no index and no
 * anchor, so an anchor never points at nothing and the first VISIBLE hero is
 * the page's one `<h1>` — a duplicate hero is demoted rather than dropped, so
 * its author can still see and delete it.
 */
export function resolveSections(page: KitPage): ResolvedSection[] {
  const style = resolveStyle(page.design);
  const seen = new Map<SectionTypeId, number>();
  let heroTaken = false;
  let previousScheme: ColourSchemeId | null = null;

  return renderableSections(page).map((section, index) => {
    const count = (seen.get(section.type) ?? 0) + 1;
    seen.set(section.type, count);
    const isPageHeading = section.type === 'hero' && !heroTaken;
    if (isPageHeading) heroTaken = true;

    const layout = resolveLayout(section.type, section.variant, style);
    const scheme = keepBandsApart(
      resolveScheme(section.type, section.design, style),
      previousScheme,
      isColourSchemeId(section.design?.scheme)
    );
    previousScheme = scheme;
    return {
      id: section.id,
      anchor: count === 1 ? section.type : `${section.type}-${count}`,
      type: section.type,
      index,
      layout,
      scheme,
      spacing: resolveSpacing(section.design, layout),
      headingLevel: isPageHeading ? 1 : 2,
    };
  });
}

/**
 * Two identical COLOURED bands in a row read as one oversized slab (a
 * contrast "problem" straight into a contrast "before and after", or a CTA
 * dropped under a brand hero), and a brand band against a contrast band
 * smears into one block when the brand is very dark — the two are then
 * near-identical. A Style DEFAULT that would do either steps back to `base`.
 * A Style's own `order` is designed apart (catalog.test.ts), but a starter, a
 * creator's reorder or a hidden section between two bands brings them
 * together, and only this sees the page as it renders. A scheme the creator
 * chose is never overridden, and base-after-base is how plain sections are
 * meant to flow.
 */
function keepBandsApart(
  scheme: ColourSchemeId,
  previous: ColourSchemeId | null,
  chosen: boolean
): ColourSchemeId {
  if (chosen || scheme === 'base' || previous === null) return scheme;
  const smears =
    (scheme === 'brand' && previous === 'contrast') ||
    (scheme === 'contrast' && previous === 'brand');
  return scheme === previous || smears ? 'base' : scheme;
}

/** The scheme a featured card renders in, inside a section of `scheme`. */
export function featuredScheme(
  style: PageStyleId,
  scheme: ColourSchemeId
): ColourSchemeId {
  return STYLES[style].featured[scheme];
}
