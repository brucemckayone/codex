/**
 * Pricing → Change plan: leaving yearly billing waits for the year's end
 * (Codex-2hxff.97; mockup year-to-month-waits.html states A1, A2, B1, C1,
 * D1, E1 and E2; owner decisions Q1 C(b), Q2 D, Q3 B, Q4 one Keep).
 *
 * - A: the same plan on monthly waits for 12 March, nothing charged.
 * - B: a cheaper plan on monthly is one waiting change, plan and billing.
 * - C(b): a dearer plan on monthly starts now on yearly billing; monthly
 *   billing waits.
 * - D: a switch to monthly billing while a cheaper plan waits joins it
 *   ("instead of £50 a year"); into yearly is still refused (its own test,
 *   tier-change-waiting-move).
 * - E1/E2: the notice, the cards and Keep, in billing words.
 * - A Stripe schedule that isn't ours refuses with an id to quote.
 *
 * Until the server's mechanism lands it sends `billingChange: null` and
 * kind 'plan', so these drive the page with the contract's shapes.
 *
 * Mounts the real `+page.svelte`, mocked as in
 * `tier-change-waiting-move.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  PendingTierChange,
  SubscriptionTier,
  TierChangePreview,
} from '$lib/types';
import { formatPrice, formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const remote = vi.hoisted(() => ({
  previewSubscriptionTierChange: vi.fn(),
  changeSubscriptionTier: vi.fn(),
  keepCurrentPlan: vi.fn(),
  reactivateSubscription: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://hollow-oak.revelations.studio/pricing');
    },
  },
}));
vi.mock('$app/navigation', () => navigation);
vi.mock('$lib/remote/subscription.remote', () => ({
  ...remote,
  createSubscriptionCheckoutSession: vi.fn(),
  resumeSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/remote/branding.remote', () => ({
  getPricingFaq: vi.fn(async () => []),
}));
vi.mock('$lib/collections', () => ({
  invalidateCollection: vi.fn(async () => {}),
}));

import PricingPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};

function tier(
  id: string,
  name: string,
  priceMonthly: number,
  sortOrder: number
) {
  return {
    id,
    organizationId: ORG.id,
    name,
    description: `${name} tier`,
    sortOrder,
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    isRecommended: false,
    isActive: true,
  } as unknown as SubscriptionTier;
}

const BASIC = tier('00000000-0000-4000-8000-0000000000b1', 'Basic', 500, 1);
const PRO = tier('00000000-0000-4000-8000-0000000000b2', 'Pro', 1200, 2);
const PREMIUM = tier(
  '00000000-0000-4000-8000-0000000000b3',
  'Premium',
  2000,
  3
);

/** The end of the year Alex paid for. */
const RENEWAL = '2027-03-12T00:00:00.000Z';
const DATE = formatSentenceDate(RENEWAL);

/** Alex on Pro, billed yearly. The page opens on monthly prices. */
function yearly(
  tierRow: SubscriptionTier,
  extra: Record<string, unknown> = {}
) {
  return {
    tierId: tierRow.id,
    tier: { id: tierRow.id, name: tierRow.name },
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: RENEWAL,
    billingInterval: 'year',
    amountCents: tierRow.priceMonthly * 10,
    heldAmountCents: null,
    pendingTierChange: null,
    ...extra,
  };
}

/** What waits after A: Pro, billed monthly from 12 March. */
const BILLING_WAITS: PendingTierChange = {
  kind: 'billing',
  tierId: PRO.id,
  tierName: 'Pro',
  amountCents: 1200,
  billingInterval: 'month',
  effectiveAt: RENEWAL,
  laterPrice: null,
};
/** What waits after B or D: Basic, billed monthly from 12 March. */
const BOTH_WAIT: PendingTierChange = {
  kind: 'plan_and_billing',
  tierId: BASIC.id,
  tierName: 'Basic',
  amountCents: 500,
  billingInterval: 'month',
  effectiveAt: RENEWAL,
  laterPrice: null,
};
/** .16's move, on yearly billing: Basic at £50 a year from 12 March. */
const BASIC_YEARLY_WAITS: PendingTierChange = {
  kind: 'plan',
  tierId: BASIC.id,
  tierName: 'Basic',
  amountCents: 5000,
  billingInterval: 'year',
  effectiveAt: RENEWAL,
  laterPrice: null,
};

