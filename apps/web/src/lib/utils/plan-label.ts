/**
 * Which plans include an item, said in words, for the buyer's side of plan
 * access (Codex-2hxff.91): the card badge, the film page's paywall and the
 * pricing page's highlight.
 *
 * An item stores the exact SET of plans that include it
 * (`includedInTierIds`), not one plan "and above". Every rule here is judged
 * by the MONTHLY price, strictly (owner decision U1), with the Studio picker's
 * own helpers, so the buyer's "Pro and above" names exactly the set the
 * creator's "Pro and above" shortcut ticks.
 *
 * Only the org's ACTIVE plans (the public tier list) are named. A tick on an
 * inactive plan keeps that plan's existing subscribers in, but nobody new can
 * join it, so it is never offered.
 *
 * "Is it included for me?" never comes through here: that is set membership,
 * `includedInTierIds.includes(myPlanId)`, and needs no tier list.
 */

import {
  isAndAboveSelection,
  isDearer,
  joinNames,
  type PickerTier,
  tiersByPrice,
} from '$lib/components/studio/plan-picker/select-from-tier';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';

/** What these helpers need of a plan: the public tier row satisfies it. */
export type PlanOption = PickerTier;

/** The viewer's own plan, from their access-granting subscription. */
export interface ViewerPlan {
  id: string;
  name: string;
}

/**
 * The plan a move to a cheaper plan goes to, waiting for the renewal
 * (Codex-2hxff.16). The viewer keeps {@link ViewerPlan} until then.
 */
export interface PendingPlan {
  id: string;
  name: string;
  /** ISO: the renewal the move lands on. */
  effectiveAt: string;
}

/**
 * The active plans that include the item, cheapest first. `[]` when it is in
 * no plan, or only in plans nobody can join.
 */
export function includingPlans<T extends PlanOption>(
  includedTierIds: readonly string[] | null | undefined,
  tiers: readonly T[]
): T[] {
  if (!includedTierIds?.length) return [];
  const ids = new Set(includedTierIds);
  return tiersByPrice(tiers.filter((tier) => ids.has(tier.id)));
}

/**
 * Whether a plan a new viewer can join includes the item: some ACTIVE plan
 * (owner U13). A tick on a switched-off plan keeps its members in but sells
 * nothing, so it does not count, as on the server's catalogue rule
 * (`notClosedToNewViewers`, `@codex/content`).
 */
export function inAPlanOnSale(
  includedTierIds: readonly string[] | null | undefined,
  tiers: readonly PlanOption[]
): boolean {
  return includingPlans(includedTierIds, tiers).length > 0;
}

/**
 * Whether the plans are "the cheapest of them and every dearer active plan",
 * the shape the "and above" shortcut ticks. Never true for one plan.
 */
function isAndAbove(
  including: readonly PlanOption[],
  tiers: readonly PlanOption[]
): boolean {
  const [cheapest] = including;
  if (!cheapest || including.length < 2) return false;
  return isAndAboveSelection(
    including.map((tier) => tier.id),
    cheapest.id,
    tiers
  );
}

/**
 * The card badge (owner decision U8, mockup badge A): "Basic and above",
 * "Pro only", "Premium" (one plan with nothing dearer), "Basic, Premium", or
 * "3 plans" for a scattered set of three or more.
 *
 * Null when no active plan includes the item, or when `tiers` has not loaded:
 * the badge then shows its generic "Subscription", or only the price for an
 * item that is on sale.
 */
export function planBadgeLabel(
  includedTierIds: readonly string[] | null | undefined,
  tiers: readonly PlanOption[]
): string | null {
  const including = includingPlans(includedTierIds, tiers);
  const [first, second] = including;
  if (!first) return null;
  if (!second) {
    return tiers.some((tier) => isDearer(first, tier))
      ? m.content_price_tier_only({ plan: first.name })
      : first.name;
  }
  if (isAndAbove(including, tiers)) {
    return m.content_price_tier_and_above({ plan: first.name });
  }
  if (including.length === 2) {
    return m.content_price_tier_pair({
      first: first.name,
      second: second.name,
    });
  }
  return m.content_price_tier_count({ count: including.length });
}

/**
 * The plans in a sentence, cheapest first: "Pro and above" for the shortcut's
 * shape, otherwise the names, "Basic and Premium". `''` for no plan.
 */
