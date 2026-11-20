/**
 * What the Showreel (WP-5) hands the window's shader (Codex-1yd58.4): the
 * piece's film, where its frame sits, and the org's name as a mask.
 *
 * A module-level channel, as `shaderTone` is, because the two live apart:
 * the Showreel is in the page, the shader in the org layout. Only the org
 * layout's hero (`tone`, the fixed canvas the window shows) reads it. A film
 * attaches that hero's compositor even when the brand has no shader, which
 * then draws the film on a plain ground (`needsCompositor`), so the feed
 * must hold the film before any compositor exists.
 *
 * One writer (the Showreel) and one reader (the hero). Setting the media or
 * stage it already holds is no change; the mask is uploaded on every set.
 */
import type { StageBox, StageMedia } from './stage';

/** Which of the three changed. */
type FeedField = 'media' | 'stage' | 'mask';

let media: StageMedia | null = null;
let stage: StageBox | null = null;
let mask: TexImageSource | null = null;
let listener: ((changed: FeedField) => void) | null = null;

export const showreelFeed = {
  get media(): StageMedia | null {
    return media;
  },
  get stage(): StageBox | null {
    return stage;
  },
  get mask(): TexImageSource | null {
    return mask;
  },
  /** The piece's video or still, or null when the Showreel shows none. */
  setMedia(next: StageMedia | null): void {
    if (next === media) return;
    media = next;
    listener?.('media');
  },
  /** Where the film's frame sits (`stage.ts`), measured on layout and resize. */
  setStage(next: StageBox | null): void {
    if (next === stage) return;
    stage = next;
    listener?.('stage');
  },
  /**
   * The org's name, white on black at the canvas's size. Set it again after
   * redrawing the same canvas (a resize, a font load): every call uploads.
   */
  setNameMask(next: TexImageSource | null): void {
    mask = next;
    listener?.('mask');
  },
  /** The hero that reads it, told what changed; null to stop. */
  onChange(next: ((changed: FeedField) => void) | null): void {
    listener = next;
  },
};
