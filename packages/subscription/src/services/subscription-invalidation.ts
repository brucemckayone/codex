/**
 * Shared subscription cache invalidation helper.
 *
 * Factored out of the ecom-api subscription webhook + direct-mutation
 * routes so every subscription lifecycle event invalidates the same two
 * KV version keys (`COLLECTION_USER_LIBRARY` and, when an org is involved,
 * `COLLECTION_USER_SUBSCRIPTION`).
 *
 * See `docs/subscription-cache-audit/phase-1-p0.md` for the motivating
 * invalidation-gap matrix. The rule is: every subscription state change
 * invalidates BOTH the library cache (what content can I see) AND the
 * per-org subscription cache (what's my active tier). Invalidating only
 * one leads to split-brain UI across devices.
 *
 * Usage:
 *
 * ```ts
 * import { invalidateForUser } from '@codex/subscription';
 * import { VersionedCache } from '@codex/cache';
 *
 * const cache = new VersionedCache({ kv: env.CACHE_KV });
 * invalidateForUser(cache, ctx.executionCtx.waitUntil.bind(ctx.executionCtx), {
 *   userId,
 *   orgId,
 *   reason: 'cancel',
 * });
 * ```
 *
 * The helper returns synchronously — the `waitUntil` runtime is responsible
 * for letting the underlying KV writes settle after the response is sent.
 */

import {
  CacheType,
  type InvalidationLogger,
  type VersionedCache,
  type WaitUntilFn,
} from '@codex/cache';
import { ValidationError } from '@codex/service-errors';

// `InvalidationLogger` and `WaitUntilFn` are canonically declared in
// `@codex/observability` and `@codex/cache` respectively (R11). They are
// re-exported here so `@codex/subscription` consumers keep their import path.
export type { InvalidationLogger, WaitUntilFn };

/**
 * Why the invalidation fired. Used for observability only — does not affect
 * which cache keys are bumped.
 */
export type InvalidationReason =
  | 'cancel'
  | 'reactivate'
  | 'change_tier'
  | 'payment_failed'
  | 'payment_succeeded'
  | 'refund'
  | 'subscription_created'
  | 'subscription_deleted'
  | 'subscription_paused'
  | 'subscription_resumed'
  | 'subscription_updated';

export interface InvalidateForUserArgs {
  /** User whose library + subscription caches should be bumped. Required. */
  userId: string;
  /**
   * Org associated with the subscription event, if any. When present the
   * per-org subscription cache is also bumped. When absent only the library
   * cache is bumped (e.g. a refund that isn't tied to a specific org).
   */
  orgId?: string;
  /** Observability tag — what triggered this invalidation. */
  reason: InvalidationReason;
}

export interface InvalidateForUserOptions {
  /** Optional logger for fire-and-forget failures. */
  logger?: InvalidationLogger;
}

/**
 * Bump the per-user KV version keys for subscription-affecting events.
 *
 * - Always bumps `COLLECTION_USER_LIBRARY(userId)`.
 * - If `orgId` is present, also bumps `COLLECTION_USER_SUBSCRIPTION(userId, orgId)`.
 * - Each bump is fire-and-forget: the promise is handed to `waitUntil` with a
 *   `.catch()` guard so a KV failure can never surface to the caller or the
 *   response.
 * - Returns synchronously — safe to call from a webhook handler right before
 *   returning a 200.
 *
 * Throws `ValidationError` if `userId` is missing or empty: the caller
 * extracted the wrong field and we want that to surface loudly in tests
 * rather than silently no-op.
 */
export function invalidateForUser(
  cache: VersionedCache,
  waitUntil: WaitUntilFn,
  args: InvalidateForUserArgs,
  options: InvalidateForUserOptions = {}
): void {
  const { userId, orgId, reason } = args;

  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ValidationError('invalidateForUser requires a non-empty userId', {
      reason,
    });
  }

  const { logger } = options;

  const libraryPromise = cache
    .invalidate(CacheType.COLLECTION_USER_LIBRARY(userId))
    .catch((error: unknown) => {
      logger?.warn('subscription-invalidation: library bump failed', {
        userId,
        orgId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  waitUntil(libraryPromise);

  if (typeof orgId === 'string' && orgId.length > 0) {
    const subscriptionPromise = cache
      .invalidate(CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId))
      .catch((error: unknown) => {
        logger?.warn('subscription-invalidation: subscription bump failed', {
          userId,
          orgId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    waitUntil(subscriptionPromise);
  }
}
