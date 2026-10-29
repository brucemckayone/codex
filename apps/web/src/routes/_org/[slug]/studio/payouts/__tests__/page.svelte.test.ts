/**
 * Org Studio → Payouts: the page's own wiring of the owner's Stripe balance
 * (Codex-2hxff, web review M2, L2, L3, and the P2 cause line). The rules
 * themselves are payouts-view's, tested there; this checks the page feeds
 * them the right reads and renders what they decide.
 *
 * Mounts the real `+page.svelte`. The remote queries answer with fixed slots
 * shaped like kit's `Query`; only `$app/*` and the remote module are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

interface Slot {
  current: unknown;
  loading: boolean;
  error: unknown;
  refresh: ReturnType<typeof vi.fn>;
}

const slots = vi.hoisted(() => {
  const slot = (current?: unknown): Slot => ({
    current,
    loading: false,
    error: undefined,
    refresh: vi.fn(async () => {}),
  });
  return {
    slot,
    status: slot(),
    balance: slot(),
    table: slot(),
    held: slot(),
    summary: slot(),
    breakdown: slot(),
  };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://hollow-oak.revelations.studio/studio/payouts');
    },
  },
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: vi.fn(() => slots.status),
  getMyStripeBalance: vi.fn(() => slots.balance),
  // The Held card asks for one page of 100 paid rows; the table for 20.
  listPayouts: vi.fn((args: { limit: number }) =>
    args.limit === 100 ? slots.held : slots.table
  ),
  getPayoutSummary: vi.fn(() => slots.summary),
  getPayoutsByCreatorBreakdown: vi.fn(() => slots.breakdown),
}));

import {
  getMyStripeBalance,
  listPayouts,
} from '$lib/remote/subscription.remote';
import PayoutsPage from '../+page.svelte';

const ORG = '11111111-1111-4111-8111-111111111111';
const EMPTY_PAGE = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const CONNECTED = {
  isConnected: true,
  accountId: 'acct_1',
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active',
  requirements: null,
};

const BELOW_ZERO = {
  checkedAt: '2026-10-28T10:00:00.000Z',
  availableCents: -2310,
  pendingCents: 0,
  manualPayouts: true,
  manualPayoutsSince: '2026-09-01T00:00:00.000Z',
  nextPayout: null,
  covering: null,
  negative: {
    owedCents: 2310,
    since: '2026-10-19',
    rule: { kind: 'stripe_writes_off', on: '2027-04-17' },
    causes: [
      {
        causeType: 'dispute',
        cents: 3443,
        on: '2026-10-19',
        title: 'The Making of Hollow Oak',
        organizationId: ORG,
        organisationName: 'Hollow Oak Films',
        payoutTypes: ['organization_fee'],
      },
    ],
  },
  towards: { live: null, lastEpisode: null },
};

/** A London day three days on: a bank day still to come, whenever this runs. */
const SOON = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/** One page of paid rows holding £2.16 of the organisation's share. */
const heldPage = (totalPages = 1) => ({
  items: [
    {
      id: 'held-1',
      payoutType: 'organization_fee',
      status: 'resolved',
      amountCents: 216,
      bankOn: SOON,
    },
  ],
  pagination: { page: 1, limit: 100, total: totalPages * 100, totalPages },
});

const ABOVE_ZERO = { ...BELOW_ZERO, availableCents: 216, negative: null };

let component: ReturnType<typeof mount> | null = null;

