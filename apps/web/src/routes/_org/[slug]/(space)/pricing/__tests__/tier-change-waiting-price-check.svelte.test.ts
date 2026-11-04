/**
 * Pricing → Change plan: every change confirms the price the dialog showed
 * (review C1 cycle 2, L4; cycle 3, L4-a).
 *
 * A cheaper plan (.16) or leaving yearly billing (.97) bills, at the renewal
 * and with no notice, the price read at confirm. A change made now does too:
 * a lateral or cheaper move that a price saved since turned into an upgrade
 * charges its part-period unseen. So every confirm echoes its preview's
 * `newRecurringAmountCents` (on a billing wait, `billingChange.amountCents`),
 * and the server refuses a price saved since with TIER_CHANGE_PREVIEW_EXPIRED.
 * The page then shows "Prices changed — please review again" with the fresh
 * figures, and the next confirm echoes the fresh price.
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules and the
 * collections are mocked, as in tier-change-billing-wait.
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
  keepCurrentPlan: vi.fn(),
  reactivateSubscription: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://hollow-oak.revelations.studio/pricing');
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

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};

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

const BASIC = tier('00000000-0000-4000-8000-0000000000b1', 'Basic', 500, 1);
const PRO = tier('00000000-0000-4000-8000-0000000000b2', 'Pro', 1200, 2);
const PREMIUM = tier(
  '00000000-0000-4000-8000-0000000000b3',
  'Premium',
  2000,
  3
);
/** At Pro's price: a move to it is lateral, made now. */
const STUDIO = tier('00000000-0000-4000-8000-0000000000b4', 'Studio', 1200, 4);

const RENEWAL = '2027-03-12T00:00:00.000Z';

/** Alex on Pro, billed `interval`. */
function onPro(interval: 'month' | 'year') {
  return {
    tierId: PRO.id,
    tier: { id: PRO.id, name: PRO.name },
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: RENEWAL,
    billingInterval: interval,
    amountCents: interval === 'year' ? 12000 : 1200,
    heldAmountCents: null,
    pendingTierChange: null,
  };
}

/** .16: a cheaper plan on the same billing waits for the renewal. */
function downgradePreview(cents: number): TierChangePreview {
  return {
    amountDueCents: 0,
    prorationLineItems: [],
    newRecurringAmountCents: cents,
    newRecurringInterval: 'month',
    prorationDate: 1_790_000_000,
    isUpgrade: false,
    takesEffect: 'period_end',
    currentPeriodEnd: RENEWAL,
    billingChange: null,
    replaces: null,
  };
}

/** A and B: monthly billing waits for the year's end. */
function billingWaitPreview(cents: number): TierChangePreview {
  return {
    ...downgradePreview(cents),
    billingChange: {
      interval: 'month',
      amountCents: cents,
      effectiveAt: RENEWAL,
    },
  };
}

/** C(b): Premium now on yearly billing, then monthly from the renewal. */
function upgradeThenMonthlyPreview(cents: number): TierChangePreview {
  return {
    ...billingWaitPreview(cents),
    amountDueCents: 2915,
    prorationDate: 1_790_000_100,
    isUpgrade: true,
    takesEffect: 'now',
  };
}

