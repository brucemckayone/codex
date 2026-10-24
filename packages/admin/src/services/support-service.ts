/**
 * Support refunds: the platform-owner refund screen and queue
 * (Codex-2hxff.28; design docs/handover/phase3-sources/support-refunds/
 * data-design.md, owner decisions 2026-10-24).
 *
 * Platform-wide on purpose: there is no organisation scope, and admin-api's
 * `platform_owner` policy is the gate. The scope is the CHARGE: every read is
 * keyed on a charge, purchase or subscription id, or on the payout ids found
 * from them, and the queue reads through its two partial indexes. Money
 * records are never hidden, so soft-deleted rows are returned, flagged.
 *
 * One refund path: `issueRefund` only asks Stripe, and writes nothing here.
 * `charge.refunded` then records the refund, claws back the shares, changes
 * the access and emails the buyer, exactly as for a Dashboard refund.
 *
 * Every Stripe call it makes (admin-api's restricted key is built from this
 * list, owner decision Q4; keep it complete):
 *
 * - `charges.retrieve(id, { expand: ['balance_transaction'] })`: the detail
 *   and the preview (amount, `created`, card, Stripe's fee);
 * - `charges.retrieve(id)`: the refund route (amount, `created`), and the
 *   source of an old purchase whose payouts name no charge;
 * - `refunds.list({ charge, limit: 100, starting_after })`, every page
 *   (`listChargeRefunds`, `listClawableRefunds`): detail, preview, refund;
 * - `refunds.create({ charge, amount, reason, metadata }, { idempotencyKey })`
 *   (`issueRefund`): the refund route;
 * - `paymentIntents.retrieve(id)`: search, for a `pi_` we hold no purchase
 *   for, and for an old purchase's charge (`latest_charge`);
 * - `disputes.retrieve(id)`: the detail, for a dispute awaiting a response
 *   (its `evidence_details.due_by`);
 * - `invoicePayments.list({ payment: { type: 'payment_intent', … }, limit: 1 })`,
 *   `invoices.retrieve(id)` and `invoices.list({ subscription, status: 'paid',
 *   limit: 20 })` (`isCurrentPeriodPayment`): the detail and a full refund's
 *   preview, for a subscription invoice.
 */

import { STRIPE_ENV_METADATA_KEY } from '@codex/constants';
import { type DatabaseClient, toIso, withPagination } from '@codex/database';
import {
  content,
  courseSubscriptions,
  courses,
  disputes,
  organizations,
  type Payout,
  type PayoutReversal,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
  refunds,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  type ClawbackSource,
  issueRefund as issueStripeRefund,
  listChargeRefunds,
  listClawableRefunds,
  loadClawbackPlanInput,
  planClawback,
  refundWindow,
  repayFailedRefund,
} from '@codex/payments';
import {
  type PurchaseService,
  type RestoredRefundAccess,
  STANDING_REFUND_STATUSES,
  supportRequesterOf,
} from '@codex/purchase';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import { isCurrentPeriodPayment } from '@codex/subscription';
import {
  type SupportChargeSearchQuery,
  type SupportIssueRefundInput,
  type SupportQueueQuery,
  type SupportResolveCreatorDebtInput,
  type SupportResolveFailedRefundInput,
  uuidSchema,
} from '@codex/validation';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';
import {
  AlreadySettledError,
  ChargeChangedError,
  ChargeHasChargebackError,
  NothingLeftToRefundError,
  RefundAlreadySubmittedError,
  RefundAmountTooLargeError,
  RefundWindowClosedError,
  StripeRefusedRefundError,
} from '../errors';
import type {
  ChargebackRow,
  ChargeDetail,
  ChargeDetailSource,
  ChargeSummary,
  CreatorDebtItem,
  FailedRefundItem,
  RefundPreview,
  RefundRequester,
  RefundRow,
  ResolvedCreatorDebt,
  ResolvedFailedRefund,
  Slice,
  SupportBuyer,
  SupportChargeKind,
  SupportPerson,
  SupportQueueCounts,
  SupportRefundResult,
} from '../support-types';
import {
  BLOCKING_DISPUTE_STATUSES,
  causeKey,
  chargebackState,
  debtErrorLabel,
  type HistoryContext,
  previewLabel,
  refundFailureLabel,
  type SliceHistory,
  sliceHistory,
} from './support-ledger';

export interface SupportServiceConfig extends ServiceConfig {
  /** The registry's shared client, on admin-api's own restricted key (Q4). */
  stripe: Stripe;
  /** Gives a purchase its access back when support re-pays a failed full refund (Q5d). */
  purchase: Pick<PurchaseService, 'restoreAfterFailedRefund'>;
}

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** What a charge paid for, as our records name it. */
type ChargeSource =
  | { type: 'purchase'; purchaseId: string }
  | { type: 'subscription' | 'course_subscription'; subscriptionId: string };

/** A failed refund support settled, and whose access came back, for the route's caches. */
export interface FailedRefundSettlement {
  settled: ResolvedFailedRefund;
  restoredAccess: RestoredRefundAccess | null;
}

/** The metadata keys support's refunds carry (read back by `supportRequesterOf`). */
const SUPPORT_KEY_METADATA = 'codex_support_key';
const REQUESTED_BY_METADATA = 'codex_requested_by';

/** Dispute statuses that await an answer: their evidence deadline is shown. */
const AWAITING_RESPONSE = new Set(['needs_response', 'warning_needs_response']);

/** The order the detail lists a charge's slices in: payees first, the fee last. */
const SLICE_ORDER: Readonly<Record<string, number>> = {
  creator_payout: 0,
  creator_payout_to_owner: 1,
  organization_fee: 2,
  platform_fee: 3,
};

/**
 * The refund's idempotency key (data design §5): this charge, this many
 * refunds on it, this amount. A double click, a retry and a second tab send
 * the same; the count only grows, so a key never names two decisions, even
 * after Stripe forgets it at 24 hours. The reason is not in it: the same key
 * with another reason is Stripe's `idempotency_error`.
 */
function supportRefundKey(
  chargeId: string,
  expectedRefundCount: number,
  amountCents: number
): string {
  return `support_refund_${chargeId}_${expectedRefundCount}_${amountCents}`;
}

/** The refunds that count against the charge: made and not undone. */
function standingCents(listed: readonly Stripe.Refund[]): number {
  const standing: readonly string[] = STANDING_REFUND_STATUSES;
  return listed
    .filter((refund) => standing.includes(refund.status ?? ''))
    .reduce((sum, refund) => sum + refund.amount, 0);
}

function stripeSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function paymentIntentIdOf(charge: Stripe.Charge): string | null {
  const ref = charge.payment_intent;
  return typeof ref === 'string' ? ref : (ref?.id ?? null);
}

/** Stripe answered that the object does not exist. */
function isStripeMissing(error: unknown): boolean {
  const e = error as { statusCode?: unknown; code?: unknown } | null;
  return e?.statusCode === 404 || e?.code === 'resource_missing';
}

/**
 * Map Stripe's answer to `refunds.create` (data design §4). The same key with
 * other parameters, or a concurrent request with it, is "already submitted";
 * a card or request refusal names Stripe's code, never its message. Anything
 * else (an outage, a rate limit, a key without the permission) propagates.
 */
function supportRefundError(error: unknown): unknown {
  const e = error as {
    type?: unknown;
    statusCode?: unknown;
    code?: unknown;
  } | null;
  if (e?.type === 'StripeIdempotencyError' || e?.statusCode === 409) {
    return new RefundAlreadySubmittedError();
  }
  if (
    e?.type === 'StripeCardError' ||
    e?.type === 'StripeInvalidRequestError'
  ) {
    const code =
      typeof e.code === 'string' && e.code.length > 0
        ? e.code.slice(0, 64)
        : 'unknown';
    return new StripeRefusedRefundError(code);
  }
  return error;
}

function clawbackSourceOf(source: ChargeSource): ClawbackSource {
  return source.type === 'purchase'
    ? { sourceType: 'purchase', purchaseId: source.purchaseId }
    : { sourceType: 'subscription' };
}

