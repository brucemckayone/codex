/**
 * Fee Config Service — singleton-row revenue-model knobs
 *
 * Reads and writes `revenue_model_config` (a singleton table with
 * `id = 'singleton'`). Provides cache-aside reads via `VersionedCache`
 * with a 10min TTL, fire-and-forget invalidation on writes, and
 * code-default fallback when no row exists yet (fresh install).
 *
 * Floor logic stays out of `calculateRevenueSplit` — callers compute the
 * effective `platformFeePercent` BEFORE invoking the pure calc when the
 * `minPlatformFeeCents` floor would otherwise dominate. See JSDoc on
 * `getFees()` for the canonical floor-application pattern.
 *
 * @module fee-config-service
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import { FEES } from '@codex/constants';
import { revenueModelConfig } from '@codex/database/schema';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import { eq } from 'drizzle-orm';

/**
 * Singleton primary-key value enforced by the DB CHECK constraint.
 * Exported so callers (tests, scripts) can reference it without
 * re-typing the magic string.
 */
export const REVENUE_MODEL_SINGLETON_ID = 'singleton' as const;

/**
 * Resolved fee configuration. All percentages are basis points
 * (10000 = 100%). All amounts are integer cents (pence for GBP).
 */
export interface FeeConfig {
  /** Platform's cut of gross, in basis points. */
  platformFeePercent: number;
  /** Org's cut of post-platform-fee for subscriptions, in basis points. */
  subscriptionOrgFeePercent: number;
  /** Floor applied per-transaction when computing the platform fee. */
  minPlatformFeeCents: number;
  /** Floor applied at transfer-execution time. */
  minTransferCents: number;
}

/**
 * Partial update payload accepted by `updateFees()`. Any field that
 * is `undefined` is preserved from the existing row (or from the
 * code-default fallback when no row exists yet).
 */
export type FeeConfigUpdate = Partial<FeeConfig>;

interface FeeConfigServiceConfig extends ServiceConfig {
  /**
   * Optional KV-backed versioned cache. When provided, `getFees()` uses
   * cache-aside with a 10min TTL and `updateFees()` invalidates the
   * cache (fire-and-forget). Absent in narrow unit tests; in workers
   * the service-registry wires `env.CACHE_KV` here.
   */
  cache?: VersionedCache;
}

/**
 * Default fee configuration sourced from the code-default `FEES.*`
 * constants. Returned by `getFees()` when no DB row exists. Exported
 * so callers can compare against it for "is this a fresh install?"
 * checks.
 */
export const DEFAULT_FEE_CONFIG: FeeConfig = {
  platformFeePercent: FEES.PLATFORM_PERCENT,
  subscriptionOrgFeePercent: FEES.SUBSCRIPTION_ORG_PERCENT,
  minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
  minTransferCents: FEES.MIN_TRANSFER_CENTS,
};

/**
 * Compute the platform fee for a transaction with the floor applied.
 *
 * Pure utility — keeps the floor logic in one place so callers don't
 * each reinvent the `max(percentage, floor)` clamp. Callers should
 * use the returned `effectivePlatformFeeCents` as the platform's cut
 * directly, and pass the remainder (`amountCents - effectivePlatformFeeCents`)
 * to whatever computes the org/creator split. Alternatively, the
 * returned `effectivePlatformFeePercent` can be plugged into
 * `calculateRevenueSplit(amountCents, effectivePlatformFeePercent, orgFeePercent)`
 * when the resulting fee is still expressible as a basis-point
 * percentage of gross — for small amounts where the floor dominates,
 * this rounds back to the floor value via `Math.ceil`.
 *
 * @param amountCents - Gross transaction amount in cents
 * @param fees - Resolved FeeConfig (from `FeeConfigService.getFees()`)
 * @returns The floored platform fee in cents AND the basis-point
 *          percentage that would produce that fee (clamped to 10000).
 */
