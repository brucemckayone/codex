/**
 * Hero FX helpers — unit tests for the two Codex-19h35 Phase 2 gotchas.
 *
 * Reduces the Playwright-only verification surface (Codex-bies6) by covering
 * the dedupe semantics that the scoping doc (Codex-6itei §4.2) calls out as
 * easy-to-break. Playwright is still required for visual/runtime confirmation
 * that slider drags update the live shader; this file only covers the pure
 * write-decision logic.
 *
 * GOTCHA #1 — selectPreset('none') iterates ALL_HERO_FX_SHADER_KEYS so no
 * stale overrides linger from a previously-selected preset.
 *
 * GOTCHA #2 — updateOverride removes (writes null) when value === default
 * so pending.tokenOverrides stays minimal and the "save only diff" invariant
 * is preserved.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type SetOverride,
  selectPreset,
  updateOverride,
} from './hero-fx-helpers';
import { ALL_HERO_FX_SHADER_KEYS, HERO_FX_DEFAULTS } from './hero-fx-presets';

describe('selectPreset (GOTCHA #1 — Codex-6itei §4.2)', () => {
  it("'none' clears every key in ALL_HERO_FX_SHADER_KEYS exactly once", () => {
    const setOverride: SetOverride = vi.fn();

    selectPreset('none', setOverride);

    // Every shader-* key (union across all presets) + 'shader-preset' itself
    // must receive exactly one null write — no skips, no duplicates.
    expect(setOverride).toHaveBeenCalledTimes(ALL_HERO_FX_SHADER_KEYS.length);

    const calls = (setOverride as ReturnType<typeof vi.fn>).mock.calls;
    const calledKeys = calls.map(([key]) => key);
    const calledValues = calls.map(([, value]) => value);

    // Each call must pass null as the value.
    expect(calledValues.every((v) => v === null)).toBe(true);

    // Calls must cover the exact key set with no duplicates.
    expect(new Set(calledKeys).size).toBe(ALL_HERO_FX_SHADER_KEYS.length);
    expect(new Set(calledKeys)).toEqual(new Set(ALL_HERO_FX_SHADER_KEYS));

    // Sanity: 'shader-preset' itself is included so the active preset
    // selector resets to 'none' as well.
    expect(calledKeys).toContain('shader-preset');
  });

  it("'suture' writes shader-preset only — no clear-all happens", () => {
    const setOverride: SetOverride = vi.fn();

    selectPreset('suture', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('shader-preset', 'suture');
  });

  it("'pulse' writes shader-preset only (parametric, mirrors 'suture')", () => {
    const setOverride: SetOverride = vi.fn();

    selectPreset('pulse', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('shader-preset', 'pulse');
  });
});

describe('updateOverride (GOTCHA #2 — Codex-6itei §4.2)', () => {
  it('removes the entry when value equals HERO_FX_DEFAULTS[key]', () => {
    // Sanity-check that we're testing against the real default, not a guess.
    expect(HERO_FX_DEFAULTS['shader-curl']).toBe('30');

    const setOverride: SetOverride = vi.fn();

    updateOverride('shader-curl', '30', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('shader-curl', null);
  });

  it('preserves a non-default value (writes value through unchanged)', () => {
    const setOverride: SetOverride = vi.fn();

    // '50' differs from HERO_FX_DEFAULTS['shader-curl'] === '30'.
    updateOverride('shader-curl', '50', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('shader-curl', '50');
  });

  it('treats empty-string value as "remove" → writes null', () => {
    const setOverride: SetOverride = vi.fn();

    updateOverride('shader-curl', '', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('shader-curl', null);
  });

  it('writes value through when key has no entry in HERO_FX_DEFAULTS', () => {
    // Sanity-check: this key doesn't exist in defaults — undefined !== 'value'
    // so the helper must treat it as a real write, not a no-op removal.
    expect(HERO_FX_DEFAULTS['non-existent-key']).toBeUndefined();

    const setOverride: SetOverride = vi.fn();

    updateOverride('non-existent-key', 'value', setOverride);

    expect(setOverride).toHaveBeenCalledTimes(1);
    expect(setOverride).toHaveBeenCalledWith('non-existent-key', 'value');
  });
});
