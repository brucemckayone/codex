/**
 * FeeConfigService write-path real-DB integration tests (Codex-9iapw;
 * dated versions Codex-2hxff.33).
 *
 * The mechanics of one write, on cuts (a cut applies at once, so its effects
 * are visible straight away; rises and edits to them are in
 * fee-config-classify.integration.test.ts):
 *
 *   1. The old "current row" tables are kept in step with the values in
 *      force (data design §6.1 Migrate): each write upserts the row and bumps
 *      its `version` by real SQL `version + 1`.
 *   2. Audit-log precision: every changed column produces exactly one audit
 *      row, naming its change; a no-op writes nothing at all.
 *   3. Cache invalidation: with a real `VersionedCache` over a mock KV, the
 *      level's version key is bumped after the write commits.
 *
 * Each case starts from a known in-force state seeded with `seedFeeLevel`
 * (a dated cut, as migration 0123's backfill writes), never from an earlier
 * write: raising a fee through the service is a rise, which waits.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import {
  feeChanges,
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  organizations,
} from '@codex/database/schema';
import {
  createMockKVNamespace,
  createUniqueSlug,
  type Database,
  seedFeeLevel,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

describe('FeeConfigService — real-DB write integration', () => {
  let db: Database;
  let adminId: string;
  let creatorId: string;
  let organizationId: string;

  async function resetOrg() {
    await db
      .delete(feeChanges)
      .where(eq(feeChanges.organizationId, organizationId));
    await db
      .delete(feeConfigOrgCreator)
      .where(eq(feeConfigOrgCreator.organizationId, organizationId));
    await db
      .delete(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId));
    await db
      .delete(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
  }

  async function orgRow() {
    const [row] = await db
      .select()
      .from(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId))
      .limit(1);
    return row;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    // seedTestUsers returns user IDs usable as `changedBy` (FK to users.id
    // with onDelete: 'restrict' in fee_config_audit_log).
    const userIds = await seedTestUsers(db, 2);
    [adminId, creatorId] = userIds as [string, string];
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Fee Config Write Test Org',
        slug: createUniqueSlug('fee-config-write-test-org'),
      })
      .returning();
    if (!org) throw new Error('Failed to create test organization');
    organizationId = org.id;
  });

  beforeEach(resetOrg);

  afterAll(async () => {
    // The org's changes, versions and current rows go with it; the platform
    // level is shared with other suites, and nothing here touches it.
    await resetOrg();
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await teardownTestDatabase();
  });

  // ── Scenario 1: the current row mirrors the values in force ───────────────

  describe('the old current row follows each cut (real SQL `version + 1`)', () => {
    it('updateOrgFees: first cut writes version 1 with the new value, the next bumps it to 2', async () => {
      await seedFeeLevel(
        db,
        { scope: 'org', organizationId },
        { orgFeePercent: 2000 }
      );
      const svc = new FeeConfigService({ db, environment: 'test' });

      const first = await svc.updateOrgFees(
        organizationId,
        { orgFeePercent: 1800 },
        adminId
      );
      expect(first.outcome).toBe('cut');
      const afterFirst = await orgRow();
      expect(afterFirst?.version).toBe(1);
      expect(afterFirst?.orgFeePercent).toBe(1800);

      await svc.updateOrgFees(organizationId, { orgFeePercent: 1500 }, adminId);
      const afterSecond = await orgRow();
      expect(afterSecond?.version).toBe(2);
      expect(afterSecond?.orgFeePercent).toBe(1500);
    });

    it('upsertCreatorOverride: the version increments by exactly 1 per real write', async () => {
      await seedFeeLevel(
        db,
        { scope: 'creator', organizationId, creatorId },
        { platformFeePercent: 1500, orgFeePercent: 0 }
      );
      const svc = new FeeConfigService({ db, environment: 'test' });

      await svc.upsertCreatorOverride(
        organizationId,
        creatorId,
        { platformFeePercent: 1200 },
        adminId
      );
      await svc.upsertCreatorOverride(
        organizationId,
        creatorId,
        { platformFeePercent: 1100 },
        adminId
      );
      const [row] = await db
        .select()
        .from(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, organizationId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
        )
        .limit(1);
      expect(row?.version).toBe(2);
      expect(row?.platformFeePercent).toBe(1100);
      // orgFeePercent preserved from the version in force.
      expect(row?.orgFeePercent).toBe(0);
    });
  });

  // ── Scenario 2: audit-log precision ───────────────────────────────────────

  describe('audit-log precision (exactly one row per changed column)', () => {
    it('a cut changing 3 of 4 columns writes exactly 3 audit rows, each naming the change', async () => {
      await seedFeeLevel(
        db,
        { scope: 'org', organizationId },
        {
          platformFeePercent: 1500,
          orgFeePercent: 2000,
          minPlatformFeeCents: 75,
          minTransferCents: 100,
        }
      );
      const svc = new FeeConfigService({ db, environment: 'test' });
      const result = await svc.updateOrgFees(
        organizationId,
        {
          platformFeePercent: 1200,
          orgFeePercent: 1800,
          minPlatformFeeCents: 50,
          minTransferCents: 100, // same as in force — must be skipped
        },
        adminId
      );
      expect(result.outcome).toBe('cut');

      const auditRows = await db
        .select()
        .from(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
      // Exact: a regressed no-op skip makes this 4.
      expect(auditRows.length).toBe(3);
      expect(auditRows.map((r) => r.columnName).sort()).toEqual([
        'minPlatformFeeCents',
        'orgFeePercent',
        'platformFeePercent',
      ]);
      for (const row of auditRows) {
        expect(row.scope).toBe('org');
        expect(row.scopeOrgId).toBe(organizationId);
        expect(row.scopeCreatorId).toBeNull();
        expect(row.changedBy).toBe(adminId);
        expect(row.newValue).not.toBeNull();
        expect(row.changeId).toBe(result.change?.id);
        // A cut applies at once, and its lines say when.
        expect(row.effectiveFrom?.toISOString()).toBe(
          result.change?.effectiveFrom
        );
      }
      const platformLine = auditRows.find(
        (r) => r.columnName === 'platformFeePercent'
      );
      expect(platformLine?.oldValue).toBe('1500');
      expect(platformLine?.newValue).toBe('1200');
    });

    it('a no-op (every value as in force) writes no audit row, no change, and leaves the row alone', async () => {
      await seedFeeLevel(
        db,
        { scope: 'org', organizationId },
        { orgFeePercent: 2000 }
      );
      const svc = new FeeConfigService({ db, environment: 'test' });
      await svc.updateOrgFees(organizationId, { orgFeePercent: 1800 }, adminId);
      const before = await orgRow();
      expect(before?.version).toBe(1);
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
      const changesBefore = await db
        .select({ id: feeChanges.id })
        .from(feeChanges)
        .where(eq(feeChanges.organizationId, organizationId));

      const result = await svc.updateOrgFees(
        organizationId,
        { orgFeePercent: 1800 },
        adminId
      );

      expect(result).toEqual({
        outcome: 'unchanged',
        change: null,
        voidedChangeId: null,
        firstEmailsAt: null,
      });
      const auditRows = await db
        .select()
        .from(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
      expect(auditRows.length).toBe(0);
      const changesAfter = await db
        .select({ id: feeChanges.id })
        .from(feeChanges)
        .where(eq(feeChanges.organizationId, organizationId));
      expect(changesAfter.length).toBe(changesBefore.length);
      expect((await orgRow())?.version).toBe(before?.version);
    });
  });

  // ── Scenario 3: cache invalidation observable after commit ────────────────

  describe('cache invalidation (real VersionedCache over mock KV)', () => {
    it('a cut bumps the version key for "org:<orgId>" after the write commits', async () => {
      await seedFeeLevel(
        db,
        { scope: 'org', organizationId },
        { orgFeePercent: 3000 }
      );
      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });
      const versionKey = `cache:version:org:${organizationId}`;
      expect(await cache.getVersion(`org:${organizationId}`)).toBeNull();

      await svc.updateOrgFees(organizationId, { orgFeePercent: 2500 }, adminId);
      // The invalidation is fire-and-forget; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      const versionPut = (kv.put.mock.calls as Array<[string, string]>).find(
        ([key]) => key === versionKey
      );
      expect(versionPut).toBeDefined();
      expect(Number(versionPut?.[1])).toBeGreaterThan(0);
      expect((await orgRow())?.orgFeePercent).toBe(2500);
      expect(await cache.getVersion(`org:${organizationId}`)).toBe(
        versionPut?.[1]
      );
      // And the next read resolves the cut.
      expect(
        (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
      ).toBe(2500);
    });

    it('an override write bumps the version key for "override:<orgId>:<creatorId>"', async () => {
      await seedFeeLevel(
        db,
        { scope: 'creator', organizationId, creatorId },
        { orgFeePercent: 500 }
      );
      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });

      await svc.upsertCreatorOverride(
        organizationId,
        creatorId,
        { orgFeePercent: 0, notes: 'test' },
        adminId
      );
      await Promise.resolve();
      await Promise.resolve();

      const versionKey = `cache:version:override:${organizationId}:${creatorId}`;
      // TWO arguments: version keys are written with no put options
      // (Codex-kgrdp.5), so a third matcher could never match.
      expect(kv.put).toHaveBeenCalledWith(versionKey, expect.any(String));
    });

    it('a no-op does NOT bump the cache version', async () => {
      await seedFeeLevel(
        db,
        { scope: 'org', organizationId },
        { orgFeePercent: 1234 }
      );
      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });

      await svc.updateOrgFees(organizationId, { orgFeePercent: 1234 }, adminId);
      await Promise.resolve();
      await Promise.resolve();

      // Two arguments, like the positive case above, which proves this
      // matcher can match (and so can fail).
      expect(kv.put).not.toHaveBeenCalledWith(
        `cache:version:org:${organizationId}`,
        expect.anything()
      );
    });

    it('a level with a waiting rise is cached for an hour, any other for a day', async () => {
      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });
      const ttlOf = (type: string) =>
        (
          kv.put.mock.calls as Array<
            [string, string, { expirationTtl?: number }?]
          >
        ).find(
          ([key]) => key.includes(type) && key.includes(organizationId)
        )?.[2]?.expirationTtl;

      await svc.getFeesForOrg(organizationId, 'one_off');
      await Promise.resolve();
      expect(ttlOf('fee-versions:org')).toBe(24 * 60 * 60);

      // An org fee rise from the inherited 10% waits for its emails.
      const rise = await svc.updateOrgFees(
        organizationId,
        { orgFeePercent: 1500 },
        adminId
      );
      expect(rise.outcome).toBe('rise');
      kv.put.mockClear();
      await svc.getFeesForOrg(organizationId, 'one_off');
      await Promise.resolve();
      expect(ttlOf('fee-versions:org')).toBe(60 * 60);
    });
  });
});
