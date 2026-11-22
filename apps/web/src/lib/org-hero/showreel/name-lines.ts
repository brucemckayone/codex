/**
 * The org's name as the Showreel's window (Codex-1yd58.6): which words go on
 * which line, and how large, so the name fills the stage's width; the Wide
 * title's size; and the run the top bar leaves a name standing in for a
 * failed logo.
 *
 * At most two lines. Each way of breaking the name is sized to fit the width,
 * and the largest wins: "Of Blood & Bones" breaks as "Of Blood" / "& Bones",
 * a one-word name stays one line. `measure` gives a text's width at 100 px in
 * the heading font (a canvas's `measureText`), so this stays pure.
 */

export interface NameLines {
  lines: string[];
  /** Font size in CSS px. */
  size: number;
}

export function nameLines(
  name: string,
  measure: (text: string) => number,
  available: number,
  maxSize: number
): NameLines {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const sizeFor = (lines: string[]) => {
    const widest = Math.max(1, ...lines.map(measure));
    return Math.min(maxSize, Math.floor((100 * available) / widest));
  };
  const whole = [words.join(' ')];
  let best: NameLines = { lines: whole, size: sizeFor(whole) };
  for (let k = 1; k < words.length; k++) {
    const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const size = sizeFor(lines);
    if (size > best.size) best = { lines, size };
  }
  return best;
}

/**
 * The name window on a short screen (the owner's floor, 2026-11-22): the
 * name in the `room` between the top bar and the words, a box of
 * `lines x size` (its line height 1). Each way of breaking it is sized to
 * the width and the cap (`nameLines`) and to the room, and the largest wins;
 * of equals, the one the width sets largest. Never under `floor`: when the
 * room holds less, it keeps the floor in its fewest lines that fit across at
 * it, and `grows` says the hero must grow to hold it. A name no break fits
 * across at the floor (a very long one on a phone) is set to the width,
 * under it.
 */
export function nameInRoom(
  name: string,
  measure: (text: string) => number,
  available: number,
  maxSize: number,
  room: number,
  floor: number
): NameLines & { grows: boolean } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const shapes = [[words.join(' ')]];
  for (let k = 1; k < words.length; k++) {
    shapes.push([words.slice(0, k).join(' '), words.slice(k).join(' ')]);
  }
  const across = (lines: string[]) =>
    Math.min(
      maxSize,
      Math.floor((100 * available) / Math.max(1, ...lines.map(measure)))
    );
  // Of breaks the room sets equal, the one the width sets largest: the
  // balanced break ("Of Blood" / "& Bones"), never the first ("Of" / ...).
  let best: NameLines = { lines: shapes[0] ?? [], size: -1 };
  let bestAcross = -1;
  for (const lines of shapes) {
    const wide = across(lines);
    const size = Math.min(wide, Math.floor(room / lines.length));
    if (size > best.size || (size === best.size && wide > bestAcross)) {
      best = { lines, size };
      bestAcross = wide;
    }
  }
  if (best.size >= floor) return { ...best, grows: false };
  // At the floor: its fewest lines that fit across, the balanced break of
  // those.
  const fits = shapes.filter((lines) => across(lines) >= floor);
  const fewest = Math.min(...fits.map((lines) => lines.length));
  let fit: string[] | null = null;
  for (const lines of fits) {
    if (lines.length !== fewest) continue;
    if (!fit || across(lines) > across(fit)) fit = lines;
  }
  if (fit) return { lines: fit, size: floor, grows: true };
  const widest = nameLines(name, measure, available, maxSize);
  return { ...widest, grows: true };
}

/**
 * The Wide title's size: the title set across the available width, from its
 * width at 100 px, held between `min` and `max` (the mock's 72-150 px).
 */
export function fitTitle(
  width100: number,
  available: number,
  min: number,
  max: number
): number {
  if (width100 <= 0) return max;
  return Math.max(min, Math.min(max, Math.floor((100 * available) / width100)));
}

/** A laid-out box across the page, as `getBoundingClientRect` gives one. */
interface Across {
  readonly left: number;
  readonly width: number;
}

/**
 * The run the top bar has free for the name standing in for a failed logo:
 * from the logo's place (`sigLeft`) to where the bar's content ends, or to
 * the meta less the bar's gap where one is laid out (a phone lays out none).
 * In whole pixels, never under 0. The stand-in is held to it out of flow, so
 * the bar keeps no place for a name it shows only when the logo fails.
 */
export function standInRun(bar: {
  sigLeft: number;
  end: number;
  gap: number;
  meta: Across | null;
}): number {
  const beforeMeta =
    bar.meta && bar.meta.width > 0
      ? bar.meta.left - bar.gap
      : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(Math.min(bar.end, beforeMeta) - bar.sigLeft));
}
