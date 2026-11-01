/**
 * Studio → Monetisation: the Edit Tier dialog's one quiet line before saving
 * new prices (Codex-2hxff.85, owner decision Q7; batch C1 Part B page 4,
 * P1). It shows only when a price differs from the saved one and the tier
 * has subscribers, and the count is the tier row's.
 *
 * Mounts the real `+page.svelte` and dialog; `$app/*` and the remote modules
 * are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionTier } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/subscription.remote',
  () =>
    import(
      '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgSettings: () => ({
    current: { features: { enableSubscriptions: true } },
    error: undefined,
    loading: false,
  }),
}));

import {
  ACTIVE_ACCOUNT,
  land,
  myConnectSlot,
  reset,
  statsSlot,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};
const PRO = {
  id: 'pro',
  name: 'Pro',
  description: 'Every film',
  priceMonthly: 1200,
  priceAnnual: 12000,
  isRecommended: false,
} as unknown as SubscriptionTier;

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(subscribers: number) {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [PRO]);
  land(statsSlot(), {
    totalSubscribers: subscribers,
    activeSubscribers: subscribers,
    mrrCents: subscribers * 1200,
    tierBreakdown:
      subscribers > 0
        ? [
            {
              tierId: 'pro',
              tierName: 'Pro',
              subscriberCount: subscribers,
              mrrCents: subscribers * 1200,
            },
          ]
        : [],
  });
  flushSync();
}

function openEdit() {
  document
    .querySelector<HTMLButtonElement>(
      `button[aria-label="${m.monetisation_tiers_edit_aria({ name: 'Pro' })}"]`
    )
    ?.click();
  flushSync();
}

function setPrice(
  id: 'tier-price-monthly' | 'tier-price-annual',
  pence: number
) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no ${id}`);
  input.value = String(pence);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const hint = () =>
  document.querySelector<HTMLElement>('[data-testid="tier-price-hint"]');

describe('the Edit Tier line about existing subscribers (P1)', () => {
  test('nothing until a price changes', () => {
    mountPage(23);
    openEdit();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(hint()).toBeNull();
  });

  test('both prices changed: who will be emailed, when it starts, the 30-day rule', () => {
    mountPage(23);
    openEdit();
    setPrice('tier-price-monthly', 1400);
    setPrice('tier-price-annual', 14000);
    expect(hint()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Your 23 Pro subscribers will be emailed about the new prices. Emails start at the next hourly run, and each person moves at their first renewal at least 30 days after their own email. New subscribers pay the new prices straight away.'
    );
    // The price fields point at it.
    expect(
      document
        .querySelector('#tier-price-monthly')
        ?.getAttribute('aria-describedby')
    ).toBe('tier-price-hint');
  });

  test('a price put back as it was: the line goes', () => {
    mountPage(23);
    openEdit();
    setPrice('tier-price-monthly', 1400);
    expect(hint()).not.toBeNull();
    setPrice('tier-price-monthly', 1200);
    expect(hint()).toBeNull();
  });

  test('a tier nobody subscribes to: no line', () => {
    mountPage(0);
    openEdit();
    setPrice('tier-price-monthly', 1400);
    setPrice('tier-price-annual', 14000);
    expect(hint()).toBeNull();
  });
});
