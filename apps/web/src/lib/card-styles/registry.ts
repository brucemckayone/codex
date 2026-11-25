/**
 * The card styles an org can pick in the brand editor (Codex-7104r), with the
 * dials each one exposes. A typed port of the card-styles design gallery's
 * style registries and dial kit: the same props, defaults, ranges and AA
 * floors its contrast checker measured.
 *
 * A dial is a custom property the style's own CSS already reads
 * (`lib/styles/card-styles/<id>.css` declares its default on `.sc`). An org's
 * value is STORED as an option id or a plain number under
 * `card-dial-<style>-<dial>` and turned into CSS only here, so a stored value
 * can never inject CSS: `resolve.ts` whitelists option ids and clamps numbers
 * to the range (whose `min` IS the gallery's measured AA floor, where it has
 * one) before anything reaches the page.
 *
 * 'today' is the platform's own card markup: it has no dials.
 */
import type { CardStyle } from '@codex/validation';

/** A number on a slider. `min` is the AA floor where `floor` is set. */
export interface RangeDial {
  readonly kind: 'range';
  /** The key suffix and the prop without `--card-`: `glass-opacity`. */
  readonly id: string;
  readonly prop: `--card-${string}`;
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** What the CSS reads: `74%` ('%') or a bare `0.72` (''). */
  readonly unit: '%' | '';
  /** How the editor words the value: 74% · 72% (of 1) · ×1.25 · 60°. */
  readonly show: 'unit' | 'pct' | 'times' | 'deg';
  /** The gallery's measured contrast floor (equal to `min`), when it has one. */
  readonly floor?: number;
}

export interface DialOption {
  readonly id: string;
  readonly label: string;
  /** The CSS value; null = the style's own default (nothing is set). */
  readonly css: string | null;
}

/** A few named choices: segmented buttons, or token stops on a slider. */
export interface ChoiceDial {
  readonly kind: 'choice';
  readonly id: string;
  readonly prop: `--card-${string}`;
  readonly label: string;
  readonly control: 'segmented' | 'steps';
  /** The default option's id. */
  readonly default: string;
  readonly options: readonly DialOption[];
}

export type CardDial = RangeDial | ChoiceDial;

export type CardStyleGroup = 'glass' | 'image' | 'print' | 'soft' | 'base';

export interface CardStyleMeta {
  readonly id: CardStyle;
  readonly name: string;
  /** One line for the picker. */
  readonly idea: string;
  readonly group: CardStyleGroup;
  readonly dials: readonly CardDial[];
}

/** The picker's groups, in order, as the gallery's start page has them. */
export const CARD_STYLE_GROUPS: readonly {
  id: CardStyleGroup;
  label: string;
}[] = [
  { id: 'glass', label: 'Glass family' },
  { id: 'image', label: 'Image first' },
  { id: 'print', label: 'Print and editorial' },
  { id: 'soft', label: 'Soft, tonal and bold' },
  { id: 'base', label: 'Baseline' },
];

// ── Dial helpers: the gallery's dial-kit.js, typed ─────────────────────────

const propId = (prop: `--card-${string}`) => prop.slice('--card-'.length);

/** A percentage the CSS reads with its unit (e.g. inside color-mix). */
function pct(
  prop: `--card-${string}`,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 1,
  floor?: number
): RangeDial {
  return {
    kind: 'range',
    id: propId(prop),
    prop,
    label,
    default: def,
    min: floor ?? min,
    max,
    step,
    unit: '%',
    show: 'unit',
    ...(floor != null ? { floor } : {}),
  };
}

/** A 0–1 number the CSS reads bare; worded as a percentage. */
function frac(
  prop: `--card-${string}`,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 0.01,
  floor?: number
): RangeDial {
  return {
    kind: 'range',
    id: propId(prop),
    prop,
    label,
    default: def,
    min: floor ?? min,
    max,
    step,
    unit: '',
    show: 'pct',
    ...(floor != null ? { floor } : {}),
  };
}

/** A multiplier (× the brand radius, × a size). */
function times(
  prop: `--card-${string}`,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 0.25
): RangeDial {
  return {
    kind: 'range',
    id: propId(prop),
    prop,
    label,
    default: def,
    min,
    max,
    step,
    unit: '',
    show: 'times',
  };
}

/** A bare number of degrees (used inside oklch()'s relative syntax). */
function deg(
  prop: `--card-${string}`,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 5
): RangeDial {
  return {
    kind: 'range',
    id: propId(prop),
    prop,
    label,
    default: def,
    min,
    max,
    step,
    unit: '',
    show: 'deg',
  };
}

