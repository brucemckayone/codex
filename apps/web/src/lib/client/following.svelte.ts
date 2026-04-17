/**
 * Following Status Store
 *
 * Lightweight Svelte 5 reactive store backed by localStorage.
 * Tracks which orgs the current user follows.
 *
 * Why not a TanStack DB collection? Following is a simple boolean per org,
 * changed only by user clicks (no webhooks, no cross-device urgency).
 * A full collection would be heavy machinery for { [orgId]: boolean }.
 *
 * Pattern reference: brand-editor-store.svelte.ts
 */
import { browser } from '$app/environment';

const STORAGE_KEY = 'codex-following';

function readStore(): Record<string, boolean> {
  if (!browser) return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, boolean>) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or blocked — silent fail
  }
}

const data = $state<Record<string, boolean>>(readStore());

export const followingStore = {
  /** Read follow state — reactive when used in $derived */
  get: (orgId: string): boolean => data[orgId] ?? false,

  /**
   * True when a value for this org has been hydrated from server or
   * explicitly set by the user. Lets callers skip redundant server
   * fetches when the localStorage-backed store already has the answer.
   * Distinct from `get(orgId) === false`, which is the hydrated value.
   */
  has: (orgId: string): boolean => data[orgId] !== undefined,

  /** Set follow state (optimistic update + persist) */
  set: (orgId: string, following: boolean) => {
    data[orgId] = following;
    writeStore(data);
  },

  /**
   * Hydrate from server on first load.
   * No-op if org is already in the store (localStorage persists across refresh).
   * This prevents overwriting an optimistic update with stale server data.
   */
  hydrate: (orgId: string, following: boolean) => {
    if (data[orgId] === undefined) {
      data[orgId] = following;
      writeStore(data);
    }
  },
};
