import type { PageStyleId } from '../ids';

/**
 * The page-level legacy LOOK → v2 Style detection (contract §3, quoted
 * verbatim): "Legacy page look → Style: Candlelit → `cinematic`; Quiet
 * Studio, The Long Read, Plain Facts, The Syllabus → `clean`; Open Air →
 * `soft`; Full Send, Signal, unrecognised → `bold`. A look is recognised by
 * matching the page's axis values against the preset table in
 * `components/page-builder/design-vocabulary.ts`."
 *
 * `LEGACY_LOOK_PRESETS` is a byte-for-byte snapshot of that file's
 * `SECTION_DESIGN_PRESETS` nine-axis tuples (pinned there by
 * `design-vocabulary.test.ts`, so this copy is exactly as stable as the
 * original) — `upgrade.ts` must not import that file, since it is deleted in
 * WP6/9.
 *
 * Matching is EXACT on all nine axes, mirroring `design-vocabulary.ts`'s own
 * `findDesignPreset()`: a bundle agreeing on eight axes is a different look,
 * and highlighting one preset over another on a near-miss would tell the
 * page it is something it is not.
 */

const LEGACY_AXIS_KEYS = [
  'width',
  'density',
  'surface',
  'edge',
  'align',
  'type',
  'accent',
  'motion',
  'media',
] as const;
type LegacyAxisKey = (typeof LEGACY_AXIS_KEYS)[number];
type LegacyAxisTuple = Readonly<Record<LegacyAxisKey, string>>;

export interface LegacyLookPreset {
  readonly id: string;
  readonly design: LegacyAxisTuple;
}

/** Snapshot of `design-vocabulary.ts` `SECTION_DESIGN_PRESETS`, in its own order. */
export const LEGACY_LOOK_PRESETS: readonly LegacyLookPreset[] = [
  {
    id: 'candlelit',
    design: {
      width: 'text',
      density: 'airy',
      surface: 'media',
      edge: 'none',
      align: 'center',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'bleed',
    },
  },
  {
    id: 'quiet-studio',
    design: {
      width: 'narrow',
      density: 'vast',
      surface: 'bare',
      edge: 'hairline',
      align: 'center',
      type: 'monumental',
      accent: 'none',
      motion: 'fade',
      media: 'inset',
    },
  },
  {
    id: 'long-read',
    design: {
      width: 'text',
      density: 'regular',
      surface: 'bare',
      edge: 'hairline',
      align: 'start',
      type: 'balanced',
      accent: 'text',
      motion: 'rise',
      media: 'frame',
    },
  },
  {
    id: 'open-air',
    design: {
      width: 'text',
      density: 'airy',
      surface: 'tint',
      edge: 'soft',
      align: 'center',
      type: 'expressive',
      accent: 'text',
      motion: 'drift',
      media: 'mask',
    },
  },
  {
    id: 'plain-facts',
    design: {
      width: 'wide',
      density: 'compact',
      surface: 'panel',
      edge: 'offset',
      align: 'start',
      type: 'monumental',
      accent: 'fill',
      motion: 'none',
      media: 'none',
    },
  },
  {
    id: 'syllabus',
    design: {
      width: 'wide',
      density: 'compact',
      surface: 'panel',
      edge: 'hairline',
      align: 'start',
      type: 'restrained',
      accent: 'edge',
      motion: 'none',
      media: 'frame',
    },
  },
  {
    id: 'full-send',
    design: {
      width: 'wide',
      density: 'regular',
      surface: 'invert',
      edge: 'heavy',
      align: 'center',
      type: 'expressive',
      accent: 'fill',
      motion: 'stagger',
      media: 'mask',
    },
  },
  {
    id: 'signal',
    design: {
      width: 'wide',
      density: 'regular',
      surface: 'panel',
      edge: 'hairline',
      align: 'start',
      type: 'balanced',
      accent: 'fill',
      motion: 'rise',
      media: 'frame',
    },
  },
] as const;

/** Look id → v2 Style, per the contract sentence quoted above. */
export const LOOK_ID_TO_STYLE: Readonly<Record<string, PageStyleId>> = {
  candlelit: 'cinematic',
  'quiet-studio': 'clean',
  'long-read': 'clean',
  'plain-facts': 'clean',
  syllabus: 'clean',
  'open-air': 'soft',
  'full-send': 'bold',
  signal: 'bold',
};

/** "Full Send, Signal, unrecognised → `bold`." The unconditional floor — a
 *  page whose bundle matches no preset at all still gets an EXPLICIT Style,
 *  never an absent one (contract's own default anyway: `DEFAULT_PAGE_STYLE`
 *  in `ids.ts` is `'bold'`). */
export const UNRECOGNISED_STYLE: PageStyleId = 'bold';

/**
 * Which preset (if any) a raw legacy `design` object exactly matches, by its
 * nine legacy axis keys. Total — never throws; a non-object or a value with
 * a wrong-typed axis simply fails every preset's match.
 */
export function matchLegacyLook(design: unknown): LegacyLookPreset | null {
  if (typeof design !== 'object' || design === null) return null;
  const bag = design as Record<string, unknown>;
  return (
    LEGACY_LOOK_PRESETS.find((preset) =>
      LEGACY_AXIS_KEYS.every((axis) => bag[axis] === preset.design[axis])
    ) ?? null
  );
}
