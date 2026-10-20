/**
 * Cache invalidation after a membership change (invite, role change, removal,
 * change of owner). Shared by `routes/members.ts` and `routes/ownership.ts`.
 */

import type { WaitUntilFn } from '@codex/cache';
import {
  invalidateUserLibrary as invalidateUserLibraryShared,
  VersionedCache,
} from '@codex/cache';
import { createDbClient } from '@codex/database';
import type { Logger } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import {
  invalidateOrgSlugCache as invalidateOrgSlugCacheShared,
  membershipCacheKey,
} from '@codex/worker-utils';

/** Context shape shared by cache-invalidation helpers */
export interface CacheCtx {
  env: HonoEnv['Bindings'];
  executionCtx: { waitUntil: WaitUntilFn };
}

/**
 * Invalidate the per-user membership cache after a mutation.
 *
 * DELETES THE KEY THE READER ACTUALLY READS. `checkOrganizationMembership()`
 * (packages/worker-utils/src/procedure/org-helpers.ts) is a write-through
 * cache with NO VERSION CHECK: it does a bare
 * `kv.get(membershipCacheKey(orgId, userId), 'json')` and returns whatever it
 * finds. It now also carries a 60s `expirationTtl` as defence in depth — a bound
 * on residual access if this invalidation ever regresses again, not a substitute
 * for it. Within that window the only thing that dislodges a stale entry is
 * deleting that exact
 * key, which is what this does.
 *
 * WHY NOT `VersionedCache.invalidate()`. It was, between 2d1c065a and this
 * commit, and the invalidation was dead for all three mutations.
 * `VersionedCache.invalidate(id)` does one `kv.put(buildVersionKey(id), …)` —
 * it writes `cache:version:membership:{orgId}:{userId}` and leaves
 * `membership:{orgId}:{userId}` untouched. Nothing in the repo reads that
 * version key (there is no membership `CacheType`; the reader is not
 * version-aware), so the bump was a KV write nobody consumed — a quota cost
 * plus a false signal that invalidation worked, while a removed member kept
 * their access until the entry was overwritten by some other path. This
 * restores c1c3d6c1's `kv.delete`.
 *
 * THE KEY IS BUILT BY THE READER'S OWN EXPORTED BUILDER. `membershipCacheKey`
 * is imported from `@codex/worker-utils`, not re-typed here: two independent
 * definitions of the same key format is the same defect in a slower form.
 *
 * Fire-and-forget via `waitUntil` — cache invalidation never blocks the
 * mutation response and never throws (graceful degradation; a failed delete
 * leaves a stale read, not a failed mutation).
 */
export function invalidateMembershipCache(
  ctx: CacheCtx,
  orgId: string,
  userId: string
) {
  const kv = ctx.env.CACHE_KV;
  if (!kv) return;
  ctx.executionCtx.waitUntil(
    kv.delete(membershipCacheKey(orgId, userId)).catch(() => {})
  );
}

/**
 * Invalidate slug-keyed cache (public org info, stats, creators) after
 * membership changes. Resolves slug from orgId in fire-and-forget fashion.
 *
 * R14: thin wrapper over the shared `@codex/cache` helper — preserves the
 * waitUntil dispatch and per-task swallow ergonomics expected by callers.
 */
export function dispatchOrgSlugInvalidation(
  ctx: CacheCtx,
  orgId: string,
  obs?: Logger
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV,
    waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
  });
  const db = createDbClient(ctx.env);
  ctx.executionCtx.waitUntil(
    invalidateOrgSlugCacheShared({ db, cache, orgId, logger: obs })
  );
}

/**
 * Everything a role change busts for one user: the membership entry the
 * policy reads, the org's slug-keyed public caches, and the user's library
 * (management roles unlock team-only content, Codex-c01do).
 */
export function invalidateMemberCaches(
  ctx: CacheCtx,
  orgId: string,
  userId: string,
  obs?: Logger
): void {
  invalidateMembershipCache(ctx, orgId, userId);
  dispatchOrgSlugInvalidation(ctx, orgId, obs);
  invalidateUserLibraryShared({
    kv: ctx.env.CACHE_KV,
    waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
    userId,
    logger: obs,
  });
}
