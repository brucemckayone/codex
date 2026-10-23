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

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));

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