export function planNamesPhrase(
  including: readonly PlanOption[],
  tiers: readonly PlanOption[]
): string {
  const [cheapest] = including;
  if (!cheapest) return '';
  if (isAndAbove(including, tiers)) {
    return m.plan_names_and_above({ plan: cheapest.name });
  }
  return joinNames(including.map((tier) => tier.name));
}

/** Where the org's plan list stands on a page that streams it. */
export type PlanListStatus = 'loading' | 'ready' | 'failed';

export interface PlanPaywallInput {
  /**
   * The item's full set of ticked plans (`[]` when gated in none). Null when
   * the row did not carry the set (a content-api older than plan access): no
   * plan is named, and the item is never called closed on that account.
   */
  includedInTierIds: readonly string[] | null;
  /** The org's active plans. */
  tiers: readonly PlanOption[];
  tiersStatus: PlanListStatus;
  /** The viewer's access-granting plan; null for anyone without one. */
  currentPlan: ViewerPlan | null;
  /** The viewer's period end (ISO), when a move to a cheaper plan starts. */
  currentPeriodEnd: string | null;
  /**
   * Where the viewer's waiting move goes, if anywhere. When that plan
   * includes the item, the paywall says when it opens (`moving`).
   */
  pendingPlan?: PendingPlan | null;
}

/**
 * What the paywall of a gated item says (owner decisions U9 and U11):
 * - `closed`: no plan anyone can join includes it.
 * - `loading` / `unnamed`: the plan list has not arrived, or failed, so no
 *   plan is named.
 * - `subscribe`: no plan yet. `upgrade`: every plan that includes it costs
 *   more than the viewer's. `change`: a cheaper (or same-price) plan includes
 *   it, so the copy says when the move starts (see `changeTiming`).
 * - `moving`: the plan the viewer is already moving to includes it
 *   (Codex-2hxff.16), so the copy says when it opens, and names any dearer
 *   plan that opens it now.
 */
export type PlanPaywall =
  | { kind: 'closed' }
  | { kind: 'loading'; member: boolean }
  | { kind: 'unnamed'; member: boolean }
  | { kind: 'subscribe'; plans: string; fromPrice: string }
  | { kind: 'upgrade'; currentPlan: string; plans: string; fromPrice: string }
  | {
      kind: 'change';
      currentPlan: string;
      plans: string;
      /** "Basic (£5.00 a month) and Premium (£20.00 a month)" */
      plansWithPrices: string;
      /** "Premium": dearer plans, which start straight away. */
      upgradePlans: string | null;
      /** "Basic": cheaper plans, which start when the period ends. */
      downgradePlans: string | null;
      /** Plans at the viewer's price, which switch now (owner Q4). */
      samePricePlans: string | null;
      periodEnd: string | null;
    }
  | {
      kind: 'moving';
      currentPlan: string;
      targetPlan: string;
      /** ISO: when the move lands. */
      date: string;
      /** "Premium": dearer plans that include it now. */
      upgradePlans: string | null;
      /** The cheapest of those, a month. */
      upgradeFromPrice: string | null;
    };

