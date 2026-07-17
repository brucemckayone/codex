/**
 * Unit tests for the pure continue-watching selector.
 *
 * These run without a database or browser — the selection rule is a pure
 * function over raw library items. The DB-backed remote (`getContinueWatching`
 * in `library.remote.ts`) delegates to this function, so exercising it here is
 * the authoritative coverage of the filter/sort/cap/map behaviour.
 */

import type { UserLibraryResponse } from '@codex/access';
import { describe, expect, it } from 'vitest';
import {
  CONTINUE_WATCHING_LIMIT,
  isInProgress,
  selectContinueWatching,
} from './continue-watching';

type LibraryItem = UserLibraryResponse['items'][number];
type LibraryProgress = NonNullable<LibraryItem['progress']>;

interface ItemOverrides {
  id?: string;
  title?: string;
  slug?: string;
  contentType?: string;
  organizationSlug?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  progress?: LibraryProgress | null;
}

/** Build a fully-shaped library item; `progress` is explicit (default: null). */
function makeItem(overrides: ItemOverrides = {}): LibraryItem {
  const {
    id = 'c1',
    title = 'Title',
    slug = 'title',
    contentType = 'video',
    organizationSlug = 'studio-alpha',
    thumbnailUrl = 'https://cdn/thumb.webp',
    durationSeconds = 600,
    progress = null,
  } = overrides;

  return {
    content: {
      id,
      slug,
      title,
      description: 'desc',
      thumbnailUrl,
      contentType,
      durationSeconds,
      organizationId: 'org-1',
      organizationSlug,
    },
    accessType: 'purchased',
    purchase: null,
    progress,
  };
}

/** Build a progress record with sensible completed/percent defaults. */
function makeProgress(
  overrides: Partial<LibraryProgress> = {}
): LibraryProgress {
  const positionSeconds = overrides.positionSeconds ?? 120;
  const durationSeconds = overrides.durationSeconds ?? 600;
  return {
    positionSeconds,
    durationSeconds,
    completed: overrides.completed ?? false,
    percentComplete:
      overrides.percentComplete ??
      Math.round((positionSeconds / durationSeconds) * 100),
    updatedAt: overrides.updatedAt ?? '2026-07-16T10:00:00.000Z',
  };
}

