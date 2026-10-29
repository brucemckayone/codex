/**
 * The daily bank payout job, `runBankPayouts` (Codex-2hxff.29, .30): a fake
 * Stripe over the real `connect_balances` table, because the account set, the
 * snapshot and the episode guard are SQL.
 *
 * The job reads EVERY switched account in the database. Another file's rows
 * are unknown to this fake Stripe, so their balance read fails and they are
 * counted `failed` without a write; the assertions below are per account,
 * and the summary's other counters are this file's alone.
 */

import { connectBalances, stripeConnectAccounts } from '@codex/database/schema';
import {
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  BANK_HOLD_MS,
  BANK_PAYOUT_ACCOUNT_LIMIT,
  runBankPayouts,
} from '../bank-payouts';

const DAY = 24 * 60 * 60 * 1000;
/** Thu 14 Jan 2027, 08:00 London (GMT). */
const RUN_AT = new Date('2027-01-14T08:00:00Z');
const RUN_DATE = '2027-01-14';

interface FakeAccount {
  available: number;
  pending?: number;
  /** Stripe's source-type breakdown; without it, `available` has none. */
  pots?: Record<string, { available: number; pending?: number }>;
  transfers?: Array<{
    id: string;
    amount: number;
    amount_reversed?: number;
    chargeCreated: Date | null;
    sourceType?: string;
  }>;
  balanceError?: unknown;
  payoutError?: unknown;
  /** A refusal for one pot only, by source type. */
  payoutErrors?: Record<string, unknown>;
  /** Every page says there is another: more transfers than the job reads. */
  endlessTransfers?: boolean;
  /** The id Stripe gives the payout (default `po_<acct>`). */
  payoutId?: string;
  /** Awaited before the balance is read: two runs can meet here. */
  beforeBalance?: () => Promise<void>;
}

function stripeError(type: string, statusCode: number, code?: string) {
  return Object.assign(new Error(`${type} ${code ?? ''}`), {
    type,
    statusCode,
    code,
    requestId: 'req_test',
  });
}

/** What the Stripe SDK throws once Cloudflare's subrequest budget is spent. */
function subrequestLimitError() {
  return Object.assign(
    new Error(
      'An error occurred with our connection to Stripe. Request was retried 1 times.'
    ),
    {
      type: 'StripeConnectionError',
      detail: new Error('Too many subrequests.'),
    }
  );
}

function fakeStripe(
  accounts: Map<string, FakeAccount>,
  options: { subrequestsSpent?: boolean } = {}
) {
  const balance = {
    retrieve: vi.fn(
      async (_params: unknown, request: { stripeAccount: string }) => {
        if (options.subrequestsSpent) throw subrequestLimitError();
        const account = accounts.get(request.stripeAccount);
        // Another file's account: an outage, so the job writes nothing to it.
        if (!account) throw stripeError('StripeAPIError', 500, 'api_error');
        await account.beforeBalance?.();
        if (account.balanceError) throw account.balanceError;
        const { pots } = account;
        if (pots) {
          const fund = (part: 'available' | 'pending') => {
            const byType = Object.fromEntries(
              Object.entries(pots).map(([type, pot]) => [type, pot[part] ?? 0])
            );
            const amount = Object.values(byType).reduce((a, b) => a + b, 0);
            return [{ amount, currency: 'gbp', source_types: byType }];
          };
          return { available: fund('available'), pending: fund('pending') };
        }
        return {
          available: [{ amount: account.available, currency: 'gbp' }],
          pending: [{ amount: account.pending ?? 0, currency: 'gbp' }],
        };
      }
    ),
  };
  let page = 0;
  const transfers = {
    list: vi.fn(async (params: { destination: string }) => {
      const account = accounts.get(params.destination);
      if (account?.endlessTransfers) {
        page++;
        return {
          data: [
            {
              id: `tr_page_${page}`,
              object: 'transfer',
              amount: 1,
              amount_reversed: 0,
              currency: 'gbp',
              created: Math.floor(RUN_AT.getTime() / 1000),
              source_transaction: null,
            },
          ],
          has_more: true,
        };
      }
      return {
        data: (account?.transfers ?? []).map((transfer) => ({
          id: transfer.id,
          object: 'transfer',
          amount: transfer.amount,
          amount_reversed: transfer.amount_reversed ?? 0,
          currency: 'gbp',
          source_type: transfer.sourceType,
          created: Math.floor(
            (transfer.chargeCreated ?? RUN_AT).getTime() / 1000
          ),
          source_transaction: transfer.chargeCreated
            ? {
                object: 'charge',
                created: Math.floor(transfer.chargeCreated.getTime() / 1000),
              }
            : null,
        })),
        has_more: false,
      };
    }),
  };
  const payouts = {
    create: vi.fn(
      async (
        params: { amount: number; source_type?: string },
        options: {
          stripeAccount: string;
          idempotencyKey?: string;
          timeout?: number;
        }
      ) => {
        const account = accounts.get(options.stripeAccount);
        const type = params.source_type ?? 'card';
        const error = account?.payoutErrors?.[type] ?? account?.payoutError;
        if (error) throw error;
        const id = account?.payoutId ?? `po_${options.stripeAccount}`;
        return {
          id: type === 'card' ? id : `${id}_${type}`,
          amount: params.amount,
        };
      }
    ),
  };
  return {
    stripe: { balance, transfers, payouts } as unknown as Stripe,
    balance,
    transfers,
    payouts,
  };
}

