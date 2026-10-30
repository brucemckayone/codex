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
  /** When the viewer's current period ends (ISO), for a downgrade's start. */
  currentPeriodEnd: string | null;
}

/**
 * What the paywall of a gated item says (owner decisions U9 and U11):
 * - `closed`: no plan anyone can join includes it.
 * - `loading` / `unnamed`: the plan list has not arrived, or failed, so no
 *   plan is named.
 * - `subscribe`: no plan yet. `upgrade`: every plan that includes it costs
 *   more than the viewer's. `change`: a cheaper (or same-price) plan includes
 *   it, which starts only when the current period ends (Codex-2hxff.16), so
 *   the copy says when each plan would start.
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
      /** "Basic": the rest, which start at the period end. */
      downgradePlans: string | null;
      periodEnd: string | null;
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
      periodEnd: input.currentPeriodEnd,
    };
  }
  const upgrades = others.filter((tier) => isDearer(current, tier));
  const downgrades = others.filter((tier) => !isDearer(current, tier));
  if (downgrades.length === 0) {
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
    downgradePlans: joinNames(
      downgrades.map((tier) => tier.name),
      'or'
    ),
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
  }
}

function changeTiming(
  paywall: Extract<PlanPaywall, { kind: 'change' }>,
  formatDate: (iso: string) => string
): string | null {
  const { downgradePlans, upgradePlans, currentPlan, periodEnd } = paywall;
  if (!downgradePlans) return null;
  if (!periodEnd) {
    return m.change_plan_cta_timing_downgrade_undated({
      downgradePlans,
      currentPlan,
    });
  }
  const date = formatDate(periodEnd);
  return upgradePlans
    ? m.change_plan_cta_timing({
        upgradePlans,
        downgradePlans,
        currentPlan,
        date,
      })
    : m.change_plan_cta_timing_downgrade({ downgradePlans, currentPlan, date });
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
