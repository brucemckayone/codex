/**
 * CheckoutSuccess — the content success page (org and creator subdomains).
 *
 * It acts on the verify read's `state`, our record and Stripe's together
 * (Codex-2hxff.22):
 * - Unlock on arrival: paid with no record of ours shows "Payment received ·
 *   Unlocking your content…" while the load's completion runs, then the
 *   success card, which refreshes the library once.
 * - Capped, then a button: still recording, it checks about six times over
 *   the first minute, only while the tab is visible, then stops and offers
 *   Check again (one check per click) and Go to library. Never more.
 * - A purchase no longer active (refunded, or paused by a dispute) gets one
 *   plain notice and the payment history, with no checks.
 *
 * A second payment for content the buyer already owns (`duplicate`,
 * Codex-o4jvw; owner decision 2026-10-22, "Say it plainly") replaces the
 * confirmation with a calm notice: they already own it, this payment is being
 * refunded, and the way to the item.
 *
 * A verify the load reports as failed for good (`verifyFailed`, a 4xx) shows
 * the error state ("couldn't verify", not "still processing") and never
 * checks; a transient one stays pending and checks, capped.
 *
 * A completion refused for good (`unlock` resolves to a `NotRecorded`,
 * Codex-2hxff.81; owner decision 2026-10-27, "Say we're on it") says support
 * is on it, at once, with Contact support and Go to library, and runs no
 * checks. Any other failed completion keeps today's slow path.
 */

import type { CheckoutSessionVerifyResult } from '@codex/purchase';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { supportMailto } from '$lib/utils/support-mailto';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { invalidateMock, invalidateCollectionMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(() => Promise.resolve()),
  invalidateCollectionMock: vi.fn(() => Promise.resolve()),
}));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));
vi.mock('$lib/collections', () => ({
  invalidateCollection: invalidateCollectionMock,
}));

import CheckoutSuccess from './CheckoutSuccess.svelte';

const CONTENT = {
  id: 'c1',
  title: 'Kettlebell Foundations',
  contentType: 'video',
};
const PURCHASE = {
  id: 'p1',
  contentId: 'c1',
  amountPaidCents: 1500,
  purchasedAt: '2026-10-22T10:00:00.000Z',
};
const UNLOCKED: CheckoutSessionVerifyResult = {
  sessionStatus: 'complete',
  state: 'unlocked',
  amountTotalCents: 1500,
  purchase: PURCHASE,
  content: CONTENT,
};
/** Paid; our row not there yet. The read names the item and Stripe's amount. */
const RECORDING: CheckoutSessionVerifyResult = {
  sessionStatus: 'complete',
  state: 'recording',
  amountTotalCents: 1500,
  content: CONTENT,
};

let component: ReturnType<typeof mount> | null = null;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  invalidateMock.mockClear();
  invalidateCollectionMock.mockClear();
});

function mountWith(props: {
  verification: CheckoutSessionVerifyResult | null;
  verifyFailed?: boolean;
  unlock?: Promise<
    | CheckoutSessionVerifyResult
    | { kind: 'not_recorded'; reference: string }
    | null
  > | null;
}) {
  component = mount(CheckoutSuccess, {
    target: document.body,
    props: {
      contentUrl: '/content/kettlebell-foundations',
      browseUrl: '/explore',
      libraryUrl: '/library',
      paymentHistoryUrl: 'https://codex.test/account/payment',
      titleSuffix: 'Of Blood and Bones',
      ...props,
    },
  });
  flushSync();
}

const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const links = () =>
  [...document.querySelectorAll('a')].map((a) => [
    clean(a),
    a.getAttribute('href'),
  ]);

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => clean(b) === label);

/** Six checks at 2, 5, 10, 20, 40 and 60 s, and the answers they wait on. */
async function runTheMinute() {
  await vi.advanceTimersByTimeAsync(60_000);
  flushSync();
}

