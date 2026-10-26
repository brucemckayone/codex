/**
 * Pricing: what a subscriber is told when Subscribe or Change plan is refused
 * (Codex-2hxff.69; owner decision 2026-10-26, "Plain message + right action").
 *
 * The worker puts most subscription codes in `details.code`, under a class
 * code at the top level (NOT_FOUND, CONFLICT, BUSINESS_LOGIC_ERROR). The page
 * used to switch on the top-level code alone, so every one of these read as
 * the generic "Something went wrong… try again", with a Try again that was
 * refused again. Now:
 * - already subscribed, plan gone, not taking subscriptions yet: the plain
 *   message, no "Something went wrong" heading, no Try again; Manage
 *   subscription for the first, the plans refreshed for the second;
 * - a checkout problem: "We couldn't start checkout. Please try again.",
 *   never the worker's text, with Try again only where a retry can work;
 * - a change-plan preview or switch refused for a lasting reason: the reason
 *   and a single Close.
 *
 * Mounts the real `+page.svelte`, mocked as in
 * `tier-change-disputed.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionTier, TierChangePreview } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const remote = vi.hoisted(() => ({
  createSubscriptionCheckoutSession: vi.fn(),
  previewSubscriptionTierChange: vi.fn(),
  changeSubscriptionTier: vi.fn(),
}));
const { invalidateAllMock } = vi.hoisted(() => ({
  invalidateAllMock: vi.fn(async () => {}),
}));
const { loggerWarnMock } = vi.hoisted(() => ({ loggerWarnMock: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: {
    warn: loggerWarnMock,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://yoga.revelations.studio/pricing');
    },
  },
}));
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: invalidateAllMock,
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  ...remote,
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

const ORG = { id: '00000000-0000-4000-8000-000000000001', name: 'Yoga Studio' };

function tier(
  id: string,
  name: string,
  priceMonthly: number,
  sortOrder: number
) {
  return {
    id,
    organizationId: ORG.id,
    name,
    description: `${name} tier`,
    sortOrder,
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    isRecommended: false,
    isActive: true,
  } as unknown as SubscriptionTier;
}

const GOLD = tier('00000000-0000-4000-8000-0000000000a1', 'Gold', 1000, 1);
const PLATINUM = tier(
  '00000000-0000-4000-8000-0000000000a2',
  'Platinum',
  3000,
  2
);

const PREVIEW: TierChangePreview = {
  amountDueCents: 2000,
  prorationLineItems: [],
  newRecurringAmountCents: 3000,
  newRecurringInterval: 'month',
  prorationDate: 1_790_000_000,
  isUpgrade: true,
  currentPeriodEnd: '2026-11-22T00:00:00.000Z',
};

/** A failure as the subscription remote returns it. */
function refused(
  code: string | undefined,
  detailsCode: string | undefined,
  status: number,
  message = 'The worker said something for developers'
) {
  return { success: false, code, detailsCode, message, status };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  remote.createSubscriptionCheckoutSession.mockReset();
  remote.previewSubscriptionTierChange.mockReset();
  remote.changeSubscriptionTier.mockReset();
  invalidateAllMock.mockClear();
  loggerWarnMock.mockClear();
  // jsdom has no layout: the banner is scrolled into view after a refusal.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(subscriber: boolean, loadError = false) {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [GOLD, PLATINUM],
        currentSubscription: {
          data: subscriber
            ? {
                tierId: GOLD.id,
                status: 'active',
                cancelAtPeriodEnd: false,
                currentPeriodEnd: '2026-11-22T00:00:00.000Z',
                billingInterval: 'month',
              }
            : null,
          loadError,
        },
        isAuthenticated: true,
        enableSubscriptions: true,
        contentPreview: Promise.resolve([]),
        portals: Promise.resolve([]),
        stats: Promise.resolve(null),
      },
    } as never,
  });
  flushSync();
}

