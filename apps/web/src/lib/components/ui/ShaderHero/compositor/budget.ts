/**
 * The phone budget for a two-preset stack.
 *
 * On a phone (under `PHONE_MAX_WIDTH` CSS px) the second preset already
 * renders at half the scene's size. If the frame interval's 95th percentile
 * over a window of `BUDGET_FRAMES` frames still goes over `BUDGET_P95_MS`,
 * the hero drops the second preset for the rest of its life (the org layout
 * mounts it once per session) and logs it. The base keeps drawing.
 *
 * START VALUES, to be tuned on a real phone (WP-11): 25 ms is 40 fps, a frame
 * and a half late at 60.
 */

import { clamp01 } from '../clamp';

/** Below this many CSS px wide the hero renders at DPR 1: a phone. */
export const PHONE_MAX_WIDTH = 768;
/** Frames in one judged window. */
export const BUDGET_FRAMES = 120;
/** The window's 95th-percentile frame interval may not exceed this. */
export const BUDGET_P95_MS = 25;

/** The window that broke the budget. */
export interface BudgetBreach {
  p95Ms: number;
  frames: number;
}

export interface FrameBudget {
  /**
   * Record one frame's interval in ms. Returns the breach once, for the
   * window that broke the budget; null for every other frame, and for every
   * frame after a breach until `reset()`.
   */
  push(intervalMs: number): BudgetBreach | null;
  /** Start judging afresh (a new second preset started drawing). */
  reset(): void;
}

/** The `p` (0-1) percentile of `values`, nearest rank. PURE. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(clamp01(p) * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
}

export function createFrameBudget({
  frames = BUDGET_FRAMES,
  p95Ms = BUDGET_P95_MS,
}: {
  frames?: number;
  p95Ms?: number;
} = {}): FrameBudget {
  let window: number[] = [];
  let breached = false;
  return {
    push(intervalMs) {
      // A stall the loop never ran through (a hidden tab) is not a frame:
      // ShaderHero resets its clock on resume, so such a gap never arrives.
      if (breached || !Number.isFinite(intervalMs) || intervalMs < 0)
        return null;
      window.push(intervalMs);
      if (window.length < frames) return null;
      const p95 = percentile(window, 0.95);
      window = [];
      if (p95 <= p95Ms) return null;
      breached = true;
      return { p95Ms: p95, frames };
    },
    reset() {
      window = [];
      breached = false;
    },
  };
}
