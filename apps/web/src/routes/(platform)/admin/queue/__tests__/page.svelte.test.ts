/**
 * /admin/queue (Codex-2hxff.28, mockup D1–D3).
 *
 * - The tab is the URL's `?tab=`: failed refunds by default, creator debts on
 *   `?tab=debts`, Owed to creators on `?tab=owed` (Codex-2hxff.73). Only that
 *   list is asked for; another loads on switching.
 * - "Check Stripe again" asks once per click, and reloads only what changed.
 * - A rejected list shows an error, never "No failed refunds".
 * - Settling refreshes the list and the counts.
 *
 * Mounts the real `+page.svelte`, tables and dialogs; `$app/*` and the remote
 * module are the reactive doubles.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: string, _opts?: unknown) => {}),
  afterNavigate: vi.fn(),
}));
vi.mock('$app/navigation', () => navigation);
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/support.remote',
  () =>
    import('$lib/components/support/__fixtures__/support-remote.mock.svelte')
);

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import {
  debtPerson,
  failedRefund,
  list,
  NOW,
  owedItem,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  checkOwedToCreator,
  countsSlot,
  debtsSlot,
  failedSlot,
  failure,
  httpError,
  listCreatorDebts,
  listFailedRefunds,
  listOwedToCreators,
  owedSlot,
  reset,
  resolveFailedRefund,
  resolveOwedToCreator,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import { clearRepayBlocks } from '$lib/components/support/repay-blocks.svelte';
import QueuePage from '../+page.svelte';

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

function mountAt(href: string) {
  setPage(href);
  component = mount(QueuePage, { target: document.body });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
// The tabs are a list within the page: aria-current="true", not "page".
const current = () =>
  [...document.querySelectorAll('a[aria-current="true"]')].map((a) =>
    a.textContent?.trim()
  );

describe('the tab', () => {
  test('failed refunds by default: only that list is asked for', () => {
    mountAt('/admin/queue');
    expect(current()[0]).toContain(m.support_queue_tab_failed());
    expect(listFailedRefunds).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listCreatorDebts).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_queue_failed_intro());
  });

  test('?tab=debts: creator debts, and the failed list is not asked for', () => {
    mountAt('/admin/queue?tab=debts');
    expect(current()[0]).toContain(m.support_queue_tab_debts());
    expect(listCreatorDebts).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFailedRefunds).not.toHaveBeenCalled();
  });

  test('switching the URL loads the other list', () => {
    mountAt('/admin/queue');
    expect(listCreatorDebts).not.toHaveBeenCalled();
    setPage('/admin/queue?tab=debts');
    flushSync();
    expect(listCreatorDebts).toHaveBeenCalledTimes(1);
    debtsSlot().current = list([debtPerson()]);
    flushSync();
    expect(
      document.querySelectorAll('[data-testid="creator-debt-person"]')
    ).toHaveLength(1);
  });

  test('each tab carries its count once the counts land', () => {
    mountAt('/admin/queue');
    countsSlot().current = {
      failedRefunds: 2,
      creatorDebts: 1,
      owedToCreators: 6,
    };
    flushSync();
    const badges = [
      ...document.querySelectorAll('nav a [data-variant="warning"]'),
    ].map((b) => b.textContent);
    expect(badges).toEqual(['2', '1', '6']);
  });
});

describe('the list', () => {
  test('a rejected list shows an error, not "No failed refunds"', () => {
    mountAt('/admin/queue');
    failedSlot().error = httpError(500, 'An unexpected error occurred');
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_queue_failed_empty_title());
    // Our own words, not the server's pasted into the sentence.
    expect(text()).toContain(m.support_try_again_soon());
    expect(text()).not.toContain('An unexpected error occurred');
  });

  test('a list the guard refused (a 404, no code) says the session ended, with no Try again', () => {
    mountAt('/admin/queue');
    failedSlot().error = httpError(404, 'Not Found');
    flushSync();
    expect(
      document.querySelector('[data-testid="session-ended"]')?.textContent
    ).toContain(m.support_outcome_signed_out_lead());
    expect(document.querySelector('[data-testid="queue-error"]')).toBeNull();
    expect(text()).not.toContain(m.support_queue_failed_empty_title());
  });

  test('a later page left empty goes back a page, never "nothing waiting"', () => {
    mountAt('/admin/queue?page=2');
    failedSlot(2).current = {
      items: [],
      pagination: { page: 2, limit: 20, total: 20, totalPages: 1 },
    };
    flushSync();
    expect(navigation.goto).toHaveBeenCalledWith('/admin/queue?page=1', {
      keepFocus: true,
      replaceState: true,
    });
    expect(text()).not.toContain(m.support_queue_failed_empty_title());
  });

  test('an empty queue says so', () => {
    mountAt('/admin/queue');
    failedSlot().current = list([]);
    flushSync();
    expect(text()).toContain(m.support_queue_failed_empty_title());
  });
});

/** Melt restores focus a tick and a millisecond after the dialog closes. */
const afterFocus = () => new Promise((resolve) => setTimeout(resolve, 20));
const rowButton = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="failed-refund-row"] button'
    ),
  ].find((b) => b.textContent?.includes(label));

