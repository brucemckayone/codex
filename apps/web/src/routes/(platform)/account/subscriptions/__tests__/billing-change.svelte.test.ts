/**
 * Account → Subscriptions: leaving yearly billing waits for the year's end
 * (Codex-2hxff.97; mockup year-to-month-waits.html E3, E4 and E7).
 *
 * The card carries the pricing page's notice in billing words: "Keep
 * yearly billing" when only the billing changes, one "Keep current plan"
 * when the plan changes too (Q4). Its price row stays what Alex pays now,
 * £120.00/yr. Set to cancel, one quiet line says the change survives a
 * reactivate (T4). A Stripe schedule that isn't ours refuses Keep, cancel
 * and reactivate with an id to quote.
 *
 * Mounts the real `+page.svelte`, mocked as in `waiting-move.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PendingTierChange, UserOrgSubscription } from '$lib/types';
import { formatPrice, formatSentenceDate } from '$lib/utils/format';
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

const RENEWAL = '2027-03-12T00:00:00.000Z';
const DATE = formatSentenceDate(RENEWAL);

const BILLING_WAITS: PendingTierChange = {
  kind: 'billing',
  tierId: 'tier-pro',
  tierName: 'Pro',
  amountCents: 1200,
  billingInterval: 'month',
  effectiveAt: RENEWAL,
  laterPrice: null,
};
const BOTH_WAIT: PendingTierChange = {
  kind: 'plan_and_billing',
  tierId: 'tier-basic',
  tierName: 'Basic',
  amountCents: 500,
  billingInterval: 'month',
  effectiveAt: RENEWAL,
  laterPrice: null,
};

const SCHEDULED_ELSEWHERE = {
  success: false,
  code: 'CONFLICT',
  detailsCode: 'SUBSCRIPTION_SCHEDULED_ELSEWHERE',
  errorId: 'err_7f3a',
  message:
    "This subscription can't be changed here just now. Please contact support.",
  status: 409,
};
const ELSEWHERE_LINE = m.subscription_refusal_scheduled_elsewhere({
  errorId: 'err_7f3a',
});

/** Alex on Pro yearly. Nothing is swapped during the wait: £120 is the row's amount. */
function proYearly(
  overrides: Partial<UserOrgSubscription> = {}
): UserOrgSubscription {
  return {
    id: 'sub-hollow',
    organizationId: 'org-hollow',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: RENEWAL,
    amountCents: 12000,
    heldAmountCents: 12000,
    billingInterval: 'year',
    disputedAt: null,
    tier: { id: 'tier-pro', name: 'Pro' },
    organization: {
      id: 'org-hollow',
      name: 'Hollow Oak Films',
      slug: 'hollow-oak',
      logoUrl: null,
    },
    pendingTierChange: BILLING_WAITS,
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

function remount(subscriptions: UserOrgSubscription[]) {
  if (component) unmount(component);
  document.body.innerHTML = '';
  mountPage(subscriptions);
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
const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('only the billing waits (E3)', () => {
  test('the notice in billing words, Keep yearly billing, and £120.00/yr', () => {
    mountPage([proYearly()]);

    const notice = clean(within('subscription-move-notice'));
    expect(notice).toContain(
      m.pricing_billing_notice_title_month({ date: DATE })
    );
    expect(notice).toContain(
      m.pricing_billing_notice_body_month({
        plan: 'Pro',
        price: formatPrice(1200),
      })
    );
    expect(clean(within('subscription-keep-button'))).toBe(
      m.pricing_billing_keep()
    );
    expect(
      clean(card()?.querySelector('.subscription-price')).replace(/\s/g, '')
    ).toBe('£120.00/yr');
  });

  test("Keep's lines: kept, refused and landed, in billing words (A2)", async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: { currentPeriodEnd: RENEWAL, amountCents: 12000 },
    });
    mountPage([proYearly()]);
    within('subscription-keep-button')?.click();
    await settle();
    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_kept_billing({ date: DATE, price: formatPrice(12000) })
    );

    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'SOMETHING_ELSE',
      message: 'no',
      status: 409,
    });
    remount([proYearly()]);
    within('subscription-keep-button')?.click();
    await settle();
    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_keep_failed_billing({ date: DATE })
    );

    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'MOVE_ALREADY_LANDED',
      message: 'landed',
      status: 409,
    });
    remount([proYearly()]);
    within('subscription-keep-button')?.click();
    await settle();
    expect(clean(within('subscription-keep-line'))).toBe(
      m.pricing_move_landed_billing()
    );
  });
});

describe('the plan and the billing wait together (E4)', () => {
  test('"billed monthly" and "billed yearly", one Keep current plan', () => {
    mountPage([proYearly({ pendingTierChange: BOTH_WAIT })]);

    const notice = clean(within('subscription-move-notice'));
    expect(notice).toContain(
      m.pricing_move_notice_title_billing_month({ plan: 'Basic', date: DATE })
    );
    expect(notice).toContain(
      m.pricing_move_notice_body_billing_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
      })
    );
    expect(clean(within('subscription-keep-button'))).toBe(
      m.pricing_move_keep()
    );
    expect(
      clean(card()?.querySelector('.subscription-price')).replace(/\s/g, '')
    ).toBe('£120.00/yr');
  });
});

describe('set to cancel while it waits (E7)', () => {
  test('the billing change survives a reactivate, in its own words', () => {
    mountPage([proYearly({ status: 'cancelling', cancelAtPeriodEnd: true })]);

    expect(within('subscription-move-notice')).toBeNull();
    expect(clean(within('subscription-move-survives'))).toBe(
      m.account_billing_change_survives_cancel({ date: DATE })
    );
  });

  test('a change of plan and billing keeps page 2’s line, word for word', () => {
    mountPage([
      proYearly({
        status: 'cancelling',
        cancelAtPeriodEnd: true,
        pendingTierChange: BOTH_WAIT,
      }),
    ]);

    expect(clean(within('subscription-move-survives'))).toBe(
      m.subscription_move_survives_cancel({ plan: 'Basic', date: DATE })
    );
  });
});

describe('a Stripe schedule that isn’t ours', () => {
  test('Keep, cancel and reactivate give the id to quote, never the worker’s words', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    mountPage([proYearly()]);
    within('subscription-keep-button')?.click();
    await settle();
    expect(clean(within('subscription-keep-line'))).toBe(ELSEWHERE_LINE);

    remote.cancelSubscription.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    remount([proYearly()]);
    within('subscription-cancel-button')?.click();
    flushSync();
    byTestId('cancel-dialog-confirm-button')?.click();
    await settle();
    expect(remote.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(ELSEWHERE_LINE);
    expect(document.body.textContent).not.toContain(
      SCHEDULED_ELSEWHERE.message
    );

    remote.reactivateSubscription.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    remount([proYearly({ status: 'cancelling', cancelAtPeriodEnd: true })]);
    within('subscription-reactivate-button')?.click();
    await settle();
    expect(clean(card())).toContain(ELSEWHERE_LINE);
  });
});
