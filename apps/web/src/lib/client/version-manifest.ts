/**
 * Client Version Manifest
 *
 * Tracks server-side cache version strings in localStorage so the client
 * can detect stale data after navigating back or returning to a tab.
 *
 * Only tracks user-scoped keys (user:*, org:*). Content catalogue versions
 * are server-authoritative — SSR re-renders the correct list on every request.
 */

import { browser, dev } from '$app/environment';

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

type VersionMap = Record<string, string | null>;

/**
 * Read stored versions from localStorage.
 * Returns {} on SSR or parse error.
 */
function getStoredVersions(): Record<string, string> {
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
 * A client collection that an org-version staleness check can invalidate.
 * One per dispatch branch in `_org/[slug]/+layout.svelte`.
 */
export type OrgCacheTarget = 'content' | 'library' | 'subscription';

/**
 * Map a set of stale version keys to the client caches that must be
 * invalidated, using EXACT-KEY matching.
 *
 * The version keys are produced server-side by `readOrgVersions`
 * (`_org/[slug]/+layout.server.ts`) from the `@codex/cache` `CacheType`
 * builders:
 *   - `COLLECTION_ORG_CONTENT(orgId)`               → `org:{orgId}:content`
 *   - `COLLECTION_USER_LIBRARY(userId)`             → `user:{userId}:library`
 *   - `COLLECTION_USER_SUBSCRIPTION(userId, orgId)` → `user:{userId}:subscription:{orgId}`
 *   - `ORG_CONFIG`                                  → `org:config:{orgId}` (no client
 *     collection — served by SSR — so it maps to no target, as before)
 * Reconstructing them from the same `{orgId, userId}` keeps client and server
 * in lockstep without importing the server-only `@codex/cache` barrel (which
 * re-exports `VersionedCache`/KV code) into the client bundle.
 *
 * Exact matching replaces the previous `key.includes(':content')` substring
 * test: a brand-new key — e.g. a future `org:{orgId}:pages` / `:courses` — is
 * now dispatched only via an explicit entry, never silently swallowed by (or
 * accidentally caught in) a substring branch. The flip side — an unmapped
 * stale key would still be dropped — is surfaced by a dev-only warning so a
 * key added to `readOrgVersions` without a matching entry here is caught in
 * development rather than silently failing to cross-tab-invalidate.
 */
export function resolveStaleCacheTargets(
  staleKeys: readonly string[],
  ids: { orgId: string; userId?: string | null }
): Set<OrgCacheTarget> {
  const { orgId, userId } = ids;

  const keyToTarget = new Map<string, OrgCacheTarget>([
    [`org:${orgId}:content`, 'content'],
  ]);
  if (userId) {
    keyToTarget.set(`user:${userId}:library`, 'library');
    keyToTarget.set(`user:${userId}:subscription:${orgId}`, 'subscription');
  }

  const targets = new Set<OrgCacheTarget>();
  for (const key of staleKeys) {
    const target = keyToTarget.get(key);
    if (target) {
      targets.add(target);
    } else if (dev && key !== `org:config:${orgId}`) {
      // A stale server key with no client target is dropped. That is correct
      // for SSR-only keys (`org:config:{orgId}`), but any OTHER unmapped key
      // means a key was added to `readOrgVersions` (`+layout.server.ts`)
      // without a matching entry here — its collection would never
      // cross-tab-invalidate. Surface the gap in dev; the omission is silent
      // in prod (no behaviour change, just a lost cross-tab refresh).
      console.warn(
        '[version-manifest] stale key has no client cache target — add a mapping in resolveStaleCacheTargets:',
        key
      );
    }
  }
  return targets;
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
