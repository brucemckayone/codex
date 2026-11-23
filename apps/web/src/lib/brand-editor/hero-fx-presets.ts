/**
 * The hero's shader presets as the brand editor knows them: which exist, the
 * name each is shown by, and the default of every shader-* token a preset
 * reads. How the editor draws each preset's controls is hero-fx-controls.ts.
 */
import { SHADER_DEFAULT_PALETTE } from '$lib/brand-editor/defaults';
import {
  FX_SETTINGS,
  fxDefaultsFor,
  LIVE_PRESET_IDS,
  presetFxKey,
} from '$lib/components/ui/ShaderHero/preset-fx-defaults';

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
  // Shown as "Liquid Logo"; the stored id stays 'pulse', so no saved brand
  // migrates.
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

/**
 * The default of every shader-* token, in the form a range input reports it
 * (String(n)), so updateOverride drops an override set back to its default.
 * A slider's default is what the hero paints when nothing is stored
 * (hero-fx-defaults.test.ts holds the reworked presets to it); several are
 * the owner's own tuning.
 */
export const HERO_FX_DEFAULTS: Record<string, string> = {
  // The shared keys from before each preset had its own: no control writes
  // them, but an older brand may hold them, and picking "None" must still
  // clear them.
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
  // Ether
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
  // Topo
  'shader-topo-line-count': '27',
  'shader-topo-line-width': '1',
  'shader-topo-speed': '0.4',
  'shader-topo-scale': '2.5',
  'shader-topo-elevation': '2.8',
  'shader-topo-octaves': '5',
  // Glass: the line settings start at the old hard, dark came
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
  // Lenia
  'shader-lenia-radius': '15',
  'shader-lenia-growth': '0.2',
  'shader-lenia-width': '0.05',
  'shader-lenia-speed': '4',
  'shader-lenia-dt': '0.5',
  // Fracture: fewer, larger shards, a calmer sway, the old hard dark line
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