describe('selectContinueWatching', () => {
  it('returns an empty array for empty input', () => {
    expect(selectContinueWatching([])).toEqual([]);
  });

  it('keeps started-but-not-completed items', () => {
    const items = [makeItem({ id: 'in-progress', progress: makeProgress() })];
    const result = selectContinueWatching(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('in-progress');
  });

  it('filters out completed items', () => {
    const items = [
      makeItem({
        id: 'done',
        progress: makeProgress({ completed: true, percentComplete: 100 }),
      }),
    ];
    expect(selectContinueWatching(items)).toEqual([]);
  });

  it('filters out zero-progress items', () => {
    const items = [
      makeItem({
        id: 'untouched',
        progress: makeProgress({ positionSeconds: 0, percentComplete: 0 }),
      }),
    ];
    expect(selectContinueWatching(items)).toEqual([]);
  });

  it('filters out items with no progress record', () => {
    const items = [makeItem({ id: 'no-progress', progress: null })];
    expect(selectContinueWatching(items)).toEqual([]);
  });

  it('sorts by most-recent progress (updatedAt DESC)', () => {
    const items = [
      makeItem({
        id: 'oldest',
        progress: makeProgress({ updatedAt: '2026-07-14T00:00:00.000Z' }),
      }),
      makeItem({
        id: 'newest',
        progress: makeProgress({ updatedAt: '2026-07-16T00:00:00.000Z' }),
      }),
      makeItem({
        id: 'middle',
        progress: makeProgress({ updatedAt: '2026-07-15T00:00:00.000Z' }),
      }),
    ];
    const result = selectContinueWatching(items);
    expect(result.map((i) => i.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('caps the result to the provided limit', () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      makeItem({
        id: `c${index}`,
        progress: makeProgress({
          updatedAt: `2026-07-16T00:00:${String(index).padStart(2, '0')}.000Z`,
        }),
      })
    );
    expect(selectContinueWatching(items, { limit: 5 })).toHaveLength(5);
  });

  it('defaults to CONTINUE_WATCHING_LIMIT when no limit is given', () => {
    const items = Array.from(
      { length: CONTINUE_WATCHING_LIMIT + 8 },
      (_, index) =>
        makeItem({
          id: `c${index}`,
          progress: makeProgress({
            updatedAt: `2026-07-16T00:00:${String(index).padStart(2, '0')}.000Z`,
          }),
        })
    );
    expect(selectContinueWatching(items)).toHaveLength(CONTINUE_WATCHING_LIMIT);
  });

  it('returns an empty array for a non-positive limit', () => {
    const items = [makeItem({ progress: makeProgress() })];
    expect(selectContinueWatching(items, { limit: 0 })).toEqual([]);
    expect(selectContinueWatching(items, { limit: -3 })).toEqual([]);
  });

  it('maps every field onto the compact resume shape', () => {
    const progress = makeProgress({
      positionSeconds: 300,
      durationSeconds: 600,
      percentComplete: 50,
      updatedAt: '2026-07-16T09:30:00.000Z',
    });
    const items = [
      makeItem({
        id: 'content-42',
        title: 'Deep Focus',
        slug: 'deep-focus',
        contentType: 'audio',
        organizationSlug: 'studio-beta',
        thumbnailUrl: 'https://cdn/deep-focus.webp',
        durationSeconds: 600,
        progress,
      }),
    ];

    const [item] = selectContinueWatching(items);
    expect(item).toEqual({
      id: 'content-42',
      title: 'Deep Focus',
      slug: 'deep-focus',
      organizationSlug: 'studio-beta',
      thumbnail: 'https://cdn/deep-focus.webp',
      contentType: 'audio',
      duration: 600,
      progress,
    });
  });

  it('maps the "written" content type to "article"', () => {
    const items = [
      makeItem({
        id: 'essay',
        contentType: 'written',
        progress: makeProgress(),
      }),
    ];
    expect(selectContinueWatching(items)[0].contentType).toBe('article');
  });

  it('preserves null thumbnail and null organizationSlug', () => {
    const items = [
      makeItem({
        id: 'orphan',
        thumbnailUrl: null,
        organizationSlug: null,
        progress: makeProgress(),
      }),
    ];
    const [item] = selectContinueWatching(items);
    expect(item.thumbnail).toBeNull();
    expect(item.organizationSlug).toBeNull();
  });

  it('does not mutate the input array', () => {
    const items = [
      makeItem({
        id: 'a',
        progress: makeProgress({ updatedAt: '2026-07-14T00:00:00.000Z' }),
      }),
      makeItem({
        id: 'b',
        progress: makeProgress({ updatedAt: '2026-07-16T00:00:00.000Z' }),
      }),
    ];
    const originalOrder = items.map((i) => i.content.id);
    selectContinueWatching(items);
    expect(items.map((i) => i.content.id)).toEqual(originalOrder);
  });
});

describe('isInProgress', () => {
  it('is true only for started, non-completed progress', () => {
    expect(isInProgress(makeItem({ progress: makeProgress() }))).toBe(true);
  });

  it('is false for null progress', () => {
    expect(isInProgress(makeItem({ progress: null }))).toBe(false);
  });

  it('is false at zero position', () => {
    expect(
      isInProgress(makeItem({ progress: makeProgress({ positionSeconds: 0 }) }))
    ).toBe(false);
  });

  it('is false when completed', () => {
    expect(
      isInProgress(makeItem({ progress: makeProgress({ completed: true }) }))
    ).toBe(false);
  });
});
