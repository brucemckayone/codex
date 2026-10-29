/**
 * ConnectAccountService and the daily bank payout (Codex-2hxff.29, .30):
 * `account.updated` records the switch to manual payouts and catches a
 * Dashboard edit (data design §2.1), and `getBalanceForUser` is Studio's
 * `GET /connect/me/balance` (§3.3, §4.2).
 *
 * Real database (the flag is an upsert on `connect_balances`), mocked Stripe.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import {
  connectBalances,
  organizations,
  payoutReversals,
  payouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { firstLondon0800After, londonDate } from '@codex/payments';
import { ServiceUnavailableError } from '@codex/service-errors';
import {
  createMockKVNamespace,
  createMockObservability,
  createMockStripe,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
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
import { ConnectAccountNotFoundError } from '../../errors';
import { ConnectAccountService } from '../connect-account-service';

const DAY = 24 * 60 * 60 * 1000;

/** An `account.updated` payload with the payout settings Stripe reports. */
function accountEvent(
  id: string,
  payoutSettings?: { interval: string; debit_negative_balances: boolean }
): Stripe.Account {
  return {
    id,
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [], disabled_reason: null },
    ...(payoutSettings
      ? {
          settings: {
            payouts: {
              schedule: { interval: payoutSettings.interval, delay_days: 7 },
              debit_negative_balances: payoutSettings.debit_negative_balances,
            },
          },
        }
      : {}),
  } as unknown as Stripe.Account;
}

