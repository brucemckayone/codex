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
import { ALL_HERO_FX_SHADER_KEYS, HERO_FX_DEFAULTS } from './hero-fx-presets';

/** Writer signature mirroring brandEditor.setThemeTokenOverride. */
export type SetOverride = (key: string, value: string | null) => void;

/**
 * GOTCHA #1 — Pick a hero-fx shader preset.
 *
 * `presetId === 'none'` clears EVERY shader-* key (including 'shader-preset')
 * on the active theme so no stale config from a previously-selected preset
 * lingers: every key a live preset writes, plus every `shader-*` key in
 * `current` (the overrides as the editor shows them). The second set is what
 * reaches a cut preset's params — `shader-nebula-depth` and the like, saved
 * before the cut, which no live preset names and so no list of live keys can.
 * Any other id writes only the 'shader-preset' key, preserving any existing
 * slider values the user has tweaked under shared controls.
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
