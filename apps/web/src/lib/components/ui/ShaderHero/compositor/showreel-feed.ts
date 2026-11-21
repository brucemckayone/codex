/**
 * What the Showreel (WP-5) hands the window's shader (Codex-1yd58.4): the
 * piece's film, where its frame sits, the org's name as a mask, and how the
 * film is shown (its look: the layout's film frame and the band).
 *
 * A module-level channel, as `shaderTone` is, because the two live apart:
 * the Showreel is in the page, the shader in the org layout. Only the org
 * layout's hero (`tone`, the fixed canvas the window shows) reads it. A film
 * attaches that hero's compositor even when the brand has no shader, which
 * then draws the film on a plain ground (`needsCompositor`), so the feed
 * must hold the film before any compositor exists.
 *
 * One writer (the Showreel) and one reader (the hero). Setting the media,
 * stage, look or motion it already holds is no change; the mask is uploaded
 * on every set.
 *
 * The motion (WP-6) is the Showreel's `FilmMotion`: its four effects, and
 * values the Showreel writes IN PLACE each frame, so a moving hero draws
 * them with no message at all. A frozen hero (reduced motion, the reel's
 * pause) draws only when told: `motionFrame()` is that word, said by the
 * Showreel each frame its motion changed something.
 */
import type { FilmMotion } from './film-motion';
import type { FilmLook, StageBox, StageMedia } from './stage';

/** What changed; `frame`: the motion's values moved this frame. */
type FeedField = 'media' | 'stage' | 'mask' | 'look' | 'motion' | 'frame';

let media: StageMedia | null = null;
let stage: StageBox | null = null;
let motion: FilmMotion | null = null;
let mask: TexImageSource | null = null;
let look: FilmLook | null = null;
let listener: ((changed: FeedField) => void) | null = null;

/** The same look, field by field: a derived look is a new object each time. */
const sameLook = (a: FilmLook, b: FilmLook): boolean =>
  a.frame === b.frame &&
  a.band === b.band &&
  (a.surface ?? 'none') === (b.surface ?? 'none') &&
  // the same clock: Showreel makes one for the visit
  (a.push ?? null) === (b.push ?? null);

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
  get look(): FilmLook | null {
    return look;
  },
  get motion(): FilmMotion | null {
    return motion;
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
  /** How the film is shown; null for the brand's own frame. */
  setLook(next: FilmLook | null): void {
    if (next === look || (next && look && sameLook(next, look))) return;
    look = next;
    listener?.('look');
  },
  /**
   * The Showreel's motion (WP-6), or null for none: the film then draws as
   * WP-5's frame. A new object is a new choice (the compositor composes its
   * pass); its values are written in place, so they need no set.
   */
  setMotion(next: FilmMotion | null): void {
    if (next === motion) return;
    motion = next;
    listener?.('motion');
  },
  /** The motion's values moved this frame: a frozen hero draws again. */
  motionFrame(): void {
    if (motion) listener?.('frame');
  },
  /** The hero that reads it, told what changed; null to stop. */
  onChange(next: ((changed: FeedField) => void) | null): void {
    listener = next;
  },
};
