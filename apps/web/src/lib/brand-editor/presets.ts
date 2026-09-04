import {
  type AtmosphereAxisId,
  composePreset,
  type FormAxisId,
  type PresetPalette,
  type PresetSpec,
  type TypeAxisId,
} from './preset-axes';
import type { BrandPreset } from './types';

/**
 * Built-in brand presets.
 *
 * A preset is NOT a list of token values. It is a palette plus one point on
 * each of three axes — type, form, atmosphere — which `composePreset` expands
 * into the complete `BrandPreset` the store consumes. See `preset-axes.ts` for
 * why (three defects that partial hand-authoring caused, and how composition
 * makes each unrepresentable).
 *
 * Every preset carries VARIANTS: the same palette with one or two axes swapped.
 * `variants[0]` is always the signature — identical to the preset's own
 * top-level values — so the guided mixer can render a uniform row without
 * special-casing the default.
 */

export type PresetCategory =
  | 'Professional'
  | 'Creative'
  | 'Bold'
  | 'Minimal'
  | 'Organic'
  | 'Tech'
  | 'Luxury'
  | 'Playful'
  | 'Atmospheric';

/** The axis coordinates a composed look was built from. */
export interface PresetAxisPoint {
  readonly type: TypeAxisId;
  readonly form: FormAxisId;
  readonly atmosphere: AtmosphereAxisId;
}

/** A sub-preset: one preset's palette, re-pointed on one or two axes. */
export interface PresetVariant extends BrandPreset {
  /** Short label for the variant selector, e.g. "Editorial". */
  readonly label: string;
  /** One line explaining how this variant differs. */
  readonly note: string;
  readonly axes: PresetAxisPoint;
}

export interface CategorizedPreset extends BrandPreset {
  readonly category: PresetCategory;
  /** The signature axis point. Powers the guided mixer's initial state. */
  readonly axes: PresetAxisPoint;
  /** Signature first, then alternates. Never empty. */
  readonly variants: readonly PresetVariant[];
}

// ── Authoring shape ────────────────────────────────────────────────────────

interface VariantSpec {
  readonly label: string;
  readonly note: string;
  readonly type?: TypeAxisId;
  readonly form?: FormAxisId;
  readonly atmosphere?: AtmosphereAxisId;
}

interface PresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: PresetCategory;
  readonly description: string;
  readonly palette: PresetPalette;
  readonly axes: PresetAxisPoint;
  /** Two alternates. The signature is synthesised as `variants[0]`. */
  readonly alternates: readonly [VariantSpec, VariantSpec];
}

function build(def: PresetDefinition): CategorizedPreset {
  const spec = (axes: PresetAxisPoint, id: string): PresetSpec => ({
    id,
    name: def.name,
    description: def.description,
    palette: def.palette,
    ...axes,
  });

  const signature = composePreset(spec(def.axes, def.id));

  const variants: PresetVariant[] = [
    {
      ...signature,
      label: 'Signature',
      note: def.description,
      axes: def.axes,
    },
    ...def.alternates.map((alt) => {
      const axes: PresetAxisPoint = {
        type: alt.type ?? def.axes.type,
        form: alt.form ?? def.axes.form,
        atmosphere: alt.atmosphere ?? def.axes.atmosphere,
      };
      const composed = composePreset(
        spec(axes, `${def.id}.${alt.label.toLowerCase().replace(/\s+/g, '-')}`)
      );
      return {
        ...composed,
        name: `${def.name} · ${alt.label}`,
        description: alt.note,
        label: alt.label,
        note: alt.note,
        axes,
      };
    }),
  ];

  return {
    ...signature,
    category: def.category,
    axes: def.axes,
    variants,
  };
}

// ── Definitions ────────────────────────────────────────────────────────────

