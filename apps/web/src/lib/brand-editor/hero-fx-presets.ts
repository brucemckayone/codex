import { SHADER_DEFAULT_PULSE_COLOR } from '$lib/brand-editor/defaults';

// ── Preset definitions ─────────────────────────────────────────────────
export interface PresetOption {
  id: string;
  label: string;
  description: string;
}

export const HERO_FX_PRESETS: PresetOption[] = [
  { id: 'none', label: 'None', description: 'Default gradient' },
  { id: 'suture', label: 'Suture Fluid', description: 'Organic flowing fluid' },
  { id: 'ether', label: 'Ether', description: 'Ethereal glowing forms' },
  { id: 'warp', label: 'Domain Warp', description: 'Marble textures' },
  {
    id: 'ripple',
    label: 'Water Ripple',
    description: 'Rippling water surface',
  },
  { id: 'pulse', label: 'Pulse', description: '3D liquid wave surface' },
  { id: 'ink', label: 'Ink Dispersion', description: 'Colored ink in liquid' },
  { id: 'topo', label: 'Topo', description: 'Topographic contour lines' },
  { id: 'nebula', label: 'Nebula', description: 'Cosmic dust clouds' },
  {
    id: 'turing',
    label: 'Turing Patterns',
    description: 'Reaction-diffusion organisms',
  },
  { id: 'silk', label: 'Silk Fabric', description: 'Flowing luxury fabric' },
  {
    id: 'glass',
    label: 'Stained Glass',
    description: 'Voronoi stained glass cells',
  },
  {
    id: 'film',
    label: 'Oil Film',
    description: 'Iridescent thin-film shimmer',
  },
  { id: 'flux', label: 'Flux', description: 'Magnetic field lines' },
  {
    id: 'lava',
    label: 'Lava',
    description: 'Molten crust with glowing cracks',
  },
  {
    id: 'caustic',
    label: 'Caustics',
    description: 'Underwater light patterns',
  },
  { id: 'physarum', label: 'Physarum', description: 'Slime mould network' },
  { id: 'rain', label: 'Rain', description: 'Raindrops on glass' },
  { id: 'frost', label: 'Frost', description: 'Ice crystal growth' },
  { id: 'glow', label: 'Glow', description: 'Bioluminescent deep sea' },
  {
    id: 'life',
    label: 'SmoothLife',
    description: 'Continuous cellular automata',
  },
  { id: 'mycelium', label: 'Mycelium', description: 'Fungal network growth' },
  { id: 'aurora', label: 'Aurora', description: 'Northern lights curtains' },
  { id: 'tendrils', label: 'Tendrils', description: 'Flowing curl noise' },
  { id: 'growth', label: 'Growth', description: 'Organic edge expansion' },
  { id: 'lenia', label: 'Lenia', description: 'Artificial lifeforms' },
  { id: 'ocean', label: 'Ocean', description: 'Caustics over sand' },
  { id: 'bismuth', label: 'Bismuth', description: 'Crystal terraces' },
  { id: 'pearl', label: 'Pearl', description: 'Iridescent raymarched sphere' },
  { id: 'vortex', label: 'Vortex', description: 'Polar volumetric spirals' },
  { id: 'gyroid', label: 'Gyroid', description: 'Organic gyroid structure' },
  { id: 'waves', label: 'Waves', description: 'Gerstner ocean surface' },
  { id: 'clouds', label: 'Clouds', description: 'Procedural sky clouds' },
  { id: 'fracture', label: 'Fracture', description: 'Geometric polygon cuts' },
  { id: 'julia', label: 'Julia', description: 'Animated fractal set' },
  { id: 'vapor', label: 'Vapor', description: 'Volumetric aurora clouds' },
  { id: 'tunnel', label: 'Tunnel', description: 'Apollonian fractal tunnel' },
  { id: 'plasma', label: 'Plasma', description: 'Iridescent fluid streams' },
  { id: 'flow', label: 'Flow', description: 'Curl-noise paint streaks' },
  { id: 'spore', label: 'Spore', description: 'Agent-based slime network' },
];

