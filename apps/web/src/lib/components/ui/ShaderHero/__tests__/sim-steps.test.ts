import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import { createFlowRenderer } from '../renderers/flow-renderer';
import { createRippleRenderer } from '../renderers/ripple-renderer';
import { createSutureRenderer } from '../renderers/suture-renderer';
import type {
  FlowConfig,
  RippleConfig,
  ShaderConfig,
  SutureConfig,
} from '../shader-config';
import { fakeGl, seededRandom } from './fake-gl';

/**
 * Simulation steps follow TIME, not frames (Codex-1yd58 WP-1d).
 *
 * The audio impulses (wanderer, beat splash, bass rumble, ambient) used to run
 * once a FRAME, outside the step clock, and a click queued a new splash on
 * every frame its burstStrength decayed (~28 at 60 Hz, ~56 at 120 Hz), each
 * with extra steps of its own. Measured before the fix, steps a second with
 * audio at 60 / 120 Hz: flow 444 / 768, suture 266 / 470, ripple 155 / 180;
 * extra steps per click: suture 261 / 969, ripple 174 / 342.
 *
 * A stand-in WebGL2 context (fake-gl.ts) counts every draw made while a
 * framebuffer is bound (a simulation pass); the screen draws are the display
 * pass.
 */

const rgb = (r: number, g: number, b: number): [number, number, number] => [
  r,
  g,
  b,
];
const BASE = {
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
  colors: {
    primary: rgb(0.5, 0.2, 0.9),
    secondary: rgb(0.9, 0.3, 0.6),
    accent: rgb(1, 0.6, 0.05),
    bg: rgb(0.06, 0.09, 0.17),
  },
  brand: { primary: rgb(0.5, 0.2, 0.9), bg: rgb(0.06, 0.09, 0.17) },
};
const PRESETS: Record<
  string,
  { create: () => ShaderRenderer; config: ShaderConfig }
> = {
  flow: {
    create: createFlowRenderer,
    config: {
      ...BASE,
      preset: 'flow',
      curl: 0.6,
      advection: 6,
      smoothing: 0.8,
      contrast: 12,
      fieldSpeed: 1,
    } satisfies FlowConfig,
  },
  suture: {
    create: createSutureRenderer,
    config: {
      ...BASE,
      preset: 'suture',
      curl: 30,
      dissipation: 0.903,
      advection: 8,
      force: 2.7,
    } satisfies SutureConfig,
  },
  ripple: {
    create: createRippleRenderer,
    config: {
      ...BASE,
      preset: 'ripple',
      waveSpeed: 0.8,
      damping: 0.995,
      rippleSize: 0.03,
      refraction: 0.5,
    } satisfies RippleConfig,
  },
};

const audioAt = (t: number): AudioState => ({
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

interface Run {
  fps: number;
  audio?: boolean;
  clickAt?: number;
  /** Frames rendered at one frozen time (reduced motion, `still`). */
  freezeFrames?: number;
}

/** Simulation draws from t = 1 s (seed and warm-up paid) to t = 4 s. */
function simDraws(
  id: string,
  { fps, audio = false, clickAt, freezeFrames = 0 }: Run
): number {
  // Ambient intervals are random: the same sequence for every run.
  vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const { gl, counts } = fakeGl();
  const { create, config } = PRESETS[id];
  const renderer = create();
  expect(renderer.init(gl, 1440, 900)).toBe(true);
  const mouse: MouseState = { x: 0.5, y: 0.5, active: true, burstStrength: 0 };
  const dt = 1 / fps;
  let t = 0;
  const frame = () => {
    if (clickAt !== undefined && t >= clickAt && t < clickAt + dt)
      mouse.burstStrength = 1;
    renderer.render(
      gl,
      t,
      mouse,
      config,
      1440,
      900,
      audio ? audioAt(t) : undefined
    );
    mouse.burstStrength *= DECAY_PER_SECOND ** dt;
    if (mouse.burstStrength < 0.01) mouse.burstStrength = 0;
  };
  for (; t < 1 - 1e-9; t += dt) frame();
  if (freezeFrames > 0) {
    frame(); // the last moving frame
    counts.sim = 0;
    for (let i = 0; i < freezeFrames; i++) frame();
    return counts.sim;
  }
  counts.sim = 0;
  for (; t < 4 - 1e-9; t += dt) frame();
  return counts.sim;
}

/** Within a step or two: a frame boundary can land a step either side. */
const near = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(2);

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  'flow',
  'suture',
  'ripple',
])('%s: steps follow time, not frames', (id) => {
  it('runs as many steps at 120 Hz as at 60 Hz, idle and with audio', () => {
    near(simDraws(id, { fps: 120 }), simDraws(id, { fps: 60 }));
    near(
      simDraws(id, { fps: 120, audio: true }),
      simDraws(id, { fps: 60, audio: true })
    );
  });

  it('runs no step on a frozen frame, audio or not', () => {
    expect(simDraws(id, { fps: 60, audio: true, freezeFrames: 30 })).toBe(0);
  });
});

describe('a click is one splash, at any frame rate', () => {
  it.each([
    // [preset, extra steps one click costs]
    ['ripple', 8],
    ['suture', 12],
    // A CONTROL, not a proof: flow's click already rode its clocked input
    // steps before WP-1d, so this case passes on the old code too (the
    // ripple and suture cases fail on it). It pins that the port left
    // flow's click at no extra steps.
    ['flow', 0],
  ] as const)('%s: %i extra steps per click at 60 Hz and at 120 Hz', (id, extra) => {
    for (const fps of [60, 120]) {
      expect(simDraws(id, { fps, clickAt: 2 }) - simDraws(id, { fps })).toBe(
        extra
      );
    }
  });
});
