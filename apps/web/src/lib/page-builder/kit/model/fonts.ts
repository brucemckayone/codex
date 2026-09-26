/**
 * The stylesheet for a page's OWN brand fonts.
 *
 * The org layout loads only the ORG's families, so a page whose brand
 * overrides pick a different heading or body face rendered it in the fallback
 * stack. The request shape is the org layout's (`_org/[slug]/+layout.svelte`)
 * exactly — same weights, `display=swap` — so a family both pages ask for is
 * one cached response.
 */
import type { BrandTokenOverrides } from '$lib/page-builder';

function familyOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const family = value.trim().replace(/^['"]|['"]$/g, '');
  return family.length > 0 ? family : null;
}

export function brandFontsHref(
  overrides: BrandTokenOverrides | null | undefined
): string | undefined {
  const families = [
    ...new Set(
      [familyOf(overrides?.fontHeading), familyOf(overrides?.fontBody)].filter(
        (family): family is string => family !== null
      )
    ),
  ];
  if (families.length === 0) return undefined;
  const params = families
    .map(
      (family) => `family=${encodeURIComponent(family)}:wght@400;500;600;700`
    )
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
