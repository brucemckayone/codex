/**
 * The cut between pieces: the piece on show falls away to the brand's picture,
 * the stage swaps to the next piece at the bottom, and that one rises in (the
 * v4 mock's 640 ms ease-in, then 1150 ms ease-out). It drives `u_reveal`; the
 * stage shows `shown`, so one media slot is all a cut needs. Time comes in from
 * outside, so the rules are under test.
 *
 * A cut NEVER turns round half way. A pick during the fall retargets it (the
 * fall goes on and the latest pick swaps in); a pick during the rise waits
 * for the rise to end, and the latest waiting pick wins. So the picture's
 * light falls and rises at most once per full cut, however fast the visitor
 * clicks: what keeps the light leak and the glitch inside WCAG 2.3.1.
 *
 * Both timings take at least 400 ms a cut, under 3 a second, and no two
 * cuts START closer than `MIN_CUT_GAP_MS`: that binds only a cut started
 * right after a `jump()` cut the last one short (a pick while paused).
 */
import { easeIn, easeOut, through } from './reel-ease';

export interface CutTiming {
  /** The fall, the piece on show giving way. */
  readonly outMs: number;
  /** The rise, the next piece coming in. */
  readonly inMs: number;
}

export const CUT_TIMING: CutTiming = { outMs: 640, inMs: 1150 };
/**
 * Under reduced motion: a short fade through the brand's picture, 400 ms in
 * all, so even back to back it dips at most 2.5 times a second (WCAG 2.3.1).
 */
export const REDUCED_CUT_TIMING: CutTiming = { outMs: 200, inMs: 200 };
/** The least time between two cuts' starts: 3 a second at most (WCAG 2.3.1). */
export const MIN_CUT_GAP_MS = 1000 / 3;

/**
 * The longest a cut waits at its bottom, closed, for the next piece to be
 * ready (`RevealClock.ready`): a phone decodes a picture late, and iOS gives
 * a video no frame before it plays, so the rise opened onto nothing, then
 * the picture snapped in (the owner's testing, 2026-11-23). A piece never
 * ready (a video the browser refuses, a picture that fails) opens anyway.
 */
export const SETTLE_MAX_MS = 1500;

type Phase =
  | { readonly kind: 'rest' }
  | { readonly kind: 'out'; readonly from: number; readonly timing: CutTiming }
  | {
      readonly kind: 'settle';
      readonly from: number;
      readonly timing: CutTiming;
      /** It found the piece not ready once: the rise starts when it is. */
      readonly waited: boolean;
    }
  | { readonly kind: 'in'; readonly from: number; readonly timing: CutTiming };

const REST: Phase = { kind: 'rest' };

export interface RevealFrame {
  /** `u_reveal`: 1 the piece shows, 0 the brand's picture alone. */
  readonly reveal: number;
  /** The piece the stage shows (it changes at a cut's bottom). */
  readonly shown: number;
  /** Cuts made so far: `u_cut`. */
  readonly cuts: number;
}

export class RevealClock {
  #phase: Phase = REST;
  #shown: number;
  #target: number;
  #waiting: number | null = null;
  #cuts = 0;
  #pausedAt: number | null = null;
  /** When the last cut started (its fall's `from`). */
  #lastStart = Number.NEGATIVE_INFINITY;
  /** The timing the next cut starts with. */
  timing: CutTiming;
  /**
   * Whether piece `shown` (the stage's, at the cut's bottom) is ready to rise
   * onto. Ready by default: the cut runs on its timing alone.
   */
  ready: (shown: number) => boolean = () => true;

  constructor(shown: number, timing: CutTiming = CUT_TIMING) {
    this.#shown = shown;
    this.#target = shown;
    this.timing = timing;
  }

