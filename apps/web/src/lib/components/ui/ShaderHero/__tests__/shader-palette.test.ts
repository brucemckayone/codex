import { afterEach, describe, expect, it } from 'vitest';
import { getShaderConfig } from '../shader-config';

/**
 * Palette resolution for shader presets.
 *
 * A shader paints in four colour slots. Before the shader palette existed
 * these were hard-wired to the org's brand colours (`--color-brand-*`), so a
 * creator could not give the hero effect its own palette. The resolution order
 * is now:
 *
 *   1. `--brand-shader-color-{slot}` — only when `--brand-shader-use-custom-colors`
 *      is exactly `'1'`, and only when the value parses
 *   2. `--color-brand-{slot}` — the org's brand palette
 *   3. a compiled-in platform default
 *
 * The tests below pin each rung, because the interesting failures are all
 * silent: a shader renders *something* whatever colours it gets, so a broken
 * fallback shows up as "the wrong purple" rather than an error. Two cases in
 * particular are regression guards rather than feature tests — the flag-off
 * case (§"ignores custom colours") and the malformed case (§"falls back on a
 * malformed"), both of which would silently repaint every existing org.
 */

/** Platform defaults, mirrored from getShaderConfig's compiled-in fallbacks. */
const PLATFORM_DEFAULT_PRIMARY = [0.486, 0.227, 0.929];

/** Assert an RGB triple matches expected channel values within 1/255. */
function expectRgb(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 2);
  }
}

/**
 * Build a detached `.org-layout` element carrying the given custom properties.
 *
 * `getShaderConfig` reads through `getComputedStyle`, and jsdom does resolve
 * inline custom properties, so setting them via `style.setProperty` exercises
 * the real read path rather than a stub.
 */
function mountLayout(props: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'org-layout';
  for (const [k, v] of Object.entries(props)) {
    el.style.setProperty(k, v);
  }
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shader palette resolution', () => {
  it('uses the org brand palette when no shader palette is set', () => {
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--color-brand-secondary': '#00ff00',
      '--color-brand-accent': '#0000ff',
      '--color-brand-bg': '#ffffff',
    });

    const cfg = getShaderConfig(el, 'waves');

    expectRgb(cfg.colors.primary, [1, 0, 0]);
    expectRgb(cfg.colors.secondary, [0, 1, 0]);
    expectRgb(cfg.colors.accent, [0, 0, 1]);
    expectRgb(cfg.colors.bg, [1, 1, 1]);
  });

  it('falls back to platform defaults with no brand palette at all', () => {
    const cfg = getShaderConfig(mountLayout({}), 'waves');
    expectRgb(cfg.colors.primary, PLATFORM_DEFAULT_PRIMARY);
  });

  it('uses the shader palette when custom colours are enabled', () => {
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': '#008080',
      '--brand-shader-color-secondary': '#123456',
    });

    const cfg = getShaderConfig(el, 'waves');

    expectRgb(cfg.colors.primary, [0, 128 / 255, 128 / 255]);
    expectRgb(cfg.colors.secondary, [0x12 / 255, 0x34 / 255, 0x56 / 255]);
  });

  it('ignores custom colours while the flag is off', () => {
    // REGRESSION GUARD. The brand editor's colour inputs always hold a value,
    // so the shader-color-* keys can be present while the creator has chosen
    // to match their brand. Honouring them here would silently repaint every
    // org that ever opened the panel.
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--brand-shader-color-primary': '#008080',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [1, 0, 0]);
  });

  it('ignores custom colours when the flag is any value other than "1"', () => {
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--brand-shader-use-custom-colors': '0',
      '--brand-shader-color-primary': '#008080',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [1, 0, 0]);
  });

  it('falls back to the brand colour on a malformed custom colour', () => {
    // REGRESSION GUARD. hexToRgb used to answer mid-grey for a malformed hex,
    // which is indistinguishable from a deliberate grey — so a typo'd token
    // painted the hero grey and every caller's fallback was dead code.
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': '#nothex',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [1, 0, 0]);
  });

  it('falls back per-slot, so one bad colour does not discard the others', () => {
    const el = mountLayout({
      '--color-brand-primary': '#ff0000',
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': 'not-a-colour',
      '--brand-shader-color-accent': '#008080',
    });

    const cfg = getShaderConfig(el, 'waves');

    expectRgb(cfg.colors.primary, [1, 0, 0]);
    expectRgb(cfg.colors.accent, [0, 128 / 255, 128 / 255]);
  });

  it('prefers the -dark shader colour when the dark sentinel is set', () => {
    const el = mountLayout({
      '--brand-shader-is-dark': '1',
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': '#ff0000',
      '--brand-shader-color-primary-dark': '#0000ff',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [0, 0, 1]);
  });

  it('uses the light shader colour when no -dark variant exists', () => {
    const el = mountLayout({
      '--brand-shader-is-dark': '1',
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': '#ff0000',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [1, 0, 0]);
  });

  it('accepts rgb() as well as hex, since computed styles may serialise either', () => {
    const el = mountLayout({
      '--brand-shader-use-custom-colors': '1',
      '--brand-shader-color-primary': 'rgb(0, 128, 255)',
    });

    expectRgb(getShaderConfig(el, 'waves').colors.primary, [0, 128 / 255, 1]);
  });
});

describe('pulse surface colour', () => {
  it('falls back to the designed default on a malformed hex', () => {
    const el = mountLayout({ '--brand-shader-pulse-color': '#zzz' });
    const cfg = getShaderConfig(el, 'pulse');

    // #d10000 — the compiled-in default, not mid-grey.
    if (cfg.preset !== 'pulse') throw new Error('expected the pulse preset');
    expectRgb(cfg.pulseColor, [0xd1 / 255, 0, 0]);
  });
});
