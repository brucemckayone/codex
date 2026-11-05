import { describe, expect, it } from 'vitest';
import type { MediaItemWithRelations } from '$lib/types';
import { mediaFacts } from './media-facts';

const media = (overrides: Record<string, unknown>) =>
  overrides as unknown as MediaItemWithRelations;

describe('mediaFacts', () => {
  it('names every fact the item has, in the mockup order', () => {
    const facts = mediaFacts(
      media({
        durationSeconds: 2538,
        width: 1920,
        height: 1080,
        fileSizeBytes: 1.8 * 1024 ** 3,
        readyVariants: ['1080p', '720p'],
        loudnessIntegrated: -1600,
        createdAt: '2026-09-26T10:00:00.000Z',
      })
    );
    expect(facts.map((f) => f.label)).toEqual([
      'Duration',
      'Resolution',
      'Size',
      'Variants',
      'Loudness',
      'Added',
    ]);
    expect(facts.find((f) => f.label === 'Loudness')?.value).toBe('-16.0 LUFS');
  });

  it('leaves out what is not known: an audio file has no resolution, a raw upload no variants', () => {
    const facts = mediaFacts(
      media({
        width: null,
        height: null,
        readyVariants: [],
        loudnessIntegrated: null,
      })
    );
    expect(facts).toEqual([]);
  });

  it('reads 0 LUFS as a value, not as missing', () => {
    expect(mediaFacts(media({ loudnessIntegrated: 0 }))[0]).toEqual({
      label: 'Loudness',
      value: '0.0 LUFS',
    });
  });
});
