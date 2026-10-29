/**
 * /admin/refunds/[chargeId] — one charge and its refund form (Codex-2hxff.28,
 * mockup B1–B4).
 *
 * - The charge is ONE awaited call: until it lands there is a skeleton and
 *   no form; the worker's 404 is "no record of this charge"; the guard's
 *   404 (no code), a 401 or a 403 is "your session has ended" (R2-M1);
 *   another failure an error.
 * - After a refund the charge and the counts are refreshed ONCE, then a
 *   Refresh button is offered (Q10). Nothing polls.
 * - Each answer reloads, or offers "Reload the charge", as drawn.
 * - A late take-back's Re-pay on its history line (C1) opens the queue's
 *   dialog; once done, the charge and the counts reload once (C2).
 *
 * Mounts the real `+page.svelte` and real components; `$app/*` and the remote
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
  goto: vi.fn(async (_url: string) => {}),
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
  CHARGE_ID,
  chargeDetail,
  historyLine,
  NOW,
  preview,
  slice,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  chargeSlot,
  countsSlot,
  failure,
  getSupportCharge,
  httpError,
  issueSupportRefund,
  previewSlot,
  reset,
  resolveOwedToCreator,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import ChargePage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  vi.useFakeTimers();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mountCharge(chargeId = CHARGE_ID) {
  setPage(`/admin/refunds/${chargeId}`, { chargeId });
  component = mount(ChargePage, { target: document.body });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const review = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="review-refund"]');

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  flushSync();
}

/** Refund £7.50 through the real form: amount, preview, Review, confirm. */
async function refund750() {
  document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
  flushSync();
  const input = document.querySelector<HTMLInputElement>(
    'input[inputmode="decimal"]'
  );
  if (!input) throw new Error('no amount input');
  input.value = '7.50';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await tick(300);
  previewSlot({
    chargeId: CHARGE_ID,
    amountCents: 750,
    refundCount: 1,
  }).current = preview();
  flushSync();
  review()?.click();
  // Review asks for the preview again; the confirm opens on its answer.
  await tick(0);
  document
    .querySelector<HTMLButtonElement>('[data-testid="confirm-refund"]')
    ?.click();
  await tick(0);
}

describe('loading the charge', () => {
  test('until it lands: a skeleton, and no form', () => {
    mountCharge();
    expect(getSupportCharge).toHaveBeenCalledWith(CHARGE_ID);
    expect(
      document.querySelector('[data-testid="charge-loading"]')
    ).not.toBeNull();
    expect(review()).toBeNull();
  });

  test('once it lands: the header, the record and the form, from that one answer', () => {
    mountCharge();
    chargeSlot(CHARGE_ID).current = chargeDetail();
    flushSync();
    expect(document.querySelector('h1')?.textContent).toContain(
      m.support_charge_title({
        title: 'Sleep Reset Programme',
        amount: '£24.00',
      })
    );
    expect(text()).toContain(m.support_split_title({ amount: '£24.00' }));
    expect(text()).toContain(m.support_refunds_card_title());
    expect(review()).not.toBeNull();
  });

  test('a 404 is "no record of this charge", never a blank page', () => {
    mountCharge();
    chargeSlot(CHARGE_ID).error = httpError(
      404,
      'No record of this charge',
      'NOT_FOUND'
    );
    flushSync();
    expect(document.querySelector('h2')?.textContent).toContain(
      m.support_not_found_title()
    );
    expect(
      document.querySelector('[data-testid="charge-load-error"]')
    ).toBeNull();
    expect(review()).toBeNull();
  });

  test('another failure is an error to retry, not the not-found state', () => {
    mountCharge();
    chargeSlot(CHARGE_ID).error = httpError(
      500,
      'An unexpected error occurred'
    );
    flushSync();
    expect(
      document.querySelector('[data-testid="charge-load-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_not_found_title());
    // Our own words, not the server's pasted into the sentence.
    expect(text()).toContain(m.support_try_again_soon());
    expect(text()).not.toContain('An unexpected error occurred');
  });

  test('the guard’s 404 (no code) says the session ended, never "no record"', () => {
    mountCharge();
    chargeSlot(CHARGE_ID).error = httpError(404, 'Not Found');
    flushSync();
    expect(
      document.querySelector('[data-testid="session-ended"]')?.textContent
    ).toContain(m.support_outcome_signed_out_lead());
    expect(text()).not.toContain(m.support_not_found_title());
    // No Try again: only signing in again helps.
    expect(
      document.querySelector('[data-testid="charge-load-error"]')
    ).toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(review()).toBeNull();
  });

  test('a reload refused because the session ended says so above the record', () => {
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    charge.error = httpError(401, 'Unauthorized');
    flushSync();
    expect(
      document.querySelector('[data-testid="session-ended"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="charge-reload-error"]')
    ).toBeNull();
  });

  test('an id that is not a charge is not found, and nothing is asked for', () => {
    mountCharge('not-a-charge');
    expect(getSupportCharge).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_not_found_title());
  });
});

describe('the page heading', () => {
  test.each([
    ['loading', () => {}],
    [
      'not found',
      () => {
        chargeSlot(CHARGE_ID).error = httpError(
          404,
          'No record of this charge',
          'NOT_FOUND'
        );
      },
    ],
    [
      'failed',
      () => {
        chargeSlot(CHARGE_ID).error = httpError(
          500,
          'An unexpected error occurred'
        );
      },
    ],
  ])('while %s, the page still has an h1', (_state, land) => {
    mountCharge();
    land();
    flushSync();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')?.textContent).toContain(
      m.support_charge_heading()
    );
  });
});

