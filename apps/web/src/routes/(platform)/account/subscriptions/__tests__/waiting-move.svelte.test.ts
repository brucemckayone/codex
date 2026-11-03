/**
 * Account → Subscriptions: a move to a cheaper plan waiting for the renewal
 * (Codex-2hxff.16; mockup waiting-move.html states 5-7 and 9).
 *
 * The card carries the pricing page's notice and Keep current plan; its
 * price row shows what the member pays now (the held amount), not the
 * cheaper next bill. Cancelled, the cancelling line takes over, and one
 * quiet line says the move survives a reactivate (T4).
 *
 * Mounts the real `+page.svelte`, mocked as in `page.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PendingTierChange, UserOrgSubscription } from '$lib/types';
import { formatDate, formatPrice, formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const remote = vi.hoisted(() => ({
  keepCurrentPlan: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelCourseSubscription: vi.fn(),
  reactivateCourseSubscription: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock('$app/navigation', () => navigation);
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://revelations.studio/account/subscriptions');
    },
  },
}));
vi.mock('$lib/remote/subscription.remote', () => remote);
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/collections', () => ({
  invalidateCollection: vi.fn(async () => {}),
}));

import SubscriptionsPage from '../+page.svelte';

const PERIOD_END = '2026-11-12T00:00:00.000Z';
const DATE = formatSentenceDate(PERIOD_END);

const MOVE: PendingTierChange = {
  kind: 'plan',
  tierId: 'tier-basic',
  tierName: 'Basic',
  amountCents: 500,
  billingInterval: 'month',
  effectiveAt: PERIOD_END,
  laterPrice: null,
};

function proMoving(
  overrides: Partial<UserOrgSubscription> = {}
): UserOrgSubscription {
  return {
    id: 'sub-hollow',
    organizationId: 'org-hollow',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    // The next bill is Basic's; Alex pays Pro's now.
    amountCents: 500,
    heldAmountCents: 1200,
    billingInterval: 'month',
    disputedAt: null,
    tier: { id: 'tier-pro', name: 'Pro' },
    organization: {
      id: 'org-hollow',
      name: 'Hollow Oak Films',
      slug: 'hollow-oak',
      logoUrl: null,
    },
    pendingTierChange: MOVE,
    ...overrides,
  } as UserOrgSubscription;
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  for (const fn of Object.values(remote)) fn.mockReset();
  navigation.invalidate.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(subscriptions: UserOrgSubscription[]) {
  component = mount(SubscriptionsPage, {
    target: document.body,
    props: {
      data: {
        subscriptions,
        loadError: false,
        courseSubscriptions: [],
        courseLoadError: false,
      },
    } as never,
  });
  flushSync();
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

const card = () =>
  document.querySelector<HTMLElement>('[data-testid="subscription-card"]');
const within = (testId: string) =>
  card()?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('a membership with a move waiting', () => {
  test('the notice and Keep, and the price row shows what Alex pays now (state 5)', () => {
    mountPage([proMoving()]);

    const notice = within('subscription-move-notice');
    expect(clean(notice)).toContain(
      m.pricing_move_notice_title({ plan: 'Basic', date: DATE })
    );
    expect(clean(notice)).toContain(
      m.pricing_move_notice_body_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
      })
    );
    expect(within('subscription-keep-button')).not.toBeNull();
    expect(clean(card()?.querySelector('.subscription-price'))).toContain(
      formatPrice(1200)
    );
  });

  test('the later price joins the line when the server sends one (state 9)', () => {
    mountPage([
      proMoving({
        pendingTierChange: {
          ...MOVE,
          laterPrice: {
            amountCents: 600,
            effectiveAt: '2026-12-12T00:00:00.000Z',
          },
        },
      }),
    ]);

    expect(clean(within('subscription-move-notice'))).toContain(
      m.pricing_move_notice_body_later_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
        laterPrice: formatPrice(600),
        laterDate: formatSentenceDate('2026-12-12T00:00:00.000Z'),
      })
    );
  });

  test('Keep: one call, the staying line, and the list read again', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: {
        ...proMoving(),
        amountCents: 1200,
        heldAmountCents: null,
        pendingTierChange: null,
      },
    });
    mountPage([proMoving()]);

    within('subscription-keep-button')?.click();
    await settle();

    expect(remote.keepCurrentPlan).toHaveBeenCalledWith({
      organizationId: 'org-hollow',
    });
    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_kept({ plan: 'Pro', date: DATE, price: formatPrice(1200) })
    );
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
    // The Keep button goes with the notice; the line takes focus (W6).
    expect(document.activeElement).toBe(within('subscription-keep-line'));
  });

  test('Keep refused: the move is still set, and the words say so', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'boom',
      status: 500,
    });
    mountPage([proMoving()]);

    within('subscription-keep-button')?.click();
    await settle();

    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_keep_failed({ plan: 'Pro', movingTo: 'Basic', date: DATE })
    );
    expect(within('subscription-move-notice')).not.toBeNull();
    expect(navigation.invalidate).not.toHaveBeenCalled();
  });

  test('Keep after the renewal (MOVE_ALREADY_LANDED): the list is read again, and one line names the tier moved to', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'MOVE_ALREADY_LANDED',
      message: 'landed',
      status: 409,
    });
    // A target name of its own, so the line can only come from the move.
    mountPage([
      proMoving({ pendingTierChange: { ...MOVE, tierName: 'Supporter' } }),
    ]);

    within('subscription-keep-button')?.click();
    await settle();

    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_landed({ plan: 'Supporter' })
    );
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
  });

  test('cancelled while it waits: the cancelling line, and the move survives a reactivate (state 6)', () => {
    mountPage([proMoving({ status: 'cancelling', cancelAtPeriodEnd: true })]);

    expect(within('subscription-move-notice')).toBeNull();
    expect(clean(card()?.querySelector('.cancelling-message'))).toBe(
      m.subscription_cancelling_message({ date: formatDate(PERIOD_END) })
    );
    expect(clean(within('subscription-move-survives'))).toBe(
      m.subscription_move_survives_cancel({ plan: 'Basic', date: DATE })
    );
    expect(within('subscription-reactivate-button')).not.toBeNull();
  });

  test('nothing waiting: no notice, and the row amount as before', () => {
    mountPage([
      proMoving({
        pendingTierChange: null,
        heldAmountCents: null,
        amountCents: 1200,
      }),
    ]);

    expect(within('subscription-move-notice')).toBeNull();
    expect(clean(card()?.querySelector('.subscription-price'))).toContain(
      formatPrice(1200)
    );
  });
});
