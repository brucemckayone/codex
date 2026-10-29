/**
 * Studio → Earnings: what a failed streamed read shows (Codex-2hxff, web
 * review M1, H1).
 *
 * The load resolves a failed KPI or ledger read to `{ ok: false }`. The page
 * must show its error with Retry, never empty KPIs or "No payouts yet", and a
 * ledger row's bank line must take the balance in once it lands.
 *
 * Mounts the real `+page.svelte` with the streamed promises the server load
 * returns; only `$app/*` and the page's remote commands are mocked.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: string, _opts?: unknown) => {}),
}));
vi.mock('$app/navigation', () => navigation);
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://creators.revelations.studio/studio/earnings');
    },
  },
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  connectMeOnboard: vi.fn(),
  getMyConnectDashboard: vi.fn(),
  syncMyConnect: vi.fn(),
}));

import EarningsPage from '../+page.svelte';

const CONNECTED = {
  isConnected: true,
  accountId: 'acct_1',
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active',
  requirements: null,
};

const SUMMARY = {
  earnedInPeriodCents: 1499,
  totalEarnedCents: 64230,
  inTransitCents: 0,
  needsAttentionCount: 0,
  waiting: null,
};

/** A paid row whose bank day (26 Oct) ran while the balance was below zero. */
const ROW = {
  id: 'p1',
  organizationId: null,
  amountCents: 600,
  currency: 'gbp',
  reason: 'transferred',
  status: 'resolved',
  payoutType: 'creator_payout',
  sourceType: 'purchase',
  resolvedAt: '2026-10-12T10:00:00.000Z',
  stripeTransferId: 'tr_1',
  transferGroup: null,
  createdAt: '2026-10-12T10:00:00.000Z',
  purchaseId: 'pur_1',
  subscriptionId: null,
  stripeChargeId: 'ch_1',
  bankOn: '2026-10-26',
};

const BELOW_ZERO = {
  checkedAt: '2026-10-28T10:00:00.000Z',
  availableCents: -840,
  pendingCents: 0,
  manualPayouts: true,
  manualPayoutsSince: '2026-09-01T00:00:00.000Z',
  nextPayout: null,
  covering: null,
  negative: {
    owedCents: 840,
    since: '2026-10-21',
    rule: { kind: 'stripe_writes_off', on: '2027-04-19' },
    causes: [
      {
        causeType: 'dispute',
        cents: 1440,
        on: '2026-10-21',
        title: null,
        organizationId: null,
        organisationName: null,
        payoutTypes: ['creator_payout'],
      },
    ],
  },
  // The £6 row's day (26 Oct) ran inside it: all of it went towards it.
  towards: {
    live: { cents: 600, rows: [{ payoutId: 'p1', towardsCents: 600 }] },
    lastEpisode: null,
  },
};

let component: ReturnType<typeof mount> | null = null;

function mountPage(data: {
  earningsSummary: Promise<unknown>;
  payouts: Promise<unknown>;
  stripeBalance: Promise<unknown>;
}) {
  component = mount(EarningsPage, {
    target: document.body,
    props: {
      data: { connectStatus: CONNECTED, connectReturnBanner: null, ...data },
    } as never,
  });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  navigation.goto.mockClear();
});

