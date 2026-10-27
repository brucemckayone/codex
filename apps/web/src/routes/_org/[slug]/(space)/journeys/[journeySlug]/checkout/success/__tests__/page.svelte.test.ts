/**
 * Journey checkout return leg — the duplicate-payment notice (Codex-o4jvw;
 * owner decision 2026-10-22, "Say it plainly").
 *
 * When the load reports `duplicate`, the waiting room becomes a calm notice:
 * the buyer already has access, this payment is being refunded, and the way
 * in. It is final, so the page stops polling. Without one, the waiting room is
 * unchanged, but its checks are capped: about six over the first minute, then
 * Check again (Codex-2hxff.22; owner decision 2026-10-26). A course purchase
 * no longer active gets one plain notice. So does a payment nothing will
 * record (`notRecorded`, Codex-2hxff.81): support is on it, with no checks.
 *
 * Mounts the real `+page.svelte`; `$app/navigation` and `$app/state` are
 * mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { supportMailto } from '$lib/utils/support-mailto';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(() => Promise.resolve()),
}));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL(
      'http://of-blood-and-bones.lvh.me:3000/journeys/rootwork/checkout/success'
    ),
  },
}));

import JourneyCheckoutSuccess from '../+page.svelte';

type Duplicate =
  | { kind: 'purchase' }
  | { kind: 'subscription' }
  | {
      kind: 'tier';
      organizationName: string;
      keptTierName: string;
      otherTierName: string | null;
    }
  | null;

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  invalidateMock.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mountWith(
  duplicate: Duplicate,
  inactive = false,
  notRecorded: { kind: 'not_recorded'; reference: string } | null = null
) {
  component = mount(JourneyCheckoutSuccess, {
    target: document.body,
    props: {
      data: {
        courseTitle: 'Rootwork',
        dashboardPath: '/journeys/rootwork/dashboard',
        checkoutPath: '/journeys/rootwork/checkout',
        libraryPath: '/library',
        arrivedFromStripe: true,
        duplicate,
        inactive,
        notRecorded,
      } as never,
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
const paragraphs = () => [...document.querySelectorAll('.ret p')].map(clean);

describe('journey checkout success — a second payment', () => {
  test('a course bought again: already own it, refunded, go to the course', () => {
    mountWith({ kind: 'purchase' });

    expect(clean(document.querySelector('h1'))).toBe(
      'You already own Rootwork'
    );
    expect(paragraphs()).toEqual([
      "This second payment is being refunded in full. You don't need to do anything.",
    ]);
    expect(links()).toEqual([
      ['Go to Rootwork →', '/journeys/rootwork/dashboard'],
    ]);
  });

  test('a course plan subscribed to again: already subscribed, go to the course', () => {
    mountWith({ kind: 'subscription' });

    expect(clean(document.querySelector('h1'))).toBe(
      "You're already subscribed to Rootwork"
    );
    expect(paragraphs()).toEqual([
      "We've cancelled the second subscription and are refunding it.",
    ]);
    expect(links()).toEqual([
      ['Go to Rootwork →', '/journeys/rootwork/dashboard'],
    ]);
  });

  test('a tier subscribed to again, for another tier: the kept tier and Change plan', () => {
    mountWith({
      kind: 'tier',
      organizationName: 'Of Blood and Bones',
      keptTierName: 'Basic',
      otherTierName: 'Pro',
    });

    expect(clean(document.querySelector('h1'))).toBe(
      "You're already subscribed to Of Blood and Bones (Basic)"
    );
    expect(paragraphs()).toEqual([
      "We've cancelled the second subscription and are refunding it.",
      'Want Pro instead? Use Change plan.',
    ]);
    expect(links()).toEqual([
      ['Go to Of Blood and Bones →', '/'],
      ['Change plan', '/pricing'],
    ]);
  });

  test('the notice is final: no more polling', () => {
    mountWith({ kind: 'purchase' });
    vi.advanceTimersByTime(10_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test('without one, the waiting room is unchanged and keeps polling', () => {
    mountWith(null);

    expect(clean(document.querySelector('h1'))).toBe(
      'Confirming your payment…'
    );
    expect(links()).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(invalidateMock).toHaveBeenCalledWith('journey:entitlement');
  });
});

describe('journey checkout success — capped, then a button (Codex-2hxff.22)', () => {
  test('six checks over the first minute, then the owner copy, Check again and Go to library', async () => {
    mountWith(null);

    await vi.advanceTimersByTimeAsync(60_000);
    flushSync();
    expect(invalidateMock).toHaveBeenCalledTimes(6);

    expect(clean(document.querySelector('h1'))).toBe(m.checkout_late_title());
    expect(paragraphs()).toEqual([m.checkout_late_description()]);
    expect(clean(document.querySelector('button'))).toBe(
      m.checkout_check_again()
    );
    expect(links()).toEqual([[m.checkout_success_go_to_library(), '/library']]);

    // An hour on an open tab: nothing, until a click; then one.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(invalidateMock).toHaveBeenCalledTimes(6);
    document.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(invalidateMock).toHaveBeenCalledTimes(7);
  });

  test('a course purchase no longer active: one plain notice, the payment history, no checks', async () => {
    mountWith(null, true);

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_inactive_title()
    );
    expect(links()).toEqual([
      [
        m.checkout_inactive_payment_history(),
        'http://lvh.me:3000/account/payment',
      ],
    ]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test("a payment nothing will record: we're on it, Contact support and Go to library, no checks (Codex-2hxff.81)", async () => {
    mountWith(null, false, {
      kind: 'not_recorded',
      reference: 'cs_test_abc / 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
    });

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_not_recorded_title()
    );
    expect(paragraphs()).toEqual([m.checkout_not_recorded_description()]);
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
    expect(document.querySelector('button')).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
