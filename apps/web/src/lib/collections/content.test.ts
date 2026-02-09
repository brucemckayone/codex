/**
 * Content Collection Tests
 *
 * Tests for the content collection configuration and helper functions.
 * Note: We mock TanStack DB to avoid queryClient initialization issues.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((options) => options),
}));

// Mock the index to provide queryClient
vi.mock('./index', () => ({
  queryClient: {
    getDefaultOptions: vi.fn(() => ({ queries: {} })),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

// Mock remote functions
vi.mock('$lib/remote/content.remote', () => ({
  listContent: vi.fn(),
}));

describe('collections/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('contentCollection', () => {
    it('is defined with required methods', async () => {
      const { contentCollection } = await import('./content');

      expect(contentCollection).toBeDefined();
      expect(contentCollection.state).toBeDefined();
      expect(typeof contentCollection.insert).toBe('function');
      expect(typeof contentCollection.update).toBe('function');
      expect(typeof contentCollection.delete).toBe('function');
    });
  });

  describe('loadContentForOrg', () => {
    it('is defined and callable', async () => {
      const { loadContentForOrg } = await import('./content');

      expect(loadContentForOrg).toBeDefined();
      expect(typeof loadContentForOrg).toBe('function');
    });
  });

  describe('loadContentWithFilters', () => {
    it('is defined and callable', async () => {
      const { loadContentWithFilters } = await import('./content');

      expect(loadContentWithFilters).toBeDefined();
      expect(typeof loadContentWithFilters).toBe('function');
    });
  });
});
