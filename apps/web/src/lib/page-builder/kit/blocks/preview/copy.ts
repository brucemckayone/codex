/**
 * Visitor-facing words the sneak-peek block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import type { PreviewMedia } from '../../../render/types';

/** What pressing a clip of each kind is. */
const KIND: Record<NonNullable<PreviewMedia['mediaType']>, string> = {
  video: 'watch',
  audio: 'listen',
};

export const PREVIEW_COPY = {
  watch: 'Play the preview',
  /** The listening card's button while it plays, and once it has ended. */
  pause: 'Pause',
  again: 'Play again',
  /** Sound was refused and it plays muted: a press takes the sound. */
  sound: 'Tap for sound',
  /** Beside the listening card's button when the player did not arrive. */
  failed: 'The preview could not load. Try again.',
} as const;

/** "An 8-second", "an 18-minute": a number said with a vowel takes "An". */
function article(n: number): string {
  return String(n).startsWith('8') || n === 11 || n === 18 ? 'An' : 'A';
}

/**
 * The clip's line (Codex-61zsk.73): what it is and how long a press plays,
 * "A 30-second watch", "A 2-minute listen", in whole minutes from a minute.
 * "A short watch" when the length is not known.
 */
export function previewKind(
  mediaType: NonNullable<PreviewMedia['mediaType']>,
  seconds: number | null
): string {
  const noun = KIND[mediaType];
  if (seconds === null) return `A short ${noun}`;
  const whole = Math.round(seconds);
  if (whole < 60) return `${article(whole)} ${whole}-second ${noun}`;
  const minutes = Math.round(whole / 60);
  return `${article(minutes)} ${minutes}-minute ${noun}`;
}
