/**
 * Shared content-mutation cache invalidation helper.
 *
 * Epic: "Content Mutation Cache Integrity" (Codex-c01do) — the sibling of
 * `packages/subscription/src/services/subscription-invalidation.ts`. Where that
 * helper fans invalidations on **subscription lifecycle** events, this helper
 * fans invalidations on **content mutation** events (update access-config,
 * unpublish, delete, membership role changes, follow/unfollow).
 *
 * The gap this closes: `libraryCollection` stores `accessType` per item in
 * localStorage. When a creator edits a content item's accessType (e.g. moves
 * free→subscribers or paid→free), **only** the catalogue collection versions
 * (`COLLECTION_CONTENT_PUBLISHED`, `COLLECTION_ORG_CONTENT`) are bumped. The
 * per-user library version (`COLLECTION_USER_LIBRARY`) is not — so the user's
 * library UI shows stale access flags until the next visibility-change
 * staleness roundtrip. Access decisions at click time are always live
 * (server-side), so this is **UX drift, not a security bug** — but per user
 * feedback `feedback_dont_defer_cache_issues` cache gaps need proactive target
 * solutions.
 *
 * See docs/caching-strategy.md and docs/content-cache-audit/ for the full
 * invalidation gap matrix and design rationale.
 *
 * Design — Option A (per-user fanout) with safety cap:
 *
 * - Catalogue versions (`COLLECTION_CONTENT_PUBLISHED` + `COLLECTION_ORG_CONTENT`)
 *   are always bumped — this is the existing behaviour preserved.
 * - Per-user library version (`COLLECTION_USER_LIBRARY`) is bumped for every
 *   user currently holding this content in their library, discovered via a
 *   union query over purchases + active subscriptions + org management
 *   memberships + (optionally) followers.
 * - A `MAX_LIBRARY_FANOUT` hard cap guards against runaway writes for
 *   unboundedly popular content (e.g. follower-gated posts on a large org).
 *   When the cap is exceeded, we log a warning and skip per-user fanout —
 *   the platform-layout `visibilitychange → invalidate('cache:versions')`
 *   loop will pick up changes on the user's next focus event.
 *
 * Usage:
 *
 * ```ts
 * import { invalidateContentAccess } from '@codex/content';
 * import { VersionedCache } from '@codex/cache';
 *
 * const cache = new VersionedCache({ kv: env.CACHE_KV });
 * await invalidateContentAccess({
 *   db,
 *   cache,
 *   waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
 *   contentId,
 *   organizationId,
 *   reason: 'content_updated',
 * });
 * ```
 *
 * Fire-and-forget: returns once the user set is resolved and all bumps are
 * handed to `waitUntil`. Individual KV failures are swallowed and logged.
 */

import {
  CacheType,
  invalidateOrgPublicCaches,
  type VersionedCache,
} from '@codex/cache';
import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  ORGANIZATION_TEAM_ROLES,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  organizationFollowers,
  organizationMemberships,
  organizations,
  subscriptions,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { holdersOf } from './content-buyers';

// ============================================================================
// Types
// ============================================================================

/**
 * Why the invalidation fired. Used for observability only — does not affect
 * which cache keys are bumped.
 *
 * Matches the taxonomy of content-adjacent mutations that can change what a
 * given user sees in their library.
 */
export type ContentInvalidationReason =
  | 'content_updated'
  | 'content_unpublished'
  | 'content_deleted'
  | 'content_leaving'
  | 'content_kept'
  | 'content_published'
  | 'membership_role_changed'
  | 'membership_removed'
  | 'membership_invited'
  | 'follower_added'
  | 'follower_removed'
  | 'plan_access_changed';

/**
 * `WaitUntilFn` and `InvalidationLogger` are canonically declared in
 * `@codex/cache` and `@codex/observability` respectively (R11). They are
 * re-exported here so `@codex/content` consumers keep their import path.
 */
import type { InvalidationLogger, WaitUntilFn } from '@codex/cache';

export type { InvalidationLogger, WaitUntilFn };

/**
 * Arguments for `invalidateContentAccess` — content-scoped invalidation.
 */
