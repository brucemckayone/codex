/**
 * Cache-fanout helpers that need access to `@codex/database`.
 *
 * R14 (denoise iter-011): cache-fanout helpers MUST live in `@codex/cache`
 * or `@codex/worker-utils` — they MUST NOT be inlined as route helpers.
 *
 * `invalidateOrgSlugCache` lives here (rather than in `@codex/cache`) because
 * it resolves `orgId → slug` via Drizzle. Keeping the DB-touching helper out
 * of `@codex/cache` preserves cache's "thin foundation over KV" charter; the
 * KV-only sibling `invalidateUserLibrary` stays in `@codex/cache`.
 */

import type { InvalidationLogger, VersionedCache } from '@codex/cache';
import type { Database } from '@codex/database';
import { eq, schema } from '@codex/database';

/**
 * Arguments for {@link invalidateOrgSlugCache}.
 */
export interface InvalidateOrgSlugCacheArgs {
  /** Drizzle client — required so the helper can resolve `orgId → slug`. */
  db: Database;
  /** A pre-built `VersionedCache` keyed against `CACHE_KV`. */
  cache: VersionedCache;
  /** Organization id whose slug-keyed public cache should be invalidated. */
  orgId: string;
  /** Optional logger for fire-and-forget failures. */
  logger?: InvalidationLogger;
}

/**
 * Resolve an organisation slug from `orgId` and invalidate the slug-keyed
 * `VersionedCache` entry (public org info, stats, creators, members).
 *
 * Returns once the invalidation has completed (or swallowed an error). The
 * caller is responsible for wrapping in `executionCtx.waitUntil(...)` if it
 * does not want to block the response. Internally swallows any error — the
 * slug cache expires via TTL, so a missed bump is non-critical.
 *
 * Replaces two inline call sites (content-api `bumpOrgContentVersion` and
 * organization-api `invalidateOrgSlugCache`) per R14.
 */
export async function invalidateOrgSlugCache(
  args: InvalidateOrgSlugCacheArgs
): Promise<void> {
  const { db, cache, orgId, logger } = args;
  if (!orgId) return;
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, orgId),
      columns: { slug: true },
    });
    if (org?.slug) {
      await cache.invalidate(org.slug);
    }
  } catch (error: unknown) {
    // Non-critical — slug cache expires via TTL.
    logger?.warn('cache: org-slug invalidate failed', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
