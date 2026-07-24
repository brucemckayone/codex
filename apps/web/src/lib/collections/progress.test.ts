/**
 * Progress Collection Tests
 *
 * Tests for the localStorage-backed progress collection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllProgress,
  clearProgress,
  getProgress,
  getUnsyncedCompletions,
  isPracticeComplete,
  loadCourseCompletionsFromServer,
  markPracticeComplete,
  mergeServerProgress,
  progressCollection,
  syncProgressToServer,
  updateLocalProgress,
} from './progress';

// A synchronous, Map-backed stand-in for the TanStack DB localStorage
// collection: the real one doesn't reflect writes synchronously in jsdom, so
// the codebase mocks `@tanstack/db` in collection tests (see library.test.ts).
// Here `insert`/`update`/`delete` mutate the Map immediately so read-after-write
// assertions on the store logic are deterministic. `vi.hoisted` + hoisted
// `vi.mock` run before the imports above resolve, so the mocks are in place.
const { mockCollection } = vi.hoisted(() => {
  const state = new Map<string, Record<string, unknown>>();
  return {
    mockCollection: {
      state,
      insert: (item: { contentId: string }) => {
        state.set(item.contentId, { ...item });
      },
      update: (
        key: string,
        updater: (draft: Record<string, unknown>) => void
      ) => {
        const current = state.get(key);
        if (!current) return;
        const draft = { ...current };
        updater(draft);
        state.set(key, draft);
      },
      delete: (key: string) => {
        state.delete(key);
      },
    },
  };
});

vi.mock('@tanstack/db', () => ({
  createCollection: () => mockCollection,
  localStorageCollectionOptions: (options: unknown) => options,
}));

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}));

vi.mock('$lib/remote/library.remote', () => ({
  savePlaybackProgress: vi.fn(async () => ({})),
  getPlaybackProgress: vi.fn(async () => ({
    positionSeconds: 0,
    durationSeconds: 0,
    completed: false,
    updatedAt: null,
  })),
}));

// The mark-complete command is exercised by its own contract; here the store
// unit test mocks it so the optimistic write is hermetic (no network).
vi.mock('$lib/remote/journeys.remote', () => ({
  markPracticeCompleted: vi.fn(async (input: { contentId: string }) => ({
    contentId: input.contentId,
    completedAt: new Date().toISOString(),
    source: 'manual' as const,
  })),
}));

describe('collections/progress', () => {
  describe('progressCollection', () => {
    it('is defined', () => {
      expect(progressCollection).toBeDefined();
    });

    it('has a state property (TanStack DB collection)', () => {
      expect(progressCollection.state).toBeDefined();
    });

    it('has insert method', () => {
      expect(typeof progressCollection.insert).toBe('function');
    });

    it('has update method', () => {
      expect(typeof progressCollection.update).toBe('function');
    });

    it('has delete method', () => {
      expect(typeof progressCollection.delete).toBe('function');
    });
  });

  describe('updateLocalProgress', () => {
    it('is defined and callable', () => {
      expect(updateLocalProgress).toBeDefined();
      expect(typeof updateLocalProgress).toBe('function');
    });

    it('accepts contentId, positionSeconds, and durationSeconds', () => {
      expect(updateLocalProgress.length).toBe(3);
    });
  });

  describe('syncProgressToServer', () => {
    it('is defined and callable', () => {
      expect(syncProgressToServer).toBeDefined();
      expect(typeof syncProgressToServer).toBe('function');
    });

    it('returns a Promise', () => {
      // Should return a Promise (async function)
      const result = syncProgressToServer();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('mergeServerProgress', () => {
    it('is defined and callable', () => {
      expect(mergeServerProgress).toBeDefined();
      expect(typeof mergeServerProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(mergeServerProgress.length).toBe(1);
    });
  });

  describe('getProgress', () => {
    it('is defined and callable', () => {
      expect(getProgress).toBeDefined();
      expect(typeof getProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(getProgress.length).toBe(1);
    });

    it('returns null for non-existent content', () => {
      const result = getProgress('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('clearProgress', () => {
    it('is defined and callable', () => {
      expect(clearProgress).toBeDefined();
      expect(typeof clearProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(clearProgress.length).toBe(1);
    });
  });

  describe('clearAllProgress', () => {
    it('is defined and callable', () => {
      expect(clearAllProgress).toBeDefined();
      expect(typeof clearAllProgress).toBe('function');
    });

    it('accepts no arguments', () => {
      expect(clearAllProgress.length).toBe(0);
    });
  });

  // ── Course completion (F19 store extension · SPEC §11 / D-E) ───────────────
  describe('course completion', () => {
    const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
    beforeEach(() => clearAllProgress());

    it('markPracticeComplete optimistically writes the completion row', () => {
      markPracticeComplete(ID, 'manual');
      expect(isPracticeComplete(ID)).toBe(true);
      const row = getProgress(ID);
      expect(row?.practiceCompletedAt).toBeTruthy();
      expect(row?.practiceCompletionSource).toBe('manual');
      // Optimistic: not yet confirmed by the server (sync runs async).
      expect(row?.practiceCompletionSyncedAt).toBeNull();
    });

    it('records the completion source (auto for media finish)', () => {
      markPracticeComplete(ID, 'auto');
      expect(getProgress(ID)?.practiceCompletionSource).toBe('auto');
    });

    it('is idempotent — a second mark does not overwrite the first', () => {
      markPracticeComplete(ID, 'auto');
      const first = getProgress(ID)?.practiceCompletedAt;
      markPracticeComplete(ID, 'manual');
      const row = getProgress(ID);
      expect(row?.practiceCompletedAt).toBe(first);
      expect(row?.practiceCompletionSource).toBe('auto');
    });

    it('surfaces unsynced completions until they persist', () => {
      markPracticeComplete(ID, 'manual');
      expect(getUnsyncedCompletions().map((e) => e.contentId)).toContain(ID);
    });

    it('does not treat playback-only progress as a completion', () => {
      updateLocalProgress(ID, 10, 100);
      expect(isPracticeComplete(ID)).toBe(false);
      expect(getUnsyncedCompletions()).toHaveLength(0);
    });

    it('loadCourseCompletionsFromServer hydrates rows as already-synced', () => {
      loadCourseCompletionsFromServer([
        {
          contentId: ID,
          completedAt: '2026-07-01T00:00:00.000Z',
          source: 'auto',
        },
      ]);
      const row = getProgress(ID);
      expect(row?.practiceCompletedAt).toBe('2026-07-01T00:00:00.000Z');
      expect(row?.practiceCompletionSource).toBe('auto');
      expect(row?.practiceCompletionSyncedAt).toBeTruthy();
      // Server-known ⇒ not queued for re-sync.
      expect(getUnsyncedCompletions()).toHaveLength(0);
    });

    it('preserves existing playback fields when hydrating a completion', () => {
      updateLocalProgress(ID, 42, 100);
      loadCourseCompletionsFromServer([
        {
          contentId: ID,
          completedAt: '2026-07-01T00:00:00.000Z',
          source: 'manual',
        },
      ]);
      const row = getProgress(ID);
      expect(row?.positionSeconds).toBe(42);
      expect(row?.practiceCompletedAt).toBe('2026-07-01T00:00:00.000Z');
    });
  });
});
