/**
 * The refund form (Codex-2hxff.28, mockup B1, B2, B4).
 *
 * - The preview is asked for 300 ms after the last keystroke, once per
 *   amount, keyed to the charge's refund count.
 * - Review waits for the preview OF THE AMOUNT SHOWN: disabled while it is
 *   pending, and never enabled by an older amount's preview.
 * - One refund call per submit, even on a double click, carrying the refund
 *   count the page showed.
 * - A blocked charge shows its reason in place of the form.
 *
 * Mounts the real component with the real Dialog; only the remote module
 * (it imports `$app/server`) is replaced by the reactive double.
 */

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
  CHARGE_ID,
  chargeDetail,
  preview,
} from '../__fixtures__/support-fixtures';
import {
  failure,
  getRefundPreview,
  issueSupportRefund,
  previewSlot,
  reset,
} from '../__fixtures__/support-remote.mock.svelte';
import RefundForm from '../RefundForm.svelte';
import type { RefundOutcome } from '../refund-outcome';

let component: ReturnType<typeof mount> | null = null;
let outcomes: RefundOutcome[] = [];

beforeEach(() => {
  reset();
  outcomes = [];
  vi.useFakeTimers();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mountForm(
  props: Partial<{
    detail: ReturnType<typeof chargeDetail>;
    stale: boolean;
  }> = {}
) {
  component = mount(RefundForm, {
    target: document.body,
    props: {
      detail: props.detail ?? chargeDetail(),
      stale: props.stale ?? false,
      onOutcome: (outcome: RefundOutcome) => outcomes.push(outcome),
    },
  });
  flushSync();
}

const review = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="review-refund"]');

function choosePart(text: string) {
  document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
  // The amount field opens with its choice.
  flushSync();
  const input = document.querySelector<HTMLInputElement>(
    'input[inputmode="decimal"]'
  );
  if (!input) throw new Error('no amount input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  flushSync();
}

const ARGS_750 = { chargeId: CHARGE_ID, amountCents: 750, refundCount: 1 };
const NOW_ISO = '2026-10-24T09:41:00.000Z';

describe('how much', () => {
  test('the amount field opens with "Part of it", and closes with "All"', () => {
    const amount = () => document.querySelector('input[inputmode="decimal"]');
    const partHint = () =>
      document.querySelector('[data-part-hint]')?.textContent?.trim();
    mountForm();
    expect(amount()).toBeNull();
    expect(partHint()).toBe(
      m.support_form_part_keeps({ buyer: 'Ellie Marsh' })
    );

    document.querySelector<HTMLInputElement>('input[value="part"]')?.click();
    flushSync();
    expect(amount()).not.toBeNull();
    expect(partHint()).toBe(
      m.support_form_part_hint_keeps({ max: '£20.00', buyer: 'Ellie Marsh' })
    );

    document.querySelector<HTMLInputElement>('input[value="all"]')?.click();
    flushSync();
    expect(amount()).toBeNull();
  });
});

describe('the preview', () => {
  test('is asked for 300 ms after the last keystroke, once, for the last amount', async () => {
    mountForm();
    choosePart('7');
    await wait(200);
    choosePart('7.5');
    await wait(299);
    expect(getRefundPreview).not.toHaveBeenCalled();

    await wait(1);
    expect(getRefundPreview).toHaveBeenCalledTimes(1);
    expect(getRefundPreview).toHaveBeenCalledWith(ARGS_750);
  });

  test('is never asked for an amount over what is left', async () => {
    mountForm();
    choosePart('20.01');
    await wait(400);
    expect(getRefundPreview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      m.support_form_amount_invalid({ max: '£20.00' })
    );
    expect(review()?.disabled).toBe(true);
  });

  test('shows what it takes back, from whom, once it lands, and announces the total', async () => {
    mountForm();
    choosePart('7.50');
    await wait(300);
    previewSlot(ARGS_750).current = preview();
    flushSync();

    const lines = document.querySelector('[data-testid="preview-lines"]');
    expect(lines?.textContent).toContain('Rowan Ellis');
    expect(lines?.textContent).toContain('£6.07');
    expect(lines?.textContent).toContain('Studio Alpha');
    expect(lines?.textContent).toContain(m.support_preview_rounding());
    expect(
      document.querySelector('[data-testid="preview-access"]')?.textContent
    ).toContain(m.support_access_keeps_lead({ buyer: 'Ellie Marsh' }));
    const live = document.querySelector('[data-preview-announce]');
    expect(live?.textContent).toContain(
      m.support_preview_announce({
        amount: '£7.50',
        payees: '£6.74',
        platform: '£0.76',
      })
    );
  });
});

describe('Review', () => {
  test('is disabled while the shown amount’s preview is pending', async () => {
    mountForm();
    choosePart('7.50');
    expect(review()?.disabled).toBe(true);
    await wait(300);
    expect(
      document.querySelector('[data-testid="preview-pending"]')
    ).not.toBeNull();
    expect(review()?.disabled).toBe(true);

    previewSlot(ARGS_750).current = preview();
    flushSync();
    expect(review()?.disabled).toBe(false);
    expect(review()?.textContent).toContain(
      m.support_form_review({ amount: '£7.50' })
    );
  });

  test('is never enabled by an older amount’s preview', async () => {
    mountForm();
    choosePart('7.50');
    await wait(300);
    previewSlot(ARGS_750).current = preview();
    flushSync();
    expect(review()?.disabled).toBe(false);

    // A new amount: the £7.50 preview is still loaded, but it is not this one.
    choosePart('8.00');
    expect(review()?.disabled).toBe(true);
    expect(document.querySelector('[data-testid="preview-lines"]')).toBeNull();
    await wait(300);
    expect(review()?.disabled).toBe(true);

    previewSlot({ ...ARGS_750, amountCents: 800 }).current = preview({
      amountCents: 800,
    });
    flushSync();
    expect(review()?.disabled).toBe(false);
  });

  test('waits while the charge reloads', async () => {
    mountForm({ stale: true });
    choosePart('7.50');
    await wait(300);
    previewSlot(ARGS_750).current = preview();
    flushSync();
    expect(review()?.disabled).toBe(true);
  });

  test('stays disabled when the preview fails, and says so', async () => {
    mountForm();
    choosePart('7.50');
    await wait(300);
    previewSlot(ARGS_750).error = { status: 500, body: { message: 'boom' } };
    flushSync();
    expect(
      document.querySelector('[data-testid="preview-error"]')
    ).not.toBeNull();
    expect(review()?.disabled).toBe(true);
  });
});

describe('Review asks for the preview again', () => {
  async function readyAt750() {
    mountForm();
    choosePart('7.50');
    await wait(300);
    const slot = previewSlot(ARGS_750);
    slot.current = preview();
    flushSync();
    return slot;
  }
  const confirmShown = () =>
    document.querySelector('[data-testid="confirm-refund"]') !== null;

  test('the confirm opens only once the fresh preview lands, and says what it says', async () => {
    const slot = await readyAt750();
    let land = () => {};
    slot.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = () => {
            // Since the page loaded, Rowan's payout went out: a person decides.
            slot.current = preview({
              lines: [
                {
                  payoutId: 'payout-rowan',
                  repayPayoutId: null,
                  label: 'Needs a person',
                  amountCents: 607,
                  method: 'needs_person',
                },
              ],
            });
            resolve();
          };
        })
    );
    review()?.click();
    await wait(0);
    expect(slot.refresh).toHaveBeenCalledTimes(1);
    expect(confirmShown()).toBe(false);
    expect(review()?.disabled).toBe(true);

    land();
    await wait(0);
    expect(confirmShown()).toBe(true);
    expect(document.body.textContent).toContain(
      m.support_confirm_line_person({ name: 'Rowan Ellis' })
    );
    expect(document.body.textContent).not.toContain(
      m.support_confirm_line_reversal({ name: 'Rowan Ellis' })
    );
  });

  test('a refresh that fails opens nothing, and Try again asks once more', async () => {
    const slot = await readyAt750();
    slot.refresh.mockImplementation(async () => {
      slot.error = { status: 500, body: { message: 'boom' } };
      throw new Error('boom');
    });
    review()?.click();
    await wait(0);
    expect(confirmShown()).toBe(false);
    const alert = document.querySelector('[data-testid="preview-error"]');
    expect(alert).not.toBeNull();
    [...(alert?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.includes(m.support_try_again()))
      ?.click();
    expect(slot.refresh).toHaveBeenCalledTimes(2);
  });

  test('an amount changed while it asks opens nothing, even once the new amount’s preview lands', async () => {
    const slot = await readyAt750();
    let land = () => {};
    slot.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        })
    );
    review()?.click();
    await wait(0);
    // While the £7.50 refresh is out, support types £8.00 and its preview lands.
    choosePart('8.00');
    await wait(300);
    previewSlot({ ...ARGS_750, amountCents: 800 }).current = preview({
      amountCents: 800,
    });
    flushSync();
    land();
    await wait(0);
    expect(confirmShown()).toBe(false);
  });
});