export interface InvalidateContentAccessArgs {
  db: DatabaseClient;
  cache: VersionedCache;
  waitUntil: WaitUntilFn;
  /** Content that was mutated. Required. */
  contentId: string;
  /** Organization that owns the content, if any. Controls org-collection + org-user fanout. */
  organizationId: string | null;
  /** Observability tag. */
  reason: ContentInvalidationReason;
  /** Optional logger for fire-and-forget failures. */
  logger?: InvalidationLogger;
  /**
   * Include organization followers in the fanout. Default `false` — follower
   * counts can be very large and follower-gated content is the common case
   * where Option B (per-org library version) would be cheaper. We default to
   * false and let `hasFollowerGating` callers opt in.
   */
  includeFollowers?: boolean;
  /**
   * Override the fanout cap. Defaults to `DEFAULT_MAX_LIBRARY_FANOUT` (500).
   * Above this, per-user fanout is skipped (warning logged) and we rely on
   * the client-side visibility staleness check.
   */
  maxFanout?: number;
}

/**
 * Arguments for `invalidateOrgMembership` — membership/follower-scoped
 * invalidation when a single user's (org, role/follow) tuple changes.
 */
export interface InvalidateOrgMembershipArgs {
  cache: VersionedCache;
  waitUntil: WaitUntilFn;
  /** User whose library is now stale. Required. */
  userId: string;
  /** Org that changed membership or follower set. Used for observability only. */
  organizationId: string;
  reason:
    | 'membership_role_changed'
    | 'membership_removed'
    | 'membership_invited'
    | 'follower_added'
    | 'follower_removed';
  logger?: InvalidationLogger;
}

/**
 * Default cap — see note on `maxFanout`.
 *
 * 500 is chosen as a pragmatic upper bound: Cloudflare KV allows ~1000
 * writes/sec per namespace. One bulk mutation can comfortably burn half a
 * second of write budget before the user-facing request returns. Above that,
 * we fall back to the cheaper visibility-change loop instead of DOS'ing KV.
 */
export const DEFAULT_MAX_LIBRARY_FANOUT = 500;

// ============================================================================
// Per-content invalidation (the main entry point)
// ============================================================================

/**
 * Fan content-mutation invalidation to every user who currently has the
 * content in their library, plus bump the catalogue version keys.
 *
 * Behaviour:
 *
 * 1. Always bumps `COLLECTION_CONTENT_PUBLISHED` (fire-and-forget).
 * 2. If `organizationId` is present, bumps `COLLECTION_ORG_CONTENT(orgId)`
 *    (fire-and-forget).
 * 3. Resolves the set of users with library-visibility:
 *    - Holders of the specific content (`holdersOf`: its buyers, anyone given
 *      it, and anyone who bought or was given a course holding it)
 *    - Subscribers to the org with access (active, cancelling, past_due —
 *      `ACCESS_GRANTING_SUBSCRIPTION_STATUSES`; subscription cache is keyed
 *      per-user, not per-content, so any subscription-gated content mutation
 *      stales the whole library entry)
 *    - Management members (owner/admin/creator) of the org
 *    - Optional: followers of the org (gated by `includeFollowers`)
 * 4. If the set exceeds `maxFanout`, logs a warning and skips step 5 — the
 *    visibility-change staleness check will resolve drift on next focus.
 * 5. For each user, fire-and-forget bumps
 *    `COLLECTION_USER_LIBRARY(userId)` via `cache.invalidate`.
 *
 * Returns once the user set is resolved and every bump is handed to
 * `waitUntil`. Individual KV failures are swallowed and logged.
 *
 * Throws `ValidationError` on missing/empty `contentId` — callers should
 * never reach this helper without a resolved content id.
 */
export async function invalidateContentAccess(
  args: InvalidateContentAccessArgs
): Promise<void> {
  const { contentId, organizationId, reason } = args;

  if (typeof contentId !== 'string' || contentId.length === 0) {
    throw new ValidationError(
      'invalidateContentAccess requires a non-empty contentId',
      { reason }
    );
  }

  await invalidateContentAccessMany({
    ...args,
    pieces: [{ id: contentId, organizationId }],
    logContext: { contentId, organizationId },
  });
}

/** A piece whose people to refresh, and the org it is filed in, if any. */
export interface InvalidatedPiece {
  id: string;
  organizationId: string | null;
}