// ── Default values ─────────────────────────────────────────────────────
export const HERO_FX_DEFAULTS: Record<string, string> = {
  'shader-intensity': '0.65',
  'shader-grain': '0.025',
  'shader-vignette': '0.20',
  // Suture
  'shader-curl': '30',
  'shader-dissipation': '0.985',
  'shader-advection': '6.0',
  'shader-force': '1.00',
  // Ether
  'shader-rotation-speed': '0.40',
  'shader-complexity': '6',
  'shader-zoom': '5.0',
  'shader-glow': '0.50',
  'shader-scale': '2.00',
  'shader-aberration': '0.003',
  // Warp
  'shader-warp-strength': '1.50',
  'shader-light-angle': '135',
  'shader-speed': '0.30',
  'shader-detail': '4',
  'shader-contrast': '1.10',
  'shader-invert': '1',
  // Ripple
  'shader-wave-speed': '0.80',
  'shader-damping': '0.995',
  'shader-ripple-size': '0.030',
  'shader-refraction': '0.50',
  // Pulse
  'shader-pulse-damping': '0.97',
  'shader-wave-scale': '4.0',
  'shader-cam-height': '30',
  'shader-cam-target': '-30',
  'shader-specular': '0.60',
  'shader-impulse-size': '0.040',
  'shader-pulse-color': SHADER_DEFAULT_PULSE_COLOR,
  // Ink
  'shader-ink-diffusion': '1.50',
  'shader-ink-advection': '0.80',
  'shader-ink-drop-size': '0.050',
  'shader-ink-evaporation': '0.997',
  'shader-ink-curl': '15',
  // Topo
  'shader-topo-line-count': '12',
  'shader-topo-line-width': '1.2',
  'shader-topo-speed': '0.15',
  'shader-topo-scale': '2.5',
  'shader-topo-elevation': '1.0',
  'shader-topo-octaves': '3',
  // Nebula
  'shader-nebula-density': '0.80',
  'shader-nebula-speed': '0.12',
  'shader-nebula-scale': '2.0',
  'shader-nebula-depth': '8',
  'shader-nebula-wind': '0.50',
  'shader-nebula-stars': '0.30',
  // Turing
  'shader-turing-feed': '0.055',
  'shader-turing-kill': '0.062',
  'shader-turing-da': '1.00',
  'shader-turing-db': '0.50',
  'shader-turing-speed': '4',
  // Silk
  'shader-silk-fold-scale': '2.5',
  'shader-silk-fold-depth': '1.5',
  'shader-silk-speed': '0.10',
  'shader-silk-softness': '0.70',
  'shader-silk-sheen': '0.15',
  'shader-silk-lining': '0.10',
  // Glass
  'shader-glass-cell-size': '5.0',
  'shader-glass-border': '0.04',
  'shader-glass-drift': '0.10',
  'shader-glass-glow': '0.20',
  'shader-glass-light': '0.15',
  // Film
  'shader-film-scale': '2.5',
  'shader-film-speed': '0.10',
  'shader-film-bands': '4.0',
  'shader-film-shift': '0.30',
  'shader-film-ripple': '1.50',
  // Flux
  'shader-flux-poles': '3',
  'shader-flux-line-density': '10.0',
  'shader-flux-line-width': '1.00',
  'shader-flux-strength': '1.50',
  'shader-flux-speed': '0.10',
  // Lava
  'shader-lava-crack-scale': '4.0',
  'shader-lava-crack-width': '0.04',
  'shader-lava-glow': '1.50',
  'shader-lava-speed': '0.08',
  'shader-lava-crust': '0.60',
  'shader-lava-heat': '1.00',
  // Caustic
  'shader-caustic-scale': '2.5',
  'shader-caustic-speed': '0.10',
  'shader-caustic-iterations': '3',
  'shader-caustic-brightness': '1.20',
  'shader-caustic-ripple': '1.50',
  // Physarum
  'shader-physarum-diffusion': '1.00',
  'shader-physarum-decay': '0.980',
  'shader-physarum-deposit': '1.00',
  'shader-physarum-sensor': '0.030',
  'shader-physarum-turn': '0.25',
  // Rain
  'shader-rain-density': '0.60',
  'shader-rain-speed': '1.00',
  'shader-rain-size': '1.00',
  'shader-rain-refraction': '0.30',
  'shader-rain-blur': '1.00',
  // Frost
  'shader-frost-growth': '0.60',
  'shader-frost-branch': '0.30',
  'shader-frost-symmetry': '6',
  'shader-frost-melt': '1.00',
  'shader-frost-glow': '0.80',
  // Glow
  'shader-glow-count': '10',
  'shader-glow-pulse': '0.70',
  'shader-glow-size': '1.00',
  'shader-glow-drift': '0.10',
  'shader-glow-trail': '0.40',
  'shader-glow-depth': '3',
  // SmoothLife
  'shader-life-inner': '5.0',
  'shader-life-outer': '12.0',
  'shader-life-birth': '0.28',
  'shader-life-death': '0.45',
  'shader-life-speed': '2',
  // Mycelium
  'shader-mycelium-growth': '0.50',
  'shader-mycelium-branch': '0.25',
  'shader-mycelium-spread': '1.00',
  'shader-mycelium-pulse': '0.70',
  'shader-mycelium-thickness': '1.00',
  // Aurora
  'shader-aurora-layers': '5',
  'shader-aurora-speed': '0.10',
  'shader-aurora-height': '0.40',
  'shader-aurora-spread': '0.25',
  'shader-aurora-shimmer': '0.80',
  // Tendrils
  'shader-tendrils-scale': '2.5',
  'shader-tendrils-speed': '0.12',
  'shader-tendrils-steps': '5',
  'shader-tendrils-curl': '1.0',
  'shader-tendrils-fade': '0.6',
  // Pollen
  'shader-pollen-density': '0.60',
  'shader-pollen-size': '1.00',
  'shader-pollen-fibres': '5',
  'shader-pollen-drift': '0.10',
  'shader-pollen-depth': '3',
  'shader-pollen-bokeh': '0.50',
  // Growth
  'shader-growth-speed': '0.20',
  'shader-growth-noise': '0.80',
  'shader-growth-scale': '2.00',
  'shader-growth-width': '1.00',
  'shader-growth-glow': '0.80',
  // Geode
  'shader-geode-bands': '8',
  'shader-geode-warp': '0.80',
  'shader-geode-cavity': '0.20',
  'shader-geode-speed': '0.06',
  'shader-geode-sparkle': '0.80',
  // Lenia
  'shader-lenia-radius': '13.0',
  'shader-lenia-growth': '0.14',
  'shader-lenia-width': '0.015',
  'shader-lenia-speed': '2',
  'shader-lenia-dt': '0.2',
  // Ocean
  'shader-ocean-caustic-scale': '2.0',
  'shader-ocean-sand-scale': '3.0',
  'shader-ocean-speed': '0.10',
  'shader-ocean-shadow': '0.25',
  'shader-ocean-ripple': '1.00',
  // Bismuth
  'shader-bismuth-terraces': '8',
  'shader-bismuth-warp': '0.80',
  'shader-bismuth-iridescence': '0.80',
  'shader-bismuth-speed': '0.06',
  'shader-bismuth-edge': '0.80',
  // Pearl
  'shader-pearl-displacement': '0.15',
  'shader-pearl-speed': '0.70',
  'shader-pearl-fresnel': '3.00',
  'shader-pearl-specular': '1.25',
  // Vortex
  'shader-vortex-speed': '0.20',
  'shader-vortex-density': '40',
  'shader-vortex-twist': '1.00',
  'shader-vortex-rings': '1.00',
  'shader-vortex-spiral': '0.60',
  // Gyroid
  'shader-gyroid-scale1': '5.23',
  'shader-gyroid-scale2': '10.76',
  'shader-gyroid-speed': '0.20',
  'shader-gyroid-density': '3.50',
  'shader-gyroid-thickness': '0.030',
  // Waves
  'shader-waves-height': '1.0',
  'shader-waves-speed': '1.0',
  'shader-waves-chop': '0.70',
  'shader-waves-foam': '0.30',
  'shader-waves-depth': '0.60',
  // Clouds
  'shader-clouds-cover': '0.20',
  'shader-clouds-speed': '0.03',
  'shader-clouds-scale': '1.10',
  'shader-clouds-dark': '0.50',
  'shader-clouds-light': '0.30',
  // Fracture
  'shader-fracture-cuts': '8',
  'shader-fracture-speed': '0.17',
  'shader-fracture-border': '0.010',
  'shader-fracture-shadow': '0.05',
  'shader-fracture-fill': '0.85',
  // Julia
  'shader-julia-zoom': '1.3',
  'shader-julia-speed': '0.33',
  'shader-julia-iterations': '75',
  'shader-julia-radius': '0.79',
  'shader-julia-saturation': '0.50',
  // Vapor
  'shader-vapor-density': '1.00',
  'shader-vapor-speed': '1.50',
  'shader-vapor-scale': '5.0',
  'shader-vapor-warmth': '0.50',
  'shader-vapor-glow': '0.80',
  // Tunnel
  'shader-tunnel-speed': '2.0',
  'shader-tunnel-fractal': '6',
  'shader-tunnel-radius': '2.0',
  'shader-tunnel-brightness': '1.00',
  'shader-tunnel-twist': '0.07',
  // Plasma
  'shader-plasma-speed': '0.80',
  'shader-plasma-bands': '25.0',
  'shader-plasma-pressure': '0.90',
  'shader-plasma-turn': '0.11',
  'shader-plasma-diffusion': '1.20',
  // Flow
  'shader-flow-curl': '0.60',
  'shader-flow-advection': '6.0',
  'shader-flow-smoothing': '0.80',
  'shader-flow-contrast': '12.0',
  'shader-flow-field-speed': '1.00',
  // Spore
  'shader-spore-sensor-angle': '12.5',
  'shader-spore-sensor-offset': '3.0',
  'shader-spore-step-size': '6.0',
  'shader-spore-rotation': '22.5',
  'shader-spore-decay': '0.998',
};