describe('ConnectAccountService and the daily bank payout', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: ConnectAccountService;
  let userId: string;
  let otherUserId: string;
  let stripeAccountId: string;
  let subscriptionId: string;
  let orgId: string;
  const payoutIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [userId, otherUserId] = (await seedTestUsers(db, 2)) as [string, string];
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('bank-pay') })
        )
        .returning()
    );
    orgId = org.id;
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning()
    );
    subscriptionId = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherUserId, orgId, tier.id))
        .returning()
    ).id;
  });

  beforeEach(async () => {
    await db
      .delete(connectBalances)
      .where(inArray(connectBalances.userId, [userId, otherUserId]));
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [userId, otherUserId]));
    stripeAccountId = takeFirst(
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(null, userId))
        .returning()
    ).stripeAccountId;
    stripe = createMockStripe();
    stripe.accounts.retrieve = vi.fn();
    service = new ConnectAccountService({ db, environment: 'test' }, stripe);
  });

  // Only this file's rows: the job reads every switched account.
  afterAll(async () => {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    await db
      .delete(connectBalances)
      .where(inArray(connectBalances.userId, [userId, otherUserId]));
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [userId, otherUserId]));
    await teardownTestDatabase();
  });

  const flagOf = async (id: string) =>
    (
      await db
        .select()
        .from(connectBalances)
        .where(eq(connectBalances.stripeAccountId, id))
    )[0];

  const errorSpy = (target: ConnectAccountService) =>
    vi.spyOn(
      (target as unknown as { obs: { error: (...a: unknown[]) => void } }).obs,
      'error'
    );

  describe('account.updated records the switch (§2.1)', () => {
    it('flags the account once Stripe reports manual payouts AND bank debit off, keeping the first date', async () => {
      vi.mocked(stripe.accounts.retrieve).mockResolvedValue(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: false,
        }) as never
      );
      await service.handleAccountUpdated(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: false,
        })
      );
      const first = await flagOf(stripeAccountId);
      expect(first?.userId).toBe(userId);
      expect(first?.manualPayoutsSince).toBeInstanceOf(Date);

      // A redelivery, or the next status change, keeps the switch date.
      await service.handleAccountUpdated(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: false,
        })
      );
      expect((await flagOf(stripeAccountId))?.manualPayoutsSince).toEqual(
        first?.manualPayoutsSince
      );
      // Asked once, before flagging; a flagged account isn't asked again.
      expect(stripe.accounts.retrieve).toHaveBeenCalledTimes(1);
    });

    // Review r3 LOW-3: the platform can no longer read or pay it.
    it('a deauthorized account leaves the daily bank payout', async () => {
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: new Date(Date.now() - 30 * DAY),
      });

      await service.handleAccountDeauthorized(stripeAccountId);

      expect((await flagOf(stripeAccountId))?.manualPayoutsSince).toBeNull();
    });

    // Review r2 LOW-5: the inverse of MED-2.
    it('a stale manual event after a real drift does not flag the account again', async () => {
      // The drift cleared the flag; the row stays.
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: null,
      });
      vi.mocked(stripe.accounts.retrieve).mockResolvedValue(
        accountEvent(stripeAccountId, {
          interval: 'daily',
          debit_negative_balances: false,
        }) as never
      );

      await service.handleAccountUpdated(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: false,
        })
      );

      expect((await flagOf(stripeAccountId))?.manualPayoutsSince).toBeNull();
    });

    it('if Stripe cannot be asked, a manual event still flags the account', async () => {
      vi.mocked(stripe.accounts.retrieve).mockRejectedValue(
        Object.assign(new Error('Stripe down'), { type: 'StripeAPIError' })
      );

      await service.handleAccountUpdated(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: false,
        })
      );

      expect(
        (await flagOf(stripeAccountId))?.manualPayoutsSince
      ).toBeInstanceOf(Date);
    });

    it('does not flag manual payouts while bank debit is still on', async () => {
      await service.handleAccountUpdated(
        accountEvent(stripeAccountId, {
          interval: 'manual',
          debit_negative_balances: true,
        })
      );
      expect(await flagOf(stripeAccountId)).toBeUndefined();
    });

    const flagged = () =>
      db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: new Date(Date.now() - 30 * DAY),
      });
    const daily = { interval: 'daily', debit_negative_balances: false };
    const manual = { interval: 'manual', debit_negative_balances: false };

    it('a Dashboard edit (drift) the live account confirms clears the flag, and the alert names the heal', async () => {
      await flagged();
      vi.mocked(stripe.accounts.retrieve).mockResolvedValue(
        accountEvent(stripeAccountId, daily) as never
      );
      const error = errorSpy(service);

      await service.handleAccountUpdated(accountEvent(stripeAccountId, daily));

      expect(stripe.accounts.retrieve).toHaveBeenCalledWith(
        stripeAccountId,
        {},
        expect.objectContaining({ timeout: 10_000 })
      );
      expect((await flagOf(stripeAccountId))?.manualPayoutsSince).toBeNull();
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(
          /payout settings were changed in Stripe.*backfill-payout-schedule\.ts with --apply/
        ),
        expect.objectContaining({
          errorId: expect.any(String),
          stripeAccountId,
          interval: 'daily',
        })
      );
    });

    // Review MED-2: Stripe redelivers for up to 3 days, and out of order.
    it('a stale event whose live account is still manual keeps the flag, with no alert', async () => {
      await flagged();
      vi.mocked(stripe.accounts.retrieve).mockResolvedValue(
        accountEvent(stripeAccountId, manual) as never
      );
      const error = errorSpy(service);

      await service.handleAccountUpdated(accountEvent(stripeAccountId, daily));

      expect(
        (await flagOf(stripeAccountId))?.manualPayoutsSince
      ).toBeInstanceOf(Date);
      expect(error).not.toHaveBeenCalled();
    });

    it('if Stripe cannot be asked, the flag stays and support is told', async () => {
      await flagged();
      vi.mocked(stripe.accounts.retrieve).mockRejectedValue(
        Object.assign(new Error('Stripe down'), { type: 'StripeAPIError' })
      );
      const error = errorSpy(service);

      await service.handleAccountUpdated(accountEvent(stripeAccountId, daily));

      expect(
        (await flagOf(stripeAccountId))?.manualPayoutsSince
      ).toBeInstanceOf(Date);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('could not be asked to confirm'),
        expect.objectContaining({
          errorId: expect.any(String),
          stripeAccountId,
        })
      );
    });

    it('a payload without payout settings changes nothing', async () => {
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: new Date(Date.now() - 30 * DAY),
      });
      const error = errorSpy(service);

      await service.handleAccountUpdated(accountEvent(stripeAccountId));

      expect(
        (await flagOf(stripeAccountId))?.manualPayoutsSince
      ).toBeInstanceOf(Date);
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('getBalanceForUser (GET /connect/me/balance)', () => {
    let balanceRetrieve: ReturnType<typeof vi.fn>;
    let transfersList: ReturnType<typeof vi.fn>;

    function stripeBalance(available: number, pending = 0) {
      balanceRetrieve.mockResolvedValue({
        available: [{ amount: available, currency: 'gbp' }],
        pending: [{ amount: pending, currency: 'gbp' }],
      });
    }

    function youngTransfers(
      transfers: Array<{ id: string; amount: number; chargeCreated: Date }>
    ) {
      transfersList.mockResolvedValue({
        has_more: false,
        data: transfers.map((transfer) => ({
          id: transfer.id,
          object: 'transfer',
          amount: transfer.amount,
          amount_reversed: 0,
          currency: 'gbp',
          created: Math.floor(transfer.chargeCreated.getTime() / 1000),
          source_transaction: {
            object: 'charge',
            created: Math.floor(transfer.chargeCreated.getTime() / 1000),
          },
        })),
      });
    }

    async function switched(since = new Date(Date.now() - 30 * DAY)) {
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: since,
      });
      return since;
    }

    beforeEach(() => {
      balanceRetrieve = vi.fn();
      // Stripe lists no transfers unless a test says which.
      transfersList = vi.fn().mockResolvedValue({ has_more: false, data: [] });
      (stripe as unknown as { balance: unknown }).balance = {
        retrieve: balanceRetrieve,
      };
      stripe.transfers.list = transfersList as never;
    });

    it('reads only the caller’s own account and gives the next payout', async () => {
      const since = await switched();
      stripeBalance(1500, 800);
      const now = Date.now();
      youngTransfers([
        { id: 'tr_young', amount: 800, chargeCreated: new Date(now - DAY) },
      ]);

      const balance = await service.getBalanceForUser(userId);

      expect(balanceRetrieve).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ stripeAccount: stripeAccountId })
      );
      expect(transfersList).toHaveBeenCalledWith(
        expect.objectContaining({ destination: stripeAccountId }),
        expect.objectContaining({ timeout: 5_000 })
      );
      expect(balance).toMatchObject({
        availableCents: 1500,
        pendingCents: 800,
        manualPayouts: true,
        manualPayoutsSince: since.toISOString(),
        nextPayout: {
          on: londonDate(firstLondon0800After(new Date(now))),
          amountCents: 1500,
        },
        covering: null,
        negative: null,
      });
    });

    it('a covered take-back names the ledger rows that won’t go on their date', async () => {
      await switched();
      const now = Date.now();
      const [row] = await db
        .insert(payouts)
        .values({
          userId,
          organizationId: orgId,
          subscriptionId,
          amountCents: 1170,
          payoutType: 'creator_payout',
          status: 'paid',
          reason: null,
          stripeChargeId: `ch_cover_${crypto.randomUUID().slice(0, 12)}`,
          stripeTransferId: `tr_cover_${crypto.randomUUID().slice(0, 12)}`,
          resolvedAt: new Date(now - 10 * DAY),
          createdAt: new Date(now - 10 * DAY),
        })
        .returning();
      if (!row?.stripeTransferId) throw new Error('payout not inserted');
      payoutIds.push(row.id);
      // £11.70 of young money, and the balance holds only £5.00 of it: a
      // £6.70 chargeback two days ago took the rest.
      await takenBack(userId, new Date(now - 2 * DAY), 670, 'dispute');
      stripeBalance(500, 0);
      youngTransfers([
        {
          id: row.stripeTransferId,
          amount: 1170,
          chargeCreated: new Date(now - 10 * DAY),
        },
      ]);

      const balance = await service.getBalanceForUser(userId);

      expect(balance.covering).toEqual({
        cents: 670,
        rows: [{ payoutId: row.id, cents: 670 }],
      });
      // The same figures, from the one rule (amendment 3).
      expect(balance.towards).toEqual({
        live: {
          cents: 670,
          rows: [{ payoutId: row.id, towardsCents: 670 }],
          causeType: 'dispute',
        },
        lastEpisode: null,
      });
      expect(balance.nextPayout?.amountCents).toBe(500);
    });

    /**
     * A paid sale of `forUser`'s, sold at `soldIso`, transferred at `paidIso`;
     * `charge: false` makes it a re-pay, which has no charge.
     */
    async function paidSale(
      forUser: string,
      soldIso: string,
      paidIso: string,
      cents: number,
      options: { charge?: boolean; transferId?: string } = {}
    ): Promise<string> {
      const [sale] = await db
        .insert(payouts)
        .values({
          userId: forUser,
          organizationId: orgId,
          subscriptionId,
          amountCents: cents,
          payoutType: 'creator_payout',
          status: 'paid',
          reason: null,
          stripeChargeId:
            options.charge === false
              ? null
              : `ch_towards_${crypto.randomUUID().slice(0, 12)}`,
          stripeTransferId:
            options.transferId ??
            `tr_towards_${crypto.randomUUID().slice(0, 12)}`,
          createdAt: new Date(soldIso),
          resolvedAt: new Date(paidIso),
        })
        .returning();
      if (!sale) throw new Error('sale not inserted');
      payoutIds.push(sale.id);
      return sale.id;
    }

    /** This user's ledger starts empty: earlier tests' rows stay until afterAll. */
    async function emptyLedger(): Promise<void> {
      const mine = db
        .select({ id: payouts.id })
        .from(payouts)
        .where(eq(payouts.userId, userId));
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, mine));
      await db.delete(payouts).where(eq(payouts.userId, userId));
    }

    /** Studio read at a fixed instant. */
    async function readAt(iso: string) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
      try {
        return await service.getBalanceForUser(userId);
      } finally {
        vi.useRealTimers();
      }
    }

    /**
     * Amendment 3, the owner's example: Mon 26 Oct to Mon 2 Nov 2026 below
     * zero (−£8.40). A £6 sale whose bank day ran in it, and a young £11
     * that cleared it: £8.60 in Stripe at the clearing reading, unless the
     * test says what else was in it. A chargeback on Sun 25 Oct took it below,
     * unless the test names other causes (split £5 then the rest).
     */
    async function ownersExample(
      clearedBalanceCents = 860,
      causes: Array<'refund' | 'dispute'> = ['dispute']
    ) {
      await emptyLedger();
      await switched(new Date('2026-09-01T00:00:00Z'));
      await db
        .update(connectBalances)
        .set({
          clearedSince: new Date('2026-10-26T08:00:00Z'),
          clearedAt: new Date('2026-11-02T08:00:00Z'),
          clearedReason: 'recovered',
          clearedOwedCents: 840,
          clearedBalanceCents,
        })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      const six = await paidSale(
        userId,
        '2026-10-14T12:00:00Z',
        '2026-10-27T09:00:00Z',
        600
      );
      const eleven = await paidSale(
        userId,
        '2026-10-30T12:00:00Z',
        '2026-10-30T12:00:05Z',
        1100
      );
      // Another payee's sale in the same window is never shared.
      await paidSale(
        otherUserId,
        '2026-10-14T12:00:00Z',
        '2026-10-27T09:00:00Z',
        500
      );
      // Sold after the clearing reading: not in that episode's sharing.
      await paidSale(
        userId,
        '2026-11-04T12:00:00Z',
        '2026-11-04T12:00:05Z',
        400
      );
      for (const [i, cause] of causes.entries()) {
        await takenBack(
          userId,
          new Date('2026-10-25T12:00:00Z'),
          causes.length === 1 ? 840 : i === 0 ? 500 : 340,
          cause
        );
      }
      return { six, eleven };
    }

    /** The owner's figures for that episode: £6 and £2.40 went towards it. */
    const ownersEpisode = (
      six: string,
      eleven: string,
      causeType: 'refund' | 'dispute' | null = 'dispute'
    ) => ({
      since: '2026-10-26',
      clearedOn: '2026-11-02',
      cents: 840,
      rows: [
        { payoutId: six, towardsCents: 600 },
        { payoutId: eleven, towardsCents: 240 },
      ],
      causeType,
    });

    // Lead, round 11: the rows say "the chargeback" or "the refund", from the
    // take-backs of the episode's window (to its reading); a mix names neither.
    it.each([
      {
        what: 'one chargeback',
        causes: ['dispute' as const],
        causeType: 'dispute',
      },
      { what: 'one refund', causes: ['refund' as const], causeType: 'refund' },
      {
        what: 'a refund and a chargeback',
        causes: ['refund' as const, 'dispute' as const],
        causeType: null,
      },
      {
        what: 'a refund, then a chargeback during it',
        causes: ['refund' as const],
        during: true,
        causeType: null,
      },
      // Engine r6 LOW-1: a refund 10 days before the episode, covered by a
      // sale still unsent then (U reaches 16 days back), is part of it too.
      {
        what: 'a chargeback, and a refund 10 days before it',
        causes: ['dispute' as const],
        before: true,
        causeType: null,
      },
    ] as const)('what the ended episode went towards, $what: $causeType', async (cases) => {
      const { causes, causeType } = cases;
      const { six, eleven } = await ownersExample(860, [...causes]);
      if ('during' in cases) {
        await takenBack(userId, new Date('2026-10-28T12:00:00Z'), 200);
      }
      if ('before' in cases) {
        await takenBack(
          userId,
          new Date('2026-10-16T12:00:00Z'),
          200,
          'refund'
        );
      }
      stripeBalance(1500, 0);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards.lastEpisode).toEqual(
        ownersEpisode(six, eleven, causeType)
      );
    });

    it('the last ended episode: £6 and £2.40 went towards it, oldest first, the caller’s sales only', async () => {
      const { six, eleven } = await ownersExample();
      // Now Stripe holds the £11 and the £4, both still young.
      stripeBalance(1500, 0);
      youngTransfers([]);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards).toEqual({
        live: null,
        lastEpisode: ownersEpisode(six, eleven),
      });
    });

    // Review r5 MED-2: the episode is valued at its clearing reading, so a
    // refund after it changes neither its total nor which sales it was.
    it.each([
      { how: 'in full', cents: 1100, status: 'reversed' as const },
      { how: 'in part (£5)', cents: 500, status: 'paid' as const },
    ])('the young £11 refunded after the clearing, $how: the episode reads as it did', async ({
      cents,
      status,
    }) => {
      const { six, eleven } = await ownersExample();
      await db.update(payouts).set({ status }).where(eq(payouts.id, eleven));
      await db.insert(payoutReversals).values({
        payoutId: eleven,
        causeType: 'refund',
        causeId: `re_after_${crypto.randomUUID().slice(0, 12)}`,
        amountCents: cents,
        kind: 'transfer_reversal',
        status: 'done',
        stripeReversalId: `trr_after_${crypto.randomUUID().slice(0, 12)}`,
        resolvedAt: new Date('2026-11-04T12:00:00Z'),
      });
      // Stripe now holds what is left of the £11, and the £4.
      stripeBalance(1100 - cents + 400, 0);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards).toEqual({
        live: null,
        lastEpisode: ownersEpisode(six, eleven),
      });
    });

    // Review r5 LOW: the cron's own drain runs before the job reads the
    // account, so what it sent in the clearing wake is in T, and in U too.
    it('a re-pay the clearing wake’s drain sent at 08:00:05 is in the reading, as it is in the balance', async () => {
      const { six, eleven } = await ownersExample(860 + 500);
      await paidSale(
        userId,
        '2026-11-02T07:30:00Z',
        '2026-11-02T08:00:05Z',
        500,
        { charge: false }
      );
      stripeBalance(1500, 0);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards).toEqual({
        live: null,
        lastEpisode: ownersEpisode(six, eleven),
      });
    });

    // Review r5 MED-1, the reviewer's case: the drain sends the amount less
    // the reductions made before it, so the £5 never reached Stripe.
    it('£20 sold, £5 refunded before the drain, £15 sent and £15 in Stripe: nothing went towards anything', async () => {
      await emptyLedger();
      await switched(new Date('2026-09-01T00:00:00Z'));
      const sale = await paidSale(
        userId,
        '2026-11-01T12:00:00Z',
        '2026-11-03T09:00:00Z',
        2000
      );
      await db.insert(payoutReversals).values({
        payoutId: sale,
        causeType: 'refund',
        causeId: `re_reduce_${crypto.randomUUID().slice(0, 12)}`,
        amountCents: 500,
        kind: 'pending_reduction',
        status: 'done',
        stripeReversalId: null,
        resolvedAt: new Date('2026-11-02T12:00:00Z'),
      });
      stripeBalance(1500, 0);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards).toEqual({ live: null, lastEpisode: null });
      expect(balance.covering).toBeNull();
    });

    // Review r5 LOW: a row recorded days after its charge (webhooks
    // redelivered after an outage) is judged by the charge, as the job is.
    it('a sale recorded late is judged by its charge from the listed transfers: the job already paid it', async () => {
      await emptyLedger();
      await switched(new Date('2026-09-01T00:00:00Z'));
      const transferId = `tr_late_${crypto.randomUUID().slice(0, 12)}`;
      // Charged Sat 10 Oct, recorded and sent Sun 1 Nov: by its row due
      // Mon 16 Nov; by its charge the job paid it on Mon 2 Nov.
      await paidSale(
        userId,
        '2026-11-01T12:00:00Z',
        '2026-11-01T12:00:05Z',
        900,
        { transferId }
      );
      stripeBalance(100, 0);
      youngTransfers([
        {
          id: transferId,
          amount: 900,
          chargeCreated: new Date('2026-10-10T12:00:00Z'),
        },
      ]);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards.live).toBeNull();
      expect(balance.covering).toBeNull();
      // The young transfers' list, 16 days back, had it: no second read.
      expect(transfersList).toHaveBeenCalledTimes(1);
      expect(transfersList).toHaveBeenCalledWith(
        expect.objectContaining({
          created: { gte: Date.parse('2026-10-21T10:00:00Z') / 1000 },
        }),
        expect.anything()
      );
    });

    /** Below zero since Mon 2 Nov, with a sale due inside it by its row only. */
    async function lateSaleBelowZero() {
      await emptyLedger();
      await switched(new Date('2026-09-01T00:00:00Z'));
      await db
        .update(connectBalances)
        .set({ negativeSince: new Date('2026-11-02T08:00:00Z') })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      const transferId = `tr_late_${crypto.randomUUID().slice(0, 12)}`;
      // Charged Thu 1 Oct, recorded and sent Sun 25 Oct: by its row due
      // Mon 9 Nov, inside the episode; by its charge the job paid it on
      // Mon 26 Oct, before it.
      await paidSale(
        userId,
        '2026-10-25T12:00:00Z',
        '2026-10-25T12:00:05Z',
        900,
        { transferId }
      );
      const young = await paidSale(
        userId,
        '2026-11-04T12:00:00Z',
        '2026-11-04T12:00:05Z',
        1100
      );
      stripeBalance(-840, 0);
      return { transferId, young };
    }

    it('below zero, a sale due in the episode by its row only is asked of Stripe, in one list around its transfer', async () => {
      const { transferId, young } = await lateSaleBelowZero();
      youngTransfers([
        {
          id: transferId,
          amount: 900,
          chargeCreated: new Date('2026-10-01T12:00:00Z'),
        },
      ]);

      const balance = await readAt('2026-11-06T10:00:00Z');

      // No take-back on record in its window: what it went towards is unknown.
      expect(balance.towards.live).toEqual({
        cents: 1100,
        rows: [{ payoutId: young, towardsCents: 1100 }],
        causeType: null,
      });
      // A day before its transfer to a minute after; nothing else is listed.
      expect(transfersList).toHaveBeenCalledTimes(1);
      expect(transfersList).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: stripeAccountId,
          created: {
            gte: Date.parse('2026-10-24T12:00:05Z') / 1000,
            lte: Date.parse('2026-10-25T12:01:05Z') / 1000,
          },
        }),
        expect.objectContaining({ timeout: 5_000 })
      );
    });

    it('below zero, if that list fails the balance is a 503, never a guess', async () => {
      await lateSaleBelowZero();
      transfersList.mockRejectedValue(
        Object.assign(new Error('Stripe down'), { type: 'StripeAPIError' })
      );

      await expect(readAt('2026-11-06T10:00:00Z')).rejects.toThrow(
        ServiceUnavailableError
      );
    });

    // A refund on Fri 30 Oct took it below zero. The window runs to the
    // reading, so a chargeback during the episode counts too: a mix. It
    // starts as far back as the unsent sales were sent (engine r6 LOW-1), so
    // a chargeback 10 days before the episode, which their money covered, does.
    it.each([
      {
        what: 'a refund took it there',
        duringIt: false,
        earlier: false,
        causeType: 'refund',
      },
      {
        what: 'then a chargeback in it, a mix',
        duringIt: true,
        earlier: false,
        causeType: null,
      },
      {
        what: 'and a chargeback 10 days before it, a mix',
        duringIt: false,
        earlier: true,
        causeType: null,
      },
    ] as const)('below zero: every unsent sale goes towards it, and covering is null; $what', async ({
      duringIt,
      earlier,
      causeType,
    }) => {
      await emptyLedger();
      await switched(new Date('2026-09-01T00:00:00Z'));
      await db
        .update(connectBalances)
        .set({ negativeSince: new Date('2026-11-02T08:00:00Z') })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      await takenBack(userId, new Date('2026-10-30T12:00:00Z'), 840, 'refund');
      if (duringIt) {
        await takenBack(userId, new Date('2026-11-04T12:00:00Z'), 300);
      }
      if (earlier) {
        await takenBack(userId, new Date('2026-10-23T12:00:00Z'), 300);
      }
      // Due Tue 3 Nov, inside the episode; and a young one due 19 Nov.
      const due = await paidSale(
        userId,
        '2026-10-19T12:00:00Z',
        '2026-10-19T12:00:05Z',
        600
      );
      const young = await paidSale(
        userId,
        '2026-11-04T12:00:00Z',
        '2026-11-04T12:00:05Z',
        1100
      );
      // Paid on Thu 29 Oct, before the episode: sent, not shared.
      await paidSale(
        userId,
        '2026-10-14T12:00:00Z',
        '2026-10-14T12:00:05Z',
        999
      );
      stripeBalance(-840, 0);

      const balance = await readAt('2026-11-06T10:00:00Z');

      expect(balance.towards.live).toEqual({
        cents: 1700,
        rows: [
          { payoutId: due, towardsCents: 600 },
          { payoutId: young, towardsCents: 1100 },
        ],
        causeType,
      });
      expect(balance.covering).toBeNull();
    });

    it('below zero: what is owed, since when, and its Q4 rule; no transfer read', async () => {
      // No sale's bank day hangs on its charge, so there is no time to ask for.
      await emptyLedger();
      await switched();
      // 23:30 London on a winter day, fixed (review r2 LOW-3): the rule adds
      // 180 London calendar days, where 180 × 24 h would land on 25 Apr.
      const negativeSince = new Date('2026-10-26T23:30:00Z');
      await db
        .update(connectBalances)
        .set({ negativeSince })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      stripeBalance(-840);

      const balance = await service.getBalanceForUser(userId);

      expect(balance.negative).toEqual({
        owedCents: 840,
        since: '2026-10-26',
        rule: { kind: 'stripe_writes_off', on: '2027-04-24' },
        causes: [],
      });
      expect(balance.nextPayout).toBeNull();
      expect(transfersList).not.toHaveBeenCalled();
    });

    /** A slice of `forUser`'s that Stripe took back at `at`. */
    async function takenBack(
      forUser: string,
      at: Date,
      cents: number,
      causeType: 'refund' | 'dispute' = 'dispute'
    ): Promise<void> {
      const [row] = await db
        .insert(payouts)
        .values({
          userId: forUser,
          organizationId: orgId,
          subscriptionId,
          amountCents: 5000,
          payoutType: 'creator_payout',
          status: 'reversed',
          reason: null,
          stripeTransferId: `tr_cause_${crypto.randomUUID().slice(0, 12)}`,
          resolvedAt: new Date(at.getTime() - 30 * DAY),
        })
        .returning();
      if (!row) throw new Error('payout not inserted');
      payoutIds.push(row.id);
      await db.insert(payoutReversals).values({
        payoutId: row.id,
        causeType,
        causeId: `dp_cause_${crypto.randomUUID().slice(0, 12)}`,
        amountCents: cents,
        kind: 'transfer_reversal',
        status: 'done',
        stripeReversalId: `trr_cause_${crypto.randomUUID().slice(0, 12)}`,
        resolvedAt: at,
      });
    }

    it('below zero: what took it there, the caller’s own take-backs only', async () => {
      await emptyLedger();
      await switched();
      const negativeSince = new Date('2026-10-26T23:30:00Z');
      await db
        .update(connectBalances)
        .set({ negativeSince })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      const at = new Date('2026-10-25T12:00:00Z');
      await takenBack(userId, at, 840);
      await takenBack(otherUserId, at, 999);
      stripeBalance(-840);

      const balance = await service.getBalanceForUser(userId);

      expect(balance.negative?.causes).toEqual([
        {
          causeType: 'dispute',
          cents: 840,
          on: '2026-10-25',
          title: expect.any(String),
          organizationId: orgId,
          organisationName: expect.any(String),
          payoutTypes: ['creator_payout'],
        },
      ]);
    });

    it('below zero since this morning’s check: the take-backs after that check', async () => {
      await emptyLedger();
      await switched();
      const now = Date.now();
      await db
        .update(connectBalances)
        .set({ checkedAt: new Date(now - 60 * 60 * 1000) })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
      await takenBack(userId, new Date(now - 30 * 60 * 1000), 600, 'refund');
      await takenBack(userId, new Date(now - 2 * 60 * 60 * 1000), 700);
      stripeBalance(-600);

      const balance = await service.getBalanceForUser(userId);

      expect(balance.negative?.causes.map((cause) => cause.cents)).toEqual([
        600,
      ]);
    });

    // Web r2 R2-L1: `since` is the first run that pays nothing. The Q4 clock
    // still runs from now. Wed 4 Nov 2026 is GMT: the run is 08:00Z.
    it.each([
      {
        when: 'after this morning’s run, which paid',
        now: '2026-11-04T10:00:00Z',
        since: '2026-11-05',
      },
      {
        when: 'before this morning’s run',
        now: '2026-11-04T06:00:00Z',
        since: '2026-11-04',
      },
    ])('below zero since the last check, $when: since is $since', async ({
      now,
      since,
    }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      try {
        await switched();
        stripeBalance(-6000);

        const balance = await service.getBalanceForUser(userId);

        expect(balance.negative?.since).toBe(since);
        expect(balance.negative?.rule).toEqual({
          kind: 'invoice',
          on: '2027-02-02',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('an account not switched yet: no next payout, no covering', async () => {
      stripeBalance(2000, 300);

      const balance = await service.getBalanceForUser(userId);

      expect(balance).toMatchObject({
        manualPayouts: false,
        manualPayoutsSince: null,
        nextPayout: null,
        covering: null,
        negative: null,
      });
      expect(transfersList).not.toHaveBeenCalled();
    });

    it('no Connect account: ConnectAccountNotFoundError, and Stripe is not asked', async () => {
      await expect(service.getBalanceForUser(otherUserId)).rejects.toThrow(
        ConnectAccountNotFoundError
      );
      expect(balanceRetrieve).not.toHaveBeenCalled();
    });

    it('cached 10 minutes; a Stripe failure is a 503 and is not cached', async () => {
      await switched();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: createMockKVNamespace() as unknown as KVNamespace,
        prefix: 'cache',
        obs: obs as unknown as ConstructorParameters<
          typeof VersionedCache
        >[0]['obs'],
      });
      const cached = new ConnectAccountService(
        { db, environment: 'test', cache },
        stripe
      );
      balanceRetrieve.mockRejectedValueOnce(
        Object.assign(new Error('Stripe down'), { type: 'StripeAPIError' })
      );

      await expect(cached.getBalanceForUser(userId)).rejects.toThrow(
        ServiceUnavailableError
      );
      stripeBalance(0, 0);
      const first = await cached.getBalanceForUser(userId);
      const second = await cached.getBalanceForUser(userId);

      expect(second).toEqual(first);
      // The failure, then one miss; the second read is a hit.
      expect(balanceRetrieve).toHaveBeenCalledTimes(2);
    });
  });
});
