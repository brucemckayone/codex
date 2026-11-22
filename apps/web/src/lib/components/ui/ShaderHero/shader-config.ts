/**
 * Shader Config — Parse tokenOverrides (via CSS custom properties) into typed config.
 *
 * Brand editor injects shader-* keys as --brand-shader-* CSS properties on .org-layout.
 * This module reads them back via getComputedStyle and provides typed defaults.
 */

import { logger } from '$lib/observability';
import {
  FX_BASE,
  type FxSetting,
  fxDefaultsFor,
  presetFxKey,
  sharedFxKey,
} from './preset-fx-defaults';

export type ShaderPresetId =
  | 'suture'
  | 'ether'
  | 'ripple'
  | 'pulse'
  | 'ink'
  | 'topo'
  | 'glass'
  | 'film'
  | 'flux'
  | 'lava'
  | 'caustic'
  | 'physarum'
  | 'aurora'
  | 'lenia'
  | 'fracture'
  | 'flow'
  | 'none';

/** A preset that paints: every id but `'none'` has its own renderer. */
export type LivePresetId = Exclude<ShaderPresetId, 'none'>;

/**
 * The 25 presets cut from the set, each mapped to the survivor nearest it in
 * look and motion.
 *
 * WHY A MAP AND NOT A MIGRATION. A stored preset id outlives its preset: the
 * org's `shader-preset` lives in its `tokenOverrides` JSON, and
 * `content.shader_preset` is free text with no enum, so nothing at the
 * database refuses an id the app no longer ships. Production holds no row on
 * a cut preset, but dev seeds and old brand exports do, and the page cannot
 * tell them apart. Before this map such an id fell through `PRESET_BUILDERS`
 * to `'none'` and silently blanked the hero; now it paints its survivor, and
 * no row has to be rewritten.
 *
 * Read only through `resolvePresetId`, the one door a stored or passed id
 * goes through on its way to a renderer.
 */
export const CUT_PRESET_ALIASES = {
  warp: 'suture',
  silk: 'film',
  bismuth: 'film',
  pearl: 'film',
  ocean: 'caustic',
  nebula: 'aurora',
  rain: 'ripple',
  waves: 'ripple',
  turing: 'lenia',
  life: 'lenia',
  growth: 'lenia',
  frost: 'physarum',
  mycelium: 'physarum',
  spore: 'physarum',
  glow: 'ether',
  pollen: 'ether',
  vortex: 'ether',
  gyroid: 'ether',
  julia: 'ether',
  tunnel: 'ether',
  tendrils: 'flow',
  clouds: 'flow',
  vapor: 'flow',
  plasma: 'flow',
  geode: 'topo',
} as const satisfies Readonly<Record<string, LivePresetId>>;

type CutPresetId = keyof typeof CUT_PRESET_ALIASES;

/**
 * Own-property checks: a stored id is free text, and `'constructor'` or
 * `'toString'` must never resolve to something on `Object.prototype`.
 */
function isShaderPresetId(id: string): id is ShaderPresetId {
  return Object.hasOwn(PRESET_BUILDERS, id);
}

function isCutPresetId(id: string): id is CutPresetId {
  return Object.hasOwn(CUT_PRESET_ALIASES, id);
}

/**
 * Turn a stored or passed preset id into one a renderer exists for.
 *
 * - A live preset, or `'none'`, passes through.
 * - A cut preset returns its survivor (`CUT_PRESET_ALIASES`).
 * - Empty, missing or unknown returns `null`, so the CALLER applies its own
 *   default — the org's preset, the platform's, or none — instead of this
 *   function guessing one for every caller at once.
 *
 * The id is trimmed first: an API client may send `' flow'`, and a CSS read
 * trims anyway, so the two must agree. Otherwise it is matched exactly.
 *
 * PURE. A caller that wants an unknown id on the record calls
 * `warnUnknownPreset` itself (`presetIsUnknown` says when).
 *
 * Every path that turns an id into a renderer goes through here:
 * `getShaderConfig` (its override and the brand's `--brand-shader-preset`),
 * `loadRenderer`, the brand editor's selected card, the studio's shader
 * picker, and the page kit's "has a moving background" gate.
 */
