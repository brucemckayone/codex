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

import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  BILLING_INTERVAL,
  CONTENT_STATUS,
  CURRENCY,
  FEES,
  OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES,
  stripeEnvMetadata,
  subscriptionStatusGrantsAccess,
} from '@codex/constants';
import { isUniqueViolation } from '@codex/database';
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
  type LedgerDeps,
  recordPlatformFee,
  recordSlice,
  resolveInvoiceCharge,
  resolveOrganisationPayee,
} from '@codex/payments';
import {
  applyMinPlatformFeeFloor,
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  type FeeConfigService,
  findActiveCreatorAgreementShare,
  refreshCourseSubscriptionEntitlementExpiry,
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
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyCourseSubscribedError,
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
  CourseSubscriptionPlanNotFoundError,
  CreatorConnectRequiredError,
  SubscriptionCheckoutError,
} from '../errors';
import { schedulePriceChange } from './pending-price-change';
import { resolveStatus } from './stripe-status-mapper';
import type { TierPriceChangeMailer } from './subscription-service';

/** Marks a Stripe subscription as a course sub (vs. an org tier sub). */
export const COURSE_SUBSCRIPTION_METADATA_TYPE = 'course_subscription';

interface CourseSubscriptionServiceConfig extends ServiceConfig {
  /** Injected so invoice payouts resolve fees via the 3-tier fallback chain. */
  feeConfig?: FeeConfigService;
  /** Price-change notices (`subscription-tier-price-change`). Absent → no email. */
  mailer?: TierPriceChangeMailer;
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
  oldAmountCents: number;
  newAmountCents: number;
}

/** Minimal per-event result so the webhook can bump the buyer's caches. */
export interface CourseSubscriptionWebhookResult {
  userId: string;
  organizationId: string;
}

export class CourseSubscriptionService extends BaseService {
  private readonly stripe: Stripe;
  private readonly feeConfig: FeeConfigService | undefined;
  private readonly mailer: TierPriceChangeMailer | undefined;
  private readonly webAppUrl: string | undefined;
  private readonly waitUntil: ((promise: Promise<unknown>) => void) | undefined;