/** Let the mocked remote calls settle and the page re-render. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const banner = () => byTestId('checkout-refusal');
const bannerButtons = () =>
  [
    ...(banner()?.querySelectorAll(
      '.checkout-error__body button, .checkout-error__body a'
    ) ?? []),
  ].map(clean);

async function subscribeRefusedWith(failure: ReturnType<typeof refused>) {
  remote.createSubscriptionCheckoutSession.mockResolvedValueOnce(failure);
  mountPage(false);
  document
    .querySelector<HTMLElement>('[data-testid="tier-cta-subscribe"]')
    ?.click();
  await settle();
}

describe('Subscribe refused', () => {
  test('already subscribed: the plain message and Manage subscription; no heading, no Try again', async () => {
    await subscribeRefusedWith(refused('CONFLICT', 'ALREADY_SUBSCRIBED', 409));

    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      "You're already subscribed to Yoga Studio."
    );
    expect(banner()?.querySelector('.checkout-error__title')).toBeNull();
    expect(bannerButtons()).toEqual([m.pricing_refusal_manage_subscription()]);
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      'https://revelations.studio/account/subscriptions'
    );
  });

  test('plan gone: the plain message, and the plans refresh; no heading, no Try again', async () => {
    await subscribeRefusedWith(refused('NOT_FOUND', 'TIER_NOT_FOUND', 404));

    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      m.pricing_refusal_plan_gone()
    );
    expect(banner()?.querySelector('.checkout-error__title')).toBeNull();
    expect(bannerButtons()).toEqual([]);
    expect(invalidateAllMock).toHaveBeenCalledOnce();
  });

  test.each([
    'CONNECT_ACCOUNT_NOT_READY',
    'CONNECT_ACCOUNT_NOT_FOUND',
  ])('%s: not taking subscriptions yet; no heading, no Try again', async (code) => {
    await subscribeRefusedWith(refused('BUSINESS_LOGIC_ERROR', code, 422));

    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      "Yoga Studio isn't taking subscriptions yet. Please check back later."
    );
    expect(banner()?.querySelector('.checkout-error__title')).toBeNull();
    expect(bannerButtons()).toEqual([]);
  });

  test.each([
    [
      'no answer',
      refused(undefined, undefined, 500, 'An unexpected error occurred'),
    ],
    ['a server error', refused('INTERNAL_ERROR', undefined, 503)],
    ['too many requests', refused('RATE_LIMITED', undefined, 429)],
  ])('a checkout problem (%s): fixed copy, the heading, and Try again', async (_label, failure) => {
    await subscribeRefusedWith(failure);

    expect(clean(banner()?.querySelector('.checkout-error__title'))).toBe(
      m.common_error()
    );
    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      m.pricing_refusal_checkout_problem()
    );
    expect(bannerButtons()).toEqual(['Try again']);
  });

  test("a checkout problem never shows the worker's text, and a 4xx gets no Try again, nor asks for one", async () => {
    await subscribeRefusedWith(
      refused(
        'BUSINESS_LOGIC_ERROR',
        'SUBSCRIPTION_CHECKOUT_ERROR',
        422,
        'Stripe Price not configured for this tier and interval'
      )
    );

    expect(clean(banner())).not.toContain('Stripe Price not configured');
    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      m.pricing_refusal_checkout_refused()
    );
    expect(clean(banner())).not.toMatch(/try again/i);
    expect(bannerButtons()).toEqual([]);
  });

  test("the current subscription couldn't be loaded: checkout refused, with no 'Please try again'", async () => {
    mountPage(false, true);
    byTestId('tier-cta-subscribe')?.click();
    await settle();

    expect(remote.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
    expect(clean(banner()?.querySelector('.checkout-error__message'))).toBe(
      m.pricing_refusal_subscription_unknown()
    );
    expect(clean(banner())).not.toMatch(/please try again/i);
    expect(bannerButtons()).toEqual([]);
  });
});

describe('Change plan refused', () => {
  async function openPreview() {
    mountPage(true);
    byTestId('tier-cta-switch')?.click();
    await settle();
  }

  test('a preview refused for a lasting reason: the reason and a single Close', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(
      refused('CONFLICT', 'SUBSCRIPTION_DISPUTED', 409)
    );
    await openPreview();

    expect(clean(document.body)).toContain(
      m.subscription_tier_change_disputed()
    );
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(byTestId('tier-change-dialog-retry')).toBeNull();
    expect(byTestId('tier-change-dialog-cancel')).toBeNull();
  });

  test('a preview for a plan that has gone: the plain message, the plans refreshed, Close', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(
      refused('NOT_FOUND', 'TIER_NOT_FOUND', 404)
    );
    await openPreview();

    expect(clean(document.body)).toContain(m.pricing_refusal_plan_gone());
    expect(invalidateAllMock).toHaveBeenCalledOnce();
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(byTestId('tier-change-dialog-retry')).toBeNull();
  });

  test("a preview refused with a 4xx we have no words for: a plain message, a single Close, no 'Please try again'", async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(
      refused('BUSINESS_LOGIC_ERROR', 'SUBSCRIPTION_CHECKOUT_ERROR', 422)
    );
    await openPreview();

    expect(clean(document.body)).toContain(m.pricing_refusal_change_refused());
    expect(clean(document.body)).not.toMatch(/please try again/i);
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(byTestId('tier-change-dialog-retry')).toBeNull();
  });

  test('a preview that failed where a retry can work keeps Cancel and Try again', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(
      refused('INTERNAL_ERROR', undefined, 500)
    );
    await openPreview();

    expect(byTestId('tier-change-dialog-retry')).not.toBeNull();
    expect(byTestId('tier-change-dialog-cancel')).not.toBeNull();
    expect(byTestId('tier-change-dialog-close')).toBeNull();
  });

  test("a preview that throws shows fixed copy, never the error's own text", async () => {
    remote.previewSubscriptionTierChange.mockRejectedValueOnce(
      new Error('TypeError: Failed to fetch at fetchPreview (pricing.js:12)')
    );
    await openPreview();

    expect(clean(document.body)).not.toContain('Failed to fetch');
    expect(clean(document.body)).toContain(m.subscription_checkout_error());
    expect(byTestId('tier-change-dialog-retry')).not.toBeNull();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'pricing: a plan-change preview got no answer',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  // No answer is not "it failed": the change and its proration may have gone
  // through. The page re-reads the plan instead of restoring the old one, and
  // offers no retry that could charge again.
  test('a switch that gets no answer: logged, the plan re-read, Close only, and no retry', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: PREVIEW,
    });
    remote.changeSubscriptionTier.mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    await openPreview();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'pricing: a plan change got no answer',
      { error: 'Failed to fetch' }
    );
    expect(invalidateAllMock).toHaveBeenCalledOnce();
    expect(clean(document.body)).toContain(
      m.pricing_refusal_change_unconfirmed()
    );
    expect(clean(document.body)).not.toMatch(/please try again/i);
    expect(byTestId('tier-change-dialog-confirm')).toBeNull();
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
  });

  test('a switch refused at Confirm for a lasting reason: the reason, and Close in place of Confirm', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: PREVIEW,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce(
      refused('CONFLICT', 'SUBSCRIPTION_DISPUTED', 409)
    );
    await openPreview();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(clean(document.body)).toContain(
      m.subscription_tier_change_disputed()
    );
    expect(byTestId('tier-change-dialog-confirm')).toBeNull();
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
  });
});