describe('a reload of the same charge', () => {
  test('asks for the preview on screen again: a payout may have moved', async () => {
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
    flushSync();
    const input = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    if (!input) throw new Error('no amount input');
    input.value = '7.50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(300);
    const slot = previewSlot({
      chargeId: CHARGE_ID,
      amountCents: 750,
      refundCount: 1,
    });
    slot.current = preview();
    flushSync();
    expect(slot.refresh).not.toHaveBeenCalled();

    // Refresh lands: a new answer, the same refund count.
    charge.current = chargeDetail();
    flushSync();
    expect(slot.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a preview the route refuses', () => {
  test('reloads the charge: what it showed has moved (R2-L1)', async () => {
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
    flushSync();
    const input = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    if (!input) throw new Error('no amount input');
    input.value = '7.50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(300);
    previewSlot({
      chargeId: CHARGE_ID,
      amountCents: 750,
      refundCount: 1,
    }).error = httpError(400, 'Too large', 'VALIDATION_ERROR');
    flushSync();
    expect(charge.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('focus', () => {
  test('after Refund, focus moves to the outcome, so it is read out', async () => {
    issueSupportRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refund: {
          id: 're_new',
          amountCents: 750,
          status: 'succeeded',
          createdAt: '2026-10-24T09:41:00.000Z',
        },
        replayed: false,
      },
    });
    mountCharge();
    chargeSlot(CHARGE_ID).current = chargeDetail();
    flushSync();
    await refund750();
    await tick(10);
    const outcome = document.querySelector('[data-testid="refund-outcome"]');
    expect(outcome?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(outcome);
  });

  test('Cancel on the confirm puts focus back on Review', async () => {
    mountCharge();
    chargeSlot(CHARGE_ID).current = chargeDetail();
    flushSync();
    document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
    flushSync();
    const input = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    if (!input) throw new Error('no amount input');
    input.value = '7.50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(300);
    previewSlot({
      chargeId: CHARGE_ID,
      amountCents: 750,
      refundCount: 1,
    }).current = preview();
    flushSync();
    review()?.click();
    await tick(0);
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === m.support_confirm_cancel())
      ?.click();
    await tick(10);
    expect(document.activeElement).toBe(review());
  });
});

describe('after Refund', () => {
  test('a refund made: the outcome above the refunds, one reload of the charge and the counts, then Refresh', async () => {
    issueSupportRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refund: {
          id: 're_new',
          amountCents: 750,
          status: 'succeeded',
          createdAt: '2026-10-24T09:41:00.000Z',
        },
        replayed: false,
      },
    });
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    await refund750();

    expect(
      document
        .querySelector('[data-testid="refund-outcome"]')
        ?.getAttribute('data-kind')
    ).toBe('made');
    expect(charge.refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);

    // No polling: time passes and nothing more is fetched.
    await tick(60_000);
    expect(charge.refresh).toHaveBeenCalledTimes(1);

    const refresh = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(m.support_refresh())
    );
    expect(refresh).toBeDefined();
    refresh?.click();
    await tick(0);
    expect(charge.refresh).toHaveBeenCalledTimes(2);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(2);
  });

  test('CHARGE_CHANGED: "changed", and the charge reloads; the counts do not', async () => {
    issueSupportRefund.mockResolvedValue(
      failure({
        status: 412,
        code: 'PRECONDITION_FAILED',
        detailsCode: 'CHARGE_CHANGED',
        refundCount: 2,
      })
    );
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    await refund750();
    expect(
      document
        .querySelector('[data-testid="refund-outcome"]')
        ?.getAttribute('data-kind')
    ).toBe('changed');
    expect(charge.refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).not.toHaveBeenCalled();
  });

  test('STRIPE_REFUSED: nothing changed, so no reload until support asks for one', async () => {
    issueSupportRefund.mockResolvedValue(
      failure({ detailsCode: 'STRIPE_REFUSED', stripeCode: 'charge_disputed' })
    );
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    await refund750();
    const alert = document.querySelector('[data-testid="refund-outcome"]');
    expect(alert?.getAttribute('data-kind')).toBe('refused');
    expect(charge.refresh).not.toHaveBeenCalled();
    [...(alert?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent?.includes(m.support_reload_charge()))
      ?.click();
    expect(charge.refresh).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['REFUND_IN_FLIGHT', 'in_flight'],
    ['REFUND_KEY_SPENT', 'key_spent'],
  ] as const)('%s: every amount is locked until a reload of the charge lands', async (detailsCode, kind) => {
    issueSupportRefund.mockResolvedValue(
      failure({ status: 409, code: 'CONFLICT', detailsCode })
    );
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    let land = () => {};
    charge.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        })
    );
    await refund750();
    const alert = document.querySelector('[data-testid="refund-outcome"]');
    expect(alert?.getAttribute('data-kind')).toBe(kind);
    expect(charge.refresh).not.toHaveBeenCalled();

    // Another amount: a new key, so a second refund. Locked too.
    const input = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    if (!input) throw new Error('no amount input');
    input.value = '8.00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(300);
    previewSlot({
      chargeId: CHARGE_ID,
      amountCents: 800,
      refundCount: 1,
    }).current = preview({ amountCents: 800 });
    flushSync();
    expect(review()?.disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="refund-locked"]')
    ).not.toBeNull();

    // Asking for the reload is not enough: it must land.
    [...(alert?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent?.includes(m.support_reload_charge()))
      ?.click();
    await tick(0);
    expect(charge.refresh).toHaveBeenCalledTimes(1);
    expect(review()?.disabled).toBe(true);

    land();
    await tick(0);
    expect(review()?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="refund-locked"]')).toBeNull();
  });

  test('a reload that fails keeps the lock, even when kit resolves an older one (R3-L1)', async () => {
    issueSupportRefund.mockResolvedValue(
      failure({
        status: 409,
        code: 'CONFLICT',
        detailsCode: 'REFUND_IN_FLIGHT',
      })
    );
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    flushSync();
    // Kit: when a later refresh fails, it RESOLVES the earlier pending one,
    // with the error already set.
    let resolveFirst = () => {};
    charge.refresh
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(async () => {
        charge.error = httpError(500, 'boom');
        throw new Error('boom');
      })
      .mockImplementationOnce(async () => {
        charge.error = undefined;
      });
    await refund750();
    const reloadButton = () =>
      [
        ...(document
          .querySelector('[data-testid="refund-outcome"]')
          ?.querySelectorAll('button') ?? []),
      ].find((b) => b.textContent?.includes(m.support_reload_charge()));

    reloadButton()?.click();
    reloadButton()?.click();
    await tick(0);
    resolveFirst();
    await tick(0);
    expect(charge.refresh).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('[data-testid="refund-locked"]')
    ).not.toBeNull();

    // A reload that lands without error frees it.
    reloadButton()?.click();
    await tick(0);
    expect(document.querySelector('[data-testid="refund-locked"]')).toBeNull();
  });

  test.each([
    ['with the charge on screen', true, 'charge-reload-error'],
    ['with nothing loaded yet', false, 'charge-load-error'],
  ])('Try again shows it is running (%s)', (_when, loaded, testId) => {
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    if (loaded) charge.current = chargeDetail();
    charge.error = httpError(500, 'boom');
    flushSync();
    const retry = () =>
      document.querySelector<HTMLButtonElement>(
        `[data-testid="${testId}"] button`
      );
    expect(retry()?.disabled).toBe(false);
    charge.loading = true;
    flushSync();
    expect(retry()?.disabled).toBe(true);
  });

  test('while the charge reloads, Review waits', async () => {
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail();
    charge.loading = true;
    flushSync();
    document.querySelector<HTMLInputElement>('input[value="all"]')?.click();
    flushSync();
    await tick(300);
    previewSlot({
      chargeId: CHARGE_ID,
      amountCents: 2000,
      refundCount: 1,
    }).current = preview({
      amountCents: 2000,
      isFinal: true,
    });
    flushSync();
    expect(review()?.disabled).toBe(true);

    charge.loading = false;
    flushSync();
    expect(review()?.disabled).toBe(false);
  });
});

