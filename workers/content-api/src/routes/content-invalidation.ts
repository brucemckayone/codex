/**
 * The cache bumps a content change needs, shared by the creator routes
 * (routes/content.ts) and the media-ready worker route (routes/internal.ts,
 * Codex-a6ofh.2.8), so a piece published by its schedule refreshes exactly
 * what a piece published by hand does.
 */

import { CacheType, VersionedCache } from '@codex/cache';
import {
  type ContentInvalidationReason,
  invalidateContentAccess,
} from '@codex/content';
import { createDbClient } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import { invalidateOrgSlugCache } from '@codex/worker-utils';

/**
 * Bump the org content version in KV after publish/unpublish/delete.
 * Also invalidates the org's public caches (info, stats, creators) since
 * content changes affect creator contentCount and org stats.
 * Fire-and-forget via waitUntil — does not block the response, and never
 * throws: the thumbnail route calls it from a `.finally()`, where a throw
 * would replace the upload's own error.
 */
export function bumpOrgContentVersion(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  organizationId: string | null | undefined,
  obs?: ObservabilityClient
): void {
  if (!organizationId || !env.CACHE_KV) return;
  // Given `obs`, because the cache swallows a failed invalidation and logs it
  // only through its own client: the `.catch` below never sees one.
  const cache = new VersionedCache({
    kv: env.CACHE_KV,
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    obs,
  });
  // Invalidate slug-keyed cache (stats, creators, public info) — shared
  // helper resolves orgId → slug and swallows transient failures. Started in
  // a promise of its own, so a client that cannot be built (missing config)
  // lands in the `.catch` below instead of throwing to the caller, and the
  // other bumps still run.
  const bySlug = Promise.resolve().then(() =>
    invalidateOrgSlugCache({
      db: createDbClient(env),
      cache,
      orgId: organizationId,
      logger: obs,
    })
  );
  executionCtx.waitUntil(
    Promise.all([
      // Invalidate org content collection version
      cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(organizationId)),
      bySlug,
      // Invalidate the public topic list: publish/unpublish/delete changes the
      // set of categories with ≥1 published item, so a cached "Browse by topic"
      // list could otherwise show empty or missing topics until TTL.
      cache.invalidate(CacheType.CATEGORIES(organizationId)),
      // Invalidate the public portal (journey) rails for the same reason
      // (Codex-72k55): each card's `practiceCount`/`stageCount` counts only
      // practices whose content is PUBLISHED, so publishing or unpublishing one
      // practice changes cards that name no content at all. Without this bump a
      // portal advertises "8 practices" while only 7 are reachable.
      cache.invalidate(CacheType.COLLECTION_ORG_JOURNEYS(organizationId)),
    ]).catch((err: unknown) => {
      obs?.warn('Cache invalidation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );
}

/**
 * Fan per-user library cache invalidation after a content mutation.
 *
 * Codex-c01do — content mutations (update-access-config, unpublish, delete,
 * publish) previously bumped ONLY catalogue version keys. The per-user
 * library cache (`COLLECTION_USER_LIBRARY`) was untouched, so library UI
 * showed stale accessType flags until the next visibility-change staleness
 * roundtrip. Access decisions at click time are always live (server-side)
 * — this is UX drift, not a security bug — but per feedback_dont_defer_cache_issues
 * we close the gap proactively.
 *
 * Fire-and-forget: the whole block is wrapped in `waitUntil` so the route
 * response is never blocked on KV writes.
 */
export function fanContentInvalidation(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  contentId: string,
  organizationId: string | null | undefined,
  reason: ContentInvalidationReason,
  obs?: ObservabilityClient,
  options: { includeFollowers?: boolean } = {}
): void {
  if (!env.CACHE_KV) return;
  // Given `obs`: the cache swallows a failed bump and logs it only through
  // its own client, so the `.catch` below never sees one.
  const cache = new VersionedCache({
    kv: env.CACHE_KV,
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    obs,
  });
  const waitUntil = executionCtx.waitUntil.bind(executionCtx);

  // Wrap the whole fanout in waitUntil so the DB `resolveAffectedUsers`
  // query does not block the response. The helper internally hands each
  // per-user KV bump to waitUntil as well. The client is built inside the
  // promise, as in bumpOrgContentVersion: one that cannot be built lands in
  // the `.catch`, never throws to a caller with more to refresh.
  executionCtx.waitUntil(
    Promise.resolve()
      .then(() =>
        invalidateContentAccess({
          db: createDbClient(env),
          cache,
          waitUntil,
          contentId,
          organizationId: organizationId ?? null,
          reason,
          logger: obs,
          includeFollowers: options.includeFollowers ?? false,
        })
      )
      .catch((err: unknown) => {
        obs?.warn('content-invalidation: fanout failed', {
          contentId,
          organizationId,
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );
}

/**
 * Everything a go-live refreshes: the org's lists and portal rails, and the
 * libraries of the people the piece now reaches (Codex-c01do).
 */
export function afterContentPublished(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  row: { id: string; organizationId: string | null },
  obs?: ObservabilityClient
): void {
  bumpOrgContentVersion(env, executionCtx, row.organizationId, obs);
  fanContentInvalidation(
    env,
    executionCtx,
    row.id,
    row.organizationId,
    'content_published',
    obs
  );
}
