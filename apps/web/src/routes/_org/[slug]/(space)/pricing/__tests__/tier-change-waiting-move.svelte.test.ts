/**
 * Pricing → Change plan: a cheaper plan waits for the renewal
 * (Codex-2hxff.16, decisions T1-T4, Q1-Q3; mockups change-plan.html and
 * waiting-move.html).
 *
 * - A cheaper plan keeps the current one until the period end, charges
 *   nothing, and the confirm says when ("Switch on 12 November").
 * - While a move waits: a notice with Keep current plan, the target card
 *   "Starts …", another cheaper plan replaces the move, a dearer plan keeps
 *   the current plan first (two calls behind one dialog), and a billing
 *   switch is refused with Keep.
 * - A cheaper plan on another billing period takes two steps.
 * - Set to cancel, other plans wait for Reactivate (Q2).
 *
 * Mounts the real `+page.svelte`, mocked as in
 * `tier-change-disputed.svelte.test.ts`.
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
}));
const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));
const collections = vi.hoisted(() => ({
  invalidateCollection: vi.fn(async () => {}),
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
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/remote/branding.remote', () => ({
  getPricingFaq: vi.fn(async () => []),
}));
vi.mock('$lib/collections', () => collections);

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

/** Alex's renewal; dates render as the page renders them. */
const PERIOD_END = '2026-11-12T00:00:00.000Z';
const DATE = formatSentenceDate(PERIOD_END);

const MOVE_TO_BASIC: PendingTierChange = {
  tierId: BASIC.id,
  tierName: 'Basic',
  amountCents: 500,
  billingInterval: 'month',
  effectiveAt: PERIOD_END,
  laterPrice: null,
};

function subscription(
  tierRow: SubscriptionTier,
  extra: Record<string, unknown> = {}
) {
  return {
    tierId: tierRow.id,
    tier: { id: tierRow.id, name: tierRow.name },
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    billingInterval: 'month',
    amountCents: tierRow.priceMonthly,
    heldAmountCents: null,
    pendingTierChange: null,
    ...extra,
  };
}

/** Pro → Basic: waits for the renewal, nothing prorated. */
const WAIT_PREVIEW: TierChangePreview = {
  amountDueCents: 0,
  prorationLineItems: [],
  newRecurringAmountCents: 500,
  newRecurringInterval: 'month',
  prorationDate: 1_790_000_000,
  isUpgrade: false,
  takesEffect: 'period_end',
  currentPeriodEnd: PERIOD_END,
};

/** Pro → Premium now, after Keep. */
const UPGRADE_PREVIEW: TierChangePreview = {
  amountDueCents: 336,
  prorationLineItems: [
    { description: 'Unused time on Pro after 30 Oct 2026', amountCents: -503 },
    {
      description: 'Remaining time on Premium after 30 Oct 2026',
      amountCents: 839,
    },
  ],
  newRecurringAmountCents: 2000,
  newRecurringInterval: 'month',
  prorationDate: 1_790_000_100,
  isUpgrade: true,
  takesEffect: 'now',
  currentPeriodEnd: PERIOD_END,
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  remote.previewSubscriptionTierChange.mockReset();
  remote.changeSubscriptionTier.mockReset();
  remote.keepCurrentPlan.mockReset();
  navigation.invalidate.mockClear();
  navigation.invalidateAll.mockClear();
  collections.invalidateCollection.mockClear();
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

/** The plan card named `name`. */
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

describe('a cheaper plan waits for the renewal (page 1 states 1-3)', () => {
  test('the dialog says the plan is kept and nothing is charged; Switch on the date', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: WAIT_PREVIEW,
    });
    mountPage(subscription(PRO));

    cardButton('Basic')?.click();
    await settle();

    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait({ currentPlan: 'Pro', date: DATE })
    );
    // Plan and date in bold.
    const bold = Array.from(
      byTestId('tier-change-wait')?.querySelectorAll('b') ?? []
    ).map((b) => b.textContent);
    expect(bold).toEqual(['Pro', DATE]);
    expect(bodyText()).toContain(
      m.pricing_change_wait_aside({ currentPlan: 'Pro' })
    );
    expect(bodyText()).toContain(
      m.pricing_change_title_switch({ plan: 'Basic' })
    );
    // No credit: Alex has paid for Pro to the renewal.
    expect(bodyText()).not.toContain(m.pricing_change_credit_note());
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_on({ date: DATE })
    );
  });

  test('confirming keeps Pro on the page and shows the waiting move', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: WAIT_PREVIEW,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: true,
      data: subscription(PRO, {
        amountCents: 500,
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      }),
    });
    mountPage(subscription(PRO));

    cardButton('Basic')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(remote.changeSubscriptionTier).toHaveBeenCalledWith(
      expect.objectContaining({
        newTierId: BASIC.id,
        prorationDate: 1_790_000_000,
      })
    );
    // Still on Pro: its card is the current one.
    expect(card('Pro').classList.contains('card--current')).toBe(true);
    expect(clean(byTestId('plan-move-notice')?.textContent)).toContain(
      m.pricing_move_notice_title({ plan: 'Basic', date: DATE })
    );
    const basic = cardButton('Basic');
    expect(clean(basic?.textContent)).toBe(
      m.pricing_move_starts({ date: DATE })
    );
    expect(basic?.disabled).toBe(true);
  });

  test('a confirm that a retry can fix: "We couldn\'t change your plan." and Switch on stays', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: WAIT_PREVIEW,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'boom',
      status: 500,
    });
    mountPage(subscription(PRO));

    cardButton('Basic')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(bodyText()).toContain(m.pricing_refusal_change_refused());
    expect(bodyText()).toContain(
      m.pricing_change_wait({ currentPlan: 'Pro', date: DATE })
    );
    expect(byTestId('tier-change-dialog-confirm')).not.toBeNull();
    // Nothing flipped: still Pro, nothing waiting.
    expect(card('Pro').classList.contains('card--current')).toBe(true);
    expect(byTestId('plan-move-notice')).toBeNull();
  });
});

