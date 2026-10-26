/**
 * A platform-side payout failure is one error per drain run, not one per row
 * (Codex-r094t).
 *
 * A short platform balance (`balance_insufficient`), a bad key or a missing
 * Connect setup fails every owed row on every drain. Those rows are retried
 * without using an attempt and never flagged (owner decision 2026-10-23), so
 * each drain used to log every one of them at error: 200 owed rows made 200
 * error lines an hour. The rules under test:
 *   - the run's FIRST platform failure logs its ONE error, with the run's
 *     errorId, the code and the message, before the run goes on: a run the
 *     runtime cuts short (a CPU limit, an eviction, a deploy) still alerts;
 *   - each row's failure is a warning carrying the run's errorId;
 *   - the end of the run is a summary at warn, under that errorId, with the
 *     count, the total pence, the codes and the first row's message;
 *   - the hourly sweep passes one tally through all its payees: one error
 *     and one summary for the sweep, not one per payee.
 *
 * Real DB, mocked Stripe. Every row hangs off this file's own users and
 * organisations and is deleted in afterAll (the local database is shared).
 */

import {
  organizations,
  payouts,
  stripeConnectAccounts,
} from '@codex/database/schema';
import type { FeeConfigService } from '@codex/purchase';
import {
  createMockStripe,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
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
import { SubscriptionService } from '../subscription-service';

const RUN_ERROR = 'failing on the platform side';
const RUN_SUMMARY = 'failed on the platform side this run';
const ROW_WARNING = 'under the one error of its run';
const STRIPE_MESSAGE = 'Insufficient funds in your Stripe balance';

/** Stripe refusing a transfer because the platform's balance is short. */
const balanceInsufficient = () =>
  Object.assign(new Error(STRIPE_MESSAGE), {
    type: 'StripeInvalidRequestError',
    statusCode: 400,
    code: 'balance_insufficient',
  });

type Logged = [string, Record<string, unknown>];

describe('platform-side payout failures, one error per drain run (Codex-r094t)', () => {
  let db: Database;
  let stripe: Stripe;
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const accounts = new Map<string, string>();

  beforeAll(async () => {
    db = setupTestDatabase();
    const seeded = await seedTestUsers(db, 4);
    userIds.push(...seeded);
    for (const userId of seeded) {
      const stripeAccountId = `acct_platfail_${crypto.randomUUID().slice(0, 12)}`;
      accounts.set(userId, stripeAccountId);
      await db.insert(stripeConnectAccounts).values({
        userId,
        stripeAccountId,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
    }
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  afterAll(async () => {
    await db.delete(payouts).where(inArray(payouts.userId, userIds));
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, userIds));
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  const payee = (index: number): string => {
    const userId = userIds[index];
    if (!userId) throw new Error(`no seeded payee ${index}`);
    return userId;
  };
  const accountOf = (userId: string): string => {
    const account = accounts.get(userId);
    if (!account) throw new Error('payee has no Connect account');
    return account;
  };

  async function newOrg(label: string): Promise<string> {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(label) }))
        .returning(),
      'organization'
    );
    orgIds.push(org.id);
    return org.id;
  }

  /** A pending creator slice owed to `userId`, waiting for their account. */
  async function owed(
    userId: string,
    organizationId: string | null,
    amountCents: number,
    sourceType: 'subscription' | 'purchase' = 'subscription'
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          userId,
          organizationId,
          sourceType,
          amountCents,
          currency: 'gbp',
          payoutType: 'creator_payout',
          status: 'pending',
          reason: 'connect_not_ready',
          stripeChargeId: `ch_platfail_${crypto.randomUUID().slice(0, 12)}`,
        })
        .returning(),
      'payout'
    );
    return row.id;
  }

  /** A service at no fees and no minimum transfer, with its logs spied on. */
  function serviceWithLogs() {
    const noFees = async () => ({
      platformFeePercent: 0,
      orgFeePercent: 0,
      minPlatformFeeCents: 0,
      minTransferCents: 0,
    });
    const feeConfig = {
      getFeesForCreator: vi.fn(noFees),
      getFeesPlatform: vi.fn(noFees),
      getFeesForOrg: vi.fn(noFees),
    } as unknown as FeeConfigService;
    const service = new SubscriptionService(
      { db, environment: 'test', payoutMailer: vi.fn(), feeConfig },
      stripe
    );
    const { obs } = service as unknown as {
      obs: { error: () => void; warn: () => void };
    };
    const alerted = vi.spyOn(obs, 'error');
    const warned = vi.spyOn(obs, 'warn');
    const calls = (spy: typeof alerted, text: string) =>
      (spy.mock.calls as unknown as Logged[]).filter(([message]) =>
        message.includes(text)
      );
    return {
      service,
      alerted,
      runErrors: () => calls(alerted, RUN_ERROR),
      runSummaries: () => calls(warned, RUN_SUMMARY),
      rowWarnings: () => calls(warned, ROW_WARNING),
    };
  }

  it('a payee-wide drain whose every transfer fails on the platform side: ONE error at the first failure, a warning per row, a summary at the end', async () => {
    const userId = payee(0);
    const orgA = await newOrg('platfail-a');
    const ids = [
      await owed(userId, orgA, 500),
      await owed(userId, orgA, 300, 'purchase'),
      await owed(userId, null, 200),
    ];
    const { service, alerted, runErrors, runSummaries, rowWarnings } =
      serviceWithLogs();
    // How many errors were already logged as each transfer was attempted.
    const errorsBeforeEachTransfer: number[] = [];
    vi.mocked(stripe.transfers.create).mockImplementation(() => {
      errorsBeforeEachTransfer.push(alerted.mock.calls.length);
      return Promise.reject(balanceInsufficient());
    });

    const result = await service.resolvePendingPayoutsForAccount(
      accountOf(userId)
    );

    // Three groups, one row each, every transfer refused.
    expect(result).toEqual({ resolved: 0, failed: 3 });
    // The error came at the first failure, before the run went on.
    expect(errorsBeforeEachTransfer).toEqual([0, 1, 1]);
    expect(alerted).toHaveBeenCalledOnce();
    expect(runErrors()).toHaveLength(1);
    const [, run] = runErrors()[0] ?? [];
    expect(run).toMatchObject({
      errorId: expect.any(String),
      code: 'balance_insufficient',
      error: STRIPE_MESSAGE,
    });
    // The end of the run: one summary, at warn, under the same errorId.
    expect(runSummaries()).toHaveLength(1);
    const [, summary] = runSummaries()[0] ?? [];
    expect(summary).toMatchObject({
      errorId: run?.errorId,
      count: 3,
      totalCents: 1000,
      codes: ['balance_insufficient'],
      error: STRIPE_MESSAGE,
      stripeAccountId: accountOf(userId),
      payeeWide: true,
    });
    // Each row is a warning, and its errorId leads to the run's one error.
    expect(rowWarnings()).toHaveLength(3);
    for (const [, fields] of rowWarnings()) {
      expect(fields).toMatchObject({
        errorId: run?.errorId,
        code: 'balance_insufficient',
      });
    }
    // Retried without using an attempt, and never flagged for support.
    const rows = await db
      .select()
      .from(payouts)
      .where(inArray(payouts.id, ids));
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'failed',
        failureCount: 0,
        needsReviewAt: null,
        lastErrorCode: 'balance_insufficient',
      });
    }
  });

  // The runtime can end an invocation mid-run (the cron's CPU limit, an
  // eviction, a deploy): before, the one error came only after the loop, so
  // such a run left warnings and no error.
  it('a run that never finishes has already raised its one error', async () => {
    const userId = payee(3);
    await owed(userId, null, 400);
    await owed(userId, null, 600);
    const { service, alerted, runErrors, runSummaries } = serviceWithLogs();
    let transfers = 0;
    vi.mocked(stripe.transfers.create).mockImplementation(() => {
      transfers++;
      // The second transfer never answers: the run is cut short there.
      return transfers === 1
        ? Promise.reject(balanceInsufficient())
        : new Promise(() => {});
    });

    void service.resolvePendingPayoutsForAccount(accountOf(userId));
    await vi.waitFor(() => expect(transfers).toBe(2), { timeout: 10_000 });

    expect(alerted).toHaveBeenCalledOnce();
    expect(runErrors()).toHaveLength(1);
    expect(runErrors()[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      code: 'balance_insufficient',
      error: STRIPE_MESSAGE,
    });
    // The summary is the end of the run, which never came.
    expect(runSummaries()).toHaveLength(0);
  });

  it('a drain with no platform-side failure reports none', async () => {
    const userId = payee(1);
    await owed(userId, null, 400);
    const { service, alerted, runErrors, runSummaries } = serviceWithLogs();

    const result = await service.resolvePendingPayoutsForAccount(
      accountOf(userId)
    );

    expect(result).toEqual({ resolved: 1, failed: 0 });
    expect(runErrors()).toHaveLength(0);
    expect(runSummaries()).toHaveLength(0);
    expect(alerted).not.toHaveBeenCalled();
  });

  it('the hourly sweep raises ONE error for all its payees, and one summary, not one per payee', async () => {
    const first = payee(1);
    const second = payee(2);
    await db.delete(payouts).where(inArray(payouts.userId, [first, second]));
    await owed(first, null, 400);
    await owed(second, null, 600);
    vi.mocked(stripe.transfers.create).mockRejectedValue(balanceInsufficient());
    // Both accounts payable now (the mock has no accounts.retrieve).
    const accountsApi = (stripe as unknown as { accounts: object }).accounts;
    Object.assign(accountsApi, {
      retrieve: vi.fn(async (id: string) => ({
        id,
        charges_enabled: true,
        payouts_enabled: true,
      })),
    });
    const { service, alerted, runErrors, runSummaries, rowWarnings } =
      serviceWithLogs();
    // The sweep's claim is global on the shared database: it is handed this
    // file's two payees, so it can never drain another suite's rows.
    vi.spyOn(
      service as unknown as {
        claimSweepPayees: () => Promise<
          Array<{ userId: string | null; organizationId: string | null }>
        >;
      },
      'claimSweepPayees'
    ).mockResolvedValue([
      { userId: first, organizationId: null },
      { userId: second, organizationId: null },
    ]);

    const result = await service.sweepUnresolvedPayouts();

    expect(result).toEqual({
      groupsScanned: 2,
      groupsResolved: 2,
      groupsSkipped: 0,
      errors: 0,
    });
    expect(alerted).toHaveBeenCalledOnce();
    expect(runErrors()).toHaveLength(1);
    const [, run] = runErrors()[0] ?? [];
    expect(run).toMatchObject({
      errorId: expect.any(String),
      code: 'balance_insufficient',
      error: STRIPE_MESSAGE,
    });
    expect(runSummaries()).toHaveLength(1);
    expect(runSummaries()[0]?.[1]).toMatchObject({
      errorId: run?.errorId,
      count: 2,
      totalCents: 1000,
      codes: ['balance_insufficient'],
      error: STRIPE_MESSAGE,
      sweep: true,
    });
    expect(rowWarnings()).toHaveLength(2);
    for (const [, fields] of rowWarnings()) {
      expect(fields).toMatchObject({ errorId: run?.errorId });
    }
  });
});
