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

import { CacheType, type VersionedCache } from '@codex/cache';
import {
  ORGANIZATION_ROLES,
  PURCHASE_STATUS,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import type { Database } from '@codex/database';
import {
  organizationFollowers,
  organizationMemberships,
  purchases,
  subscriptions,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import { and, eq, gt, inArray } from 'drizzle-orm';

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
  | 'content_published'
  | 'membership_role_changed'
  | 'membership_removed'
  | 'membership_invited'
  | 'follower_added'
  | 'follower_removed';

/**
 * Narrow waitUntil signature. We intentionally do not depend on Hono or
 * workers-types here so this helper stays portable.
 */
export type WaitUntilFn = (promise: Promise<unknown>) => void;

/**
 * Optional logger surface — matches the subset of `ObservabilityClient` the
 * helper uses. Omitted by default so the helper has no runtime deps.
 */
export interface InvalidationLogger {
  warn: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Arguments for `invalidateContentAccess` — content-scoped invalidation.
 */
export interface InvalidateContentAccessArgs {
  db: Database;
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
 *    - Purchasers of the specific content (via `purchases.status='completed'`)
 *    - Active/cancelling subscribers to the org (subscription cache is keyed
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
  const {
    db,
    cache,
    waitUntil,
    contentId,
    organizationId,
    reason,
    logger,
    includeFollowers = false,
    maxFanout = DEFAULT_MAX_LIBRARY_FANOUT,
  } = args;

  if (typeof contentId !== 'string' || contentId.length === 0) {
    throw new ValidationError(
      'invalidateContentAccess requires a non-empty contentId',
      { reason }
    );
  }

  // --- Catalogue bumps (always) -------------------------------------------
  bumpWithLogger(
    cache,
    waitUntil,
    CacheType.COLLECTION_CONTENT_PUBLISHED,
    { reason, contentId, key: 'content:published' },
    logger
  );

  if (organizationId) {
    bumpWithLogger(
      cache,
      waitUntil,
      CacheType.COLLECTION_ORG_CONTENT(organizationId),
      { reason, contentId, key: 'org:content' },
      logger
    );
  }

  // --- Resolve affected user set ------------------------------------------
  const affectedUserIds = await resolveAffectedUsers({
    db,
    contentId,
    organizationId,
    includeFollowers,
  });

  if (affectedUserIds.size === 0) {
    return;
  }

  if (affectedUserIds.size > maxFanout) {
    logger?.warn('content-invalidation: fanout skipped (cap exceeded)', {
      contentId,
      organizationId,
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
      { reason, contentId, organizationId, userId, key: 'user:library' },
      logger
    );
  }

  logger?.info?.('content-invalidation: fanout complete', {
    contentId,
    organizationId,
    reason,
    userCount: affectedUserIds.size,
  });
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
  db: Database;
  contentId: string;
  organizationId: string | null;
  includeFollowers: boolean;
}

/**
 * Union-query the set of user ids whose library currently includes (or could
 * include) this content. Mirrors the decision tree in
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
  const { db, contentId, organizationId, includeFollowers } = args;

  const MANAGEMENT_ROLES: string[] = [
    ORGANIZATION_ROLES.OWNER,
    ORGANIZATION_ROLES.ADMIN,
    ORGANIZATION_ROLES.CREATOR,
  ];

  const emptyUserRows: Promise<Array<{ userId: string }>> = Promise.resolve([]);

  const purchasePromise = db.query.purchases
    .findMany({
      where: and(
        eq(purchases.contentId, contentId),
        eq(purchases.status, PURCHASE_STATUS.COMPLETED)
      ),
      columns: { customerId: true },
    })
    .then((rows) =>
      // Adapt `customerId` to `userId` so the merge loop is uniform.
      rows.map((r) => ({ userId: r.customerId }))
    );

  const subscriberPromise: Promise<Array<{ userId: string }>> = organizationId
    ? db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.organizationId, organizationId),
          inArray(subscriptions.status, [
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.CANCELLING,
          ]),
          gt(subscriptions.currentPeriodEnd, new Date())
        ),
        columns: { userId: true },
      })
    : emptyUserRows;

  const managementPromise: Promise<Array<{ userId: string }>> = organizationId
    ? db.query.organizationMemberships.findMany({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
          inArray(organizationMemberships.role, MANAGEMENT_ROLES)
        ),
        columns: { userId: true },
      })
    : emptyUserRows;

  const followerPromise: Promise<Array<{ userId: string }>> =
    organizationId && includeFollowers
      ? db.query.organizationFollowers.findMany({
          where: eq(organizationFollowers.organizationId, organizationId),
          columns: { userId: true },
        })
      : emptyUserRows;

  const [purchaseRows, subscriberRows, managementRows, followerRows] =
    await Promise.all([
      purchasePromise,
      subscriberPromise,
      managementPromise,
      followerPromise,
    ]);

  const ids = new Set<string>();
  for (const r of purchaseRows) ids.add(r.userId);
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