export function resolvePresetId(
  id: string | null | undefined
): ShaderPresetId | null {
  const key = id?.trim();
  if (!key) return null;
  if (isShaderPresetId(key)) return key;
  if (isCutPresetId(key)) return CUT_PRESET_ALIASES[key];
  return null;
}

/**
 * Whether an id was SET but names no preset, live or cut: the case that paints
 * a fallback the creator never chose, so it is worth a log line. An empty or
 * missing id is not unknown — it is simply unset. PURE.
 */
export function presetIsUnknown(id: string | null | undefined): boolean {
  return Boolean(id?.trim()) && resolvePresetId(id) === null;
}

/** Where an unknown preset id was read from, for `warnUnknownPreset`. */
export type PresetIdSource = 'brand' | 'override' | 'content' | 'studio';

/**
 * `${where}:${id}` pairs already logged this session (one tab): a render loop
 * reads the brand's ~2x a second.
 */
const warnedUnknownPresets = new Set<string>();

/**
 * Log, once per id and source per session, a preset id that resolves to
 * nothing (`shader.unknown_preset`). The page then paints its own fallback —
 * the brand's preset, flow, or none — and without this line nobody would
 * learn that a saved id had stopped meaning anything. Keyed on the source too,
 * so one bad id in a brand AND on a content row says both.
 */
export function warnUnknownPreset(id: string, where: PresetIdSource): void {
  const trimmed = id.trim();
  const key = `${where}:${trimmed}`;
  if (warnedUnknownPresets.has(key)) return;
  warnedUnknownPresets.add(key);
  logger.warn('shader.unknown_preset', { id: trimmed, where });
}

/** `resolvePresetId`, logging a set-but-unknown id as from `where`. */
function resolveNoting(
  id: string | null | undefined,
  where: PresetIdSource
): ShaderPresetId | null {
  const resolved = resolvePresetId(id);
  // Null for a set id means it names nothing (an unset one is not news).
  if (resolved === null && id?.trim()) warnUnknownPreset(id, where);
  return resolved;
}

/** Shared configuration fields present on all presets. */
interface ShaderConfigBase {
  preset: ShaderPresetId;
  intensity: number;
  grain: number;
  vignette: number;
  /** Org logo URL for SDF-based shader integration (optional). */
  logoUrl?: string;
  /** Brand colors parsed from CSS custom properties. */
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    bg: [number, number, number];
  };
  /**
   * The org's OWN primary and ground, from its brand tokens, whatever the
   * shader's palette (`colors` is the custom shader palette when one is opted
   * into). The Showreel's surfaces over the footage tint from these: the film
   * plays in the org's colours, not the shader's.
   */
  brand: {
    primary: [number, number, number];
    bg: [number, number, number];
  };
}

export interface SutureConfig extends ShaderConfigBase {
  preset: 'suture';
  curl: number;
  dissipation: number;
  advection: number;
  force: number;
}

export interface EtherConfig extends ShaderConfigBase {
  preset: 'ether';
  rotationSpeed: number;
  complexity: number;
  zoom: number;
  glow: number;
  scale: number;
  aberration: number;
}

export interface RippleConfig extends ShaderConfigBase {
  preset: 'ripple';
  waveSpeed: number;
  damping: number;
  rippleSize: number;
  refraction: number;
}

export interface PulseConfig extends ShaderConfigBase {
  preset: 'pulse';
  damping: number;
  waveScale: number;
  camHeight: number;
  camTarget: number;
  specular: number;
  impulseSize: number;
}

export interface InkConfig extends ShaderConfigBase {
  preset: 'ink';
  diffusion: number;
  advection: number;
  dropSize: number;
  evaporation: number;
  curl: number;
}

export interface TopoConfig extends ShaderConfigBase {
  preset: 'topo';
  lineCount: number;
  lineWidth: number;
  speed: number;
  scale: number;
  elevation: number;
  octaves: number;
}

interface GlassConfig extends ShaderConfigBase {
  preset: 'glass';
  cellSize: number;
  border: number;
  drift: number;
  glow: number;
  light: number;
  /** 0 hard to 1 soft (R4's); the default is the hard came. */
  lineSoftness: number;
  /** 0 near-black to 1 a tint of the ground (R4's). */
  lineTint: number;
  /** 0 flat pieces to 1 bevelled toward the lead (R4's). */
  pieceEdges: number;
}

