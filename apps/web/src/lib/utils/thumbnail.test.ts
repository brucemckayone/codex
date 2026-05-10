import { describe, expect, it } from 'vitest';
import { getDisplayThumbnail } from './thumbnail';

describe('getDisplayThumbnail', () => {
  it('returns null for null/undefined content', () => {
    expect(getDisplayThumbnail(null)).toBeNull();
    expect(getDisplayThumbnail(undefined)).toBeNull();
  });

  it('returns the custom thumbnailUrl when set, regardless of media type', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: 'https://cdn/custom.webp',
        contentType: 'video',
        mediaItem: { thumbnailUrl: 'https://cdn/auto.webp' },
      })
    ).toBe('https://cdn/custom.webp');

    expect(
      getDisplayThumbnail({
        thumbnailUrl: 'https://cdn/custom-audio.webp',
        contentType: 'audio',
        mediaItem: null,
      })
    ).toBe('https://cdn/custom-audio.webp');

    expect(
      getDisplayThumbnail({
        thumbnailUrl: 'https://cdn/custom-written.webp',
        contentType: 'written',
      })
    ).toBe('https://cdn/custom-written.webp');
  });

  it('falls back to mediaItem.thumbnailUrl for video when no custom thumbnail', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: null,
        contentType: 'video',
        mediaItem: { thumbnailUrl: 'https://cdn/auto-poster.webp' },
      })
    ).toBe('https://cdn/auto-poster.webp');
  });

  it('returns null for audio when no custom thumbnail and no mediaItem.thumbnailUrl', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: null,
        contentType: 'audio',
        mediaItem: { thumbnailUrl: null },
      })
    ).toBeNull();

    expect(
      getDisplayThumbnail({
        thumbnailUrl: null,
        contentType: 'audio',
        mediaItem: null,
      })
    ).toBeNull();
  });

  it('returns null for written content with no thumbnail', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: null,
        contentType: 'written',
        mediaItem: null,
      })
    ).toBeNull();
  });

  it('treats empty string thumbnailUrl as falsy and falls back', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: '',
        contentType: 'video',
        mediaItem: { thumbnailUrl: 'https://cdn/auto.webp' },
      })
    ).toBe('https://cdn/auto.webp');
  });

  it('handles missing mediaItem gracefully', () => {
    expect(
      getDisplayThumbnail({
        thumbnailUrl: null,
        contentType: 'video',
      })
    ).toBeNull();
  });
});