/** Decide the paywall's case. Pure; the copy is {@link planPaywallCopy}. */
export function describePlanPaywall(input: PlanPaywallInput): PlanPaywall {
  const { currentPlan } = input;
  const member = currentPlan != null;
  if (input.includedInTierIds == null) return { kind: 'unnamed', member };
  // No tick at all needs no plan list to call: it is closed (U11).
  if (input.includedInTierIds.length === 0) return { kind: 'closed' };
  if (input.tiersStatus === 'loading') return { kind: 'loading', member };
  if (input.tiersStatus === 'failed') return { kind: 'unnamed', member };

  const including = includingPlans(input.includedInTierIds, input.tiers);
  const [cheapest] = including;
  if (!cheapest) return { kind: 'closed' };

  const plans = planNamesPhrase(including, input.tiers);
  const fromPrice = formatPrice(cheapest.priceMonthly);
  if (!currentPlan) return { kind: 'subscribe', plans, fromPrice };

  const others = including.filter((tier) => tier.id !== currentPlan.id);
  const current = input.tiers.find((tier) => tier.id === currentPlan.id);
  const pending = input.pendingPlan;
  if (pending && input.includedInTierIds.includes(pending.id)) {
    // Already chosen: only a dearer plan opens it sooner.
    const sooner = current
      ? others.filter((tier) => isDearer(current, tier))
      : [];
    const [cheapestSooner] = sooner;
    return {
      kind: 'moving',
      currentPlan: currentPlan.name,
      targetPlan: pending.name,
      date: pending.effectiveAt,
      upgradePlans:
        sooner.length > 0
          ? joinNames(
              sooner.map((tier) => tier.name),
              'or'
            )
          : null,
      upgradeFromPrice: cheapestSooner
        ? formatPrice(cheapestSooner.priceMonthly)
        : null,
    };
  }
  const plansWithPrices = joinNames(
    others.map((tier) =>
      m.change_plan_cta_plan_with_price({
        plan: tier.name,
        price: formatPrice(tier.priceMonthly),
      })
    )
  );
  if (!current) {
    // Their plan is not on sale any more, so its price is unknown: name the
    // plans, but say nothing about when a move would start.
    return {
      kind: 'change',
      currentPlan: currentPlan.name,
      plans,
      plansWithPrices,
      upgradePlans: null,
      downgradePlans: null,
      samePricePlans: null,
      periodEnd: input.currentPeriodEnd,
    };
  }
  const upgrades = others.filter((tier) => isDearer(current, tier));
  const downgrades = others.filter((tier) => isDearer(tier, current));
  const samePrice = others.filter(
    (tier) => !isDearer(current, tier) && !isDearer(tier, current)
  );
  if (downgrades.length === 0 && samePrice.length === 0) {
    return { kind: 'upgrade', currentPlan: currentPlan.name, plans, fromPrice };
  }
  return {
    kind: 'change',
    currentPlan: currentPlan.name,
    plans,
    plansWithPrices,
    upgradePlans:
      upgrades.length > 0
        ? joinNames(
            upgrades.map((tier) => tier.name),
            'or'
          )
        : null,
    downgradePlans:
      downgrades.length > 0
        ? joinNames(
            downgrades.map((tier) => tier.name),
            'or'
          )
        : null,
    samePricePlans:
      samePrice.length > 0
        ? joinNames(
            samePrice.map((tier) => tier.name),
            'or'
          )
        : null,
    periodEnd: input.currentPeriodEnd,
  };
}

/** The paywall's words: the lock over the player takes `short`. */
export interface PlanPaywallCopy {
  title: string;
  /** Null while the plan list loads: the view shows a skeleton pill. */
  short: string | null;
  /** The gate box's sentence. Null while loading, as `short`. */
  full: string | null;
  /** When each plan would start, for a change of plan. */
  timing: string | null;
}

/**
 * The copy for a {@link PlanPaywall}. `formatDate` renders the period end
 * ("12 November"); it is passed in so this stays free of the clock.
 */
export function planPaywallCopy(
  paywall: PlanPaywall,
  formatDate: (iso: string) => string
): PlanPaywallCopy {
  switch (paywall.kind) {
    case 'closed':
      return {
        title: m.unavailable_cta_title(),
        short: m.unavailable_cta_description(),
        full: m.unavailable_cta_description(),
        timing: null,
      };
    case 'loading':
      return {
        title: paywall.member
          ? m.change_plan_cta_title()
          : m.subscribe_cta_title(),
        short: null,
        full: null,
        timing: null,
      };
    case 'unnamed':
      return paywall.member
        ? {
            title: m.change_plan_cta_title(),
            short: m.upgrade_cta_description(),
            full: m.upgrade_cta_description(),
            timing: null,
          }
        : {
            title: m.subscribe_cta_title(),
            short: m.subscribe_cta_description(),
            full: m.subscribe_cta_description(),
            timing: null,
          };
    case 'subscribe':
      return {
        title: m.subscribe_cta_title(),
        short: m.subscribe_cta_included_short({ plans: paywall.plans }),
        full: m.subscribe_cta_included({
          plans: paywall.plans,
          price: paywall.fromPrice,
        }),
        timing: null,
      };
    case 'upgrade':
      return {
        title: m.upgrade_cta_title(),
        short: m.plan_cta_not_in_plan_short({
          currentPlan: paywall.currentPlan,
          plans: paywall.plans,
        }),
        full: m.upgrade_cta_not_in_plan({
          currentPlan: paywall.currentPlan,
          plans: paywall.plans,
          price: paywall.fromPrice,
        }),
        timing: null,
      };
    case 'change':
      return {
        title: m.change_plan_cta_title(),
        short: m.plan_cta_not_in_plan_short({
          currentPlan: paywall.currentPlan,
          plans: paywall.plans,
        }),
        full: m.change_plan_cta_not_in_plan({
          currentPlan: paywall.currentPlan,
          plansWithPrices: paywall.plansWithPrices,
        }),
        timing: changeTiming(paywall, formatDate),
      };
    case 'moving': {
      const date = formatDate(paywall.date);
      return {
        title: m.change_plan_cta_title(),
        short: m.plan_cta_moving_short({
          currentPlan: paywall.currentPlan,
          date,
        }),
        full: m.change_plan_cta_moving({
          targetPlan: paywall.targetPlan,
          date,
        }),
        timing:
          paywall.upgradePlans && paywall.upgradeFromPrice
            ? m.change_plan_cta_moving_now({
                upgradePlans: paywall.upgradePlans,
                price: paywall.upgradeFromPrice,
              })
            : null,
      };
    }
  }
}

