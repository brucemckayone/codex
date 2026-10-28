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
 * it, a delete/unpaid revokes it. Auto-enrollment (D-G) rides along. Each grant
 * belongs to one subscription (`sourceRef`), and is written only while that
 * subscription grants access.
 *
 * Drift (Codex-2hxff.15): a second subscription to a course the buyer already
 * holds is recorded as a duplicate, then cancelled and refunded in full, and
 * grants nothing. A deletion leaves a tombstone (`endedAt`) that no later or
 * replayed event changes.
 *
 * Payouts: recurring-invoice revenue REUSES the h69cg payout LEDGER (`payouts`)
 * — Option B platform-charge fan-out (creator + org secondary transfers linked
 * by `source_transaction`), attributed via the new `payouts.courseSubscriptionId`
 * FK (§H3). Idempotent by Stripe charge id + deterministic transfer idempotency
 * keys, mirroring `PurchaseService.writePurchasePayouts`.
 */

import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  BILLING_INTERVAL,
  CHECKOUT_SESSION_KIND,
  CONTENT_STATUS,
  CURRENCY,
  OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES,
  STRIPE_ENV_METADATA_KEY,
  SUBSCRIPTION_STATUS,
  stripeEnvMetadata,
  subscriptionStatusGrantsAccess,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  type CourseSubscription,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  isGbpOrUnset,
  issueRefund,
  type LedgerDeps,
  type RecordSliceInput,
  recordPlatformFee,
  recordSplitOnce,
  resolveInvoiceCharge,
  resolveOrganisationPayee,
  reverseEarlierRefundsAfterCommit,
} from '@codex/payments';
import {
  applyMinPlatformFeeFloor,
  CheckoutReservations,
  calculateRevenueSplit,
  checkoutIdempotencyKey,
  type FeeResolver,
  findActiveCreatorAgreementShare,
  revokeCourseSubscriptionEntitlement,
  stripeErrorCode,
  toStripeTime,
  withStaleCustomerRecovery,
  writeCourseSubscriptionEntitlement,
} from '@codex/purchase';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
  ServiceUnavailableError,
} from '@codex/service-errors';
import type { CreateCourseSubscriptionCheckoutInput } from '@codex/validation';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyCourseSubscribedError,
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
  CourseSubscriptionPlanNotFoundError,
  CreatorConnectRequiredError,
  ForbiddenError,
  SubscriptionCheckoutError,
} from '../errors';
import {
  type CreateKeySubject,
  createKeyRefusal,
  stripeRefusalDetail,
} from './create-key-refusal';
import {
  alertFanOutOutOfTime,
  moveFailureAlert,
  noticeFailureAlert,
  PRICE_FAN_OUT_BUDGET_MS,
  type PriceChangeNotice,
  type PriceChangeNoticeMailer,
  schedulePriceChange,
  sendPriceChangeNotice,
} from './pending-price-change';
import { resolveStatus } from './stripe-status-mapper';
import {
  cancelAndRefundDuplicate,
  isDuplicateSubscription,
} from './subscription-duplicates';

/** Marks a Stripe subscription as a course sub (vs. an org tier sub). */
export const COURSE_SUBSCRIPTION_METADATA_TYPE = 'course_subscription';

/** Codes for Stripe's refusals of a course plan create (Codex-2hxff.66). */
const COURSE_PLAN_CREATE_KEY: CreateKeySubject = {
  noun: 'plan',
  reusedCode: 'COURSE_PLAN_KEY_REUSED',
  inProgressCode: 'COURSE_PLAN_IN_PROGRESS',
};

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * Fire-and-forget `course-no-longer-offered` email (Codex-2hxff.64). The
 * cancel never waits on it; the registry wires `sendEmailToWorker`.
 */
export type CourseOffSaleMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'course-no-longer-offered';
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

/**
 * The money dependencies are required (Codex-2hxff.55, docs/payments/
 * architecture.md rule A4): the registry wires them, a test uses
 * `createTestMoneyDeps()` from `@codex/test-utils`.
 */
interface CourseSubscriptionServiceConfig extends ServiceConfig {
  /** Invoice payouts resolve fees via the 3-tier fallback chain. */
  feeConfig: FeeResolver;
  /**
   * Price-change notices (`subscription-tier-price-change`), awaited: a
   * subscriber moves only once theirs is accepted (D-P3, Codex-2hxff.43).
   */
  mailer: PriceChangeNoticeMailer;
  /** Off-sale notices (`course-no-longer-offered`). */
  offSaleMailer: CourseOffSaleMailer;
  /** Base for the notice's manage-subscription link. */
  webAppUrl?: string;
  /**
   * Runs a plan's subscriber fan-out after the response. Absent (tests) → the
   * fan-out is awaited inline.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** One interval of a plan whose Price changed. */
interface PlanPriceMove {
  interval: 'month' | 'year';
  newPriceId: string;
  /**
   * The plan's previous LIST price. Not what a subscriber pays: the notice
   * quotes their live item (`PriceChangeOutcome.currentAmountCents`), and
   * this is only the fallback when that has no unit amount (Codex-2hxff.40).
   */
  oldAmountCents: number;
  newAmountCents: number;
}

/** Minimal per-event result so the webhook can bump the buyer's caches. */
export interface CourseSubscriptionWebhookResult {
  userId: string;
  organizationId: string;
}

/**
 * Result of `verifyCheckoutSession()` — what the journey success page reads.
 * `subscription` appears once our row for the session exists.
 */
export interface CourseSubscriptionCheckoutVerifyResult {
  sessionStatus: 'complete' | 'expired' | 'open';
  subscription?: {
    id: string;
    courseId: string;
    courseTitle: string;
    startedAt: string;
    /**
     * Set when this subscription is a duplicate (Codex-2hxff.15): the course
     * subscription it repeats, which the user keeps. This one is cancelled
     * and refunded (Codex-o4jvw).
     */
    duplicateOf?: { id: string };
  };
}

export class CourseSubscriptionService extends BaseService {
  private readonly stripe: Stripe;
  private readonly feeConfig: FeeResolver;
  private readonly mailer: PriceChangeNoticeMailer;
  private readonly offSaleMailer: CourseOffSaleMailer;
  private readonly webAppUrl: string | undefined;
  private readonly waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  private readonly checkoutReservations: CheckoutReservations;

  constructor(config: CourseSubscriptionServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.feeConfig = config.feeConfig;
    this.mailer = config.mailer;
    this.offSaleMailer = config.offSaleMailer;
    this.webAppUrl = config.webAppUrl;
    this.waitUntil = config.waitUntil;
    this.checkoutReservations = new CheckoutReservations(
      this.db,
      stripe,
      this.obs
    );
  }

  // ─── Plan management (Stripe Product + 2 Prices, per course) ─────────────────

  /**
   * Resolve a course inside `organizationId`, or throw.
   *
   * Every plan mutation routes through here. Callers hold org management over
   * `organizationId` only; the course id arrives from an untrusted client path
   * segment, so resolving by `(id, organizationId)` is what stops an org-A admin
   * from attaching a Stripe product — or changing prices — on org B's course.
   * A foreign course reads as `NotFoundError`, never `ForbiddenError`, so this
   * never confirms that a course in another org exists.
   */
  private async getCourseInOrgOrThrow(
    organizationId: string,
    courseId: string
  ) {
    const course = await this.db.query.courses.findFirst({
      where: and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
        isNull(courses.deletedAt)
      ),
      columns: {
        id: true,
        title: true,
        organizationId: true,
        creatorId: true,
        status: true,
      },
    });
    if (!course) {
      throw new NotFoundError('Course not found', { courseId, organizationId });
    }
    return course;
  }

