/**
 * The org intro film's two views (Codex-376dl): the landing's and the studio's,
 * from each answer `resolveIntroFilm` can give. They must agree: the studio
 * says "preview" exactly when the landing draws a preview, and "none" exactly
 * when it draws no film.
 */

import type { IntroFilm, StudioIntroFilm } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import { toPublicIntroFilm, toStudioIntroFilm } from '../intro-film-views';
import type { IntroFilmMedia, IntroFilmResolution } from '../sales-films';

const CDN = 'https://cdn.example.test';

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
    expect(toPublicIntroFilm({ ok: true, film }, CDN)).toEqual({
      title: 'Why we teach',
      posterUrl: `${CDN}/${film.thumbnailKey}`,
      previewUrl: `${CDN}/${film.hlsPreviewKey}`,
      durationSeconds: 134,
      fullFilm: true,
    });
  });

  it('draws a paid film as its preview, never as a full film', () => {
    expect(toPublicIntroFilm(refused('paid-use'), CDN)).toMatchObject({
      previewUrl: `${CDN}/${film.hlsPreviewKey}`,
      fullFilm: false,
    });
  });

  it('draws no film for a paid film with no preview: there is nothing to play', () => {
    expect(toPublicIntroFilm(refused('paid-use', noPreview), CDN)).toBeNull();
  });

  it('draws no film for every other refusal', () => {
    for (const reason of [
      'not-ready',
      'not-video',
      'creator-not-member',
    ] as const) {
      expect(toPublicIntroFilm(refused(reason), CDN)).toBeNull();
    }
    expect(toPublicIntroFilm(refused('empty-slot', null), CDN)).toBeNull();
    expect(toPublicIntroFilm(refused('no-org', null), CDN)).toBeNull();
  });

  it('still offers the full film without a CDN base, with no URLs to draw', () => {
    expect(toPublicIntroFilm({ ok: true, film }, undefined)).toMatchObject({
      posterUrl: null,
      previewUrl: null,
      fullFilm: true,
    });
  });
});

describe('toStudioIntroFilm: what the studio says', () => {
  it('names a full film', () => {
    expect(toStudioIntroFilm({ ok: true, film }, CDN)).toEqual({
      mediaItemId: 'media-1',
      title: 'Why we teach',
      posterUrl: `${CDN}/${film.thumbnailKey}`,
      durationSeconds: 134,
      plays: 'full',
    });
  });

  it('says a paid film plays its preview, or nothing when it has none', () => {
    expect(toStudioIntroFilm(refused('paid-use'), CDN)).toMatchObject({
      plays: 'preview',
      reason: 'paid',
    });
    expect(
      toStudioIntroFilm(refused('paid-use', noPreview), CDN)
    ).toMatchObject({ plays: 'none', reason: 'paid' });
  });

  it('says why visitors see no film', () => {
    expect(toStudioIntroFilm(refused('not-ready'), CDN)).toMatchObject({
      plays: 'none',
      reason: 'not-ready',
    });
    expect(toStudioIntroFilm(refused('not-video'), CDN)).toMatchObject({
      plays: 'none',
      reason: 'not-video',
    });
    expect(toStudioIntroFilm(refused('creator-not-member'), CDN)).toMatchObject(
      { plays: 'none', reason: 'creator-left' }
    );
  });

  it('is null when no film is picked', () => {
    expect(toStudioIntroFilm(refused('empty-slot', null), CDN)).toBeNull();
    expect(toStudioIntroFilm(refused('no-org', null), CDN)).toBeNull();
  });

  it('agrees with the landing on every answer', () => {
    const answers: IntroFilmResolution[] = [
      { ok: true, film },
      refused('paid-use'),
      refused('paid-use', noPreview),
      refused('not-ready'),
      refused('not-video'),
      refused('creator-not-member'),
    ];
    for (const answer of answers) {
      const landing = landingPlays(toPublicIntroFilm(answer, CDN));
      expect(toStudioIntroFilm(answer, CDN)?.plays).toBe(landing);
    }
  });
});
