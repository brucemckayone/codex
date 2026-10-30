/**
 * The org intro film's two views (Codex-376dl): the landing's and the studio's,
 * from each answer `resolveIntroFilm` can give. They must agree: the studio
 * says "preview" exactly when the landing draws a preview, and "none" exactly
 * when it draws no film.
 */

import type { IntroFilm, StudioIntroFilm } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import type { R2PublicBases } from '../../r2-public-bases';
import { toPublicIntroFilm, toStudioIntroFilm } from '../intro-film-views';
import type { IntroFilmMedia, IntroFilmResolution } from '../sales-films';

const CDN = 'https://cdn.example.test';
const PREVIEWS = 'https://previews.example.test';
/** Production's shape: one host for both. */
const ONE_HOST: R2PublicBases = { assets: CDN, mediaPreview: CDN };

const film: IntroFilmMedia = {
  mediaId: 'media-1',
  creatorId: 'creator-1',
  title: 'Why we teach',
  thumbnailKey: 'creator-1/thumbnails/media-1/md.webp',
  hlsPreviewKey: 'creator-1/hls/media-1/preview/preview.m3u8',
  durationSeconds: 134,
};
const noPreview: IntroFilmMedia = { ...film, hlsPreviewKey: null };

const refused = (
  reason: Exclude<IntroFilmResolution, { ok: true }>['reason'],
  media: IntroFilmMedia | null = film
): IntroFilmResolution => ({ ok: false, reason, film: media });

/** What the landing plays, in the studio's words. */
function landingPlays(view: IntroFilm | null): StudioIntroFilm['plays'] {
  if (!view) return 'none';
  if (view.fullFilm) return 'full';
  return 'preview';
}

describe('toPublicIntroFilm: what the landing draws', () => {
  it('draws an eligible film as a full film, with CDN poster and preview', () => {
    expect(toPublicIntroFilm({ ok: true, film }, ONE_HOST)).toEqual({
      title: 'Why we teach',
      posterUrl: `${CDN}/${film.thumbnailKey}`,
      previewUrl: `${CDN}/${film.hlsPreviewKey}`,
      durationSeconds: 134,
      fullFilm: true,
    });
  });

  it('resolves the poster on the assets host and the preview on the preview host', () => {
    expect(
      toPublicIntroFilm(
        { ok: true, film },
        { assets: CDN, mediaPreview: PREVIEWS }
      )
    ).toMatchObject({
      posterUrl: `${CDN}/${film.thumbnailKey}`,
      previewUrl: `${PREVIEWS}/${film.hlsPreviewKey}`,
    });
  });

  it('draws a paid film as its preview, never as a full film', () => {
    expect(toPublicIntroFilm(refused('paid-use'), ONE_HOST)).toMatchObject({
      previewUrl: `${CDN}/${film.hlsPreviewKey}`,
      fullFilm: false,
    });
  });

  it("gives a paid film its preview's length, as the transcoder cuts it", () => {
    // Up to 30s, from a tenth of the way in: a 30:00 film plays 0:30, and a
    // 20s one plays from 2s to its end.
    const length = (durationSeconds: number | null) =>
      toPublicIntroFilm(
        refused('paid-use', { ...film, durationSeconds }),
        ONE_HOST
      )?.durationSeconds;
    expect(length(1800)).toBe(30);
    expect(length(20)).toBe(18);
    expect(length(null)).toBeNull();
  });

  it('draws no film for a paid film with no preview: there is nothing to play', () => {
    expect(
      toPublicIntroFilm(refused('paid-use', noPreview), ONE_HOST)
    ).toBeNull();
  });

  it('draws no film for every other refusal', () => {
    for (const reason of [
      'not-ready',
      'failed',
      'not-video',
      'creator-not-member',
    ] as const) {
      expect(toPublicIntroFilm(refused(reason), ONE_HOST)).toBeNull();
    }
    expect(toPublicIntroFilm(refused('empty-slot', null), ONE_HOST)).toBeNull();
    expect(toPublicIntroFilm(refused('no-org', null), ONE_HOST)).toBeNull();
  });

  it('still offers the full film without a CDN base, with no URLs to draw', () => {
    expect(
      toPublicIntroFilm(
        { ok: true, film },
        { assets: undefined, mediaPreview: undefined }
      )
    ).toMatchObject({
      posterUrl: null,
      previewUrl: null,
      fullFilm: true,
    });
  });
});

describe('toStudioIntroFilm: what the studio says', () => {
  it('names a full film', () => {
    expect(toStudioIntroFilm({ ok: true, film }, ONE_HOST)).toEqual({
      mediaItemId: 'media-1',
      title: 'Why we teach',
      posterUrl: `${CDN}/${film.thumbnailKey}`,
      durationSeconds: 134,
      plays: 'full',
    });
  });

  it('says a paid film plays its preview, or nothing when it has none', () => {
    expect(toStudioIntroFilm(refused('paid-use'), ONE_HOST)).toMatchObject({
      plays: 'preview',
      reason: 'paid',
    });
    expect(
      toStudioIntroFilm(refused('paid-use', noPreview), ONE_HOST)
    ).toMatchObject({ plays: 'none', reason: 'paid' });
  });

  it("names a paid film by its own length, not its preview's", () => {
    expect(
      toStudioIntroFilm(
        refused('paid-use', { ...film, durationSeconds: 1800 }),
        ONE_HOST
      )?.durationSeconds
    ).toBe(1800);
  });

  it('says why visitors see no film', () => {
    expect(toStudioIntroFilm(refused('not-ready'), ONE_HOST)).toMatchObject({
      plays: 'none',
      reason: 'not-ready',
    });
    expect(toStudioIntroFilm(refused('failed'), ONE_HOST)).toMatchObject({
      plays: 'none',
      reason: 'failed',
    });
    expect(toStudioIntroFilm(refused('not-video'), ONE_HOST)).toMatchObject({
      plays: 'none',
      reason: 'not-video',
    });
    expect(
      toStudioIntroFilm(refused('creator-not-member'), ONE_HOST)
    ).toMatchObject({ plays: 'none', reason: 'creator-left' });
  });

  it('is null when no film is picked', () => {
    expect(toStudioIntroFilm(refused('empty-slot', null), ONE_HOST)).toBeNull();
    expect(toStudioIntroFilm(refused('no-org', null), ONE_HOST)).toBeNull();
  });

  it('agrees with the landing on every answer', () => {
    const answers: IntroFilmResolution[] = [
      { ok: true, film },
      refused('paid-use'),
      refused('paid-use', noPreview),
      refused('not-ready'),
      refused('failed'),
      refused('not-video'),
      refused('creator-not-member'),
    ];
    for (const answer of answers) {
      const landing = landingPlays(toPublicIntroFilm(answer, ONE_HOST));
      expect(toStudioIntroFilm(answer, ONE_HOST)?.plays).toBe(landing);
    }
  });
});
