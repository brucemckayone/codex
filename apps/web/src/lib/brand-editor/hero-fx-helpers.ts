/**
 * Hero FX helpers — preset selection + override default-equality removal.
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
 * GOTCHA #1 (selectPreset 'none'): MUST iterate ALL_HERO_FX_SHADER_KEYS — the
 * union of every shader-* key across every preset plus 'shader-preset' — so
 * no stale overrides linger after the user picks "None".
 *
 * GOTCHA #2 (updateOverride remove-on-default): MUST remove the override
 * entry (write null) when the value equals HERO_FX_DEFAULTS[key] or is empty,
 * so pending.tokenOverrides stays minimal and the brand editor's "save only
 * diff" invariant holds.
 */
import { ALL_HERO_FX_SHADER_KEYS, HERO_FX_DEFAULTS } from './hero-fx-presets';

/** Writer signature mirroring brandEditor.setThemeTokenOverride. */
export type SetOverride = (key: string, value: string | null) => void;

/**
 * GOTCHA #1 — Pick a hero-fx shader preset.
 *
 * `presetId === 'none'` clears EVERY shader-* key (including 'shader-preset')
 * on the active theme so no stale config from a previously-selected preset
 * lingers. Any other id writes only the 'shader-preset' key, preserving any
 * existing slider values the user has tweaked under shared controls.
 */
export function selectPreset(presetId: string, setOverride: SetOverride): void {
  if (presetId === 'none') {
    for (const key of ALL_HERO_FX_SHADER_KEYS) {
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
