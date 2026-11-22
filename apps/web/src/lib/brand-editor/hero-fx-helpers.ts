/**
 * Hero FX helpers — preset selection + override default-equality removal,
 * and `migrateSharedFx`, which folds a brand's legacy shared intensity/grain/
 * vignette into its preset's own keys when the editor opens it.
 *
 * Extracted from BrandEditorHeroEffects.svelte (Codex-19h35 Phase 2) so the
 * two scoping-doc gotchas (Codex-6itei §4.2) can be unit-tested without
 * mounting the full Svelte component. The component delegates to these
 * pure functions; behaviour is byte-equivalent to the original inline
 * implementation.
 *
 * Both helpers receive the `setOverride` writer as a parameter rather than
 * importing the brandEditor store directly, which keeps them dependency-free
 * and makes the call shape explicit at the test boundary. The caller is
 * responsible for providing a writer that routes to the active editing theme
 * (light vs dark) — these helpers do not look at editingTheme.
 *
 * GOTCHA #1 (selectPreset 'none'): MUST clear ALL_HERO_FX_SHADER_KEYS — the
 * union of every shader-* key across every preset plus 'shader-preset' — AND
 * every other `shader-*` key the overrides hold (a cut preset's params, saved
 * before the cut), so no stale overrides linger after the user picks "None".
 *
 * GOTCHA #2 (updateOverride remove-on-default): MUST remove the override
 * entry (write null) when the value equals HERO_FX_DEFAULTS[key] or is empty,
 * so pending.tokenOverrides stays minimal and the brand editor's "save only
 * diff" invariant holds.
 */
import {
  FX_SETTINGS,
  type FxSetting,
  presetFxKey,
  sharedFxKey,
} from '$lib/components/ui/ShaderHero/preset-fx-defaults';
import {
  type LivePresetId,
  resolvePresetId,
} from '$lib/components/ui/ShaderHero/shader-config';
import { ALL_HERO_FX_SHADER_KEYS, HERO_FX_DEFAULTS } from './hero-fx-presets';

/** Writer signature mirroring brandEditor.setThemeTokenOverride. */
export type SetOverride = (key: string, value: string | null) => void;

/** A brand's two override maps: light, and the dark theme's divergences. */
export interface FxOverrideMaps {
  tokenOverrides: Record<string, string | null>;
  darkTokenOverrides: Record<string, string | null> | null;
}

type OverrideMap = Record<string, string | null>;

const isSet = (value: string | null | undefined): value is string =>
  value != null && value !== '';

/** The live preset an id paints (through the alias door), or null. */
function livePreset(id: string | null | undefined): LivePresetId | null {
  const resolved = resolvePresetId(id);
  return resolved && resolved !== 'none' ? resolved : null;
}

/**
 * The live preset the dark theme paints: its own, else light's. '' is unset,
 * as readBrandVar reads it. Null with no dark map.
 */
function darkPresetOf(
  light: OverrideMap,
  dark: OverrideMap | null
): LivePresetId | null {
  if (!dark) return null;
  return livePreset(
    isSet(dark['shader-preset'])
      ? dark['shader-preset']
      : light['shader-preset']
  );
}

/** The map, or null when it is null or empty. */
function nonEmpty(map: OverrideMap | null): OverrideMap | null {
  return map && Object.keys(map).length > 0 ? map : null;
}

/**
 * What the dark theme reads for `preset`'s `setting`, in getShaderConfig's
 * order: the preset's key (dark, then light), then the shared key (dark,
 * then light). Null when none is set.
 */
function darkReads(
  light: OverrideMap,
  dark: OverrideMap,
  preset: LivePresetId,
  setting: FxSetting
): string | null {
  const own = presetFxKey(preset, setting);
  const shared = sharedFxKey(setting);
  return (
    [dark[own], light[own], dark[shared], light[shared]].find(isSet) ?? null
  );
}

/**
 * Light theme: the shared key goes. With a live `preset`, its value first
 * moves to the preset's key unless that key is already set. True when the
 * map changed.
 */
function foldLight(
  light: OverrideMap,
  preset: LivePresetId | null,
  setting: FxSetting
): boolean {
  const shared = sharedFxKey(setting);
  if (!(shared in light)) return false;
  if (preset) {
    const own = presetFxKey(preset, setting);
    if (!isSet(light[own]) && isSet(light[shared])) light[own] = light[shared];
  }
  delete light[shared];
  return true;
}

