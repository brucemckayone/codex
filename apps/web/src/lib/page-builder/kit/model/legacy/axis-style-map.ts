import type { ColourSchemeId, SectionSpacingId } from '../ids';

/**
 * The section-level legacy-axis → v2 `SectionStyle` conversion (contract §3,
 * quoted verbatim): "Legacy `design` axes → `SectionStyle` (`surface: invert`
 * → `contrast`; `tint`/`panel` → `soft`; `density: compact` → `compact`,
 * `regular` → `regular`, `airy`/`vast` → `spacious`; everything else →
 * absent)."
 *
 * Independent per-axis rules — `surface` alone decides `scheme`, `density`
 * alone decides `spacing` — UNLIKE the page-level look→Style detection
 * (`look-map.ts`), which matches all nine axes as one tuple. The other seven
 * legacy axes (`width`, `edge`, `align`, `type`, `accent`, `motion`, `media`)
 * have no v2 `SectionStyle` counterpart at all and are read by nothing here;
 * a value not present in the relevant map below resolves to absent, per
 * "everything else → absent" — there is no catch-all default the way the
 * page-level Style detection has one ("unrecognised → bold").
 *
 * Reads ONLY the section's own literal `design` object as stored — NOT a
 * retired-variant id's implied axes (see `variant-map.ts`'s header for why).
 */
export const SURFACE_TO_SCHEME: Readonly<Record<string, ColourSchemeId>> = {
  invert: 'contrast',
  tint: 'soft',
  panel: 'soft',
};

export const DENSITY_TO_SPACING: Readonly<Record<string, SectionSpacingId>> = {
  compact: 'compact',
  regular: 'regular',
  airy: 'spacious',
  vast: 'spacious',
};