describe('while a move waits', () => {
  test('the notice, and the target card says when it starts (waiting move state 1)', () => {
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    const notice = byTestId('plan-move-notice');
    expect(clean(notice?.textContent)).toContain(
      m.pricing_move_notice_body_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
      })
    );
    expect(clean(byTestId('tier-move-badge')?.textContent)).toBe(
      m.pricing_move_from({ date: DATE })
    );
    const basic = cardButton('Basic');
    expect(basic?.disabled).toBe(true);
    // The disabled button points at its reason.
    expect(basic?.getAttribute('aria-describedby')).toBe(
      'plan-move-notice-text'
    );
    expect(document.getElementById('plan-move-notice-text')).not.toBeNull();
  });

  test('the later price shows only when the server sends one', () => {
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: {
          ...MOVE_TO_BASIC,
          laterPrice: {
            amountCents: 600,
            effectiveAt: '2026-12-12T00:00:00.000Z',
          },
        },
      })
    );

    expect(clean(byTestId('plan-move-notice')?.textContent)).toContain(
      m.pricing_move_notice_body_later_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
        laterPrice: formatPrice(600),
        laterDate: formatSentenceDate('2026-12-12T00:00:00.000Z'),
      })
    );
  });

  test('another cheaper plan replaces it: "instead of Basic" (page 1 state 5)', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: { ...WAIT_PREVIEW, newRecurringAmountCents: 1200 },
    });
    // Sam: Premium, moving to Basic, picks Pro.
    mountPage(
      subscription(PREMIUM, {
        heldAmountCents: 2000,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    expect(clean(cardButton('Pro')?.textContent)).toBe('Downgrade to Pro');
    cardButton('Pro')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_title_instead({ plan: 'Pro' })
    );
    expect(clean(byTestId('tier-change-wait')?.textContent)).toBe(
      m.pricing_change_wait_instead({
        currentPlan: 'Premium',
        date: DATE,
        plan: 'Pro',
        movingTo: 'Basic',
      })
    );
    expect(bodyText()).not.toContain(
      m.pricing_change_wait_aside({ currentPlan: 'Premium' })
    );
  });

  test('a dearer plan keeps the current plan first, then shows the usual preview (states 6-7)', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: subscription(PRO),
    });
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: UPGRADE_PREVIEW,
    });
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    cardButton('Premium')?.click();
    await settle();

    // Step 1 asks before any preview: Stripe's item carries Basic's price.
    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
    expect(clean(byTestId('tier-change-keep-first')?.textContent)).toBe(
      m.pricing_change_keep_first({
        movingTo: 'Basic',
        date: DATE,
        plan: 'Premium',
      })
    );
    expect(bodyText()).toContain(
      m.pricing_change_title_upgrade({ plan: 'Premium' })
    );

    byTestId('tier-change-dialog-continue')?.click();
    await settle();

    expect(remote.keepCurrentPlan).toHaveBeenCalledWith({
      organizationId: ORG.id,
    });
    expect(remote.previewSubscriptionTierChange).toHaveBeenCalledWith(
      expect.objectContaining({
        newTierId: PREMIUM.id,
        billingInterval: 'month',
      })
    );
    expect(clean(byTestId('tier-change-notice')?.textContent)).toBe(
      m.pricing_change_move_cancelled({ movingTo: 'Basic', currentPlan: 'Pro' })
    );
    expect(clean(byTestId('tier-change-dialog-confirm')?.textContent)).toBe(
      m.pricing_change_confirm_pay({ amount: formatPrice(336) })
    );
    // The page behind shows plain Pro: the move is gone.
    expect(byTestId('plan-move-notice')).toBeNull();
  });

  test('Cancel in step 1 changes nothing', async () => {
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    cardButton('Premium')?.click();
    await settle();
    byTestId('tier-change-dialog-cancel')?.click();
    await settle();

    expect(remote.keepCurrentPlan).not.toHaveBeenCalled();
    expect(byTestId('plan-move-notice')).not.toBeNull();
  });

  test('a declined charge in step 2 says the move was cancelled in step 1 (state 8)', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: subscription(PRO),
    });
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: true,
      data: UPGRADE_PREVIEW,
    });
    remote.changeSubscriptionTier.mockResolvedValueOnce({
      success: false,
      code: 'PAYMENT_REQUIRED',
      detailsCode: undefined,
      message: '',
      status: 402,
    });
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    cardButton('Premium')?.click();
    await settle();
    byTestId('tier-change-dialog-continue')?.click();
    await settle();
    byTestId('tier-change-dialog-confirm')?.click();
    await settle();

    expect(bodyText()).toContain(m.pricing_refusal_payment_declined());
    expect(clean(byTestId('tier-change-move-cleared')?.textContent)).toBe(
      m.pricing_change_declined_after_keep({
        currentPlan: 'Pro',
        movingTo: 'Basic',
      })
    );
    // The info line about step 1 gives way to the decline.
    expect(byTestId('tier-change-notice')).toBeNull();
  });

  test('a refused step 1 leaves the move set and says so', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'boom',
      status: 500,
    });
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    cardButton('Premium')?.click();
    await settle();
    byTestId('tier-change-dialog-continue')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_move_keep_failed({ plan: 'Pro', movingTo: 'Basic', date: DATE })
    );
    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
    expect(byTestId('tier-change-dialog-continue')).not.toBeNull();
  });

  test('a billing switch is refused with Keep Pro, which keeps the plan only (state 12)', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: subscription(PRO),
    });
    mountPage(
      subscription(PRO, {
        heldAmountCents: 1200,
        pendingTierChange: MOVE_TO_BASIC,
      })
    );

    // Annual billing: Pro's card offers the switch.
    const annual = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.billing-toggle [role="radio"]'
      )
    )[1];
    annual?.click();
    flushSync();
    byTestId('tier-cta-switch-interval')?.click();
    await settle();

    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
    expect(bodyText()).toContain(m.pricing_change_title_billing_year());
    expect(
      clean(byTestId('tier-change-interval-while-moving')?.textContent)
    ).toBe(
      m.pricing_change_interval_while_moving({
        movingTo: 'Basic',
        date: DATE,
        currentPlan: 'Pro',
      })
    );

    byTestId('tier-change-dialog-keep')?.click();
    await settle();

    expect(remote.keepCurrentPlan).toHaveBeenCalledTimes(1);
    // Kept only: no billing-switch preview follows.
    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_kept({ plan: 'Pro', date: DATE, price: formatPrice(1200) })
    );
  });
});

