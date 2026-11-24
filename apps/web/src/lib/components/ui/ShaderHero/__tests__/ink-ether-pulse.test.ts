import { afterEach, describe, expect, it, vi } from 'vitest';
import { fxDefaultsFor } from '../preset-fx-defaults';
import type { MouseState } from '../renderer-types';
import { createEtherRenderer } from '../renderers/ether-renderer';
import { createInkRenderer } from '../renderers/ink-renderer';
import { createPulseRenderer } from '../renderers/pulse-renderer';
import {
  type EtherConfig,
  getShaderConfig,
  type InkConfig,
  type PulseConfig,
} from '../shader-config';
import { PULSE_DISPLAY_FRAG } from '../shaders/pulse-display.frag';
import { PULSE_SIM_FRAG } from '../shaders/pulse-sim.frag';
import { fakeGl, seededRandom } from './fake-gl';
import { BASE, near, runFrames, uploads } from './renderer-run';

/**
 * Ink on the step clock with a seeded start, ether's rotation integrated on the
 * CPU, Liquid Logo (id 'pulse') still until touched, and the lab's tuning as
 * the defaults a brand that stored nothing paints.
 */

const INK = {
  ...BASE,
  preset: 'ink',
  diffusion: 1.5,
  advection: 0.8,
  dropSize: 0.05,
  evaporation: 0.997,
  curl: 15,
} satisfies InkConfig;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

interface InkRun {
  fps: number;
  audio?: boolean;
  clickAt?: number;
}

/** Ink's simulation draws from t = 1 s (seed and warm-up paid) to t = 4 s. */
function inkDraws({ fps, audio = false, clickAt }: InkRun): number {
  return runFrames(createInkRenderer(), INK, {
    fps,
    audio,
    clickAt,
    pointer: { x: 0.5, y: 0.5, active: true },
  }).counts.sim;
}

describe('ink: steps follow time, not frames', () => {
  it('runs as many steps at 120 Hz as at 60 Hz, idle and with audio', () => {
    // Measured before the port, steps a second at 60 / 120 Hz: idle 120 /
    // 240, with audio 444 / 888.
    near(inkDraws({ fps: 120 }), inkDraws({ fps: 60 }));
    near(
      inkDraws({ fps: 120, audio: true }),
      inkDraws({ fps: 60, audio: true })
    );
    expect(inkDraws({ fps: 60 })).toBe(360);
  });

  it('runs one 5-step burst per click at any frame rate (it queued one a frame: 145 / 285 extra steps)', () => {
    for (const fps of [60, 120]) {
      expect(inkDraws({ fps, clickAt: 2 }) - inkDraws({ fps })).toBe(5);
    }
  });

  it('starts seeded and warmed, and an idle trail keeps laying ink with no audio and no pointer', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom());
    const { gl, counts, log } = fakeGl();
    const renderer = createInkRenderer();
    expect(renderer.init(gl, 1440, 900)).toBe(true);
    const away: MouseState = {
      x: 0.5,
      y: 0.5,
      active: false,
      burstStrength: 0,
    };
    renderer.render(gl, 0, away, INK, 1440, 900);
    // 9 seed drops and 90 warm-up steps before the frame's own step: the
    // first frame (a reduced-motion still) shows blooming ink, not water.
    expect(counts.sim).toBeGreaterThanOrEqual(99);

    log.length = 0;
    for (let i = 1; i <= 60; i++)
      renderer.render(gl, i / 60, away, INK, 1440, 900);
    const deposits = log.filter(
      (u) => u.name === 'uMouseActive' && u.value === 1.0
    ).length;
    // Every input step (60 a second) lays the idle trail.
    expect(deposits).toBe(60);
  });

  it('draws round drops: the grid has the canvas shape', () => {
    const { gl, uniforms } = fakeGl();
    const renderer = createInkRenderer();
    renderer.init(gl, 1440, 900);
    const off: MouseState = { x: 0, y: 0, active: false, burstStrength: 0 };
    renderer.render(gl, 0, off, INK, 1440, 900);
    const [tx, ty] = uniforms.get('uTexel') as [number, number];
    // Texels per canvas pixel, across and down: equal within a cell's rounding.
    expect((1 / tx / 1440) * 900 * ty).toBeCloseTo(1, 1);
    expect(tx).not.toBe(ty);
  });
});

