/**
 * The org intro film's two views (Codex-376dl), from the one read
 * `resolveIntroFilm` makes: what the public landing draws, and what the brand
 * studio says about it. Pure, so the minter, the public org info and the
 * studio cannot disagree about a film.
 */

import type { IntroFilm, StudioIntroFilm } from '@codex/shared-types';
import type { R2PublicBases } from '../r2-public-bases';
import type {
  IntroFilmMedia,
  IntroFilmRefusal,
  IntroFilmResolution,
} from './sales-films';

/** A refusal with a film behind it: every one but `no-org` and `empty-slot`. */
type PickedRefusal = Exclude<IntroFilmRefusal, 'no-org' | 'empty-slot'>;

/**
 * The longest public preview: `PREVIEW_DURATION` in the transcoder
 * (`create_preview`, infrastructure/runpod/handler/main.py).
 */
const PREVIEW_SECONDS = 30;

/** `${base}/${key}`, or null without either. */
function publicUrl(
  base: string | undefined,
  key: string | null
): string | null {
  if (!base || !key) return null;
  return `${base}/${key}`;
}

/**
 * How long a film's preview runs. The transcoder cuts it from a tenth of the
 * way in, for up to {@link PREVIEW_SECONDS} (`create_preview`), so a short
 * film's preview is shorter still.
 */
function previewLength(durationSeconds: number | null): number | null {
  if (durationSeconds === null) return null;
  const start = Math.floor(durationSeconds * 0.1);
  return Math.min(PREVIEW_SECONDS, durationSeconds - start);
}

/**
 * The landing's view of a film. `durationSeconds` is the length of what a
 * press PLAYS, as the chip says it: the whole film's, or its preview's. The
 * poster resolves on the assets host and the preview on the preview host, as
 * the catalogue's do.
 */
function drawn(
  film: IntroFilmMedia,
  bases: R2PublicBases,
  fullFilm: boolean
): IntroFilm {
  return {
    title: film.title,
    posterUrl: publicUrl(bases.assets, film.thumbnailKey),
    previewUrl: publicUrl(bases.mediaPreview, film.hlsPreviewKey),
    durationSeconds: fullFilm
      ? film.durationSeconds
      : previewLength(film.durationSeconds),
    fullFilm,
  };
}

/**
 * The landing's film. One that may stream in full is drawn with
 * `fullFilm: true`. A paid one still plays its public 30-second preview, so it
 * is drawn when that preview exists. Every other refusal (not ready, failed,
 * not a video, its creator off the team, no film at all) draws no film.
 */
export function toPublicIntroFilm(
  resolution: IntroFilmResolution,
  bases: R2PublicBases
): IntroFilm | null {
  if (resolution.ok) return drawn(resolution.film, bases, true);
  const { reason, film } = resolution;
  if (reason !== 'paid-use' || !film) return null;
  const view = drawn(film, bases, false);
  return view.previewUrl ? view : null;
}

/** The studio's reason for each refusal that leaves visitors a cut or no film. */
const STUDIO_REASONS: Record<
  PickedRefusal,
  NonNullable<StudioIntroFilm['reason']>
> = {
  'paid-use': 'paid',
  'not-ready': 'not-ready',
  failed: 'failed',
  'not-video': 'not-video',
  'creator-not-member': 'creator-left',
};

/**
 * The studio's film: null when none is picked, otherwise what was picked and
 * what visitors get. A paid film plays its preview if it has one, and nothing
 * if it does not, exactly as {@link toPublicIntroFilm} draws it. Its
 * `durationSeconds` is the film's own: the studio names the film, not the cut.
 */
export function toStudioIntroFilm(
  resolution: IntroFilmResolution,
  bases: R2PublicBases
): StudioIntroFilm | null {
  const { film } = resolution;
  if (!film) return null;
  const picked = {
    mediaItemId: film.mediaId,
    title: film.title,
    posterUrl: publicUrl(bases.assets, film.thumbnailKey),
    durationSeconds: film.durationSeconds,
  };
  if (resolution.ok) return { ...picked, plays: 'full' };

  const reason = resolution.reason;
  if (reason === 'no-org' || reason === 'empty-slot') return null;
  const shown = toPublicIntroFilm(resolution, bases);
  return {
    ...picked,
    plays: shown ? 'preview' : 'none',
    reason: STUDIO_REASONS[reason],
  };
}