function waitPreview(
  monthlyCents: number,
  replaces: TierChangePreview['replaces'] = null
): TierChangePreview {
  return {
    amountDueCents: 0,
    prorationLineItems: [],
    newRecurringAmountCents: monthlyCents,
    newRecurringInterval: 'month',
    prorationDate: 1_790_000_000,
    isUpgrade: false,
    takesEffect: 'period_end',
    currentPeriodEnd: RENEWAL,
    billingChange: {
      interval: 'month',
      amountCents: monthlyCents,
      effectiveAt: RENEWAL,
    },
    replaces,
  };
}

/** C(b): Pro yearly → Premium yearly now, Premium monthly from 12 March. */
const UPGRADE_THEN_MONTHLY: TierChangePreview = {
  amountDueCents: 2915,
  prorationLineItems: [
    {
      description: 'Unused time on Pro (yearly) after 30 Oct 2026',
      amountCents: -4373,
    },
    {
      description: 'Remaining time on Premium (yearly) after 30 Oct 2026',
      amountCents: 7288,
    },
  ],
  newRecurringAmountCents: 2000,
  newRecurringInterval: 'month',
  prorationDate: 1_790_000_100,
  isUpgrade: true,
  takesEffect: 'now',
  currentPeriodEnd: RENEWAL,
  billingChange: { interval: 'month', amountCents: 2000, effectiveAt: RENEWAL },
  replaces: null,
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

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  for (const fn of Object.values(remote)) fn.mockReset();
  navigation.invalidate.mockClear();
  navigation.invalidateAll.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(current: Record<string, unknown>) {
  component = mount(PricingPage, {
    target: document.body,
    props: {
      data: {
        org: ORG,
        tiers: [BASIC, PRO, PREMIUM],
        currentSubscription: { data: current, loadError: false },
        isAuthenticated: true,
        enableSubscriptions: true,
        contentPreview: Promise.resolve([]),
        portals: Promise.resolve([]),
        stats: Promise.resolve(null),
        forContent: Promise.resolve(null),
      },
    } as never,
  });
  flushSync();
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const clean = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim();
const bodyText = () => clean(document.body.textContent);
const bold = (id: string) =>
  Array.from(byTestId(id)?.querySelectorAll('b') ?? []).map(
    (b) => b.textContent
  );

function card(name: string): HTMLElement {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>('article.card')
  ).find((el) => clean(el.querySelector('.card__name')?.textContent) === name);
  if (!found) throw new Error(`no card for ${name}`);
  return found;
}
const cardButton = (name: string) =>
  card(name).querySelector<HTMLButtonElement>(
    '[data-testid="tier-action"] button'
  );
const cardLabels = (name: string) =>
  Array.from(card(name).querySelectorAll('.card__label')).map((el) =>
    clean(el.textContent)
  );
function showAnnual() {
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.billing-toggle [role="radio"]'
    )
  )[1]?.click();
  flushSync();
}

