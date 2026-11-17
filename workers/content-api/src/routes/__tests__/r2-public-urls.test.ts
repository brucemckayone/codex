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

import type { PublicContentItem, PublicContentRow } from '@codex/content';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  type PublicItem,
  type R2PublicBases,
  toPublicItem,
  toPublicItems,
  withPosterUrls,
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

    expect(toPublicItem(withExtras, BOTH_BASES, undefined).creator).toEqual({
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

describe('the documented item is the built item', () => {
  it('builds exactly @codex/content PublicContentItem from a listPublic row', () => {
    // A compile-time check: `PublicContentListResponse`, which the routes
    // name in their @returns, used to be declared apart from what this module
    // builds, and had drifted (no categorySlugs).
    expectTypeOf<PublicItem<PublicContentRow>>().toExtend<PublicContentItem>();
    expectTypeOf<PublicContentItem>().toExtend<PublicItem<PublicContentRow>>();
  });
});

describe('withPosterUrls — the studio list resolves its posters (Codex-a6ofh.3.1)', () => {
  /** A studio row: the creator's own, its media item whole. */
  function studioRow(id: string, thumbnailKey: string | null) {
    return {
      id,
      title: `Piece ${id}`,
      mediaItem: {
        id: `media-${id}`,
        status: 'ready',
        thumbnailKey,
        hlsPreviewKey: null,
      },
    };
  }

  it('puts the poster URL beside the key, keeping the rest of the row', () => {
    const [item] = withPosterUrls(
      [studioRow('a', 'creator-1/media-thumbnails/a/md.webp')],
      BOTH_BASES,
      { warn: vi.fn() }
    );

    expect(item).toEqual({
      id: 'a',
      title: 'Piece a',
      mediaItem: {
        id: 'media-a',
        status: 'ready',
        thumbnailKey: 'creator-1/media-thumbnails/a/md.webp',
        hlsPreviewKey: null,
        thumbnailUrl: `${BASE}/creator-1/media-thumbnails/a/md.webp`,
      },
    });
  });

  it('leaves a row with no media as it is, and a media item with no poster null', () => {
    const items = withPosterUrls(
      [{ id: 'b', title: 'Piece b', mediaItem: null }, studioRow('c', null)],
      BOTH_BASES,
      { warn: vi.fn() }
    );

    expect(items[0]?.mediaItem).toBeNull();
    expect(items[1]?.mediaItem?.thumbnailUrl).toBeNull();
  });

  it('warns once for the page when no base can resolve a poster', () => {
    const obs = { warn: vi.fn() };

    withPosterUrls([studioRow('d', 'k1'), studioRow('e', 'k2')], NO_BASES, obs);

    expect(obs.warn).toHaveBeenCalledTimes(1);
    expect(obs.warn).toHaveBeenCalledWith(
      'r2_public_base.missing',
      expect.objectContaining({ unresolvedThumbnails: 2 })
    );
  });
});
