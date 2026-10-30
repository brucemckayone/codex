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
 *
 * The membership fan-out (`invalidateMemberCaches` and its two parts) lives
 * here too (Codex-2hxff.44): organization-api's member and ownership routes
 * and admin-api's support owner reassign all bust the same caches, and the
 * admin copy, re-typed inline, had drifted (no org-slug bust, a silent catch).
 */

import {
  type InvalidationLogger,
  invalidateOrgPublicCaches,
  invalidateUserLibrary,
  VersionedCache,
  type WaitUntilFn,
} from '@codex/cache';
import type { Database } from '@codex/database';
import { createDbClient, eq, schema } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { membershipCacheKey } from './procedure/org-helpers';

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
 * Resolve an organisation slug from `orgId` and invalidate the org's public
 * caches: its config and stats, keyed by the slug, and its creators list,
 * which has its own id (`invalidateOrgPublicCaches`, Codex-kk9nv.9).
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
      await invalidateOrgPublicCaches(cache, org.slug);
    }
  } catch (error: unknown) {
    // Non-critical — slug cache expires via TTL.
    logger?.warn('cache: org-slug invalidate failed', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The slice of a `procedure()` context the membership fan-out needs; a route
 * passes its own `ctx`.
 */
export interface MemberCacheCtx {
  env: Bindings;
  executionCtx: { waitUntil: WaitUntilFn };
}

/**
 * Invalidate the per-user membership cache after a mutation.
 *
 * DELETES THE KEY THE READER ACTUALLY READS. `checkOrganizationMembership()`
 * (./procedure/org-helpers.ts) is a write-through cache with NO VERSION
 * CHECK: it does a bare `kv.get(membershipCacheKey(orgId, userId), 'json')`
 * and returns whatever it finds. It also carries a 60s `expirationTtl` as
 * defence in depth — a bound on residual access if this invalidation ever
 * regresses again, not a substitute for it. Within that window the only
 * thing that dislodges a stale entry is deleting that exact key, which is
 * what this does.
 *
 * WHY NOT `VersionedCache.invalidate()`. It was, from 2d1c065a until
 * c1c3d6c1's `kv.delete` was restored (Codex-rxjwp), and the invalidation was
 * dead for all three member mutations. `VersionedCache.invalidate(id)` does one
 * `kv.put(buildVersionKey(id), …)` — it writes
 * `cache:version:membership:{orgId}:{userId}` and leaves
 * `membership:{orgId}:{userId}` untouched. Nothing reads that version key
 * (there is no membership `CacheType`; the reader is not version-aware), so
 * the bump was a KV write nobody consumed, while a removed member kept their
 * access until the entry was overwritten by some other path.
 *
 * THE KEY IS BUILT BY THE READER'S OWN BUILDER, `membershipCacheKey`, never
 * re-typed: two independent definitions of the same key format is the same
 * defect in a slower form.
 *
 * Fire-and-forget via `waitUntil` — it never blocks the mutation response
 * and never throws. A failed delete leaves the old role readable for up to
 * the entry's 60s TTL, so it is logged with the org and user ids
 * (Codex-2hxff.44); before, an empty catch left no trace. `obs` is a
 * required argument, and an undefined one (`ctx.obs` is typed so) falls back
 * to a client of this module's own, so the failure is never silent.
 */
export function invalidateMembershipCache(
  ctx: MemberCacheCtx,
  orgId: string,
  userId: string,
  obs: ObservabilityClient | undefined
): void {
  const kv = ctx.env.CACHE_KV;
  if (!kv) return;
  ctx.executionCtx.waitUntil(
    kv.delete(membershipCacheKey(orgId, userId)).catch((error: unknown) => {
      orFallback(ctx, obs).warn('cache: membership delete failed', {
        orgId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );
}

/**
 * Invalidate the org's slug-keyed public caches (org info, stats, creators)
 * after a membership change: {@link invalidateOrgSlugCache}, resolving the
 * slug from `orgId`, dispatched through `waitUntil`. A failed invalidation is
 * logged by that helper, never thrown.
 */
export function dispatchOrgSlugInvalidation(
  ctx: MemberCacheCtx,
  orgId: string,
  obs?: ObservabilityClient
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV,
    waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
    // The cache logs a failed invalidation only through its own obs.
    obs,
  });
  const db = createDbClient(ctx.env);
  ctx.executionCtx.waitUntil(
    invalidateOrgSlugCache({ db, cache, orgId, logger: obs })
  );
}

/**
 * Invalidate the public caches of orgs whose slugs the caller already holds,
 * dispatched through `waitUntil`: content-api's media delete, when the item
 * was an org's intro film (Codex-376dl). The cache logs a failed invalidation
 * through `obs` and never throws, so the write it follows cannot fail.
 */
export function dispatchOrgPublicInvalidation(
  ctx: MemberCacheCtx,
  slugs: readonly string[],
  obs?: ObservabilityClient
): void {
  if (slugs.length === 0 || !ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV,
    waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
    obs,
  });
  ctx.executionCtx.waitUntil(
    Promise.all(slugs.map((slug) => invalidateOrgPublicCaches(cache, slug)))
  );
}

/**
 * Everything a role change busts for one user: the membership entry the
 * policy reads, the org's slug-keyed public caches, and the user's library
 * (management roles unlock team-only content, Codex-c01do). An ownership
 * change calls it for both the new and the previous owner. Every part logs
 * its failure, through `obs` or, when that is undefined, this module's own.
 */
export function invalidateMemberCaches(
  ctx: MemberCacheCtx,
  orgId: string,
  userId: string,
  obs: ObservabilityClient | undefined
): void {
  const logger = orFallback(ctx, obs);
  invalidateMembershipCache(ctx, orgId, userId, logger);
  dispatchOrgSlugInvalidation(ctx, orgId, logger);
  invalidateUserLibrary({
    kv: ctx.env.CACHE_KV,
    waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
    userId,
    logger,
  });
}

/**
 * The caller's client, or one of this module's own: a failed membership
 * invalidation is never silent (Codex-2hxff.44). `ctx.obs` is typed
 * `ObservabilityClient | undefined`, though createWorker always sets it.
 */
function orFallback(
  ctx: MemberCacheCtx,
  obs: ObservabilityClient | undefined
): ObservabilityClient {
  return obs ?? new ObservabilityClient('cache-fanout', ctx.env.ENVIRONMENT);
}
