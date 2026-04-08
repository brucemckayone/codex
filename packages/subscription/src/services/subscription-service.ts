/**
 * Subscription Service
 *
 * Manages subscription lifecycle: checkout, renewals, tier changes, cancellation.
 *
 * Key Responsibilities:
 * - Create Stripe Checkout sessions in subscription mode
 * - Handle webhook events (created, updated, deleted, invoice)
 * - Execute multi-party revenue transfers (platform + org + creators)
 * - Manage tier changes (upgrade/downgrade with proration)
 * - Cancel and reactivate subscriptions
 * - Query subscriptions and subscriber stats
 *
 * Revenue Split (Phase 1 defaults):
 * - Platform: 10% of gross
 * - Organization: 15% of post-platform amount
 * - Creator pool: 85% of post-platform amount (divided by fixed % per creator)
 *
 * Transfer Flow:
 * 1. invoice.payment_succeeded fires
 * 2. Calculate split via calculateRevenueSplit()
 * 3. stripe.transfers.create() to org connected account
 * 4. stripe.transfers.create() to each creator connected account
 * 5. Platform retains its fee in balance
 *
 * Idempotency:
 * - stripeSubscriptionId unique constraint prevents duplicate creation
 * - Webhook handlers check-before-insert (same pattern as PurchaseService)
 */

