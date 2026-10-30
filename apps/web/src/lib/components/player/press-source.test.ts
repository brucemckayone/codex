/**
 * Which film a press plays (`press-source.ts`): the full film when it is
 * offered and comes back, the preview whenever asking fails, and, for a film
 * offered in full with NO preview (an intro film can be one), a rejection
 * the player shows as its error, never a made-up address.
 */
import { describe, expect, it } from 'vitest';
import { pressRenewal, pressSource } from './press-source';

const PREVIEW = 'https://cdn.test/hls/m1/preview/preview.m3u8';
const FULL = { playlistUrl: 'https://api.test/film/master.m3u8?token=t' };

describe('pressSource', () => {
  it('plays the preview when nothing is asked', () => {
    expect(pressSource(PREVIEW, undefined)).toBe(PREVIEW);
  });

  it('plays the full film when it comes back', async () => {
    await expect(pressSource(PREVIEW, async () => FULL)).resolves.toBe(FULL);
  });

  it('falls back to the preview on a refusal, a rejection or a throw', async () => {
    await expect(pressSource(PREVIEW, async () => null)).resolves.toBe(PREVIEW);
    await expect(
      pressSource(PREVIEW, () => Promise.reject(new Error('503')))
    ).resolves.toBe(PREVIEW);
    expect(
      pressSource(PREVIEW, () => {
        throw new Error('sync');
      })
    ).toBe(PREVIEW);
  });

  it('with no preview, a failed ask rejects: there is nothing to play', async () => {
    await expect(pressSource(null, async () => null)).rejects.toThrow();
    await expect(
      pressSource(null, () => Promise.reject(new Error('503')))
    ).rejects.toThrow();
    await expect(pressSource(null, async () => FULL)).resolves.toBe(FULL);
  });
});

describe('pressRenewal', () => {
  it('asks again, settling a rejection as null; nothing to renew without an ask', async () => {
    expect(pressRenewal(undefined)).toBeUndefined();
    const renew = pressRenewal(() => Promise.reject(new Error('503')));
    await expect(renew?.()).resolves.toBeNull();
  });
});
