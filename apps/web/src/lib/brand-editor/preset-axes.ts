/**
 * Preset Axes — the composable vocabulary behind every built-in brand preset.
 *
 * WHY THIS EXISTS
 * ---------------
 * The editor can write 33 non-shader `--brand-*` inputs (BRAND_PREFIX_KEYS in
 * css-injection.ts). Presets used to hand-author between 3 and 10 of them each,
 * which produced three concrete defects:
 *
 *  1. UNIFORM WHERE IT SHOULD DIFFER. `text-scale`, `heading-weight`,
 *     `body-weight`, `shadow-scale` and `shadow-color` were set by NO preset,
 *     so a Cormorant-Garamond luxury brand and a JetBrains-Mono terminal brand
 *     rendered at identical weight, scale and elevation. The fonts changed; the
 *     typography did not.
 *
 *  2. ILLEGIBLE IN DARK MODE. org-brand.css derives the dark heading colour as
 *     `var(--brand-heading-color-dark, var(--brand-heading-color, …))` — the
 *     dark slot falls back to the LIGHT value. 22 presets set a light
 *     `heading-color` and none set a dark one, so `executive` shipped #1E293B
 *     headings on a #262626 dark surface: 1.03:1, invisible. Eleven presets
 *     failed below 3:1.
 *
 *  3. CROSS-PRESET BLEED. `applyPreset` MERGES token overrides (deliberately —
 *     Codex-oqv3r — so user fine-tunes survive preset browsing). A key one
 *     preset sets and the next does not is therefore INHERITED. Partial
 *     coverage meant clicking Corporate → Minimal left Corporate's tokens
 *     behind, and no preset ever rendered as authored.
 *
 * All three share one root cause: values were authored per preset instead of
 * derived from a design decision. So a preset here does not list tokens. It
 * names one point on each of four axes:
 *
 *     palette     — the four brand colours (the preset's identity)
 *     type        — font pairing + scale + weights + label casing
 *     form        — radius, density, elevation, hover response
 *     atmosphere  — the hero: shader, its parameters, and the hero ink
 *
 * `composePreset` expands that point into the flat `BrandPreset` the store
 * already consumes, filling EVERY design key — so defect 3 cannot recur — and
 * DERIVING both theme variants of every contrast-critical colour, so defect 2
 * cannot recur. `presets.test.ts` locks both properties.
 *
 * WHAT IS DELIBERATELY NOT SET
 * ----------------------------
 * The ten `player-*` keys. The player is chrome over video — always a dark
 * surface regardless of brand — and org-brand.css already derives correct
 * white-on-dark values for it (lines 171-180, mirrored for dark at 439-448).
 * Writing brand colours there would tint text over footage that the brand does
 * not control. An org can still override them by hand in fine-tune; a preset
 * asserting a value would be a guess dressed as a design.
 */
import { DEFAULTS } from '$lib/components/ui/ShaderHero/shader-config';
import { hexToOklch, oklchToHex } from './oklch-math';
import type { BrandPreset } from './types';

// ── Contrast primitives ────────────────────────────────────────────────────
// Duplicated rather than imported from components/brand-studio/rail/contrast.ts
// on purpose: this module is imported by the store, and the store must not pull
// in component-tree code. `presets.test.ts` asserts the two implementations
// agree, so the duplication cannot silently diverge.

/** WCAG 2.x AA floor for normal-size text. Headings are held to this, not the
 *  3:1 large-text allowance — `--color-heading` also paints h3/h4 at body size. */
export const AA_TEXT_CONTRAST = 4.5;

/** OKLCH lightness at which org-brand.css flips text-on-brand white → black. */
const TEXT_ON_BRAND_PIVOT = 0.62;