interface FilmConfig extends ShaderConfigBase {
  preset: 'film';
  filmScale: number;
  filmSpeed: number;
  bands: number;
  shift: number;
  ripple: number;
}

export interface FluxConfig extends ShaderConfigBase {
  preset: 'flux';
  poles: number;
  lineDensity: number;
  lineWidth: number;
  strength: number;
  speed: number;
}

export interface LavaConfig extends ShaderConfigBase {
  preset: 'lava';
  crackScale: number;
  crackWidth: number;
  glow: number;
  speed: number;
  crust: number;
  heat: number;
}

interface CausticConfig extends ShaderConfigBase {
  preset: 'caustic';
  scale: number;
  speed: number;
  iterations: number;
  brightness: number;
  ripple: number;
}

interface PhysarumConfig extends ShaderConfigBase {
  preset: 'physarum';
  diffusion: number;
  decay: number;
  deposit: number;
  sensor: number;
  turn: number;
}

export interface AuroraConfig extends ShaderConfigBase {
  preset: 'aurora';
  layers: number;
  speed: number;
  height: number;
  spread: number;
  shimmer: number;
}

export interface LeniaConfig extends ShaderConfigBase {
  preset: 'lenia';
  radius: number;
  growth: number;
  width: number;
  speed: number;
  dt: number;
}

export interface FractureConfig extends ShaderConfigBase {
  preset: 'fracture';
  cuts: number;
  speed: number;
  border: number;
  shadow: number;
  fill: number;
  /** 0 hard to 1 soft (R4's); the default is the hard line. */
  lineSoftness: number;
  /** 0 near-black to 1 a tint of the ground (R4's). */
  lineTint: number;
}

export interface FlowConfig extends ShaderConfigBase {
  preset: 'flow';
  curl: number;
  advection: number;
  smoothing: number;
  contrast: number;
  fieldSpeed: number;
}

interface NoneConfig extends ShaderConfigBase {
  preset: 'none';
}

export type ShaderConfig =
  | SutureConfig
  | EtherConfig
  | RippleConfig
  | PulseConfig
  | InkConfig
  | TopoConfig
  | GlassConfig
  | FilmConfig
  | FluxConfig
  | LavaConfig
  | CausticConfig
  | PhysarumConfig
  | AuroraConfig
  | LeniaConfig
  | FractureConfig
  | FlowConfig
  | NoneConfig;

/**
 * Default values matching the spec in 14-final-preset-catalog.md.
 *
 * EXPORTED because the brand-editor preset axes anchor to it
 * (`lib/brand-editor/preset-axes.ts`). A preset that wanted a "calm" shader
 * used to hand-author an absolute — and guessed: shipped values sat 13x above
 * a shader's tuned speed, and rounded a layer count from 8 down to 1.
 * Atmospheres now declare a MULTIPLIER on the number tuned here, so a retune
 * in this file flows through to every preset instead of leaving them stranded.
 */