describe('ether: the rotation follows the speed it has, never time x a new speed', () => {
  const ETHER = {
    ...BASE,
    preset: 'ether',
    rotationSpeed: 0.9,
    complexity: 8,
    zoom: 5.5,
    glow: 1.5,
    scale: 4,
    aberration: 0.02,
  } satisfies EtherConfig;

  it('integrates the speed on the CPU, so a slider change after a minute moves it by one frame', () => {
    const { gl, uniforms } = fakeGl();
    const renderer = createEtherRenderer();
    renderer.init(gl, 1440, 900);
    const mouse: MouseState = {
      x: 0.5,
      y: 0.5,
      active: false,
      burstStrength: 0,
    };
    let t = 0;
    for (let i = 1; i <= 3600; i++) {
      t = i / 60;
      renderer.render(gl, t, mouse, ETHER, 1440, 900);
    }
    const before = uniforms.get('u_phase') as number;
    expect(before).toBeCloseTo(60 * 0.9, 6);

    renderer.render(
      gl,
      t + 1 / 60,
      mouse,
      { ...ETHER, rotationSpeed: 0.2 },
      1440,
      900
    );
    const after = uniforms.get('u_phase') as number;
    // time x speed would have jumped by 60 s x 0.7 = 42 radians.
    expect(after - before).toBeCloseTo(0.2 / 60, 9);
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

  it('topo: 27 lines, 5 octaves, elevation 2.8, speed 0.4; intensity stays the base 0.65', () => {
    expect(config('topo')).toMatchObject({
      lineCount: 27,
      lineWidth: 1,
      speed: 0.4,
      scale: 2.5,
      elevation: 2.8,
      octaves: 5,
      // An intensity of 2.25 failed the contrast check (OBB white text 3.6).
      intensity: 0.65,
    });
  });

  it('ether: their look, colour split at 0.02 included, with grain 0.07 and vignette 0.3', () => {
    expect(config('ether')).toMatchObject({
      rotationSpeed: 0.9,
      complexity: 8,
      zoom: 5.5,
      glow: 1.5,
      scale: 4,
      aberration: 0.02,
      intensity: 0.65,
      grain: 0.07,
      vignette: 0.3,
    });
    expect(fxDefaultsFor('ether')).toEqual({
      intensity: 0.65,
      grain: 0.07,
      vignette: 0.3,
    });
  });
});

const PULSE = {
  ...BASE,
  preset: 'pulse',
  damping: 0.98,
  waveScale: 4,
  camHeight: 27,
  camTarget: -5,
  specular: 1,
  impulseSize: 0.04,
} satisfies PulseConfig;

interface PulseRun {
  fps: number;
  /** The pointer over the water, at (0.5, 0.4): on the plane at this camera. */
  pointer?: boolean;
  audio?: boolean;
  clickAt?: number;
  /** The run counts from t = 1 s to this. */
  until?: number;
}

/** Liquid Logo's simulation draws and pointer deposits, from t = 1 s. */
function pulseRun({
  fps,
  pointer = false,
  audio = false,
  clickAt,
  until = 4,
}: PulseRun) {
  const fake = runFrames(createPulseRenderer(), PULSE, {
    fps,
    audio,
    clickAt,
    until,
    pointer: { x: 0.5, y: 0.4, active: pointer },
  });
  return {
    draws: fake.counts.sim,
    deposits: uploads(fake, 'uMouseActive', (v) => v === 1.0),
    uniforms: fake.uniforms,
  };
}

/** A shader's declared uniforms, comments stripped first. */
function declaredUniforms(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...code.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
}

describe('Liquid Logo (pulse): still until touched', () => {
  it('lays nothing in 10 s with no pointer and no sound, at 60 and 120 Hz; the pointer lays 60 a second', () => {
    for (const fps of [60, 120]) {
      const still = pulseRun({ fps, until: 11 });
      // An idle drop every 1.5 s or so would be the self-pulse.
      expect(still.deposits, `${fps} Hz`).toBe(0);
      // The water still steps (the clock runs): it has nothing to move it.
      expect(still.draws, `${fps} Hz`).toBe(1200);
      // The control: the same run with the pointer over the water.
      expect(pulseRun({ fps, pointer: true }).deposits, `${fps} Hz`).toBe(180);
    }
  });

  it('reads no time and no logo in the simulation, so nothing but input can move it', () => {
    // The logo attractor pushed sin(uTime ...) along the logo's edge on
    // every step. The sim's inputs are now its state, the pointer and sound.
    expect(declaredUniforms(PULSE_SIM_FRAG).sort()).toEqual(
      [
        'uState',
        'uTexel',
        'uDamping',
        'uImpulseSize',
        'uMouse',
        'uMouseActive',
        'uMouseStrength',
        'u_audioActive',
        'u_bass',
        'u_mids',
        'u_treble',
        'u_level',
        'u_beatPulse',
        'u_energy',
        'u_flux',
        'u_centroid',
        'u_beatPhase',
        'u_beatSeed',
      ].sort()
    );
  });

  it('runs as many steps at 120 Hz as at 60 Hz: idle, with the pointer, and with sound', () => {
    expect(pulseRun({ fps: 60 }).draws).toBe(360);
    near(pulseRun({ fps: 120 }).draws, pulseRun({ fps: 60 }).draws);
    near(
      pulseRun({ fps: 120, pointer: true }).draws,
      pulseRun({ fps: 60, pointer: true }).draws
    );
    near(
      pulseRun({ fps: 120, audio: true }).draws,
      pulseRun({ fps: 60, audio: true }).draws
    );
  });

  it('runs one 6-step splash per click at any frame rate', () => {
    for (const fps of [60, 120]) {
      const plain = pulseRun({ fps, pointer: true }).draws;
      expect(
        pulseRun({ fps, pointer: true, clickAt: 2 }).draws - plain,
        `${fps} Hz`
      ).toBe(6);
    }
  });

  it('paints a plain surface with no logo: no relief is raised', () => {
    const { uniforms } = pulseRun({ fps: 60, until: 1.5 });
    expect(uniforms.get('uHasLogo')).toBe(0);
    // The relief is the logo mask x its height, and the mask is 0 with no logo.
    const code = PULSE_DISPLAY_FRAG.replace(/\/\/.*$/gm, '');
    expect(code).toMatch(
      /float logoMask\(vec3 p\) \{\s*if \(uHasLogo < 0\.5\) return 0\.0;/
    );
    expect(code).toMatch(/waves\(p\) \+ uLogoHeight \* logoMask\(p\)/);
  });
});
