/**
 * Collections Index Tests
 *
 * Tests for the QueryClient configuration and module exports.
 * Note: We mock TanStack DB to avoid queryClient initialization issues.
 */

import { describe, expect, it, vi } from 'vitest';

// Create mock collection with required methods
const mockCollection = {
  state: new Map(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

// Mock TanStack DB before importing
vi.mock('@tanstack/db', () => ({
  createCollection: vi.fn(() => mockCollection),
  localStorageCollectionOptions: vi.fn((options) => options),
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
  not: vi.fn(),
  or: vi.fn(),
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((options) => options),
}));

vi.mock('@tanstack/svelte-db', () => ({
  useLiveQuery: vi.fn(),
}));

// Mock remote functions
vi.mock('$lib/remote/content.remote', () => ({
  listContent: vi.fn(),
}));

vi.mock('$lib/remote/library.remote', () => ({
  getUserLibrary: vi.fn(),
  savePlaybackProgress: vi.fn(),
  getPlaybackProgress: vi.fn(),
}));

vi.mock('$app/environment', () => ({
  browser: false,
}));

describe('collections/index', () => {
  describe('queryClient', () => {
    it('is defined', async () => {
      const { queryClient } = await import('./index');
      expect(queryClient).toBeDefined();
    });

    it('has correct default staleTime', async () => {
      const { queryClient } = await import('./index');
      const defaults = queryClient.getDefaultOptions();
      // 5 minutes = 300,000 ms
      expect(defaults.queries?.staleTime).toBe(1000 * 60 * 5);
    });

    it('has correct default gcTime', async () => {
      const { queryClient } = await import('./index');
      const defaults = queryClient.getDefaultOptions();
      // 30 minutes = 1,800,000 ms
      expect(defaults.queries?.gcTime).toBe(1000 * 60 * 30);
    });

    it('has retry configured', async () => {
      const { queryClient } = await import('./index');
      const defaults = queryClient.getDefaultOptions();
      expect(defaults.queries?.retry).toBe(3);
    });
  });

  describe('TanStack DB exports', () => {
    it('exports createCollection', async () => {
      const { createCollection } = await import('./index');
      expect(createCollection).toBeDefined();
      expect(typeof createCollection).toBe('function');
    });

    it('exports queryCollectionOptions', async () => {
      const { queryCollectionOptions } = await import('./index');
      expect(queryCollectionOptions).toBeDefined();
      expect(typeof queryCollectionOptions).toBe('function');
    });

    it('exports useLiveQuery', async () => {
      const { useLiveQuery } = await import('./index');
      expect(useLiveQuery).toBeDefined();
      expect(typeof useLiveQuery).toBe('function');
    });

    it('exports query operators', async () => {
      const { eq, gt, gte, lt, lte, not, or } = await import('./index');
      expect(eq).toBeDefined();
      expect(gt).toBeDefined();
      expect(gte).toBeDefined();
      expect(lt).toBeDefined();
      expect(lte).toBeDefined();
      expect(not).toBeDefined();
      expect(or).toBeDefined();
    });
  });

  describe('collection exports', () => {
    it('exports contentCollection', async () => {
      const { contentCollection } = await import('./index');
      expect(contentCollection).toBeDefined();
    });

    it('exports libraryCollection', async () => {
      const { libraryCollection } = await import('./index');
      expect(libraryCollection).toBeDefined();
    });

    it('exports progressCollection', async () => {
      const { progressCollection } = await import('./index');
      expect(progressCollection).toBeDefined();
    });
  });

  describe('hydration exports', () => {
    it('exports COLLECTION_KEYS', async () => {
      const { COLLECTION_KEYS } = await import('./index');
      expect(COLLECTION_KEYS).toBeDefined();
      expect(COLLECTION_KEYS.content).toEqual(['content']);
      expect(COLLECTION_KEYS.library).toEqual(['library']);
    });

    it('exports hydration functions', async () => {
      const {
        hydrateCollection,
        hydrateIfNeeded,
        invalidateCollection,
        isCollectionHydrated,
      } = await import('./index');
      expect(hydrateCollection).toBeDefined();
      expect(hydrateIfNeeded).toBeDefined();
      expect(isCollectionHydrated).toBeDefined();
      expect(invalidateCollection).toBeDefined();
    });
  });
});
