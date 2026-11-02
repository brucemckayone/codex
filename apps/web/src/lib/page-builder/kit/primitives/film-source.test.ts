/**
 * Which film a press plays (owner P10, "Full film unless it's paid"): the
 * full one only when the server allows it and the page can ask; the
 * 30-second preview whenever asking cannot give one. And how a full film
 * asks again as its links run out (`filmRenewal`).
 */
import { describe, expect, test, vi } from 'vitest';
import type { PreviewMedia } from '../../render/types';
import { filmRenewal, filmSource, playsInFull } from './film-source';

const PREVIEW = '/m1/hls/preview/preview.m3u8';
const FULL = '/films/m1/master.m3u8?token=t';
const EXPIRES = '2026-10-28T12:10:00.000Z';

const allowed: PreviewMedia = { playlistUrl: PREVIEW, fullFilm: true };
const previewOnly: PreviewMedia = { playlistUrl: PREVIEW };

// The rule `filmSource` asks by, and `filmPlays` reads for the line.
describe('playsInFull', () => {
  const requestFilm = async () => null;

  test('a clip the server marked, on a page that can ask', () => {
    expect(playsInFull(allowed, requestFilm)).toBe(true);
  });

  test('not a clip the server did not mark, nor a page that cannot ask', () => {
    expect(playsInFull(previewOnly, requestFilm)).toBe(false);
    expect(playsInFull({ ...allowed, fullFilm: false }, requestFilm)).toBe(
      false
    );
    expect(playsInFull(allowed, undefined)).toBe(false);
  });
});

describe('filmSource', () => {
  test('the full film when the server allows it and the page asks', async () => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    const source = filmSource(allowed, 'intro', requestFilm);
    expect(source).toBeInstanceOf(Promise);
    await expect(source).resolves.toEqual({ playlistUrl: FULL });
    expect(requestFilm).toHaveBeenCalledWith('intro');
  });

  test('the full film keeps when its links run out, for the player to renew', async () => {
    const requestFilm = vi.fn(async () => ({
      playlistUrl: FULL,
      expiresAt: EXPIRES,
    }));
    await expect(filmSource(allowed, 'intro', requestFilm)).resolves.toEqual({
      playlistUrl: FULL,
      expiresAt: EXPIRES,
    });
  });

  test('the preview when the page says it may not play in full', async () => {
    const requestFilm = vi.fn(async () => null);
    await expect(filmSource(allowed, 'reel', requestFilm)).resolves.toBe(
      PREVIEW
    );
  });

  test('the preview when asking fails', async () => {
    const requestFilm = vi.fn(() => Promise.reject(new Error('503')));
    await expect(filmSource(allowed, 'guide', requestFilm)).resolves.toBe(
      PREVIEW
    );
  });

  test('the preview when asking throws before it starts', () => {
    const requestFilm = vi.fn(() => {
      throw new Error('no remote');
    });
    expect(filmSource(allowed, 'intro', requestFilm)).toBe(PREVIEW);
  });

  test('the preview for an answer with no address', async () => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: '' }));
    await expect(filmSource(allowed, 'intro', requestFilm)).resolves.toBe(
      PREVIEW
    );
  });

  test.each([
    ['a clip the server did not mark', previewOnly, 'intro' as const, true],
    ['a film with no slot name (the hero)', allowed, undefined, true],
    ['a page that cannot ask (the canvas)', allowed, 'intro' as const, false],
  ])('never asks for %s: the preview, at once', (_label, clip, film, canAsk) => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    expect(filmSource(clip, film, canAsk ? requestFilm : undefined)).toBe(
      PREVIEW
    );
    expect(requestFilm).not.toHaveBeenCalled();
  });
});

describe('filmRenewal', () => {
  test('asks the page the same question again, when called', async () => {
    const requestFilm = vi.fn(async () => ({
      playlistUrl: `${FULL}2`,
      expiresAt: EXPIRES,
    }));
    const renew = filmRenewal(allowed, 'guide', requestFilm);
    expect(requestFilm).not.toHaveBeenCalled();
    await expect(renew?.()).resolves.toEqual({
      playlistUrl: `${FULL}2`,
      expiresAt: EXPIRES,
    });
    expect(requestFilm).toHaveBeenCalledWith('guide');
  });

  test('answers null for a rejection or a throw: the film ends, never the preview', async () => {
    const rejects = vi.fn(() => Promise.reject(new Error('503')));
    const throws = vi.fn(() => {
      throw new Error('no remote');
    });
    await expect(
      filmRenewal(allowed, 'intro', rejects)?.()
    ).resolves.toBeNull();
    await expect(filmRenewal(allowed, 'intro', throws)?.()).resolves.toBeNull();
  });

  test.each([
    ['a clip the server did not mark', previewOnly, 'intro' as const, true],
    ['a film with no slot name (the hero)', allowed, undefined, true],
    ['a page that cannot ask (the canvas)', allowed, 'intro' as const, false],
  ])('none for %s: a preview is never renewed', (_label, clip, film, canAsk) => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    expect(
      filmRenewal(clip, film, canAsk ? requestFilm : undefined)
    ).toBeUndefined();
  });
});
