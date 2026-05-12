/**
 * AccessRevokedOverlay unit tests.
 *
 * Covers each revocation reason variant renders the documented copy + CTAs,
 * the generic fallback when no reason is supplied, and the interaction
 * surfaces (reactivate / billing portal / href navigation). Regression
 * guard for `feedback_stripe_portal_lockdown`: the `View plan` secondary
 * CTA MUST navigate to `/account/subscriptions`, NEVER directly to the
 * Stripe portal — the portal is reachable only via the dedicated
 * `Update payment` CTA on payment_failed (and even then is locked down
 * server-side by a configuration id that disables tier changes).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// Remote fns need to exist as mocks before the component imports them.
vi.mock('$lib/remote/subscription.remote', () => ({
  reactivateSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({
  openBillingPortal: vi.fn(),
}));
vi.mock('$lib/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/') },
}));

import { toast } from '$lib/components/ui/Toast';
import { openBillingPortal } from '$lib/remote/account.remote';
import { reactivateSubscription } from '$lib/remote/subscription.remote';
import AccessRevokedOverlay from './AccessRevokedOverlay.svelte';

const ORG_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Find a button by visible label (textContent).
 */
function buttonByLabel(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.body.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label
    ) ?? null
  );
}

type Variant =
  | 'subscription_deleted'
  | 'payment_failed'
  | 'refund'
  | 'admin_revoke';

const variants: Record<
  Variant,
  { title: string; primary: string; secondary?: string }
> = {
  subscription_deleted: {
    title: 'Your subscription has ended',
    primary: 'Reactivate',
    secondary: 'View plan',
  },
  payment_failed: {
    title: 'Payment failed',
    primary: 'Update payment',
    secondary: 'Manage plan',
  },
  refund: {
    title: 'This purchase was refunded',
    primary: 'Browse plans',
    secondary: 'Contact support',
  },
  admin_revoke: {
    title: 'Access revoked',
    primary: 'Contact support',
  },
};

describe('AccessRevokedOverlay', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test.each(
    Object.keys(variants) as Variant[]
  )('renders %s variant copy + CTAs', (reason) => {
    const expected = variants[reason];
    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: { reason, organizationId: ORG_ID },
    });

    const root = document.body.querySelector('.access-revoked');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('alert');
    expect(root?.getAttribute('data-reason')).toBe(reason);

    expect(document.body.textContent).toContain(expected.title);

    const buttons = Array.from(document.body.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim() ?? '');
    expect(labels).toContain(expected.primary);
    if (expected.secondary) {
      expect(labels).toContain(expected.secondary);
    }
  });

  test('generic fallback when reason is null', () => {
    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: { reason: null },
    });

    const root = document.body.querySelector('.access-revoked');
    expect(root?.getAttribute('data-reason')).toBe('generic');
    expect(document.body.textContent).toContain('Access denied');
    expect(document.body.textContent).toContain(
      'You do not have permission to view this content.'
    );

    // Generic fallback has no CTA row.
    const buttons = document.body.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  test('overlay is not dismissable — no close button', () => {
    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: { reason: 'subscription_deleted' },
    });

    const closeButtons = Array.from(
      document.body.querySelectorAll('button')
    ).filter((b) => /close|dismiss/i.test(b.getAttribute('aria-label') ?? ''));
    expect(closeButtons.length).toBe(0);
  });

  test('Reactivate CTA calls reactivateSubscription with org id and fires onreactivated', async () => {
    const reactivateMock = vi.mocked(reactivateSubscription);
    reactivateMock.mockResolvedValueOnce({ success: true } as never);
    const onreactivated = vi.fn();

    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: {
        reason: 'subscription_deleted',
        organizationId: ORG_ID,
        onreactivated,
      },
    });

    const primary = buttonByLabel('Reactivate');
    expect(primary).toBeTruthy();
    primary?.click();
    // Drain microtasks so the awaited reactivateSubscription resolves.
    await Promise.resolve();
    await Promise.resolve();
    flushSync();

    // Regression guard for feedback_stripe_portal_lockdown:
    // reactivate path MUST go through the dedicated remote command
    // (which targets `/account/subscriptions` flows), not the Stripe
    // billing portal — the portal cannot perform reactivation.
    expect(reactivateMock).toHaveBeenCalledTimes(1);
    expect(reactivateMock).toHaveBeenCalledWith({ organizationId: ORG_ID });
    expect(vi.mocked(openBillingPortal)).not.toHaveBeenCalled();
    expect(onreactivated).toHaveBeenCalledTimes(1);
  });

  test('Reactivate without organizationId surfaces a toast and does NOT call the remote', () => {
    component = mount(AccessRevokedOverlay, {
      target: document.body,
      // organizationId intentionally omitted — multi-org user landed on
      // an overlay rendered without org context.
      props: { reason: 'subscription_deleted' },
    });

    buttonByLabel('Reactivate')?.click();
    flushSync();

    expect(vi.mocked(reactivateSubscription)).not.toHaveBeenCalled();
    expect(vi.mocked(toast).error).toHaveBeenCalledTimes(1);
  });

  test('View plan secondary CTA navigates to /account/subscriptions (NOT Stripe portal)', () => {
    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: { reason: 'subscription_deleted', organizationId: ORG_ID },
    });

    // jsdom: replace window.location with a spy-able descriptor so we
    // can observe the assignment from the component's handleAction.
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return 'http://localhost/';
        },
        set href(value: string) {
          hrefSpy(value);
        },
      },
    });

    buttonByLabel('View plan')?.click();
    flushSync();

    // Regression guard for feedback_stripe_portal_lockdown: the secondary
    // CTA MUST land users in the in-app subscription manager, not deep
    // link to Stripe (which would bypass our locked-down portal config).
    expect(hrefSpy).toHaveBeenCalledWith('/account/subscriptions');
    expect(hrefSpy.mock.calls[0][0]).not.toMatch(/stripe\.com/);
    expect(vi.mocked(openBillingPortal)).not.toHaveBeenCalled();
  });

  test('multi-org disambiguation: organizationId prop scopes the reactivate call to one org', async () => {
    // Simulates user holding subs in 3 orgs (a, b, c); only `b` is
    // revoked. The overlay must reactivate ONLY `b` — not blanket-call
    // for every org.
    const reactivateMock = vi.mocked(reactivateSubscription);
    reactivateMock.mockResolvedValueOnce({ success: true } as never);
    const orgB = '11111111-1111-1111-1111-111111111111';

    component = mount(AccessRevokedOverlay, {
      target: document.body,
      props: { reason: 'subscription_deleted', organizationId: orgB },
    });

    buttonByLabel('Reactivate')?.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();

    expect(reactivateMock).toHaveBeenCalledTimes(1);
    expect(reactivateMock.mock.calls[0][0]).toEqual({ organizationId: orgB });
  });
});
