/**
 * The org intro film's two views (Codex-376dl), from the one read
 * `resolveIntroFilm` makes: what the public landing draws, and what the brand
 * studio says about it. Pure, so the minter, the public org info and the
 * studio cannot disagree about a film.
 */

import type { IntroFilm, StudioIntroFilm } from '@codex/shared-types';
import type {
  IntroFilmMedia,
  IntroFilmRefusal,
  IntroFilmResolution,
} from './sales-films';

/** A refusal with a film behind it: every one but `no-org` and `empty-slot`. */
type PickedRefusal = Exclude<IntroFilmRefusal, 'no-org' | 'empty-slot'>;

/** `${base}/${key}`, or null without either. */
function publicUrl(
  base: string | undefined,
  key: string | null
): string | null {
  if (!base || !key) return null;
  return `${base}/${key}`;
}

function drawn(
  film: IntroFilmMedia,
  r2PublicUrlBase: string | undefined,
  fullFilm: boolean
): IntroFilm {
  return {
    title: film.title,
    posterUrl: publicUrl(r2PublicUrlBase, film.thumbnailKey),
    previewUrl: publicUrl(r2PublicUrlBase, film.hlsPreviewKey),
    durationSeconds: film.durationSeconds,
    fullFilm,
  };
}

/**
 * The landing's film. One that may stream in full is drawn with
 * `fullFilm: true`. A paid one still plays its public 30-second preview, so it
 * is drawn when that preview exists. Every other refusal (not ready, not a
 * video, its creator off the team, no film at all) draws no film.
 */
export function toPublicIntroFilm(
  resolution: IntroFilmResolution,
  r2PublicUrlBase: string | undefined
): IntroFilm | null {
  if (resolution.ok) return drawn(resolution.film, r2PublicUrlBase, true);
  const { reason, film } = resolution;
  if (reason !== 'paid-use' || !film) return null;
  const view = drawn(film, r2PublicUrlBase, false);
  return view.previewUrl ? view : null;
}

/** The studio's reason for each refusal that leaves visitors a cut or no film. */
const STUDIO_REASONS: Record<
  PickedRefusal,
  NonNullable<StudioIntroFilm['reason']>
> = {
  'paid-use': 'paid',
  'not-ready': 'not-ready',
  'not-video': 'not-video',
  'creator-not-member': 'creator-left',
};

/**
 * The studio's film: null when none is picked, otherwise what was picked and
 * what visitors get. A paid film plays its preview if it has one, and nothing
 * if it does not, exactly as {@link toPublicIntroFilm} draws it.
 */
export function toStudioIntroFilm(
  resolution: IntroFilmResolution,
  r2PublicUrlBase: string | undefined
): StudioIntroFilm | null {
  const { film } = resolution;
  if (!film) return null;
  const picked = {
    mediaItemId: film.mediaId,
    title: film.title,
    posterUrl: publicUrl(r2PublicUrlBase, film.thumbnailKey),
    durationSeconds: film.durationSeconds,
  };
  if (resolution.ok) return { ...picked, plays: 'full' };

  const reason = resolution.reason;
  if (reason === 'no-org' || reason === 'empty-slot') return null;
  const shown = toPublicIntroFilm(resolution, r2PublicUrlBase);
  return {
    ...picked,
    plays: shown ? 'preview' : 'none',
    reason: STUDIO_REASONS[reason],
  };
}
