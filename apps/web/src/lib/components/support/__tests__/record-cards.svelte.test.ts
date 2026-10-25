/**
 * The charge's record (Codex-2hxff.28, mockup B1, B3, B4, C1, D2): "The
 * charge", the split, the refunds, the chargebacks, and a slice's history.
 * Each mounts the real component.
 */

import type { Component } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import {
  chargeDetail,
  creatorDebt,
  historyLine,
  NOW,
  refundRow,
  SLICES,
  slice,
} from '../__fixtures__/support-fixtures';
import ChargebacksCard from '../ChargebacksCard.svelte';
import ChargeSummaryCard from '../ChargeSummaryCard.svelte';
import RefundsCard from '../RefundsCard.svelte';
import SliceHistory from '../SliceHistory.svelte';
import SplitCard from '../SplitCard.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

// `object`, not Record<string, unknown>: a Props interface has no index signature.
function render<P extends object>(C: Component<P>, props: P) {
  component = mount(C, { target: document.body, props });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('The charge', () => {
  test('a purchase: buyer, item, what is left, the window and Stripe’s ids', () => {
    render(ChargeSummaryCard, { detail: chargeDetail(), now: NOW });
    expect(text()).toContain('Ellie Marsh · ellie.marsh@example.com');
    expect(text()).toContain('Sleep Reset Programme · Studio Alpha');
    expect(text()).toContain(
      m.support_amount_partial({
        amount: '£24.00',
        refunded: '£4.00',
        left: '£20.00',
      })
    );
    expect(text()).toContain('ch_3QeT8xLk2vRb09aZ');
    expect(text()).toContain('pi_3QeT8xLk2vRb09aZ');
  });

  test('an invoice: the plan, and that it is the current period’s payment', () => {
    render(ChargeSummaryCard, {
      detail: chargeDetail({
        source: {
          type: 'subscription',
          subscriptionId: 'sub-1',
          planName: 'Inner Circle',
          planDeleted: false,
          interval: 'month',
          periodStart: '2026-10-20T06:00:00.000Z',
          periodEnd: '2026-11-20T07:00:00.000Z',
          status: 'active',
          isCurrentPeriodPayment: true,
        },
      }),
      now: NOW,
    });
    expect(text()).toContain(m.support_kv_subscriber());
    expect(text()).toContain('Inner Circle · Studio Alpha · monthly');
    expect(text()).toContain(
      m.support_period_current({ start: '20 Oct', end: '20 Nov 2026' })
    );
  });

  test('a deleted buyer is labelled, not hidden', () => {
    render(ChargeSummaryCard, {
      detail: chargeDetail({
        buyer: {
          userId: 'u',
          name: 'Ellie Marsh',
          email: 'e@example.com',
          deleted: true,
        },
      }),
      now: NOW,
    });
    expect(text()).toContain('Ellie Marsh');
    expect(text()).toContain(m.support_deleted());
  });

  test('Copy puts the charge id on the clipboard', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(ChargeSummaryCard, { detail: chargeDetail(), now: NOW });
    document
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.support_copy_charge_id()}"]`
      )
      ?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ch_3QeT8xLk2vRb09aZ');
  });
});

describe('How it was split', () => {
  test('one row per slice: who, share, payout, and what was taken back', () => {
    render(SplitCard, { detail: chargeDetail() });
    const rows = [...document.querySelectorAll('[data-testid="slice-row"]')];
    expect(rows).toHaveLength(3);
    const [rowan, studio, fee] = rows.map(
      (row) => row.textContent?.replace(/\s+/g, ' ') ?? ''
    );
    expect(rowan).toContain('Rowan Ellis');
    expect(rowan).toContain(m.support_payout_paid());
    expect(rowan).toContain('tr_3QeT9aLk2v');
    expect(rowan).toContain('£3.24');
    expect(rowan).toContain(m.support_taken_reversed());
    expect(studio).toContain(m.support_payee_org_fee({ name: 'Sam Owner' }));
    expect(studio).toContain(m.support_payout_reason_connect_not_ready());
    expect(studio).toContain(m.support_taken_reduced());
    expect(fee).toContain(m.support_payout_kept());
    expect(fee).toContain('10%');
    // The total is the server's takenCents summed, nothing re-derived.
    expect(document.querySelector('tfoot')?.textContent).toContain('£4.00');
  });

  test('a slice with history opens it underneath', () => {
    const detail = chargeDetail({
      slices: [
        slice({
          history: [historyLine({ outcome: 'taken', amountCents: 324 })],
        }),
        ...SLICES.slice(1),
      ],
    });
    render(SplitCard, { detail });
    expect(document.querySelector('[data-testid="history-line"]')).toBeNull();
    const toggle = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(m.support_history_show())
    );
    toggle?.click();
    flushSync();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.querySelector('[data-testid="history-line"]')
    ).not.toBeNull();
  });
});

