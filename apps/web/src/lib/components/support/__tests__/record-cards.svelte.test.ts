/**
 * The charge's record (Codex-2hxff.28, mockup B1, B3, B4, C1, D2; batch B's
 * mock-b-support C1-C2 and F3): "The charge", the split, the refunds, the
 * chargebacks, and a slice's history.
 * Each mounts the real component.
 */

import type { HistoryLine } from '@codex/admin';
import type { Component } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import {
  chargebackRow,
  chargeDetail,
  creatorDebt,
  historyLine,
  LIFTED_WINDOW,
  lateWonChargeback,
  lateWonHistoryLine,
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

  test('a charge settled by hand: the amount says it was refunded outside Stripe, never "nothing refunded"', () => {
    render(ChargeSummaryCard, {
      detail: chargeDetail({
        charge: { ...chargeDetail().charge, refundedCents: 0 },
        refundable: {
          maxCents: 2400,
          blocked: 'refunded_outside_stripe',
          refundedOutsideStripeOn: '2026-11-08T14:00:00.000Z',
        },
      }),
      now: NOW,
    });
    expect(text()).toContain('£24.00 · refunded outside Stripe on 8 Nov 2026');
    expect(text()).not.toContain(m.support_amount_none({ amount: '£24.00' }));
  });

  test('a window a late win lifted (Q7): no time limit, and never its passed date', () => {
    render(ChargeSummaryCard, {
      detail: chargeDetail({ window: LIFTED_WINDOW }),
      now: NOW,
    });
    expect(text()).toContain('No time limit: the chargeback was won late');
    expect(text()).not.toContain('17 Sep');
    expect(text()).not.toMatch(/days? left/);
  });

  test('an invoice: the plan, and that it is the current period’s payment', () => {
    render(ChargeSummaryCard, {
      detail: chargeDetail({
        source: {
          type: 'subscription',
          subscriptionId: 'sub-1',
          stripeSubscriptionId: 'sub_1PpRwLk2vRb',
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
    // Stripe's own subscription id, never our row's.
    expect(text()).toContain('sub_1PpRwLk2vRb');
    expect(text()).not.toContain('sub-1');
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

  test('a creator’s slice names its agreement’s share, when there was one', () => {
    render(SplitCard, {
      detail: chargeDetail({
        slices: [
          slice({ agreementShareBps: 6000 }),
          slice({
            payoutId: 'payout-maya',
            payee: { userId: 'user-maya', name: 'Maya Chen', deleted: false },
            agreementShareBps: null,
          }),
        ],
      }),
    });
    const [rowan, maya] = [
      ...document.querySelectorAll('[data-testid="slice-row"]'),
    ].map((row) => row.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rowan).toContain(
      m.support_payee_creator_agreement({ share: '60%' })
    );
    expect(maya).toContain(m.support_payee_creator());
    expect(maya).not.toContain('agreement');
  });

  test('the footer and the fee’s rate are the server’s: nothing summed or rounded here', () => {
    render(SplitCard, {
      detail: chargeDetail({
        split: { takenTotalCents: 999, platformFeeShareBps: 1050 },
      }),
    });
    expect(document.querySelector('tfoot')?.textContent).toContain('£9.99');
    const fee = [
      ...document.querySelectorAll('[data-testid="slice-row"]'),
    ].find((row) => row.textContent?.includes(m.support_payee_platform_fee()));
    expect(fee?.textContent).toContain('10.5%');
  });

  test('no fee share from the server: no rate is shown', () => {
    render(SplitCard, {
      detail: chargeDetail({
        split: { takenTotalCents: 400, platformFeeShareBps: null },
      }),
    });
    const fee = [
      ...document.querySelectorAll('[data-testid="slice-row"]'),
    ].find((row) => row.textContent?.includes(m.support_payee_platform_fee()));
    expect(fee?.textContent).not.toContain('%');
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
    // The toggle names the history it opens.
    const controls = toggle?.getAttribute('aria-controls') ?? '';
    expect(controls).not.toBe('');
    const panel = document.getElementById(controls);
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-testid="history-line"]')).not.toBeNull();
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

  test('a failed refund settled refunded elsewhere reads "Refunded another way"; an open or re-paid one still reads "Failed" (Codex-3xnta)', () => {
    const failed = {
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
      failureLabel: 'The card has expired or been cancelled',
    };
    render(RefundsCard, {
      detail: chargeDetail({
        refunds: [
          refundRow({
            id: 're_elsewhere',
            ...failed,
            resolution: 'refunded_elsewhere',
          }),
          refundRow({ id: 're_open', ...failed, resolution: null }),
          refundRow({
            id: 're_repaid',
            ...failed,
            resolution: 'creators_repaid',
          }),
        ],
      }),
    });
    const badgeOf = (id: string) =>
      document
        .querySelector(`[data-testid="refund-row"][data-refund-id="${id}"]`)
        ?.querySelector('.badge');
    expect(badgeOf('re_elsewhere')?.textContent?.trim()).toBe(
      m.support_action_elsewhere()
    );
    expect(m.support_action_elsewhere()).toBe('Refunded another way');
    expect(badgeOf('re_elsewhere')?.getAttribute('data-variant')).toBe(
      'neutral'
    );
    for (const id of ['re_open', 're_repaid']) {
      expect(badgeOf(id)?.textContent?.trim()).toBe(m.support_refund_failed());
      expect(badgeOf(id)?.getAttribute('data-variant')).toBe('error');
    }
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
          lostOn: null,
          lateWonOn: null,
          settling: false,
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

// The mockup's own words (late-win support/charge-page.html), not the
// messages: a word changed in en.json alone must fail here.
describe('A chargeback won after it was lost (late-win S1-S3)', () => {
  const rowText = () =>
    document
      .querySelector('[data-testid="chargeback-row"]')
      ?.textContent?.replace(/\s+/g, ' ') ?? '';
  const badge = () =>
    document.querySelector('[data-testid="chargeback-row"] [data-variant]');

  test('S1: while the creators are paid back, "Won late" is info, and the card says what happens', () => {
    render(ChargebacksCard, {
      chargebacks: [lateWonChargeback({ settling: true })],
    });
    expect(badge()?.textContent?.trim()).toBe('Won late');
    expect(badge()?.getAttribute('data-variant')).toBe('info');
    expect(rowText()).toContain('Paying the creators back');
    expect(rowText()).not.toContain('Lost 20 Nov');
    expect(text()).toContain(
      'The bank decided this chargeback for us on 14 Dec, after it was lost. The creators are being paid back; a step that fails is tried again within the hour.'
    );
  });

  test('S2: once undone, "Won late" is success, says when it was lost, and the card says nothing more', () => {
    render(ChargebacksCard, { chargebacks: [lateWonChargeback()] });
    expect(badge()?.textContent?.trim()).toBe('Won late');
    expect(badge()?.getAttribute('data-variant')).toBe('success');
    expect(rowText()).toContain('Lost 20 Nov');
    expect(rowText()).not.toContain('Paying the creators back');
    expect(text()).not.toContain('The bank decided this chargeback for us');
  });

  test('a normal win is "Won" as before, even while its pay-back runs: "Won late" keys on the late win, never the status', () => {
    render(ChargebacksCard, {
      chargebacks: [
        chargebackRow({ status: 'won', respondBy: null, settling: true }),
      ],
    });
    expect(badge()?.textContent?.trim()).toBe(m.support_dispute_won());
    expect(text()).not.toContain('Won late');
    expect(text()).not.toContain('The bank decided this chargeback for us');
  });

  const history = (lines: HistoryLine[]) => {
    render(SliceHistory, {
      title: 'How Maya Okafor’s share was taken back',
      lines,
    });
    return [...document.querySelectorAll('[data-testid="history-line"]')].map(
      (line) => line.textContent?.replace(/\s+/g, ' ') ?? ''
    );
  };

  test('S1: the cause names the loss, and the line says it is being paid back', () => {
    const [line] = history([
      lateWonHistoryLine({
        outcome: 'taken',
        repayPayoutId: null,
        disputeWonAt: null,
      }),
    ]);
    expect(line).toContain('Chargeback · opened 26 Oct, lost 20 Nov');
    expect(line).not.toContain(', won');
    expect(line).toContain(
      'Taken back while the chargeback was open. Being paid back.'
    );
  });

  test('S2: the cause names all three dates, and the share was paid back', () => {
    const [line] = history([lateWonHistoryLine()]);
    expect(line).toContain(
      'Chargeback · opened 26 Oct, lost 20 Nov, won 14 Dec'
    );
    expect(line).toContain('Taken back, then paid back by a new payout.');
    expect(line).toContain('Paid back');
  });

  test('S3: a share the loss cancelled before it was paid says so', () => {
    const [line] = history([
      lateWonHistoryLine({
        causeAmountCents: 9900,
        amountCents: 1980,
        disputeOpenedAt: '2026-10-27T09:00:00.000Z',
        lostOn: '2026-11-21T10:00:00.000Z',
        stepKind: 'cancellation',
      }),
    ]);
    expect(line).toContain(
      'Chargeback · opened 27 Oct, lost 21 Nov, won 14 Dec'
    );
    expect(line).toContain(
      'Cancelled when the chargeback was lost, then paid back by a new payout.'
    );
  });

  test('a normal win’s line is as before: opened, then won', () => {
    const [line] = history([
      lateWonHistoryLine({ lostOn: null, stepKind: undefined }),
    ]);
    expect(line).toContain('Chargeback · opened 26 Oct, won 14 Dec');
    expect(line).toContain('Taken back, then paid back by a new payout.');
  });

  test('a settled late win’s lines keep the loss date but never say "Being paid back." (S2)', () => {
    // After the undo, the lines still carry `lostOn` (WP-B): only settling
    // is "being paid back", and a line whose win is applied is not settling.
    const lines = history([
      lateWonHistoryLine(),
      lateWonHistoryLine({ stepKind: 'cancellation' }),
      lateWonHistoryLine({ outcome: 'taken', repayPayoutId: null }),
    ]);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain('lost 20 Nov, won 14 Dec');
      expect(line).not.toContain('Being paid back');
    }
  });

  test('a late win whose loss never finished: no loss date, and nothing reads "null"', () => {
    // `lostOn` is present but null when the loss was never applied (WP-B).
    const [line] = history([
      lateWonHistoryLine({
        outcome: 'taken',
        repayPayoutId: null,
        disputeWonAt: null,
        lostOn: null,
      }),
    ]);
    expect(line).toContain('Chargeback · opened 26 Oct');
    expect(line).not.toContain('lost');
    expect(line).not.toContain('null');
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

  test('a chargeback line is dated: when it opened, and when its win was applied', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [
        historyLine({
          causeType: 'dispute',
          causeId: 'du_won',
          disputeOpenedAt: '2026-10-13T09:00:00.000Z',
          disputeWonAt: '2026-10-20T09:00:00.000Z',
          outcome: 'paid_back',
        }),
        historyLine({
          causeType: 'dispute',
          causeId: 'du_open',
          disputeOpenedAt: '2026-10-22T09:00:00.000Z',
        }),
      ],
    });
    const [won, open] = [
      ...document.querySelectorAll('[data-testid="history-line"]'),
    ].map((line) => line.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(won).toContain(
      m.support_history_cause_dispute_won({ opened: '13 Oct', won: '20 Oct' })
    );
    expect(open).toContain(
      m.support_history_cause_dispute_opened({ opened: '22 Oct' })
    );
    expect(open).not.toMatch(/, won /);
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

describe('A late take-back on the charge page (C1, C2)', () => {
  const credit = (overrides = {}) => ({
    creditId: '44444444-4444-4444-8444-444444444444',
    state: 'owed' as const,
    amountCents: 900,
    action: 'repay' as const,
    repayPayout: null,
    ...overrides,
  });
  const lateLine = (overrides = {}) =>
    historyLine({
      causeType: 'dispute',
      causeId: 'du_1QjM3pLk2vSb91tU',
      causeAmountCents: 1200,
      amountCents: 900,
      outcome: 'taken_after_settled',
      disputeOpenedAt: '2026-10-02T09:00:00.000Z',
      disputeWonAt: '2026-10-23T09:00:00.000Z',
      credit: credit(),
      ...overrides,
    });

  test('the line says it was taken after it was settled, and what is owed back to whom', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [lateLine()],
      payeeName: 'Maya Okafor',
    });
    const line = document.querySelector('[data-testid="history-line"]');
    expect(line?.textContent).toContain(
      m.support_history_what_taken_after_settled({
        amount: '£9.00',
        name: 'Maya Okafor',
      })
    );
    expect(line?.textContent).toContain(
      m.support_history_taken_after_settled()
    );
    // Never "Not taken": it was.
    expect(line?.textContent).not.toContain(m.support_history_what_not_taken());
  });

  test('Re-pay is on the line only where the page asks for it, and calls back with the line', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [lateLine()],
      payeeName: 'Maya Okafor',
    });
    expect(document.querySelector('[data-testid="credit-action"]')).toBeNull();
    if (component) unmount(component);
    const onCreditAction = vi.fn();
    const line = lateLine();
    render(SliceHistory, {
      title: 'History',
      lines: [line],
      payeeName: 'Maya Okafor',
      onCreditAction,
    });
    const action = document.querySelector<HTMLButtonElement>(
      '[data-testid="credit-action"]'
    );
    expect(action?.textContent).toContain(
      m.support_repay_submit({ amount: '£9.00' })
    );
    action?.click();
    expect(onCreditAction).toHaveBeenCalledWith(line);
  });

  test('Check Stripe again stays in the queue: a needs-check credit has no button here', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [
        lateLine({
          outcome: 'not_taken',
          credit: credit({
            state: 'needs_check',
            amountCents: null,
            action: 'check',
          }),
        }),
      ],
      payeeName: 'Maya Okafor',
      onCreditAction: vi.fn(),
    });
    expect(document.querySelector('[data-testid="credit-action"]')).toBeNull();
    expect(text()).toContain(m.support_history_needs_check());
  });

  test('once re-paid: paid back by a new payout, waiting for the next run, and no button', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [
        lateLine({
          outcome: 'paid_back',
          credit: credit({
            state: 'repaid',
            action: null,
            repayPayout: { id: 'payout-repay-1', status: 'pending' },
          }),
        }),
      ],
      payeeName: 'Maya Okafor',
      onCreditAction: vi.fn(),
    });
    expect(text()).toContain(m.support_history_what_repaid_late_waiting());
    expect(document.querySelector('[data-testid="credit-action"]')).toBeNull();
  });

  test('the split shows what is owed back, in its own words, never as a debt the payee owes', () => {
    render(SplitCard, {
      detail: chargeDetail({
        slices: [
          slice({
            takenCents: 900,
            owedToPayeeCents: 900,
            history: [lateLine()],
          }),
        ],
      }),
    });
    const owedBack = document.querySelector('table [data-testid="owed-back"]');
    expect(owedBack?.textContent?.trim()).toBe(
      m.support_owed_back({ amount: '£9.00', name: 'Rowan Ellis' })
    );
    expect(document.querySelector('table .owed')).toBeNull();
  });
});

describe('A step the system settled (Q6, F3)', () => {
  test.each([
    ['took_share', 'refund', m.support_history_system_took_share_refund()],
    ['took_share', 'dispute', m.support_history_system_took_share_dispute()],
    ['payee_kept', 'refund', m.support_history_system_payee_kept()],
  ] as const)('%s on a %s line says what the system decided, with its tag', (systemDecision, causeType, said) => {
    render(SliceHistory, {
      title: 'History',
      lines: [historyLine({ causeType, outcome: 'paid_back', systemDecision })],
    });
    const line = document.querySelector('[data-testid="history-line"]');
    expect(line?.textContent).toContain(m.support_history_system_lead());
    expect(line?.textContent).toContain(said);
    expect(line?.textContent).toContain(m.support_history_system_badge());
  });

  test('a line the system did not settle has no such tag', () => {
    render(SliceHistory, { title: 'History', lines: [historyLine()] });
    expect(text()).not.toContain(m.support_history_system_badge());
  });
});

describe('A take-back after the system decided (MED-1, MED-3)', () => {
  test('a reopened credit on a step the system said the payee kept: the line says what is owed back, not "kept"', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [
        historyLine({
          causeType: 'refund',
          outcome: 'taken_after_settled',
          amountCents: 765,
          systemDecision: 'payee_kept',
          credit: {
            creditId: 'c-reopened',
            state: 'owed',
            amountCents: 765,
            action: 'repay',
            repayPayout: null,
          },
        }),
      ],
      payeeName: 'Jonah Reyes',
    });
    const line = document.querySelector('[data-testid="history-line"]');
    expect(line?.textContent).toContain(
      m.support_history_what_taken_after_settled({
        amount: '£7.65',
        name: 'Jonah Reyes',
      })
    );
    expect(line?.textContent).not.toContain(
      m.support_history_system_payee_kept()
    );
    // What the system decided first is still marked.
    expect(line?.textContent).toContain(m.support_history_system_badge());
  });

  test('a step only a person can decide says so, and has no button on the charge page', () => {
    render(SliceHistory, {
      title: 'History',
      lines: [
        historyLine({
          causeType: 'dispute',
          outcome: 'not_taken',
          credit: {
            creditId: 'c-decide',
            state: 'needs_person',
            amountCents: null,
            action: 'decide',
            repayPayout: null,
          },
        }),
      ],
      payeeName: 'Jonah Reyes',
      onCreditAction: vi.fn(),
    });
    expect(text()).toContain(m.support_history_needs_person());
    expect(document.querySelector('[data-testid="credit-action"]')).toBeNull();
  });
});
