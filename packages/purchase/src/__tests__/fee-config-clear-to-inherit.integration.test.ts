/**
 * FeeConfigService: `null` clears an org or override column back to inherit
 * (Codex-2hxff.23 PAY-16), against a real Postgres.
 *
 * The zod schemas accept `null` as "inherit the tier above". The write used
 * to merge with `??`, so the old value stayed while the audit log recorded a
 * clear (as the string 'null'), and every repeat recorded another. Now the
 * column becomes NULL, the audit row says old → NULL, and a repeat writes
 * nothing.
 *
 * Since Codex-2hxff.33 each clear here is a CUT (the inherited value is
 * lower than the cleared one), so it applies at once. Clearing a value below
 * the inherited one (losing a waiver) is a rise and waits: that case is in
 * fee-config-classify.integration.test.ts. Each starts from an in-force
 * value seeded with `seedFeeLevel`.
 *
 * The local test DB is shared with other sessions, so this file never calls
 * `cleanupDatabase`: it deletes only the users, org and fee rows it made.
 */

import {
  feeChanges,
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  organizations,
  users,
} from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedFeeLevel,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

describe('FeeConfigService — null clears back to inherit (real DB)', () => {
  let db: Database;
  let service: FeeConfigService;
  let adminId: string;
  let creatorId: string;
  let organizationId: string;

  async function auditRows(columnName: string, scope: 'org' | 'override') {
    return db
      .select({
        oldValue: feeConfigAuditLog.oldValue,
        newValue: feeConfigAuditLog.newValue,
      })
      .from(feeConfigAuditLog)
      .where(
        and(
          eq(feeConfigAuditLog.scopeOrgId, organizationId),
          eq(feeConfigAuditLog.scope, scope),
          eq(feeConfigAuditLog.columnName, columnName)
        )
      );
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new FeeConfigService({ db, environment: 'test' });
    [adminId, creatorId] = await seedTestUsers(db, 2);
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Fee Clear To Inherit Org',
        slug: createUniqueSlug('fee-clear-inherit'),
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('Failed to create test organization');
    organizationId = org.id;
  });

  afterAll(async () => {
    // Audit rows first: changed_by RESTRICTs the user delete.
    await db
      .delete(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
    await db
      .delete(feeChanges)
      .where(eq(feeChanges.organizationId, organizationId));
    await db
      .delete(feeConfigOrgCreator)
      .where(eq(feeConfigOrgCreator.organizationId, organizationId));
    await db
      .delete(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(inArray(users.id, [adminId, creatorId]));
    await teardownTestDatabase();
  });

  it('org: {orgFeePercent: null} stores NULL, audits old → NULL once, and a repeat writes nothing', async () => {
    await seedFeeLevel(
      db,
      { scope: 'org', organizationId },
      { orgFeePercent: 1800 }
    );
    const cleared = await service.updateOrgFees(
      organizationId,
      { orgFeePercent: null },
      adminId
    );
    expect(cleared.outcome).toBe('cut');

    const row = await service.getOrgRow(organizationId);
    expect(row?.orgFeePercent).toBeNull();
    const audited = await auditRows('orgFeePercent', 'org');
    expect(audited).toEqual([{ oldValue: '1800', newValue: null }]);

    // Inherits again: the org's one-off fee is the platform's.
    const [orgFees, platformFees] = await Promise.all([
      service.getFeesForOrg(organizationId, 'one_off'),
      service.getFeesPlatform('one_off'),
    ]);
    expect(orgFees.orgFeePercent).toBe(platformFees.orgFeePercent);

    const repeat = await service.updateOrgFees(
      organizationId,
      { orgFeePercent: null },
      adminId
    );
    expect(repeat.outcome).toBe('unchanged');
    expect(await auditRows('orgFeePercent', 'org')).toHaveLength(1);
  });

  it('override: {platformFeePercent: null} stores NULL, audits old → NULL once, and a repeat writes nothing', async () => {
    await seedFeeLevel(
      db,
      { scope: 'creator', organizationId, creatorId },
      { platformFeePercent: 1500, notes: 'launch deal' }
    );
    const cleared = await service.upsertCreatorOverride(
      organizationId,
      creatorId,
      { platformFeePercent: null },
      adminId
    );
    expect(cleared.outcome).toBe('cut');

    const row = await service.getCreatorOverrideRow(organizationId, creatorId);
    expect(row?.platformFeePercent).toBeNull();
    // A column the update does not name is left alone.
    expect(row?.notes).toBe('launch deal');
    expect(await auditRows('platformFeePercent', 'override')).toEqual([
      { oldValue: '1500', newValue: null },
    ]);

    await service.upsertCreatorOverride(
      organizationId,
      creatorId,
      { platformFeePercent: null },
      adminId
    );
    expect(await auditRows('platformFeePercent', 'override')).toHaveLength(1);
  });
});
