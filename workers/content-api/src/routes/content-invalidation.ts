/**
 * The cache bumps a content change needs, shared by the creator routes
 * (routes/content.ts) and the media-ready worker route (routes/internal.ts,
 * Codex-a6ofh.2.8), so a piece published by its schedule refreshes exactly
 * what a piece published by hand does.
 */

import { CacheType, VersionedCache } from '@codex/cache';
import {
  type BulkTouchedPiece,
  type ContentInvalidationReason,
  invalidateContentAccess,
  invalidateContentAccessMany,
  orgsOf,
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
  fanOut(
    env,
    executionCtx,
    obs,
    { contentId, organizationId, reason },
    (deps) =>
      invalidateContentAccess({
        ...deps,
        contentId,
        organizationId: organizationId ?? null,
        reason,
        includeFollowers: options.includeFollowers ?? false,
      })
  );
}

/**
 * {@link fanContentInvalidation} for a bulk action's pieces (Codex-a6ofh.3.5):
 * one background task on one DB client, each user's library bumped once
 * however many of the pieces it covers. The catalogue keys are left to
 * {@link afterBulkChange}, which bumps each once.
 */
function fanContentInvalidationMany(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  pieces: BulkTouchedPiece[],
  reason: ContentInvalidationReason,
  obs?: ObservabilityClient
): void {
  if (pieces.length === 0) return;
  fanOut(env, executionCtx, obs, { pieces: pieces.length, reason }, (deps) =>
    invalidateContentAccessMany({
      ...deps,
      pieces,
      reason,
      catalogue: false,
    })
  );
}

/**
 * The fan-out's plumbing: the cache, given `obs` because it swallows a
 * failed bump and logs it only through its own client, and the whole run
 * in `waitUntil`, so its DB reads never hold up the response. The client is
 * built inside the promise, as in bumpOrgContentVersion: one that cannot be
 * built lands in the `.catch`, never throws to a caller with more to refresh.
 */
function fanOut(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  obs: ObservabilityClient | undefined,
  failureContext: Record<string, unknown>,
  run: (deps: {
    db: ReturnType<typeof createDbClient>;
    cache: VersionedCache;
    waitUntil: (promise: Promise<unknown>) => void;
    logger?: ObservabilityClient;
  }) => Promise<void>
): void {
  if (!env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: env.CACHE_KV,
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    obs,
  });
  const waitUntil = executionCtx.waitUntil.bind(executionCtx);
  executionCtx.waitUntil(
    Promise.resolve()
      .then(() =>
        run({ db: createDbClient(env), cache, waitUntil, logger: obs })
      )
      .catch((err: unknown) => {
        obs?.warn('content-invalidation: fanout failed', {
          ...failureContext,
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );
}

/**
 * After a bulk action (Codex-a6ofh.3.5), each key once: the platform's
 * published list (with a `reason`, as a per-piece fan-out bumps it), each
 * org's lists, topics, portal rails and slug caches (`bumpOrgContentVersion`),
 * and, with a `reason`, the libraries of the people the pieces reach. Fifteen
 * per-piece refreshes would write one KV key fifteen times, and KV keeps
 * about one write a second to a key, so the last ones would be lost and
 * public pages stay stale for the cache's TTL.
 */
export function afterBulkChange(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  touched: BulkTouchedPiece[],
  reason: ContentInvalidationReason | null,
  obs?: ObservabilityClient
): void {
  if (touched.length === 0) return;
  for (const organizationId of orgsOf(touched)) {
    bumpOrgContentVersion(env, executionCtx, organizationId, obs);
  }
  if (!reason) return;
  if (env.CACHE_KV) {
    const cache = new VersionedCache({
      kv: env.CACHE_KV,
      waitUntil: (promise) => executionCtx.waitUntil(promise),
      obs,
    });
    executionCtx.waitUntil(
      cache
        .invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED)
        .catch((err: unknown) => {
          obs?.warn('Cache invalidation failed', {
            key: 'content:published',
            error: err instanceof Error ? err.message : String(err),
          });
        })
    );
  }
  fanContentInvalidationMany(env, executionCtx, touched, reason, obs);
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
