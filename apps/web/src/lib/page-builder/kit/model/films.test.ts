import { describe, expect, it } from 'vitest';
import type { PreviewMedia, SellPreview } from '../../render/types';
import { filmPlays, filmToShow } from './films';

const FILM = { playlistUrl: 'https://cdn.example/film.m3u8' };

/** A settled stream carrying only the films given. */
const stream = (films: Partial<Pick<SellPreview, 'intro' | 'reel'>> = {}) =>
  ({ intro: null, reel: null, ...films }) as SellPreview;

describe('filmToShow (Codex-61zsk.57)', () => {
  it('a film that is here shows, attached or not: the awaited view can lag the creator', () => {
    for (const attached of [true, false, undefined]) {
      expect(
        filmToShow(attached, stream({ intro: FILM }), 'intro'),
        String(attached)
      ).toBe(true);
    }
  });

  it('none is coming once the stream settles without it, or fails', () => {
    expect(filmToShow(true, stream(), 'intro')).toBe(false);
    expect(filmToShow(undefined, stream(), 'reel')).toBe(false);
    expect(filmToShow(true, null, 'intro')).toBe(false);
  });

  it('none is coming from the first paint when the course has none attached', () => {
    expect(filmToShow(false, undefined, 'intro')).toBe(false);
  });

  it('is on its way while the stream is pending and one may come', () => {
    expect(filmToShow(true, undefined, 'intro')).toBeUndefined();
    expect(filmToShow(undefined, undefined, 'reel')).toBeUndefined();
  });

  it('reads its own film, never the other', () => {
    expect(filmToShow(true, stream({ reel: FILM }), 'intro')).toBe(false);
    expect(filmToShow(true, stream({ intro: FILM }), 'reel')).toBe(false);
  });
});

describe('filmPlays: what a press plays, and for how long (Codex-61zsk.73)', () => {
  // A 2:04 film whose preview runs 30 seconds.
  const CLIP: PreviewMedia = {
    ...FILM,
    durationSeconds: 124,
    previewSeconds: 30,
  };
  const visitor = { still: false, requestFilm: async () => null };
  const onItsOwn = { still: false, requestFilm: undefined };
  const looked = { still: true, requestFilm: undefined };

  it("plays the preview's length when the film may not play in full", () => {
    expect(filmPlays(CLIP, visitor)).toEqual({ full: false, seconds: 30 });
  });

  it("plays the whole film's length when it plays in full on a visitor's page", () => {
    expect(filmPlays({ ...CLIP, fullFilm: true }, visitor)).toEqual({
      full: true,
      seconds: 124,
    });
  });

  it('plays the preview where the page cannot ask for the full film', () => {
    expect(filmPlays({ ...CLIP, fullFilm: true }, onItsOwn)).toEqual({
      full: false,
      seconds: 30,
    });
  });

  it("names the visitor's length where the page is only looked at, as the canvas", () => {
    expect(filmPlays({ ...CLIP, fullFilm: true }, looked)).toEqual({
      full: true,
      seconds: 124,
    });
  });

  it('an older payload knows the length only of a film that plays in full', () => {
    const older: PreviewMedia = { ...FILM, durationSeconds: 1800 };
    expect(filmPlays(older, visitor)).toEqual({ full: false, seconds: null });
    expect(filmPlays({ ...older, fullFilm: true }, visitor)).toEqual({
      full: true,
      seconds: 1800,
    });
  });

  it('says no length for an unknown or empty one', () => {
    expect(
      filmPlays({ ...CLIP, previewSeconds: null }, visitor).seconds
    ).toBeNull();
    expect(
      filmPlays({ ...CLIP, previewSeconds: 0 }, visitor).seconds
    ).toBeNull();
  });
});