// Melt ignores a keydown whose target isn't an element: press it in the dialog.
const pressEscape = () =>
  document
    .querySelector('[role="dialog"]')
    ?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

describe('the settle dialog', () => {
  test('Cancel puts focus back on the row’s button', async () => {
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    const button = rowButton(m.support_action_elsewhere());
    button?.focus();
    button?.click();
    flushSync();
    // A keyboard user moves to Cancel and presses it; it leaves with the dialog.
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.trim() === m.support_confirm_cancel());
    cancel?.focus();
    cancel?.click();
    flushSync();
    await afterFocus();
    expect(document.activeElement).toBe(button);
  });

  test('while its request runs, Escape and the close button do nothing', async () => {
    let answer: (value: unknown) => void = () => {};
    resolveFailedRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never
    );
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    rowButton(m.support_action_elsewhere())?.click();
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    flushSync();

    pressEscape();
    flushSync();
    await afterFocus();
    expect(
      document.querySelector('[data-testid="settle-submit"]')
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>(
        '[role="dialog"] [aria-label="Close"]'
      )?.disabled
    ).toBe(true);

    answer({ outcome: 'failed', status: 500, code: null, detailsCode: null });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
    // Idle again: Escape closes it.
    pressEscape();
    flushSync();
    await afterFocus();
    expect(document.querySelector('[data-testid="settle-submit"]')).toBeNull();
  });
});

describe('a refusal that keeps the dialog open', () => {
  async function submitRepay() {
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    rowButton(m.support_action_repay())?.click();
    flushSync();
    const area = document.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea'
    );
    if (!area) throw new Error('no note');
    area.value = 'Re-pay.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const submit = document.querySelector<HTMLButtonElement>(
      '[data-testid="settle-submit"]'
    );
    submit?.focus();
    submit?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
    await afterFocus();
  }
  const problem = () =>
    document.querySelector<HTMLElement>('[data-testid="settle-problem"]');

  test('takes focus, so it is read out (R2-L3)', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({ detailsCode: 'REFUND_CLAWBACK_UNFINISHED' })
    );
    await submitRepay();
    expect(problem()?.dataset.problem).toBe('clawback_running');
    expect(document.activeElement).toBe(problem());
  });

  test('a settle the guard refused says the session ended (R2-M1)', async () => {
    resolveFailedRefund.mockRejectedValue(httpError(404, 'Not Found'));
    await submitRepay();
    expect(problem()?.dataset.problem).toBe('session_ended');
    expect(problem()?.textContent).toContain(m.support_settle_session_ended());
    expect(document.activeElement).toBe(problem());
  });
});

