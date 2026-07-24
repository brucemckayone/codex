/**
 * CourseSubscriptionService (Codex-2pryk · WP-6 · SPEC §7 path 3).
 *
 * A course-SPECIFIC recurring subscription — "a low-friction entry into one
 * course" (SPEC §7). Decision D-C (HARDENING §H3): each course gets a SEPARATE
 * Stripe Product per plan (reusing the `TierService` product/price-sync shape),
 * recorded on `course_subscription_plans`, with `course_subscriptions.planId`
 * FK. Distinct from the ORG tier subscription (`SubscriptionService`): a course
 * sub is not an org `subscriptions` row and never grants org membership.
 *
 * Lifecycle (all events flow through the SAME `/webhooks/stripe/subscription`
 * endpoint as org subs — the handler discriminates by the Stripe subscription's
 * `type: 'course_subscription'` metadata and routes here):
 *   - checkout.session.completed → {@link handleCourseSubscriptionCreated}
 *   - invoice.payment_succeeded  → {@link handleCourseInvoicePaymentSucceeded}
 *   - customer.subscription.updated → {@link handleCourseSubscriptionUpdated}
 *   - customer.subscription.deleted → {@link handleCourseSubscriptionDeleted}
 *
 * Entitlement seam: activation writes a `course_subscription` entitlement (the
 * READ target of the WP-2 resolver) with `expiresAt = currentPeriodEnd`, so a
 * missed renewal fails closed even before a delete webhook lands; renewals bump
 * it, a delete/unpaid revokes it. Auto-enrollment (D-G) rides along.
 *
 * Payouts: recurring-invoice revenue REUSES the h69cg payout LEDGER (`payouts`)
 * — Option B platform-charge fan-out (creator + org secondary transfers linked
 * by `source_transaction`), attributed via the new `payouts.courseSubscriptionId`
 * FK (§H3). Idempotent by Stripe charge id + deterministic transfer idempotency
 * keys, mirroring `PurchaseService.writePurchasePayouts`.
 */

import { BILLING_INTERVAL, CONTENT_STATUS, CURRENCY } from '@codex/constants';
import { getConstraintName, isUniqueViolation } from '@codex/database';
import {
  type CourseSubscription,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  payouts,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  applyMinPlatformFeeFloor,
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  type FeeConfigService,
  findActiveCreatorAgreementShare,
  refreshCourseSubscriptionEntitlementExpiry,
  resolvePrimaryConnect,
  revokeCourseSubscriptionEntitlement,
  withStaleCustomerRecovery,
  writeCourseSubscriptionEntitlement,
} from '@codex/purchase';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { CreateCourseSubscriptionCheckoutInput } from '@codex/validation';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyCourseSubscribedError,
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
  CourseSubscriptionPlanNotFoundError,
  SubscriptionCheckoutError,
} from '../errors';
import { resolveStatus } from './stripe-status-mapper';

/** Marks a Stripe subscription as a course sub (vs. an org tier sub). */
export const COURSE_SUBSCRIPTION_METADATA_TYPE = 'course_subscription';

/** Statuses under which a course subscription's stored grant stays live. */
const GRANTING_STATUSES = ['active', 'cancelling', 'past_due'];

interface CourseSubscriptionServiceConfig extends ServiceConfig {
  /** Injected so invoice payouts resolve fees via the 3-tier fallback chain. */
  feeConfig?: FeeConfigService;
}

/** Minimal per-event result so the webhook can bump the buyer's caches. */
export interface CourseSubscriptionWebhookResult {
  userId: string;
  organizationId: string;
}

export class CourseSubscriptionService extends BaseService {
  private readonly stripe: Stripe;
  private readonly feeConfig: FeeConfigService | undefined;

  constructor(config: CourseSubscriptionServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.feeConfig = config.feeConfig;
  }

  // ─── Plan management (Stripe Product + 2 Prices, per course) ─────────────────