describe('the amount field', () => {
  test('sits outside the radio’s label; its error is tied to it and read out', () => {
    mountForm();
    choosePart('20.01');
    const radio = document.querySelector<HTMLInputElement>(
      'input[value="part"]'
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    expect(radio?.labels?.length).toBe(1);
    expect(radio?.labels?.[0]?.contains(input)).toBe(false);

    const described = (input?.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id));
    const error = described.find(
      (el) => el?.getAttribute('aria-live') === 'polite'
    );
    expect(error?.textContent).toContain(
      m.support_form_amount_invalid({ max: '£20.00' })
    );
    expect(input?.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('submitting', () => {
  async function openReview() {
    mountForm();
    choosePart('7.50');
    await wait(300);
    previewSlot(ARGS_750).current = preview();
    flushSync();
    review()?.click();
    // Review asks for the preview again; the confirm opens on its answer.
    await wait(0);
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-refund"]'
    );
    if (!confirm) throw new Error('confirm dialog did not open');
    return confirm;
  }

  test('the confirm names the amount, the buyer and what each payee gives back', async () => {
    await openReview();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      m.support_confirm_title({ amount: '£7.50', buyer: 'Ellie Marsh' })
    );
    expect(dialog?.textContent).toContain(
      m.support_confirm_line_reversal({ name: 'Rowan Ellis' })
    );
    expect(dialog?.textContent).toContain(
      m.support_confirm_line_reduce({ name: 'Studio Alpha' })
    );
    expect(dialog?.textContent).toContain('£0.76');
  });

  test('a double click sends one refund, with the refund count the page showed', async () => {
    let settle: (value: { outcome: 'done'; result: never }) => void = () => {};
    issueSupportRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve as typeof settle;
        })
    );
    const confirm = await openReview();
    confirm.click();
    confirm.click();
    flushSync();
    confirm.click();

    expect(issueSupportRefund).toHaveBeenCalledTimes(1);
    expect(issueSupportRefund).toHaveBeenCalledWith({
      chargeId: CHARGE_ID,
      amountCents: 750,
      reason: 'requested_by_customer',
      expectedRefundCount: 1,
    });
    settle({
      outcome: 'done',
      result: {
        refund: {
          id: 're_new',
          amountCents: 750,
          status: 'succeeded',
          createdAt: NOW_ISO,
        },
        replayed: false,
      } as never,
    });
    await wait(0);
    expect(outcomes.map((o) => o.kind)).toEqual(['made']);
  });

  test('a refusal reaches the page by its details code', async () => {
    issueSupportRefund.mockResolvedValue(
      failure({
        status: 412,
        code: 'PRECONDITION_FAILED',
        detailsCode: 'CHARGE_CHANGED',
      })
    );
    const confirm = await openReview();
    confirm.click();
    await wait(0);
    expect(outcomes.map((o) => o.kind)).toEqual(['changed']);
  });

  test('a command the remote’s guard refuses (404) reads as a lost session', async () => {
    issueSupportRefund.mockRejectedValue({
      status: 404,
      body: { message: 'Not Found' },
    });
    const confirm = await openReview();
    confirm.click();
    await wait(0);
    expect(outcomes.map((o) => o.kind)).toEqual(['signed_out']);
  });
});