/** The orgs pieces are filed in, each once. */
export function orgsOf(pieces: readonly InvalidatedPiece[]): string[] {
  return [
    ...new Set(
      pieces.flatMap((piece) =>
        piece.organizationId ? [piece.organizationId] : []
      )
    ),
  ];
}

/** Arguments for {@link invalidateContentAccessMany}. */
export interface InvalidateContentAccessManyArgs
  extends Pick<
    InvalidateContentAccessArgs,
    | 'db'
    | 'cache'
    | 'waitUntil'
    | 'reason'
    | 'logger'
    | 'includeFollowers'
    | 'maxFanout'
  > {
  pieces: readonly InvalidatedPiece[];
  /**
   * Bump the catalogue keys (`COLLECTION_CONTENT_PUBLISHED`, each org's
   * `COLLECTION_ORG_CONTENT`) too. Default true. A bulk action's route bumps
   * them itself, once (`afterBulkChange`), so it passes false: KV takes
   * about one write a second to a key.
   */
  catalogue?: boolean;
  /** Merged into every log line, e.g. the one piece's id. */
  logContext?: Record<string, unknown>;
}

/**
 * {@link invalidateContentAccess} for any number of pieces (a bulk action's,
 * Codex-a6ofh.3.5). Each catalogue key is bumped once, however many pieces
 * share it, and each user's library once, however many of the pieces they
 * hold. The users are the union of every piece's, read once per source:
 * the pieces' holders, and their orgs' subscribers, team and (opt-in)
 * followers. Above `maxFanout` users in all, the per-user bumps are skipped
 * (logged).
 */
export async function invalidateContentAccessMany(
  args: InvalidateContentAccessManyArgs
): Promise<void> {
  const {
    db,
    cache,
    waitUntil,
    pieces,
    reason,
    logger,
    includeFollowers = false,
    maxFanout = DEFAULT_MAX_LIBRARY_FANOUT,
    catalogue = true,
    logContext = { pieces: pieces.length },
  } = args;
  if (pieces.length === 0) return;
  const contentIds = [...new Set(pieces.map((piece) => piece.id))];
  const organizationIds = orgsOf(pieces);

  // --- Catalogue bumps ------------------------------------------------------
  if (catalogue) {
    bumpWithLogger(
      cache,
      waitUntil,
      CacheType.COLLECTION_CONTENT_PUBLISHED,
      { reason, ...logContext, key: 'content:published' },
      logger
    );
    for (const organizationId of organizationIds) {
      bumpWithLogger(
        cache,
        waitUntil,
        CacheType.COLLECTION_ORG_CONTENT(organizationId),
        { reason, ...logContext, organizationId, key: 'org:content' },
        logger
      );
    }
  }

  // --- Resolve affected user set ------------------------------------------
  const affectedUserIds = await resolveAffectedUsers({
    db,
    contentIds,
    organizationIds,
    includeFollowers,
  });

  if (affectedUserIds.size === 0) {
    return;
  }

  if (affectedUserIds.size > maxFanout) {
    logger?.warn('content-invalidation: fanout skipped (cap exceeded)', {
      ...logContext,
      reason,
      userCount: affectedUserIds.size,
      maxFanout,
    });
    return;
  }

  // --- Per-user library bumps (fire-and-forget) ---------------------------
  for (const userId of affectedUserIds) {
    bumpWithLogger(
      cache,
      waitUntil,
      CacheType.COLLECTION_USER_LIBRARY(userId),
      { reason, ...logContext, userId, key: 'user:library' },
      logger
    );
  }

  logger?.info?.('content-invalidation: fanout complete', {
    ...logContext,
    reason,
    userCount: affectedUserIds.size,
  });
}

// ============================================================================
// Per-tier invalidation (plan access, Codex-2hxff.91)
// ============================================================================

/** Arguments for {@link invalidatePlanSubscriberLibraries}. */
export interface InvalidatePlanSubscriberLibrariesArgs {
  db: DatabaseClient;
  cache: VersionedCache;
  waitUntil: WaitUntilFn;
  organizationId: string;
  /** The tiers whose contents changed. `[]` bumps the org catalogue only. */
  tierIds: string[];
  reason: 'plan_access_changed';
  logger?: InvalidationLogger;
  /** Override the fanout cap (default {@link DEFAULT_MAX_LIBRARY_FANOUT}). */
  maxFanout?: number;
}

