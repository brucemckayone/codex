import { afterEach, describe, expect, it } from 'vitest';
import {
  FX_BASE,
  fxDefaultsFor,
  LIVE_PRESET_IDS,
  PRESET_FX_KEYS,
  presetFxKey,
} from '../preset-fx-defaults';
import { getShaderConfig } from '../shader-config';

/**
 * Intensity, grain and vignette are each preset's own. getShaderConfig reads,
 * in order: the preset's key, then the legacy shared key (older brands), then
 * the preset's tuned default.
 */

function mountLayout(props: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'org-layout';
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  document.body.appendChild(el);
  return el;
}

/** The three settings getShaderConfig resolves for `props`. */
function fx(props: Record<string, string>) {
  const { intensity, grain, vignette } = getShaderConfig(mountLayout(props));
  return { intensity, grain, vignette };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the per-preset keys', () => {
  it('are three for every preset that paints, and none for "none"', () => {
    expect(LIVE_PRESET_IDS).toHaveLength(16);
    expect(LIVE_PRESET_IDS).not.toContain('none');
    expect(PRESET_FX_KEYS).toHaveLength(48);
    expect(new Set(PRESET_FX_KEYS).size).toBe(48);
    expect(PRESET_FX_KEYS).toContain('shader-suture-intensity');
    expect(PRESET_FX_KEYS).toContain('shader-fracture-vignette');
    expect(
      PRESET_FX_KEYS.every((k) =>
        /^shader-[a-z]+-(intensity|grain|vignette)$/.test(k)
      )
    ).toBe(true);
  });

  it('default to the tuned values where the contrast check passed, else the old global', () => {
    expect(fxDefaultsFor('suture')).toEqual({
      intensity: 1.6,
      grain: 0.025,
      vignette: 0.1,
    });
    expect(fxDefaultsFor('caustic')).toEqual({
      intensity: 1.5,
      grain: 0.025,
      vignette: 0.2,
    });
    expect(fxDefaultsFor('flow')).toBe(FX_BASE);
    expect(fxDefaultsFor('none')).toBe(FX_BASE);
  });
});

describe('getShaderConfig: intensity, grain and vignette', () => {
  it("reads the preset's own key first", () => {
    expect(
      fx({
        '--brand-shader-preset': 'suture',
        '--brand-shader-suture-intensity': '2',
        '--brand-shader-suture-grain': '0.04',
        '--brand-shader-suture-vignette': '0.3',
        '--brand-shader-intensity': '0.9',
        '--brand-shader-grain': '0.01',
        '--brand-shader-vignette': '0.45',
      })
    ).toEqual({ intensity: 2, grain: 0.04, vignette: 0.3 });
  });

  it('falls back to the legacy shared key when the preset has none (an older brand)', () => {
    expect(
      fx({
        '--brand-shader-preset': 'flow',
        '--brand-shader-intensity': '0.75',
        '--brand-shader-grain': '0.05',
        '--brand-shader-vignette': '0.35',
      })
    ).toEqual({ intensity: 0.75, grain: 0.05, vignette: 0.35 });
  });

  it("falls back per setting: the preset's key for one, the shared key for another", () => {
    expect(
      fx({
        '--brand-shader-preset': 'flow',
        '--brand-shader-flow-intensity': '1.1',
        '--brand-shader-vignette': '0.35',
      })
    ).toEqual({ intensity: 1.1, grain: FX_BASE.grain, vignette: 0.35 });
  });

  it("falls back to the preset's own default when neither is set", () => {
    expect(fx({ '--brand-shader-preset': 'suture' })).toEqual(
      fxDefaultsFor('suture')
    );
    expect(fx({ '--brand-shader-preset': 'caustic' })).toEqual(
      fxDefaultsFor('caustic')
    );
    expect(fx({ '--brand-shader-preset': 'flow' })).toEqual(FX_BASE);
  });

  it('reaches a brand that stored nothing: suture paints 1.6, caustic 1.5', () => {
    // Intended: the tuned defaults are what a brand on that preset gets until
    // it tunes its own. Both once read the global 0.65; a census found no
    // production brand on suture or caustic.
    expect(fx({ '--brand-shader-preset': 'suture' })).toEqual({
      intensity: 1.6,
      grain: 0.025,
      vignette: 0.1,
    });
    expect(fx({ '--brand-shader-preset': 'caustic' }).intensity).toBe(1.5);
  });

  it("never reads another preset's key", () => {
    // Suture's tuning must not reach caustic: caustic keeps its own default…
    expect(
      fx({
        '--brand-shader-preset': 'caustic',
        '--brand-shader-suture-intensity': '3',
        '--brand-shader-suture-vignette': '0.5',
      })
    ).toEqual(fxDefaultsFor('caustic'));
    // …and suture's key does not stand in for caustic's in the read order.
    expect(
      fx({
        '--brand-shader-preset': 'caustic',
        '--brand-shader-suture-intensity': '3',
        '--brand-shader-intensity': '0.9',
      }).intensity
    ).toBe(0.9);
  });

  it("goes through the alias door: a cut id reads its survivor's keys", () => {
    // nebula was cut to aurora.
    expect(
      fx({
        '--brand-shader-preset': 'nebula',
        [`--brand-${presetFxKey('aurora', 'intensity')}`]: '1.3',
      }).intensity
    ).toBe(1.3);
  });

  it("in dark mode prefers each key's -dark value, the preset's key still first", () => {
    const dark = {
      '--brand-shader-is-dark': '1',
      '--brand-shader-preset': 'suture',
    };
    expect(
      fx({
        ...dark,
        '--brand-shader-suture-intensity': '2',
        '--brand-shader-suture-intensity-dark': '2.5',
        '--brand-shader-intensity-dark': '0.4',
      }).intensity
    ).toBe(2.5);
    // A legacy brand's dark shared value, with no preset key.
    expect(
      fx({
        ...dark,
        '--brand-shader-vignette': '0.35',
        '--brand-shader-vignette-dark': '0.25',
      }).vignette
    ).toBe(0.25);
  });

  it('"none" has no keys of its own: the shared key, else the base default', () => {
    expect(
      fx({ '--brand-shader-preset': 'none', '--brand-shader-intensity': '0.9' })
        .intensity
    ).toBe(0.9);
    expect(fx({ '--brand-shader-preset': 'none' })).toEqual(FX_BASE);
  });
});