describe('money owed back to a payee (C1, C2)', () => {
  test('Re-pay on the line opens the dialog; once done, the charge and the counts reload once', async () => {
    const creditId = '44444444-4444-4444-8444-444444444444';
    resolveOwedToCreator.mockResolvedValue({
      outcome: 'done',
      result: {
        creditId,
        resolution: 'repaid',
        resolvedAt: NOW.toISOString(),
        repayPayoutId: 'payout-repay-1',
        amountCents: 900,
        payeeName: 'Rowan Ellis',
      },
    });
    mountCharge();
    const charge = chargeSlot(CHARGE_ID);
    charge.current = chargeDetail({
      slices: [
        slice({
          takenCents: 900,
          owedToPayeeCents: 900,
          history: [
            historyLine({
              causeType: 'dispute',
              causeId: 'du_1QjM3pLk2vSb91tU',
              amountCents: 900,
              outcome: 'taken_after_settled',
              credit: {
                creditId,
                state: 'owed',
                amountCents: 900,
                action: 'repay',
                repayPayout: null,
              },
            }),
          ],
        }),
      ],
    });
    flushSync();
    [...document.querySelectorAll<HTMLButtonElement>('table button')]
      .find((b) => b.textContent?.includes(m.support_history_show()))
      ?.click();
    flushSync();
    document
      .querySelector<HTMLButtonElement>('table [data-testid="credit-action"]')
      ?.click();
    flushSync();
    expect(text()).toContain(
      m.support_credit_repay_title({ name: 'Rowan Ellis', amount: '£9.00' })
    );
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await tick();
    expect(resolveOwedToCreator).toHaveBeenCalledWith({
      creditId,
      body: { action: 'repay', note: '' },
    });
    expect(charge.refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="credit-notice"]')?.textContent
    ).toContain(
      m.support_credit_repaid({ name: 'Rowan Ellis', amount: '£9.00' })
    );
  });
  test('Cancel on the dialog puts focus back on the line’s button (L1)', async () => {
    const creditId = '55555555-5555-4555-8555-555555555555';
    mountCharge();
    chargeSlot(CHARGE_ID).current = chargeDetail({
      slices: [
        slice({
          takenCents: 900,
          owedToPayeeCents: 900,
          history: [
            historyLine({
              causeType: 'dispute',
              causeId: 'du_1QjM3pLk2vSb91tU',
              amountCents: 900,
              outcome: 'taken_after_settled',
              credit: {
                creditId,
                state: 'owed',
                amountCents: 900,
                action: 'repay',
                repayPayout: null,
              },
            }),
          ],
        }),
      ],
    });
    flushSync();
    [...document.querySelectorAll<HTMLButtonElement>('table button')]
      .find((b) => b.textContent?.includes(m.support_history_show()))
      ?.click();
    flushSync();
    const button = document.querySelector<HTMLButtonElement>(
      'table [data-testid="credit-action"]'
    );
    button?.focus();
    button?.click();
    flushSync();
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.trim() === m.support_confirm_cancel());
    cancel?.focus();
    cancel?.click();
    flushSync();
    await tick(20);
    expect(button).not.toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
