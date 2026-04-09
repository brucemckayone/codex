/**
 * Shader Config — Parse tokenOverrides (via CSS custom properties) into typed config.
 *
 * Brand editor injects shader-* keys as --brand-shader-* CSS properties on .org-layout.
 * This module reads them back via getComputedStyle and provides typed defaults.
 */

export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'none';

/** Shared configuration fields present on all presets. */
export interface ShaderConfigBase {
  preset: ShaderPresetId;
  intensity: number;
  grain: number;
  vignette: number;
  /** Brand colors parsed from CSS custom properties. */
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
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

export interface WarpConfig extends ShaderConfigBase {
  preset: 'warp';
  warpStrength: number;
  lightAngle: number;
  speed: number;
  detail: number;
  contrast: number;
  invert: boolean;
}

export interface RippleConfig extends ShaderConfigBase {
  preset: 'ripple';
  waveSpeed: number;
  damping: number;
  rippleSize: number;
  refraction: number;
}

export interface NoneConfig extends ShaderConfigBase {
  preset: 'none';
}

export type ShaderConfig =
  | SutureConfig
  | EtherConfig
  | WarpConfig
  | RippleConfig
  | NoneConfig;

/** Default values matching the spec in 14-final-preset-catalog.md */
const DEFAULTS = {
  preset: 'none' as ShaderPresetId,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
  // Suture
  curl: 30,
  dissipation: 0.985,
  advection: 6.0,
  force: 1.0,
  // Ether
  rotationSpeed: 0.4,
  complexity: 6,
  zoom: 5.0,
  glow: 0.5,
  scale: 2.0,
  aberration: 0.003,
  // Warp
  warpStrength: 1.5,
  lightAngle: 135,
  speed: 0.3,
  detail: 4,
  contrast: 1.1,
  invert: true,
  // Ripple
  waveSpeed: 0.8,
  damping: 0.995,
  rippleSize: 0.03,
  refraction: 0.5,
};

/** Parse a hex color (#rrggbb) to normalized [0-1, 0-1, 0-1]. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0.5, 0.5, 0.5];
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

/** Read a --brand-shader-* CSS property from the org layout element. */
function readBrandVar(el: Element, key: string): string | null {
  const val = getComputedStyle(el).getPropertyValue(`--brand-${key}`).trim();
  return val || null;
}

/** Read a --color-brand-* CSS property for brand palette colors. */
function readColorVar(
  el: Element,
  key: string
): [number, number, number] | null {
  const val = getComputedStyle(el).getPropertyValue(`--color-${key}`).trim();
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
 * Read shader configuration from CSS custom properties on the org layout element.
 * Returns a fully typed ShaderConfig with defaults for any missing values.
 */
export function getShaderConfig(orgLayoutEl?: Element | null): ShaderConfig {
  const el = orgLayoutEl ?? document.querySelector('.org-layout');

  const preset = (
    el ? readBrandVar(el, 'shader-preset') : null
  ) as ShaderPresetId | null;
  const resolvedPreset = preset ?? DEFAULTS.preset;

  // Read brand colors from the org's CSS custom properties
  const primary = (el ? readColorVar(el, 'brand-primary') : null) ?? [
    0.486, 0.227, 0.929,
  ];
  const secondary = (el ? readColorVar(el, 'brand-secondary') : null) ?? [
    0.925, 0.282, 0.6,
  ];
  const accent = (el ? readColorVar(el, 'brand-accent') : null) ?? [
    0.961, 0.62, 0.043,
  ];
  const bg = (el ? readColorVar(el, 'brand-bg') : null) ?? [0.059, 0.09, 0.165];

  const base: ShaderConfigBase = {
    preset: resolvedPreset,
    intensity: num(
      el ? readBrandVar(el, 'shader-intensity') : null,
      DEFAULTS.intensity
    ),
    grain: num(el ? readBrandVar(el, 'shader-grain') : null, DEFAULTS.grain),
    vignette: num(
      el ? readBrandVar(el, 'shader-vignette') : null,
      DEFAULTS.vignette
    ),
    colors: {
      primary: primary as [number, number, number],
      secondary: secondary as [number, number, number],
      accent: accent as [number, number, number],
      bg: bg as [number, number, number],
    },
  };

  const rv = (key: string, def: number) =>
    num(el ? readBrandVar(el, key) : null, def);

  switch (resolvedPreset) {
    case 'suture':
      return {
        ...base,
        preset: 'suture',
        curl: rv('shader-curl', DEFAULTS.curl),
        dissipation: rv('shader-dissipation', DEFAULTS.dissipation),
        advection: rv('shader-advection', DEFAULTS.advection),
        force: rv('shader-force', DEFAULTS.force),
      };
    case 'ether':
      return {
        ...base,
        preset: 'ether',
        rotationSpeed: rv('shader-rotation-speed', DEFAULTS.rotationSpeed),
        complexity: Math.round(rv('shader-complexity', DEFAULTS.complexity)),
        zoom: rv('shader-zoom', DEFAULTS.zoom),
        glow: rv('shader-glow', DEFAULTS.glow),
        scale: rv('shader-scale', DEFAULTS.scale),
        aberration: rv('shader-aberration', DEFAULTS.aberration),
      };
    case 'warp': {
      const invertRaw = el ? readBrandVar(el, 'shader-invert') : null;
      return {
        ...base,
        preset: 'warp',
        warpStrength: rv('shader-warp-strength', DEFAULTS.warpStrength),
        lightAngle: rv('shader-light-angle', DEFAULTS.lightAngle),
        speed: rv('shader-speed', DEFAULTS.speed),
        detail: Math.round(rv('shader-detail', DEFAULTS.detail)),
        contrast: rv('shader-contrast', DEFAULTS.contrast),
        invert:
          invertRaw != null
            ? invertRaw !== '0' && invertRaw !== 'false'
            : DEFAULTS.invert,
      };
    }
    case 'ripple':
      return {
        ...base,
        preset: 'ripple',
        waveSpeed: rv('shader-wave-speed', DEFAULTS.waveSpeed),
        damping: rv('shader-damping', DEFAULTS.damping),
        rippleSize: rv('shader-ripple-size', DEFAULTS.rippleSize),
        refraction: rv('shader-refraction', DEFAULTS.refraction),
      };
    default:
      return { ...base, preset: 'none' };
  }
}
