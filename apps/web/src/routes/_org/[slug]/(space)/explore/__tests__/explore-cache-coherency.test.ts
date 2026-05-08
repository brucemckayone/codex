/**
 * Regression test: org /explore must not be polluted by a content-detail
 * page's single-item hydration of the global ['content'] queryKey.
 *
 * Bug history: contentCollection uses queryKey ['content'] (global, not
 * org-scoped). The org and creator content detail pages used to call
 * `hydrateIfNeeded('content', [data.content])` on mount, which seeded the
 * cache with a 1-item array. The org /explore page then called
 * `hydrateIfNeeded('content', data.content.items)` on mount — but
 * `hydrateIfNeeded` no-ops when the cache is non-empty, so the explore
 * page rendered only the 1 poisoning item until the user navigated to a
 * different filter combination.
 *
 * The fix:
 *   1. Detail pages no longer hydrate contentCollection.
 *   2. Explore unconditionally calls `hydrateCollection` on mount so the
 *      SSR payload is always authoritative.
 *
 * This test verifies the contract that backs (2): even when the cache is
 * pre-populated with a stale single item, `hydrateCollection` replaces it
 * with the fresh payload.
 */

import { QueryClient } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testQueryClient = new QueryClient();

vi.mock('@tanstack/db', () => ({
  createCollection: vi.fn(() => ({
    state: new Map(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
  localStorageCollectionOptions: vi.fn((options) => options),
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((options) => options),
}));

vi.mock('$lib/remote/content.remote', () => ({
  listContent: vi.fn(),
}));

vi.mock('$lib/remote/library.remote', () => ({
  getUserLibrary: vi.fn(),
  savePlaybackProgress: vi.fn(),
  getPlaybackProgress: vi.fn(),
}));

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
}));

// hydration.ts imports `queryClient` from `./query-client`, NOT from `./index`.
// Mocking the index doesn't reach the hydration helpers — we must mock the
// query-client module itself.
vi.mock('$lib/collections/query-client', () => ({
  queryClient: testQueryClient,
}));

describe('explore: contentCollection cache coherency', () => {
  beforeEach(() => {
    testQueryClient.clear();
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  it('hydrateCollection overwrites a pre-existing single-item cache with the full SSR payload', async () => {
    const { hydrateCollection, COLLECTION_KEYS } = await import(
      '$lib/collections/hydration'
    );

    const stalePoisonItem = {
      id: 'last-purchase',
      title: 'Most recently visited',
    };
    testQueryClient.setQueryData(COLLECTION_KEYS.content, [stalePoisonItem]);
    expect(testQueryClient.getQueryData(COLLECTION_KEYS.content)).toHaveLength(
      1
    );

    const ssrCatalogue = Array.from({ length: 50 }, (_, i) => ({
      id: `content-${i}`,
      title: `Item ${i}`,
    }));
    hydrateCollection('content', ssrCatalogue);

    const result = testQueryClient.getQueryData<typeof ssrCatalogue>(
      COLLECTION_KEYS.content
    );
    expect(result).toHaveLength(50);
    expect(result?.[0]?.id).toBe('content-0');
    expect(result?.find((i) => i.id === 'last-purchase')).toBeUndefined();
  });

  it('hydrateIfNeeded is the WRONG helper for /explore — proves the bug we fixed', async () => {
    // This test documents why explore uses `hydrateCollection` instead of
    // `hydrateIfNeeded`. If a future refactor reverts to `hydrateIfNeeded`,
    // this assertion makes the regression visible.
    const { hydrateIfNeeded, COLLECTION_KEYS } = await import(
      '$lib/collections/hydration'
    );

    const stalePoisonItem = {
      id: 'last-purchase',
      title: 'Most recently visited',
    };
    testQueryClient.setQueryData(COLLECTION_KEYS.content, [stalePoisonItem]);

    const ssrCatalogue = Array.from({ length: 50 }, (_, i) => ({
      id: `content-${i}`,
      title: `Item ${i}`,
    }));
    const didHydrate = hydrateIfNeeded('content', ssrCatalogue);

    // hydrateIfNeeded refuses to overwrite — this is exactly the trap the
    // explore page used to fall into. Cache is still the 1 poison item.
    expect(didHydrate).toBe(false);
    const result = testQueryClient.getQueryData<typeof ssrCatalogue>(
      COLLECTION_KEYS.content
    );
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe('last-purchase');
  });
});