/** A cover / frame shape. Ratios are written '16 / 9'; their ids '16x9'. */
function ratio(
  prop: `--card-${string}`,
  label: string,
  def: string,
  options: readonly string[]
): ChoiceDial {
  const id = (r: string) => r.replace(/\s*\/\s*/, 'x');
  return {
    kind: 'choice',
    id: propId(prop),
    prop,
    label,
    control: 'segmented',
    default: id(def),
    options: options.map((r) => ({
      id: id(r),
      label: r.replace(/\s*\/\s*/, ':'),
      css: r,
    })),
  };
}

/** Space-token stops: ids are the token keys ('1-5' is --space-1-5, 6px). */
function space(
  prop: `--card-${string}`,
  label: string,
  def: string,
  keys: readonly string[]
): ChoiceDial {
  return {
    kind: 'choice',
    id: propId(prop),
    prop,
    label,
    control: 'steps',
    default: def,
    options: keys.map((k) => ({
      id: k,
      label: `${Number(k.replace('-', '.')) * 4}px`,
      css: `var(--space-${k})`,
    })),
  };
}

const BLUR_LABEL: Record<string, string> = {
  sm: 'Faint',
  md: 'Light',
  lg: 'Medium',
  xl: 'Strong',
  '2xl': 'Deep',
};

/** Blur-token stops. */
function blur(
  prop: `--card-${string}`,
  label: string,
  def: string,
  keys: readonly string[] = ['sm', 'md', 'lg', 'xl', '2xl']
): ChoiceDial {
  return {
    kind: 'choice',
    id: propId(prop),
    prop,
    label,
    control: 'steps',
    default: def,
    options: keys.map((k) => ({
      id: k,
      label: BLUR_LABEL[k] ?? k,
      css: `var(--blur-${k})`,
    })),
  };
}

/** Card shadow: the style's own, none, or a platform elevation. */
function shadow(
  prop: `--card-${string}` = '--card-shadow',
  label = 'Shadow'
): ChoiceDial {
  return {
    kind: 'choice',
    id: propId(prop),
    prop,
    label,
    control: 'segmented',
    default: 'default',
    options: [
      { id: 'default', label: 'Style’s own', css: null },
      { id: 'none', label: 'None', css: 'none' },
      { id: 'sm', label: 'Small', css: 'var(--shadow-sm)' },
      { id: 'lg', label: 'Large', css: 'var(--shadow-lg)' },
    ],
  };
}

/** A colour strength: the same mix the CSS writes, at a few named weights. */
function mix(
  prop: `--card-${string}`,
  label: string,
  of: `--${string}`,
  def: number,
  weights: readonly (readonly [string, number])[]
): ChoiceDial {
  return {
    kind: 'choice',
    id: propId(prop),
    prop,
    label,
    control: 'segmented',
    default: 'default',
    options: [
      { id: 'default', label: `Default (${def}%)`, css: null },
      ...weights.map(([name, w]) => ({
        id: name.toLowerCase(),
        label: `${name} (${w}%)`,
        css: `color-mix(in oklab, var(${of}) ${w}%, transparent)`,
      })),
    ],
  };
}

/** The corner dial every style shares (× the brand radius; each style caps it). */
const corners = (def = 1, max = 2) =>
  times('--card-radius-scale', 'Corner roundness', def, 0, max, 0.25);

const WIDE = ['16 / 9', '3 / 2', '4 / 5', '1 / 1'] as const;
const TALL = ['4 / 5', '1 / 1', '3 / 2', '16 / 9'] as const;

// ── The styles, in picker order (CARD_STYLES) ───────────────────────────────

