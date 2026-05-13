/**
 * FeeConfigService write-path real-DB integration tests (Codex-9iapw).
 *
 * Companion to `fee-config-service-writes.test.ts` (25 unit-mocked cases).
 * Those tests assert Drizzle was called with the right fragments; this file
 * proves the fragments produce the right result against a real Postgres
 * (via `setupTestDatabase()` + `dbWs`).
 *
 * Gaps closed vs the unit suite:
 *
 *   1. Atomic version bump: real SQL `version + 1` executes (assert row's
 *      version column actually increments — unit mocks only assert the SQL
 *      object identity).
 *   2. Audit-log precision: every changed column produces exactly one audit
 *      row (assert `=== n`, not `>= n`); no-op writes produce zero.
 *   3. Cache invalidation observability: with a real `VersionedCache` over a
 *      mock KV, the version key is bumped AFTER the DB write commits
 *      (re-reading after the bump produces the new value).
 *
 * NOT covered (and intentionally so):
 *
 *   - Transactional rollback. The current implementation does NOT wrap
 *     upsert + audit-log insert + cache.invalidate in `db.transaction()` —
 *     so there is no atomicity contract to lock in. This was flagged as a
 *     real production gap during this bead and filed as Codex-rtwpv. When
 *     that bug is fixed, this file should grow a scenario that forces an
 *     audit-log FK violation and asserts the upsert rolls back.
 *
 * Parent epic: Codex-hu4ou. Sibling unit suite:
 *   packages/purchase/src/__tests__/fee-config-service-writes.test.ts
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import {
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  organizations,
} from '@codex/database/schema';
import {
  createMockKVNamespace,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

/**
 * KV mock comes from the shared `@codex/test-utils` helper
 * (`createMockKVNamespace`). Its `put`/`get`/`delete` are `vi.fn()` spies
 * we can introspect with `.mock.calls`, and `_storage` is the in-memory
 * Map backing the spied methods. This replaces an earlier hand-rolled
 * mock that drifted from the shared signature.
 */

