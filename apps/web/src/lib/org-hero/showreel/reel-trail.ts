/**
 * The pointer's trail over the reel, for the pointer effects
 * (`pointer-liquid.ts`, `pointer-smoke.ts`): where the pointer has been in the
 * last two seconds, packed into `u_trail` each frame.
 *
 * Points are in output uv, origin bottom left, like `u_pointer`. A point is
 * laid only once the pointer has moved a step from the last one, so a resting
 * pointer adds nothing. On a phone a touch counts only once its gesture is
 * sideways (`SwipeGate`): a vertical swipe stays the page's scroll.
 *
 * SMOKE WITH INERTIA: one soft continuous field that drifts on after the
 * pointer stops. The smoke carries the pointer's velocity. Each puff keeps the
 * velocity it was laid with, and so does the smoke's head after the last move.
 * That velocity dies away exponentially (`DRIFT_MS`), so a puff `age` ms old
 * has moved `v * DRIFT_MS * (1 - e^(-age / DRIFT_MS))`: fast at first, slowing,
 * never further than `v * DRIFT_MS`. The puffs and the head follow the same
 * law, so the trail moves on as one field when the pointer stops or leaves, and
 * the head stays at its front. Liquid keeps its rings where they were laid: its
 * motion is the ripple's.
 *
 * Under reduced motion (`motion = 'still'`) the smoke is static: it sits
 * where the pointer has been, with no drift, no rise and no spread, and it
 * goes with the pointer. On a phone the sideways swipe drives it, and a flick
 * carries on when the finger lifts.
 */
import { TRAIL_POINTS } from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';

/** How long a point lasts. */
export const TRAIL_LIFE_MS = 2000;
/** How far, in the output's height, the pointer moves before a new point. */
const TRAIL_STEP = 0.012;
/** Points kept on a phone, where every one is a ring or a puff per pixel. */
export const PHONE_TRAIL_POINTS = 12;
/**
 * The e-folding time of the smoke's carried velocity. A smoke thrown at `v`
 * drifts `v * DRIFT_MS` in all, 63% of it in the first `DRIFT_MS`.
 */
export const DRIFT_MS = 520;
/**
 * The fastest the smoke is carried, in output heights per ms (aspect-true),
 * so a fling cannot whip it across the hero: it drifts at most
 * `MAX_DRIFT_SPEED * DRIFT_MS` (0.62 of the height) after the pointer stops.
 */
export const MAX_DRIFT_SPEED = 0.0012;
/** How fast the smoke's head fades once the pointer has gone. */
export const HEAD_FADE_MS = 900;
/** The pointer's speed is smoothed over about this long. */
const SMOOTH_MS = 50;
/** The smoke's head: as thick as the trail gets, and its radius. */
const HEAD_STRENGTH = 1.03;
const HEAD_RADIUS = 0.12;

export type TrailStyle = 'liquid' | 'smoke';
/** `still`: reduced motion. The smoke sits where it was laid. */
export type TrailMotion = 'drift' | 'still';

type Vec2 = readonly [number, number];

interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  /** The velocity the point was laid with, output uv per ms. */
  readonly v: Vec2;
}

const STILL: Vec2 = [0, 0];

/** How far a velocity `v` carries something in `ms`, as it dies away. */
function carried(v: Vec2, ms: number): Vec2 {
  const k = DRIFT_MS * (1 - Math.exp(-Math.max(0, ms) / DRIFT_MS));
  return [v[0] * k, v[1] * k];
}

export class PointerTrail {
  #points: TrailPoint[] = [];
  #pointer: Vec2 | null = null;
  /** Points kept: one fewer than the slots, the first slot being the pointer's. */
  readonly #keep: number;
  /** The last move, and the smoke's velocity there. */
  #last: { readonly at: Vec2; readonly t: number; readonly v: Vec2 } | null =
    null;
  /** When the pointer left, the smoke's head drifting on; null while over. */
  #leftAt: number | null = null;
  /** A move after a leave starts a new gesture: no speed from the jump. */
  #gesture = false;
  /** `still` under reduced motion: no drift, no rise, no spread. */
  motion: TrailMotion = 'drift';

  constructor(slots: number = TRAIL_POINTS) {
    this.#keep = Math.max(0, Math.min(slots, TRAIL_POINTS) - 1);
  }

  /** The pointer over the reel, or null. */
  get pointer(): Vec2 | null {
    return this.#pointer;
  }

  /** The smoke's carried velocity at the last move, output uv per ms. */
  get velocity(): Vec2 {
    return this.#last?.v ?? STILL;
  }

