/**
 * Count-up (03-expressive-contract §7): a stats figure counts from zero to
 * its value, once, the first time it comes into view.
 *
 * The page's HTML always holds the FINAL value and the real text never
 * changes. While it counts, that text is painted transparent (still there
 * for a screen reader, find-in-page and copying) and an `aria-hidden` copy
 * laid over it shows the running number — so a screen reader meets the final
 * value once, and nothing re-lays out: the real text keeps the box its final
 * width. Only a value that reads as ONE amount with signs or words around it
 * counts (`£49`, `4,000+`, `20 min`, `4.9★`); `24/7`, `1h 30m`, a year or a
 * code never do, and the signs and words stay as they are.
 *
 * The page's stage (`./stage`) times it like every other entrance: a figure
 * below the fold waits at zero and counts once it clears the floating call to
 * action; one on screen when the page wakes up has been seen, and stays. It
 * never runs on a still page (the canvas, thumbnails), under reduced motion,
 * or where the Style opts out (`--lp-stat-count: none`).
 */
import type { Attachment } from 'svelte/attachments';
import { stageFor } from './stage';

export interface Figure {
  prefix: string;
  value: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
}

// Signs before (no letters, no digits), one amount — plain digits, or grouped
// in threes with commas, with optional decimals — and no digit after it.
const FIGURE =
  /^([^\p{L}\p{N}]*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\P{N}*)$/u;

export function parseFigure(text: string): Figure | null {
  const match = FIGURE.exec(text);
  if (!match) return null;
  const [, prefix, whole, fraction = '', suffix] = match;
  // "007" is a code, "2019" a year and ".5" a decimal cut short: none counts.
  if (/^0\d/.test(whole) || /[.,]$/.test(prefix)) return null;
  if (!fraction && /^(?:19|20)\d\d$/.test(whole)) return null;
  const value = Number(`${whole.replaceAll(',', '')}.${fraction || '0'}`);
  if (!(value > 0)) return null;
  return {
    prefix,
    value,
    decimals: fraction.length,
    grouped: whole.includes(','),
    suffix,
  };
}

/** The figure as it reads a share of the way up; at 1, exactly as written. */
export function figureAt(figure: Figure, progress: number): string {
  const amount = (figure.value * progress).toLocaleString('en-GB', {
    minimumFractionDigits: figure.decimals,
    maximumFractionDigits: figure.decimals,
    useGrouping: figure.grouped,
  });
  return `${figure.prefix}${amount}${figure.suffix}`;
}

/** A time token (`800ms`, `0.8s`) in milliseconds. */
function milliseconds(token: string): number {
  const amount = Number.parseFloat(token);
  return /ms\s*$/.test(token) ? amount : amount * 1000;
}

/**
 * Attach to the element holding the figure's text. `undefined` for a value
 * that does not count, so `{@attach countUp(value)}` attaches nothing.
 */
export function countUp(text: string): Attachment<HTMLElement> | undefined {
  const figure = parseFigure(text);
  if (!figure) return undefined;
  return (value) => {
    // The Style's opt-out first: a stage is only made for something to stage.
    const style = getComputedStyle(value);
    if (style.getPropertyValue('--lp-stat-count').trim() === 'none') return;
    const stage = stageFor(value);
    if (!stage) return;
    const copy = document.createElement('span');
    copy.className = 'lp-count';
    copy.setAttribute('aria-hidden', 'true');
    let animation: Animation | undefined;
    let frame = 0;

    const settle = () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      copy.remove();
      value.removeAttribute('data-lp-counting');
    };

    // The motion tokens time it, and the browser eases it: the effect's
    // progress is already eased, so the curve is the token's own. (Under
    // reduced motion the tokens are near zero, and it is simply there.)
    const run = () => {
      const duration =
        2 * milliseconds(style.getPropertyValue('--duration-slowest'));
      if (!(duration > 0)) return settle();
      const easing = style.getPropertyValue('--ease-out').trim() || undefined;
      const running = copy.animate(null, {
        duration,
        easing,
        fill: 'forwards',
      });
      animation = running;
      const tick = () => {
        const shown = figureAt(
          figure,
          running.effect?.getComputedTiming().progress ?? 1
        );
        if (copy.textContent !== shown) copy.textContent = shown;
        frame = requestAnimationFrame(tick);
      };
      tick();
      // Finished, or cancelled by anything at all (an extension clearing the
      // page's animations): either way the figure is itself again and the
      // frames stop.
      running.finished.then(settle, settle);
    };

    return stage.add(value, {
      arm() {
        copy.textContent = figureAt(figure, 0);
        value.setAttribute('data-lp-counting', '');
        value.appendChild(copy);
        return true;
      },
      play: run,
      settle,
    });
  };
}
