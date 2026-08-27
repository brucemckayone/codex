/**
 * user-scoped-state tests — Codex-1g5lh.17
 *
 * Locks the clear-on-identity-change primitive that stops one user's
 * persisted client state being served to the next user on the same browser.
 *
 * The behaviours that matter:
 *   - a DIFFERENT authenticated user wipes the previous user's state
 *     (`switched`) — this is the reported bug
 *   - state of UNKNOWN provenance is wiped on first reconcile (`claimed`), so
 *     browsers that already hold pre-fix data are fixed by the deploy rather
 *     than needing two sign-in cycles
 *   - the SAME user keeps their state (`unchanged`) — the fix must not wipe on
 *     every page load
 *   - a null user does NOT wipe, because `hooks.server.ts` turns an
 *     auth-worker blip into `user: null` and that must not nuke a
 *     still-signed-in user's caches
 *   - device preferences (theme, player volume) survive — clearing them would
 *     be a regression in its own right
 *   - registered in-memory resets run, not just the storage removal
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true, dev: false }));

import {
  __clearUserScopedResetsForTest,
  clearUserScopedState,
  DEVICE_SCOPED_KEYS_NOT_CLEARED,
  reconcileStateOwner,
  registerUserScopedReset,
  STATE_OWNER_KEY,
  USER_SCOPED_LOCAL_KEYS,
  USER_SCOPED_SESSION_KEYS,
} from '../user-scoped-state';

const USER_A = 'user-aaaa-1111';
const USER_B = 'user-bbbb-2222';

/** Populate every user-scoped key so a clear has something to remove. */
function seedUserScopedState(): void {
  for (const key of USER_SCOPED_LOCAL_KEYS) {
    localStorage.setItem(key, `local:${key}`);
  }
  for (const key of USER_SCOPED_SESSION_KEYS) {
    sessionStorage.setItem(key, `session:${key}`);
  }
}

/** Populate the device preferences that must SURVIVE a clear. */
function seedDevicePreferences(): void {
  localStorage.setItem('theme', 'dark');
  localStorage.setItem(
    'codex-player-prefs',
    JSON.stringify({ volume: 0.2, muted: true, playbackRate: 1.5 })
  );
  localStorage.setItem('codex-payout-rail-count:studio-alpha.lvh.me', '7');
  localStorage.setItem('codex:brand-studio-mode:org-1', 'advanced');
  // A completely unrelated app on the same origin.
  localStorage.setItem('some-other-app', 'keep-me');
}

