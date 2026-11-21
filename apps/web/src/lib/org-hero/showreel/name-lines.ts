/**
 * The org's name as the Showreel's window (Codex-1yd58.6): which words go on
 * which line, and how large, so the name fills the stage's width.
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
