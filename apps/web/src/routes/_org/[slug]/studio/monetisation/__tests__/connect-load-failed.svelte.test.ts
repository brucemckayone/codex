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
  httpError,
  land,
  myConnectSlot,
  NO_ACCOUNT,
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
const loadErrorFocus = () => q('.load-error-focus');
/** Lets a Retry run to its end: the refresh, `tick()`, then the focus move. */
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};
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

/**
 * Retry used to give no sign at all (Codex-2hxff.66 review, MED-1): no
 * in-flight state, and a repeat failure left the `role="alert"` text
 * byte-identical, so nothing was announced and the click looked ignored. A
 * success unmounted the alert with the focused Retry inside it, dropping
 * focus to <body>. Focus now follows the outcome, as `handleRecheckStatus`.
 */
describe('Retry feedback', () => {
  /** A refresh that settles when the test says, the way kit's does. */
  function holdRefresh(slot: ReturnType<typeof myConnectSlot>) {
    let finish: (outcome: 'ok' | 'failed') => void = () => {};
    slot.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = (outcome) => {
            if (outcome === 'ok') {
              land(slot, ACTIVE_ACCOUNT);
              resolve();
            } else {
              fail(slot);
              reject(httpError());
            }
          };
        })
    );
    return (outcome: 'ok' | 'failed') => finish(outcome);
  }

  test('shows "Retrying…" while in flight, keeps the button enabled, and marks the alert busy', async () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();
    const finish = holdRefresh(slot);

    retryButton()?.click();
    flushSync();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(retryButton()?.disabled).toBe(false);
    expect(loadError()?.getAttribute('aria-busy')).toBe('true');

    // A second click while it runs sends nothing more.
    retryButton()?.click();
    expect(slot.refresh).toHaveBeenCalledTimes(1);

    finish('failed');
    await settle();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
    expect(loadError()?.getAttribute('aria-busy')).toBe('false');
  });

  test('a repeat failure says so, and puts focus back on the alert', async () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();
    const finish = holdRefresh(slot);

    retryButton()?.focus();
    retryButton()?.click();
    finish('failed');
    await settle();

    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
    expect(document.activeElement).toBe(loadErrorFocus());
    expect(loadErrorFocus()?.contains(loadError())).toBe(true);
  });

  test('a second repeat failure is announced again: focus returns to the alert', async () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();

    let finish = holdRefresh(slot);
    retryButton()?.click();
    finish('failed');
    await settle();
    // The owner moves back to Retry and tries once more: the alert's text
    // ("We still couldn't…") does not change this time.
    retryButton()?.focus();

    finish = holdRefresh(slot);
    retryButton()?.click();
    finish('failed');
    await settle();
    expect(document.activeElement).toBe(loadErrorFocus());
  });

  test('a success moves focus to a status line that says the account loaded', async () => {
    mountPage();
    const slot = myConnectSlot();
    fail(slot);
    flushSync();
    const finish = holdRefresh(slot);

    retryButton()?.focus();
    retryButton()?.click();
    finish('ok');
    await settle();

    expect(loadError()).toBeNull();
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBe(document.body);
    expect(focused?.getAttribute('role')).toBe('status');
    expect(focused?.textContent?.trim()).toBe(m.money_setup_load_retry_ok());
  });
});

/**
 * A refresh is not a first load (Codex-2hxff.66 review, LOW-2). The page's
 * loading gate used to OR every query's own `loading`, which is also true
 * during a refresh, so a Connect Retry or a tier re-read flipped the Tiers
 * card to skeletons and the toggle OFF for the round trip.
 */
describe('no skeleton flash on a refresh', () => {
  const FOUNDING = {
    id: 'tier-0',
    name: 'Founding',
    description: null,
    priceMonthly: 999,
    priceAnnual: 9990,
    isRecommended: false,
  } as unknown as SubscriptionTier;

  const skeletons = () => document.querySelectorAll('.tier-item--skeleton');
  const toggle = () => q('#enable-subscriptions');

  test('a Connect Retry in flight leaves the Tiers card alone', () => {
    mountPage();
    land(tiersSlot(), [FOUNDING]);
    const slot = myConnectSlot();
    fail(slot);
    flushSync();

    retryButton()?.click();
    slot.loading = true;
    flushSync();

    expect(skeletons()).toHaveLength(0);
    expect(text()).toContain('Founding');
  });

  test('a tier re-read keeps the rows and the toggle as they were', () => {
    mountPage();
    land(myConnectSlot(), ACTIVE_ACCOUNT);
    land(tiersSlot(), [FOUNDING]);
    flushSync();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');

    tiersSlot().loading = true;
    flushSync();

    expect(skeletons()).toHaveLength(0);
    expect(text()).toContain('Founding');
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });

  test('the first load still shows skeletons', () => {
    mountPage();
    flushSync();
    expect(skeletons().length).toBeGreaterThan(0);
  });
});
