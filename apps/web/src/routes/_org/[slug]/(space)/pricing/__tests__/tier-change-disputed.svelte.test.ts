/**
 * Pricing → Change plan: a plan with an open payment dispute can't be changed
 * (Codex-2hxff.60).
 *
 * While a chargeback on one of its invoices is open, the worker refuses both
 * the price preview and the change itself with a 409: top-level code
 * 'CONFLICT', and 'SUBSCRIPTION_DISPUTED' in `details.code`, which the remote
 * forwards as `detailsCode`. The dialog says plainly why, instead of the
 * generic "Something went wrong… Please try again", which retrying can't fix.
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules (they import
 * `$app/server`) and the collections are mocked, as in
 * `tier-change-review-again.svelte.test.ts`.
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
  previewSubscriptionTierChange: vi.fn(),
  changeSubscriptionTier: vi.fn(),
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
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  ...remote,
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

/** What the remote returns for the worker's 409 on a disputed plan. */
const DISPUTED = {
  success: false,
  code: 'CONFLICT',
  detailsCode: 'SUBSCRIPTION_DISPUTED',
  message:
    'The plan cannot be changed while a payment dispute on this subscription is open.',
  status: 409,
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  remote.previewSubscriptionTierChange.mockReset();
  remote.changeSubscriptionTier.mockReset();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage() {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [GOLD, PLATINUM],
        // A Gold subscriber, monthly.
        currentSubscription: {
          data: {
            tierId: GOLD.id,
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: '2026-11-22T00:00:00.000Z',
            billingInterval: 'month',
          },
          loadError: false,
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
const bodyText = () => document.body.textContent ?? '';

describe('tier change: a plan with an open payment dispute', () => {
  test('a refused preview says why, and quotes no price', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(DISPUTED);
    mountPage();

    byTestId('tier-cta-switch')?.click();
    await settle();

    expect(bodyText()).toContain(m.subscription_tier_change_disputed());
    expect(bodyText()).not.toContain(m.subscription_checkout_error());
    expect(byTestId('tier-change-dialog-confirm')).toBeNull();
    expect(remote.changeSubscriptionTier).not.toHaveBeenCalled();
  });

  test('a refused confirmation says why', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: PREVIEW,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce(DISPUTED);
    mountPage();

    byTestId('tier-cta-switch')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain(m.subscription_tier_change_disputed());
    expect(bodyText()).not.toContain(m.subscription_checkout_error());
    // Not taken for an expired preview: no second preview.
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledTimes(1);
  });
});