describe('a failed read (M1)', () => {
  test('the KPIs and the ledger say they could not load, with Retry; never "No payouts yet"', async () => {
    mountPage({
      earningsSummary: Promise.resolve({ ok: false }),
      payouts: Promise.resolve({ ok: false }),
      stripeBalance: Promise.resolve(null),
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="earnings-payouts-error"]')
      ).not.toBeNull()
    );
    expect(
      document.querySelector('[data-testid="earnings-kpi-error"]')?.textContent
    ).toContain(m.earnings_kpi_load_error());
    expect(text()).toContain(m.earnings_payouts_load_error());
    expect(text()).not.toContain(m.earnings_payouts_empty());
    expect(document.querySelector('.kpi-grid')).toBeNull();

    // Retry reloads the page's data, once per click.
    const retry = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.earnings_payouts_retry()
    );
    retry?.click();
    expect(navigation.goto).toHaveBeenCalledWith('/studio/earnings', {
      invalidateAll: true,
    });
  });

  test('a read that worked and found nothing is the empty state', async () => {
    mountPage({
      earningsSummary: Promise.resolve({ ok: true, summary: SUMMARY }),
      payouts: Promise.resolve({
        ok: true,
        list: {
          items: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      }),
      stripeBalance: Promise.resolve(null),
    });
    await vi.waitFor(() =>
      expect(text()).toContain(m.earnings_payouts_empty())
    );
    expect(document.querySelector('.kpi-grid')).not.toBeNull();
    expect(text()).not.toContain(m.earnings_payouts_load_error());
  });
});

describe('a failed balance read (E8, r3-L1)', () => {
  test('"couldn\'t check" with Retry, and a passed bank day reads "Due", never "Sent"', async () => {
    mountPage({
      earningsSummary: Promise.resolve({ ok: true, summary: SUMMARY }),
      payouts: Promise.resolve({
        ok: true,
        list: {
          items: [ROW],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }),
      stripeBalance: Promise.resolve({ ok: false }),
    });
    await vi.waitFor(() =>
      expect(document.querySelector('.bank-line')?.textContent).toBe(
        'Due to your bank on 26 Oct'
      )
    );
    expect(text()).toContain(m.earnings_bank_check_failed());
    expect(text()).not.toContain('Sent to your bank');
  });
});

describe('below zero: what caused it (E5)', () => {
  test('the card names the take-back, and the charged-back row says when it was taken back', async () => {
    mountPage({
      earningsSummary: Promise.resolve({ ok: true, summary: SUMMARY }),
      payouts: Promise.resolve({
        ok: true,
        list: {
          items: [
            {
              ...ROW,
              id: 'p2',
              amountCents: 1440,
              status: 'reversed',
              bankOn: '2026-09-17',
              takenBack: { causeType: 'dispute', on: '2026-10-26' },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }),
      stripeBalance: Promise.resolve({
        ok: true,
        balance: {
          ...BELOW_ZERO,
          negative: {
            ...BELOW_ZERO.negative,
            causes: [
              {
                causeType: 'dispute',
                cents: 1440,
                on: '2026-10-26',
                title: 'Winter Light',
                organizationId: 'org-hollow-oak',
                organisationName: 'Hollow Oak Films',
              },
            ],
          },
        },
      }),
    });
    await vi.waitFor(() =>
      expect(text()).toContain(
        'A chargeback on ‘Winter Light’ (Hollow Oak Films) took back £14.40 on 26 Oct'
      )
    );
    expect(text()).not.toContain(m.earnings_negative_cause());
    await vi.waitFor(() =>
      expect(document.querySelector('.bank-line')?.textContent).toBe(
        'Taken back for a chargeback on 26 Oct'
      )
    );
  });
});

describe('a bank day that ran below zero (H1)', () => {
  test('reads as gone towards the chargeback once the balance lands, never "Sent"', async () => {
    let land: (value: unknown) => void = () => {};
    mountPage({
      earningsSummary: Promise.resolve({ ok: true, summary: SUMMARY }),
      payouts: Promise.resolve({
        ok: true,
        list: {
          items: [ROW],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }),
      stripeBalance: new Promise((resolve) => {
        land = resolve;
      }),
    });
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.payouts-table__row')).toHaveLength(1)
    );
    // While the balance loads, the row shows no bank line.
    expect(document.querySelector('.bank-line')).toBeNull();

    land({ ok: true, balance: BELOW_ZERO });
    await vi.waitFor(() =>
      expect(document.querySelector('.bank-line')?.textContent).toBe(
        'Went towards the chargeback'
      )
    );
    expect(text()).not.toContain(m.earnings_bank_sent_on({ date: '26 Oct' }));
  });
});