export const DEFAULTS = {
  preset: 'none' as ShaderPresetId,
  // The renderers' last-resort fallbacks. A brand gets its preset's own
  // values (preset-fx-defaults.ts; the read order is in getShaderConfig).
  intensity: FX_BASE.intensity,
  grain: FX_BASE.grain,
  vignette: FX_BASE.vignette,
  // Suture
  curl: 30,
  // The lab's tunings, contrast-checked on three brand modes: suture's
  // dissipation, advection and force; film's speed and bands; caustic's five
  // below. (Shared intensity/grain/vignette and flow's tuning were measured and
  // not adopted; see Codex-1yd58.14.)
  dissipation: 0.903,
  advection: 8.0,
  force: 2.7,
  // Ether (the lab's tuning)
  rotationSpeed: 0.9,
  complexity: 8,
  zoom: 5.5,
  glow: 1.5,
  scale: 4.0,
  aberration: 0.02,
  // Ripple
  waveSpeed: 0.8,
  damping: 0.995,
  rippleSize: 0.03,
  refraction: 0.5,
  // Pulse (the lab's view, shine and persistence)
  pulseDamping: 0.98,
  waveScale: 4.0,
  camHeight: 27,
  camTarget: -5,
  specular: 1.0,
  impulseSize: 0.04,
  // Ink
  inkDiffusion: 1.5,
  inkAdvection: 0.8,
  inkDropSize: 0.05,
  inkEvaporation: 0.997,
  inkCurl: 15,
  // Topo (the lab's tuning)
  topoLineCount: 27,
  topoLineWidth: 1.0,
  topoSpeed: 0.4,
  topoScale: 2.5,
  topoElevation: 2.8,
  topoOctaves: 5,
  // Glass
  glassCellSize: 5.0,
  glassBorder: 0.04,
  glassDrift: 0.1,
  glassGlow: 0.2,
  glassLight: 0.15,
  // 0 by default: the hard lines; 1 on each gives the soft look.
  glassLineSoftness: 0,
  glassLineTint: 0,
  glassPieceEdges: 0,
  // Film
  filmScale: 2.5,
  filmSpeed: 0.16,
  filmBands: 6.0,
  filmShift: 0.3,
  filmRipple: 1.5,
  // Flux
  fluxPoles: 3,
  fluxLineDensity: 10.0,
  fluxLineWidth: 1.0,
  fluxStrength: 1.5,
  fluxSpeed: 0.1,
  // Lava
  lavaCrackScale: 4.0,
  lavaCrackWidth: 0.04,
  lavaGlow: 1.5,
  lavaSpeed: 0.08,
  lavaCrust: 0.6,
  lavaHeat: 1.0,
  // Caustic
  causticScale: 5.0,
  causticSpeed: 0.3,
  causticIterations: 5,
  causticBrightness: 1.7,
  causticRipple: 3.0,
  // Physarum
  physarumDiffusion: 1.0,
  physarumDecay: 0.98,
  physarumDeposit: 1.0,
  physarumSensor: 0.03,
  physarumTurn: 0.25,
  // Aurora
  auroraLayers: 5,
  auroraSpeed: 0.1,
  auroraHeight: 0.4,
  auroraSpread: 0.25,
  auroraShimmer: 0.8,
  // Lenia The lab's tuning.
  leniaRadius: 15,
  leniaGrowth: 0.2,
  leniaWidth: 0.05,
  leniaSpeed: 4,
  leniaDt: 0.5,
  // Fracture Fewer, larger shards and a calmer sway, with bold, hard, dark
  // lines, shadow and fill. Softness and tint 1 give the soft look.
  fractureCuts: 5,
  fractureSpeed: 0.12,
  fractureBorder: 0.01,
  fractureShadow: 0.05,
  fractureFill: 0.85,
  fractureLineSoftness: 0,
  fractureLineTint: 0,
  // Flow
  flowCurl: 0.6,
  flowAdvection: 6.0,
  flowSmoothing: 0.8,
  flowContrast: 12.0,
  flowFieldSpeed: 1.0,
};

/**
 * Parse a hex color (#rrggbb) to normalized [0-1, 0-1, 0-1], or null if the
 * string is not a well-formed 6-digit hex.
 *
 * Returns null rather than a placeholder colour so callers can fall back to
 * something meaningful. This previously returned mid-grey `[0.5, 0.5, 0.5]` on
 * malformed input, which is indistinguishable from a deliberate grey: every
 * caller's `?? fallback` was dead code, and a typo'd token painted the hero
 * grey instead of using the brand colour.
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b];
}

/** Parse an rgb() or oklch() CSS color to normalized [0-1, 0-1, 0-1]. */
function parseCssColor(str: string): [number, number, number] | null {
  const trimmed = str.trim();
  if (trimmed.startsWith('#')) return hexToRgb(trimmed);

  // Try rgb(r, g, b) or rgb(r g b)
  const rgbMatch = trimmed.match(
    /rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/
  );
  if (rgbMatch) {
    return [
      parseFloat(rgbMatch[1]) / 255,
      parseFloat(rgbMatch[2]) / 255,
      parseFloat(rgbMatch[3]) / 255,
    ];
  }

  return null;
}

/**
 * Read a `--brand-shader-*` CSS property from a cached CSSStyleDeclaration.
 *
 * When `isDark` is set, the `--brand-{key}-dark` value wins if present, falling
 * back to the light `--brand-{key}`. This is how a dark-only hero effect
 * reaches ShaderHero: the dark values are injected inline as `--brand-*-dark`,
 * and the light values are injected inline as `--brand-*` — so a plain CSS
 * rebind can't promote dark over light (inline beats stylesheet, and a
 * self-referential `var(--x-dark, var(--x))` is a cycle). Resolving the
 * `-dark` suffix here, keyed off a stylesheet sentinel, covers every key.
 */
