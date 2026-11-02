/**
 * Migration 0125's CHECK (Codex-2hxff.97, data design §6):
 * `check_subscription_pending_billing`. A waiting change of billing is an
 * interval and an amount together, only beside a waiting move, onto the
 * other interval, never a negative bill.
 *
 * Real DB. A CHECK that evaluates to NULL passes in Postgres, so besides one
 * row per refusal, the stored expression is evaluated over every combination
 * of its columns and must never be NULL. Every row hangs off this file's own
 * organisation and subscriber, deleted in afterAll.
 */

import {
  organizations,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHECK = 'check_subscription_pending_billing';

/** The constraint a refused write names, from Postgres's error. */
async function refusedBy(write: Promise<unknown>): Promise<string> {
  try {
    await write;
  } catch (error) {
    const found = [error, (error as { cause?: unknown }).cause].find(
      (e): e is { constraint: string } =>
        typeof (e as { constraint?: unknown })?.constraint === 'string'
    );
    return found?.constraint ?? String(error);
  }
  return 'accepted';
}

describe('0125 check_subscription_pending_billing (Codex-2hxff.97)', () => {
  let db: Database;
  let orgId: string;
  let userId: string;
  let basicId: string;
  let rowId: string;
  const from = new Date('2027-03-12T10:00:00Z');

  beforeAll(async () => {
    db = setupTestDatabase();
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('pend-bill') })
        )
        .returning()
    );
    orgId = org.id;
    const tier = async (name: string, sortOrder: number, monthly: number) =>
      takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org.id, {
              name,
              sortOrder,
              priceMonthly: monthly,
              priceAnnual: monthly * 10,
            })
          )
          .returning()
      );
    basicId = (await tier('Basic', 1, 500)).id;
    const pro = await tier('Pro', 2, 1200);
    userId = takeFirst(await seedTestUsers(db, 1), 'member');
    rowId = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, pro.id, {
            billingInterval: 'year',
            amountCents: 12000,
            platformFeeCents: 1200,
            organizationFeeCents: 1620,
            creatorPayoutCents: 9180,
          })
        )
        .returning()
    ).id;
  });

  afterAll(async () => {
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
    await teardownTestDatabase();
  });

  /** A waiting move to Basic, with the billing columns as given. */
  const write = (
    billing: {
      pendingBillingInterval: string | null;
      pendingAmountCents: number | null;
    },
    move = true
  ) =>
    db
      .update(subscriptions)
      .set({
        pendingTierId: move ? basicId : null,
        pendingTierFrom: move ? from : null,
        heldAmountCents: move ? 12000 : null,
        ...billing,
      })
      .where(eq(subscriptions.id, rowId));

  it('takes a waiting change of billing, and none', async () => {
    expect(
      await refusedBy(
        write({ pendingBillingInterval: 'month', pendingAmountCents: 500 })
      )
    ).toBe('accepted');
    expect(
      await refusedBy(
        write({ pendingBillingInterval: null, pendingAmountCents: null })
      )
    ).toBe('accepted');
    expect(
      await refusedBy(
        write({ pendingBillingInterval: null, pendingAmountCents: null }, false)
      )
    ).toBe('accepted');
  });

  it.each([
    [
      'an interval without an amount',
      { pendingBillingInterval: 'month', pendingAmountCents: null },
      true,
    ],
    [
      'an amount without an interval',
      { pendingBillingInterval: null, pendingAmountCents: 500 },
      true,
    ],
    [
      'an interval without a waiting move',
      { pendingBillingInterval: 'month', pendingAmountCents: 500 },
      false,
    ],
    [
      'the interval the row is already billed on',
      { pendingBillingInterval: 'year', pendingAmountCents: 500 },
      true,
    ],
    [
      'an interval that is not month or year',
      { pendingBillingInterval: 'week', pendingAmountCents: 500 },
      true,
    ],
    [
      'a negative bill',
      { pendingBillingInterval: 'month', pendingAmountCents: -1 },
      true,
    ],
  ])('refuses %s', async (_name, billing, move) => {
    expect(await refusedBy(write(billing, move))).toBe(CHECK);
  });

  it('never evaluates to NULL, for any combination of its columns', async () => {
    const def = await db.execute(
      sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${CHECK}`
    );
    const text = (def.rows[0] as { def: string } | undefined)?.def ?? '';
    expect(text).toMatch(/^CHECK /);
    const expression = text.replace(/^CHECK /, '');

    const intervals = [null, 'month', 'year', 'week'];
    const amounts = [null, -1, 0, 500];
    const tiers = [null, basicId];
    const billed = ['month', 'year'];
    const rows = intervals.flatMap((interval) =>
      amounts.flatMap((amount) =>
        tiers.flatMap((tier) =>
          billed.map(
            (billing) =>
              sql`(${interval}::varchar, ${amount}::integer, ${tier}::uuid, ${billing}::varchar)`
          )
        )
      )
    );
    const result = await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE (${sql.raw(expression)}) IS NULL)::int AS nulls
        FROM (VALUES ${sql.join(rows, sql`, `)})
          AS subscriptions(pending_billing_interval, pending_amount_cents, pending_tier_id, billing_interval)
    `);
    expect(result.rows[0]).toEqual({ total: 64, nulls: 0 });
  });
});
