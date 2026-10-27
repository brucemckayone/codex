/**
 * Pricing → Change plan: a preview that has expired is priced again and
 * confirmed again (Codex-2hxff.15; owner decision 2026-10-22, "Prices
 * changed, review again").
 *
 * A tier-change preview is good for 10 minutes. A change confirmed later is
 * refused with TIER_CHANGE_PREVIEW_EXPIRED and nothing changes. The dialog
 * says so, fetches a fresh preview and asks the subscriber to confirm again;
 * that confirmation sends the fresh preview's proration date.
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules (they import
 * `$app/server`) and the collections are mocked.
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

function preview(
  amountDueCents: number,
  prorationDate: number
): TierChangePreview {
  return {
    amountDueCents,
    prorationLineItems: [],
    newRecurringAmountCents: 3000,
    newRecurringInterval: 'month',
    prorationDate,
    isUpgrade: true,
    currentPeriodEnd: '2026-11-22T00:00:00.000Z',
  };
}

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

describe('tier change: an expired preview', () => {
  test('is priced again and must be confirmed again, with the fresh proration date', async () => {
    remote.previewSubscriptionTierChange
      .mockResolvedValueOnce({
        success: true,
        data: preview(2000, 1_790_000_000),
      })
      .mockResolvedValueOnce({
        success: true,
        data: preview(1950, 1_790_000_900),
      });
    remote.changeSubscriptionTier
      .mockResolvedValueOnce({
        success: false,
        code: 'TIER_CHANGE_PREVIEW_EXPIRED',
        message: 'The price preview has expired',
        status: 409,
      })
      .mockResolvedValueOnce({ success: true, data: {} });
    mountPage();

    byTestId('tier-cta-switch')?.click();
    await settle();
    expect(byTestId('tier-change-dialog-confirm')?.textContent).toContain(
      '£20.00'
    );

    // Confirmed after the preview expired: refused, nothing changed.
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenNthCalledWith(1, {
      organizationId: ORG.id,
      newTierId: PLATINUM.id,
      billingInterval: 'month',
      prorationDate: 1_790_000_000,
    });
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledTimes(2);
    expect(byTestId('tier-change-notice')?.textContent?.trim()).toBe(
      m.subscription_tier_change_preview_expired()
    );
    // The fresh price, waiting on a new confirmation; no error shown.
    const confirm = byTestId('tier-change-dialog-confirm');
    expect(confirm?.textContent).toContain('£19.50');
    expect(document.body.textContent).not.toContain(
      'The price preview has expired'
    );
    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(1);

    confirm?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(2);
    expect(remote.changeSubscriptionTier).toHaveBeenLastCalledWith({
      organizationId: ORG.id,
      newTierId: PLATINUM.id,
      billingInterval: 'month',
      prorationDate: 1_790_000_900,
    });
  });

  test('another refusal is shown as an error, with no fresh preview', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: preview(2000, 1_790_000_000),
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: false,
      code: 'PAYMENT_REQUIRED',
      message: 'Your card was declined.',
      status: 402,
    });
    mountPage();

    byTestId('tier-cta-switch')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledTimes(1);
    expect(byTestId('tier-change-notice')).toBeNull();
    expect(document.body.textContent).toContain('Your card was declined.');
  });
});
