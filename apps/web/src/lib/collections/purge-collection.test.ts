/**
 * purgeLocalCollection tests — Codex-1g5lh.17
 *
 * The collections keep the previous user's rows in TWO places: the
 * localStorage payload and `collection.state`. A clear that only removes the
 * key leaves the rows live in memory, which is where every reader looks.
 *
 * These tests use a hand-rolled fake shaped like a
 * `localStorageCollectionOptions` collection (a `state` Map, a write-through
 * `delete`, and `utils.clearStorage`) rather than a real one. That keeps the
 * ORDER contract explicit and testable: `delete()` writes through to storage,
 * so rows must go before `clearStorage()` or the key comes back holding an
 * empty payload.
 */

import { describe, expect, it, vi } from 'vitest';
import { purgeLocalCollection } from './purge-collection';

/**
 * Minimal stand-in for a localStorage-backed TanStack DB collection.
 *
 * `delete()` writes the remaining rows back to `storage`, mirroring
 * `wrappedOnDelete` → `saveToStorage` in @tanstack/db's local-storage adapter.
 * That write-through is the reason ordering matters.
 */
function fakeCollection(
  keys: string[],
  options: { deleteThrowsFor?: string; storage?: Map<string, string> } = {}
) {
  const state = new Map(keys.map((k) => [k, { id: k }]));
  const storage = options.storage ?? new Map<string, string>();
  storage.set('payload', JSON.stringify(Object.fromEntries(state)));

  return {
    state,
    storage,
    // Signature mirrors TanStack DB's `delete(keys | key)`. The helper only
    // ever passes a single key, so the array arm is unreachable here.
    delete: vi.fn((keys: string | string[]) => {
      const key = Array.isArray(keys) ? keys[0] : keys;
      if (options.deleteThrowsFor === key) {
        throw new Error('collection not synced');
      }
      state.delete(key);
      storage.set('payload', JSON.stringify(Object.fromEntries(state)));
    }),
    utils: {
      clearStorage: vi.fn(() => {
        storage.delete('payload');
      }),
    },
  };
}

describe('purgeLocalCollection', () => {
  it('empties the in-memory state', () => {
    const c = fakeCollection(['a', 'b', 'c']);
    purgeLocalCollection(c);
    expect(c.state.size).toBe(0);
  });

  it('leaves no persisted payload behind', () => {
    // Ordering proof: `delete` writes through, so if clearStorage ran FIRST
    // the payload would be back — present and holding `{}`.
    const c = fakeCollection(['a', 'b']);
    purgeLocalCollection(c);
    expect(c.storage.has('payload')).toBe(false);
  });

  it('deletes every row, not just the first', () => {
    const c = fakeCollection(['a', 'b', 'c']);
    purgeLocalCollection(c);
    expect(c.delete).toHaveBeenCalledTimes(3);
  });

  it('iterates a snapshot, so mutation during the loop is safe', () => {
    // Deleting from a Map while iterating its live `keys()` can skip entries.
    const c = fakeCollection(['a', 'b', 'c', 'd', 'e']);
    purgeLocalCollection(c);
    expect(c.state.size).toBe(0);
  });

  it('keeps going when one row refuses to delete', () => {
    // A collection whose sync has not started can reject a delete. The rest
    // must still go, and clearStorage must still run.
    const c = fakeCollection(['a', 'b', 'c'], { deleteThrowsFor: 'b' });
    expect(() => purgeLocalCollection(c)).not.toThrow();
    expect(c.state.has('a')).toBe(false);
    expect(c.state.has('c')).toBe(false);
    expect(c.utils.clearStorage).toHaveBeenCalled();
    expect(c.storage.has('payload')).toBe(false);
  });

  it('is a no-op for an undefined collection (SSR guard)', () => {
    // Every collection is `browser ? createCollection(...) : undefined`.
    expect(() => purgeLocalCollection(undefined)).not.toThrow();
  });

  it('does not throw when clearStorage is absent or throws', () => {
    const c = fakeCollection(['a']);
    c.utils.clearStorage = vi.fn(() => {
      throw new Error('storage blocked');
    });
    expect(() => purgeLocalCollection(c)).not.toThrow();
    expect(c.state.size).toBe(0);

    const noUtils = { state: new Map([['a', {}]]), delete: vi.fn(), utils: {} };
    expect(() => purgeLocalCollection(noUtils)).not.toThrow();
  });

  it('does not throw when state is unreadable', () => {
    // The annotation is load-bearing: without it TS infers the always-throwing
    // getter's type as `void` and the fixture stops matching the parameter.
    const broken = {
      get state(): ReadonlyMap<string, object> {
        throw new Error('not initialised');
      },
      delete: vi.fn((_keys: string | string[]) => undefined),
      utils: { clearStorage: vi.fn() },
    };
    expect(() => purgeLocalCollection(broken)).not.toThrow();
    // The persisted copy is still dropped even when the rows are unreachable.
    expect(broken.utils.clearStorage).toHaveBeenCalled();
  });
});
