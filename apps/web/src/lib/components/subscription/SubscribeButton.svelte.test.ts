/**
 * SubscribeButton component tests.
 *
 * Covers the state-aware render matrix (Codex-g5vbp):
 *
 *   no subscription         → "Subscribe" link → pricing (or /login if unauth)
 *   active                  → "Subscriber" badge + Manage plan
 *   active + upgradeRequired→ "Upgrade to Watch" CTA + Manage plan
 *   cancelling              → "Plan ends {date}" warning badge + Reactivate + Manage
 *   past_due                → "Payment failed" error badge + Update payment + Manage
 *   paused                  → "Plan paused" warning badge + Resume (interactive) + Manage
 *
 * The subscriptionCollection is replaced by a controllable Map so we can
 * seed each state without touching the real localStorage-backed collection.
 * Remote functions are mocked to prevent network calls.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// Shared mutable state map used by the mocked collection. Hoisted alongside
// the vi.mock factory so the reference is initialised before hoisting moves
// the mock to the top of the file.
const { collectionState, mockUpdate } = vi.hoisted(() => ({
  collectionState: new Map<string, unknown>(),
  mockUpdate: vi.fn(),
}));

vi.mock('$lib/collections', () => ({
  subscriptionCollection: {
    state: collectionState,
    update: mockUpdate,
  },
  invalidateCollection: vi.fn(),
}));

vi.mock('$lib/remote/subscription.remote', () => ({
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));

vi.mock('$lib/remote/account.remote', () => ({
  openBillingPortal: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  invalidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://example.lvh.me:3000/pricing'),
  },
}));

// buildPlatformUrl on the platform origin — stub to a known value so the
// Manage-plan href is assertable.
vi.mock('$lib/utils/subdomain', () => ({
  buildPlatformUrl: vi.fn(() => 'http://lvh.me:3000/account/subscriptions'),
}));

// formatDate — just passthrough so "Plan ends {date}" stays deterministic.
vi.mock('$lib/utils/format', () => ({
  formatDate: vi.fn((d: string | Date) =>
    typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  ),
  formatPrice: vi.fn((v: number) => `£${(v / 100).toFixed(2)}`),
}));

import SubscribeButton from './SubscribeButton.svelte';

const ORG_ID = 'org-abc';

function seed(status: {
  status: 'active' | 'cancelling' | 'past_due' | 'paused';
  cancelAtPeriodEnd?: boolean;
  tierName?: string;
  currentPeriodEnd?: string;
}) {
  collectionState.set(ORG_ID, {
    organizationId: ORG_ID,
    tier: { id: 'tier-1', name: status.tierName ?? 'Member', sortOrder: 1 },
    status: status.status,
    currentPeriodEnd: status.currentPeriodEnd ?? '2026-05-20',
    cancelAtPeriodEnd: status.cancelAtPeriodEnd ?? false,
  });
}

describe('SubscribeButton', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    collectionState.clear();
    mockUpdate.mockClear();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('not subscribed → renders Subscribe link to pricing', () => {
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const link = screen.getByTestId('subscribe-button-subscribe');
    expect(link).toBeTruthy();
    // Authenticated user → direct pricing link (no /login redirect).
    expect(link?.getAttribute('href')).toBe('/pricing');
    expect(document.body.textContent).toContain('Subscribe');
  });

  test('not subscribed + unauth → Subscribe link points to /login redirect', () => {
    component = mount(SubscribeButton, {
      target: document.body,
      props: {
        organizationId: ORG_ID,
        isAuthenticated: false,
        subscribeHref: '/pricing?returnTo=/content/foo',
      },
    });

    const link = screen.getByTestId('subscribe-button-subscribe');
    const href = link?.getAttribute('href') ?? '';
    expect(href.startsWith('/login?redirect=')).toBe(true);
    expect(href).toContain(
      encodeURIComponent('/pricing?returnTo=/content/foo')
    );
  });

  test('active → Subscriber badge + Manage plan link', () => {
    seed({ status: 'active' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    expect(document.body.textContent).toContain('Subscriber');
    const manage = screen.getByTestId('subscribe-button-manage');
    expect(manage?.getAttribute('href')).toBe(
      'http://lvh.me:3000/account/subscriptions'
    );
    // No reactivate / update / resume primary buttons on the active path.
    expect(screen.getByTestId('subscribe-button-reactivate')).toBeNull();
    expect(screen.getByTestId('subscribe-button-update-payment')).toBeNull();
    expect(screen.getByTestId('subscribe-button-resume')).toBeNull();
  });

  test('active + upgradeRequired → Upgrade CTA + Manage plan', () => {
    seed({ status: 'active' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: {
        organizationId: ORG_ID,
        isAuthenticated: true,
        upgradeRequired: true,
      },
    });

    const upgrade = screen.getByTestId('subscribe-button-upgrade');
    expect(upgrade).toBeTruthy();
    expect(upgrade?.getAttribute('href')).toBe('/pricing');
    expect(document.body.textContent).toContain('Upgrade to Watch');
    // Still exposes Manage plan as a secondary.
    expect(screen.getByTestId('subscribe-button-manage')).toBeTruthy();
  });

  test('cancelling → Ends date warning + Reactivate button', () => {
    seed({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-05-20T00:00:00Z',
    });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    expect(document.body.textContent).toContain('Plan ends');
    expect(document.body.textContent).toContain('2026-05-20');

    const reactivate = screen.getByTestId('subscribe-button-reactivate');
    expect(reactivate).toBeTruthy();
    expect(reactivate?.textContent).toContain('Reactivate plan');

    // Manage link alongside.
    expect(screen.getByTestId('subscribe-button-manage')).toBeTruthy();
  });

  test('past_due → Payment failed danger badge + Update payment', () => {
    seed({ status: 'past_due' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    expect(document.body.textContent).toContain('Payment failed');
    const update = screen.getByTestId('subscribe-button-update-payment');
    expect(update).toBeTruthy();
    expect(update?.textContent).toContain('Update payment');

    expect(screen.getByTestId('subscribe-button-manage')).toBeTruthy();
  });

  test('paused → Plan paused warning badge + interactive Resume (Codex-7h4vo)', () => {
    seed({ status: 'paused' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    expect(document.body.textContent).toContain('Plan paused');

    const resume = screen.getByTestId('subscribe-button-resume');
    expect(resume).toBeTruthy();
    expect(resume?.textContent).toContain('Resume plan');
    // Codex-7h4vo: backend resume endpoint ships — button is now interactive.
    expect((resume as HTMLButtonElement).disabled).toBe(false);

    expect(screen.getByTestId('subscribe-button-manage')).toBeTruthy();
  });

  test('paused → clicking Resume calls resumeSubscription and optimistically flips to active (Codex-7h4vo)', async () => {
    const { resumeSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const mockResume = resumeSubscription as unknown as ReturnType<
      typeof vi.fn
    >;
    mockResume.mockResolvedValueOnce({ success: true, data: undefined });

    seed({ status: 'paused' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const resume = screen.getByTestId(
      'subscribe-button-resume'
    ) as HTMLButtonElement;
    expect(resume).toBeTruthy();

    // Clicking Resume should (a) optimistically flip the collection row
    // via `subscriptionCollection.update` and (b) call resumeSubscription
    // with the org id.
    resume.click();
    // The optimistic flip happens synchronously before the await.
    expect(mockUpdate).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    // And the remote function is called with the org id.
    await Promise.resolve();
    expect(mockResume).toHaveBeenCalledWith({ organizationId: ORG_ID });
  });

  test('cancelAtPeriodEnd wins over past_due (matches status helper)', () => {
    // Regression guard for the effective-status matrix: a past_due row that
    // has also been cancelled should show Reactivate, not Update payment —
    // reactivation is the only recovery path because the card won't be retried.
    seed({
      status: 'past_due',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-06-01',
    });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    expect(screen.getByTestId('subscribe-button-reactivate')).toBeTruthy();
    expect(screen.getByTestId('subscribe-button-update-payment')).toBeNull();
  });

  // ── Reactivate: error / rollback paths (Codex-70lic) ───────────────
  // The reactivate path is the only inline mutation the button performs
  // for cancelling subscriptions. Confirm both halves of the optimistic
  // contract: success acknowledged AND failure rolled back without
  // leaking server internals.

  test('cancelling → Reactivate click invokes reactivateSubscription with org id (Codex-70lic)', async () => {
    const { reactivateSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const mockReactivate = reactivateSubscription as unknown as ReturnType<
      typeof vi.fn
    >;
    mockReactivate.mockResolvedValueOnce({ success: true, data: undefined });

    seed({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-05-20T00:00:00Z',
    });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const reactivate = screen.getByTestId(
      'subscribe-button-reactivate'
    ) as HTMLButtonElement;
    reactivate.click();

    // Optimistic flip lands BEFORE the remote resolves.
    expect(mockUpdate).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    await Promise.resolve();
    expect(mockReactivate).toHaveBeenCalledTimes(1);
    expect(mockReactivate).toHaveBeenCalledWith({ organizationId: ORG_ID });
  });

  test('cancelling → Reactivate API failure rolls back and surfaces user-readable error, no Stripe internals leak (Codex-70lic)', async () => {
    const { reactivateSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const mockReactivate = reactivateSubscription as unknown as ReturnType<
      typeof vi.fn
    >;
    // Service contract returns SubscriptionCommandFailure with a sanitised
    // message — never raw Stripe `StripeCardError: card_declined: ...`.
    mockReactivate.mockResolvedValueOnce({
      success: false,
      code: 'SUBSCRIPTION_REACTIVATE_FAILED',
      message: 'Unable to reactivate subscription. Please try again.',
      status: 502,
    });

    seed({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-05-20T00:00:00Z',
    });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const reactivate = screen.getByTestId(
      'subscribe-button-reactivate'
    ) as HTMLButtonElement;
    reactivate.click();

    // Flush microtasks so the failure branch can run + render.
    await new Promise((r) => setTimeout(r, 0));

    // Error region is exposed via role=alert (a11y contract).
    const errorAlert = document.querySelector('[role="alert"]');
    expect(errorAlert).toBeTruthy();
    expect(errorAlert?.textContent).toContain('Unable to reactivate');
    // No raw Stripe wording leaked through (defence-in-depth assert).
    expect(errorAlert?.textContent ?? '').not.toMatch(
      /stripe|card_declined|invoice|payment_intent/i
    );

    // Rollback path: the second update() call restores the prior snapshot.
    // First call was the optimistic flip; second is the rollback.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  test('cancelling → Reactivate network exception rolls back and shows error message (Codex-70lic)', async () => {
    const { reactivateSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const mockReactivate = reactivateSubscription as unknown as ReturnType<
      typeof vi.fn
    >;
    // Thrown error simulates network failure / DNS / 5xx unwrap.
    mockReactivate.mockRejectedValueOnce(new Error('Network request failed'));

    seed({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-05-20T00:00:00Z',
    });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const reactivate = screen.getByTestId(
      'subscribe-button-reactivate'
    ) as HTMLButtonElement;
    reactivate.click();
    await new Promise((r) => setTimeout(r, 0));

    const errorAlert = document.querySelector('[role="alert"]');
    expect(errorAlert?.textContent).toContain('Network request failed');
    // Optimistic + rollback = 2 update() calls.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  test('paused → Resume API failure rolls back state and surfaces sanitised error (Codex-70lic)', async () => {
    const { resumeSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const mockResume = resumeSubscription as unknown as ReturnType<
      typeof vi.fn
    >;
    mockResume.mockResolvedValueOnce({
      success: false,
      code: 'SUBSCRIPTION_RESUME_FAILED',
      message: 'Could not resume your subscription right now.',
      status: 502,
    });

    seed({ status: 'paused' });
    component = mount(SubscribeButton, {
      target: document.body,
      props: { organizationId: ORG_ID, isAuthenticated: true },
    });

    const resume = screen.getByTestId(
      'subscribe-button-resume'
    ) as HTMLButtonElement;
    resume.click();
    await new Promise((r) => setTimeout(r, 0));

    const errorAlert = document.querySelector('[role="alert"]');
    expect(errorAlert?.textContent).toContain('Could not resume');
    // No internal Stripe terminology bleeds into the UI.
    expect(errorAlert?.textContent ?? '').not.toMatch(
      /stripe|subscription_pause|invoice/i
    );
    // Optimistic + rollback.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  test('past_due → Update payment click opens billing portal (Codex-70lic)', async () => {
    const { openBillingPortal } = await import('$lib/remote/account.remote');
    const mockPortal = openBillingPortal as unknown as ReturnType<typeof vi.fn>;
    mockPortal.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/p/session/test_xyz',
    });

    // Stub window.location.href so we can assert without navigating away
    // (jsdom navigates synchronously and pollutes subsequent tests).
    const originalLocation = window.location;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new Proxy(originalLocation, {
        set(target, prop, value) {
          if (prop === 'href') {
            hrefSetter(value);
            return true;
          }
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          return Reflect.get(target, prop);
        },
      }),
    });

    try {
      seed({ status: 'past_due' });
      component = mount(SubscribeButton, {
        target: document.body,
        props: { organizationId: ORG_ID, isAuthenticated: true },
      });

      const update = screen.getByTestId(
        'subscribe-button-update-payment'
      ) as HTMLButtonElement;
      update.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPortal).toHaveBeenCalledWith({
        returnUrl: 'http://example.lvh.me:3000/pricing',
      });
      expect(hrefSetter).toHaveBeenCalledWith(
        'https://billing.stripe.com/p/session/test_xyz'
      );
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