function linearise(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance, or null for an unparseable hex. */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => linearise(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio in 1…21, or null if either hex is unparseable. */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The foreground the product auto-places on a brand-coloured surface. Mirrors
 * the org-brand.css OKLCH rule exactly: white below the lightness pivot, black
 * at or above it.
 */
export function inkOn(backgroundHex: string): string {
  const oklch = hexToOklch(backgroundHex);
  if (!oklch) return '#FFFFFF';
  return oklch.l < TEXT_ON_BRAND_PIVOT ? '#FFFFFF' : '#000000';
}

/**
 * Whichever of white/black actually contrasts better with `backgroundHex`.
 *
 * WHY THIS IS NOT `inkOn`
 * -----------------------
 * `inkOn` faithfully mirrors the product's auto-placement rule, which flips at
 * a single OKLCH LIGHTNESS threshold. But WCAG contrast is a ratio of relative
 * LUMINANCE, and one lightness threshold cannot track a luminance ratio across
 * hues. Saturated greens and teals in the 0.58–0.64 lightness band are exactly
 * where the two disagree: `#059669` has l = 0.596, so the rule picks white at
 * 3.77:1 when black would have given 5.57:1 — a sub-AA label on the Corporate
 * preset's hero CTA.
 *
 * Where the product auto-places text we have to live with its rule (and
 * `inkOn` is how a readout tells the truth about it). Where a preset writes
 * `--brand-hero-cta-text` EXPLICITLY, we get to choose, and choosing the better
 * of the same two colours is strictly better with no new vocabulary. The pivot
 * itself is a separate defect in `--color-text-on-brand`; this does not paper
 * over it, it just declines to reproduce it.
 */
export function bestInkOn(backgroundHex: string): string {
  const white = contrast('#FFFFFF', backgroundHex);
  const black = contrast('#000000', backgroundHex);
  if (white === null || black === null) return '#FFFFFF';
  return white >= black ? '#FFFFFF' : '#000000';
}

/**
 * Nudge `intentHex` along OKLCH lightness — preserving hue, and chroma as far
 * as the gamut allows — until it clears `min` contrast against `surfaceHex`.
 *
 * This is the structural fix for defect 2. A preset author states the hue they
 * want a heading to carry; the machine guarantees it is readable on the surface
 * it will actually land on, in each theme. Hue is what reads as "brand"; the
 * exact lightness is not a design decision worth shipping an invisible heading
 * for.
 *
 * Walks AWAY from the surface (lighter on a dark surface, darker on a light
 * one) in 1% steps. Returns the best candidate found; if even pure white or
 * pure black cannot clear `min` — impossible for a mid-grey surface, which is
 * why the caller must never pass one — the extreme is returned rather than an
 * unreadable original.
 */
export function readableOn(
  intentHex: string,
  surfaceHex: string,
  min: number = AA_TEXT_CONTRAST
): string {
  const current = contrast(intentHex, surfaceHex);
  if (current !== null && current >= min) return intentHex;

  const intent = hexToOklch(intentHex);
  const surface = hexToOklch(surfaceHex);
  if (!intent || !surface) return intentHex;

  // Walk towards whichever pole is further from the surface.
  const goLighter = surface.l < 0.5;
  const step = goLighter ? 0.01 : -0.01;

  let best = intentHex;
  let bestRatio = current ?? 0;

  for (let l = intent.l + step; l >= 0 && l <= 1; l += step) {
    const candidate = oklchToHex(l, intent.c, intent.h);
    const ratio = contrast(candidate, surfaceHex);
    if (ratio === null) continue;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= min) return candidate;
  }

  // Lightness alone was not enough (a very chromatic hue against a mid
  // surface). Desaturate towards the pole, which always reaches 21:1.
  const pole = goLighter ? '#FFFFFF' : '#000000';
  return bestRatio >= min ? best : pole;
}

// ── Font constraints ───────────────────────────────────────────────────────

/**
 * Catalog families Google Fonts serves at ONE weight (400).
 *
 * Both font loaders — `loadGoogleFont` (css-injection.ts:706) and the org
 * layout's `googleFontsUrl` (_org/[slug]/+layout.svelte:230) — request
 * `wght@400;500;600;700` for every family. That request succeeds for these
 * faces but the response carries only the 400 face, so asking a display face
 * for 600/700 gets browser-synthesised faux-bold: a smeared outline on a face
 * that is already black by design.
 *
 * Verified against the live Google Fonts css2 API over the whole 46-entry
 * catalog. A type axis pairing one of these as its heading MUST declare
 * `headingWeight: 400`; `presets.test.ts` enforces it.
 */
export const SINGLE_WEIGHT_FONTS: ReadonlySet<string> = new Set([
  'Bebas Neue',
  'Righteous',
  'Abril Fatface',
  'Archivo Black',
  'Anton',
  'Lilita One',
  'Titan One',
  'Patrick Hand',
  'Pacifico',
  'Satisfy',
]);

/**
 * Families served at 400/700 only — no 500 or 600. Requesting an intermediate
 * weight synthesises it, so a type axis using these must stick to 400 or 700.
 */
export const NO_MID_WEIGHT_FONTS: ReadonlySet<string> = new Set([
  'Lato',
  'Kalam',
  'Crimson Text', // 400/600/700 — no 500
]);

// ── Type axis ──────────────────────────────────────────────────────────────

/** A complete typographic treatment. */
export interface TypeAxis {
  readonly id: string;
  /** Plain-language name shown in the guided mixer. */
  readonly label: string;
  /** One line the admin reads to choose. */
  readonly description: string;
  readonly fontHeading: string;
  readonly fontBody: string;
  /** Multiplier on the whole text scale (org-brand.css `--text-scale`). */
  readonly textScale: number;
  /** 400-700, and 400 only for a SINGLE_WEIGHT_FONTS heading. */
  readonly headingWeight: 400 | 500 | 600 | 700;
  readonly bodyWeight: 400 | 500;
  /** Casing for eyebrow/label text (`--text-transform-label`). */
  readonly labelTransform: 'uppercase' | 'capitalize' | 'none';
}

export const TYPE_AXES = {
  humanist: {
    id: 'humanist',
    label: 'Humanist',
    description: 'Open, legible sans — reads as calm and credible',
    fontHeading: 'Source Sans 3',
    fontBody: 'Source Sans 3',
    textScale: 1,
    headingWeight: 600,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    description: 'The quiet default — gets out of the content’s way',
    fontHeading: 'Inter',
    fontBody: 'Inter',
    textScale: 1,
    headingWeight: 600,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  grotesk: {
    id: 'grotesk',
    label: 'Grotesk',
    description: 'Tight, technical headlines over a neutral body',
    fontHeading: 'Space Grotesk',
    fontBody: 'Inter',
    textScale: 1,
    headingWeight: 700,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  geometric: {
    id: 'geometric',
    label: 'Geometric',
    description: 'Rounded, friendly shapes at a slightly larger scale',
    fontHeading: 'Poppins',
    fontBody: 'Nunito',
    textScale: 1.02,
    headingWeight: 600,
    bodyWeight: 400,
    labelTransform: 'none',
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    description: 'Serif headlines, generous scale — magazine cadence',
    fontHeading: 'Playfair Display',
    fontBody: 'Lora',
    textScale: 1.06,
    headingWeight: 500,
    bodyWeight: 400,
    labelTransform: 'capitalize',
  },
  classical: {
    id: 'classical',
    label: 'Classical',
    description: 'High-contrast garamond at a large, airy scale',
    fontHeading: 'Cormorant Garamond',
    fontBody: 'EB Garamond',
    textScale: 1.12,
    headingWeight: 500,
    bodyWeight: 400,
    labelTransform: 'capitalize',
  },
  slab: {
    id: 'slab',
    label: 'Slab',
    description: 'Sturdy slab headings, workmanlike and grounded',
    fontHeading: 'Bitter',
    fontBody: 'Source Sans 3',
    textScale: 1.02,
    headingWeight: 700,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  mono: {
    id: 'mono',
    label: 'Monospace',
    description: 'Fixed-width throughout — engineered and exact',
    fontHeading: 'JetBrains Mono',
    fontBody: 'JetBrains Mono',
    textScale: 0.96,
    headingWeight: 700,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  poster: {
    id: 'poster',
    label: 'Poster',
    description: 'Heavy display headlines that shout — 400 is already black',
    fontHeading: 'Archivo Black',
    fontBody: 'Space Grotesk',
    // Archivo Black ships one weight. Asking for 700 would faux-bold a face
    // that is already black — see SINGLE_WEIGHT_FONTS.
    textScale: 1.08,
    headingWeight: 400,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
  soft: {
    id: 'soft',
    label: 'Soft',
    description: 'Rounded display over a warm body — approachable',
    fontHeading: 'Fredoka',
    fontBody: 'Nunito',
    textScale: 1.04,
    headingWeight: 600,
    bodyWeight: 400,
    labelTransform: 'none',
  },
  airy: {
    id: 'airy',
    label: 'Airy',
    description: 'Light weights and open spacing — quiet and spacious',
    fontHeading: 'Raleway',
    fontBody: 'Raleway',
    textScale: 1,
    headingWeight: 500,
    bodyWeight: 400,
    labelTransform: 'uppercase',
  },
} as const satisfies Record<string, TypeAxis>;

export type TypeAxisId = keyof typeof TYPE_AXES;

// ── Form axis ──────────────────────────────────────────────────────────────

/** Shape, density and material response. */
export interface FormAxis {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** rem — becomes `--brand-radius`. */
  readonly radius: number;
  /** Multiplier on the spacing scale. */
  readonly density: number;
  /** Multiplier on shadow strength (`--brand-shadow-scale`). */
  readonly shadowScale: number;
  /**
   * `--brand-shadow-color` — an HSL TRIPLE with no `hsl()` wrapper, because
   * org-brand.css composes it as `hsl(var(--shadow-color) / …)`. A hex here
   * silently breaks every shadow on the page.
   */
  readonly shadowColor: string;
  /**
   * The dark-theme twin (`--brand-shadow-color-dark`, org-brand.css:451).
   * Not derivable: a warm shadow that reads as expensive on white reads as
   * mud on near-black, so each form states its own.
   */
  readonly shadowColorDark: string;
  readonly cardHoverScale: number;
  readonly cardImageHoverScale: number;
}

export const FORM_AXES = {
  flat: {
    id: 'flat',
    label: 'Flat',
    description: 'Almost no elevation — borders do the work',
    radius: 0.25,
    density: 1,
    shadowScale: 0.25,
    shadowColor: '220 3% 20%',
    shadowColorDark: '220 6% 4%',
    cardHoverScale: 1,
    cardImageHoverScale: 1.01,
  },
  precise: {
    id: 'precise',
    label: 'Precise',
    description: 'Square corners, tight spacing, engineered edges',
    radius: 0,
    density: 0.9,
    shadowScale: 0.4,
    shadowColor: '200 20% 10%',
    shadowColorDark: '200 30% 3%',
    cardHoverScale: 1,
    cardImageHoverScale: 1.02,
  },
  sharp: {
    id: 'sharp',
    label: 'Sharp',
    description: 'Barely-rounded and compact — dense and businesslike',
    radius: 0.125,
    density: 0.92,
    shadowScale: 0.6,
    shadowColor: '220 8% 12%',
    shadowColorDark: '220 12% 4%',
    cardHoverScale: 1.01,
    cardImageHoverScale: 1.02,
  },
  crisp: {
    id: 'crisp',
    label: 'Crisp',
    description: 'Modest radius with a clean, contained shadow',
    radius: 0.375,
    density: 0.96,
    shadowScale: 0.9,
    shadowColor: '220 6% 14%',
    shadowColorDark: '220 10% 5%',
    cardHoverScale: 1.015,
    cardImageHoverScale: 1.03,
  },
  soft: {
    id: 'soft',
    label: 'Soft',
    description: 'Generous radius and a diffuse lift on hover',
    radius: 0.75,
    density: 1,
    shadowScale: 1.1,
    shadowColor: '220 10% 18%',
    shadowColorDark: '220 14% 6%',
    cardHoverScale: 1.03,
    cardImageHoverScale: 1.06,
  },
  plush: {
    id: 'plush',
    label: 'Plush',
    description: 'Deep warm shadows and roomy spacing — expensive feel',
    radius: 1,
    density: 1.08,
    shadowScale: 1.5,
    shadowColor: '28 35% 22%',
    shadowColorDark: '28 24% 6%',
    cardHoverScale: 1.035,
    cardImageHoverScale: 1.07,
  },
  pill: {
    id: 'pill',
    label: 'Pill',
    description: 'Fully rounded and bouncy — maximum friendliness',
    radius: 1.5,
    density: 1.04,
    shadowScale: 1.3,
    shadowColor: '330 30% 25%',
    shadowColorDark: '330 22% 7%',
    cardHoverScale: 1.04,
    cardImageHoverScale: 1.08,
  },
} as const satisfies Record<string, FormAxis>;

export type FormAxisId = keyof typeof FORM_AXES;

// ── Atmosphere axis ────────────────────────────────────────────────────────

/**
 * The hero treatment: which shader paints behind the title, how briskly it
 * moves, and — critically — whether the hero carries LIGHT or DARK ink.
 *
 * `heroInk` is the whole reason this is an axis rather than a shader id. Every
 * `--brand-hero-*` token falls back to `white` in `(space)/+page.svelte`, which
 * is correct over `lava` or `nebula` and wrong over `pearl` or `clouds` — pale
 * shaders that would render white text on a white field. Naming the ink per
 * atmosphere makes that combination unrepresentable.
 *
 * WHY `tempo` IS A MULTIPLIER AND NOT A SPEED
 * ------------------------------------------
 * Each shader's speed is tuned in `shader-config.ts` `DEFAULTS`, and the tuned
 * values are not comparable across shaders: `cloudsSpeed` is 0.03 while
 * `wavesSpeed` is 1.0 — a 33x spread for two effects that both read as "slow".
 * Hand-authoring an absolute therefore guesses at a scale you cannot see, and
 * the shipped presets did exactly that: `clouds-speed: 0.4` was 13x its tuned
 * value, and `nebula-depth: 0.8` hit a `Math.round` and became 1 where the
 * shader wants 8.
 *
 * So an atmosphere says "0.6x as fast as this shader was tuned to run" and
 * `composePreset` resolves that against `DEFAULTS`. A shader retune moves every
 * atmosphere with it, and no atmosphere can land outside the tuned envelope.
 * `params` remains for deliberate non-speed deviations, stated as absolutes in
 * the SAME units the config uses — and the test checks each key is writable and
 * is an integer wherever the config rounds it.
 */
export interface AtmosphereAxis {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** ShaderHero preset id, or 'none' for a still hero. */
  readonly shader: string;
  /**
   * Multiplier on this shader's own tuned speed default. 1 = exactly as tuned.
   * Ignored for shaders with no speed parameter (`spore`, `none`), which must
   * declare 1.
   */
  readonly tempo: number;
  /** `--brand-shader-intensity`, 0..1. A generic post-process, safe absolute. */
  readonly intensity: number;
  /** `--brand-shader-vignette`, 0..1. */
  readonly vignette: number;
  /** `--brand-shader-grain`, 0..1. Omitted = leave the shader's default. */
  readonly grain?: number;
  /** Deliberate non-speed deviations, keyed WITHOUT the `shader-` prefix. */
  readonly params?: Readonly<Record<string, string>>;
  /** Which way the hero text reads. Drives every `hero-*` colour token. */
  readonly heroInk: 'light' | 'dark';
  /**
   * `--brand-hero-title-blend`. `difference` inverts the title against the
   * shader — striking but uncontrolled; `normal` keeps the authored colour.
   */
  readonly titleBlend: 'normal' | 'difference';
  /** `--brand-hero-logo-scale`. */
  readonly logoScale: number;
  /** Hero arrangement — positioning only, never visibility. */
  readonly layout: 'default' | 'centered' | 'logo-hero';
}

/**
 * Which `DEFAULTS` entry is each shader's "speed", and which token writes it.
 *
 * Not derivable by naming convention: `ether` calls it `rotation-speed`, `flow`
 * calls it `field-speed`, and `glow`/`pollen` have no speed at all — their
 * motion knob is `drift`. `null` means the shader has no tempo control, and the
 * test asserts those atmospheres declare `tempo: 1`.
 */
export const SHADER_TEMPO: Readonly<
  Record<string, { token: string; base: keyof typeof DEFAULTS } | null>
> = {
  none: null,
  spore: null, // sensor/decay driven — no speed uniform
  topo: { token: 'topo-speed', base: 'topoSpeed' },
  silk: { token: 'silk-speed', base: 'silkSpeed' },
  clouds: { token: 'clouds-speed', base: 'cloudsSpeed' },
  gyroid: { token: 'gyroid-speed', base: 'gyroidSpeed' },
  glow: { token: 'glow-drift', base: 'glowDrift' },
  plasma: { token: 'plasma-speed', base: 'plasmaSpeed' },
  lava: { token: 'lava-speed', base: 'lavaSpeed' },
  flux: { token: 'flux-speed', base: 'fluxSpeed' },
  nebula: { token: 'nebula-speed', base: 'nebulaSpeed' },
  aurora: { token: 'aurora-speed', base: 'auroraSpeed' },
  vortex: { token: 'vortex-speed', base: 'vortexSpeed' },
  rain: { token: 'rain-speed', base: 'rainSpeed' },
  ether: { token: 'rotation-speed', base: 'rotationSpeed' },
  caustic: { token: 'caustic-speed', base: 'causticSpeed' },
  waves: { token: 'waves-speed', base: 'wavesSpeed' },
  growth: { token: 'growth-speed', base: 'growthSpeed' },
  pollen: { token: 'pollen-drift', base: 'pollenDrift' },
  flow: { token: 'flow-field-speed', base: 'flowFieldSpeed' },
  bismuth: { token: 'bismuth-speed', base: 'bismuthSpeed' },
  pearl: { token: 'pearl-speed', base: 'pearlSpeed' },
  film: { token: 'film-speed', base: 'filmSpeed' },
};

export const ATMOSPHERE_AXES = {
  // ── Quiet / structural ──
  still: {
    id: 'still',
    label: 'Still',
    description: 'No animation — the hero is type and colour alone',
    shader: 'none',
    tempo: 1,
    intensity: 0,
    vignette: 0,
    heroInk: 'dark',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  contour: {
    id: 'contour',
    label: 'Contour',
    description: 'Slow topographic lines — quietly technical',
    shader: 'topo',
    tempo: 1.2,
    intensity: 0.7,
    vignette: 0.4,
    // Finer, wider-spread contours than the default 12 lines at scale 2.5.
    params: { 'topo-line-count': '16', 'topo-scale': '3' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  drape: {
    id: 'drape',
    label: 'Drape',
    description: 'Folded silk with a slow sheen — composed and premium',
    shader: 'silk',
    tempo: 1.4,
    intensity: 0.8,
    vignette: 0.5,
    // More sheen than default (0.15) is what reads as satin rather than cloth.
    params: { 'silk-sheen': '0.35', 'silk-fold-scale': '2.2' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  haze: {
    id: 'haze',
    label: 'Haze',
    description: 'Soft pale cloud drift — carries dark hero ink',
    shader: 'clouds',
    tempo: 1.5,
    intensity: 0.55,
    vignette: 0.2,
    grain: 0.05,
    params: { 'clouds-cover': '0.35' },
    // Clouds render pale. White hero text would vanish into it.
    heroInk: 'dark',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  lattice: {
    id: 'lattice',
    label: 'Lattice',
    description: 'A rotating gyroid mesh — structural and precise',
    shader: 'gyroid',
    tempo: 1.2,
    intensity: 0.75,
    vignette: 0.5,
    params: { 'gyroid-thickness': '0.05' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },

  // ── Luminous / energetic ──
  bloomlight: {
    id: 'bloomlight',
    label: 'Bloom',
    description: 'Drifting coloured orbs — warm and inviting',
    shader: 'glow',
    tempo: 1.6,
    intensity: 0.9,
    vignette: 0.45,
    params: { 'glow-count': '8', 'glow-size': '0.8' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1.05,
    layout: 'centered',
  },
  charge: {
    id: 'charge',
    label: 'Charge',
    description: 'Crackling plasma — loud, electric, unmissable',
    shader: 'plasma',
    tempo: 1.3,
    intensity: 1,
    vignette: 0.35,
    params: { 'plasma-bands': '30' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  forge: {
    id: 'forge',
    label: 'Forge',
    description: 'Molten crust and heat — heavy and industrial',
    shader: 'lava',
    tempo: 1.5,
    intensity: 0.95,
    vignette: 0.55,
    params: { 'lava-heat': '1.2', 'lava-crust': '0.7' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  current: {
    id: 'current',
    label: 'Current',
    description: 'Fast banded flux — kinetic and synthetic',
    shader: 'flux',
    tempo: 1.8,
    intensity: 1,
    vignette: 0.4,
    grain: 0.06,
    params: { 'flux-line-density': '14' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },

  // ── Deep / atmospheric ──
  deepfield: {
    id: 'deepfield',
    label: 'Deep field',
    description: 'Dust, depth and stars — vast and cinematic',
    shader: 'nebula',
    tempo: 0.8,
    intensity: 0.9,
    vignette: 0.6,
    // `nebula-depth` is Math.round-ed to a layer COUNT — a fraction here
    // collapses the volume to a single sheet. Default is 8.
    params: {
      'nebula-density': '0.9',
      'nebula-stars': '0.6',
      'nebula-depth': '9',
    },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'centered',
  },
  borealis: {
    id: 'borealis',
    label: 'Borealis',
    description: 'Slow curtains of light — serene and cold',
    shader: 'aurora',
    tempo: 0.8,
    intensity: 0.85,
    vignette: 0.6,
    params: { 'aurora-layers': '6', 'aurora-height': '0.6' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'centered',
  },
  maelstrom: {
    id: 'maelstrom',
    label: 'Maelstrom',
    description: 'A tightening spiral — tense and dramatic',
    shader: 'vortex',
    tempo: 1.4,
    intensity: 0.9,
    vignette: 0.65,
    // `vortex-density` is a rounded arm COUNT (default 40), not a 0..1 ratio.
    params: { 'vortex-twist': '1.5', 'vortex-density': '48' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  drizzle: {
    id: 'drizzle',
    label: 'Drizzle',
    description: 'Rain on glass — meditative and quiet',
    shader: 'rain',
    tempo: 0.9,
    intensity: 0.7,
    vignette: 0.5,
    params: { 'rain-density': '0.7', 'rain-blur': '1.3' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  voidform: {
    id: 'voidform',
    label: 'Voidform',
    description: 'Rotating aetheric folds — abstract and dark',
    shader: 'ether',
    tempo: 0.7,
    intensity: 0.85,
    vignette: 0.7,
    // `complexity` is a rounded iteration count (default 6).
    params: { complexity: '7', glow: '0.7' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'centered',
  },

  // ── Water / organic ──
  tide: {
    id: 'tide',
    label: 'Tide',
    description: 'Caustic light through water — fresh and clear',
    shader: 'caustic',
    tempo: 1.3,
    intensity: 0.85,
    vignette: 0.4,
    params: { 'caustic-brightness': '1.4' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  dunes: {
    id: 'dunes',
    label: 'Dunes',
    description: 'Long rolling swells — patient and wide',
    shader: 'waves',
    tempo: 0.6,
    intensity: 0.8,
    vignette: 0.5,
    params: { 'waves-chop': '0.5', 'waves-height': '1.2' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  canopy: {
    id: 'canopy',
    label: 'Canopy',
    description: 'Branching growth — alive and unhurried',
    shader: 'growth',
    tempo: 1.2,
    intensity: 0.8,
    vignette: 0.55,
    params: { 'growth-glow': '1', 'growth-scale': '2.4' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  driftseed: {
    id: 'driftseed',
    label: 'Driftseed',
    description: 'Pollen adrift in shallow depth of field — gentle',
    shader: 'pollen',
    tempo: 1.6,
    intensity: 0.75,
    vignette: 0.45,
    params: { 'pollen-bokeh': '0.8', 'pollen-density': '0.7' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1.05,
    layout: 'centered',
  },
  stream: {
    id: 'stream',
    label: 'Stream',
    description: 'Laminar flow lines — smooth and continuous',
    shader: 'flow',
    tempo: 1,
    intensity: 0.85,
    vignette: 0.45,
    params: { 'flow-curl': '0.8' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'centered',
  },
  spores: {
    id: 'spores',
    label: 'Spores',
    description: 'Agent trails seeking and reinforcing — emergent',
    shader: 'spore',
    // `spore` has no speed uniform; its motion comes from sensor geometry and
    // trail decay, so tempo must be 1 (SHADER_TEMPO.spore is null).
    tempo: 1,
    intensity: 0.8,
    vignette: 0.6,
    grain: 0.08,
    // `spore-decay` is a per-frame trail retention — 0.998 is the tuned value
    // and small changes are enormous. 0.995 fades trails perceptibly faster.
    params: { 'spore-decay': '0.995', 'spore-step-size': '7' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },

  // ── Mineral / crafted ──
  facet: {
    id: 'facet',
    label: 'Facet',
    description: 'Iridescent bismuth terraces — jewelled and hard',
    shader: 'bismuth',
    tempo: 1.3,
    intensity: 0.9,
    vignette: 0.6,
    params: { 'bismuth-iridescence': '0.9', 'bismuth-terraces': '6' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'centered',
  },
  alabaster: {
    id: 'alabaster',
    label: 'Alabaster',
    description: 'Pale nacre sheen — carries dark hero ink',
    shader: 'pearl',
    tempo: 0.6,
    intensity: 0.6,
    vignette: 0.25,
    params: { 'pearl-fresnel': '2.4' },
    // Pearl is the palest shader in the set. Light ink is unreadable on it.
    heroInk: 'dark',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
  grain: {
    id: 'grain',
    label: 'Grain',
    description: 'Analogue film wash and dust — nostalgic',
    shader: 'film',
    tempo: 0.8,
    intensity: 0.7,
    vignette: 0.7,
    grain: 0.35,
    params: { 'film-bands': '5' },
    heroInk: 'light',
    titleBlend: 'normal',
    logoScale: 1,
    layout: 'default',
  },
} as const satisfies Record<string, AtmosphereAxis>;

export type AtmosphereAxisId = keyof typeof ATMOSPHERE_AXES;

/** Resolve an atmosphere's shader tokens: preset id, tempo, post-process, params. */
export function atmosphereShaderTokens(
  atmos: AtmosphereAxis
): Record<string, string> {
  const tokens: Record<string, string> = {
    'shader-preset': atmos.shader,
    'shader-intensity': String(atmos.intensity),
    'shader-vignette': String(atmos.vignette),
  };
  if (atmos.grain !== undefined) tokens['shader-grain'] = String(atmos.grain);

  const tempo = SHADER_TEMPO[atmos.shader];
  if (tempo) {
    const base = DEFAULTS[tempo.base];
    if (typeof base === 'number') {
      // Round to 4dp so a float multiply never emits 0.30000000000000004.
      tokens[`shader-${tempo.token}`] = String(
        Number((base * atmos.tempo).toFixed(4))
      );
    }
  }

  for (const [key, value] of Object.entries(atmos.params ?? {})) {
    tokens[`shader-${key}`] = value;
  }
  return tokens;
}

// ── Palette ────────────────────────────────────────────────────────────────

/** The four brand colours, per theme. This is the preset's identity. */
export interface PresetPalette {
  readonly primary: string;
  readonly secondary: string;
  /**
   * null for palettes that deliberately have no accent (Minimal, Mono). Tokens
   * that need a fill — the hero CTA, the glass tint — fall back to `primary`,
   * while `values.accentColor` stays null so the editor still shows "none".
   */
  readonly accent: string | null;
  /** null = inherit the theme's default surface (white / neutral-800). */
  readonly background: string | null;
  /** Dark-theme primary. Required — the light primary rarely survives inversion. */
  readonly darkPrimary: string;
  /** Dark-theme surface. Required whenever `background` is set, else the light
   *  value bleeds through org-brand.css:363's fallback chain. */
  readonly darkBackground: string;
  /**
   * The hue a heading should carry, or `'auto'` for the theme's own near-neutral
   * text colour (what `--color-text-primary` resolved to before presets set this
   * key at all — the right answer for a palette whose point is restraint).
   *
   * Either way `composePreset` guarantees AA on BOTH surfaces by moving
   * lightness only, so this states intent rather than a final value.
   */
  readonly headingIntent: string | 'auto';
}

/** Near-neutral heading ink for `headingIntent: 'auto'`, per surface polarity.
 *  Matches the `--color-neutral-900` / `--color-neutral-100` text family
 *  rather than pure black/white, which reads as harsh at heading sizes. */
const AUTO_HEADING = { onLight: '#171717', onDark: '#F5F5F5' } as const;

/** Resolve `headingIntent` against the surface it will land on. */
function headingFor(intent: string, surface: string): string {
  if (intent !== 'auto') return readableOn(intent, surface);
  const oklch = hexToOklch(surface);
  const isDarkSurface = !oklch || oklch.l < 0.5;
  return readableOn(
    isDarkSurface ? AUTO_HEADING.onDark : AUTO_HEADING.onLight,
    surface
  );
}

// ── Composition ────────────────────────────────────────────────────────────

/** Surfaces headings actually land on when `background` is null. */
const DEFAULT_LIGHT_SURFACE = '#FFFFFF'; // themes/light.css --color-surface
const DEFAULT_DARK_SURFACE = '#262626'; // themes/dark.css --color-neutral-800

/** Hero ink pairs. The hero sits over a shader, not over `--color-surface`. */
const HERO_INK = {
  light: { text: '#FFFFFF', tint: '#FFFFFF' },
  dark: { text: '#0B0B0F', tint: '#0B0B0F' },
} as const;

/**
 * Token-override keys that have a real `--brand-{key}-dark` consumer.
 *
 * Emitting a dark twin for anything else writes a custom property NOTHING
 * reads — it is persisted into the org's `tokenOverrides` JSON forever and
 * reads, to the next maintainer, like a wired feature. The `hero-*` family is
 * the trap: `(space)/+page.svelte` resolves `var(--brand-hero-text, white)`
 * with no dark chain at all, so the hero is theme-invariant by construction.
 *
 * Derived from org-brand.css's dark block plus the layout's own `var()` reads.
 * `presets.test.ts` re-derives it from source and fails on drift.
 */
export const DARK_CAPABLE_KEYS: readonly string[] = [
  'heading-color',
  'glass-tint',
  'shadow-color',
  'font-body',
  'font-heading',
  // player-* are dark-capable too, but presets deliberately never set them.
];

/**
 * Glass surfaces mix this colour with their backdrop, so a raw saturated
 * accent turns every glass panel into a colour wash. Pull the accent's hue to
 * a near-surface lightness and shed most of its chroma: the panel still reads
 * as *this* brand's glass, but as glass first.
 */
function glassTint(accentHex: string, theme: 'light' | 'dark'): string {
  const accent = hexToOklch(accentHex);
  if (!accent) return theme === 'light' ? '#FFFFFF' : '#0B0B0F';
  return oklchToHex(
    theme === 'light' ? 0.94 : 0.22,
    Math.min(accent.c, 0.04),
    accent.h
  );
}

/** A named point in axis space. One preset, or one of its variants. */
export interface PresetSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly palette: PresetPalette;
  readonly type: TypeAxisId;
  readonly form: FormAxisId;
  readonly atmosphere: AtmosphereAxisId;
}

/**
 * Expand a `PresetSpec` into the flat `BrandPreset` the store consumes.
 *
 * Guarantees, each locked by `presets.test.ts`:
 *  - every non-player design key is present (no cross-preset bleed)
 *  - `heading-color` clears AA on the light surface, and its `-dark` twin
 *    clears AA on the dark surface
 *  - `hero-cta-text` clears AA against `hero-cta-bg`
 *  - a single-weight heading face is never asked for a synthesised weight
 */
export function composePreset(spec: PresetSpec): BrandPreset {
  const type = TYPE_AXES[spec.type];
  const form = FORM_AXES[spec.form];
  const atmos = ATMOSPHERE_AXES[spec.atmosphere];
  const p = spec.palette;

  const lightSurface = p.background ?? DEFAULT_LIGHT_SURFACE;
  const darkSurface = p.background
    ? p.darkBackground
    : // No `[data-org-bg]`, so the dark theme keeps its own neutral surface and
      // `darkBackground` never reaches the page. Measure against what renders.
      DEFAULT_DARK_SURFACE;

  const ink = HERO_INK[atmos.heroInk];

  // The hero CTA is a filled accent-coloured button sitting on the shader, so
  // it is theme-invariant like the rest of the hero. Its label is derived from
  // the fill by the SAME rule the product uses elsewhere, which is why it can
  // never end up white-on-yellow. An accent-less palette fills with primary.
  const fill = p.accent ?? p.primary;
  const ctaBg = fill;

  const shaderTokens = atmosphereShaderTokens(atmos);

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    heroLayout: atmos.layout,
    tokenOverrides: {
      ...shaderTokens,

      // ── Type ──
      'text-scale': String(type.textScale),
      'heading-weight': String(type.headingWeight),
      'body-weight': String(type.bodyWeight),
      'text-transform-label': type.labelTransform,

      // ── Form ──
      'shadow-scale': String(form.shadowScale),
      'shadow-color': form.shadowColor,
      'card-hover-scale': String(form.cardHoverScale),
      'card-image-hover-scale': String(form.cardImageHoverScale),

      // ── Palette-derived, contrast-guaranteed ──
      'heading-color': headingFor(p.headingIntent, lightSurface),
      'glass-tint': glassTint(fill, 'light'),

      // ── Hero: theme-invariant (no `-dark` consumer exists), driven by the
      //    atmosphere's ink rather than by the page surface ──
      'hero-text': ink.text,
      'hero-text-muted': ink.text,
      'hero-title-color': ink.text,
      'hero-title-blend': atmos.titleBlend,
      'hero-glass-text': ink.text,
      'hero-glass-tint': ink.tint,
      'hero-border-tint': ink.tint,
      'hero-logo-scale': String(atmos.logoScale),
      'hero-cta-bg': ctaBg,
      'hero-cta-text': bestInkOn(ctaBg),
    },
    // ONLY keys in DARK_CAPABLE_KEYS. Anything else here is a property no
    // stylesheet reads — see that constant's note.
    darkTokenOverrides: {
      'heading-color': headingFor(p.headingIntent, darkSurface),
      'glass-tint': glassTint(fill, 'dark'),
      'shadow-color': form.shadowColorDark,
    },
    values: {
      primaryColor: p.primary,
      secondaryColor: p.secondary,
      accentColor: p.accent,
      backgroundColor: p.background,
      fontBody: type.fontBody,
      fontHeading: type.fontHeading,
      radius: form.radius,
      density: form.density,
      heroLayout: atmos.layout,
      // `Partial<ThemeColors>`: an OMITTED key falls back to the light value
      // through `var(--brand-x-dark, var(--brand-x, …))`, whereas an explicit
      // `null` reads as "deliberately unset" to the store's getter
      // (brand-editor-store.svelte.ts:292). Omission is what we want for
      // secondary/accent, so they are absent rather than null.
      //
      // `backgroundColor` is only meaningful alongside a light background:
      // the dark surface rule is gated on `[data-org-bg]` (org-brand.css:359),
      // which the layout sets from the LIGHT background alone. A dark-only
      // background would never reach the page.
      darkOverrides: p.background
        ? {
            primaryColor: p.darkPrimary,
            backgroundColor: p.darkBackground,
          }
        : { primaryColor: p.darkPrimary },
    },
  };
}

/** The design keys `composePreset` is responsible for filling, for the
 *  coverage test. Excludes `player-*` (see the module header) and
 *  `font-body`/`font-heading` (dark-font variants; light lives in `values`). */
export const COMPOSED_DESIGN_KEYS: readonly string[] = [
  'text-scale',
  'heading-weight',
  'body-weight',
  'text-transform-label',
  'shadow-scale',
  'shadow-color',
  'card-hover-scale',
  'card-image-hover-scale',
  'heading-color',
  'glass-tint',
  'hero-text',
  'hero-text-muted',
  'hero-title-color',
  'hero-title-blend',
  'hero-glass-text',
  'hero-glass-tint',
  'hero-border-tint',
  'hero-logo-scale',
  'hero-cta-bg',
  'hero-cta-text',
];

/** Surfaces a composed preset's headings are measured against, for tests and
 *  for the guided mixer's contrast readout. */
export function presetSurfaces(p: PresetPalette): {
  light: string;
  dark: string;
} {
  return {
    light: p.background ?? DEFAULT_LIGHT_SURFACE,
    dark: p.background ? p.darkBackground : DEFAULT_DARK_SURFACE,
  };
}