describe('A: the same plan on monthly billing waits for the year’s end', () => {
  test('the dialog: nothing today, then £12 a month from 12 March (A1)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(1200),
    });
    mountPage(yearly(PRO));

    byTestId('tier-cta-switch-interval')?.click();
    await settle();

    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledWith(
      expect.objectContaining({ newTierId: PRO.id, billingInterval: 'month' })
    );
    expect(bodyText()).toContain(m.pricing_change_title_billing_month());
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait_billing_month({ date: DATE, price: '£12' })
    );
    expect(bold('tier-change-wait')).toEqual([DATE, '£12']);
    expect(bodyText()).toContain(m.pricing_change_wait_aside_billing());
    expect(bodyText()).toContain(
      m.pricing_change_then_month({ price: formatPrice(1200) })
    );
    expect(bodyText()).toContain(m.pricing_change_starting({ date: DATE }));
    // No credit: the year Alex paid for runs on.
    expect(bodyText()).not.toContain(m.pricing_change_credit_note());
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_on({ date: DATE })
    );
  });

  test('confirmed: the notice, Keep yearly billing, and Pro’s card says when (E1)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(1200),
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: true,
      data: yearly(PRO, {
        heldAmountCents: 12000,
        pendingTierChange: BILLING_WAITS,
      }),
    });
    mountPage(yearly(PRO));

    byTestId('tier-cta-switch-interval')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    const notice = clean(byTestId('plan-move-notice')?.textContent);
    expect(notice).toContain(
      m.pricing_billing_notice_title_month({ date: DATE })
    );
    expect(notice).toContain(
      m.pricing_billing_notice_body_month({
        plan: 'Pro',
        price: formatPrice(1200),
      })
    );
    expect(clean(byTestId('plan-move-keep')?.textContent)).toBe(
      m.pricing_billing_keep()
    );

    // Pro wears "Monthly from 12 March" in place of "Current Plan".
    expect(card('Pro').classList.contains('card--current')).toBe(true);
    expect(cardLabels('Pro')).toEqual([
      m.pricing_billing_from_month({ date: DATE }),
    ]);
    const pro = cardButton('Pro');
    expect(clean(pro?.textContent)).toBe(m.pricing_move_starts({ date: DATE }));
    expect(pro?.disabled).toBe(true);
    expect(pro?.getAttribute('aria-describedby')).toBe('plan-move-notice-text');
    // Basic still joins it; Premium still offers the upgrade.
    expect(cardButton('Basic')?.disabled).toBe(false);
    expect(cardButton('Premium')?.disabled).toBe(false);

    // On annual prices Pro is the current plan, with nothing waiting on it.
    showAnnual();
    expect(cardLabels('Pro')).toEqual([m.pricing_current_plan()]);
  });

  test('Keep yearly billing: kept, refused and landed say so in billing words (A2)', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: yearly(PRO),
    });
    mountPage(
      yearly(PRO, { heldAmountCents: 12000, pendingTierChange: BILLING_WAITS })
    );

    byTestId('plan-move-keep')?.click();
    await settle();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_kept_billing({ date: DATE, price: formatPrice(12000) })
    );
    expect(byTestId('plan-move-notice')).toBeNull();
    unmount(component);
    component = null;
    document.body.innerHTML = '';

    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'SOMETHING_ELSE',
      message: 'no',
      status: 409,
    });
    mountPage(
      yearly(PRO, { heldAmountCents: 12000, pendingTierChange: BILLING_WAITS })
    );
    byTestId('plan-move-keep')?.click();
    await settle();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_keep_failed_billing({ date: DATE })
    );
    unmount(component);
    component = null;
    document.body.innerHTML = '';

    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'MOVE_ALREADY_LANDED',
      message: 'landed',
      status: 409,
    });
    mountPage(
      yearly(PRO, { heldAmountCents: 12000, pendingTierChange: BILLING_WAITS })
    );
    byTestId('plan-move-keep')?.click();
    await settle();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_landed_billing()
    );
  });

  test('a dearer plan while billing waits: Keep first, in billing words', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: yearly(PRO),
    });
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: UPGRADE_THEN_MONTHLY,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: false,
      code: 'PAYMENT_REQUIRED',
      detailsCode: undefined,
      message: 'Your card was declined.',
      status: 402,
    });
    mountPage(
      yearly(PRO, { heldAmountCents: 12000, pendingTierChange: BILLING_WAITS })
    );

    cardButton('Premium')?.click();
    await settle();
    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
    expect(clean(byTestId('tier-change-keep-first')?.textContent)).toBe(
      m.pricing_change_keep_first_billing({ date: DATE, plan: 'Premium' })
    );

    byTestId('tier-change-dialog-continue')?.click();
    await settle();
    expect(clean(byTestId('tier-change-notice')?.textContent)).toBe(
      m.pricing_change_billing_cancelled({ currentPlan: 'Pro' })
    );

    byTestId('tier-change-dialog-confirm')?.click();
    await settle();
    expect(clean(byTestId('tier-change-move-cleared')?.textContent)).toBe(
      m.pricing_change_declined_after_keep_billing({ currentPlan: 'Pro' })
    );
  });
});