  constructor(config: CourseSubscriptionServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.feeConfig = config.feeConfig;
    this.mailer = config.mailer;
    this.webAppUrl = config.webAppUrl;
    this.waitUntil = config.waitUntil;
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
   */
  async createPlan(
    organizationId: string,
    courseId: string,
    input: { priceMonthly: number; priceAnnual: number }
  ): Promise<typeof courseSubscriptionPlans.$inferSelect> {
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

      const idempotencyBase = crypto.randomUUID();
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
        { idempotencyKey: `course-plan-product-${idempotencyBase}` }
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
          { idempotencyKey: `course-plan-price-monthly-${idempotencyBase}` }
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
    return existing
      ? this.savePlanPrices(organizationId, courseId, input)
      : this.createPlan(organizationId, courseId, input);
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
              this.obs.error('Course plan price fan-out failed', {
                planId: existing.id,
                courseId,
                error: error instanceof Error ? error.message : String(error),
              });
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
   * proration (`schedulePriceChange`), and email each one. Past-due and paused
   * subscribers get the pending marker and move once active again. One failed
   * subscriber never stops the rest.
   */
  private async movePlanSubscribers(
    planId: string,
    moves: PlanPriceMove[]
  ): Promise<void> {
    const noticeAt = new Date();
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

      const batchSize = 8;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((row) =>
            schedulePriceChange(this.stripe, {
              stripeSubscriptionId: row.stripeSubscriptionId,
              newPriceId: move.newPriceId,
              newAmountCents: move.newAmountCents,
              interval: move.interval,
              noticeAt,
            })
          )
        );
        for (const [idx, result] of results.entries()) {
          const row = batch[idx];
          if (!row) continue;
          if (result.status === 'rejected') {
            this.obs.error('Course plan price change failed for a subscriber', {
              planId,
              courseSubscriptionId: row.id,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
            continue;
          }
          const outcome = result.value;
          if (outcome.kind !== 'applied' && outcome.kind !== 'pending')
            continue;
          if (!this.mailer || !row.userEmail) continue;
          try {
            this.mailer({
              to: row.userEmail,
              toName: row.userName || undefined,
              templateName: 'subscription-tier-price-change',
              category: 'transactional',
              userId: row.userId,
              organizationId: row.organizationId,
              data: {
                userName: row.userName || 'there',
                planName: row.courseTitle || 'your subscription',
                oldPriceFormatted: `£${(move.oldAmountCents / 100).toFixed(2)}`,
                newPriceFormatted: `£${(move.newAmountCents / 100).toFixed(2)}`,
                billingInterval: move.interval,
                effectiveDate: outcome.effectiveAt.toLocaleDateString('en-GB', {
                  timeZone: 'UTC',
                }),
                manageUrl: `${this.webAppUrl ?? ''}/account/subscriptions`,
              },
            });
          } catch (error) {
            this.obs.warn('Course plan price notice: mailer threw', {
              courseSubscriptionId: row.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
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
    if (!this.mailer || !row.userEmail) return;
    try {
      this.mailer({
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
        // On the session AND (via subscription_data) the subscription, whose
        // invoices snapshot it — the tag the webhook guard reads (Codex-2hxff.5).
        ...stripeEnvMetadata(this.environment),
      };

      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        { userId, email: user.email, environment: this.environment },
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
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
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
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
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

    const chargeId = await resolveInvoiceCharge(this.stripe, stripeInvoice);
    if (!chargeId) {
      this.obs.warn(
        'Course subscription invoice has no charge — skipping payouts',
        { courseSubscriptionId: row.id, invoiceId: stripeInvoice.id }
      );
      return { userId: row.userId, organizationId: row.organizationId ?? '' };
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

    return { userId: row.userId, organizationId: row.organizationId ?? '' };
  }

  /**
   * customer.subscription.updated (course sub): mirror status/period. While the
   * status grants access — including `past_due`, as Stripe retries a failed
   * renewal (owner decision P-3) — the stored grant follows the period end;
   * otherwise it would lapse at the old one, since only a PAID renewal moves it
   * on. `unpaid` is access-reducing → revoke the grant immediately.
   */
  async handleCourseSubscriptionUpdated(
    stripeSub: Stripe.Subscription
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
    const presence = await this.ensureDataPresent(stripeSub);
    if (!presence) return;
    const { row } = presence;

    const item = stripeSub.items.data[0];
    const status = resolveStatus(
      stripeSub.status,
      stripeSub.cancel_at_period_end ?? false,
      row.status as Parameters<typeof resolveStatus>[2]
    );
    const currentPeriodEnd = item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : row.currentPeriodEnd;
    await this.db
      .update(courseSubscriptions)
      .set({
        status,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(courseSubscriptions.id, row.id));

    if (subscriptionStatusGrantsAccess(status) && currentPeriodEnd) {
      await refreshCourseSubscriptionEntitlementExpiry(this.db, {
        userId: row.userId,
        courseId: row.courseId,
        expiresAt: currentPeriodEnd,
      });
    }

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
  ): Promise<CourseSubscriptionWebhookResult | undefined> {
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
    // reserved by a per-charge unique key before any transfer (recordSlice,
    // Codex-2hxff.11), so a redelivery re-runs this whole fan-out safely: the
    // slices already recorded are skipped and only a missing one is added.
    // (A per-charge SELECT pre-check used to skip the fan-out if ANY row
    // existed — so a delivery that died after the platform fee lost the
    // creator and org slices for good.)

    const fees = this.feeConfig
      ? await this.feeConfig.getFeesForCreator(
          organizationId,
          creatorId,
          'subscription'
        )
      : {
          platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
          orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
          minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
          minTransferCents: 0,
        };

    const agreementSharePercent = await findActiveCreatorAgreementShare(
      this.db,
      {
        organizationId,
        creatorId,
        revenueType: 'subscription',
        at: invoiceCreatedAt,
        obs: this.obs,
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

    // 1. Platform fee — retained on the platform balance (no transfer).
    await recordPlatformFee(ledger, {
      amountCents: split.platformFeeCents,
      organizationId,
      source,
      stripeChargeId,
      transferGroup,
    });

    // 2. Creator payout — to the course creator's single account.
    if (split.creatorPayoutCents > 0) {
      const [creatorConnect] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId))
        .limit(1);
      await recordSlice(ledger, {
        payoutType: 'creator_payout',
        amountCents: split.creatorPayoutCents,
        organizationId,
        source,
        stripeChargeId,
        transferGroup,
        sendTransferGroup: false,
        payee: { userId: creatorId, account: creatorConnect },
        idempotencyKey: `${stripeChargeId}_creator`,
        metadata: { course_subscription_id: sub.id },
      });
    }

    // 3. Organization fee — to the owner when the invoice was created; pending
    // in their name until they can be paid, or held as `no_owner` if the
    // organisation had none (Codex-2hxff.37; it used to be logged and dropped).
    if (split.organizationFeeCents > 0) {
      const orgPayee = await resolveOrganisationPayee(
        this.db,
        organizationId,
        invoiceCreatedAt,
        this.obs
      );
      await recordSlice(ledger, {
        payoutType: 'organization_fee',
        amountCents: split.organizationFeeCents,
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
  }
}
