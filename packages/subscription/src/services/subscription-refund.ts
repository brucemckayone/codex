/**
 * A refunded subscription payment (owner decision P-4, "Cancel + end access";
 * docs/payments/subscriptions.md#refunds):
 *
 * - a FULL refund of the payment for the CURRENT billing period cancels the
 *   subscription at Stripe, at once and without proration, and access ends;
 * - a partial refund, a refund of an earlier period's payment, or of a
 *   payment that bought no period (an upgrade's proration invoice) leaves it
 *   running (owner decision 2026-10-20, "Current period's payment").
 *
 * The money is not handled here: the creator and organisation slices are
 * reversed from the charge, as for any refund. Tier and course subscriptions
 * are handled alike. Safe to run again: Stripe is asked first whether the
 * subscription is still live, and the cancel carries an idempotency key.
 *
 * A refund of a second subscription the user already had (Codex-2hxff.15)
 * cancels nothing: it was cancelled when it was recorded, and refunded by us.
 * Nor does the refund of the payment that revived an old subscription next to
 * the newer one that stands (owner decision 7, "Cancel old, refund it"): it
 * was ended then. Either result says what the buyer's email needs instead.
 */

import { ACCESS_GRANTING_SUBSCRIPTION_STATUSES } from '@codex/constants';
import {
  courseSubscriptions,
  courses,
  organizations,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';
import {
  type ChargedSubscription,
  invoiceForPaymentIntent,
  type SubscriptionChargeDeps,
  subscriptionForStripeId,
} from './subscription-charge';

type SubscriptionRefundDeps = SubscriptionChargeDeps & {
  obs: SubscriptionChargeDeps['obs'] & {
    info(message: string, metadata?: Record<string, unknown>): void;
  };
};

export interface RefundedCharge {
  chargeId: string;
  paymentIntentId: string | null;
  /** The charge's amount, in pence. */
  amountCents: number;
  /** Everything refunded on the charge so far, in pence (cumulative). */
  amountRefundedCents: number;
}

/**
 * What the refund email of a duplicate subscription says (owner decision
 * 2026-10-22): "You were already subscribed to …", and for another tier
 * than the one that stands, that Change plan switches to it.
 */
export type DuplicateSubscriptionRefund =
  | {
      kind: 'tier';
      organizationName: string;
      /** The tier the second subscription was for. */
      tierName: string;
      /** The tier of the subscription that stands. */
      survivingTierName: string;
      /** The second subscription was for another tier than the one that stands. */
      otherTier: boolean;
    }
  | { kind: 'course'; courseTitle: string };

/**
 * What the refund email of an old subscription, ended next to the newer one
 * that stands, says (owner decision 7): "You still subscribe to …".
 */
export type SupersededSubscriptionRefund =
  | {
      kind: 'tier';
      organizationName: string;
      /** The old subscription's tier. */
      tierName: string;
    }
  | { kind: 'course'; courseTitle: string };

/**
 * A subscription the refund cancelled now; or a duplicate's refund, or an
 * ended old subscription's beside the one that stands, which end nothing of
 * the user's: they carry no user or org, so no access is ended and no
 * streaming block written for them.
 */
export type RefundCancellation =
  | {
      subscription: ChargedSubscription;
      /** The subscription as Stripe returned it from the cancel. */
      cancelled: Stripe.Subscription;
      duplicate?: never;
      superseded?: never;
    }
  | {
      duplicate: DuplicateSubscriptionRefund;
      subscription?: never;
      cancelled?: never;
      superseded?: never;
    }
  | {
      superseded: SupersededSubscriptionRefund;
      subscription?: never;
      cancelled?: never;
      duplicate?: never;
    };

/** Invoices that buy a billing period: the first one, and each renewal. */
const PERIOD_BILLING_REASONS: readonly string[] = [
  'subscription_create',
  'subscription_cycle',
];

/** A refund is full once everything charged has been refunded. */
export function isFullRefund(
  charge: Pick<RefundedCharge, 'amountCents' | 'amountRefundedCents'>
): boolean {
  return (
    charge.amountCents > 0 && charge.amountRefundedCents >= charge.amountCents
  );
}

/**
 * Cancels the subscription a fully refunded charge paid for, when that charge
 * paid for the current billing period: the newest paid invoice raised for a
 * period, so an upgrade's proration invoice, a dispute's voided ones and a
 * renewal still being retried never count as "latest". Undefined when nothing
 * is cancelled: a partial refund, a one-off purchase, another payment, or a
 * subscription that has already ended (its `customer.subscription.deleted`
 * ends it here). A duplicate's refund, any of its payments, cancels nothing
 * and asks Stripe no more: it returns what the buyer's email says. So does
 * the refund of an ended subscription while the user holds a live one for
 * the same org or course.
 */
export async function cancelForFullRefund(
  deps: SubscriptionRefundDeps,
  charge: RefundedCharge
): Promise<RefundCancellation | undefined> {
  if (!isFullRefund(charge)) return undefined;

  const paid = await invoiceForPaymentIntent(deps, charge.paymentIntentId);
  if (!paid?.stripeSubscriptionId) return undefined;
  const stripeSubscriptionId = paid.stripeSubscriptionId;
  const context = { chargeId: charge.chargeId, stripeSubscriptionId };

  const subscription = await subscriptionForStripeId(
    deps,
    stripeSubscriptionId
  );
  if (!subscription) {
    // Stripe goes on billing it: nothing here can cancel what we hold no row for.
    deps.obs.error(
      'A subscription payment was refunded in full but we hold no subscription for it; cancel it at Stripe by hand',
      { ...context, errorId: crypto.randomUUID() }
    );
    return undefined;
  }
  const duplicate = await duplicateRefund(deps, subscription);
  if (duplicate) {
    deps.obs.info(
      'Full refund of a duplicate subscription; nothing to cancel',
      {
        ...context,
        kind: subscription.kind,
      }
    );
    return { duplicate };
  }
  const superseded = await supersededRefund(deps, subscription);
  if (superseded) {
    deps.obs.info(
      'Full refund of an ended subscription beside a live one; nothing to cancel',
      { ...context, kind: subscription.kind }
    );
    return { superseded };
  }
  if (!PERIOD_BILLING_REASONS.includes(paid.billingReason ?? '')) {
    deps.obs.info(
      'Full refund of a payment that bought no period; kept running',
      {
        ...context,
        billingReason: paid.billingReason,
      }
    );
    return undefined;
  }

  const live = await deps.stripe.subscriptions.retrieve(stripeSubscriptionId);
  if (live.status === 'canceled' || live.status === 'incomplete_expired') {
    // Already ended at Stripe: its customer.subscription.deleted ends it here.
    deps.obs.info(
      'Full refund of an ended subscription; nothing to cancel',
      context
    );
    return undefined;
  }
  const periodInvoiceId = await currentPeriodInvoiceId(
    deps,
    stripeSubscriptionId
  );
  if (periodInvoiceId !== paid.invoiceId) {
    deps.obs.info("Full refund of an earlier period's payment; kept running", {
      ...context,
      refundedInvoiceId: paid.invoiceId,
      currentPeriodInvoiceId: periodInvoiceId,
    });
    return undefined;
  }

  const cancelled = await deps.stripe.subscriptions.cancel(
    stripeSubscriptionId,
    {
      prorate: false,
      cancellation_details: {
        comment: "Current period's payment refunded in full",
      },
    },
    { idempotencyKey: `${charge.chargeId}_refund_cancel` }
  );
  deps.obs.info(
    "Subscription cancelled: the current period's payment refunded in full",
    { ...context, kind: subscription.kind }
  );
  return { subscription, cancelled };
}

/**
 * What a duplicate's refund email says; undefined for a subscription that
 * duplicates none. A tier duplicate is read with the subscription it
 * duplicated, which stands, so the email can tell their tiers apart.
 */
async function duplicateRefund(
  deps: SubscriptionRefundDeps,
  subscription: ChargedSubscription
): Promise<DuplicateSubscriptionRefund | undefined> {
  if (subscription.kind === 'course') {
    const [row] = await deps.db
      .select({ courseTitle: courses.title })
      .from(courseSubscriptions)
      .innerJoin(courses, eq(courses.id, courseSubscriptions.courseId))
      .where(
        and(
          eq(courseSubscriptions.id, subscription.id),
          isNotNull(courseSubscriptions.duplicateOfCourseSubscriptionId)
        )
      )
      .limit(1);
    return row ? { kind: 'course', courseTitle: row.courseTitle } : undefined;
  }

  const surviving = alias(subscriptions, 'surviving');
  const survivingTier = alias(subscriptionTiers, 'surviving_tier');
  const [row] = await deps.db
    .select({
      organizationName: organizations.name,
      tierId: subscriptions.tierId,
      tierName: subscriptionTiers.name,
      survivingTierId: surviving.tierId,
      survivingTierName: survivingTier.name,
    })
    .from(subscriptions)
    // Only a duplicate names the subscription it duplicated.
    .innerJoin(
      surviving,
      eq(surviving.id, subscriptions.duplicateOfSubscriptionId)
    )
    .innerJoin(survivingTier, eq(survivingTier.id, surviving.tierId))
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, subscriptions.tierId)
    )
    .innerJoin(
      organizations,
      eq(organizations.id, subscriptions.organizationId)
    )
    .where(eq(subscriptions.id, subscription.id))
    .limit(1);
  if (!row) return undefined;
  return {
    kind: 'tier',
    organizationName: row.organizationName,
    tierName: row.tierName,
    survivingTierName: row.survivingTierName,
    otherTier: row.tierId !== row.survivingTierId,
  };
}

