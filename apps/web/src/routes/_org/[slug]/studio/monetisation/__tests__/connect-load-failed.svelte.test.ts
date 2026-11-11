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
 * Mounts the real `+page.svelte`; `$app/*` and the remote modules are mocked.
 * The Connect read is a double of kit's query (`kitMyConnect`), so a Retry
 * takes kit's real path: the page is handed a NEW query, still loading
 * (Codex-if444). On the old slot, which never swaps, these tests passed while
 * the page judged its Retry on that loading query: a repeat failure read as
 * a success, and focus fell to <body>.
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

import type {
  KitQuery,
  KitRead,
} from '$lib/components/studio/__fixtures__/kit-query.mock.svelte';
import {
  ACTIVE_ACCOUNT,
  kitMyConnect,
  land,
  NO_ACCOUNT,
  reset,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import type {
  ConnectAccountStatusResponse,
  SubscriptionTier,
} from '$lib/types';
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

let component: ReturnType<typeof mount> | null = null;
let connect: KitQuery<ConnectAccountStatusResponse>;

beforeEach(() => {
  reset();
  connect = kitMyConnect();
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

/** The page with its tiers loaded and its first Connect read failed. */
function mountFailed() {
  mountPage();
  land(tiersSlot(), [FOUNDING]);
  connect.fail();
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const loadError = () => q('[data-testid="connect-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
/** The alert's focus wrapper: it takes focus after a Retry that failed again. */
const loadErrorFocus = () => loadError()?.closest('[tabindex="-1"]') ?? null;
const connectCard = () =>
  [...document.querySelectorAll('.card')].find((card) =>
    card.textContent?.includes(m.monetisation_connect_title())
  ) ?? null;
const tierSkeletons = () => document.querySelectorAll('.tier-item--skeleton');
const loadedStatus = () =>
  [...document.querySelectorAll('[role="status"]')].find(
    (node) => node.textContent?.trim() === m.money_setup_load_retry_ok()
  ) ?? null;
/** Lets reads settle and a Retry run on from them, focus moves included. */
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

/**
 * Presses Retry with focus on it. Kit hands the page a NEW Connect query,
 * still loading, and fetches the refreshed one again too: a stray read
 * nobody should judge. Returns the refreshed query WRAPPED: a query is
 * thenable, so an async function returning it bare would await that read.
 */
async function pressRetry(): Promise<{
  refreshed: KitRead<ConnectAccountStatusResponse>;
}> {
  const refreshed = connect.held();
  retryButton()?.focus();
  retryButton()?.click();
  await settle();

  expect(connect.refreshes(refreshed)).toBe(1);
  expect(connect.held()).not.toBe(refreshed);
  expect(connect.held().loading).toBe(true);
  return { refreshed };
}

describe('a failed payout-status read', () => {
  test('says it could not load the account, with Retry, and claims no status', () => {
    mountFailed();

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
    mountFailed();

    expect(q('[data-testid="connect-stripe-btn"]')).toBeNull();
    expect(text()).not.toContain(m.monetisation_connect_start());
    expect(text()).not.toContain(m.monetisation_connect_continue());
  });

  test('shows no set-up warnings: no readiness prompt and neither needs-Connect hint', () => {
    mountFailed();

    // Two subscribers + the "no account" default used to raise this one.
    expect(q('.money-prompt')).toBeNull();
    expect(text()).not.toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).not.toContain(m.monetisation_feature_requires_connect());
    expect(text()).not.toContain(m.monetisation_tiers_requires_connect());
  });

  test('keeps Create tier disabled', () => {
    mountFailed();

    expect(createTierButton()?.disabled).toBe(true);
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();

    expect(error).toHaveBeenCalledWith(
      'studio/monetisation: payout account status failed to load',
      expect.objectContaining({ organizationId: ORG.id })
    );
  });
});

describe('Retry, while the new query loads', () => {
  test('keeps the alert and the focused Retry, reading "Retrying…" and busy', async () => {
    mountFailed();
    await pressRetry();

    expect(loadError()).not.toBeNull();
    expect(document.activeElement).toBe(retryButton());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(retryButton()?.disabled).toBe(false);
    expect(loadError()?.getAttribute('aria-busy')).toBe('true');
  });

  test('keeps the failed layout: no skeletons, no status claim, no set-up hints', async () => {
    mountFailed();
    await pressRetry();

    // A loading Connect read used to count as a first load: the Connect card
    // and the Tiers card went back to skeletons for the round trip.
    expect(connectCard()?.querySelector('.skeleton')).toBeNull();
    expect(tierSkeletons()).toHaveLength(0);
    expect(text()).toContain('Founding');

    expect(q('[data-testid="connect-status-badge"]')).toBeNull();
    expect(q('[data-testid="connect-stripe-btn"]')).toBeNull();
    expect(q('.money-prompt')).toBeNull();
    expect(text()).not.toContain(m.monetisation_feature_requires_connect());
    expect(text()).not.toContain(m.monetisation_tiers_requires_connect());
    expect(createTierButton()?.disabled).toBe(true);
  });

  test('a second press sends nothing', async () => {
    mountFailed();
    const refreshed = connect.held();
    retryButton()?.click();
    retryButton()?.click();
    await settle();

    expect(connect.refreshes(refreshed)).toBe(1);
    expect(connect.refreshes(connect.held())).toBe(0);
  });
});

describe('Retry, once the new query answers', () => {
  test('a read that fails again says "We still couldn\'t…" and focuses the alert', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    // The network is down: the stray fetch fails first, then the held read.
    connect.fail(undefined, refreshed);
    await settle();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    connect.fail();
    await settle();

    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
    expect(document.activeElement).toBe(loadErrorFocus());
    expect(loadedStatus()).toBeNull();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
    expect(loadError()?.getAttribute('aria-busy')).toBe('false');
  });

  test('a stray fetch that lands first claims nothing; the held read decides', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    connect.land(ACTIVE_ACCOUNT, refreshed);
    await settle();
    expect(loadedStatus()).toBeNull();
    expect(document.activeElement).toBe(retryButton());

    connect.fail();
    await settle();
    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
    expect(loadedStatus()).toBeNull();
  });

  test('a read that loads clears the alert, shows the real status, and says so', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    connect.land(ACTIVE_ACCOUNT);
    await settle();

    // Judged on the held read: the stray fetch is still in flight.
    expect(refreshed.loading).toBe(true);
    expect(loadError()).toBeNull();
    const badge = q('[data-testid="connect-status-badge"]');
    expect(badge?.getAttribute('data-connect-status')).toBe('active');
    expect(text()).toContain(m.monetisation_connect_dashboard());
    expect(createTierButton()?.disabled).toBe(false);
    // The alert unmounted with the focused Retry inside it.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('a read that loads "no account" shows Not connected and the set-up button, and says it loaded', async () => {
    mountFailed();
    await pressRetry();

    connect.land(NO_ACCOUNT);
    await settle();

    expect(loadError()).toBeNull();
    const badge = q('[data-testid="connect-status-badge"]');
    expect(badge?.getAttribute('data-connect-status')).toBe('not_connected');
    expect(q('[data-testid="connect-stripe-btn"]')).not.toBeNull();
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('a second repeat failure is announced again: focus returns to the alert', async () => {
    mountFailed();
    await pressRetry();
    connect.fail();
    await settle();

    // The owner moves back to Retry and tries once more: the alert's text
    // ("We still couldn't…") does not change this time.
    await pressRetry();
    connect.fail();
    await settle();

    expect(document.activeElement).toBe(loadErrorFocus());
    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
  });

  test('logs each failed read once, with its reason, and nothing for the Retry itself', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();
    await pressRetry();
    connect.fail();
    await settle();

    const failures = error.mock.calls.filter(
      ([what]) =>
        what === 'studio/monetisation: payout account status failed to load'
    );
    expect(failures).toHaveLength(2);
    for (const [, context] of failures) {
      expect(context).toEqual({
        organizationId: ORG.id,
        reason: 'Internal Error',
      });
    }
  });
});

describe('a read that succeeded is still believed', () => {
  test('a real "no account" still shows Not connected and the set-up button', () => {
    mountPage();
    connect.land(NO_ACCOUNT);
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
 * A refresh is not a first load (Codex-2hxff.66 review, LOW-2). The page's
 * loading gate used to OR every query's own `loading`, which is also true
 * during a refresh, so a tier re-read flipped the Tiers card to skeletons and
 * the toggle OFF for the round trip. (A Connect Retry: see above.)
 */
describe('no skeleton flash on a refresh', () => {
  const toggle = () => q('#enable-subscriptions');

  test('a tier re-read keeps the rows and the toggle as they were', () => {
    mountPage();
    connect.land(ACTIVE_ACCOUNT);
    land(tiersSlot(), [FOUNDING]);
    flushSync();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');

    tiersSlot().loading = true;
    flushSync();

    expect(tierSkeletons()).toHaveLength(0);
    expect(text()).toContain('Founding');
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });

  test('the first load still shows skeletons', () => {
    mountPage();
    flushSync();
    expect(tierSkeletons().length).toBeGreaterThan(0);
  });
});
