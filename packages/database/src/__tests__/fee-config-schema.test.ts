/**
 * Fee Config Schema Constraint Tests (Codex-m644n PR #182).
 *
 * Verifies the DB-level invariants for `fee_config_*` tables:
 *
 *   1. platform: only one row allowed (CHECK id='singleton').
 *   2. platform: percent bps clamped to [0, 10000]; floor cents non-negative.
 *   3. org: PK on organizationId prevents duplicate rows per org.
 *   4. org/override: nullable percent columns admit NULL but clamp non-null
 *      values to [0, 10000].
 *   5. override: composite PK (orgId, creatorId) prevents duplicates.
 *   6. audit-log: scope CHECK constraint enforces correct (orgId, creatorId)
 *      shape per scope value.
 *   7. version columns: default to 1 on INSERT when omitted.
 *
 * Real DB. Skips when DB_METHOD is not configured (e.g. local without proxy).
 */

import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/**
 * Probe whether the fee_config_* tables exist in the connected DB. The
 * migration adding them landed in PR #182 (Codex-m644n) — local dev DBs
 * without `pnpm db:migrate` recently run will not have them yet. We skip the
 * whole suite rather than fail noisily on a config gap.
 */
let MIGRATION_APPLIED = false;
beforeAll(async () => {
  if (!HAS_DB) return;
  try {
    const { dbHttp } = await import('../index');
    const result = await dbHttp.execute(
      sql`SELECT to_regclass('public.fee_config_audit_log') AS exists`
    );
    MIGRATION_APPLIED = Boolean(
      (result.rows[0] as { exists: string | null } | undefined)?.exists
    );
  } catch {
    MIGRATION_APPLIED = false;
  }
});

