/**
 * Fee Configuration Service (Codex-m644n; dated versions Codex-2hxff.33)
 *
 * Read side: the fee in force at a sale's own time. Each level (platform,
 * organisation, creator override) is a list of dated versions; the resolver
 * (`resolveFeesAt`, `@codex/payments`) takes the newest with
 * `effective_from <= at` and layers them as it always has:
 *   creator-override → org-default → platform-default → FEES.* constants
 * Every caller may pass `at`; without one it is "now", today's behaviour.
 *
 * Write side (batch C1 Part B data design §1.3): every write is ONE
 * transaction holding the level's lock, the classification, the version,
 * the change, the audit lines and any follow-up notices (Codex-rtwpv). A cut
 * applies at once; a rise (or a mixed change, F1) waits for notifications-
 * api's daily run to tell everyone it affects; an edit to a waiting rise
 * follows F2. Nothing is deleted: removing an organisation's values or an
 * override is a version that inherits everything.
 *
 * The old "current row" tables (`fee_config_platform`, `_org`,
 * `_org_creator`) are kept in step with the values in force NOW, never a
 * waiting rise, so code rolled back to before migration 0123 reads the right
 * fee (§6.1 Migrate): every write here mirrors its level
 * (`mirrorLegacyFeeRow`, @codex/payments), and notifications-api's daily run
 * does on the morning a dated rise starts. Nothing reads them here any more.
 *
 * Caching: @codex/cache VersionedCache, one slot per level holding its
 * version list (`FEE_VERSIONS_*`). One day, or one hour while a rise there
 * waits (notifications-api dates it without a cache binding, §5). Every
 * write invalidates the level. Cache ids are unchanged:
 *   'platform' · 'org:${orgId}' · 'override:${orgId}:${creatorId}'
 *
 * The internal admin-api endpoints (/api/admin/fees/*) are the only mutation
 * surface. Direct SQL edits are forbidden (docs/payments/operations.md): they
 * would skip the notice the terms promise.
 *
 * @module fee-config-service
 */

import type { VersionedCache } from '@codex/cache';
import { CacheType } from '@codex/cache';
import type { DatabaseClient } from '@codex/database';
import {
  type FeeChangeRow,
  type FeeNoticeRoleValues,
  feeChangeNotices,
  feeChanges,
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigPlatform,
  feeConfigVersions,
  organizations,
} from '@codex/database/schema';
import {
  affectedPayees,
  CODE_DEFAULT_PLATFORM,
  classifyFeeWrite,
  dbFeeVersionReader,
  type FeeContext,
  type FeeLevel,
  type FeeValues,
  type FeeVersionList,
  type FeeVersionReader,
  type FeeVersionValues,
  type FeeWriteOutcome,
  feeLevelKey,
  feeLevelWhere,
  feeNoticeMayHaveTold,
  feeRiseStartAfter,
  layerLevelFees,
  lockFeeLevel,
  lockFeeNotices,
  mirrorLegacyFeeRow,
  nextFeeNoticeRunAfter,
  queueSmallerFeeNotices,
  readFeeVersions,
  resolveFeesAt,
  versionInForce,
} from '@codex/payments';
import {
  BaseService,
  ConflictError,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';

// ─── Public types ───────────────────────────────────────────────────────────

export type { FeeContext } from '@codex/payments';

/** Resolved fees for one kind of sale. */
export type FeeConfig = FeeValues;

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
  /** `null` on either side: unset, inheriting the tier above. */
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: Date;
  /** The change the line belongs to. Null on lines written before 0123. */
  changeId: string | null;
  /** When it applied, as known at the write: null for a rise (see the change). */
  effectiveFrom: Date | null;
}

export interface AuditLogFilters {
  scope?: 'platform' | 'org' | 'override';
  orgId?: string;
  creatorId?: string;
  limit?: number;
}

/** A fee change as the admin routes return it. */
export interface FeeChangeSummary {
  id: string;
  scope: 'platform' | 'org' | 'creator';
  organizationId: string | null;
  creatorId: string | null;
  kind: 'cut' | 'rise';
  /** Null while a rise waits for its emails. */
  effectiveFrom: string | null;
  /** When the daily run made its list; null until then. */
  firstRunAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  replacesChangeId: string | null;
}

/** What one write did (data design §3: the changed routes' `change`). */
export interface FeeWriteResult {
  outcome: FeeWriteOutcome | 'unchanged';
  /** The change this write made or edited; null when nothing changed. */
  change: FeeChangeSummary | null;
  /** The waiting rise this write voided (cancelled, cut below today, bigger). */
  voidedChangeId: string | null;
  /** A rise's first emails: the next 08:00 UTC run. Null for anything else. */
  firstEmailsAt: string | null;
}

/** One value that moves for the reader (Studio's note, data design §1.8). */
export interface UpcomingFeeLine {
  /** Null for a creator's own sales with no organisation. */
  organizationId: string | null;
  organizationName: string | null;
  as: 'creator' | 'owner';
  value: keyof FeeValues;
  /** `both` when one-off sales and subscriptions move alike. */
  context: FeeContext | 'both';
  from: number;
  to: number;
  /** A smaller rise: the figure the reader was first told. */
  replaced: number | null;
  /**
   * A bigger rise (F2): the figure the rise it replaces told the reader.
   * Null when they weren't told that one, or it didn't move this value.
   */
  replacesFigure: number | null;
}