export function applyPlatformFeeFloor(
  amountCents: number,
  fees: Pick<FeeConfig, 'platformFeePercent' | 'minPlatformFeeCents'>
): { effectivePlatformFeeCents: number; effectivePlatformFeePercent: number } {
  if (amountCents <= 0) {
    return {
      effectivePlatformFeeCents: 0,
      effectivePlatformFeePercent: 0,
    };
  }

  const percentageFeeCents = Math.ceil(
    (amountCents * fees.platformFeePercent) / 10000
  );
  const effectivePlatformFeeCents = Math.max(
    percentageFeeCents,
    fees.minPlatformFeeCents
  );

  // Convert back to a basis-point percentage so the caller can pass it
  // straight into the pure `calculateRevenueSplit(amountCents, X, Y)`.
  // `Math.ceil` inside calculateRevenueSplit will re-round to the same
  // cent value when the floor is dominant.
  // Clamp to 10000 in case the floor exceeds the gross (degenerate
  // micro-transaction); calculateRevenueSplit rejects > 10000.
  const effectivePlatformFeePercent = Math.min(
    Math.ceil((effectivePlatformFeeCents / amountCents) * 10000),
    10000
  );

  return { effectivePlatformFeeCents, effectivePlatformFeePercent };
}

/**
 * FeeConfigService — read/write the singleton revenue-model row.
 *
 * Reads are cache-aside (10min TTL); writes invalidate the cache
 * after a successful DB upsert. Cache absence degrades gracefully —
 * every call hits the DB and the fallback path still works.
 */
export class FeeConfigService extends BaseService {
  /** Cache TTL for `getFees()` — 10 minutes. */
  private static readonly CACHE_TTL_SECONDS = 600;

  private readonly cache: VersionedCache | undefined;

  /**
   * Whether the fresh-install fallback has already been logged this
   * process lifetime. Prevents log spam — operator only needs to see
   * "no row, using FEES.*" once per worker boot.
   */
  private fallbackLogged = false;

  constructor(config: FeeConfigServiceConfig) {
    super(config);
    this.cache = config.cache;
  }

  /**
   * Resolve the platform fee configuration.
   *
   * Order of preference:
   *   1. Cached row (if cache is wired and warm)
   *   2. DB row at `id = 'singleton'`
   *   3. Code-default `FEES.*` constants (logs INFO once per process)
   *
   * Callers should invoke this ONCE per request and thread the result
   * through to whatever needs `platformFeePercent`/
   * `subscriptionOrgFeePercent`/floors — repeated calls add latency
   * without changing the answer within a TTL window.
   */
  async getFees(): Promise<FeeConfig> {
    try {
      if (this.cache) {
        return await this.cache.get(
          REVENUE_MODEL_SINGLETON_ID,
          CacheType.PLATFORM_FEE_CONFIG,
          () => this.fetchFromDb(),
          { ttl: FeeConfigService.CACHE_TTL_SECONDS }
        );
      }
      return await this.fetchFromDb();
    } catch (error) {
      this.handleError(error, 'getFees');
    }
  }

