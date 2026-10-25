/**
 * The queue's pieces and the search results (Codex-2hxff.28, mockup A1, D1,
 * D2, D3): the two tables, the two settle dialogs, the tab links, and the
 * charges found. Mounts the real components with the real Dialog; only the
 * remote module is the reactive double.
 */

import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$lib/remote/support.remote',
  () => import('../__fixtures__/support-remote.mock.svelte')
);

import {
  chargeSummary,
  creatorDebt,
  failedRefund,
  NOW,
} from '../__fixtures__/support-fixtures';
import {
  failure,
  reset,
  resolveCreatorDebt,
  resolveFailedRefund,
} from '../__fixtures__/support-remote.mock.svelte';
import ChargeResults from '../ChargeResults.svelte';
import CreatorDebtsTable from '../CreatorDebtsTable.svelte';
import FailedRefundsTable from '../FailedRefundsTable.svelte';
import SettleDebtDialog from '../SettleDebtDialog.svelte';
import SettleRefundDialog from '../SettleRefundDialog.svelte';
import type { SettleNotice } from '../settle-notice';
import TabLinks from '../TabLinks.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

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
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label)
  );
const submit = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="settle-submit"]');

async function settled() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

function typeNote(value: string) {
  const area = document.querySelector<HTMLTextAreaElement>('textarea');
  if (!area) throw new Error('no note');
  area.value = value;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('Failed refunds table', () => {
  test('a row: when, who, the charge, the refund, why, what was taken, two actions', () => {
    const onSettle = vi.fn();
    render(FailedRefundsTable, { items: [failedRefund()], onSettle });
    const row = document.querySelector('[data-testid="failed-refund-row"]');
    const rowText = row?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(rowText).toContain('Daniel Price');
    expect(rowText).toContain('Sleep Reset Programme · 12 Oct · £24.00');
    expect(rowText).toContain(
      m.support_failed_full_by({ date: '16 Oct', name: 'Jordan Reid' })
    );
    expect(rowText).toContain('The card has expired or been cancelled');
    expect(rowText).toContain('expired_or_canceled_card');
    expect(rowText).toContain('£21.60');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/refunds/ch_3QdP7aLk2vRb11aA'
    );

    row?.querySelector<HTMLButtonElement>('button')?.click();
    expect(onSettle).toHaveBeenCalledWith(failedRefund(), 'refunded_elsewhere');
  });

  test('the charge line: an invoice says so, and a date we hold no record of is left out', () => {
    render(FailedRefundsTable, {
      items: [
        failedRefund({
          kind: 'subscription_invoice',
          title: 'Inner Circle',
          chargeAmountCents: 1200,
          chargePaidAt: '2026-10-02T06:00:00.000Z',
        }),
        failedRefund({ refundId: 'r-2', chargePaidAt: null }),
      ],
      onSettle: vi.fn(),
    });
    const links = [
      ...document.querySelectorAll('table [data-testid="failed-refund-row"] a'),
    ].map((a) => a.textContent?.replace(/\s+/g, ' ').trim());
    expect(links).toEqual([
      'Inner Circle invoice · 2 Oct · £12.00',
      'Sleep Reset Programme · £24.00',
    ]);
  });
});