describe('Refunds on this charge', () => {
  test('a confirmed refund the webhook has not recorded yet says "Taking back shares…"', () => {
    render(RefundsCard, {
      detail: chargeDetail({
        refunds: [refundRow({ id: 're_new', notifiedAt: null }), refundRow()],
      }),
    });
    const rows = [...document.querySelectorAll('[data-testid="refund-row"]')];
    expect(rows[0].querySelector('[data-testid="taking-back"]')).not.toBeNull();
    expect(rows[0].textContent).toContain(m.support_emailed_not_yet());
    // The older one is emailed: the webhook has been.
    expect(rows[1].querySelector('[data-testid="taking-back"]')).toBeNull();
  });

  test('who made each: support by name, the Dashboard, or the platform', () => {
    render(RefundsCard, {
      detail: chargeDetail({
        refunds: [
          refundRow({ id: 're_a' }),
          refundRow({ id: 're_b', requestedBy: 'dashboard' }),
          refundRow({ id: 're_c', requestedBy: null }),
        ],
      }),
    });
    const rows = [
      ...document.querySelectorAll('[data-testid="refund-row"]'),
    ].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Jordan Reid');
    expect(rows[1]).toContain(m.support_by_dashboard());
    expect(rows[2]).toContain(m.support_by_platform());
  });

  test('Refresh shows only when asked for, and calls back', () => {
    const onRefresh = vi.fn();
    render(RefundsCard, { detail: chargeDetail() });
    expect(text()).not.toContain(m.support_refresh());
    unmount(component as ReturnType<typeof mount>);
    document.body.innerHTML = '';
    render(RefundsCard, { detail: chargeDetail(), onRefresh });
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes(m.support_refresh()))
      ?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('no refunds: "None yet."', () => {
    render(RefundsCard, { detail: chargeDetail({ refunds: [] }) });
    expect(text()).toContain(m.support_refunds_none());
    expect(document.querySelector('table')).toBeNull();
  });
});

describe('Chargebacks', () => {
  test('an open one: needs a response, and by when', () => {
    render(ChargebacksCard, {
      chargebacks: [
        {
          id: 'du_1QhP4mLk2v',
          amountCents: 1800,
          status: 'needs_response',
          reason: 'product_not_received',
          createdAt: '2026-10-22T09:00:00.000Z',
          respondBy: '2026-11-01T09:00:00.000Z',
        },
      ],
    });
    const row = document.querySelector('[data-testid="chargeback-row"]');
    expect(row?.textContent).toContain('Product not received');
    expect(row?.textContent).toContain(m.support_dispute_needs_response());
    expect(row?.textContent).toContain(m.support_respond_by({ date: '1 Nov' }));
    expect(row?.querySelector('[data-variant="error"]')).not.toBeNull();
  });

  test('none: "None on this charge."', () => {
    render(ChargebacksCard, { chargebacks: [] });
    expect(text()).toContain(m.support_chargebacks_none());
  });
});

describe('A slice’s history', () => {
  test('a share taken from the re-pay payout reads so, never "Not taken"', () => {
    const debt = creatorDebt();
    render(SliceHistory, {
      title: 'How Maya’s share was taken back',
      lines: debt.history,
      debtCause: { type: 'refund', id: 're_3QiC9bLk2v' },
    });
    const lines = [
      ...document.querySelectorAll('[data-testid="history-line"]'),
    ];
    const repay = lines.find(
      (line) => line.getAttribute('data-outcome') === 'taken_from_repay'
    );
    expect(repay?.textContent).toContain(m.support_history_taken_from_repay());
    expect(repay?.textContent).not.toContain(m.support_history_not_taken());
    // The debt being viewed is marked as this debt.
    const owed = lines.find(
      (line) => line.getAttribute('data-outcome') === 'owed'
    );
    expect(owed?.textContent).toContain(m.support_history_this_debt());
  });

  test('a settled debt says how it was settled', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [historyLine({ debtResolution: 'platform_absorbed' })],
    });
    expect(text()).toContain(
      m.support_history_settled({
        resolution: m.support_resolution_platform_absorbed(),
      })
    );
    expect(text()).not.toContain(m.support_history_this_debt());
  });
});
