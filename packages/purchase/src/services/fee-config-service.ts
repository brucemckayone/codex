/**
 * Fee Configuration Service (Codex-m644n)
 *
 * Read-side fallback chain (override → org → platform → code constants) and
 * write-side mutations with version-bump cache invalidation + audit logging.
 *
 * Architecture (locked by user 2026-05-13 in closed bead Codex-8qmop):
 *   creator-override → org-default → platform-default → FEES.* constants
 *
 * Caching: uses @codex/cache VersionedCache. No TTL — data is effectively
 * immutable between writes. Writers bump the row's `version` column then call
 * `cache.invalidate(id)` to advance the cache's version key for the entity.
 *
 * Cache key scheme:
 *   id='platform'                       → fee_config_platform singleton
 *   id='org:${orgId}'                   → fee_config_org row
 *   id='override:${orgId}:${creatorId}' → fee_config_org_creator row
 *
 * No public web routes consume this service. The internal admin-api endpoints
 * (/api/admin/fees/*) are the only mutation surface today; future local admin
 * desktop app (Codex-xyb7v epic) is the planned UI.
 *
 * @module fee-config-service
 */

import type { VersionedCache } from '@codex/cache';
import { CacheType } from '@codex/cache';
import { FEES } from '@codex/constants';
import type { Database } from '@codex/database';
import {
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigPlatform,
} from '@codex/database/schema';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import { and, desc, eq, sql } from 'drizzle-orm';

// ─── Public types ───────────────────────────────────────────────────────────

export type FeeContext = 'subscription' | 'one_off';

export interface FeeConfig {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

export interface FeeConfigUpdate {
  platformFeePercent?: number | null;
  orgFeePercent?: number | null;
  minPlatformFeeCents?: number | null;
  minTransferCents?: number | null;
}

export interface PlatformFeeConfigUpdate {
  platformFeePercent?: number;
  subscriptionOrgFeePercent?: number;
  oneOffOrgFeePercent?: number;
  minPlatformFeeCents?: number;
  minTransferCents?: number;
}

export interface CreatorOverrideUpdate extends FeeConfigUpdate {
  notes?: string | null;
}

export interface AuditLogEntry {
  id: string;
  scope: 'platform' | 'org' | 'override';
  scopeOrgId: string | null;
  scopeCreatorId: string | null;
  columnName: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: Date;
}

export interface AuditLogFilters {
  scope?: 'platform' | 'org' | 'override';
  orgId?: string;
  creatorId?: string;
  limit?: number;
}

// ─── Code-default fallback ──────────────────────────────────────────────────

const CODE_DEFAULT_SUBSCRIPTION: Readonly<FeeConfig> = Object.freeze({
  platformFeePercent: FEES.PLATFORM_PERCENT,
  orgFeePercent: FEES.SUBSCRIPTION_ORG_PERCENT,
  minPlatformFeeCents: 0,
  minTransferCents: 0,
});

const CODE_DEFAULT_ONE_OFF: Readonly<FeeConfig> = Object.freeze({
  platformFeePercent: FEES.PLATFORM_PERCENT,
  orgFeePercent: FEES.ORG_PERCENT,
  minPlatformFeeCents: 0,
  minTransferCents: 0,
});

function codeDefault(ctx: FeeContext): FeeConfig {
  return ctx === 'subscription'
    ? { ...CODE_DEFAULT_SUBSCRIPTION }
    : { ...CODE_DEFAULT_ONE_OFF };
}

// ─── Audit helpers ──────────────────────────────────────────────────────────

type DiffEntry = {
  columnName: string;
  oldValue: string | null;
  newValue: string;
};

/**
 * Diff a partial update against the existing row, producing one diff entry per
 * column the caller actually wants to change. Skips no-op writes (same value).
 */
function diffUpdate(
  existing: Record<string, unknown> | null,
  updates: Record<string, unknown>
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const old = existing?.[key] ?? null;
    if (String(old) === String(value)) continue;
    entries.push({
      columnName: key,
      oldValue: old === null || old === undefined ? null : String(old),
      newValue: String(value),
    });
  }
  return entries;
}

