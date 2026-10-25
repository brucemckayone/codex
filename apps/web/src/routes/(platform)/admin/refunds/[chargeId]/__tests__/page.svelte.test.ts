/**
 * /admin/refunds/[chargeId] — one charge and its refund form (Codex-2hxff.28,
 * mockup B1–B4).
 *
 * - The charge is ONE awaited call: until it lands there is a skeleton and
 *   no form; a 404 is "no record of this charge"; another failure an error.
 * - After a refund the charge and the counts are refreshed ONCE, then a
 *   Refresh button is offered (Q10). Nothing polls.
 * - Each answer reloads, or offers "Reload the charge", as drawn.
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
  preview,
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
    chargeSlot(CHARGE_ID).error = httpError(404, 'Not Found');
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
        chargeSlot(CHARGE_ID).error = httpError(404, 'Not Found');
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