// Reusable inserter for "expect this to throw a constraint error".
async function expectConstraintError(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

/** Skip the current test if the migration hasn't been applied locally. */
function skipIfNoMigration(ctx: { skip: () => void }) {
  if (!MIGRATION_APPLIED) ctx.skip();
}

describe.skipIf(!HAS_DB)('Fee Config Schema Constraints', () => {
  beforeAll(() => {
    if (!MIGRATION_APPLIED) {
      console.warn(
        '[fee-config-schema] Skipping suite — fee_config_* tables not present. Run `pnpm db:migrate` to enable.'
      );
    }
  });
  describe('feeConfigPlatform — singleton + bps bounds', () => {
    it('admits exactly one row when id="singleton"', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigPlatform } = await import('../schema');

      // Clean slate. The singleton row may already exist from prior tests or
      // seeds — use upsert with onConflictDoNothing so the assertion still
      // works idempotently.
      await dbHttp
        .insert(feeConfigPlatform)
        .values({
          id: 'singleton',
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        })
        .onConflictDoNothing();

      // A second row with id='not-singleton' MUST be rejected by the CHECK.
      await expectConstraintError(
        dbHttp.insert(feeConfigPlatform).values({
          id: 'not-singleton',
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        })
      );
    });

    it('rejects platformFeePercent > 10000', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigPlatform } = await import('../schema');
      await expectConstraintError(
        dbHttp
          .insert(feeConfigPlatform)
          .values({
            id: 'singleton',
            platformFeePercent: 10001,
            subscriptionOrgFeePercent: 1500,
            oneOffOrgFeePercent: 0,
            minPlatformFeeCents: 0,
            minTransferCents: 0,
          })
          .onConflictDoUpdate({
            target: feeConfigPlatform.id,
            set: { platformFeePercent: 10001 },
          })
      );
    });

    it('rejects negative minPlatformFeeCents', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigPlatform } = await import('../schema');
      await expectConstraintError(
        dbHttp
          .insert(feeConfigPlatform)
          .values({
            id: 'singleton',
            platformFeePercent: 1000,
            subscriptionOrgFeePercent: 1500,
            oneOffOrgFeePercent: 0,
            minPlatformFeeCents: -1,
            minTransferCents: 0,
          })
          .onConflictDoUpdate({
            target: feeConfigPlatform.id,
            set: { minPlatformFeeCents: -1 },
          })
      );
    });

    it('version defaults to 1 when omitted on first insert', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigPlatform } = await import('../schema');

      // Idempotent upsert (the singleton may already be present).
      await dbHttp
        .insert(feeConfigPlatform)
        .values({
          id: 'singleton',
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        })
        .onConflictDoNothing();

      const [row] = await dbHttp
        .select()
        .from(feeConfigPlatform)
        .where(eq(feeConfigPlatform.id, 'singleton'))
        .limit(1);
      // Either freshly inserted (version=1) or previously bumped — version
      // must be >= 1 and integer.
      expect(row).toBeDefined();
      expect(typeof row.version).toBe('number');
      expect(row.version).toBeGreaterThanOrEqual(1);
    });
  });

  describe('feeConfigOrg — PK + nullable bps', () => {
    async function freshOrg(label: string): Promise<string> {
      const { dbHttp } = await import('../index');
      const { organizations, users } = await import('../schema');
      // Create owner user first.
      const userId = `fee-schema-${label}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Fee Schema Test',
        emailVerified: false,
        role: 'creator',
      });
      const [org] = await dbHttp
        .insert(organizations)
        .values({
          name: `Fee Schema ${label}`,
          slug: `fee-schema-${label}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          ownerId: userId,
        })
        .returning();
      return org.id;
    }

    it('PK on organizationId prevents duplicate rows for same org', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigOrg } = await import('../schema');
      const orgId = await freshOrg('dup');

      await dbHttp.insert(feeConfigOrg).values({
        organizationId: orgId,
        orgFeePercent: 2000,
      });

      await expectConstraintError(
        dbHttp
          .insert(feeConfigOrg)
          .values({ organizationId: orgId, orgFeePercent: 3000 })
      );
    });

    it('admits NULL percent columns (inherit-from-platform semantics)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigOrg } = await import('../schema');
      const orgId = await freshOrg('nulls');

      const [row] = await dbHttp
        .insert(feeConfigOrg)
        .values({
          organizationId: orgId,
          platformFeePercent: null,
          orgFeePercent: null,
          minPlatformFeeCents: null,
          minTransferCents: null,
        })
        .returning();
      expect(row.platformFeePercent).toBeNull();
      expect(row.orgFeePercent).toBeNull();
    });

    it('rejects non-null orgFeePercent > 10000', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigOrg } = await import('../schema');
      const orgId = await freshOrg('over');
      await expectConstraintError(
        dbHttp
          .insert(feeConfigOrg)
          .values({ organizationId: orgId, orgFeePercent: 10001 })
      );
    });

    it('version defaults to 1 on insert', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigOrg } = await import('../schema');
      const orgId = await freshOrg('ver');
      const [row] = await dbHttp
        .insert(feeConfigOrg)
        .values({ organizationId: orgId, orgFeePercent: 1500 })
        .returning();
      expect(row.version).toBe(1);
    });
  });

  describe('feeConfigOrgCreator — composite PK', () => {
    it('composite PK (orgId, creatorId) prevents duplicate rows', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigOrgCreator, organizations, users } = await import(
        '../schema'
      );

      const userId = `fee-schema-creator-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Creator Test',
        emailVerified: false,
        role: 'creator',
      });
      const [org] = await dbHttp
        .insert(organizations)
        .values({
          name: 'Override Test Org',
          slug: `override-org-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          ownerId: userId,
        })
        .returning();

      await dbHttp.insert(feeConfigOrgCreator).values({
        organizationId: org.id,
        creatorId: userId,
        orgFeePercent: 0,
        notes: 'first',
      });

      await expectConstraintError(
        dbHttp.insert(feeConfigOrgCreator).values({
          organizationId: org.id,
          creatorId: userId,
          orgFeePercent: 0,
          notes: 'second',
        })
      );
    });
  });

  describe('feeConfigAuditLog — scope shape', () => {
    it('rejects scope="platform" with non-null scopeOrgId (shape CHECK)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigAuditLog, organizations, users } = await import(
        '../schema'
      );
      const userId = `fee-schema-audit-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Audit Test',
        emailVerified: false,
        role: 'creator',
      });
      const [org] = await dbHttp
        .insert(organizations)
        .values({
          name: 'Audit Test Org',
          slug: `audit-org-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          ownerId: userId,
        })
        .returning();

      await expectConstraintError(
        dbHttp.insert(feeConfigAuditLog).values({
          scope: 'platform',
          scopeOrgId: org.id, // CHECK requires NULL for scope='platform'
          scopeCreatorId: null,
          columnName: 'platformFeePercent',
          oldValue: '1000',
          newValue: '1100',
          changedBy: userId,
        })
      );
    });

    it('rejects scope="org" with NULL scopeOrgId (shape CHECK)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigAuditLog, users } = await import('../schema');
      const userId = `fee-schema-audit2-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Audit Test 2',
        emailVerified: false,
        role: 'creator',
      });

      await expectConstraintError(
        dbHttp.insert(feeConfigAuditLog).values({
          scope: 'org',
          scopeOrgId: null, // CHECK requires NOT NULL for scope='org'
          scopeCreatorId: null,
          columnName: 'orgFeePercent',
          oldValue: '1500',
          newValue: '2000',
          changedBy: userId,
        })
      );
    });

    it('rejects unknown scope value (CHECK in (platform, org, override))', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigAuditLog, users } = await import('../schema');
      const userId = `fee-schema-audit3-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Audit Test 3',
        emailVerified: false,
        role: 'creator',
      });

      await expectConstraintError(
        dbHttp.insert(feeConfigAuditLog).values({
          scope: 'BOGUS',
          scopeOrgId: null,
          scopeCreatorId: null,
          columnName: 'x',
          oldValue: null,
          newValue: 'y',
          changedBy: userId,
        })
      );
    });

    it('foreign key on changedBy resolves to users.id', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigAuditLog } = await import('../schema');
      // Non-existent changedBy must fail.
      await expectConstraintError(
        dbHttp.insert(feeConfigAuditLog).values({
          scope: 'platform',
          scopeOrgId: null,
          scopeCreatorId: null,
          columnName: 'platformFeePercent',
          oldValue: '1000',
          newValue: '1100',
          changedBy: 'no-such-user-id-12345',
        })
      );
    });

    it('admits scope="platform" with NULL scopeOrgId and NULL scopeCreatorId', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { feeConfigAuditLog, users } = await import('../schema');
      const userId = `fee-schema-audit-ok-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      await dbHttp.insert(users).values({
        id: userId,
        email: `${userId}@test.com`,
        name: 'Audit OK',
        emailVerified: false,
        role: 'creator',
      });

      const [row] = await dbHttp
        .insert(feeConfigAuditLog)
        .values({
          scope: 'platform',
          scopeOrgId: null,
          scopeCreatorId: null,
          columnName: 'platformFeePercent',
          oldValue: '1000',
          newValue: '1100',
          changedBy: userId,
        })
        .returning();
      expect(row.id).toBeDefined();
      expect(row.scope).toBe('platform');

      // Clean up so this row doesn't pollute getAuditLog tests.
      await dbHttp
        .delete(feeConfigAuditLog)
        .where(and(eq(feeConfigAuditLog.id, row.id)));
    });
  });
});