function readBrandVar(
  style: CSSStyleDeclaration,
  key: string,
  isDark = false
): string | null {
  if (isDark) {
    const darkVal = style.getPropertyValue(`--brand-${key}-dark`).trim();
    if (darkVal) return darkVal;
  }
  const val = style.getPropertyValue(`--brand-${key}`).trim();
  return val || null;
}

/** Read a --color-brand-* CSS property for brand palette colors. */
function readColorVar(
  style: CSSStyleDeclaration,
  key: string
): [number, number, number] | null {
  const val = style.getPropertyValue(`--color-${key}`).trim();
  if (!val) return null;
  return parseCssColor(val);
}

/** Parse a numeric string with a fallback. */
function num(val: string | null, fallback: number): number {
  if (val == null) return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Dark mode is signalled by a stylesheet-only sentinel set under the org
 * brand's dark gate (org-brand.css). When dark, every shader read prefers
 * the key's `--brand-*-dark` value so a dark-only hero effect activates.
 */
export function shaderIsDark(style: CSSStyleDeclaration | null): boolean {
  return (
    !!style && style.getPropertyValue('--brand-shader-is-dark').trim() === '1'
  );
}

/** The brand's `shader-preset` from a cached style, through the alias door. */
function brandPresetFrom(
  style: CSSStyleDeclaration | null,
  isDark: boolean
): ShaderPresetId | null {
  return resolveNoting(
    style ? readBrandVar(style, 'shader-preset', isDark) : null,
    'brand'
  );
}

/**
 * The shader the org's brand sets — `--brand-shader-preset` on the org layout
 * (its `-dark` value in dark mode) — which is what `getShaderConfig` paints
 * when no override is passed. `null` when the brand names no preset, or one
 * that does not exist; `'none'` when it turns the shader off.
 */
export function getBrandPresetId(
  orgLayoutEl?: Element | null
): ShaderPresetId | null {
  const el = orgLayoutEl ?? document.querySelector('.org-layout');
  const style = el ? getComputedStyle(el) : null;
  return brandPresetFrom(style, shaderIsDark(style));
}

/**
 * Read shader configuration from CSS custom properties on the org layout element.
 * Returns a fully typed ShaderConfig with defaults for any missing values.
 *
 * `presetOverride` is a plain string because callers hold stored ids (a
 * content item's `shader_preset`, a menu id). It wins when it resolves; an
 * empty or unknown one falls back to the brand's preset, then to `'none'`.
 * Both go through `resolvePresetId`, so a cut preset paints its survivor
 * instead of falling through to `'none'`.
 */
export function getShaderConfig(
  orgLayoutEl?: Element | null,
  presetOverride?: string | null
): ShaderConfig {
  const el = orgLayoutEl ?? document.querySelector('.org-layout');
  // Cache getComputedStyle once — avoids forced reflow on each property read
  const style = el ? getComputedStyle(el) : null;
  const isDark = shaderIsDark(style);

  const resolvedPreset =
    resolveNoting(presetOverride, 'override') ??
    brandPresetFrom(style, isDark) ??
    DEFAULTS.preset;

  // Shader palette. By default a shader paints in the org's brand colours, so
  // the hero matches the site with no configuration. A creator can opt into a
  // separate shader palette — a teal shader over a purple brand — by enabling
  // `shader-use-custom-colors` and setting the four `shader-color-*` keys.
  //
  // The opt-in toggle is load-bearing rather than decorative: `<input
  // type="color">` has no empty state, so a picker always reports SOME colour.
  // Without an explicit flag there would be no way to distinguish "the creator
  // chose this exact colour" from "the picker defaulted", and every org would
  // silently inherit the platform default palette the first time this panel
  // was opened.
  const useCustomColors =
    (style ? readBrandVar(style, 'shader-use-custom-colors', isDark) : null) ===
    '1';

  /** One slot of the org's own brand palette, else the platform default. */
  const brandSlot = (
    slot: 'primary' | 'secondary' | 'accent' | 'bg',
    fallback: [number, number, number]
  ): [number, number, number] => {
    if (!style) return fallback;
    if (slot === 'bg') {
      // The org's background is injected as `--brand-bg` (+ `--brand-bg-dark`),
      // NOT `--color-brand-bg`, which no stylesheet defines. Reading that name
      // sent every org's shader to the navy platform default whatever its own
      // background was. `readBrandVar` applies the page's own rule (the -dark
      // value in dark mode, else the light one), so the shader's ground is the
      // ground the page paints around it. No background set: the default, as before.
      const raw = readBrandVar(style, 'bg', isDark);
      return (raw ? parseCssColor(raw) : null) ?? fallback;
    }
    return readColorVar(style, `brand-${slot}`) ?? fallback;
  };

  /**
   * Resolve one palette slot: custom shader colour when opted in and parseable,
   * else the org brand colour, else the platform default.
   *
   * Falls through on an unparseable custom value rather than failing to black —
   * a malformed token should degrade to the brand colour, not blank the hero.
   */
  const paletteSlot = (
    slot: 'primary' | 'secondary' | 'accent' | 'bg',
    fallback: [number, number, number]
  ): [number, number, number] => {
    if (useCustomColors && style) {
      const raw = readBrandVar(style, `shader-color-${slot}`, isDark);
      const parsed = raw ? parseCssColor(raw) : null;
      if (parsed) return parsed;
    }
    return brandSlot(slot, fallback);
  };

  const PRIMARY: [number, number, number] = [0.486, 0.227, 0.929];
  const BG: [number, number, number] = [0.059, 0.09, 0.165];
  const primary = paletteSlot('primary', PRIMARY);
  const secondary = paletteSlot('secondary', [0.925, 0.282, 0.6]);
  const accent = paletteSlot('accent', [0.961, 0.62, 0.043]);
  const bg = paletteSlot('bg', BG);

  // Read logo URL for SDF-based shader integration
  const logoUrl = style ? readBrandVar(style, 'shader-logo-url', isDark) : null;

  // Intensity, grain and vignette belong to each preset (preset-fx-defaults
  // .ts): its own key, then the legacy shared key an older brand may hold, then
  // the preset's tuned default. `none` has no keys.
  const fx = fxDefaultsFor(resolvedPreset);
  const fxValue = (setting: FxSetting): number => {
    if (!style) return fx[setting];
    const own =
      resolvedPreset === 'none'
        ? null
        : readBrandVar(style, presetFxKey(resolvedPreset, setting), isDark);
    return num(
      own ?? readBrandVar(style, sharedFxKey(setting), isDark),
      fx[setting]
    );
  };
  const base: ShaderConfigBase = {
    preset: resolvedPreset,
    intensity: fxValue('intensity'),
    grain: fxValue('grain'),
    vignette: fxValue('vignette'),
    logoUrl: logoUrl ?? undefined,
    colors: {
      primary: primary as [number, number, number],
      secondary: secondary as [number, number, number],
      accent: accent as [number, number, number],
      bg: bg as [number, number, number],
    },
    brand: { primary: brandSlot('primary', PRIMARY), bg: brandSlot('bg', BG) },
  };

  const rv = (key: string, def: number) =>
    num(style ? readBrandVar(style, key, isDark) : null, def);

  // `resolvedPreset` is a resolved id, so it always has a builder.
  return PRESET_BUILDERS[resolvedPreset](base, rv, style, isDark);
}

/**
 * Per-preset builders. Each takes the shared `base` config plus helpers
 * and returns the preset-specific `ShaderConfig` variant. TypeScript's
 * `Record<ShaderPresetId, ...>` enforces exhaustiveness so any new preset
 * added to `ShaderPresetId` must be wired up here — and its keys are also
 * what `resolvePresetId` treats as a live id.
 */
type PresetBuilder = (
  base: ShaderConfigBase,
  rv: (key: string, def: number) => number,
  style: CSSStyleDeclaration | null,
  isDark: boolean
) => ShaderConfig;

const PRESET_BUILDERS: Record<ShaderPresetId, PresetBuilder> = {
  suture: (base, rv) => ({
    ...base,
    preset: 'suture',
    curl: rv('shader-curl', DEFAULTS.curl),
    dissipation: rv('shader-dissipation', DEFAULTS.dissipation),
    advection: rv('shader-advection', DEFAULTS.advection),
    force: rv('shader-force', DEFAULTS.force),
  }),
  ether: (base, rv) => ({
    ...base,
    preset: 'ether',
    rotationSpeed: rv('shader-rotation-speed', DEFAULTS.rotationSpeed),
    complexity: Math.round(rv('shader-complexity', DEFAULTS.complexity)),
    zoom: rv('shader-zoom', DEFAULTS.zoom),
    glow: rv('shader-glow', DEFAULTS.glow),
    scale: rv('shader-scale', DEFAULTS.scale),
    aberration: rv('shader-aberration', DEFAULTS.aberration),
  }),
  ripple: (base, rv) => ({
    ...base,
    preset: 'ripple',
    waveSpeed: rv('shader-wave-speed', DEFAULTS.waveSpeed),
    damping: rv('shader-damping', DEFAULTS.damping),
    rippleSize: rv('shader-ripple-size', DEFAULTS.rippleSize),
    refraction: rv('shader-refraction', DEFAULTS.refraction),
  }),
  // Pulse paints the shared palette: its own colour picker, red for every org,
  // is gone, and a stored `shader-pulse-color` is ignored.
  pulse: (base, rv) => ({
    ...base,
    preset: 'pulse',
    damping: rv('shader-pulse-damping', DEFAULTS.pulseDamping),
    waveScale: rv('shader-wave-scale', DEFAULTS.waveScale),
    camHeight: rv('shader-cam-height', DEFAULTS.camHeight),
    camTarget: rv('shader-cam-target', DEFAULTS.camTarget),
    specular: rv('shader-specular', DEFAULTS.specular),
    impulseSize: rv('shader-impulse-size', DEFAULTS.impulseSize),
  }),
  ink: (base, rv) => ({
    ...base,
    preset: 'ink',
    diffusion: rv('shader-ink-diffusion', DEFAULTS.inkDiffusion),
    advection: rv('shader-ink-advection', DEFAULTS.inkAdvection),
    dropSize: rv('shader-ink-drop-size', DEFAULTS.inkDropSize),
    evaporation: rv('shader-ink-evaporation', DEFAULTS.inkEvaporation),
    curl: rv('shader-ink-curl', DEFAULTS.inkCurl),
  }),
  topo: (base, rv) => ({
    ...base,
    preset: 'topo',
    lineCount: Math.round(rv('shader-topo-line-count', DEFAULTS.topoLineCount)),
    lineWidth: rv('shader-topo-line-width', DEFAULTS.topoLineWidth),
    speed: rv('shader-topo-speed', DEFAULTS.topoSpeed),
    scale: rv('shader-topo-scale', DEFAULTS.topoScale),
    elevation: rv('shader-topo-elevation', DEFAULTS.topoElevation),
    octaves: Math.round(rv('shader-topo-octaves', DEFAULTS.topoOctaves)),
  }),
  glass: (base, rv) => ({
    ...base,
    preset: 'glass',
    cellSize: rv('shader-glass-cell-size', DEFAULTS.glassCellSize),
    border: rv('shader-glass-border', DEFAULTS.glassBorder),
    drift: rv('shader-glass-drift', DEFAULTS.glassDrift),
    glow: rv('shader-glass-glow', DEFAULTS.glassGlow),
    light: rv('shader-glass-light', DEFAULTS.glassLight),
    lineSoftness: rv('shader-glass-line-softness', DEFAULTS.glassLineSoftness),
    lineTint: rv('shader-glass-line-colour', DEFAULTS.glassLineTint),
    pieceEdges: rv('shader-glass-piece-edges', DEFAULTS.glassPieceEdges),
  }),
  film: (base, rv) => ({
    ...base,
    preset: 'film',
    filmScale: rv('shader-film-scale', DEFAULTS.filmScale),
    filmSpeed: rv('shader-film-speed', DEFAULTS.filmSpeed),
    bands: rv('shader-film-bands', DEFAULTS.filmBands),
    shift: rv('shader-film-shift', DEFAULTS.filmShift),
    ripple: rv('shader-film-ripple', DEFAULTS.filmRipple),
  }),
  flux: (base, rv) => ({
    ...base,
    preset: 'flux',
    poles: Math.round(rv('shader-flux-poles', DEFAULTS.fluxPoles)),
    lineDensity: rv('shader-flux-line-density', DEFAULTS.fluxLineDensity),
    lineWidth: rv('shader-flux-line-width', DEFAULTS.fluxLineWidth),
    strength: rv('shader-flux-strength', DEFAULTS.fluxStrength),
    speed: rv('shader-flux-speed', DEFAULTS.fluxSpeed),
  }),
  lava: (base, rv) => ({
    ...base,
    preset: 'lava',
    crackScale: rv('shader-lava-crack-scale', DEFAULTS.lavaCrackScale),
    crackWidth: rv('shader-lava-crack-width', DEFAULTS.lavaCrackWidth),
    glow: rv('shader-lava-glow', DEFAULTS.lavaGlow),
    speed: rv('shader-lava-speed', DEFAULTS.lavaSpeed),
    crust: rv('shader-lava-crust', DEFAULTS.lavaCrust),
    heat: rv('shader-lava-heat', DEFAULTS.lavaHeat),
  }),
  caustic: (base, rv) => ({
    ...base,
    preset: 'caustic',
    scale: rv('shader-caustic-scale', DEFAULTS.causticScale),
    speed: rv('shader-caustic-speed', DEFAULTS.causticSpeed),
    iterations: Math.round(
      rv('shader-caustic-iterations', DEFAULTS.causticIterations)
    ),
    brightness: rv('shader-caustic-brightness', DEFAULTS.causticBrightness),
    ripple: rv('shader-caustic-ripple', DEFAULTS.causticRipple),
  }),
  physarum: (base, rv) => ({
    ...base,
    preset: 'physarum',
    diffusion: rv('shader-physarum-diffusion', DEFAULTS.physarumDiffusion),
    decay: rv('shader-physarum-decay', DEFAULTS.physarumDecay),
    deposit: rv('shader-physarum-deposit', DEFAULTS.physarumDeposit),
    sensor: rv('shader-physarum-sensor', DEFAULTS.physarumSensor),
    turn: rv('shader-physarum-turn', DEFAULTS.physarumTurn),
  }),
  aurora: (base, rv) => ({
    ...base,
    preset: 'aurora',
    layers: Math.round(rv('shader-aurora-layers', DEFAULTS.auroraLayers)),
    speed: rv('shader-aurora-speed', DEFAULTS.auroraSpeed),
    height: rv('shader-aurora-height', DEFAULTS.auroraHeight),
    spread: rv('shader-aurora-spread', DEFAULTS.auroraSpread),
    shimmer: rv('shader-aurora-shimmer', DEFAULTS.auroraShimmer),
  }),
  lenia: (base, rv) => ({
    ...base,
    preset: 'lenia',
    radius: rv('shader-lenia-radius', DEFAULTS.leniaRadius),
    growth: rv('shader-lenia-growth', DEFAULTS.leniaGrowth),
    width: rv('shader-lenia-width', DEFAULTS.leniaWidth),
    speed: Math.round(rv('shader-lenia-speed', DEFAULTS.leniaSpeed)),
    dt: rv('shader-lenia-dt', DEFAULTS.leniaDt),
  }),
  fracture: (base, rv) => ({
    ...base,
    preset: 'fracture',
    cuts: Math.round(rv('shader-fracture-cuts', DEFAULTS.fractureCuts)),
    speed: rv('shader-fracture-speed', DEFAULTS.fractureSpeed),
    border: rv('shader-fracture-border', DEFAULTS.fractureBorder),
    shadow: rv('shader-fracture-shadow', DEFAULTS.fractureShadow),
    fill: rv('shader-fracture-fill', DEFAULTS.fractureFill),
    lineSoftness: rv(
      'shader-fracture-line-softness',
      DEFAULTS.fractureLineSoftness
    ),
    lineTint: rv('shader-fracture-line-colour', DEFAULTS.fractureLineTint),
  }),
  flow: (base, rv) => ({
    ...base,
    preset: 'flow',
    curl: rv('shader-flow-curl', DEFAULTS.flowCurl),
    advection: rv('shader-flow-advection', DEFAULTS.flowAdvection),
    smoothing: rv('shader-flow-smoothing', DEFAULTS.flowSmoothing),
    contrast: rv('shader-flow-contrast', DEFAULTS.flowContrast),
    fieldSpeed: rv('shader-flow-field-speed', DEFAULTS.flowFieldSpeed),
  }),
  none: (base) => ({ ...base, preset: 'none' }),
};
