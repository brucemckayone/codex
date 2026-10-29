/**
 * Earnings hub page — unit tests (WP9 — Codex-69t7c.9; batch B Codex-2hxff.29,
 * .30, .34, .87).
 *
 * These exercise the page's OWN logic (`earnings-view.ts`) and its real
 * server load. The tests used to re-implement the page's helpers inline, so
 * they pinned their copy: the copy filtered `status === 'paid'`, the API
 * sends `resolved`, and the test passed while the page's Paid chip hid every
 * paid row and its badge read "resolved" (Codex-2hxff.87).
 *
 * Covered:
 *   - connect state derivation
 *   - status labels and the Paid chip on the API's vocabulary
 *   - each row's bank line (mock-b-studio earnings.html E1-E6)
 *   - the waiting banner's lines, the switch-over notice (OQ5), the Q4 rule
 *   - the server load: connect-return, fetch failures, the streamed balance
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  type BankLineRow,
  bankDayHasRun,
  bankLineFor,
  deriveConnectState,
  filterPayouts,
  formatDay,
  formatPence,
  negativeCauseLine,
  ruleLine,
  statusLabel,
  statusTone,
  switchoverNotice,
  waitingLines,
  waitingSince,
} from '../earnings-view';

// ── Connect state ────────────────────────────────────────────────────────────

describe('deriveConnectState', () => {
  const account = (
    over: Partial<{
      isConnected: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      status: string | null;
    }>
  ) => ({
    isConnected: true,
    chargesEnabled: false,
    payoutsEnabled: false,
    status: 'onboarding',
    ...over,
  });

  it('not_started: no status, or not connected', () => {
    expect(deriveConnectState(null)).toBe('not_started');
    expect(
      deriveConnectState(account({ isConnected: false, status: null }))
    ).toBe('not_started');
  });

  it('enabled: charges and payouts both on', () => {
    expect(
      deriveConnectState(
        account({
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      )
    ).toBe('enabled');
  });

  it('pending_verification: restricted or disabled', () => {
    expect(deriveConnectState(account({ status: 'restricted' }))).toBe(
      'pending_verification'
    );
    expect(deriveConnectState(account({ status: 'disabled' }))).toBe(
      'pending_verification'
    );
  });

  it('incomplete: onboarding, or charges on but payouts off', () => {
    expect(deriveConnectState(account({}))).toBe('incomplete');
    expect(
      deriveConnectState(account({ chargesEnabled: true, status: 'active' }))
    ).toBe('incomplete');
  });

  it('fetch_failed: the load could not read the status (never not_started)', () => {
    expect(deriveConnectState({ fetchFailed: true })).toBe('fetch_failed');
  });
});

// ── Status labels and the Paid chip (Codex-2hxff.87) ─────────────────────────

const ROWS = [
  { id: '1', status: 'resolved', sourceType: 'subscription' as const },
  { id: '2', status: 'pending', sourceType: 'purchase' as const },
  { id: '3', status: 'failed', sourceType: 'subscription' as const },
  { id: '4', status: 'reversed', sourceType: 'purchase' as const },
  { id: '5', status: 'cancelled_by_refund', sourceType: 'purchase' as const },
];

describe('status labels on the API vocabulary', () => {
  it('a paid row is `resolved`, and reads "Paid" with the paid colour', () => {
    expect(statusLabel('resolved')).toBe('Paid');
    expect(statusTone('resolved')).toBe('paid');
  });

  it('reversed and cancelled rows read as words, in the neutral colour', () => {
    expect(statusLabel('reversed')).toBe('Reversed');
    expect(statusLabel('cancelled_by_refund')).toBe('Cancelled');
    expect(statusLabel('cancelled_by_dispute')).toBe('Cancelled');
    expect(statusTone('reversed')).toBe('neutral');
    expect(statusTone('cancelled_by_dispute')).toBe('neutral');
  });

  it('pending and failed keep their own colours', () => {
    expect(statusTone('pending')).toBe('pending');
    expect(statusTone('failed')).toBe('failed');
  });
});

describe('filterPayouts', () => {
  it('the Paid chip keeps the resolved rows', () => {
    expect(filterPayouts(ROWS, 'paid', 'all').map((r) => r.id)).toEqual(['1']);
  });

  it('All keeps everything; Pending and Failed match their own status', () => {
    expect(filterPayouts(ROWS, 'all', 'all')).toHaveLength(5);
    expect(filterPayouts(ROWS, 'pending', 'all').map((r) => r.id)).toEqual([
      '2',
    ]);
    expect(filterPayouts(ROWS, 'failed', 'all').map((r) => r.id)).toEqual([
      '3',
    ]);
  });

  it('combines status and source', () => {
    expect(
      filterPayouts(ROWS, 'paid', 'subscription').map((r) => r.id)
    ).toEqual(['1']);
    expect(filterPayouts(ROWS, 'paid', 'purchase')).toEqual([]);
    expect(filterPayouts(ROWS, 'all', 'purchase').map((r) => r.id)).toEqual([
      '2',
      '4',
      '5',
    ]);
  });
});

// ── Money and days ───────────────────────────────────────────────────────────

describe('formatPence and formatDay', () => {
  it('pounds and pence, with a real minus sign below zero', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(1770)).toBe('£17.70');
    expect(formatPence(-840)).toBe('−£8.40');
  });

  it('a London day as the mockup writes it; September is "Sep"', () => {
    expect(formatDay('2026-10-29')).toBe('29 Oct');
    expect(formatDay('2026-10-29', { weekday: true })).toBe('Thu 29 Oct');
    expect(formatDay('2027-04-24', { year: true })).toBe('24 Apr 2027');
    expect(formatDay('2026-09-14', { year: true })).toBe('14 Sep 2026');
  });

  it('a bank day has run from 08:00 London that morning', () => {
    // 28 Oct 2026 is GMT (UTC+0): 07:59 has not run, 08:00 has.
    expect(bankDayHasRun('2026-10-28', new Date('2026-10-28T07:59:00Z'))).toBe(
      false
    );
    expect(bankDayHasRun('2026-10-28', new Date('2026-10-28T08:00:00Z'))).toBe(
      true
    );
    // 14 Oct 2026 is BST (UTC+1): 08:00 London is 07:00 UTC.
    expect(bankDayHasRun('2026-10-14', new Date('2026-10-14T07:00:00Z'))).toBe(
      true
    );
    expect(bankDayHasRun('2026-10-29', new Date('2026-10-28T10:00:00Z'))).toBe(
      false
    );
  });
});

// ── The bank line under each row (E1-E6) ─────────────────────────────────────

describe('bankLineFor', () => {
  // Wednesday 28 October 2026, 10:00 UK (the mockup's "today").
  const now = new Date('2026-10-28T10:00:00Z');
  const paid = (over: Partial<BankLineRow> = {}): BankLineRow => ({
    id: 'p1',
    status: 'resolved',
    reason: 'transferred',
    amountCents: 899,
    bankOn: '2026-11-11',
    ...over,
  });
  const enabled = {
    connectState: 'enabled' as const,
    balance: { negative: null },
    now,
  };

  it('a paid row goes to the bank on its date, or was sent (E1)', () => {
    expect(bankLineFor(paid(), enabled)).toBe('Goes to your bank on 11 Nov');
    expect(bankLineFor(paid({ bankOn: '2026-10-28' }), enabled)).toBe(
      'Sent to your bank on 28 Oct'
    );
    expect(bankLineFor(paid({ bankOn: '2026-10-24' }), enabled)).toBe(
      'Sent to your bank on 24 Oct'
    );
  });

  it("no bank date (Stripe's old schedule) is no line", () => {
    expect(bankLineFor(paid({ bankOn: null }), enabled)).toBeNull();
  });

  it('while the balance loads, no date shows, coming or passed', () => {
    // Below zero, a passed day may have sent nothing (E5), so it waits too.
    const loading = { ...enabled, balance: undefined };
    expect(bankLineFor(paid(), loading)).toBeNull();
    expect(bankLineFor(paid({ bankOn: '2026-10-24' }), loading)).toBeNull();
  });

  it('a failed balance read: our ledger\'s dates, and a passed day is due, never "Sent" (E8, r3-L1)', () => {
    const unread = { ...enabled, balance: null };
    expect(bankLineFor(paid(), unread)).toBe('Goes to your bank on 11 Nov');
    expect(bankLineFor(paid({ bankOn: '2026-10-24' }), unread)).toBe(
      'Due to your bank on 24 Oct'
    );
  });

  // AMENDMENT 3: every row's line comes from the server's per-sale
  // `towardsCents` (shared oldest first), live or from the last ended episode.
  const towards = (
    rows: Array<[string, number]>,
    causeType?: 'refund' | 'dispute' | null
  ) => ({
    cents: rows.reduce((sum, [, cents]) => sum + cents, 0),
    rows: rows.map(([payoutId, towardsCents]) => ({ payoutId, towardsCents })),
    causeType,
  });

  it("the owner's example: −£8.40, a £6 sale whose day ran inside it, then a young £11 that clears it", () => {
    const ended = {
      ...enabled,
      balance: {
        negative: null,
        towards: {
          live: null,
          lastEpisode: towards(
            [
              ['six', 600],
              ['eleven', 240],
            ],
            'dispute'
          ),
        },
      },
    };
    // All £6 went towards it: never "Sent", though its day has passed.
    expect(
      bankLineFor(
        paid({ id: 'six', amountCents: 600, bankOn: '2026-10-26' }),
        ended
      )
    ).toBe('Went towards the chargeback');
    // £2.40 of the £11 went towards it; £8.60 goes on its own bank day.
    const eleven = paid({
      id: 'eleven',
      amountCents: 1100,
      bankOn: '2026-11-11',
    });
    expect(bankLineFor(eleven, ended)).toBe(
      '£2.40 went towards the chargeback. £8.60 goes to your bank on 11 Nov'
    );
    // Past tense once that day has run.
    expect(
      bankLineFor(eleven, { ...ended, now: new Date('2026-11-11T09:00:00Z') })
    ).toBe(
      '£2.40 went towards the chargeback. £8.60 went to your bank on 11 Nov'
    );
  });

  it('none of it: the usual bank line, coming or sent', () => {
    const elsewhere = {
      ...enabled,
      balance: {
        negative: null,
        towards: { live: towards([['other', 500]]), lastEpisode: null },
      },
    };
    expect(bankLineFor(paid(), elsewhere)).toBe('Goes to your bank on 11 Nov');
    expect(bankLineFor(paid({ bankOn: '2026-10-24' }), elsewhere)).toBe(
      'Sent to your bank on 24 Oct'
    );
  });

  it("a running episode: all of a sale went towards it, its day passed or not, in the latest cause's words (E5)", () => {
    const running = (causeType: 'refund' | 'dispute') => ({
      ...enabled,
      balance: {
        negative: {
          owedCents: 840,
          since: '2026-10-21',
          causes: [
            {
              causeType,
              cents: 1440,
              on: '2026-10-21',
              title: null,
              organizationId: null,
              organisationName: null,
            },
          ],
        },
        towards: {
          live: towards([
            ['p1', 899],
            ['ran', 600],
          ]),
          lastEpisode: null,
        },
      },
    });
    expect(bankLineFor(paid(), running('dispute'))).toBe(
      'Went towards the chargeback'
    );
    expect(
      bankLineFor(
        paid({ id: 'ran', amountCents: 600, bankOn: '2026-10-26' }),
        running('dispute')
      )
    ).toBe('Went towards the chargeback');
    expect(bankLineFor(paid(), running('refund'))).toBe(
      'Went towards the refund'
    );
    // A sale the server says was sent before it began stays sent.
    expect(
      bankLineFor(
        paid({ id: 'before', bankOn: '2026-10-20' }),
        running('dispute')
      )
    ).toBe('Sent to your bank on 20 Oct');
  });

  it('covering a take-back above zero, cause unknown: in part, naming neither (E6)', () => {
    const covering = {
      ...enabled,
      balance: {
        negative: null,
        towards: {
          live: towards([
            ['full', 1170],
            ['part', 540],
          ]),
          lastEpisode: null,
        },
      },
    };
    expect(bankLineFor(paid({ id: 'full', amountCents: 1170 }), covering)).toBe(
      'Went towards a refund or chargeback'
    );
    expect(
      bankLineFor(
        paid({ id: 'part', amountCents: 899, bankOn: '2026-11-04' }),
        covering
      )
    ).toBe(
      '£5.40 went towards a refund or chargeback. £3.59 goes to your bank on 4 Nov'
    );
  });

  it.each([
    ['dispute', 'the chargeback'],
    ['refund', 'the refund'],
    [null, 'a refund or chargeback'],
  ] as const)('the server\'s causeType %s picks the word: "%s", live or from the last episode', (causeType, what) => {
    const withCause = (where: 'live' | 'lastEpisode') => ({
      ...enabled,
      balance: {
        negative: null,
        towards: {
          live: null,
          lastEpisode: null,
          [where]: towards(
            [
              ['all', 600],
              ['part', 540],
            ],
            causeType
          ),
        },
      },
    });
    for (const where of ['live', 'lastEpisode'] as const) {
      expect(
        bankLineFor(paid({ id: 'all', amountCents: 600 }), withCause(where))
      ).toBe(`Went towards ${what}`);
      expect(
        bankLineFor(
          paid({ id: 'part', amountCents: 899, bankOn: '2026-11-04' }),
          withCause(where)
        )
      ).toBe(`£5.40 went towards ${what}. £3.59 goes to your bank on 4 Nov`);
    }
  });

  it('below zero, the server\'s null (mixed causes) stays "a refund or chargeback", whatever cause is newest; no field at all falls back to it', () => {
    const below = (causeType?: null) => ({
      ...enabled,
      balance: {
        negative: {
          owedCents: 840,
          since: '2026-10-21',
          causes: [
            {
              causeType: 'dispute' as const,
              cents: 1440,
              on: '2026-10-21',
              title: null,
              organizationId: null,
              organisationName: null,
            },
          ],
        },
        towards: {
          live:
            causeType === null
              ? towards([['p1', 899]], null)
              : { cents: 899, rows: [{ payoutId: 'p1', towardsCents: 899 }] },
          lastEpisode: null,
        },
      },
    });
    expect(bankLineFor(paid(), below(null))).toBe(
      'Went towards a refund or chargeback'
    );
    expect(bankLineFor(paid(), below())).toBe('Went towards the chargeback');
  });

  it('the live share comes first; the last episode only for a sale the live one leaves out', () => {
    const both = {
      ...enabled,
      balance: {
        negative: null,
        towards: {
          live: towards([['p1', 300]], 'refund'),
          lastEpisode: towards(
            [
              ['p1', 200],
              ['old', 400],
            ],
            'dispute'
          ),
        },
      },
    };
    expect(bankLineFor(paid(), both)).toBe(
      '£3.00 went towards the refund. £5.99 goes to your bank on 11 Nov'
    );
    expect(
      bankLineFor(
        paid({ id: 'old', amountCents: 400, bankOn: '2026-10-20' }),
        both
      )
    ).toBe('Went towards the chargeback');
  });

  it('paused by Stripe: a coming date stays in the balance; a passed one says nothing (E4)', () => {
    const paused = {
      ...enabled,
      connectState: 'pending_verification' as const,
    };
    expect(bankLineFor(paid(), paused)).toBe(
      'In your Stripe balance until Stripe has finished'
    );
    expect(bankLineFor(paid({ bankOn: '2026-09-28' }), paused)).toBeNull();
  });

  it('a reversed row says when Stripe took it back, and why (E5)', () => {
    const reversed = (takenBack: BankLineRow['takenBack']) =>
      paid({ status: 'reversed', bankOn: '2026-09-17', takenBack });
    expect(
      bankLineFor(reversed({ causeType: 'dispute', on: '2026-10-26' }), enabled)
    ).toBe('Taken back for a chargeback on 26 Oct');
    expect(
      bankLineFor(reversed({ causeType: 'refund', on: '2026-10-14' }), enabled)
    ).toBe('Taken back for a refund on 14 Oct');
    // Not known (an older row, or a step still pending): no line, never a bank date.
    expect(bankLineFor(reversed(null), enabled)).toBeNull();
    expect(bankLineFor(reversed(undefined), enabled)).toBeNull();
  });

  it('a waiting row says what it waits for (E2-E4)', () => {
    const waiting = paid({
      status: 'pending',
      reason: 'connect_not_ready',
      bankOn: null,
    });
    expect(
      bankLineFor(waiting, { ...enabled, connectState: 'not_started' })
    ).toBe('Waiting for you to set up payouts');
    expect(
      bankLineFor(waiting, { ...enabled, connectState: 'incomplete' })
    ).toBe('Waiting for you to finish setup');
    expect(
      bankLineFor(
        { ...waiting, reason: 'connect_restricted' },
        { ...enabled, connectState: 'pending_verification' }
      )
    ).toBe('Waiting while Stripe reviews your account');
  });

  it('a pending row in flight, or held for a dispute, has no waiting line', () => {
    expect(
      bankLineFor(paid({ status: 'pending', reason: 'dispute_hold' }), {
        ...enabled,
        connectState: 'not_started',
      })
    ).toBeNull();
  });

  it('a reversed row has no bank line', () => {
    expect(bankLineFor(paid({ status: 'reversed' }), enabled)).toBeNull();
  });
});

// ── The waiting banner, the switch-over notice, the Q4 rule ──────────────────

describe('the money waiting for setup (E2, E3)', () => {
  const waiting = {
    totalCents: 13890,
    oldestAt: '2026-09-02T09:00:00Z',
    organisations: [
      {
        organizationId: 'org-b',
        name: 'Northlight Collective',
        asOwner: true,
        cents: 9630,
      },
      {
        organizationId: 'org-a',
        name: 'Hollow Oak Films',
        asOwner: false,
        cents: 4260,
      },
      { organizationId: null, name: null, asOwner: false, cents: 0 },
    ],
  };

  it('one line per organisation and role, the owner share marked', () => {
    expect(waitingLines(waiting)).toEqual([
      {
        key: 'org-b:owner',
        name: 'Northlight Collective',
        asOwner: true,
        amount: '£96.30',
      },
      {
        key: 'org-a:creator',
        name: 'Hollow Oak Films',
        asOwner: false,
        amount: '£42.60',
      },
      {
        key: 'own:creator',
        name: 'Your own sales',
        asOwner: false,
        amount: '£0.00',
      },
    ]);
  });

  it('waiting since the oldest row, as a London day', () => {
    expect(waitingSince(waiting)).toBe('2 Sep 2026');
  });
});

describe('switchoverNotice (OQ5)', () => {
  const since = '2026-10-20T08:00:00Z';

  it('shows for the first 14 days after the switch', () => {
    expect(switchoverNotice(since, new Date('2026-10-28T10:00:00Z'))).toBe(
      "Since 20 Oct, each sale's money stays in your Stripe balance for 14 days before it goes to your bank, in case of a refund. Sales from the last 14 days follow the same rule."
    );
    expect(
      switchoverNotice(since, new Date('2026-11-03T07:59:59Z'))
    ).not.toBeNull();
  });

  it('not from day 14, and not for an account never switched', () => {
    expect(
      switchoverNotice(since, new Date('2026-11-03T08:00:00Z'))
    ).toBeNull();
    expect(switchoverNotice(null, new Date('2026-10-28T10:00:00Z'))).toBeNull();
  });
});

describe('negativeCauseLine (E5)', () => {
  const winterLight = {
    causeType: 'dispute' as const,
    cents: 1440,
    on: '2026-10-26',
    title: 'Winter Light',
    organizationId: 'org-hollow-oak',
    organisationName: 'Hollow Oak Films',
  };

  it("names the latest take-back, as the owner's mockup does", () => {
    expect(negativeCauseLine([winterLight])).toBe(
      'A chargeback on ‘Winter Light’ (Hollow Oak Films) took back £14.40 on 26 Oct, after that money had gone to your bank. If the bank decides for us, the £14.40 is paid back to you.'
    );
  });

  it('a refund is never paid back; an untitled orgless sale is "one of your sales"', () => {
    expect(
      negativeCauseLine([
        {
          ...winterLight,
          causeType: 'refund',
          title: null,
          organizationId: null,
          organisationName: null,
        },
      ])
    ).toBe(
      'A refund on one of your sales took back £14.40 on 26 Oct, after that money had gone to your bank.'
    );
  });

  it("one grouped cause (a solo owner-creator's chargeback, from both shares) is one, never 'one other take-back'", () => {
    expect(
      negativeCauseLine([
        {
          ...winterLight,
          cents: 864,
          payoutTypes: ['creator_payout', 'organization_fee'],
        },
      ])
    ).toBe(
      'A chargeback on ‘Winter Light’ (Hollow Oak Films) took back £8.64 on 26 Oct, after that money had gone to your bank. If the bank decides for us, the £8.64 is paid back to you.'
    );
  });

  it('counts the others behind the latest', () => {
    expect(negativeCauseLine([winterLight, winterLight])).toContain(
      'took back £14.40 on 26 Oct, along with one other take-back, after'
    );
    expect(
      negativeCauseLine([winterLight, winterLight, winterLight])
    ).toContain('along with 2 other take-backs, after');
  });

  it('no cause known (none sent, or an older API): the generic line', () => {
    expect(negativeCauseLine([])).toBe(m.earnings_negative_cause());
    expect(negativeCauseLine(undefined)).toBe(m.earnings_negative_cause());
  });
});

describe('ruleLine (Q4)', () => {
  it('£50 or less: written off at 180 days', () => {
    expect(ruleLine({ kind: 'stripe_writes_off', on: '2027-04-24' })).toEqual({
      label: '£50 or less:',
      text: "if it's still below zero on 24 Apr 2027, we'll write off what's left. We never take it from your bank account.",
    });
  });

  it('over £50: an invoice at 90 days', () => {
    expect(ruleLine({ kind: 'invoice', on: '2027-01-24' })).toEqual({
      label: 'Over £50:',
      text: "if more than £50 is still owed on 24 Jan 2027, we'll send you an invoice for what's left. We never take it from your bank account.",
    });
  });
});

// ── The real server load ─────────────────────────────────────────────────────

const { api, logger } = vi.hoisted(() => ({
  api: {
    connect: {
      syncMyStatus: vi.fn(),
      getMyStatus: vi.fn(),
      getMyBalance: vi.fn(),
    },
    subscription: {
      getMyEarningsSummary: vi.fn(),
      getMyPayouts: vi.fn(),
    },
  },
  logger: { error: vi.fn() },
}));

vi.mock('@sveltejs/kit', () => ({ redirect: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger }));
vi.mock('$lib/server/api', () => ({ createServerApi: vi.fn(() => api) }));

const CONNECTED = {
  isConnected: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active',
};

async function runLoad(connectParam: string | null = null) {
  const { load } = await import('../+page.server');
  const url = new URL('https://creators.example.test/studio/earnings');
  if (connectParam) url.searchParams.set('connect', connectParam);
  const result = (await load({
    locals: { user: { id: 'user-1' }, requestId: 'req-1' },
    url,
    platform: { env: {} },
    cookies: {},
  } as unknown as Parameters<typeof load>[0])) as {
    connectReturnBanner: string | null;
    connectStatus: unknown;
    earningsSummary: Promise<unknown>;
    payouts: Promise<unknown>;
    stripeBalance: Promise<unknown>;
  };
  return {
    ...result,
    earningsSummary: await result.earningsSummary,
    payouts: await result.payouts,
    stripeBalance: await result.stripeBalance,
  };
}

describe('server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.connect.syncMyStatus.mockResolvedValue(undefined);
    api.connect.getMyStatus.mockResolvedValue(CONNECTED);
    api.connect.getMyBalance.mockResolvedValue({ availableCents: 100 });
    api.subscription.getMyEarningsSummary.mockResolvedValue({
      earnedInPeriodCents: 0,
    });
    api.subscription.getMyPayouts.mockResolvedValue({
      items: [],
      pagination: { page: 1, totalPages: 1 },
    });
  });

  it('a failed sync on return from Stripe is sync_failed, and the load goes on', async () => {
    api.connect.syncMyStatus.mockRejectedValue(new Error('Stripe timeout'));
    const result = await runLoad('success');
    expect(result.connectReturnBanner).toBe('sync_failed');
    expect(result.connectStatus).toEqual(CONNECTED);
    expect(logger.error.mock.calls[0]?.[0]).toContain('syncMyStatus');
  });

  it('a failed status read is the fetchFailed sentinel, never not_started', async () => {
    api.connect.getMyStatus.mockRejectedValue(new Error('Network error'));
    const result = await runLoad();
    expect(result.connectStatus).toEqual({ fetchFailed: true });
    // No account to read, so no balance call.
    expect(api.connect.getMyBalance).not.toHaveBeenCalled();
    expect(result.stripeBalance).toBeNull();
  });

  it('failed summary and payouts reads are { ok: false } and logged, never an empty ledger or empty KPIs', async () => {
    api.subscription.getMyEarningsSummary.mockRejectedValue(new Error('x'));
    api.subscription.getMyPayouts.mockRejectedValue(new Error('y'));
    const result = await runLoad();
    expect(result.earningsSummary).toEqual({ ok: false });
    expect(result.payouts).toEqual({ ok: false });
    expect(result.connectReturnBanner).toBeNull();
    const logged = logger.error.mock.calls.map((c) => String(c[0]));
    expect(logged).toContain('earnings-load:getMyEarningsSummary failed');
    expect(logged).toContain('earnings-load:getMyPayouts failed');
  });

  it('summary and payouts reads that worked are { ok: true } with what came back', async () => {
    const result = await runLoad();
    expect(result.earningsSummary).toEqual({
      ok: true,
      summary: { earnedInPeriodCents: 0 },
    });
    expect(result.payouts).toEqual({
      ok: true,
      list: { items: [], pagination: { page: 1, totalPages: 1 } },
    });
  });

  it('a connected account streams its balance', async () => {
    const result = await runLoad();
    expect(api.connect.getMyBalance).toHaveBeenCalledOnce();
    expect(result.stripeBalance).toEqual({
      ok: true,
      balance: { availableCents: 100 },
    });
  });

  it('a failed balance read is { ok: false } and logged, never a zero balance', async () => {
    api.connect.getMyBalance.mockRejectedValue(new Error('503'));
    const result = await runLoad();
    expect(result.stripeBalance).toEqual({ ok: false });
    expect(
      logger.error.mock.calls.some((c) => String(c[0]).includes('getMyBalance'))
    ).toBe(true);
  });

  it('an account not connected has no balance to read', async () => {
    api.connect.getMyStatus.mockResolvedValue({
      ...CONNECTED,
      isConnected: false,
    });
    const result = await runLoad();
    expect(api.connect.getMyBalance).not.toHaveBeenCalled();
    expect(result.stripeBalance).toBeNull();
  });
});