export interface UpcomingFeeChange {
  changeId: string;
  kind: 'announce' | 'smaller';
  scope: 'platform' | 'org' | 'creator';
  /** Null until everyone on the list is told. */
  effectiveFrom: string | null;
  /** The earliest it can start: the date, or 30 days from now to UK midnight. */
  earliestFrom: string;
  /** When the reader was told: their email accepted, or support's mark. */
  announcedAt: string | null;
  /** A rise made smaller (Q2): when its short email to the reader was accepted. */
  smallerToldAt: string | null;
  /**
   * A bigger rise replacing a waiting one (F2): that rise, and when the
   * reader was told about it (null if they never were).
   */
  replaces: { changeId: string; announcedAt: string | null } | null;
  lines: UpcomingFeeLine[];
}

// ─── Level values ───────────────────────────────────────────────────────────

/** A level's own stored values, as one version holds them. */
interface LevelRaw extends FeeVersionValues {
  notes: string | null;
  removed: boolean;
}

const EMPTY_LEVEL: Readonly<LevelRaw> = Object.freeze({
  platformFeePercent: null,
  oneOffOrgFeePercent: null,
  subscriptionOrgFeePercent: null,
  orgFeePercent: null,
  minPlatformFeeCents: null,
  minTransferCents: null,
  notes: null,
  // No version at all is the same as a removed one: everything inherits.
  removed: true,
});

const PLATFORM_COLUMNS = [
  'platformFeePercent',
  'subscriptionOrgFeePercent',
  'oneOffOrgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
] as const;
const ORG_COLUMNS = [
  'platformFeePercent',
  'orgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
] as const;
const OVERRIDE_COLUMNS = [...ORG_COLUMNS, 'notes'] as const;

function columnsOf(level: FeeLevel): ReadonlyArray<keyof LevelRaw> {
  if (level.scope === 'platform') return PLATFORM_COLUMNS;
  return level.scope === 'org' ? ORG_COLUMNS : OVERRIDE_COLUMNS;
}

/** The audit log's old `scope` names: 'override' for a creator's. */
function auditScope(level: FeeLevel): 'platform' | 'org' | 'override' {
  return level.scope === 'creator' ? 'override' : level.scope;
}

// ─── Audit helpers ──────────────────────────────────────────────────────────

type DiffEntry = {
  columnName: string;
  oldValue: string | null;
  newValue: string | null;
};

/** A stored or requested value as the audit log records it: SQL NULL for unset. */
function auditValue(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * One entry per column whose stored value changes. A clear back to inherit
 * is recorded as a real NULL (Codex-2hxff.23 PAY-16); a value set to what it
 * already is, or a clear of one already clear, records nothing.
 */
function diffLevel(
  before: LevelRaw,
  after: LevelRaw,
  columns: ReadonlyArray<keyof LevelRaw>
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const column of columns) {
    const oldValue = auditValue(before[column]);
    const newValue = auditValue(after[column]);
    if (oldValue !== newValue) {
      entries.push({ columnName: column, oldValue, newValue });
    }
  }
  return entries;
}

/**
 * The value an org or override write stores: the update's when it names the
 * column, `null` included (clear back to inherit, as the zod schemas'
 * `.nullable()` means it), else the stored one. Not `??`, which would read a
 * clear as "leave alone" (Codex-2hxff.23 PAY-16).
 */
function mergedValue<T>(
  update: T | null | undefined,
  stored: T | null | undefined
): T | null {
  return update !== undefined ? update : (stored ?? null);
}