describe('a re-pay refused for good', () => {
  test.each([
    [
      'a later cause',
      failure({
        detailsCode: 'REPAY_BLOCKED_BY_LATER_CAUSE',
        reason: 'chargeback',
      }),
    ],
    [
      'a step that needs a person',
      failure({ detailsCode: 'REFUND_CLAWBACK_NEEDS_PERSON' }),
    ],
  ])('(%s) then Cancel: focus goes to the row’s next enabled choice, not the page (R3-L2)', async (_why, answer) => {
    resolveFailedRefund.mockResolvedValue(answer);
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    const repay = rowButton(m.support_action_repay());
    repay?.focus();
    repay?.click();
    flushSync();
    const area = document.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea'
    );
    if (!area) throw new Error('no note');
    area.value = 'Re-pay.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
    await afterFocus();
    expect(rowButton(m.support_action_repay())?.disabled).toBe(true);

    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.trim() === m.support_confirm_cancel());
    cancel?.focus();
    cancel?.click();
    flushSync();
    await afterFocus();
    expect(document.activeElement).toBe(
      rowButton(m.support_action_elsewhere())
    );
  });
});

describe('a re-pay refused for a later cause', () => {
  test('turns that row’s Re-pay off for the session, with the reason beside it', async () => {
    resolveFailedRefund.mockResolvedValue(
      failure({
        detailsCode: 'REPAY_BLOCKED_BY_LATER_CAUSE',
        reason: 'later_refunds',
      })
    );
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    rowButton(m.support_action_repay())?.click();
    flushSync();
    const area = document.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea'
    );
    if (!area) throw new Error('no note');
    area.value = 'Re-pay.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === m.support_confirm_cancel())
      ?.click();
    flushSync();
    await afterFocus();

    expect(rowButton(m.support_action_repay())?.disabled).toBe(true);
    expect(rowButton(m.support_action_elsewhere())?.disabled).toBe(false);
    expect(
      document.querySelector(
        '[data-testid="failed-refund-row"] [data-testid="repay-off"]'
      )?.textContent
    ).toContain(m.support_repay_off_later_refunds());
  });
});

describe('settling', () => {
  test('refreshes the list and the counts, and says what happened', async () => {
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
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();

    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="failed-refund-row"] button'
      ),
    ]
      .find((b) => b.textContent?.includes(m.support_action_elsewhere()))
      ?.click();
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();

    expect(resolveFailedRefund).toHaveBeenCalledTimes(1);
    expect(failedSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="settle-notice"]')?.textContent
    ).toContain(m.support_settled_elsewhere({ buyer: 'Daniel Price' }));

    // The notice takes focus, so it is read out.
    await afterFocus();
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="settle-notice"]')
    );
  });
});

