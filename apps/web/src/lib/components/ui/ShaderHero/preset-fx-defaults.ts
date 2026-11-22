/**
 * The three shared settings (intensity, grain, vignette), per preset: each
 * preset reads differently, its intensity most of all, so each has its own
 * defaults.
 *
 * EACH PRESET KEEPS ITS OWN. A brand stores them under the preset's keys,
 * `shader-<id>-intensity` / `-grain` / `-vignette` (`presetFxKey`), so
 * switching from suture to caustic never carries suture's tuning across, and
 * switching back restores it. `getShaderConfig` reads, in order:
 *   1. the preset's own key,
 *   2. the legacy shared key (`shader-intensity` etc.), which older brands
 *      hold (production: OBB, on flow), and which the brand
 *      editor folds into the preset's key when it opens (`migrateSharedFx`),
 *   3. the preset's tuned default below (`fxDefaultsFor`).
 *
 * A default moves off FX_BASE only after the three-brand contrast check
 * (obb-light, obb-dark, tide): the ink that reads best today must stay at or
 * above min(today, 4.5).
 */
import type { LivePresetId, ShaderPresetId } from './shader-config';

export interface PresetFxDefaults {
  readonly intensity: number;
  readonly grain: number;
  readonly vignette: number;
}

/** The three settings, in the editor's order. */
export const FX_SETTINGS = ['intensity', 'grain', 'vignette'] as const;
export type FxSetting = (typeof FX_SETTINGS)[number];

/** The one global default every preset had before they had their own. */
export const FX_BASE: PresetFxDefaults = {
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
};

/**
 * Typed `Record<ShaderPresetId, ...>`, so a new preset without an entry is a
 * compile error rather than a silent fallback.
 */
const PRESET_FX_DEFAULTS: Record<ShaderPresetId, PresetFxDefaults> = {
  none: FX_BASE,
  // A lab tuning of flow (1.55 / 0.02 / 0.25) dropped white text on OBB from
  // ~11 to 2.8-3.8 and dark text on Tide from ~6.8 to 2.0: not adopted.
  flow: FX_BASE,
  // The lab's tuning. White text on OBB 17 -> 5.0, dark text on Tide 7.0 ->
  // 10.6. An earlier one (2.2 / 0.005 / 0.05) took OBB's to 3.3.
  suture: { intensity: 1.6, grain: 0.025, vignette: 0.1 },
  ripple: FX_BASE,
  film: FX_BASE,
  // The lab's intensity. White text (the hero's ink over a live shader) on OBB
  // 15.2 -> 6.6 and on Tide 2.2 -> 5.3; DARK text on Tide falls 4.1 -> 3.1, so
  // a brand with a dark hero ink over caustic needs its own.
  caustic: { intensity: 1.5, grain: 0.025, vignette: 0.2 },
  // The lab's grain and vignette. OBB white text 17.8 -> 11.8; Tide 2.56 ->
  // 2.68 (its glow is a third on a light ground).
  ether: { intensity: 0.65, grain: 0.07, vignette: 0.3 },
  // The lab's intensity and vignette: mostly the ground's colour, the form
  // drawn by light. OBB white text 14.5 -> 17.5; Tide's best ink turns dark
  // (white 15.9 -> dark 10.5): a light ground is light.
  pulse: { intensity: 0.1, grain: 0.025, vignette: 0 },
  ink: FX_BASE,
  // An intensity of 2.25 took white text on OBB from 18.9 to 3.6 (1.6: 4.4;
  // 1.2: 6.1), and anything above 0.65 took dark text on Tide below its 4.3
  // (0.9: 3.0): not adopted.
  topo: FX_BASE,
  glass: FX_BASE,
  flux: FX_BASE,
  lava: FX_BASE,
  physarum: FX_BASE,
  // The curtains at full strength (at 0.65 they read as a dim band). White text
  // on OBB 7.3 (11.8 at 0.65); Tide dark text 9.9.
  aurora: { ...FX_BASE, intensity: 1 },
  // The lab's intensity; contrast checked in the lab.
  lenia: { ...FX_BASE, intensity: 1.6 },
  fracture: FX_BASE,
};

/** The shared-settings defaults for a (resolved) preset id. */
export function fxDefaultsFor(id: ShaderPresetId): PresetFxDefaults {
  return PRESET_FX_DEFAULTS[id];
}

/** The key a brand stores `preset`'s own `setting` under. */
export function presetFxKey(
  preset: LivePresetId,
  setting: FxSetting
): `shader-${LivePresetId}-${FxSetting}` {
  return `shader-${preset}-${setting}`;
}

/** The legacy shared key, read only as a fallback (see the file comment). */
export function sharedFxKey(setting: FxSetting): `shader-${FxSetting}` {
  return `shader-${setting}`;
}

function isLivePresetId(id: string): id is LivePresetId {
  return id !== 'none' && Object.hasOwn(PRESET_FX_DEFAULTS, id);
}

/** Every preset that paints, from the table above. */
export const LIVE_PRESET_IDS: readonly LivePresetId[] =
  Object.keys(PRESET_FX_DEFAULTS).filter(isLivePresetId);

/** Every per-preset key: 16 presets x 3 settings. */
export const PRESET_FX_KEYS: readonly string[] = LIVE_PRESET_IDS.flatMap((id) =>
  FX_SETTINGS.map((setting) => presetFxKey(id, setting))
);
