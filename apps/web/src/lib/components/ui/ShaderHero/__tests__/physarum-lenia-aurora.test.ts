import { afterEach, describe, expect, it, vi } from 'vitest';
import { fxDefaultsFor } from '../preset-fx-defaults';
import type { ShaderRenderer } from '../renderer-types';
import { createLeniaRenderer } from '../renderers/lenia-renderer';
import { createPhysarumRenderer } from '../renderers/physarum-renderer';
import {
  getShaderConfig,
  type LeniaConfig,
  type ShaderConfig,
} from '../shader-config';
import { AURORA_FRAG } from '../shaders/aurora.frag';
import { PHYSARUM_REMAP_FRAG } from '../shaders/physarum-init.frag';
import { PHYSARUM_AGENT_FRAG } from '../shaders/physarum-sim.frag';
import { PHYSARUM_DEPOSIT_VERT } from '../shaders/physarum-sim.vert';
import { fakeGl } from './fake-gl';
import { audioAt, BASE, near, runFrames, uploads } from './renderer-run';

/**
 * Physarum as particles that grow a vein network before the first frame, lenia
 * on the step clock at the lab's tuning, and aurora's folds measured across the
 * width. Each FBO preset: one splash per click, the same speed at 60 and 120
 * Hz, a grid of the canvas's shape (round on a phone), and a first frame
 * already grown.
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const PHYSARUM = {
  ...BASE,
  preset: 'physarum',
  diffusion: 1,
  decay: 0.98,
  deposit: 1,
  sensor: 0.03,
  turn: 0.25,
} satisfies ShaderConfig;

/** Radius 17, not the default 15 or the old warm-up's 13: the rules show. */
const LENIA = {
  ...BASE,
  preset: 'lenia',
  radius: 17,
  growth: 0.2,
  width: 0.05,
  speed: 4,
  dt: 0.5,
} satisfies LeniaConfig;

const OVER = { x: 0.5, y: 0.5, active: true };

/** Texels per canvas pixel across, over texels per pixel down: 1 is round. */
function texelShape(texel: unknown, width: number, height: number) {
  const [tx, ty] = texel as [number, number];
  return { tx, ty, ratio: (1 / tx / width) * height * ty };
}

/** The uniforms uploaded through one render at t = 0, after init. */
function firstFrame(renderer: ShaderRenderer, config: ShaderConfig) {
  const fake = fakeGl();
  expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
  fake.log.length = 0;
  fake.counts.sim = 0;
  renderer.render(
    fake.gl,
    0,
    { x: 0, y: 0, active: false, burstStrength: 0 },
    config,
    1440,
    900
  );
  return fake;
}

describe('physarum: a vein network that has grown before it shows', () => {
  const steps = (fps: number, audio = false) =>
    uploads(
      runFrames(createPhysarumRenderer(), PHYSARUM, { fps, audio }),
      'uStep'
    );

  it('runs 120 steps a second at 60 and at 120 Hz, idle and with sound', () => {
    // It ran 2 steps a FRAME: 240 a second at 120 Hz.
    expect(steps(60)).toBe(360);
    near(steps(120), steps(60));
    near(steps(120, true), steps(60, true));
  });

  it('lays one 6-step burst per click at any frame rate (it queued one a frame)', () => {
    for (const fps of [60, 120]) {
      const burst = (clickAt?: number) =>
        uploads(
          runFrames(createPhysarumRenderer(), PHYSARUM, {
            fps,
            clickAt,
            pointer: OVER,
          }),
          'uMouseStrength',
          (v) => (v as number) > 1
        );
      expect(burst(), `${fps} Hz`).toBe(0);
      expect(burst(2), `${fps} Hz`).toBe(6);
    }
  });

  it('draws round cells on a phone: the trail grid has the canvas shape', () => {
    const fake = runFrames(createPhysarumRenderer(), PHYSARUM, {
      fps: 60,
      width: 390,
      height: 844,
      from: 0,
      until: 0.1,
    });
    const { tx, ty, ratio } = texelShape(fake.uniforms.get('uTexel'), 390, 844);
    // Within the rounding of the sides to whole cells; the square grid's
    // texels were 2.2x as tall as wide here.
    expect(Math.abs(ratio - 1)).toBeLessThan(0.15);
    expect(tx).not.toBe(ty);
  });

  it('opens on a grown network: 120 steps run before the first frame shows', () => {
    const fake = firstFrame(createPhysarumRenderer(), PHYSARUM);
    // The old first frame ran 2 steps over per-texel speckle.
    expect(uploads(fake, 'uStep')).toBeGreaterThanOrEqual(121);
    expect(fake.counts.screen).toBe(1);
  });
});

