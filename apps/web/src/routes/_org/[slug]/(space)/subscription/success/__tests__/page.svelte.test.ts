/**
 * Org tier subscription success page.
 *
 * A second subscription to an org the user already subscribes to is
 * cancelled and refunded (Codex-2hxff.15, "Keep the first"). Its page names
 * the subscription the user keeps instead of confirming this one (Codex-o4jvw;
 * owner decision 2026-10-22, "Say it plainly"), and points at Change plan when
 * this one was for another tier. A first subscription is unchanged.
 *
 * A verify the load reports as failed for good (`verifyFailed`, a 4xx) shows
 * the error state ("couldn't verify", not "still processing") at once and
 * stops polling; a transient one stays pending and polls.
 *
 * Mounts the real `+page.svelte`; `$app/navigation` is mocked.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { invalidateMock, invalidateCollectionMock, loadSubscriptionMock } =
  vi.hoisted(() => ({
    invalidateMock: vi.fn(() => Promise.resolve()),
    invalidateCollectionMock: vi.fn(() => Promise.resolve()),
    loadSubscriptionMock: vi.fn(() => Promise.resolve()),
  }));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));
vi.mock('$lib/collections', () => ({
  invalidateCollection: invalidateCollectionMock,
  loadSubscriptionFromServer: loadSubscriptionMock,
}));

import SubscriptionSuccessPage from '../+page.svelte';

const SUBSCRIPTION = {
  id: 'sub-new',
  organizationId: 'org-1',
  tierId: 'tier-pro',
  tierName: 'Pro',
  organizationName: 'Of Blood and Bones',
  organizationSlug: 'of-blood-and-bones',
  startedAt: '2026-10-22T10:00:00.000Z',
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  invalidateCollectionMock.mockClear();
  loadSubscriptionMock.mockClear();
});

function mountWith(duplicateOf?: {
  id: string;
  tierId: string;
  tierName: string;
}) {
  component = mount(SubscriptionSuccessPage, {
    target: document.body,
    props: {
      data: {
        verification: {
          sessionStatus: 'complete',
          subscription: {
            ...SUBSCRIPTION,
            ...(duplicateOf ? { duplicateOf } : {}),
          },
        },
        org: { name: 'Of Blood and Bones' },
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
const paragraphs = () =>
  [...document.querySelectorAll('.subscription-success__card p')].map(clean);

describe('subscription success page', () => {
  test('a duplicate for another tier names the kept tier and offers Change plan', () => {
    mountWith({ id: 'sub-kept', tierId: 'tier-basic', tierName: 'Basic' });

    expect(clean(document.querySelector('h1'))).toBe(
      "You're already subscribed to Of Blood and Bones (Basic)"
    );
    expect(paragraphs()).toEqual([
      "We've cancelled the second subscription and are refunding it.",
      'Want Pro instead? Use Change plan.',
    ]);
    expect(links()).toEqual([
      ['Go to Of Blood and Bones', '/'],
      ['Change plan', '/pricing'],
    ]);
    expect(document.querySelector('.checkmark')).toBeNull();
  });

  test('a duplicate for the same tier has no Change plan', () => {
    mountWith({ id: 'sub-kept', tierId: 'tier-pro', tierName: 'Pro' });

    expect(clean(document.querySelector('h1'))).toBe(
      "You're already subscribed to Of Blood and Bones (Pro)"
    );
    expect(paragraphs()).toEqual([
      "We've cancelled the second subscription and are refunding it.",
    ]);
    expect(links()).toEqual([['Go to Of Blood and Bones', '/']]);
  });

  test('a first subscription still confirms, unchanged', () => {
    mountWith();

    expect(clean(document.querySelector('h1'))).toBe(
      m.subscription_success_title()
    );
    expect(document.querySelector('.checkmark')).not.toBeNull();
    expect(clean(document.querySelector('.subscription-success__tier'))).toBe(
      'Pro · Of Blood and Bones'
    );
    expect(links()).toEqual([[m.nav_library(), '/library']]);
  });

  test('a first subscription refreshes its org subscription and the library, once (WEB-04)', () => {
    mountWith();

    expect(loadSubscriptionMock).toHaveBeenCalledOnce();
    expect(loadSubscriptionMock).toHaveBeenCalledWith(
      'org-1',
      'of-blood-and-bones'
    );
    expect(invalidateCollectionMock).toHaveBeenCalledOnce();
    expect(invalidateCollectionMock).toHaveBeenCalledWith('library');
  });

  test('a duplicate refreshes nothing', () => {
    mountWith({ id: 'sub-kept', tierId: 'tier-pro', tierName: 'Pro' });

    expect(loadSubscriptionMock).not.toHaveBeenCalled();
    expect(invalidateCollectionMock).not.toHaveBeenCalled();
  });
});

describe('subscription success page — capped, then a button (Codex-2hxff.22)', () => {
  let visibility: DocumentVisibilityState = 'visible';

  // The getter outlives this block; leave the tab visible for the next one.
  afterEach(() => {
    visibility = 'visible';
  });

  function mountWaiting(sessionStatus: 'complete' | 'open' | null) {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    component = mount(SubscriptionSuccessPage, {
      target: document.body,
      props: {
        data: {
          verification: sessionStatus ? { sessionStatus } : null,
          verifyFailed: false,
          org: { name: 'Of Blood and Bones' },
        } as never,
      },
    });
    flushSync();
  }

  test('paid but our row is late: six checks over the first minute, then the owner copy, Check again and Go to library', async () => {
    vi.useFakeTimers();
    try {
      mountWaiting('complete');
      expect(clean(document.querySelector('h1'))).toBe(
        m.checkout_success_confirming()
      );

      await vi.advanceTimersByTimeAsync(60_000);
      flushSync();
      expect(invalidateMock).toHaveBeenCalledTimes(6);
      expect(invalidateMock).toHaveBeenCalledWith('subscription:verify');

      expect(clean(document.querySelector('h1'))).toBe(m.checkout_late_title());
      expect(paragraphs()).toEqual([m.checkout_late_description()]);
      expect(clean(document.querySelector('button'))).toBe(
        m.checkout_check_again()
      );
      expect(links()).toEqual([
        [m.checkout_success_go_to_library(), '/library'],
      ]);

      // An hour on an open tab: nothing more, until a click; then one.
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(invalidateMock).toHaveBeenCalledTimes(6);
      document.querySelector('button')?.click();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(invalidateMock).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });

  test('no answer at all: Almost there, with Check again', async () => {
    vi.useFakeTimers();
    try {
      mountWaiting(null);

      await vi.advanceTimersByTimeAsync(60_000);
      flushSync();

      expect(clean(document.querySelector('h1'))).toBe(
        m.checkout_success_almost_there()
      );
      expect(clean(document.querySelector('button'))).toBe(
        m.checkout_check_again()
      );
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });

  test('a hidden tab runs no checks', async () => {
    vi.useFakeTimers();
    try {
      mountWaiting('complete');
      visibility = 'hidden';

      await vi.advanceTimersByTimeAsync(60 * 60_000);

      expect(invalidateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });
});

describe('subscription success page — a failed verify', () => {
  function mountFailed(verifyFailed: boolean) {
    component = mount(SubscriptionSuccessPage, {
      target: document.body,
      props: {
        data: {
          verification: null,
          verifyFailed,
          org: { name: 'Of Blood and Bones' },
        } as never,
      },
    });
    flushSync();
  }

  test('a final failure (4xx) shows the error state at once and stops polling', () => {
    vi.useFakeTimers();
    try {
      mountFailed(true);

      expect(clean(document.querySelector('h1'))).toBe(m.common_error());
      expect(paragraphs()).toEqual([m.checkout_success_error()]);
      // Not the fallback, which implies the payment is still processing.
      expect(clean(document.body)).not.toContain(
        m.checkout_success_almost_there()
      );
      expect(links()).toEqual([
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
      expect(invalidateMock).toHaveBeenCalledWith('subscription:verify');
    } finally {
      vi.useRealTimers();
      invalidateMock.mockClear();
    }
  });
});
