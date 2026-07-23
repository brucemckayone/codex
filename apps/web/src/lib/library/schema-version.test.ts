/**
 * Library schema-version reconcile tests.
 *
 * Locks the R-B mitigation (HARDENING §E): a course-grouping schema change
 * must NOT strand old localStorage payloads. The reconcile pass runs before
 * the collection is created and:
 *   - hydrates a current-version payload unchanged (fast path),
 *   - adopts an unstamped payload at the introduction version WITHOUT
 *     discarding (behaviour-preserving for existing users), and
 *   - discards/migrates an incompatible older payload (never hydrated as-is).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_SCHEMA_STORAGE_KEY,
  LIBRARY_SCHEMA_VERSION,
  LIBRARY_STORAGE_KEY,
  type LibrarySchemaMigrations,
  reconcileLibrarySchemaVersion,
} from './schema-version';

/** Minimal in-memory Storage stand-in (independent of jsdom global state). */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    // test helpers
    has: (k: string) => map.has(k),
    peek: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
  };
}

// A realistic TanStack-DB localStorage blob: { [id]: { versionKey, data } }.
const PAYLOAD = JSON.stringify({
  'content-1': { versionKey: 'v-uuid', data: { content: { id: 'content-1' } } },
});

describe('reconcileLibrarySchemaVersion', () => {
  describe('current-version data hydrates unchanged', () => {
    it('is a no-op when the stamp already matches the current version', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: String(LIBRARY_SCHEMA_VERSION),
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });

      const outcome = reconcileLibrarySchemaVersion(storage);

      expect(outcome).toBe('current');
      // Payload untouched — this is the "hydrate as-is" guarantee.
      expect(storage.peek(LIBRARY_STORAGE_KEY)).toBe(PAYLOAD);
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe(
        String(LIBRARY_SCHEMA_VERSION)
      );
    });

    it('injected current version matches an injected stamp (fast path)', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: '3',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });

      expect(
        reconcileLibrarySchemaVersion(storage, { currentVersion: 3 })
      ).toBe('current');
      expect(storage.peek(LIBRARY_STORAGE_KEY)).toBe(PAYLOAD);
    });
  });

  describe('old-version data is discarded, never stranded (R-B)', () => {
    it('discards a payload stamped with an older version when no migration exists', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: '1',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });

      // Simulate the future course-grouping bump: current is now v2.
      const outcome = reconcileLibrarySchemaVersion(storage, {
        currentVersion: 2,
        introductionVersion: 1,
      });

      expect(outcome).toBe('discarded');
      // The stale payload is GONE (self-heals via loadLibraryFromServer on
      // mount) rather than hydrated with a shape the new code can't read.
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
      // Stamp advanced so the discard happens exactly once.
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe('2');
    });

    it('discards an UNSTAMPED payload once past the introduction version', () => {
      // No stamp, but we are already at v2 — the payload predates stamping and
      // its shape cannot be trusted against v2.
      const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: PAYLOAD });

      const outcome = reconcileLibrarySchemaVersion(storage, {
        currentVersion: 2,
        introductionVersion: 1,
      });

      expect(outcome).toBe('discarded');
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe('2');
    });

    it('treats a corrupt stamp as incompatible when past the introduction version', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: 'not-a-number',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });

      expect(
        reconcileLibrarySchemaVersion(storage, {
          currentVersion: 2,
          introductionVersion: 1,
        })
      ).toBe('discarded');
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
    });
  });

  describe('migration seam', () => {
    it('migrates an older payload in place when a migration is registered', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: '1',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });
      const MIGRATED = JSON.stringify({ migrated: true });
      const migrations: LibrarySchemaMigrations = {
        1: vi.fn(() => MIGRATED),
      };

      const outcome = reconcileLibrarySchemaVersion(storage, {
        currentVersion: 2,
        introductionVersion: 1,
        migrations,
      });

      expect(outcome).toBe('migrated');
      expect(migrations[1]).toHaveBeenCalledWith(PAYLOAD);
      expect(storage.peek(LIBRARY_STORAGE_KEY)).toBe(MIGRATED);
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe('2');
    });

    it('falls back to discard when the migration returns null', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: '1',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });
      const migrations: LibrarySchemaMigrations = { 1: () => null };

      expect(
        reconcileLibrarySchemaVersion(storage, {
          currentVersion: 2,
          introductionVersion: 1,
          migrations,
        })
      ).toBe('discarded');
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
    });

    it('falls back to discard when the migration throws', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: '1',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });
      const migrations: LibrarySchemaMigrations = {
        1: () => {
          throw new Error('bad migration');
        },
      };

      expect(
        reconcileLibrarySchemaVersion(storage, {
          currentVersion: 2,
          introductionVersion: 1,
          migrations,
        })
      ).toBe('discarded');
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
    });
  });

  describe('introduction bootstrap is behaviour-preserving', () => {
    it('adopts an unstamped payload at the introduction version WITHOUT discarding', () => {
      const storage = memoryStorage({ [LIBRARY_STORAGE_KEY]: PAYLOAD });

      const outcome = reconcileLibrarySchemaVersion(storage, {
        currentVersion: 1,
        introductionVersion: 1,
      });

      expect(outcome).toBe('initialized');
      // Existing data is kept — no empty-library flash for current users.
      expect(storage.peek(LIBRARY_STORAGE_KEY)).toBe(PAYLOAD);
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe('1');
    });

    it('adopts an unstamped corrupt-stamp payload at the introduction version', () => {
      const storage = memoryStorage({
        [LIBRARY_SCHEMA_STORAGE_KEY]: 'garbage',
        [LIBRARY_STORAGE_KEY]: PAYLOAD,
      });

      expect(
        reconcileLibrarySchemaVersion(storage, {
          currentVersion: 1,
          introductionVersion: 1,
        })
      ).toBe('initialized');
      expect(storage.peek(LIBRARY_STORAGE_KEY)).toBe(PAYLOAD);
    });

    it('records the stamp on a fresh (empty) store', () => {
      const storage = memoryStorage();

      expect(reconcileLibrarySchemaVersion(storage)).toBe('initialized');
      expect(storage.peek(LIBRARY_SCHEMA_STORAGE_KEY)).toBe(
        String(LIBRARY_SCHEMA_VERSION)
      );
      expect(storage.has(LIBRARY_STORAGE_KEY)).toBe(false);
    });
  });

  describe('storage safety', () => {
    it('is a no-op when storage is null/undefined (SSR)', () => {
      expect(reconcileLibrarySchemaVersion(null)).toBe('unavailable');
      expect(reconcileLibrarySchemaVersion(undefined)).toBe('unavailable');
    });

    it('never throws when localStorage access throws (blocked storage)', () => {
      const throwing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      };

      expect(reconcileLibrarySchemaVersion(throwing)).toBe('unavailable');
    });
  });
});