describe('B: a cheaper plan on monthly is one waiting change', () => {
  test('the dialog names the plan and the billing, and the confirm waits (B1)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(500),
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: true,
      data: yearly(PRO, {
        heldAmountCents: 12000,
        pendingTierChange: BOTH_WAIT,
      }),
    });
    mountPage(yearly(PRO));

    cardButton('Basic')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_title_two_steps_month({ plan: 'Basic' })
    );
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait_plan_and_billing_month({
        currentPlan: 'Pro',
        date: DATE,
        plan: 'Basic',
        price: '£5',
      })
    );
    expect(bold('tier-change-wait')).toEqual(['Pro', DATE, 'Basic', '£5']);
    expect(bodyText()).toContain(
      m.pricing_change_wait_aside({ currentPlan: 'Pro' })
    );
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_on({ date: DATE })
    );

    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    // E2: one notice, one Keep current plan (Q4); Basic's card says when.
    const notice = clean(byTestId('plan-move-notice')?.textContent);
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
    expect(clean(byTestId('plan-move-keep')?.textContent)).toBe(
      m.pricing_move_keep()
    );
    expect(cardLabels('Basic')).toEqual([m.pricing_move_from({ date: DATE })]);
    expect(cardButton('Basic')?.disabled).toBe(true);
    // Pro monthly would replace it (latest wins), so its switch stays.
    expect(cardLabels('Pro')).toEqual([m.pricing_current_plan()]);
    expect(byTestId('tier-cta-switch-interval')).not.toBeNull();
  });
});

describe('C(b): a dearer plan on monthly starts now on yearly billing', () => {
  test('the charge today, then £20.00/mo from 12 March (C1)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: UPGRADE_THEN_MONTHLY,
    });
    mountPage(yearly(PRO));

    cardButton('Premium')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_title_upgrade({ plan: 'Premium' })
    );
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_upgrade_then_billing_month({
        plan: 'Premium',
        date: DATE,
      })
    );
    expect(bold('tier-change-wait')).toEqual(['Premium', DATE]);
    expect(bodyText()).toContain(
      m.pricing_change_then_month({ price: formatPrice(2000) })
    );
    expect(bodyText()).toContain(m.pricing_change_starting({ date: DATE }));
    expect(bodyText()).not.toContain(m.pricing_change_credit_note());
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_pay({ amount: formatPrice(2915) })
    );
  });

  test('confirming: Premium now, still billed yearly, with monthly billing waiting', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: UPGRADE_THEN_MONTHLY,
    });
    let answer: (value: unknown) => void = () => {};
    remote.changeSubscriptionTier.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    mountPage(yearly(PRO));

    cardButton('Premium')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    // In flight: Premium is the plan, but the billing hasn't flipped to
    // monthly, so its card still offers the switch to monthly billing.
    expect(card('Premium').classList.contains('card--current')).toBe(true);
    expect(byTestId('tier-cta-switch-interval')).not.toBeNull();

    answer({
      success: true,
      data: yearly(PREMIUM, {
        pendingTierChange: {
          ...BILLING_WAITS,
          tierId: PREMIUM.id,
          tierName: 'Premium',
          amountCents: 2000,
        },
      }),
    });
    await settle();

    expect(clean(byTestId('plan-move-notice')?.textContent)).toContain(
      m.pricing_billing_notice_title_month({ date: DATE })
    );
    expect(cardLabels('Premium')).toEqual([
      m.pricing_billing_from_month({ date: DATE }),
    ]);
  });

  test('at the same price nothing is charged today', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: {
        ...UPGRADE_THEN_MONTHLY,
        amountDueCents: 0,
        prorationLineItems: [],
        isUpgrade: false,
      },
    });
    mountPage(yearly(PRO));

    cardButton('Premium')?.click();
    await settle();

    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_same_price_then_billing_month({
        plan: 'Premium',
        date: DATE,
      })
    );
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_switch()
    );
  });
});