/**
 * When a change of plan starts, as `SubscriptionService.changeTier` does it
 * (Codex-2hxff.16, owner U9; it flipped U12's "starts straight away, with
 * credit" in the same PR): a dearer plan is invoiced for the difference and
 * starts at once; a cheaper one waits for the end of the period the viewer
 * has paid for, which they keep until then; a same-price one switches now
 * with nothing charged (owner Q4), in its own sentence.
 */
function changeTiming(
  paywall: Extract<PlanPaywall, { kind: 'change' }>,
  formatDate: (iso: string) => string
): string | null {
  const {
    downgradePlans,
    upgradePlans,
    samePricePlans,
    currentPlan,
    periodEnd,
  } = paywall;
  const lines: string[] = [];
  if (downgradePlans && !periodEnd) {
    lines.push(
      m.change_plan_cta_timing_downgrade_undated({
        downgradePlans,
        currentPlan,
      })
    );
  } else if (downgradePlans && periodEnd) {
    const date = formatDate(periodEnd);
    lines.push(
      upgradePlans
        ? m.change_plan_cta_timing({
            upgradePlans,
            downgradePlans,
            currentPlan,
            date,
          })
        : m.change_plan_cta_timing_downgrade({
            downgradePlans,
            currentPlan,
            date,
          })
    );
  }
  if (samePricePlans) {
    lines.push(m.change_plan_cta_timing_same_price({ samePricePlans }));
  }
  return lines.length > 0 ? lines.join(' ') : null;
}

/** What the notice of a waiting move needs (`PendingTierChange`'s fields). */
export interface WaitingMove {
  /**
   * What waits (Codex-2hxff.97): a cheaper plan on the same billing, a
   * switch to monthly billing on the same plan, or both. Only yearly
   * billing waits to become monthly, so the billing kinds word it monthly.
   */
  kind: 'plan' | 'billing' | 'plan_and_billing';
  tierName: string;
  /** The next bill, at the target's price. */
  amountCents: number;
  billingInterval: 'month' | 'year';
  /** A price change on the target after the move (T6); null until .86 fills it. */
  laterPrice: null | { amountCents: number; effectiveAt: string };
}

/** The notice's title: "Moving to Basic on 12 November". */
export function waitingMoveTitle(
  move: Pick<WaitingMove, 'kind' | 'tierName'> & { effectiveAt: string },
  formatDate: (iso: string) => string
): string {
  const date = formatDate(move.effectiveAt);
  switch (move.kind) {
    case 'billing':
      return m.pricing_billing_notice_title_month({ date });
    case 'plan_and_billing':
      return m.pricing_move_notice_title_billing_month({
        plan: move.tierName,
        date,
      });
    default:
      return m.pricing_move_notice_title({ plan: move.tierName, date });
  }
}

/**
 * The notice's button. One Keep undoes the whole change (Q4); it is "Keep
 * yearly billing" when the plan stays the same.
 */
export function waitingMoveKeepLabel(move: Pick<WaitingMove, 'kind'>): string {
  return move.kind === 'billing'
    ? m.pricing_billing_keep()
    : m.pricing_move_keep();
}

/**
 * The second line of the waiting-move notice on the pricing and account
 * pages (Codex-2hxff.16, T3): "You keep Pro until then. Basic is £5.00 a
 * month after that." When the target's price changes after the move (T6),
 * it names the later price too, so the page and the 30-day email agree.
 */
