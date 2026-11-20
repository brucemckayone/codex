import { SHADER_DEFAULT_PALETTE } from '$lib/brand-editor/defaults';
import {
  FX_SETTINGS,
  type FxSetting,
  fxDefaultsFor,
  LIVE_PRESET_IDS,
  presetFxKey,
} from '$lib/components/ui/ShaderHero/preset-fx-defaults';
import type { LivePresetId } from '$lib/components/ui/ShaderHero/shader-config';

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
  {
    id: 'ripple',
    label: 'Water Ripple',
    description: 'Rippling water surface',
  },
  // Shown as "Liquid Logo" since WP-1d; the stored id stays 'pulse', so no
  // saved brand migrates.
  {
    id: 'pulse',
    label: 'Liquid Logo',
    description: 'Your logo raised in still liquid',
  },
  { id: 'ink', label: 'Ink Dispersion', description: 'Colored ink in liquid' },
  { id: 'topo', label: 'Topo', description: 'Topographic contour lines' },
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
  { id: 'aurora', label: 'Aurora', description: 'Northern lights curtains' },
  { id: 'lenia', label: 'Lenia', description: 'Artificial lifeforms' },
  { id: 'fracture', label: 'Fracture', description: 'Geometric polygon cuts' },
  { id: 'flow', label: 'Flow', description: 'Curl-noise paint streaks' },
];

/** A preset's name as the pickers show it; the id itself when it has none. */
export function presetLabel(id: string): string {
  return HERO_FX_PRESETS.find((p) => p.id === id)?.label ?? id;
}

// ── Default values ─────────────────────────────────────────────────────
/**
 * Each preset's own intensity/grain/vignette default (preset-fx-defaults.ts),
 * written as a range input reports a value (String(0.2) is '0.2'), so
 * updateOverride's remove-on-default matches a slider set back to it.
 */
const PRESET_FX_DEFAULT_VALUES: Record<string, string> = Object.fromEntries(
  LIVE_PRESET_IDS.flatMap((id) =>
    FX_SETTINGS.map((setting) => [
      presetFxKey(id, setting),
      String(fxDefaultsFor(id)[setting]),
    ])
  )
);

