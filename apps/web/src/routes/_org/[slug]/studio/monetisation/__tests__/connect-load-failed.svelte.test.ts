/**
 * Studio → Monetisation: a payout-status read that FAILED is not "no account"
 * (Codex-2hxff.45).
 *
 * The page used to cover a rejected `getMyConnectStatus()` with a "no account"
 * default, so a fully set-up owner saw "Not connected", "Connect Stripe
 * Account", both needs-Connect hints, and (with subscribers) "2 paying
 * subscribers and nowhere to send the money". Now it says "We couldn't load
 * your payout account." with Retry, and claims nothing about the account.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the remote modules are mocked,
 * and the Connect read is a reactive slot that a test fails or answers.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  fail,
  land,
  myConnectSlot,
  NO_ACCOUNT,
  reset,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
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
const loadError = () => q('[data-testid="connect-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
const createTierButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(m.monetisation_tiers_create())
  ) as HTMLButtonElement | undefined;

describe('a failed payout-status read', () => {
  test('says it could not load the account, with Retry, and claims no status', () => {
    mountPage();
    fail(myConnectSlot());
    flushSync();

    const alert = loadError();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.money_setup_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );

    // No status claim: no badge, no "Not connected".
    expect(q('[data-testid="connect-status-badge"]')).toBeNull();
    expect(text()).not.toContain(m.monetisation_connect_not_connected());
  });

  test('offers no set-up or continue button', () => {
    mountPage();
    fail(myConnectSlot());
    flushSync();

    expect(q('[data-testid="connect-stripe-btn"]')).toBeNull();
    expect(text()).not.toContain(m.monetisation_connect_start());
    expect(text()).not.toContain(m.monetisation_connect_continue());
  });

  test('shows no set-up warnings: no readiness prompt and neither needs-Connect hint', () => {
    mountPage();
    fail(myConnectSlot());
    flushSync();

    // Two subscribers + the "no account" default used to raise this one.
    expect(q('.money-prompt')).toBeNull();
    expect(text()).not.toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).not.toContain(m.monetisation_feature_requires_connect());
    expect(text()).not.toContain(m.monetisation_tiers_requires_connect());
  });

  test('keeps Create tier disabled', () => {
    mountPage();
    fail(myConnectSlot());
    flushSync();

    expect(createTierButton()?.disabled).toBe(true);
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountPage();
    fail(myConnectSlot());
    flushSync();

    expect(error).toHaveBeenCalledWith(
      'studio/monetisation: payout account status failed to load',
      expect.objectContaining({ organizationId: ORG.id })
    );
  });
});

describe('Retry', () => {
  test('refreshes the read; the alert and an enabled Retry stay while it runs', () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();

    retryButton()?.click();
    expect(slot.refresh).toHaveBeenCalledTimes(1);

    // kit: `loading` goes true and `error` stays set until an answer lands.
    slot.loading = true;
    flushSync();
    expect(loadError()).not.toBeNull();
    expect(retryButton()?.disabled).toBe(false);
  });

  test('a successful retry shows the real status in place of the error', () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();

    retryButton()?.click();
    land(slot, ACTIVE_ACCOUNT);
    flushSync();

    expect(loadError()).toBeNull();
    const badge = q('[data-testid="connect-status-badge"]');
    expect(badge?.getAttribute('data-connect-status')).toBe('active');
    expect(text()).toContain(m.monetisation_connect_dashboard());
    expect(createTierButton()?.disabled).toBe(false);
  });
});

describe('a read that succeeded is still believed', () => {
  test('a real "no account" still shows Not connected and the set-up button', () => {
    mountPage();
    land(myConnectSlot(), NO_ACCOUNT);
    flushSync();

    expect(loadError()).toBeNull();
    const badge = q('[data-testid="connect-status-badge"]');
    expect(badge?.getAttribute('data-connect-status')).toBe('not_connected');
    expect(q('[data-testid="connect-stripe-btn"]')).not.toBeNull();
    // Two subscribers and no account: the stranded-money prompt is right here.
    expect(q('.money-prompt')).not.toBeNull();
  });
});