export function waitingMoveBody(
  move: WaitingMove,
  currentPlan: string,
  formatDate: (iso: string) => string
): string {
  const params = {
    currentPlan,
    plan: move.tierName,
    price: formatPrice(move.amountCents),
  };
  const later = move.laterPrice;
  if (move.kind === 'billing') {
    const billing = { plan: move.tierName, price: params.price };
    return later
      ? m.pricing_billing_notice_body_later_month({
          ...billing,
          laterPrice: formatPrice(later.amountCents),
          laterDate: formatDate(later.effectiveAt),
        })
      : m.pricing_billing_notice_body_month(billing);
  }
  if (move.kind === 'plan_and_billing') {
    return later
      ? m.pricing_move_notice_body_billing_later_month({
          ...params,
          laterPrice: formatPrice(later.amountCents),
          laterDate: formatDate(later.effectiveAt),
        })
      : m.pricing_move_notice_body_billing_month(params);
  }
  if (later) {
    const withLater = {
      ...params,
      laterPrice: formatPrice(later.amountCents),
      laterDate: formatDate(later.effectiveAt),
    };
    return move.billingInterval === 'year'
      ? m.pricing_move_notice_body_later_year(withLater)
      : m.pricing_move_notice_body_later_month(withLater);
  }
  return move.billingInterval === 'year'
    ? m.pricing_move_notice_body_year(params)
    : m.pricing_move_notice_body_month(params);
}

/**
 * What Keep came to (page 2 states 3-4; year-to-month-waits A2). `date` and
 * `price` are formatted already; without either the line names no payment.
 */
export function waitingMoveKeptLine(
  move: Pick<WaitingMove, 'kind'> | null,
  plan: string,
  date: string | null,
  price: string | null
): string {
  if (move?.kind === 'billing') {
    return date && price
      ? m.pricing_move_kept_billing({ date, price })
      : m.pricing_move_kept_billing_undated();
  }
  return date && price
    ? m.pricing_move_kept({ plan, date, price })
    : m.pricing_move_kept_undated({ plan });
}

/** A refused Keep: what waits is still set. */
export function waitingMoveKeepFailedLine(
  move: Pick<WaitingMove, 'kind' | 'tierName'> & { effectiveAt: string },
  plan: string,
  formatDate: (iso: string) => string
): string {
  const date = formatDate(move.effectiveAt);
  return move.kind === 'billing'
    ? m.pricing_move_keep_failed_billing({ date })
    : m.pricing_move_keep_failed({ plan, movingTo: move.tierName, date });
}

/** Keep pressed after the renewal it waited for: the change has happened. */
export function waitingMoveLandedLine(
  move: Pick<WaitingMove, 'kind' | 'tierName'>
): string {
  return move.kind === 'billing'
    ? m.pricing_move_landed_billing()
    : m.pricing_move_landed({ plan: move.tierName });
}

/** Set to cancel: reactivating brings what waits back (T4). */
export function waitingMoveSurvivesCancelLine(
  move: Pick<WaitingMove, 'kind' | 'tierName'> & { effectiveAt: string },
  formatDate: (iso: string) => string
): string {
  const date = formatDate(move.effectiveAt);
  return move.kind === 'billing'
    ? m.account_billing_change_survives_cancel({ date })
    : m.subscription_move_survives_cancel({ plan: move.tierName, date });
}

/** The pricing page's words when it is opened from an item (U10). */
export interface PricingHighlight {
  /** "Salt Roads is included with Pro and Premium." */
  headline: string;
  /** The active plans that include it. */
  includedTierIds: ReadonlySet<string>;
}

/**
 * The pricing highlight for `item` over the page's plan cards. The plans are
 * named in full ("Pro and Premium"), since each card is on the page beside
 * the line.
 */
export function pricingHighlight(
  item: { title: string; includedInTierIds: readonly string[] },
  tiers: readonly PlanOption[]
): PricingHighlight {
  const including = includingPlans(item.includedInTierIds, tiers);
  return {
    headline:
      including.length > 0
        ? m.pricing_for_content_included({
            title: item.title,
            plans: joinNames(including.map((tier) => tier.name)),
          })
        : m.pricing_for_content_none({ title: item.title }),
    includedTierIds: new Set(including.map((tier) => tier.id)),
  };
}
