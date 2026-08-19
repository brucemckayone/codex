/**
 * The design panel's VOCABULARY — the eight presets plus the creator-facing label
 * for every axis and every axis value (`docs/design/journey-sections/00-design-
 * language-research.md` §4, `02-axis-contract.md` A20/A21).
 *
 * WHY IT LIVES IN THE BUILDER LAYER, not in `section-catalog.ts`: every string
 * here is editor UI. `$lib/page-builder` is the CE-4-scanned public-bundle root
 * that the PUBLIC sales page imports, and none of this copy is ever rendered on
 * that page — a preset name is something a creator picks, not something a visitor
 * reads. The catalogue keeps what the renderer needs (the axis enums and
 * `resolveDesign`); this keeps what the panel needs.
 *
 * ONE SOURCE OF TRUTH FOR THE ENUMS: nothing here re-declares which values an
 * axis has. The label maps are keyed off `SECTION_DESIGN_VALUES` and
 * `design-vocabulary.test.ts` asserts they cover it EXACTLY — no missing key, no
 * extra key. A hand-written second list is how a value becomes selectable in the
 * editor while matching no CSS rule on the page.
 *
 * i18n: deliberately inline English for now, exactly as `section-catalog.ts`'s
 * variant labels are (A20 draws the line here, and `messages/en.json` is
 * single-owner — a worktree that regenerates paraglide strips other worktrees'
 * keys). The suggested keys are reported with this stage, not added here.
 */

import type { ResolvedSectionDesign, SectionDesign } from '@codex/shared-types';
import {
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_VALUES,
  type SectionDesignAxis,
} from '$lib/page-builder';

/** A named, complete look a creator can apply to the whole page in one click. */
export interface SectionDesignPreset {
  /** Stable id — not shown, used for selection state and (later) i18n keys. */
  id: string;
  /** Creator-facing name (research §4 names them for creators, not designers). */
  name: string;
  /** One line on who it is for. */
  description: string;
  /**
   * TOTAL by type (`ResolvedSectionDesign`, not `SectionDesign`): a preset must
   * state all nine axes. A partial preset would leave the page half in the new
   * look and half in whatever it held before, which reads as a broken control
   * rather than a design choice.
   */
  design: ResolvedSectionDesign;
}

/**
 * The eight presets, in the research's own order (§4.1 → §4.8).
 *
 * `signal` is the recommended platform default and is ALSO declared in
 * `CourseJourneyService.NEW_PAGE_DESIGN`, which writes it onto every new page
 * (A21) — a package cannot import from `apps/web`. The test pins the two to the
 * same nine values, so a drift fails the suite rather than quietly producing new
 * pages whose stored bundle matches no preset in this picker.
 *
 * Per-type VARIANT preferences are part of each preset in the research; they are
 * deliberately NOT here yet — `resolveVariant` is per-section state the component
 * worktrees are still collapsing (A9 stage 2), so writing variant preferences now
 * would fight that migration. Presets currently set the nine axes only.
 */
