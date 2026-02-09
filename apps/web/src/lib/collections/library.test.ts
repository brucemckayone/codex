/**
 * Library Collection Tests
 *
 * Tests for the library collection and optimistic update helpers.
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
vi.mock('$lib/remote/library.remote', () => ({
  getUserLibrary: vi.fn(),
  savePlaybackProgress: vi.fn(),
}));

describe('collections/library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('libraryCollection', () => {
    it('is defined with required methods', async () => {
      const { libraryCollection } = await import('./library');

      expect(libraryCollection).toBeDefined();
      expect(libraryCollection.state).toBeDefined();
      expect(typeof libraryCollection.insert).toBe('function');
      expect(typeof libraryCollection.update).toBe('function');
      expect(typeof libraryCollection.delete).toBe('function');
    });
  });

  describe('updateProgress', () => {
    it('is defined and callable', async () => {
      const { updateProgress } = await import('./library');

      expect(updateProgress).toBeDefined();
      expect(typeof updateProgress).toBe('function');
    });

    it('accepts contentId, positionSeconds, and durationSeconds', async () => {
      const { updateProgress } = await import('./library');
      // Function signature check - it should accept 3 parameters
      expect(updateProgress.length).toBe(3);
    });
  });

  describe('markAsCompleted', () => {
    it('is defined and callable', async () => {
      const { markAsCompleted } = await import('./library');

      expect(markAsCompleted).toBeDefined();
      expect(typeof markAsCompleted).toBe('function');
    });

    it('accepts contentId and durationSeconds', async () => {
      const { markAsCompleted } = await import('./library');
      // Function signature check - it should accept 2 parameters
      expect(markAsCompleted.length).toBe(2);
    });
  });

  describe('resetProgress', () => {
    it('is defined and callable', async () => {
      const { resetProgress } = await import('./library');

      expect(resetProgress).toBeDefined();
      expect(typeof resetProgress).toBe('function');
    });

    it('accepts contentId', async () => {
      const { resetProgress } = await import('./library');
      // Function signature check - it should accept 1 parameter
      expect(resetProgress.length).toBe(1);
    });
  });
});