const STYLES: readonly CardStyleMeta[] = [
  {
    id: 'today',
    name: 'Today',
    idea: 'The platform’s own cards: title-in-cover tiles and a bordered portal card.',
    group: 'base',
    dials: [],
  },
  {
    id: 'glass-sheet',
    name: 'Glass sheet',
    idea: 'Cover on top; a real glass sheet over its blurred colour carries the words.',
    group: 'glass',
    dials: [
      pct('--card-glass-opacity', 'Glass strength', 74, 74, 96, 1, 74),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 9', WIDE),
      corners(1),
      shadow(),
    ],
  },
  {
    id: 'frost',
    name: 'Frost',
    idea: 'The photo is the card; it melts into a thin band of milky frost (pale by day, soft smoke by night).',
    group: 'glass',
    dials: [
      frac('--card-frost-opacity', 'Frost strength', 0.72, 0.5, 0.95),
      blur('--card-frost-blur', 'Frost blur', '2xl'),
      space('--card-melt', 'Melt into the frost', '10', [
        '4',
        '6',
        '8',
        '10',
        '14',
      ]),
      ratio('--card-cover-ratio', 'Card shape', '4 / 5', TALL),
      corners(1),
    ],
  },
  {
    id: 'floating-sheet',
    name: 'Floating sheet',
    idea: 'The cover fills the card; a glass widget floats inset over it, concentric corners, a solid CTA.',
    group: 'glass',
    dials: [
      frac('--card-glass-opacity', 'Glass density', 0.7, 0.5, 0.95),
      blur('--card-glass-blur', 'Glass blur', 'xl'),
      space('--card-inset', 'Float from the edge', '2', [
        '1',
        '1-5',
        '2',
        '3',
        '4',
      ]),
      ratio('--card-cover-ratio', 'Card shape', '4 / 5', TALL),
      corners(1),
    ],
  },
  {
    id: 'prism',
    name: 'Prism',
    idea: 'A light crystal sheet with a refractive edge: a hue-shifted prism rim and a chromatic glint on top.',
    group: 'glass',
    dials: [
      frac('--card-glass-opacity', 'Glass smoke', 0.68, 0.5, 0.9),
      deg('--card-prism-spread', 'Rim colour spread', 60, 0, 120),
      frac('--card-prism-strength', 'Rim brightness', 0.9, 0, 1, 0.05),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 9', WIDE),
      corners(1),
    ],
  },
  {
    id: 'stained',
    name: 'Stained',
    idea: 'Brand-coloured glass: the cover glows through a stained, domed panel; the card casts coloured light.',
    group: 'glass',
    dials: [
      times('--card-tint-strength', 'Stain colour', 1, 0, 1.4, 0.1),
      frac('--card-glass-opacity', 'Glass density', 0.86, 0.7, 0.98),
      frac('--card-glow', 'Glow under the dome', 0.2, 0, 0.6, 0.05),
      ratio('--card-cover-ratio', 'Cover shape', '3 / 2', [
        '3 / 2',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
  {
    id: 'smoke',
    name: 'Smoke',
    idea: 'Always-dark cinematic smoked glass for media-heavy orgs; the brand only glints on the CTA.',
    group: 'glass',
    dials: [
      frac('--card-smoke-opacity', 'Smoke density', 0.84, 0.7, 0.98),
      frac('--card-glint', 'Brand glint', 0.55, 0, 1, 0.05),
      space('--card-melt', 'Melt into the smoke', '10', [
        '4',
        '6',
        '8',
        '10',
        '14',
      ]),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 9', WIDE),
      corners(1),
    ],
  },
  {
    id: 'clear-glass',
    name: 'Clear glass',
    idea: 'The image is the whole card; the words float on one slim, clear-glass capsule.',
    group: 'glass',
    dials: [
      frac('--card-glass-opacity', 'Glass smoke', 0.4, 0.4, 0.8, 0.02, 0.4),
      frac(
        '--card-dim',
        'Dimming under the words',
        0.52,
        0.52,
        0.85,
        0.01,
        0.52
      ),
      ratio('--card-cover-ratio', 'Card shape', '4 / 5', TALL),
      space('--card-inset', 'Float from the edge', '2', [
        '1',
        '1-5',
        '2',
        '3',
        '4',
      ]),
      corners(1),
    ],
  },
  {
    id: 'cinema',
    name: 'Cinema',
    idea: 'Artwork first, edge to edge; a quiet title below; deep scrims, no chrome.',
    group: 'image',
    dials: [
      pct('--card-scrim-depth', 'Scrim depth', 84, 80, 96, 1, 80),
      ratio('--card-cover-ratio', 'Art shape (wide)', '16 / 9', WIDE),
      ratio('--card-hero-ratio', 'Hero shape', '4 / 5', [
        '4 / 5',
        '1 / 1',
        '3 / 2',
        '16 / 9',
      ]),
      corners(1),
    ],
  },
  {
    id: 'album',
    name: 'Album',
    idea: 'A music shelf: square art carries it, small type below, a floating glass play / continue button.',
    group: 'image',
    dials: [
      space('--card-button', 'Button size', '10', ['8', '9', '10', '12', '14']),
      ratio('--card-cover-ratio', 'Art shape', '1 / 1', [
        '1 / 1',
        '4 / 5',
        '16 / 9',
      ]),
      corners(1),
      shadow('--card-art-shadow', 'Art shadow'),
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    idea: 'Each cover floats in its own light: brand-derived glows halo behind it, on a plain body.',
    group: 'image',
    dials: [
      times('--card-glow', 'Glow', 1, 0, 1.4, 0.1),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 10', [
        '16 / 10',
        '16 / 9',
        '4 / 5',
        '1 / 1',
      ]),
      corners(1),
    ],
  },
  {
    id: 'duotone',
    name: 'Duotone',
    idea: 'Every cover remapped into the brand’s two colours, so any art reads as one family.',
    group: 'image',
    dials: [
      frac('--card-duotone', 'Duotone strength', 1, 0, 1, 0.05),
      ratio('--card-cover-ratio', 'Cover shape', '4 / 3', [
        '4 / 3',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
  {
    id: 'editorial',
    name: 'Editorial',
    idea: 'A magazine page: no card body, type as the hero, hairline rules.',
    group: 'print',
    dials: [
      times('--card-title-scale', 'Title size', 1, 0.85, 1.3, 0.05),
      ratio('--card-cover-ratio', 'Frame shape', '3 / 2', [
        '3 / 2',
        '16 / 9',
        '4 / 5',
        '1 / 1',
      ]),
      mix('--card-rule', 'Rule strength', '--color-text', 24, [
        ['Faint', 12],
        ['Strong', 40],
      ]),
      corners(1, 3),
    ],
  },
  {
    id: 'gallery-mat',
    name: 'Gallery mat',
    idea: 'A museum print: the image in an even mat with a fine bevel, a wall label below.',
    group: 'print',
    dials: [
      space('--card-mat', 'Mat width', '3', ['1', '2', '3', '4', '6']),
      pct('--card-mat-tint', 'Mat tint', 5, 0, 20),
      ratio('--card-cover-ratio', 'Window shape', '4 / 3', [
        '4 / 3',
        '3 / 2',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
  {
    id: 'index',
    name: 'Index',
    idea: 'A library catalogue card: a short image band, a margin rule, a large title, a spec line.',
    group: 'print',
    dials: [
      ratio('--card-band-ratio', 'Image band', '5 / 2', [
        '5 / 2',
        '3 / 1',
        '2 / 1',
        '16 / 9',
      ]),
      times('--card-title-scale', 'Title size', 1, 0.85, 1.3, 0.05),
      mix('--card-margin-rule', 'Margin line', '--color-brand-primary', 55, [
        ['Faint', 30],
        ['Strong', 85],
      ]),
      corners(1),
    ],
  },
  {
    id: 'pass',
    name: 'Pass',
    idea: 'A ticket: the cover is the face, a notched tear line, a brand-colour stub with the value and CTA.',
    group: 'print',
    dials: [
      space('--card-stub', 'Stub height', '16', ['12', '14', '16', '20', '24']),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 10', [
        '16 / 10',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
  {
    id: 'soft',
    name: 'Soft',
    idea: 'Wellness-soft: a pastel brand surface, big round corners, a hill of colour over the image.',
    group: 'soft',
    dials: [
      pct('--card-tint', 'Surface tint', 20, 6, 36),
      times('--card-radius-scale', 'Corner roundness', 2.5, 0, 4, 0.25),
      times('--card-hill', 'Hill height', 1, 0, 2, 0.25),
      ratio('--card-cover-ratio', 'Image shape', '4 / 3', [
        '4 / 3',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
    ],
  },
  {
    id: 'tonal',
    name: 'Tonal',
    idea: 'Material-3 tonal: surfaces lift by tint, never shadow; one expressive corner.',
    group: 'soft',
    dials: [
      pct('--card-tone', 'Tone', 12, 4, 28),
      times('--card-corner-scale', 'Expressive corner', 4, 1, 6, 0.5),
      corners(1),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 9', WIDE),
    ],
  },
  {
    id: 'bento',
    name: 'Bento',
    idea: 'Soft tonal tiles; the image a rounded panel in the top; the featured card is the deep-toned hero tile.',
    group: 'soft',
    dials: [
      pct('--card-tile-tint', 'Tile tint', 6, 0, 20),
      space('--card-gutter', 'Gutter', '2', ['0', '1', '2', '3', '4']),
      ratio('--card-cover-ratio', 'Panel shape', '4 / 3', [
        '4 / 3',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
  {
    id: 'hard-shadow',
    name: 'Hard shadow',
    idea: 'Tasteful neo-brutalism: flat, a hairline in deep brand ink, a solid brand-colour offset shadow; stickers.',
    group: 'soft',
    dials: [
      space('--card-shadow-offset', 'Shadow offset', '1-5', [
        '0-5',
        '1',
        '1-5',
        '2',
        '3',
      ]),
      pct('--card-shadow-mix', 'Shadow brand colour', 100, 40, 100, 5),
      ratio('--card-cover-ratio', 'Cover shape', '16 / 10', [
        '16 / 10',
        '16 / 9',
        '1 / 1',
        '4 / 5',
      ]),
      corners(1),
    ],
  },
];

/** Every style's name, idea, group and dials, by id. */
export const CARD_STYLE_REGISTRY: Readonly<Record<CardStyle, CardStyleMeta>> =
  Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<
    CardStyle,
    CardStyleMeta
  >;

/** The styles in picker order. */
export const CARD_STYLE_LIST: readonly CardStyleMeta[] = STYLES;

/** How the editor words a range dial's value. */
export function formatDialValue(dial: RangeDial, value: number): string {
  switch (dial.show) {
    case 'unit':
      return `${value}${dial.unit}`;
    case 'pct':
      return `${Math.round(value * 100)}%`;
    case 'times':
      return `×${value}`;
    case 'deg':
      return `${value}°`;
  }
}