/**
 * A tier's films or courses changed (the checklist, a delete's "move", a
 * create's copy). Bumps the org's content catalogue version (the public list
 * carries each item's `includedInTierIds`) and its public counts (topics,
 * stats, creators), then the library of every user
 * whose subscription to one of `tierIds` grants access now — the same
 * statuses and period test as the decision. Above `maxFanout` the per-user
 * bumps are skipped (logged), as {@link invalidateContentAccess} does.
 */
export async function invalidatePlanSubscriberLibraries(
  args: InvalidatePlanSubscriberLibrariesArgs
): Promise<void> {
  const {
    db,
    cache,
    waitUntil,
    organizationId,
    tierIds,
    reason,
    logger,
    maxFanout = DEFAULT_MAX_LIBRARY_FANOUT,
  } = args;

  bumpWithLogger(
    cache,
    waitUntil,
    CacheType.COLLECTION_ORG_CONTENT(organizationId),
    { reason, organizationId, key: 'org:content' },
    logger
  );
  // Ticks decide which items are CLOSED, and the public counts leave closed
  // items out (review L7): the active topics, and the slug-keyed stats and
  // creators list. The editor's saves bump these already
  // (`bumpOrgContentVersion`); a tick write elsewhere must too, or a topic
  // whose only film just closed keeps its chip until the TTL.
  bumpWithLogger(
    cache,
    waitUntil,
    CacheType.CATEGORIES(organizationId),
    { reason, organizationId, key: 'org:categories' },
    logger
  );
  // The slug-keyed bumps need the slug: one primary-key read, AWAITED so it
  // runs inside the request (review round 2). Handed to a plain `waitUntil`,
  // it raced the request's DB cleanup (`pool.end()`), and a lost race left
  // the stats and creators stale until their TTL. Only the KV bumps are fire
  // and forget. A failed read is logged and never fails the write.
  const logPublicBumpFailure = (error: unknown) => {
    logger?.warn('content-invalidation: bump failed', {
      reason,
      organizationId,
      key: 'org:public',
      error: error instanceof Error ? error.message : String(error),
    });
  };
  const org = await db.query.organizations
    .findFirst({
      where: eq(organizations.id, organizationId),
      columns: { slug: true },
    })
    .catch((error: unknown) => {
      logPublicBumpFailure(error);
      return undefined;
    });
  if (org?.slug) {
    waitUntil(
      invalidateOrgPublicCaches(cache, org.slug).catch(logPublicBumpFailure)
    );
  }

  const ids = [...new Set(tierIds)];
  if (ids.length === 0) return;

  const rows = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.organizationId, organizationId),
      inArray(subscriptions.tierId, ids),
      inArray(subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
      gt(subscriptions.currentPeriodEnd, new Date())
    ),
    columns: { userId: true },
  });
  const userIds = new Set(rows.map((r) => r.userId));
  if (userIds.size === 0) return;
  if (userIds.size > maxFanout) {
    logger?.warn('content-invalidation: tier fanout skipped (cap exceeded)', {
      organizationId,
      reason,
      tierCount: ids.length,
      userCount: userIds.size,
      maxFanout,
    });
    return;
  }
  for (const userId of userIds) {
    bumpWithLogger(
      cache,
      waitUntil,
      CacheType.COLLECTION_USER_LIBRARY(userId),
      { reason, organizationId, userId, key: 'user:library' },
      logger
    );
  }
}

// ============================================================================
// Per-user-in-org invalidation (membership + follower mutations)
// ============================================================================

/**
 * Bump exactly one user's library version. Used for org-membership and
 * follower mutations where we already know the specific user whose library
 * just changed (inviteMember, updateMemberRole, removeMember,
 * followOrganization, unfollowOrganization).
 *
 * Fire-and-forget via `waitUntil` — returns synchronously.
 *
 * Throws `ValidationError` on missing/empty `userId` — callers should never
 * reach this helper without a resolved user id.
 */