/**
 * Dark theme: its shared key goes; with a live `preset`, if it would then
 * read something other than `before`, `before` is written to its own key.
 * True when the map changed.
 */
function foldDark(
  light: OverrideMap,
  dark: OverrideMap,
  preset: LivePresetId | null,
  setting: FxSetting,
  before: string | null
): boolean {
  const shared = sharedFxKey(setting);
  let changed = false;
  if (shared in dark) {
    delete dark[shared];
    changed = true;
  }
  if (
    preset &&
    before !== null &&
    darkReads(light, dark, preset, setting) !== before
  ) {
    dark[presetFxKey(preset, setting)] = before;
    changed = true;
  }
  return changed;
}

/**
 * Fold a brand's legacy SHARED intensity/grain/vignette into its current
 * preset's own keys, so switching presets never carries
 * them to another preset. The brand editor runs it on the brand it opens.
 *
 * Each theme keeps rendering what it rendered for its current preset:
 * - light: the shared value moves to the light preset's key, unless that key
 *   is already set (then it already won, and the shared value was unused);
 * - dark (its own preset, else light's): checked AFTER the shared keys are
 *   gone; if it would then read a different value for its preset, the value
 *   it read before is written to its own key.
 * The shared keys are then dropped, even where a preset key already won:
 * left in place, every OTHER preset would still fall back to them.
 *
 * A theme with NO live preset drops them too, moving them nowhere (the
 * owner's rule: each preset gets its own defaults). They paint nothing there,
 * and kept, they became the fallback of whatever preset was picked next:
 * the "Still" look wrote intensity 0 and vignette 0 with preset none, so a
 * later pick of Flow painted 0 / 0 while its sliders read 0.65 / 0.2. (A
 * light value a LIVE dark theme falls back to is pinned on dark first.)
 *
 * PURE. Returns `maps` itself when there is nothing to fold.
 */
export function migrateSharedFx(maps: FxOverrideMaps): FxOverrideMaps {
  const light: OverrideMap = { ...maps.tokenOverrides };
  const dark: OverrideMap | null = maps.darkTokenOverrides
    ? { ...maps.darkTokenOverrides }
    : null;
  const lightPreset = livePreset(light['shader-preset']);
  const darkPreset = darkPresetOf(light, dark);
  let changed = false;

  for (const setting of FX_SETTINGS) {
    // Read before the light fold, which can change what dark falls back to.
    const darkBefore =
      dark && darkPreset ? darkReads(light, dark, darkPreset, setting) : null;
    if (foldLight(light, lightPreset, setting)) changed = true;
    if (dark && foldDark(light, dark, darkPreset, setting, darkBefore)) {
      changed = true;
    }
  }

  if (!changed) return maps;
  return { tokenOverrides: light, darkTokenOverrides: nonEmpty(dark) };
}

/**
 * GOTCHA #1 — Pick a hero-fx shader preset.
 *
 * `presetId === 'none'` clears EVERY shader-* key (including 'shader-preset')
 * on the active theme so no stale config from a previously-selected preset
 * lingers: every key a live preset writes, plus every `shader-*` key in
 * `current` (the overrides as the editor shows them). The second set is what
 * reaches a cut preset's params — `shader-nebula-depth` and the like, saved
 * before the cut, which no live preset names and so no list of live keys can.
 * Any other id writes only the 'shader-preset' key. Every preset's settings,
 * intensity/grain/vignette included (`shader-<id>-intensity` etc.), are its
 * own keys, so they stay with it: a switch picks up the new preset's, and a
 * switch back finds the old one's where they were left.
 */
export function selectPreset(
  presetId: string,
  setOverride: SetOverride,
  current: Readonly<Record<string, unknown>>
): void {
  if (presetId === 'none') {
    const stale = Object.keys(current).filter((key) =>
      key.startsWith('shader-')
    );
    for (const key of new Set([...ALL_HERO_FX_SHADER_KEYS, ...stale])) {
      setOverride(key, null);
    }
  } else {
    setOverride('shader-preset', presetId);
  }
}

/**
 * GOTCHA #2 — Write a single shader-* override.
 *
 * Removes the entry (writes null) when `value` is empty OR equals the
 * compiled-in default for `key`, so pending.tokenOverrides only carries
 * meaningful diffs. Otherwise writes the value through unchanged.
 */
export function updateOverride(
  key: string,
  value: string,
  setOverride: SetOverride
): void {
  if (!value || value === HERO_FX_DEFAULTS[key]) {
    setOverride(key, null);
  } else {
    setOverride(key, value);
  }
}
