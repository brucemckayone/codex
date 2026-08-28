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
 *   - an identity change leaves NO trace of the previous user's follows, in
 *     localStorage AND in the module-level `$state` (Codex-1g5lh.17)
 *
 * `$state()` lives at module scope so we use `vi.resetModules()` between
 * tests + dynamic `import()` to get a fresh store. localStorage is cleared
 * in `beforeEach` to avoid bleed between tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'codex-following';
const STATE_OWNER_KEY = 'codex-state-owner';

async function loadStore() {
  // Dynamic import after each reset — re-evaluates module-level $state()
  const mod = await import('../following.svelte');
  return mod.followingStore;
}

/**
 * Load the store AND the identity-change primitive from the SAME post-reset
 * module graph.
 *
 * This matters: `following.svelte.ts` calls `registerUserScopedReset` at
 * module scope, so the registration lands in whichever `user-scoped-state`
 * instance was live when the store was evaluated. Importing the primitive
 * from a stale graph would silently hand back an empty registry and every
 * in-memory assertion below would pass vacuously.
 */
async function loadStoreWithIdentityGuard() {
  const store = await loadStore();
  const guard = await import('../user-scoped-state');
  return { store, ...guard };
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

  describe('identity change (Codex-1g5lh.17)', () => {
    it('a storage-only wipe is NOT enough — the $state survives it', async () => {
      // NEGATIVE CONTROL. This is the trap the bead warns about: a fix that
      // only removes the localStorage key looks correct under a
      // localStorage-only assertion while the previous user's map is still
      // live in memory, and `has()` returning true is exactly what suppresses
      // the corrective server hydration in `_org/[slug]/+layout.svelte`.
      // If this test ever starts FAILING, the in-memory copy went away by
      // some other means and the assertions below have lost their teeth.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const store = await loadStore();

      localStorage.removeItem(STORAGE_KEY);

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(store.get('org-1')).toBe(true);
      expect(store.has('org-1')).toBe(true);
    });

    it('clears BOTH localStorage and the in-memory $state', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'org-1': true }));
      const { store, clearUserScopedState } =
        await loadStoreWithIdentityGuard();

      // Precondition: the store really did hydrate from the seeded value.
      expect(store.get('org-1')).toBe(true);

      clearUserScopedState();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(store.get('org-1')).toBe(false);
      // `has()` is the load-bearing one — false is what lets the org layout
      // fetch the correct value from the server for the new user.
      expect(store.has('org-1')).toBe(false);
    });

    it('the next user does not see the previous user\u2019s follows', async () => {
      // The reported symptom end to end: A follows an org, then B signs in on
      // the same browser and the same origin.
      localStorage.setItem(STATE_OWNER_KEY, 'user-a');
      const { store, reconcileStateOwner } = await loadStoreWithIdentityGuard();
      store.set('org-1', true);
      expect(store.get('org-1')).toBe(true);

      expect(reconcileStateOwner('user-b')).toBe('switched');

      expect(store.get('org-1')).toBe(false);
      expect(store.has('org-1')).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBe('user-b');
    });

    it('leaves the SAME user\u2019s follows intact', async () => {
      localStorage.setItem(STATE_OWNER_KEY, 'user-a');
      const { store, reconcileStateOwner } = await loadStoreWithIdentityGuard();
      store.set('org-1', true);

      expect(reconcileStateOwner('user-a')).toBe('unchanged');

      expect(store.get('org-1')).toBe(true);
      expect(store.has('org-1')).toBe(true);
    });

    it('drops every org, not just the one being viewed', async () => {
      localStorage.setItem(STATE_OWNER_KEY, 'user-a');
      const { store, reconcileStateOwner } = await loadStoreWithIdentityGuard();
      store.set('org-1', true);
      store.set('org-2', false);
      store.set('org-3', true);

      reconcileStateOwner('user-b');

      for (const orgId of ['org-1', 'org-2', 'org-3']) {
        expect(store.has(orgId)).toBe(false);
        expect(store.get(orgId)).toBe(false);
      }
    });

    it('accepts a fresh hydrate after the wipe (self-heals)', async () => {
      // After the clear, the org layout's `getFollowingStatus()` fetch is no
      // longer suppressed, so hydrate() must be able to write the new user's
      // real value — a wiped store must not be a poisoned one.
      localStorage.setItem(STATE_OWNER_KEY, 'user-a');
      const { store, reconcileStateOwner } = await loadStoreWithIdentityGuard();
      store.set('org-1', true);
      reconcileStateOwner('user-b');

      store.hydrate('org-1', false);

      expect(store.get('org-1')).toBe(false);
      expect(store.has('org-1')).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        'org-1': false,
      });
    });
  });
});