function makeObs() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('runBankPayouts', () => {
  let db: Database;
  const userIds: string[] = [];
  const accountIds: string[] = [];
  let counter = 0;

  /** A switched account; `current` gives it a stripe_connect_accounts row. */
  async function account(
    values: Partial<typeof connectBalances.$inferInsert> = {},
    current: { payoutsEnabled: boolean } | null = { payoutsEnabled: true }
  ): Promise<{ stripeAccountId: string; userId: string }> {
    const [userId] = await seedTestUsers(db, 1);
    if (!userId) throw new Error('no user');
    counter++;
    const stripeAccountId = `acct_bankjob${Date.now()}${counter}`;
    userIds.push(userId);
    accountIds.push(stripeAccountId);
    if (current) {
      await db.insert(stripeConnectAccounts).values({
        userId,
        stripeAccountId,
        status: current.payoutsEnabled ? 'active' : 'restricted',
        chargesEnabled: current.payoutsEnabled,
        payoutsEnabled: current.payoutsEnabled,
      });
    }
    await db.insert(connectBalances).values({
      stripeAccountId,
      userId,
      manualPayoutsSince: new Date(RUN_AT.getTime() - 60 * DAY),
      ...values,
    });
    return { stripeAccountId, userId };
  }

  async function balanceRow(stripeAccountId: string) {
    const [row] = await db
      .select()
      .from(connectBalances)
      .where(eq(connectBalances.stripeAccountId, stripeAccountId));
    if (!row) throw new Error('no balance row');
    return row;
  }

  beforeAll(() => {
    db = setupTestDatabase();
  });

  // Only this file's rows: the job and the money sweep read the whole table.
  afterAll(async () => {
    if (accountIds.length > 0) {
      await db
        .delete(connectBalances)
        .where(inArray(connectBalances.stripeAccountId, accountIds));
      await db
        .delete(stripeConnectAccounts)
        .where(inArray(stripeConnectAccounts.stripeAccountId, accountIds));
    }
    await teardownTestDatabase();
  });

  let accounts: Map<string, FakeAccount>;
  beforeEach(() => {
    accounts = new Map();
  });

  function deps(fake: ReturnType<typeof fakeStripe>) {
    const obs = makeObs();
    const invalidateBalance = vi.fn();
    return {
      obs,
      invalidateBalance,
      deps: {
        db,
        stripe: fake.stripe,
        obs,
        environment: 'test',
        invalidateBalance,
      },
    };
  }

  it('pays the old money under the day’s key, records it, and drops the Studio cache', async () => {
    const { stripeAccountId, userId } = await account({
      lastErrorCode: 'bank_account_unusable',
      failingSince: new Date(RUN_AT.getTime() - DAY),
    });
    accounts.set(stripeAccountId, {
      available: 12_000,
      pending: 3000,
      transfers: [
        {
          id: 'tr_d2',
          amount: 2000,
          chargeCreated: new Date(RUN_AT.getTime() - 2 * DAY),
        },
        {
          id: 'tr_d3',
          amount: 1000,
          chargeCreated: new Date(RUN_AT.getTime() - 3 * DAY),
        },
        {
          id: 'tr_d9',
          amount: 2500,
          amount_reversed: 500,
          chargeCreated: new Date(RUN_AT.getTime() - 9 * DAY),
        },
      ],
    });
    const fake = fakeStripe(accounts);
    const { deps: d, invalidateBalance } = deps(fake);

    const summary = await runBankPayouts(d, RUN_AT);

    expect(fake.transfers.list).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: stripeAccountId,
        created: { gte: Math.floor((RUN_AT.getTime() - BANK_HOLD_MS) / 1000) },
        expand: ['data.source_transaction'],
      }),
      expect.anything()
    );
    expect(fake.payouts.create).toHaveBeenCalledWith(
      {
        amount: 10_000,
        currency: 'gbp',
        source_type: 'card',
        metadata: {
          codex_env: 'test',
          type: 'bank_payout',
          run_date: RUN_DATE,
          source_type: 'card',
        },
      },
      expect.objectContaining({
        stripeAccount: stripeAccountId,
        idempotencyKey: `bank_payout_${stripeAccountId}_${RUN_DATE}_card`,
        timeout: 10_000,
      })
    );
    expect(
      fake.payouts.create.mock.calls.filter(
        ([, options]) => options.stripeAccount === stripeAccountId
      )
    ).toHaveLength(1);
    expect(summary.paid).toBe(1);
    expect(summary.paidCents).toBe(10_000);
    const row = await balanceRow(stripeAccountId);
    expect(row).toMatchObject({
      availableCents: 12_000,
      pendingCents: 3000,
      lastPayoutId: `po_${stripeAccountId}`,
      lastPayoutCents: 10_000,
      lastErrorCode: null,
      failingSince: null,
      negativeSince: null,
    });
    expect(row.checkedAt).not.toBeNull();
    expect(invalidateBalance).toHaveBeenCalledWith(userId);
  });

  it('balance_insufficient is skipped today, never retried in the run, and starts the streak', async () => {
    const { stripeAccountId } = await account();
    accounts.set(stripeAccountId, {
      available: 500,
      payoutError: stripeError(
        'StripeInvalidRequestError',
        400,
        'balance_insufficient'
      ),
    });
    const fake = fakeStripe(accounts);
    const { deps: d } = deps(fake);

    const summary = await runBankPayouts(d, RUN_AT);

    expect(summary.insufficient).toBe(1);
    expect(
      fake.payouts.create.mock.calls.filter(
        ([, options]) => options.stripeAccount === stripeAccountId
      )
    ).toHaveLength(1);
    const row = await balanceRow(stripeAccountId);
    expect(row.lastErrorCode).toBe('balance_insufficient');
    expect(row.failingSince).toEqual(RUN_AT);
  });

  it('an idempotency_error is today’s payout already made', async () => {
    const { stripeAccountId } = await account();
    accounts.set(stripeAccountId, {
      available: 500,
      payoutError: stripeError(
        'StripeIdempotencyError',
        400,
        'idempotency_error'
      ),
    });
    const { deps: d } = deps(fakeStripe(accounts));

    const summary = await runBankPayouts(d, RUN_AT);

    expect(summary.alreadyPaid).toBe(1);
    expect((await balanceRow(stripeAccountId)).failingSince).toBeNull();
  });

  it('a 5xx or a failed read is a warning for that account; the others are still paid', async () => {
    const outage = await account();
    const unreadable = await account();
    const healthy = await account();
    accounts.set(outage.stripeAccountId, {
      available: 700,
      payoutError: stripeError('StripeAPIError', 500, 'api_error'),
    });
    accounts.set(unreadable.stripeAccountId, {
      available: 900,
      balanceError: stripeError('StripeConnectionError', 0),
    });
    accounts.set(healthy.stripeAccountId, { available: 300 });
    const fake = fakeStripe(accounts);
    const { deps: d, obs } = deps(fake);

    const summary = await runBankPayouts(d, RUN_AT);

    expect(summary.paid).toBe(1);
    expect((await balanceRow(healthy.stripeAccountId)).lastPayoutCents).toBe(
      300
    );
    // Outcome unknown: nothing recorded as a refusal.
    expect((await balanceRow(outage.stripeAccountId)).lastErrorCode).toBeNull();
    expect((await balanceRow(unreadable.stripeAccountId)).checkedAt).toBeNull();
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('no answer from Stripe'),
      expect.objectContaining({ stripeAccountId: outage.stripeAccountId })
    );
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ stripeAccountId: unreadable.stripeAccountId })
    );
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('pays replaced accounts and skips an unswitched one', async () => {
    const replaced = await account({}, null);
    const unswitched = await account({ manualPayoutsSince: null });
    for (const { stripeAccountId } of [replaced, unswitched]) {
      accounts.set(stripeAccountId, { available: 400 });
    }
    const fake = fakeStripe(accounts);
    const { deps: d } = deps(fake);

    await runBankPayouts(d, RUN_AT);

    const asked = fake.balance.retrieve.mock.calls.map(
      ([, options]) => options.stripeAccount
    );
    expect(asked).toContain(replaced.stripeAccountId);
    expect(asked).not.toContain(unswitched.stripeAccountId);
    expect((await balanceRow(replaced.stripeAccountId)).lastPayoutCents).toBe(
      400
    );
  });

  // Review MED-3: a creator whose requirements fell past due can still be
  // charged back. The balance is read and its episode recorded; only the
  // payout waits for Stripe to turn payouts back on.
  it('a current account with payouts off is read and recorded, never paid', async () => {
    const paused = await account({}, { payoutsEnabled: false });
    const pausedNegative = await account({}, { payoutsEnabled: false });
    accounts.set(paused.stripeAccountId, { available: 400 });
    accounts.set(pausedNegative.stripeAccountId, { available: -8000 });
    const fake = fakeStripe(accounts);
    const { deps: d } = deps(fake);

    const summary = await runBankPayouts(d, RUN_AT);

    expect(await balanceRow(paused.stripeAccountId)).toMatchObject({
      availableCents: 400,
      checkedAt: RUN_AT,
      lastPayoutId: null,
    });
    expect(
      (await balanceRow(pausedNegative.stripeAccountId)).negativeSince
    ).toEqual(RUN_AT);
    expect(
      fake.payouts.create.mock.calls.filter(([, options]) =>
        [paused.stripeAccountId, pausedNegative.stripeAccountId].includes(
          options.stripeAccount
        )
      )
    ).toHaveLength(0);
    expect(summary.payoutsOff).toBe(1);
    expect(summary.negative).toBe(1);
  });

  // Review MED-4: an over-cap account would be skipped every morning.
  it('more transfers than the job reads is an error alert, and nothing is paid', async () => {
    const busy = await account();
    accounts.set(busy.stripeAccountId, {
      available: 50_000,
      endlessTransfers: true,
    });
    const fake = fakeStripe(accounts);
    const { deps: d, obs } = deps(fake);

    await runBankPayouts(d, RUN_AT);

    // The cap is 10,000 transfers: 100 pages of 100, well above 2,000.
    expect(fake.transfers.list).toHaveBeenCalledTimes(100);
    expect(fake.transfers.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
      expect.anything()
    );
    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('too_many_transfers'),
      expect.objectContaining({
        errorId: expect.any(String),
        stripeAccountId: busy.stripeAccountId,
      })
    );
    expect(fake.payouts.create).not.toHaveBeenCalled();
  });

  // Review LOW-2: the money moved, so it is paid, and the alert names it.
  it('a payout whose record fails is still counted as paid, and the alert names the payout', async () => {
    const { stripeAccountId } = await account();
    // Longer than last_payout_id's 255 characters: the write after it fails.
    const payoutId = `po_${'x'.repeat(300)}`;
    accounts.set(stripeAccountId, { available: 700, payoutId });
    const { deps: d, obs } = deps(fakeStripe(accounts));

    const summary = await runBankPayouts(d, RUN_AT);

    expect(summary.paid).toBe(1);
    expect(summary.paidCents).toBe(700);
    expect(obs.error).toHaveBeenCalledWith(
      'bank_payout.paid_but_not_recorded',
      expect.objectContaining({
        errorId: expect.any(String),
        stripeAccountId,
        payoutId,
        amountCents: 700,
      })
    );
  });

  describe('the snapshot and its episodes (§4.1)', () => {
    it('the first negative check starts an episode after the last check, pays nothing and sends nothing', async () => {
      const lastCheck = new Date(RUN_AT.getTime() - DAY);
      const { stripeAccountId, userId } = await account({
        checkedAt: lastCheck,
        availableCents: 1200,
      });
      accounts.set(stripeAccountId, { available: -840, pending: 600 });
      const fake = fakeStripe(accounts);
      const { deps: d, invalidateBalance } = deps(fake);

      const summary = await runBankPayouts(d, RUN_AT);

      expect(summary.negative).toBe(1);
      const row = await balanceRow(stripeAccountId);
      expect(row.availableCents).toBe(-840);
      expect(row.pendingCents).toBe(600);
      expect(row.negativeAfter).toEqual(lastCheck);
      expect(row.negativeSince?.getTime()).toBeGreaterThan(lastCheck.getTime());
      expect(fake.transfers.list).not.toHaveBeenCalledWith(
        expect.objectContaining({ destination: stripeAccountId }),
        expect.anything()
      );
      expect(invalidateBalance).toHaveBeenCalledWith(userId);
    });

    it('clearing records "recovered" under 180 days and "stripe_collected" from 180, with what was last owed', async () => {
      const recent = await account({
        negativeSince: new Date(RUN_AT.getTime() - 10 * DAY),
        negativeAfter: new Date(RUN_AT.getTime() - 11 * DAY),
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -840,
      });
      const old = await account({
        negativeSince: new Date(RUN_AT.getTime() - 200 * DAY),
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -1440,
        // An earlier episode's figure, replaced by this one's.
        clearedOwedCents: 99,
      });
      accounts.set(recent.stripeAccountId, { available: 0 });
      accounts.set(old.stripeAccountId, { available: 0, pending: 300 });
      const { deps: d } = deps(fakeStripe(accounts));

      await runBankPayouts(d, RUN_AT);

      expect(await balanceRow(recent.stripeAccountId)).toMatchObject({
        negativeSince: null,
        negativeAfter: null,
        clearedReason: 'recovered',
        clearedOwedCents: 840,
      });
      expect(await balanceRow(old.stripeAccountId)).toMatchObject({
        negativeSince: null,
        clearedSince: new Date(RUN_AT.getTime() - 200 * DAY),
        clearedReason: 'stripe_collected',
        clearedOwedCents: 1440,
        // Available + pending at the clearing reading (amendment 3).
        clearedBalanceCents: 300,
      });
      expect((await balanceRow(old.stripeAccountId)).clearedAt).not.toBeNull();
    });

    // Amendment 2 (§14): over £50, what Stripe collected is support's to
    // invoice (P6); £50 or less Stripe simply wrote off.
    it('a debt over £50 Stripe collected is kept for support, with an error alert; £50 or less is not', async () => {
      const longAgo = new Date(RUN_AT.getTime() - 200 * DAY);
      const over = await account({
        negativeSince: longAgo,
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -5001,
      });
      const atMost = await account({
        negativeSince: longAgo,
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -5000,
      });
      accounts.set(over.stripeAccountId, { available: 0 });
      accounts.set(atMost.stripeAccountId, { available: 0 });
      const { deps: d, obs } = deps(fakeStripe(accounts));

      await runBankPayouts(d, RUN_AT);

      expect(await balanceRow(over.stripeAccountId)).toMatchObject({
        clearedReason: 'stripe_collected',
        clearedOwedCents: 5001,
        collectedOwedCents: 5001,
        collectedAt: RUN_AT,
      });
      expect(await balanceRow(atMost.stripeAccountId)).toMatchObject({
        clearedReason: 'stripe_collected',
        clearedOwedCents: 5000,
        collectedOwedCents: null,
        collectedAt: null,
      });
      const mine = [over.stripeAccountId, atMost.stripeAccountId];
      expect(
        obs.error.mock.calls
          .filter(([, meta]) => mine.includes(meta?.stripeAccountId))
          .map(([message, meta]) => [String(message).split(':')[0], meta])
      ).toEqual([
        [
          'bank_payout.debt_collected',
          {
            errorId: expect.any(String),
            stripeAccountId: over.stripeAccountId,
            collectedCents: 5001,
            runDate: RUN_DATE,
          },
        ],
      ]);
    });

    it('a later episode leaves a collected debt alone; a second collection adds to it, keeping the first date', async () => {
      const firstAt = new Date(RUN_AT.getTime() - 30 * DAY);
      const collected = { collectedOwedCents: 8400, collectedAt: firstAt };
      const again = await account({
        ...collected,
        availableCents: 100,
        checkedAt: new Date(RUN_AT.getTime() - DAY),
      });
      const twice = await account({
        ...collected,
        negativeSince: new Date(RUN_AT.getTime() - 200 * DAY),
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -6000,
      });

      // `again` goes below zero: a new episode starts.
      accounts.set(again.stripeAccountId, { available: -6000 });
      accounts.set(twice.stripeAccountId, { available: 0 });
      await runBankPayouts(deps(fakeStripe(accounts)).deps, RUN_AT);
      expect(await balanceRow(again.stripeAccountId)).toMatchObject({
        negativeSince: RUN_AT,
        ...collected,
      });
      expect(await balanceRow(twice.stripeAccountId)).toMatchObject({
        clearedReason: 'stripe_collected',
        collectedOwedCents: 14_400,
        collectedAt: firstAt,
      });

      // The next morning it is back above zero: recovered, nothing collected.
      accounts.set(again.stripeAccountId, { available: 0 });
      await runBankPayouts(
        deps(fakeStripe(accounts)).deps,
        new Date(RUN_AT.getTime() + DAY)
      );
      expect(await balanceRow(again.stripeAccountId)).toMatchObject({
        negativeSince: null,
        clearedReason: 'recovered',
        clearedOwedCents: 6000,
        ...collected,
      });
    });

    it('a write that clears nothing leaves the last episode’s owed figure', async () => {
      const cleared = {
        clearedSince: new Date(RUN_AT.getTime() - 40 * DAY),
        clearedAt: new Date(RUN_AT.getTime() - 30 * DAY),
        clearedReason: 'recovered',
        clearedOwedCents: 1234,
      };
      const quiet = await account({
        ...cleared,
        availableCents: 500,
        checkedAt: new Date(RUN_AT.getTime() - DAY),
      });
      const negativeAgain = await account({
        ...cleared,
        availableCents: 500,
        checkedAt: new Date(RUN_AT.getTime() - DAY),
      });
      accounts.set(quiet.stripeAccountId, { available: 0, pending: 700 });
      accounts.set(negativeAgain.stripeAccountId, { available: -300 });
      const { deps: d } = deps(fakeStripe(accounts));

      await runBankPayouts(d, RUN_AT);

      expect(await balanceRow(quiet.stripeAccountId)).toMatchObject({
        availableCents: 0,
        clearedOwedCents: 1234,
      });
      const started = await balanceRow(negativeAgain.stripeAccountId);
      expect(started.negativeSince).not.toBeNull();
      expect(started.clearedOwedCents).toBe(1234);
    });
  });

  it('three days of refusals raise ONE alert for support', async () => {
    const failingSince = new Date(RUN_AT.getTime() - 3 * DAY - 60 * 60 * 1000);
    const { stripeAccountId } = await account({
      failingSince,
      lastErrorCode: 'no_external_account',
      checkedAt: new Date(RUN_AT.getTime() - DAY),
    });
    accounts.set(stripeAccountId, {
      available: 900,
      payoutError: stripeError(
        'StripeInvalidRequestError',
        400,
        'no_external_account'
      ),
    });
    const first = deps(fakeStripe(accounts));
    await runBankPayouts(first.deps, RUN_AT);
    const alerts = (obs: ReturnType<typeof makeObs>) =>
      obs.error.mock.calls.filter(
        ([, meta]) => meta?.stripeAccountId === stripeAccountId
      );
    expect(alerts(first.obs)).toHaveLength(1);
    expect(alerts(first.obs)[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      failingSince: failingSince.toISOString(),
      code: 'no_external_account',
    });
    expect(await balanceRow(stripeAccountId)).toMatchObject({
      failingSince,
      lastErrorCode: 'no_external_account',
    });

    // The next morning: still refused, already alerted.
    const second = deps(fakeStripe(accounts));
    await runBankPayouts(second.deps, new Date(RUN_AT.getTime() + DAY));
    expect(alerts(second.obs)).toHaveLength(0);
  });

  it('a first refusal starts failing_since and raises no alert', async () => {
    const { stripeAccountId } = await account();
    accounts.set(stripeAccountId, {
      available: 900,
      payoutError: stripeError(
        'StripeInvalidRequestError',
        400,
        'payouts_not_allowed'
      ),
    });
    const { deps: d, obs } = deps(fakeStripe(accounts));

    await runBankPayouts(d, RUN_AT);

    const row = await balanceRow(stripeAccountId);
    expect(row.lastErrorCode).toBe('payouts_not_allowed');
    expect(row.failingSince).not.toBeNull();
    expect(obs.error).not.toHaveBeenCalled();
  });

  const refusalAlerts = (
    obs: ReturnType<typeof makeObs>,
    stripeAccountId: string
  ) =>
    obs.error.mock.calls.filter(
      ([message, meta]) =>
        String(message).includes('refused this account') &&
        meta?.stripeAccountId === stripeAccountId
    );

  // Review LOW-3: Fri 26 Mar 2027 is GMT, Mon 29 Mar BST. Day 3's run is
  // 71 hours after the first refusal.
  it('the 3-day mark counts London days, across the spring clock change', async () => {
    const failingSince = new Date('2027-03-26T08:00:00Z');
    const { stripeAccountId } = await account({
      failingSince,
      lastErrorCode: 'no_external_account',
      checkedAt: new Date('2027-03-28T07:00:00Z'),
    });
    accounts.set(stripeAccountId, {
      available: 900,
      payoutError: stripeError(
        'StripeInvalidRequestError',
        400,
        'no_external_account'
      ),
    });
    const { deps: d, obs } = deps(fakeStripe(accounts));

    await runBankPayouts(d, new Date('2027-03-29T07:00:00Z'));

    expect(refusalAlerts(obs, stripeAccountId)).toHaveLength(1);
  });

  // Review LOW-4: a refusal, weeks below zero, then refusals again.
  it('a run with nothing to ask for ends the streak, so new refusals can alert again', async () => {
    const { stripeAccountId } = await account({
      failingSince: new Date(RUN_AT.getTime() - 30 * DAY),
      lastErrorCode: 'no_external_account',
      checkedAt: new Date(RUN_AT.getTime() - DAY),
    });
    const refused = stripeError(
      'StripeInvalidRequestError',
      400,
      'no_external_account'
    );
    accounts.set(stripeAccountId, { available: -300 });
    await runBankPayouts(deps(fakeStripe(accounts)).deps, RUN_AT);
    expect(await balanceRow(stripeAccountId)).toMatchObject({
      failingSince: null,
      lastErrorCode: null,
    });

    accounts.set(stripeAccountId, { available: 900, payoutError: refused });
    const dayOne = new Date(RUN_AT.getTime() + DAY);
    const first = deps(fakeStripe(accounts));
    await runBankPayouts(first.deps, dayOne);
    expect((await balanceRow(stripeAccountId)).failingSince).toEqual(dayOne);
    expect(refusalAlerts(first.obs, stripeAccountId)).toHaveLength(0);

    const third = deps(fakeStripe(accounts));
    await runBankPayouts(third.deps, new Date(dayOne.getTime() + 3 * DAY));
    expect(refusalAlerts(third.obs, stripeAccountId)).toHaveLength(1);
  });

  // HIGH-1, owner: "Pay each pot separately".
  describe('each pot separately', () => {
    const insufficient = () =>
      stripeError('StripeInvalidRequestError', 400, 'balance_insufficient');

    it('two pots are paid separately, each under its own key, and a young transfer holds only its own pot', async () => {
      const { stripeAccountId } = await account();
      accounts.set(stripeAccountId, {
        available: 0,
        pots: { card: { available: 5000 }, bank_account: { available: 800 } },
        transfers: [
          {
            id: 'tr_ach_young',
            amount: 300,
            chargeCreated: new Date(RUN_AT.getTime() - 3 * DAY),
            sourceType: 'bank_account',
          },
        ],
      });
      const fake = fakeStripe(accounts);
      const { deps: d } = deps(fake);

      const summary = await runBankPayouts(d, RUN_AT);

      const calls = fake.payouts.create.mock.calls.filter(
        ([, options]) => options.stripeAccount === stripeAccountId
      );
      expect(
        calls.map(([params, options]) => ({
          sourceType: params.source_type,
          amount: params.amount,
          key: options.idempotencyKey,
          timeout: options.timeout,
        }))
      ).toEqual([
        {
          sourceType: 'card',
          amount: 5000,
          key: `bank_payout_${stripeAccountId}_${RUN_DATE}_card`,
          timeout: 10_000,
        },
        {
          sourceType: 'bank_account',
          amount: 500,
          key: `bank_payout_${stripeAccountId}_${RUN_DATE}_bank_account`,
          timeout: 10_000,
        },
      ]);
      expect(summary.paid).toBe(2);
      expect(summary.paidCents).toBe(5500);
      expect(await balanceRow(stripeAccountId)).toMatchObject({
        availableCents: 5800,
        lastPayoutId: `po_${stripeAccountId}_bank_account`,
        lastPayoutCents: 500,
      });
    });

    it('balance_insufficient three London days running raises ONE alert, naming the pot', async () => {
      const { stripeAccountId } = await account();
      accounts.set(stripeAccountId, {
        available: 900,
        payoutError: insufficient(),
      });
      const perDay: number[] = [];
      let alert: unknown;
      for (let day = 0; day <= 4; day++) {
        const fake = fakeStripe(accounts);
        const { deps: d, obs } = deps(fake);
        await runBankPayouts(d, new Date(RUN_AT.getTime() + day * DAY));
        expect(
          fake.payouts.create.mock.calls.filter(
            ([, options]) => options.stripeAccount === stripeAccountId
          )
        ).toHaveLength(1);
        const alerts = refusalAlerts(obs, stripeAccountId);
        perDay.push(alerts.length);
        alert ??= alerts[0]?.[1];
      }
      expect(perDay).toEqual([0, 0, 0, 1, 0]);
      expect(alert).toMatchObject({
        errorId: expect.any(String),
        stripeAccountId,
        sourceType: 'card',
        code: 'balance_insufficient',
        failingSince: RUN_AT.toISOString(),
      });
    });

    it('a pot Stripe has too little for starts the streak although the other pot was paid', async () => {
      const { stripeAccountId } = await account();
      accounts.set(stripeAccountId, {
        available: 0,
        pots: { card: { available: 5000 }, bank_account: { available: 800 } },
        payoutErrors: { bank_account: insufficient() },
      });
      const { deps: d } = deps(fakeStripe(accounts));

      const summary = await runBankPayouts(d, RUN_AT);

      expect(summary.paid).toBe(1);
      expect(summary.insufficient).toBe(1);
      expect(await balanceRow(stripeAccountId)).toMatchObject({
        lastPayoutId: `po_${stripeAccountId}`,
        lastPayoutCents: 5000,
        lastErrorCode: 'balance_insufficient',
        failingSince: RUN_AT,
      });
    });

    // Review r2 LOW-4: the gate reads the total, as the episode does.
    it('a pot above zero is not paid while the account’s total is below zero', async () => {
      const { stripeAccountId } = await account();
      accounts.set(stripeAccountId, {
        available: 0,
        pots: { card: { available: -1000 }, bank_account: { available: 800 } },
      });
      const fake = fakeStripe(accounts);
      const { deps: d } = deps(fake);

      await runBankPayouts(d, RUN_AT);

      expect(
        fake.payouts.create.mock.calls.filter(
          ([, options]) => options.stripeAccount === stripeAccountId
        )
      ).toHaveLength(0);
      expect(await balanceRow(stripeAccountId)).toMatchObject({
        availableCents: -200,
        negativeSince: RUN_AT,
      });
    });

    // Review r2 LOW-4: the refusal's write is inside the payout record's guard.
    it('a refusal whose write fails after another pot was paid is still a paid run, naming the payouts', async () => {
      const { stripeAccountId } = await account();
      accounts.set(stripeAccountId, {
        available: 0,
        pots: { card: { available: 5000 }, bank_account: { available: 800 } },
        payoutErrors: { bank_account: insufficient() },
      });
      const { deps: d, obs } = deps(fakeStripe(accounts));
      // Only the refusal's write fails; every other query goes through.
      const failing = new Proxy(db, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          if (prop !== 'update') {
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (table: Parameters<typeof db.update>[0]) => {
            const builder = target.update(table);
            const set = builder.set.bind(builder);
            return Object.assign(builder, {
              set: (values: Record<string, unknown>) => {
                if (values.lastErrorCode === 'balance_insufficient') {
                  throw new Error('the refusal write failed');
                }
                return set(values as never);
              },
            });
          };
        },
      });

      const summary = await runBankPayouts({ ...d, db: failing }, RUN_AT);

      expect(summary.paid).toBe(1);
      expect(summary.paidCents).toBe(5000);
      const errors = obs.error.mock.calls.filter(
        ([, meta]) => meta?.stripeAccountId === stripeAccountId
      );
      expect(errors.map(([message]) => message)).toEqual([
        'bank_payout.paid_but_not_recorded',
      ]);
      expect(errors[0]?.[1]).toMatchObject({
        errorId: expect.any(String),
        payoutIds: [`po_${stripeAccountId}`],
      });
    });
  });

  // Review r2 LOW-2: past the budget's account limit, support hears of it.
  it('reaching the account limit is an error alert with the flagged count', async () => {
    await account();
    await account();
    const { deps: d, obs } = deps(fakeStripe(accounts));

    const summary = await runBankPayouts({ ...d, accountLimit: 1 }, RUN_AT);

    expect(summary.accounts).toBe(1);
    const alert = obs.error.mock.calls.find(([message]) =>
      String(message).startsWith('bank_payout.account_limit')
    );
    expect(alert?.[1]).toMatchObject({
      errorId: expect.any(String),
      limit: 1,
      flaggedAccounts: expect.any(Number),
    });
    expect(alert?.[1]?.flaggedAccounts).toBeGreaterThanOrEqual(2);
    // The real limit fits the 10,000-subrequest invocation: about 6 per
    // account, with 4,000 left for the wake's other sweeps.
    expect(BANK_PAYOUT_ACCOUNT_LIMIT * 6 + 4000).toBeLessThanOrEqual(10_000);
  });

  // Review r3 LOW-1: a collected debt is added, and support told, once.
  describe('a collected debt, run twice', () => {
    const collectedAlerts = (
      obs: ReturnType<typeof makeObs>,
      stripeAccountId: string
    ) =>
      obs.error.mock.calls.filter(
        ([message, meta]) =>
          String(message).startsWith('bank_payout.debt_collected') &&
          meta?.stripeAccountId === stripeAccountId
      );
    const owing = () =>
      account({
        negativeSince: new Date(RUN_AT.getTime() - 200 * DAY),
        checkedAt: new Date(RUN_AT.getTime() - DAY),
        availableCents: -6000,
      });

    it('a same-day re-run adds nothing and tells support nothing more', async () => {
      const { stripeAccountId } = await owing();
      accounts.set(stripeAccountId, { available: 0 });
      const first = deps(fakeStripe(accounts));
      const second = deps(fakeStripe(accounts));

      await runBankPayouts(first.deps, RUN_AT);
      await runBankPayouts(second.deps, RUN_AT);

      expect(collectedAlerts(first.obs, stripeAccountId)).toHaveLength(1);
      expect(collectedAlerts(second.obs, stripeAccountId)).toHaveLength(0);
      expect((await balanceRow(stripeAccountId)).collectedOwedCents).toBe(6000);
    });

    it('two runs at once: the losing write adds nothing and tells support nothing', async () => {
      const { stripeAccountId } = await owing();
      // Both runs have read the account before either writes.
      let arrived = 0;
      let release = () => {};
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      accounts.set(stripeAccountId, {
        available: 0,
        beforeBalance: async () => {
          arrived++;
          if (arrived === 2) release();
          await bothRead;
        },
      });
      const a = deps(fakeStripe(accounts));
      const b = deps(fakeStripe(accounts));

      await Promise.all([
        runBankPayouts(a.deps, RUN_AT),
        runBankPayouts(b.deps, RUN_AT),
      ]);

      expect(arrived).toBe(2);
      expect(
        collectedAlerts(a.obs, stripeAccountId).length +
          collectedAlerts(b.obs, stripeAccountId).length
      ).toBe(1);
      expect((await balanceRow(stripeAccountId)).collectedOwedCents).toBe(6000);
    });
  });

  // Review r3 LOW-2: once the invocation's budget is spent, stop and say so once.
  it('running out of Cloudflare subrequests stops the run with ONE error', async () => {
    for (let i = 0; i < 6; i++) await account();
    const fake = fakeStripe(accounts, { subrequestsSpent: true });
    const { deps: d, obs } = deps(fake);

    const summary = await runBankPayouts(d, RUN_AT);

    // The four workers each meet it once, then stop.
    expect(fake.balance.retrieve.mock.calls.length).toBeLessThanOrEqual(4);
    const limitErrors = obs.error.mock.calls.filter(([message]) =>
      String(message).startsWith('bank_payout.subrequest_limit')
    );
    expect(limitErrors).toHaveLength(1);
    expect(limitErrors[0]?.[1]).toEqual({
      errorId: expect.any(String),
      runDate: RUN_DATE,
      accountsDone: 0,
      accountsLeft: summary.accounts,
    });
    expect(summary.accountsLeft).toBe(summary.accounts);
    expect(
      obs.warn.mock.calls.filter(([message]) =>
        String(message).includes('balance read failed')
      )
    ).toHaveLength(0);
  });

  // Review r3 LOW-3: a read that fails every day can't head the queue.
  describe('a balance read that keeps failing', () => {
    const accessLost = () =>
      stripeError('StripePermissionError', 403, 'account_invalid');

    it('goes after a healthy account, though it was never checked', async () => {
      const failing = await account({
        failingSince: new Date(RUN_AT.getTime() - 2 * DAY),
        lastErrorCode: 'account_invalid',
      });
      const healthy = await account({
        checkedAt: new Date(RUN_AT.getTime() - 400 * DAY),
      });
      accounts.set(failing.stripeAccountId, {
        available: 0,
        balanceError: accessLost(),
      });
      accounts.set(healthy.stripeAccountId, { available: 0 });
      const fake = fakeStripe(accounts);

      await runBankPayouts(deps(fake).deps, RUN_AT);

      const order = fake.balance.retrieve.mock.calls.map(
        ([, request]) => request.stripeAccount
      );
      expect(order.indexOf(healthy.stripeAccountId)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(healthy.stripeAccountId)).toBeLessThan(
        order.indexOf(failing.stripeAccountId)
      );
    });

    it('counts into the 3-London-day alert, once; an outage does not', async () => {
      const lost = await account();
      const outage = await account();
      accounts.set(lost.stripeAccountId, {
        available: 0,
        balanceError: accessLost(),
      });
      accounts.set(outage.stripeAccountId, {
        available: 0,
        balanceError: stripeError('StripeAPIError', 500, 'api_error'),
      });
      const perDay: number[] = [];
      for (let day = 0; day <= 4; day++) {
        const { deps: d, obs } = deps(fakeStripe(accounts));
        await runBankPayouts(d, new Date(RUN_AT.getTime() + day * DAY));
        perDay.push(refusalAlerts(obs, lost.stripeAccountId).length);
      }

      expect(perDay).toEqual([0, 0, 0, 1, 0]);
      expect(await balanceRow(lost.stripeAccountId)).toMatchObject({
        lastErrorCode: 'account_invalid',
        failingSince: RUN_AT,
        checkedAt: null,
      });
      expect(await balanceRow(outage.stripeAccountId)).toMatchObject({
        lastErrorCode: null,
        failingSince: null,
      });
    });
  });
});