/** A change made now, on monthly billing: an upgrade, or a lateral move. */
function nowPreview(
  cents: number,
  amountDueCents: number,
  isUpgrade: boolean
): TierChangePreview {
  return {
    ...downgradePreview(cents),
    amountDueCents,
    isUpgrade,
    takesEffect: 'now',
  };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  for (const fn of Object.values(remote)) fn.mockReset();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(current: Record<string, unknown>) {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [BASIC, PRO, PREMIUM, STUDIO],
        currentSubscription: { data: current, loadError: false },
        isAuthenticated: true,
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

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const clean = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

function cardButton(name: string) {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>('article.card')
  ).find((el) => clean(el.querySelector('.card__name')?.textContent) === name);
  if (!card) throw new Error(`no card for ${name}`);
  return card.querySelector<HTMLButtonElement>(
    '[data-testid="tier-action"] button'
  );
}

const EXPIRED = {
  success: false,
  code: 'TIER_CHANGE_PREVIEW_EXPIRED',
  message: 'Prices changed. Review the change again.',
  status: 409,
};

describe('every change confirms the price the dialog showed', () => {
  test.each([
    {
      kind: 'a cheaper plan (.16)',
      current: onPro('month'),
      open: () => cardButton('Basic')?.click(),
      tierId: BASIC.id,
      preview: downgradePreview,
      shown: 500,
      fresh: 550,
    },
    {
      kind: 'A: the same plan on monthly billing',
      current: onPro('year'),
      open: () => byTestId('tier-cta-switch-interval')?.click(),
      tierId: PRO.id,
      preview: billingWaitPreview,
      shown: 1200,
      fresh: 1300,
    },
    {
      kind: 'B: a cheaper plan on monthly billing',
      current: onPro('year'),
      open: () => cardButton('Basic')?.click(),
      tierId: BASIC.id,
      preview: billingWaitPreview,
      shown: 500,
      fresh: 550,
    },
    {
      kind: 'C(b): a dearer plan now, monthly billing waiting',
      current: onPro('year'),
      open: () => cardButton('Premium')?.click(),
      tierId: PREMIUM.id,
      preview: upgradeThenMonthlyPreview,
      shown: 2000,
      fresh: 2100,
    },
  ])('$kind: echoed, and a price saved since is reviewed again', async (c) => {
    remote.previewSubscriptionTierChange
      .mockResolvedValueOnce({ success: true, data: c.preview(c.shown) })
      .mockResolvedValueOnce({ success: true, data: c.preview(c.fresh) });
    remote.changeSubscriptionTier
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValueOnce({ success: true, data: c.current });
    mountPage(c.current);

    c.open();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        newTierId: c.tierId,
        billingInterval: 'month',
        newRecurringAmountCents: c.shown,
      })
    );
    // Refused, nothing changed: the fresh figures wait on a new confirm.
    expect(clean(byTestId('tier-change-notice')?.textContent)).toBe(
      m.subscription_tier_change_preview_expired()
    );
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(EXPIRED.message);
    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(1);

    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(2);
    expect(remote.changeSubscriptionTier).toHaveBeenLastCalledWith(
      expect.objectContaining({ newRecurringAmountCents: c.fresh })
    );
  });

  test.each([
    {
      kind: 'an upgrade made now',
      open: () => cardButton('Premium')?.click(),
      tierId: PREMIUM.id,
      shown: nowPreview(2000, 800, true),
      fresh: nowPreview(2100, 900, true),
    },
    {
      kind: 'a lateral move that a price saved since made an upgrade',
      open: () => cardButton('Studio')?.click(),
      tierId: STUDIO.id,
      shown: nowPreview(1200, 0, false),
      fresh: nowPreview(1500, 300, true),
    },
  ])('$kind: echoed, and a price saved since is reviewed again (L4-a)', async (c) => {
    remote.previewSubscriptionTierChange
      .mockResolvedValueOnce({ success: true, data: c.shown })
      .mockResolvedValueOnce({ success: true, data: c.fresh });
    remote.changeSubscriptionTier
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValueOnce({ success: true, data: onPro('month') });
    mountPage(onPro('month'));

    c.open();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        newTierId: c.tierId,
        billingInterval: 'month',
        newRecurringAmountCents: c.shown.newRecurringAmountCents,
      })
    );
    // Refused, nothing changed: the fresh figures wait on a new confirm.
    expect(clean(byTestId('tier-change-notice')?.textContent)).toBe(
      m.subscription_tier_change_preview_expired()
    );
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(EXPIRED.message);
    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(1);

    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenCalledTimes(2);
    expect(remote.changeSubscriptionTier).toHaveBeenLastCalledWith(
      expect.objectContaining({
        newRecurringAmountCents: c.fresh.newRecurringAmountCents,
      })
    );
  });
});
