/**
 * Running a renderer frame by frame on the fake WebGL (fake-gl.ts), for the
 * WP-1d rework tests (Codex-1yd58): a palette, a sound to play, ShaderHero's
 * click decay, and `runFrames`, which renders a stretch of seconds at a
 * given frame rate and keeps what was drawn and uploaded after `from`.
 */

import { expect, vi } from 'vitest';
import { FX_BASE } from '../preset-fx-defaults';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { type FakeGl, fakeGl, seededRandom } from './fake-gl';

const rgb = (r: number, g: number, b: number): [number, number, number] => [
  r,
  g,
  b,
];

/** The shared settings and a palette, for a preset config to spread. */
export const BASE = {
  ...FX_BASE,
  colors: {
    primary: rgb(0.5, 0.2, 0.9),
    secondary: rgb(0.9, 0.3, 0.6),
    accent: rgb(1, 0.6, 0.05),
    bg: rgb(0.06, 0.09, 0.17),
  },
};

/** A track playing at time t. */
export const audioAt = (t: number): AudioState => ({
  bass: 0.6,
  mids: 0.4,
  treble: 0.3,
  amplitude: 0.5,
  bassSmooth: 0.6,
  midsSmooth: 0.4,
  trebleSmooth: 0.3,
  amplitudeSmooth: 0.5,
  // A beat every 0.5 s, above the renderers' 0.2 gate for its first 0.2 s.
  beatPulse: Math.max(0, 1 - (t % 0.5) / 0.25),
  energy: 0.5,
  flux: 0.2,
  centroid: 0.5,
  beatPhase: (t % 0.5) / 0.5,
  onsetCount: Math.floor(t / 0.5),
  active: true,
});

/** ShaderHero's own decay: 0.85 a frame at 60 Hz, applied by elapsed time. */
const DECAY_PER_SECOND = 0.85 ** 60;

/** Two step counts that agree to within a frame's rounding. */
export const near = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(2);

export interface FrameRun {
  fps: number;
  /** Canvas size; a 1440x900 desktop hero unless given. */
  width?: number;
  height?: number;
  /** Where the pointer is, and whether it is over the canvas. */
  pointer?: { x: number; y: number; active: boolean };
  audio?: boolean;
  /** A click at this time, decaying as ShaderHero decays it. */
  clickAt?: number;
  /** What was drawn and uploaded is kept from this time (default 1 s). */
  from?: number;
  /** The run ends here (default 4 s). */
  until?: number;
}

/**
 * Render `renderer` from t = 0 to `until` at `fps`, with Math.random seeded.
 * The counts and the uniform log hold what happened from `from` on; the
 * uniform map holds the last value of each.
 */
export function runFrames(
  renderer: ShaderRenderer,
  config: ShaderConfig,
  run: FrameRun
): FakeGl {
  vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const { width = 1440, height = 900, from = 1, until = 4 } = run;
  const fake = fakeGl(width, height);
  if (!renderer.init(fake.gl, width, height)) {
    throw new Error('the renderer did not initialise on the fake GL');
  }
  const pointer = run.pointer ?? { x: 0.5, y: 0.5, active: false };
  const mouse: MouseState = { ...pointer, burstStrength: 0 };
  const dt = 1 / run.fps;
  let t = 0;
  const frame = () => {
    if (run.clickAt !== undefined && t >= run.clickAt && t < run.clickAt + dt) {
      mouse.burstStrength = 1;
    }
    renderer.render(
      fake.gl,
      t,
      mouse,
      config,
      width,
      height,
      run.audio ? audioAt(t) : undefined
    );
    mouse.burstStrength *= DECAY_PER_SECOND ** dt;
    if (mouse.burstStrength < 0.01) mouse.burstStrength = 0;
  };
  for (; t < from - 1e-9; t += dt) frame();
  fake.counts.sim = 0;
  fake.counts.screen = 0;
  fake.log.length = 0;
  for (; t < until - 1e-9; t += dt) frame();
  return fake;
}

/** How many times a uniform was set to a value `pick` accepts. */
export function uploads(
  fake: FakeGl,
  name: string,
  pick: (value: unknown) => boolean = () => true
): number {
  return fake.log.filter((u) => u.name === name && pick(u.value)).length;
}
