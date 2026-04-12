/**
 * Shader Config — Parse tokenOverrides (via CSS custom properties) into typed config.
 *
 * Brand editor injects shader-* keys as --brand-shader-* CSS properties on .org-layout.
 * This module reads them back via getComputedStyle and provides typed defaults.
 */

export type ShaderPresetId =
  | 'suture'
  | 'ether'
  | 'warp'
  | 'ripple'
  | 'pulse'
  | 'ink'
  | 'topo'
  | 'nebula'
  | 'turing'
  | 'silk'
  | 'glass'
  | 'film'
  | 'flux'
  | 'lava'
  | 'caustic'
  | 'physarum'
  | 'rain'
  | 'frost'
  | 'glow'
  | 'life'
  | 'mycelium'
  | 'aurora'
  | 'tendrils'
  | 'pollen'
  | 'growth'
  | 'geode'
  | 'lenia'
  | 'ocean'
  | 'bismuth'
  | 'pearl'
  | 'vortex'
  | 'gyroid'
  | 'waves'
  | 'clouds'
  | 'fracture'
  | 'julia'
  | 'vapor'
  | 'tunnel'
  | 'none';

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

export interface PulseConfig extends ShaderConfigBase {
  preset: 'pulse';
  damping: number;
  waveScale: number;
  camHeight: number;
  camTarget: number;
  specular: number;
  impulseSize: number;
  /** Surface override color — defaults to blood red (#d10000). */
  pulseColor: [number, number, number];
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

export interface NebulaConfig extends ShaderConfigBase {
  preset: 'nebula';
  density: number;
  speed: number;
  scale: number;
  depth: number;
  wind: number;
  stars: number;
}

export interface TuringConfig extends ShaderConfigBase {
  preset: 'turing';
  feed: number;
  kill: number;
  da: number;
  db: number;
  speed: number;
}

export interface SilkConfig extends ShaderConfigBase {
  preset: 'silk';
  foldScale: number;
  foldDepth: number;
  speed: number;
  softness: number;
  sheen: number;
  lining: number;
}

export interface GlassConfig extends ShaderConfigBase {
  preset: 'glass';
  cellSize: number;
  border: number;
  drift: number;
  glow: number;
  light: number;
}

export interface FilmConfig extends ShaderConfigBase {
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

export interface CausticConfig extends ShaderConfigBase {
  preset: 'caustic';
  scale: number;
  speed: number;
  iterations: number;
  brightness: number;
  ripple: number;
}

export interface PhysarumConfig extends ShaderConfigBase {
  preset: 'physarum';
  diffusion: number;
  decay: number;
  deposit: number;
  sensor: number;
  turn: number;
}

export interface RainConfig extends ShaderConfigBase {
  preset: 'rain';
  density: number;
  speed: number;
  size: number;
  refraction: number;
  blur: number;
}

export interface FrostConfig extends ShaderConfigBase {
  preset: 'frost';
  growth: number;
  branch: number;
  symmetry: number;
  melt: number;
  glow: number;
}

export interface GlowConfig extends ShaderConfigBase {
  preset: 'glow';
  count: number;
  pulse: number;
  size: number;
  drift: number;
  trail: number;
  depth: number;
}

export interface LifeConfig extends ShaderConfigBase {
  preset: 'life';
  inner: number;
  outer: number;
  birth: number;
  death: number;
  speed: number;
}

export interface MyceliumConfig extends ShaderConfigBase {
  preset: 'mycelium';
  growth: number;
  branch: number;
  spread: number;
  pulse: number;
  thickness: number;
}

export interface AuroraConfig extends ShaderConfigBase {
  preset: 'aurora';
  layers: number;
  speed: number;
  height: number;
  spread: number;
  shimmer: number;
}

export interface TendrilsConfig extends ShaderConfigBase {
  preset: 'tendrils';
  scale: number;
  speed: number;
  steps: number;
  curl: number;
  fade: number;
}

export interface PollenConfig extends ShaderConfigBase {
  preset: 'pollen';
  density: number;
  size: number;
  fibres: number;
  drift: number;
  depth: number;
  bokeh: number;
}

export interface GrowthConfig extends ShaderConfigBase {
  preset: 'growth';
  speed: number;
  noise: number;
  scale: number;
  width: number;
  glow: number;
}

export interface GeodeConfig extends ShaderConfigBase {
  preset: 'geode';
  bands: number;
  warp: number;
  cavity: number;
  speed: number;
  sparkle: number;
}

export interface LeniaConfig extends ShaderConfigBase {
  preset: 'lenia';
  radius: number;
  growth: number;
  width: number;
  speed: number;
  dt: number;
}

export interface OceanConfig extends ShaderConfigBase {
  preset: 'ocean';
  causticScale: number;
  sandScale: number;
  speed: number;
  shadow: number;
  ripple: number;
}

export interface BismuthConfig extends ShaderConfigBase {
  preset: 'bismuth';
  terraces: number;
  warp: number;
  iridescence: number;
  speed: number;
  edge: number;
}

export interface PearlConfig extends ShaderConfigBase {
  preset: 'pearl';
  displacement: number;
  speed: number;
  fresnel: number;
  specular: number;
}

export interface VortexConfig extends ShaderConfigBase {
  preset: 'vortex';
  speed: number;
  density: number;
  twist: number;
  rings: number;
  spiral: number;
}

export interface GyroidConfig extends ShaderConfigBase {
  preset: 'gyroid';
  scale1: number;
  scale2: number;
  speed: number;
  density: number;
  thickness: number;
}

export interface WavesConfig extends ShaderConfigBase {
  preset: 'waves';
  height: number;
  speed: number;
  chop: number;
  foam: number;
  depth: number;
}

export interface CloudsConfig extends ShaderConfigBase {
  preset: 'clouds';
  cover: number;
  speed: number;
  scale: number;
  dark: number;
  light: number;
}

export interface FractureConfig extends ShaderConfigBase {
  preset: 'fracture';
  cuts: number;
  speed: number;
  border: number;
  shadow: number;
  fill: number;
}

export interface JuliaConfig extends ShaderConfigBase {
  preset: 'julia';
  zoom: number;
  speed: number;
  iterations: number;
  radius: number;
  saturation: number;
}

export interface VaporConfig extends ShaderConfigBase {
  preset: 'vapor';
  density: number;
  speed: number;
  scale: number;
  warmth: number;
  glow: number;
}

export interface TunnelConfig extends ShaderConfigBase {
  preset: 'tunnel';
  speed: number;
  fractal: number;
  radius: number;
  brightness: number;
  twist: number;
}

export interface NoneConfig extends ShaderConfigBase {
  preset: 'none';
}

export type ShaderConfig =
  | SutureConfig
  | EtherConfig
  | WarpConfig
  | RippleConfig
  | PulseConfig
  | InkConfig
  | TopoConfig
  | NebulaConfig
  | TuringConfig
  | SilkConfig
  | GlassConfig
  | FilmConfig
  | FluxConfig
  | LavaConfig
  | CausticConfig
  | PhysarumConfig
  | RainConfig
  | FrostConfig
  | GlowConfig
  | LifeConfig
  | MyceliumConfig
  | AuroraConfig
  | TendrilsConfig
  | PollenConfig
  | GrowthConfig
  | GeodeConfig
  | LeniaConfig
  | OceanConfig
  | BismuthConfig
  | PearlConfig
  | VortexConfig
  | GyroidConfig
  | WavesConfig
  | CloudsConfig
  | FractureConfig
  | JuliaConfig
  | VaporConfig
  | TunnelConfig
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
  // Pulse
  pulseDamping: 0.97,
  waveScale: 4.0,
  camHeight: 30,
  camTarget: -30,
  specular: 0.6,
  impulseSize: 0.04,
  pulseColor: [0.82, 0.0, 0.0] as [number, number, number], // blood red (#d10000)
  // Ink
  inkDiffusion: 1.5,
  inkAdvection: 0.8,
  inkDropSize: 0.05,
  inkEvaporation: 0.997,
  inkCurl: 15,
  // Topo
  topoLineCount: 12,
  topoLineWidth: 1.2,
  topoSpeed: 0.15,
  topoScale: 2.5,
  topoElevation: 1.0,
  topoOctaves: 3,
  // Nebula
  nebulaDensity: 0.8,
  nebulaSpeed: 0.12,
  nebulaScale: 2.0,
  nebulaDepth: 8,
  nebulaWind: 0.5,
  nebulaStars: 0.3,
  // Turing
  turingFeed: 0.055,
  turingKill: 0.062,
  turingDa: 1.0,
  turingDb: 0.5,
  turingSpeed: 4,
  // Silk
  silkFoldScale: 2.5,
  silkFoldDepth: 1.5,
  silkSpeed: 0.1,
  silkSoftness: 0.7,
  silkSheen: 0.15,
  silkLining: 0.1,
  // Glass
  glassCellSize: 5.0,
  glassBorder: 0.04,
  glassDrift: 0.1,
  glassGlow: 0.2,
  glassLight: 0.15,
  // Film
  filmScale: 2.5,
  filmSpeed: 0.1,
  filmBands: 4.0,
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
  causticScale: 2.5,
  causticSpeed: 0.1,
  causticIterations: 3,
  causticBrightness: 1.2,
  causticRipple: 1.5,
  // Physarum
  physarumDiffusion: 1.0,
  physarumDecay: 0.98,
  physarumDeposit: 1.0,
  physarumSensor: 0.03,
  physarumTurn: 0.25,
  // Rain
  rainDensity: 0.6,
  rainSpeed: 1.0,
  rainSize: 1.0,
  rainRefraction: 0.3,
  rainBlur: 1.0,
  // Frost
  frostGrowth: 0.6,
  frostBranch: 0.3,
  frostSymmetry: 6,
  frostMelt: 1.0,
  frostGlow: 0.8,
  // Glow
  glowCount: 10,
  glowPulse: 0.7,
  glowSize: 1.0,
  glowDrift: 0.1,
  glowTrail: 0.4,
  glowDepth: 3,
  // Life
  lifeInner: 7.0,
  lifeOuter: 21.0,
  lifeBirth: 0.278,
  lifeDeath: 0.365,
  lifeSpeed: 2,
  // Mycelium
  myceliumGrowth: 0.5,
  myceliumBranch: 0.25,
  myceliumSpread: 1.0,
  myceliumPulse: 0.7,
  myceliumThickness: 1.0,
  // Aurora
  auroraLayers: 5,
  auroraSpeed: 0.1,
  auroraHeight: 0.4,
  auroraSpread: 0.25,
  auroraShimmer: 0.8,
  // Tendrils
  tendrilsScale: 2.5,
  tendrilsSpeed: 0.12,
  tendrilsSteps: 5,
  tendrilsCurl: 1.0,
  tendrilsFade: 0.6,
  // Pollen
  pollenDensity: 0.6,
  pollenSize: 1.0,
  pollenFibres: 5,
  pollenDrift: 0.1,
  pollenDepth: 3,
  pollenBokeh: 0.5,
  // Growth
  growthSpeed: 0.2,
  growthNoise: 0.8,
  growthScale: 2.0,
  growthWidth: 1.0,
  growthGlow: 0.8,
  // Geode
  geodeBands: 8,
  geodeWarp: 0.8,
  geodeCavity: 0.2,
  geodeSpeed: 0.06,
  geodeSparkle: 0.8,
  // Lenia
  leniaRadius: 13.0,
  leniaGrowth: 0.14,
  leniaWidth: 0.04,
  leniaSpeed: 2,
  leniaDt: 0.2,
  // Ocean
  oceanCausticScale: 2.0,
  oceanSandScale: 3.0,
  oceanSpeed: 0.1,
  oceanShadow: 0.25,
  oceanRipple: 1.0,
  // Bismuth
  bismuthTerraces: 8,
  bismuthWarp: 0.8,
  bismuthIridescence: 0.8,
  bismuthSpeed: 0.06,
  bismuthEdge: 0.8,
  // Pearl
  pearlDisplacement: 0.15,
  pearlSpeed: 0.7,
  pearlFresnel: 3.0,
  pearlSpecular: 1.25,
  // Vortex
  vortexSpeed: 0.2,
  vortexDensity: 40,
  vortexTwist: 1.0,
  vortexRings: 1.0,
  vortexSpiral: 0.6,
  // Gyroid
  gyroidScale1: 5.23,
  gyroidScale2: 10.76,
  gyroidSpeed: 0.2,
  gyroidDensity: 3.5,
  gyroidThickness: 0.03,
  // Waves
  wavesHeight: 1.0,
  wavesSpeed: 1.0,
  wavesChop: 0.7,
  wavesFoam: 0.3,
  wavesDepth: 0.6,
  // Clouds
  cloudsCover: 0.2,
  cloudsSpeed: 0.03,
  cloudsScale: 1.1,
  cloudsDark: 0.5,
  cloudsLight: 0.3,
  // Fracture
  fractureCuts: 8,
  fractureSpeed: 0.17,
  fractureBorder: 0.01,
  fractureShadow: 0.05,
  fractureFill: 0.85,
  // Julia
  juliaZoom: 1.3,
  juliaSpeed: 0.33,
  juliaIterations: 75,
  juliaRadius: 0.79,
  juliaSaturation: 0.5,
  // Vapor
  vaporDensity: 1.0,
  vaporSpeed: 1.5,
  vaporScale: 5.0,
  vaporWarmth: 0.5,
  vaporGlow: 0.8,
  // Tunnel
  tunnelSpeed: 2.0,
  tunnelFractal: 6,
  tunnelRadius: 2.0,
  tunnelBrightness: 1.0,
  tunnelTwist: 0.07,
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
    case 'pulse': {
      const pulseColorRaw = el ? readBrandVar(el, 'shader-pulse-color') : null;
      return {
        ...base,
        preset: 'pulse',
        damping: rv('shader-pulse-damping', DEFAULTS.pulseDamping),
        waveScale: rv('shader-wave-scale', DEFAULTS.waveScale),
        camHeight: rv('shader-cam-height', DEFAULTS.camHeight),
        camTarget: rv('shader-cam-target', DEFAULTS.camTarget),
        specular: rv('shader-specular', DEFAULTS.specular),
        impulseSize: rv('shader-impulse-size', DEFAULTS.impulseSize),
        pulseColor: pulseColorRaw
          ? hexToRgb(pulseColorRaw)
          : DEFAULTS.pulseColor,
      };
    }
    case 'ink':
      return {
        ...base,
        preset: 'ink',
        diffusion: rv('shader-ink-diffusion', DEFAULTS.inkDiffusion),
        advection: rv('shader-ink-advection', DEFAULTS.inkAdvection),
        dropSize: rv('shader-ink-drop-size', DEFAULTS.inkDropSize),
        evaporation: rv('shader-ink-evaporation', DEFAULTS.inkEvaporation),
        curl: rv('shader-ink-curl', DEFAULTS.inkCurl),
      };
    case 'topo':
      return {
        ...base,
        preset: 'topo',
        lineCount: Math.round(
          rv('shader-topo-line-count', DEFAULTS.topoLineCount)
        ),
        lineWidth: rv('shader-topo-line-width', DEFAULTS.topoLineWidth),
        speed: rv('shader-topo-speed', DEFAULTS.topoSpeed),
        scale: rv('shader-topo-scale', DEFAULTS.topoScale),
        elevation: rv('shader-topo-elevation', DEFAULTS.topoElevation),
        octaves: Math.round(rv('shader-topo-octaves', DEFAULTS.topoOctaves)),
      };
    case 'nebula':
      return {
        ...base,
        preset: 'nebula',
        density: rv('shader-nebula-density', DEFAULTS.nebulaDensity),
        speed: rv('shader-nebula-speed', DEFAULTS.nebulaSpeed),
        scale: rv('shader-nebula-scale', DEFAULTS.nebulaScale),
        depth: Math.round(rv('shader-nebula-depth', DEFAULTS.nebulaDepth)),
        wind: rv('shader-nebula-wind', DEFAULTS.nebulaWind),
        stars: rv('shader-nebula-stars', DEFAULTS.nebulaStars),
      };
    case 'turing':
      return {
        ...base,
        preset: 'turing',
        feed: rv('shader-turing-feed', DEFAULTS.turingFeed),
        kill: rv('shader-turing-kill', DEFAULTS.turingKill),
        da: rv('shader-turing-da', DEFAULTS.turingDa),
        db: rv('shader-turing-db', DEFAULTS.turingDb),
        speed: Math.round(rv('shader-turing-speed', DEFAULTS.turingSpeed)),
      };
    case 'silk':
      return {
        ...base,
        preset: 'silk',
        foldScale: rv('shader-silk-fold-scale', DEFAULTS.silkFoldScale),
        foldDepth: rv('shader-silk-fold-depth', DEFAULTS.silkFoldDepth),
        speed: rv('shader-silk-speed', DEFAULTS.silkSpeed),
        softness: rv('shader-silk-softness', DEFAULTS.silkSoftness),
        sheen: rv('shader-silk-sheen', DEFAULTS.silkSheen),
        lining: rv('shader-silk-lining', DEFAULTS.silkLining),
      };
    case 'glass':
      return {
        ...base,
        preset: 'glass',
        cellSize: rv('shader-glass-cell-size', DEFAULTS.glassCellSize),
        border: rv('shader-glass-border', DEFAULTS.glassBorder),
        drift: rv('shader-glass-drift', DEFAULTS.glassDrift),
        glow: rv('shader-glass-glow', DEFAULTS.glassGlow),
        light: rv('shader-glass-light', DEFAULTS.glassLight),
      };
    case 'film':
      return {
        ...base,
        preset: 'film',
        filmScale: rv('shader-film-scale', DEFAULTS.filmScale),
        filmSpeed: rv('shader-film-speed', DEFAULTS.filmSpeed),
        bands: rv('shader-film-bands', DEFAULTS.filmBands),
        shift: rv('shader-film-shift', DEFAULTS.filmShift),
        ripple: rv('shader-film-ripple', DEFAULTS.filmRipple),
      };
    case 'flux':
      return {
        ...base,
        preset: 'flux',
        poles: Math.round(rv('shader-flux-poles', DEFAULTS.fluxPoles)),
        lineDensity: rv('shader-flux-line-density', DEFAULTS.fluxLineDensity),
        lineWidth: rv('shader-flux-line-width', DEFAULTS.fluxLineWidth),
        strength: rv('shader-flux-strength', DEFAULTS.fluxStrength),
        speed: rv('shader-flux-speed', DEFAULTS.fluxSpeed),
      };
    case 'lava':
      return {
        ...base,
        preset: 'lava',
        crackScale: rv('shader-lava-crack-scale', DEFAULTS.lavaCrackScale),
        crackWidth: rv('shader-lava-crack-width', DEFAULTS.lavaCrackWidth),
        glow: rv('shader-lava-glow', DEFAULTS.lavaGlow),
        speed: rv('shader-lava-speed', DEFAULTS.lavaSpeed),
        crust: rv('shader-lava-crust', DEFAULTS.lavaCrust),
        heat: rv('shader-lava-heat', DEFAULTS.lavaHeat),
      };
    case 'caustic':
      return {
        ...base,
        preset: 'caustic',
        scale: rv('shader-caustic-scale', DEFAULTS.causticScale),
        speed: rv('shader-caustic-speed', DEFAULTS.causticSpeed),
        iterations: Math.round(
          rv('shader-caustic-iterations', DEFAULTS.causticIterations)
        ),
        brightness: rv('shader-caustic-brightness', DEFAULTS.causticBrightness),
        ripple: rv('shader-caustic-ripple', DEFAULTS.causticRipple),
      };
    case 'physarum':
      return {
        ...base,
        preset: 'physarum',
        diffusion: rv('shader-physarum-diffusion', DEFAULTS.physarumDiffusion),
        decay: rv('shader-physarum-decay', DEFAULTS.physarumDecay),
        deposit: rv('shader-physarum-deposit', DEFAULTS.physarumDeposit),
        sensor: rv('shader-physarum-sensor', DEFAULTS.physarumSensor),
        turn: rv('shader-physarum-turn', DEFAULTS.physarumTurn),
      };
    case 'rain':
      return {
        ...base,
        preset: 'rain',
        density: rv('shader-rain-density', DEFAULTS.rainDensity),
        speed: rv('shader-rain-speed', DEFAULTS.rainSpeed),
        size: rv('shader-rain-size', DEFAULTS.rainSize),
        refraction: rv('shader-rain-refraction', DEFAULTS.rainRefraction),
        blur: rv('shader-rain-blur', DEFAULTS.rainBlur),
      };
    case 'frost':
      return {
        ...base,
        preset: 'frost',
        growth: rv('shader-frost-growth', DEFAULTS.frostGrowth),
        branch: rv('shader-frost-branch', DEFAULTS.frostBranch),
        symmetry: Math.round(
          rv('shader-frost-symmetry', DEFAULTS.frostSymmetry)
        ),
        melt: rv('shader-frost-melt', DEFAULTS.frostMelt),
        glow: rv('shader-frost-glow', DEFAULTS.frostGlow),
      };
    case 'glow':
      return {
        ...base,
        preset: 'glow',
        count: Math.round(rv('shader-glow-count', DEFAULTS.glowCount)),
        pulse: rv('shader-glow-pulse', DEFAULTS.glowPulse),
        size: rv('shader-glow-size', DEFAULTS.glowSize),
        drift: rv('shader-glow-drift', DEFAULTS.glowDrift),
        trail: rv('shader-glow-trail', DEFAULTS.glowTrail),
        depth: Math.round(rv('shader-glow-depth', DEFAULTS.glowDepth)),
      };
    case 'life':
      return {
        ...base,
        preset: 'life',
        inner: rv('shader-life-inner', DEFAULTS.lifeInner),
        outer: rv('shader-life-outer', DEFAULTS.lifeOuter),
        birth: rv('shader-life-birth', DEFAULTS.lifeBirth),
        death: rv('shader-life-death', DEFAULTS.lifeDeath),
        speed: Math.round(rv('shader-life-speed', DEFAULTS.lifeSpeed)),
      };
    case 'mycelium':
      return {
        ...base,
        preset: 'mycelium',
        growth: rv('shader-mycelium-growth', DEFAULTS.myceliumGrowth),
        branch: rv('shader-mycelium-branch', DEFAULTS.myceliumBranch),
        spread: rv('shader-mycelium-spread', DEFAULTS.myceliumSpread),
        pulse: rv('shader-mycelium-pulse', DEFAULTS.myceliumPulse),
        thickness: rv('shader-mycelium-thickness', DEFAULTS.myceliumThickness),
      };
    case 'aurora':
      return {
        ...base,
        preset: 'aurora',
        layers: Math.round(rv('shader-aurora-layers', DEFAULTS.auroraLayers)),
        speed: rv('shader-aurora-speed', DEFAULTS.auroraSpeed),
        height: rv('shader-aurora-height', DEFAULTS.auroraHeight),
        spread: rv('shader-aurora-spread', DEFAULTS.auroraSpread),
        shimmer: rv('shader-aurora-shimmer', DEFAULTS.auroraShimmer),
      };
    case 'tendrils':
      return {
        ...base,
        preset: 'tendrils',
        scale: rv('shader-tendrils-scale', DEFAULTS.tendrilsScale),
        speed: rv('shader-tendrils-speed', DEFAULTS.tendrilsSpeed),
        steps: Math.round(rv('shader-tendrils-steps', DEFAULTS.tendrilsSteps)),
        curl: rv('shader-tendrils-curl', DEFAULTS.tendrilsCurl),
        fade: rv('shader-tendrils-fade', DEFAULTS.tendrilsFade),
      };
    case 'pollen':
      return {
        ...base,
        preset: 'pollen',
        density: rv('shader-pollen-density', DEFAULTS.pollenDensity),
        size: rv('shader-pollen-size', DEFAULTS.pollenSize),
        fibres: Math.round(rv('shader-pollen-fibres', DEFAULTS.pollenFibres)),
        drift: rv('shader-pollen-drift', DEFAULTS.pollenDrift),
        depth: Math.round(rv('shader-pollen-depth', DEFAULTS.pollenDepth)),
        bokeh: rv('shader-pollen-bokeh', DEFAULTS.pollenBokeh),
      };
    case 'growth':
      return {
        ...base,
        preset: 'growth',
        speed: rv('shader-growth-speed', DEFAULTS.growthSpeed),
        noise: rv('shader-growth-noise', DEFAULTS.growthNoise),
        scale: rv('shader-growth-scale', DEFAULTS.growthScale),
        width: rv('shader-growth-width', DEFAULTS.growthWidth),
        glow: rv('shader-growth-glow', DEFAULTS.growthGlow),
      };
    case 'geode':
      return {
        ...base,
        preset: 'geode',
        bands: Math.round(rv('shader-geode-bands', DEFAULTS.geodeBands)),
        warp: rv('shader-geode-warp', DEFAULTS.geodeWarp),
        cavity: rv('shader-geode-cavity', DEFAULTS.geodeCavity),
        speed: rv('shader-geode-speed', DEFAULTS.geodeSpeed),
        sparkle: rv('shader-geode-sparkle', DEFAULTS.geodeSparkle),
      };
    case 'lenia':
      return {
        ...base,
        preset: 'lenia',
        radius: rv('shader-lenia-radius', DEFAULTS.leniaRadius),
        growth: rv('shader-lenia-growth', DEFAULTS.leniaGrowth),
        width: rv('shader-lenia-width', DEFAULTS.leniaWidth),
        speed: Math.round(rv('shader-lenia-speed', DEFAULTS.leniaSpeed)),
        dt: rv('shader-lenia-dt', DEFAULTS.leniaDt),
      };
    case 'ocean':
      return {
        ...base,
        preset: 'ocean',
        causticScale: rv(
          'shader-ocean-caustic-scale',
          DEFAULTS.oceanCausticScale
        ),
        sandScale: rv('shader-ocean-sand-scale', DEFAULTS.oceanSandScale),
        speed: rv('shader-ocean-speed', DEFAULTS.oceanSpeed),
        shadow: rv('shader-ocean-shadow', DEFAULTS.oceanShadow),
        ripple: rv('shader-ocean-ripple', DEFAULTS.oceanRipple),
      };
    case 'bismuth':
      return {
        ...base,
        preset: 'bismuth',
        terraces: Math.round(
          rv('shader-bismuth-terraces', DEFAULTS.bismuthTerraces)
        ),
        warp: rv('shader-bismuth-warp', DEFAULTS.bismuthWarp),
        iridescence: rv(
          'shader-bismuth-iridescence',
          DEFAULTS.bismuthIridescence
        ),
        speed: rv('shader-bismuth-speed', DEFAULTS.bismuthSpeed),
        edge: rv('shader-bismuth-edge', DEFAULTS.bismuthEdge),
      };
    case 'pearl':
      return {
        ...base,
        preset: 'pearl',
        displacement: rv(
          'shader-pearl-displacement',
          DEFAULTS.pearlDisplacement
        ),
        speed: rv('shader-pearl-speed', DEFAULTS.pearlSpeed),
        fresnel: rv('shader-pearl-fresnel', DEFAULTS.pearlFresnel),
        specular: rv('shader-pearl-specular', DEFAULTS.pearlSpecular),
      };
    case 'vortex':
      return {
        ...base,
        preset: 'vortex',
        speed: rv('shader-vortex-speed', DEFAULTS.vortexSpeed),
        density: Math.round(
          rv('shader-vortex-density', DEFAULTS.vortexDensity)
        ),
        twist: rv('shader-vortex-twist', DEFAULTS.vortexTwist),
        rings: rv('shader-vortex-rings', DEFAULTS.vortexRings),
        spiral: rv('shader-vortex-spiral', DEFAULTS.vortexSpiral),
      };
    case 'gyroid':
      return {
        ...base,
        preset: 'gyroid',
        scale1: rv('shader-gyroid-scale1', DEFAULTS.gyroidScale1),
        scale2: rv('shader-gyroid-scale2', DEFAULTS.gyroidScale2),
        speed: rv('shader-gyroid-speed', DEFAULTS.gyroidSpeed),
        density: rv('shader-gyroid-density', DEFAULTS.gyroidDensity),
        thickness: rv('shader-gyroid-thickness', DEFAULTS.gyroidThickness),
      };
    case 'waves':
      return {
        ...base,
        preset: 'waves',
        height: rv('shader-waves-height', DEFAULTS.wavesHeight),
        speed: rv('shader-waves-speed', DEFAULTS.wavesSpeed),
        chop: rv('shader-waves-chop', DEFAULTS.wavesChop),
        foam: rv('shader-waves-foam', DEFAULTS.wavesFoam),
        depth: rv('shader-waves-depth', DEFAULTS.wavesDepth),
      };
    case 'clouds':
      return {
        ...base,
        preset: 'clouds',
        cover: rv('shader-clouds-cover', DEFAULTS.cloudsCover),
        speed: rv('shader-clouds-speed', DEFAULTS.cloudsSpeed),
        scale: rv('shader-clouds-scale', DEFAULTS.cloudsScale),
        dark: rv('shader-clouds-dark', DEFAULTS.cloudsDark),
        light: rv('shader-clouds-light', DEFAULTS.cloudsLight),
      };
    case 'fracture':
      return {
        ...base,
        preset: 'fracture',
        cuts: Math.round(rv('shader-fracture-cuts', DEFAULTS.fractureCuts)),
        speed: rv('shader-fracture-speed', DEFAULTS.fractureSpeed),
        border: rv('shader-fracture-border', DEFAULTS.fractureBorder),
        shadow: rv('shader-fracture-shadow', DEFAULTS.fractureShadow),
        fill: rv('shader-fracture-fill', DEFAULTS.fractureFill),
      };
    case 'julia':
      return {
        ...base,
        preset: 'julia',
        zoom: rv('shader-julia-zoom', DEFAULTS.juliaZoom),
        speed: rv('shader-julia-speed', DEFAULTS.juliaSpeed),
        iterations: Math.round(
          rv('shader-julia-iterations', DEFAULTS.juliaIterations)
        ),
        radius: rv('shader-julia-radius', DEFAULTS.juliaRadius),
        saturation: rv('shader-julia-saturation', DEFAULTS.juliaSaturation),
      };
    case 'vapor':
      return {
        ...base,
        preset: 'vapor',
        density: rv('shader-vapor-density', DEFAULTS.vaporDensity),
        speed: rv('shader-vapor-speed', DEFAULTS.vaporSpeed),
        scale: rv('shader-vapor-scale', DEFAULTS.vaporScale),
        warmth: rv('shader-vapor-warmth', DEFAULTS.vaporWarmth),
        glow: rv('shader-vapor-glow', DEFAULTS.vaporGlow),
      };
    case 'tunnel':
      return {
        ...base,
        preset: 'tunnel',
        speed: rv('shader-tunnel-speed', DEFAULTS.tunnelSpeed),
        fractal: Math.round(
          rv('shader-tunnel-fractal', DEFAULTS.tunnelFractal)
        ),
        radius: rv('shader-tunnel-radius', DEFAULTS.tunnelRadius),
        brightness: rv('shader-tunnel-brightness', DEFAULTS.tunnelBrightness),
        twist: rv('shader-tunnel-twist', DEFAULTS.tunnelTwist),
      };
    default:
      return { ...base, preset: 'none' };
  }
}