describe('Creator debts table', () => {
  test('who owes, from what, why, and the history on request', () => {
    render(CreatorDebtsTable, { items: [creatorDebt()], onSettle: vi.fn() });
    const row = document.querySelector('[data-testid="creator-debt-row"]');
    const rowText = row?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(rowText).toContain('Maya Chen');
    expect(rowText).toContain(m.support_role_creator());
    expect(rowText).toContain('£8.10');
    expect(rowText).toContain(
      m.support_debt_from_refund({ buyer: 'Grace Liu', amount: '£10.00' })
    );
    expect(rowText).toContain('slice_repaid');
    expect(document.querySelector('[data-testid="history-line"]')).toBeNull();
    const toggle = button(m.support_history_show());
    toggle?.click();
    flushSync();
    // The toggle names the history it opens.
    const controls = toggle?.getAttribute('aria-controls') ?? '';
    expect(
      document
        .getElementById(controls)
        ?.querySelectorAll('[data-testid="history-line"]')
    ).toHaveLength(3);
    // The table's copy (jsdom applies no media query, so the phone list's
    // copy renders too).
    expect(
      document
        .querySelector('table')
        ?.querySelectorAll('[data-testid="history-line"]')
    ).toHaveLength(3);
  });

  test('a debt from an open chargeback says it closes by itself if won', () => {
    render(CreatorDebtsTable, {
      items: [
        creatorDebt({
          cause: {
            type: 'dispute',
            id: 'du_1',
            amountCents: 1800,
            disputeStatus: 'needs_response',
          },
        }),
      ],
      onSettle: vi.fn(),
    });
    expect(text()).toContain(m.support_debt_closes_if_won());
    expect(text()).toContain(
      m.support_debt_from_chargeback({
        buyer: 'Grace Liu',
        status: m.support_chargeback_word_open(),
      })
    );
  });
});

