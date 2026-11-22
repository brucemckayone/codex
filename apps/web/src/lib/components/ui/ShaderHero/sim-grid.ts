/**
 * Shared helpers for the FBO-simulated presets (flow, suture, ripple, and the
 * reworks that follow them).
 *
 * WHY THIS EXISTS (the shader lab's audit)
 * ----------------------------------------
 * 1. SHAPE. Every simulated preset ran a square 512x512 grid and stretched it
 *    over the canvas, so on a 16:9 hero every feature was ~1.8x wide and on a
 *    phone ~2x tall: ripples drew as ellipses, smoke as smears. `simGridFor`
 *    gives the grid the canvas's shape at the same texel budget, so a texel is
 *    square on screen and the simulation costs what it did.
 * 2. SPEED. Each preset ran a fixed number of steps per frame, so a 120 Hz
 *    display ran it twice as fast as a 60 Hz one and a 30 fps phone at half
 *    speed. `createStepClock` turns elapsed time into a step count.
 *
 * DEPENDENCY-FREE on purpose: shader modules import `SIM_BASE`, `SIM_CELL` and
 * `PERIODIC_NOISE_GLSL` from here, and `shaders:check` bundles them alone, so
 * GL runtime helpers (which reach the app logger) live in `sim-resize.ts`.
 *
 * Shaders measure distance in texels (`(v_uv - p) / uTexel`), so a brush or
 * drop is round on screen at any shape. A size that was tuned in uv on the
 * old square grid divides by `SIM_BASE` texels instead (ripple's drop), so it
 * keeps exactly the size it always had on a square canvas.
 */

/** The texel budget: a square grid of this side, which every shape matches. */
export const SIM_BASE = 512;

/** Grid sides are multiples of this, so a periodic seed tiles exactly. */
export const SIM_CELL = 64;

/** Shapes past these clamp (a 4:1 banner is the widest a hero gets). */
const MIN_ASPECT = 0.25;
const MAX_ASPECT = 4;

export interface SimGrid {
  readonly w: number;
  readonly h: number;
  /** The (clamped) canvas shape this grid was built for, before rounding. */
  readonly aspect: number;
}

/** Width over height, clamped; 1 for a canvas not laid out yet. */
function canvasAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(Math.max(width / height, MIN_ASPECT), MAX_ASPECT);
}

function roundToCell(n: number, cell: number): number {
  return Math.max(cell, Math.round(n / cell) * cell);
}

/**
 * The simulation grid for a canvas of this size: the canvas's shape, with
 * about `base`² texels (`SIM_BASE`² unless a preset's pass is too costly for
 * it: lenia's 48-tap kernel runs at 256²), each side a multiple of `cell`.
 * `SIM_CELL` (64) lets a periodic seed tile; a preset with no periodic seed
 * can round finer, and a small grid must (lenia, 16: at 256² a 64-texel side
 * is a quarter of the grid, which made ovals of 0.80 to 1.25 on tablets). A
 * zero or missing size (a canvas not laid out yet) gives the square grid.
 */
export function simGridFor(
  width: number,
  height: number,
  base: number = SIM_BASE,
  cell: number = SIM_CELL
): SimGrid {
  const aspect = canvasAspect(width, height);
  const root = Math.sqrt(aspect);
  return {
    w: roundToCell(base * root, cell),
    h: roundToCell(base / root, cell),
    aspect,
  };
}

/**
 * Whether a resize should rebuild the grid. Only a real change of shape
 * does: a phone's address bar showing or hiding moves the height a few
 * percent on every scroll, and rebuilding on that would churn the
 * simulation. It compares canvas shapes, not grids: rounding to whole cells
 * makes neighbouring shapes give different grids (390x844 and 390x800 do).
 */
export function simGridChanged(
  current: SimGrid,
  width: number,
  height: number
): boolean {
  // A canvas collapsing to 0 (a hidden container) is not a new shape.
  if (!(width > 0) || !(height > 0)) return false;
  const ratio = canvasAspect(width, height) / current.aspect;
  return Math.abs(Math.log(ratio)) > Math.log(1.15);
}

/** Longest frame the clock will catch up on (a tab returning from the background). */
const MAX_DT = 0.1;

export interface StepTick {
  /** Simulation steps to run this frame. */
  readonly steps: number;
  /** Index (since creation or reset) of this frame's first step. */
  readonly first: number;
  /** Seconds since the last frame, clamped to [0, 0.1]; 1/60 on the first. */
  readonly dt: number;
}

export interface StepClock {
  /**
   * This frame's step count and frame time. The first call after creation
   * or `reset()` counts as one nominal 60 Hz frame and runs at least one
   * step, so a single frozen frame (reduced motion) still advances. Later
   * frozen redraws at the same `time` run none: they redraw the same field
   * (a sim setting changed while frozen shows at the next reseed).
   */
  tick(time: number): StepTick;
  reset(): void;
}

/**
 * A clock that runs `perSecond` steps a second whatever the frame rate.
 * At 60 Hz, `perSecond = 120` gives 2 steps a frame (what flow and ripple
 * always ran); at 120 Hz it gives 1. `maxPerFrame` caps catch-up after a
 * long frame so one slow frame cannot snowball into a slower one.
 */
export function createStepClock(perSecond: number, maxPerFrame = 4): StepClock {
  let last: number | null = null;
  let carry = 0;
  let total = 0;
  return {
    tick(time: number): StepTick {
      const first = last === null;
      const dt = first ? 1 / 60 : Math.min(Math.max(time - last, 0), MAX_DT);
      last = time;
      carry += dt * perSecond;
      // The epsilon absorbs float error: 1/60 * 120 is 1.9999…, not 2.
      const whole = Math.floor(carry + 1e-6);
      // Whole steps past the cap are dropped, not owed: carrying them would
      // make the next frames slow too. Only the fraction carries over.
      carry = Math.max(carry - whole, 0);
      const capped = Math.min(whole, maxPerFrame);
      const steps = first ? Math.max(capped, 1) : capped;
      const start = total;
      total += steps;
      return { steps, first: start, dt };
    },
    reset(): void {
      last = null;
      carry = 0;
      total = 0;
    },
  };
}

/** Pointer input is applied this many times a second, whatever the step rate. */
export const INPUT_PER_SECOND = 60;

/**
 * Apply pointer input on every `inputStride(perSecond)`-th step. Input on
 * EVERY step would make a 120-steps/s preset push twice as hard as it did at
 * 60 Hz; input on each frame's FIRST step ties strength to frame rate (half
 * as strong at 30 fps, double at 120 Hz for flow). A fixed stride over the
 * step index gives 60 pushes a second at any frame rate, and exactly the
 * old behaviour at 60 Hz.
 */
export function inputStride(perSecond: number): number {
  return Math.max(1, Math.round(perSecond / INPUT_PER_SECOND));
}

/**
 * GLSL for a seed that tiles over the grid: a value noise whose lattice
 * wraps (the simulations wrap at their edges, so a seed that does not tile
 * starts with a seam of false curl). `p` and `period` are in cells. Flow's
 * seed uses it; suture and ripple still seed their own way.
 */
export const PERIODIC_NOISE_GLSL = `
float simHash(vec2 c, float seed) {
  vec3 p3 = fract(vec3(c.xyx + seed) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float periodicNoise(vec2 p, vec2 period, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = simHash(mod(i, period), seed);
  float b = simHash(mod(i + vec2(1.0, 0.0), period), seed);
  float c = simHash(mod(i + vec2(0.0, 1.0), period), seed);
  float d = simHash(mod(i + vec2(1.0, 1.0), period), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;