  /** Cut to piece `to`, now. */
  cut(to: number, now: number): void {
    this.#advance(now);
    const phase = this.#phase;
    if (phase.kind === 'out') {
      this.#target = to;
      return;
    }
    if (phase.kind === 'settle') {
      // Still closed, nothing new on show: aim the cut at the pick now. No
      // new dip, and the wait stays bounded from the bottom it reached.
      this.#target = to;
      this.#shown = to;
      return;
    }
    if (phase.kind === 'in') {
      this.#waiting = to === this.#shown ? null : to;
      return;
    }
    if (to === this.#shown) return;
    this.#target = to;
    const from = Math.max(
      this.#pausedAt ?? now,
      this.#lastStart + MIN_CUT_GAP_MS
    );
    this.#lastStart = from;
    this.#phase = { kind: 'out', from, timing: this.timing };
  }

  /** Show piece `to` at once, with no cut: the first piece, or a new reel. */
  jump(to: number): void {
    this.#phase = REST;
    this.#shown = to;
    this.#target = to;
    this.#waiting = null;
  }

  /**
   * The piece the cut under way is going to at `now`: the latest pick
   * waiting for a rise to end, else its target; at rest, the piece shown.
   */
  headingTo(now: number): number {
    this.#advance(now);
    return this.#waiting ?? this.#target;
  }

  /**
   * A cut is under way at `now`, or due: its fall may not have begun yet,
   * the reveal still 1 (a pick stamped after the frame reading it began, or
   * a fall `MIN_CUT_GAP_MS` holds off). A loop that stops on the reveal alone
   * stops before such a cut runs.
   */
  cutting(now: number): boolean {
    this.#advance(now);
    return this.#phase.kind !== 'rest';
  }

  /** Stop the cut where it is (the reel's pause, its holds). */
  pause(now: number): void {
    if (this.#pausedAt === null) this.#pausedAt = now;
  }

  /** Carry the cut on from where it stopped. */
  play(now: number): void {
    const at = this.#pausedAt;
    if (at === null) return;
    this.#pausedAt = null;
    const phase = this.#phase;
    if (phase.kind !== 'rest')
      this.#phase = { ...phase, from: phase.from + (now - at) };
  }

  /** Where the cut is at `now`. */
  at(now: number): RevealFrame {
    const t = this.#advance(now);
    const phase = this.#phase;
    let reveal = 1;
    if (phase.kind === 'out')
      reveal = 1 - easeIn(through(t, phase.from, phase.timing.outMs));
    else if (phase.kind === 'settle') reveal = 0;
    else if (phase.kind === 'in')
      reveal = easeOut(through(t, phase.from, phase.timing.inMs));
    return { reveal, shown: this.#shown, cuts: this.#cuts };
  }

  /** Run the phases on to `now` (or to the pause). The clock's time. */
  #advance(now: number): number {
    const t = this.#pausedAt ?? now;
    while (this.#turn(t));
    return t;
  }

  /** Make the phase change due by `t`, if one is. True: another may follow. */
  #turn(t: number): boolean {
    const phase = this.#phase;
    if (phase.kind === 'rest') return false;
    if (phase.kind === 'out') {
      const bottom = phase.from + phase.timing.outMs;
      if (t < bottom) return false;
      this.#shown = this.#target;
      this.#cuts += 1;
      this.#phase = {
        kind: 'settle',
        from: bottom,
        timing: phase.timing,
        waited: false,
      };
      return true;
    }
    if (phase.kind === 'settle') {
      const limit = phase.from + SETTLE_MAX_MS;
      const ready = this.ready(this.#shown);
      if (!ready && t < limit) {
        if (!phase.waited) this.#phase = { ...phase, waited: true };
        return false;
      }
      // Ready at once: the rise from the bottom, as the timing has it. Ready
      // after a wait: a whole rise from the frame that found it. Never ready:
      // from the limit.
      const from = !phase.waited ? phase.from : ready ? t : limit;
      this.#phase = { kind: 'in', from, timing: phase.timing };
      return true;
    }
    const top = phase.from + phase.timing.inMs;
    if (t < top) return false;
    const next = this.#waiting;
    this.#waiting = null;
    if (next === null || next === this.#shown) {
      this.#phase = REST;
      return false;
    }
    this.#target = next;
    this.#lastStart = top;
    this.#phase = { kind: 'out', from: top, timing: this.timing };
    return true;
  }
}