describe('two steps, and a refusal the page has no move for', () => {
  test('a cheaper plan on another billing period: plan first (page 1 state 10)', async () => {
    remote.previewSubscriptionTierChange
      .mockResolvedValueOnce({
        success: false,
        code: 'BUSINESS_LOGIC_ERROR',
        detailsCode: 'TIER_CHANGE_TWO_STEPS',
        message: 'two steps',
        status: 422,
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          ...WAIT_PREVIEW,
          newRecurringInterval: 'year',
          newRecurringAmountCents: 5000,
        },
      });
    // Jo: Pro yearly, picks Basic monthly.
    mountPage(subscription(PRO, { billingInterval: 'year' }));

    cardButton('Basic')?.click();
    await settle();

    expect(bodyText()).toContain(
      m.pricing_change_title_two_steps_month({ plan: 'Basic' })
    );
    const steps = Array.from(
      byTestId('tier-change-two-steps')?.querySelectorAll('li') ?? []
    ).map((li) => clean(li.textContent));
    expect(steps).toEqual([
      m.pricing_change_two_steps_first({
        target: m.pricing_change_plan_on_billing_year({ plan: 'Basic' }),
        currentPlan: 'Pro',
        date: DATE,
      }),
      m.pricing_change_two_steps_second_to_month({
        plan: 'Basic',
        billing: m.pricing_change_billing_month(),
      }),
    ]);

    byTestId('tier-change-dialog-first-step')?.click();
    await settle();

    // Step 1 is Basic on the billing Jo has now.
    expect(remote.previewSubscriptionTierChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ newTierId: BASIC.id, billingInterval: 'year' })
    );
    expect(byTestId('tier-change-wait')).not.toBeNull();
  });

  test('PENDING_MOVE_KEEP_FIRST with no move known: a plain refusal, Close, and a re-read', async () => {
    remote.previewSubscriptionTierChange.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'PENDING_MOVE_KEEP_FIRST',
      message: 'keep first',
      status: 409,
    });
    mountPage(subscription(PRO));

    cardButton('Premium')?.click();
    await settle();

    expect(bodyText()).toContain(m.pricing_refusal_change_keep_first());
    expect(byTestId('tier-change-dialog-close')).not.toBeNull();
    expect(navigation.invalidateAll).toHaveBeenCalled();
  });
});