  /**
   * A live course takes a new way to pay only if its creator can be paid
   * (Codex-2hxff.14, owner decision "Yes, same rule"), as publishing a priced
   * course does. A plan on a draft course is checked when the course is
   * published. Without this a creator who can't be paid could start earning a
   * share that waits, pending, until they set up payouts.
   */
  private async assertLiveCourseCreatorCanBePaid(course: {
    creatorId: string;
    status: string;
  }): Promise<void> {
    if (course.status !== CONTENT_STATUS.PUBLISHED) return;
    const [account] = await this.db
      .select({
        chargesEnabled: stripeConnectAccounts.chargesEnabled,
        payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
      })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, course.creatorId))
      .limit(1);
    if (!account?.chargesEnabled || !account.payoutsEnabled) {
      throw new CreatorConnectRequiredError(course.creatorId);
    }
  }

  /**
   * Create the course's subscription plan: a Stripe Product + monthly/annual
   * Prices (on the PLATFORM account — the platform-charge model, same as tiers)
   * plus the `course_subscription_plans` row. One live plan per course.
   *
   * Prefer {@link upsertPlan} from a management surface — this throws
   * {@link CourseSubscriptionPlanExistsError} on a second call, which makes it
   * unusable directly behind a "save" button.
   *
   * Two creates racing for a course make one plan (Codex-2hxff.66; owner
   * decisions 2026-10-25 and 2026-10-26). The keys are the course, its plan
   * generation and the UTC hour, so racers in one hour share one Product and
   * clean-up never leaves it archived. Racers either side of an hour boundary
   * make two Products: the loser archives its spare and throws
   * {@link CourseSubscriptionPlanExistsError}, so {@link upsertPlan} returns
   * the plan that won.
   */
  async createPlan(
    organizationId: string,
    courseId: string,
    input: { priceMonthly: number; priceAnnual: number }
  ): Promise<typeof courseSubscriptionPlans.$inferSelect> {
    // Read once: the keys' UTC hour, and a refusal's retryAfter, both come
    // from this instant.
    const keyedAt = Date.now();
    try {
      const course = await this.getCourseInOrgOrThrow(organizationId, courseId);

      // A course sub pays out to the org/creator, so the org Connect account
      // must be ready before a plan can be sold (mirrors TierService).
      const connect = (
        await resolveOrganisationPayee(this.db, course.organizationId)
      )?.account;
      if (!connect?.chargesEnabled || !connect?.payoutsEnabled) {
        throw new ConnectAccountNotReadyError(course.organizationId);
      }
      await this.assertLiveCourseCreatorCanBePaid(course);

      const existing = await this.db.query.courseSubscriptionPlans.findFirst({
        where: and(
          eq(courseSubscriptionPlans.courseId, courseId),
          isNull(courseSubscriptionPlans.deletedAt)
        ),
      });
      if (existing) {
        throw new CourseSubscriptionPlanExistsError(courseId);
      }

      // Keys that survive a retry (Codex-2hxff.66): the course, its plan
      // generation and the UTC hour, so a concurrent twin of this create, or a
      // retry of one that failed after Stripe, gets back the same Product and
      // Prices instead of making new ones. The generation counts deleted
      // plans too, so a plan made after one was deleted gets fresh keys. The
      // hour (owner decision 2026-10-26) bounds a Stripe failure that Stripe
      // stores and replays under a key: plan saves are blocked for at most
      // the rest of the hour, not 24 hours. A race across the hour boundary
      // makes a spare Product, which the clean-up below archives. The amounts
      // are in the Price keys: Stripe refuses a reused key with new
      // parameters, so a retry at new prices must make new Prices. The
      // environment is in the keys because production, dev and CI share one
      // Stripe sandbox, and seeded course ids repeat across them.
      const generation = await this.planGeneration(courseId);
      const hour = new Date(keyedAt).toISOString().slice(0, 13);
      const keyBase = `${this.environment}-${courseId}-${generation}-${hour}`;
      const product = await this.stripe.products.create(
        {
          name: `${course.title} — Subscription`,
          metadata: {
            codex_organization_id: course.organizationId,
            codex_course_id: courseId,
            codex_type: COURSE_SUBSCRIPTION_METADATA_TYPE,
            ...stripeEnvMetadata(this.environment),
          },
        },
        { idempotencyKey: `course-plan-product-${keyBase}` }
      );

      const [monthlyPrice, annualPrice] = await Promise.all([
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceMonthly,
            currency: CURRENCY.GBP,
            recurring: { interval: 'month' },
            metadata: {
              codex_course_id: courseId,
              interval: 'month',
              ...stripeEnvMetadata(this.environment),
            },
          },
          {
            idempotencyKey: `course-plan-price-monthly-${keyBase}-${input.priceMonthly}`,
          }
        ),
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceAnnual,
            currency: CURRENCY.GBP,
            recurring: { interval: 'year' },
            metadata: {
              codex_course_id: courseId,
              interval: 'year',
              ...stripeEnvMetadata(this.environment),
            },
          },
          {
            idempotencyKey: `course-plan-price-annual-${keyBase}-${input.priceAnnual}`,
          }
        ),
      ]);

      // A retry of an attempt that failed after Stripe gets that attempt's
      // Product back, archived by its clean-up below. Put it on sale, or the
      // plan this call saves could never be billed.
      await this.stripe.products.update(product.id, { active: true });

      let plan: typeof courseSubscriptionPlans.$inferSelect;
      try {
        const [inserted] = await this.db
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
        if (!inserted) {
          throw new InternalServiceError('Failed to insert course plan', {
            courseId,
          });
        }
        plan = inserted;
      } catch (dbError) {
        // A concurrent twin of this create took the course's one plan row
        // (uq_course_sub_plans_course) with the same Product, since the keys
        // match. It is the plan this call was making: return it, and never
        // archive a Product a live plan sells with.
        let twin: typeof courseSubscriptionPlans.$inferSelect | null;
        try {
          twin = await this.findLivePlanWithProduct(courseId, product.id);
        } catch (lookupError) {
          // Unknown whether a live plan uses it: leave the Product on sale
          // rather than risk archiving one that does. A retry reuses it.
          this.obs.error(
            'Could not check for a live course plan on the product; left it on sale',
            {
              stripeProductId: product.id,
              courseId,
              error:
                lookupError instanceof Error
                  ? lookupError.message
                  : String(lookupError),
            }
          );
          throw dbError;
        }
        if (twin) return twin;

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
        // Look again. A twin's insert can commit after the look-up above and
        // before the archive: if one did, put the Product back on sale and
        // return its plan. The twin re-lists after its insert too, so
        // whichever side acts last leaves a live plan's Product on sale.
        // Otherwise a racing create under the next (or last) hour's keys won
        // the course's one plan row with a Product of its own: this one was
        // the spare. Say so, and upsertPlan saves onto the plan that won. If
        // the look-up fails, the insert's own error stands.
        const winner = await this.findPlanRow(courseId).catch((lookupError) => {
          // Error, as for the look-up above: this one decides whether a
          // live plan's Product, archived just now, goes back on sale.
          this.obs.error(
            'Archived a course plan product, then could not check for a live plan',
            {
              errorId: crypto.randomUUID(),
              stripeProductId: product.id,
              courseId,
              error:
                lookupError instanceof Error
                  ? lookupError.message
                  : String(lookupError),
            }
          );
          return null;
        });
        if (winner?.stripeProductId === product.id) {
          await this.relistPlanProduct(winner.id, courseId, product.id);
          return winner;
        }
        if (winner) throw new CourseSubscriptionPlanExistsError(courseId);
        throw dbError;
      }

      // The other half of the clean-up's second look: a twin whose insert
      // failed may have archived the Product since this call put it on sale
      // above. Now this row is committed, put it on sale again.
      await this.relistPlanProduct(plan.id, courseId, product.id);
      return plan;
    } catch (error) {
      // A refusal under the plan's keys is typed, never a 500. The generation
      // and the amounts are IN the keys, so "other values under one key" is the
      // Product's name: a course retitled between a failed create and its
      // retry within the same hour.
      const refusal = createKeyRefusal(
        error,
        COURSE_PLAN_CREATE_KEY,
        { courseId },
        keyedAt
      );
      if (refusal) {
        const log = refusal.statusCode >= 500 ? 'error' : 'warn';
        this.obs[log]('Stripe refused a course plan create', {
          errorId: crypto.randomUUID(),
          courseId,
          code: refusal.context?.code,
          ...stripeRefusalDetail(error),
        });
      }
      this.handleError(refusal ?? error, 'createPlan');
    }
  }

  /**
   * Put a live plan's Product on sale (Codex-2hxff.66). A create calls this
   * once its row is committed, and its clean-up when a twin's row appeared
   * after the archive, so whichever acts last leaves the Product on sale.
   * Never throws: the plan is saved, so the create succeeded. A failure is
   * logged, because a plan on an archived Product can never be billed.
   */
  private async relistPlanProduct(
    planId: string,
    courseId: string,
    stripeProductId: string
  ): Promise<void> {
    try {
      await this.stripe.products.update(stripeProductId, { active: true });
    } catch (error) {
      this.obs.error(
        "Could not put a live course plan's Stripe product on sale",
        {
          errorId: crypto.randomUUID(),
          planId,
          courseId,
          stripeProductId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
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

  /**
   * The course's plan row whatever its state — including one withdrawn by
   * {@link deactivatePlan}.
   *
   * Distinct from {@link getPlanForCourse}, which answers "what is on sale" and
   * so filters `isActive`. Write paths must use THIS one: `courseId` is unique
   * among non-deleted rows (`uq_course_sub_plans_course`), so an `isActive`-filtered
   * lookup would report "no plan" for a course that cannot accept a new row.
   */
  private async findPlanRow(courseId: string) {
    const plan = await this.db.query.courseSubscriptionPlans.findFirst({
      where: and(
        eq(courseSubscriptionPlans.courseId, courseId),
        isNull(courseSubscriptionPlans.deletedAt)
      ),
    });
    return plan ?? null;
  }

  /** The course's live plan when it sells with `stripeProductId`, or null. */
  private async findLivePlanWithProduct(
    courseId: string,
    stripeProductId: string
  ) {
    const plan = await this.db.query.courseSubscriptionPlans.findFirst({
      where: and(
        eq(courseSubscriptionPlans.courseId, courseId),
        eq(courseSubscriptionPlans.stripeProductId, stripeProductId),
        isNull(courseSubscriptionPlans.deletedAt)
      ),
    });
    return plan ?? null;
  }

  /**
   * How many plans the course has had, deleted ones included: the generation
   * its next plan's Stripe idempotency keys carry (Codex-2hxff.66).
   */
  private async planGeneration(courseId: string): Promise<number> {
    const [row] = await this.db
      .select({ plans: count() })
      .from(courseSubscriptionPlans)
      .where(eq(courseSubscriptionPlans.courseId, courseId));
    return row?.plans ?? 0;
  }

  /**
   * Create the plan if the course has never had one, otherwise save the prices
   * onto the existing row (re-listing it if it had been withdrawn).
   *
   * The management surface's single entry point. A "save" button must be
   * idempotent — {@link createPlan} alone throws
   * {@link CourseSubscriptionPlanExistsError} on the second press, so the
   * create/update decision belongs here in the service rather than in a route
   * (or, worse, in each caller).
   *
   * The existence check deliberately uses {@link findPlanRow}, not
   * {@link getPlanForCourse}: a WITHDRAWN plan still occupies the course's unique
   * row, so routing that case to `createPlan` would raise
   * `CourseSubscriptionPlanExistsError` and leave the creator permanently unable
   * to put the subscription back on sale.
   */
  async upsertPlan(
    organizationId: string,
    courseId: string,
    input: { priceMonthly: number; priceAnnual: number }
  ): Promise<typeof courseSubscriptionPlans.$inferSelect> {
    const existing = await this.findPlanRow(courseId);
    if (existing) return this.savePlanPrices(organizationId, courseId, input);
    try {
      return await this.createPlan(organizationId, courseId, input);
    } catch (error) {
      // A concurrent save made the plan: between the look-up above and the
      // create's own check, or by winning the unique index under another
      // hour's keys. Save onto it, as a repeat of the save that made it
      // (Codex-2hxff.66). A race inside one hour returns the plan already.
      if (error instanceof CourseSubscriptionPlanExistsError) {
        return this.savePlanPrices(organizationId, courseId, input);
      }
      throw error;
    }
  }

  /**
   * Save prices onto the course's existing plan and make sure it is on sale.
   *
   * Stripe `Price` objects are IMMUTABLE in `unit_amount`, so a price change
   * means: create a new Price on the SAME Product, point the row at it, and
   * archive the old one. This mirrors `TierService.updateTier` exactly, including
   * the compensating rollback — if the DB write fails after Stripe succeeded, the
   * new Prices are archived and the old ones un-archived, so Stripe and the DB
   * cannot silently diverge (a diverged row would sell at a price the creator
   * never set).
   *
   * Existing subscribers on a changed interval move to its new Price under the
   * same rule as org tiers (owner decision P-6, "Same rule as tiers"): at their
   * first renewal at least 30 days after they are emailed, no proration — see
   * `movePlanSubscribers` (Codex-2hxff.3). New checkouts pay the new amount at
   * once.
   *
   * RE-LISTS a withdrawn plan (`isActive` back to true, Stripe Product
   * un-archived). Saving an offer is the creator asserting "this is what I sell",
   * and since the withdrawn row is the only one the course can have, reuse is the
   * only way back on sale — it also keeps every `course_subscriptions.planId` FK
   * pointing at the same plan across a withdraw/re-list cycle.
   *
   * Unchanged prices on an already-live plan are a complete no-op, so repeated
   * saves create no Stripe Price churn.
   */
  async savePlanPrices(
    organizationId: string,
    courseId: string,
    input: { priceMonthly: number; priceAnnual: number }
  ): Promise<typeof courseSubscriptionPlans.$inferSelect> {
    try {
      const course = await this.getCourseInOrgOrThrow(organizationId, courseId);

      const existing = await this.findPlanRow(courseId);
      if (!existing) {
        throw new CourseSubscriptionPlanNotFoundError(courseId);
      }

      const monthlyChanged = input.priceMonthly !== existing.priceMonthly;
      const annualChanged = input.priceAnnual !== existing.priceAnnual;
      const needsRelist = !existing.isActive;
      if (!monthlyChanged && !annualChanged && !needsRelist) {
        return existing;
      }
      // Putting a withdrawn plan back on sale is a new way to pay; a price
      // change on a plan already on sale is not.
      if (needsRelist) await this.assertLiveCourseCreatorCanBePaid(course);

      // The three Stripe id columns are nullable, so the row type permits a live
      // plan with nothing behind it in Stripe. `createPlan` always writes all
      // three, so this is unreachable by design — but it IS reachable by a bad
      // manual row or a future partial write, and a re-price is impossible
      // without a Product to hang the new Price on. Fail loudly: a plan the DB
      // advertises as sellable with no Stripe object is corrupt, and silently
      // updating only the pence columns would make the row lie about what a buyer
      // is actually charged.
      const { stripeProductId, stripePriceMonthlyId, stripePriceAnnualId } =
        existing;
      if (
        !stripeProductId ||
        (monthlyChanged && !stripePriceMonthlyId) ||
        (annualChanged && !stripePriceAnnualId)
      ) {
        throw new InternalServiceError(
          'Course subscription plan is missing its Stripe product/price ids',
          { courseId, organizationId, planId: existing.id }
        );
      }

      let newMonthlyPriceId = stripePriceMonthlyId;
      let newAnnualPriceId = stripePriceAnnualId;
      const createdPriceIds: string[] = [];
      const archivedPriceIds: string[] = [];

      const idempotencyBase = crypto.randomUUID();

      // Re-list first: `deactivatePlan` archived the Product, and Stripe refuses
      // to bill a subscription against an inactive Product. Do it BEFORE the new
      // Prices so we never attach a Price to a Product that is still archived.
      if (needsRelist) {
        await this.stripe.products.update(stripeProductId, { active: true });
      }

      if (monthlyChanged && stripePriceMonthlyId) {
        const price = await this.stripe.prices.create(
          {
            product: stripeProductId,
            unit_amount: input.priceMonthly,
            currency: CURRENCY.GBP,
            recurring: { interval: 'month' },
            metadata: {
              codex_course_id: courseId,
              interval: 'month',
              ...stripeEnvMetadata(this.environment),
            },
          },
          { idempotencyKey: `course-plan-reprice-monthly-${idempotencyBase}` }
        );
        newMonthlyPriceId = price.id;
        createdPriceIds.push(price.id);
        await this.stripe.prices.update(stripePriceMonthlyId, {
          active: false,
        });
        archivedPriceIds.push(stripePriceMonthlyId);
      }

      if (annualChanged && stripePriceAnnualId) {
        const price = await this.stripe.prices.create(
          {
            product: stripeProductId,
            unit_amount: input.priceAnnual,
            currency: CURRENCY.GBP,
            recurring: { interval: 'year' },
            metadata: {
              codex_course_id: courseId,
              interval: 'year',
              ...stripeEnvMetadata(this.environment),
            },
          },
          { idempotencyKey: `course-plan-reprice-annual-${idempotencyBase}` }
        );
        newAnnualPriceId = price.id;
        createdPriceIds.push(price.id);
        await this.stripe.prices.update(stripePriceAnnualId, {
          active: false,
        });
        archivedPriceIds.push(stripePriceAnnualId);
      }

      try {
        const [updated] = await this.db
          .update(courseSubscriptionPlans)
          .set({
            priceMonthly: input.priceMonthly,
            priceAnnual: input.priceAnnual,
            stripePriceMonthlyId: newMonthlyPriceId,
            stripePriceAnnualId: newAnnualPriceId,
            // Saving an offer puts it on sale — this is what re-lists a plan the
            // creator had withdrawn.
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(courseSubscriptionPlans.id, existing.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update course plan prices',
            {
              courseId,
              planId: existing.id,
            }
          );
        }

        const moves: PlanPriceMove[] = [];
        if (monthlyChanged && newMonthlyPriceId) {
          moves.push({
            interval: 'month',
            newPriceId: newMonthlyPriceId,
            oldAmountCents: existing.priceMonthly,
            newAmountCents: input.priceMonthly,
          });
        }
        if (annualChanged && newAnnualPriceId) {
          moves.push({
            interval: 'year',
            newPriceId: newAnnualPriceId,
            oldAmountCents: existing.priceAnnual,
            newAmountCents: input.priceAnnual,
          });
        }
        if (moves.length > 0) {
          // After the commit, so the plan row already points at the new Prices.
          const fanOut = this.movePlanSubscribers(existing.id, moves).catch(
            (error) => {
              // Before or outside the per-subscriber handling (reading the
              // subscribers, say): who was reached is unknown (silent #10).
              this.obs.error(
                'Course plan price fan-out failed; its subscribers may not have been notified or moved (support: check the start line and retry)',
                {
                  errorId: crypto.randomUUID(),
                  planId: existing.id,
                  courseId,
                  moves: moves.map((move) => ({
                    interval: move.interval,
                    newPriceId: move.newPriceId,
                  })),
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
          );
          if (this.waitUntil) this.waitUntil(fanOut);
          else await fanOut;
        }
        return updated;
      } catch (dbError) {
        this.obs.warn(
          'DB update failed during savePlanPrices, rolling back Stripe price changes',
          {
            courseId,
            organizationId,
            planId: existing.id,
            dbError:
              dbError instanceof Error ? dbError.message : String(dbError),
          }
        );
        await this.rollbackPriceChanges(
          createdPriceIds,
          archivedPriceIds,
          courseId
        );
        throw dbError;
      }
    } catch (error) {
      this.handleError(error, 'savePlanPrices');
    }
  }

  /**
   * Move a plan's existing subscribers on each changed interval to its new
   * Price — at their first renewal at least 30 days after this notice, with no
   * proration (`schedulePriceChange`). Notice first, then move (D-P3,
   * Codex-2hxff.43): each subscriber is emailed, and moved only once
   * notifications-api accepts the email. A notice not accepted, or a move that
   * fails, is alerted (errorId and ids) for support to retry. Past-due and
   * paused subscribers get the pending marker and move once active again. One
   * failed subscriber never stops the rest.
   *
   * It runs on `waitUntil`, which the runtime cancels 30 s after the response,
   * so no batch starts after `PRICE_FAN_OUT_BUDGET_MS` (17 s), across both
   * intervals, and every Stripe call gives up after 3 s. Both intervals'
   * subscribers are read first, so every one not reached, on either interval,
   * is reported in one alert after the end summary (`alertFanOutOutOfTime`).
   * A start line opens the run.
   */
  private async movePlanSubscribers(
    planId: string,
    moves: PlanPriceMove[]
  ): Promise<void> {
    const noticeAt = new Date();
    const startedAt = Date.now();
    const prefix = 'Course plan price fan-out: ';
    const planned = [];
    for (const move of moves) {
      const rows = await this.db
        .select({
          id: courseSubscriptions.id,
          stripeSubscriptionId: courseSubscriptions.stripeSubscriptionId,
          organizationId: courseSubscriptions.organizationId,
          userId: courseSubscriptions.userId,
          userEmail: users.email,
          userName: users.name,
          courseTitle: courses.title,
        })
        .from(courseSubscriptions)
        .leftJoin(users, eq(users.id, courseSubscriptions.userId))
        .leftJoin(courses, eq(courses.id, courseSubscriptions.courseId))
        .where(
          and(
            eq(courseSubscriptions.planId, planId),
            eq(courseSubscriptions.billingInterval, move.interval),
            inArray(courseSubscriptions.status, [
              'active',
              'cancelling',
              'past_due',
              'paused',
            ])
          )
        );
      planned.push({ move, rows });
    }

    const counts = {
      total: planned.reduce((sum, { rows }) => sum + rows.length, 0),
      updated: 0,
      unnotified: 0,
      unhandled: 0,
      failed: 0,
    };
    const summary = {
      planId,
      noticeAt: noticeAt.toISOString(),
      moves: planned.map(({ move, rows }) => ({
        interval: move.interval,
        newPriceId: move.newPriceId,
        total: rows.length,
      })),
    };
    this.obs.info('Course plan price fan-out: starting', {
      ...summary,
      total: counts.total,
    });

    // Everyone the deadline leaves out, on either interval: one alert,
    // after the end summary.
    const unreached: Array<Record<string, unknown>> = [];
    const batchSize = 8;
    for (const { move, rows } of planned) {
      for (let i = 0; i < rows.length; i += batchSize) {
        // The runtime cancels everything 30 s after the response: start no
        // batch it could cut off, and name every subscriber left (silent #1).
        if (
          unreached.length > 0 ||
          Date.now() - startedAt >= PRICE_FAN_OUT_BUDGET_MS
        ) {
          const left = rows.slice(i);
          counts.unhandled += left.length;
          unreached.push(
            ...left.map((row) => ({
              courseSubscriptionId: row.id,
              stripeSubscriptionId: row.stripeSubscriptionId,
              userId: row.userId,
              organizationId: row.organizationId,
              interval: move.interval,
            }))
          );
          break;
        }
        const batch = rows.slice(i, i + batchSize);
        // Each accepted notice, so a failure after it can say what was sent.
        const notified = new Map<string, PriceChangeNotice>();
        const results = await Promise.allSettled(
          batch.map((row) =>
            schedulePriceChange(
              this.stripe,
              {
                stripeSubscriptionId: row.stripeSubscriptionId,
                newPriceId: move.newPriceId,
                newAmountCents: move.newAmountCents,
                interval: move.interval,
                noticeAt,
              },
              async (notice) => {
                const accepted = await this.sendPlanPriceChangeNotice(
                  planId,
                  move,
                  row,
                  notice
                );
                if (accepted) notified.set(row.id, notice);
                return accepted;
              }
            )
          )
        );
        for (const [idx, result] of results.entries()) {
          const row = batch[idx];
          if (!row) continue;
          if (result.status === 'fulfilled') {
            const { kind } = result.value;
            if (kind === 'applied' || kind === 'pending') counts.updated++;
            // Alerted by sendPlanPriceChangeNotice.
            else if (kind === 'unnotified') counts.unnotified++;
            continue;
          }
          counts.failed++;
          const alert = moveFailureAlert(
            prefix,
            result.reason,
            notified.get(row.id),
            noticeAt
          );
          this.obs.error(alert.message, {
            errorId: crypto.randomUUID(),
            ...alert.data,
            planId,
            interval: move.interval,
            newPriceId: move.newPriceId,
            courseSubscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            userId: row.userId,
            organizationId: row.organizationId,
          });
        }
      }
    }

    if (counts.failed > 0 || counts.unnotified > 0 || counts.unhandled > 0) {
      this.obs.error(
        'Course plan price fan-out completed with failures (operator review required)',
        { errorId: crypto.randomUUID(), ...summary, ...counts }
      );
    } else {
      this.obs.info('Course plan price fan-out complete', {
        ...summary,
        ...counts,
      });
    }
    // After the summary, and count first: the per-invocation log cap drops
    // whatever comes last (review A round 2, silent R1).
    alertFanOutOutOfTime((message, data) => this.obs.error(message, data), {
      errorId: crypto.randomUUID(),
      context: summary,
      subscribers: unreached,
    });
  }

  /**
   * Send one course subscriber the notice of a plan price change and resolve
   * whether notifications-api accepted it: their move is scheduled only then
   * (D-P3, Codex-2hxff.43). A notice not accepted (no address, refused,
   * skipped, or an unknown outcome) is alerted at error with an errorId and
   * the ids support needs to retry (`noticeFailureAlert`). Never throws.
   */
  private async sendPlanPriceChangeNotice(
    planId: string,
    move: PlanPriceMove,
    row: {
      id: string;
      stripeSubscriptionId: string;
      organizationId: string | null;
      userId: string;
      userEmail: string | null;
      userName: string | null;
      courseTitle: string | null;
    },
    notice: PriceChangeNotice
  ): Promise<boolean> {
    // The "from" figure is what this subscriber is billed today, read off
    // their live item: subscribers grandfathered before #589 pay something
    // other than the plan's previous list price (Codex-2hxff.40).
    let currentAmountCents = notice.currentAmountCents;
    if (currentAmountCents === null) {
      // An error: the email may quote a figure this subscriber is not
      // billed, and PriceChangeNotice says this never happens.
      this.obs.error(
        'Course plan price notice: live price has no unit amount; quoting the plan list price',
        {
          errorId: crypto.randomUUID(),
          planId,
          courseSubscriptionId: row.id,
        }
      );
      currentAmountCents = move.oldAmountCents;
    }
    const failure = await sendPriceChangeNotice(this.mailer, {
      to: row.userEmail,
      toName: row.userName || undefined,
      templateName: 'subscription-tier-price-change',
      category: 'transactional',
      userId: row.userId,
      organizationId: row.organizationId,
      data: {
        userName: row.userName || 'there',
        planName: row.courseTitle || 'your subscription',
        oldPriceFormatted: `£${(currentAmountCents / 100).toFixed(2)}`,
        newPriceFormatted: `£${(move.newAmountCents / 100).toFixed(2)}`,
        billingInterval: move.interval,
        effectiveDate: notice.effectiveAt.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
        }),
        manageUrl: `${this.webAppUrl ?? ''}/account/subscriptions`,
      },
    });
    if (!failure) return true;

    const alert = noticeFailureAlert(
      'Course plan price fan-out: ',
      failure,
      notice
    );
    this.obs.error(alert.message, {
      errorId: crypto.randomUUID(),
      ...alert.data,
      planId,
      interval: move.interval,
      newPriceId: move.newPriceId,
      courseSubscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
      userId: row.userId,
      organizationId: row.organizationId,
    });
    return false;
  }

  /**
   * Best-effort undo of a Stripe price swap after the DB write failed: archive
   * what we created, un-archive what we archived.
   *
   * Deliberately swallows its own failures — it runs on an error path where the
   * caller is about to rethrow the real cause, and a cleanup failure must not
   * mask it. Each failure is logged individually so a genuinely diverged plan is
   * still discoverable, and one bad call does not abort the rest of the undo.
   */
  private async rollbackPriceChanges(
    createdPriceIds: string[],
    archivedPriceIds: string[],
    courseId: string
  ): Promise<void> {
    await Promise.all([
      ...createdPriceIds.map((id) =>
        this.stripe.prices.update(id, { active: false }).catch((err) =>
          this.obs.error('Failed to archive new course price during rollback', {
            courseId,
            stripePriceId: id,
            error: err instanceof Error ? err.message : String(err),
          })
        )
      ),
      ...archivedPriceIds.map((id) =>
        this.stripe.prices.update(id, { active: true }).catch((err) =>
          this.obs.error(
            'Failed to restore archived course price during rollback',
            {
              courseId,
              stripePriceId: id,
              error: err instanceof Error ? err.message : String(err),
            }
          )
        )
      ),
    ]);
  }

  /**
   * Withdraw the course subscription as a way in: flip `isActive` false so
   * `getCourseOffer` stops offering it and `createCheckoutSession` refuses.
   *
   * The Stripe Product + Prices are archived but the ROW IS KEPT (no soft
   * delete): live `course_subscriptions` carry a `planId` FK to it, and existing
   * subscribers must keep renewing and keep their entitlement. This turns off
   * NEW sales only — cancelling current subscribers is a separate, explicit act.
   *
   * Idempotent: deactivating a course with no live plan is a no-op, so the
   * panel's toggle can be pressed twice without a 404.
   */
  async deactivatePlan(
    organizationId: string,
    courseId: string
  ): Promise<void> {
    try {
      await this.getCourseInOrgOrThrow(organizationId, courseId);

      const existing = await this.getPlanForCourse(courseId);
      if (!existing) {
        return;
      }

      await this.db
        .update(courseSubscriptionPlans)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(courseSubscriptionPlans.id, existing.id));

      // Stripe cleanup is best-effort AFTER the authoritative DB flip: the offer
      // is already withdrawn, and an archive failure must not resurrect it. A row
      // with no product id (nullable column) simply has nothing to archive —
      // unlike a re-price, deactivation is complete without Stripe.
      if (existing.stripeProductId) {
        await this.stripe.products
          .update(existing.stripeProductId, { active: false })
          .catch((err) =>
            this.obs.error(
              'Failed to archive course plan product on deactivate',
              {
                courseId,
                organizationId,
                stripeProductId: existing.stripeProductId,
                error: err instanceof Error ? err.message : String(err),
              }
            )
          );
      }
    } catch (error) {
      this.handleError(error, 'deactivatePlan');
    }
  }

  /**
   * Cancel, at period end, the live course subscriptions to courses taken off
   * sale because their creator left the organisation (owner decision
   * 2026-10-21, Codex-2hxff.64: "Cancel at period end"). Each subscriber keeps
   * access until the period they paid for ends, is not charged again, and is
   * emailed `course-no-longer-offered`.
   *
   * At most `limit` per call (owner: "50 at once, rest hourly"): the removal
   * runs it for its own courses, and the hourly sweep (no `courseIds`) does
   * whatever is left. A course is off sale when `off_sale_at` is set; a
   * republish clears it, so a course put back on sale is never swept. Stripe's
   * idempotency key makes a repeat safe; the webhook then mirrors the status
   * as for any other cancel. A Stripe failure is logged at error and the row
   * stays eligible, so the next sweep retries it.
   */
  async cancelForCoursesOffSale(params: {
    courseIds?: readonly string[];
    limit: number;
  }): Promise<{ cancelled: number; failed: number; remaining: number }> {
    try {
      if (params.courseIds && params.courseIds.length === 0) {
        return { cancelled: 0, failed: 0, remaining: 0 };
      }
      const eligible = and(
        isNotNull(courses.offSaleAt),
        params.courseIds
          ? inArray(courses.id, [...params.courseIds])
          : undefined,
        // Live and not yet cancelling; the Remove dialog's preview counts the
        // same list.
        inArray(courseSubscriptions.status, [
          ...OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES,
        ]),
        eq(courseSubscriptions.cancelAtPeriodEnd, false)
      );

      const rows = await this.db
        .select({
          id: courseSubscriptions.id,
          stripeSubscriptionId: courseSubscriptions.stripeSubscriptionId,
          status: courseSubscriptions.status,
          currentPeriodEnd: courseSubscriptions.currentPeriodEnd,
          organizationId: courseSubscriptions.organizationId,
          userId: courseSubscriptions.userId,
          userEmail: users.email,
          userName: users.name,
          courseTitle: courses.title,
          orgName: organizations.name,
        })
        .from(courseSubscriptions)
        .innerJoin(courses, eq(courses.id, courseSubscriptions.courseId))
        .leftJoin(users, eq(users.id, courseSubscriptions.userId))
        .leftJoin(organizations, eq(organizations.id, courses.organizationId))
        .where(eligible)
        .limit(params.limit);

      let cancelled = 0;
      let failed = 0;
      const batchSize = 8;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((row) =>
            this.stripe.subscriptions.update(
              row.stripeSubscriptionId,
              { cancel_at_period_end: true },
              { idempotencyKey: `course_off_sale_cancel_${row.id}` }
            )
          )
        );
        for (const [idx, result] of results.entries()) {
          const row = batch[idx];
          if (!row) continue;
          if (result.status === 'rejected') {
            failed += 1;
            this.obs.error('Course subscription off-sale cancel failed', {
              courseSubscriptionId: row.id,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
            continue;
          }
          cancelled += 1;
          await this.db
            .update(courseSubscriptions)
            .set({
              cancelAtPeriodEnd: true,
              // `active` + cancel-at-period-end is `cancelling`; a past-due
              // or paused row keeps its status (resolveStatus, the webhook).
              ...(row.status === 'active' ? { status: 'cancelling' } : {}),
              updatedAt: new Date(),
            })
            .where(eq(courseSubscriptions.id, row.id));
          this.sendCourseNoLongerOffered(row);
        }
      }

      const [left] = await this.db
        .select({ total: count() })
        .from(courseSubscriptions)
        .innerJoin(courses, eq(courses.id, courseSubscriptions.courseId))
        .where(eligible);
      const remaining = Number(left?.total ?? 0);
      if (rows.length > 0) {
        this.obs.info('Course subscriptions cancelled for courses off sale', {
          cancelled,
          failed,
          remaining,
        });
      }
      return { cancelled, failed, remaining };
    } catch (error) {
      this.handleError(error, 'cancelForCoursesOffSale');
    }
  }

  /** Tell one subscriber their course is no longer offered. Never throws. */
  private sendCourseNoLongerOffered(row: {
    id: string;
    userId: string;
    organizationId: string | null;
    userEmail: string | null;
    userName: string | null;
    courseTitle: string | null;
    orgName: string | null;
    currentPeriodEnd: Date;
  }): void {
    if (!row.userEmail) return;
    try {
      this.offSaleMailer({
        to: row.userEmail,
        toName: row.userName || undefined,
        templateName: 'course-no-longer-offered',
        category: 'transactional',
        userId: row.userId,
        organizationId: row.organizationId,
        data: {
          userName: row.userName || 'there',
          courseTitle: row.courseTitle || 'your course',
          orgName: row.orgName || 'the organisation',
          accessUntil: row.currentPeriodEnd.toLocaleDateString('en-GB', {
            timeZone: 'UTC',
          }),
          manageUrl: `${this.webAppUrl ?? ''}/account/subscriptions`,
        },
      });
    } catch (error) {
      this.obs.warn('Course off-sale notice: mailer threw', {
        courseSubscriptionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ─── Checkout ────────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout session (`mode: 'subscription'`) for a course sub.
   * Platform-charge model (no `transfer_data`) so `invoice.payment_succeeded`
   * fans out the split via `source_transaction`, exactly like org subs.
   *
   * One open session per buyer and course plan (Codex-2hxff.15, owner
   * decision "Block early, same as purchases"): a second tab gets the first
   * tab's Stripe page, and the other interval replaces it. It expires after 30
   * minutes.
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
            inArray(courseSubscriptions.status, [
              ...ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
            ])
          )
        )
        .limit(1);
      if (existing) {
        throw new AlreadyCourseSubscribedError(userId, input.courseId);
      }

      // The organisation owner must be payable, as for an organisation tier
      // (Codex-2hxff.12): every invoice carries an org slice, and the course
      // checkout used to open without this check.
      const payee = await resolveOrganisationPayee(
        this.db,
        course.organizationId
      );
      if (!payee?.account?.chargesEnabled || !payee.account.payoutsEnabled) {
        throw new ConnectAccountNotReadyError(course.organizationId);
      }

      const monthly = input.billingInterval === BILLING_INTERVAL.MONTH;
      const stripePriceId = monthly
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
        // On the session AND (via subscription_data) the subscription, whose
        // invoices snapshot it — the tag the webhook guard reads (Codex-2hxff.5).
        ...stripeEnvMetadata(this.environment),
      };

      const reserved = await this.checkoutReservations.reserve({
        kind: CHECKOUT_SESSION_KIND.SUBSCRIPTION,
        customerId: userId,
        courseId: input.courseId,
        stripePriceId,
        amountCents: monthly ? plan.priceMonthly : plan.priceAnnual,
      });
      if (reserved.url && reserved.stripeSessionId) {
        return {
          sessionUrl: reserved.url,
          sessionId: reserved.stripeSessionId,
        };
      }

      const email = user.email;
      return await this.checkoutReservations.create(reserved, () =>
        withStaleCustomerRecovery(
          { db: this.db, stripe: this.stripe, obs: this.obs },
          { userId, email, environment: this.environment },
          (stripeCustomerId) =>
            this.stripe.checkout.sessions.create(
              {
                mode: 'subscription',
                customer: stripeCustomerId,
                line_items: [{ price: stripePriceId, quantity: 1 }],
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
                metadata,
                subscription_data: { metadata },
                expires_at: toStripeTime(reserved.expiresAt),
              },
              {
                idempotencyKey: checkoutIdempotencyKey(
                  reserved,
                  stripeCustomerId
                ),
              }
            ),
          {
            onStaleRecovery: (info) =>
              this.obs.warn(
                'Stale users.stripe_customer_id detected; clearing and retrying',
                { ...info, courseId: input.courseId }
              ),
          }
        )
      );
    } catch (error) {
      this.handleError(error, 'createCheckoutSession');
    }
  }

  /**
   * Verify a course-plan Checkout session for the journey success page, as
   * `SubscriptionService.verifyCheckoutSession` does for tiers: ownership by
   * `metadata.codex_user_id`, and a `subscription` only once our row exists
   * (the caller keeps polling until then). A duplicate's carries `duplicateOf`
   * (Codex-o4jvw).
   */
  async verifyCheckoutSession(
    sessionId: string,
    userId: string
  ): Promise<CourseSubscriptionCheckoutVerifyResult> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.codex_user_id !== userId) {
        throw new ForbiddenError(
          'Checkout session does not belong to authenticated user',
          { sessionId }
        );
      }

      const result: CourseSubscriptionCheckoutVerifyResult = {
        sessionStatus:
          (session.status as 'complete' | 'expired' | 'open') ?? 'open',
      };
      if (result.sessionStatus !== 'complete') return result;

      const stripeSubId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      if (!stripeSubId) return result;

      const row = await this.db.query.courseSubscriptions.findFirst({
        where: and(
          eq(courseSubscriptions.stripeSubscriptionId, stripeSubId),
          eq(courseSubscriptions.userId, userId)
        ),
        with: { course: { columns: { title: true } } },
      });
      if (row) {
        result.subscription = {
          id: row.id,
          courseId: row.courseId,
          courseTitle: row.course.title,
          startedAt: row.createdAt.toISOString(),
          // isDuplicateSubscription: the row names the one the user keeps.
          ...(row.duplicateOfCourseSubscriptionId
            ? { duplicateOf: { id: row.duplicateOfCourseSubscriptionId } }
            : {}),
        };
      }
      return result;
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      if (
        error instanceof Error &&
        'type' in error &&
        (error as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        // The context is sent to the client verbatim, so Stripe's own message
        // is logged here instead (Codex-2hxff.23 SEC-02). The session id came
        // from the client (a stale or invented success URL), so it is a
        // warning; any other failure reaches handleError, at error.
        const errorId = crypto.randomUUID();
        this.obs.warn('Course checkout session could not be retrieved', {
          errorId,
          sessionId,
          userId,
          code: stripeErrorCode(error),
          error: error.message,
        });
        throw new SubscriptionCheckoutError('Checkout session not found', {
          sessionId,
          errorId,
        });
      }
      this.handleError(error, 'verifyCheckoutSession');
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

  /** The row a Stripe subscription is recorded as, if any. */
  private async findByStripeId(
    stripeSubscriptionId: string
  ): Promise<CourseSubscription | undefined> {
    const [row] = await this.db
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return row;
  }

  /**
   * The row a Stripe subscription describes, from its course metadata and
   * first item. Null, logged, when the metadata is missing.
   */
  private rowFromStripe(
    stripeSub: Stripe.Subscription
  ): typeof courseSubscriptions.$inferInsert | null {
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
    const periodStart = item?.current_period_start ?? 0;
    const periodEnd = item?.current_period_end ?? 0;
    return {
      userId,
      courseId,
      planId,
      organizationId,
      stripeSubscriptionId: stripeSub.id,
      stripeCustomerId:
        typeof stripeSub.customer === 'string'
          ? stripeSub.customer
          : stripeSub.customer.id,
      status: resolveStatus(
        stripeSub.status,
        stripeSub.cancel_at_period_end ?? false,
        'active'
      ),
      billingInterval:
        item?.price?.recurring?.interval === 'year'
          ? BILLING_INTERVAL.YEAR
          : BILLING_INTERVAL.MONTH,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
    };
  }

  /**
   * Ensure the `course_subscriptions` row exists (self-heal on webhook-ordering
   * races, mirroring `ensureSubscriptionDataPresent`). Returns null when the
   * subscription lacks course metadata.
   */
  private async ensureDataPresent(
    stripeSub: Stripe.Subscription
  ): Promise<{ row: CourseSubscription; justInserted: boolean } | null> {
    const existing = await this.findByStripeId(stripeSub.id);
    if (existing) return { row: existing, justInserted: false };
    const values = this.rowFromStripe(stripeSub);
    return values ? this.recordUnderLock(values) : null;
  }

  /**
   * Run `fn` in a transaction holding the per-buyer, per-course advisory lock
   * (Codex-2hxff.15). Every write that records a course subscription, ends
   * it, or writes or revokes its grant takes it, so a deletion cannot
   * interleave with a grant for the same buyer and course: a grant written
   * after it sees the tombstone, and one written before it is revoked by it.
   */
  private withCourseLock<T>(
    key: { userId: string; courseId: string },
    fn: (tx: Tx) => Promise<T>
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`course-subscription:${key.userId}:${key.courseId}`}))`
      );
      return fn(tx);
    });
  }

  /**
   * Inside the lock: the buyer's live subscription to the course, other than
   * `exceptId`, if any.
   */
  private async liveRow(
    tx: Tx,
    key: { userId: string; courseId: string },
    exceptId?: string
  ): Promise<{ id: string } | undefined> {
    const [live] = await tx
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(
        and(
          eq(courseSubscriptions.userId, key.userId),
          eq(courseSubscriptions.courseId, key.courseId),
          inArray(courseSubscriptions.status, [
            ...ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
          ]),
          ...(exceptId ? [ne(courseSubscriptions.id, exceptId)] : [])
        )
      )
      .limit(1);
    return live;
  }

  /**
   * Insert a subscription's row under the lock, then look again, as
   * `PurchaseService.lockForItem` does. The lock serialises the events of
   * one buyer's subscriptions to one course, so:
   *
   * - this subscription's own row, written by a concurrent event while this
   *   one waited, is returned as it is;
   * - a second subscription to a course the buyer holds live (two payment
   *   pages paid before either was recorded) is recorded `cancelled`, a
   *   duplicate of the live one (owner decision 2026-10-22, "Keep the
   *   first"). Cancelled, it is outside the one-live-per-course index. It
   *   grants and pays nothing; the caller settles it after the commit.
   */
  private async recordUnderLock(
    values: typeof courseSubscriptions.$inferInsert
  ): Promise<{ row: CourseSubscription; justInserted: boolean }> {
    const recorded = await this.withCourseLock(values, async (tx) => {
      const [replay] = await tx
        .select()
        .from(courseSubscriptions)
        .where(
          eq(
            courseSubscriptions.stripeSubscriptionId,
            values.stripeSubscriptionId
          )
        )
        .limit(1);
      if (replay) return { row: replay, justInserted: false };

      const live = await this.liveRow(tx, values);
      const [row] = await tx
        .insert(courseSubscriptions)
        .values(
          live
            ? {
                ...values,
                status: SUBSCRIPTION_STATUS.CANCELLED,
                cancelledAt: values.cancelledAt ?? new Date(),
                duplicateOfCourseSubscriptionId: live.id,
              }
            : values
        )
        .returning();
      if (!row) {
        throw new InternalServiceError(
          'course subscription row missing after insert',
          { stripeSubscriptionId: values.stripeSubscriptionId }
        );
      }
      return { row, justInserted: true };
    });

    if (recorded.justInserted && isDuplicateSubscription(recorded.row)) {
      this.obs.warn('Second course subscription recorded as a duplicate', {
        courseSubscriptionId: recorded.row.id,
        duplicateOfCourseSubscriptionId:
          recorded.row.duplicateOfCourseSubscriptionId,
        stripeSubscriptionId: recorded.row.stripeSubscriptionId,
        courseId: recorded.row.courseId,
      });
    }
    return recorded;
  }

  /**
   * Settle a duplicate after the commit: cancel it at Stripe and refund every
   * payment it took, once (`duplicateSettledAt`), so a later event for it asks
   * Stripe nothing. Each refund's `charge.refunded` emails the buyer.
   *
   * If Stripe refuses, the row stays unsettled: the buyer is owed the money.
   * The failure is logged with Stripe's code and thrown as retryable whatever
   * its cause, so Stripe redelivers the event through its retry window, as
   * `PurchaseService.refundDuplicatePayment` does. One that never clears is
   * held for support (owner decision: a failed refund is held for support).
   */
  private async settleDuplicate(row: CourseSubscription): Promise<void> {
    if (row.duplicateSettledAt) return;
    let refundedInvoices: number;
    try {
      ({ refundedInvoices } = await cancelAndRefundDuplicate(this.stripe, {
        stripeSubscriptionId: row.stripeSubscriptionId,
        environment: this.environment,
      }));
    } catch (error) {
      this.obs.error(
        'Duplicate course subscription could not be cancelled and refunded',
        {
          errorId: crypto.randomUUID(),
          courseSubscriptionId: row.id,
          duplicateOfCourseSubscriptionId: row.duplicateOfCourseSubscriptionId,
          stripeSubscriptionId: row.stripeSubscriptionId,
          code: stripeErrorCode(error),
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new ServiceUnavailableError(
        'Duplicate course subscription refund failed; it will be retried',
        { courseSubscriptionId: row.id }
      );
    }
    await this.db
      .update(courseSubscriptions)
      .set({ duplicateSettledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(courseSubscriptions.id, row.id),
          isNull(courseSubscriptions.duplicateSettledAt)
        )
      );
    this.obs.warn('Duplicate course subscription cancelled and refunded', {
      courseSubscriptionId: row.id,
      duplicateOfCourseSubscriptionId: row.duplicateOfCourseSubscriptionId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      refundedInvoices,
    });
  }

  /**
   * Refund one paid invoice of a duplicate by its charge, whether or not the
   * duplicate is settled. A delayed payment method (Bacs Direct Debit and
   * others; subscription checkouts don't restrict `payment_method_types`)
   * can be paid after the settle found nothing to refund. The key is the one
   * `cancelAndRefundDuplicate` uses, so a refund it made is not made twice. A
   * failure is retryable, as in {@link settleDuplicate}.
   */
  private async refundDuplicateInvoice(
    row: CourseSubscription,
    invoice: Stripe.Invoice
  ): Promise<void> {
    if (!invoice.id || invoice.amount_paid <= 0) return;
    try {
      const chargeId = await resolveInvoiceCharge(this.stripe, invoice);
      if (!chargeId) {
        throw new InternalServiceError(
          'A paid invoice of a duplicate course subscription has no charge to refund',
          { courseSubscriptionId: row.id, invoiceId: invoice.id }
        );
      }
      await issueRefund(this.stripe, {
        chargeId,
        reason: 'duplicate',
        idempotencyKey: `refund_duplicate_${invoice.id}`,
        environment: this.environment,
      });
    } catch (error) {
      this.obs.error('Duplicate course subscription invoice not refunded', {
        errorId: crypto.randomUUID(),
        courseSubscriptionId: row.id,
        duplicateOfCourseSubscriptionId: row.duplicateOfCourseSubscriptionId,
        invoiceId: invoice.id,
        code: stripeErrorCode(error),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableError(
        'Duplicate course subscription refund failed; it will be retried',
        { courseSubscriptionId: row.id }
      );
    }
  }

  /**
   * Settle the duplicates still owed to their buyers: recorded more than
   * `olderThanMs` ago and never settled, because Stripe refused every
   * delivery's attempt. For the hourly sweep (the owner decision holds a
   * failed refund for support; this makes it visible). One row's failure is
   * logged by {@link settleDuplicate} and the rest carry on; the rows that
   * stay owed are returned.
   */
  async settleOwedDuplicates(params: {
    olderThanMs: number;
    limit: number;
  }): Promise<{
    settled: number;
    stillOwed: Array<{ id: string; stripeSubscriptionId: string }>;
  }> {
    const recordedBefore = new Date(Date.now() - params.olderThanMs);
    const owed = await this.db
      .select()
      .from(courseSubscriptions)
      .where(
        and(
          isNotNull(courseSubscriptions.duplicateOfCourseSubscriptionId),
          isNull(courseSubscriptions.duplicateSettledAt),
          lt(courseSubscriptions.createdAt, recordedBefore)
        )
      )
      .orderBy(asc(courseSubscriptions.createdAt))
      .limit(params.limit);

    let settled = 0;
    const stillOwed: Array<{ id: string; stripeSubscriptionId: string }> = [];
    for (const row of owed) {
      try {
        await this.settleDuplicate(row);
        settled += 1;
      } catch (error) {
        // A refused Stripe step is logged by settleDuplicate, with its
        // errorId and Stripe's code; anything else (its row write) is here.
        if (!(error instanceof ServiceUnavailableError)) {
          this.obs.error('Owed duplicate course subscription not settled', {
            errorId: crypto.randomUUID(),
            courseSubscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            code: stripeErrorCode(error),
            error: error instanceof Error ? error.message : String(error),
          });
        }
        stillOwed.push({
          id: row.id,
          stripeSubscriptionId: row.stripeSubscriptionId,
        });
      }
    }
    return { settled, stillOwed };
  }

  /**
   * Inside the lock: write or extend the subscription's grant to `expiresAt`
   * if its row, read again now, still grants access — not ended, not a
   * duplicate, and in an access-granting status. Returns whether it did.
   */
  private async grantIfLive(
    tx: Tx,
    courseSubscriptionId: string,
    expiresAt: Date
  ): Promise<boolean> {
    const [row] = await tx
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.id, courseSubscriptionId))
      .limit(1);
    if (
      !row ||
      row.endedAt ||
      isDuplicateSubscription(row) ||
      !subscriptionStatusGrantsAccess(row.status)
    ) {
      return false;
    }
    await writeCourseSubscriptionEntitlement(tx, {
      userId: row.userId,
      organizationId: row.organizationId,
      courseId: row.courseId,
      courseSubscriptionId: row.id,
      expiresAt,
    });
    return true;
  }

  /**
   * Stripe ended it: cancelled, with the tombstone (`endedAt`) no later event
   * changes, and its own grant revoked, under the lock. Safe to repeat.
   */
  private async endCourseSubscription(
    row: CourseSubscription
  ): Promise<CourseSubscriptionWebhookResult> {
    const at = new Date();
    await this.withCourseLock(row, async (tx) => {
      await tx
        .update(courseSubscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLED,
          cancelledAt: sql`COALESCE(${courseSubscriptions.cancelledAt}, ${at})`,
          endedAt: sql`COALESCE(${courseSubscriptions.endedAt}, ${at})`,
          updatedAt: at,
        })
        .where(eq(courseSubscriptions.id, row.id));
      await revokeCourseSubscriptionEntitlement(tx, {
        courseSubscriptionId: row.id,
      });
    });

    this.obs.info('Course subscription cancelled', {
      courseSubscriptionId: row.id,
      courseId: row.courseId,
      userId: row.userId,
    });
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * An old subscription paid back to life (an `unpaid` one whose open invoice
   * was paid) while the buyer holds a newer live one to the course (owner
   * decision 7, "Cancel old, refund it"). The newer one stays.
   *
   * Stripe first, each step idempotent, in this order:
   * 1. ONLY the invoice that revived it is refunded — earlier invoices really
   *    bought access;
   * 2. then it is cancelled now with no proration (unless Stripe has ended
   *    it);
   * 3. then its row is tombstoned under the lock; it keeps no grant and pays
   *    no one.
   * Refunding first is what makes a retry safe. Cancelled first, a refused
   * refund would leave it ended at Stripe, and the redelivery would no longer
   * see a revival: it would pay out the invoice instead of refunding it. A
   * refused step leaves the row unchanged and is retryable, so the
   * redelivery repeats the steps (the refund under the same key, or Stripe
   * answers that the charge is refunded already) and then writes the row.
   *
   * `revivingInvoice` is the paid invoice, or (from `updated`) the
   * subscription's `latest_invoice`, refunded only if it was paid.
   */
  private async endRevived(
    row: CourseSubscription,
    supersededById: string,
    revivingInvoice: Stripe.Invoice | string | null
  ): Promise<void> {
    let refundedInvoiceId: string | null = null;
    try {
      const invoice =
        typeof revivingInvoice === 'string'
          ? await this.stripe.invoices.retrieve(revivingInvoice)
          : revivingInvoice;
      if (invoice?.id && invoice.status === 'paid' && invoice.amount_paid > 0) {
        const chargeId = await resolveInvoiceCharge(this.stripe, invoice);
        if (!chargeId) {
          throw new InternalServiceError(
            'The invoice that revived an old course subscription has no charge to refund',
            { courseSubscriptionId: row.id, invoiceId: invoice.id }
          );
        }
        await issueRefund(this.stripe, {
          chargeId,
          reason: 'requested_by_customer',
          idempotencyKey: `refund_revived_${invoice.id}`,
          environment: this.environment,
        });
        refundedInvoiceId = invoice.id;
      }

      const live = await this.stripe.subscriptions.retrieve(
        row.stripeSubscriptionId
      );
      if (live.status !== 'canceled' && live.status !== 'incomplete_expired') {
        await this.stripe.subscriptions.cancel(
          row.stripeSubscriptionId,
          {
            prorate: false,
            cancellation_details: {
              comment: 'Revived next to a newer subscription to the course',
            },
          },
          { idempotencyKey: `revived_cancel_${row.stripeSubscriptionId}` }
        );
      }
    } catch (error) {
      this.obs.error(
        'Revived course subscription could not be refunded and cancelled',
        {
          errorId: crypto.randomUUID(),
          courseSubscriptionId: row.id,
          supersededByCourseSubscriptionId: supersededById,
          stripeSubscriptionId: row.stripeSubscriptionId,
          code: stripeErrorCode(error),
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new ServiceUnavailableError(
        'Revived course subscription refund failed; it will be retried',
        { courseSubscriptionId: row.id }
      );
    }

    const at = new Date();
    await this.withCourseLock(row, async (tx) => {
      await tx
        .update(courseSubscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLED,
          cancelledAt: sql`COALESCE(${courseSubscriptions.cancelledAt}, ${at})`,
          endedAt: sql`COALESCE(${courseSubscriptions.endedAt}, ${at})`,
          updatedAt: at,
        })
        .where(eq(courseSubscriptions.id, row.id));
      await revokeCourseSubscriptionEntitlement(tx, {
        courseSubscriptionId: row.id,
      });
    });
    this.obs.warn(
      'Old course subscription revived next to a newer one: refunded and cancelled',
      {
        courseSubscriptionId: row.id,
        supersededByCourseSubscriptionId: supersededById,
        stripeSubscriptionId: row.stripeSubscriptionId,
        refundedInvoiceId,
      }
    );
  }

  /**
   * Whether a charge has been refunded in full, so a late invoice on an ended
   * subscription pays no one rather than paying out only to be reversed.
   * Slices recorded after a refund are clawed back anyway
   * (`reverseEarlierRefunds`), but that reads the refunds we have recorded,
   * and a refund just made (a revival's) may not be recorded yet: Stripe is
   * asked here.
   */
  private async chargeRefundedInFull(chargeId: string): Promise<boolean> {
    const charge = await this.stripe.charges.retrieve(chargeId);
    return (
      charge.refunded === true ||
      (charge.amount > 0 && charge.amount_refunded >= charge.amount)
    );
  }

  /**
   * checkout.session.completed (course sub): ensure the row + write the
   * `course_subscription` entitlement (expiresAt = currentPeriodEnd) + auto-enroll.
   *
   * A duplicate is settled and grants nothing. Nor does a row Stripe has
   * ended (a redelivery after the deletion), or one whose status grants no
   * access (`incomplete`).
   */
  async handleCourseSubscriptionCreated(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;
    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      return;
    }
    const granted = await this.withCourseLock(row, (tx) =>
      this.grantIfLive(tx, row.id, row.currentPeriodEnd)
    );
    if (!granted) {
      this.obs.info('Course subscription not granted: ended or not live', {
        courseSubscriptionId: row.id,
        status: row.status,
      });
      return;
    }

    this.obs.info('Course subscription activated', {
      courseSubscriptionId: row.id,
      courseId: row.courseId,
      userId: row.userId,
    });
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * invoice.payment_succeeded (course sub): refresh the period + status, write
   * or extend the grant to the new period end, then fan out the
   * recurring-revenue payout for the invoice charge.
   *
   * `stripeSub` is the live subscription (the webhook retrieves it), so an
   * `unpaid` subscription whose open invoice the customer paid, which Stripe
   * reports active again, gets its access back (owner decision 2026-10-22,
   * "Yes, like tiers") — unless the buyer has since taken a newer one, when
   * the old one is cancelled and this invoice refunded instead
   * ({@link endRevived}). Only the subscription's latest invoice revives it:
   * a redelivered earlier one retires it too, refunding the latest, but it
   * bought real access, so it is not refunded and pays out as usual.
   *
   * A duplicate is settled, and this invoice refunded, and it pays no one. A
   * row Stripe has ended is left as it is, grant included, but the invoice
   * was paid, so it still pays out — unless its charge was refunded in full.
   * That is checked whenever the row has ended (read again under the lock)
   * or the subscription is not live: a revival being refunded by a
   * concurrent event must not be paid out.
   */
  async handleCourseInvoicePaymentSucceeded(
    stripeInvoice: Stripe.Invoice,
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;
    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      await this.refundDuplicateInvoice(row, stripeInvoice);
      return;
    }

    const result = {
      userId: row.userId,
      organizationId: row.organizationId ?? '',
    };
    const status = resolveStatus(
      stripeSub.status,
      stripeSub.cancel_at_period_end ?? false,
      'active'
    );
    if (row.endedAt) {
      this.obs.info('Invoice for an ended course subscription: row kept', {
        courseSubscriptionId: row.id,
        invoiceId: stripeInvoice.id,
      });
    } else {
      const item = stripeSub.items.data[0];
      const periodStart = item?.current_period_start ?? 0;
      const periodEnd = item?.current_period_end ?? 0;
      const newPeriodEnd = new Date(periodEnd * 1000);

      // Under the lock, and only while the row has not ended: a deletion that
      // won the lock leaves it as it is. Then extend the stored grant to the
      // new period end (fail-closed between renewals), or write it afresh
      // when `unpaid` had revoked it. A revival next to a newer live
      // subscription writes nothing here.
      const supersededBy = await this.withCourseLock(row, async (tx) => {
        const newer = subscriptionStatusGrantsAccess(status)
          ? await this.liveRow(tx, row, row.id)
          : undefined;
        if (newer) return newer.id;
        await tx
          .update(courseSubscriptions)
          .set({
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: newPeriodEnd,
            status,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(courseSubscriptions.id, row.id),
              isNull(courseSubscriptions.endedAt)
            )
          );
        await this.grantIfLive(tx, row.id, newPeriodEnd);
        return null;
      });
      if (supersededBy) {
        const latest = stripeSub.latest_invoice;
        const latestId = typeof latest === 'string' ? latest : latest?.id;
        if (latestId === stripeInvoice.id) {
          await this.endRevived(row, supersededBy, stripeInvoice);
          return;
        }
        // An earlier invoice: retired here too, as tiers do, refunding the
        // latest invoice that revived it. This one bought real access, so it
        // is not refunded and pays out below.
        await this.endRevived(row, supersededBy, latest ?? null);
      }
    }

    // GBP-only: every slice is transferred in pounds (Codex-2hxff.23 PAY-25).
    // The subscriber paid, so the renewal above stands and they keep access;
    // only the payouts are refused, and a person settles them by hand. (A
    // tier invoice is refused before it writes anything, but tier access
    // follows the subscription's status, not the invoice.)
    if (!isGbpOrUnset(stripeInvoice.currency)) {
      this.obs.error(
        'Non-GBP course subscription invoice: access renewed, payouts not recorded',
        {
          errorId: crypto.randomUUID(),
          courseSubscriptionId: row.id,
          invoiceId: stripeInvoice.id,
          currency: stripeInvoice.currency,
        }
      );
      return result;
    }

    const chargeId = await resolveInvoiceCharge(this.stripe, stripeInvoice);
    if (!chargeId) {
      this.obs.warn(
        'Course subscription invoice has no charge — skipping payouts',
        { courseSubscriptionId: row.id, invoiceId: stripeInvoice.id }
      );
      return result;
    }
    const [current] = await this.withCourseLock(row, (tx) =>
      tx
        .select({ endedAt: courseSubscriptions.endedAt })
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.id, row.id))
        .limit(1)
    );
    if (
      (current?.endedAt || !subscriptionStatusGrantsAccess(status)) &&
      (await this.chargeRefundedInFull(chargeId))
    ) {
      this.obs.info(
        'Invoice for a course subscription that is not live was refunded in full — skipping payouts',
        { courseSubscriptionId: row.id, invoiceId: stripeInvoice.id, chargeId }
      );
      return result;
    }

    // The invoice's creation time decides the split (Codex-2hxff.2) — the
    // same guard as the tier path's `invoiceCreatedAt`.
    const invoiceCreatedAt =
      typeof stripeInvoice.created === 'number'
        ? new Date(stripeInvoice.created * 1000)
        : new Date();
    await this.writeCoursePayouts(
      row,
      stripeInvoice.amount_paid,
      chargeId,
      invoiceCreatedAt
    );
    // A refund or chargeback handled before this invoice found no slices to
    // claw back (Codex-2hxff.67): it is clawed back now, as if it had come
    // after. Its failure comes with the result (`AfterCommitError`), so the
    // webhook still refreshes the buyer's library.
    const finish = await reverseEarlierRefundsAfterCommit(
      {
        db: this.db,
        stripe: this.stripe,
        obs: this.obs,
        environment: this.environment,
      },
      { chargeId, source: { sourceType: 'subscription' } }
    );

    return finish(result);
  }

  /**
   * customer.subscription.updated (course sub): mirror status/period. While the
   * status grants access — including `past_due`, as Stripe retries a failed
   * renewal (owner decision P-3) — the grant is written or extended to the
   * period end; otherwise it would lapse at the old one, since only a PAID
   * renewal moves it on. That write is also what gives an `unpaid`
   * subscription, paid again, its access back (owner decision 2026-10-22).
   * `unpaid` is access-reducing → revoke the grant immediately.
   *
   * Stripe does not order events, so the payload can be stale. A CANCELLED
   * row comes back only if the live subscription says so: an `updated` from
   * before it went `unpaid` can arrive after the one that took access away.
   * Ended at Stripe, it is tombstoned; tombstoned, it is never changed. A
   * duplicate is settled and changes nothing. Revived next to a newer live
   * subscription, it is cancelled and its latest invoice refunded
   * ({@link endRevived}).
   */
  async handleCourseSubscriptionUpdated(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;
    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      return;
    }
    if (row.endedAt) {
      this.obs.info('Late course subscription event ignored: it has ended', {
        courseSubscriptionId: row.id,
        eventStatus: stripeSub.status,
      });
      return;
    }

    const priorStatus = row.status as Parameters<typeof resolveStatus>[2];
    const reviving =
      row.status === SUBSCRIPTION_STATUS.CANCELLED &&
      resolveStatus(
        stripeSub.status,
        stripeSub.cancel_at_period_end ?? false,
        priorStatus
      ) !== SUBSCRIPTION_STATUS.CANCELLED;
    const current = reviving
      ? await this.stripe.subscriptions.retrieve(stripeSub.id)
      : stripeSub;
    if (
      current.status === 'canceled' ||
      current.status === 'incomplete_expired'
    ) {
      return this.endCourseSubscription(row);
    }

    const item = current.items.data[0];
    const status = resolveStatus(
      current.status,
      current.cancel_at_period_end ?? false,
      priorStatus
    );
    const currentPeriodEnd = item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : row.currentPeriodEnd;
    // Under the lock, and only while the row has not ended, as for invoices.
    const supersededBy = await this.withCourseLock(row, async (tx) => {
      const newer = subscriptionStatusGrantsAccess(status)
        ? await this.liveRow(tx, row, row.id)
        : undefined;
      if (newer) return newer.id;
      await tx
        .update(courseSubscriptions)
        .set({
          status,
          cancelAtPeriodEnd: current.cancel_at_period_end ?? false,
          currentPeriodEnd,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(courseSubscriptions.id, row.id),
            isNull(courseSubscriptions.endedAt)
          )
        );
      const granted = await this.grantIfLive(tx, row.id, currentPeriodEnd);
      if (!granted && current.status === 'unpaid') {
        await revokeCourseSubscriptionEntitlement(tx, {
          courseSubscriptionId: row.id,
        });
      }
      return null;
    });
    if (supersededBy) {
      await this.endRevived(row, supersededBy, current.latest_invoice ?? null);
      return;
    }
    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * customer.subscription.deleted (course sub): mark cancelled + REVOKE this
   * subscription's grant so the resolver stops granting immediately, leaving
   * the tombstone every later event respects (Codex-2hxff.15).
   *
   * Deleted before we recorded it, the tombstone is written from its metadata
   * (only when it is tagged with this environment), so a late
   * `checkout.session.completed` or `updated` cannot record it live. A
   * duplicate is settled and changes nothing.
   */
  async handleCourseSubscriptionDeleted(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
    let row = await this.findByStripeId(stripeSub.id);
    if (!row) {
      const tagged =
        stripeSub.metadata?.[STRIPE_ENV_METADATA_KEY] === this.environment;
      const values = tagged ? this.rowFromStripe(stripeSub) : null;
      if (!values) {
        this.obs.warn(
          'Course subscription deleted before it was recorded; no tombstone',
          { stripeSubscriptionId: stripeSub.id, tagged }
        );
        return;
      }
      const endedAt = new Date();
      ({ row } = await this.recordUnderLock({
        ...values,
        status: SUBSCRIPTION_STATUS.CANCELLED,
        cancelledAt: endedAt,
        endedAt,
      }));
    }
    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      return;
    }
    return this.endCourseSubscription(row);
  }

  // ─── Payout fan-out (Option B platform charge — mirrors writePurchasePayouts) ─

  /**
   * Split a course-subscription invoice charge and fan out the creator + org
   * secondary transfers, writing `payouts` rows attributed by
   * `courseSubscriptionId` (§H3). ctx='subscription' (recurring), and per
   * HARDENING §H4 the creator's `subscription` revenue-share agreement applies.
   *
   * `invoiceCreatedAt` is the one clock for the split (Codex-2hxff.2): the
   * agreements active then, and the org's owner then, decide it — so a late
   * webhook retry pays what the sale earned, not what it would earn today.
   */
  private async writeCoursePayouts(
    sub: CourseSubscription,
    amountCents: number,
    stripeChargeId: string,
    invoiceCreatedAt: Date
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

    // Idempotency: `invoice.payment_succeeded` can redeliver. Every slice is
    // reserved by a per-charge unique key before any transfer (Codex-2hxff.11),
    // and the creator and organisation slices are reserved together, once
    // (`recordSplitOnce`, Codex-2hxff.49): a slice recorded stands, so a fee
    // change between deliveries cannot re-size it. A delivery that died after
    // the platform fee, or between the slices (the per-slice writer before
    // this), is completed by the redelivery from what the charge has left.

    const fees = await this.feeConfig.getFeesForCreator(
      organizationId,
      creatorId,
      'subscription'
    );

    const agreement = await findActiveCreatorAgreementShare(this.db, {
      organizationId,
      creatorId,
      revenueType: 'subscription',
      at: invoiceCreatedAt,
      obs: this.obs,
    });
    const effectiveOrgFeePercent = agreement
      ? 10_000 - agreement.sharePercent
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
      agreementApplied: agreement !== null,
      source: 'course_subscription',
    });

    const ledger: LedgerDeps = {
      db: this.db,
      stripe: this.stripe,
      obs: this.obs,
      environment: this.environment,
    };
    const source = {
      sourceType: 'subscription',
      courseSubscriptionId: sub.id,
    } as const;
    const transferGroup = `course_sub_${sub.id}`;

    // 1. Platform fee — retained on the platform balance (no transfer). A
    // replay keeps the fee an earlier delivery recorded, and the pool is the
    // gross minus it, split by the same organisation share, so the slices sum
    // to the gross (owner decision 2026-10-23, "Keep recorded fee").
    const recordedFeeCents = await recordPlatformFee(ledger, {
      amountCents: split.platformFeeCents,
      organizationId,
      source,
      stripeChargeId,
      transferGroup,
      unlessSplit: true,
    });
    let pool: { organizationFeeCents: number; creatorPayoutCents: number } =
      split;
    if (recordedFeeCents !== split.platformFeeCents) {
      this.obs.warn(
        'A replay found a different platform fee on record; the rest of the charge is split from it',
        {
          courseSubscriptionId: sub.id,
          organizationId,
          stripeChargeId,
          recordedFeeCents,
          computedFeeCents: split.platformFeeCents,
        }
      );
      pool = calculateRevenueSplit(
        Math.max(amountCents - recordedFeeCents, 0),
        0,
        effectiveOrgFeePercent
      );
    }

    const slices: RecordSliceInput[] = [];
    // 2. Creator payout — to the course creator's single account.
    if (pool.creatorPayoutCents > 0) {
      const [creatorConnect] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId))
        .limit(1);
      slices.push({
        payoutType: 'creator_payout',
        amountCents: pool.creatorPayoutCents,
        organizationId,
        source,
        stripeChargeId,
        transferGroup,
        sendTransferGroup: false,
        payee: { userId: creatorId, account: creatorConnect },
        idempotencyKey: `${stripeChargeId}_creator`,
        metadata: { course_subscription_id: sub.id },
        // The invoice has no row of its own, so its creator slice records the
        // agreement it was split by (Codex-2hxff.19 AGR-06).
        creatorOrgAgreementId: agreement?.agreementId ?? null,
      });
    }

    // 3. Organization fee — to the owner when the invoice was created; pending
    // in their name until they can be paid, or held as `no_owner` if the
    // organisation had none (Codex-2hxff.37; it used to be logged and dropped).
    if (pool.organizationFeeCents > 0) {
      const orgPayee = await resolveOrganisationPayee(
        this.db,
        organizationId,
        invoiceCreatedAt,
        this.obs
      );
      slices.push({
        payoutType: 'organization_fee',
        amountCents: pool.organizationFeeCents,
        organizationId,
        source,
        stripeChargeId,
        transferGroup,
        sendTransferGroup: false,
        payee: orgPayee
          ? { userId: orgPayee.userId, account: orgPayee.account }
          : null,
        idempotencyKey: `${stripeChargeId}_org_fee`,
        metadata: { course_subscription_id: sub.id },
      });
    }

    if (slices.length === 0) return;
    const recorded = await recordSplitOnce(
      ledger,
      { id: stripeChargeId, grossCents: amountCents },
      slices
    );
    if (recorded.kind !== 'recorded') {
      this.obs.info(
        recorded.kind === 'completed'
          ? 'Course invoice already split by an earlier delivery that died part-way; the replay recorded only the slices it lacked'
          : 'Course invoice already split by an earlier delivery; the replay keeps that split',
        { courseSubscriptionId: sub.id, organizationId, stripeChargeId }
      );
    }
  }
}