function mountPage() {
  component = mount(PayoutsPage, {
    target: document.body,
    props: {
      data: {
        userRole: 'owner',
        org: { id: ORG, name: 'Hollow Oak Films', slug: 'hollow-oak' },
      },
    } as never,
  });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const heldCard = () =>
  document.querySelector<HTMLElement>('[data-testid="payouts-held"]');

beforeEach(() => {
  for (const key of [
    'status',
    'balance',
    'table',
    'held',
    'summary',
    'breakdown',
  ] as const) {
    Object.assign(slots[key], slots.slot());
  }
  slots.status.current = CONNECTED;
  slots.table.current = EMPTY_PAGE;
  slots.held.current = EMPTY_PAGE;
  slots.summary.current = {
    earnedInPeriodCents: 0,
    totalEarnedCents: 0,
    inTransitCents: 0,
    needsAttentionCount: 0,
  };
  slots.breakdown.current = [];
  vi.mocked(getMyStripeBalance).mockClear();
  vi.mocked(listPayouts).mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe("the owner's balance below zero (P2)", () => {
  test("the alert names this organisation's take-back, as the mockup words it", () => {
    slots.balance.current = BELOW_ZERO;
    mountPage();
    expect(text()).toContain(
      "A chargeback on ‘The Making of Hollow Oak’ took back £34.43 of the organisation's share on 19 Oct, after that money had gone to your bank."
    );
    expect(text()).not.toContain(m.payouts_negative_cause());
    expect(heldCard()?.dataset.state).toBe('shown');
    expect(heldCard()?.textContent).toContain(m.payouts_held_covering());
  });
});

describe("the owner's bank line (r3-L1)", () => {
  test('a failed balance read: a passed bank day reads "Due", never "Sent"', () => {
    slots.balance.error = { status: 503, body: { message: 'Unavailable' } };
    slots.table.current = {
      items: [
        {
          id: 'fee-1',
          creatorId: 'owner-1',
          creatorName: 'Hannah Price',
          creatorEmail: 'hannah@example.com',
          creatorAvatarUrl: null,
          amountCents: 216,
          currency: 'gbp',
          reason: 'transferred',
          status: 'resolved',
          resolvedAt: '2026-10-05T10:00:00.000Z',
          stripeTransferId: 'tr_1QaBcDeFgHiJkLmN',
          createdAt: '2026-10-05T10:00:00.000Z',
          payoutType: 'organization_fee',
          subscriberName: null,
          subscriberEmail: null,
          sourceType: 'purchase',
          transferGroup: 'pur_1',
          purchaseId: 'pur_1',
          subscriptionId: null,
          stripeChargeId: 'ch_1',
          bankOn: '2026-10-19',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mountPage();
    expect(document.querySelector('.bank-line')?.textContent).toBe(
      'Due to your bank on 19 Oct'
    );
    expect(text()).not.toContain('Sent to your bank');
  });
});

describe('the Held card (M2, L2, L3)', () => {
  test('while the balance loads: the card shimmers, with no figure and no next day', () => {
    slots.balance.loading = true;
    slots.held.current = heldPage();
    mountPage();
    expect(heldCard()?.dataset.loading).toBe('true');
    expect(heldCard()?.textContent).not.toContain('£');
    expect(text()).not.toContain('Next to your bank');
  });

  test('both reads in: the share held, and the next part that goes to the bank', () => {
    slots.balance.current = ABOVE_ZERO;
    slots.held.current = heldPage();
    mountPage();
    expect(heldCard()?.dataset.state).toBe('shown');
    expect(heldCard()?.textContent).toContain('£2.16');
    expect(heldCard()?.textContent).toContain('Next to your bank: £2.16 on');
  });

  test('Held asks for rows by transfer, so a backlog sale released late is held and next to the bank (R2-L3)', () => {
    slots.balance.current = ABOVE_ZERO;
    // Sold 40 days ago, released yesterday after a late Connect setup.
    slots.held.current = {
      ...heldPage(),
      items: [
        {
          ...heldPage().items[0],
          createdAt: new Date(
            Date.now() - 40 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      ],
    };
    mountPage();
    const heldArgs = vi
      .mocked(listPayouts)
      .mock.calls.map(([args]) => args as Record<string, unknown>)
      .find((args) => args.limit === 100);
    expect(heldArgs?.transferredFrom).toEqual(expect.any(String));
    expect(heldArgs).not.toHaveProperty('fromDate');
    expect(heldCard()?.textContent).toContain('Next to your bank: £2.16 on');
  });

  test('more rows than one page: no total, never a partial sum (L2)', () => {
    slots.balance.current = ABOVE_ZERO;
    slots.held.current = heldPage(2);
    mountPage();
    expect(heldCard()?.dataset.state).toBe('too_many');
    expect(heldCard()?.textContent).toContain(m.payouts_held_too_many());
    expect(heldCard()?.textContent).not.toContain('£');
    expect(text()).not.toContain('Next to your bank');
  });

  test('a failed balance read: "couldn\'t check", no figure and no next day; Try again re-asks only that read', () => {
    slots.balance.error = { status: 503, body: { message: 'Unavailable' } };
    // Rows that would give a figure and a next day, were the failure ignored.
    slots.held.current = heldPage();
    mountPage();
    expect(heldCard()?.dataset.state).toBe('failed');
    expect(heldCard()?.textContent).toContain(m.payouts_held_check_failed());
    expect(heldCard()?.textContent).not.toContain('£');
    expect(text()).not.toContain('Next to your bank');
    const retry = [...(heldCard()?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === m.payouts_held_retry()
    );
    retry?.click();
    expect(slots.balance.refresh).toHaveBeenCalledTimes(1);
    expect(slots.held.refresh).not.toHaveBeenCalled();
    expect(slots.status.refresh).not.toHaveBeenCalled();
  });

  test('an owner with no Connect account: the balance is never asked for, and there is no card', () => {
    slots.status.current = { ...CONNECTED, isConnected: false };
    mountPage();
    expect(getMyStripeBalance).not.toHaveBeenCalled();
    expect(heldCard()).toBeNull();
  });
});