describe('user-scoped-state', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    __clearUserScopedResetsForTest();
  });

  describe('key inventory', () => {
    it('covers every persisted store the pre-fix list missed', () => {
      // The pre-fix `CODEX_STORAGE_KEYS` in version-manifest.ts held only
      // these five. Each addition below is a store that leaked across an
      // identity change because it was absent.
      expect(USER_SCOPED_LOCAL_KEYS).toContain('codex-dismissals');
      expect(USER_SCOPED_LOCAL_KEYS).toContain('codex-recent-searches');
      expect(USER_SCOPED_LOCAL_KEYS).toContain('codex-library-schema');
      // sessionStorage was not cleared AT ALL before this module existed.
      expect(USER_SCOPED_SESSION_KEYS.length).toBeGreaterThan(0);
    });

    it('never lists a device preference as user-scoped', () => {
      for (const key of DEVICE_SCOPED_KEYS_NOT_CLEARED) {
        const literal = key.replace('*', '');
        for (const userKey of USER_SCOPED_LOCAL_KEYS) {
          expect(userKey.startsWith(literal) && literal.length > 0).toBe(false);
        }
      }
    });

    it('does not list the owner marker as state (it describes the state)', () => {
      expect(USER_SCOPED_LOCAL_KEYS as readonly string[]).not.toContain(
        STATE_OWNER_KEY
      );
    });
  });

  describe('clearUserScopedState', () => {
    it('removes every user-scoped local and session key', () => {
      seedUserScopedState();
      clearUserScopedState();

      for (const key of USER_SCOPED_LOCAL_KEYS) {
        expect(localStorage.getItem(key)).toBeNull();
      }
      for (const key of USER_SCOPED_SESSION_KEYS) {
        expect(sessionStorage.getItem(key)).toBeNull();
      }
    });

    it('leaves device preferences and unrelated keys alone', () => {
      seedUserScopedState();
      seedDevicePreferences();
      clearUserScopedState();

      // Wiping these would be a regression: volume belongs to the speakers
      // and light/dark belongs to the eyes, not the account.
      expect(localStorage.getItem('theme')).toBe('dark');
      expect(
        JSON.parse(localStorage.getItem('codex-player-prefs') as string)
      ).toEqual({ volume: 0.2, muted: true, playbackRate: 1.5 });
      expect(
        localStorage.getItem('codex-payout-rail-count:studio-alpha.lvh.me')
      ).toBe('7');
      expect(localStorage.getItem('codex:brand-studio-mode:org-1')).toBe(
        'advanced'
      );
      expect(localStorage.getItem('some-other-app')).toBe('keep-me');
    });

    it('removes the ownership marker so no marker outlives the state', () => {
      localStorage.setItem(STATE_OWNER_KEY, USER_A);
      clearUserScopedState();
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBeNull();
    });

    it('runs every registered in-memory reset', () => {
      const first = vi.fn();
      const second = vi.fn();
      registerUserScopedReset(first);
      registerUserScopedReset(second);

      clearUserScopedState();

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps clearing when one reset throws', () => {
      // A single misbehaving store must not strand the others, and must not
      // take down the root layout — which is where this runs.
      const later = vi.fn();
      registerUserScopedReset(() => {
        throw new Error('collection not synced');
      });
      registerUserScopedReset(later);
      seedUserScopedState();

      expect(() => clearUserScopedState()).not.toThrow();
      expect(later).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('codex-following')).toBeNull();
    });

    it('re-removes a key that a reset wrote back through storage', () => {
      // TanStack DB `delete()` writes through to localStorage, so a reset can
      // recreate its key holding an empty payload. The key must end up ABSENT,
      // not present-and-empty.
      registerUserScopedReset(() => {
        localStorage.setItem('codex-library', '{}');
      });
      seedUserScopedState();

      clearUserScopedState();

      expect(localStorage.getItem('codex-library')).toBeNull();
    });

    it('is a safe no-op when nothing is stored', () => {
      expect(() => clearUserScopedState()).not.toThrow();
    });
  });

  describe('reconcileStateOwner', () => {
    it('wipes the previous user state when a DIFFERENT user is seen', () => {
      // THE REPORTED BUG: follow as A, sign out, sign in as B, B sees the org
      // as already followed.
      localStorage.setItem(STATE_OWNER_KEY, USER_A);
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-1': true })
      );

      expect(reconcileStateOwner(USER_B)).toBe('switched');

      expect(localStorage.getItem('codex-following')).toBeNull();
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBe(USER_B);
    });

    it('wipes state of unknown provenance and claims it', () => {
      // Covers first sign-in on this origin AND every browser already holding
      // pre-fix state — those have data but no marker. Adopting instead of
      // clearing would leave the reported bug live for exactly the people who
      // reported it.
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-1': true })
      );

      expect(reconcileStateOwner(USER_B)).toBe('claimed');

      expect(localStorage.getItem('codex-following')).toBeNull();
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBe(USER_B);
    });

    it('keeps state for the SAME user across loads', () => {
      // The guard runs on every page load, so a false positive here would
      // wipe a signed-in user's library on every navigation.
      localStorage.setItem(STATE_OWNER_KEY, USER_A);
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-1': true })
      );

      expect(reconcileStateOwner(USER_A)).toBe('unchanged');

      expect(
        JSON.parse(localStorage.getItem('codex-following') as string)
      ).toEqual({ 'org-1': true });
    });

    it('does not run resets on the unchanged path', () => {
      const reset = vi.fn();
      registerUserScopedReset(reset);
      localStorage.setItem(STATE_OWNER_KEY, USER_A);

      reconcileStateOwner(USER_A);

      expect(reset).not.toHaveBeenCalled();
    });

    it('does NOT wipe on a null user', () => {
      // `hooks.server.ts:61-69` sets `locals.user = null` when the auth worker
      // throws, so null is indistinguishable from a real sign-out. Clearing
      // here would flash an empty library at a still-signed-in user and could
      // drop unflushed playback progress. The `switched` branch above is the
      // deterministic fix; this one deliberately abstains.
      localStorage.setItem(STATE_OWNER_KEY, USER_A);
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-1': true })
      );

      expect(reconcileStateOwner(null)).toBe('anonymous');
      expect(reconcileStateOwner(undefined)).toBe('anonymous');

      expect(
        JSON.parse(localStorage.getItem('codex-following') as string)
      ).toEqual({ 'org-1': true });
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBe(USER_A);
    });

    it('runs the registered resets on the switched path', () => {
      // Storage removal alone is not enough — the in-memory copies seeded at
      // module init are what readers consult.
      const reset = vi.fn();
      registerUserScopedReset(reset);
      localStorage.setItem(STATE_OWNER_KEY, USER_A);

      reconcileStateOwner(USER_B);

      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('survives a full A → out → B → back-to-A cycle without bleed', () => {
      localStorage.setItem(STATE_OWNER_KEY, USER_A);
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-1': true })
      );

      // B signs in: A's follow is gone.
      reconcileStateOwner(USER_B);
      expect(localStorage.getItem('codex-following')).toBeNull();

      // B follows a different org.
      localStorage.setItem(
        'codex-following',
        JSON.stringify({ 'org-2': true })
      );

      // A comes back: B's follow is gone, and A's original is NOT resurrected.
      expect(reconcileStateOwner(USER_A)).toBe('switched');
      expect(localStorage.getItem('codex-following')).toBeNull();
      expect(localStorage.getItem(STATE_OWNER_KEY)).toBe(USER_A);
    });
  });
});
