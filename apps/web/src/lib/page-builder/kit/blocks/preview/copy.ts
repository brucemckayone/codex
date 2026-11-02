/**
 * Visitor-facing words the sneak-peek block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import type { PreviewMedia } from '../../../render/types';
import type { FilmPlays } from '../../model/films';
import { FILM_COPY } from '../../primitives/film-copy';

/** What pressing a clip of each kind is. */
const KIND: Record<NonNullable<PreviewMedia['mediaType']>, string> = {
  video: 'watch',
  audio: 'listen',
};

export const PREVIEW_COPY = {
  /** The listening card's button for a clip that plays its preview: a film's words. */
  watch: FILM_COPY.preview,
  /** The listening card's button for a clip that plays in full, and once it has started. */
  play: 'Play',
  resume: 'Resume',
  /** The listening card's button while it plays, and once it has ended. */
  pause: 'Pause',
  again: 'Play again',
  /** Sound was refused and it plays muted: a press takes the sound. */
  sound: 'Tap for sound',
  /** The listening card's time, and its announcement, while the clip loads or stalls. */
  loading: 'Loading…',
  /** Beside the listening card's button when the player did not arrive. */
  failed: 'The preview could not load. Try again.',
  /**
   * Beside the listening card's button when a full recording's links ran
   * out mid-play and no fresh ones came: no end, so no "Play again".
   */
  lapsed: 'The recording stopped before its end. Press play to start it again.',
  /** On the listening card when the full recording was asked for and the preview plays. */
  fellBack: 'Playing the preview: the full recording could not load.',
} as const;

/** "An 8-second", "an 18-minute": a number said with a vowel takes "An". */
function article(n: number): string {
  return String(n).startsWith('8') || n === 11 || n === 18 ? 'An' : 'A';
}

/**
 * The clip's line (Codex-61zsk.73): what it is and how long a press plays,
 * "A 30-second watch", "A 2-minute listen", in whole minutes from a minute.
 * When the length is not known, "A short watch" for a preview, which is 30
 * seconds at most; a film that plays in full may be any length, so it names
 * no kind (`undefined`), as the Video block's line names no length.
 */
export function previewKind(
  mediaType: NonNullable<PreviewMedia['mediaType']>,
  { full, seconds }: FilmPlays
): string | undefined {
  const noun = KIND[mediaType];
  if (seconds === null) return full ? undefined : `A short ${noun}`;
  const whole = Math.round(seconds);
  if (whole < 60) return `${article(whole)} ${whole}-second ${noun}`;
  const minutes = Math.round(whole / 60);
  return `${article(minutes)} ${minutes}-minute ${noun}`;
}