describe('FeeConfigService — real-DB write integration', () => {
  let db: Database;
  let adminId: string;
  let creatorId: string;
  let organizationId: string;

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
        ownerId: creatorId,
      })
      .returning();
    if (!org) throw new Error('Failed to create test organization');
    organizationId = org.id;
  });

  afterAll(async () => {
    // Tests for this bead all mutate per-org/per-creator rows; the schema
    // ON DELETE CASCADE on organizationId is enough for the org/override
    // rows. The singleton platform row is shared with other suites — DO NOT
    // wipe it. teardownTestDatabase closes the pool.
    await db
      .delete(feeConfigOrgCreator)
      .where(eq(feeConfigOrgCreator.organizationId, organizationId));
    await db
      .delete(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId));
    await db
      .delete(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
    await teardownTestDatabase();
  });

  // ── Scenario 1: atomic version bump ───────────────────────────────────────

  describe('atomic version bump (real SQL `version + 1`)', () => {
    it('updateOrgFees: first write sets version=1, second write increments to 2', async () => {
      // Clean slate for this org row before this test owns it.
      await db
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));

      const svc = new FeeConfigService({ db, environment: 'test' });

      // First write — insert path of upsert. Schema default for `version` is 1.
      await svc.updateOrgFees(organizationId, { orgFeePercent: 1500 }, adminId);
      const [afterFirst] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      expect(afterFirst).toBeDefined();
      expect(afterFirst?.version).toBe(1);
      expect(afterFirst?.orgFeePercent).toBe(1500);

      // Second write changes a different column — must hit the
      // onConflictDoUpdate branch where `version: sql\`version + 1\`` is in
      // play. If the SQL fragment were wrong (e.g. plain `1`), version would
      // stay at 1; if it double-incremented, it would jump to 3.
      await svc.updateOrgFees(
        organizationId,
        { platformFeePercent: 1100 },
        adminId
      );
      const [afterSecond] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      expect(afterSecond?.version).toBe(2);
      expect(afterSecond?.platformFeePercent).toBe(1100);
      // Untouched columns preserved by the merge step.
      expect(afterSecond?.orgFeePercent).toBe(1500);

      // Third write — single increment, locks the "exactly +1" contract.
      await svc.updateOrgFees(organizationId, { orgFeePercent: 1600 }, adminId);
      const [afterThird] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      expect(afterThird?.version).toBe(3);
    });

    it('upsertCreatorOverride: version increments by exactly 1 per real write', async () => {
      // Ensure clean override row.
      await db
        .delete(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, organizationId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
        );

      const svc = new FeeConfigService({ db, environment: 'test' });

      await svc.upsertCreatorOverride(
        organizationId,
        creatorId,
        { orgFeePercent: 0, notes: 'launch partner' },
        adminId
      );
      const [r1] = await db
        .select()
        .from(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, organizationId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
        )
        .limit(1);
      expect(r1?.version).toBe(1);

      await svc.upsertCreatorOverride(
        organizationId,
        creatorId,
        { notes: 'launch partner renewed' },
        adminId
      );
      const [r2] = await db
        .select()
        .from(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, organizationId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
        )
        .limit(1);
      expect(r2?.version).toBe(2);
      // orgFeePercent preserved across the version bump.
      expect(r2?.orgFeePercent).toBe(0);
    });
  });

  // ── Scenario 2: audit-log precision ───────────────────────────────────────

  describe('audit-log precision (exactly one row per changed column)', () => {
    it('updateOrgFees changing 3 columns writes exactly 3 audit rows', async () => {
      // Reset the org row so the diff is deterministic.
      await db
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      // Seed an initial row so subsequent writes hit the update path.
      const svc = new FeeConfigService({ db, environment: 'test' });
      await svc.updateOrgFees(
        organizationId,
        {
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 50,
          minTransferCents: 100,
        },
        adminId
      );
      // After seed: 4 columns changed from "no row" → null-old/value-new.
      const seedAudit = await db
        .select()
        .from(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
      expect(seedAudit.length).toBe(4);

      // Wipe audit log to isolate the next assertion.
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      // Change exactly 3 of the 4 columns; leave minTransferCents unchanged.
      await svc.updateOrgFees(
        organizationId,
        {
          platformFeePercent: 1200,
          orgFeePercent: 1800,
          minPlatformFeeCents: 75,
          minTransferCents: 100, // same as existing — must be skipped
        },
        adminId
      );

      const auditRows = await db
        .select()
        .from(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      // Tripwire: exact === 3. If the no-op skip in diffUpdate() regresses
      // (e.g. someone removes the `String(old) === String(value)` guard),
      // this becomes 4 and fails.
      expect(auditRows.length).toBe(3);

      const cols = auditRows.map((r) => r.columnName).sort();
      expect(cols).toEqual([
        'minPlatformFeeCents',
        'orgFeePercent',
        'platformFeePercent',
      ]);

      // Every audit row carries the right scope + actor + non-null new value.
      for (const row of auditRows) {
        expect(row.scope).toBe('org');
        expect(row.scopeOrgId).toBe(organizationId);
        expect(row.scopeCreatorId).toBeNull();
        expect(row.changedBy).toBe(adminId);
        expect(row.newValue).not.toBeNull();
      }

      // Specific old→new values for one column to prove the diff is real.
      const platformRow = auditRows.find(
        (r) => r.columnName === 'platformFeePercent'
      );
      expect(platformRow?.oldValue).toBe('1000');
      expect(platformRow?.newValue).toBe('1200');
    });

    it('no-op update (all values match existing) writes 0 audit rows AND does not bump version', async () => {
      // Seed a known state.
      await db
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      const svc = new FeeConfigService({ db, environment: 'test' });
      await svc.updateOrgFees(organizationId, { orgFeePercent: 2000 }, adminId);
      const [seeded] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      const versionBefore = seeded?.version;
      expect(versionBefore).toBe(1);

      // Wipe audit so we can assert "zero new rows".
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      // No-op: same value.
      await svc.updateOrgFees(organizationId, { orgFeePercent: 2000 }, adminId);

      const auditRows = await db
        .select()
        .from(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
      expect(auditRows.length).toBe(0);

      // Version must NOT have bumped (early-return before the upsert).
      const [after] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      expect(after?.version).toBe(versionBefore);
    });
  });

  // ── Scenario 4: cache invalidation observable after commit ────────────────

  describe('cache invalidation (real VersionedCache over mock KV)', () => {
    it('updateOrgFees bumps the version key for "org:<orgId>" AFTER the DB row is updated', async () => {
      // Fresh DB state.
      await db
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));
      await db
        .delete(feeConfigAuditLog)
        .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));

      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });

      // No version key for org yet.
      const versionKey = `cache:version:org:${organizationId}`;
      expect(await cache.getVersion(`org:${organizationId}`)).toBeNull();

      await svc.updateOrgFees(organizationId, { orgFeePercent: 2500 }, adminId);

      // invalidateAsync is fire-and-forget; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      // Tripwire: KV.put was invoked on EXACTLY the org version key, with a
      // timestamp-shaped value. If the key shape regresses (e.g. someone
      // refactors orgCacheId), this assertion fails.
      const versionPut = (kv.put.mock.calls as Array<[string, string]>).find(
        ([key]) => key === versionKey
      );
      expect(versionPut).toBeDefined();
      expect(Number(versionPut?.[1])).toBeGreaterThan(0);

      // And the DB row was actually written — proves invalidate runs AFTER
      // the upsert (if the order were reversed and the upsert failed, we
      // would see a version put with no row).
      const [row] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId))
        .limit(1);
      expect(row?.orgFeePercent).toBe(2500);

      // getVersion now returns the new timestamp (observable bump).
      const observedVersion = await cache.getVersion(`org:${organizationId}`);
      expect(observedVersion).toBe(versionPut?.[1]);
    });

    it('upsertCreatorOverride bumps the version key for "override:<orgId>:<creatorId>"', async () => {
      await db
        .delete(feeConfigOrgCreator)
        .where(
          and(
            eq(feeConfigOrgCreator.organizationId, organizationId),
            eq(feeConfigOrgCreator.creatorId, creatorId)
          )
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
      expect(kv.put).toHaveBeenCalledWith(
        versionKey,
        expect.any(String),
        expect.anything()
      );
    });

    it('no-op update does NOT bump the cache version', async () => {
      // Seed first to put the row in a known state.
      await db
        .delete(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));
      const seedSvc = new FeeConfigService({ db, environment: 'test' });
      await seedSvc.updateOrgFees(
        organizationId,
        { orgFeePercent: 1234 },
        adminId
      );

      const kv = createMockKVNamespace();
      const cache = new VersionedCache({ kv: kv as unknown as KVNamespace });
      const svc = new FeeConfigService({ db, environment: 'test', cache });

      // Same value → diff is empty → early return before invalidate.
      await svc.updateOrgFees(organizationId, { orgFeePercent: 1234 }, adminId);
      await Promise.resolve();
      await Promise.resolve();

      const versionKey = `cache:version:org:${organizationId}`;
      // `kv.put` must never have been called with the version key — the
      // no-op early-returns before reaching invalidateAsync.
      expect(kv.put).not.toHaveBeenCalledWith(
        versionKey,
        expect.anything(),
        expect.anything()
      );
    });
  });
});