export const SECTION_DESIGN_PRESETS: readonly SectionDesignPreset[] = [
  {
    id: 'candlelit',
    name: 'Candlelit',
    description:
      'Cinematic and close. For narrative, depth work and film-led programmes.',
    design: {
      width: 'narrow',
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
    name: 'Quiet Studio',
    description:
      'Space and restraint. For photography, architecture and craft.',
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
    name: 'The Long Read',
    description: 'Editorial columns. For writers, essayists and researchers.',
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
    name: 'Open Air',
    description:
      'Soft and unhurried. For yoga, breathwork, somatics and coaching.',
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
    name: 'Plain Facts',
    description:
      'No fluff. For developer courses, trades and direct positioning.',
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
    name: 'The Syllabus',
    description:
      'Dense and structured. For certifications and curriculum-heavy programmes.',
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
    name: 'Full Send',
    description: 'Loud and energetic. For challenges, bootcamps and cohorts.',
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
    name: 'Signal',
    description: 'A good modern page. The recommended starting point.',
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
];

/** The preset a new page is created with (`A21` — Signal, research §4.8). */
export const DEFAULT_PRESET_ID = 'signal';

/**
 * Which preset a stored bundle IS, or `null` for none.
 *
 * Requires ALL NINE axes to match, because a preset is a whole look: a bundle
 * agreeing on eight axes is a different look, and highlighting it would tell the
 * creator the page is something it is not. `null` renders as "Custom" — honest,
 * and reachable (a page written by an older client, or a partial bundle).
 */
export function findDesignPreset(
  design: SectionDesign | undefined
): SectionDesignPreset | null {
  if (!design) return null;
  return (
    SECTION_DESIGN_PRESETS.find((preset) =>
      SECTION_DESIGN_AXES.every((axis) => design[axis] === preset.design[axis])
    ) ?? null
  );
}

/** Axis → the panel's label for it. */
export const AXIS_LABELS: Record<SectionDesignAxis, string> = {
  width: 'Width',
  density: 'Spacing',
  surface: 'Surface',
  edge: 'Edge',
  align: 'Alignment',
  type: 'Type scale',
  accent: 'Accent',
  motion: 'Motion',
  media: 'Media',
};

/** Axis → one line on what moving it does. */
export const AXIS_HINTS: Record<SectionDesignAxis, string> = {
  width: 'How wide the content runs.',
  density: 'How much air between things.',
  surface: 'What the section sits on.',
  edge: 'Borders and lift.',
  align: 'Where the text starts.',
  type: 'How large the headings run.',
  accent: 'How the brand colour is used.',
  motion: 'How content arrives on scroll.',
  media: 'How images and video are framed.',
};

/**
 * Axis → value → label. Keyed off `SECTION_DESIGN_VALUES`, and the test asserts
 * an exact key match against it in both directions.
 */
export const AXIS_VALUE_LABELS: {
  readonly [A in SectionDesignAxis]: Readonly<Record<string, string>>;
} = {
  width: {
    narrow: 'Narrow',
    text: 'Text column',
    wide: 'Wide',
    full: 'Full width',
  },
  density: {
    compact: 'Compact',
    regular: 'Regular',
    airy: 'Airy',
    vast: 'Vast',
  },
  surface: {
    bare: 'Bare',
    tint: 'Tinted',
    panel: 'Panel',
    invert: 'Inverted',
    media: 'Atmospheric',
  },
  edge: {
    none: 'None',
    hairline: 'Hairline',
    soft: 'Soft',
    heavy: 'Heavy',
    offset: 'Offset',
  },
  align: {
    start: 'Left',
    center: 'Centred',
  },
  type: {
    restrained: 'Restrained',
    balanced: 'Balanced',
    expressive: 'Expressive',
    monumental: 'Monumental',
  },
  accent: {
    text: 'Accent text',
    fill: 'Filled',
    edge: 'Edge stripe',
    glow: 'Glow',
    none: 'None',
  },
  motion: {
    none: 'None',
    fade: 'Fade',
    rise: 'Rise',
    stagger: 'Stagger',
    drift: 'Drift',
  },
  media: {
    bleed: 'Bleed',
    frame: 'Framed',
    mask: 'Masked',
    inset: 'Inset',
    none: 'None',
  },
};

/**
 * The section types on which `media` means anything (research §2.2 — it is inert
 * on the other six).
 *
 * The panel HIDES the control on the rest rather than showing a dead one. Note
 * `proof` is in the list for its avatars, which is not obvious from the type name.
 */
export const MEDIA_AWARE_SECTION_TYPES: readonly string[] = [
  'hero',
  'introVideo',
  'reel',
  'guide',
  'proof',
];

/**
 * Which axes the panel offers for a section TYPE — all nine, minus `media` on the
 * types that ignore it.
 *
 * A hidden control is not a lost value: a stored `media` override on, say, a
 * `faq` still resolves and still emits its attribute. This only decides what is
 * worth a creator's attention.
 */
export function axesForSectionType(type: string): readonly SectionDesignAxis[] {
  if (MEDIA_AWARE_SECTION_TYPES.includes(type)) return SECTION_DESIGN_AXES;
  return SECTION_DESIGN_AXES.filter((axis) => axis !== 'media');
}

/**
 * Is `value` a legal member of `axis`? A type GUARD, and the reason one exists.
 *
 * A `<select>` hands back a plain `string`, while the store's setter is typed per
 * axis. Without a guard the call site needs a cast — and a cast is exactly how a
 * value that no CSS rule matches reaches the stored bundle and then the
 * `data-jp-*` attribute, which renders as "the control does nothing". This checks
 * against `SECTION_DESIGN_VALUES`, the same list the renderer resolves against,
 * so the compiler is satisfied by a check that actually happened.
 */
export function isAxisValue<A extends SectionDesignAxis>(
  axis: A,
  value: string
): value is NonNullable<SectionDesign[A]> & string {
  return (SECTION_DESIGN_VALUES[axis] as readonly string[]).includes(value);
}

/** The legal values of one axis, paired with their labels, for a control. */
export function axisOptions(
  axis: SectionDesignAxis
): readonly { value: string; label: string }[] {
  return SECTION_DESIGN_VALUES[axis].map((value) => ({
    value: value as string,
    label: AXIS_VALUE_LABELS[axis][value as string] ?? (value as string),
  }));
}