describe('CheckoutSuccess', () => {
  test('a duplicate payment says the buyer already owns it and it is being refunded', () => {
    mountWith({
      verification: {
        sessionStatus: 'complete',
        state: 'duplicate',
        purchase: PURCHASE,
        content: CONTENT,
        duplicatePayment: true,
      },
    });

    expect(clean(document.querySelector('h1'))).toBe(
      'You already own Kettlebell Foundations'
    );
    expect(
      clean(document.querySelector('.checkout-success__description'))
    ).toBe(
      "This second payment is being refunded in full. You don't need to do anything."
    );

    // One way out: to the item, where the normal page's CTA goes.
    expect(links()).toEqual([
      ['Go to Kettlebell Foundations', '/content/kettlebell-foundations'],
    ]);

    // No confirmation: no checkmark, receipt amount or onboarding tips.
    const card = clean(document.querySelector('.checkout-success__card'));
    expect(card).not.toContain(m.checkout_success_title());
    expect(card).not.toContain('£15.00');
    expect(document.querySelector('.checkmark')).toBeNull();
    expect(document.querySelector('.whats-next')).toBeNull();
  });

  test('a purchase already recorded confirms, unchanged, and refreshes the library once', () => {
    mountWith({ verification: UNLOCKED });

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_title()
    );
    expect(document.querySelector('.checkmark')).not.toBeNull();
    expect(clean(document.querySelector('.checkout-success__amount'))).toBe(
      '£15.00'
    );
    expect(document.querySelector('.whats-next')).not.toBeNull();
    expect(links()).toEqual([
      [m.checkout_success_watch_now(), '/content/kettlebell-foundations'],
      [m.checkout_success_browse(), '/explore'],
    ]);
    expect(invalidateCollectionMock).toHaveBeenCalledOnce();
    expect(invalidateCollectionMock).toHaveBeenCalledWith('library');
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test('Stripe complete is not enough: with no record of ours it never says Purchase Complete', () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: new Promise(() => {}) });

    expect(clean(document.body)).not.toContain(m.checkout_success_title());
    expect(invalidateCollectionMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutSuccess — unlock on arrival', () => {
  test('paid with no record: "Payment received · Unlocking your content…", the item, and the Start slot held', () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: new Promise(() => {}) });

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_arrival_title()
    );
    expect(clean(document.querySelector('[role="status"]'))).toBe(
      m.checkout_arrival_unlocking()
    );
    expect(
      clean(document.querySelector('.checkout-success__content-title'))
    ).toBe('Kettlebell Foundations');
    // Stripe's amount, before our row exists.
    expect(clean(document.querySelector('.checkout-success__amount'))).toBe(
      '£15.00'
    );
    const held = document.querySelector('.checkout-success__btn--held');
    expect(held?.getAttribute('aria-disabled')).toBe('true');
    expect(links()).toEqual([]);
  });

  test('no check runs while the completion is still out', async () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: new Promise(() => {}) });

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  // Told apart by its literal: a `kind` the verify result gains later must
  // not read as "we're on it" (Codex-2hxff.81).
  test('a verify answer carrying some other kind is the session, not a refusal', async () => {
    vi.useFakeTimers();
    mountWith({
      verification: RECORDING,
      unlock: Promise.resolve({
        ...UNLOCKED,
        kind: 'content',
      } as CheckoutSessionVerifyResult),
    });

    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_title()
    );
    expect(clean(document.body)).not.toContain(m.checkout_contact_support());
  });

  test('the completion records it: Start watching, the library refreshed once, and no checks', async () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: Promise.resolve(UNLOCKED) });
    const checkmark = document.querySelector('.checkmark');

    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_title()
    );
    expect(links()[0]).toEqual([
      m.checkout_success_watch_now(),
      '/content/kettlebell-foundations',
    ]);
    // The same checkmark, so it draws once.
    expect(document.querySelector('.checkmark')).toBe(checkmark);
    expect(invalidateCollectionMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutSuccess — capped, then a button', () => {
  test('still recording: six checks over the first minute, then it stops and offers Check again', async () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: Promise.resolve(RECORDING) });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith('checkout:verify');
    // Still "Unlocking…" while the checks run.
    flushSync();
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_arrival_title()
    );

    await runTheMinute();
    expect(invalidateMock).toHaveBeenCalledTimes(6);

    expect(clean(document.querySelector('h1'))).toBe(m.checkout_late_title());
    expect(
      clean(document.querySelector('.checkout-success__description'))
    ).toBe(m.checkout_late_description());
    expect(button(m.checkout_check_again())).toBeDefined();
    expect(links()).toEqual([[m.checkout_success_go_to_library(), '/library']]);
    // The checkmark stays: the payment went through.
    expect(document.querySelector('.checkmark')).not.toBeNull();

    // An hour on an open tab: nothing more.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(invalidateMock).toHaveBeenCalledTimes(6);
  });

  test('Check again is one check per click', async () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: Promise.resolve(RECORDING) });
    await vi.advanceTimersByTimeAsync(0);
    await runTheMinute();
    invalidateMock.mockClear();

    button(m.checkout_check_again())?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  test('a hidden tab runs no checks', async () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    mountWith({ verification: RECORDING, unlock: Promise.resolve(RECORDING) });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutSuccess — a payment nothing will record (Codex-2hxff.81)', () => {
  test("refused for good: we're on it, at once, with Contact support and Go to library, and no checks", async () => {
    vi.useFakeTimers();
    mountWith({
      verification: RECORDING,
      unlock: Promise.resolve({
        kind: 'not_recorded' as const,
        reference: 'cs_test_abc / 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
      }),
    });
    const checkmark = document.querySelector('.checkmark');

    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_not_recorded_title()
    );
    expect(
      clean(document.querySelector('.checkout-success__description'))
    ).toBe(m.checkout_not_recorded_description());
    expect(links()).toEqual([
      // The subject quotes the reference support matches to the alert.
      [
        m.checkout_contact_support(),
        supportMailto(
          'Checkout help, reference cs_test_abc / 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f'
        ),
      ],
      [m.checkout_success_go_to_library(), '/library'],
    ]);
    expect(button(m.checkout_check_again())).toBeUndefined();
    // The payment went through: the same checkmark, and the item paid for.
    expect(document.querySelector('.checkmark')).toBe(checkmark);
    expect(
      clean(document.querySelector('.checkout-success__content-title'))
    ).toBe('Kettlebell Foundations');

    // Each check would ask again and alert support again: none run.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(invalidateCollectionMock).not.toHaveBeenCalled();
  });

  test("any other failed completion keeps today's slow path: checks, then Check again", async () => {
    vi.useFakeTimers();
    mountWith({ verification: RECORDING, unlock: Promise.resolve(null) });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_arrival_title()
    );

    await runTheMinute();

    expect(invalidateMock).toHaveBeenCalledTimes(6);
    expect(clean(document.querySelector('h1'))).toBe(m.checkout_late_title());
    expect(button(m.checkout_check_again())).toBeDefined();
    expect(clean(document.body)).not.toContain(m.checkout_contact_support());
  });
});

