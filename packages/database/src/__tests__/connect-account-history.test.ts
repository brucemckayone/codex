/**
 * Every Connect account a user stops having is remembered (Codex-2hxff.47,
 * migration 0113), so a transfer sent to it can still be found and never
 * sent twice. A trigger does it, so a manual support edit is caught too.
 *
 * Real DB. Skips when DB_METHOD is not configured.
 */

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

describe.skipIf(!HAS_DB)('stripe_connect_account_history', () => {
  const tag = `connhist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-${tag}`;

  afterAll(async () => {
    const { dbHttp } = await import('../index');
    const { stripeConnectAccountHistory, stripeConnectAccounts, users } =
      await import('../schema');
    await dbHttp
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, userId));
    await dbHttp
      .delete(stripeConnectAccountHistory)
      .where(eq(stripeConnectAccountHistory.userId, userId));
    await dbHttp.delete(users).where(eq(users.id, userId));
  });

  it('records the old account on a re-key and on a delete, and nothing on a no-op update', async () => {
    const { dbHttp } = await import('../index');
    const { stripeConnectAccountHistory, stripeConnectAccounts, users } =
      await import('../schema');
    const history = () =>
      dbHttp
        .select({ account: stripeConnectAccountHistory.stripeAccountId })
        .from(stripeConnectAccountHistory)
        .where(eq(stripeConnectAccountHistory.userId, userId))
        .orderBy(stripeConnectAccountHistory.stripeAccountId);

    await dbHttp.insert(users).values({
      id: userId,
      name: 'History Test',
      email: `${tag}@example.test`,
    });
    await dbHttp.insert(stripeConnectAccounts).values({
      userId,
      stripeAccountId: `acct_${tag}_a`,
    });

    // The same value written again is not a replacement.
    await dbHttp
      .update(stripeConnectAccounts)
      .set({ stripeAccountId: `acct_${tag}_a` })
      .where(eq(stripeConnectAccounts.userId, userId));
    expect(await history()).toEqual([]);

    // Support re-keys the row by hand.
    await dbHttp
      .update(stripeConnectAccounts)
      .set({ stripeAccountId: `acct_${tag}_b` })
      .where(eq(stripeConnectAccounts.userId, userId));
    expect(await history()).toEqual([{ account: `acct_${tag}_a` }]);

    // Support deletes the row so the creator can onboard again.
    await dbHttp
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, userId));
    expect(await history()).toEqual([
      { account: `acct_${tag}_a` },
      { account: `acct_${tag}_b` },
    ]);
  });

  it('a user with a Connect account can still be hard-deleted (the history has no FK to block or break it)', async () => {
    const { dbHttp } = await import('../index');
    const { stripeConnectAccounts, users } = await import('../schema');
    const other = `${userId}-del`;
    await dbHttp.insert(users).values({
      id: other,
      name: 'History Delete',
      email: `${tag}-del@example.test`,
    });
    await dbHttp.insert(stripeConnectAccounts).values({
      userId: other,
      stripeAccountId: `acct_${tag}_del`,
    });

    // Cascades to the Connect row, whose trigger writes history naming a
    // user deleted in the same statement.
    await dbHttp.delete(users).where(eq(users.id, other));

    const left = await dbHttp
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, other));
    expect(left).toEqual([]);
    const { stripeConnectAccountHistory } = await import('../schema');
    await dbHttp
      .delete(stripeConnectAccountHistory)
      .where(eq(stripeConnectAccountHistory.userId, other));
  });
});