export const HERO_FX_DEFAULTS: Record<string, string> = {
  // The legacy shared keys: no control writes them any more (each preset
  // has its own, below), but a brand saved before WP-1d may hold them, and
  // picking "None" must still clear them.
  'shader-intensity': '0.65',
  'shader-grain': '0.025',
  'shader-vignette': '0.20',
  ...PRESET_FX_DEFAULT_VALUES,
  // Shader palette. The default is '0' — match the brand palette — so an org
  // that never opens this section renders exactly as it did before the keys
  // existed. The four colours below are only the pickers' opening state.
  'shader-use-custom-colors': '0',
  'shader-color-primary': SHADER_DEFAULT_PALETTE.primary,
  'shader-color-secondary': SHADER_DEFAULT_PALETTE.secondary,
  'shader-color-accent': SHADER_DEFAULT_PALETTE.accent,
  'shader-color-bg': SHADER_DEFAULT_PALETTE.bg,
  // Suture
  'shader-curl': '30',
  'shader-dissipation': '0.903',
  'shader-advection': '8',
  'shader-force': '2.7',
  // Ether: the owner's tuning (WP-1d), written as a range input reports it,
  // so a slider set back to it drops the override (updateOverride).
  'shader-rotation-speed': '0.9',
  'shader-complexity': '8',
  'shader-zoom': '5.5',
  'shader-glow': '1.5',
  'shader-scale': '4',
  'shader-aberration': '0.02',
  // Ripple
  'shader-wave-speed': '0.8',
  'shader-damping': '0.995',
  'shader-ripple-size': '0.03',
  'shader-refraction': '0.5',
  // Liquid Logo (id 'pulse')
  'shader-pulse-damping': '0.98',
  'shader-wave-scale': '4',
  'shader-cam-height': '27',
  'shader-cam-target': '-5',
  'shader-specular': '1',
  'shader-impulse-size': '0.04',
  // Ink
  'shader-ink-diffusion': '1.5',
  'shader-ink-advection': '0.8',
  'shader-ink-drop-size': '0.05',
  'shader-ink-evaporation': '0.997',
  'shader-ink-curl': '15',
  // Topo: the owner's tuning (WP-1d), as a range input reports it.
  'shader-topo-line-count': '27',
  'shader-topo-line-width': '1',
  'shader-topo-speed': '0.4',
  'shader-topo-scale': '2.5',
  'shader-topo-elevation': '2.8',
  'shader-topo-octaves': '5',
  // Glass
  // Glass: as a range input reports it. R4b's line settings start at the old
  // hard, dark came (WP-1d).
  'shader-glass-cell-size': '5',
  'shader-glass-border': '0.04',
  'shader-glass-line-softness': '0',
  'shader-glass-line-colour': '0',
  'shader-glass-piece-edges': '0',
  'shader-glass-drift': '0.1',
  'shader-glass-glow': '0.2',
  'shader-glass-light': '0.15',
  // Film
  'shader-film-scale': '2.5',
  'shader-film-speed': '0.16',
  'shader-film-bands': '6',
  'shader-film-shift': '0.3',
  'shader-film-ripple': '1.5',
  // Flux
  'shader-flux-poles': '3',
  'shader-flux-line-density': '10',
  'shader-flux-line-width': '1',
  'shader-flux-strength': '1.5',
  'shader-flux-speed': '0.1',
  // Lava
  'shader-lava-crack-scale': '4',
  'shader-lava-crack-width': '0.04',
  'shader-lava-glow': '1.5',
  'shader-lava-speed': '0.08',
  'shader-lava-crust': '0.6',
  'shader-lava-heat': '1',
  // Caustic
  'shader-caustic-scale': '5',
  'shader-caustic-speed': '0.3',
  'shader-caustic-iterations': '5',
  'shader-caustic-brightness': '1.7',
  'shader-caustic-ripple': '3',
  // Physarum
  'shader-physarum-diffusion': '1',
  'shader-physarum-decay': '0.98',
  'shader-physarum-deposit': '1',
  'shader-physarum-sensor': '0.03',
  'shader-physarum-turn': '0.25',
  // Aurora
  'shader-aurora-layers': '5',
  'shader-aurora-speed': '0.1',
  'shader-aurora-height': '0.4',
  'shader-aurora-spread': '0.25',
  'shader-aurora-shimmer': '0.8',
  // Lenia: the owner's tuning (WP-1d R3). Width was '0.015' while the hero
  // painted 0.04, so the slider showed one value and the page another.
  'shader-lenia-radius': '15',
  'shader-lenia-growth': '0.2',
  'shader-lenia-width': '0.05',
  'shader-lenia-speed': '4',
  'shader-lenia-dt': '0.5',
  // Fracture
  // Fracture (WP-1d R4b): fewer, larger shards, a calmer sway, the old hard
  // dark line; as a range input reports it.
  'shader-fracture-cuts': '5',
  'shader-fracture-speed': '0.12',
  'shader-fracture-border': '0.01',
  'shader-fracture-line-softness': '0',
  'shader-fracture-line-colour': '0',
  'shader-fracture-shadow': '0.05',
  'shader-fracture-fill': '0.85',
  // Flow
  'shader-flow-curl': '0.6',
  'shader-flow-advection': '6',
  'shader-flow-smoothing': '0.8',
  'shader-flow-contrast': '12',
  'shader-flow-field-speed': '1',
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

/** The intensity/grain/vignette sliders, before a preset gives them a key. */
const FX_SLIDERS: Record<FxSetting, Omit<SliderControlConfig, 'key'>> = {
  intensity: {
    kind: 'slider',
    label: 'Intensity',
    min: 0.1,
    max: 6.0,
    step: 0.05,
    format: 'fixed2',
    minLabel: 'Subtle',
    maxLabel: 'Blazing',
  },
  grain: {
    kind: 'slider',
    label: 'Grain',
    min: 0.0,
    max: 0.08,
    step: 0.005,
    format: 'fixed3',
    minLabel: 'Clean',
    maxLabel: 'Gritty',
  },
  vignette: {
    kind: 'slider',
    label: 'Vignette',
    min: 0.0,
    max: 0.5,
    step: 0.05,
    format: 'fixed2',
    minLabel: 'None',
    maxLabel: 'Heavy',
  },
};

/**
 * The intensity, grain and vignette sliders for `preset`, shown above its own
 * section. Each writes the preset's OWN key (`shader-<id>-intensity` etc.), so
 * switching presets never carries one's tuning to another, and switching back
 * finds it where it was left.
 */
export function presetFxControls(preset: LivePresetId): SliderControlConfig[] {
  return FX_SETTINGS.map((setting) => ({
    ...FX_SLIDERS[setting],
    key: presetFxKey(preset, setting),
  }));
}

/**
 * Shader palette controls, shown for every active preset.
 *
 * Every preset consumes the same four colour slots — `u_brandPrimary`,
 * `u_brandSecondary`, `u_brandAccent`, `u_bgColor` — so this group is shared
 * rather than repeated per preset. What each slot *means* varies by preset —
 * a gradient stop in one, a surface or its highlight in another — which is
 * why the labels name the slot rather than guessing at a role.
 *
 * The toggle comes first and gates the rest: with it off the shader paints in
 * the org's brand colours, which is the default for every org.
 */
export const HERO_FX_COLOR_CONTROLS: ControlConfig[] = [
  {
    kind: 'toggle',
    key: 'shader-use-custom-colors',
    label: 'Custom shader palette',
  },
  { kind: 'color', key: 'shader-color-primary', label: 'Primary' },
  { kind: 'color', key: 'shader-color-secondary', label: 'Secondary' },
  { kind: 'color', key: 'shader-color-accent', label: 'Accent' },
  { kind: 'color', key: 'shader-color-bg', label: 'Background' },
];

/**
 * Per-preset control sections. Each entry maps a preset id (matching
 * HERO_FX_PRESETS) to its section label and ordered controls. The order
 * here is the order rendered in the editor — pulse's color picker
 * (first) preserves the historical placement of that control within its
 * section.
 */
export const HERO_FX_PRESET_CONTROLS: Record<
  string,
  { sectionLabel: string; controls: ControlConfig[] }
> = {
  suture: {
    sectionLabel: 'Suture Fluid',
    controls: [
      {
        kind: 'slider',
        key: 'shader-curl',
        label: 'Curl Strength',
        min: 1,
        max: 80,
        step: 1,
        format: 'int',
        minLabel: 'Calm',
        maxLabel: 'Chaotic',
      },
      {
        kind: 'slider',
        key: 'shader-dissipation',
        label: 'Dissipation',
        min: 0.9,
        max: 0.999,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'Fast',
        maxLabel: 'Slow',
      },
      {
        kind: 'slider',
        key: 'shader-advection',
        label: 'Advection',
        min: 1.0,
        max: 15.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Short',
        maxLabel: 'Long',
      },
      {
        kind: 'slider',
        key: 'shader-force',
        label: 'Mouse Force',
        min: 0.1,
        max: 3.0,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Gentle',
        maxLabel: 'Strong',
      },
    ],
  },
  ether: {
    sectionLabel: 'Ether',
    controls: [
      {
        kind: 'slider',
        key: 'shader-rotation-speed',
        label: 'Rotation Speed',
        min: 0.1,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-complexity',
        label: 'Complexity',
        min: 3,
        max: 8,
        step: 1,
        format: 'int',
        minLabel: 'Simple',
        maxLabel: 'Complex',
      },
      {
        kind: 'slider',
        key: 'shader-zoom',
        label: 'Zoom',
        min: 1.0,
        max: 8.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Close',
        maxLabel: 'Far',
      },
      {
        kind: 'slider',
        key: 'shader-glow',
        label: 'Glow',
        min: 0.1,
        max: 1.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Dim',
        maxLabel: 'Bright',
      },
      {
        kind: 'slider',
        key: 'shader-scale',
        label: 'Scale',
        min: 0.5,
        max: 4.0,
        step: 0.25,
        format: 'fixed2',
        minLabel: 'Small',
        maxLabel: 'Large',
      },
      {
        kind: 'slider',
        key: 'shader-aberration',
        label: 'Chromatic Aberration',
        min: 0.0,
        max: 0.02,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'None',
        maxLabel: 'Heavy',
      },
    ],
  },
  ripple: {
    sectionLabel: 'Water Ripple',
    controls: [
      {
        kind: 'slider',
        key: 'shader-wave-speed',
        label: 'Wave Speed',
        min: 0.1,
        max: 2.0,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-damping',
        label: 'Damping',
        min: 0.98,
        max: 0.999,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'Quick',
        maxLabel: 'Lasting',
      },
      {
        kind: 'slider',
        key: 'shader-ripple-size',
        label: 'Ripple Size',
        min: 0.01,
        max: 0.1,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Tiny',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-refraction',
        label: 'Refraction',
        min: 0.1,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Flat',
        maxLabel: 'Deep',
      },
    ],
  },
  pulse: {
    sectionLabel: 'Liquid Logo',
    // No colour picker: the surface paints the brand palette (WP-1d).
    controls: [
      {
        kind: 'slider',
        key: 'shader-pulse-damping',
        label: 'Persistence',
        min: 0.93,
        max: 0.99,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Fleeting',
        maxLabel: 'Lasting',
      },
      {
        kind: 'slider',
        key: 'shader-wave-scale',
        label: 'Wave Height',
        min: 1.0,
        max: 10.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Subtle',
        maxLabel: 'Dramatic',
      },
      {
        kind: 'slider',
        key: 'shader-cam-height',
        label: 'View Height',
        min: 10,
        max: 50,
        step: 1,
        format: 'int',
        minLabel: 'Low',
        maxLabel: 'High',
      },
      {
        kind: 'slider',
        key: 'shader-cam-target',
        label: 'View Depth',
        min: -50,
        max: 0,
        step: 1,
        format: 'int',
        minLabel: 'Near',
        maxLabel: 'Far',
      },
      {
        kind: 'slider',
        key: 'shader-specular',
        label: 'Shine',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Matte',
        maxLabel: 'Glossy',
      },
      {
        kind: 'slider',
        key: 'shader-impulse-size',
        label: 'Touch Size',
        min: 0.01,
        max: 0.1,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Focused',
        maxLabel: 'Broad',
      },
    ],
  },
  ink: {
    sectionLabel: 'Ink Dispersion',
    controls: [
      {
        kind: 'slider',
        key: 'shader-ink-diffusion',
        label: 'Diffusion Rate',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-ink-advection',
        label: 'Flow Strength',
        min: 0.0,
        max: 2.0,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Still',
        maxLabel: 'Swirling',
      },
      {
        kind: 'slider',
        key: 'shader-ink-drop-size',
        label: 'Drop Size',
        min: 0.02,
        max: 0.1,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Tiny',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-ink-evaporation',
        label: 'Persistence',
        min: 0.99,
        max: 0.999,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'Fleeting',
        maxLabel: 'Lasting',
      },
      {
        kind: 'slider',
        key: 'shader-ink-curl',
        label: 'Swirl Detail',
        min: 5,
        max: 40,
        step: 1,
        format: 'int',
        minLabel: 'Broad',
        maxLabel: 'Fine',
      },
    ],
  },
  topo: {
    sectionLabel: 'Topo',
    controls: [
      {
        kind: 'slider',
        key: 'shader-topo-line-count',
        label: 'Contour Lines',
        min: 5,
        max: 30,
        step: 1,
        format: 'int',
        minLabel: 'Few',
        maxLabel: 'Dense',
      },
      {
        kind: 'slider',
        key: 'shader-topo-line-width',
        label: 'Line Width',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Thin',
        maxLabel: 'Thick',
      },
      {
        kind: 'slider',
        key: 'shader-topo-speed',
        label: 'Animation Speed',
        min: 0.05,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-topo-scale',
        label: 'Noise Scale',
        min: 1.0,
        max: 5.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Zoomed',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-topo-elevation',
        label: 'Mouse Elevation',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Flat',
        maxLabel: 'Tall',
      },
      {
        kind: 'slider',
        key: 'shader-topo-octaves',
        label: 'Detail (octaves)',
        min: 2,
        max: 5,
        step: 1,
        format: 'int',
        minLabel: 'Smooth',
        maxLabel: 'Detailed',
      },
    ],
  },
  glass: {
    sectionLabel: 'Stained Glass',
    controls: [
      {
        kind: 'slider',
        key: 'shader-glass-cell-size',
        label: 'Cell Size',
        min: 3.0,
        max: 10.0,
        step: 0.5,
        format: 'fixed1',
        // More cells across at the top end: smaller pieces.
        minLabel: 'Large',
        maxLabel: 'Small',
      },
      {
        kind: 'slider',
        key: 'shader-glass-border',
        label: 'Line Weight',
        min: 0.02,
        max: 0.1,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Thin',
        maxLabel: 'Thick',
      },
      {
        kind: 'slider',
        key: 'shader-glass-line-softness',
        label: 'Line Softness',
        min: 0,
        max: 1,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Hard',
        maxLabel: 'Soft',
      },
      {
        kind: 'slider',
        key: 'shader-glass-line-colour',
        label: 'Line Colour',
        min: 0,
        max: 1,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Dark',
        maxLabel: 'Tinted',
      },
      {
        kind: 'slider',
        key: 'shader-glass-piece-edges',
        label: 'Piece Edges',
        min: 0,
        max: 1,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Sharp',
        maxLabel: 'Bevelled',
      },
      {
        kind: 'slider',
        key: 'shader-glass-drift',
        label: 'Drift Speed',
        min: 0.05,
        max: 0.3,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-glass-glow',
        label: 'Edge Glow',
        min: 0.0,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'None',
        maxLabel: 'Bright',
      },
      {
        kind: 'slider',
        key: 'shader-glass-light',
        label: 'Light Shift',
        min: 0.0,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Static',
        maxLabel: 'Vivid',
      },
    ],
  },
  film: {
    sectionLabel: 'Oil Film',
    controls: [
      {
        kind: 'slider',
        key: 'shader-film-scale',
        label: 'Noise Scale',
        min: 1.0,
        max: 5.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Fine',
        maxLabel: 'Broad',
      },
      {
        kind: 'slider',
        key: 'shader-film-speed',
        label: 'Animation Speed',
        min: 0.05,
        max: 0.3,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-film-bands',
        label: 'Colour Bands',
        min: 2.0,
        max: 8.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Smooth',
        maxLabel: 'Tight',
      },
      {
        kind: 'slider',
        key: 'shader-film-shift',
        label: 'Angle Shift',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'None',
        maxLabel: 'Strong',
      },
      {
        kind: 'slider',
        key: 'shader-film-ripple',
        label: 'Ripple Strength',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Gentle',
        maxLabel: 'Intense',
      },
    ],
  },
  flux: {
    sectionLabel: 'Magnetic Flux',
    controls: [
      {
        kind: 'slider',
        key: 'shader-flux-poles',
        label: 'Magnetic Poles',
        min: 2,
        max: 5,
        step: 1,
        format: 'int',
        minLabel: 'Few',
        maxLabel: 'Many',
      },
      {
        kind: 'slider',
        key: 'shader-flux-line-density',
        label: 'Line Density',
        min: 5.0,
        max: 20.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Sparse',
        maxLabel: 'Dense',
      },
      {
        kind: 'slider',
        key: 'shader-flux-line-width',
        label: 'Line Width',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Thin',
        maxLabel: 'Thick',
      },
      {
        kind: 'slider',
        key: 'shader-flux-strength',
        label: 'Mouse Strength',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Gentle',
        maxLabel: 'Strong',
      },
      {
        kind: 'slider',
        key: 'shader-flux-speed',
        label: 'Rotation Speed',
        min: 0.05,
        max: 0.3,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
    ],
  },
  lava: {
    sectionLabel: 'Lava',
    controls: [
      {
        kind: 'slider',
        key: 'shader-lava-crack-scale',
        label: 'Crack Density',
        min: 2.0,
        max: 8.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Few',
        maxLabel: 'Many',
      },
      {
        kind: 'slider',
        key: 'shader-lava-crack-width',
        label: 'Crack Width',
        min: 0.02,
        max: 0.1,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Thin',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-lava-glow',
        label: 'Crack Glow',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Dim',
        maxLabel: 'Blazing',
      },
      {
        kind: 'slider',
        key: 'shader-lava-speed',
        label: 'Flow Speed',
        min: 0.05,
        max: 0.25,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-lava-crust',
        label: 'Crust Darkness',
        min: 0.3,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Light',
        maxLabel: 'Dark',
      },
      {
        kind: 'slider',
        key: 'shader-lava-heat',
        label: 'Mouse Heat',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Cool',
        maxLabel: 'Hot',
      },
    ],
  },
  caustic: {
    sectionLabel: 'Caustics',
    controls: [
      {
        kind: 'slider',
        key: 'shader-caustic-scale',
        label: 'Pattern Scale',
        min: 1.0,
        max: 5.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Fine',
        maxLabel: 'Coarse',
      },
      {
        kind: 'slider',
        key: 'shader-caustic-speed',
        label: 'Animation Speed',
        min: 0.05,
        max: 0.3,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-caustic-iterations',
        label: 'Detail Layers',
        min: 2,
        max: 5,
        step: 1,
        format: 'int',
        minLabel: 'Simple',
        maxLabel: 'Complex',
      },
      {
        kind: 'slider',
        key: 'shader-caustic-brightness',
        label: 'Highlight Power',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Dim',
        maxLabel: 'Bright',
      },
      {
        kind: 'slider',
        key: 'shader-caustic-ripple',
        label: 'Mouse Ripple',
        min: 0.5,
        max: 3.0,
        step: 0.1,
        format: 'fixed1',
        minLabel: 'Gentle',
        maxLabel: 'Strong',
      },
    ],
  },
  physarum: {
    sectionLabel: 'Physarum Network',
    controls: [
      {
        kind: 'slider',
        key: 'shader-physarum-diffusion',
        label: 'Trail Spread',
        min: 0.5,
        max: 2.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Tight',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-physarum-decay',
        label: 'Trail Persistence',
        min: 0.95,
        max: 0.999,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'Fleeting',
        maxLabel: 'Lasting',
      },
      {
        kind: 'slider',
        key: 'shader-physarum-deposit',
        label: 'Deposit Strength',
        min: 0.5,
        max: 2.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Faint',
        maxLabel: 'Strong',
      },
      {
        kind: 'slider',
        key: 'shader-physarum-sensor',
        label: 'Sensor Distance',
        min: 0.01,
        max: 0.05,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Near',
        maxLabel: 'Far',
      },
      {
        kind: 'slider',
        key: 'shader-physarum-turn',
        label: 'Turn Speed',
        min: 0.1,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Gradual',
        maxLabel: 'Sharp',
      },
    ],
  },
  aurora: {
    sectionLabel: 'Aurora',
    controls: [
      {
        kind: 'slider',
        key: 'shader-aurora-layers',
        label: 'Curtain Layers',
        min: 3,
        max: 7,
        step: 1,
        format: 'int',
        minLabel: 'Few',
        maxLabel: 'Many',
      },
      {
        kind: 'slider',
        key: 'shader-aurora-speed',
        label: 'Sway Speed',
        min: 0.05,
        max: 0.3,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-aurora-height',
        label: 'Band Position',
        min: 0.2,
        max: 0.6,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Low',
        maxLabel: 'High',
      },
      {
        kind: 'slider',
        key: 'shader-aurora-spread',
        label: 'Vertical Spread',
        min: 0.1,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Narrow',
        maxLabel: 'Wide',
      },
      {
        kind: 'slider',
        key: 'shader-aurora-shimmer',
        label: 'Edge Shimmer',
        min: 0.3,
        max: 1.5,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Subtle',
        maxLabel: 'Intense',
      },
    ],
  },
  lenia: {
    sectionLabel: 'Lenia',
    controls: [
      {
        kind: 'slider',
        key: 'shader-lenia-radius',
        label: 'Creature Size',
        min: 8.0,
        max: 20.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Small',
        maxLabel: 'Large',
      },
      {
        kind: 'slider',
        key: 'shader-lenia-growth',
        label: 'Growth Target',
        min: 0.1,
        max: 0.2,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Sparse',
        maxLabel: 'Dense',
      },
      {
        kind: 'slider',
        key: 'shader-lenia-width',
        label: 'Selectivity',
        min: 0.01,
        max: 0.05,
        step: 0.005,
        format: 'fixed3',
        minLabel: 'Sharp',
        maxLabel: 'Soft',
      },
      {
        kind: 'slider',
        key: 'shader-lenia-speed',
        label: 'Sim Speed',
        min: 1,
        max: 4,
        step: 1,
        format: 'int',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-lenia-dt',
        label: 'Timestep',
        min: 0.1,
        max: 0.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Smooth',
        maxLabel: 'Rapid',
      },
    ],
  },
  fracture: {
    sectionLabel: 'Fracture',
    controls: [
      {
        kind: 'slider',
        key: 'shader-fracture-cuts',
        label: 'Subdivision Depth',
        min: 4,
        max: 9,
        step: 1,
        format: 'int',
        minLabel: 'Few',
        maxLabel: 'Many',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-speed',
        label: 'Animation Speed',
        min: 0.1,
        max: 0.5,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-border',
        label: 'Line Weight',
        min: 0.005,
        max: 0.02,
        step: 0.001,
        format: 'fixed3',
        minLabel: 'Thin',
        maxLabel: 'Thick',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-line-softness',
        label: 'Line Softness',
        min: 0,
        max: 1,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Hard',
        maxLabel: 'Soft',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-line-colour',
        label: 'Line Colour',
        min: 0,
        max: 1,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Dark',
        maxLabel: 'Tinted',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-shadow',
        label: 'Shadow Depth',
        min: 0.02,
        max: 0.1,
        step: 0.01,
        format: 'fixed2',
        minLabel: 'Flat',
        maxLabel: 'Deep',
      },
      {
        kind: 'slider',
        key: 'shader-fracture-fill',
        label: 'Fill Opacity',
        min: 0.5,
        max: 1.0,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Faded',
        maxLabel: 'Solid',
      },
    ],
  },
  flow: {
    sectionLabel: 'Flow',
    controls: [
      {
        kind: 'slider',
        key: 'shader-flow-curl',
        label: 'Curl Strength',
        min: 0.1,
        max: 1.5,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Gentle',
        maxLabel: 'Tight',
      },
      {
        kind: 'slider',
        key: 'shader-flow-advection',
        label: 'Advection',
        min: 1.0,
        max: 12.0,
        step: 0.5,
        format: 'fixed1',
        minLabel: 'Short',
        maxLabel: 'Long',
      },
      {
        kind: 'slider',
        key: 'shader-flow-smoothing',
        label: 'Smoothing',
        min: 0.3,
        max: 0.95,
        step: 0.05,
        format: 'fixed2',
        minLabel: 'Crisp',
        maxLabel: 'Smooth',
      },
      {
        kind: 'slider',
        key: 'shader-flow-contrast',
        label: 'Contrast',
        min: 4.0,
        max: 20.0,
        step: 1.0,
        format: 'fixed1',
        minLabel: 'Soft',
        maxLabel: 'Punchy',
      },
      {
        kind: 'slider',
        key: 'shader-flow-field-speed',
        label: 'Field Speed',
        min: 0.2,
        max: 2.0,
        step: 0.1,
        format: 'fixed2',
        minLabel: 'Slow',
        maxLabel: 'Fast',
      },
    ],
  },
};
