/**
 * The v4 mock's cubic easings (Codex-1yd58.7), shared by the reel's motion
 * timelines. Each takes and gives 0-1; a value outside is clamped first.
 */
import { clamp01 } from '$lib/components/ui/ShaderHero/clamp';

/** Slow, then fast: a fall or a dive. */
export const easeIn = (x: number) => clamp01(x) ** 3;
/** Fast, then slow: a rise, settling. */
export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
/** Slow, fast, slow. */
export function easeInOut(x: number): number {
  const u = clamp01(x);
  return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
}
/** How far `ms` is through `[from, from + length]`, 0-1. */
export const through = (ms: number, from: number, length: number) =>
  length <= 0 ? (ms >= from ? 1 : 0) : clamp01((ms - from) / length);