describe('Owed to creators (?tab=owed)', () => {
  const owedButton = (label: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="owed-row"] button'
      ),
    ].find((b) => b.textContent?.includes(label));
  const notice = () =>
    document.querySelector<HTMLElement>('[data-testid="settle-notice"]');
  const answered = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
  };
  const checkRow = () =>
    owedItem({
      creditId: '55555555-5555-4555-8555-555555555555',
      payee: {
        userId: 'user-priya',
        name: 'Priya Shah',
        deleted: false,
        role: 'creator',
      },
      state: 'needs_check',
      effect: 'unverified',
      amountCents: null,
      repayCents: null,
      stepAmountCents: 1080,
      stripeReversalId: null,
      action: 'check',
    });

  test('only that list is asked for, with its own intro', () => {
    mountAt('/admin/queue?tab=owed');
    expect(current()[0]).toContain(m.support_queue_tab_owed());
    expect(listOwedToCreators).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFailedRefunds).not.toHaveBeenCalled();
    expect(listCreatorDebts).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_queue_owed_intro());
  });

  test('a rejected list shows an error, never "Nothing owed to creators"', () => {
    mountAt('/admin/queue?tab=owed');
    owedSlot().error = httpError(500);
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_queue_owed_empty_title());
  });

  test('an empty list says so, in its own words', () => {
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([]);
    flushSync();
    expect(text()).toContain(m.support_queue_owed_empty_title());
    expect(text()).toContain(m.support_queue_owed_empty_body());
  });

  test('Re-pay: the dialog names who and how much; done refreshes the list and the counts', async () => {
    resolveOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId: owedItem().creditId,
        resolution: 'repaid',
        resolvedAt: NOW.toISOString(),
        repayPayoutId: 'payout-repay-1',
        amountCents: 900,
        payeeName: 'Maya Okafor',
      },
    });
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([owedItem()]);
    flushSync();
    owedButton(m.support_repay_submit({ amount: '£9.00' }))?.click();
    flushSync();
    expect(text()).toContain(
      m.support_credit_repay_title({ name: 'Maya Okafor', amount: '£9.00' })
    );
    const submit = document.querySelector<HTMLButtonElement>(
      '[data-testid="settle-submit"]'
    );
    expect(submit?.textContent).toContain(
      m.support_credit_repay_submit({ amount: '£9.00', name: 'Maya Okafor' })
    );
    submit?.click();
    await answered();
    expect(resolveOwedToCreator).toHaveBeenCalledWith({
      creditId: owedItem().creditId,
      body: { action: 'repay', note: '' },
    });
    expect(owedSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    expect(notice()?.textContent).toContain(
      m.support_credit_repaid({ name: 'Maya Okafor', amount: '£9.00' })
    );
  });

  test('Check Stripe again asks once, says what Stripe found, and refreshes', async () => {
    checkOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId: checkRow().creditId,
        outcome: 'owed',
        state: 'owed',
        amountCents: 1080,
        stripeReversalId: 'trr_1QkV9eLk2vTb85gG',
        note: null,
        checkedAt: NOW.toISOString(),
        action: 'repay',
      },
    });
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([checkRow()]);
    flushSync();
    owedButton(m.support_owed_action_check())?.click();
    await answered();
    expect(checkOwedToCreator).toHaveBeenCalledTimes(1);
    expect(checkOwedToCreator).toHaveBeenCalledWith({
      creditId: checkRow().creditId,
    });
    // No dialog: a check is one question, not a decision.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(notice()?.textContent).toContain(
      m.support_credit_check_owed({ name: 'Priya Shah', amount: '£10.80' })
    );
    expect(owedSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    await afterFocus();
    expect(document.activeElement).toBe(notice());
  });

  test('Stripe still with no answer: nothing changed, so nothing reloads', async () => {
    checkOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId: checkRow().creditId,
        outcome: 'still_unknown',
        state: 'needs_check',
        amountCents: null,
        stripeReversalId: null,
        note: null,
        checkedAt: NOW.toISOString(),
        action: 'check',
      },
    });
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([checkRow()]);
    flushSync();
    owedButton(m.support_owed_action_check())?.click();
    await answered();
    expect(
      notice()?.dataset.variant ?? notice()?.getAttribute('data-variant')
    ).toBe('warning');
    expect(notice()?.textContent).toContain(
      m.support_credit_check_unknown_lead()
    );
    expect(owedSlot().refresh).not.toHaveBeenCalled();
    expect(countsSlot().refresh).not.toHaveBeenCalled();
  });

  test('a check the ledger cannot attribute: the row now asks a person, so the list reloads', async () => {
    checkOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId: checkRow().creditId,
        outcome: 'needs_person',
        state: 'needs_person',
        amountCents: null,
        stripeReversalId: null,
        note: null,
        checkedAt: NOW.toISOString(),
        action: 'decide',
      },
    });
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([checkRow()]);
    flushSync();
    owedButton(m.support_owed_action_check())?.click();
    await answered();
    expect(notice()?.textContent).toContain(
      m.support_credit_check_needs_person()
    );
    expect(owedSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('while a check runs, its button is busy and the row cannot be acted on twice', async () => {
    let answer: (value: unknown) => void = () => {};
    checkOwedToCreator.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never
    );
    mountAt('/admin/queue?tab=owed');
    owedSlot().current = list([checkRow()]);
    flushSync();
    owedButton(m.support_owed_action_check())?.click();
    flushSync();
    expect(owedButton(m.support_owed_action_not_owed())?.disabled).toBe(true);
    owedButton(m.support_owed_action_check())?.click();
    flushSync();
    expect(checkOwedToCreator).toHaveBeenCalledTimes(1);
    answer(failure({ status: 500, code: null }));
    await answered();
    expect(owedButton(m.support_owed_action_not_owed())?.disabled).toBe(false);
    expect(notice()?.textContent).toContain(m.support_credit_check_failed());
  });
});
