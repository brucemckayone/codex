/**
 * What the Showreel's theatre plays: a preview, with sound, opened by a
 * press. The film's preview and a video or audio piece's preview are public
 * HLS manifests (never renewed), so the theatre needs no signed stream: the
 * org's full film keeps its own player.
 */
import type { ReelEntry } from '../reel';

export interface TheatreItem {
  /** A film fills the hero; a recording shows its cover over the shader. */
  readonly kind: 'video' | 'audio';
  /** The preview's HLS manifest. */
  readonly src: string;
  /** The bar's title and the player's accessible name. */
  readonly title: string;
  /** The film's poster until its first frame, or the recording's cover. */
  readonly still: string | null;
}

/** Filling the box may crop at most this share of the film (the owner's limit). */
const CROP_LIMIT = 0.4;

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * How the film sits in the theatre: it fills the box (`cover`) unless that
 * would crop more than 40% of it, as a landscape film on an upright phone
 * would; then it plays whole on the dark (`contain`). Unknown sizes fill.
 */
export function theatreFit(box: Size, film: Size): 'cover' | 'contain' {
  if (box.width <= 0 || box.height <= 0 || film.width <= 0 || film.height <= 0)
    return 'cover';
  const boxAspect = box.width / box.height;
  const filmAspect = film.width / film.height;
  const shown = Math.min(boxAspect / filmAspect, filmAspect / boxAspect);
  return 1 - shown > CROP_LIMIT ? 'contain' : 'cover';
}

/**
 * The entry's preview with sound, or null when it has none to play: a
 * portal or an essay, or a film or recording without a preview. `title` is
 * the entry's as the reel words it (the film's is the org's name).
 */
export function theatreFor(
  entry: ReelEntry,
  title: string
): TheatreItem | null {
  if (entry.type === 'film') {
    const { film } = entry;
    if (!film.previewUrl) return null;
    return {
      kind: 'video',
      src: film.previewUrl,
      title,
      still: film.posterUrl,
    };
  }
  const { piece } = entry;
  if (!piece.previewUrl || (piece.kind !== 'video' && piece.kind !== 'audio'))
    return null;
  return {
    kind: piece.kind,
    src: piece.previewUrl,
    title,
    still: piece.imageUrl,
  };
}