describe('a blocked charge', () => {
  test.each([
    ['window_closed', m.support_blocked_lead()],
    ['chargeback', m.support_blocked_chargeback_open_lead()],
    ['nothing_left', m.support_blocked_nothing()],
  ] as const)('%s shows its reason in place of the form', (blocked, text) => {
    mountForm({
      detail: chargeDetail({
        refundable: {
          maxCents: blocked === 'nothing_left' ? 0 : 2000,
          blocked,
        },
        window: {
          closesAt: '2026-10-17T07:15:00.000Z',
          isOpen: blocked !== 'window_closed',
        },
      }),
    });
    const alert = document.querySelector('[data-testid="refund-blocked"]');
    expect(alert?.getAttribute('data-reason')).toBe(blocked);
    expect(alert?.textContent).toContain(text);
    expect(review()).toBeNull();
  });

  test('an inquiry does not block, and the form says what a full refund does to it', () => {
    mountForm({
      detail: chargeDetail({
        chargebacks: [
          {
            id: 'du_1',
            amountCents: 2400,
            status: 'warning_needs_response',
            reason: 'general',
            createdAt: NOW_ISO,
            respondBy: null,
          },
        ],
      }),
    });
    expect(review()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="refund-inquiry"]')?.textContent
    ).toContain(m.support_form_inquiry());
  });
});
