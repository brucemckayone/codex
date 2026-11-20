/**
 * The Showreel's reel (Codex-1yd58): what the hero plays, in order. The org's
 * intro film, then up to five featured pieces when at least two of them can
 * be shown; else up to five of the latest. The two are never mixed (owner,
 * 2026-11-19). Featured content plays before featured portals: moving pieces
 * lead (the spotlight, by contrast, puts a portal first).
 *
 * Each entry plays for a few seconds. A film with a preview plays its footage
 * silently; anything else shows its picture with a slow push-in. A recording
 * shows its cover (its preview is heard only in the theatre), so a piece with
 * no picture and no footage has nothing to show and is left out.
 *
 * Pure: the landing hands over its catalogue rows and a way to word a row as
 * a piece (the words and links need the page); this decides which play, in
 * what order, and how.
 */

import type { IntroFilm, PublicMediaItem } from '@codex/shared-types';
import type { OrgHeroPiece } from './hero-config';

/** Its footage, playing silently, or its picture with a slow push-in. */
type ReelShow = 'footage' | 'still';

type ReelFilm = { type: 'film'; film: IntroFilm; show: ReelShow };

export type ReelEntry =
  | ReelFilm
  | { type: 'piece'; piece: OrgHeroPiece; show: ReelShow };

/** What the reel reads from a catalogue row itself. */
interface ReelRow {
  featured: boolean;
  mediaItem: PublicMediaItem | null;
}

const MAX_PIECES = 5;
/** With fewer featured pieces to show than this, the latest play instead. */
const MIN_FEATURED = 2;

function showFor(
  footageUrl: string | null,
  pictureUrl: string | null
): ReelShow | null {
  if (footageUrl) return 'footage';
  return pictureUrl ? 'still' : null;
}

function filmEntry(film: IntroFilm | null): ReelFilm | null {
  const show = film ? showFor(film.previewUrl, film.posterUrl) : null;
  return film && show ? { type: 'film', film, show } : null;
}

/**
 * Whether a catalogue row is the intro film itself. The public film carries
 * no media id, so its preview and its poster stand in for one: each is built
 * from the same media item's key, on the same host, as the row's own. The
 * poster matters for a film offered in full with no preview.
 */
function isFilmRow(film: IntroFilm, media: PublicMediaItem | null): boolean {
  if (!media) return false;
  return (
    (film.previewUrl !== null && media.hlsPreviewUrl === film.previewUrl) ||
    (film.posterUrl !== null && media.thumbnailUrl === film.posterUrl)
  );
}

function playable(pieces: readonly OrgHeroPiece[]): ReelEntry[] {
  return pieces.flatMap((piece): ReelEntry[] => {
    const footage = piece.kind === 'video' ? piece.previewUrl : null;
    const show = showFor(footage, piece.imageUrl);
    return show ? [{ type: 'piece', piece, show }] : [];
  });
}

export function buildReel<Row extends ReelRow>(input: {
  /** The intro film, only when a press can play it (the landing's `filmPlayable`). */
  film: IntroFilm | null;
  /** The catalogue, newest first. */
  rows: readonly Row[];
  /** The featured portals, in their own order. */
  portals: readonly OrgHeroPiece[];
  /** Words a row as a featured or a latest piece. */
  toPiece: (row: Row, mode: 'featured' | 'latest') => OrgHeroPiece;
}): ReelEntry[] {
  const { toPiece } = input;
  const lead = filmEntry(input.film);
  // the film's own row plays once, as the film
  const rows = lead
    ? input.rows.filter((row) => !isFilmRow(lead.film, row.mediaItem))
    : input.rows;
  const featured = playable([
    ...rows
      .filter((row) => row.featured)
      .map((row) => toPiece(row, 'featured')),
    ...input.portals,
  ]);
  const latest =
    featured.length >= MIN_FEATURED
      ? []
      : playable(rows.map((row) => toPiece(row, 'latest')));
  // A lone featured piece still plays when there is nothing newer: it never
  // mixes, and it keeps the org's only showable piece (team lead, 2026-11-19).
  const pieces = latest.length > 0 ? latest : featured;
  return [...(lead ? [lead] : []), ...pieces.slice(0, MAX_PIECES)];
}

/**
 * Whether the reel is worth playing: the intro film, or at least two pieces.
 * One piece alone is a spotlight, which the Showcase already draws.
 */
export function reelQualifies(reel: readonly ReelEntry[]): boolean {
  return reel.some((entry) => entry.type === 'film') || reel.length >= 2;
}