describe('Settling a failed refund', () => {
  function renderDialog(
    resolution: 'refunded_elsewhere' | 'creators_repaid',
    item = failedRefund()
  ) {
    const notices: SettleNotice[] = [];
    render(SettleRefundDialog, {
      item,
      resolution,
      open: true,
      onFinished: (notice: SettleNotice) => notices.push(notice),
    });
    return notices;
  }

  test('re-paying needs a note: an empty one sends nothing', async () => {
    renderDialog('creators_repaid');
    expect(text()).toContain(m.support_repay_title({ buyer: 'Daniel Price' }));
    submit()?.click();
    await settled();
    expect(resolveFailedRefund).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_note_missing());

    resolveFailedRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refundId: failedRefund().refundId,
        resolution: 'creators_repaid',
        resolvedAt: NOW.toISOString(),
        repaid: [
          { payoutId: 'p1', payeeName: 'Rowan Ellis', amountCents: 1944 },
        ],
        accessRestored: true,
        accessNotRestoredReason: null,
      },
    });
    typeNote('Daniel asked to keep the programme instead.');
    submit()?.click();
    await settled();
    expect(resolveFailedRefund).toHaveBeenCalledWith({
      refundId: failedRefund().refundId,
      body: {
        resolution: 'creators_repaid',
        note: 'Daniel asked to keep the programme instead.',
      },
    });
  });

  test('a full purchase refund re-paid says the buyer gets access back, before and after', async () => {
    const notices = renderDialog('creators_repaid');
    expect(text()).toContain(
      m.support_repay_access_lead({ buyer: 'Daniel Price' })
    );
    resolveFailedRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refundId: failedRefund().refundId,
        resolution: 'creators_repaid',
        resolvedAt: NOW.toISOString(),
        repaid: [
          { payoutId: 'p1', payeeName: 'Rowan Ellis', amountCents: 1944 },
        ],
        accessRestored: true,
        accessNotRestoredReason: null,
      },
    });
    typeNote('Kept the programme.');
    submit()?.click();
    await settled();
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain(
      m.support_settled_repaid({ list: 'Rowan Ellis £19.44' })
    );
    expect(notices[0].text).toContain(
      m.support_settled_access({
        buyer: 'Daniel Price',
        title: 'Sleep Reset Programme',
      })
    );
  });

  test('"refunded another way" needs no note', async () => {
    resolveFailedRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refundId: failedRefund().refundId,
        resolution: 'refunded_elsewhere',
        resolvedAt: NOW.toISOString(),
        repaid: [],
        accessRestored: false,
        accessNotRestoredReason: null,
      },
    });
    const notices = renderDialog('refunded_elsewhere');
    submit()?.click();
    await settled();
    expect(resolveFailedRefund).toHaveBeenCalledWith({
      refundId: failedRefund().refundId,
      body: { resolution: 'refunded_elsewhere', note: '' },
    });
    expect(notices[0]).toEqual({
      variant: 'success',
      text: m.support_settled_elsewhere({ buyer: 'Daniel Price' }),
    });
  });

  test.each([
    ['chargeback', 'blocked_chargeback', m.support_repay_blocked_chargeback()],
    [
      'later_refunds',
      'blocked_later_refunds',
      m.support_repay_blocked_later_refunds(),
    ],
  ] as const)('a later cause (%s) that took the shares too refuses re-paying, and the dialog stays', async (reason, problemKind, body) => {
    resolveFailedRefund.mockResolvedValue(
      failure({ detailsCode: 'REPAY_BLOCKED_BY_LATER_CAUSE', reason })
    );
    const notices = renderDialog('creators_repaid');
    typeNote('Re-pay.');
    submit()?.click();
    await settled();
    const problem = document.querySelector('[data-testid="settle-problem"]');
    expect(problem?.getAttribute('data-problem')).toBe(problemKind);
    expect(problem?.getAttribute('data-variant')).toBe('warning');
    expect(problem?.textContent).toContain(m.support_repay_blocked_lead());
    expect(problem?.textContent).toContain(body);
    expect(notices).toHaveLength(0);
  });

  test.each([
    ['dispute_holds', m.support_access_kept_dispute({ buyer: 'Daniel Price' })],
    ['rebought', m.support_access_kept_rebought({ buyer: 'Daniel Price' })],
    ['duplicate', m.support_access_kept_duplicate()],
  ] as const)('re-paid without access back (%s): the notice says why', async (accessNotRestoredReason, why) => {
    resolveFailedRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refundId: failedRefund().refundId,
        resolution: 'creators_repaid',
        resolvedAt: NOW.toISOString(),
        repaid: [
          { payoutId: 'p1', payeeName: 'Rowan Ellis', amountCents: 1944 },
        ],
        accessRestored: false,
        accessNotRestoredReason,
      },
    });
    const notices = renderDialog('creators_repaid');
    typeNote('Kept the programme.');
    submit()?.click();
    await settled();
    expect(notices[0].text).toContain(
      m.support_settled_repaid({ list: 'Rowan Ellis £19.44' })
    );
    expect(notices[0].text).toContain(why);
    expect(notices[0].text).not.toContain(
      m.support_settled_access({
        buyer: 'Daniel Price',
        title: 'Sleep Reset Programme',
      })
    );
  });

  test('a clawback still running is a calm "try again later", and the dialog stays', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({ detailsCode: 'REFUND_CLAWBACK_UNFINISHED' })
    );
    const notices = renderDialog('creators_repaid');
    typeNote('Re-pay.');
    submit()?.click();
    await settled();
    const problem = document.querySelector('[data-testid="settle-problem"]');
    expect(problem?.getAttribute('data-problem')).toBe('clawback_running');
    expect(problem?.getAttribute('data-variant')).toBe('info');
    expect(problem?.textContent).toContain(m.support_settle_clawback_running());
    expect(notices).toHaveLength(0);
  });

  test('already settled another way closes, and says the list is up to date', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({ status: 409, code: 'CONFLICT', detailsCode: 'ALREADY_SETTLED' })
    );
    const notices = renderDialog('refunded_elsewhere');
    submit()?.click();
    await settled();
    expect(notices).toEqual([
      { variant: 'info', text: m.support_settle_already() },
    ]);
  });
});

