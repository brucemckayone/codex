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
 * Mounts the real `+page.svelte`; `$app/*` and the remote module are mocked,
 * and the payout read is a reactive slot that a test fails or answers.
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

import {
  ACTIVE_ACCOUNT,
  fail,
  land,
  NO_ACCOUNT,
  orgPayoutSlot,
  reset,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import { logger } from '$lib/observability';
import SubscribersPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
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

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const loadError = () => q('[data-testid="payout-status-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;

describe('a failed payout-status read', () => {
  test('says it could not load the account, with Retry', () => {
    mountPage();
    fail(orgPayoutSlot());
    flushSync();

    const alert = loadError();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.money_setup_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('shows no set-up prompt', () => {
    mountPage();
    fail(orgPayoutSlot());
    flushSync();

    expect(q('.money-prompt')).toBeNull();
    expect(text()).not.toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).not.toContain(m.money_setup_stripe_missing_cta());
  });

  test('the empty state claims neither "set up" nor "live"', () => {
    mountPage();
    fail(orgPayoutSlot());
    flushSync();

    expect(text()).toContain(m.subscribers_empty_status_unknown_description());
    expect(text()).not.toContain(
      m.subscribers_empty_pending_setup_description()
    );
    expect(text()).not.toContain(m.subscribers_empty_description());
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountPage();
    fail(orgPayoutSlot());
    flushSync();

    expect(error).toHaveBeenCalledWith(
      'studio/subscribers payout status query failed',
      expect.objectContaining({ organizationId: ORG.id })
    );
  });
});

describe('Retry', () => {
  test('refreshes the read; the alert stays and the list does not go back to skeletons', () => {
    mountPage();
    const slot = orgPayoutSlot();
    fail(slot);
    flushSync();

    retryButton()?.click();
    expect(slot.refresh).toHaveBeenCalledTimes(1);

    // kit: `loading` goes true and `error` stays set until an answer lands.
    slot.loading = true;
    flushSync();
    expect(loadError()).not.toBeNull();
    expect(retryButton()?.disabled).toBe(false);
    expect(q('.table-skeleton')).toBeNull();
  });

  test('a successful retry replaces the error with the real verdict', () => {
    mountPage();
    const slot = orgPayoutSlot();
    fail(slot);
    flushSync();

    retryButton()?.click();
    land(slot, ACTIVE_ACCOUNT);
    flushSync();

    expect(loadError()).toBeNull();
    expect(text()).not.toContain(
      m.subscribers_empty_status_unknown_description()
    );
  });
});

describe('a read that succeeded is still believed', () => {
  test('a real "no account" still raises the stranded-money prompt', () => {
    mountPage();
    land(orgPayoutSlot(), NO_ACCOUNT);
    flushSync();

    expect(loadError()).toBeNull();
    expect(text()).toContain(
      m.money_setup_stripe_missing_subscribers_title({ count: '2' })
    );
    expect(text()).toContain(m.subscribers_empty_pending_setup_description());
  });
});
