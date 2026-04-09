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
}

export interface EtherConfig extends ShaderConfigBase {
  preset: 'ether';
  rotationSpeed: number;
  complexity: number;
  zoom: number;
}

export interface WarpConfig extends ShaderConfigBase {
  preset: 'warp';
  warpStrength: number;
  lightAngle: number;
}

export interface RippleConfig extends ShaderConfigBase {
  preset: 'ripple';
  waveSpeed: number;
  damping: number;
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
  intensity: 0.4,
  grain: 0.025,
  vignette: 0.2,
  curl: 30,
  dissipation: 0.985,
  rotationSpeed: 0.4,
  complexity: 6,
  zoom: 5.0,
  warpStrength: 1.5,
  lightAngle: 135,
  waveSpeed: 0.8,
  damping: 0.995,
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

  switch (resolvedPreset) {
    case 'suture':
      return {
        ...base,
        preset: 'suture',
        curl: num(el ? readBrandVar(el, 'shader-curl') : null, DEFAULTS.curl),
        dissipation: num(
          el ? readBrandVar(el, 'shader-dissipation') : null,
          DEFAULTS.dissipation
        ),
      };
    case 'ether':
      return {
        ...base,
        preset: 'ether',
        rotationSpeed: num(
          el ? readBrandVar(el, 'shader-rotation-speed') : null,
          DEFAULTS.rotationSpeed
        ),
        complexity: Math.round(
          num(
            el ? readBrandVar(el, 'shader-complexity') : null,
            DEFAULTS.complexity
          )
        ),
        zoom: num(el ? readBrandVar(el, 'shader-zoom') : null, DEFAULTS.zoom),
      };
    case 'warp':
      return {
        ...base,
        preset: 'warp',
        warpStrength: num(
          el ? readBrandVar(el, 'shader-warp-strength') : null,
          DEFAULTS.warpStrength
        ),
        lightAngle: num(
          el ? readBrandVar(el, 'shader-light-angle') : null,
          DEFAULTS.lightAngle
        ),
      };
    case 'ripple':
      return {
        ...base,
        preset: 'ripple',
        waveSpeed: num(
          el ? readBrandVar(el, 'shader-wave-speed') : null,
          DEFAULTS.waveSpeed
        ),
        damping: num(
          el ? readBrandVar(el, 'shader-damping') : null,
          DEFAULTS.damping
        ),
      };
    default:
      return { ...base, preset: 'none' };
  }
}