describe('Settling a creator debt', () => {
  function renderDialog(item = creatorDebt()) {
    const notices: SettleNotice[] = [];
    render(SettleDebtDialog, {
      item,
      open: true,
      onFinished: (notice: SettleNotice) => notices.push(notice),
    });
    return notices;
  }

  const radios = () => [
    ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];

  test('three answers, none chosen, and never "dispute won"', () => {
    renderDialog();
    expect(radios().map((r) => r.value)).toEqual([
      'creator_absorbed',
      'platform_absorbed',
      'manually_reversed',
    ]);
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(radios().some((r) => r.value === 'dispute_won')).toBe(false);
  });

  test('nothing chosen sends nothing', async () => {
    renderDialog();
    submit()?.click();
    await settled();
    expect(resolveCreatorDebt).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_debt_choose());
  });

  test('"reversed by hand" needs a note; the platform absorbing it does not', async () => {
    resolveCreatorDebt.mockResolvedValue({
      outcome: 'done',
      result: {
        reviewId: creatorDebt().reviewId,
        resolution: 'platform_absorbed',
        resolvedAt: NOW.toISOString(),
      },
    });
    renderDialog();
    radios()[2].click();
    flushSync();
    submit()?.click();
    await settled();
    expect(resolveCreatorDebt).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_note_missing());

    radios()[1].click();
    flushSync();
    submit()?.click();
    await settled();
    expect(resolveCreatorDebt).toHaveBeenCalledWith({
      reviewId: creatorDebt().reviewId,
      body: { resolution: 'platform_absorbed', note: '' },
    });
  });

  test('on a chargeback’s debt, absorbing it says a win pays nothing back', () => {
    renderDialog(
      creatorDebt({
        cause: {
          type: 'dispute',
          id: 'du_1',
          amountCents: 1800,
          disputeStatus: 'needs_response',
        },
      })
    );
    expect(text()).toContain(
      m.support_debt_option_platform_absorbed_dispute({ name: 'Maya Chen' })
    );
  });
});

describe('Tab links', () => {
  test('the current one is aria-current; a count shows as a badge and is spoken', () => {
    render(TabLinks, {
      label: 'Support',
      kicker: 'Support',
      items: [
        { href: '/admin/refunds', label: 'Refunds', current: true },
        {
          href: '/admin/queue',
          label: 'Queue',
          current: false,
          count: 5,
          countLabel: '5 waiting',
        },
      ],
    });
    const links = [...document.querySelectorAll('a')];
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].getAttribute('aria-current')).toBeNull();
    expect(
      links[1].querySelector('[data-variant="warning"]')?.textContent
    ).toBe('5');
    expect(links[1].querySelector('.sr-only')?.textContent).toBe('5 waiting');
  });

  test('a zero or missing count shows no badge', () => {
    render(TabLinks, {
      label: 'Queue sections',
      items: [
        {
          href: '/admin/queue',
          label: 'Failed refunds',
          current: true,
          count: 0,
        },
      ],
    });
    expect(document.querySelector('[data-variant="warning"]')).toBeNull();
  });
});

describe('The charges found', () => {
  test('a row links to its charge, with the refund note and the window', () => {
    render(ChargeResults, { items: [chargeSummary()], now: NOW });
    const row = document.querySelector('[data-testid="charge-row"]');
    const rowText = row?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(row?.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/refunds/ch_3QeT8xLk2vRb09aZ'
    );
    expect(rowText).toContain(m.support_refunded_note({ amount: '£4.00' }));
    expect(rowText).toContain(m.support_window_open());
  });

  test('a payment Stripe names no charge for is listed but cannot be opened', () => {
    render(ChargeResults, {
      items: [chargeSummary({ chargeId: null })],
      now: NOW,
    });
    const row = document.querySelector('[data-testid="charge-row"]');
    expect(row?.querySelector('a')).toBeNull();
    expect(row?.textContent).toContain(m.support_no_charge_id());
  });

  test('a deleted item and a lost chargeback are labelled, not hidden', () => {
    render(ChargeResults, {
      items: [chargeSummary({ titleDeleted: true, chargeback: 'lost' })],
      now: NOW,
    });
    const row = document.querySelector('[data-testid="charge-row"]');
    expect(row?.textContent).toContain(m.support_deleted());
    expect(row?.textContent).toContain(m.support_chargeback_lost());
  });
});
