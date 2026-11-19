/**
 * The flash governor (Codex-1yd58.4, plan §5.8; WCAG 2.3.1 Three Flashes).
 *
 * An effect marked `flashes` can change the picture's brightness over time
 * (a glitch burst, a strobe-like leak). It never sees the real clock: it gets
 * one stepped to at most 3 values a second, so whatever it draws from the
 * time changes at most 3 times a second, however its GLSL is written.
 */

/** WCAG 2.3.1: no more than three flashes in any one second. */
export const FLASH_MAX_PER_SECOND = 3;

/**
 * `time` (seconds) stepped to at most `perSecond` changes a second, and never
 * more than `FLASH_MAX_PER_SECOND` whatever is asked. A time that is not a
 * finite, non-negative number is 0. PURE.
 */
export function governFlash(
  time: number,
  perSecond: number = FLASH_MAX_PER_SECOND
): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  const rate = Math.min(
    FLASH_MAX_PER_SECOND,
    Number.isFinite(perSecond) && perSecond > 0
      ? perSecond
      : FLASH_MAX_PER_SECOND
  );
  return Math.floor(time * rate) / rate;
}

/** The clock an effect is given: governed when it flashes. PURE. */
export function effectTime(
  effect: { flashes?: boolean },
  time: number
): number {
  return effect.flashes ? governFlash(time) : time;
}
