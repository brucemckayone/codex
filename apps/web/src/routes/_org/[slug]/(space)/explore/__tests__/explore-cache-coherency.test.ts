/**
 * Cache-coherency contract tests for the org /explore page.
 *
 * Two regression classes covered:
 *
 * 1. **Single-item poisoning** (commit 32487baa): a content-detail page
 *    used to seed the cache with `[data.content]` (1 item). After the
 *    fix, /explore unconditionally hydrates with the SSR payload on
 *    mount, so a stale 1-item cache cannot mask the catalogue.
 *
 * 2. **Cross-org poisoning** (this fix): the cache used a global queryKey
 *    `['content']` shared across orgs. A creator owning multiple orgs
 *    could see Org B's content on Org A's /explore. After the fix, the
 *    queryKey is `['content', orgId]` — different orgs cannot collide.
 *
 * The harness mocks `$lib/collections/query-client` directly because
 * `hydration.ts` imports `queryClient` from `./query-client`, not from
 * the barrel. Mocking the barrel doesn't reach the helpers.
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

vi.mock('$lib/collections/query-client', () => ({
  queryClient: testQueryClient,
}));

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

describe('explore: cache coherency', () => {
  beforeEach(() => {
    testQueryClient.clear();
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  describe('within a single org (single-item poisoning)', () => {
    it('hydrateCollection overwrites a pre-existing single-item cache with the full SSR payload', async () => {
      const { hydrateCollection, COLLECTION_KEYS } = await import(
        '$lib/collections/hydration'
      );

      const stalePoisonItem = {
        id: 'last-purchase',
        title: 'Most recently visited',
      };
      testQueryClient.setQueryData(COLLECTION_KEYS.content(ORG_A), [
        stalePoisonItem,
      ]);
      expect(
        testQueryClient.getQueryData(COLLECTION_KEYS.content(ORG_A))
      ).toHaveLength(1);

      const ssrCatalogue = Array.from({ length: 50 }, (_, i) => ({
        id: `content-${i}`,
        title: `Item ${i}`,
      }));
      hydrateCollection({ kind: 'content', orgId: ORG_A }, ssrCatalogue);

      const result = testQueryClient.getQueryData<typeof ssrCatalogue>(
        COLLECTION_KEYS.content(ORG_A)
      );
      expect(result).toHaveLength(50);
      expect(result?.[0]?.id).toBe('content-0');
      expect(result?.find((i) => i.id === 'last-purchase')).toBeUndefined();
    });

    it('hydrateIfNeeded refuses to overwrite — proves why /explore must NOT use it', async () => {
      const { hydrateIfNeeded, COLLECTION_KEYS } = await import(
        '$lib/collections/hydration'
      );

      const stalePoisonItem = {
        id: 'last-purchase',
        title: 'Most recently visited',
      };
      testQueryClient.setQueryData(COLLECTION_KEYS.content(ORG_A), [
        stalePoisonItem,
      ]);

      const ssrCatalogue = Array.from({ length: 50 }, (_, i) => ({
        id: `content-${i}`,
        title: `Item ${i}`,
      }));
      const didHydrate = hydrateIfNeeded(
        { kind: 'content', orgId: ORG_A },
        ssrCatalogue
      );

      expect(didHydrate).toBe(false);
      const result = testQueryClient.getQueryData<typeof ssrCatalogue>(
        COLLECTION_KEYS.content(ORG_A)
      );
      expect(result).toHaveLength(1);
      expect(result?.[0]?.id).toBe('last-purchase');
    });
  });

  describe('across orgs (cross-org poisoning — the user-reported scenario)', () => {
    it('hydrating Org A does not poison Org B (different queryKeys)', async () => {
      const { hydrateCollection, COLLECTION_KEYS } = await import(
        '$lib/collections/hydration'
      );

      const orgAItems = [
        { id: 'a1', title: 'Of Blood and Bones — Item 1' },
        { id: 'a2', title: 'Of Blood and Bones — Item 2' },
      ];
      const orgBItems = [
        { id: 'b1', title: 'Alpha — Item 1' },
        { id: 'b2', title: 'Alpha — Item 2' },
        { id: 'b3', title: 'Alpha — Item 3' },
      ];

      hydrateCollection({ kind: 'content', orgId: ORG_A }, orgAItems);
      hydrateCollection({ kind: 'content', orgId: ORG_B }, orgBItems);

      // Each org's cache is independent
      expect(
        testQueryClient.getQueryData(COLLECTION_KEYS.content(ORG_A))
      ).toEqual(orgAItems);
      expect(
        testQueryClient.getQueryData(COLLECTION_KEYS.content(ORG_B))
      ).toEqual(orgBItems);
    });

    it('reading Org A returns ONLY Org A items, even after Org B has been hydrated', async () => {
      const { hydrateCollection, COLLECTION_KEYS } = await import(
        '$lib/collections/hydration'
      );

      const orgAItems = [{ id: 'a1', organizationId: ORG_A }];
      const orgBItems = [{ id: 'b1', organizationId: ORG_B }];

      hydrateCollection({ kind: 'content', orgId: ORG_B }, orgBItems);
      hydrateCollection({ kind: 'content', orgId: ORG_A }, orgAItems);

      const orgAResult = testQueryClient.getQueryData<typeof orgAItems>(
        COLLECTION_KEYS.content(ORG_A)
      );
      expect(orgAResult).toEqual(orgAItems);
      expect(
        orgAResult?.find((i) => i.organizationId === ORG_B)
      ).toBeUndefined();
    });

    it('overwriting Org A does not affect Org B', async () => {
      const { hydrateCollection, COLLECTION_KEYS } = await import(
        '$lib/collections/hydration'
      );

      hydrateCollection({ kind: 'content', orgId: ORG_A }, [
        { id: 'a-old', title: 'Stale A' },
      ]);
      hydrateCollection({ kind: 'content', orgId: ORG_B }, [
        { id: 'b1', title: 'Org B item' },
      ]);

      // Re-hydrate Org A with fresh data
      hydrateCollection({ kind: 'content', orgId: ORG_A }, [
        { id: 'a-new-1', title: 'Fresh A 1' },
        { id: 'a-new-2', title: 'Fresh A 2' },
      ]);

      // Org A is updated
      expect(
        testQueryClient.getQueryData(COLLECTION_KEYS.content(ORG_A))
      ).toHaveLength(2);
      // Org B is untouched
      expect(
        testQueryClient.getQueryData(COLLECTION_KEYS.content(ORG_B))
      ).toEqual([{ id: 'b1', title: 'Org B item' }]);
    });

    it('isCollectionHydrated is independently tracked per org', async () => {
      const { hydrateCollection, isCollectionHydrated } = await import(
        '$lib/collections/hydration'
      );

      hydrateCollection({ kind: 'content', orgId: ORG_A }, [
        { id: 'a1', title: 'A' },
      ]);

      expect(isCollectionHydrated({ kind: 'content', orgId: ORG_A })).toBe(
        true
      );
      expect(isCollectionHydrated({ kind: 'content', orgId: ORG_B })).toBe(
        false
      );
    });
  });
});
