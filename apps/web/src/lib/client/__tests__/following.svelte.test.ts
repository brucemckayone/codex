/**
 * followingStore tests
 *
 * Locks the localStorage-backed reactive contract used to replace the
 * 847ms server-side `isFollowing` stream from `_org/[slug]/+layout.server.ts`
 * (Codex-ltfk / Codex-dljb, auth-performance Quick Win #2).
 *
 * Behaviours under test:
 *   - get() returns false for unknown orgs (logged-out / first visit)
 *   - has() distinguishes "no entry" from "explicit false"
 *   - set() persists to localStorage and updates state
 *   - hydrate() respects existing values (no clobbering optimistic updates)
 *
 * `$state()` lives at module scope so we use `vi.resetModules()` between
 * tests + dynamic `import()` to get a fresh store. localStorage is cleared
 * in `beforeEach` to avoid bleed between tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'codex-following';

async function loadStore() {
  // Dynamic import after each reset — re-evaluates module-level $state()
  const mod = await import('../following.svelte');
  return mod.followingStore;
}

describe('followingStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('get', () => {
    it('returns false for unknown org (first visit, no localStorage entry)', async () => {
      const store = await loadStore();
      expect(store.get('org-1')).toBe(false);
    });

    it('returns hydrated value when entry exists', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();
      expect(store.get('org-1')).toBe(true);
    });

    it('returns false when stored value is explicitly false', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': false }));
      const store = await loadStore();
      expect(store.get('org-1')).toBe(false);
    });

    it('returns false for malformed JSON (graceful degradation)', async () => {
      localStorage.setItem(STORAGE_KEY, 'not json');
      const store = await loadStore();
      expect(store.get('org-1')).toBe(false);
    });
  });

  describe('has', () => {
    it('returns false when no entry exists for the org', async () => {
      const store = await loadStore();
      expect(store.has('org-1')).toBe(false);
    });

    it('returns true when entry exists, even if value is false', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': false }));
      const store = await loadStore();
      // Critical for the layout: skips redundant /api/follow/me hydration
      // when localStorage already says "user explicitly does not follow".
      expect(store.has('org-1')).toBe(true);
    });

    it('returns true when entry value is true', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();
      expect(store.has('org-1')).toBe(true);
    });
  });

  describe('set', () => {
    it('persists to localStorage', async () => {
      const store = await loadStore();
      store.set('org-1', true);
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({ 'org-1': true });
    });

    it('updates an existing entry', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();
      store.set('org-1', false);
      expect(store.get('org-1')).toBe(false);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        'org-1': false,
      });
    });

    it('coexists with other org entries', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();
      store.set('org-2', true);
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
      expect(persisted).toEqual({ 'org-1': true, 'org-2': true });
    });
  });

  describe('hydrate', () => {
    it('writes the value when no entry exists', async () => {
      const store = await loadStore();
      store.hydrate('org-1', true);
      expect(store.get('org-1')).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        'org-1': true,
      });
    });

    it('does not overwrite an existing optimistic update', async () => {
      // Simulates: user clicks Follow (set true) → server hydration tries to
      // backfill with stale "false" from a slow follow-state query.
      // Without the guard, the button would flip back to "Follow" briefly.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();
      store.hydrate('org-1', false);
      expect(store.get('org-1')).toBe(true);
    });

    it('does not overwrite an explicit false from a previous session', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': false }));
      const store = await loadStore();
      store.hydrate('org-1', true);
      expect(store.get('org-1')).toBe(false);
    });
  });

  describe('reactivity contract (logged-out user)', () => {
    it('returns false for any orgId when localStorage is empty', async () => {
      const store = await loadStore();
      expect(store.get('any-org-id')).toBe(false);
      expect(store.get('another-id')).toBe(false);
      expect(store.has('any-org-id')).toBe(false);
    });
  });
});
