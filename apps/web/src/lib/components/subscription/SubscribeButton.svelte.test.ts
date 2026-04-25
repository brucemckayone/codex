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
  invalidate: vi.fn(),
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
    mockResume.mockResolvedValueOnce(undefined);

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
});