const DEFINITIONS: readonly PresetDefinition[] = [
  // ─── Professional ───────────────────────────────────────────────────
  {
    id: 'corporate',
    name: 'Corporate',
    category: 'Professional',
    description: 'Trustworthy and dense — contour lines, tight spacing',
    palette: {
      primary: '#1E40AF',
      secondary: '#4B5563',
      accent: '#059669',
      background: null,
      darkPrimary: '#60A5FA',
      darkBackground: '#0B1220',
      headingIntent: '#1E3A5F',
    },
    axes: { type: 'humanist', form: 'sharp', atmosphere: 'contour' },
    alternates: [
      {
        label: 'Editorial',
        note: 'Serif headlines at a larger scale — annual-report weight',
        type: 'editorial',
        form: 'crisp',
      },
      {
        label: 'Open',
        note: 'Roomier spacing and a softer lift — less buttoned-up',
        form: 'soft',
        atmosphere: 'haze',
      },
    ],
  },
  {
    id: 'executive',
    name: 'Executive',
    category: 'Professional',
    description: 'Refined and authoritative — slate, gold, folded silk',
    palette: {
      primary: '#1E293B',
      secondary: '#64748B',
      accent: '#D97706',
      background: null,
      darkPrimary: '#CBD5E1',
      darkBackground: '#0B1120',
      headingIntent: '#1E293B',
    },
    axes: { type: 'neutral', form: 'sharp', atmosphere: 'drape' },
    alternates: [
      {
        label: 'Classical',
        note: 'Garamond at an airy scale — old-institution confidence',
        type: 'classical',
        form: 'plush',
      },
      {
        label: 'Deep',
        note: 'Aetheric folds and a centred hero — boardroom drama',
        atmosphere: 'voidform',
      },
    ],
  },
  {
    id: 'consulting',
    name: 'Consulting',
    category: 'Professional',
    description: 'Clean, approachable expertise — teal over pale haze',
    palette: {
      primary: '#0D9488',
      secondary: '#6B7280',
      accent: '#F97316',
      background: null,
      darkPrimary: '#2DD4BF',
      darkBackground: '#08201E',
      headingIntent: '#0F766E',
    },
    axes: { type: 'humanist', form: 'crisp', atmosphere: 'haze' },
    alternates: [
      {
        label: 'Grounded',
        note: 'Slab headings and flat elevation — practical, unfussy',
        type: 'slab',
        form: 'flat',
      },
      {
        label: 'Quiet',
        note: 'No animation at all — the content carries the page',
        atmosphere: 'still',
      },
    ],
  },

  // ─── Creative ───────────────────────────────────────────────────────
  {
    id: 'vibrant',
    name: 'Vibrant',
    category: 'Creative',
    description: 'Bold and energetic — drifting orbs, rounded geometry',
    palette: {
      primary: '#7C3AED',
      secondary: '#EC4899',
      accent: '#F59E0B',
      background: null,
      darkPrimary: '#A78BFA',
      darkBackground: '#140B24',
      headingIntent: '#7C3AED',
    },
    axes: { type: 'geometric', form: 'soft', atmosphere: 'bloomlight' },
    alternates: [
      {
        label: 'Poster',
        note: 'Heavy display headlines — gallery-billboard loud',
        type: 'poster',
        form: 'sharp',
      },
      {
        label: 'Electric',
        note: 'Crackling plasma behind the hero — maximum voltage',
        atmosphere: 'charge',
      },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    category: 'Creative',
    description: 'Warm gradient heat — deep field dust and star depth',
    palette: {
      primary: '#E11D48',
      secondary: '#F97316',
      accent: '#FBBF24',
      background: null,
      darkPrimary: '#FB7185',
      darkBackground: '#1A0A10',
      headingIntent: '#BE123C',
    },
    axes: { type: 'geometric', form: 'soft', atmosphere: 'deepfield' },
    alternates: [
      {
        label: 'Film',
        note: 'Analogue grain and heavy vignette — sun-bleached',
        atmosphere: 'grain',
        form: 'crisp',
      },
      {
        label: 'Molten',
        note: 'Lava crust under a slab headline — furnace heat',
        type: 'slab',
        atmosphere: 'forge',
      },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    category: 'Creative',
    description: 'Fresh and clear — caustic light through shallow water',
    palette: {
      primary: '#0284C7',
      secondary: '#0891B2',
      accent: '#34D399',
      background: null,
      darkPrimary: '#38BDF8',
      darkBackground: '#06182A',
      headingIntent: '#0369A1',
    },
    axes: { type: 'neutral', form: 'soft', atmosphere: 'tide' },
    alternates: [
      {
        label: 'Swell',
        note: 'Long rolling waves and roomier spacing — open water',
        atmosphere: 'dunes',
        form: 'plush',
      },
      {
        label: 'Current',
        note: 'Laminar flow lines under grotesk type — kinetic',
        type: 'grotesk',
        atmosphere: 'stream',
      },
    ],
  },

  // ─── Bold ───────────────────────────────────────────────────────────
  {
    id: 'dark',
    name: 'Dark',
    category: 'Bold',
    description: 'Dark-first indigo — aetheric folds, centred hero',
    palette: {
      primary: '#818CF8',
      secondary: '#A78BFA',
      accent: '#FBBF24',
      background: '#0F172A',
      darkPrimary: '#A78BFA',
      darkBackground: '#0B1120',
      headingIntent: '#818CF8',
    },
    axes: { type: 'neutral', form: 'crisp', atmosphere: 'voidform' },
    alternates: [
      {
        label: 'Borealis',
        note: 'Slow curtains of light instead of folds — colder, calmer',
        atmosphere: 'borealis',
      },
      {
        label: 'Grotesk',
        note: 'Technical headlines and square corners — harder edge',
        type: 'grotesk',
        form: 'precise',
      },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'Bold',
    description: 'Near-black with electric cyan — fast banded flux',
    palette: {
      primary: '#22D3EE',
      secondary: '#A3E635',
      accent: '#F472B6',
      background: '#09090B',
      darkPrimary: '#67E8F9',
      darkBackground: '#050505',
      headingIntent: '#22D3EE',
    },
    axes: { type: 'grotesk', form: 'precise', atmosphere: 'current' },
    alternates: [
      {
        label: 'Arcade',
        note: 'Plasma and a poster headline — coin-op energy',
        type: 'poster',
        atmosphere: 'charge',
      },
      {
        label: 'Terminal',
        note: 'Monospace throughout — machine-room readout',
        type: 'mono',
      },
    ],
  },
  {
    id: 'ember',
    name: 'Ember',
    category: 'Bold',
    description: 'Charcoal and fire — molten crust, industrial weight',
    palette: {
      primary: '#DC2626',
      secondary: '#EA580C',
      accent: '#FCD34D',
      background: '#1C1917',
      darkPrimary: '#F87171',
      darkBackground: '#120F0E',
      headingIntent: '#DC2626',
    },
    axes: { type: 'slab', form: 'sharp', atmosphere: 'forge' },
    alternates: [
      {
        label: 'Poster',
        note: 'Archivo Black at scale — protest-print volume',
        type: 'poster',
      },
      {
        label: 'Smoulder',
        note: 'Film grain over a quieter form — banked heat',
        atmosphere: 'grain',
        form: 'flat',
      },
    ],
  },

  // ─── Minimal ────────────────────────────────────────────────────────
  {
    id: 'minimal',
    name: 'Minimal',
    category: 'Minimal',
    description: 'Near-black on white, no animation, almost no elevation',
    palette: {
      primary: '#1A1A1A',
      secondary: '#737373',
      accent: null,
      background: null,
      darkPrimary: '#E5E5E5',
      darkBackground: '#0A0A0A',
      headingIntent: 'auto',
    },
    axes: { type: 'neutral', form: 'flat', atmosphere: 'still' },
    alternates: [
      {
        label: 'Airy',
        note: 'Lighter weights at open spacing — gallery-wall quiet',
        type: 'airy',
        form: 'soft',
      },
      {
        label: 'Haze',
        note: 'One pale cloud drift — motion without noise',
        atmosphere: 'haze',
      },
    ],
  },
  {
    id: 'paper',
    name: 'Paper',
    category: 'Minimal',
    description: 'Warm off-white and stone — serif, flat, still',
    palette: {
      primary: '#78716C',
      secondary: '#A8A29E',
      accent: '#B45309',
      background: '#FAFAF9',
      darkPrimary: '#D6D3D1',
      darkBackground: '#1C1917',
      headingIntent: '#57534E',
    },
    axes: { type: 'editorial', form: 'flat', atmosphere: 'still' },
    alternates: [
      {
        label: 'Alabaster',
        note: 'Pale nacre sheen behind the hero — dark ink over it',
        atmosphere: 'alabaster',
      },
      {
        label: 'Classical',
        note: 'Garamond at a large airy scale — private-press feel',
        type: 'classical',
        form: 'plush',
      },
    ],
  },
  {
    id: 'mono',
    name: 'Mono',
    category: 'Minimal',
    description: 'Pure black and white — square corners, zero colour',
    palette: {
      primary: '#000000',
      secondary: '#525252',
      accent: null,
      background: '#FFFFFF',
      darkPrimary: '#FFFFFF',
      darkBackground: '#0A0A0A',
      headingIntent: 'auto',
    },
    axes: { type: 'mono', form: 'precise', atmosphere: 'still' },
    alternates: [
      {
        label: 'Grotesk',
        note: 'Proportional grotesk headlines over a mono body feel',
        type: 'grotesk',
      },
      {
        label: 'Lattice',
        note: 'A rotating gyroid mesh — structure, still no colour',
        atmosphere: 'lattice',
      },
    ],
  },

  // ─── Organic ────────────────────────────────────────────────────────
  {
    id: 'forest',
    name: 'Forest',
    category: 'Organic',
    description: 'Deep green on pale sage — branching growth, slab type',
    palette: {
      primary: '#14532D',
      secondary: '#854D0E',
      accent: '#65A30D',
      background: '#FAFDF7',
      darkPrimary: '#22C55E',
      darkBackground: '#0C1A0F',
      headingIntent: '#14532D',
    },
    axes: { type: 'slab', form: 'soft', atmosphere: 'canopy' },
    alternates: [
      {
        label: 'Editorial',
        note: 'Serif headlines — field-guide typography',
        type: 'editorial',
      },
      {
        label: 'Rain',
        note: 'Rain on glass instead of growth — quieter, wetter',
        atmosphere: 'drizzle',
        form: 'plush',
      },
    ],
  },
  {
    id: 'desert',
    name: 'Desert',
    category: 'Organic',
    description: 'Terracotta and sand — long rolling swells, serif type',
    palette: {
      primary: '#A0522D',
      secondary: '#92400E',
      accent: '#D97706',
      background: '#FDF8F0',
      darkPrimary: '#D2956B',
      darkBackground: '#1A120B',
      headingIntent: '#78350F',
    },
    axes: { type: 'editorial', form: 'plush', atmosphere: 'dunes' },
    alternates: [
      {
        label: 'Classical',
        note: 'Garamond at a large scale — expedition-journal weight',
        type: 'classical',
      },
      {
        label: 'Heat',
        note: 'Molten crust under the hero — noon rather than dusk',
        atmosphere: 'forge',
        form: 'crisp',
      },
    ],
  },
  {
    id: 'bloom',
    name: 'Bloom',
    category: 'Organic',
    description: 'Rose on blush — pollen adrift, centred hero',
    palette: {
      primary: '#BE185D',
      secondary: '#DB2777',
      accent: '#F472B6',
      background: '#FDF2F8',
      darkPrimary: '#F472B6',
      darkBackground: '#1A0A14',
      headingIntent: '#9D174D',
    },
    axes: { type: 'editorial', form: 'soft', atmosphere: 'driftseed' },
    alternates: [
      {
        label: 'Soft',
        note: 'Rounded display type and pill corners — sweeter',
        type: 'soft',
        form: 'pill',
      },
      {
        label: 'Bloom',
        note: 'Drifting orbs instead of pollen — warmer light',
        atmosphere: 'bloomlight',
      },
    ],
  },

  // ─── Tech ───────────────────────────────────────────────────────────
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'Tech',
    description: 'Phosphor green on black — monospace, square corners',
    palette: {
      primary: '#4ADE80',
      secondary: '#86EFAC',
      accent: '#FDE047',
      background: '#0A0A0A',
      darkPrimary: '#4ADE80',
      darkBackground: '#050505',
      headingIntent: '#4ADE80',
    },
    axes: { type: 'mono', form: 'precise', atmosphere: 'spores' },
    alternates: [
      {
        label: 'Lattice',
        note: 'A gyroid mesh instead of agent trails — colder geometry',
        atmosphere: 'lattice',
      },
      {
        label: 'Grotesk',
        note: 'Proportional headlines — less retro, more product',
        type: 'grotesk',
        form: 'sharp',
      },
    ],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    category: 'Tech',
    description: 'Draughtsman blue on pale — gyroid lattice, zero radius',
    palette: {
      primary: '#1E3A8A',
      secondary: '#3B82F6',
      accent: '#60A5FA',
      background: '#EFF6FF',
      darkPrimary: '#60A5FA',
      darkBackground: '#0A1628',
      headingIntent: '#1E3A8A',
    },
    axes: { type: 'mono', form: 'precise', atmosphere: 'lattice' },
    alternates: [
      {
        label: 'Humanist',
        note: 'Open sans throughout — documentation rather than drawing',
        type: 'humanist',
        form: 'sharp',
      },
      {
        label: 'Contour',
        note: 'Topographic lines — survey rather than schematic',
        atmosphere: 'contour',
      },
    ],
  },
  {
    id: 'gradient',
    name: 'Gradient',
    category: 'Tech',
    description: 'Violet to cyan — laminar flow, centred hero',
    palette: {
      primary: '#8B5CF6',
      secondary: '#06B6D4',
      accent: '#F472B6',
      background: null,
      darkPrimary: '#A78BFA',
      darkBackground: '#0D0A1F',
      headingIntent: '#7C3AED',
    },
    axes: { type: 'grotesk', form: 'crisp', atmosphere: 'stream' },
    alternates: [
      {
        label: 'Bloom',
        note: 'Soft orbs and generous radius — friendlier SaaS',
        atmosphere: 'bloomlight',
        form: 'soft',
      },
      {
        label: 'Flux',
        note: 'Fast banded flux — launch-day energy',
        atmosphere: 'current',
      },
    ],
  },

  // ─── Luxury ─────────────────────────────────────────────────────────
  {
    id: 'onyx',
    name: 'Onyx',
    category: 'Luxury',
    description: 'Antique gold on true black — bismuth facets, garamond',
    palette: {
      primary: '#B8860B',
      secondary: '#D4A843',
      accent: '#F5DEB3',
      background: '#0C0A09',
      darkPrimary: '#D4A843',
      darkBackground: '#080706',
      headingIntent: '#B8860B',
    },
    axes: { type: 'classical', form: 'plush', atmosphere: 'facet' },
    alternates: [
      {
        label: 'Editorial',
        note: 'Playfair headlines at a tighter scale — fashion masthead',
        type: 'editorial',
        form: 'crisp',
      },
      {
        label: 'Drape',
        note: 'Folded silk instead of mineral facets — softer luxury',
        atmosphere: 'drape',
      },
    ],
  },
  {
    id: 'marble',
    name: 'Marble',
    category: 'Luxury',
    description: 'Stone greys on warm white — pale nacre, dark hero ink',
    palette: {
      primary: '#292524',
      secondary: '#57534E',
      accent: '#A8A29E',
      background: '#FAFAF9',
      darkPrimary: '#D6D3D1',
      darkBackground: '#1C1917',
      headingIntent: '#292524',
    },
    axes: { type: 'classical', form: 'plush', atmosphere: 'alabaster' },
    alternates: [
      {
        label: 'Facet',
        note: 'Iridescent bismuth terraces — mineral rather than milky',
        atmosphere: 'facet',
      },
      {
        label: 'Airy',
        note: 'Light sans at open spacing — modern gallery',
        type: 'airy',
        form: 'flat',
      },
    ],
  },
  {
    id: 'velvet',
    name: 'Velvet',
    category: 'Luxury',
    description: 'Lilac on deep indigo — folded silk, centred hero',
    palette: {
      primary: '#A78BFA',
      secondary: '#8B5CF6',
      accent: '#C4B5FD',
      background: '#1E1B4B',
      darkPrimary: '#C4B5FD',
      darkBackground: '#0F0D2E',
      headingIntent: '#C4B5FD',
    },
    axes: { type: 'editorial', form: 'plush', atmosphere: 'drape' },
    alternates: [
      {
        label: 'Classical',
        note: 'Garamond at maximum scale — opera-programme elegance',
        type: 'classical',
      },
      {
        label: 'Borealis',
        note: 'Curtains of light instead of silk — colder, wider',
        atmosphere: 'borealis',
      },
    ],
  },

  // ─── Playful ────────────────────────────────────────────────────────
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    category: 'Playful',
    description: 'Hot pink and amber — rounded display type, pill corners',
    palette: {
      primary: '#EC4899',
      secondary: '#F472B6',
      accent: '#FBBF24',
      background: null,
      darkPrimary: '#F9A8D4',
      darkBackground: '#1F0A16',
      headingIntent: '#DB2777',
    },
    axes: { type: 'soft', form: 'pill', atmosphere: 'bloomlight' },
    alternates: [
      {
        label: 'Poster',
        note: 'Archivo Black instead of rounded — sticker-print punch',
        type: 'poster',
        form: 'soft',
      },
      {
        label: 'Charge',
        note: 'Plasma behind the hero — sugar rush',
        atmosphere: 'charge',
      },
    ],
  },
  {
    id: 'retro',
    name: 'Retro',
    category: 'Playful',
    description: 'Burnt orange on cream — film grain, poster headlines',
    palette: {
      primary: '#EA580C',
      secondary: '#DC2626',
      accent: '#FBBF24',
      background: '#FFFBEB',
      darkPrimary: '#FB923C',
      darkBackground: '#1A1207',
      headingIntent: '#9A3412',
    },
    axes: { type: 'poster', form: 'sharp', atmosphere: 'grain' },
    alternates: [
      {
        label: 'Slab',
        note: 'Slab headings instead of display — newsprint rather than poster',
        type: 'slab',
        form: 'flat',
      },
      {
        label: 'Sunset',
        note: 'Deep-field dust — drive-in rather than darkroom',
        atmosphere: 'deepfield',
      },
    ],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    category: 'Playful',
    description: 'Electric blue and lime — crackling plasma, poster type',
    palette: {
      primary: '#3B82F6',
      secondary: '#A3E635',
      accent: '#F472B6',
      background: '#0F172A',
      darkPrimary: '#60A5FA',
      darkBackground: '#080E1F',
      headingIntent: '#3B82F6',
    },
    axes: { type: 'poster', form: 'crisp', atmosphere: 'charge' },
    alternates: [
      {
        label: 'Mono',
        note: 'Fixed-width throughout — high-score-table exact',
        type: 'mono',
        form: 'precise',
      },
      {
        label: 'Flux',
        note: 'Banded flux instead of plasma — smoother, faster',
        atmosphere: 'current',
      },
    ],
  },

  // ─── Atmospheric ────────────────────────────────────────────────────
  {
    id: 'midnight',
    name: 'Midnight',
    category: 'Atmospheric',
    description: 'Slate and sky on navy — slow aurora, centred hero',
    palette: {
      primary: '#94A3B8',
      secondary: '#64748B',
      accent: '#38BDF8',
      background: '#0F172A',
      darkPrimary: '#CBD5E1',
      darkBackground: '#0A0F1F',
      headingIntent: '#CBD5E1',
    },
    axes: { type: 'airy', form: 'soft', atmosphere: 'borealis' },
    alternates: [
      {
        label: 'Deep field',
        note: 'Dust and stars instead of curtains — vaster',
        atmosphere: 'deepfield',
      },
      {
        label: 'Editorial',
        note: 'Serif headlines — long-read at night',
        type: 'editorial',
        form: 'plush',
      },
    ],
  },
  {
    id: 'storm',
    name: 'Storm',
    category: 'Atmospheric',
    description: 'Cobalt on gunmetal — a tightening vortex, crisp form',
    palette: {
      primary: '#2563EB',
      secondary: '#1D4ED8',
      accent: '#FBBF24',
      background: '#1F2937',
      darkPrimary: '#60A5FA',
      darkBackground: '#111827',
      headingIntent: '#93C5FD',
    },
    axes: { type: 'grotesk', form: 'crisp', atmosphere: 'maelstrom' },
    alternates: [
      {
        label: 'Rain',
        note: 'Rain on glass — the aftermath rather than the front',
        atmosphere: 'drizzle',
        form: 'soft',
      },
      {
        label: 'Slab',
        note: 'Slab headings and tight spacing — bulletin urgency',
        type: 'slab',
        form: 'sharp',
      },
    ],
  },
  {
    id: 'zen',
    name: 'Zen',
    category: 'Atmospheric',
    description: 'Sage and brass on parchment — rain on glass, serif type',
    palette: {
      primary: '#6B8F71',
      secondary: '#8FAE92',
      accent: '#D4A843',
      background: '#FEFCE8',
      darkPrimary: '#8FAE92',
      darkBackground: '#1A1A0E',
      headingIntent: '#5F7A63',
    },
    axes: { type: 'editorial', form: 'soft', atmosphere: 'drizzle' },
    alternates: [
      {
        label: 'Still',
        note: 'No animation — the emptiest version of the page',
        atmosphere: 'still',
        form: 'flat',
      },
      {
        label: 'Canopy',
        note: 'Slow branching growth — the garden rather than the rain',
        atmosphere: 'canopy',
      },
    ],
  },
];

/**
 * The `/* @__PURE__ *​/` annotation is load-bearing, not decoration.
 *
 * This used to be a plain literal array, which Rollup could shake out of the
 * `$lib/brand-editor` barrel for any importer that did not name it. Composing
 * turned it into a module-scope CALL, and Rollup cannot prove `.map(build)` is
 * side-effect free — so it became a retained side effect, dragging `build` →
 * `composePreset` → `preset-axes` → `shader-config` into every chunk that
 * touches the barrel.
 *
 * That is not hypothetical: the barrel is imported by 26 files, two of them
 * public routes. `(auth)/+layout.svelte` imports it for
 * `tokenOverridesToCssVars` / `parseDarkColorOverrides` alone, and measuring
 * the built manifest showed route node 2 — the layout behind /login,
 * /register, /forgot-password, /reset-password and /verify-email — statically
 * reaching the 46.7KB chunk these presets live in.
 *
 * The annotation tells Rollup the call is safe to drop when nothing reads
 * `BRAND_PRESETS`, restoring the shakeability the literal had. Verified by
 * rebuilding and re-running the reachability walk over
 * `.svelte-kit/output/client/.vite/manifest.json`; keep it on any future
 * module-scope composition here.
 */
export const BRAND_PRESETS: readonly CategorizedPreset[] =
  /* @__PURE__ */ DEFINITIONS.map(build);

/** Category display order for the guided flow and the presets level. */
export const PRESET_CATEGORY_ORDER: readonly PresetCategory[] = [
  'Professional',
  'Creative',
  'Bold',
  'Minimal',
  'Organic',
  'Tech',
  'Luxury',
  'Playful',
  'Atmospheric',
];

/** Look up a preset by id. Variants are addressed as `parent.variant-label`. */
export function findPreset(id: string): CategorizedPreset | undefined {
  return BRAND_PRESETS.find((p) => p.id === id);
}