describe('lenia: the step clock, round creatures, grown under its own rules', () => {
  const draws = (fps: number, audio = false) =>
    runFrames(createLeniaRenderer(), LENIA, { fps, audio }).counts.sim;

  it('runs speed x 60 steps a second at 60 and at 120 Hz, idle and with sound', () => {
    // It ran `speed` substeps a FRAME: twice the speed at 120 Hz.
    expect(draws(60)).toBe(720);
    near(draws(120), draws(60));
    near(draws(120, true), draws(60, true));
  });

  it('lays one 5-step burst per click at any frame rate (it queued one a frame)', () => {
    for (const fps of [60, 120]) {
      // A tap: no hover, so every step that touches the field is the burst.
      const burst = (clickAt?: number) =>
        uploads(
          runFrames(createLeniaRenderer(), LENIA, {
            fps,
            clickAt,
            pointer: { x: 0.5, y: 0.5, active: false },
          }),
          'uMouseActive',
          (v) => v === 1
        );
      expect(burst(), `${fps} Hz`).toBe(0);
      expect(burst(2), `${fps} Hz`).toBe(5);
    }
  });

  it('keeps creatures round on a phone, at about a 256² texel budget', () => {
    const fake = runFrames(createLeniaRenderer(), LENIA, {
      fps: 60,
      width: 390,
      height: 844,
      from: 0,
      until: 0.1,
    });
    const { tx, ty, ratio } = texelShape(fake.uniforms.get('uTexel'), 390, 844);
    expect(Math.abs(ratio - 1)).toBeLessThan(0.15);
    expect(tx).not.toBe(ty);
    const texels = 1 / tx / ty;
    expect(texels).toBeGreaterThan(256 * 256 * 0.8);
    expect(texels).toBeLessThan(256 * 256 * 1.25);
  });

  it("grows its first frame under the brand's own rules", () => {
    const fake = firstFrame(createLeniaRenderer(), LENIA);
    const radii = fake.log
      .filter((u) => u.name === 'uRadius')
      .map((u) => u.value);
    // 50 warm-up steps and the frame's own; the old warm-up ran radius 13
    // whatever the brand chose, before the first frame.
    expect(radii.length).toBeGreaterThanOrEqual(51);
    expect(new Set(radii)).toEqual(new Set([17]));
  });
});

describe('aurora: curtains a phone can see', () => {
  it('measures the folds across the width, never narrower than FOLD_ASPECT', () => {
    const code = AURORA_FRAG.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /\/\/.*$/gm,
      ''
    );
    // Measured in heights, a 390x844 phone showed a tenth of one fold.
    expect(code).toMatch(/const float FOLD_ASPECT = 1\.4;/);
    expect(code).toMatch(/float xw = uv\.x \* max\(aspect, FOLD_ASPECT\);/);
    expect(code).toMatch(/float arg = xw \* freq/);
  });
});

describe("what a brand that stored nothing paints: the lab's tuning", () => {
  function config(preset: string) {
    const el = document.createElement('div');
    el.className = 'org-layout';
    el.style.setProperty('--brand-shader-preset', preset);
    document.body.appendChild(el);
    return getShaderConfig(el);
  }

  it('lenia: radius 15, growth 0.2, width 0.05, speed 4, dt 0.5, intensity 1.6', () => {
    expect(config('lenia')).toMatchObject({
      radius: 15,
      growth: 0.2,
      width: 0.05,
      speed: 4,
      dt: 0.5,
      intensity: 1.6,
    });
  });

  it('aurora: intensity 1.0; physarum keeps the base 0.65', () => {
    expect(config('aurora')).toMatchObject({ intensity: 1 });
    expect(fxDefaultsFor('aurora').intensity).toBe(1);
    expect(config('physarum')).toMatchObject({ intensity: 0.65 });
  });
});

