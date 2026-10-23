/**
 * CheckoutSuccess — the content success page (org and creator subdomains).
 *
 * A second payment for content the buyer already owns (`duplicatePayment`,
 * Codex-o4jvw; owner decision 2026-10-22, "Say it plainly") replaces the
 * confirmation with a calm notice: they already own it, this payment is being
 * refunded, and the way to the item. A first purchase is unchanged.
 *
 * A verify the load reports as failed for good (`verifyFailed`, a 4xx) shows
 * the error state ("couldn't verify", not "still processing") and stops
 * polling; a transient one stays pending and polls.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));

import CheckoutSuccess from './CheckoutSuccess.svelte';

const CONTENT = {
  id: 'c1',
  title: 'Kettlebell Foundations',
  contentType: 'video',
};
const PURCHASE = {
  id: 'p1',
  amountPaidCents: 1500,
  purchasedAt: '2026-10-22T10:00:00.000Z',
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(duplicatePayment: boolean) {
  component = mount(CheckoutSuccess, {
    target: document.body,
    props: {
      verification: {
        sessionStatus: 'complete',
        purchase: PURCHASE,
        content: CONTENT,
        ...(duplicatePayment ? { duplicatePayment: true as const } : {}),
      },
      contentUrl: '/content/kettlebell-foundations',
      browseUrl: '/explore',
      libraryUrl: '/library',
      titleSuffix: 'Of Blood and Bones',
    },
  });
  flushSync();
}

const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('CheckoutSuccess', () => {
  test('a duplicate payment says the buyer already owns it and it is being refunded', () => {
    mountWith(true);

    expect(clean(document.querySelector('h1'))).toBe(
      'You already own Kettlebell Foundations'
    );
    expect(
      clean(document.querySelector('.checkout-success__description'))
    ).toBe(
      "This second payment is being refunded in full. You don't need to do anything."
    );

    // One way out: to the item, where the normal page's CTA goes.
    const links = [...document.querySelectorAll('a')];
    expect(links.map((a) => [clean(a), a.getAttribute('href')])).toEqual([
      ['Go to Kettlebell Foundations', '/content/kettlebell-foundations'],
    ]);

    // No confirmation: no checkmark, receipt amount or onboarding tips.
    const card = clean(document.querySelector('.checkout-success__card'));
    expect(card).not.toContain(m.checkout_success_title());
    expect(card).not.toContain('£15.00');
    expect(document.querySelector('.checkmark')).toBeNull();
    expect(document.querySelector('.whats-next')).toBeNull();
  });

  test('a first purchase still confirms, unchanged', () => {
    mountWith(false);

    expect(clean(document.querySelector('h1'))).toBe(
      m.checkout_success_title()
    );
    expect(document.querySelector('.checkmark')).not.toBeNull();
    expect(clean(document.querySelector('.checkout-success__amount'))).toBe(
      '£15.00'
    );
    expect(document.querySelector('.whats-next')).not.toBeNull();
    const links = [...document.querySelectorAll('a')];
    expect(links.map((a) => [clean(a), a.getAttribute('href')])).toEqual([
      [m.checkout_success_watch_now(), '/content/kettlebell-foundations'],
      [m.checkout_success_browse(), '/explore'],
    ]);
  });
});

describe('CheckoutSuccess — a failed verify', () => {
  function mountFailed(verifyFailed: boolean) {
    component = mount(CheckoutSuccess, {
      target: document.body,
      props: {
        verification: null,
        verifyFailed,
        contentUrl: '/content/kettlebell-foundations',
        browseUrl: '/explore',
        libraryUrl: '/library',
        titleSuffix: 'Of Blood and Bones',
      },
    });
    flushSync();
  }

  test('a final failure (4xx) shows the error state at once and stops polling', () => {
    vi.useFakeTimers();
    try {
      mountFailed(true);

      expect(clean(document.querySelector('h1'))).toBe(m.common_error());
      expect(
        clean(document.querySelector('.checkout-success__description'))
      ).toBe(m.checkout_success_error());
      // Not the fallback, which implies the payment is still processing.
      expect(clean(document.body)).not.toContain(
        m.checkout_success_almost_there()
      );
      const links = [...document.querySelectorAll('a')];
      expect(links.map((a) => [clean(a), a.getAttribute('href')])).toEqual([
        [m.checkout_success_go_to_library(), '/library'],
      ]);
      vi.advanceTimersByTime(10_000);
      expect(invalidateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });

  test('a transient failure stays pending and polls', () => {
    vi.useFakeTimers();
    try {
      mountFailed(false);

      expect(clean(document.querySelector('h1'))).toBe(
        m.checkout_success_confirming()
      );
      vi.advanceTimersByTime(3_000);
      expect(invalidateMock).toHaveBeenCalledWith('checkout:verify');
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });
});
