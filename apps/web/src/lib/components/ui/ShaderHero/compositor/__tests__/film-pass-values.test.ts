/**
 * A Showreel film pass's values and how they reach its uniforms
 * (Codex-1yd58.7, WP-6 wiring part 1). Every name a composed pass can
 * declare gets a value (a declared, unset uniform reads zero, legal GLSL
 * nothing else would catch), the motion arrives as the Showreel wrote it,
 * and each uniform is set by its own type: the trail as one array.
 */
import { describe, expect, it } from 'vitest';
import {
  FILM_PASS_UNIFORMS,
  restMotion,
  TRAIL_POINTS,
} from '../effects/motion-uniforms';
import { SAMPLER_UNITS } from '../effects/uniforms';
import {
  type FilmPassLocations,
  filmPassValues,
  type FrameShared,
  setFilmPassUniforms,
} from '../film-pass-values';
import { governFlash } from '../flash';

const shared: FrameShared = {
  u_pointer: [0.25, 0.75],
  u_brandPrimary: [0.8, 0.1, 0.2],
  u_brandSecondary: [0.4, 0.5, 0.6],
  u_brandAccent: [0.7, 0.8, 0.9],
  u_bgColor: [0.05, 0.05, 0.05],
  u_rect: [20, 30, 400, 600],
  u_fade: 1,
  u_mediaSize: [720, 1280],
  u_hasMedia: 1,
  u_band: 2,
  u_ramp: [0.5, 0.95],
};

describe('filmPassValues', () => {
  it('has a value for every uniform a film pass can read but the samplers, which have units', () => {
    const values = filmPassValues(shared, [780, 1688], 2.9, restMotion());
    for (const name of FILM_PASS_UNIFORMS) {
      if (name in SAMPLER_UNITS) continue;
      expect(values, name).toHaveProperty(name);
      expect(values[name as keyof typeof values], name).not.toBeUndefined();
    }
  });

  it('hands the motion through as written, and the governed clock beside the real one', () => {
    const motion = restMotion();
    motion.u_reveal = 0.3;
    const values = filmPassValues(shared, [780, 1688], 2.9, motion);
    expect(values.u_trail).toBe(motion.u_trail);
    expect(values.u_reveal).toBe(0.3);
    expect(values.u_resolution).toEqual([780, 1688]);
    expect(values.u_amount).toBe(1);
    expect(values.u_time).toBe(2.9);
    expect(values.u_flashTime).toBe(governFlash(2.9));
    expect(values.u_flashTime).not.toBe(2.9);
    expect(values.u_rect).toBe(shared.u_rect);
  });
});

describe('setFilmPassUniforms', () => {
  function recordingGl() {
    const calls: [string, unknown[]][] = [];
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push([method, args]);
      };
    const gl = {
      uniform1i: record('uniform1i'),
      uniform1f: record('uniform1f'),
      uniform2f: record('uniform2f'),
      uniform3f: record('uniform3f'),
      uniform4f: record('uniform4f'),
      uniform4fv: record('uniform4fv'),
    } as unknown as WebGL2RenderingContext;
    return { gl, calls };
  }
  const loc = (name: string) =>
    ({ name }) as unknown as WebGLUniformLocation;

  it('sets samplers to their units, the trail as one array, the rest by size', () => {
    const { gl, calls } = recordingGl();
    const motion = restMotion();
    motion.u_nameCentre = [0.4, 0.6];
    const values = filmPassValues(shared, [780, 1688], 2.9, motion);
    const locations: FilmPassLocations = [
      ['u_scene', loc('u_scene')],
      ['u_mask', loc('u_mask')],
      ['u_trail', loc('u_trail')],
      ['u_reveal', loc('u_reveal')],
      ['u_nameCentre', loc('u_nameCentre')],
      ['u_brandPrimary', loc('u_brandPrimary')],
      ['u_rect', loc('u_rect')],
      // A name the driver optimised out: nothing is set for it.
      ['u_dive', null],
    ];
    setFilmPassUniforms(gl, locations, values);
    expect(calls).toEqual([
      ['uniform1i', [loc('u_scene'), SAMPLER_UNITS.u_scene]],
      ['uniform1i', [loc('u_mask'), SAMPLER_UNITS.u_mask]],
      ['uniform4fv', [loc('u_trail'), motion.u_trail]],
      ['uniform1f', [loc('u_reveal'), 1]],
      ['uniform2f', [loc('u_nameCentre'), 0.4, 0.6]],
      ['uniform3f', [loc('u_brandPrimary'), 0.8, 0.1, 0.2]],
      ['uniform4f', [loc('u_rect'), 20, 30, 400, 600]],
    ]);
    const trail = calls.find(([m]) => m === 'uniform4fv')?.[1][1];
    expect(trail).toBeInstanceOf(Float32Array);
    expect((trail as Float32Array).length).toBe(TRAIL_POINTS * 4);
  });

  it('never sets a sampler from the values, whatever they hold', () => {
    const { gl, calls } = recordingGl();
    setFilmPassUniforms(
      gl,
      [['u_media', loc('u_media')]],
      filmPassValues(shared, [1, 1], 0, restMotion())
    );
    expect(calls).toEqual([
      ['uniform1i', [loc('u_media'), SAMPLER_UNITS.u_media]],
    ]);
  });
});
