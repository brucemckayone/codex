/**
 * Financial records are permanent (docs/payments/README.md rule 5,
 * Codex-2hxff.23, migration 0111).
 *
 * The database itself refuses to delete a user, organisation or course that
 * money history points at: every foreign key from a money table to one of
 * them is ON DELETE RESTRICT (or SET NULL for an optional reference), never
 * CASCADE. Account deletion anonymises instead (identity-service
 * `deleteAccount`), so no production path issues the hard delete; this is the
 * guarantee for the one that someday might.
 *
 * Real DB. Skips when DB_METHOD is not configured.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

const MONEY_TABLES = [
  'purchases',
  'subscriptions',
  'course_subscriptions',
  'pending_payouts',
  'payouts',
  'refunds',
  'disputes',
  'payout_reversals',
  'refund_reviews',
] as const;

const OWNER_TABLES = ['users', 'organizations', 'courses'] as const;

/** Postgres SQLSTATE of a failed query; drizzle wraps it in `cause`. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

describe.skipIf(!HAS_DB)('money history outlives its owner', () => {
  const tag = `restrict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-${tag}`;
  let orgId: string | undefined;

  afterAll(async () => {
    const { dbHttp } = await import('../index');
    const { organizations, payouts, users } = await import('../schema');
    await dbHttp.delete(payouts).where(eq(payouts.userId, userId));
    if (orgId) {
      await dbHttp.delete(organizations).where(eq(organizations.id, orgId));
    }
    await dbHttp.delete(users).where(eq(users.id, userId));
  });

  it('no foreign key from a money table to a user, organisation or course cascades', async () => {
    const { dbHttp } = await import('../index');
    // A census of the live catalogue, not a list of names: a money table that
    // gains a new owner reference later is checked too.
    const result = await dbHttp.execute(sql`
      SELECT src.relname AS from_table,
             dst.relname AS to_table,
             c.conname AS name,
             c.confdeltype AS on_delete
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE c.contype = 'f'
        AND n.nspname = 'public'
        AND src.relname IN (${sql.join(
          MONEY_TABLES.map((t) => sql`${t}`),
          sql`, `
        )})
        AND dst.relname IN (${sql.join(
          OWNER_TABLES.map((t) => sql`${t}`),
          sql`, `
        )})
    `);
    const rows = result.rows as Array<{
      from_table: string;
      to_table: string;
      name: string;
      on_delete: string;
    }>;

    // Calibration: the census sees the references it is meant to guard.
    const seen = new Set(rows.map((r) => `${r.from_table}->${r.to_table}`));
    for (const edge of [
      'purchases->users',
      'payouts->users',
      'payouts->organizations',
      'subscriptions->users',
      'subscriptions->organizations',
      'course_subscriptions->users',
      'course_subscriptions->courses',
    ]) {
      expect(seen, edge).toContain(edge);
    }

    // 'c' = CASCADE. RESTRICT ('r'), NO ACTION ('a') and SET NULL ('n') all
    // keep the money row.
    const cascading = rows
      .filter((r) => r.on_delete === 'c')
      .map((r) => `${r.from_table}.${r.name} -> ${r.to_table}`);
    expect(cascading).toEqual([]);
  });

  it('refuses to hard-delete a user or organisation with a payout, and allows it once the payout is gone', async () => {
    const { dbHttp } = await import('../index');
    const { organizations, payouts, users } = await import('../schema');

    await dbHttp.insert(users).values({
      id: userId,
      name: 'Restrict Test',
      email: `${tag}@example.test`,
    });
    const [org] = await dbHttp
      .insert(organizations)
      .values({ name: `Restrict ${tag}`, slug: tag })
      .returning({ id: organizations.id });
    expect(org).toBeDefined();
    orgId = org!.id;

    await dbHttp.insert(payouts).values({
      userId,
      organizationId: orgId,
      amountCents: 500,
      payoutType: 'creator_payout',
      status: 'pending',
      reason: 'connect_not_ready',
      sourceType: 'subscription',
    });

    const userDelete = await dbHttp
      .delete(users)
      .where(eq(users.id, userId))
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect(pgCode(userDelete)).toBe('23503');

    const orgDelete = await dbHttp
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect(pgCode(orgDelete)).toBe('23503');

    // The refusal is the money row's, not something else holding the user.
    await dbHttp.delete(payouts).where(eq(payouts.userId, userId));
    await dbHttp.delete(organizations).where(eq(organizations.id, orgId));
    await dbHttp.delete(users).where(eq(users.id, userId));
    const left = await dbHttp
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    expect(left).toEqual([]);
  });
});
