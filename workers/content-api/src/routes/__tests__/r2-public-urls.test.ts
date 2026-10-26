/**
 * `toPublicItem` / `toPublicItems` (r2-public-urls.ts), called directly.
 *
 * The routes' allow-lists for the media item and the org are pinned through
 * the real routes in public-routes.test.ts and content-browse-projection.test.ts.
 * This file pins the two things only the helper itself can show: the creator is
 * rebuilt from named fields too, and a key that no configured base can resolve
 * is reported once per call rather than silently sent as a null URL. The single
 * builder reports it too: the withdrawn read sends one item through it.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type R2PublicBases,
  toPublicItem,
  toPublicItems,
} from '../r2-public-urls';

const BASE = 'https://cdn-assets.test';
const BOTH_BASES: R2PublicBases = { assets: BASE, mediaPreview: BASE };
const NO_BASES: R2PublicBases = { assets: undefined, mediaPreview: undefined };

function row(id: string) {
  return {
    id,
    title: `Piece ${id}`,
    creator: { id: 'creator-1', name: 'Ada' },
    mediaItem: {
      durationSeconds: 60,
      thumbnailKey: `creator-1/media-thumbnails/${id}/md.webp`,
      hlsPreviewKey: `creator-1/hls/${id}/preview/preview.m3u8`,
    },
    organization: null,
  };
}

describe('toPublicItem — the creator is allow-listed too', () => {
  it('sends only the id and name, whatever the row carries', () => {
    const withExtras = {
      ...row('a'),
      creator: {
        id: 'creator-1',
        name: 'Ada',
        email: 'ada@example.com',
        stripeCustomerId: 'cus_123',
      },
    };

    expect(toPublicItem(withExtras, BOTH_BASES).creator).toEqual({
      id: 'creator-1',
      name: 'Ada',
    });
  });
});

describe('toPublicItems — a key no base can resolve is reported', () => {
  it('warns ONCE per call, with counts, when no base is configured', () => {
    const obs = { warn: vi.fn() };

    const items = toPublicItems([row('a'), row('b'), row('c')], NO_BASES, obs);

    expect(items.map((item) => item.mediaItem?.thumbnailUrl)).toEqual([
      null,
      null,
      null,
    ]);
    expect(obs.warn).toHaveBeenCalledTimes(1);
    expect(obs.warn).toHaveBeenCalledWith('r2_public_base.missing', {
      assetsBaseSet: false,
      mediaPreviewBaseSet: false,
      unresolvedThumbnails: 3,
      unresolvedPreviews: 3,
    });
  });

  it('does not warn when every key resolves', () => {
    const obs = { warn: vi.fn() };

    toPublicItems([row('a'), row('b')], BOTH_BASES, obs);

    expect(obs.warn).not.toHaveBeenCalled();
  });
});

describe('toPublicItem — the single item is reported the same way', () => {
  it('warns when its key has no base', () => {
    const obs = { warn: vi.fn() };

    const item = toPublicItem(row('a'), NO_BASES, obs);

    expect(item.mediaItem?.thumbnailUrl).toBeNull();
    expect(obs.warn).toHaveBeenCalledOnce();
    expect(obs.warn).toHaveBeenCalledWith('r2_public_base.missing', {
      assetsBaseSet: false,
      mediaPreviewBaseSet: false,
      unresolvedThumbnails: 1,
      unresolvedPreviews: 1,
    });
  });

  it('does not warn when its keys resolve', () => {
    const obs = { warn: vi.fn() };

    toPublicItem(row('a'), BOTH_BASES, obs);

    expect(obs.warn).not.toHaveBeenCalled();
  });
});
