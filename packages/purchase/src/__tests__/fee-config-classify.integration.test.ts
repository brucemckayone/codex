/**
 * Classifying a fee write (Codex-2hxff.33; batch C1 Part B data design §1.3,
 * owner decisions F1, F2, F9), against a real Postgres.
 *
 * Every write is ONE transaction under the level's lock: the classification,
 * the change, the version, the audit lines and any follow-up notices
 * (Codex-rtwpv). A cut applies at once; a rise waits for notifications-api's
 * daily run; an edit to a waiting rise follows F2. The old current rows only
 * ever hold the values in force, never a waiting rise (§6.1).
 *
 * Everything here is at ONE organisation's level, so nothing another suite
 * resolves can move: the platform level is shared, and is never written.
 * Each case starts from in-force values seeded with `seedFeeLevel`.
 */

import { FEES } from '@codex/constants';
import {
  feeChangeNotices,
  feeChanges,
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigVersions,
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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

describe('FeeConfigService — classifying a write (real DB)', () => {
  let db: Database;
  let svc: FeeConfigService;
  let adminId: string;
  let creatorId: string;
  let toldId: string;
  let untoldId: string;
  let organizationId: string;
  const level = () => ({ scope: 'org' as const, organizationId });

  async function changesOfOrg() {
    return db
      .select()
      .from(feeChanges)
      .where(eq(feeChanges.organizationId, organizationId))
      .orderBy(feeChanges.createdAt);
  }

  async function liveVersion(changeId: string) {
    const [row] = await db
      .select()
      .from(feeConfigVersions)
      .where(
        and(
          eq(feeConfigVersions.changeId, changeId),
          isNull(feeConfigVersions.supersededAt)
        )
      );
    return row;
  }

  async function orgRow() {
    const [row] = await db
      .select()
      .from(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId));
    return row;
  }

  /** As the daily run leaves it: one person told, one not yet. */
  async function listNotices(changeId: string) {
    const roles = [{ organizationId, as: 'creator' as const }];
    await db.insert(feeChangeNotices).values([
      {
        changeId,
        userId: toldId,
        kind: 'announce',
        onList: true,
        roles,
        beforeValues: [],
        afterValues: [],
        state: 'sent',
        acceptedAt: new Date(),
        attempts: 1,
      },
      {
        changeId,
        userId: untoldId,
        kind: 'announce',
        onList: true,
        roles,
        beforeValues: [],
        afterValues: [],
        state: 'failed',
        lastReason: 'refused',
        attempts: 1,
      },
    ]);
  }

  async function noticesOf(changeId: string) {
    return db
      .select({
        userId: feeChangeNotices.userId,
        kind: feeChangeNotices.kind,
        state: feeChangeNotices.state,
        onList: feeChangeNotices.onList,
      })
      .from(feeChangeNotices)
      .where(eq(feeChangeNotices.changeId, changeId));
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new FeeConfigService({ db, environment: 'test' });
    [adminId, creatorId, toldId, untoldId] = (await seedTestUsers(db, 4)) as [
      string,
      string,
      string,
      string,
    ];
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Fee Classify Org',
        slug: createUniqueSlug('fee-classify'),
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('Failed to create test organization');
    organizationId = org.id;
  });

  beforeEach(async () => {
    await db
      .delete(feeChanges)
      .where(eq(feeChanges.organizationId, organizationId));
    await db
      .delete(feeConfigOrg)
      .where(eq(feeConfigOrg.organizationId, organizationId));
    await db
      .delete(feeConfigOrgCreator)
      .where(eq(feeConfigOrgCreator.organizationId, organizationId));
    await db
      .delete(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
  });

  afterAll(async () => {
    await db
      .delete(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db
      .delete(users)
      .where(inArray(users.id, [adminId, creatorId, toldId, untoldId]));
    await teardownTestDatabase();
  });

  // ── No waiting rise ───────────────────────────────────────────────────────

  it('a cut applies at once; a sale before it still resolves the old fee', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 2000 });
    const before = new Date(Date.now() - 1000);

    const result = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );

    expect(result.outcome).toBe('cut');
    expect(result.change?.kind).toBe('cut');
    expect(result.change?.effectiveFrom).not.toBeNull();
    expect(result.firstEmailsAt).toBeNull();
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(1500);
    // The key gap the research found: a late webhook for an earlier sale
    // splits with ITS fee, not the one after the change.
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off', before)).orgFeePercent
    ).toBe(2000);
    expect((await orgRow())?.orgFeePercent).toBe(1500);
  });

  it('a rise waits: not dated, not in force, not in the current row', async () => {
    const result = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );

    expect(result.outcome).toBe('rise');
    expect(result.change).toMatchObject({
      kind: 'rise',
      effectiveFrom: null,
      firstRunAt: null,
    });
    // The first emails go on the next 08:00 UTC run.
    const firstEmails = new Date(result.firstEmailsAt ?? '');
    expect(firstEmails.getUTCHours()).toBe(8);
    expect(firstEmails.getTime()).toBeGreaterThan(Date.now());
    // Still today's (inherited) fee for every sale.
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(FEES.ORG_PERCENT);
    // Nothing was in force at this level, so there is no current row.
    expect(await orgRow()).toBeUndefined();
    const audit = await db
      .select()
      .from(feeConfigAuditLog)
      .where(eq(feeConfigAuditLog.scopeOrgId, organizationId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changeId).toBe(result.change?.id);
    expect(audit[0]?.effectiveFrom).toBeNull();
  });

  it('F1: one org fee that is a rise on one-off sales and a cut on subscriptions waits as a whole', async () => {
    // Inherited: 10% one-off, 15% subscriptions. 12% is up on one, down on
    // the other.
    const result = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1200 },
      adminId
    );
    expect(result.outcome).toBe('rise');
    expect(
      (await svc.getFeesForOrg(organizationId, 'subscription')).orgFeePercent
    ).toBe(FEES.SUBSCRIPTION_ORG_PERCENT);
  });

  it('F9: raising the minimum transfer is a rise', async () => {
    const result = await svc.updateOrgFees(
      organizationId,
      { minTransferCents: 500 },
      adminId
    );
    expect(result.outcome).toBe('rise');
  });

  it('clearing a waiver back to the inherited fee is a rise', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 0 });
    const result = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: null },
      adminId
    );
    expect(result.outcome).toBe('rise');
    // The waiver stays in force, and in the current row, until the date.
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(0);
    expect((await orgRow())?.orgFeePercent).toBe(0);
  });

  // ── A waiting rise (F2) ───────────────────────────────────────────────────

  it('smaller: a new version under the SAME change, and one short email to everyone told', async () => {
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );
    const riseId = rise.change?.id as string;
    await listNotices(riseId);

    const smaller = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1300 },
      adminId
    );

    expect(smaller.outcome).toBe('smaller');
    expect(smaller.change?.id).toBe(riseId);
    expect((await liveVersion(riseId))?.orgFeePercent).toBe(1300);
    const versions = await db
      .select()
      .from(feeConfigVersions)
      .where(eq(feeConfigVersions.changeId, riseId));
    expect(versions).toHaveLength(2);
    // Q2 (A): the told person gets a `smaller` email; the untold one just
    // gets the announcement, now with the smaller figure.
    const notices = await noticesOf(riseId);
    expect(
      notices.filter((n) => n.kind === 'smaller').map((n) => n.userId)
    ).toEqual([toldId]);
    expect(notices.find((n) => n.kind === 'smaller')?.onList).toBe(false);
  });

  it('a rise restated with the same figures keeps its change and emails nobody', async () => {
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );
    const riseId = rise.change?.id as string;
    await listNotices(riseId);

    // 0 is what the minimum transfer inherits: a different stored value,
    // the same fees.
    const same = await svc.updateOrgFees(
      organizationId,
      { minTransferCents: 0 },
      adminId
    );
    expect(same.outcome).toBe('same_as_waiting');
    expect(same.change?.id).toBe(riseId);
    expect(
      (await noticesOf(riseId)).filter((n) => n.kind === 'smaller')
    ).toHaveLength(0);
  });

  it('bigger: the waiting rise is replaced and a new 30 days start; nobody waits for the old one', async () => {
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );
    const riseId = rise.change?.id as string;
    await listNotices(riseId);

    const bigger = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1800 },
      adminId
    );

    expect(bigger.outcome).toBe('bigger');
    expect(bigger.voidedChangeId).toBe(riseId);
    expect(bigger.change).toMatchObject({
      kind: 'rise',
      effectiveFrom: null,
      replacesChangeId: riseId,
    });
    const [old] = await db
      .select()
      .from(feeChanges)
      .where(eq(feeChanges.id, riseId));
    expect(old?.voidReason).toBe('replaced_by_bigger');
    const notices = await noticesOf(riseId);
    expect(notices.find((n) => n.userId === untoldId)?.state).toBe(
      'not_needed'
    );
    // Its announcement says what it replaces: no separate "cancelled".
    expect(notices.filter((n) => n.kind === 'cancelled')).toHaveLength(0);
  });

  it('back to today exactly: the rise is cancelled, the told are emailed it is off, no version written', async () => {
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );
    const riseId = rise.change?.id as string;
    await listNotices(riseId);

    const back = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: null },
      adminId
    );

    expect(back.outcome).toBe('cancelled');
    expect(back.voidedChangeId).toBe(riseId);
    expect(back.change).toBeNull();
    const changes = await changesOfOrg();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.voidReason).toBe('cancelled');
    const notices = await noticesOf(riseId);
    expect(
      notices.filter((n) => n.kind === 'cancelled').map((n) => n.userId)
    ).toEqual([toldId]);
    expect(
      notices.find((n) => n.userId === untoldId && n.kind === 'announce')?.state
    ).toBe('not_needed');
  });

  it('below today: the rise is off and the cut applies at once', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 2000 });
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 2500 },
      adminId
    );
    expect(rise.outcome).toBe('rise');
    await listNotices(rise.change?.id as string);

    const cut = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );

    expect(cut.outcome).toBe('cut_below_today');
    expect(cut.voidedChangeId).toBe(rise.change?.id);
    expect(cut.change?.kind).toBe('cut');
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(1500);
    expect((await orgRow())?.orgFeePercent).toBe(1500);
    expect(
      (await noticesOf(rise.change?.id as string)).filter(
        (n) => n.kind === 'cancelled'
      )
    ).toHaveLength(1);
  });

  // ── Removal and cancel by name ────────────────────────────────────────────

  it('removing values that are above the inherited ones is a cut: a removed version, the row deleted', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 2000 });
    await svc.updateOrgFees(organizationId, { orgFeePercent: 1900 }, adminId);
    expect(await orgRow()).toBeDefined();

    const removed = await svc.deleteOrgFees(organizationId, adminId);

    expect(removed.outcome).toBe('cut');
    expect((await liveVersion(removed.change?.id as string))?.removed).toBe(
      true
    );
    expect(await orgRow()).toBeUndefined();
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(FEES.ORG_PERCENT);
  });

  it('removing a waiver is a rise: it waits, and the row keeps the waiver', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 500 });
    await svc.updateOrgFees(organizationId, { orgFeePercent: 400 }, adminId);

    const removed = await svc.deleteOrgFees(organizationId, adminId);

    expect(removed.outcome).toBe('rise');
    expect((await orgRow())?.orgFeePercent).toBe(400);
    // Nothing is deleted: the change and its removed version exist.
    expect((await liveVersion(removed.change?.id as string))?.removed).toBe(
      true
    );
  });

  it('removing nothing changes nothing', async () => {
    const result = await svc.deleteOrgFees(organizationId, adminId);
    expect(result.outcome).toBe('unchanged');
    expect(await changesOfOrg()).toHaveLength(0);
  });

  it('cancel by name voids a waiting rise; a second cancel, or a cut, is 409 FEE_CHANGE_NOT_WAITING', async () => {
    const rise = await svc.updateOrgFees(
      organizationId,
      { orgFeePercent: 1500 },
      adminId
    );
    const riseId = rise.change?.id as string;
    await listNotices(riseId);

    const cancelled = await svc.cancelChange(riseId, adminId);

    expect(cancelled.voidReason).toBe('cancelled');
    expect(
      (await noticesOf(riseId)).filter((n) => n.kind === 'cancelled')
    ).toHaveLength(1);
    await expect(svc.cancelChange(riseId, adminId)).rejects.toMatchObject({
      statusCode: 409,
      context: { code: 'FEE_CHANGE_NOT_WAITING' },
    });

    const cutId = await seedFeeLevel(db, level(), { orgFeePercent: 900 });
    await expect(svc.cancelChange(cutId, adminId)).rejects.toMatchObject({
      context: { code: 'FEE_CHANGE_NOT_WAITING' },
    });
  });

  // ── One transaction (Codex-rtwpv) and the level lock ──────────────────────

  it('a failure late in the write rolls back the change and its version', async () => {
    await seedFeeLevel(db, level(), { orgFeePercent: 2000 });
    // Fail the audit insert, the step after the change and version, for
    // this one organisation only. DDL takes no bind parameters; the id is a
    // uuid this suite created.
    const orgLiteral = sql.raw(`'${organizationId}'`);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fee_audit_fail_probe_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.scope_org_id = ${orgLiteral}::uuid THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER fee_audit_fail_probe BEFORE INSERT ON fee_config_audit_log
      FOR EACH ROW EXECUTE FUNCTION fee_audit_fail_probe_fn()
    `);
    try {
      await expect(
        svc.updateOrgFees(organizationId, { orgFeePercent: 1500 }, adminId)
      ).rejects.toThrow();
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS fee_audit_fail_probe ON fee_config_audit_log`
      );
      await db.execute(sql`DROP FUNCTION IF EXISTS fee_audit_fail_probe_fn()`);
    }

    // Only the seeded change: the cut, its version and the row never landed.
    expect(await changesOfOrg()).toHaveLength(1);
    expect(
      (await svc.getFeesForOrg(organizationId, 'one_off')).orgFeePercent
    ).toBe(2000);
    expect(await orgRow()).toBeUndefined();
  });

  it('two saves race: the second waits for the level lock and classifies against the first', async () => {
    const key = `fee-level:org:${organizationId}`;
    let blocked = false;
    let second: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // The "first save": hold the level's lock and write a waiting rise.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const [pidRow] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`))
        .rows as Array<{ pid: number }>;
      const [first] = await tx
        .insert(feeChanges)
        .values({
          scope: 'org',
          organizationId,
          kind: 'rise',
          createdBy: adminId,
        })
        .returning({ id: feeChanges.id });
      await tx.insert(feeConfigVersions).values({
        changeId: first?.id as string,
        scope: 'org',
        orgFeePercent: 1500,
      });

      second = svc.updateOrgFees(
        organizationId,
        { orgFeePercent: 1800 },
        adminId
      );
      // Probe, never sleep: wait until Postgres reports the second save
      // blocked by this transaction's backend.
      for (let i = 0; i < 100 && !blocked; i++) {
        const probe = await db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pidRow?.pid ?? 0} = ANY(pg_blocking_pids(pid))`
        );
        blocked = ((probe.rows[0] as { n: number } | undefined)?.n ?? 0) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
    });

    expect(blocked).toBe(true);
    const result = (await second) as { outcome: string };
    // It saw the first save's rise, so it is bigger, not a second rise.
    expect(result.outcome).toBe('bigger');
    const waiting = (await changesOfOrg()).filter(
      (c) => c.kind === 'rise' && c.voidedAt === null
    );
    expect(waiting).toHaveLength(1);
  });
});
