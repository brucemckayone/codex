/**
 * Pricing, opened from a film's paywall (Codex-2hxff.91, owner decision U10,
 * mockup pricing A): the hero names the plans that include the film, and each
 * plan card's first line says whether IT includes it. The "Most Popular" glow
 * stays where the creator put it. The film is streamed (`forContent`): the
 * cards render first, and a failed or unknown film is no highlight at all.
 *
 * Mounts the real `+page.svelte`, with `$app/*`, the remote modules and the
 * collections mocked as in `tier-change-disputed.svelte.test.ts`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
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
      return new URL('https://films.revelations.studio/pricing?for=salt-roads');
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
const PREMIUM = tier(
  '00000000-0000-4000-8000-0000000000b3',
  'Premium',
  2000,
  3
);

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(forContent: Promise<unknown>) {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [BASIC, PRO, PREMIUM],
        currentSubscription: { data: null, loadError: false },
        isAuthenticated: false,
        enableSubscriptions: true,
        contentPreview: Promise.resolve([]),
        portals: Promise.resolve([]),
        stats: Promise.resolve(null),
        forContent,
      },
    } as never,
  });
  flushSync();
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

const subtitle = () =>
  document
    .querySelector('[data-testid="pricing-hero-subtitle"]')
    ?.textContent?.trim();
const contentLines = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-testid="tier-content-line"]'
    ),
  ].map((li) => ({
    text: li.textContent?.trim(),
    includes: li.dataset.includes,
  }));
const cardNames = () =>
  [...document.querySelectorAll('.card__name')].map((n) => n.textContent);

const SALT_ROADS = {
  title: 'Salt Roads',
  slug: 'salt-roads',
  includedInTierIds: [PRO.id, PREMIUM.id],
};

describe('pricing opened from a film (U10)', () => {
  test('the hero names the including plans; each card says whether it includes the film', async () => {
    mountPage(Promise.resolve(SALT_ROADS));
    await settle();

    expect(subtitle()).toBe('Salt Roads is included with Pro and Premium.');
    const back = document.querySelector<HTMLAnchorElement>(
      '[data-testid="pricing-for-content-back"]'
    );
    expect(back?.textContent?.trim()).toBe('Back to Salt Roads');
    expect(back?.getAttribute('href')).toBe('/content/salt-roads');

    expect(cardNames()).toEqual(['Basic', 'Pro', 'Premium']);
    expect(contentLines()).toEqual([
      { text: "Doesn't include Salt Roads", includes: 'false' },
      { text: 'Includes Salt Roads', includes: 'true' },
      { text: 'Includes Salt Roads', includes: 'true' },
    ]);
    // No plan is hidden, and the creator's Most Popular stays on Pro.
    expect(
      document.querySelector('.card--featured .card__name')?.textContent
    ).toBe('Pro');
  });

  test('a bundle marks exactly its plans, not a ladder', async () => {
    mountPage(
      Promise.resolve({
        title: 'Winter Light',
        slug: 'winter-light',
        includedInTierIds: [BASIC.id, PREMIUM.id],
      })
    );
    await settle();

    expect(subtitle()).toBe('Winter Light is included with Basic and Premium.');
    expect(contentLines().map((l) => l.includes)).toEqual([
      'true',
      'false',
      'true',
    ]);
  });

  test('a film no plan includes says so, and every card says it does not', async () => {
    mountPage(
      Promise.resolve({
        title: 'Lost Reels',
        slug: 'lost-reels',
        includedInTierIds: [],
      })
    );
    await settle();

    expect(subtitle()).toBe('No plan includes Lost Reels right now.');
    expect(contentLines().every((l) => l.includes === 'false')).toBe(true);
  });

  test('while the film streams, the cards are there with today’s copy', () => {
    mountPage(new Promise(() => {}));

    expect(cardNames()).toEqual(['Basic', 'Pro', 'Premium']);
    expect(subtitle()).toBe(m.subscription_pricing_subtitle());
    expect(contentLines()).toEqual([]);
  });

  test('a failed or unknown film (null) is no highlight at all', async () => {
    mountPage(Promise.resolve(null));
    await settle();

    expect(subtitle()).toBe(m.subscription_pricing_subtitle());
    expect(contentLines()).toEqual([]);
    expect(
      document.querySelector('[data-testid="pricing-for-content-back"]')
    ).toBeNull();
    expect(cardNames()).toEqual(['Basic', 'Pro', 'Premium']);
  });
});