// ─── Cache key builders ─────────────────────────────────────────────────────

const PLATFORM_CACHE_ID = 'platform';
function orgCacheId(orgId: string): string {
  return `org:${orgId}`;
}
function overrideCacheId(orgId: string, creatorId: string): string {
  return `override:${orgId}:${creatorId}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

interface FeeConfigServiceConfig extends ServiceConfig {
  cache?: VersionedCache;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export class FeeConfigService extends BaseService {
  private readonly cache?: VersionedCache;
  private readonly waitUntil?: (promise: Promise<unknown>) => void;

  constructor(config: FeeConfigServiceConfig) {
    super(config);
    this.cache = config.cache;
    this.waitUntil = config.waitUntil;
  }

  // ── READ: fallback chain ────────────────────────────────────────────────

  async getFeesForCreator(
    orgId: string,
    creatorId: string,
    ctx: FeeContext
  ): Promise<FeeConfig> {
    try {
      const [override, orgFees, platform] = await Promise.all([
        this.readCreatorOverride(orgId, creatorId),
        this.readOrgFees(orgId),
        this.readPlatformFees(),
      ]);
      const base = this.resolveFromPlatform(platform, ctx);
      const withOrg = this.layerOverride(base, orgFees);
      return this.layerOverride(withOrg, override);
    } catch (error) {
      this.handleError(error, 'getFeesForCreator');
    }
  }

  async getFeesForOrg(orgId: string, ctx: FeeContext): Promise<FeeConfig> {
    try {
      const [orgFees, platform] = await Promise.all([
        this.readOrgFees(orgId),
        this.readPlatformFees(),
      ]);
      const base = this.resolveFromPlatform(platform, ctx);
      return this.layerOverride(base, orgFees);
    } catch (error) {
      this.handleError(error, 'getFeesForOrg');
    }
  }

  async getFeesPlatform(ctx: FeeContext): Promise<FeeConfig> {
    try {
      const platform = await this.readPlatformFees();
      return this.resolveFromPlatform(platform, ctx);
    } catch (error) {
      this.handleError(error, 'getFeesPlatform');
    }
  }

  // ── WRITE: platform ─────────────────────────────────────────────────────

  async updatePlatformFees(
    updates: PlatformFeeConfigUpdate,
    updatedBy: string
  ): Promise<void> {
    this.validateUpdates(updates);
    try {
      const existing = await this.fetchPlatformRow();
      const diff = diffUpdate(existing as Record<string, unknown> | null, {
        platformFeePercent: updates.platformFeePercent,
        subscriptionOrgFeePercent: updates.subscriptionOrgFeePercent,
        oneOffOrgFeePercent: updates.oneOffOrgFeePercent,
        minPlatformFeeCents: updates.minPlatformFeeCents,
        minTransferCents: updates.minTransferCents,
      });
      if (diff.length === 0) return;

      const merged = {
        platformFeePercent:
          updates.platformFeePercent ??
          existing?.platformFeePercent ??
          FEES.PLATFORM_PERCENT,
        subscriptionOrgFeePercent:
          updates.subscriptionOrgFeePercent ??
          existing?.subscriptionOrgFeePercent ??
          FEES.SUBSCRIPTION_ORG_PERCENT,
        oneOffOrgFeePercent:
          updates.oneOffOrgFeePercent ??
          existing?.oneOffOrgFeePercent ??
          FEES.ORG_PERCENT,
        minPlatformFeeCents:
          updates.minPlatformFeeCents ?? existing?.minPlatformFeeCents ?? 0,
        minTransferCents:
          updates.minTransferCents ?? existing?.minTransferCents ?? 0,
      };

      await (this.db as Database)
        .insert(feeConfigPlatform)
        .values({
          id: 'singleton',
          ...merged,
          version: 1,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: feeConfigPlatform.id,
          set: {
            ...merged,
            version: sql`${feeConfigPlatform.version} + 1`,
            updatedBy,
            updatedAt: new Date(),
          },
        });

      await this.writeAuditEntries('platform', null, null, diff, updatedBy);
      this.invalidateAsync(PLATFORM_CACHE_ID);
    } catch (error) {
      this.handleError(error, 'updatePlatformFees');
    }
  }

  // ── WRITE: org ──────────────────────────────────────────────────────────

  async updateOrgFees(
    orgId: string,
    updates: FeeConfigUpdate,
    updatedBy: string
  ): Promise<void> {
    this.validateUpdates(updates);
    try {
      const existing = await this.fetchOrgRow(orgId);
      const diff = diffUpdate(existing as Record<string, unknown> | null, {
        platformFeePercent: updates.platformFeePercent,
        orgFeePercent: updates.orgFeePercent,
        minPlatformFeeCents: updates.minPlatformFeeCents,
        minTransferCents: updates.minTransferCents,
      });
      if (diff.length === 0) return;

      const merged = {
        platformFeePercent:
          updates.platformFeePercent ?? existing?.platformFeePercent ?? null,
        orgFeePercent: updates.orgFeePercent ?? existing?.orgFeePercent ?? null,
        minPlatformFeeCents:
          updates.minPlatformFeeCents ?? existing?.minPlatformFeeCents ?? null,
        minTransferCents:
          updates.minTransferCents ?? existing?.minTransferCents ?? null,
      };

      await (this.db as Database)
        .insert(feeConfigOrg)
        .values({
          organizationId: orgId,
          ...merged,
          version: 1,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: feeConfigOrg.organizationId,
          set: {
            ...merged,
            version: sql`${feeConfigOrg.version} + 1`,
            updatedBy,
            updatedAt: new Date(),
          },
        });

      await this.writeAuditEntries('org', orgId, null, diff, updatedBy);
      this.invalidateAsync(orgCacheId(orgId));
    } catch (error) {
      this.handleError(error, 'updateOrgFees');
    }
  }

  async deleteOrgFees(orgId: string, deletedBy: string): Promise<void> {
    try {
      const existing = await this.fetchOrgRow(orgId);
      if (!existing) return;

      const diff = diffUpdate(existing as Record<string, unknown>, {
        platformFeePercent: null,
        orgFeePercent: null,
        minPlatformFeeCents: null,
        minTransferCents: null,
      });

      await (this.db as Database)
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, orgId));

      if (diff.length > 0) {
        await this.writeAuditEntries('org', orgId, null, diff, deletedBy);
      }
      this.invalidateAsync(orgCacheId(orgId));
    } catch (error) {
      this.handleError(error, 'deleteOrgFees');
    }
  }

  // ── WRITE: creator override ─────────────────────────────────────────────

  async upsertCreatorOverride(
    orgId: string,
    creatorId: string,
    updates: CreatorOverrideUpdate,
    updatedBy: string
  ): Promise<void> {
    this.validateUpdates(updates);
    try {
      const existing = await this.fetchOverrideRow(orgId, creatorId);
      const diff = diffUpdate(existing as Record<string, unknown> | null, {
        platformFeePercent: updates.platformFeePercent,
        orgFeePercent: updates.orgFeePercent,
        minPlatformFeeCents: updates.minPlatformFeeCents,
        minTransferCents: updates.minTransferCents,
        notes: updates.notes,
      });
      if (diff.length === 0) return;

      const merged = {
        platformFeePercent:
          updates.platformFeePercent ?? existing?.platformFeePercent ?? null,
        orgFeePercent: updates.orgFeePercent ?? existing?.orgFeePercent ?? null,
        minPlatformFeeCents:
          updates.minPlatformFeeCents ?? existing?.minPlatformFeeCents ?? null,
        minTransferCents:
          updates.minTransferCents ?? existing?.minTransferCents ?? null,
        notes: updates.notes ?? existing?.notes ?? null,
      };

      await (this.db as Database)
        .insert(feeConfigOrgCreator)
        .values({
          organizationId: orgId,
          creatorId,
          ...merged,
          version: 1,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: [
            feeConfigOrgCreator.organizationId,
            feeConfigOrgCreator.creatorId,
          ],
          set: {
            ...merged,
            version: sql`${feeConfigOrgCreator.version} + 1`,
            updatedBy,
            updatedAt: new Date(),
          },
        });

      await this.writeAuditEntries(
        'override',
        orgId,
        creatorId,
        diff,
        updatedBy
      );
      this.invalidateAsync(overrideCacheId(orgId, creatorId));
    } catch (error) {
      this.handleError(error, 'upsertCreatorOverride');
    }
  }

  async deleteCreatorOverride(
    orgId: string,
    creatorId: string,
    deletedBy: string
  ): Promise<void> {
    try {
      const existing = await this.fetchOverrideRow(orgId, creatorId);
      if (!existing) return;

      const diff = diffUpdate(existing as Record<string, unknown>, {
        platformFeePercent: null,
        orgFeePercent: null,
        minPlatformFeeCents: null,
        minTransferCents: null,
        notes: null,
      });

      await (this.db as Database)
        .delete(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, orgId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
        );

      if (diff.length > 0) {
        await this.writeAuditEntries(
          'override',
          orgId,
          creatorId,
          diff,
          deletedBy
        );
      }
      this.invalidateAsync(overrideCacheId(orgId, creatorId));
    } catch (error) {
      this.handleError(error, 'deleteCreatorOverride');
    }
  }

  // ── READ: admin convenience ─────────────────────────────────────────────

  async getPlatformRow() {
    return this.fetchPlatformRow();
  }

  async getOrgRow(orgId: string) {
    return this.fetchOrgRow(orgId);
  }

  async getCreatorOverrideRow(orgId: string, creatorId: string) {
    return this.fetchOverrideRow(orgId, creatorId);
  }

  async listCreatorOverrides(orgId: string) {
    return (this.db as Database)
      .select()
      .from(feeConfigOrgCreator)
      .where(eq(feeConfigOrgCreator.organizationId, orgId))
      .orderBy(desc(feeConfigOrgCreator.updatedAt));
  }

  async getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
    try {
      const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
      const clauses = [];
      if (filters.scope)
        clauses.push(eq(feeConfigAuditLog.scope, filters.scope));
      if (filters.orgId)
        clauses.push(eq(feeConfigAuditLog.scopeOrgId, filters.orgId));
      if (filters.creatorId)
        clauses.push(eq(feeConfigAuditLog.scopeCreatorId, filters.creatorId));

      const rows = await (this.db as Database)
        .select()
        .from(feeConfigAuditLog)
        .where(clauses.length > 0 ? and(...clauses) : undefined)
        .orderBy(desc(feeConfigAuditLog.changedAt))
        .limit(limit);

      return rows.map((r) => ({
        id: r.id,
        scope: r.scope as AuditLogEntry['scope'],
        scopeOrgId: r.scopeOrgId,
        scopeCreatorId: r.scopeCreatorId,
        columnName: r.columnName,
        oldValue: r.oldValue,
        newValue: r.newValue,
        changedBy: r.changedBy,
        changedAt: r.changedAt,
      }));
    } catch (error) {
      this.handleError(error, 'getAuditLog');
    }
  }

  // ── Private resolvers ───────────────────────────────────────────────────

  private resolveFromPlatform(
    row: {
      platformFeePercent: number;
      subscriptionOrgFeePercent: number;
      oneOffOrgFeePercent: number;
      minPlatformFeeCents: number;
      minTransferCents: number;
    } | null,
    ctx: FeeContext
  ): FeeConfig {
    if (!row) return codeDefault(ctx);
    return {
      platformFeePercent: row.platformFeePercent,
      orgFeePercent:
        ctx === 'subscription'
          ? row.subscriptionOrgFeePercent
          : row.oneOffOrgFeePercent,
      minPlatformFeeCents: row.minPlatformFeeCents,
      minTransferCents: row.minTransferCents,
    };
  }

  private layerOverride(
    base: FeeConfig,
    override: {
      platformFeePercent?: number | null;
      orgFeePercent?: number | null;
      minPlatformFeeCents?: number | null;
      minTransferCents?: number | null;
    } | null
  ): FeeConfig {
    if (!override) return base;
    return {
      platformFeePercent:
        override.platformFeePercent ?? base.platformFeePercent,
      orgFeePercent: override.orgFeePercent ?? base.orgFeePercent,
      minPlatformFeeCents:
        override.minPlatformFeeCents ?? base.minPlatformFeeCents,
      minTransferCents: override.minTransferCents ?? base.minTransferCents,
    };
  }

  // ── Cache-aside DB reads ────────────────────────────────────────────────

  private async readPlatformFees() {
    if (!this.cache) return this.fetchPlatformRow();
    return this.cache.get(
      PLATFORM_CACHE_ID,
      CacheType.FEE_CONFIG_PLATFORM,
      () => this.fetchPlatformRow()
    );
  }

  private async readOrgFees(orgId: string) {
    if (!this.cache) return this.fetchOrgRow(orgId);
    return this.cache.get(orgCacheId(orgId), CacheType.FEE_CONFIG_ORG, () =>
      this.fetchOrgRow(orgId)
    );
  }

  private async readCreatorOverride(orgId: string, creatorId: string) {
    if (!this.cache) return this.fetchOverrideRow(orgId, creatorId);
    return this.cache.get(
      overrideCacheId(orgId, creatorId),
      CacheType.FEE_CONFIG_OVERRIDE,
      () => this.fetchOverrideRow(orgId, creatorId)
    );
  }

  // ── Raw DB reads ────────────────────────────────────────────────────────

  private async fetchPlatformRow() {
    const [row] = await (this.db as Database)
      .select()
      .from(feeConfigPlatform)
      .where(eq(feeConfigPlatform.id, 'singleton'))
      .limit(1);
    return row ?? null;
  }

  private async fetchOrgRow(orgId: string) {
    const [row] = await (this.db as Database)
      .select()
      .from(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, orgId))
      .limit(1);
    return row ?? null;
  }

  private async fetchOverrideRow(orgId: string, creatorId: string) {
    const [row] = await (this.db as Database)
      .select()
      .from(feeConfigOrgCreator)
      .where(
        and(
          eq(feeConfigOrgCreator.organizationId, orgId),
          eq(feeConfigOrgCreator.creatorId, creatorId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  // ── Audit log writer ────────────────────────────────────────────────────

  private async writeAuditEntries(
    scope: 'platform' | 'org' | 'override',
    scopeOrgId: string | null,
    scopeCreatorId: string | null,
    diff: DiffEntry[],
    changedBy: string
  ): Promise<void> {
    if (diff.length === 0) return;
    await (this.db as Database).insert(feeConfigAuditLog).values(
      diff.map((d) => ({
        scope,
        scopeOrgId,
        scopeCreatorId,
        columnName: d.columnName,
        oldValue: d.oldValue,
        newValue: d.newValue,
        changedBy,
      }))
    );
  }

  // ── Cache invalidation (fire-and-forget) ────────────────────────────────

  private invalidateAsync(id: string): void {
    if (!this.cache) return;
    const p = this.cache.invalidate(id).catch(() => {});
    if (this.waitUntil) {
      this.waitUntil(p);
    }
  }

  // ── Input guards ────────────────────────────────────────────────────────

  private validateUpdates(updates: object): void {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) continue;
      if (key.endsWith('Percent')) {
        if (typeof value !== 'number' || value < 0 || value > 10000) {
          throw new ValidationError(
            `Invalid ${key}: must be 0-10000 basis points`,
            { field: key, value }
          );
        }
      } else if (key.endsWith('Cents')) {
        if (typeof value !== 'number' || value < 0) {
          throw new ValidationError(`Invalid ${key}: must be non-negative`, {
            field: key,
            value,
          });
        }
      }
    }
  }
}