/** All shader-* token override keys. */
export const ALL_HERO_FX_SHADER_KEYS =
  Object.keys(HERO_FX_DEFAULTS).concat('shader-preset');

// ── Control manifest (Phase 2) ─────────────────────────────────────────
// Data-driven schema for slider/color/toggle controls per preset. Drives
// the <ControlField> renderer in BrandEditorHeroEffects.svelte. Replaces
// the 41 {:else if} per-preset blocks the file used to carry inline.

/** A range slider with formatted value display. */
export interface SliderControlConfig {
  kind: 'slider';
  /** Token override key (e.g. 'shader-curl'). Must exist in HERO_FX_DEFAULTS. */
  key: string;
  /** Visible label text. */
  label: string;
  min: number;
  max: number;
  step: number;
  /**
   * How to format the displayed value:
   *  - 'int':    String(Math.round(n))
   *  - 'fixed1': n.toFixed(1)
   *  - 'fixed2': n.toFixed(2)
   *  - 'fixed3': n.toFixed(3)
   *  - 'angle':  String(Math.round(n)) + '°'
   */
  format: 'int' | 'fixed1' | 'fixed2' | 'fixed3' | 'angle';
  minLabel?: string;
  maxLabel?: string;
}

/** Native HTML <input type="color">. */
export interface ColorControlConfig {
  kind: 'color';
  key: string;
  label: string;
}

/** Boolean toggle (stores '1'/'0' in the override bucket). */
export interface ToggleControlConfig {
  kind: 'toggle';
  key: string;
  label: string;
}

export type ControlConfig =
  | SliderControlConfig
  | ColorControlConfig
  | ToggleControlConfig;