describe('set to cancel (Q2, page 1 state 11)', () => {
  test('other plans say "Reactivate to change plan" and point at the end date', () => {
    mountPage(
      subscription(PRO, { status: 'cancelling', cancelAtPeriodEnd: true })
    );

    for (const name of ['Basic', 'Premium']) {
      const button = cardButton(name);
      expect(clean(button?.textContent)).toBe(m.pricing_reactivate_to_change());
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute('aria-describedby')).toBe(
        'tier-cancelling-label'
      );
    }
    expect(document.getElementById('tier-cancelling-label')).not.toBeNull();
    expect(remote.previewSubscriptionTierChange).not.toHaveBeenCalled();
  });
});

describe('Keep current plan from the notice (waiting move states 2-4)', () => {
  const moving = () =>
    subscription(PRO, {
      heldAmountCents: 1200,
      pendingTierChange: MOVE_TO_BASIC,
    });

  test('kept: one call, the notice turns into the staying line, focused', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: true,
      data: subscription(PRO),
    });
    mountPage(moving());

    byTestId('plan-move-keep')?.click();
    await settle();
    await settle();

    expect(remote.keepCurrentPlan).toHaveBeenCalledTimes(1);
    expect(byTestId('plan-move-notice')).toBeNull();
    const outcome = byTestId('plan-move-outcome');
    expect(clean(outcome?.textContent)).toBe(
      m.pricing_move_kept({ plan: 'Pro', date: DATE, price: formatPrice(1200) })
    );
    expect(document.activeElement).toBe(outcome);
    // Basic is offered again.
    expect(clean(cardButton('Basic')?.textContent)).toBe('Downgrade to Basic');
    expect(collections.invalidateCollection).toHaveBeenCalledWith(
      'subscription'
    );
    expect(collections.invalidateCollection).toHaveBeenCalledWith('library');
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
  });

  test('refused: the move stays, and the words say so; Keep is offered again', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'boom',
      status: 500,
    });
    mountPage(moving());

    byTestId('plan-move-keep')?.click();
    await settle();

    expect(byTestId('plan-move-notice')).not.toBeNull();
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_keep_failed({ plan: 'Pro', movingTo: 'Basic', date: DATE })
    );
    expect(byTestId('plan-move-keep')).not.toBeNull();
    expect(navigation.invalidateAll).not.toHaveBeenCalled();
  });

  test('no answer: the page reads the plan again and says it could not confirm', async () => {
    remote.keepCurrentPlan.mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    mountPage(moving());

    byTestId('plan-move-keep')?.click();
    await settle();

    expect(navigation.invalidateAll).toHaveBeenCalledTimes(1);
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_refusal_change_unconfirmed()
    );
  });

  test('after the renewal (MOVE_ALREADY_LANDED): the page reads the plan again', async () => {
    remote.keepCurrentPlan.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'MOVE_ALREADY_LANDED',
      message: 'landed',
      status: 409,
    });
    mountPage(moving());

    byTestId('plan-move-keep')?.click();
    await settle();

    expect(navigation.invalidateAll).toHaveBeenCalledTimes(1);
    expect(clean(byTestId('plan-move-outcome')?.textContent)).toBe(
      m.pricing_move_landed({ plan: 'Basic' })
    );
  });
});
