/**
 * The queue's pieces and the search results (Codex-2hxff.28, mockup A1, D1,
 * D2, D3; batch B's mock-b-support D1-D2 and O1-O4): the three tables, the
 * three settle dialogs, the tab links, and the charges found. Mounts the real components with the real Dialog; only the
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
  debtPerson,
  failedRefund,
  NOW,
  owedItem,
  refusedDebtPerson,
} from '../__fixtures__/support-fixtures';
import {
  failure,
  httpError,
  reset,
  resolveCreatorDebt,
  resolveFailedRefund,
  resolveOwedToCreator,
} from '../__fixtures__/support-remote.mock.svelte';
import ChargeResults from '../ChargeResults.svelte';
import CreatorDebtsTable from '../CreatorDebtsTable.svelte';
import FailedRefundsTable from '../FailedRefundsTable.svelte';
import OwedToCreatorsTable from '../OwedToCreatorsTable.svelte';
import { targetFromItem } from '../owed-view';
import ResolveCreditDialog from '../ResolveCreditDialog.svelte';
import {
  clearRepayBlocks,
  markRepayBlocked,
  repayBlockReason,
} from '../repay-blocks.svelte';
import SettleDebtDialog from '../SettleDebtDialog.svelte';
import SettleRefundDialog from '../SettleRefundDialog.svelte';
import type { SettleNotice } from '../settle-notice';
import TabLinks from '../TabLinks.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  clearRepayBlocks();
});

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

  test('a refund whose size we hold no record of says so, never "part"', () => {
    render(FailedRefundsTable, {
      items: [failedRefund({ isFull: null })],
      onSettle: vi.fn(),
    });
    const all = text();
    expect(all).toContain(
      m.support_failed_size_unknown_by({ date: '16 Oct', name: 'Jordan Reid' })
    );
    expect(all).toContain(
      m.support_failed_phone_size_unknown({ made: '16 Oct', failed: '21 Oct' })
    );
    expect(all).not.toContain(
      m.support_failed_part_by({ date: '16 Oct', name: 'Jordan Reid' })
    );
    expect(all).not.toContain(
      m.support_failed_phone_part({ made: '16 Oct', failed: '21 Oct' })
    );
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

describe('a row whose re-pay was refused for a later cause', () => {
  test('keeps Re-pay off, says why beside it, and still offers "refunded another way"', () => {
    const blocked = failedRefund();
    const other = failedRefund({
      refundId: '33333333-3333-4333-8333-333333333333',
    });
    markRepayBlocked(blocked.refundId, 'chargeback');
    render(FailedRefundsTable, { items: [blocked, other], onSettle: vi.fn() });
    const [first, second] = [
      ...document.querySelectorAll<HTMLElement>(
        'table [data-testid="failed-refund-row"]'
      ),
    ];
    const buttonIn = (row: HTMLElement, label: string) =>
      [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes(label)
      );
    expect(buttonIn(first, m.support_action_repay())?.disabled).toBe(true);
    expect(
      first.querySelector('[data-testid="repay-off"]')?.textContent
    ).toContain(m.support_repay_off_chargeback());
    expect(buttonIn(first, m.support_action_elsewhere())?.disabled).toBe(false);
    expect(buttonIn(second, m.support_action_repay())?.disabled).toBe(false);
    expect(second.querySelector('[data-testid="repay-off"]')).toBeNull();
  });

  test('one that needs a person says it must be settled by hand', () => {
    markRepayBlocked(failedRefund().refundId, 'needs_person');
    render(FailedRefundsTable, { items: [failedRefund()], onSettle: vi.fn() });
    const row = document.querySelector<HTMLElement>(
      'table [data-testid="failed-refund-row"]'
    );
    expect(
      row?.querySelector('[data-testid="repay-off"]')?.textContent
    ).toContain(m.support_repay_off_needs_person());
  });
});

describe('Creator debts table, one row per person', () => {
  const personRow = () =>
    document.querySelector('[data-testid="creator-debt-person"]');
  const rowText = () => personRow()?.textContent?.replace(/\s+/g, ' ') ?? '';

  test('who owes, what, the live Stripe balance, back so far and where it stands (D1)', () => {
    render(CreatorDebtsTable, { items: [debtPerson()], onSettle: vi.fn() });
    expect(rowText()).toContain('Maya Chen');
    expect(rowText()).toContain(m.support_role_creator());
    expect(rowText()).toContain('£8.40');
    // Stripe's own negative balance, signed, with why bank payouts wait.
    const balance = document.querySelector('[data-testid="stripe-balance"]');
    expect(balance?.textContent).toContain('−£8.40');
    expect(balance?.querySelector('.balance-negative')).not.toBeNull();
    expect(balance?.textContent).toContain(m.support_debts_balance_paused());
    expect(rowText()).toContain('£6.00');
    expect(rowText()).toContain(m.support_debts_state_recovering());
    expect(rowText()).toContain(
      m.support_debts_clock_writes_off({
        date: '24 Apr 2027',
        left: m.support_days_in({ count: '178' }),
      })
    );
    // Its take-back's chargeback is still open.
    expect(rowText()).toContain(m.support_debt_closes_if_won());
  });

  test("Show debts opens the person's debts; a Stripe-held one has no Settle, and its history opens", () => {
    render(CreatorDebtsTable, { items: [debtPerson()], onSettle: vi.fn() });
    expect(document.querySelector('[data-testid="debt-line"]')).toBeNull();
    const toggle = button(m.support_debts_show());
    toggle?.click();
    flushSync();
    const debts = document.getElementById(
      toggle?.getAttribute('aria-controls') ?? ''
    );
    const line = debts?.querySelector('[data-testid="debt-line"]');
    expect(line?.getAttribute('data-held')).toBe('stripe');
    expect(line?.textContent).toContain(m.support_debts_held_stripe());
    expect(line?.textContent).toContain('trr_1QlW3aLk2v');
    expect(line?.textContent).not.toContain(m.support_action_settle());
    expect(debts?.querySelector('[data-testid="history-line"]')).toBeNull();
    [...(debts?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((b) => b.textContent?.includes(m.support_history_show()))
      ?.click();
    flushSync();
    expect(
      debts?.querySelectorAll('[data-testid="history-line"]')
    ).toHaveLength(1);
  });

  test('a balance Stripe could not be read for says so, never £0.00 (D2)', () => {
    render(CreatorDebtsTable, {
      items: [
        debtPerson({
          stripe: {
            availableCents: null,
            pendingCents: null,
            checkedAt: null,
            live: false,
          },
          backCents: null,
        }),
      ],
      onSettle: vi.fn(),
    });
    const balance = document.querySelector('[data-testid="stripe-balance"]');
    expect(balance?.textContent?.trim()).toBe(m.support_debts_balance_unread());
    expect(balance?.textContent).not.toContain('£');
    expect(rowText()).toContain(m.support_debts_as_recorded());
    expect(rowText()).toContain(m.support_debts_back_unknown());
  });

  test('a debt Stripe refused: Settle on its line, and a link to Owed to creators when a take-back paid it (D2)', () => {
    const onSettle = vi.fn();
    const debt = creatorDebt({
      owedCreditId: '44444444-4444-4444-8444-444444444444',
    });
    render(CreatorDebtsTable, {
      items: [refusedDebtPerson({ recordedDebts: [debt] })],
      onSettle,
    });
    expect(rowText()).toContain(m.support_debts_state_needs_settling());
    expect(rowText()).toContain(m.support_debts_clock_refused());
    expect(
      document.querySelector('[data-testid="stripe-balance"]')?.textContent
    ).toContain(m.support_debts_balance_refused());
    button(m.support_debts_show())?.click();
    flushSync();
    const line = document.querySelector('table [data-testid="debt-line"]');
    expect(line?.getAttribute('data-held')).toBe('platform');
    expect(line?.textContent).toContain(m.support_debts_held_platform());
    expect(
      line?.querySelector('a[href="/admin/queue?tab=owed"]')?.textContent
    ).toBe(m.support_debts_count_link());
    [...(line?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((b) => b.textContent?.includes(m.support_action_settle()))
      ?.click();
    expect(onSettle).toHaveBeenCalledWith(debt);
  });

  test('over £50 before 90 days: the invoice clock, in days', () => {
    render(CreatorDebtsTable, {
      items: [
        debtPerson({
          totalOwedCents: 6240,
          stripeOwedCents: 6240,
          clock: {
            kind: 'invoice',
            on: '2027-01-24T07:00:00.000Z',
            daysLeft: 1,
          },
        }),
      ],
      onSettle: vi.fn(),
    });
    expect(rowText()).toContain(
      m.support_debts_clock_invoice({
        date: '24 Jan 2027',
        left: m.support_days_in_one(),
      })
    );
  });
});

describe('Owed to creators table', () => {
  const RUTH = {
    userId: 'user-ruth',
    name: 'Ruth Calder',
    deleted: false,
    role: 'creator' as const,
  };
  const rows = () => [
    owedItem(),
    owedItem({
      creditId: 'c-count',
      payee: RUTH,
      amountCents: 450,
      repayCents: 450,
      stepAmountCents: 450,
      settledAs: 'debt',
      debt: { reviewId: 'r-1', owedCents: 450, resolution: null },
      action: 'count_against_debt',
    }),
    owedItem({
      creditId: 'c-check',
      state: 'needs_check',
      effect: 'unverified',
      amountCents: null,
      repayCents: null,
      stepAmountCents: 1080,
      stripeReversalId: null,
      action: 'check',
    }),
    owedItem({
      creditId: 'c-hand',
      settledAs: 'done',
      action: 'settle_by_hand',
    }),
  ];
  const rowAt = (i: number) =>
    document.querySelectorAll('[data-testid="owed-row"]')[i] as
      | HTMLElement
      | undefined;
  const rowText = (i: number) =>
    rowAt(i)?.textContent?.replace(/\s+/g, ' ') ?? '';
  const mainAction = (i: number) =>
    rowAt(i)?.querySelector<HTMLButtonElement>(
      '[data-testid="owed-main-action"]'
    );

  test('every row: who, what, from what, what happened, one main action and Not owed (O1)', () => {
    render(OwedToCreatorsTable, {
      items: rows(),
      onResolve: vi.fn(),
      onCheck: vi.fn(),
    });
    expect(document.querySelectorAll('[data-testid="owed-row"]')).toHaveLength(
      4
    );

    expect(rowText(0)).toContain('Maya Okafor');
    expect(rowText(0)).toContain(
      m.support_debt_from_chargeback({
        buyer: 'Owen Clarke',
        status: m.support_chargeback_word_won(),
      })
    );
    expect(rowText(0)).toContain(m.support_owed_what_landed_dispute());
    expect(rowText(0)).toContain('trr_1QkR8sLk2vTb41cC');
    expect(mainAction(0)?.textContent).toContain(
      m.support_repay_submit({ amount: '£9.00' })
    );

    expect(rowText(1)).toContain(m.support_owed_what_landed_debt());
    expect(rowText(1)).toContain(
      m.support_owed_debt_open({ name: 'Ruth Calder', amount: '£4.50' })
    );
    expect(mainAction(1)?.textContent).toContain(m.support_owed_action_count());

    // Nothing is owed until Stripe says it took it: the share, "if taken".
    expect(rowText(2)).toContain('£10.80');
    expect(rowText(2)).toContain(m.support_owed_if_taken());
    expect(rowText(2)).toContain(m.support_owed_what_unverified_note());
    expect(mainAction(2)?.textContent).toContain(m.support_owed_action_check());

    // Only a person can settle it: no main action, and it says why.
    expect(mainAction(3)).toBeNull();
    expect(rowText(3)).toContain(m.support_owed_settle_by_hand());

    for (let i = 0; i < 4; i++) {
      expect(rowText(i)).toContain(m.support_owed_action_not_owed());
    }
  });

  test('the main action resolves or checks; Not owed resolves not_owed', () => {
    const onResolve = vi.fn();
    const onCheck = vi.fn();
    const items = rows();
    render(OwedToCreatorsTable, { items, onResolve, onCheck });
    mainAction(0)?.click();
    mainAction(1)?.click();
    mainAction(2)?.click();
    [...(rowAt(3)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((b) => b.textContent?.includes(m.support_owed_action_not_owed()))
      ?.click();
    expect(onResolve.mock.calls).toEqual([
      [items[0], 'repay'],
      [items[1], 'count_against_debt'],
      [items[3], 'not_owed'],
    ]);
    expect(onCheck).toHaveBeenCalledWith(items[2]);
  });

  test('while a check runs: its button is busy, and no other row button can be pressed', () => {
    render(OwedToCreatorsTable, {
      items: rows(),
      onResolve: vi.fn(),
      onCheck: vi.fn(),
      checkingId: 'c-check',
    });
    expect(mainAction(2)?.getAttribute('aria-busy')).toBe('true');
    expect(mainAction(0)?.disabled).toBe(true);
    for (let i = 0; i < 4; i++) {
      const notOwed = [
        ...(rowAt(i)?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ].find((b) => b.textContent?.includes(m.support_owed_action_not_owed()));
      expect(notOwed?.disabled).toBe(true);
    }
  });
});

describe('Resolving money owed to a creator', () => {
  function renderDialog(
    action: 'repay' | 'count_against_debt' | 'not_owed',
    item = owedItem()
  ) {
    const notices: SettleNotice[] = [];
    render(ResolveCreditDialog, {
      target: targetFromItem(item),
      action,
      open: true,
      onFinished: (notice: SettleNotice) => notices.push(notice),
    });
    return notices;
  }

  const done = (
    resolution: 'repaid' | 'debt_collected' | 'not_owed',
    amountCents: number | null
  ) => ({
    outcome: 'done' as const,
    result: {
      creditId: owedItem().creditId,
      resolution,
      resolvedAt: NOW.toISOString(),
      repayPayoutId: resolution === 'repaid' ? 'payout-repay-1' : null,
      amountCents,
      payeeName: 'Maya Okafor',
    },
  });

  test('Re-pay names the person and the amount, shows what Stripe took, and needs no note (O2)', async () => {
    const notices = renderDialog('repay');
    expect(text()).toContain(
      m.support_credit_repay_title({ name: 'Maya Okafor', amount: '£9.00' })
    );
    expect(text()).toContain(
      m.support_credit_repay_taken({
        name: 'Maya Okafor',
        amount: '£9.00',
        after: m.support_credit_after_dispute(),
      })
    );
    expect(text()).toContain('trr_1QkR8sLk2vTb41cC');
    expect(submit()?.textContent).toContain(
      m.support_credit_repay_submit({ amount: '£9.00', name: 'Maya Okafor' })
    );
    resolveOwedToCreator.mockResolvedValue(done('repaid', 900));
    submit()?.click();
    await settled();
    expect(resolveOwedToCreator).toHaveBeenCalledWith({
      creditId: owedItem().creditId,
      body: { action: 'repay', note: '' },
    });
    expect(notices).toEqual([
      {
        variant: 'success',
        text: m.support_credit_repaid({ name: 'Maya Okafor', amount: '£9.00' }),
      },
    ]);
  });

  test('a cancelled unpaid share says it was never paid, not that Stripe took it', () => {
    renderDialog(
      'repay',
      owedItem({
        effect: 'slice_cancelled',
        stripeReversalId: null,
        amountCents: 1215,
        repayCents: 1215,
      })
    );
    expect(text()).toContain(
      m.support_credit_repay_cancelled({
        name: 'Maya Okafor',
        amount: '£12.15',
        after: m.support_credit_after_dispute(),
      })
    );
    expect(text()).not.toContain('trr_');
  });

  test('Count against this debt settles the debt and re-pays nothing (O3)', async () => {
    const notices = renderDialog(
      'count_against_debt',
      owedItem({
        amountCents: 450,
        repayCents: 450,
        settledAs: 'debt',
        action: 'count_against_debt',
      })
    );
    expect(text()).toContain(
      m.support_credit_count_title({ name: 'Maya Okafor', amount: '£4.50' })
    );
    resolveOwedToCreator.mockResolvedValue(done('debt_collected', 450));
    submit()?.click();
    await settled();
    expect(notices[0]?.text).toBe(
      m.support_credit_counted({ name: 'Maya Okafor', amount: '£4.50' })
    );
  });

  test('Not owed needs a note: an empty one sends nothing (O4)', async () => {
    const notices = renderDialog('not_owed');
    expect(text()).toContain(
      m.support_credit_not_owed_title({ name: 'Maya Okafor', amount: '£9.00' })
    );
    submit()?.click();
    await settled();
    expect(resolveOwedToCreator).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_note_missing());
    resolveOwedToCreator.mockResolvedValue(done('not_owed', null));
    typeNote('Paid back by bank transfer on 27 Oct.');
    submit()?.click();
    await settled();
    expect(resolveOwedToCreator).toHaveBeenCalledWith({
      creditId: owedItem().creditId,
      body: {
        action: 'not_owed',
        note: 'Paid back by bank transfer on 27 Oct.',
      },
    });
    expect(notices[0]?.text).toBe(
      m.support_credit_not_owed_done({ name: 'Maya Okafor' })
    );
  });

  test.each([
    ['ALREADY_SETTLED', 409, m.support_settle_already()],
    ['CREDIT_DEBT_STILL_OPEN', 409, m.support_credit_changed()],
    ['CREDIT_DEBT_ALREADY_CLOSED', 409, m.support_credit_changed()],
    ['CREDIT_NEEDS_CHECK', 422, m.support_credit_changed()],
    ['CREDIT_SETTLE_BY_HAND', 422, m.support_credit_settle_by_hand()],
  ] as const)('%s closes the dialog with a notice: nothing is paid twice', async (detailsCode, status, said) => {
    resolveOwedToCreator.mockResolvedValue(failure({ status, detailsCode }));
    const notices = renderDialog('repay');
    submit()?.click();
    await settled();
    expect(notices).toEqual([{ variant: 'info', text: said }]);
  });

  test('another take-back still running on the slice: the dialog stays open and says so, and nothing reloads', async () => {
    resolveOwedToCreator.mockResolvedValue(
      failure({ status: 422, detailsCode: 'CREDIT_SIBLING_UNFINISHED' })
    );
    const notices = renderDialog(
      'repay',
      owedItem({
        state: 'needs_person',
        effect: 'unverified',
        amountCents: null,
        repayCents: 1215,
        stripeReversalId: null,
        action: 'decide',
      })
    );
    typeNote('Stripe shows no transfer for this share.');
    submit()?.click();
    await settled();
    // No notice: the list is not reloaded, and the row stays as it was.
    expect(notices).toEqual([]);
    const problem = document.querySelector<HTMLElement>(
      '[data-testid="settle-problem"]'
    );
    expect(problem?.dataset.problem).toBe('sibling_unfinished');
    expect(problem?.textContent).toContain(
      m.support_credit_sibling_unfinished()
    );
  });

  test('a failure keeps the dialog open and says so', async () => {
    resolveOwedToCreator.mockResolvedValue(
      failure({ status: 500, code: null })
    );
    const notices = renderDialog('repay');
    submit()?.click();
    await settled();
    expect(notices).toEqual([]);
    expect(
      document.querySelector<HTMLElement>('[data-testid="settle-problem"]')
        ?.dataset.problem
    ).toBe('failed');
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
        systemSettled: [],
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
        systemSettled: [],
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

  test.each([
    ['nothing in the way', failedRefund(), 'restores'],
    [
      'a chargeback holding it',
      failedRefund({ accessRestoreBlockedReason: 'dispute_holds' }),
      'blocked',
    ],
    [
      'a part refund',
      failedRefund({ isFull: false, accessRestoreBlockedReason: 'partial' }),
      'nothing',
    ],
    [
      'an invoice',
      failedRefund({
        kind: 'subscription_invoice',
        accessRestoreBlockedReason: 'no_purchase',
      }),
      'subscription',
    ],
  ] as const)('before re-paying, the dialog says what the server predicts for access: %s', (_case, item, expected) => {
    renderDialog('creators_repaid', item);
    const restores = m.support_repay_access_lead({ buyer: 'Daniel Price' });
    const blockedLine = m.support_access_kept_dispute({
      buyer: 'Daniel Price',
    });
    const subscription = m.support_repay_subscription();
    expect(text().includes(restores)).toBe(expected === 'restores');
    expect(text().includes(blockedLine)).toBe(expected === 'blocked');
    expect(text().includes(subscription)).toBe(expected === 'subscription');
    expect(
      document.querySelector('[data-testid="repay-access-blocked"]') !== null
    ).toBe(expected === 'blocked');
  });

  test('re-paid after the system settled a stuck take-back: the notice says so, last (F2)', async () => {
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
        systemSettled: [
          { payoutId: 'p1', payeeName: 'Rowan Ellis', decision: 'took_share' },
        ],
      },
    });
    const notices = renderDialog('creators_repaid');
    typeNote('Kept the programme.');
    submit()?.click();
    await settled();
    expect(
      notices[0]?.text.endsWith(
        m.support_settled_system_one({ name: 'Rowan Ellis' })
      )
    ).toBe(true);
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
        systemSettled: [],
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
    // Refused for good: no retry from here, and the row remembers why.
    expect(submit()?.disabled).toBe(true);
    expect(repayBlockReason(failedRefund().refundId)).toBe(reason);
    // Re-paying won't happen, so nothing is said of what it would do.
    expect(text()).not.toContain(
      m.support_repay_access_lead({ buyer: 'Daniel Price' })
    );
  });

  test('a clawback step only a person can read: settle it by hand, and Re-pay stays off', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({ detailsCode: 'REFUND_CLAWBACK_NEEDS_PERSON' })
    );
    const notices = renderDialog('creators_repaid');
    typeNote('Re-pay.');
    submit()?.click();
    await settled();
    const problem = document.querySelector('[data-testid="settle-problem"]');
    expect(problem?.getAttribute('data-problem')).toBe('needs_person');
    expect(problem?.getAttribute('data-variant')).toBe('warning');
    expect(problem?.textContent).toContain(m.support_repay_needs_person_lead());
    expect(problem?.textContent).toContain(m.support_repay_needs_person_body());
    expect(notices).toHaveLength(0);
    expect(submit()?.disabled).toBe(true);
    expect(repayBlockReason(failedRefund().refundId)).toBe('needs_person');
    expect(text()).not.toContain(
      m.support_repay_access_lead({ buyer: 'Daniel Price' })
    );
  });

  test('a prediction the server couldn’t make says so, and promises nothing', () => {
    renderDialog(
      'creators_repaid',
      failedRefund({ accessRestoreBlockedReason: 'unknown' })
    );
    expect(
      document.querySelector('[data-testid="repay-access-blocked"]')
        ?.textContent
    ).toContain(m.support_repay_access_unknown({ buyer: 'Daniel Price' }));
    // No promise of access back: the "gets access back" alert is not shown.
    expect(text()).not.toContain(
      m.support_repay_access_body({ title: 'Sleep Reset Programme' })
    );
  });

  test('a refusal to try again later keeps the access prediction', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({ detailsCode: 'REFUND_CLAWBACK_UNFINISHED' })
    );
    renderDialog('creators_repaid');
    expect(text()).toContain(
      m.support_repay_access_lead({ buyer: 'Daniel Price' })
    );
    typeNote('Re-pay.');
    submit()?.click();
    await settled();
    expect(text()).toContain(m.support_settle_clawback_running());
    expect(text()).toContain(
      m.support_repay_access_lead({ buyer: 'Daniel Price' })
    );
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
        systemSettled: [],
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

  test.each([
    ['a failure', () => failure({ status: 500 }), 'failed'],
    [
      'a 401',
      () => failure({ status: 401, code: 'UNAUTHORIZED' }),
      'session_ended',
    ],
  ])('%s keeps it open, says why, and takes focus there', async (_what, answer, kind) => {
    resolveCreatorDebt.mockResolvedValue(answer());
    renderDialog();
    radios()[1].click();
    flushSync();
    submit()?.focus();
    submit()?.click();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const problem = document.querySelector<HTMLElement>(
      '[data-testid="settle-problem"]'
    );
    expect(problem?.dataset.problem).toBe(kind);
    expect(document.activeElement).toBe(problem);
  });

  test('a settle the guard refused (a 404, no code) says the session ended', async () => {
    resolveCreatorDebt.mockRejectedValue(httpError(404, 'Not Found'));
    renderDialog();
    radios()[1].click();
    flushSync();
    submit()?.click();
    await settled();
    expect(
      document.querySelector<HTMLElement>('[data-testid="settle-problem"]')
        ?.dataset.problem
    ).toBe('session_ended');
    expect(text()).toContain(m.support_settle_session_ended());
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

describe('A row the ledger cannot attribute: check in Stripe, then decide (MED-3)', () => {
  const decideRow = () =>
    owedItem({
      creditId: 'c-decide',
      state: 'needs_person',
      effect: 'unverified',
      amountCents: null,
      repayCents: 1215,
      // The step's whole share; Re-pay pays it less its done reductions.
      stepAmountCents: 1500,
      stripeReversalId: null,
      action: 'decide',
    });

  test('the row: the share it would pay "if it is owed", why, and Re-pay beside Not owed', () => {
    const onResolve = vi.fn();
    render(OwedToCreatorsTable, {
      items: [decideRow()],
      onResolve,
      onCheck: vi.fn(),
    });
    const row = document.querySelector('[data-testid="owed-row"]');
    const said = row?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(said).toContain('£12.15');
    expect(said).not.toContain('£15.00');
    expect(said).toContain(m.support_owed_if_owed());
    expect(said).toContain(m.support_owed_what_needs_person());
    expect(said).toContain(m.support_owed_what_needs_person_note());
    const main = row?.querySelector<HTMLButtonElement>(
      '[data-testid="owed-main-action"]'
    );
    expect(main?.textContent).toContain(
      m.support_repay_submit({ amount: '£12.15' })
    );
    main?.click();
    expect(onResolve).toHaveBeenCalledWith(decideRow(), 'repay');
  });

  test('Re-pay needs a note of what was seen in Stripe: an empty one sends nothing', async () => {
    const notices: SettleNotice[] = [];
    render(ResolveCreditDialog, {
      target: targetFromItem(decideRow()),
      action: 'repay',
      open: true,
      onFinished: (notice: SettleNotice) => notices.push(notice),
    });
    expect(text()).toContain(m.support_credit_note_label_decide());
    expect(text()).toContain(
      m.support_credit_decide_body({ name: 'Maya Okafor', amount: '£12.15' })
    );
    submit()?.click();
    await settled();
    expect(resolveOwedToCreator).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_note_missing());

    resolveOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId: 'c-decide',
        resolution: 'repaid',
        resolvedAt: NOW.toISOString(),
        repayPayoutId: 'payout-repay-2',
        amountCents: 1215,
        payeeName: 'Maya Okafor',
      },
    });
    typeNote('Stripe shows no transfer for this share.');
    submit()?.click();
    await settled();
    expect(resolveOwedToCreator).toHaveBeenCalledWith({
      creditId: 'c-decide',
      body: {
        action: 'repay',
        note: 'Stripe shows no transfer for this share.',
      },
    });
    expect(notices[0]?.text).toBe(
      m.support_credit_repaid({ name: 'Maya Okafor', amount: '£12.15' })
    );
  });

  test('the server asking for the note keeps the dialog open on it', async () => {
    resolveOwedToCreator.mockResolvedValue(
      failure({ status: 422, detailsCode: 'CREDIT_NOTE_REQUIRED' })
    );
    const notices: SettleNotice[] = [];
    render(ResolveCreditDialog, {
      target: targetFromItem(decideRow()),
      action: 'repay',
      open: true,
      onFinished: (notice: SettleNotice) => notices.push(notice),
    });
    typeNote(' ');
    // A blank note is caught before sending; a note the server still refuses
    // (it trims) is shown the same way.
    typeNote('x');
    submit()?.click();
    await settled();
    expect(notices).toEqual([]);
    expect(text()).toContain(m.support_note_missing());
  });
});

describe('A debt over £50 Stripe collected from the platform (AMENDMENT 2)', () => {
  test('it stays To invoice, says what Stripe collected and when, and has no lines to open', () => {
    render(CreatorDebtsTable, {
      items: [
        debtPerson({
          stripe: {
            availableCents: 0,
            pendingCents: 0,
            checkedAt: '2026-10-24T09:40:00.000Z',
            live: true,
          },
          stripeOwedCents: 0,
          negativeSince: null,
          backCents: null,
          stripeHeld: [],
          collectedCents: 6240,
          collectedAt: '2027-04-24T07:00:00.000Z',
          totalOwedCents: 6240,
          state: 'to_invoice',
          clock: null,
          oldestAt: '2027-04-24T07:00:00.000Z',
        }),
      ],
      onSettle: vi.fn(),
    });
    const row = document.querySelector('[data-testid="creator-debt-person"]');
    const said = row?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(said).toContain(m.support_debts_state_to_invoice());
    expect(said).toContain(
      m.support_debts_collected({ amount: '£62.40', date: '24 Apr 2027' })
    );
    expect(said).toContain('£62.40');
    expect(button(m.support_debts_show())).toBeUndefined();
  });
});

describe('CONTRACT CHANGE 3: collected and below zero again, one row', () => {
  test("both the collected line and the new balance's clock, on one row, with its debts to open", () => {
    render(CreatorDebtsTable, {
      items: [
        debtPerson({
          collectedCents: 6240,
          collectedAt: '2027-04-24T07:00:00.000Z',
          totalOwedCents: 7080,
          state: 'to_invoice',
        }),
      ],
      onSettle: vi.fn(),
    });
    const rows = document.querySelectorAll(
      '[data-testid="creator-debt-person"]'
    );
    expect(rows).toHaveLength(1);
    const said = rows[0]?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(said).toContain(m.support_debts_state_to_invoice());
    expect(said).toContain('£70.80');
    expect(said).toContain(
      m.support_debts_collected({ amount: '£62.40', date: '24 Apr 2027' })
    );
    // The new negative balance keeps its own Q4 clock and Stripe figure.
    expect(said).toContain(
      m.support_debts_clock_writes_off({
        date: '24 Apr 2027',
        left: m.support_days_in({ count: '178' }),
      })
    );
    expect(said).toContain('−£8.40');
    expect(button(m.support_debts_show())).toBeDefined();
  });
});

describe('CONTRACT CHANGE 4: the row shows the action the server sends', () => {
  test('a needs-person row whose sibling step is done offers no Re-pay: settle it by hand, then Not owed', () => {
    render(OwedToCreatorsTable, {
      items: [
        owedItem({
          creditId: 'c-person-hand',
          state: 'needs_person',
          effect: 'unverified',
          amountCents: null,
          repayCents: 1215,
          stripeReversalId: null,
          action: 'settle_by_hand',
        }),
      ],
      onResolve: vi.fn(),
      onCheck: vi.fn(),
    });
    const row = document.querySelector('[data-testid="owed-row"]');
    expect(row?.querySelector('[data-testid="owed-main-action"]')).toBeNull();
    expect(row?.textContent).toContain(m.support_owed_settle_by_hand());
    expect(row?.textContent).toContain(m.support_owed_action_not_owed());
  });

  test('a needs-check row offers Check Stripe again, whatever its effect', () => {
    render(OwedToCreatorsTable, {
      items: [
        owedItem({
          creditId: 'c-check-cancelled',
          state: 'needs_check',
          effect: 'slice_cancelled',
          amountCents: null,
          repayCents: null,
          stepAmountCents: 1215,
          stripeReversalId: null,
          action: 'check',
        }),
      ],
      onResolve: vi.fn(),
      onCheck: vi.fn(),
    });
    const row = document.querySelector('[data-testid="owed-row"]');
    expect(
      row?.querySelector('[data-testid="owed-main-action"]')?.textContent
    ).toContain(m.support_owed_action_check());
    expect(row?.textContent).toContain(m.support_owed_what_unverified());
  });
});
