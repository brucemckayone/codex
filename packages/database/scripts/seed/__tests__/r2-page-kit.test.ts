/**
 * The page-kit gallery's sample photographs are seeded (Codex-rlrct).
 *
 * `/studio/page-kit` asks the dev-cdn for `page-kit/img1.jpg` … `img6.jpg`,
 * which it serves from the assets bucket. No seed wrote them, so they existed
 * only where someone had once put them into local R2 by hand, and a fresh
 * checkout's gallery drew every picture empty.
 *
 * The fetchers are mocked: the assets the seed writes are collected here
 * without the network or wrangler.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../placeholders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../placeholders')>();
  const offline = async () => Buffer.from('offline');
  return {
    ...actual,
    fetchPortraitImage: offline,
    fetchRealImage: offline,
    fetchUrlImage: offline,
  };
});

import { collectAssetFiles, pageKitSamplePhotos } from '../r2';

const MOCKUP_ASSETS_DIR = path.resolve(
  import.meta.dirname,
  '../../../../../docs/design/mockup-assets'
);
const KEYS = [1, 2, 3, 4, 5, 6].map((n) => `page-kit/img${n}.jpg`);

describe('the page-kit gallery photographs', () => {
  it('are the six keys the gallery asks for, in the bucket the dev-cdn serves them from', () => {
    const photos = pageKitSamplePhotos();
    expect(photos.map((p) => p.key)).toEqual(KEYS);
    for (const photo of photos) {
      expect(photo.bucket).toBe('codex-assets-test');
      expect(photo.contentType).toBe('image/jpeg');
    }
  });

  it('are the committed mockup images, byte for byte', () => {
    pageKitSamplePhotos().forEach((photo, i) => {
      const committed = fs.readFileSync(
        path.join(MOCKUP_ASSETS_DIR, `img${i + 1}.jpg`)
      );
      expect(Buffer.compare(photo.data as Buffer, committed)).toBe(0);
    });
  });

  it('are among the assets the seed writes', async () => {
    const written = (await collectAssetFiles())
      .filter((f) => f.key.startsWith('page-kit/'))
      .map((f) => `${f.bucket}/${f.key}`);
    expect(written).toEqual(KEYS.map((key) => `codex-assets-test/${key}`));
  });
});