export function invalidateOrgMembership(
  args: InvalidateOrgMembershipArgs
): void {
  const { cache, waitUntil, userId, organizationId, reason, logger } = args;

  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ValidationError(
      'invalidateOrgMembership requires a non-empty userId',
      { reason, organizationId }
    );
  }

  bumpWithLogger(
    cache,
    waitUntil,
    CacheType.COLLECTION_USER_LIBRARY(userId),
    { reason, userId, organizationId, key: 'user:library' },
    logger
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

interface ResolveArgs {
  db: DatabaseClient;
  /** The pieces whose buyers count: at least one. */
  contentIds: string[];
  /** The orgs whose subscribers, team and followers count; may be empty. */
  organizationIds: string[];
  includeFollowers: boolean;
}

/**
 * Union-query the set of user ids whose library currently includes (or could
 * include) these pieces: their holders, and their orgs' people. Mirrors the decision tree in
 * `ContentAccessService.hasContentAccess` so the invalidation fanout is a
 * superset of users who could be holding the item.
 *
 * Intentionally a superset: we invalidate a few users who never had access,
 * rather than miss anyone who does. Library items are looked up on reload
 * anyway (the cache is only a UI-flash optimisation), so the cost of a
 * superfluous bump is one extra `GET /api/library` on next focus.
 *
 * The per-source queries run in parallel for minimum latency.
 */
async function resolveAffectedUsers(args: ResolveArgs): Promise<Set<string>> {
  const { db, contentIds, organizationIds, includeFollowers } = args;

  const emptyUserRows: Promise<Array<{ userId: string }>> = Promise.resolve([]);
  const hasOrg = organizationIds.length > 0;

  // Everyone who holds a piece, bought or given, through it or a course
  // (`holdersOf`, the leaving notice's set, Codex-a6ofh.6): a delete or a
  // Keep changes what each of them sees.
  const holders = holdersOf(db, contentIds);
  const holderPromise: Promise<Array<{ userId: string }>> = db
    .select({ userId: holders.userId })
    .from(holders);

  const subscriberPromise: Promise<Array<{ userId: string }>> = hasOrg
    ? db.query.subscriptions.findMany({
        where: and(
          inArray(subscriptions.organizationId, organizationIds),
          inArray(subscriptions.status, [
            ...ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
          ]),
          gt(subscriptions.currentPeriodEnd, new Date())
        ),
        columns: { userId: true },
      })
    : emptyUserRows;

  const managementPromise: Promise<Array<{ userId: string }>> = hasOrg
    ? db.query.organizationMemberships.findMany({
        where: and(
          inArray(organizationMemberships.organizationId, organizationIds),
          eq(organizationMemberships.status, 'active'),
          inArray(organizationMemberships.role, ORGANIZATION_TEAM_ROLES)
        ),
        columns: { userId: true },
      })
    : emptyUserRows;

  const followerPromise: Promise<Array<{ userId: string }>> =
    hasOrg && includeFollowers
      ? db.query.organizationFollowers.findMany({
          where: inArray(organizationFollowers.organizationId, organizationIds),
          columns: { userId: true },
        })
      : emptyUserRows;

  const [holderRows, subscriberRows, managementRows, followerRows] =
    await Promise.all([
      holderPromise,
      subscriberPromise,
      managementPromise,
      followerPromise,
    ]);

  const ids = new Set<string>();
  for (const r of holderRows) ids.add(r.userId);
  for (const r of subscriberRows) ids.add(r.userId);
  for (const r of managementRows) ids.add(r.userId);
  for (const r of followerRows) ids.add(r.userId);
  return ids;
}

/**
 * Internal: queue a single KV version bump via `waitUntil`, swallowing and
 * optionally logging any failure. Mirrors the shape used by
 * `subscription-invalidation.ts` so the two sibling helpers behave
 * identically in the face of KV outages.
 */
function bumpWithLogger(
  cache: VersionedCache,
  waitUntil: WaitUntilFn,
  key: string,
  ctx: Record<string, unknown>,
  logger?: InvalidationLogger
): void {
  const promise = cache.invalidate(key).catch((error: unknown) => {
    logger?.warn('content-invalidation: bump failed', {
      ...ctx,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  waitUntil(promise);
}
