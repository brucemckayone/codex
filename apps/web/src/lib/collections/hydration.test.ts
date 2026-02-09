/**
 * Hydration Utilities Tests
 *
 * Tests for SSR hydration helpers.
 */

import { QueryClient } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Create a fresh queryClient for testing
let testQueryClient: QueryClient;

// Mock TanStack DB
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
  browser: false,
}));

// We'll import the actual hydration module but mock the index's queryClient
vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>();
  // Create a new QueryClient for each test run
  testQueryClient = new QueryClient();
  return {
    ...actual,
    queryClient: testQueryClient,
  };
});

describe('collections/hydration', () => {
  beforeEach(async () => {
    // Reset query client before each test
    testQueryClient = new QueryClient();

    // Re-mock index with fresh queryClient
    vi.doMock('./index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./index')>();
      return {
        ...actual,
        queryClient: testQueryClient,
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('COLLECTION_KEYS', () => {
    it('has content key', async () => {
      const { COLLECTION_KEYS } = await import('./hydration');
      expect(COLLECTION_KEYS.content).toEqual(['content']);
    });

    it('has library key', async () => {
      const { COLLECTION_KEYS } = await import('./hydration');
      expect(COLLECTION_KEYS.library).toEqual(['library']);
    });
  });

  describe('hydrateCollection', () => {
    it('is defined and callable', async () => {
      const { hydrateCollection } = await import('./hydration');
      expect(hydrateCollection).toBeDefined();
      expect(typeof hydrateCollection).toBe('function');
    });
  });

  describe('isCollectionHydrated', () => {
    it('is defined and callable', async () => {
      const { isCollectionHydrated } = await import('./hydration');
      expect(isCollectionHydrated).toBeDefined();
      expect(typeof isCollectionHydrated).toBe('function');
    });
  });

  describe('hydrateIfNeeded', () => {
    it('is defined and callable', async () => {
      const { hydrateIfNeeded } = await import('./hydration');
      expect(hydrateIfNeeded).toBeDefined();
      expect(typeof hydrateIfNeeded).toBe('function');
    });
  });

  describe('invalidateCollection', () => {
    it('is defined and callable', async () => {
      const { invalidateCollection } = await import('./hydration');
      expect(invalidateCollection).toBeDefined();
      expect(typeof invalidateCollection).toBe('function');
    });

    it('returns a Promise', async () => {
      const { invalidateCollection } = await import('./hydration');
      const result = invalidateCollection('content');
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