/**
 * What the refund email of an ended subscription says while the user holds
 * a live one for the same org (course plan: the same course); undefined
 * otherwise. The payment that revived it next to the newer one was refunded
 * when it was ended (owner decision 7).
 */
async function supersededRefund(
  deps: SubscriptionRefundDeps,
  subscription: ChargedSubscription
): Promise<SupersededSubscriptionRefund | undefined> {
  const liveStatuses = [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES];
  if (subscription.kind === 'course') {
    const live = alias(courseSubscriptions, 'live');
    const [row] = await deps.db
      .select({ courseTitle: courses.title })
      .from(courseSubscriptions)
      // The live plan subscription the user holds for the course now.
      .innerJoin(
        live,
        and(
          eq(live.userId, courseSubscriptions.userId),
          eq(live.courseId, courseSubscriptions.courseId),
          ne(live.id, courseSubscriptions.id),
          inArray(live.status, liveStatuses)
        )
      )
      .innerJoin(courses, eq(courses.id, courseSubscriptions.courseId))
      .where(
        and(
          eq(courseSubscriptions.id, subscription.id),
          isNotNull(courseSubscriptions.endedAt)
        )
      )
      .limit(1);
    return row ? { kind: 'course', courseTitle: row.courseTitle } : undefined;
  }

  const live = alias(subscriptions, 'live');
  const [row] = await deps.db
    .select({
      organizationName: organizations.name,
      tierName: subscriptionTiers.name,
    })
    .from(subscriptions)
    // The live subscription the user holds for the org now.
    .innerJoin(
      live,
      and(
        eq(live.userId, subscriptions.userId),
        eq(live.organizationId, subscriptions.organizationId),
        ne(live.id, subscriptions.id),
        inArray(live.status, liveStatuses)
      )
    )
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, subscriptions.tierId)
    )
    .innerJoin(
      organizations,
      eq(organizations.id, subscriptions.organizationId)
    )
    .where(
      and(
        eq(subscriptions.id, subscription.id),
        isNotNull(subscriptions.endedAt)
      )
    )
    .limit(1);
  return row
    ? {
        kind: 'tier',
        organizationName: row.organizationName,
        tierName: row.tierName,
      }
    : undefined;
}

/** The newest paid invoice that bought a billing period, newest first. */
async function currentPeriodInvoiceId(
  deps: SubscriptionRefundDeps,
  stripeSubscriptionId: string
): Promise<string | null> {
  const page = await deps.stripe.invoices.list({
    subscription: stripeSubscriptionId,
    status: 'paid',
    limit: 20,
  });
  const current = page.data.find((invoice) =>
    PERIOD_BILLING_REASONS.includes(invoice.billing_reason ?? '')
  );
  return current?.id ?? null;
}
