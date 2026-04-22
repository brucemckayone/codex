/**
 * AccessRevokedOverlay unit tests.
 *
 * Covers each revocation reason variant renders the documented copy + CTAs,
 * and the generic fallback when no reason is supplied. Interaction paths
 * (reactivate / billing portal) hit remote functions and are verified via
 * E2E tests — here we assert the control surface stays stable.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';

// Remote fns need to exist as mocks before the component imports them.
vi.mock('$lib/remote/subscription.remote', () => ({
  reactivateSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({
  openBillingPortal: vi.fn(),
}));
vi.mock('$lib/components/ui/Toast', () => ({
  toast: { error: vi.fn() },
}));
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/') },
}));

import AccessRevokedOverlay from './AccessRevokedOverlay.svelte';

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
      props: { reason, organizationId: '00000000-0000-0000-0000-000000000000' },
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
});
