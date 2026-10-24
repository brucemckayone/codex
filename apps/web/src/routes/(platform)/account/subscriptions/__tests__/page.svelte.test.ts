/**
 * Account → Subscriptions: a plan paused by a payment dispute (Codex-2hxff.60,
 * mockup C1).
 *
 * An open chargeback on one of its invoices pauses the plan's access and
 * billing, and `/subscriptions/mine` sends it with `disputedAt` set. The card
 * then says so: a warning badge, one line of notice, the price line, and
 * Cancel. Change Plan, Reactivate and Update payment are hidden until the bank
 * settles it. A plan with no dispute is unchanged.
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules (they import
 * `$app/server`) and the collections barrel are mocked.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UserOrgSubscription } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://revelations.studio/account/subscriptions');
    },
  },
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/collections', () => ({ invalidateCollection: vi.fn() }));

import SubscriptionsPage from '../+page.svelte';

const DISPUTED_AT = '2026-10-20T09:00:00.000Z';

function makeSub(
  slug: string,
  overrides: Partial<UserOrgSubscription> = {}
): UserOrgSubscription {
  return {
    id: `sub-${slug}`,
    organizationId: `org-${slug}`,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-11-14T00:00:00.000Z',
    amountCents: 999,
    billingInterval: 'month',
    disputedAt: null,
    tier: { id: `tier-${slug}`, name: 'Members' },
    organization: {
      id: `org-${slug}`,
      name: slug === 'alpha' ? 'Studio Alpha' : 'Northside Yoga',
      slug,
      logoUrl: null,
    },
    ...overrides,
  } as UserOrgSubscription;
}

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(subscriptions: UserOrgSubscription[]) {
  component = mount(SubscriptionsPage, {
    target: document.body,
    props: { data: { subscriptions, loadError: false } } as never,
  });
  flushSync();
}

function cardFor(slug: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-testid="subscription-card"][data-org-slug="${slug}"]`
  );
  if (!card) throw new Error(`no card for ${slug}`);
  return card;
}

const within = (card: HTMLElement, testId: string) =>
  card.querySelector(`[data-testid="${testId}"]`);
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('a subscription paused by a payment dispute', () => {
  test('shows the dispute badge, the notice and Cancel, and no Change Plan', () => {
    mountPage([makeSub('alpha', { disputedAt: DISPUTED_AT })]);
    const card = cardFor('alpha');

    const badge = within(card, 'subscription-status-badge');
    expect(clean(badge)).toBe(m.access_paused_dispute_label());
    expect(badge?.getAttribute('data-variant')).toBe('warning');

    const notice = within(card, 'subscription-dispute-notice');
    expect(clean(notice)).toBe(m.access_paused_dispute_subscription());
    expect(notice?.getAttribute('data-variant')).toBe('warning');

    expect(within(card, 'subscription-cancel-button')).not.toBeNull();
    expect(within(card, 'subscription-change-tier-button')).toBeNull();
    // The price line stays.
    expect(clean(card)).toContain('£9.99');
  });

  test('a disputed plan that was already cancelling offers no Reactivate', () => {
    mountPage([
      makeSub('alpha', {
        status: 'cancelling',
        cancelAtPeriodEnd: true,
        disputedAt: DISPUTED_AT,
      }),
    ]);
    const card = cardFor('alpha');

    expect(clean(within(card, 'subscription-status-badge'))).toBe(
      m.access_paused_dispute_label()
    );
    expect(within(card, 'subscription-reactivate-button')).toBeNull();
    expect(within(card, 'subscription-change-tier-button')).toBeNull();
    expect(card.querySelector('.cancelling-message')).toBeNull();
  });

  test('a disputed plan that was past due offers no payment update', () => {
    mountPage([
      makeSub('alpha', { status: 'past_due', disputedAt: DISPUTED_AT }),
    ]);
    const card = cardFor('alpha');

    expect(clean(card)).not.toContain(m.subscription_past_due_message());
    expect(clean(card)).not.toContain(m.subscription_update_payment());
    expect(within(card, 'subscription-dispute-notice')).not.toBeNull();
  });

  test('a plan with no dispute, beside it, is unchanged', () => {
    mountPage([
      makeSub('alpha', { disputedAt: DISPUTED_AT }),
      makeSub('north'),
    ]);
    const card = cardFor('north');

    const badge = within(card, 'subscription-status-badge');
    expect(clean(badge)).toBe(m.subscription_status_active());
    expect(badge?.getAttribute('data-variant')).toBe('success');
    expect(within(card, 'subscription-dispute-notice')).toBeNull();
    expect(within(card, 'subscription-change-tier-button')).not.toBeNull();
    expect(within(card, 'subscription-cancel-button')).not.toBeNull();
  });
});