function sourceFromIds(
  row:
    | {
        purchaseId: string | null;
        subscriptionId: string | null;
        courseSubscriptionId: string | null;
      }
    | undefined
): ChargeSource | undefined {
  if (row?.purchaseId) return { type: 'purchase', purchaseId: row.purchaseId };
  if (row?.subscriptionId) {
    return { type: 'subscription', subscriptionId: row.subscriptionId };
  }
  if (row?.courseSubscriptionId) {
    return {
      type: 'course_subscription',
      subscriptionId: row.courseSubscriptionId,
    };
  }
  return undefined;
}

function buyerOf(row: {
  id: string;
  name: string;
  email: string;
  deletedAt: Date | null;
}): SupportBuyer {
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    deleted: row.deletedAt !== null,
  };
}

function billingInterval(value: string | null): 'month' | 'year' | null {
  return value === 'month' || value === 'year' ? value : null;
}

/**
 * Either condition. Never left undefined: `and()` would drop a missing
 * filter without a word, and the search would list every charge.
 */
function either(first: SQL, second: SQL): SQL {
  const condition = or(first, second);
  if (!condition) {
    throw new InternalServiceError('A support search filter did not build');
  }
  return condition;
}

function unique<T>(values: readonly (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

function pageOf<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): PaginatedListResponse<T> {
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

type PurchaseSourceDetail = Extract<ChargeDetailSource, { type: 'purchase' }>;
type SubscriptionSourceDetail = Exclude<
  ChargeDetailSource,
  { type: 'purchase' }
>;

/** What the source of a charge says about it, for the detail and preview. */
interface SourceView {
  /** A subscription's lacks the current-period answer, which asks Stripe. */
  source:
    | PurchaseSourceDetail
    | Omit<SubscriptionSourceDetail, 'isCurrentPeriodPayment'>;
  buyer: SupportBuyer;
  organization: ChargeDetail['organization'];
  /** What the buyer keeps or loses: the item, or the plan. */
  title: string;
}

export class SupportService extends BaseService {
  private readonly stripe: Stripe;
  private readonly purchase: SupportServiceConfig['purchase'];

  constructor(config: SupportServiceConfig) {
    super(config);
    this.stripe = config.stripe;
    this.purchase = config.purchase;
  }

  // ==========================================================================
  // Search (route 1)
  // ==========================================================================

  /**
   * Charges found by an exact key (data design §2): an email (lower-cased;
   * BetterAuth stores emails lower-case), a purchase or subscription id, a
   * `sub_`, `pi_`, `ch_` or `py_` id. Anything else finds nothing. Newest
   * first, a purchase's and an invoice's alike.
   */
  async searchCharges(
    query: SupportChargeSearchQuery
  ): Promise<PaginatedListResponse<ChargeSummary>> {
    try {
      const { page, limit } = query;
      const scope = await this.searchScope(query.q);
      if (!scope) return pageOf([], 0, page, limit);

      const charges = this.purchaseCharges(scope.purchases)
        .unionAll(this.invoiceCharges(scope.invoices))
        .as('charges');
      const { offset } = withPagination({ page, limit });
      const [rows, [totals]] = await Promise.all([
        this.db
          .select()
          .from(charges)
          .orderBy(desc(charges.paidAt), desc(charges.rowId))
          .limit(limit)
          .offset(offset),
        this.db.select({ total: count() }).from(charges),
      ]);

      const now = new Date();
      const items: ChargeSummary[] = [];
      for (const row of rows) {
        const paidAt = new Date(row.paidAt);
        // A purchase recorded before charge ids were (D8): Stripe names its
        // charge, for this page's rows only.
        const chargeId =
          row.chargeId ??
          (row.paymentIntentId
            ? await this.latestChargeOf(row.paymentIntentId)
            : null);
        items.push({
          chargeId,
          kind: row.kind,
          title: row.title,
          titleDeleted: row.titleDeleted,
          interval: billingInterval(row.interval),
          organizationName: row.organizationName,
          buyer: {
            userId: row.buyerId,
            name: row.buyerName,
            email: row.buyerEmail,
            deleted: row.buyerDeleted,
          },
          amountCents: row.amountCents,
          refundedCents: row.refundedCents,
          paidAt: paidAt.toISOString(),
          chargeback: row.disputeStatus
            ? chargebackState(row.disputeStatus)
            : null,
          window: this.windowView(Math.floor(paidAt.getTime() / 1000), now),
        });
      }
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'searchCharges');
    }
  }

  /**
   * Which purchases and which invoice charges `q` names; null for nothing.
   * Each is a point lookup on an indexed key.
   */
  private async searchScope(
    q: string
  ): Promise<{ purchases: SQL; invoices: SQL } | null> {
    const none = sql`false`;
    if (q.includes('@')) {
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, q.toLowerCase()))
        .limit(1);
      if (!user) return null;
      return {
        purchases: eq(purchases.customerId, user.id),
        invoices: either(
          inArray(
            payouts.subscriptionId,
            this.db
              .select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.userId, user.id))
          ),
          inArray(
            payouts.courseSubscriptionId,
            this.db
              .select({ id: courseSubscriptions.id })
              .from(courseSubscriptions)
              .where(eq(courseSubscriptions.userId, user.id))
          )
        ),
      };
    }
    if (uuidSchema.safeParse(q).success) {
      return {
        purchases: eq(purchases.id, q),
        invoices: either(
          eq(payouts.subscriptionId, q),
          eq(payouts.courseSubscriptionId, q)
        ),
      };
    }
    if (q.startsWith('sub_')) {
      return {
        purchases: none,
        invoices: either(
          inArray(
            payouts.subscriptionId,
            this.db
              .select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.stripeSubscriptionId, q))
          ),
          inArray(
            payouts.courseSubscriptionId,
            this.db
              .select({ id: courseSubscriptions.id })
              .from(courseSubscriptions)
              .where(eq(courseSubscriptions.stripeSubscriptionId, q))
          )
        ),
      };
    }
    if (q.startsWith('pi_')) {
      const [purchase] = await this.db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, q))
        .limit(1);
      if (purchase) {
        return { purchases: eq(purchases.id, purchase.id), invoices: none };
      }
      // An invoice's payment, or a purchase we hold under its charge only.
      const chargeId = await this.latestChargeOf(q);
      return chargeId ? this.chargeScope(chargeId) : null;
    }
    if (q.startsWith('ch_') || q.startsWith('py_')) {
      return this.chargeScope(q);
    }
    return null;
  }

  /** One charge's row, a purchase's or an invoice's; null if we hold none. */
  private async chargeScope(
    chargeId: string
  ): Promise<{ purchases: SQL; invoices: SQL } | null> {
    let source: ChargeSource;
    try {
      source = await this.sourceOfCharge(chargeId, () =>
        this.retrieveCharge(chargeId, false)
      );
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
    return source.type === 'purchase'
      ? { purchases: eq(purchases.id, source.purchaseId), invoices: sql`false` }
      : {
          purchases: sql`false`,
          invoices: eq(payouts.stripeChargeId, chargeId),
        };
  }

  /** The search's purchase rows; `filter` picks them. */
  private purchaseCharges(filter: SQL) {
    const standing = inArray(refunds.status, [...STANDING_REFUND_STATUSES]);
    return (
      this.db
        .select({
          rowId: sql<string>`${purchases.id}::text`.as('row_id'),
          kind: sql<SupportChargeKind>`'purchase'`.as('kind'),
          paymentIntentId: sql<
            string | null
          >`${purchases.stripePaymentIntentId}`.as('payment_intent_id'),
          chargeId: sql<
            string | null
          >`(SELECT ${payouts.stripeChargeId} FROM ${payouts} WHERE ${payouts.purchaseId} = ${purchases.id} AND ${payouts.payoutType} = 'platform_fee' AND ${payouts.stripeChargeId} IS NOT NULL LIMIT 1)`.as(
            'charge_id'
          ),
          title:
            sql<string>`COALESCE(${content.title}, ${courses.title}, '')`.as(
              'title'
            ),
          titleDeleted: sql<boolean>`(${content.deletedAt} IS NOT NULL)`.as(
            'title_deleted'
          ),
          interval: sql<string | null>`NULL::varchar`.as('interval'),
          organizationName: sql<string | null>`${organizations.name}`.as(
            'organization_name'
          ),
          buyerId: sql<string>`${users.id}`.as('buyer_id'),
          buyerName: sql<string>`${users.name}`.as('buyer_name'),
          buyerEmail: sql<string>`${users.email}`.as('buyer_email'),
          buyerDeleted: sql<boolean>`(${users.deletedAt} IS NOT NULL)`.as(
            'buyer_deleted'
          ),
          amountCents: sql<number>`${purchases.amountPaidCents}`.as(
            'amount_cents'
          ),
          refundedCents:
            sql<number>`(SELECT COALESCE(SUM(${refunds.amountCents}), 0)::int FROM ${refunds} WHERE ${refunds.purchaseId} = ${purchases.id} AND ${standing})`.as(
              'refunded_cents'
            ),
          paidAt:
            sql<Date>`COALESCE(${purchases.purchasedAt}, ${purchases.createdAt})`.as(
              'paid_at'
            ),
          disputeStatus: sql<
            string | null
          >`(SELECT ${disputes.status} FROM ${disputes} WHERE ${disputes.purchaseId} = ${purchases.id} ORDER BY ${disputes.stripeCreatedAt} DESC LIMIT 1)`.as(
            'dispute_status'
          ),
        })
        .from(purchases)
        .innerJoin(users, eq(users.id, purchases.customerId))
        .leftJoin(content, eq(content.id, purchases.contentId))
        .leftJoin(courses, eq(courses.id, purchases.courseId))
        .leftJoin(organizations, eq(organizations.id, purchases.organizationId))
        // A failed checkout took no money.
        .where(and(filter, ne(purchases.status, 'failed')))
    );
  }

  /**
   * The search's invoice rows: an invoice has no row of its own, so its
   * charge is its platform-fee slice (one per charge, uq_payouts_platform_fee
   * _per_charge), and its amount the sum of the charge's slices.
   */
  private invoiceCharges(filter: SQL) {
    // An alias renders as its bare name in a `sql` template, so its FROM names
    // the table too: `FROM ${payouts} ${slice}`.
    const slice = alias(payouts, 'charge_slice');
    const standing = inArray(refunds.status, [...STANDING_REFUND_STATUSES]);
    return this.db
      .select({
        rowId: sql<string>`${payouts.id}::text`.as('row_id'),
        kind: sql<SupportChargeKind>`CASE WHEN ${payouts.courseSubscriptionId} IS NULL THEN 'subscription_invoice' ELSE 'course_plan_invoice' END`.as(
          'kind'
        ),
        paymentIntentId: sql<string | null>`NULL::varchar`.as(
          'payment_intent_id'
        ),
        chargeId: sql<string | null>`${payouts.stripeChargeId}`.as('charge_id'),
        title:
          sql<string>`COALESCE(${subscriptionTiers.name}, ${courses.title}, '')`.as(
            'title'
          ),
        titleDeleted:
          sql<boolean>`(${subscriptionTiers.deletedAt} IS NOT NULL)`.as(
            'title_deleted'
          ),
        interval: sql<
          string | null
        >`COALESCE(${subscriptions.billingInterval}, ${courseSubscriptions.billingInterval})`.as(
          'interval'
        ),
        organizationName: sql<string | null>`${organizations.name}`.as(
          'organization_name'
        ),
        buyerId: sql<string>`${users.id}`.as('buyer_id'),
        buyerName: sql<string>`${users.name}`.as('buyer_name'),
        buyerEmail: sql<string>`${users.email}`.as('buyer_email'),
        buyerDeleted: sql<boolean>`(${users.deletedAt} IS NOT NULL)`.as(
          'buyer_deleted'
        ),
        amountCents:
          sql<number>`(SELECT COALESCE(SUM(${slice.amountCents}), 0)::int FROM ${payouts} ${slice} WHERE ${slice.stripeChargeId} = ${payouts.stripeChargeId} AND ${slice.sourceType} = 'subscription')`.as(
            'amount_cents'
          ),
        refundedCents:
          sql<number>`(SELECT COALESCE(SUM(${refunds.amountCents}), 0)::int FROM ${refunds} WHERE ${refunds.stripeChargeId} = ${payouts.stripeChargeId} AND ${standing})`.as(
            'refunded_cents'
          ),
        paidAt: sql<Date>`${payouts.createdAt}`.as('paid_at'),
        disputeStatus: sql<
          string | null
        >`(SELECT ${disputes.status} FROM ${disputes} WHERE ${disputes.stripeChargeId} = ${payouts.stripeChargeId} ORDER BY ${disputes.stripeCreatedAt} DESC LIMIT 1)`.as(
          'dispute_status'
        ),
      })
      .from(payouts)
      .leftJoin(subscriptions, eq(subscriptions.id, payouts.subscriptionId))
      .leftJoin(
        subscriptionTiers,
        eq(subscriptionTiers.id, subscriptions.tierId)
      )
      .leftJoin(
        courseSubscriptions,
        eq(courseSubscriptions.id, payouts.courseSubscriptionId)
      )
      .leftJoin(courses, eq(courses.id, courseSubscriptions.courseId))
      .leftJoin(organizations, eq(organizations.id, payouts.organizationId))
      .innerJoin(
        users,
        eq(
          users.id,
          sql`COALESCE(${subscriptions.userId}, ${courseSubscriptions.userId})`
        )
      )
      .where(
        and(
          filter,
          eq(payouts.payoutType, 'platform_fee'),
          eq(payouts.sourceType, 'subscription'),
          isNotNull(payouts.stripeChargeId)
        )
      );
  }

  /** A PaymentIntent's charge, as Stripe names it; null if Stripe has none. */
  private async latestChargeOf(
    paymentIntentId: string
  ): Promise<string | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      const ref = intent.latest_charge;
      return typeof ref === 'string' ? ref : (ref?.id ?? null);
    } catch (error) {
      if (isStripeMissing(error)) return null;
      throw error;
    }
  }

  // ==========================================================================
  // Charge detail (route 2)
  // ==========================================================================

  /**
   * The charge, its split, and every refund and chargeback of it, as one
   * answer: the page must never offer a refund on half-loaded data.
   */
  async getChargeDetail(chargeId: string): Promise<ChargeDetail> {
    try {
      const now = new Date();
      const readCharge = this.chargeReader(chargeId, true);
      const source = await this.sourceOfCharge(chargeId, readCharge);
      const charge = await readCharge();
      const [view, listed, ledger, disputeRows, recorded] = await Promise.all([
        this.sourceView(source),
        listChargeRefunds(this.stripe, chargeId),
        loadClawbackPlanInput(this.db, {
          charge: { id: chargeId, amountCents: charge.amount },
          source: clawbackSourceOf(source),
          refunds: [],
        }),
        this.db
          .select()
          .from(disputes)
          .where(eq(disputes.stripeChargeId, chargeId))
          .orderBy(
            asc(disputes.stripeCreatedAt),
            asc(disputes.stripeDisputeId)
          ),
        this.db
          .select({
            stripeRefundId: refunds.stripeRefundId,
            notifiedAt: refunds.notifiedAt,
            requestedByUserId: refunds.requestedByUserId,
          })
          .from(refunds)
          .where(eq(refunds.stripeChargeId, chargeId)),
      ]);

      const refundedCents = standingCents(listed);
      const maxCents = Math.max(0, charge.amount - refundedCents);
      const window = this.windowView(charge.created, now);
      const blocking = disputeRows.find((row) =>
        BLOCKING_DISPUTE_STATUSES.includes(row.status)
      );
      const sourceDetail: ChargeDetailSource =
        view.source.type === 'purchase'
          ? view.source
          : {
              ...view.source,
              isCurrentPeriodPayment: await isCurrentPeriodPayment(
                { db: this.db, stripe: this.stripe, obs: this.obs },
                paymentIntentIdOf(charge)
              ),
            };

      return {
        charge: {
          id: charge.id,
          paymentIntentId: paymentIntentIdOf(charge),
          amountCents: charge.amount,
          refundedCents,
          paidAt: stripeSeconds(charge.created),
          card: this.cardOf(charge),
          stripeFeeCents: this.stripeFeeOf(charge),
        },
        source: sourceDetail,
        buyer: view.buyer,
        organization: view.organization,
        window,
        refundable: {
          maxCents,
          blocked: !window.isOpen
            ? 'window_closed'
            : blocking
              ? 'chargeback'
              : maxCents === 0
                ? 'nothing_left'
                : null,
        },
        refundCount: listed.length,
        slices: await this.slicesOf(ledger.slices, ledger.steps),
        refunds: await this.refundRows(listed, recorded),
        chargebacks: await this.chargebackRows(disputeRows),
      };
    } catch (error) {
      this.handleError(error, 'getChargeDetail');
    }
  }

  private cardOf(charge: Stripe.Charge): ChargeDetail['charge']['card'] {
    const card = charge.payment_method_details?.card;
    return card?.brand && card.last4
      ? { brand: card.brand, last4: card.last4 }
      : null;
  }

  /** Stripe's fee on the payment, from the expanded balance transaction. */
  private stripeFeeOf(charge: Stripe.Charge): number | null {
    const balance = charge.balance_transaction;
    return balance && typeof balance !== 'string' ? balance.fee : null;
  }

  private windowView(createdSeconds: number, now: Date) {
    const window = refundWindow(createdSeconds, now);
    return { closesAt: window.closesAt.toISOString(), isOpen: window.isOpen };
  }

  /** The charge's slices, payees first, each with its history. */
  private async slicesOf(
    slices: readonly Payout[],
    steps: readonly PayoutReversal[]
  ): Promise<Slice[]> {
    const [people, orgs, context] = await Promise.all([
      this.peopleById(slices.map((slice) => slice.userId)),
      this.organizationNames(slices.map((slice) => slice.organizationId)),
      this.historyContext(steps),
    ]);
    return [...slices]
      .sort(
        (a, b) =>
          (SLICE_ORDER[a.payoutType] ?? 9) - (SLICE_ORDER[b.payoutType] ?? 9) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )
      .map((slice) => {
        const { history, takenCents, owedCents } = sliceHistory(
          slice.id,
          steps,
          context
        );
        return {
          payoutId: slice.id,
          payoutType: slice.payoutType,
          payee: slice.userId ? (people.get(slice.userId) ?? null) : null,
          organizationName: slice.organizationId
            ? (orgs.get(slice.organizationId) ?? null)
            : null,
          amountCents: slice.amountCents,
          status: slice.status,
          reason: slice.reason,
          paidAt:
            slice.status === 'paid' || slice.status === 'reversed'
              ? toIso(slice.resolvedAt)
              : null,
          transferId: slice.stripeTransferId,
          takenCents,
          owedCents,
          history,
        };
      });
  }

  /** The charge's refunds as Stripe lists them, oldest first. */
  private async refundRows(
    listed: readonly Stripe.Refund[],
    recorded: ReadonlyArray<{
      stripeRefundId: string;
      notifiedAt: Date | null;
      requestedByUserId: string | null;
    }>
  ): Promise<RefundRow[]> {
    const byId = new Map(recorded.map((row) => [row.stripeRefundId, row]));
    const requesterIds = listed.map(
      (refund) =>
        byId.get(refund.id)?.requestedByUserId ?? supportRequesterOf(refund)
    );
    const people = await this.peopleById(requesterIds);
    return [...listed]
      .map((refund, index) => ({ refund, requester: requesterIds[index] }))
      .sort(
        (a, b) =>
          a.refund.created - b.refund.created ||
          a.refund.id.localeCompare(b.refund.id)
      )
      .map(({ refund, requester }) => {
        let requestedBy: RefundRequester;
        if (requester) {
          requestedBy = people.get(requester) ?? null;
        } else {
          // The platform tags every refund it makes; the Dashboard does not.
          requestedBy = refund.metadata?.[STRIPE_ENV_METADATA_KEY]
            ? null
            : 'dashboard';
        }
        const failureReason = refund.failure_reason ?? null;
        return {
          id: refund.id,
          amountCents: refund.amount,
          reason: refund.reason ?? null,
          status: refund.status ?? 'unknown',
          failureReason,
          failureLabel:
            failureReason || refund.status === 'failed'
              ? refundFailureLabel(failureReason)
              : null,
          createdAt: stripeSeconds(refund.created),
          notifiedAt: toIso(byId.get(refund.id)?.notifiedAt),
          requestedBy,
        };
      });
  }

  /** The charge's disputes; one awaiting an answer gets its deadline from Stripe. */
  private async chargebackRows(
    rows: ReadonlyArray<typeof disputes.$inferSelect>
  ): Promise<ChargebackRow[]> {
    const result: ChargebackRow[] = [];
    for (const row of rows) {
      let respondBy: string | null = null;
      if (AWAITING_RESPONSE.has(row.status)) {
        const dispute = await this.stripe.disputes.retrieve(
          row.stripeDisputeId
        );
        const due = dispute.evidence_details?.due_by;
        respondBy = due ? stripeSeconds(due) : null;
      }
      result.push({
        id: row.stripeDisputeId,
        amountCents: row.amountCents,
        status: row.status,
        reason: row.reason,
        createdAt: row.stripeCreatedAt.toISOString(),
        respondBy,
      });
    }
    return result;
  }

  // ==========================================================================
  // Refund preview (route 3)
  // ==========================================================================

  /**
   * What a refund of `amountCents` would take from each slice, worked out by
   * the clawback engine's own rules (`planClawback`), so the page never
   * re-implements them. It writes nothing.
   */
  async previewRefund(
    chargeId: string,
    amountCents: number
  ): Promise<RefundPreview> {
    try {
      const readCharge = this.chargeReader(chargeId, true);
      const source = await this.sourceOfCharge(chargeId, readCharge);
      const charge = await readCharge();
      const listed = await listChargeRefunds(this.stripe, chargeId);
      const refunded = standingCents(listed);
      this.assertAmountFits(amountCents, charge.amount - refunded);

      const clawbackCharge = { id: chargeId, amountCents: charge.amount };
      const plan = planClawback({
        ...(await loadClawbackPlanInput(this.db, {
          charge: clawbackCharge,
          source: clawbackSourceOf(source),
          refunds: () => listClawableRefunds(this.stripe, chargeId),
        })),
        newRefundCents: amountCents,
      });

      const lines = plan.lines.map((line) => ({
        payoutId: line.payoutId,
        repayPayoutId: line.repayPayoutId,
        label: previewLabel(line.method, plan.isFinal),
        amountCents: line.amountCents,
        method: line.method,
      }));
      const platform = new Set(['platform_bears', 'rounding']);
      const sum = (pick: (method: string) => boolean) =>
        lines
          .filter((line) => pick(line.method))
          .reduce((total, line) => total + line.amountCents, 0);

      // Access follows what the refund webhook will see: the charge refunded
      // in full counts every standing refund, a pending one included.
      const inFull = refunded + amountCents >= charge.amount;
      const view = await this.sourceView(source);
      let kind: RefundPreview['access']['kind'];
      if (source.type === 'purchase') {
        kind = inFull ? 'loses' : 'keeps';
      } else {
        kind =
          inFull &&
          (await isCurrentPeriodPayment(
            { db: this.db, stripe: this.stripe, obs: this.obs },
            paymentIntentIdOf(charge)
          ))
            ? 'subscription_cancelled'
            : 'subscription_runs';
      }

      return {
        amountCents,
        isFinal: plan.isFinal,
        lines,
        payeesGiveBackCents: sum(
          (method) => !platform.has(method) && method !== 'needs_person'
        ),
        platformBearsCents: sum((method) => platform.has(method)),
        stripeFeeCents: this.stripeFeeOf(charge),
        access: { kind, title: view.title },
      };
    } catch (error) {
      this.handleError(error, 'previewRefund');
    }
  }

  /** At most what is left: the charge less its standing refunds. */
  private assertAmountFits(amountCents: number, leftCents: number): void {
    if (leftCents <= 0) throw new NothingLeftToRefundError();
    if (amountCents > leftCents) throw new RefundAmountTooLargeError(leftCents);
  }

  // ==========================================================================
  // Issue a refund (route 4)
  // ==========================================================================

  /**
   * Refund the charge, in full or in part, in this order (data design §5):
   *
   * 1. list the charge's refunds;
   * 2. one already carrying this decision's key is returned, `replayed`;
   * 3. a count that moved since the page loaded stops it (`CHARGE_CHANGED`);
   * 4. the window (server clock, Stripe's `charge.created`), the chargeback
   *    block (the dispute's CURRENT status) and the amount cap;
   * 5. `refunds.create`, with the key and who asked.
   *
   * Nothing is written here: `charge.refunded` records the refund.
   */
  async issueRefund(
    chargeId: string,
    input: SupportIssueRefundInput,
    requestedByUserId: string
  ): Promise<SupportRefundResult> {
    try {
      const readCharge = this.chargeReader(chargeId, false);
      await this.sourceOfCharge(chargeId, readCharge);

      const listed = await listChargeRefunds(this.stripe, chargeId);
      const key = supportRefundKey(
        chargeId,
        input.expectedRefundCount,
        input.amountCents
      );
      const replay = listed.find(
        (refund) => refund.metadata?.[SUPPORT_KEY_METADATA] === key
      );
      if (replay) {
        return {
          refund: {
            id: replay.id,
            amountCents: replay.amount,
            status: replay.status ?? 'unknown',
            createdAt: stripeSeconds(replay.created),
          },
          replayed: true,
        };
      }
      if (listed.length !== input.expectedRefundCount) {
        throw new ChargeChangedError(listed.length);
      }

      const charge = await readCharge();
      const window = refundWindow(charge.created, new Date());
      if (!window.isOpen) throw new RefundWindowClosedError(window.closesAt);
      const [blocking] = await this.db
        .select({ status: disputes.status })
        .from(disputes)
        .where(
          and(
            eq(disputes.stripeChargeId, chargeId),
            inArray(disputes.status, [...BLOCKING_DISPUTE_STATUSES])
          )
        )
        .limit(1);
      if (blocking) throw new ChargeHasChargebackError(blocking.status);
      this.assertAmountFits(
        input.amountCents,
        charge.amount - standingCents(listed)
      );

      let made: Awaited<ReturnType<typeof issueStripeRefund>>;
      try {
        made = await issueStripeRefund(this.stripe, {
          chargeId,
          amountCents: input.amountCents,
          reason: input.reason,
          idempotencyKey: key,
          environment: this.environment,
          metadata: {
            [SUPPORT_KEY_METADATA]: key,
            [REQUESTED_BY_METADATA]: requestedByUserId,
          },
        });
      } catch (error) {
        throw supportRefundError(error);
      }
      // Refunded in full meanwhile, by another tab or the Dashboard.
      if (made.alreadyRefunded) throw new NothingLeftToRefundError();

      this.obs.info('Support refund issued', {
        chargeId,
        stripeRefundId: made.refundId,
        amountCents: made.amountCents,
        status: made.status,
        requestedByUserId,
      });
      return {
        refund: {
          id: made.refundId,
          amountCents: made.amountCents,
          status: made.status ?? 'unknown',
          createdAt: stripeSeconds(made.createdAt),
        },
        replayed: false,
      };
    } catch (error) {
      this.handleError(error, 'issueRefund');
    }
  }

  // ==========================================================================
  // The queue (routes 5, 6, 7)
  // ==========================================================================

  /** The queue's two counts, each through its partial index. */
  async getQueueCounts(): Promise<SupportQueueCounts> {
    try {
      const [[failed], [debts]] = await Promise.all([
        this.db
          .select({ total: count() })
          .from(refunds)
          .where(and(eq(refunds.status, 'failed'), isNull(refunds.resolvedAt))),
        this.db
          .select({ total: count() })
          .from(refundReviews)
          .where(isNull(refundReviews.resolvedAt)),
      ]);
      return {
        failedRefunds: failed?.total ?? 0,
        creatorDebts: debts?.total ?? 0,
      };
    } catch (error) {
      this.handleError(error, 'getQueueCounts');
    }
  }

  /** Failed refunds not yet settled, oldest first (`idx_refunds_failed_open`). */
  async listFailedRefunds(
    query: SupportQueueQuery
  ): Promise<PaginatedListResponse<FailedRefundItem>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const open = and(
        eq(refunds.status, 'failed'),
        isNull(refunds.resolvedAt)
      );
      const requester = alias(users, 'requester');
      const [rows, [totals]] = await Promise.all([
        this.db
          .select({
            refund: refunds,
            requesterName: requester.name,
            requesterDeletedAt: requester.deletedAt,
          })
          .from(refunds)
          .leftJoin(requester, eq(requester.id, refunds.requestedByUserId))
          .where(open)
          .orderBy(asc(refunds.createdAt), asc(refunds.id))
          .limit(limit)
          .offset(offset),
        this.db.select({ total: count() }).from(refunds).where(open),
      ]);

      const charges = await this.chargeFacts(
        rows.map(({ refund }) => ({
          chargeId: refund.stripeChargeId,
          purchaseId: refund.purchaseId,
        }))
      );
      const taken = await this.takenFromPayees(
        rows.map(({ refund }) => refund.stripeRefundId)
      );
      const items = rows.map(
        ({ refund, requesterName, requesterDeletedAt }): FailedRefundItem => {
          const facts = charges.get(refund.stripeChargeId);
          return {
            refundId: refund.id,
            stripeRefundId: refund.stripeRefundId,
            chargeId: refund.stripeChargeId,
            kind: facts?.kind ?? null,
            title: facts?.title ?? null,
            buyer: facts?.buyer ?? null,
            chargeAmountCents: facts?.amountCents ?? null,
            amountCents: refund.amountCents,
            isFull:
              facts !== undefined && refund.amountCents >= facts.amountCents,
            requestedBy:
              refund.requestedByUserId && requesterName !== null
                ? {
                    userId: refund.requestedByUserId,
                    name: requesterName,
                    deleted: requesterDeletedAt !== null,
                  }
                : null,
            createdAt: refund.stripeCreatedAt.toISOString(),
            // A failed row is final, so its last update is its failure.
            failedAt: refund.updatedAt.toISOString(),
            failureReason: refund.failureReason,
            failureLabel: refundFailureLabel(refund.failureReason),
            takenFromPayeesCents: taken.get(refund.stripeRefundId) ?? 0,
          };
        }
      );
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listFailedRefunds');
    }
  }

  /** Creator debts not yet settled, oldest first (`idx_refund_reviews_open`). */
  async listCreatorDebts(
    query: SupportQueueQuery
  ): Promise<PaginatedListResponse<CreatorDebtItem>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const open = isNull(refundReviews.resolvedAt);
      const [rows, [totals]] = await Promise.all([
        this.db
          .select({
            review: {
              id: refundReviews.id,
              payoutId: refundReviews.payoutId,
              creatorUserId: refundReviews.creatorUserId,
              attemptedReversalCents: refundReviews.attemptedReversalCents,
              errorCode: refundReviews.errorCode,
              createdAt: refundReviews.createdAt,
            },
            causeType: payoutReversals.causeType,
            causeId: payoutReversals.causeId,
            slice: {
              payoutType: payouts.payoutType,
              stripeChargeId: payouts.stripeChargeId,
              purchaseId: payouts.purchaseId,
            },
            payeeName: users.name,
            payeeDeletedAt: users.deletedAt,
          })
          .from(refundReviews)
          .innerJoin(payouts, eq(payouts.id, refundReviews.payoutId))
          .innerJoin(users, eq(users.id, refundReviews.creatorUserId))
          .leftJoin(
            payoutReversals,
            eq(payoutReversals.id, refundReviews.payoutReversalId)
          )
          .where(open)
          .orderBy(asc(refundReviews.createdAt), asc(refundReviews.id))
          .limit(limit)
          .offset(offset),
        this.db.select({ total: count() }).from(refundReviews).where(open),
      ]);

      const charges = await this.chargeFacts(
        rows.flatMap(({ slice }) =>
          slice.stripeChargeId
            ? [{ chargeId: slice.stripeChargeId, purchaseId: slice.purchaseId }]
            : []
        )
      );
      const histories = await this.historiesFor(
        rows.map(({ review }) => review.payoutId)
      );
      const causes = await this.causeFacts(
        rows.flatMap(({ causeType, causeId }) =>
          causeType && causeId ? [{ causeType, causeId }] : []
        )
      );
      const items = rows.map((row): CreatorDebtItem => {
        const facts = row.slice.stripeChargeId
          ? charges.get(row.slice.stripeChargeId)
          : undefined;
        const cause =
          row.causeType && row.causeId
            ? causes.get(causeKey(row.causeType, row.causeId))
            : undefined;
        return {
          reviewId: row.review.id,
          payoutId: row.review.payoutId,
          payee: {
            userId: row.review.creatorUserId,
            name: row.payeeName,
            deleted: row.payeeDeletedAt !== null,
            role:
              row.slice.payoutType === 'creator_payout'
                ? 'creator'
                : 'organisation_owner',
          },
          owedCents: row.review.attemptedReversalCents,
          chargeId: row.slice.stripeChargeId,
          title: facts?.title ?? null,
          buyerName: facts?.buyer?.name ?? null,
          cause:
            row.causeType && row.causeId
              ? {
                  type: row.causeType === 'dispute' ? 'dispute' : 'refund',
                  id: row.causeId,
                  amountCents: cause?.amountCents ?? null,
                  disputeStatus: cause?.disputeStatus ?? null,
                }
              : null,
          errorCode: row.review.errorCode,
          errorLabel: debtErrorLabel(row.review.errorCode, row.payeeName),
          createdAt: row.review.createdAt.toISOString(),
          history: histories.get(row.review.payoutId)?.history ?? [],
        };
      });
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listCreatorDebts');
    }
  }

  // ==========================================================================
  // Settling (routes 8, 9; data design §8)
  // ==========================================================================

  /**
   * Settle a failed refund. `refunded_elsewhere` only resolves the row.
   * `creators_repaid` is one transaction with the refund row locked: what its
   * clawback took is paid back (`repayFailedRefund`), a failed FULL purchase
   * refund gives the buyer access back, then the row is resolved. A repeat of
   * the same resolution returns the row as it stands; another is a 409.
   */
  async resolveFailedRefund(
    refundId: string,
    input: SupportResolveFailedRefundInput,
    resolvedByUserId: string
  ): Promise<FailedRefundSettlement> {
    try {
      const note = input.note === '' ? null : input.note;
      const settlement =
        input.resolution === 'refunded_elsewhere'
          ? await this.settleRefundedElsewhere(refundId, note, resolvedByUserId)
          : await this.settleCreatorsRepaid(
              refundId,
              input.note,
              resolvedByUserId
            );
      this.obs.info('Support settled a failed refund', {
        refundId,
        resolution: settlement.settled.resolution,
        resolvedByUserId,
        repaidPayouts: settlement.settled.repaid.length,
        accessRestored: settlement.settled.accessRestored,
      });
      return settlement;
    } catch (error) {
      this.handleError(error, 'resolveFailedRefund');
    }
  }

  private async settleRefundedElsewhere(
    refundId: string,
    note: string | null,
    resolvedByUserId: string
  ): Promise<FailedRefundSettlement> {
    const [row] = await this.db
      .update(refunds)
      .set({
        resolution: 'refunded_elsewhere',
        resolvedAt: new Date(),
        resolvedByUserId,
        resolutionNote: note,
      })
      .where(
        and(
          eq(refunds.id, refundId),
          eq(refunds.status, 'failed'),
          isNull(refunds.resolvedAt)
        )
      )
      .returning();
    const settled =
      row ??
      (await this.alreadySettledRefund(
        this.db,
        refundId,
        'refunded_elsewhere'
      ));
    return {
      settled: {
        refundId,
        resolution: 'refunded_elsewhere',
        resolvedAt: (settled.resolvedAt ?? new Date()).toISOString(),
        repaid: [],
        accessRestored: false,
      },
      restoredAccess: null,
    };
  }

  private async settleCreatorsRepaid(
    refundId: string,
    note: string,
    resolvedByUserId: string
  ): Promise<FailedRefundSettlement> {
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .for('update');
      if (!row || row.status !== 'failed') {
        throw new NotFoundError('No failed refund with this id', { refundId });
      }
      if (row.resolvedAt) {
        const settled = await this.alreadySettledRefund(
          tx,
          refundId,
          'creators_repaid'
        );
        return { row: settled, repaid: null, access: undefined };
      }
      const now = new Date();
      const repaid = await repayFailedRefund(tx, {
        stripeRefundId: row.stripeRefundId,
        resolvedByUserId,
        note,
        now,
      });
      const access = row.purchaseId
        ? await this.purchase.restoreAfterFailedRefund(tx, row.purchaseId)
        : undefined;
      const [resolved] = await tx
        .update(refunds)
        .set({
          resolution: 'creators_repaid',
          resolvedAt: now,
          resolvedByUserId,
          resolutionNote: note,
        })
        .where(
          and(
            eq(refunds.id, refundId),
            eq(refunds.status, 'failed'),
            isNull(refunds.resolvedAt)
          )
        )
        .returning();
      return { row: resolved ?? row, repaid, access };
    });

    // A repeat reports the re-pay rows the first settlement wrote.
    const repaid =
      outcome.repaid ??
      (await this.repaidFor(outcome.row.stripeRefundId)).map((row) => ({
        payoutId: row.id,
        payeeUserId: row.userId,
        amountCents: row.amountCents,
      }));
    const people = await this.peopleById(repaid.map((row) => row.payeeUserId));
    const restored = outcome.access?.restored === true;
    return {
      settled: {
        refundId,
        resolution: 'creators_repaid',
        resolvedAt: (outcome.row.resolvedAt ?? new Date()).toISOString(),
        repaid: repaid.map((row) => ({
          payoutId: row.payoutId,
          payeeName: row.payeeUserId
            ? (people.get(row.payeeUserId)?.name ?? null)
            : null,
          amountCents: row.amountCents,
        })),
        accessRestored: restored,
      },
      restoredAccess: restored && outcome.access ? outcome.access : null,
    };
  }

  /**
   * The guarded settle found nothing to change: no failed refund (404), one
   * settled another way (409), or the same settlement repeated (its row).
   */
  private async alreadySettledRefund(
    db: DatabaseClient | Tx,
    refundId: string,
    resolution: string
  ): Promise<typeof refunds.$inferSelect> {
    const [row] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    if (!row || row.status !== 'failed') {
      throw new NotFoundError('No failed refund with this id', { refundId });
    }
    if (row.resolution !== resolution) {
      throw new AlreadySettledError(row.resolution ?? 'unknown');
    }
    return row;
  }

  /** The re-pay payouts a refund's steps were paid back by. */
  private async repaidFor(stripeRefundId: string) {
    return this.db
      .select({
        id: payouts.id,
        userId: payouts.userId,
        amountCents: payouts.amountCents,
      })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payouts.id, payoutReversals.repaidByPayoutId))
      .where(
        and(
          eq(payoutReversals.causeType, 'refund'),
          eq(payoutReversals.causeId, stripeRefundId)
        )
      )
      .orderBy(asc(payouts.createdAt), asc(payouts.id));
  }

  /**
   * Settle a creator debt: the guarded UPDATE on an open review. The step
   * stays `debt`: the review is the record, and a later won chargeback reads
   * its resolution (`PAYEE_PAID_RESOLUTIONS`, @codex/payments). `dispute_won`
   * is never accepted here (Q7).
   */
  async resolveCreatorDebt(
    reviewId: string,
    input: SupportResolveCreatorDebtInput,
    resolvedByUserId: string
  ): Promise<ResolvedCreatorDebt> {
    try {
      const [row] = await this.db
        .update(refundReviews)
        .set({
          resolution: input.resolution,
          resolvedAt: new Date(),
          resolvedByUserId,
          resolutionNote: input.note === '' ? null : input.note,
        })
        .where(
          and(eq(refundReviews.id, reviewId), isNull(refundReviews.resolvedAt))
        )
        .returning();
      let resolvedAt = row?.resolvedAt;
      if (!row) {
        const [existing] = await this.db
          .select({
            resolution: refundReviews.resolution,
            resolvedAt: refundReviews.resolvedAt,
          })
          .from(refundReviews)
          .where(eq(refundReviews.id, reviewId))
          .limit(1);
        if (!existing) {
          throw new NotFoundError('No creator debt with this id', { reviewId });
        }
        if (existing.resolution !== input.resolution) {
          throw new AlreadySettledError(existing.resolution ?? 'unknown');
        }
        resolvedAt = existing.resolvedAt;
      } else {
        this.obs.info('Support settled a creator debt', {
          reviewId,
          resolution: input.resolution,
          resolvedByUserId,
        });
      }
      return {
        reviewId,
        resolution: input.resolution,
        resolvedAt: (resolvedAt ?? new Date()).toISOString(),
      };
    } catch (error) {
      this.handleError(error, 'resolveCreatorDebt');
    }
  }

  // ==========================================================================
  // Shared reads
  // ==========================================================================

  /**
   * What a charge paid for, from our records: its platform-fee slice (every
   * charge has one), else a refund or dispute recorded on it, else, for a
   * purchase recorded before charge ids were (D8), Stripe's PaymentIntent.
   * None is a 404: support never refunds a charge we hold no record of (the
   * Stripe sandbox is shared with other environments).
   */
  private async sourceOfCharge(
    chargeId: string,
    readCharge: () => Promise<Stripe.Charge>
  ): Promise<ChargeSource> {
    const [fee] = await this.db
      .select({
        purchaseId: payouts.purchaseId,
        subscriptionId: payouts.subscriptionId,
        courseSubscriptionId: payouts.courseSubscriptionId,
      })
      .from(payouts)
      .where(
        and(
          eq(payouts.stripeChargeId, chargeId),
          eq(payouts.payoutType, 'platform_fee')
        )
      )
      .limit(1);
    const fromFee = sourceFromIds(fee);
    if (fromFee) return fromFee;

    const [refund] = await this.db
      .select({ purchaseId: refunds.purchaseId })
      .from(refunds)
      .where(
        and(eq(refunds.stripeChargeId, chargeId), isNotNull(refunds.purchaseId))
      )
      .limit(1);
    if (refund?.purchaseId) {
      return { type: 'purchase', purchaseId: refund.purchaseId };
    }
    const [dispute] = await this.db
      .select({
        purchaseId: disputes.purchaseId,
        subscriptionId: disputes.subscriptionId,
        courseSubscriptionId: disputes.courseSubscriptionId,
      })
      .from(disputes)
      .where(eq(disputes.stripeChargeId, chargeId))
      .limit(1);
    const fromDispute = sourceFromIds(dispute);
    if (fromDispute) return fromDispute;

    const paymentIntentId = paymentIntentIdOf(await readCharge());
    if (paymentIntentId) {
      const [purchase] = await this.db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
        .limit(1);
      if (purchase) return { type: 'purchase', purchaseId: purchase.id };
    }
    throw new NotFoundError('No record of this charge', { chargeId });
  }

  /** A charge, read from Stripe once per call (`expand` for the fee). */
  private chargeReader(
    chargeId: string,
    expand: boolean
  ): () => Promise<Stripe.Charge> {
    let read: Promise<Stripe.Charge> | undefined;
    return () => {
      read ??= this.retrieveCharge(chargeId, expand);
      return read;
    };
  }

  private async retrieveCharge(
    chargeId: string,
    expand: boolean
  ): Promise<Stripe.Charge> {
    try {
      return expand
        ? await this.stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction'],
          })
        : await this.stripe.charges.retrieve(chargeId);
    } catch (error) {
      if (isStripeMissing(error)) {
        throw new NotFoundError('Stripe holds no such charge', { chargeId });
      }
      throw error;
    }
  }

  /** The source's record: what was bought, by whom, from which organisation. */
  private async sourceView(source: ChargeSource): Promise<SourceView> {
    if (source.type === 'purchase') {
      const [row] = await this.db
        .select({
          purchase: {
            id: purchases.id,
            status: purchases.status,
            contentId: purchases.contentId,
            courseId: purchases.courseId,
          },
          buyer: {
            id: users.id,
            name: users.name,
            email: users.email,
            deletedAt: users.deletedAt,
          },
          contentTitle: content.title,
          contentDeletedAt: content.deletedAt,
          courseTitle: courses.title,
          org: {
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            deletedAt: organizations.deletedAt,
          },
        })
        .from(purchases)
        .innerJoin(users, eq(users.id, purchases.customerId))
        .leftJoin(content, eq(content.id, purchases.contentId))
        .leftJoin(courses, eq(courses.id, purchases.courseId))
        .leftJoin(organizations, eq(organizations.id, purchases.organizationId))
        .where(eq(purchases.id, source.purchaseId))
        .limit(1);
      if (!row) {
        throw new NotFoundError('No record of this purchase', {
          purchaseId: source.purchaseId,
        });
      }
      const item = row.purchase.contentId
        ? {
            kind: 'content' as const,
            id: row.purchase.contentId,
            title: row.contentTitle ?? '',
            deleted: row.contentDeletedAt !== null,
          }
        : row.purchase.courseId
          ? {
              kind: 'course' as const,
              id: row.purchase.courseId,
              title: row.courseTitle ?? '',
              deleted: false,
            }
          : null;
      return {
        source: {
          type: 'purchase',
          purchaseId: row.purchase.id,
          status: row.purchase.status,
          item,
        },
        buyer: buyerOf(row.buyer),
        organization: row.org
          ? {
              id: row.org.id,
              name: row.org.name,
              slug: row.org.slug,
              deleted: row.org.deletedAt !== null,
            }
          : null,
        title: item?.title ?? '',
      };
    }

    const table =
      source.type === 'subscription' ? subscriptions : courseSubscriptions;
    const [row] = await this.db
      .select({
        id: table.id,
        status: table.status,
        interval: table.billingInterval,
        periodStart: table.currentPeriodStart,
        periodEnd: table.currentPeriodEnd,
        userId: table.userId,
        organizationId: table.organizationId,
      })
      .from(table)
      .where(eq(table.id, source.subscriptionId))
      .limit(1);
    if (!row) {
      throw new NotFoundError('No record of this subscription', {
        subscriptionId: source.subscriptionId,
      });
    }
    const [[buyer], [org], [plan]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1),
      row.organizationId
        ? this.db
            .select({
              id: organizations.id,
              name: organizations.name,
              slug: organizations.slug,
              deletedAt: organizations.deletedAt,
            })
            .from(organizations)
            .where(eq(organizations.id, row.organizationId))
            .limit(1)
        : Promise.resolve([]),
      source.type === 'subscription'
        ? this.db
            .select({
              name: subscriptionTiers.name,
              deletedAt: subscriptionTiers.deletedAt,
            })
            .from(subscriptions)
            .innerJoin(
              subscriptionTiers,
              eq(subscriptionTiers.id, subscriptions.tierId)
            )
            .where(eq(subscriptions.id, row.id))
            .limit(1)
        : this.db
            .select({
              name: courses.title,
              deletedAt: sql<Date | null>`NULL`,
            })
            .from(courseSubscriptions)
            .innerJoin(courses, eq(courses.id, courseSubscriptions.courseId))
            .where(eq(courseSubscriptions.id, row.id))
            .limit(1),
    ]);
    if (!buyer) {
      throw new NotFoundError('No record of the subscriber', {
        subscriptionId: row.id,
      });
    }
    return {
      source: {
        type: source.type,
        subscriptionId: row.id,
        planName: plan?.name ?? '',
        planDeleted: plan?.deletedAt != null,
        interval: billingInterval(row.interval) ?? 'month',
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        status: row.status,
      },
      buyer: buyerOf(buyer),
      organization: org
        ? {
            id: org.id,
            name: org.name,
            slug: org.slug,
            deleted: org.deletedAt !== null,
          }
        : null,
      title: plan?.name ?? '',
    };
  }

  /**
   * Title, buyer and amount for the queue's charges: a purchase's from its
   * row, an invoice's from its platform-fee slice and the charge's slices.
   */
  private async chargeFacts(
    refs: ReadonlyArray<{ chargeId: string; purchaseId: string | null }>
  ): Promise<
    Map<
      string,
      {
        kind: SupportChargeKind;
        title: string;
        buyer: SupportBuyer;
        amountCents: number;
      }
    >
  > {
    const facts = new Map<
      string,
      {
        kind: SupportChargeKind;
        title: string;
        buyer: SupportBuyer;
        amountCents: number;
      }
    >();
    const purchaseIds = unique(refs.map((ref) => ref.purchaseId));
    if (purchaseIds.length > 0) {
      const rows = await this.db
        .select({
          id: purchases.id,
          amountCents: purchases.amountPaidCents,
          contentTitle: content.title,
          courseTitle: courses.title,
          buyer: {
            id: users.id,
            name: users.name,
            email: users.email,
            deletedAt: users.deletedAt,
          },
        })
        .from(purchases)
        .innerJoin(users, eq(users.id, purchases.customerId))
        .leftJoin(content, eq(content.id, purchases.contentId))
        .leftJoin(courses, eq(courses.id, purchases.courseId))
        .where(inArray(purchases.id, purchaseIds));
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const ref of refs) {
        const row = ref.purchaseId ? byId.get(ref.purchaseId) : undefined;
        if (!row) continue;
        facts.set(ref.chargeId, {
          kind: 'purchase',
          title: row.contentTitle ?? row.courseTitle ?? '',
          buyer: buyerOf(row.buyer),
          amountCents: row.amountCents,
        });
      }
    }

    const invoiceCharges = unique(
      refs.filter((ref) => !facts.has(ref.chargeId)).map((ref) => ref.chargeId)
    );
    if (invoiceCharges.length > 0) {
      const rows = await this.invoiceCharges(
        inArray(payouts.stripeChargeId, invoiceCharges)
      );
      for (const row of rows) {
        if (!row.chargeId) continue;
        facts.set(row.chargeId, {
          kind: row.kind,
          title: row.title,
          buyer: {
            userId: row.buyerId,
            name: row.buyerName,
            email: row.buyerEmail,
            deleted: row.buyerDeleted,
          },
          amountCents: row.amountCents,
        });
      }
    }
    return facts;
  }

  /** What each refund's clawback took from payees: done steps, not the fee's share. */
  private async takenFromPayees(
    stripeRefundIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (stripeRefundIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        causeId: payoutReversals.causeId,
        cents: sql<number>`COALESCE(SUM(${payoutReversals.amountCents}), 0)::int`,
      })
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.causeType, 'refund'),
          inArray(payoutReversals.causeId, [...stripeRefundIds]),
          eq(payoutReversals.status, 'done'),
          ne(payoutReversals.kind, 'retained_fee')
        )
      )
      .groupBy(payoutReversals.causeId);
    return new Map(rows.map((row) => [row.causeId, row.cents]));
  }

  /** Each slice's history, for the creator-debt rows. */
  private async historiesFor(
    sliceIds: readonly string[]
  ): Promise<Map<string, SliceHistory>> {
    const ids = unique(sliceIds);
    if (ids.length === 0) return new Map();
    const onSlices = await this.db
      .select()
      .from(payoutReversals)
      .where(inArray(payoutReversals.payoutId, ids));
    const repayIds = unique(onSlices.map((step) => step.repaidByPayoutId));
    const onRepay =
      repayIds.length === 0
        ? []
        : await this.db
            .select()
            .from(payoutReversals)
            .where(inArray(payoutReversals.payoutId, repayIds));
    const steps = [...onSlices, ...onRepay];
    const context = await this.historyContext(steps);
    return new Map(ids.map((id) => [id, sliceHistory(id, steps, context)]));
  }

  /** What the history rule reads besides the steps: causes, wins, debt settlements. */
  private async historyContext(
    steps: readonly PayoutReversal[]
  ): Promise<HistoryContext> {
    const causes = await this.causeFacts(steps);
    const debtIds = steps
      .filter((step) => step.status === 'debt')
      .map((step) => step.id);
    const reviews =
      debtIds.length === 0
        ? []
        : await this.db
            .select({
              payoutReversalId: refundReviews.payoutReversalId,
              resolution: refundReviews.resolution,
            })
            .from(refundReviews)
            .where(inArray(refundReviews.payoutReversalId, debtIds));
    return {
      causeAmounts: new Map(
        [...causes].flatMap(([key, cause]) =>
          cause.amountCents === null ? [] : [[key, cause.amountCents]]
        )
      ),
      wonDisputeIds: new Set(
        [...causes.values()]
          .filter((cause) => cause.disputeStatus === 'won')
          .map((cause) => cause.id)
      ),
      debtResolutions: new Map(
        reviews.flatMap((review) =>
          review.payoutReversalId
            ? [[review.payoutReversalId, review.resolution]]
            : []
        )
      ),
    };
  }

  /** Each refund's and dispute's own amount, and a dispute's current status. */
  private async causeFacts(
    refs: ReadonlyArray<{ causeType: string; causeId: string }>
  ): Promise<
    Map<
      string,
      { id: string; amountCents: number | null; disputeStatus: string | null }
    >
  > {
    const refundIds = unique(
      refs.filter((ref) => ref.causeType === 'refund').map((ref) => ref.causeId)
    );
    const disputeIds = unique(
      refs
        .filter((ref) => ref.causeType === 'dispute')
        .map((ref) => ref.causeId)
    );
    const [refundRows, disputeRows] = await Promise.all([
      refundIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              id: refunds.stripeRefundId,
              amountCents: refunds.amountCents,
            })
            .from(refunds)
            .where(inArray(refunds.stripeRefundId, refundIds)),
      disputeIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              id: disputes.stripeDisputeId,
              amountCents: disputes.amountCents,
              status: disputes.status,
            })
            .from(disputes)
            .where(inArray(disputes.stripeDisputeId, disputeIds)),
    ]);
    const facts = new Map<
      string,
      { id: string; amountCents: number | null; disputeStatus: string | null }
    >();
    for (const row of refundRows) {
      facts.set(causeKey('refund', row.id), {
        id: row.id,
        amountCents: row.amountCents,
        disputeStatus: null,
      });
    }
    for (const row of disputeRows) {
      facts.set(causeKey('dispute', row.id), {
        id: row.id,
        amountCents: row.amountCents,
        disputeStatus: row.status,
      });
    }
    return facts;
  }

  /** Names for user ids (payees, requesters); a soft-deleted user is flagged. */
  private async peopleById(
    userIds: readonly (string | null | undefined)[]
  ): Promise<Map<string, SupportPerson>> {
    const ids = unique(userIds);
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, name: users.name, deletedAt: users.deletedAt })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(
      rows.map((row) => [
        row.id,
        { userId: row.id, name: row.name, deleted: row.deletedAt !== null },
      ])
    );
  }

  private async organizationNames(
    organizationIds: readonly (string | null | undefined)[]
  ): Promise<Map<string, string>> {
    const ids = unique(organizationIds);
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, ids));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
