import { describe, expect, it } from 'vitest';
import type { SellPreview } from '../../render/types';
import { filmToShow } from './films';

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