describe('CheckoutSuccess — a purchase no longer active', () => {
  test.each([
    'refunded',
    'paused',
  ] as const)('%s: one plain notice, the payment history, and no checks', async (state) => {
    vi.useFakeTimers();
    mountWith({
      verification: {
        sessionStatus: 'complete',
        state,
        purchase: PURCHASE,
        content: CONTENT,
      },
    });

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_inactive_title()
    );
    expect(links()).toEqual([
      [
        m.checkout_inactive_payment_history(),
        'https://codex.test/account/payment',
      ],
    ]);
    expect(clean(document.body)).not.toContain(m.checkout_success_title());
    expect(document.querySelector('.checkmark')).toBeNull();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(invalidateCollectionMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutSuccess — a failed verify', () => {
  test('a final failure (4xx) shows the error state at once and never checks', async () => {
    vi.useFakeTimers();
    mountWith({ verification: null, verifyFailed: true });

    expect(clean(document.querySelector('h1'))).toBe(m.common_error());
    expect(
      clean(document.querySelector('.checkout-success__description'))
    ).toBe(m.checkout_success_error());
    // Not the fallback, which implies the payment is still processing.
    expect(clean(document.body)).not.toContain(
      m.checkout_success_almost_there()
    );
    expect(links()).toEqual([[m.checkout_success_go_to_library(), '/library']]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test('an unpaid session shows the error state, and never checks', async () => {
    vi.useFakeTimers();
    mountWith({
      verification: { sessionStatus: 'complete', state: 'unpaid' },
    });

    expect(clean(document.querySelector('h1'))).toBe(m.common_error());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test('a transient failure stays pending, checks six times, then Almost there with Check again', async () => {
    vi.useFakeTimers();
    mountWith({ verification: null, verifyFailed: false });

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_confirming()
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(invalidateMock).toHaveBeenCalledWith('checkout:verify');

    await runTheMinute();
    expect(invalidateMock).toHaveBeenCalledTimes(6);
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_almost_there()
    );
    expect(button(m.checkout_check_again())).toBeDefined();
  });

  test('a check whose verify fails for now keeps "Payment received", never drops to "Confirming…"', async () => {
    vi.useFakeTimers();
    const live = $state<{
      verification: CheckoutSessionVerifyResult | null;
      unlock: Promise<CheckoutSessionVerifyResult | null> | null;
      contentUrl: string;
      browseUrl: string;
      libraryUrl: string;
      paymentHistoryUrl: string;
      titleSuffix: string;
    }>({
      verification: RECORDING,
      unlock: Promise.resolve(RECORDING),
      contentUrl: '/content/kettlebell-foundations',
      browseUrl: '/explore',
      libraryUrl: '/library',
      paymentHistoryUrl: 'https://codex.test/account/payment',
      titleSuffix: 'Of Blood and Bones',
    });
    component = mount(CheckoutSuccess, { target: document.body, props: live });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_arrival_title()
    );

    // A scheduled check's load: the verify got a 503, so no answer, no unlock.
    live.verification = null;
    live.unlock = null;
    flushSync();
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_arrival_title()
    );
    expect(clean(document.body)).not.toContain(m.checkout_success_confirming());

    // The next good read moves it on.
    live.verification = UNLOCKED;
    flushSync();
    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_title()
    );
  });
});