describe('the waiting bill is read from billingChange', () => {
  test('the recurring line and the confirm date come from it, not the recurring fields', async () => {
    // The server fills both the same way today (data design §3.2); the dialog
    // reads billingChange, so a preview whose recurring fields describe the
    // yearly target still says monthly, from the year's end.
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: {
        ...waitPreview(1200),
        newRecurringAmountCents: 12000,
        newRecurringInterval: 'year',
        currentPeriodEnd: '2027-02-12T00:00:00.000Z',
      },
    });
    mountPage(yearly(PRO));

    byTestId('tier-cta-switch-interval')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_then_month({ price: formatPrice(1200) })
    );
    expect(bodyText()).not.toContain(
      m.pricing_change_then_year({ price: formatPrice(12000) })
    );
    expect(bodyText()).toContain(m.pricing_change_starting({ date: DATE }));
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_on({ date: DATE })
    );
  });
});

describe('D: a billing switch while a cheaper plan waits joins it', () => {
  test('Basic monthly replaces Basic yearly: "instead of £50 a year" (D1)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(500, {
        tierId: BASIC.id,
        tierName: 'Basic',
        interval: 'year',
        amountCents: 5000,
      }),
    });
    mountPage(
      yearly(PRO, {
        amountCents: 5000,
        heldAmountCents: 12000,
        pendingTierChange: BASIC_YEARLY_WAITS,
      })
    );

    cardButton('Basic')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_title_two_steps_month({ plan: 'Basic' })
    );
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait_billing_instead({
        currentPlan: 'Pro',
        date: DATE,
        plan: 'Basic',
        price: '£5',
        movingPrice: '£50',
      })
    );
    expect(bodyText()).not.toContain(
      m.pricing_change_wait_aside({ currentPlan: 'Pro' })
    );
  });

  test('Pro monthly while Basic waits: previewed, not refused, in A’s words', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(1200, {
        tierId: BASIC.id,
        tierName: 'Basic',
        interval: 'year',
        amountCents: 5000,
      }),
    });
    mountPage(
      yearly(PRO, {
        amountCents: 5000,
        heldAmountCents: 12000,
        pendingTierChange: BASIC_YEARLY_WAITS,
      })
    );

    byTestId('tier-cta-switch-interval')?.click();
    await settle();

    expect(byTestId('tier-change-interval-while-moving')).toBeNull();
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledWith(
      expect.objectContaining({ newTierId: PRO.id, billingInterval: 'month' })
    );
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait_billing_month({ date: DATE, price: '£12' })
    );
    // It replaces a waiting change, so no "Keep … from this page" aside.
    expect(bodyText()).not.toContain(m.pricing_change_wait_aside_billing());
  });
});

describe('a Stripe schedule that isn’t ours (SUBSCRIPTION_SCHEDULED_ELSEWHERE)', () => {
  const line = m.subscription_refusal_scheduled_elsewhere({
    errorId: 'err_7f3a',
  });

  test('a refused preview gives the id to quote, and only Close', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce(
      SCHEDULED_ELSEWHERE
    );
    mountPage(yearly(PRO));

    byTestId('tier-cta-switch-interval')?.click();
    await settle();

    expect(bodyText()).toContain(line);
    expect(bodyText()).not.toContain(SCHEDULED_ELSEWHERE.message);
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(byTestId('tier-change-dialog-retry')).toBeNull();
    expect(byTestId('tier-change-dialog-confirm')).toBeNull();
  });

  test('a refused confirm says the same, with no Try again', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: waitPreview(1200),
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    mountPage(yearly(PRO));

    byTestId('tier-cta-switch-interval')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(bodyText()).toContain(line);
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(byTestId('tier-change-dialog-confirm')).toBeNull();
  });

  test('a refused Keep and a refused Reactivate say it too, not "try again"', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    mountPage(
      yearly(PRO, { heldAmountCents: 12000, pendingTierChange: BILLING_WAITS })
    );

    byTestId('plan-move-keep')?.click();
    await settle();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(line);
    unmount(component);
    component = null;
    document.body.innerHTML = '';

    remote.reactivateSubscription.mockResolvedValueOnce(SCHEDULED_ELSEWHERE);
    mountPage(yearly(PRO, { status: 'active', cancelAtPeriodEnd: true }));
    byTestId('tier-cta-reactivate')?.click();
    await settle();
    expect(bodyText()).toContain(line);
  });
});
