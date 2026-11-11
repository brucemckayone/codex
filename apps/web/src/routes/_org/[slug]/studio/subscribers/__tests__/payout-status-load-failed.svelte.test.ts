/**
 * Studio → Subscribers: a payout-status read that FAILED is not "no account"
 * (Codex-2hxff.45).
 *
 * The page used to cover a rejected `getOrganizationPayoutStatus()` with a
 * "no account" default, so its readiness verdict was `stripe_missing`: a set-up
 * owner was told "2 paying subscribers and nowhere to send the money", and the
 * empty state said "Once the setup above is done". Now it says "We couldn't
 * load your payout account." with Retry, and the empty state claims nothing.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the remote module are mocked.
 * The payout read is a double of kit's query (`kitOrgPayout`), so a Retry
 * takes kit's real path: the page is handed a NEW query, still loading
 * (Codex-if444). On the old slot, which never swaps, these tests passed while
 * the page judged its Retry on that loading query.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
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

import type {
  KitQuery,
  KitRead,
} from '$lib/components/studio/__fixtures__/kit-query.mock.svelte';
import {
  ACTIVE_ACCOUNT,
  kitOrgPayout,
  NO_ACCOUNT,
  reset,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import type { OrganizationPayoutStatusResponse } from '$lib/types';
import SubscribersPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};

let component: ReturnType<typeof mount> | null = null;
let payout: KitQuery<OrganizationPayoutStatusResponse>;

beforeEach(() => {
  reset();
  payout = kitOrgPayout();
  setPage('/studio/subscribers');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(SubscribersPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  flushSync();
}

/** The page with its first payout read failed (the list is empty). */
function mountFailed() {
  mountPage();
  payout.fail();
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const loadError = () => q('[data-testid="payout-status-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
/** The alert's focus wrapper: it takes focus after a Retry that failed again. */
const loadErrorFocus = () => loadError()?.closest('[tabindex="-1"]') ?? null;
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

/**
 * Presses Retry with focus on it. Kit hands the page a NEW payout query,
 * still loading, and fetches the refreshed one again too: a stray read
 * nobody should judge. Returns the refreshed query WRAPPED: a query is
 * thenable, so an async function returning it bare would await that read.
 */
async function pressRetry(): Promise<{
  refreshed: KitRead<OrganizationPayoutStatusResponse>;
}> {
  const refreshed = payout.held();
  retryButton()?.focus();
  retryButton()?.click();
  await settle();

  expect(payout.refreshes(refreshed)).toBe(1);
  expect(payout.held()).not.toBe(refreshed);
  expect(payout.held().loading).toBe(true);
  return { refreshed };
}

describe('a failed payout-status read', () => {
  test('says it could not load the account, with Retry', () => {
    mountFailed();

    const alert = loadError();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.money_setup_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('shows no set-up prompt', () => {
    mountFailed();

    expect(q('.money-prompt')).toBeNull();
    expect(text()).not.toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).not.toContain(m.money_setup_stripe_missing_cta());
  });

  test('the empty state claims neither "set up" nor "live"', () => {
    mountFailed();

    expect(text()).toContain(m.subscribers_empty_status_unknown_description());
    expect(text()).not.toContain(
      m.subscribers_empty_pending_setup_description()
    );
    expect(text()).not.toContain(m.subscribers_empty_description());
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();

    expect(error).toHaveBeenCalledWith(
      'studio/subscribers payout status query failed',
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

  test('keeps the failed layout: no table skeleton, no set-up prompt, the empty state unchanged', async () => {
    mountFailed();
    await pressRetry();

    // A loading payout read used to count as the list loading: the table
    // went back to skeletons for the round trip.
    expect(q('.table-skeleton')).toBeNull();
    expect(q('.money-prompt')).toBeNull();
    expect(text()).toContain(m.subscribers_empty_status_unknown_description());
    expect(text()).not.toContain(
      m.subscribers_empty_pending_setup_description()
    );
  });

  test('a second press sends nothing', async () => {
    mountFailed();
    const refreshed = payout.held();
    retryButton()?.click();
    retryButton()?.click();
    await settle();

    expect(payout.refreshes(refreshed)).toBe(1);
    expect(payout.refreshes(payout.held())).toBe(0);
  });
});

describe('Retry, once the new query answers', () => {
  test('a read that fails again says "We still couldn\'t…" and focuses the alert', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    // The network is down: the stray fetch fails first, then the held read.
    payout.fail(undefined, refreshed);
    await settle();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    payout.fail();
    await settle();

    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
    expect(document.activeElement).toBe(loadErrorFocus());
    expect(loadedStatus()).toBeNull();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('a stray fetch that lands first claims nothing; the held read decides', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    payout.land(ACTIVE_ACCOUNT, refreshed);
    await settle();
    expect(loadedStatus()).toBeNull();
    expect(document.activeElement).toBe(retryButton());

    payout.fail();
    await settle();
    expect(loadError()?.textContent).toContain(
      m.money_setup_load_failed_again()
    );
    expect(loadedStatus()).toBeNull();
  });

  test('a read that loads clears the alert, gives the real verdict, and says so', async () => {
    mountFailed();
    const { refreshed } = await pressRetry();

    payout.land(ACTIVE_ACCOUNT);
    await settle();

    // Judged on the held read: the stray fetch is still in flight.
    expect(refreshed.loading).toBe(true);
    expect(loadError()).toBeNull();
    expect(text()).not.toContain(
      m.subscribers_empty_status_unknown_description()
    );
    // The alert unmounted with the focused Retry inside it.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('a second repeat failure is announced again: focus returns to the alert', async () => {
    mountFailed();
    await pressRetry();
    payout.fail();
    await settle();

    await pressRetry();
    payout.fail();
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
    payout.fail();
    await settle();

    const failures = error.mock.calls.filter(
      ([what]) => what === 'studio/subscribers payout status query failed'
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
  test('a real "no account" still raises the stranded-money prompt', () => {
    mountPage();
    payout.land(NO_ACCOUNT);
    flushSync();

    expect(loadError()).toBeNull();
    expect(text()).toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).toContain(m.subscribers_empty_pending_setup_description());
  });
});