function summarise(change: FeeChangeRow): FeeChangeSummary {
  return {
    id: change.id,
    scope: change.scope,
    organizationId: change.organizationId,
    creatorId: change.creatorId,
    kind: change.kind,
    effectiveFrom: change.effectiveFrom?.toISOString() ?? null,
    firstRunAt: change.firstRunAt?.toISOString() ?? null,
    voidedAt: change.voidedAt?.toISOString() ?? null,
    voidReason: change.voidReason,
    replacesChangeId: change.replacesChangeId,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

interface FeeConfigServiceConfig extends ServiceConfig {
  cache?: VersionedCache;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** A level's version list in KV: a day, or an hour while a rise waits (§5). */
const FEE_VERSIONS_TTL_SECONDS = 24 * 60 * 60;
const FEE_VERSIONS_WAITING_TTL_SECONDS = 60 * 60;

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

interface LevelState {
  /** The version in force now, and its change. */
  inForce: { change: FeeChangeRow; raw: LevelRaw } | null;
  /** The rise at this level that hasn't started: waiting, or dated ahead. */
  pending: { change: FeeChangeRow; versionId: string; raw: LevelRaw } | null;
}

/**
 * What a money service resolves a sale's fees with: FeeConfigService's read
 * side. PurchaseService, SubscriptionService and CourseSubscriptionService
 * require one (Codex-2hxff.55, docs/payments/architecture.md rule A4) and take
 * this rather than the class, so a test can give them
 * `createTestFeeConfig()` from `@codex/test-utils` instead of a database.
 * Each method takes the sale's own time as `at` (absent: now).
 */
export type FeeResolver = Pick<
  FeeConfigService,
  'getFeesForCreator' | 'getFeesForOrg' | 'getFeesPlatform'
>;

export class FeeConfigService extends BaseService {
  private readonly cache?: VersionedCache;
  private readonly waitUntil?: (promise: Promise<unknown>) => void;

  constructor(config: FeeConfigServiceConfig) {
    super(config);
    this.cache = config.cache;
    this.waitUntil = config.waitUntil;
  }

  // ── READ: the fee in force at `at` ───────────────────────────────────────

  async getFeesForCreator(
    orgId: string,
    creatorId: string,
    ctx: FeeContext,
    at: Date = new Date()
  ): Promise<FeeConfig> {
    try {
      return await resolveFeesAt(this.reader(), {
        organizationId: orgId,
        creatorId,
        ctx,
        at,
      });
    } catch (error) {
      this.handleError(error, 'getFeesForCreator');
    }
  }

  async getFeesForOrg(
    orgId: string,
    ctx: FeeContext,
    at: Date = new Date()
  ): Promise<FeeConfig> {
    try {
      return await resolveFeesAt(this.reader(), {
        organizationId: orgId,
        ctx,
        at,
      });
    } catch (error) {
      this.handleError(error, 'getFeesForOrg');
    }
  }

  async getFeesPlatform(
    ctx: FeeContext,
    at: Date = new Date()
  ): Promise<FeeConfig> {
    try {
      return await resolveFeesAt(this.reader(), { ctx, at });
    } catch (error) {
      this.handleError(error, 'getFeesPlatform');
    }
  }

  // ── WRITE: platform ─────────────────────────────────────────────────────

  async updatePlatformFees(
    updates: PlatformFeeConfigUpdate,
    updatedBy: string
  ): Promise<FeeWriteResult> {
    this.validateUpdates(updates);
    try {
      return await this.writeLevel(
        { scope: 'platform' },
        (base) => ({
          ...base,
          platformFeePercent:
            updates.platformFeePercent ?? base.platformFeePercent,
          subscriptionOrgFeePercent:
            updates.subscriptionOrgFeePercent ?? base.subscriptionOrgFeePercent,
          oneOffOrgFeePercent:
            updates.oneOffOrgFeePercent ?? base.oneOffOrgFeePercent,
          minPlatformFeeCents:
            updates.minPlatformFeeCents ?? base.minPlatformFeeCents,
          minTransferCents: updates.minTransferCents ?? base.minTransferCents,
          orgFeePercent: null,
          notes: null,
          removed: false,
        }),
        updatedBy
      );
    } catch (error) {
      this.handleError(error, 'updatePlatformFees');
    }
  }

  // ── WRITE: org ──────────────────────────────────────────────────────────

  async updateOrgFees(
    orgId: string,
    updates: FeeConfigUpdate,
    updatedBy: string
  ): Promise<FeeWriteResult> {
    this.validateUpdates(updates);
    try {
      return await this.writeLevel(
        { scope: 'org', organizationId: orgId },
        (base) => ({
          ...EMPTY_LEVEL,
          platformFeePercent: mergedValue(
            updates.platformFeePercent,
            base.platformFeePercent
          ),
          orgFeePercent: mergedValue(updates.orgFeePercent, base.orgFeePercent),
          minPlatformFeeCents: mergedValue(
            updates.minPlatformFeeCents,
            base.minPlatformFeeCents
          ),
          minTransferCents: mergedValue(
            updates.minTransferCents,
            base.minTransferCents
          ),
          removed: false,
        }),
        updatedBy
      );
    } catch (error) {
      this.handleError(error, 'updateOrgFees');
    }
  }

  /** "Remove this organisation's values": a version where all inherit. */
  async deleteOrgFees(
    orgId: string,
    deletedBy: string
  ): Promise<FeeWriteResult> {
    try {
      return await this.writeLevel(
        { scope: 'org', organizationId: orgId },
        () => ({ ...EMPTY_LEVEL }),
        deletedBy
      );
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
  ): Promise<FeeWriteResult> {
    this.validateUpdates(updates);
    try {
      return await this.writeLevel(
        { scope: 'creator', organizationId: orgId, creatorId },
        (base) => ({
          ...EMPTY_LEVEL,
          platformFeePercent: mergedValue(
            updates.platformFeePercent,
            base.platformFeePercent
          ),
          orgFeePercent: mergedValue(updates.orgFeePercent, base.orgFeePercent),
          minPlatformFeeCents: mergedValue(
            updates.minPlatformFeeCents,
            base.minPlatformFeeCents
          ),
          minTransferCents: mergedValue(
            updates.minTransferCents,
            base.minTransferCents
          ),
          notes: mergedValue(updates.notes, base.notes),
          removed: false,
        }),
        updatedBy
      );
    } catch (error) {
      this.handleError(error, 'upsertCreatorOverride');
    }
  }

  /** "Remove the override": a version where all inherit. */
  async deleteCreatorOverride(
    orgId: string,
    creatorId: string,
    deletedBy: string
  ): Promise<FeeWriteResult> {
    try {
      return await this.writeLevel(
        { scope: 'creator', organizationId: orgId, creatorId },
        () => ({ ...EMPTY_LEVEL }),
        deletedBy
      );
    } catch (error) {
      this.handleError(error, 'deleteCreatorOverride');
    }
  }

  // ── WRITE: cancel a waiting rise by name ────────────────────────────────

  /**
   * `POST /api/admin/fees/changes/:changeId/cancel`: the "N = T" row of the
   * classification, with no values to type. 409 `FEE_CHANGE_NOT_WAITING`
   * once the rise has started, was voided, or is a cut.
   */
  async cancelChange(
    changeId: string,
    cancelledBy: string
  ): Promise<FeeChangeSummary> {
    try {
      const [found] = await this.db
        .select()
        .from(feeChanges)
        .where(eq(feeChanges.id, changeId))
        .limit(1);
      if (!found) {
        throw new NotFoundError('Fee change not found', { changeId });
      }
      const level = levelOf(found);
      const now = new Date();
      const voided = await this.db.transaction(async (tx) => {
        await lockFeeLevel(tx, level);
        const state = await this.levelState(tx, level, now);
        if (!state.pending || state.pending.change.id !== changeId) {
          throw notWaiting(changeId);
        }
        const base = state.inForce?.raw ?? emptyOrDefault(level);
        await voidPending(tx, state.pending.change.id, 'cancelled', now);
        await writeAudit(
          tx,
          level,
          diffLevel(state.pending.raw, base, columnsOf(level)),
          cancelledBy,
          changeId,
          now
        );
        await mirrorLegacyFeeRow(tx, level, cancelledBy, now);
        const [row] = await tx
          .select()
          .from(feeChanges)
          .where(eq(feeChanges.id, changeId));
        return row;
      });
      this.invalidateLevel(level);
      if (!voided) throw notWaiting(changeId);
      return summarise(voided);
    } catch (error) {
      this.handleError(error, 'cancelChange');
    }
  }

  // ── READ: admin convenience ─────────────────────────────────────────────

  /** The old current rows: the values in force now (never a waiting rise). */
  async getPlatformRow() {
    const [row] = await this.db
      .select()
      .from(feeConfigPlatform)
      .where(eq(feeConfigPlatform.id, 'singleton'))
      .limit(1);
    return row ?? null;
  }

  async getOrgRow(orgId: string) {
    const [row] = await this.db
      .select()
      .from(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, orgId))
      .limit(1);
    return row ?? null;
  }

  async getCreatorOverrideRow(orgId: string, creatorId: string) {
    const [row] = await this.db
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

  async listCreatorOverrides(orgId: string) {
    return this.db
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

      const rows = await this.db
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
        changeId: r.changeId,
        effectiveFrom: r.effectiveFrom,
      }));
    } catch (error) {
      this.handleError(error, 'getAuditLog');
    }
  }

  // ── READ: Studio's note (ecom-api GET /fees/upcoming) ───────────────────

  /**
   * The caller's own fee rises that haven't started (data design §1.8). A
   * rise appears from its first run, including when the caller's email
   * failed: seeing the note is not being told. With `organizationId`, the
   * caller's owner lines for that organisation (Billing, Payouts); without,
   * their creator lines everywhere, orgless sales included (Earnings, Q3).
   * The lines are worked out now, with the same layering sales use, so a
   * waiting rise made smaller shows its new figure at once.
   */
  async listUpcomingForUser(
    userId: string,
    organizationId?: string,
    now: Date = new Date()
  ): Promise<UpcomingFeeChange[]> {
    try {
      const notices = await this.db
        .select({
          notice: {
            kind: feeChangeNotices.kind,
            acceptedAt: feeChangeNotices.acceptedAt,
            toldAt: feeChangeNotices.toldAt,
            afterValues: feeChangeNotices.afterValues,
          },
          change: feeChanges,
        })
        .from(feeChangeNotices)
        .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
        .where(
          and(
            eq(feeChangeNotices.userId, userId),
            inArray(feeChangeNotices.kind, ['announce', 'smaller']),
            ne(feeChangeNotices.state, 'not_needed'),
            eq(feeChanges.kind, 'rise'),
            isNull(feeChanges.voidedAt),
            sql`${feeChanges.firstRunAt} IS NOT NULL`,
            or(
              isNull(feeChanges.effectiveFrom),
              gt(feeChanges.effectiveFrom, now)
            )
          )
        )
        .orderBy(feeChanges.createdAt);

      type Notice = (typeof notices)[number]['notice'];
      const byChange = new Map<
        string,
        { change: FeeChangeRow; announce?: Notice; smaller?: Notice }
      >();
      for (const { notice, change } of notices) {
        const entry = byChange.get(change.id) ?? { change };
        if (notice.kind === 'announce') entry.announce = notice;
        else entry.smaller = notice;
        byChange.set(change.id, entry);
      }

      // F2: what the reader was told about each rise a bigger one replaced.
      // Only a notice that reached them counts (an accepted email or
      // support's mark): a failed one told them nothing.
      const replacedIds = [
        ...new Set(
          [...byChange.values()].flatMap(({ change }) =>
            change.replacesChangeId ? [change.replacesChangeId] : []
          )
        ),
      ];
      const toldBefore = new Map(
        (replacedIds.length === 0
          ? []
          : await this.db
              .select({
                changeId: feeChangeNotices.changeId,
                acceptedAt: feeChangeNotices.acceptedAt,
                toldAt: feeChangeNotices.toldAt,
                beforeValues: feeChangeNotices.beforeValues,
                afterValues: feeChangeNotices.afterValues,
              })
              .from(feeChangeNotices)
              .where(
                and(
                  eq(feeChangeNotices.userId, userId),
                  eq(feeChangeNotices.kind, 'announce'),
                  inArray(feeChangeNotices.changeId, replacedIds),
                  inArray(feeChangeNotices.state, ['sent', 'told_another_way'])
                )
              )
        ).map((row) => [row.changeId, row])
      );

      const items: UpcomingFeeChange[] = [];
      const orgIds = new Set<string>();
      for (const { change, announce, smaller } of byChange.values()) {
        const [payee] = await affectedPayees(this.db, change, now, {
          onlyUserId: userId,
        });
        if (!payee) continue;
        const keep = (role: { organizationId: string | null; as: string }) =>
          organizationId
            ? role.as === 'owner' && role.organizationId === organizationId
            : role.as === 'creator';
        const told = smaller ? (announce?.afterValues ?? []) : [];
        const replaced = change.replacesChangeId
          ? toldBefore.get(change.replacesChangeId)
          : undefined;
        const lines = linesFor(
          payee.before.filter(keep),
          payee.after.filter(keep),
          told,
          replaced ?? null
        );
        if (lines.length === 0) continue;
        for (const line of lines) {
          if (line.organizationId) orgIds.add(line.organizationId);
        }
        items.push({
          changeId: change.id,
          kind: smaller ? 'smaller' : 'announce',
          scope: change.scope,
          effectiveFrom: change.effectiveFrom?.toISOString() ?? null,
          earliestFrom: (
            change.effectiveFrom ?? feeRiseStartAfter(now)
          ).toISOString(),
          // Seeing the note isn't being told: only an accepted email or
          // support's mark is (§1.8), so a failed email leaves this null.
          announcedAt:
            (announce?.acceptedAt ?? announce?.toldAt)?.toISOString() ?? null,
          smallerToldAt:
            (smaller?.acceptedAt ?? smaller?.toldAt)?.toISOString() ?? null,
          replaces: change.replacesChangeId
            ? {
                changeId: change.replacesChangeId,
                announcedAt:
                  (replaced?.acceptedAt ?? replaced?.toldAt)?.toISOString() ??
                  null,
              }
            : null,
          lines,
        });
      }

      if (orgIds.size > 0) {
        const names = await this.db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, [...orgIds]));
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        for (const item of items) {
          for (const line of item.lines) {
            if (line.organizationId) {
              line.organizationName = nameOf.get(line.organizationId) ?? null;
            }
          }
        }
      }
      return items;
    } catch (error) {
      this.handleError(error, 'listUpcomingForUser');
    }
  }

  // ── Cache ───────────────────────────────────────────────────────────────

  /**
   * Make a level's next read fresh. Every write here calls it; support's
   * "told another way" calls it too, since a mark can date a rise (§1.6).
   */
  invalidateLevel(level: FeeLevel): void {
    if (!this.cache) return;
    // invalidate never rejects (it logs and resolves), so a failure comes
    // back through onError. The write has landed, but the level's old list
    // is still served until its TTL (up to a day): a cut would bill the old
    // fee unseen.
    const p = this.cache.invalidate(feeLevelKey(level), {
      onError: (error) => {
        this.obs.error(
          'Fee cache not cleared: this level reads its old fees until the cache expires',
          {
            errorId: crypto.randomUUID(),
            ...level,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      },
    });
    if (this.waitUntil) {
      this.waitUntil(p);
    }
  }

  private reader(): FeeVersionReader {
    const fromDb = dbFeeVersionReader(this.db);
    const cache = this.cache;
    if (!cache) return fromDb;
    return (level) =>
      cache.get<FeeVersionList>(
        feeLevelKey(level),
        cacheTypeOf(level),
        () => fromDb(level),
        {
          ttl: (list) =>
            list.waiting
              ? FEE_VERSIONS_WAITING_TTL_SECONDS
              : FEE_VERSIONS_TTL_SECONDS,
        }
      );
  }

  // ── The write (data design §1.3) ────────────────────────────────────────

  /**
   * One write at one level, in one transaction. `makeNext` builds the
   * level's new values from P (the waiting rise's) if there is one, else T
   * (in force now). Then T, P and N are each resolved at this level, for
   * both kinds of sale, and `classifyFeeWrite` decides what happens.
   */
  private async writeLevel(
    level: FeeLevel,
    makeNext: (base: LevelRaw) => LevelRaw,
    author: string
  ): Promise<FeeWriteResult> {
    const now = new Date();
    const columns = columnsOf(level);
    const result = await this.db.transaction(
      async (tx): Promise<FeeWriteResult> => {
        await lockFeeLevel(tx, level);
        const state = await this.levelState(tx, level, now);
        const today = state.inForce?.raw ?? emptyOrDefault(level);
        const base = state.pending?.raw ?? today;
        const next = makeNext(base);
        const diff = diffLevel(base, next, columns);
        if (diff.length === 0 && next.removed === base.removed) {
          return unchanged();
        }

        const lower = await lowerLevelsNow(tx, level, now);
        const resolve = (raw: LevelRaw) => layerLevelFees(...lower(raw));
        const outcome = classifyFeeWrite(
          resolve(today),
          state.pending ? resolve(state.pending.raw) : null,
          resolve(next)
        );

        let change: FeeChangeRow | undefined;
        let voidedChangeId: string | null = null;
        let auditChangeId: string;
        let auditFrom: Date | null;
        const pending = state.pending;

        switch (outcome) {
          case 'cut':
          case 'rise': {
            change = await insertChange(tx, level, outcome, now, author);
            await insertVersion(tx, change.id, level, next, author);
            auditChangeId = change.id;
            auditFrom = outcome === 'cut' ? now : null;
            break;
          }
          case 'cancelled':
          case 'cut_below_today': {
            if (!pending) throw noWaitingRise(level, outcome);
            await voidPending(tx, pending.change.id, outcome, now);
            voidedChangeId = pending.change.id;
            auditChangeId = pending.change.id;
            // A cancel that restates today's values exactly writes no
            // version; anything else is recorded as a cut, dated now.
            if (diffLevel(today, next, columns).length > 0) {
              change = await insertChange(tx, level, 'cut', now, author);
              await insertVersion(tx, change.id, level, next, author);
              auditChangeId = change.id;
            }
            auditFrom = now;
            break;
          }
          case 'smaller':
          case 'same_as_waiting': {
            if (!pending) throw noWaitingRise(level, outcome);
            // Same change, so it keeps its list, its clock and its date.
            await tx
              .update(feeConfigVersions)
              .set({ supersededAt: now })
              .where(eq(feeConfigVersions.id, pending.versionId));
            await insertVersion(tx, pending.change.id, level, next, author);
            if (outcome === 'smaller') {
              await queueSmallerNotices(tx, pending.change.id, now);
            }
            change = pending.change;
            auditChangeId = pending.change.id;
            auditFrom = pending.change.effectiveFrom;
            break;
          }
          case 'bigger': {
            if (!pending) throw noWaitingRise(level, outcome);
            await voidPending(tx, pending.change.id, 'replaced_by_bigger', now);
            voidedChangeId = pending.change.id;
            change = await insertChange(tx, level, 'rise', now, author, {
              replacesChangeId: pending.change.id,
            });
            await insertVersion(tx, change.id, level, next, author);
            auditChangeId = change.id;
            auditFrom = null;
            break;
          }
        }

        await writeAudit(tx, level, diff, author, auditChangeId, auditFrom);
        await mirrorLegacyFeeRow(tx, level, author, now);

        const [fresh] = change
          ? await tx
              .select()
              .from(feeChanges)
              .where(eq(feeChanges.id, change.id))
          : [];
        return {
          outcome,
          change: fresh ? summarise(fresh) : null,
          voidedChangeId,
          firstEmailsAt:
            fresh && fresh.kind === 'rise' && fresh.effectiveFrom === null
              ? nextFeeNoticeRunAfter(now).toISOString()
              : null,
        };
      }
    );
    if (result.outcome !== 'unchanged') this.invalidateLevel(level);
    return result;
  }

  /** The level's live changes and versions: what's in force, what's pending. */
  private async levelState(
    tx: Tx,
    level: FeeLevel,
    now: Date
  ): Promise<LevelState> {
    const rows = await tx
      .select({ change: feeChanges, version: feeConfigVersions })
      .from(feeChanges)
      .innerJoin(
        feeConfigVersions,
        and(
          eq(feeConfigVersions.changeId, feeChanges.id),
          isNull(feeConfigVersions.supersededAt)
        )
      )
      .where(and(feeLevelWhere(level), isNull(feeChanges.voidedAt)))
      .orderBy(desc(feeChanges.effectiveFrom), desc(feeChanges.createdAt));
    const t = now.getTime();
    let inForce: LevelState['inForce'] = null;
    let pending: LevelState['pending'] = null;
    for (const { change, version } of rows) {
      const raw: LevelRaw = {
        platformFeePercent: version.platformFeePercent,
        oneOffOrgFeePercent: version.oneOffOrgFeePercent,
        subscriptionOrgFeePercent: version.subscriptionOrgFeePercent,
        orgFeePercent: version.orgFeePercent,
        minPlatformFeeCents: version.minPlatformFeeCents,
        minTransferCents: version.minTransferCents,
        notes: version.notes,
        removed: version.removed,
      };
      const from = change.effectiveFrom?.getTime() ?? null;
      if (from !== null && from <= t) {
        // Newest dated first (NULLs sort first under DESC, so pending ones
        // were seen already).
        if (!inForce) inForce = { change, raw };
      } else if (change.kind === 'rise' && !pending) {
        pending = { change, versionId: version.id, raw };
      }
    }
    return { inForce, pending };
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

// ─── Write helpers ──────────────────────────────────────────────────────────

function unchanged(): FeeWriteResult {
  return {
    outcome: 'unchanged',
    change: null,
    voidedChangeId: null,
    firstEmailsAt: null,
  };
}

function notWaiting(changeId: string): ConflictError {
  return new ConflictError(
    'This fee change is no longer waiting: it has started, or was cancelled or replaced.',
    { code: 'FEE_CHANGE_NOT_WAITING', changeId }
  );
}

function levelOf(change: FeeChangeRow): FeeLevel {
  if (change.scope === 'platform' || change.organizationId === null) {
    return { scope: 'platform' };
  }
  if (change.scope === 'org' || change.creatorId === null) {
    return { scope: 'org', organizationId: change.organizationId };
  }
  return {
    scope: 'creator',
    organizationId: change.organizationId,
    creatorId: change.creatorId,
  };
}

function cacheTypeOf(level: FeeLevel): string {
  switch (level.scope) {
    case 'platform':
      return CacheType.FEE_VERSIONS_PLATFORM;
    case 'org':
      return CacheType.FEE_VERSIONS_ORG;
    case 'creator':
      return CacheType.FEE_VERSIONS_OVERRIDE;
  }
}

/** A level with no version: the code constants on the platform, else empty. */
function emptyOrDefault(level: FeeLevel): LevelRaw {
  return level.scope === 'platform'
    ? { ...CODE_DEFAULT_PLATFORM, notes: null, removed: false }
    : { ...EMPTY_LEVEL };
}

/**
 * The levels below `level` as they are now, so a write compares its own
 * level's values on the same footing: `lower(raw)` is the layer list with
 * `raw` at this level.
 */
async function lowerLevelsNow(
  tx: Tx,
  level: FeeLevel,
  now: Date
): Promise<
  (raw: LevelRaw) => [FeeVersionValues | null, ...(FeeVersionValues | null)[]]
> {
  if (level.scope === 'platform') return (raw) => [raw];
  const platform = versionInForce(
    await readFeeVersions(tx, { scope: 'platform' }),
    now
  );
  if (level.scope === 'org') return (raw) => [platform, raw];
  const org = versionInForce(
    await readFeeVersions(tx, {
      scope: 'org',
      organizationId: level.organizationId,
    }),
    now
  );
  return (raw) => [platform, org, raw];
}

/**
 * `classifyFeeWrite` answers cancelled, smaller or bigger only when given a
 * waiting rise, so reaching one of those without it means the level's state
 * and the classifier disagree. The write's transaction rolls back.
 */
function noWaitingRise(level: FeeLevel, outcome: string): InternalServiceError {
  return new InternalServiceError('Fee write found no waiting rise', {
    ...level,
    outcome,
  });
}

async function insertChange(
  tx: Tx,
  level: FeeLevel,
  kind: 'cut' | 'rise',
  now: Date,
  author: string,
  extra: { replacesChangeId?: string } = {}
): Promise<FeeChangeRow> {
  const [row] = await tx
    .insert(feeChanges)
    .values({
      scope: level.scope,
      organizationId: level.scope === 'platform' ? null : level.organizationId,
      creatorId: level.scope === 'creator' ? level.creatorId : null,
      kind,
      effectiveFrom: kind === 'cut' ? now : null,
      replacesChangeId: extra.replacesChangeId ?? null,
      createdBy: author,
      createdAt: now,
    })
    .returning();
  if (!row) {
    throw new InternalServiceError('Fee change insert wrote no row', {
      ...level,
      kind,
    });
  }
  return row;
}

async function insertVersion(
  tx: Tx,
  changeId: string,
  level: FeeLevel,
  raw: LevelRaw,
  author: string
): Promise<void> {
  const platform = level.scope === 'platform';
  await tx.insert(feeConfigVersions).values({
    changeId,
    scope: level.scope,
    platformFeePercent: raw.platformFeePercent,
    oneOffOrgFeePercent: platform ? raw.oneOffOrgFeePercent : null,
    subscriptionOrgFeePercent: platform ? raw.subscriptionOrgFeePercent : null,
    orgFeePercent: platform ? null : raw.orgFeePercent,
    minPlatformFeeCents: raw.minPlatformFeeCents,
    minTransferCents: raw.minTransferCents,
    notes: level.scope === 'creator' ? raw.notes : null,
    removed: platform ? false : raw.removed,
    createdBy: author,
  });
}

/**
 * Void a waiting rise. Nobody still waits for it: its open notices become
 * `not_needed`. Unless a bigger rise replaces it (whose own announcement
 * says so), everyone it told, or may have told (payments'
 * `feeNoticeMayHaveTold`), is emailed that it's off (F2,
 * `fee-change-cancelled`, sent by the next daily run). The cancelled notice
 * keeps what they were told (roles, values, the date named) for its email.
 * It is queued before the open notices are closed, which would hide which
 * ones may have gone. For someone whose email was in flight as the rise was
 * voided, notifications-api's fee step runs this insert narrowed to them
 * (`tellOfVoid`), with what that email told.
 */
async function voidPending(
  tx: Tx,
  changeId: string,
  reason: 'cancelled' | 'cut_below_today' | 'replaced_by_bigger',
  now: Date
): Promise<void> {
  await tx
    .update(feeChanges)
    .set({ voidedAt: now, voidReason: reason })
    .where(eq(feeChanges.id, changeId));
  // Lock the notices before reading them (review final M3), in the one
  // order (`lockFeeNotices`): a send's record() then waits for this void and
  // takes its void branch (tellOfVoid), and the daily run's claim (SKIP
  // LOCKED) passes them by, so no email is recorded between the read below
  // and the close, unseen by both.
  await lockFeeNotices(tx, { changeId });
  if (reason !== 'replaced_by_bigger') {
    await tx.execute(sql`
      INSERT INTO ${feeChangeNotices}
        (change_id, user_id, kind, on_list, roles, before_values, after_values, quoted_from, state)
      SELECT change_id, user_id, 'cancelled', false, roles, before_values, after_values, quoted_from, 'due'
      FROM ${feeChangeNotices}
      WHERE change_id = ${changeId}
        AND kind = 'announce'
        AND ${feeNoticeMayHaveTold(now)}
      ON CONFLICT (change_id, user_id, kind) DO NOTHING
    `);
  }
  await tx
    .update(feeChangeNotices)
    .set({ state: 'not_needed', updatedAt: now })
    .where(
      and(
        eq(feeChangeNotices.changeId, changeId),
        ne(feeChangeNotices.kind, 'cancelled'),
        inArray(feeChangeNotices.state, ['due', 'failed', 'unknown'])
      )
    );
}

/**
 * Q2 (A): the smaller email for everyone the waiting rise's announcement
 * told, or may have told, and a new round for those told before; the rule
 * and the statement are payments' `queueSmallerFeeNotices`, which the daily
 * step also runs for one person it emailed with figures read before a cut.
 * The notices are locked first, as a void locks them (`lockFeeNotices`, the
 * one order; review final silent L1): the daily claim passes them by while
 * this cut is open, and a claim already committed is read as tried, so no
 * announcement goes with the bigger figure unseen by this queue.
 */
async function queueSmallerNotices(
  tx: Tx,
  changeId: string,
  now: Date
): Promise<void> {
  await lockFeeNotices(tx, { changeId });
  await queueSmallerFeeNotices(tx, { changeId, now });
}

async function writeAudit(
  tx: Tx,
  level: FeeLevel,
  diff: DiffEntry[],
  changedBy: string,
  changeId: string,
  effectiveFrom: Date | null
): Promise<void> {
  if (diff.length === 0) return;
  await tx.insert(feeConfigAuditLog).values(
    diff.map((d) => ({
      scope: auditScope(level),
      scopeOrgId: level.scope === 'platform' ? null : level.organizationId,
      scopeCreatorId: level.scope === 'creator' ? level.creatorId : null,
      columnName: d.columnName,
      oldValue: d.oldValue,
      newValue: d.newValue,
      changedBy,
      changeId,
      effectiveFrom,
    }))
  );
}

// ─── Studio lines ───────────────────────────────────────────────────────────

const LINE_VALUES: ReadonlyArray<keyof FeeValues> = [
  'platformFeePercent',
  'orgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
];

/**
 * One line per value that moves in each role, merged across the two kinds
 * of sale when they move alike. `told` is what the reader was first told,
 * for a smaller rise's "not 12%". `replacedTold` is what they were told
 * about the rise a bigger one replaced (F2), for "This replaces the rise to
 * 12%": a value that rise didn't move has no figure.
 */
function linesFor(
  before: FeeNoticeRoleValues[],
  after: FeeNoticeRoleValues[],
  told: FeeNoticeRoleValues[],
  replacedTold: {
    beforeValues: FeeNoticeRoleValues[];
    afterValues: FeeNoticeRoleValues[];
  } | null
): UpcomingFeeLine[] {
  const lines: UpcomingFeeLine[] = [];
  const roleIn = (list: FeeNoticeRoleValues[], role: FeeNoticeRoleValues) =>
    list.find(
      (t) => t.organizationId === role.organizationId && t.as === role.as
    );
  before.forEach((role, index) => {
    const next = after[index];
    if (!next) return;
    const was = roleIn(told, role);
    const prevFrom = replacedTold
      ? roleIn(replacedTold.beforeValues, role)
      : undefined;
    const prevTo = replacedTold
      ? roleIn(replacedTold.afterValues, role)
      : undefined;
    const figures = (
      ctx: 'oneOff' | 'subscription',
      value: keyof FeeValues
    ) => ({
      replaced: was ? was[ctx][value] : null,
      replacesFigure:
        prevFrom && prevTo && prevTo[ctx][value] !== prevFrom[ctx][value]
          ? prevTo[ctx][value]
          : null,
    });
    for (const value of LINE_VALUES) {
      const oneOff = { from: role.oneOff[value], to: next.oneOff[value] };
      const sub = {
        from: role.subscription[value],
        to: next.subscription[value],
      };
      const base = {
        organizationId: role.organizationId,
        organizationName: null,
        as: role.as,
        value,
      };
      if (oneOff.from === sub.from && oneOff.to === sub.to) {
        if (oneOff.from !== oneOff.to) {
          lines.push({
            ...base,
            context: 'both',
            ...oneOff,
            ...figures('oneOff', value),
          });
        }
        continue;
      }
      if (oneOff.from !== oneOff.to) {
        lines.push({
          ...base,
          context: 'one_off',
          ...oneOff,
          ...figures('oneOff', value),
        });
      }
      if (sub.from !== sub.to) {
        lines.push({
          ...base,
          context: 'subscription',
          ...sub,
          ...figures('subscription', value),
        });
      }
    }
  });
  return lines;
}
