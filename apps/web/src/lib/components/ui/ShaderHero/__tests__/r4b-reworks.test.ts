import { afterEach, describe, expect, it } from 'vitest';
import type { ShaderRenderer } from '../renderer-types';
import { createFractureRenderer } from '../renderers/fracture-renderer';
import { createGlassRenderer } from '../renderers/glass-renderer';
import { getShaderConfig } from '../shader-config';
import { FRACTURE_FRAG } from '../shaders/fracture.frag';
import { GLASS_FRAG } from '../shaders/glass.frag';
import { fakeGl } from './fake-gl';

/**
 * The R4b reworks (Codex-1yd58 WP-1d): glass and fracture keep their bold,
 * hard, dark lines by default (the owner's motif), and R4's softer line is a
 * set of creator settings. A brand that stores nothing paints the old line;
 * each new slider reaches its uniform.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

const PRESETS: Record<string, () => ShaderRenderer> = {
  glass: createGlassRenderer,
  fracture: createFractureRenderer,
};

/** The uniforms one frame uploads for a brand storing `vars` (shader-* keys). */
function frame(preset: string, vars: Record<string, string> = {}) {
  const el = document.createElement('div');
  el.className = 'org-layout';
  el.style.setProperty('--brand-shader-preset', preset);
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(`--brand-${key}`, value);
  }
  document.body.appendChild(el);
  const config = getShaderConfig(el);
  const fake = fakeGl(1440, 900);
  const renderer = PRESETS[preset]();
  expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
  const mouse = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };
  renderer.render(fake.gl, 0, mouse, config, 1440, 900);
  const fields: Record<string, unknown> = { ...config };
  return { uniforms: fake.uniforms, config: fields };
}

/** GLSL with comments stripped and whitespace collapsed. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ');

describe('R4b: a brand storing nothing paints the old line', () => {
  it.each([
    {
      preset: 'glass',
      want: {
        u_lineSoftness: 0,
        u_lineTint: 0,
        u_pieceEdges: 0,
        u_border: 0.04,
      },
    },
    {
      preset: 'fracture',
      // Border, shadow and fill as before R4; fewer cuts, a calmer sway.
      want: {
        u_lineSoftness: 0,
        u_lineTint: 0,
        u_border: 0.01,
        u_shadow: 0.05,
        u_fill: 0.85,
        u_cuts: 5,
      },
      // Speed has no uniform: it runs the cut clock.
      config: { speed: 0.12 },
    },
  ])('$preset uploads the hard, dark defaults', ({ preset, want, config }) => {
    const painted = frame(preset);
    for (const [name, value] of Object.entries(want)) {
      expect(painted.uniforms.get(name), name).toBeCloseTo(value, 6);
    }
    for (const [field, value] of Object.entries(config ?? {})) {
      expect(painted.config[field], field).toBe(value);
    }
  });

  // At softness, tint and piece edges 0, each blend gives back the old term:
  // a 1 px anti-aliased edge, the old near-black lead, the old shadow, the
  // old flat piece, and no edge glow lighting a dark came on a light ground.
  it('glass at 0: a 1 px hard edge, the ground at 18%, flat pieces', () => {
    const glsl = code(GLASS_FRAG);
    expect(glsl).toContain('float aa = fwidth(edge);');
    expect(glsl).toContain(
      'float leadRamp = max(aa, u_lineSoftness * u_border * 0.4);'
    );
    expect(glsl).toContain(
      'vec3 leadColor = mix(u_bgColor * 0.18, tintLead, u_lineTint);'
    );
    expect(glsl).toContain('0.45 * bevel * u_pieceEdges');
    expect(glsl).toContain('* mix(1.0, u_lineTint, onLight);');
  });

  it('fracture at 0: a 1 px hard edge, the old lead and shadow', () => {
    const glsl = code(FRACTURE_FRAG);
    expect(glsl).toContain(
      'float ramp = max(fw, u_lineSoftness * u_border * 0.65);'
    );
    expect(glsl).toContain(
      'vec3 leadColor = mix(u_bgColor * mix(0.40, 0.14, onLight), tintLead, u_lineTint);'
    );
    expect(glsl).toContain(
      'vec3 shadowColor = mix( u_bgColor * mix(0.30, 0.55, onLight),'
    );
    expect(glsl).toContain(
      'shadowMask = clamp(shadowMask, 0.0, mix(0.5, 0.25, u_lineSoftness));'
    );
  });
});

describe('R4b: each new slider reaches its uniform', () => {
  it.each([
    ['glass', 'shader-glass-line-softness', 'u_lineSoftness'],
    ['glass', 'shader-glass-line-colour', 'u_lineTint'],
    ['glass', 'shader-glass-piece-edges', 'u_pieceEdges'],
    ['fracture', 'shader-fracture-line-softness', 'u_lineSoftness'],
    ['fracture', 'shader-fracture-line-colour', 'u_lineTint'],
  ])('%s %s -> %s', (preset, key, uniform) => {
    expect(frame(preset).uniforms.get(uniform)).toBe(0);
    expect(frame(preset, { [key]: '0.6' }).uniforms.get(uniform)).toBeCloseTo(
      0.6,
      6
    );
  });
});
