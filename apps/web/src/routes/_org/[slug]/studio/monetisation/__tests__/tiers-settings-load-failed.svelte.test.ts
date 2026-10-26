/**
 * Studio → Monetisation: a failed tiers or settings read is not "no tiers" /
 * "subscriptions off" (Codex-2hxff.74, the .45 pattern).
 *
 * - A rejected `listTiers` used to render "No subscription tiers yet." with
 *   Create Tier enabled once Stripe was ready, so an owner with three tiers
 *   could make a duplicate first one. Now: "We couldn't load your tiers." with
 *   Retry in place of the list, and no Create Tier.
 * - A rejected `getOrgSettings` used to show the Enable Subscriptions switch
 *   OFF, and switching it wrote a setting the owner never saw. Now the alert
 *   stands in for the switch.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the remote modules are mocked.
 * The tier read is the shared reactive slot; the settings read is a plain
 * object a test swaps before mounting.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const settings = vi.hoisted(() => ({ result: null as unknown }));

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
  getOrgSettings: () => settings.result,
}));

import {
  ACTIVE_ACCOUNT,
  fail,
  httpError,
  land,
  myConnectSlot,
  reset,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import type { SubscriptionTier } from '$lib/types';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};

const FOUNDING = {
  id: 'tier-0',
  name: 'Founding',
  description: null,
  priceMonthly: 999,
  priceAnnual: 9990,
  isRecommended: false,
} as unknown as SubscriptionTier;

const SETTINGS_ON = {
  current: { features: { enableSubscriptions: true } },
  error: undefined,
  loading: false,
  refresh: vi.fn(async () => {}),
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  settings.result = SETTINGS_ON;
  setPage('/studio/monetisation');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const tiersError = () => q('[data-testid="tiers-load-error"]');
const tiersRetry = () =>
  tiersError()?.querySelector('button') as HTMLButtonElement | null;
const createTierButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(m.monetisation_tiers_create())
  );
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

describe('a failed tiers read, with Stripe ready', () => {
  function mountFailed() {
    mountPage();
    land(myConnectSlot(), ACTIVE_ACCOUNT);
    fail(tiersSlot());
    flushSync();
  }

  test('says it could not load the tiers, with Retry', () => {
    mountFailed();
    expect(tiersError()?.getAttribute('role')).toBe('alert');
    expect(tiersError()?.textContent).toContain(
      m.monetisation_tiers_load_failed()
    );
    expect(tiersRetry()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('never says there are no tiers', () => {
    mountFailed();
    expect(text()).not.toContain(m.monetisation_tiers_empty());
    expect(text()).not.toContain(m.monetisation_tiers_empty_description());
  });

  test('offers no Create Tier', () => {
    mountFailed();
    expect(createTierButton()).toBeUndefined();
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();
    expect(error).toHaveBeenCalledWith(
      'studio/monetisation: tiers failed to load',
      expect.objectContaining({ organizationId: ORG.id })
    );
  });

  test('a Retry that fails again says "We still couldn\'t…"', async () => {
    mountFailed();
    const slot = tiersSlot();
    slot.refresh.mockImplementationOnce(async () => {
      fail(slot);
      throw httpError();
    });

    tiersRetry()?.click();
    await settle();

    expect(slot.refresh).toHaveBeenCalledTimes(1);
    expect(tiersError()?.textContent).toContain(
      m.monetisation_tiers_load_failed_again()
    );
  });

  test('a Retry that loads them shows the tiers and Create Tier', async () => {
    mountFailed();
    const slot = tiersSlot();
    slot.refresh.mockImplementationOnce(async () => {
      land(slot, [FOUNDING]);
    });

    tiersRetry()?.click();
    await settle();

    expect(tiersError()).toBeNull();
    expect(text()).toContain('Founding');
    expect(createTierButton()?.disabled).toBe(false);
  });
});

test('a tier list that LOADED empty still says so, with Create Tier (negative control)', () => {
  mountPage();
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), []);
  flushSync();

  expect(tiersError()).toBeNull();
  expect(text()).toContain(m.monetisation_tiers_empty());
  expect(createTierButton()?.disabled).toBe(false);
});

describe('a failed settings read', () => {
  function mountFailed() {
    settings.result = {
      current: undefined,
      error: httpError(),
      loading: false,
      refresh: vi.fn(async () => {}),
    };
    mountPage();
    land(myConnectSlot(), ACTIVE_ACCOUNT);
    land(tiersSlot(), [FOUNDING]);
    flushSync();
  }

  test('shows the alert in place of the Enable Subscriptions switch', () => {
    mountFailed();
    expect(q('[data-testid="settings-load-error"]')?.textContent).toContain(
      m.monetisation_settings_load_failed()
    );
    // No OFF switch to guess with, and none to flip.
    expect(q('#enable-subscriptions')).toBeNull();
  });

  test('leaves the tiers alone', () => {
    mountFailed();
    expect(text()).toContain('Founding');
    expect(createTierButton()?.disabled).toBe(false);
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();
    expect(error).toHaveBeenCalledWith(
      'studio/monetisation: settings failed to load',
      expect.objectContaining({ organizationId: ORG.id })
    );
  });
});

test('a settings read that loaded shows the switch as it is (negative control)', () => {
  mountPage();
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [FOUNDING]);
  flushSync();

  expect(q('[data-testid="settings-load-error"]')).toBeNull();
  expect(q('#enable-subscriptions')?.getAttribute('aria-checked')).toBe('true');
});
