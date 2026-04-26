/**
 * Shared cache-fanout helpers used by worker route handlers.
 *
 * R14 (denoise iter-011): cache-fanout helpers MUST live in `@codex/cache`
 * (or `@codex/worker-utils`) — they MUST NOT be inlined as route helpers.
 * Inline copies drift on retry/timeout semantics, swallow ergonomics, and
 * KV bindings; one shared entry point keeps every consumer in lockstep.
 *
 * `@codex/cache` hosts only the KV-only fanout helpers — anything that needs
 * `@codex/database` lives in `@codex/worker-utils` (which already depends on
 * the database package) so the cache package stays thin/standalone.
 *
 * Helper here:
 *
 *   `invalidateUserLibrary` — fire-and-forget bump of the per-user
 *   `COLLECTION_USER_LIBRARY(userId)` version key. Used by membership and
 *   follower mutations (organization-api) and purchase webhooks (ecom-api).
 *
 * The DB-touching `invalidateOrgSlugCache` lives in `@codex/worker-utils`.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType } from '../cache-keys';
import { VersionedCache } from '../versioned-cache';

/**
 * Narrow `waitUntil` signature — matches `ExecutionContext.waitUntil` without
 * pulling Hono or workers-types into the helper surface.
 */
export type WaitUntilFn = (promise: Promise<unknown>) => void;

/**
 * Optional logger surface. Mirrors the structural shape used by
 * `@codex/content` `invalidateContentAccess` so the sibling fan-out helpers
 * behave identically in the face of KV outages.
 */
export interface InvalidationLogger {
  warn: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Arguments for {@link invalidateUserLibrary}.
 */
export interface InvalidateUserLibraryArgs {
  /** The CACHE_KV binding. If absent the helper is a no-op. */
  kv: KVNamespace | undefined;
  /** ExecutionContext-style waitUntil to dispatch the fire-and-forget bump. */
  waitUntil: WaitUntilFn;
  /** User whose library cache should be invalidated. Empty string → no-op. */
  userId: string;
  /** Optional logger for fire-and-forget failures. */
  logger?: InvalidationLogger;
}

/**
 * Bump one user's library KV version key.
 *
 * Membership mutations, follow/unfollow toggles, and completed purchases all
 * change what a user sees in their library. This helper centralises the
 * "build VersionedCache → invalidate(COLLECTION_USER_LIBRARY) → swallow"
 * shape that was previously inlined in three route files.
 *
 * Fires once, fire-and-forget via `waitUntil`. Never throws — KV failures
 * surface through the optional logger only.
 */
export function invalidateUserLibrary(args: InvalidateUserLibraryArgs): void {
  const { kv, waitUntil, userId, logger } = args;
  if (!kv || !userId) return;
  const cache = new VersionedCache({ kv });
  const key = CacheType.COLLECTION_USER_LIBRARY(userId);
  waitUntil(
    cache.invalidate(key).catch((error: unknown) => {
      logger?.warn('cache: user-library invalidate failed', {
        userId,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );
}