  /**
   * Create the course's subscription plan: a Stripe Product + monthly/annual
   * Prices (on the PLATFORM account — the platform-charge model, same as tiers)
   * plus the `course_subscription_plans` row. One live plan per course.
   */
  async createPlan(
    courseId: string,
    input: { priceMonthly: number; priceAnnual: number }
  ): Promise<typeof courseSubscriptionPlans.$inferSelect> {
    try {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, courseId), isNull(courses.deletedAt)),
        columns: { id: true, title: true, organizationId: true },
      });
      if (!course) {
        throw new NotFoundError('Course not found', { courseId });
      }

      // A course sub pays out to the org/creator, so the org Connect account
      // must be ready before a plan can be sold (mirrors TierService).
      const connect = await resolvePrimaryConnect(
        this.db,
        course.organizationId
      );
      if (!connect?.chargesEnabled || !connect?.payoutsEnabled) {
        throw new ConnectAccountNotReadyError(course.organizationId);
      }

      const existing = await this.db.query.courseSubscriptionPlans.findFirst({
        where: and(
          eq(courseSubscriptionPlans.courseId, courseId),
          isNull(courseSubscriptionPlans.deletedAt)
        ),
      });
      if (existing) {
        throw new CourseSubscriptionPlanExistsError(courseId);
      }

      const idempotencyBase = crypto.randomUUID();
      const product = await this.stripe.products.create(
        {
          name: `${course.title} — Subscription`,
          metadata: {
            codex_organization_id: course.organizationId,
            codex_course_id: courseId,
            codex_type: COURSE_SUBSCRIPTION_METADATA_TYPE,
          },
        },
        { idempotencyKey: `course-plan-product-${idempotencyBase}` }
      );

      const [monthlyPrice, annualPrice] = await Promise.all([
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceMonthly,
            currency: CURRENCY.GBP,
            recurring: { interval: 'month' },
            metadata: { codex_course_id: courseId, interval: 'month' },
          },
          { idempotencyKey: `course-plan-price-monthly-${idempotencyBase}` }
        ),
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceAnnual,
            currency: CURRENCY.GBP,
            recurring: { interval: 'year' },
            metadata: { codex_course_id: courseId, interval: 'year' },
          },
          { idempotencyKey: `course-plan-price-annual-${idempotencyBase}` }
        ),
      ]);

      try {
        const [plan] = await this.db
          .insert(courseSubscriptionPlans)
          .values({
            courseId,
            priceMonthly: input.priceMonthly,
            priceAnnual: input.priceAnnual,
            stripeProductId: product.id,
            stripePriceMonthlyId: monthlyPrice.id,
            stripePriceAnnualId: annualPrice.id,
          })
          .returning();
        if (!plan) {
          throw new InternalServiceError('Failed to insert course plan', {
            courseId,
          });
        }
        return plan;
      } catch (dbError) {
        // Archive the Stripe Product so a failed DB insert leaves no orphan.
        await this.stripe.products
          .update(product.id, { active: false })
          .catch((cleanupErr) =>
            this.obs.error('Failed to archive orphaned course plan product', {
              stripeProductId: product.id,
              courseId,
              error:
                cleanupErr instanceof Error
                  ? cleanupErr.message
                  : String(cleanupErr),
            })
          );
        throw dbError;
      }
    } catch (error) {
      this.handleError(error, 'createPlan');
    }
  }

  /** The live plan for a course, or null. */
  async getPlanForCourse(
    courseId: string
  ): Promise<typeof courseSubscriptionPlans.$inferSelect | null> {
    const plan = await this.db.query.courseSubscriptionPlans.findFirst({
      where: and(
        eq(courseSubscriptionPlans.courseId, courseId),
        eq(courseSubscriptionPlans.isActive, true),
        isNull(courseSubscriptionPlans.deletedAt)
      ),
    });
    return plan ?? null;
  }

  // ─── Checkout ────────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout session (`mode: 'subscription'`) for a course sub.
   * Platform-charge model (no `transfer_data`) so `invoice.payment_succeeded`
   * fans out the split via `source_transaction`, exactly like org subs.
   */
  async createCheckoutSession(
    userId: string,
    input: CreateCourseSubscriptionCheckoutInput
  ): Promise<{ sessionUrl: string; sessionId: string }> {
    try {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, input.courseId), isNull(courses.deletedAt)),
        columns: { id: true, organizationId: true, status: true },
      });
      if (!course) {
        throw new NotFoundError('Course not found', {
          courseId: input.courseId,
        });
      }
      if (course.status !== CONTENT_STATUS.PUBLISHED) {
        throw new SubscriptionCheckoutError('Course is not published', {
          courseId: input.courseId,
        });
      }

      const plan = await this.getPlanForCourse(input.courseId);
      if (!plan) {
        throw new CourseSubscriptionPlanNotFoundError(input.courseId);
      }

      // Block a second active sub to the same course (the partial unique index
      // also enforces this at the DB, but fail early with a clean 409).
      const [existing] = await this.db
        .select({ id: courseSubscriptions.id })
        .from(courseSubscriptions)
        .where(
          and(
            eq(courseSubscriptions.userId, userId),
            eq(courseSubscriptions.courseId, input.courseId),
            inArray(courseSubscriptions.status, GRANTING_STATUSES)
          )
        )
        .limit(1);
      if (existing) {
        throw new AlreadyCourseSubscribedError(userId, input.courseId);
      }

      const stripePriceId =
        input.billingInterval === BILLING_INTERVAL.MONTH
          ? plan.stripePriceMonthlyId
          : plan.stripePriceAnnualId;
      if (!stripePriceId) {
        throw new SubscriptionCheckoutError(
          'Stripe Price not configured for this plan and interval',
          { courseId: input.courseId, billingInterval: input.billingInterval }
        );
      }

      const [user] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user?.email) {
        throw new NotFoundError('User email not found for checkout', {
          userId,
        });
      }

      const metadata = {
        type: COURSE_SUBSCRIPTION_METADATA_TYPE,
        codex_user_id: userId,
        codex_course_id: input.courseId,
        codex_plan_id: plan.id,
        codex_organization_id: course.organizationId,
      };

      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        { userId, email: user.email },
        (stripeCustomerId) =>
          this.stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [{ price: stripePriceId, quantity: 1 }],
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata,
            subscription_data: { metadata },
          }),
        {
          onStaleRecovery: (info) =>
            this.obs.warn(
              'Stale users.stripe_customer_id detected; clearing and retrying',
              { ...info, courseId: input.courseId }
            ),
        }
      );

      if (!session.url) {
        throw new SubscriptionCheckoutError(
          'Failed to create checkout session URL'
        );
      }
      return { sessionUrl: session.url, sessionId: session.id };
    } catch (error) {
      this.handleError(error, 'createCheckoutSession');
    }
  }

  // ─── Webhook handlers ──────────────────────────────────────────────────────

  /**
   * Discriminator: does this Stripe subscription belong to a course sub? Read by
   * the webhook dispatcher to route between org- and course-subscription paths.
   */
  static isCourseSubscription(stripeSub: Stripe.Subscription): boolean {
    return (
      (stripeSub.metadata?.type ?? null) === COURSE_SUBSCRIPTION_METADATA_TYPE
    );
  }

  /**
   * Ensure the `course_subscriptions` row exists (self-heal on webhook-ordering
   * races, mirroring `ensureSubscriptionDataPresent`). Returns null when the
   * subscription lacks course metadata or Stripe reports it not-found.
   */
  private async ensureDataPresent(
    stripeSub: Stripe.Subscription
  ): Promise<{ row: CourseSubscription; justInserted: boolean } | null> {
    const [existing] = await this.db
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSub.id))
      .limit(1);
    if (existing) return { row: existing, justInserted: false };

    const metadata = stripeSub.metadata ?? {};
    const userId = metadata.codex_user_id;
    const courseId = metadata.codex_course_id;
    const planId = metadata.codex_plan_id;
    const organizationId = metadata.codex_organization_id;
    if (!userId || !courseId || !planId || !organizationId) {
      this.obs.warn('Course subscription webhook missing metadata', {
        stripeSubscriptionId: stripeSub.id,
        metadata,
      });
      return null;
    }

    const item = stripeSub.items.data[0];
    const billingInterval =
      item?.price?.recurring?.interval === 'year'
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;
    const periodStart = item?.current_period_start ?? 0;
    const periodEnd = item?.current_period_end ?? 0;
    const status = resolveStatus(
      stripeSub.status,
      stripeSub.cancel_at_period_end ?? false,
      'active'
    );

    try {
      await this.db.insert(courseSubscriptions).values({
        userId,
        courseId,
        planId,
        organizationId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId:
          typeof stripeSub.customer === 'string'
            ? stripeSub.customer
            : stripeSub.customer.id,
        status,
        billingInterval,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [raced] = await this.db
          .select()
          .from(courseSubscriptions)
          .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSub.id))
          .limit(1);
        if (raced) return { row: raced, justInserted: false };
      }
      throw error;
    }

    const [inserted] = await this.db
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSub.id))
      .limit(1);
    if (!inserted) {
      throw new InternalServiceError(
        'course subscription row missing after insert',
        { stripeSubscriptionId: stripeSub.id }
      );
    }
    return { row: inserted, justInserted: true };
  }

  /**
   * customer.subscription.created (course sub): ensure the row + write the
   * `course_subscription` entitlement (expiresAt = currentPeriodEnd) + auto-enroll.
   */
  async handleCourseSubscriptionCreated(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | void> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;

    await writeCourseSubscriptionEntitlement(this.db, {
      userId: row.userId,
      organizationId: row.organizationId ?? '',
      courseId: row.courseId,
      courseSubscriptionId: row.id,
      expiresAt: row.currentPeriodEnd,
    });

    this.obs.info('Course subscription activated', {
      courseSubscriptionId: row.id,
      courseId: row.courseId,
      userId: row.userId,
    });
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * invoice.payment_succeeded (course sub): refresh the period + entitlement
   * expiry, then fan out the recurring-revenue payout for the invoice charge.
   */
  async handleCourseInvoicePaymentSucceeded(
    stripeInvoice: Stripe.Invoice,
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | void> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;

    const item = stripeSub.items.data[0];
    const periodStart = item?.current_period_start ?? 0;
    const periodEnd = item?.current_period_end ?? 0;
    const newPeriodEnd = new Date(periodEnd * 1000);

    await this.db
      .update(courseSubscriptions)
      .set({
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: newPeriodEnd,
        status: resolveStatus(
          stripeSub.status,
          stripeSub.cancel_at_period_end ?? false,
          'active'
        ),
        updatedAt: new Date(),
      })
      .where(eq(courseSubscriptions.id, row.id));

    // Extend the stored grant to the new period end (fail-closed between renewals).
    await refreshCourseSubscriptionEntitlementExpiry(this.db, {
      userId: row.userId,
      courseId: row.courseId,
      expiresAt: newPeriodEnd,
    });

    // GBP-only: the fan-out is hardcoded to GBP transfers (same invariant as
    // the org-subscription pipeline). Reject a non-GBP invoice loudly.
    if (stripeInvoice.currency && stripeInvoice.currency !== CURRENCY.GBP) {
      this.obs.error('Non-GBP course subscription invoice — skipping payouts', {
        courseSubscriptionId: row.id,
        invoiceId: stripeInvoice.id,
        currency: stripeInvoice.currency,
      });
      return { userId: row.userId, organizationId: row.organizationId ?? '' };
    }

    const chargeId = await this.resolveInvoiceCharge(stripeInvoice);
    if (!chargeId) {
      this.obs.warn(
        'Course subscription invoice has no charge — skipping payouts',
        { courseSubscriptionId: row.id, invoiceId: stripeInvoice.id }
      );
      return { userId: row.userId, organizationId: row.organizationId ?? '' };
    }

    await this.writeCoursePayouts(row, stripeInvoice.amount_paid, chargeId);

    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * customer.subscription.updated (course sub): mirror status/period. `unpaid`
   * is access-reducing → revoke the grant immediately.
   */
  async handleCourseSubscriptionUpdated(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | void> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;

    const item = stripeSub.items.data[0];
    const status = resolveStatus(
      stripeSub.status,
      stripeSub.cancel_at_period_end ?? false,
      row.status as Parameters<typeof resolveStatus>[2]
    );
    await this.db
      .update(courseSubscriptions)
      .set({
        status,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : row.currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(courseSubscriptions.id, row.id));

    if (stripeSub.status === 'unpaid') {
      await revokeCourseSubscriptionEntitlement(this.db, {
        userId: row.userId,
        courseId: row.courseId,
      });
    }
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * customer.subscription.deleted (course sub): mark cancelled + REVOKE the
   * stored grant so the resolver stops granting immediately.
   */
  async handleCourseSubscriptionDeleted(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | void> {
    const [row] = await this.db
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSub.id))
      .limit(1);
    if (!row) return;

    await this.db
      .update(courseSubscriptions)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(courseSubscriptions.id, row.id));

    await revokeCourseSubscriptionEntitlement(this.db, {
      userId: row.userId,
      courseId: row.courseId,
    });

    this.obs.info('Course subscription cancelled', {
      courseSubscriptionId: row.id,
      courseId: row.courseId,
      userId: row.userId,
    });
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  // ─── Payout fan-out (Option B platform charge — mirrors writePurchasePayouts) ─

  /**
   * Split a course-subscription invoice charge and fan out the creator + org
   * secondary transfers, writing `payouts` rows attributed by
   * `courseSubscriptionId` (§H3). ctx='subscription' (recurring), and per
   * HARDENING §H4 the creator's `subscription` revenue-share agreement applies.
   */
  private async writeCoursePayouts(
    sub: CourseSubscription,
    amountCents: number,
    stripeChargeId: string
  ): Promise<void> {
    const [course] = await this.db
      .select({
        creatorId: courses.creatorId,
        organizationId: courses.organizationId,
      })
      .from(courses)
      .where(eq(courses.id, sub.courseId))
      .limit(1);
    if (!course) {
      this.obs.error('Course missing during course-sub payout', {
        courseSubscriptionId: sub.id,
        courseId: sub.courseId,
      });
      return;
    }
    const { creatorId, organizationId } = course;

    // Idempotency: `invoice.payment_succeeded` can redeliver. Only platform_fee
    // has a per-charge unique index, so guard the WHOLE fan-out with a per-charge
    // SELECT pre-check (mirrors executeTransfers) — if any payout row already
    // exists for this (charge, course-sub), the fan-out ran; skip re-inserting
    // the creator/org rows. The transfer idempotency keys are the second line of
    // defence against double-paying if two redeliveries race past this check.
    const [already] = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(
        and(
          eq(payouts.stripeChargeId, stripeChargeId),
          eq(payouts.courseSubscriptionId, sub.id)
        )
      )
      .limit(1);
    if (already) {
      this.obs.info(
        'Course-sub payouts already recorded for charge — skipping',
        {
          courseSubscriptionId: sub.id,
          stripeChargeId,
        }
      );
      return;
    }

    const fees = this.feeConfig
      ? await this.feeConfig.getFeesForCreator(
          organizationId,
          creatorId,
          'subscription'
        )
      : {
          platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
          orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        };

    const agreementSharePercent = await findActiveCreatorAgreementShare(
      this.db,
      {
        organizationId,
        creatorId,
        revenueType: 'subscription',
        at: new Date(),
      }
    );
    const effectiveOrgFeePercent =
      agreementSharePercent != null
        ? 10_000 - agreementSharePercent
        : fees.orgFeePercent;

    const split = applyMinPlatformFeeFloor(
      amountCents,
      calculateRevenueSplit(
        amountCents,
        fees.platformFeePercent,
        effectiveOrgFeePercent
      ),
      fees.minPlatformFeeCents
    );

    this.obs.info('payout_split_computed', {
      courseSubscriptionId: sub.id,
      courseId: sub.courseId,
      organizationId,
      creatorId,
      amountPaidCents: amountCents,
      platformFeeCents: split.platformFeeCents,
      organizationFeeCents: split.organizationFeeCents,
      creatorPayoutCents: split.creatorPayoutCents,
      agreementApplied: agreementSharePercent != null,
      source: 'course_subscription',
    });

    const transferGroup = `course_sub_${sub.id}`;
    const now = new Date();

    // 1. Platform fee — retained on platform balance (no transfer). Idempotent
    // per charge via uq_payouts_platform_fee_per_charge.
    if (split.platformFeeCents > 0) {
      try {
        await this.db
          .insert(payouts)
          .values({
            userId: null,
            organizationId,
            courseSubscriptionId: sub.id,
            amountCents: split.platformFeeCents,
            payoutType: 'platform_fee',
            status: 'paid',
            sourceType: 'subscription',
            stripeChargeId,
            transferGroup,
            resolvedAt: now,
          })
          .onConflictDoNothing({
            target: payouts.stripeChargeId,
            where: sql`${payouts.payoutType} = 'platform_fee'`,
          });
      } catch (err) {
        this.obs.error('Failed to insert course-sub platform_fee payout', {
          courseSubscriptionId: sub.id,
          stripeChargeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Creator payout — secondary transfer to the course creator's account.
    if (split.creatorPayoutCents > 0) {
      const [creatorConnect] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId))
        .limit(1);
      await this.executeCourseTransfer({
        sub,
        organizationId,
        amountCents: split.creatorPayoutCents,
        payoutType: 'creator_payout',
        rowUserId: creatorId,
        connect: creatorConnect,
        stripeChargeId,
        transferGroup,
        idempotencyKey: `${stripeChargeId}_creator`,
        now,
      });
    }

    // 3. Organization fee — secondary transfer to the org's Connect account.
    if (split.organizationFeeCents > 0) {
      const orgConnect = await resolvePrimaryConnect(this.db, organizationId);
      const rowUserId = orgConnect?.userId ?? null;
      if (rowUserId) {
        await this.executeCourseTransfer({
          sub,
          organizationId,
          amountCents: split.organizationFeeCents,
          payoutType: 'organization_fee',
          rowUserId,
          connect: orgConnect,
          stripeChargeId,
          transferGroup,
          idempotencyKey: `${stripeChargeId}_org_fee`,
          now,
        });
      } else {
        this.obs.error(
          'Cannot record course-sub organization_fee payout: no org Connect/owner',
          { courseSubscriptionId: sub.id, organizationId }
        );
      }
    }
  }

  /**
   * Execute one secondary transfer (creator or org) for a course sub + write its
   * `payouts` ledger row. Per-row error isolation, NEVER throws — mirrors
   * `PurchaseService.executePurchaseTransfer`. success → paid+transferId,
   * connect-not-ready → pending, Stripe failure → failed.
   */
  private async executeCourseTransfer(params: {
    sub: CourseSubscription;
    organizationId: string;
    amountCents: number;
    payoutType: 'creator_payout' | 'organization_fee';
    rowUserId: string;
    connect: { stripeAccountId: string; chargesEnabled: boolean } | undefined;
    stripeChargeId: string;
    transferGroup: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<void> {
    const {
      sub,
      organizationId,
      amountCents,
      payoutType,
      rowUserId,
      connect,
      stripeChargeId,
      transferGroup,
      idempotencyKey,
      now,
    } = params;

    if (!connect?.chargesEnabled) {
      try {
        await this.db.insert(payouts).values({
          userId: rowUserId,
          organizationId,
          courseSubscriptionId: sub.id,
          amountCents,
          payoutType,
          status: 'pending',
          sourceType: 'subscription',
          reason: 'connect_not_ready',
          stripeChargeId,
          transferGroup,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          this.obs.error(
            `Failed to record pending ${payoutType} (course sub)`,
            {
              courseSubscriptionId: sub.id,
              constraint: getConstraintName(err),
              error: err instanceof Error ? err.message : String(err),
            }
          );
        }
      }
      return;
    }

    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: amountCents,
          currency: CURRENCY.GBP,
          destination: connect.stripeAccountId,
          source_transaction: stripeChargeId,
          metadata: {
            course_subscription_id: sub.id,
            type: payoutType,
            stripe_charge_id: stripeChargeId,
          },
        },
        { idempotencyKey }
      );
      try {
        await this.db.insert(payouts).values({
          userId: rowUserId,
          organizationId,
          courseSubscriptionId: sub.id,
          amountCents,
          payoutType,
          status: 'paid',
          sourceType: 'subscription',
          stripeTransferId: transfer.id,
          stripeChargeId,
          transferGroup,
          resolvedAt: now,
        });
      } catch (insertErr) {
        if (!isUniqueViolation(insertErr)) {
          const errorId = crypto.randomUUID();
          this.obs.error(
            `${payoutType} transfer succeeded but course-sub ledger insert failed`,
            {
              errorId,
              courseSubscriptionId: sub.id,
              stripeTransferId: transfer.id,
              idempotencyKey,
              constraint: getConstraintName(insertErr),
              error:
                insertErr instanceof Error
                  ? insertErr.message
                  : String(insertErr),
            }
          );
        }
      }
    } catch (transferErr) {
      this.obs.error(`${payoutType} transfer failed (course sub)`, {
        courseSubscriptionId: sub.id,
        amountCents,
        idempotencyKey,
        destination: connect.stripeAccountId,
        error:
          transferErr instanceof Error
            ? transferErr.message
            : String(transferErr),
      });
      try {
        await this.db.insert(payouts).values({
          userId: rowUserId,
          organizationId,
          courseSubscriptionId: sub.id,
          amountCents,
          payoutType,
          status: 'failed',
          sourceType: 'subscription',
          reason: 'transfer_failed',
        });
      } catch (insertErr) {
        if (!isUniqueViolation(insertErr)) {
          this.obs.error(`Failed to record failed ${payoutType} (course sub)`, {
            courseSubscriptionId: sub.id,
            error:
              insertErr instanceof Error
                ? insertErr.message
                : String(insertErr),
          });
        }
      }
    }
  }

  /**
   * Resolve the source charge id for an invoice's transfers. Webhook payloads
   * omit expanded `payments` by default, so fall back through expand →
   * payment_intent → charges.list (mirrors SubscriptionService.resolveInvoiceCharge).
   */
  private async resolveInvoiceCharge(
    invoice: Stripe.Invoice
  ): Promise<string | null> {
    const payment = invoice.payments?.data?.[0];
    const paymentCharge = payment?.payment?.charge;
    if (typeof paymentCharge === 'string') return paymentCharge;

    if (invoice.id) {
      const expanded = await this.stripe.invoices.retrieve(invoice.id, {
        expand: ['payments'],
      });
      const expandedCharge = expanded.payments?.data?.[0]?.payment?.charge;
      if (typeof expandedCharge === 'string') return expandedCharge;
    }
    return null;
  }
}
