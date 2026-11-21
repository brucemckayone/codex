/**
 * Time that stands still moves nothing (Codex-1yd58.12, WP-11's visual-gate
 * drift). `createDeltaClock` handed back a sixtieth of a second for a frame
 * drawn at the same time as the last, so every preset that integrates its
 * own clock (`u_clock += dt * rate`) went on moving with the page's clock
 * frozen: a light org page drifted ~2.8 mean over 8 s under the visual
 * gate's frozen `performance.now`, and a reduced-motion still frame moved on
 * each redraw. A frame at the same time now advances nothing, with sound on
 * too (whose beat rate divides by dt).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeltaClock } from '../audio-uniforms';
import type { MouseState, ShaderRenderer } from '../renderer-types';
import { createAuroraRenderer } from '../renderers/aurora-renderer';
import { createCausticRenderer } from '../renderers/caustic-renderer';
import { createFilmRenderer } from '../renderers/film-renderer';
import { createFluxRenderer } from '../renderers/flux-renderer';
import { createFractureRenderer } from '../renderers/fracture-renderer';
import { createGlassRenderer } from '../renderers/glass-renderer';
import { createLavaRenderer } from '../renderers/lava-renderer';
import { createTopoRenderer } from '../renderers/topo-renderer';
import { getShaderConfig } from '../shader-config';
import { fakeGl, seededRandom } from './fake-gl';
import { audioAt } from './renderer-run';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDeltaClock', () => {
  it('is a sixtieth on the first frame, then the time that passed', () => {
    const dt = createDeltaClock();
    expect(dt(3)).toBeCloseTo(1 / 60, 10);
    expect(dt(3.016)).toBeCloseTo(0.016, 10);
  });

  it('is 0 for a frame at the same time: time standing still moves nothing', () => {
    const dt = createDeltaClock();
    dt(3);
    expect(dt(3)).toBe(0);
    expect(dt(3)).toBe(0);
  });

  it('caps a long pause, and treats a time reset as one frame', () => {
    const dt = createDeltaClock();
    dt(3);
    expect(dt(10)).toBe(0.1);
    expect(dt(1)).toBeCloseTo(1 / 60, 10);
  });
});

const PRESETS: readonly [string, () => ShaderRenderer][] = [
  ['aurora', createAuroraRenderer],
  ['caustic', createCausticRenderer],
  ['film', createFilmRenderer],
  ['flux', createFluxRenderer],
  ['fracture', createFractureRenderer],
  ['glass', createGlassRenderer],
  ['lava', createLavaRenderer],
  ['topo', createTopoRenderer],
];

describe('a preset with its own clock, at a frozen time', () => {
  it.each(
    PRESETS.flatMap(
      ([id, create]) =>
        [
          [id, 'silent', create],
          [id, 'with sound', create],
        ] as const
    )
  )('%s (%s) draws the same frame again', (id, sound, create) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom());
    const fake = fakeGl(1440, 900);
    const renderer = create();
    expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
    const config = getShaderConfig(null, id);
    const mouse: MouseState = {
      x: 0.5,
      y: 0.5,
      active: false,
      burstStrength: 0,
    };
    const audio = sound === 'with sound';
    const at = (t: number) =>
      renderer.render(
        fake.gl,
        t,
        mouse,
        config,
        1440,
        900,
        audio ? audioAt(t) : undefined
      );
    // a second of frames, then the clock stands still at 1 s
    for (let t = 0; t < 1; t += 1 / 60) at(t);
    at(1);
    const held = fake.uniforms.get('u_clock');
    expect(Number.isFinite(held)).toBe(true);
    for (let i = 0; i < 30; i++) at(1);
    expect(fake.uniforms.get('u_clock')).toBe(held);
    // and time moving on moves it again
    at(1 + 1 / 60);
    expect(fake.uniforms.get('u_clock')).not.toBe(held);
  });
});
