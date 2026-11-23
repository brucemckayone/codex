/**
 * How the Showreel plays for this visitor.
 *
 * - `footage`: each film plays its preview, silently, looping every time
 *   (previews stream from R2, so a loop costs no egress).
 * - `stills`: Save-Data is on. Each piece shows its picture, and the reel
 *   still moves on with the same effects: what is saved is data, not motion.
 * - `static`: reduced motion, or the creator turned "Loop and move on" off.
 *   No video and no moving on; each piece shows its picture, and the
 *   visitor's own index, strip or tap still changes piece. The shader holds
 *   its still frame.
 */

export type ReelMode = 'footage' | 'stills' | 'static';

export function reelMode(input: {
  reducedMotion: boolean;
  saveData: boolean;
  /** The creator's `reel-loop`: "Loop and move on". */
  loop: boolean;
}): ReelMode {
  if (input.reducedMotion || !input.loop) return 'static';
  return input.saveData ? 'stills' : 'footage';
}

/** The Network Information API's one field the reel reads (Chromium only). */
type SaveDataNavigator = Navigator & { connection?: { saveData?: boolean } };

/**
 * Whether the visitor asked to save data: the Save-Data hint where the
 * browser has it, or `prefers-reduced-data` where that ships. Neither is a
 * guess from the connection type.
 */
export function prefersSavingData(win: Window): boolean {
  const nav = win.navigator as SaveDataNavigator;
  if (nav.connection?.saveData === true) return true;
  return win.matchMedia?.('(prefers-reduced-data: reduce)').matches ?? false;
}