describe('a zero dt, a slow frame, float positions and a rotate', () => {
  // The musical clock divided by the step clock's dt, which is 0 when two
  // frames share a timestamp (Firefox resistFingerprinting coarsens
  // performance.now): NaN, and the pulse went black for the session.
  it.each([
    ['lenia', createLeniaRenderer, LENIA],
    ['physarum', createPhysarumRenderer, PHYSARUM],
  ] as const)('%s: uClock stays finite when two frames share a timestamp, with sound', (_name, make, config) => {
    const fake = fakeGl();
    const renderer = make();
    expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
    const mouse = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };
    for (const t of [1, 1 + 1 / 60, 1 + 2 / 60, 1 + 2 / 60, 1 + 3 / 60]) {
      renderer.render(fake.gl, t, mouse, config, 1440, 900, audioAt(t));
    }
    expect(Number.isFinite(fake.uniforms.get('uClock') as number)).toBe(true);
  });

  // A slow frame catches up to 2 x the steps a frame, and never fewer than 4,
  // so iOS Low Power (30 fps) keeps full speed at speed 4; the cap of 4 ran it
  // at half. And speed 1 at 20 fps owes 3 steps a frame, where a cap of 2 x 1
  // ran 2.
  it.each([
    { speed: 4, fps: 30, steps: 720 },
    { speed: 1, fps: 20, steps: 180 },
  ])('lenia keeps speed x 60 steps a second: speed $speed at $fps fps', ({
    speed,
    fps,
    steps,
  }) => {
    expect(
      runFrames(createLeniaRenderer(), { ...LENIA, speed }, { fps }).counts.sim
    ).toBe(steps);
  });

  // The agents are 32-bit float positions: read at high precision (ESSL3's
  // default sampler2D precision is lowp).
  it('reads the agent texture through a highp sampler wherever it is sampled', () => {
    for (const src of [PHYSARUM_DEPOSIT_VERT, PHYSARUM_AGENT_FRAG]) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).toMatch(/precision highp sampler2D;/);
    }
  });

  // A rotate (a real change of shape) keeps the agents and rebuilds only the
  // trail with a short regrow; it re-ran all 120 warm-up steps.
  it('physarum regrows briefly after a rotate, keeping its agents', () => {
    const fake = fakeGl(1440, 900);
    const renderer = createPhysarumRenderer();
    expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
    const mouse = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };
    for (let i = 0; i < 3; i++) {
      renderer.render(fake.gl, i / 60, mouse, PHYSARUM, 1440, 900);
    }
    renderer.resize(fake.gl, 390, 844);
    fake.log.length = 0;
    renderer.render(fake.gl, 3 / 60, mouse, PHYSARUM, 390, 844);
    expect(uploads(fake, 'uSeed')).toBe(0);
    const steps = uploads(fake, 'uStep');
    expect(steps).toBeGreaterThan(1);
    expect(steps).toBeLessThanOrEqual(30);
  });

  // Round 2 MEDIUM. The kept agents kept their uv places, so a rotate
  // stretched the network: a round cell on a 390x844 phone came back 4.7x
  // wider than tall at 844x390. They now keep their pixel offsets from the
  // centre (PHYSARUM_REMAP_FRAG), before the first frame at the new size.
  describe('physarum rotate keeps the cells round', () => {
    type Pt = [number, number];
    const fract = (v: number) => v - Math.floor(v);

    /** PHYSARUM_REMAP_FRAG's arithmetic, line for line (checked below). */
    function remap([x, y]: Pt, [sx, sy]: Pt): Pt {
      const px = 0.5 + (x - 0.5) * sx;
      const py = 0.5 + (y - 0.5) * sy;
      const offX = Math.abs(px * 2 - 1) >= 1 ? 1 : 0;
      const offY = Math.abs(py * 2 - 1) >= 1 ? 1 : 0;
      return [fract(px + offY * 0.5), fract(py + offX * 0.5)];
    }

    /** A ring `r` px round on a w x h canvas, centred at `c` (uv). */
    function ring(c: Pt, r: number, w: number, h: number): Pt[] {
      return Array.from({ length: 64 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return [c[0] + (r * Math.cos(a)) / w, c[1] + (r * Math.sin(a)) / h];
      });
    }

    /** Pixel width over pixel height of the points' box on a w x h canvas. */
    function aspect(points: Pt[], w: number, h: number): number {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const across = (Math.max(...xs) - Math.min(...xs)) * w;
      const down = (Math.max(...ys) - Math.min(...ys)) * h;
      return across / down;
    }

    /** The uScale the rotate sent before its first frame; [1, 1] if none. */
    function rotateScale(): Pt {
      const fake = fakeGl(390, 844);
      const renderer = createPhysarumRenderer();
      expect(renderer.init(fake.gl, 390, 844)).toBe(true);
      const mouse = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };
      for (let i = 0; i < 3; i++) {
        renderer.render(fake.gl, i / 60, mouse, PHYSARUM, 390, 844);
      }
      fake.log.length = 0;
      renderer.resize(fake.gl, 844, 390);
      renderer.render(fake.gl, 3 / 60, mouse, PHYSARUM, 844, 390);
      const at = fake.log.findIndex((u) => u.name === 'uScale');
      const firstStep = fake.log.findIndex((u) => u.name === 'uStep');
      if (at < 0) return [1, 1];
      expect(at).toBeLessThan(firstStep);
      return fake.log[at]?.value as Pt;
    }

    it.each([
      { where: 'mid-canvas', c: [0.5, 0.5] as Pt },
      // 321 px above the centre: off the 390 px tall landscape canvas, so it
      // wraps and lands in a side band the narrower width left empty.
      { where: 'off the new canvas', c: [0.3, 0.12] as Pt },
    ])('a ring $where stays round within 15% and on the canvas', ({ c }) => {
      const scale = rotateScale();
      const after = ring(c, 50, 390, 844).map((p) => remap(p, scale));
      expect(Math.abs(aspect(after, 844, 390) - 1)).toBeLessThan(0.15);
      for (const [x, y] of after) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(1);
      }
    });

    it('sends the old canvas size over the new, per axis', () => {
      const [sx, sy] = rotateScale();
      expect(sx).toBeCloseTo(390 / 844, 6);
      expect(sy).toBeCloseTo(844 / 390, 6);
    });

    // Round 3 LOW. A same-shape resize keeps the grid but scales the agents'
    // uv places with the canvas, so the next rotate must remap from THAT
    // size: from 720x450, not from the 1440x900 the grid was built for
    // (which sent twice the scale, [3.2, 1.25]).
    it('remaps from the last canvas, not the one the grid was built for', () => {
      const fake = fakeGl(1440, 900);
      const renderer = createPhysarumRenderer();
      expect(renderer.init(fake.gl, 1440, 900)).toBe(true);
      const mouse = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };
      renderer.render(fake.gl, 0, mouse, PHYSARUM, 1440, 900);
      fake.log.length = 0;
      renderer.resize(fake.gl, 720, 450);
      renderer.render(fake.gl, 1 / 60, mouse, PHYSARUM, 720, 450);
      // Same shape: no rebuild, so no remap.
      expect(uploads(fake, 'uScale')).toBe(0);
      renderer.resize(fake.gl, 450, 720);
      const scale = fake.log.find((u) => u.name === 'uScale')?.value as
        | [number, number]
        | undefined;
      expect(scale?.[0]).toBeCloseTo(720 / 450, 6);
      expect(scale?.[1]).toBeCloseTo(450 / 720, 6);
    });

    it('mirrors the remap shader, comments stripped', () => {
      const code = PHYSARUM_REMAP_FRAG.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/\s+/g, ' ');
      expect(code).toContain('vec2 pos = 0.5 + (agent.xy - 0.5) * uScale;');
      expect(code).toContain('vec2 off = step(1.0, abs(pos * 2.0 - 1.0));');
      expect(code).toContain('pos = fract(pos + off.yx * 0.5);');
      expect(code).toContain('fragColor = vec4(pos, agent.zw);');
    });
  });
});
