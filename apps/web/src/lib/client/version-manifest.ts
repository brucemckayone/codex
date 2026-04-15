/**
 * Client Version Manifest
 *
 * Tracks server-side cache version strings in localStorage so the client
 * can detect stale data after navigating back or returning to a tab.
 *
 * Only tracks user-scoped keys (user:*, org:*). Content catalogue versions
 * are server-authoritative — SSR re-renders the correct list on every request.
 */

import { browser } from '$app/environment';

const MANIFEST_KEY = 'codex-versions';

/** All localStorage keys owned by Codex client state */
const CODEX_STORAGE_KEYS = [
  MANIFEST_KEY,
  'codex-library',
  'codex-playback-progress',
  'codex-following',
  'codex-subscription',
] as const;

/**
 * Clear all Codex client state from localStorage.
 * Called on logout to prevent stale user data persisting.
 */
export function clearClientState(): void {
  if (!browser) return;
  for (const key of CODEX_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage blocked — silent fail
    }
  }
}

export type VersionMap = Record<string, string | null>;

/**
 * Read stored versions from localStorage.
 * Returns {} on SSR or parse error.
 */
export function getStoredVersions(): Record<string, string> {
  if (!browser) return {};
  try {
    return JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Diff SSR versions against stored manifest. Returns stale keys.
 *
 * - Missing from stored = NOT stale (first visit — trust SSR data)
 * - Null SSR version = NOT stale (no data cached yet, nothing to invalidate)
 * - Mismatch = stale (server version advanced since last visit)
 */
export function getStaleKeys(ssrVersions: VersionMap): string[] {
  const stored = getStoredVersions();
  return Object.entries(ssrVersions)
    .filter(
      ([key, version]) =>
        version !== null && stored[key] !== undefined && stored[key] !== version
    )
    .map(([key]) => key);
}

/**
 * Merge non-null SSR versions into manifest and persist.
 *
 * Null versions are skipped — no version in KV means no cache entry exists yet,
 * so there's nothing to track.
 */
export function updateStoredVersions(ssrVersions: VersionMap): void {
  if (!browser) return;
  const stored = getStoredVersions();
  for (const [key, version] of Object.entries(ssrVersions)) {
    if (version !== null) stored[key] = version;
  }
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(stored));
  } catch {
    // localStorage full or blocked — silent fail, retries on next load
  }
}