  /**
   * Update the singleton row. Partial — any field omitted is preserved
   * from the existing row (or filled from the code-default fallback
   * when no row exists yet, so the first write doesn't have to set
   * every column).
   *
   * @param updates - Partial FeeConfig with new values
   * @param updatedBy - userId of the operator performing the update.
   *                   Required at the service layer; persists to
   *                   `updated_by` FK on `revenue_model_config`.
   * @returns The fully resolved FeeConfig after the write.
   */
  async updateFees(
    updates: FeeConfigUpdate,
    updatedBy: string
  ): Promise<FeeConfig> {
    try {
      if (!updatedBy) {
        throw new ValidationError(
          'updatedBy userId is required to update fee configuration',
          { type: 'missing_updated_by' }
        );
      }

      // Resolve the base row (existing or default) so partial updates
      // preserve unset columns. `fetchFromDb()` returns DEFAULT_FEE_CONFIG
      // on miss — same fallback path `getFees()` uses.
      const current = await this.fetchFromDb();
      const merged: FeeConfig = {
        platformFeePercent:
          updates.platformFeePercent ?? current.platformFeePercent,
        subscriptionOrgFeePercent:
          updates.subscriptionOrgFeePercent ??
          current.subscriptionOrgFeePercent,
        minPlatformFeeCents:
          updates.minPlatformFeeCents ?? current.minPlatformFeeCents,
        minTransferCents: updates.minTransferCents ?? current.minTransferCents,
      };

      this.validateFeeConfig(merged);

      const now = new Date();
      await this.db
        .insert(revenueModelConfig)
        .values({
          id: REVENUE_MODEL_SINGLETON_ID,
          platformFeePercent: merged.platformFeePercent,
          subscriptionOrgFeePercent: merged.subscriptionOrgFeePercent,
          minPlatformFeeCents: merged.minPlatformFeeCents,
          minTransferCents: merged.minTransferCents,
          updatedBy,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: revenueModelConfig.id,
          set: {
            platformFeePercent: merged.platformFeePercent,
            subscriptionOrgFeePercent: merged.subscriptionOrgFeePercent,
            minPlatformFeeCents: merged.minPlatformFeeCents,
            minTransferCents: merged.minTransferCents,
            updatedBy,
            updatedAt: now,
          },
        });

      // Fire-and-forget invalidation — the cache wrapper already
      // guarantees graceful degradation on failure, so we don't await
      // or surface the error. Mirrors the IdentityService pattern.
      if (this.cache) {
        await this.cache.invalidate(REVENUE_MODEL_SINGLETON_ID).catch((err) => {
          this.obs.warn('FeeConfigService cache invalidate failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      this.obs.info('Revenue model config updated', {
        updatedBy,
        platformFeePercent: merged.platformFeePercent,
        subscriptionOrgFeePercent: merged.subscriptionOrgFeePercent,
        minPlatformFeeCents: merged.minPlatformFeeCents,
        minTransferCents: merged.minTransferCents,
      });

      return merged;
    } catch (error) {
      this.handleError(error, 'updateFees');
    }
  }

  /**
   * DB read used by both `getFees()` (as the cache fetcher) and
   * `updateFees()` (to resolve the merge base for partial updates).
   * Returns DEFAULT_FEE_CONFIG on miss and logs INFO once per process.
   */
  private async fetchFromDb(): Promise<FeeConfig> {
    const [row] = await this.db
      .select({
        platformFeePercent: revenueModelConfig.platformFeePercent,
        subscriptionOrgFeePercent: revenueModelConfig.subscriptionOrgFeePercent,
        minPlatformFeeCents: revenueModelConfig.minPlatformFeeCents,
        minTransferCents: revenueModelConfig.minTransferCents,
      })
      .from(revenueModelConfig)
      .where(eq(revenueModelConfig.id, REVENUE_MODEL_SINGLETON_ID))
      .limit(1);

    if (!row) {
      if (!this.fallbackLogged) {
        this.obs.info(
          'No revenue_model_config row found — using code-default FEES.* constants',
          {
            defaults: DEFAULT_FEE_CONFIG,
          }
        );
        this.fallbackLogged = true;
      }
      return { ...DEFAULT_FEE_CONFIG };
    }

    return {
      platformFeePercent: row.platformFeePercent,
      subscriptionOrgFeePercent: row.subscriptionOrgFeePercent,
      minPlatformFeeCents: row.minPlatformFeeCents,
      minTransferCents: row.minTransferCents,
    };
  }

  /**
   * Domain validation — guards against operator typos before they
   * reach the DB CHECK constraints. Each field has identical bounds
   * to the underlying CHECK so the error surface is consistent.
   */
  private validateFeeConfig(fees: FeeConfig): void {
    const failures: string[] = [];

    if (
      !Number.isInteger(fees.platformFeePercent) ||
      fees.platformFeePercent < 0 ||
      fees.platformFeePercent > 10000
    ) {
      failures.push(
        'platformFeePercent must be an integer between 0 and 10000'
      );
    }
    if (
      !Number.isInteger(fees.subscriptionOrgFeePercent) ||
      fees.subscriptionOrgFeePercent < 0 ||
      fees.subscriptionOrgFeePercent > 10000
    ) {
      failures.push(
        'subscriptionOrgFeePercent must be an integer between 0 and 10000'
      );
    }
    if (
      !Number.isInteger(fees.minPlatformFeeCents) ||
      fees.minPlatformFeeCents < 0
    ) {
      failures.push('minPlatformFeeCents must be a non-negative integer');
    }
    if (!Number.isInteger(fees.minTransferCents) || fees.minTransferCents < 0) {
      failures.push('minTransferCents must be a non-negative integer');
    }

    if (failures.length > 0) {
      throw new ValidationError(
        `Invalid fee configuration: ${failures.join('; ')}`,
        { failures }
      );
    }
  }
}
