/**
 * Content Collection Tests
 *
 * Tests for the org-scoped content collection factory.
 * Note: We mock TanStack DB to avoid queryClient initialization issues.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCollection = {
  state: new Map(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@tanstack/db', () => ({
  createCollection: vi.fn(() => mockCollection),
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((options) => options),
}));

vi.mock('./query-client', () => ({
  queryClient: {
    getDefaultOptions: vi.fn(() => ({ queries: {} })),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

vi.mock('$lib/remote/content.remote', () => ({
  listContent: vi.fn(),
}));

describe('collections/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getContentCollection', () => {
    it('returns a collection instance for an orgId', async () => {
      const { getContentCollection } = await import('./content');
      const collection = getContentCollection('org-a');
      expect(collection).toBeDefined();
      expect(collection?.state).toBeDefined();
      expect(typeof collection?.insert).toBe('function');
    });

    it('returns the SAME instance for the same orgId (collection identity)', async () => {
      const { getContentCollection } = await import('./content');
      const a1 = getContentCollection('org-a');
      const a2 = getContentCollection('org-a');
      // TanStack DB live queries subscribe by collection identity — repeated
      // calls must return the same reference or subscriptions go stale.
      expect(a1).toBe(a2);
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
