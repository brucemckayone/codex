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
 * Helpers here:
 *
 *   `invalidateUserLibrary` — fire-and-forget bump of the per-user
 *   `COLLECTION_USER_LIBRARY(userId)` version key. Used by membership and
 *   follower mutations (organization-api) and purchase webhooks (ecom-api).
 *
 *   `invalidateOrgPublicCaches` — bump everything an org's public pages read
 *   under its slug: its config and stats, and its creators list.
 *
 * The DB-touching `invalidateOrgSlugCache` lives in `@codex/worker-utils`.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { InvalidationLogger } from '@codex/observability';
import { CacheType } from '../cache-keys';
import { VersionedCache } from '../versioned-cache';

/**
 * Narrow `waitUntil` signature — matches `ExecutionContext.waitUntil` without
 * pulling Hono or workers-types into the helper surface.
 *
 * R11 canonical declaration site for the platform — `@codex/content`,
 * `@codex/subscription`, and worker route files all re-export or import from
 * here so that there is a single structural source of truth.
 */
export type WaitUntilFn = (promise: Promise<unknown>) => void;

// `InvalidationLogger` is canonically declared in `@codex/observability`
// and re-exported by the `@codex/cache` barrel (`index.ts`) directly from
// `@codex/observability` — no helper-level re-export needed here. The type
// is still imported above so the `logger?: InvalidationLogger` parameter
// keeps its symbolic name in IDE tooling.

/**
 * Invalidate every cache an org's public pages read for `slug`: its config
 * and stats, versioned by the slug itself, and its creators list, versioned
 * by `CacheType.COLLECTION_ORG_CREATORS(slug)` (Codex-kk9nv.9). A change to
 * the org or to who is in it calls this; a member's own profile write changes
 * only their card, so it invalidates only the creators list.
 */
export async function invalidateOrgPublicCaches(
  cache: VersionedCache,
  slug: string
): Promise<void> {
  await Promise.all([
    cache.invalidate(slug),
    cache.invalidate(CacheType.COLLECTION_ORG_CREATORS(slug)),
  ]);
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
  const cache = new VersionedCache({ kv, waitUntil });
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
