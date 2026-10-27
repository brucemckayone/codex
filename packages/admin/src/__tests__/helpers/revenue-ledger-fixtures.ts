/**
 * Ledger fixtures for the Studio revenue reads (Codex-2hxff.20, zsh2p, .75).
 *
 * The revenue block and Revenue by creator read the payouts ledger, not the
 * purchase row's amounts, so a test of them writes what a sale's webhook
 * writes: one row per slice per Stripe charge, plus any refunds and disputes.
 *
 * Every row is token-tagged and `cleanup()` deletes it. The local test
 * database is shared with other sessions, and a pending or failed payout left
 * behind would be met by the global drains and the clawback sweeps.
 */

import { randomUUID } from 'node:crypto';
import {
  content as contentTable,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  disputes,
  mediaItems,
  payoutReversals,
  payouts,
  purchases,
  refunds,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  takeFirst,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';

export const DAY_MS = 24 * 60 * 60 * 1000;

type PayoutType =
  | 'platform_fee'
  | 'organization_fee'
  | 'creator_payout'
  | 'creator_payout_to_owner';

export interface SliceInput {
  type: PayoutType;
  /** The payee; `null` only for the platform fee. */
  userId: string | null;
  cents: number;
  /** `paid` by default. A pending or failed row is owed, not sent. */
  status?: 'paid' | 'pending' | 'failed';
}

export type ChargeSource =
  | { purchaseId: string }
  | { subscriptionId: string }
  | { courseSubscriptionId: string }
  /** A pre-ledger row with no source reference: kind from `source_type`. */
  | { legacy: 'purchase' | 'subscription' };

export function ledgerFixtures(db: Database) {
  const token = randomUUID().slice(0, 8);
  const chargeIds: string[] = [];
  const payoutIds: string[] = [];
  const purchaseIds: string[] = [];
  let sequence = 0;

  /** A unique, token-tagged Stripe charge id. */
  function chargeId(): string {
    sequence += 1;
    const id = `ch_admrev_${token}_${sequence}`;
    chargeIds.push(id);
    return id;
  }

  /** A published video by `creatorId` in `orgId`. */
  async function content(orgId: string, creatorId: string): Promise<string> {
    const media = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning()
    );
    const row = takeFirst(
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: orgId,
          mediaItemId: media.id,
          title: `Ledger content ${token}`,
          slug: createUniqueSlug(`admrev-${token}`),
          contentType: 'video',
          status: 'published',
          priceCents: 1000,
        })
        .returning()
    );
    return row.id;
  }

  async function course(orgId: string, creatorId: string): Promise<string> {
    const row = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug(`admrev-course-${token}`),
          title: `Ledger course ${token}`,
          status: 'published',
          priceCents: 5000,
        })
        .returning({ id: courses.id })
    );
    return row.id;
  }

  /**
   * A completed purchase of content or a course. Its own amount columns are
   * not what the revenue read counts; the ledger rows are.
   */
  async function purchase(opts: {
    orgId: string;
    customerId: string;
    item: { contentId: string } | { courseId: string };
    amountCents: number;
    purchasedAt?: Date;
    status?: string;
  }): Promise<string> {
    const row = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: opts.customerId,
          ...opts.item,
          organizationId: opts.orgId,
          amountPaidCents: opts.amountCents,
          currency: 'gbp',
          // check_revenue_split_equals_total
          platformFeeCents: 0,
          organizationFeeCents: 0,
          creatorPayoutCents: opts.amountCents,
          stripePaymentIntentId: `pi_admrev_${token}_${randomUUID()}`,
          status: opts.status ?? 'completed',
          purchasedAt: opts.purchasedAt ?? new Date(),
        })
        .returning({ id: purchases.id })
    );
    purchaseIds.push(row.id);
    return row.id;
  }

  /** An organisation subscription, for an invoice's slices to point at. */
  async function subscription(orgId: string, userId: string): Promise<string> {
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning()
    );
    const sub = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(userId, orgId, tier.id))
        .returning()
    );
    return sub.id;
  }

  /** A course plan subscription, for a course-plan invoice's slices. */
  async function courseSubscription(
    courseId: string,
    userId: string
  ): Promise<string> {
    const plan = takeFirst(
      await db
        .insert(courseSubscriptionPlans)
        .values({ courseId, priceMonthly: 500, priceAnnual: 5000 })
        .returning({ id: courseSubscriptionPlans.id })
    );
    const now = new Date();
    const sub = takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId,
          courseId,
          planId: plan.id,
          stripeSubscriptionId: `sub_admrev_${token}_${randomUUID()}`,
          stripeCustomerId: `cus_admrev_${token}_${randomUUID()}`,
          status: 'active',
          billingInterval: 'month',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * DAY_MS),
        })
        .returning({ id: courseSubscriptions.id })
    );
    return sub.id;
  }

  /**
   * One Stripe charge's slices, as the sale's webhook writes them: every row
   * carries the charge id, the organisation and the one source.
   */
  async function charge(opts: {
    orgId: string;
    source: ChargeSource;
    slices: SliceInput[];
    createdAt?: Date;
    /** Reuse an existing charge (a later replay adding a missing slice). */
    chargeId?: string;
  }): Promise<{ chargeId: string; payoutIds: string[] }> {
    const id = opts.chargeId ?? chargeId();
    const createdAt = opts.createdAt ?? new Date();
    const source = opts.source;
    const sourceColumns =
      'purchaseId' in source
        ? { purchaseId: source.purchaseId, sourceType: 'purchase' }
        : 'subscriptionId' in source
          ? {
              subscriptionId: source.subscriptionId,
              sourceType: 'subscription',
            }
          : 'courseSubscriptionId' in source
            ? {
                courseSubscriptionId: source.courseSubscriptionId,
                sourceType: 'subscription',
              }
            : { sourceType: source.legacy };
    const rows = await db
      .insert(payouts)
      .values(
        opts.slices.map((slice) => {
          const status = slice.status ?? 'paid';
          return {
            organizationId: opts.orgId,
            userId: slice.userId,
            ...sourceColumns,
            stripeChargeId: id,
            transferGroup: `tg_${id}`,
            amountCents: slice.cents,
            payoutType: slice.type,
            status,
            reason: status === 'paid' ? null : 'connect_not_ready',
            resolvedAt: status === 'paid' ? createdAt : null,
            // A failed row waits for support, so no drain retries it while
            // the test runs (Codex-2hxff.48).
            needsReviewAt: status === 'failed' ? createdAt : null,
            createdAt,
          };
        })
      )
      .returning({ id: payouts.id });
    const ids = rows.map((row) => row.id);
    payoutIds.push(...ids);
    return { chargeId: id, payoutIds: ids };
  }

  async function refund(opts: {
    chargeId: string;
    cents: number;
    status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
    purchaseId?: string;
  }): Promise<void> {
    await db.insert(refunds).values({
      stripeRefundId: `re_admrev_${token}_${randomUUID()}`,
      stripeChargeId: opts.chargeId,
      purchaseId: opts.purchaseId ?? null,
      amountCents: opts.cents,
      currency: 'gbp',
      status: opts.status,
      stripeCreatedAt: new Date(),
    });
  }

  async function dispute(opts: {
    chargeId: string;
    cents: number;
    status: 'needs_response' | 'under_review' | 'won' | 'lost';
  }): Promise<void> {
    const final = opts.status === 'won' || opts.status === 'lost';
    await db.insert(disputes).values({
      stripeDisputeId: `dp_admrev_${token}_${randomUUID()}`,
      stripeChargeId: opts.chargeId,
      amountCents: opts.cents,
      currency: 'gbp',
      status: opts.status,
      stripeCreatedAt: new Date(),
      // Already acted on, so no sweep takes its outcome again.
      outcomeAppliedAt: final ? new Date() : null,
    });
  }

  /** What a partial refund already took off an unpaid slice. */
  async function pendingReduction(
    payoutId: string,
    cents: number
  ): Promise<void> {
    await db.insert(payoutReversals).values({
      payoutId,
      causeType: 'refund',
      causeId: `re_admrev_${token}_${randomUUID()}`,
      amountCents: cents,
      kind: 'pending_reduction',
      status: 'done',
      resolvedAt: new Date(),
    });
  }

  /** Deletes every ledger row, refund, dispute and purchase made here. */
  async function cleanup(): Promise<void> {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
    }
    if (chargeIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeChargeId, chargeIds));
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeChargeId, chargeIds));
    }
    if (payoutIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
  }

  return {
    token,
    chargeId,
    content,
    course,
    purchase,
    subscription,
    courseSubscription,
    charge,
    refund,
    dispute,
    pendingReduction,
    cleanup,
  };
}

/** A UTC calendar day as `YYYY-MM-DD`. */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