/** Sliders shown for every active preset (above the per-preset section). */
export const HERO_FX_SHARED_CONTROLS: SliderControlConfig[] = [
  { kind: 'slider', key: 'shader-intensity', label: 'Intensity', min: 0.1, max: 6.0, step: 0.05, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Blazing' },
  { kind: 'slider', key: 'shader-grain', label: 'Grain', min: 0.0, max: 0.08, step: 0.005, format: 'fixed3', minLabel: 'Clean', maxLabel: 'Gritty' },
  { kind: 'slider', key: 'shader-vignette', label: 'Vignette', min: 0.0, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Heavy' },
];

/**
 * Per-preset control sections. Each entry maps a preset id (matching
 * HERO_FX_PRESETS) to its section label and ordered controls. The order
 * here is the order rendered in the editor — pulse's color picker
 * (first) and warp's invert toggle (last) preserve the historical
 * placement of those controls within their sections.
 */
export const HERO_FX_PRESET_CONTROLS: Record<
  string,
  { sectionLabel: string; controls: ControlConfig[] }
> = {
  suture: {
    sectionLabel: 'Suture Fluid',
    controls: [
      { kind: 'slider', key: 'shader-curl', label: 'Curl Strength', min: 1, max: 80, step: 1, format: 'int', minLabel: 'Calm', maxLabel: 'Chaotic' },
      { kind: 'slider', key: 'shader-dissipation', label: 'Dissipation', min: 0.9, max: 0.999, step: 0.001, format: 'fixed3', minLabel: 'Fast', maxLabel: 'Slow' },
      { kind: 'slider', key: 'shader-advection', label: 'Advection', min: 1.0, max: 15.0, step: 0.5, format: 'fixed1', minLabel: 'Short', maxLabel: 'Long' },
      { kind: 'slider', key: 'shader-force', label: 'Mouse Force', min: 0.1, max: 3.0, step: 0.1, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Strong' },
    ],
  },
  ether: {
    sectionLabel: 'Ether',
    controls: [
      { kind: 'slider', key: 'shader-rotation-speed', label: 'Rotation Speed', min: 0.1, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-complexity', label: 'Complexity', min: 3, max: 8, step: 1, format: 'int', minLabel: 'Simple', maxLabel: 'Complex' },
      { kind: 'slider', key: 'shader-zoom', label: 'Zoom', min: 1.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Close', maxLabel: 'Far' },
      { kind: 'slider', key: 'shader-glow', label: 'Glow', min: 0.1, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Dim', maxLabel: 'Bright' },
      { kind: 'slider', key: 'shader-scale', label: 'Scale', min: 0.5, max: 4.0, step: 0.25, format: 'fixed2', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-aberration', label: 'Chromatic Aberration', min: 0.0, max: 0.02, step: 0.001, format: 'fixed3', minLabel: 'None', maxLabel: 'Heavy' },
    ],
  },
  warp: {
    sectionLabel: 'Domain Warp',
    controls: [
      { kind: 'slider', key: 'shader-warp-strength', label: 'Warp Strength', min: 0.5, max: 3.0, step: 0.1, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Extreme' },
      { kind: 'slider', key: 'shader-light-angle', label: 'Light Angle', min: 0, max: 360, step: 5, format: 'angle', minLabel: '0°', maxLabel: '360°' },
      { kind: 'slider', key: 'shader-speed', label: 'Animation Speed', min: 0.05, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-detail', label: 'Detail (octaves)', min: 2, max: 6, step: 1, format: 'int', minLabel: 'Smooth', maxLabel: 'Detailed' },
      { kind: 'slider', key: 'shader-contrast', label: 'Contrast', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Flat', maxLabel: 'Punchy' },
      // Toggle stays at the end of the warp section to match the
      // historical layout of the Invert Colors control.
      { kind: 'toggle', key: 'shader-invert', label: 'Invert Colors' },
    ],
  },
  ripple: {
    sectionLabel: 'Water Ripple',
    controls: [
      { kind: 'slider', key: 'shader-wave-speed', label: 'Wave Speed', min: 0.1, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-damping', label: 'Damping', min: 0.98, max: 0.999, step: 0.001, format: 'fixed3', minLabel: 'Quick', maxLabel: 'Lasting' },
      { kind: 'slider', key: 'shader-ripple-size', label: 'Ripple Size', min: 0.01, max: 0.1, step: 0.005, format: 'fixed3', minLabel: 'Tiny', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-refraction', label: 'Refraction', min: 0.1, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Flat', maxLabel: 'Deep' },
    ],
  },
  pulse: {
    sectionLabel: 'Pulse',
    controls: [
      // Color picker first to mirror the historical layout.
      { kind: 'color', key: 'shader-pulse-color', label: 'Surface Color' },
      { kind: 'slider', key: 'shader-pulse-damping', label: 'Persistence', min: 0.93, max: 0.99, step: 0.01, format: 'fixed2', minLabel: 'Fleeting', maxLabel: 'Lasting' },
      { kind: 'slider', key: 'shader-wave-scale', label: 'Wave Height', min: 1.0, max: 10.0, step: 0.5, format: 'fixed1', minLabel: 'Subtle', maxLabel: 'Dramatic' },
      { kind: 'slider', key: 'shader-cam-height', label: 'View Height', min: 10, max: 50, step: 1, format: 'int', minLabel: 'Low', maxLabel: 'High' },
      { kind: 'slider', key: 'shader-cam-target', label: 'View Depth', min: -50, max: 0, step: 1, format: 'int', minLabel: 'Near', maxLabel: 'Far' },
      { kind: 'slider', key: 'shader-specular', label: 'Shine', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Matte', maxLabel: 'Glossy' },
      { kind: 'slider', key: 'shader-impulse-size', label: 'Touch Size', min: 0.01, max: 0.1, step: 0.005, format: 'fixed3', minLabel: 'Focused', maxLabel: 'Broad' },
    ],
  },
  ink: {
    sectionLabel: 'Ink Dispersion',
    controls: [
      { kind: 'slider', key: 'shader-ink-diffusion', label: 'Diffusion Rate', min: 0.5, max: 3.0, step: 0.1, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-ink-advection', label: 'Flow Strength', min: 0.0, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Still', maxLabel: 'Swirling' },
      { kind: 'slider', key: 'shader-ink-drop-size', label: 'Drop Size', min: 0.02, max: 0.1, step: 0.005, format: 'fixed3', minLabel: 'Tiny', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-ink-evaporation', label: 'Persistence', min: 0.99, max: 0.999, step: 0.001, format: 'fixed3', minLabel: 'Fleeting', maxLabel: 'Lasting' },
      { kind: 'slider', key: 'shader-ink-curl', label: 'Swirl Detail', min: 5, max: 40, step: 1, format: 'int', minLabel: 'Broad', maxLabel: 'Fine' },
    ],
  },
  topo: {
    sectionLabel: 'Topo',
    controls: [
      { kind: 'slider', key: 'shader-topo-line-count', label: 'Contour Lines', min: 5, max: 30, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-topo-line-width', label: 'Line Width', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-topo-speed', label: 'Animation Speed', min: 0.05, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-topo-scale', label: 'Noise Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Zoomed', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-topo-elevation', label: 'Mouse Elevation', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Flat', maxLabel: 'Tall' },
      { kind: 'slider', key: 'shader-topo-octaves', label: 'Detail (octaves)', min: 2, max: 5, step: 1, format: 'int', minLabel: 'Smooth', maxLabel: 'Detailed' },
    ],
  },
  nebula: {
    sectionLabel: 'Nebula',
    controls: [
      { kind: 'slider', key: 'shader-nebula-density', label: 'Gas Density', min: 0.3, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-nebula-speed', label: 'Evolution Speed', min: 0.05, max: 0.5, step: 0.01, format: 'fixed2', minLabel: 'Frozen', maxLabel: 'Flowing' },
      { kind: 'slider', key: 'shader-nebula-scale', label: 'Cloud Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Vast' },
      { kind: 'slider', key: 'shader-nebula-depth', label: 'Depth Quality', min: 4, max: 16, step: 1, format: 'int', minLabel: 'Fast', maxLabel: 'Rich' },
      { kind: 'slider', key: 'shader-nebula-wind', label: 'Stellar Wind', min: 0.0, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Still', maxLabel: 'Gale' },
      { kind: 'slider', key: 'shader-nebula-stars', label: 'Star Density', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Dark', maxLabel: 'Milky' },
    ],
  },
  turing: {
    sectionLabel: 'Turing Patterns',
    controls: [
      { kind: 'slider', key: 'shader-turing-feed', label: 'Feed Rate', min: 0.02, max: 0.08, step: 0.001, format: 'fixed3', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-turing-kill', label: 'Kill Rate', min: 0.05, max: 0.07, step: 0.001, format: 'fixed3', minLabel: 'Spots', maxLabel: 'Maze' },
      { kind: 'slider', key: 'shader-turing-da', label: 'Diffusion A', min: 0.8, max: 1.2, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-turing-db', label: 'Diffusion B', min: 0.3, max: 0.6, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-turing-speed', label: 'Sim Speed', min: 1, max: 8, step: 1, format: 'int', minLabel: 'Slow', maxLabel: 'Fast' },
    ],
  },
  silk: {
    sectionLabel: 'Silk Fabric',
    controls: [
      { kind: 'slider', key: 'shader-silk-fold-scale', label: 'Fold Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Broad' },
      { kind: 'slider', key: 'shader-silk-fold-depth', label: 'Fold Depth', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Flat', maxLabel: 'Deep' },
      { kind: 'slider', key: 'shader-silk-speed', label: 'Flow Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Still', maxLabel: 'Flowing' },
      { kind: 'slider', key: 'shader-silk-softness', label: 'Light Wrap', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Harder', maxLabel: 'Softer' },
      { kind: 'slider', key: 'shader-silk-sheen', label: 'Sheen', min: 0.0, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Matte', maxLabel: 'Satin' },
      { kind: 'slider', key: 'shader-silk-lining', label: 'Lining Peek', min: 0.0, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Visible' },
    ],
  },
  glass: {
    sectionLabel: 'Stained Glass',
    controls: [
      { kind: 'slider', key: 'shader-glass-cell-size', label: 'Cell Size', min: 3.0, max: 10.0, step: 0.5, format: 'fixed1', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-glass-border', label: 'Border Width', min: 0.02, max: 0.1, step: 0.01, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-glass-drift', label: 'Drift Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-glass-glow', label: 'Edge Glow', min: 0.0, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Bright' },
      { kind: 'slider', key: 'shader-glass-light', label: 'Light Shift', min: 0.0, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Static', maxLabel: 'Vivid' },
    ],
  },
  film: {
    sectionLabel: 'Oil Film',
    controls: [
      { kind: 'slider', key: 'shader-film-scale', label: 'Noise Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Broad' },
      { kind: 'slider', key: 'shader-film-speed', label: 'Animation Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-film-bands', label: 'Colour Bands', min: 2.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Smooth', maxLabel: 'Tight' },
      { kind: 'slider', key: 'shader-film-shift', label: 'Angle Shift', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Strong' },
      { kind: 'slider', key: 'shader-film-ripple', label: 'Ripple Strength', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Gentle', maxLabel: 'Intense' },
    ],
  },
  flux: {
    sectionLabel: 'Magnetic Flux',
    controls: [
      { kind: 'slider', key: 'shader-flux-poles', label: 'Magnetic Poles', min: 2, max: 5, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-flux-line-density', label: 'Line Density', min: 5.0, max: 20.0, step: 0.5, format: 'fixed1', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-flux-line-width', label: 'Line Width', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-flux-strength', label: 'Mouse Strength', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Gentle', maxLabel: 'Strong' },
      { kind: 'slider', key: 'shader-flux-speed', label: 'Rotation Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
    ],
  },
  lava: {
    sectionLabel: 'Lava',
    controls: [
      { kind: 'slider', key: 'shader-lava-crack-scale', label: 'Crack Density', min: 2.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-lava-crack-width', label: 'Crack Width', min: 0.02, max: 0.1, step: 0.01, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-lava-glow', label: 'Crack Glow', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Dim', maxLabel: 'Blazing' },
      { kind: 'slider', key: 'shader-lava-speed', label: 'Flow Speed', min: 0.05, max: 0.25, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-lava-crust', label: 'Crust Darkness', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Light', maxLabel: 'Dark' },
      { kind: 'slider', key: 'shader-lava-heat', label: 'Mouse Heat', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Cool', maxLabel: 'Hot' },
    ],
  },
  caustic: {
    sectionLabel: 'Caustics',
    controls: [
      { kind: 'slider', key: 'shader-caustic-scale', label: 'Pattern Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Coarse' },
      { kind: 'slider', key: 'shader-caustic-speed', label: 'Animation Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-caustic-iterations', label: 'Detail Layers', min: 2, max: 5, step: 1, format: 'int', minLabel: 'Simple', maxLabel: 'Complex' },
      { kind: 'slider', key: 'shader-caustic-brightness', label: 'Highlight Power', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Dim', maxLabel: 'Bright' },
      { kind: 'slider', key: 'shader-caustic-ripple', label: 'Mouse Ripple', min: 0.5, max: 3.0, step: 0.1, format: 'fixed1', minLabel: 'Gentle', maxLabel: 'Strong' },
    ],
  },
  physarum: {
    sectionLabel: 'Physarum Network',
    controls: [
      { kind: 'slider', key: 'shader-physarum-diffusion', label: 'Trail Spread', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Tight', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-physarum-decay', label: 'Trail Persistence', min: 0.95, max: 0.999, step: 0.001, format: 'fixed3', minLabel: 'Fleeting', maxLabel: 'Lasting' },
      { kind: 'slider', key: 'shader-physarum-deposit', label: 'Deposit Strength', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Faint', maxLabel: 'Strong' },
      { kind: 'slider', key: 'shader-physarum-sensor', label: 'Sensor Distance', min: 0.01, max: 0.05, step: 0.005, format: 'fixed3', minLabel: 'Near', maxLabel: 'Far' },
      { kind: 'slider', key: 'shader-physarum-turn', label: 'Turn Speed', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Gradual', maxLabel: 'Sharp' },
    ],
  },
  rain: {
    sectionLabel: 'Rain on Glass',
    controls: [
      { kind: 'slider', key: 'shader-rain-density', label: 'Drop Density', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-rain-speed', label: 'Fall Speed', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Drizzle', maxLabel: 'Downpour' },
      { kind: 'slider', key: 'shader-rain-size', label: 'Drop Size', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Fine', maxLabel: 'Heavy' },
      { kind: 'slider', key: 'shader-rain-refraction', label: 'Refraction', min: 0.1, max: 0.5, step: 0.01, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Warped' },
      { kind: 'slider', key: 'shader-rain-blur', label: 'Background Blur', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Sharp', maxLabel: 'Dreamy' },
    ],
  },
  frost: {
    sectionLabel: 'Frost Crystal',
    controls: [
      { kind: 'slider', key: 'shader-frost-growth', label: 'Growth Speed', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-frost-branch', label: 'Branching', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Linear', maxLabel: 'Dendritic' },
      { kind: 'slider', key: 'shader-frost-symmetry', label: 'Symmetry', min: 4, max: 8, step: 1, format: 'int', minLabel: '4-fold', maxLabel: '8-fold' },
      { kind: 'slider', key: 'shader-frost-melt', label: 'Melt Radius', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Small', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-frost-glow', label: 'Growth Glow', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Bright' },
    ],
  },
  glow: {
    sectionLabel: 'Bioluminescent Glow',
    controls: [
      { kind: 'slider', key: 'shader-glow-count', label: 'Organisms', min: 5, max: 20, step: 1, format: 'int', minLabel: 'Sparse', maxLabel: 'Teeming' },
      { kind: 'slider', key: 'shader-glow-pulse', label: 'Pulse Speed', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Rapid' },
      { kind: 'slider', key: 'shader-glow-size', label: 'Organism Size', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Tiny', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-glow-drift', label: 'Drift Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Still', maxLabel: 'Flowing' },
      { kind: 'slider', key: 'shader-glow-trail', label: 'Trail Length', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Long' },
      { kind: 'slider', key: 'shader-glow-depth', label: 'Depth Layers', min: 2, max: 4, step: 1, format: 'int', minLabel: 'Flat', maxLabel: 'Deep' },
    ],
  },
  life: {
    sectionLabel: 'SmoothLife',
    controls: [
      { kind: 'slider', key: 'shader-life-inner', label: 'Organism Size', min: 3.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-life-outer', label: 'Neighbourhood', min: 8.0, max: 15.0, step: 0.5, format: 'fixed1', minLabel: 'Tight', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-life-birth', label: 'Birth Threshold', min: 0.25, max: 0.4, step: 0.01, format: 'fixed2', minLabel: 'Easy', maxLabel: 'Hard' },
      { kind: 'slider', key: 'shader-life-death', label: 'Death Threshold', min: 0.35, max: 0.55, step: 0.01, format: 'fixed2', minLabel: 'Fragile', maxLabel: 'Tough' },
      { kind: 'slider', key: 'shader-life-speed', label: 'Sim Speed', min: 1, max: 4, step: 1, format: 'int', minLabel: 'Slow', maxLabel: 'Fast' },
    ],
  },
  mycelium: {
    sectionLabel: 'Mycelium',
    controls: [
      { kind: 'slider', key: 'shader-mycelium-growth', label: 'Growth Speed', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-mycelium-branch', label: 'Branching', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-mycelium-spread', label: 'Spread', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Tight', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-mycelium-pulse', label: 'Pulse Speed', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-mycelium-thickness', label: 'Thickness', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Thick' },
    ],
  },
  aurora: {
    sectionLabel: 'Aurora',
    controls: [
      { kind: 'slider', key: 'shader-aurora-layers', label: 'Curtain Layers', min: 3, max: 7, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-aurora-speed', label: 'Sway Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-aurora-height', label: 'Band Position', min: 0.2, max: 0.6, step: 0.05, format: 'fixed2', minLabel: 'Low', maxLabel: 'High' },
      { kind: 'slider', key: 'shader-aurora-spread', label: 'Vertical Spread', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Narrow', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-aurora-shimmer', label: 'Edge Shimmer', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Intense' },
    ],
  },
  tendrils: {
    sectionLabel: 'Tendrils',
    controls: [
      { kind: 'slider', key: 'shader-tendrils-scale', label: 'Noise Scale', min: 1.0, max: 5.0, step: 0.25, format: 'fixed2', minLabel: 'Fine', maxLabel: 'Coarse' },
      { kind: 'slider', key: 'shader-tendrils-speed', label: 'Flow Speed', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-tendrils-steps', label: 'Advection Steps', min: 3, max: 7, step: 1, format: 'int', minLabel: 'Fast', maxLabel: 'Smooth' },
      { kind: 'slider', key: 'shader-tendrils-curl', label: 'Curl Strength', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Tight' },
      { kind: 'slider', key: 'shader-tendrils-fade', label: 'Tendril Density', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Wispy', maxLabel: 'Dense' },
    ],
  },
  pollen: {
    sectionLabel: 'Pollen Drift',
    controls: [
      { kind: 'slider', key: 'shader-pollen-density', label: 'Density', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-pollen-size', label: 'Particle Size', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Tiny', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-pollen-fibres', label: 'Fibre Count', min: 3, max: 8, step: 1, format: 'int', minLabel: 'Simple', maxLabel: 'Complex' },
      { kind: 'slider', key: 'shader-pollen-drift', label: 'Drift Speed', min: 0.05, max: 0.25, step: 0.01, format: 'fixed2', minLabel: 'Still', maxLabel: 'Breezy' },
      { kind: 'slider', key: 'shader-pollen-depth', label: 'Depth Layers', min: 2, max: 4, step: 1, format: 'int', minLabel: 'Flat', maxLabel: 'Deep' },
      { kind: 'slider', key: 'shader-pollen-bokeh', label: 'Bokeh Blur', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Sharp', maxLabel: 'Soft' },
    ],
  },
  growth: {
    sectionLabel: 'Differential Growth',
    controls: [
      { kind: 'slider', key: 'shader-growth-speed', label: 'Growth Speed', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-growth-noise', label: 'Buckling', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Wrinkled' },
      { kind: 'slider', key: 'shader-growth-scale', label: 'Wrinkle Scale', min: 1.0, max: 4.0, step: 0.25, format: 'fixed2', minLabel: 'Fine', maxLabel: 'Coarse' },
      { kind: 'slider', key: 'shader-growth-width', label: 'Edge Width', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-growth-glow', label: 'Edge Glow', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Bright' },
    ],
  },
  geode: {
    sectionLabel: 'Geode',
    controls: [
      { kind: 'slider', key: 'shader-geode-bands', label: 'Mineral Bands', min: 4, max: 12, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-geode-warp', label: 'Band Irregularity', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Jagged' },
      { kind: 'slider', key: 'shader-geode-cavity', label: 'Crystal Cavity', min: 0.1, max: 0.4, step: 0.01, format: 'fixed2', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-geode-speed', label: 'Rotation Speed', min: 0.03, max: 0.15, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-geode-sparkle', label: 'Crystal Sparkle', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Matte', maxLabel: 'Brilliant' },
    ],
  },
  lenia: {
    sectionLabel: 'Lenia',
    controls: [
      { kind: 'slider', key: 'shader-lenia-radius', label: 'Creature Size', min: 8.0, max: 20.0, step: 0.5, format: 'fixed1', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-lenia-growth', label: 'Growth Target', min: 0.1, max: 0.2, step: 0.005, format: 'fixed3', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-lenia-width', label: 'Selectivity', min: 0.01, max: 0.05, step: 0.005, format: 'fixed3', minLabel: 'Sharp', maxLabel: 'Soft' },
      { kind: 'slider', key: 'shader-lenia-speed', label: 'Sim Speed', min: 1, max: 4, step: 1, format: 'int', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-lenia-dt', label: 'Timestep', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Rapid' },
    ],
  },
  ocean: {
    sectionLabel: 'Ocean',
    controls: [
      { kind: 'slider', key: 'shader-ocean-caustic-scale', label: 'Caustic Scale', min: 1.0, max: 4.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Coarse' },
      { kind: 'slider', key: 'shader-ocean-sand-scale', label: 'Sand Scale', min: 1.0, max: 5.0, step: 0.5, format: 'fixed1', minLabel: 'Smooth', maxLabel: 'Rough' },
      { kind: 'slider', key: 'shader-ocean-speed', label: 'Animation Speed', min: 0.05, max: 0.25, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-ocean-shadow', label: 'Shadow Depth', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Deep' },
      { kind: 'slider', key: 'shader-ocean-ripple', label: 'Mouse Ripple', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Gentle', maxLabel: 'Strong' },
    ],
  },
  bismuth: {
    sectionLabel: 'Bismuth',
    controls: [
      { kind: 'slider', key: 'shader-bismuth-terraces', label: 'Terrace Levels', min: 4, max: 12, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-bismuth-warp', label: 'Domain Warp', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Warped' },
      { kind: 'slider', key: 'shader-bismuth-iridescence', label: 'Iridescence', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Subtle', maxLabel: 'Vivid' },
      { kind: 'slider', key: 'shader-bismuth-speed', label: 'Morph Speed', min: 0.03, max: 0.15, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-bismuth-edge', label: 'Edge Glow', min: 0.3, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Faint', maxLabel: 'Bright' },
    ],
  },
  pearl: {
    sectionLabel: 'Pearl',
    controls: [
      { kind: 'slider', key: 'shader-pearl-displacement', label: 'Surface Displacement', min: 0.05, max: 0.3, step: 0.01, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Rough' },
      { kind: 'slider', key: 'shader-pearl-speed', label: 'Animation Speed', min: 0.3, max: 1.5, step: 0.1, format: 'fixed1', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-pearl-fresnel', label: 'Iridescence Power', min: 1.0, max: 5.0, step: 0.1, format: 'fixed1', minLabel: 'Subtle', maxLabel: 'Strong' },
      { kind: 'slider', key: 'shader-pearl-specular', label: 'Specular Highlight', min: 0.5, max: 2.0, step: 0.05, format: 'fixed2', minLabel: 'Matte', maxLabel: 'Glossy' },
    ],
  },
  vortex: {
    sectionLabel: 'Vortex',
    controls: [
      { kind: 'slider', key: 'shader-vortex-speed', label: 'Rotation Speed', min: 0.1, max: 0.5, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-vortex-density', label: 'Ray Steps', min: 20, max: 60, step: 1, format: 'int', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-vortex-twist', label: 'Spiral Twist', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Loose', maxLabel: 'Tight' },
      { kind: 'slider', key: 'shader-vortex-rings', label: 'Ring Scale', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-vortex-spiral', label: 'Arm Brightness', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Dim', maxLabel: 'Bright' },
    ],
  },
  gyroid: {
    sectionLabel: 'Gyroid',
    controls: [
      { kind: 'slider', key: 'shader-gyroid-scale1', label: 'Primary Frequency', min: 3.0, max: 8.0, step: 0.1, format: 'fixed1', minLabel: 'Coarse', maxLabel: 'Fine' },
      { kind: 'slider', key: 'shader-gyroid-scale2', label: 'Detail Frequency', min: 8.0, max: 15.0, step: 0.1, format: 'fixed1', minLabel: 'Sparse', maxLabel: 'Dense' },
      { kind: 'slider', key: 'shader-gyroid-speed', label: 'Animation Speed', min: 0.1, max: 0.4, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-gyroid-density', label: 'Volume Density', min: 1.0, max: 5.0, step: 0.1, format: 'fixed1', minLabel: 'Faint', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-gyroid-thickness', label: 'Surface Thickness', min: 0.01, max: 0.05, step: 0.005, format: 'fixed3', minLabel: 'Thin', maxLabel: 'Thick' },
    ],
  },
  waves: {
    sectionLabel: 'Waves',
    controls: [
      { kind: 'slider', key: 'shader-waves-height', label: 'Wave Height', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Flat', maxLabel: 'Tall' },
      { kind: 'slider', key: 'shader-waves-speed', label: 'Wave Speed', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-waves-chop', label: 'Choppiness', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Smooth', maxLabel: 'Choppy' },
      { kind: 'slider', key: 'shader-waves-foam', label: 'Foam Amount', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'None', maxLabel: 'Heavy' },
      { kind: 'slider', key: 'shader-waves-depth', label: 'Water Depth', min: 0.3, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Murky', maxLabel: 'Clear' },
    ],
  },
  clouds: {
    sectionLabel: 'Clouds',
    controls: [
      { kind: 'slider', key: 'shader-clouds-cover', label: 'Cloud Cover', min: 0.0, max: 0.5, step: 0.02, format: 'fixed2', minLabel: 'Clear', maxLabel: 'Overcast' },
      { kind: 'slider', key: 'shader-clouds-speed', label: 'Wind Speed', min: 0.01, max: 0.06, step: 0.005, format: 'fixed3', minLabel: 'Still', maxLabel: 'Breezy' },
      { kind: 'slider', key: 'shader-clouds-scale', label: 'Cloud Scale', min: 0.5, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Small', maxLabel: 'Large' },
      { kind: 'slider', key: 'shader-clouds-dark', label: 'Shadow Depth', min: 0.2, max: 0.8, step: 0.05, format: 'fixed2', minLabel: 'Flat', maxLabel: 'Deep' },
      { kind: 'slider', key: 'shader-clouds-light', label: 'Highlight', min: 0.1, max: 0.5, step: 0.05, format: 'fixed2', minLabel: 'Dim', maxLabel: 'Bright' },
    ],
  },
  fracture: {
    sectionLabel: 'Fracture',
    controls: [
      { kind: 'slider', key: 'shader-fracture-cuts', label: 'Subdivision Depth', min: 4, max: 9, step: 1, format: 'int', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-fracture-speed', label: 'Animation Speed', min: 0.1, max: 0.5, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-fracture-border', label: 'Edge Width', min: 0.005, max: 0.02, step: 0.001, format: 'fixed3', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-fracture-shadow', label: 'Shadow Depth', min: 0.02, max: 0.1, step: 0.01, format: 'fixed2', minLabel: 'Flat', maxLabel: 'Deep' },
      { kind: 'slider', key: 'shader-fracture-fill', label: 'Fill Opacity', min: 0.5, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Faded', maxLabel: 'Solid' },
    ],
  },
  julia: {
    sectionLabel: 'Julia',
    controls: [
      { kind: 'slider', key: 'shader-julia-zoom', label: 'Zoom Level', min: 1.0, max: 2.0, step: 0.1, format: 'fixed1', minLabel: 'Close', maxLabel: 'Far' },
      { kind: 'slider', key: 'shader-julia-speed', label: 'Orbit Speed', min: 0.2, max: 0.6, step: 0.01, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-julia-iterations', label: 'Detail', min: 30, max: 100, step: 5, format: 'int', minLabel: 'Smooth', maxLabel: 'Sharp' },
      { kind: 'slider', key: 'shader-julia-radius', label: 'Orbit Radius', min: 0.6, max: 0.95, step: 0.01, format: 'fixed2', minLabel: 'Tight', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-julia-saturation', label: 'Palette Intensity', min: 0.3, max: 0.7, step: 0.05, format: 'fixed2', minLabel: 'Muted', maxLabel: 'Vivid' },
    ],
  },
  vapor: {
    sectionLabel: 'Vapor',
    controls: [
      { kind: 'slider', key: 'shader-vapor-density', label: 'Cloud Density', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Thin', maxLabel: 'Thick' },
      { kind: 'slider', key: 'shader-vapor-speed', label: 'Animation Speed', min: 0.5, max: 2.5, step: 0.1, format: 'fixed1', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-vapor-scale', label: 'Cloud Scale', min: 3.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Fine', maxLabel: 'Coarse' },
      { kind: 'slider', key: 'shader-vapor-warmth', label: 'Warmth', min: 0.0, max: 1.0, step: 0.05, format: 'fixed2', minLabel: 'Cool', maxLabel: 'Warm' },
      { kind: 'slider', key: 'shader-vapor-glow', label: 'Glow Intensity', min: 0.3, max: 1.5, step: 0.1, format: 'fixed2', minLabel: 'Dim', maxLabel: 'Bright' },
    ],
  },
  tunnel: {
    sectionLabel: 'Tunnel',
    controls: [
      { kind: 'slider', key: 'shader-tunnel-speed', label: 'Flight Speed', min: 1.0, max: 4.0, step: 0.5, format: 'fixed1', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-tunnel-fractal', label: 'Fractal Detail', min: 4, max: 8, step: 1, format: 'int', minLabel: 'Simple', maxLabel: 'Complex' },
      { kind: 'slider', key: 'shader-tunnel-radius', label: 'Tunnel Width', min: 1.0, max: 3.0, step: 0.5, format: 'fixed1', minLabel: 'Narrow', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-tunnel-brightness', label: 'Brightness', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Dim', maxLabel: 'Bright' },
      { kind: 'slider', key: 'shader-tunnel-twist', label: 'Path Curvature', min: 0.03, max: 0.1, step: 0.01, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Winding' },
    ],
  },
  plasma: {
    sectionLabel: 'Plasma',
    controls: [
      { kind: 'slider', key: 'shader-plasma-speed', label: 'Flow Speed', min: 0.2, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-plasma-bands', label: 'Color Bands', min: 5.0, max: 40.0, step: 1.0, format: 'fixed1', minLabel: 'Few', maxLabel: 'Many' },
      { kind: 'slider', key: 'shader-plasma-pressure', label: 'Pressure', min: 0.2, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Soft', maxLabel: 'Strong' },
      { kind: 'slider', key: 'shader-plasma-turn', label: 'Slime Turn', min: 0.02, max: 0.25, step: 0.01, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Sharp' },
      { kind: 'slider', key: 'shader-plasma-diffusion', label: 'Diffusion', min: 0.5, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Tight', maxLabel: 'Spread' },
    ],
  },
  spore: {
    sectionLabel: 'Spore',
    controls: [
      { kind: 'slider', key: 'shader-spore-sensor-angle', label: 'Sensor Angle', min: 5.0, max: 45.0, step: 0.5, format: 'fixed1', minLabel: 'Narrow', maxLabel: 'Wide' },
      { kind: 'slider', key: 'shader-spore-sensor-offset', label: 'Sensor Reach', min: 1.0, max: 8.0, step: 0.5, format: 'fixed1', minLabel: 'Close', maxLabel: 'Far' },
      { kind: 'slider', key: 'shader-spore-step-size', label: 'Step Size', min: 2.0, max: 12.0, step: 0.5, format: 'fixed1', minLabel: 'Slow', maxLabel: 'Fast' },
      { kind: 'slider', key: 'shader-spore-rotation', label: 'Turn Amount', min: 5.0, max: 45.0, step: 0.5, format: 'fixed1', minLabel: 'Gentle', maxLabel: 'Sharp' },
      { kind: 'slider', key: 'shader-spore-decay', label: 'Trail Decay', min: 0.99, max: 0.999, step: 0.001, format: 'fixed3', minLabel: 'Fast', maxLabel: 'Slow' },
    ],
  },
  flow: {
    sectionLabel: 'Flow',
    controls: [
      { kind: 'slider', key: 'shader-flow-curl', label: 'Curl Strength', min: 0.1, max: 1.5, step: 0.05, format: 'fixed2', minLabel: 'Gentle', maxLabel: 'Tight' },
      { kind: 'slider', key: 'shader-flow-advection', label: 'Advection', min: 1.0, max: 12.0, step: 0.5, format: 'fixed1', minLabel: 'Short', maxLabel: 'Long' },
      { kind: 'slider', key: 'shader-flow-smoothing', label: 'Smoothing', min: 0.3, max: 0.95, step: 0.05, format: 'fixed2', minLabel: 'Crisp', maxLabel: 'Smooth' },
      { kind: 'slider', key: 'shader-flow-contrast', label: 'Contrast', min: 4.0, max: 20.0, step: 1.0, format: 'fixed1', minLabel: 'Soft', maxLabel: 'Punchy' },
      { kind: 'slider', key: 'shader-flow-field-speed', label: 'Field Speed', min: 0.2, max: 2.0, step: 0.1, format: 'fixed2', minLabel: 'Slow', maxLabel: 'Fast' },
    ],
  },
};
