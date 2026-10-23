/**
 * Journey checkout return leg — the duplicate-payment notice (Codex-o4jvw;
 * owner decision 2026-10-22, "Say it plainly").
 *
 * When the load reports `duplicate`, the waiting room becomes a calm notice:
 * the buyer already has access, this payment is being refunded, and the way
 * in. It is final, so the page stops polling. Without one, the waiting room is
 * unchanged.
 *
 * Mounts the real `+page.svelte`; `$app/navigation` is mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }));

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

function mountWith(duplicate: Duplicate) {
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
