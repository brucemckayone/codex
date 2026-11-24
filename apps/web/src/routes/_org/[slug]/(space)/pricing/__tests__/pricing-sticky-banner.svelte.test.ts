/**
 * The pricing page's sticky call-to-action is a banner OFFER (Codex-r9ws7):
 * the page renders no bar of its own, on any breakpoint. It hands the
 * page's banner slot a description, which the phone dock or DockBannerHost
 * draws, so these tests read the slot, not the DOM. The page's observers
 * are the real ones; only their callbacks are driven, as a scroll would.
 *
 * Mounts the real `+page.svelte`, mocked as in
 * `pricing-for-content.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  currentDockBanner,
  DOCK_BANNER_PRIORITY,
} from '$lib/components/layout/DockBanner';
import { createSubscriptionCheckoutSession } from '$lib/remote/subscription.remote';
import type { SubscriptionTier } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://films.revelations.studio/pricing');
    },
  },
}));
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  previewSubscriptionTierChange: vi.fn(),
  changeSubscriptionTier: vi.fn(),
  createSubscriptionCheckoutSession: vi.fn(),
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/remote/branding.remote', () => ({
  getPricingFaq: vi.fn(async () => []),
}));
vi.mock('$lib/collections', () => ({
  invalidateCollection: vi.fn(async () => {}),
}));

import PricingPage from '../+page.svelte';

const ORG = { id: '00000000-0000-4000-8000-000000000001', name: 'Hollow Oak' };

function tier(
  id: string,
  name: string,
  priceMonthly: number,
  sortOrder: number,
  isRecommended = false
) {
  return {
    id,
    organizationId: ORG.id,
    name,
    description: `${name} plan`,
    sortOrder,
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    isRecommended,
    isActive: true,
  } as unknown as SubscriptionTier;
}

const BASIC = tier('00000000-0000-4000-8000-0000000000b1', 'Basic', 500, 1);
const PRO = tier('00000000-0000-4000-8000-0000000000b2', 'Pro', 1200, 2, true);

/**
 * Every callback watching each element: the page's reveal observer watches
 * the trust strip too, and a real scroll notifies both.
 */
let watching: Map<Element, IntersectionObserverCallback[]>;

class WatchingObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(el: Element) {
    watching.set(el, [...(watching.get(el) ?? []), this.callback]);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function scroll(selector: string, inView: boolean) {
  const el = document.querySelector(selector);
  const callbacks = el ? watching.get(el) : undefined;
  if (!el || !callbacks) throw new Error(`nothing observes ${selector}`);
  for (const callback of callbacks) {
    callback(
      [{ isIntersecting: inView, target: el } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  }
  flushSync();
}

/** Scrolled past the plan cards, the trust strip at the foot not yet in view. */
const scrollPastPlans = () => scroll('.tier-stage', false);

let component: ReturnType<typeof mount> | null = null;

function mountPage({ isAuthenticated = false } = {}) {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [BASIC, PRO],
        currentSubscription: { data: null, loadError: false },
        isAuthenticated,
        enableSubscriptions: true,
        contentPreview: Promise.resolve([]),
        portals: Promise.resolve([]),
        stats: Promise.resolve(null),
        forContent: Promise.resolve(null),
      },
    } as never,
  });
  flushSync();
}

beforeEach(() => {
  watching = new Map();
  vi.stubGlobal('IntersectionObserver', WatchingObserver);
});

afterEach(() => {
  // The slot is module-level: unmount even when a test failed early, or its
  // offer would still be there for the next test to read.
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.mocked(createSubscriptionCheckoutSession).mockReset();
  vi.unstubAllGlobals();
});

describe('pricing — the sticky call-to-action is a banner offer', () => {
  test('offers nothing while the plans are in view', () => {
    mountPage();
    scroll('.tier-stage', true);

    expect(currentDockBanner()).toBeNull();
  });

  test('past the plans it offers the recommended plan, by the month', () => {
    mountPage();
    scrollPastPlans();

    expect(currentDockBanner()).toMatchObject({
      id: 'pricing-sticky',
      priority: DOCK_BANNER_PRIORITY.pageCta,
      region: 'Subscribe to the recommended plan',
      title: 'Pro · £12.00/mo',
      subtitle: 'Most popular',
      action: {
        label: m.pricing_subscribe(),
        ariaLabel: 'Subscribe to Pro',
        loading: false,
        testId: 'pricing-sticky-subscribe',
      },
      dismiss: { label: 'Dismiss', testId: 'pricing-sticky-dismiss' },
    });
  });

  test('annual billing prices it by the year, with the monthly equivalent', () => {
    mountPage();
    const year =
      document.querySelectorAll<HTMLButtonElement>('.toggle-option')[1];
    year.click();
    flushSync();
    scrollPastPlans();

    expect(currentDockBanner()).toMatchObject({
      title: 'Pro · £120.00/yr',
      subtitle: '£10.00/mo · billed annually',
    });
  });

  test('the trust strip at the foot of the page withdraws it', () => {
    mountPage();
    scrollPastPlans();
    expect(currentDockBanner()).not.toBeNull();

    scroll('.trust', true);

    expect(currentDockBanner()).toBeNull();
  });

  test('its dismiss withdraws it for the rest of the visit', () => {
    mountPage();
    scrollPastPlans();

    currentDockBanner()?.dismiss?.onclick();
    flushSync();
    expect(currentDockBanner()).toBeNull();

    scroll('.tier-stage', true);
    scrollPastPlans();
    expect(currentDockBanner()).toBeNull();
  });

  test('its action starts checkout for that plan, loading meanwhile', () => {
    vi.mocked(createSubscriptionCheckoutSession).mockImplementation(
      () => new Promise(() => {}) as never
    );
    mountPage({ isAuthenticated: true });
    scrollPastPlans();

    currentDockBanner()?.action.onclick?.();
    flushSync();

    expect(createSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ tierId: PRO.id, billingInterval: 'month' })
    );
    expect(currentDockBanner()?.action.loading).toBe(true);
  });
});
