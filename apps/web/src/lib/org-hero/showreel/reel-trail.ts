/**
 * The pointer's trail over the reel (Codex-1yd58.7), for the pointer
 * effects (`pointer-liquid.ts`, `pointer-smoke.ts`): where the pointer has
 * been in the last two seconds, packed into `u_trail` each frame.
 *
 * Points are in output uv, origin bottom left, like `u_pointer`. A point is
 * laid only once the pointer has moved a step from the last one, so a
 * resting pointer adds nothing. On a phone a touch counts only once its
 * gesture is sideways (`SwipeGate`, plan §4): a vertical swipe stays the
 * page's scroll.
 */
import { TRAIL_POINTS } from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';

/** How long a point lasts. */
export const TRAIL_LIFE_MS = 2000;
/** How far, in the output's height, the pointer moves before a new point. */
export const TRAIL_STEP = 0.012;
/** Points kept on a phone, where every one is a ring or a puff per pixel. */
export const PHONE_TRAIL_POINTS = 12;

export type TrailStyle = 'liquid' | 'smoke';

interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

export class PointerTrail {
  #points: TrailPoint[] = [];
  #pointer: readonly [number, number] | null = null;
  /** Points kept: one fewer than the slots, the first slot being the pointer's. */
  readonly #keep: number;

  constructor(slots: number = TRAIL_POINTS) {
    this.#keep = Math.max(0, Math.min(slots, TRAIL_POINTS) - 1);
  }

  /** The pointer over the reel, or null. */
  get pointer(): readonly [number, number] | null {
    return this.#pointer;
  }

  /** The pointer moved to (x, y) at `t` ms; `aspect` is width / height. */
  move(x: number, y: number, t: number, aspect: number): void {
    this.#pointer = [x, y];
    const last = this.#points.at(-1);
    if (last && Math.hypot((x - last.x) * aspect, y - last.y) <= TRAIL_STEP)
      return;
    this.#points.push({ x, y, t });
    if (this.#points.length > this.#keep)
      this.#points.splice(0, this.#points.length - this.#keep);
  }

  /** The pointer left the reel (or a touch ended): its trail fades on. */
  leave(): void {
    this.#pointer = null;
  }

  /** Forget the trail (a new layout, or the reel going away). */
  clear(): void {
    this.#points = [];
    this.#pointer = null;
  }

  /**
   * The trail at `now`, written into `out` (`TRAIL_POINTS` × 4 floats: x, y,
   * strength, radius) for `style`; every other slot is zero. Liquid sends a
   * widening ring out from each point; smoke is a puff that rises and
   * spreads, with the pointer itself the thickest. Returns `out`.
   */
  /** Drop the points older than their life: laid in time order, they lead. */
  #expire(now: number): void {
    const live = this.#points.findIndex((p) => now - p.t < TRAIL_LIFE_MS);
    if (live === -1) this.#points.length = 0;
    else if (live > 0) this.#points.splice(0, live);
  }

  pack(now: number, style: TrailStyle, out: Float32Array): Float32Array {
    out.fill(0);
    this.#expire(now);
    const pointer = this.#pointer;
    if (style === 'smoke' && pointer) {
      out[0] = pointer[0];
      out[1] = pointer[1];
      out[2] = 1.03;
      out[3] = 0.12;
    }
    const smoke = style === 'smoke';
    let o = 4;
    for (const p of this.#points) {
      const age = Math.max(0, now - p.t);
      const fade = Math.exp(-age / 900);
      out[o] = p.x;
      out[o + 1] = smoke ? p.y + age * 0.00004 : p.y;
      out[o + 2] = fade * (smoke ? 1.15 : 0.9);
      out[o + 3] = smoke ? (0.09 + age * 0.00006) * 1.1 : 0.012 + age * 0.00032;
      o += 4;
    }
    return out;
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