import {
  BILLING_INTERVAL,
  CURRENCY,
  FEES,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import { isUniqueViolation } from '@codex/database';
import {
  creatorOrganizationAgreements,
  pendingPayouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadySubscribedError,
  ConnectAccountNotReadyError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  TierNotFoundError,
} from '../errors';
import { calculateRevenueSplit } from './revenue-split';

type Subscription = typeof subscriptions.$inferSelect;
type SubscriptionTier = typeof subscriptionTiers.$inferSelect;

interface SubscriptionWithTier extends Subscription {
  tier: SubscriptionTier;
}

interface SubscriptionWithOrg extends Subscription {
  tier: SubscriptionTier;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
}

interface SubscriptionStats {
  totalSubscribers: number;
  activeSubscribers: number;
  mrrCents: number;
  tierBreakdown: Array<{
    tierId: string;
    tierName: string;
    subscriberCount: number;
    mrrCents: number;
  }>;
}

export class SubscriptionService extends BaseService {
  private readonly stripe: Stripe;

  constructor(config: ServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
  }

  // ─── Checkout ──────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout session in subscription mode.
   * Validates tier exists, is active, Connect account is ready, and user isn't already subscribed.
   */
  async createCheckoutSession(
    userId: string,
    orgId: string,
    tierId: string,
    billingInterval: 'month' | 'year',
    successUrl: string,
    cancelUrl: string
  ): Promise<{ sessionUrl: string; sessionId: string }> {
    try {
      const [tier] = await this.db
        .select()
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.id, tierId),
            eq(subscriptionTiers.organizationId, orgId),
            eq(subscriptionTiers.isActive, true),
            isNull(subscriptionTiers.deletedAt)
          )
        )
        .limit(1);

      if (!tier) {
        throw new TierNotFoundError(tierId, { organizationId: orgId });
      }

      // Check user doesn't already have an active subscription to this org
      const [existing] = await this.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.organizationId, orgId),
            inArray(subscriptions.status, [
              SUBSCRIPTION_STATUS.ACTIVE,
              SUBSCRIPTION_STATUS.CANCELLING,
              SUBSCRIPTION_STATUS.PAST_DUE,
            ])
          )
        )
        .limit(1);

      if (existing) {
        throw new AlreadySubscribedError(userId, orgId);
      }

      // Validate Connect account
      const [connectAccount] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.organizationId, orgId))
        .limit(1);

      if (!connectAccount?.chargesEnabled || !connectAccount?.payoutsEnabled) {
        throw new ConnectAccountNotReadyError(orgId);
      }

      // Get the correct Stripe Price ID
      const stripePriceId =
        billingInterval === BILLING_INTERVAL.MONTH
          ? tier.stripePriceMonthlyId
          : tier.stripePriceAnnualId;

      if (!stripePriceId) {
        throw new SubscriptionCheckoutError(
          'Stripe Price not configured for this tier and interval',
          { tierId, billingInterval }
        );
      }

      // Create Stripe Checkout Session
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          codex_user_id: userId,
          codex_organization_id: orgId,
          codex_tier_id: tierId,
          codex_billing_interval: billingInterval,
        },
        subscription_data: {
          metadata: {
            codex_user_id: userId,
            codex_organization_id: orgId,
            codex_tier_id: tierId,
          },
        },
      });

      if (!session.url) {
        throw new SubscriptionCheckoutError(
          'Failed to create checkout session URL'
        );
      }

      this.obs.info('Subscription checkout session created', {
        sessionId: session.id,
        organizationId: orgId,
        tierId,
        billingInterval,
      });

      return { sessionUrl: session.url, sessionId: session.id };
    } catch (error) {
      this.handleError(error, 'createCheckoutSession');
    }
  }

  // ─── Webhook Handlers ──────────────────────────────────────────────────────

  /**
   * Handle checkout.session.completed for subscription mode.
   * Creates the subscription record in our database.
   * Idempotent via stripeSubscriptionId unique constraint.
   */
  async handleSubscriptionCreated(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata;

    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;
    const tierId = metadata.codex_tier_id;

    if (!userId || !orgId || !tierId) {
      this.obs.warn('Subscription webhook missing metadata', {
        stripeSubscriptionId: stripeSubId,
        metadata,
      });
      return;
    }

    // Get amount from the subscription's latest invoice
    const amountCents =
      stripeSubscription.items.data[0]?.price?.unit_amount ?? 0;
    const billingInterval =
      stripeSubscription.items.data[0]?.price?.recurring?.interval === 'year'
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;

    // Calculate revenue split
    const split = calculateRevenueSplit(
      amountCents,
      FEES.PLATFORM_PERCENT,
      FEES.SUBSCRIPTION_ORG_PERCENT
    );

    // In Stripe v19+, period dates are on the subscription item, not the subscription
    const firstItem = stripeSubscription.items.data[0];
    const periodStart = firstItem?.current_period_start ?? 0;
    const periodEnd = firstItem?.current_period_end ?? 0;

    // Insert subscription record — rely on unique constraint for idempotency
    // (eliminates TOCTOU race between SELECT check and INSERT)
    try {
      await this.db.insert(subscriptions).values({
        userId,
        organizationId: orgId,
        tierId,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId:
          typeof stripeSubscription.customer === 'string'
            ? stripeSubscription.customer
            : stripeSubscription.customer.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        billingInterval,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        amountCents,
        platformFeeCents: split.platformFeeCents,
        organizationFeeCents: split.organizationFeeCents,
        creatorPayoutCents: split.creatorPayoutCents,
      });

      this.obs.info('Subscription created from webhook', {
        stripeSubscriptionId: stripeSubId,
        organizationId: orgId,
        tierId,
        amountCents,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.obs.info('Subscription already recorded (idempotent)', {
          stripeSubscriptionId: stripeSubId,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Handle invoice.payment_succeeded for subscription renewals.
   * Extends subscription period and creates revenue transfers.
   */
  async handleInvoicePaymentSucceeded(
    stripeInvoice: Stripe.Invoice
  ): Promise<void> {
    // Stripe v19+: subscription ID is in parent.subscription_details
    const subDetails = stripeInvoice.parent?.subscription_details;
    const stripeSubId =
      typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : (subDetails?.subscription?.id ?? null);
    if (!stripeSubId) return;

    // Get charge ID from the invoice's payment intent
    // In v19+, payments are in invoice.payments.data[]
    const payment = stripeInvoice.payments?.data?.[0];
    const chargeId =
      typeof payment?.payment?.charge === 'string'
        ? payment.payment.charge
        : null;
    // Fall back to payment_intent if no direct charge
    const paymentIntentId =
      typeof payment?.payment?.payment_intent === 'string'
        ? payment.payment.payment_intent
        : null;

    if (!chargeId && !paymentIntentId) {
      this.obs.warn(
        'Invoice has no charge or payment intent, skipping transfers',
        {
          invoiceId: stripeInvoice.id,
        }
      );
      return;
    }

    // For transfers, we need the charge ID. If we only have PI, retrieve it.
    let sourceTransaction = chargeId;
    if (!sourceTransaction && paymentIntentId) {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      sourceTransaction =
        typeof pi.latest_charge === 'string' ? pi.latest_charge : null;
    }

    if (!sourceTransaction) {
      this.obs.warn('Could not resolve charge for transfers', {
        invoiceId: stripeInvoice.id,
      });
      return;
    }

    // Find our subscription record
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);

    if (!sub) {
      this.obs.warn('Invoice for unknown subscription', {
        stripeSubscriptionId: stripeSubId,
      });
      return;
    }

    // Fetch the Stripe subscription for period dates (v19+: on items)
    const stripeSub = await this.stripe.subscriptions.retrieve(stripeSubId);
    const subItem = stripeSub.items.data[0];
    const periodStart = subItem?.current_period_start ?? 0;
    const periodEnd = subItem?.current_period_end ?? 0;

    // Update period dates and recalculate split
    const amountCents = stripeInvoice.amount_paid;
    const split = calculateRevenueSplit(
      amountCents,
      FEES.PLATFORM_PERCENT,
      FEES.SUBSCRIPTION_ORG_PERCENT
    );

    await this.db
      .update(subscriptions)
      .set({
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        status: SUBSCRIPTION_STATUS.ACTIVE,
        amountCents,
        platformFeeCents: split.platformFeeCents,
        organizationFeeCents: split.organizationFeeCents,
        creatorPayoutCents: split.creatorPayoutCents,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    // Execute revenue transfers
    await this.executeTransfers(
      sub.id,
      sub.organizationId,
      sourceTransaction,
      split.organizationFeeCents,
      split.creatorPayoutCents
    );

    this.obs.info('Invoice payment processed', {
      subscriptionId: sub.id,
      invoiceId: stripeInvoice.id,
      amountCents,
    });
  }

  /**
   * Handle customer.subscription.updated — tier changes, status changes.
   */
  async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const stripeSubId = stripeSubscription.id;

    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);

    if (!sub) return;

    // Map Stripe status to our status
    let status = sub.status;
    if (stripeSubscription.status === 'active') {
      status = stripeSubscription.cancel_at_period_end
        ? SUBSCRIPTION_STATUS.CANCELLING
        : SUBSCRIPTION_STATUS.ACTIVE;
    } else if (stripeSubscription.status === 'past_due') {
      status = SUBSCRIPTION_STATUS.PAST_DUE;
    } else if (stripeSubscription.status === 'canceled') {
      status = SUBSCRIPTION_STATUS.CANCELLED;
    } else if (stripeSubscription.status === 'incomplete') {
      status = SUBSCRIPTION_STATUS.INCOMPLETE;
    }

    // Detect tier change via metadata
    const newTierId = stripeSubscription.metadata.codex_tier_id;

    // v19+: period dates on subscription items
    const updatedItem = stripeSubscription.items.data[0];
    const updatedPeriodStart = updatedItem?.current_period_start ?? 0;
    const updatedPeriodEnd = updatedItem?.current_period_end ?? 0;

    await this.db
      .update(subscriptions)
      .set({
        status,
        ...(newTierId && newTierId !== sub.tierId && { tierId: newTierId }),
        currentPeriodStart: new Date(updatedPeriodStart * 1000),
        currentPeriodEnd: new Date(updatedPeriodEnd * 1000),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    this.obs.info('Subscription updated from webhook', {
      subscriptionId: sub.id,
      status,
    });
  }

  /**
   * Handle customer.subscription.deleted — subscription cancelled/expired.
   */
  async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const stripeSubId = stripeSubscription.id;

    await this.db
      .update(subscriptions)
      .set({
        status: SUBSCRIPTION_STATUS.CANCELLED,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    this.obs.info('Subscription deleted/cancelled from webhook', {
      stripeSubscriptionId: stripeSubId,
    });
  }

  // ─── Subscription Management ───────────────────────────────────────────────

  /**
   * Change subscription tier (upgrade or downgrade).
   * Uses Stripe proration to handle billing adjustments.
   */
  async changeTier(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year'
  ): Promise<void> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

      // Validate new tier
      const [newTier] = await this.db
        .select()
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.id, newTierId),
            eq(subscriptionTiers.organizationId, orgId),
            eq(subscriptionTiers.isActive, true),
            isNull(subscriptionTiers.deletedAt)
          )
        )
        .limit(1);

      if (!newTier) {
        throw new TierNotFoundError(newTierId, { organizationId: orgId });
      }

      const newPriceId =
        billingInterval === BILLING_INTERVAL.MONTH
          ? newTier.stripePriceMonthlyId
          : newTier.stripePriceAnnualId;

      if (!newPriceId) {
        throw new SubscriptionCheckoutError('Price not configured for tier', {
          tierId: newTierId,
          billingInterval,
        });
      }

      // Update Stripe subscription with new price
      const stripeSub = await this.stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId
      );
      const itemId = stripeSub.items.data[0]?.id;

      if (!itemId) {
        throw new SubscriptionCheckoutError('No subscription item found');
      }

      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          codex_tier_id: newTierId,
          codex_user_id: userId,
          codex_organization_id: orgId,
        },
      });

      // Update local record
      await this.db
        .update(subscriptions)
        .set({
          tierId: newTierId,
          billingInterval,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription tier changed', {
        subscriptionId: sub.id,
        oldTierId: sub.tierId,
        newTierId,
        billingInterval,
      });
    } catch (error) {
      this.handleError(error, 'changeTier');
    }
  }

  /**
   * Cancel subscription at period end.
   * Access retained until currentPeriodEnd.
   */
  async cancelSubscription(
    userId: string,
    orgId: string,
    reason?: string
  ): Promise<void> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await this.db
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLING,
          cancelReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription cancelled at period end', {
        subscriptionId: sub.id,
        organizationId: orgId,
      });
    } catch (error) {
      this.handleError(error, 'cancelSubscription');
    }
  }

  /**
   * Reactivate a subscription that was set to cancel_at_period_end.
   * Only works if still within the active period.
   */
  async reactivateSubscription(userId: string, orgId: string): Promise<void> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

      if (sub.status !== SUBSCRIPTION_STATUS.CANCELLING) {
        throw new SubscriptionCheckoutError(
          'Can only reactivate a subscription that is set to cancel'
        );
      }

      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      await this.db
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.ACTIVE,
          cancelReason: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription reactivated', {
        subscriptionId: sub.id,
        organizationId: orgId,
      });
    } catch (error) {
      this.handleError(error, 'reactivateSubscription');
    }
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get a user's current subscription for an org (with tier details).
   */
  async getSubscription(
    userId: string,
    orgId: string
  ): Promise<SubscriptionWithTier | null> {
    const result = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.organizationId, orgId),
        inArray(subscriptions.status, [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.CANCELLING,
          SUBSCRIPTION_STATUS.PAST_DUE,
        ])
      ),
      with: { tier: true },
    });

    return (result as SubscriptionWithTier) ?? null;
  }

  /**
   * Get all of a user's active subscriptions across orgs.
   */
  async getUserSubscriptions(userId: string): Promise<SubscriptionWithOrg[]> {
    const results = await this.db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.CANCELLING,
          SUBSCRIPTION_STATUS.PAST_DUE,
        ])
      ),
      with: {
        tier: true,
        organization: true,
      },
      orderBy: [desc(subscriptions.createdAt)],
    });

    return results as SubscriptionWithOrg[];
  }

  /**
   * List subscribers for an org (admin view). Paginated with filters.
   */
  async listSubscribers(
    orgId: string,
    options: { page: number; limit: number; tierId?: string; status?: string }
  ): Promise<PaginatedListResponse<Subscription>> {
    const { page, limit, tierId, status } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(subscriptions.organizationId, orgId)];
    if (tierId) conditions.push(eq(subscriptions.tierId, tierId));
    if (status) conditions.push(eq(subscriptions.status, status));

    const [items, [totalResult]] = await Promise.all([
      this.db
        .select()
        .from(subscriptions)
        .where(and(...conditions))
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(and(...conditions)),
    ]);

    const total = totalResult?.count ?? 0;

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get subscription stats for an org dashboard.
   */
  async getSubscriptionStats(orgId: string): Promise<SubscriptionStats> {
    // Total and active counts
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} IN ('active', 'cancelling'))::int`,
      })
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId));

    // Per-tier breakdown
    const tierBreakdown = await this.db
      .select({
        tierId: subscriptions.tierId,
        tierName: subscriptionTiers.name,
        subscriberCount: sql<number>`count(*)::int`,
        mrrCents: sql<number>`sum(
          CASE
            WHEN ${subscriptions.billingInterval} = 'month' THEN ${subscriptions.amountCents}
            WHEN ${subscriptions.billingInterval} = 'year' THEN ${subscriptions.amountCents} / 12
            ELSE 0
          END
        )::int`,
      })
      .from(subscriptions)
      .innerJoin(
        subscriptionTiers,
        eq(subscriptions.tierId, subscriptionTiers.id)
      )
      .where(
        and(
          eq(subscriptions.organizationId, orgId),
          inArray(subscriptions.status, [
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.CANCELLING,
          ])
        )
      )
      .groupBy(subscriptions.tierId, subscriptionTiers.name);

    const mrrCents = tierBreakdown.reduce(
      (sum, t) => sum + (t.mrrCents ?? 0),
      0
    );

    return {
      totalSubscribers: totals?.total ?? 0,
      activeSubscribers: totals?.active ?? 0,
      mrrCents,
      tierBreakdown: tierBreakdown.map((t) => ({
        tierId: t.tierId,
        tierName: t.tierName,
        subscriberCount: t.subscriberCount,
        mrrCents: t.mrrCents ?? 0,
      })),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async getSubscriptionOrThrow(
    userId: string,
    orgId: string
  ): Promise<Subscription> {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.organizationId, orgId),
          inArray(subscriptions.status, [
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.CANCELLING,
            SUBSCRIPTION_STATUS.PAST_DUE,
          ])
        )
      )
      .limit(1);

    if (!sub) {
      throw new SubscriptionNotFoundError({ userId, organizationId: orgId });
    }

    return sub;
  }

  /**
   * Execute revenue transfers to org and creator(s) after invoice payment.
   * Uses source_transaction to link transfers to the charge.
   * Creators without active Connect accounts have their share accumulated.
   */
  private async executeTransfers(
    subscriptionId: string,
    orgId: string,
    chargeId: string,
    orgFeeCents: number,
    creatorPayoutCents: number
  ): Promise<void> {
    const transferGroup = `sub_${subscriptionId}`;

    // Get org's Connect account
    const [orgConnect] = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.organizationId, orgId))
      .limit(1);

    // Transfer org fee
    if (orgConnect?.chargesEnabled && orgFeeCents > 0) {
      try {
        await this.stripe.transfers.create(
          {
            amount: orgFeeCents,
            currency: CURRENCY.GBP,
            destination: orgConnect.stripeAccountId,
            source_transaction: chargeId,
            transfer_group: transferGroup,
            metadata: {
              subscription_id: subscriptionId,
              type: 'organization_fee',
            },
          },
          { idempotencyKey: `${chargeId}_org_fee` }
        );
      } catch (transferError) {
        this.obs.error('Org transfer failed, accumulating as pending payout', {
          subscriptionId,
          organizationId: orgId,
          amountCents: orgFeeCents,
          error: (transferError as Error).message,
        });
        try {
          await this.db.insert(pendingPayouts).values({
            userId: orgConnect.userId,
            organizationId: orgId,
            subscriptionId,
            amountCents: orgFeeCents,
            reason: 'transfer_failed',
          });
        } catch (insertError) {
          this.obs.error('Failed to record pending payout for org transfer', {
            subscriptionId,
            organizationId: orgId,
            amountCents: orgFeeCents,
            error: (insertError as Error).message,
          });
        }
      }
    } else if (orgFeeCents > 0) {
      // Accumulate if Connect not ready
      try {
        await this.db.insert(pendingPayouts).values({
          userId: orgConnect?.userId ?? '',
          organizationId: orgId,
          subscriptionId,
          amountCents: orgFeeCents,
          reason: 'connect_not_ready',
        });
      } catch (insertError) {
        this.obs.error('Failed to record pending payout (Connect not ready)', {
          subscriptionId,
          organizationId: orgId,
          amountCents: orgFeeCents,
          error: (insertError as Error).message,
        });
      }
    }

    // Get all creators in the org with their revenue share agreements
    const creatorAgreements = await this.db
      .select({
        creatorId: creatorOrganizationAgreements.creatorId,
        sharePercent: creatorOrganizationAgreements.organizationFeePercentage,
      })
      .from(creatorOrganizationAgreements)
      .where(
        and(
          eq(creatorOrganizationAgreements.organizationId, orgId),
          sql`${creatorOrganizationAgreements.effectiveUntil} IS NULL OR ${creatorOrganizationAgreements.effectiveUntil} > now()`
        )
      );

    if (creatorAgreements.length === 0) {
      // No creator agreements — org owner gets the full creator pool
      // (Already handled by org transfer above or accumulated)
      // Transfer remaining to the org Connect account as creator payout
      if (orgConnect?.chargesEnabled && creatorPayoutCents > 0) {
        try {
          await this.stripe.transfers.create(
            {
              amount: creatorPayoutCents,
              currency: CURRENCY.GBP,
              destination: orgConnect.stripeAccountId,
              source_transaction: chargeId,
              transfer_group: transferGroup,
              metadata: {
                subscription_id: subscriptionId,
                type: 'creator_payout_to_owner',
              },
            },
            { idempotencyKey: `${chargeId}_creator_pool_owner` }
          );
        } catch (transferError) {
          this.obs.error(
            'Creator pool transfer to owner failed, accumulating',
            {
              subscriptionId,
              organizationId: orgId,
              amountCents: creatorPayoutCents,
              error: (transferError as Error).message,
            }
          );
          await this.db.insert(pendingPayouts).values({
            userId: orgConnect.userId,
            organizationId: orgId,
            subscriptionId,
            amountCents: creatorPayoutCents,
            reason: 'transfer_failed',
          });
        }
      }
      return;
    }

    // Distribute creator pool by fixed percentages
    // Note: creatorOrganizationAgreements.organizationFeePercentage is repurposed
    // as the creator's share percentage in basis points for subscription context
    const totalShareBps = creatorAgreements.reduce(
      (sum, a) => sum + a.sharePercent,
      0
    );

    // Batch-fetch all creator Connect accounts to avoid N+1 queries
    const creatorIds = creatorAgreements.map((a) => a.creatorId);
    const creatorConnects = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(
        and(
          inArray(stripeConnectAccounts.userId, creatorIds),
          eq(stripeConnectAccounts.organizationId, orgId)
        )
      );
    const connectByCreator = new Map(creatorConnects.map((c) => [c.userId, c]));

    for (const agreement of creatorAgreements) {
      const creatorAmount = Math.floor(
        (creatorPayoutCents * agreement.sharePercent) / totalShareBps
      );

      if (creatorAmount <= 0) continue;

      const creatorConnect = connectByCreator.get(agreement.creatorId);

      if (creatorConnect?.chargesEnabled) {
        try {
          await this.stripe.transfers.create(
            {
              amount: creatorAmount,
              currency: CURRENCY.GBP,
              destination: creatorConnect.stripeAccountId,
              source_transaction: chargeId,
              transfer_group: transferGroup,
              metadata: {
                subscription_id: subscriptionId,
                creator_id: agreement.creatorId,
                type: 'creator_payout',
              },
            },
            { idempotencyKey: `${chargeId}_creator_${agreement.creatorId}` }
          );
        } catch (transferError) {
          this.obs.error('Creator transfer failed, accumulating as pending', {
            subscriptionId,
            creatorId: agreement.creatorId,
            amountCents: creatorAmount,
            error: (transferError as Error).message,
          });
          await this.db.insert(pendingPayouts).values({
            userId: agreement.creatorId,
            organizationId: orgId,
            subscriptionId,
            amountCents: creatorAmount,
            reason: 'transfer_failed',
          });
        }
      } else {
        // Accumulate pending payout
        await this.db.insert(pendingPayouts).values({
          userId: agreement.creatorId,
          organizationId: orgId,
          subscriptionId,
          amountCents: creatorAmount,
          reason: creatorConnect ? 'connect_restricted' : 'connect_not_ready',
        });

        this.obs.warn('Creator payout accumulated (Connect not ready)', {
          creatorId: agreement.creatorId,
          amountCents: creatorAmount,
          subscriptionId,
        });
      }
    }
  }
}