  /** The pointer moved to (x, y) at `t` ms; `aspect` is width / height. */
  move(x: number, y: number, t: number, aspect: number): void {
    const v = this.#gesture ? this.#velocityTo(x, y, t, aspect) : STILL;
    this.#pointer = [x, y];
    this.#leftAt = null;
    this.#gesture = true;
    this.#last = { at: [x, y], t, v };
    const laid = this.#points.at(-1);
    if (laid && Math.hypot((x - laid.x) * aspect, y - laid.y) <= TRAIL_STEP)
      return;
    this.#points.push({ x, y, t, v });
    if (this.#points.length > this.#keep)
      this.#points.splice(0, this.#points.length - this.#keep);
  }

  /** The pointer left the reel (or a touch ended) at `t`: its trail drifts on and fades. */
  leave(t: number): void {
    if (this.#pointer !== null) this.#leftAt = t;
    this.#pointer = null;
    this.#gesture = false;
  }

  /** Forget the trail (a new layout, or the reel going away). */
  clear(): void {
    this.#points = [];
    this.#pointer = null;
    this.#last = null;
    this.#leftAt = null;
    this.#gesture = false;
  }

  /**
   * Whether the trail still changes at `now`: points to fade, or a head
   * drifting or fading. False once it has come to rest, so the reel's motion
   * loop can stop.
   */
  active(now: number): boolean {
    this.#expire(now);
    if (this.#points.length > 0) return true;
    if (this.motion === 'still' || !this.#last) return false;
    if (this.#leftAt !== null) return now - this.#leftAt < TRAIL_LIFE_MS;
    const [vx, vy] = this.#last.v;
    return (vx !== 0 || vy !== 0) && now - this.#last.t < DRIFT_MS * 6;
  }

  /**
   * The trail at `now`, written into `out` (`TRAIL_POINTS` × 4 floats: x, y,
   * strength, radius) for `style`; every other slot is zero. Liquid sends a
   * widening ring out from each point. Smoke is a puff that drifts on with
   * the velocity it was laid with, and rises and spreads; its head, slot 0,
   * is the thickest, and drifts on and fades once the pointer has gone.
   * Returns `out`.
   */
  pack(now: number, style: TrailStyle, out: Float32Array): Float32Array {
    out.fill(0);
    this.#expire(now);
    const smoke = style === 'smoke';
    const drifts = smoke && this.motion === 'drift';
    if (smoke) this.#packHead(now, drifts, out);
    let o = 4;
    for (const p of this.#points) {
      const age = Math.max(0, now - p.t);
      const fade = Math.exp(-age / 900);
      const [dx, dy] = drifts ? carried(p.v, age) : STILL;
      out[o] = p.x + dx;
      out[o + 1] = p.y + dy + (drifts ? age * 0.00004 : 0);
      out[o + 2] = fade * (smoke ? 1.15 : 0.9);
      out[o + 3] = smoke
        ? (0.09 + (drifts ? age * 0.00006 : 0)) * 1.1
        : 0.012 + age * 0.00032;
      o += 4;
    }
    return out;
  }

  /** The smoke's head into slot 0: at the pointer, carried on by its speed. */
  #packHead(now: number, drifts: boolean, out: Float32Array): void {
    const last = this.#last;
    let at: Vec2;
    let strength = HEAD_STRENGTH;
    if (this.#pointer) {
      if (!drifts || !last) at = this.#pointer;
      else {
        const [dx, dy] = carried(last.v, now - last.t);
        at = [last.at[0] + dx, last.at[1] + dy];
      }
    } else {
      // Gone: under reduced motion the smoke goes with it; otherwise it
      // drifts on from the last move and fades.
      const left = this.#leftAt;
      if (!drifts || !last || left === null) return;
      const since = now - left;
      if (since >= TRAIL_LIFE_MS) return;
      const [dx, dy] = carried(last.v, now - last.t);
      at = [last.at[0] + dx, last.at[1] + dy];
      strength *= Math.exp(-Math.max(0, since) / HEAD_FADE_MS);
    }
    out[0] = at[0];
    out[1] = at[1];
    out[2] = strength;
    out[3] = HEAD_RADIUS;
  }

  /**
   * The smoke's velocity at a move to (x, y) at `t`: the last one, died away
   * over the gap, eased toward the move's own, then clamped (aspect-true).
   */
  #velocityTo(x: number, y: number, t: number, aspect: number): Vec2 {
    const last = this.#last;
    if (!last) return STILL;
    const dt = t - last.t;
    if (dt <= 0) return last.v;
    const decay = Math.exp(-dt / DRIFT_MS);
    const old: Vec2 = [last.v[0] * decay, last.v[1] * decay];
    const seen: Vec2 = [(x - last.at[0]) / dt, (y - last.at[1]) / dt];
    const w = 1 - Math.exp(-dt / SMOOTH_MS);
    let vx = old[0] + (seen[0] - old[0]) * w;
    let vy = old[1] + (seen[1] - old[1]) * w;
    const speed = Math.hypot(vx * aspect, vy);
    if (speed > MAX_DRIFT_SPEED) {
      vx *= MAX_DRIFT_SPEED / speed;
      vy *= MAX_DRIFT_SPEED / speed;
    }
    return [vx, vy];
  }

  /** Drop the points older than their life: laid in time order, they lead. */
  #expire(now: number): void {
    const live = this.#points.findIndex((p) => now - p.t < TRAIL_LIFE_MS);
    if (live === -1) this.#points.length = 0;
    else if (live > 0) this.#points.splice(0, live);
  }
}

/** How far, in CSS px, a touch moves before its gesture counts as one way. */
const DECIDE_PX = 10;

/**
 * Whether a touch gesture drives the pointer effect: only once it has gone
 * sideways. Undecided until it moves `DECIDE_PX`; then sideways for the rest
 * of the gesture, or never.
 */
export class SwipeGate {
  #start: readonly [number, number] | null = null;
  #sideways: boolean | null = null;

  /** A touch went down at (x, y), CSS px. */
  down(x: number, y: number): void {
    this.#start = [x, y];
    this.#sideways = null;
  }

  /** The touch moved to (x, y): true when this move drives the effect. */
  move(x: number, y: number): boolean {
    const start = this.#start;
    if (!start) return false;
    if (this.#sideways === null) {
      const dx = x - start[0];
      const dy = y - start[1];
      if (Math.hypot(dx, dy) < DECIDE_PX) return false;
      this.#sideways = Math.abs(dx) > Math.abs(dy);
    }
    return this.#sideways;
  }

  /** The touch ended or was cancelled. */
  up(): void {
    this.#start = null;
    this.#sideways = null;
  }
}
