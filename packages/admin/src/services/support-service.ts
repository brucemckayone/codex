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
 *   preview, for a subscription invoice;
 * - settling a failed refund `creators_repaid`: `charges.retrieve(id)` (its
 *   amount, for the later-cause guard), `refunds.list` (the engine's causes),
 *   and `transfers.listReversals(transferId)` for each step no retry will run
 *   (`settleUnfinishedRefundSteps`, @codex/payments); for a stranded
 *   cancellation, also `transfers.list({ destination, created, limit: 100 })`
 *   on each account the payee has had, and `transfers.retrieve(id)`
 *   (Codex-2hxff.71);
 * - the Creator debts tab: `balance.retrieve({}, { stripeAccount })` on each
 *   listed person's account, 5 s each, for the live balance (Codex-2hxff.73;
 *   the key needs Balance: Read on connected accounts);
 * - "Check Stripe again" on an Owed to creators row (`recheckPayeeCredit`,
 *   @codex/payments): `transfers.listReversals`, `transfers.retrieve` and
 *   `transfers.list({ destination, … })`.
 */

import {
  STRIPE_ENV_METADATA_KEY,
  STRIPE_REQUESTED_BY_METADATA_KEY,
  STRIPE_SUPPORT_KEY_METADATA_KEY,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import { type DatabaseClient, toIso, withPagination } from '@codex/database';
import {
  agreementProposals,
  type ConnectBalance,
  connectBalances,
  content,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  creatorOrganizationAgreements,
  disputes,
  type FeeChangeRow,
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  type Payout,
  type PayoutReversal,
  type PriceChange,
  payeeCredits,
  payoutReversals,
  payouts,
  priceChanges,
  purchases,
  refundReviews,
  refunds,
  type SubscriptionPriceMove,
  stripeConnectAccounts,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  type ClawbackSource,
  DEBT_INVOICE_AFTER_DAYS,
  DEBT_INVOICE_THRESHOLD_CENTS,
  dateRiseIfAllTold,
  type FeeLevel,
  type FeeVersionList,
  type FeeVersionValues,
  failedRefundRepayBlock,
  feeLevelKey,
  feeRiseStartAfter,
  type GbpBalance,
  issueRefund as issueStripeRefund,
  type LevelFees,
  layerLevelFees,
  listChargeRefunds,
  listClawableRefunds,
  loadClawbackCauses,
  loadClawbackPlanInput,
  nextFeeNoticeRunAfter,
  nextPriceMovesRunAfter,
  payeeCreditsNeedingAPerson,
  pendingReductionsFor,
  planClawback,
  readFeeVersions,
  readFeeVersionsByLevel,
  readGbpBalance,
  recheckPayeeCredit,
  refundWindow,
  repayBlockedError,
  repayFailedRefund,
  reportPayeeKept,
  resolvePayeeCredit,
  type StrandedStep,
  settleUnfinishedRefundSteps,
  versionInForce,
} from '@codex/payments';
import {
  type FeeConfigService,
  type PurchaseService,
  type RestoredRefundAccess,
  STANDING_REFUND_STATUSES,
  supportRequesterOf,
} from '@codex/purchase';
import {
  BaseService,
  ConflictError,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import { isCurrentPeriodPayment } from '@codex/subscription';
import {
  type SupportChargeSearchQuery,
  type SupportClosePriceMoveInput,
  type SupportIssueRefundInput,
  type SupportQueueQuery,
  type SupportResolveCreatorDebtInput,
  type SupportResolveCreditInput,
  type SupportResolveFailedRefundInput,
  type SupportToldAnotherWayInput,
  uuidSchema,
} from '@codex/validation';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';
import {
  AlreadySettledError,
  ChargebackSettlingError,
  ChargeChangedError,
  ChargeHasChargebackError,
  LateWinRefundNotRepayableError,
  NothingLeftToRefundError,
  RefundAmountTooLargeError,
  RefundedOutsideStripeError,
  RefundInFlightError,
  RefundKeySpentError,
  RefundWindowClosedError,
  StripeRefusedRefundError,
} from '../errors';
import type {
  AccessRestorePrediction,
  ChargebackRow,
  ChargeDetail,
  ChargeDetailSource,
  ChargeSummary,
  CheckedOwedToCreator,
  CreatorDebtItem,
  CreatorDebtPerson,
  FailedRefundItem,
  FeeChangeCard,
  FeeChangeLine,
  FeeNoticeItem,
  FeeToldAnotherWay,
  FeeToldOnDay,
  HeldPriceMove,
  OwedToCreatorItem,
  PayeeRole,
  PriceChangeRestarted,
  PriceMoveHeldReason,
  PriceMoveNotHeldReason,
  PriceMovePlan,
  PriceMoveRetried,
  QueueCause,
  RefundBlock,
  RefundPreview,
  RefundRequester,
  RefundRow,
  ResolvedCreatorDebt,
  ResolvedFailedRefund,
  ResolvedOwedToCreator,
  Slice,
  StoppedPriceChange,
  StripeHeldTakeBack,
  SupportBuyer,
  SupportChargeKind,
  SupportPerson,
  SupportQueueCounts,
  SupportRefundResult,
  SupportRefundWindow,
  SystemDecision,
  ToldAnotherWayResult,
} from '../support-types';
import {
  causeKey,
  chargebackState,
  creditAction,
  creditState,
  debtErrorLabel,
  debtStanding,
  type HistoryContext,
  isSettlingDispute,
  previewLabel,
  refundFailureLabel,
  refundHolds,
  type SliceHistory,
  sliceHistory,
} from './support-ledger';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Creator debts tab's live balance read, per account: a slow Stripe never
 * holds the page (data design §4.3). No retry: the snapshot is the fallback.
 */
const LIVE_BALANCE_REQUEST = {
  timeout: 5_000,
  maxNetworkRetries: 0,
} as const satisfies Stripe.RequestOptions;

/** A payee's role on a slice of this payout type. */
function payeeRoleOf(payoutType: string): PayeeRole {
  return payoutType === 'creator_payout' ? 'creator' : 'organisation_owner';
}

/** A queue row's refund or chargeback, with what we hold of it. */
function queueCause(
  causeType: string,
  causeId: string,
  facts:
    | { amountCents: number | null; disputeStatus: string | null }
    | undefined
): QueueCause {
  return {
    type: causeType === 'dispute' ? 'dispute' : 'refund',
    id: causeId,
    amountCents: facts?.amountCents ?? null,
    disputeStatus: facts?.disputeStatus ?? null,
  };
}

/** What the settlement's transaction needs from the Stripe pre-step. */
interface PreparedRepay {
  /** The Stripe charge's amount: the guard's denominator. */
  chargeAmountCents: number;
  /** Steps no retry will run whose reversal never landed: cancelled in the transaction. */
  unlanded: StrandedStep[];
  /**
   * The slices whose stranded step the system settled as `took_share`
   * (Codex-2hxff.71). The `payee_kept` ones are cancelled in the
   * transaction, so they come back from `repayFailedRefund`.
   */
  tookShare: string[];
}

export interface SupportServiceConfig extends ServiceConfig {
  /** The registry's shared client, on admin-api's own restricted key (Q4). */
  stripe: Stripe;
  /**
   * Gives a purchase its access back when support re-pays a failed full
   * refund (Q5d), and predicts it for the queue by the same rule.
   */
  purchase: Pick<
    PurchaseService,
    'restoreAfterFailedRefund' | 'failedRefundRestoreBlock'
  >;
  /** Makes a level's fee read fresh after "told another way" dates a rise. */
  feeConfig: Pick<FeeConfigService, 'invalidateLevel'>;
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
  return refundedCentsIn(listed, STANDING_REFUND_STATUSES);
}

/** What the listed refunds in any of these statuses add up to. */
function refundedCentsIn(
  listed: readonly Stripe.Refund[],
  statuses: readonly string[]
): number {
  return listed
    .filter((refund) => statuses.includes(refund.status ?? ''))
    .reduce((sum, refund) => sum + refund.amount, 0);
}

/**
 * The metadata key a late win's own refund carries: its dispute's Stripe id,
 * written in the same call that makes the refund (`issueLateWinRefund`,
 * `@codex/purchase`). Keep the two in step.
 */
const LATE_WIN_REFUND_METADATA = 'codex_late_win_dispute';

/**
 * The dispute a late win made this refund for, by the refund's own metadata
 * at Stripe, or null. Unlike `disputes.late_win_refund_id`, which is written
 * only after Stripe answers, it can never be missing from a refund the late
 * win made (review cycle 2, finding 1).
 */
function lateWinDisputeMarked(
  listed: readonly Stripe.Refund[],
  stripeRefundId: string
): string | null {
  const value = listed.find((refund) => refund.id === stripeRefundId)
    ?.metadata?.[LATE_WIN_REFUND_METADATA];
  return typeof value === 'string' && value !== '' ? value : null;
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
 * The refusals Stripe documents for a refund: a business answer support is
 * shown (`STRIPE_REFUSED`, with the code). Any other invalid-request or card
 * error is a defect in our request, never a refusal (silent F2).
 */
const STRIPE_REFUND_REFUSALS: ReadonlySet<string> = new Set([
  'action_blocked',
  'amount_too_large',
  'amount_too_small',
  'balance_insufficient',
  'charge_already_refunded',
  'charge_disputed',
  'insufficient_funds',
  'refund_disputed_payment',
]);

/** What a Stripe error carries that we read; never its message. */
interface StripeErrorFields {
  type?: unknown;
  statusCode?: unknown;
  code?: unknown;
  requestId?: unknown;
  headers?: Record<string, unknown>;
}

/**
 * Stripe answered with the response it saved under this idempotency key
 * (its `Idempotent-Replayed` header): an earlier failure, repeated for 24 h.
 */
function isReplayedAnswer(error: StripeErrorFields | null): boolean {
  return String(error?.headers?.['idempotent-replayed'] ?? '') === 'true';
}

/**
 * The split card's two figures, made here, not in the browser (web L3): what
 * was taken back from every slice, and the platform fee slice's share of the
 * charge in basis points, rounded half up (null with no fee slice, or a
 * charge of nothing).
 */
function splitTotals(
  slices: readonly Slice[],
  chargeAmountCents: number
): ChargeDetail['split'] {
  const fee = slices.find((slice) => slice.payoutType === 'platform_fee');
  return {
    takenTotalCents: slices.reduce((sum, slice) => sum + slice.takenCents, 0),
    platformFeeShareBps:
      fee && chargeAmountCents > 0
        ? Math.round((fee.amountCents * 10_000) / chargeAmountCents)
        : null,
  };
}

/** A refund this decision's key already made: the answer is a replay. */
function replayOf(refund: Stripe.Refund): SupportRefundResult {
  return {
    refund: {
      id: refund.id,
      amountCents: refund.amount,
      status: refund.status ?? 'unknown',
      createdAt: stripeSeconds(refund.created),
    },
    replayed: true,
  };
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

/**
 * Why the form can't refund the charge, in the refund route's order, so the
 * form and the route agree. Refunded outside Stripe comes first: nothing
 * lifts it, the window included (owner decision 2026-11-08).
 */
function refundBlockOf(input: {
  outsideStripe: Date | null;
  windowOpen: boolean;
  holds: { blocking: string | null; settling: boolean };
  maxCents: number;
}): RefundBlock | null {
  if (input.outsideStripe) return 'refunded_outside_stripe';
  if (!input.windowOpen) return 'window_closed';
  if (input.holds.blocking) return 'chargeback';
  if (input.holds.settling) return 'chargeback_settling';
  return input.maxCents === 0 ? 'nothing_left' : null;
}

/**
 * When support settled the charge by hand and refunded the buyer outside
 * Stripe (`refunded_outside_stripe_at`, docs/payments/operations.md): the
 * earliest of its disputes', or null. A charge with one is never refunded
 * through Stripe again (owner decision 2026-11-08, "Block it in code").
 */
function refundedOutsideStripeAt(
  rows: ReadonlyArray<{ refundedOutsideStripeAt: Date | null }>
): Date | null {
  let earliest: Date | null = null;
  for (const { refundedOutsideStripeAt: at } of rows) {
    if (at && (!earliest || at < earliest)) earliest = at;
  }
  return earliest;
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
  private readonly feeConfig: SupportServiceConfig['feeConfig'];

  constructor(config: SupportServiceConfig) {
    super(config);
    this.stripe = config.stripe;
    this.purchase = config.purchase;
    this.feeConfig = config.feeConfig;
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
      const scope = await this.searchScope(query.lookup);
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
          window: this.windowView(
            Math.floor(paidAt.getTime() / 1000),
            now,
            row.lateWon
          ),
        });
      }
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'searchCharges');
    }
  }

  /**
   * Which purchases and which invoice charges `lookup` names; null for nothing.
   * Each is a point lookup on an indexed key.
   */
  private async searchScope(
    lookup: string
  ): Promise<{ purchases: SQL; invoices: SQL } | null> {
    const none = sql`false`;
    if (lookup.includes('@')) {
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, lookup.toLowerCase()))
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
    if (uuidSchema.safeParse(lookup).success) {
      return {
        purchases: eq(purchases.id, lookup),
        invoices: either(
          eq(payouts.subscriptionId, lookup),
          eq(payouts.courseSubscriptionId, lookup)
        ),
      };
    }
    if (lookup.startsWith('sub_')) {
      return {
        purchases: none,
        invoices: either(
          inArray(
            payouts.subscriptionId,
            this.db
              .select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.stripeSubscriptionId, lookup))
          ),
          inArray(
            payouts.courseSubscriptionId,
            this.db
              .select({ id: courseSubscriptions.id })
              .from(courseSubscriptions)
              .where(eq(courseSubscriptions.stripeSubscriptionId, lookup))
          )
        ),
      };
    }
    if (lookup.startsWith('pi_')) {
      const [purchase] = await this.db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, lookup))
        .limit(1);
      if (purchase) {
        return { purchases: eq(purchases.id, purchase.id), invoices: none };
      }
      // An invoice's payment, or a purchase we hold under its charge only.
      const chargeId = await this.latestChargeOf(lookup);
      return chargeId ? this.chargeScope(chargeId) : null;
    }
    if (lookup.startsWith('ch_') || lookup.startsWith('py_')) {
      return this.chargeScope(lookup);
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
          // Owner Q7: a late-won payment has no 14-day window, unless it
          // was refunded outside Stripe (owner decision 2026-11-08).
          lateWon:
            sql<boolean>`EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.purchaseId} = ${purchases.id} AND ${disputes.lateWonAt} IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.purchaseId} = ${purchases.id} AND ${disputes.refundedOutsideStripeAt} IS NOT NULL)`.as(
              'late_won'
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
        lateWon:
          sql<boolean>`EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.stripeChargeId} = ${payouts.stripeChargeId} AND ${disputes.lateWonAt} IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.stripeChargeId} = ${payouts.stripeChargeId} AND ${disputes.refundedOutsideStripeAt} IS NOT NULL)`.as(
            'late_won'
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
      const holds = refundHolds(disputeRows);
      const outsideStripe = refundedOutsideStripeAt(disputeRows);
      const window = this.windowView(
        charge.created,
        now,
        holds.lateWon && outsideStripe === null
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

      const slices = await this.slicesOf(ledger.slices, ledger.steps);
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
          blocked: refundBlockOf({
            outsideStripe,
            windowOpen: window.isOpen,
            holds,
            maxCents,
          }),
          refundedOutsideStripeOn: toIso(outsideStripe),
        },
        refundCount: listed.length,
        slices,
        split: splitTotals(slices, charge.amount),
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

  /**
   * The 14-day window. A late-won payment's is lifted once it has closed
   * (owner Q7): open, its closing date kept. The callers pass `lateWon`
   * false for a charge refunded outside Stripe, which nothing lifts.
   */
  private windowView(
    createdSeconds: number,
    now: Date,
    lateWon: boolean
  ): SupportRefundWindow {
    const window = refundWindow(createdSeconds, now);
    const liftedByLateWin = lateWon && !window.isOpen;
    return {
      closesAt: window.closesAt.toISOString(),
      isOpen: window.isOpen || liftedByLateWin,
      liftedByLateWin,
    };
  }

  /** The charge's slices, payees first, each with its history. */
  private async slicesOf(
    slices: readonly Payout[],
    steps: readonly PayoutReversal[]
  ): Promise<Slice[]> {
    const [people, orgs, context, shares] = await Promise.all([
      this.peopleById(slices.map((slice) => slice.userId)),
      this.organizationNames(slices.map((slice) => slice.organizationId)),
      this.historyContext(steps),
      this.agreementShares(slices.map((slice) => slice.id)),
    ]);
    return [...slices]
      .sort(
        (a, b) =>
          (SLICE_ORDER[a.payoutType] ?? 9) - (SLICE_ORDER[b.payoutType] ?? 9) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )
      .map((slice) => {
        const { history, takenCents, owedCents, owedToPayeeCents } =
          sliceHistory(slice.id, steps, context);
        return {
          payoutId: slice.id,
          payoutType: slice.payoutType,
          payee: slice.userId ? (people.get(slice.userId) ?? null) : null,
          organizationName: slice.organizationId
            ? (orgs.get(slice.organizationId) ?? null)
            : null,
          amountCents: slice.amountCents,
          agreementShareBps: shares.get(slice.id) ?? null,
          status: slice.status,
          reason: slice.reason,
          paidAt:
            slice.status === 'paid' || slice.status === 'reversed'
              ? toIso(slice.resolvedAt)
              : null,
          transferId: slice.stripeTransferId,
          takenCents,
          owedCents,
          owedToPayeeCents,
          history,
        };
      });
  }

  /**
   * Each creator slice's agreement share, by payout id: an invoice slice
   * names its agreement, a purchase's creator slice takes its purchase's. An
   * accepted agreement's proposal never changes, so its share is the one the
   * slice was split by.
   */
  private async agreementShares(
    payoutIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (payoutIds.length === 0) return new Map();
    const agreementId = sql`COALESCE(${payouts.creatorOrgAgreementId}, CASE WHEN ${payouts.payoutType} = 'creator_payout' THEN ${purchases.creatorOrgAgreementId} END)`;
    const rows = await this.db
      .select({
        payoutId: payouts.id,
        shareBps: agreementProposals.proposedCreatorSharePercent,
      })
      .from(payouts)
      .leftJoin(purchases, eq(purchases.id, payouts.purchaseId))
      .innerJoin(
        creatorOrganizationAgreements,
        eq(creatorOrganizationAgreements.id, agreementId)
      )
      .innerJoin(
        agreementProposals,
        eq(
          agreementProposals.id,
          creatorOrganizationAgreements.currentProposalId
        )
      )
      .where(inArray(payouts.id, [...payoutIds]));
    return new Map(rows.map((row) => [row.payoutId, row.shareBps]));
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
        lostOn: toIso(row.lostAppliedAt),
        lateWonOn: toIso(row.lateWonAt),
        settling: isSettlingDispute(row),
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
      const [listed, holds] = await Promise.all([
        listChargeRefunds(this.stripe, chargeId),
        this.refundHoldsOf(chargeId),
      ]);
      // As the detail's block reads, before the amount it would refuse.
      if (holds.refundedOutsideStripeAt) {
        throw new RefundedOutsideStripeError(holds.refundedOutsideStripeAt);
      }
      if (holds.settling) throw new ChargebackSettlingError();
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

  /**
   * `refundHolds` over the charge's disputes as they stand now, and when the
   * charge was refunded outside Stripe, if it was.
   */
  private async refundHoldsOf(chargeId: string) {
    const rows = await this.db
      .select({
        status: disputes.status,
        outcomeAppliedAt: disputes.outcomeAppliedAt,
        lateWonAt: disputes.lateWonAt,
        refundedOutsideStripeAt: disputes.refundedOutsideStripeAt,
      })
      .from(disputes)
      .where(eq(disputes.stripeChargeId, chargeId))
      .orderBy(asc(disputes.stripeCreatedAt), asc(disputes.stripeDisputeId));
    return {
      ...refundHolds(rows),
      refundedOutsideStripeAt: refundedOutsideStripeAt(rows),
    };
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
   * 4. a charge settled by hand and refunded outside Stripe (never again
   *    here, owner decision 2026-11-08), the window (server clock, Stripe's
   *    `charge.created`; a late-won payment has none, owner Q7), the
   *    chargeback block (the dispute's CURRENT status), a won chargeback
   *    still settling, and the amount cap;
   * 5. `refunds.create`, with the key and who asked; when Stripe does not
   *    make it, `refundNotMade` says why.
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
        (refund) => refund.metadata?.[STRIPE_SUPPORT_KEY_METADATA_KEY] === key
      );
      if (replay) return replayOf(replay);
      if (listed.length !== input.expectedRefundCount) {
        throw new ChargeChangedError(listed.length);
      }

      const charge = await readCharge();
      const holds = await this.refundHoldsOf(chargeId);
      // Settled by hand (owner decision 2026-11-08): never through Stripe,
      // whatever the window or a late win says.
      if (holds.refundedOutsideStripeAt) {
        throw new RefundedOutsideStripeError(holds.refundedOutsideStripeAt);
      }
      const window = refundWindow(charge.created, new Date());
      if (!window.isOpen && !holds.lateWon) {
        throw new RefundWindowClosedError(window.closesAt);
      }
      if (holds.blocking) throw new ChargeHasChargebackError(holds.blocking);
      if (holds.settling) throw new ChargebackSettlingError();
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
            [STRIPE_SUPPORT_KEY_METADATA_KEY]: key,
            [STRIPE_REQUESTED_BY_METADATA_KEY]: requestedByUserId,
          },
        });
      } catch (error) {
        return await this.refundNotMade(error, {
          chargeId,
          key,
          requestedByUserId,
        });
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

  /**
   * Stripe did not make the refund (data design §4; silent F1, F2). Every
   * answer is logged with ids and Stripe's code and request id, never its
   * message:
   *
   * - the key is held: the charge's refunds are read again, and one carrying
   *   the key is a replay. None, while a request with it is still running
   *   (409), is `REFUND_IN_FLIGHT`: it may still succeed, so nothing else
   *   may be tried yet. None, for an answer saved to other parameters (400
   *   `idempotency_error`), means the key is spent (`REFUND_KEY_SPENT`);
   * - Stripe repeated an answer saved under the key: a documented refusal is
   *   `STRIPE_REFUSED` with its code; a 500 or anything else is
   *   `REFUND_KEY_SPENT`, since retrying this amount cannot work;
   * - a refusal Stripe documents is `STRIPE_REFUSED` with its code;
   * - any other invalid-request or card error is our defect: a 500, alerted;
   * - anything else (an outage, a rate limit, a key without the permission)
   *   propagates.
   */
  private async refundNotMade(
    error: unknown,
    attempt: { chargeId: string; key: string; requestedByUserId: string }
  ): Promise<SupportRefundResult> {
    const e = error as StripeErrorFields | null;
    const stripeCode =
      typeof e?.code === 'string' && e.code.length > 0
        ? e.code.slice(0, 64)
        : 'unknown';
    const facts = {
      chargeId: attempt.chargeId,
      stripeCode,
      stripeRequestId: typeof e?.requestId === 'string' ? e.requestId : null,
      statusCode: typeof e?.statusCode === 'number' ? e.statusCode : null,
      requestedByUserId: attempt.requestedByUserId,
    };
    // A 409 is a request with this key still running (nothing saved yet);
    // a 400 `idempotency_error` is a saved answer to other parameters.
    const inFlight =
      e?.statusCode === 409 || stripeCode === 'idempotency_key_in_use';
    if (inFlight || e?.type === 'StripeIdempotencyError') {
      const listed = await listChargeRefunds(this.stripe, attempt.chargeId);
      const made = listed.find(
        (refund) =>
          refund.metadata?.[STRIPE_SUPPORT_KEY_METADATA_KEY] === attempt.key
      );
      if (made) return replayOf(made);
      if (inFlight) {
        this.obs.warn('A support refund with this key is still running', facts);
        throw new RefundInFlightError();
      }
      this.obs.warn(
        'A support refund key is held, and no refund carries it',
        facts
      );
      throw new RefundKeySpentError();
    }
    if (isReplayedAnswer(e)) {
      this.obs.warn(
        'Stripe repeated an earlier failure of this support refund',
        facts
      );
      // A refusal keeps its code (LOW-E); a replayed outage or defect cannot
      // be retried for this amount.
      if (STRIPE_REFUND_REFUSALS.has(stripeCode)) {
        throw new StripeRefusedRefundError(stripeCode);
      }
      throw new RefundKeySpentError();
    }
    if (
      e?.type === 'StripeCardError' ||
      e?.type === 'StripeInvalidRequestError'
    ) {
      if (STRIPE_REFUND_REFUSALS.has(stripeCode)) {
        this.obs.warn('Stripe refused a support refund', facts);
        throw new StripeRefusedRefundError(stripeCode);
      }
      this.obs.error(
        'Stripe rejected a support refund request: a defect in the request, not a refusal',
        { errorId: crypto.randomUUID(), ...facts }
      );
      throw new InternalServiceError('The refund request was not accepted');
    }
    throw error;
  }

  // ==========================================================================
  // The queue (routes 5, 6, 7)
  // ==========================================================================

  /**
   * The queue's counts, each through partial indexes. Creator debts
   * counts PEOPLE who need a person (owner decision OQ2): an open debt Stripe
   * refused, a Stripe-held balance over £50 for 90 days ("To invoice", on
   * the morning snapshot), or a debt over £50 Stripe collected from the
   * platform, awaiting the P6 invoice (AMENDMENT 2). Each person once. A
   * balance Stripe is recovering by itself is listed on the tab, not counted.
   * Fee notices counts people not yet told about a fee rise that hasn't
   * started, joiners included (Codex-2hxff.33, Q4). Price moves counts held
   * moves not closed (`idx_price_moves_held_open`) plus stopped changes
   * nobody has pressed Restart on (Codex-2hxff.85, .86).
   */
  async getQueueCounts(): Promise<SupportQueueCounts> {
    try {
      const invoiceFrom = new Date(
        Date.now() - DEBT_INVOICE_AFTER_DAYS * DAY_MS
      );
      const needing = this.db
        .select({ userId: refundReviews.creatorUserId })
        .from(refundReviews)
        .where(isNull(refundReviews.resolvedAt))
        .union(
          this.db
            .select({ userId: connectBalances.userId })
            .from(connectBalances)
            .where(isNotNull(connectBalances.negativeSince))
            .groupBy(connectBalances.userId)
            .having(
              and(
                sql`MIN(${connectBalances.negativeSince}) <= ${invoiceFrom}`,
                sql`SUM(GREATEST(0, -COALESCE(${connectBalances.availableCents}, 0))) > ${DEBT_INVOICE_THRESHOLD_CENTS}`
              )
            )
        )
        .union(
          this.db
            .select({ userId: connectBalances.userId })
            .from(connectBalances)
            .where(isNotNull(connectBalances.collectedOwedCents))
        )
        .as('needing');
      const [[failed], [debts], [owed], [fees], [held], [stopped]] =
        await Promise.all([
          this.db
            .select({ total: count() })
            .from(refunds)
            .where(
              and(eq(refunds.status, 'failed'), isNull(refunds.resolvedAt))
            ),
          this.db.select({ total: count() }).from(needing),
          this.db
            .select({ total: count() })
            .from(payeeCredits)
            .where(isNull(payeeCredits.resolvedAt)),
          this.db
            .select({ total: count() })
            .from(feeChangeNotices)
            .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
            .where(notToldYet(new Date())),
          this.db
            .select({ total: count() })
            .from(subscriptionPriceMoves)
            .where(
              and(
                eq(subscriptionPriceMoves.state, 'held'),
                isNull(subscriptionPriceMoves.resolvedAt)
              )
            ),
          this.db
            .select({ total: count() })
            .from(priceChanges)
            .where(stoppedAwaitingRestart()),
        ]);
      return {
        failedRefunds: failed?.total ?? 0,
        creatorDebts: debts?.total ?? 0,
        owedToCreators: owed?.total ?? 0,
        feeNotices: fees?.total ?? 0,
        priceMoves: (held?.total ?? 0) + (stopped?.total ?? 0),
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

      const { purchaseOf, unread } = await this.purchasesOfRefunds(
        rows.map(({ refund }) => ({
          chargeId: refund.stripeChargeId,
          purchaseId: refund.purchaseId,
        })),
        'predict'
      );
      const charges = await this.chargeFacts(
        rows.map(({ refund }) => ({
          chargeId: refund.stripeChargeId,
          purchaseId: purchaseOf.get(refund.stripeChargeId) ?? null,
        }))
      );
      const [taken, restoreBlocks] = await Promise.all([
        this.takenFromPayees(rows.map(({ refund }) => refund.stripeRefundId)),
        // What the settle's restore would answer, by its own rule (read only).
        Promise.all(
          rows.map(
            async ({ refund }): Promise<AccessRestorePrediction | null> => {
              if (unread.has(refund.stripeChargeId)) return 'unknown';
              const purchaseId = purchaseOf.get(refund.stripeChargeId);
              if (!purchaseId) return 'no_purchase';
              const block = await this.purchase.failedRefundRestoreBlock(
                purchaseId,
                refund.stripeChargeId
              );
              return block === undefined ? 'no_purchase' : block;
            }
          )
        ),
      ]);
      const items = rows.map(
        (
          { refund, requesterName, requesterDeletedAt },
          index
        ): FailedRefundItem => {
          const facts = charges.get(refund.stripeChargeId);
          return {
            refundId: refund.id,
            stripeRefundId: refund.stripeRefundId,
            chargeId: refund.stripeChargeId,
            kind: facts?.kind ?? null,
            title: facts?.title ?? null,
            buyer: facts?.buyer ?? null,
            chargeAmountCents: facts?.amountCents ?? null,
            chargePaidAt: facts ? facts.paidAt.toISOString() : null,
            amountCents: refund.amountCents,
            // Unknown, never "partial", with no record of the charge (LOW-F).
            isFull: facts ? refund.amountCents >= facts.amountCents : null,
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
            accessRestoreBlockedReason: restoreBlocks[index] ?? null,
          };
        }
      );
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listFailedRefunds');
    }
  }

  /**
   * Creator debts, ONE ROW PER PERSON (data design §4.3; owner decisions Q2,
   * Q4, Q7): everyone whose Stripe balance is below zero (Stripe holds the
   * debt), everyone with a debt Stripe refused (`refund_reviews`), and
   * everyone whose debt over £50 Stripe collected from the platform at 180
   * days (`collected_owed_cents`, design §14, AMENDMENT 2: `to_invoice`
   * until the P6 invoice, with no balance below zero needed), oldest first,
   * paginated by person. A refused take-back never moved the balance, so
   * those two never overlap.
   *
   * Each listed account's balance is read live, in parallel, 5 s each; a
   * failure shows the morning snapshot (`live: false`), never £0.00.
   */
  async listCreatorDebts(
    query: SupportQueueQuery
  ): Promise<PaginatedListResponse<CreatorDebtPerson>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const people = this.db
        .select({
          userId: connectBalances.userId,
          oldest: sql<string>`MIN(${connectBalances.negativeSince})`.as(
            'oldest'
          ),
        })
        .from(connectBalances)
        .where(isNotNull(connectBalances.negativeSince))
        .groupBy(connectBalances.userId)
        .unionAll(
          this.db
            .select({
              userId: refundReviews.creatorUserId,
              oldest: sql<string>`MIN(${refundReviews.createdAt})`.as('oldest'),
            })
            .from(refundReviews)
            .where(isNull(refundReviews.resolvedAt))
            .groupBy(refundReviews.creatorUserId)
        )
        .unionAll(
          this.db
            .select({
              userId: connectBalances.userId,
              oldest: sql<string>`MIN(${connectBalances.collectedAt})`.as(
                'oldest'
              ),
            })
            .from(connectBalances)
            .where(isNotNull(connectBalances.collectedOwedCents))
            .groupBy(connectBalances.userId)
        )
        .as('people');
      const oldest = sql<string>`MIN(${people.oldest})`;
      const [rows, [totals]] = await Promise.all([
        this.db
          .select({ userId: people.userId, oldest })
          .from(people)
          .groupBy(people.userId)
          .orderBy(oldest, people.userId)
          .limit(limit)
          .offset(offset),
        this.db
          .select({
            total: sql<number>`COUNT(DISTINCT ${people.userId})::int`,
          })
          .from(people),
      ]);
      const userIds = rows.map((row) => row.userId);
      if (userIds.length === 0) {
        return pageOf([], totals?.total ?? 0, page, limit);
      }

      const [balances, accounts, roles, names] = await Promise.all([
        this.db
          .select()
          .from(connectBalances)
          .where(inArray(connectBalances.userId, userIds)),
        this.db
          .select({
            userId: stripeConnectAccounts.userId,
            stripeAccountId: stripeConnectAccounts.stripeAccountId,
          })
          .from(stripeConnectAccounts)
          .where(inArray(stripeConnectAccounts.userId, userIds)),
        this.db
          .selectDistinct({
            userId: payouts.userId,
            payoutType: payouts.payoutType,
          })
          .from(payouts)
          .where(
            and(
              inArray(payouts.userId, userIds),
              ne(payouts.payoutType, 'platform_fee')
            )
          ),
        this.peopleById(userIds),
      ]);
      const negativeOf = (userId: string) =>
        balances.filter(
          (row) => row.userId === userId && row.negativeSince !== null
        );
      // Each person's take-backs since the last morning they were at or
      // above zero (§4.2): one read for the page.
      const windows = new Map(
        userIds.flatMap((userId) => {
          const starts = negativeOf(userId).map(
            (row) => row.negativeAfter ?? row.negativeSince
          );
          const start = starts.reduce<Date | null>(
            (min, at) => (at && (!min || at < min) ? at : min),
            null
          );
          return start ? [[userId, start] as const] : [];
        })
      );
      const currentAccount = new Map(
        accounts.map((account) => [account.userId, account.stripeAccountId])
      );
      const snapshotOf = new Map(
        balances.map((row) => [row.stripeAccountId, row])
      );
      const [debts, held, live] = await Promise.all([
        this.openDebts(inArray(refundReviews.creatorUserId, userIds)),
        this.stripeHeldTakeBacks(windows),
        Promise.all(
          userIds.map((userId) => {
            const accountId = currentAccount.get(userId) ?? null;
            return this.liveBalanceOf(
              userId,
              negativeOf(userId),
              accountId ? (snapshotOf.get(accountId) ?? null) : null,
              accountId
            );
          })
        ),
      ]);

      const now = new Date();
      const items = rows.map((row, index): CreatorDebtPerson => {
        const negative = negativeOf(row.userId);
        const balance = live[index] ?? {
          availableCents: null,
          pendingCents: null,
          checkedAt: null,
          live: false,
          owedCents: 0,
        };
        const recordedDebts = debts.filter(
          (debt) => debt.payee.userId === row.userId
        );
        const stripeHeld = held.get(row.userId) ?? [];
        const recordedCents = recordedDebts.reduce(
          (sum, debt) => sum + debt.owedCents,
          0
        );
        // Collected by Stripe over £50, awaiting the P6 invoice (AMENDMENT 2).
        const collected = balances.filter(
          (account) =>
            account.userId === row.userId && account.collectedOwedCents !== null
        );
        const collectedCents =
          collected.length === 0
            ? null
            : collected.reduce(
                (sum, account) => sum + (account.collectedOwedCents ?? 0),
                0
              );
        const collectedAt = collected.reduce<Date | null>(
          (min, account) =>
            account.collectedAt && (!min || account.collectedAt < min)
              ? account.collectedAt
              : min,
          null
        );
        const owedNowCents = balance.owedCents + recordedCents;
        const totalOwedCents = owedNowCents + (collectedCents ?? 0);
        const negativeSince = negative.reduce<Date | null>(
          (min, at) =>
            at.negativeSince && (!min || at.negativeSince < min)
              ? at.negativeSince
              : min,
          null
        );
        const windowKnown =
          negative.length > 0 &&
          negative.every((account) => account.negativeAfter !== null);
        const person = names.get(row.userId);
        // The clock is the balance below zero now; a collected debt is
        // support's to invoice whatever that balance does.
        const standing = negativeSince
          ? debtStanding(owedNowCents, negativeSince, now)
          : { state: 'needs_settling' as const, clock: null };
        return {
          payee: {
            userId: row.userId,
            name: person?.name ?? '',
            deleted: person?.deleted ?? false,
            roles: unique(
              roles
                .filter((role) => role.userId === row.userId)
                .map((role) => payeeRoleOf(role.payoutType))
            ).sort(),
          },
          stripe: {
            availableCents: balance.availableCents,
            pendingCents: balance.pendingCents,
            checkedAt: balance.checkedAt,
            live: balance.live,
          },
          stripeOwedCents: balance.owedCents,
          negativeSince: toIso(negativeSince),
          backCents:
            windowKnown && balance.live
              ? Math.max(
                  0,
                  stripeHeld.reduce((sum, take) => sum + take.amountCents, 0) -
                    balance.owedCents
                )
              : null,
          stripeHeld,
          recordedDebts,
          collectedCents,
          collectedAt: toIso(collectedAt),
          totalOwedCents,
          state: collectedCents === null ? standing.state : 'to_invoice',
          clock: standing.clock,
          oldestAt: new Date(row.oldest).toISOString(),
        };
      });
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listCreatorDebts');
    }
  }

  /**
   * A person's balance for the Creator debts tab: read live on each account
   * below zero (else their current one), and on any failure the morning
   * snapshot, marked `live: false`. `owedCents` is what Stripe holds: each
   * account's balance below zero, never netted across accounts.
   */
  private async liveBalanceOf(
    userId: string,
    negative: readonly ConnectBalance[],
    current: ConnectBalance | null,
    currentAccountId: string | null
  ): Promise<{
    availableCents: number | null;
    pendingCents: number | null;
    checkedAt: string | null;
    live: boolean;
    owedCents: number;
  }> {
    const snapshots = negative.length > 0 ? negative : current ? [current] : [];
    const accountIds =
      negative.length > 0
        ? negative.map((row) => row.stripeAccountId)
        : currentAccountId
          ? [currentAccountId]
          : [];
    const fromSnapshot = () => {
      const read = snapshots.filter((row) => row.availableCents !== null);
      if (read.length === 0) {
        return {
          availableCents: null,
          pendingCents: null,
          checkedAt: null,
          live: false,
          owedCents: 0,
        };
      }
      return {
        availableCents: read.reduce(
          (sum, row) => sum + (row.availableCents ?? 0),
          0
        ),
        pendingCents: read.reduce(
          (sum, row) => sum + (row.pendingCents ?? 0),
          0
        ),
        checkedAt: toIso(
          read.reduce<Date | null>(
            (min, row) =>
              row.checkedAt && (!min || row.checkedAt < min)
                ? row.checkedAt
                : min,
            null
          )
        ),
        live: false,
        owedCents: read.reduce(
          (sum, row) => sum + Math.max(0, -(row.availableCents ?? 0)),
          0
        ),
      };
    };
    if (accountIds.length === 0) return fromSnapshot();
    let read: GbpBalance[];
    try {
      read = await Promise.all(
        accountIds.map((accountId) =>
          readGbpBalance(this.stripe, accountId, LIVE_BALANCE_REQUEST)
        )
      );
    } catch (error) {
      const e = error as StripeErrorFields | null;
      const facts = {
        userId,
        stripeAccountIds: accountIds,
        stripeRequestId: typeof e?.requestId === 'string' ? e.requestId : null,
        statusCode: typeof e?.statusCode === 'number' ? e.statusCode : null,
        stripeCode: typeof e?.code === 'string' ? e.code.slice(0, 64) : null,
        stripeErrorType:
          typeof e?.type === 'string' ? e.type.slice(0, 64) : null,
        stripeMessage: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 300),
      };
      // A refused key is a configuration fault, not an outage: every load
      // would show the snapshot for good. The key needs Balance: Read on
      // connected accounts (review MED-6).
      if (facts.statusCode === 401 || facts.statusCode === 403) {
        this.obs.error(
          "Stripe refused admin-api's key a creator debt's live balance: the key needs Balance: Read on connected accounts. The morning snapshot is shown",
          { errorId: crypto.randomUUID(), ...facts }
        );
      } else {
        this.obs.warn(
          "A creator debt's Stripe balance could not be read: the morning snapshot is shown",
          facts
        );
      }
      return fromSnapshot();
    }
    return {
      availableCents: read.reduce((sum, b) => sum + b.availableCents, 0),
      pendingCents: read.reduce((sum, b) => sum + b.pendingCents, 0),
      checkedAt: new Date().toISOString(),
      live: true,
      owedCents: read.reduce(
        (sum, b) => sum + Math.max(0, -b.availableCents),
        0
      ),
    };
  }

  /**
   * Open debts Stripe refused (`refund_reviews`), oldest first, each with its
   * slice's facts and history, and a credit whose late take-back paid it.
   */
  private async openDebts(where: SQL): Promise<CreatorDebtItem[]> {
    const rows = await this.db
      .select({
        review: {
          id: refundReviews.id,
          payoutId: refundReviews.payoutId,
          payoutReversalId: refundReviews.payoutReversalId,
          creatorUserId: refundReviews.creatorUserId,
          attemptedReversalCents: refundReviews.attemptedReversalCents,
          errorCode: refundReviews.errorCode,
          createdAt: refundReviews.createdAt,
        },
        causeType: payoutReversals.causeType,
        causeId: payoutReversals.causeId,
        repaidByPayoutId: payoutReversals.repaidByPayoutId,
        slice: {
          payoutType: payouts.payoutType,
          organizationId: payouts.organizationId,
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
      .where(and(isNull(refundReviews.resolvedAt), where))
      .orderBy(asc(refundReviews.createdAt), asc(refundReviews.id));
    if (rows.length === 0) return [];

    const stepIds = unique(rows.map(({ review }) => review.payoutReversalId));
    const [charges, histories, causes, orgs, credits] = await Promise.all([
      this.chargeFacts(
        rows.flatMap(({ slice }) =>
          slice.stripeChargeId
            ? [{ chargeId: slice.stripeChargeId, purchaseId: slice.purchaseId }]
            : []
        )
      ),
      this.historiesFor(rows.map(({ review }) => review.payoutId)),
      this.causeFacts(
        rows.flatMap(({ causeType, causeId }) =>
          causeType && causeId ? [{ causeType, causeId }] : []
        )
      ),
      this.organizationNames(rows.map(({ slice }) => slice.organizationId)),
      stepIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(payeeCredits)
            .where(
              and(
                inArray(payeeCredits.payoutReversalId, stepIds),
                isNull(payeeCredits.resolvedAt)
              )
            ),
    ]);
    const needsPerson = await payeeCreditsNeedingAPerson(this.db, credits);
    return rows.map((row): CreatorDebtItem => {
      const facts = row.slice.stripeChargeId
        ? charges.get(row.slice.stripeChargeId)
        : undefined;
      const cause =
        row.causeType && row.causeId
          ? causes.get(causeKey(row.causeType, row.causeId))
          : undefined;
      const found = credits.find(
        (c) => c.payoutReversalId === row.review.payoutReversalId
      );
      const credit = found && {
        ...found,
        needsPerson: needsPerson.has(found.id),
        siblingTook: needsPerson.get(found.id)?.siblingTook ?? false,
      };
      return {
        reviewId: row.review.id,
        payoutId: row.review.payoutId,
        payee: {
          userId: row.review.creatorUserId,
          name: row.payeeName,
          deleted: row.payeeDeletedAt !== null,
          role: payeeRoleOf(row.slice.payoutType),
        },
        owedCents: row.review.attemptedReversalCents,
        chargeId: row.slice.stripeChargeId,
        title: facts?.title ?? null,
        organizationName: row.slice.organizationId
          ? (orgs.get(row.slice.organizationId) ?? null)
          : null,
        buyerName: facts?.buyer?.name ?? null,
        cause:
          row.causeType && row.causeId
            ? queueCause(row.causeType, row.causeId, cause)
            : null,
        errorCode: row.review.errorCode,
        errorLabel: debtErrorLabel(row.review.errorCode, row.payeeName),
        createdAt: row.review.createdAt.toISOString(),
        owedCreditId:
          credit &&
          creditAction(
            credit,
            { repaidByPayoutId: row.repaidByPayoutId },
            {
              attemptedReversalCents: row.review.attemptedReversalCents,
              resolvedAt: null,
              resolution: null,
            }
          ) === 'count_against_debt'
            ? credit.id
            : null,
        history: histories.get(row.review.payoutId)?.history ?? [],
      };
    });
  }

  /**
   * The take-backs that came out of each person's Stripe balance since
   * `windows`' start (§4.2): `done` steps with a Stripe reversal on their
   * payouts, not since paid back. A cancelled share's late full reversal
   * reads its share, so "back so far" is approximate there.
   */
  private async stripeHeldTakeBacks(
    windows: ReadonlyMap<string, Date>
  ): Promise<Map<string, StripeHeldTakeBack[]>> {
    const held = new Map<string, StripeHeldTakeBack[]>();
    if (windows.size === 0) return held;
    const from = [...windows.values()].reduce((min, at) =>
      at < min ? at : min
    );
    const rows = await this.db
      .select({
        step: payoutReversals,
        slice: {
          userId: payouts.userId,
          organizationId: payouts.organizationId,
          stripeChargeId: payouts.stripeChargeId,
          purchaseId: payouts.purchaseId,
        },
      })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
      .where(
        and(
          inArray(payouts.userId, [...windows.keys()]),
          eq(payoutReversals.status, 'done'),
          isNotNull(payoutReversals.stripeReversalId),
          isNull(payoutReversals.repaidByPayoutId),
          sql`${payoutReversals.resolvedAt} >= ${from}`
        )
      )
      .orderBy(asc(payoutReversals.resolvedAt), asc(payoutReversals.id));
    const inWindow = rows.filter(({ step, slice }) => {
      const start = slice.userId ? windows.get(slice.userId) : undefined;
      return (
        start !== undefined &&
        step.resolvedAt !== null &&
        step.resolvedAt >= start
      );
    });
    if (inWindow.length === 0) return held;
    const [charges, histories, causes, orgs] = await Promise.all([
      this.chargeFacts(
        inWindow.flatMap(({ slice }) =>
          slice.stripeChargeId
            ? [{ chargeId: slice.stripeChargeId, purchaseId: slice.purchaseId }]
            : []
        )
      ),
      this.historiesFor(inWindow.map(({ step }) => step.payoutId)),
      this.causeFacts(inWindow.map(({ step }) => step)),
      this.organizationNames(inWindow.map(({ slice }) => slice.organizationId)),
    ]);
    for (const { step, slice } of inWindow) {
      if (!slice.userId) continue;
      const facts = slice.stripeChargeId
        ? charges.get(slice.stripeChargeId)
        : undefined;
      const cause = causes.get(causeKey(step.causeType, step.causeId));
      const line: StripeHeldTakeBack = {
        payoutReversalId: step.id,
        payoutId: step.payoutId,
        amountCents: step.amountCents,
        takenAt: (step.resolvedAt ?? step.updatedAt).toISOString(),
        stripeReversalId: step.stripeReversalId,
        chargeId: slice.stripeChargeId,
        title: facts?.title ?? null,
        organizationName: slice.organizationId
          ? (orgs.get(slice.organizationId) ?? null)
          : null,
        buyerName: facts?.buyer?.name ?? null,
        cause: queueCause(step.causeType, step.causeId, cause),
        history: histories.get(step.payoutId)?.history ?? [],
      };
      held.set(slice.userId, [...(held.get(slice.userId) ?? []), line]);
    }
    return held;
  }

  /**
   * Owed to creators (Codex-2hxff.73; owner decisions Q8-Q11): open payee
   * credits, oldest first (`idx_payee_credits_open`). Each row carries its
   * one action, by the rules the resolve route enforces (`creditAction`).
   */
  async listOwedToCreators(
    query: SupportQueueQuery
  ): Promise<PaginatedListResponse<OwedToCreatorItem>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const open = isNull(payeeCredits.resolvedAt);
      // A step on a re-pay payout: its charge is its slice's.
      const repaidFrom = alias(payoutReversals, 'repaid_from');
      const origin = alias(payouts, 'origin');
      const [rows, [totals]] = await Promise.all([
        this.db
          .select({
            credit: payeeCredits,
            step: {
              amountCents: payoutReversals.amountCents,
              causeType: payoutReversals.causeType,
              causeId: payoutReversals.causeId,
              repaidByPayoutId: payoutReversals.repaidByPayoutId,
            },
            slice: {
              id: payouts.id,
              amountCents: payouts.amountCents,
              payoutType: payouts.payoutType,
              organizationId: payouts.organizationId,
              purchaseId: payouts.purchaseId,
              stripeChargeId: sql<
                string | null
              >`COALESCE(${payouts.stripeChargeId}, ${origin.stripeChargeId})`,
            },
            review: {
              id: refundReviews.id,
              attemptedReversalCents: refundReviews.attemptedReversalCents,
              resolution: refundReviews.resolution,
              resolvedAt: refundReviews.resolvedAt,
            },
            payeeName: users.name,
            payeeDeletedAt: users.deletedAt,
          })
          .from(payeeCredits)
          .innerJoin(
            payoutReversals,
            eq(payoutReversals.id, payeeCredits.payoutReversalId)
          )
          .innerJoin(payouts, eq(payouts.id, payeeCredits.payoutId))
          .leftJoin(repaidFrom, eq(repaidFrom.repaidByPayoutId, payouts.id))
          .leftJoin(origin, eq(origin.id, repaidFrom.payoutId))
          .leftJoin(users, eq(users.id, payeeCredits.payeeUserId))
          .leftJoin(
            refundReviews,
            eq(refundReviews.payoutReversalId, payeeCredits.payoutReversalId)
          )
          .where(open)
          .orderBy(asc(payeeCredits.foundAt), asc(payeeCredits.id))
          .limit(limit)
          .offset(offset),
        this.db.select({ total: count() }).from(payeeCredits).where(open),
      ]);

      const [charges, causes, orgs] = await Promise.all([
        this.chargeFacts(
          rows.flatMap(({ slice }) =>
            slice.stripeChargeId
              ? [
                  {
                    chargeId: slice.stripeChargeId,
                    purchaseId: slice.purchaseId,
                  },
                ]
              : []
          )
        ),
        this.causeFacts(rows.map(({ step }) => step)),
        this.organizationNames(rows.map(({ slice }) => slice.organizationId)),
      ]);
      // Needs-person rows (MED-3): Re-pay pays the cancelled share, as
      // `resolvePayeeCredit` works it out.
      const needsPerson = await payeeCreditsNeedingAPerson(
        this.db,
        rows.map(({ credit }) => credit)
      );
      const reductions = await pendingReductionsFor(
        this.db,
        rows
          .filter(({ credit }) => needsPerson.has(credit.id))
          .map(({ slice }) => slice.id)
      );
      const items = rows.map((row): OwedToCreatorItem => {
        const credit = {
          ...row.credit,
          needsPerson: needsPerson.has(row.credit.id),
          siblingTook: needsPerson.get(row.credit.id)?.siblingTook ?? false,
        };
        const state = creditState(credit);
        const facts = row.slice.stripeChargeId
          ? charges.get(row.slice.stripeChargeId)
          : undefined;
        return {
          creditId: credit.id,
          payoutId: credit.payoutId,
          payee:
            credit.payeeUserId && row.payeeName !== null
              ? {
                  userId: credit.payeeUserId,
                  name: row.payeeName,
                  deleted: row.payeeDeletedAt !== null,
                  role: payeeRoleOf(row.slice.payoutType),
                }
              : null,
          // Open: a `transfer_kept` row is born settled, so never here.
          state: state as OwedToCreatorItem['state'],
          effect: credit.effect as OwedToCreatorItem['effect'],
          amountCents: credit.amountCents,
          repayCents:
            state === 'needs_person'
              ? row.slice.amountCents - (reductions.get(row.slice.id) ?? 0)
              : credit.effect === 'unverified'
                ? null
                : credit.amountCents,
          stepAmountCents: row.step.amountCents,
          settledAs: credit.settledAs as OwedToCreatorItem['settledAs'],
          stripeReversalId: credit.stripeReversalId,
          chargeId: row.slice.stripeChargeId,
          title: facts?.title ?? null,
          organizationName: row.slice.organizationId
            ? (orgs.get(row.slice.organizationId) ?? null)
            : null,
          buyerName: facts?.buyer?.name ?? null,
          cause: queueCause(
            row.step.causeType,
            row.step.causeId,
            causes.get(causeKey(row.step.causeType, row.step.causeId))
          ),
          debt: row.review
            ? {
                reviewId: row.review.id,
                owedCents: row.review.attemptedReversalCents,
                resolution: row.review.resolution,
              }
            : null,
          // Never null for an open credit.
          action:
            creditAction(
              credit,
              { repaidByPayoutId: row.step.repaidByPayoutId },
              row.review
            ) ?? 'check',
          foundAt: credit.foundAt.toISOString(),
          checkedAt: toIso(credit.checkedAt),
        };
      });
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listOwedToCreators');
    }
  }

  /**
   * Settle an Owed to creators row (data design §7.4): Re-pay, Count it
   * against this debt, or Not owed, in one transaction with the credit
   * locked (`resolvePayeeCredit`). Its refusals pass through as they are.
   */
  async resolveOwedToCreator(
    creditId: string,
    input: SupportResolveCreditInput,
    resolvedByUserId: string
  ): Promise<ResolvedOwedToCreator> {
    try {
      const { credit, repayPayout } = await resolvePayeeCredit(
        { db: this.db, obs: this.obs },
        { creditId, action: input.action, note: input.note, resolvedByUserId }
      );
      const people = await this.peopleById([credit.payeeUserId]);
      return {
        creditId: credit.id,
        resolution: credit.resolution as ResolvedOwedToCreator['resolution'],
        resolvedAt: (credit.resolvedAt ?? new Date()).toISOString(),
        repayPayoutId: repayPayout?.id ?? null,
        amountCents: credit.amountCents,
        payeeName: credit.payeeUserId
          ? (people.get(credit.payeeUserId)?.name ?? null)
          : null,
      };
    } catch (error) {
      this.handleError(error, 'resolveOwedToCreator');
    }
  }

  /** "Check Stripe again" on an Owed to creators row (`recheckPayeeCredit`). */
  async checkOwedToCreator(creditId: string): Promise<CheckedOwedToCreator> {
    try {
      const { credit, outcome } = await recheckPayeeCredit(
        {
          db: this.db,
          stripe: this.stripe,
          obs: this.obs,
          environment: this.environment,
        },
        { creditId }
      );
      const [[step], [review]] = await Promise.all([
        this.db
          .select({ repaidByPayoutId: payoutReversals.repaidByPayoutId })
          .from(payoutReversals)
          .where(eq(payoutReversals.id, credit.payoutReversalId))
          .limit(1),
        this.db
          .select({
            attemptedReversalCents: refundReviews.attemptedReversalCents,
            resolvedAt: refundReviews.resolvedAt,
            resolution: refundReviews.resolution,
          })
          .from(refundReviews)
          .where(eq(refundReviews.payoutReversalId, credit.payoutReversalId))
          .limit(1),
      ]);
      const person = (await payeeCreditsNeedingAPerson(this.db, [credit])).get(
        credit.id
      );
      const view = {
        ...credit,
        needsPerson: outcome === 'needs_person' || person !== undefined,
        siblingTook: person?.siblingTook ?? false,
      };
      return {
        creditId: credit.id,
        outcome,
        state: creditState(view),
        amountCents: credit.amountCents,
        stripeReversalId: credit.stripeReversalId,
        note: credit.resolution === 'not_owed' ? credit.resolutionNote : null,
        checkedAt: (credit.checkedAt ?? new Date()).toISOString(),
        action: creditAction(
          view,
          { repaidByPayoutId: step?.repaidByPayoutId ?? null },
          review ?? null
        ),
      };
    } catch (error) {
      this.handleError(error, 'checkOwedToCreator');
    }
  }

  // ==========================================================================
  // Settling (routes 8, 9; data design §8)
  // ==========================================================================

  /**
   * Settle a failed refund. `refunded_elsewhere` resolves the row; for a
   * late win's own refund it also marks the charge refunded outside Stripe
   * (`lateWinRefundedOutsideStripe`).
   * `creators_repaid` is one transaction with the refund row locked: what its
   * clawback took is paid back (`repayFailedRefund`), a failed FULL purchase
   * refund gives the buyer access back, then the row is resolved. A late
   * win's own refund is never `creators_repaid` (`refuseLateWinRefund`). A
   * repeat of the same resolution returns the row as it stands; another is a
   * 409.
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
    const found = await this.failedRefundRow(this.db, refundId);
    // Asks Stripe, so before the transaction. A repeat asks nothing.
    const outsideStripe = found.resolvedAt
      ? null
      : await this.lateWinRefundedOutsideStripe(found);
    const outcome = await this.db.transaction(async (tx) => {
      const { row, settled } = await this.lockForSettling(
        tx,
        refundId,
        'refunded_elsewhere'
      );
      if (settled) return { row: settled, marked: false };
      const now = new Date();
      const [resolved] = await tx
        .update(refunds)
        .set({
          resolution: 'refunded_elsewhere',
          resolvedAt: now,
          resolvedByUserId,
          resolutionNote: note,
        })
        .where(and(eq(refunds.id, refundId), isNull(refunds.resolvedAt)))
        .returning();
      // The row is locked and was checked above (silent F7, as below).
      if (!resolved) {
        throw new InternalServiceError(
          'The failed refund could not be marked settled'
        );
      }
      const marked = outsideStripe
        ? await this.markRefundedOutsideStripe(
            tx,
            outsideStripe,
            row.stripeChargeId,
            now
          )
        : false;
      return { row: resolved, marked };
    });
    if (outcome.marked) {
      this.obs.info(
        "A late win's refund was settled as refunded elsewhere, so its charge is refunded outside Stripe",
        {
          refundId,
          disputeId: outsideStripe,
          chargeId: found.stripeChargeId,
        }
      );
    }
    return {
      settled: {
        refundId,
        resolution: 'refunded_elsewhere',
        resolvedAt: (outcome.row.resolvedAt ?? new Date()).toISOString(),
        repaid: [],
        accessRestored: false,
        accessNotRestoredReason: null,
        systemSettled: [],
      },
      restoredAccess: null,
    };
  }

  /**
   * The late win to mark refunded outside Stripe as support settles this
   * failed refund as refunded elsewhere, or null (owner decision 5's rule,
   * applied in review cycle 2, finding 2). It is the late win's own refund,
   * by our record or by Stripe's metadata (`lateWinDisputeMarked`), and the
   * charge's SUCCEEDED refunds at Stripe don't cover the charge. Then the
   * buyer was refunded another way, and without the mark the charge would
   * stay refundable through Stripe for good: Stripe doesn't count the failed
   * refund, and the late win lifts the 14-day window (Q7). Succeeded refunds
   * that cover it mean support refunded it again through Stripe: nothing is
   * left to refund, so nothing is marked. A re-refund still pending (or
   * requires_action) doesn't count here, unlike for `maxCents`: if it then
   * failed, it would be a new failed refund with no late-win metadata, and
   * nothing would ever mark the charge. Marked while it is pending, the
   * charge is blocked either way (review cycle 3, scoping LOW).
   */
  private async lateWinRefundedOutsideStripe(refund: {
    stripeRefundId: string;
    stripeChargeId: string;
  }): Promise<string | null> {
    const recorded = await this.lateWinDisputeRecorded(
      this.db,
      refund.stripeRefundId
    );
    // Stripe is asked only on a late win's charge (`chargeHasLateWin`), so
    // any other charge's settle never waits on it.
    if (!recorded && !(await this.chargeHasLateWin(refund.stripeChargeId))) {
      return null;
    }
    const listed = await listChargeRefunds(this.stripe, refund.stripeChargeId);
    const disputeId =
      recorded ?? lateWinDisputeMarked(listed, refund.stripeRefundId);
    if (!disputeId) return null;
    const charge = await this.retrieveCharge(refund.stripeChargeId, false);
    return refundedCentsIn(listed, ['succeeded']) >= charge.amount
      ? null
      : disputeId;
  }

  /**
   * Set the late win's `refunded_outside_stripe_at`, in the settlement's
   * transaction; a date already set is kept. The dispute must be on the
   * refund's charge. Anything else is a broken record, so the settlement
   * rolls back rather than leave the charge refundable through Stripe.
   */
  private async markRefundedOutsideStripe(
    tx: Tx,
    stripeDisputeId: string,
    chargeId: string,
    now: Date
  ): Promise<boolean> {
    const [marked] = await tx
      .update(disputes)
      .set({ refundedOutsideStripeAt: now })
      .where(
        and(
          eq(disputes.stripeDisputeId, stripeDisputeId),
          eq(disputes.stripeChargeId, chargeId),
          isNull(disputes.refundedOutsideStripeAt)
        )
      )
      // `.returning({ id })` doesn't type-check on this client's union.
      .returning();
    if (marked) return true;
    const [held] = await tx
      .select({ id: disputes.id })
      .from(disputes)
      .where(
        and(
          eq(disputes.stripeDisputeId, stripeDisputeId),
          eq(disputes.stripeChargeId, chargeId)
        )
      )
      .limit(1);
    if (!held) {
      throw new InternalServiceError(
        "The late win's dispute is not on its refund's charge",
        { stripeDisputeId, chargeId }
      );
    }
    return false;
  }

  private async settleCreatorsRepaid(
    refundId: string,
    note: string,
    resolvedByUserId: string
  ): Promise<FailedRefundSettlement> {
    const found = await this.failedRefundRow(this.db, refundId);
    // A repeat returns what the first settlement did: no guard, no Stripe.
    let purchaseId = found.purchaseId;
    let prepared: PreparedRepay | undefined;
    if (!found.resolvedAt) {
      // Before the re-pay reads Stripe: its pre-step writes the steps that
      // landed, and a late win's refund is refused without them. Our record
      // first, then the refund's own metadata at Stripe: the late win writes
      // our record only after Stripe made the refund, so it can be missing.
      await this.refuseLateWinRefund(this.db, found.stripeRefundId);
      await this.refuseIfMarkedLateWin(found);
      prepared = await this.prepareRepay(
        found.stripeRefundId,
        found.stripeChargeId
      );
      const { purchaseOf } = await this.purchasesOfRefunds(
        [{ chargeId: found.stripeChargeId, purchaseId }],
        'decide'
      );
      purchaseId = purchaseOf.get(found.stripeChargeId) ?? null;
    }

    const outcome = await this.db.transaction(async (tx) => {
      const { row, settled } = await this.lockForSettling(
        tx,
        refundId,
        'creators_repaid'
      );
      if (settled) {
        return {
          row: settled,
          repaid: null,
          payeeKept: [],
          access: undefined,
        };
      }
      // Unresolved here means it was unresolved before: a settlement is
      // never undone.
      if (!prepared) {
        throw new InternalServiceError(
          'The failed refund was not prepared for its settlement'
        );
      }
      // Our record again, before anything is written, in case the late win
      // recorded its refund's id since the check above. This only narrows
      // that window: the late win takes no lock on this row. The refund's
      // metadata, read above, is what a late win's refund always carries.
      await this.refuseLateWinRefund(tx, row.stripeRefundId);
      const now = new Date();
      // Re-checks the whole later-cause guard under the lock, and cancels the
      // pre-step's unlanded steps here, so a refusal leaves them as they were
      // (round 2 LOW-B, LOW-D).
      const { repaid, payeeKept } = await repayFailedRefund(tx, {
        stripeRefundId: row.stripeRefundId,
        resolvedByUserId,
        note,
        now,
        chargeAmountCents: prepared.chargeAmountCents,
        unlanded: prepared.unlanded,
        obs: this.obs,
      });
      const access = purchaseId
        ? await this.purchase.restoreAfterFailedRefund(
            tx,
            purchaseId,
            row.stripeChargeId
          )
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
      // The row is locked and was checked above: matching nothing is
      // impossible, and committing the re-pay without the resolution would
      // leave the refund open (silent F7). Throwing rolls it all back.
      if (!resolved) {
        throw new InternalServiceError(
          'The failed refund could not be marked settled'
        );
      }
      return { row: resolved, repaid, payeeKept, access };
    });
    // Only now that the cancellations committed (review LOW-8): a refused
    // settlement changed nothing, so it raises nothing.
    reportPayeeKept(
      this.obs,
      { stripeRefundId: outcome.row.stripeRefundId },
      outcome.payeeKept
    );

    // A repeat reports the re-pay rows the first settlement wrote.
    const repaid =
      outcome.repaid ??
      (await this.repaidFor(outcome.row.stripeRefundId)).map((row) => ({
        payoutId: row.id,
        payeeUserId: row.userId,
        amountCents: row.amountCents,
      }));
    // What the system settled with this settlement, and how (F2's notice):
    // paid back (`took_share`) or kept by the payee. A repeat ran no
    // pre-step, so it names none.
    const tookShare =
      outcome.repaid === null || !prepared
        ? []
        : await this.payeesOfSlices(prepared.tookShare);
    const systemSettled: Array<{
      id: string;
      userId: string | null;
      decision: SystemDecision;
    }> = [
      ...tookShare.map((slice) => ({
        ...slice,
        decision: 'took_share' as const,
      })),
      ...outcome.payeeKept.map((step) => ({
        id: step.payoutId,
        userId: step.payeeUserId,
        decision: 'payee_kept' as const,
      })),
    ].sort((a, b) => a.id.localeCompare(b.id));
    const people = await this.peopleById([
      ...repaid.map((row) => row.payeeUserId),
      ...systemSettled.map((slice) => slice.userId),
    ]);
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
        // A repeat did not run the restore, so it says nothing.
        accessNotRestoredReason:
          outcome.repaid === null
            ? null
            : (outcome.access?.reason ?? (purchaseId ? null : 'no_purchase')),
        systemSettled: systemSettled.map((slice) => ({
          payoutId: slice.id,
          payeeName: slice.userId
            ? (people.get(slice.userId)?.name ?? null)
            : null,
          decision: slice.decision,
        })),
      },
      restoredAccess: restored && outcome.access ? outcome.access : null,
    };
  }

  /**
   * A late win's own refund of the payment (`disputes.late_win_refund_id`) is
   * never settled `creators_repaid` (`LATE_WIN_REFUND_NOT_REPAYABLE`, 422;
   * owner decision 6, 2026-11-08, "Block it in code"): it pays back a buyer
   * who paid twice, so its clawback stands. `refunded_elsewhere` is still
   * allowed for it. This is the check by our record; `lateWinDisputeMarked`
   * is the one by Stripe's.
   */
  private async refuseLateWinRefund(
    db: DatabaseClient | Tx,
    stripeRefundId: string
  ): Promise<void> {
    this.refuseIfLateWin(
      stripeRefundId,
      await this.lateWinDisputeRecorded(db, stripeRefundId)
    );
  }

  /** Refuse the re-pay when the refund is the named late win's own. */
  private refuseIfLateWin(
    stripeRefundId: string,
    stripeDisputeId: string | null
  ): void {
    if (!stripeDisputeId) return;
    this.obs.info('A creators_repaid settlement was refused', {
      stripeRefundId,
      disputeId: stripeDisputeId,
      reason: 'late_win_refund',
    });
    throw new LateWinRefundNotRepayableError(stripeDisputeId);
  }

  /**
   * Refuse the re-pay by the refund's own metadata at Stripe. Asked only on
   * a late win's charge (`chargeHasLateWin`).
   */
  private async refuseIfMarkedLateWin(refund: {
    stripeRefundId: string;
    stripeChargeId: string;
  }): Promise<void> {
    if (!(await this.chargeHasLateWin(refund.stripeChargeId))) return;
    this.refuseIfLateWin(
      refund.stripeRefundId,
      lateWinDisputeMarked(
        await listChargeRefunds(this.stripe, refund.stripeChargeId),
        refund.stripeRefundId
      )
    );
  }

  /**
   * Does the charge have a late win (`late_won_at`)? Only then can one of
   * its refunds be a late win's own: the late win records `late_won_at` on
   * the dispute (`recordLateWin`) before its undo makes the refund, so the
   * gate never hides a refund whose `late_win_refund_id` write was lost
   * (review cycle 2, finding 1). It is what keeps Stripe out of every other
   * charge's settle.
   */
  private async chargeHasLateWin(chargeId: string): Promise<boolean> {
    const [lateWin] = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .where(
        and(
          eq(disputes.stripeChargeId, chargeId),
          isNotNull(disputes.lateWonAt)
        )
      )
      .limit(1);
    return lateWin !== undefined;
  }

  /** The late win whose own refund this is, by our record, or null. */
  private async lateWinDisputeRecorded(
    db: DatabaseClient | Tx,
    stripeRefundId: string
  ): Promise<string | null> {
    const [lateWin] = await db
      .select({ stripeDisputeId: disputes.stripeDisputeId })
      .from(disputes)
      .where(eq(disputes.lateWinRefundId, stripeRefundId))
      .limit(1);
    return lateWin?.stripeDisputeId ?? null;
  }

  /**
   * Before a `creators_repaid` settlement's transaction (owner decision
   * 2026-10-25; money HIGH-1, silent F3): refuse it when a later cause was
   * shared against this refund (`REPAY_BLOCKED_BY_LATER_CAUSE`, 422), then
   * look up at Stripe the steps no retry will ever run: one whose reversal
   * landed is recorded done, the rest come back as `unlanded`. Both read
   * Stripe, so neither can run inside the transaction. `repayFailedRefund`
   * re-checks the whole guard under the lock and cancels the unlanded steps
   * there; a step only a person can read is `REFUND_CLAWBACK_NEEDS_PERSON`
   * (422, no retry), passed through as it is.
   */
  private async prepareRepay(
    stripeRefundId: string,
    chargeId: string
  ): Promise<PreparedRepay> {
    const charge = await this.retrieveCharge(chargeId, false);
    const causes = await loadClawbackCauses(this.db, {
      chargeId,
      refunds: () => listClawableRefunds(this.stripe, chargeId),
    });
    const block = failedRefundRepayBlock({
      chargeAmountCents: charge.amount,
      refunds: causes.refunds,
      chargebacks: causes.chargebacks,
      stripeRefundId,
    });
    if (block) {
      this.obs.info('A creators_repaid settlement was refused', {
        stripeRefundId,
        chargeId,
        reason: block,
      });
      throw repayBlockedError(block);
    }
    const unfinished = await settleUnfinishedRefundSteps(
      {
        db: this.db,
        stripe: this.stripe,
        obs: this.obs,
        environment: this.environment,
      },
      { stripeRefundId }
    );
    return {
      chargeAmountCents: charge.amount,
      unlanded: unfinished.unlanded,
      tookShare: unfinished.decided,
    };
  }

  /** The slices named, with their payees, in id order. */
  private async payeesOfSlices(
    payoutIds: readonly string[]
  ): Promise<Array<{ id: string; userId: string | null }>> {
    if (payoutIds.length === 0) return [];
    return this.db
      .select({ id: payouts.id, userId: payouts.userId })
      .from(payouts)
      .where(inArray(payouts.id, [...payoutIds]))
      .orderBy(asc(payouts.id));
  }

  /**
   * The purchase each failed refund is for, by charge: the one it names, else
   * its charge's, by `sourcesOfCharges`' routes (a refund recorded before its
   * purchase names none, Codex-aa08z; silent F4). Null for an invoice's
   * charge, or one we hold no purchase for, Stripe's missing charge included.
   * The settle's restore and the queue's prediction of it both read this, so
   * the prediction never says "no purchase" where the settle restores (review
   * round 3 LOW-H). Stripe is read only for a charge none of our records
   * name, which is rare.
   *
   * To `decide` (the settle), any other Stripe failure propagates. To
   * `predict` (the queue), it is logged and the charge is listed `unread`,
   * so one charge Stripe can't serve never fails the page, and its
   * prediction is `unknown`, never a guess.
   */
  private async purchasesOfRefunds(
    refs: ReadonlyArray<{ chargeId: string; purchaseId: string | null }>,
    mode: 'decide' | 'predict'
  ): Promise<{
    purchaseOf: Map<string, string | null>;
    unread: ReadonlySet<string>;
  }> {
    const unread = new Set<string>();
    const sources = await this.sourcesOfCharges(
      refs.filter((ref) => !ref.purchaseId).map((ref) => ref.chargeId),
      (chargeId) =>
        this.retrieveCharge(chargeId, false).catch((error: unknown) => {
          if (error instanceof NotFoundError) return null;
          if (mode === 'decide') throw error;
          const e = error as StripeErrorFields | null;
          this.obs.warn(
            "A failed refund's charge could not be read: its access prediction is unknown",
            {
              chargeId,
              stripeRequestId:
                typeof e?.requestId === 'string' ? e.requestId : null,
              statusCode:
                typeof e?.statusCode === 'number' ? e.statusCode : null,
            }
          );
          unread.add(chargeId);
          return null;
        })
    );
    const purchaseOf = new Map<string, string | null>();
    for (const ref of refs) {
      const source = sources.get(ref.chargeId);
      purchaseOf.set(
        ref.chargeId,
        purchaseOf.get(ref.chargeId) ??
          ref.purchaseId ??
          (source?.type === 'purchase' ? source.purchaseId : null)
      );
    }
    return { purchaseOf, unread };
  }

  /**
   * The guarded settle found nothing to change: no failed refund (404), one
   * settled another way (409), or the same settlement repeated (its row).
   */
  /**
   * The failed refund locked in the settlement's transaction, with what
   * settled it when it is settled already (`alreadySettledRefund`: the
   * same resolution returns the row, another is a 409).
   */
  private async lockForSettling(
    tx: Tx,
    refundId: string,
    resolution: string
  ): Promise<{
    row: typeof refunds.$inferSelect;
    settled: typeof refunds.$inferSelect | null;
  }> {
    const row = await this.failedRefundRow(tx, refundId, { lock: true });
    return {
      row,
      settled: row.resolvedAt
        ? await this.alreadySettledRefund(tx, refundId, resolution)
        : null,
    };
  }

  /**
   * The failed refund a settlement acts on, read (`lock`: FOR UPDATE, in
   * the settlement's transaction), or a 404 for any other refund.
   */
  private async failedRefundRow(
    db: DatabaseClient | Tx,
    refundId: string,
    { lock = false }: { lock?: boolean } = {}
  ): Promise<typeof refunds.$inferSelect> {
    const query = db.select().from(refunds).where(eq(refunds.id, refundId));
    const [row] = lock ? await query.for('update') : await query.limit(1);
    if (!row || row.status !== 'failed') {
      throw new NotFoundError('No failed refund with this id', { refundId });
    }
    return row;
  }

  private async alreadySettledRefund(
    db: DatabaseClient | Tx,
    refundId: string,
    resolution: string
  ): Promise<typeof refunds.$inferSelect> {
    const row = await this.failedRefundRow(db, refundId);
    if (row.resolution !== resolution) {
      throw new AlreadySettledError(row.resolution ?? 'unknown');
    }
    return row;
  }

  /**
   * The re-pay payouts a refund's steps were paid back by. Not a credit's
   * (Owed to creators): support re-paid a late take-back there, which is not
   * this settlement's (data design §7.5).
   */
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
          eq(payoutReversals.causeId, stripeRefundId),
          sql`NOT EXISTS (SELECT 1 FROM ${payeeCredits} WHERE ${payeeCredits.repayPayoutId} = ${payouts.id})`
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
  // Fee notices (Codex-2hxff.33; batch C1 Part B data design §1.6)
  // ==========================================================================

  /**
   * Fee rises that haven't started, oldest first: waiting for their emails,
   * or dated. A card stays until its date, so the date is always visible
   * somewhere. The tallies are one grouped read over the page's changes.
   */
  async listFeeChanges(
    query: SupportQueueQuery,
    now: Date = new Date()
  ): Promise<PaginatedListResponse<FeeChangeCard>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const open = notStartedRise(now);
      const [rows, [totals]] = await Promise.all([
        this.db
          .select()
          .from(feeChanges)
          .where(open)
          .orderBy(asc(feeChanges.createdAt), asc(feeChanges.id))
          .limit(limit)
          .offset(offset),
        this.db.select({ total: count() }).from(feeChanges).where(open),
      ]);
      if (rows.length === 0) return pageOf([], totals?.total ?? 0, page, limit);

      const ids = rows.map((change) => change.id);
      const platformNow = versionInForce(
        await readFeeVersions(this.db, { scope: 'platform' }),
        now
      );
      const [tallies, byDay, marks, lines, people, orgs] = await Promise.all([
        this.feeNoticeTallies(ids),
        this.feeToldByDay(ids),
        this.toldAnotherWayOf(ids),
        this.feeChangeLinesOf(rows, platformNow, now),
        this.peopleById(rows.flatMap((c) => [c.creatorId, c.createdBy])),
        this.organizationsOf(rows.map((c) => c.organizationId)),
      ]);

      const items = rows.map((change, index): FeeChangeCard => {
        const tally = tallies.get(change.id);
        const waitingFor = tally?.waiting ?? 0;
        const listed = change.firstRunAt !== null;
        return {
          changeId: change.id,
          scope: change.scope,
          organization: change.organizationId
            ? (orgs.get(change.organizationId) ?? null)
            : null,
          creator: change.creatorId
            ? (people.get(change.creatorId) ?? null)
            : null,
          lines: lines[index]?.lines ?? [],
          removed: lines[index]?.removed ?? false,
          replacesChangeId: change.replacesChangeId,
          savedAt: change.createdAt.toISOString(),
          savedBy: change.createdBy
            ? (people.get(change.createdBy) ?? null)
            : null,
          firstRunAt: toIso(change.firstRunAt),
          firstEmailsAt: listed
            ? null
            : nextFeeNoticeRunAfter(now).toISOString(),
          listed: change.listedCount,
          told: {
            byEmail: tally?.byEmail ?? 0,
            anotherWay: tally?.anotherWay ?? 0,
          },
          toldByDay: byDay.get(change.id) ?? [],
          waitingFor,
          joiners: {
            total: tally?.joiners ?? 0,
            told: tally?.joinersTold ?? 0,
            waiting: tally?.joinersWaiting ?? 0,
          },
          toldAnotherWay: marks.get(change.id) ?? [],
          lastToldAt:
            listed && waitingFor === 0
              ? toIso(tally?.lastToldAt ?? null)
              : null,
          effectiveFrom: toIso(change.effectiveFrom),
          earliestFrom: (
            change.effectiveFrom ?? feeRiseStartAfter(now)
          ).toISOString(),
        };
      });
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listFeeChanges');
    }
  }

  /**
   * The people a fee rise that hasn't started is waiting for: their
   * announcement failed, or may not have gone, oldest first. Joiners are
   * listed too, flagged (Q4: they don't hold the date, but they still need
   * telling).
   */
  async listFeeNotices(
    query: SupportQueueQuery,
    now: Date = new Date()
  ): Promise<PaginatedListResponse<FeeNoticeItem>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const where = notToldYet(now);
      const [rows, [totals]] = await Promise.all([
        this.db
          .select({
            notice: feeChangeNotices,
            changeSavedAt: feeChanges.createdAt,
            changeEffectiveFrom: feeChanges.effectiveFrom,
            changeFirstRunAt: feeChanges.firstRunAt,
            name: users.name,
            email: users.email,
            deletedAt: users.deletedAt,
          })
          .from(feeChangeNotices)
          .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
          .innerJoin(users, eq(users.id, feeChangeNotices.userId))
          .where(where)
          .orderBy(asc(feeChangeNotices.createdAt), asc(feeChangeNotices.id))
          .limit(limit)
          .offset(offset),
        this.db
          .select({ total: count() })
          .from(feeChangeNotices)
          .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
          .where(where),
      ]);
      const [names, joined] = await Promise.all([
        this.organizationNames(
          rows.flatMap(({ notice }) =>
            notice.roles.map((r) => r.organizationId)
          )
        ),
        this.joinedSinceAnnounced(rows),
      ]);
      const nextTryAt = nextFeeNoticeRunAfter(now).toISOString();
      const items = rows.map(
        ({
          notice,
          changeSavedAt,
          changeEffectiveFrom,
          name,
          email,
          deletedAt,
        }): FeeNoticeItem => ({
          noticeId: notice.id,
          changeId: notice.changeId,
          person: {
            userId: notice.userId,
            name,
            email,
            deleted: deletedAt !== null,
          },
          roles: notice.roles.map((role) => ({
            organizationId: role.organizationId,
            organizationName: role.organizationId
              ? (names.get(role.organizationId) ?? null)
              : null,
            as: role.as,
          })),
          onList: notice.onList,
          joinedAt: toIso(joined.get(notice.id) ?? null),
          // notToldYet reads only these two.
          state: notice.state === 'unknown' ? 'unknown' : 'failed',
          reason: notice.lastReason,
          error: notice.lastError,
          attempts: notice.attempts,
          waitingSince: notice.createdAt.toISOString(),
          lastTriedAt: toIso(notice.attemptedAt),
          nextTryAt,
          changeSavedAt: changeSavedAt.toISOString(),
          changeEffectiveFrom: toIso(changeEffectiveFrom),
        })
      );
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listFeeNotices');
    }
  }

  /**
   * Support told someone about a fee rise another way, for example on the
   * phone (§1.6). One transaction: lock the change, then the notice (the
   * order the fee writes and the daily run take them in), refuse with a 409
   * when there is nothing to mark, record the mark, and date the rise when
   * this was the last person on the list. After the commit it invalidates
   * the level's fee cache, so the date shows at once.
   *
   * A second press after a lost answer meets FEE_NOTICE_ALREADY_TOLD, and the
   * page reads that as done.
   */
  async markToldAnotherWay(
    noticeId: string,
    input: SupportToldAnotherWayInput,
    toldByUserId: string,
    now: Date = new Date()
  ): Promise<ToldAnotherWayResult> {
    try {
      const [found] = await this.db
        .select({ changeId: feeChangeNotices.changeId })
        .from(feeChangeNotices)
        .where(
          and(
            eq(feeChangeNotices.id, noticeId),
            eq(feeChangeNotices.kind, 'announce')
          )
        )
        .limit(1);
      if (!found) {
        throw new NotFoundError('No fee notice with this id', { noticeId });
      }
      const { result, level } = await this.db.transaction(async (tx) => {
        const [change] = await tx
          .select()
          .from(feeChanges)
          .where(eq(feeChanges.id, found.changeId))
          .for('update');
        if (
          !change ||
          change.kind !== 'rise' ||
          change.voidedAt !== null ||
          (change.effectiveFrom !== null && change.effectiveFrom <= now)
        ) {
          throw new ConflictError(
            'Nothing to mark: this fee rise has started, or was cancelled or replaced.',
            {
              code: 'FEE_CHANGE_NOT_WAITING',
              changeId: found.changeId,
              voidedAt: toIso(change?.voidedAt ?? null),
              voidReason: change?.voidReason ?? null,
              effectiveFrom: toIso(change?.effectiveFrom ?? null),
            }
          );
        }
        const [notice] = await tx
          .select()
          .from(feeChangeNotices)
          .where(eq(feeChangeNotices.id, noticeId))
          .for('update');
        if (!notice) {
          throw new NotFoundError('No fee notice with this id', { noticeId });
        }
        if (notice.state === 'sent' || notice.state === 'told_another_way') {
          // Who marked them, by name, for "already marked as told by Sam
          // Ortiz at 10:41" (F6). A platform-owner route only.
          const [by] = notice.toldByUserId
            ? await tx
                .select({ name: users.name })
                .from(users)
                .where(eq(users.id, notice.toldByUserId))
                .limit(1)
            : [];
          throw new ConflictError('This person has already been told.', {
            code: 'FEE_NOTICE_ALREADY_TOLD',
            noticeId,
            state: notice.state,
            acceptedAt: toIso(notice.acceptedAt),
            toldAt: toIso(notice.toldAt),
            toldByUserId: notice.toldByUserId,
            toldByName: by?.name ?? null,
          });
        }
        if (notice.state === 'not_needed') {
          throw new ConflictError(
            'This person is no longer paid less, so no notice is needed.',
            { code: 'FEE_NOTICE_NOT_NEEDED', noticeId }
          );
        }
        await tx
          .update(feeChangeNotices)
          .set({
            state: 'told_another_way',
            toldNote: input.note,
            toldByUserId,
            toldAt: now,
            updatedAt: now,
          })
          .where(eq(feeChangeNotices.id, noticeId));
        const dating = await dateRiseIfAllTold(tx, change.id);
        this.obs.info('Support marked a fee notice told another way', {
          noticeId,
          changeId: change.id,
          toldByUserId,
          dated: dating.dated,
        });
        const marked: ToldAnotherWayResult = {
          notice: {
            noticeId,
            state: 'told_another_way',
            toldAt: now.toISOString(),
            toldBy: toldByUserId,
            note: input.note,
          },
          change: {
            changeId: change.id,
            effectiveFrom: toIso(dating.effectiveFrom),
            waitingFor: dating.dated ? 0 : dating.waitingFor,
          },
        };
        return { result: marked, level: feeLevelOfChange(change) };
      });
      // Not needed for correctness (a date is 30 days off, and the cache
      // re-reads hourly while a rise waits); it shows the date at once.
      this.feeConfig.invalidateLevel(level);
      return result;
    } catch (error) {
      this.handleError(error, 'markToldAnotherWay');
    }
  }

  /** Each change's announcement counts, on the list and joined since. */
  private async feeNoticeTallies(changeIds: string[]) {
    const n = feeChangeNotices;
    const counted = (filter: SQL) =>
      sql<number>`count(*) FILTER (WHERE ${filter})`.mapWith(Number);
    // Told: an accepted email or support's mark. Waiting: the open states
    // (FEE_NOTICE_OPEN_STATES), the ones a person on the list holds the date in.
    const told = sql`${n.state} IN ('sent', 'told_another_way')`;
    const waiting = sql`${n.state} IN ('due', 'failed', 'unknown')`;
    const rows = await this.db
      .select({
        changeId: n.changeId,
        byEmail: counted(sql`${n.onList} AND ${n.state} = 'sent'`),
        anotherWay: counted(
          sql`${n.onList} AND ${n.state} = 'told_another_way'`
        ),
        waiting: counted(sql`${n.onList} AND ${waiting}`),
        joiners: counted(sql`NOT ${n.onList} AND ${n.state} <> 'not_needed'`),
        joinersTold: counted(sql`NOT ${n.onList} AND ${told}`),
        joinersWaiting: counted(sql`NOT ${n.onList} AND ${waiting}`),
        lastToldAt:
          sql<Date | null>`max(GREATEST(${n.acceptedAt}, ${n.toldAt})) FILTER (WHERE ${n.onList} AND ${told})`.mapWith(
            (value: string | Date | null) =>
              value === null ? null : new Date(value)
          ),
      })
      .from(n)
      .where(and(inArray(n.changeId, changeIds), eq(n.kind, 'announce')))
      .groupBy(n.changeId);
    return new Map(rows.map((row) => [row.changeId, row]));
  }

  /**
   * F7's "joined 12 Nov": for each joiner, the day they joined one of the
   * organisations the rise reaches them through, when that is on or after
   * the rise's first announcement. An older membership means they joined
   * the LIST, not the organisation (a promotion, say), and an orgless
   * creator has no membership: both are null, never the notice's own date
   * (that is `waitingSince`).
   */
  private async joinedSinceAnnounced(
    rows: Array<{
      notice: {
        id: string;
        userId: string;
        onList: boolean;
        roles: Array<{ organizationId: string | null }>;
      };
      changeFirstRunAt: Date | null;
    }>
  ): Promise<Map<string, Date>> {
    const joiners = rows.filter(
      ({ notice, changeFirstRunAt }) =>
        !notice.onList && changeFirstRunAt !== null
    );
    const userIds = unique(joiners.map(({ notice }) => notice.userId));
    const orgIds = unique(
      joiners.flatMap(({ notice }) =>
        notice.roles.map((role) => role.organizationId)
      )
    );
    const joined = new Map<string, Date>();
    if (userIds.length === 0 || orgIds.length === 0) return joined;
    const memberships = await this.db
      .select({
        userId: organizationMemberships.userId,
        organizationId: organizationMemberships.organizationId,
        createdAt: organizationMemberships.createdAt,
      })
      .from(organizationMemberships)
      .where(
        and(
          inArray(organizationMemberships.userId, userIds),
          inArray(organizationMemberships.organizationId, orgIds)
        )
      );
    const since = new Map(
      memberships.map((m) => [`${m.userId}:${m.organizationId}`, m.createdAt])
    );
    for (const { notice, changeFirstRunAt } of joiners) {
      if (!changeFirstRunAt) continue;
      // The earliest such join: the one that made them a joiner.
      for (const role of notice.roles) {
        if (!role.organizationId) continue;
        const at = since.get(`${notice.userId}:${role.organizationId}`);
        if (!at || at < changeFirstRunAt) continue;
        const best = joined.get(notice.id);
        if (!best || at < best) joined.set(notice.id, at);
      }
    }
    return joined;
  }

  /**
   * Each change's on-list told counts per London calendar day: the day each
   * email was accepted, or each person was marked told another way.
   */
  private async feeToldByDay(
    changeIds: string[]
  ): Promise<Map<string, FeeToldOnDay[]>> {
    const n = feeChangeNotices;
    const day = sql<string>`to_char((CASE WHEN ${n.state} = 'sent' THEN ${n.acceptedAt} ELSE ${n.toldAt} END) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        changeId: n.changeId,
        londonDate: day,
        byEmail:
          sql<number>`count(*) FILTER (WHERE ${n.state} = 'sent')`.mapWith(
            Number
          ),
        anotherWay:
          sql<number>`count(*) FILTER (WHERE ${n.state} = 'told_another_way')`.mapWith(
            Number
          ),
      })
      .from(n)
      .where(
        and(
          inArray(n.changeId, changeIds),
          eq(n.kind, 'announce'),
          eq(n.onList, true),
          inArray(n.state, ['sent', 'told_another_way'])
        )
      )
      .groupBy(n.changeId, day)
      .orderBy(day);
    const days = new Map<string, FeeToldOnDay[]>();
    for (const { changeId, ...counts } of rows) {
      const list = days.get(changeId) ?? [];
      list.push(counts);
      days.set(changeId, list);
    }
    return days;
  }

  /** The latest 20 people marked told another way, per change, in one read. */
  private async toldAnotherWayOf(
    changeIds: string[]
  ): Promise<Map<string, FeeToldAnotherWay[]>> {
    const n = feeChangeNotices;
    const ranked = this.db
      .select({
        changeId: n.changeId,
        userId: n.userId,
        toldByUserId: n.toldByUserId,
        toldAt: n.toldAt,
        note: n.toldNote,
        rank: sql<number>`row_number() OVER (PARTITION BY ${n.changeId} ORDER BY ${n.toldAt} DESC, ${n.id})`.as(
          'rank'
        ),
      })
      .from(n)
      .where(
        and(
          inArray(n.changeId, changeIds),
          eq(n.kind, 'announce'),
          eq(n.state, 'told_another_way')
        )
      )
      .as('ranked');
    const rows = await this.db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, TOLD_ANOTHER_WAY_SHOWN))
      .orderBy(asc(ranked.rank));
    const people = await this.peopleById(
      rows.flatMap((row) => [row.userId, row.toldByUserId])
    );
    const lists = new Map<string, FeeToldAnotherWay[]>(
      changeIds.map((changeId) => [changeId, []])
    );
    for (const row of rows) {
      lists.get(row.changeId)?.push({
        person: people.get(row.userId) ?? {
          userId: row.userId,
          name: '',
          deleted: true,
        },
        by: row.toldByUserId ? (people.get(row.toldByUserId) ?? null) : null,
        at: toIso(row.toldAt) ?? '',
        note: row.note ?? '',
      });
    }
    return lists;
  }

  /**
   * What each change moves at its own level, layered over the levels in
   * force now: what that level's sales pay today, and with the change. One
   * read of the changes' versions, and one per scope of the levels below.
   */
  private async feeChangeLinesOf(
    changes: FeeChangeRow[],
    platformNow: FeeVersionValues | null,
    now: Date
  ): Promise<Array<{ lines: FeeChangeLine[]; removed: boolean }>> {
    const orgIds = unique(
      changes.map((c) => (c.scope === 'platform' ? null : c.organizationId))
    );
    const creatorIds = unique(
      changes.map((c) => (c.scope === 'creator' ? c.creatorId : null))
    );
    const none = Promise.resolve(new Map<string, FeeVersionList>());
    const [versions, orgLevels, creatorLevels] = await Promise.all([
      this.db
        .select()
        .from(feeConfigVersions)
        .where(
          and(
            inArray(
              feeConfigVersions.changeId,
              changes.map((c) => c.id)
            ),
            isNull(feeConfigVersions.supersededAt)
          )
        ),
      orgIds.length > 0
        ? readFeeVersionsByLevel(
            this.db,
            'org',
            inArray(feeChanges.organizationId, orgIds)
          )
        : none,
      creatorIds.length > 0
        ? readFeeVersionsByLevel(
            this.db,
            'creator',
            and(
              inArray(feeChanges.organizationId, orgIds),
              inArray(feeChanges.creatorId, creatorIds)
            )
          )
        : none,
    ]);
    const versionOf = new Map(versions.map((v) => [v.changeId, v]));
    const inForce = (lists: Map<string, FeeVersionList>, level: FeeLevel) =>
      versionInForce(
        lists.get(feeLevelKey(level)) ?? { versions: [], waiting: false },
        now
      );

    return changes.map((change) => {
      const level = feeLevelOfChange(change);
      const version = versionOf.get(change.id);
      const own = version && !version.removed ? version : null;
      if (level.scope === 'platform') {
        return {
          lines: feeLines(layerLevelFees(platformNow), layerLevelFees(own)),
          removed: false,
        };
      }
      const orgNow = inForce(orgLevels, {
        scope: 'org',
        organizationId: level.organizationId,
      });
      if (level.scope === 'org') {
        return {
          lines: feeLines(
            layerLevelFees(platformNow, orgNow),
            layerLevelFees(platformNow, own)
          ),
          removed: version?.removed ?? false,
        };
      }
      const creatorNow = inForce(creatorLevels, level);
      return {
        lines: feeLines(
          layerLevelFees(platformNow, orgNow, creatorNow),
          layerLevelFees(platformNow, orgNow, own)
        ),
        removed: version?.removed ?? false,
      };
    });
  }

  private async organizationsOf(
    organizationIds: readonly (string | null | undefined)[]
  ): Promise<Map<string, { id: string; name: string; deleted: boolean }>> {
    const ids = unique(organizationIds);
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        deletedAt: organizations.deletedAt,
      })
      .from(organizations)
      .where(inArray(organizations.id, ids));
    return new Map(
      rows.map((row) => [
        row.id,
        { id: row.id, name: row.name, deleted: row.deletedAt !== null },
      ])
    );
  }

  // ==========================================================================
  // Price moves (Codex-2hxff.85, .86; batch C1 Part B data design §2.5)
  //
  // Every action is a database flip the next hourly run acts on: admin-api has
  // no worker secret to send an email, and only a refund-restricted Stripe key.
  // ==========================================================================

  /**
   * Queue › Price moves: held moves not closed, and moves support queued
   * again that the run hasn't finished with, oldest first. A queued row is
   * off the badge but stays here ("Queued for 11:00") until the run moves it
   * or holds it again. The plan and amounts come from the record, not the log.
   */
  async listHeldPriceMoves(
    query: SupportQueueQuery,
    now: Date = new Date()
  ): Promise<PaginatedListResponse<HeldPriceMove>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const where = onPriceMovesQueue();
      const [rows, [totals]] = await Promise.all([
        this.priceMoveRows(where, { limit, offset }),
        this.db
          .select({ total: count() })
          .from(subscriptionPriceMoves)
          .where(where),
      ]);
      const items = await this.priceMoveViews(rows, now);
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listHeldPriceMoves');
    }
  }

  /**
   * Price changes the run stopped, oldest stop first: one card per change,
   * since nobody on it was tried after the first batch. A card asked to
   * restart stays, off the badge, until the run restarts it.
   */
  async listStoppedPriceChanges(
    query: SupportQueueQuery,
    now: Date = new Date()
  ): Promise<PaginatedListResponse<StoppedPriceChange>> {
    try {
      const { page, limit } = query;
      const { offset } = withPagination({ page, limit });
      const stopped = eq(priceChanges.state, 'stopped');
      const [rows, [totals]] = await Promise.all([
        this.stoppedChangeRows(stopped, { limit, offset }),
        this.db.select({ total: count() }).from(priceChanges).where(stopped),
      ]);
      const items = await this.stoppedChangeViews(rows, now);
      return pageOf(items, totals?.total ?? 0, page, limit);
    } catch (error) {
      this.handleError(error, 'listStoppedPriceChanges');
    }
  }

  /**
   * Retry a held move. With no accepted email, it goes back to `due`: the run
   * emails them again, and their 30 days count from the new email. With one,
   * it goes to `notified`: the run asks Stripe again for the date they were
   * told, or the next renewal if that has passed, and sends no second email
   * (Q5). Either way it gets three fresh tries and keeps its `held_reason`.
   *
   * A row flip only: the move is locked, checked again, then flipped. The
   * change is not touched: the run re-opens a finished change that has a row
   * to work. Refused with 409 PRICE_MOVE_NOT_HELD when the row isn't held,
   * the subscription has ended, or a newer price for the plan replaced this
   * one: Retry would then tell them about the older price. A newer save
   * that lands just after supersedes the flipped row.
   */
  async retryPriceMove(
    moveId: string,
    requestedByUserId: string,
    now: Date = new Date()
  ): Promise<PriceMoveRetried> {
    try {
      const read = await this.priceMoveRead(moveId);
      await this.db.transaction(async (tx) => {
        const move = await this.lockPriceMove(tx, moveId);
        const newer = await this.newerPriceChange(tx, read);
        const refused = refusedPriceMove(move, {
          action: 'retry',
          newer,
          ended: !isLivePriceMoveStatus(read.subscriptionStatus),
        });
        if (refused) {
          throw priceMoveNotHeld(refused, 'retry', move, read, newer);
        }

        const told = move.noticeAt !== null;
        await tx
          .update(subscriptionPriceMoves)
          .set({
            state: told ? 'notified' : 'due',
            attempts: 0,
            nextAttemptAt: null,
            retryRequestedAt: now,
            retryRequestedByUserId: requestedByUserId,
            updatedAt: now,
          })
          .where(eq(subscriptionPriceMoves.id, moveId));
        this.obs.info('Support queued a held price move again', {
          moveId,
          priceChangeId: move.priceChangeId,
          requestedByUserId,
          to: told ? 'notified' : 'due',
        });
      });
      const move = await this.priceMoveView(moveId, now);
      return { move, nextRunAt: nextPriceMovesRunAfter(now).toISOString() };
    } catch (error) {
      this.handleError(error, 'retryPriceMove');
    }
  }

  /**
   * Close a held move without a retry: `moved_by_hand` or `not_needed`, with
   * support's note. It moves nobody; the row stays `held` (which the run never
   * claims) and leaves the Queue. Refused with 409 PRICE_MOVE_NOT_HELD when it
   * isn't held or is closed already. A held row a newer price overtook can be
   * closed: closing tells nobody anything. The move is the only row locked.
   */
  async closePriceMove(
    moveId: string,
    input: SupportClosePriceMoveInput,
    resolvedByUserId: string,
    now: Date = new Date()
  ): Promise<HeldPriceMove> {
    try {
      const read = await this.priceMoveRead(moveId);
      await this.db.transaction(async (tx) => {
        const move = await this.lockPriceMove(tx, moveId);
        const refused = refusedPriceMove(move, { action: 'close' });
        if (refused) {
          const newer =
            refused === 'superseded'
              ? await this.newerPriceChange(tx, read)
              : undefined;
          throw priceMoveNotHeld(refused, 'close', move, read, newer);
        }

        await tx
          .update(subscriptionPriceMoves)
          .set({
            resolution: input.resolution,
            resolvedAt: now,
            resolvedByUserId,
            resolutionNote: input.note,
            updatedAt: now,
          })
          .where(eq(subscriptionPriceMoves.id, moveId));
        this.obs.info('Support closed a held price move', {
          moveId,
          priceChangeId: move.priceChangeId,
          resolution: input.resolution,
          resolvedByUserId,
        });
      });
      return await this.priceMoveView(moveId, now);
    } catch (error) {
      this.handleError(error, 'closePriceMove');
    }
  }

  /**
   * Restart a stopped change once its cause is fixed (Q6): the next run sets
   * it running again and carries on where it stopped. A repeat before that
   * run returns the change as it stands. Refused with 409
   * PRICE_CHANGE_NOT_STOPPED when it isn't stopped.
   */
  async restartPriceChange(
    changeId: string,
    requestedByUserId: string,
    now: Date = new Date()
  ): Promise<PriceChangeRestarted> {
    try {
      await this.db.transaction(async (tx) => {
        const [change] = await tx
          .select()
          .from(priceChanges)
          .where(eq(priceChanges.id, changeId))
          .for('update');
        if (!change) {
          throw new NotFoundError('No price change with this id', {
            changeId,
          });
        }
        if (change.state !== 'stopped') {
          throw new ConflictError(notStoppedMessage(change.state), {
            code: 'PRICE_CHANGE_NOT_STOPPED',
            changeId,
            state: change.state,
            doneAt: toIso(change.doneAt),
            supersededAt: toIso(change.supersededAt),
            supersededById: change.supersededById,
          });
        }
        if (restartPending(change)) return;
        await tx
          .update(priceChanges)
          .set({
            restartRequestedAt: now,
            restartRequestedByUserId: requestedByUserId,
          })
          .where(eq(priceChanges.id, changeId));
        this.obs.info('Support restarted a stopped price change', {
          changeId,
          requestedByUserId,
          stoppedErrorId: change.stoppedErrorId,
        });
      });
      const [row] = await this.stoppedChangeRows(eq(priceChanges.id, changeId));
      const [change] = await this.stoppedChangeViews(row ? [row] : [], now);
      if (!change) {
        throw new InternalServiceError('A restarted price change did not read');
      }
      return { change, nextRunAt: nextPriceMovesRunAfter(now).toISOString() };
    } catch (error) {
      this.handleError(error, 'restartPriceChange');
    }
  }

  /** One move's queue read; a 404 when there is none. */
  private async priceMoveRead(moveId: string): Promise<PriceMoveRead> {
    const [read] = await this.priceMoveRows(
      eq(subscriptionPriceMoves.id, moveId)
    );
    if (!read) {
      throw new NotFoundError('No price move with this id', { moveId });
    }
    return read;
  }

  /**
   * The move, locked for Retry's or Close's transaction: the one row either
   * writes. The state is read again under the lock.
   */
  private async lockPriceMove(
    tx: Tx,
    moveId: string
  ): Promise<SubscriptionPriceMove> {
    const [move] = await tx
      .select()
      .from(subscriptionPriceMoves)
      .where(eq(subscriptionPriceMoves.id, moveId))
      .for('update');
    if (!move) {
      throw new NotFoundError('No price move with this id', { moveId });
    }
    return move;
  }

  /**
   * The latest change not superseded, saved after this move's for the same
   * tier or plan and interval: latest wins, so its own rows tell these
   * subscribers instead. It reads only what a change never changes (its plan,
   * interval and save time), so the change needs no lock.
   */
  private async newerPriceChange(
    tx: Tx,
    { move, change }: PriceMoveRead
  ): Promise<NewerPriceChange | undefined> {
    const c = priceChanges;
    const samePlan = change.tierId
      ? eq(c.tierId, change.tierId)
      : change.courseSubscriptionPlanId
        ? eq(c.courseSubscriptionPlanId, change.courseSubscriptionPlanId)
        : undefined;
    if (!samePlan) {
      throw new InternalServiceError('A price change names no tier or plan', {
        changeId: move.priceChangeId,
      });
    }
    const [newer] = await tx
      .select({
        id: c.id,
        createdAt: c.createdAt,
        newAmountCents: c.newAmountCents,
      })
      .from(c)
      .where(
        and(
          samePlan,
          eq(c.interval, change.interval),
          gt(c.createdAt, change.createdAt),
          ne(c.state, 'superseded')
        )
      )
      .orderBy(desc(c.createdAt), desc(c.id))
      .limit(1);
    return newer;
  }

  /**
   * Queue reads for the moves `where` names, oldest first: the move, its
   * change's plan and amounts, who and which organisation, and the
   * subscription's status now.
   */
  private async priceMoveRows(
    where: SQL,
    pageAt?: { limit: number; offset: number }
  ): Promise<PriceMoveRead[]> {
    const m = subscriptionPriceMoves;
    const c = priceChanges;
    const query = this.db
      .select({
        move: m,
        change: {
          kind: c.kind,
          tierId: c.tierId,
          courseSubscriptionPlanId: c.courseSubscriptionPlanId,
          interval: c.interval,
          fromAmountCents: c.fromAmountCents,
          newAmountCents: c.newAmountCents,
          createdAt: c.createdAt,
        },
        subscriber: {
          name: users.name,
          email: users.email,
          deletedAt: users.deletedAt,
        },
        organization: {
          name: organizations.name,
          deletedAt: organizations.deletedAt,
        },
        planName: sql<
          string | null
        >`COALESCE(${subscriptionTiers.name}, ${courses.title})`,
        subscriptionStatus: sql<
          string | null
        >`COALESCE(${subscriptions.status}, ${courseSubscriptions.status})`,
        // The price-moves sweep's own read (`sub_disputed_at`, owner D1).
        subscriptionDisputed: sql<boolean>`(COALESCE(${subscriptions.disputedAt}, ${courseSubscriptions.disputedAt}) IS NOT NULL)`,
      })
      .from(m)
      .innerJoin(c, eq(c.id, m.priceChangeId))
      .innerJoin(users, eq(users.id, m.userId))
      .innerJoin(organizations, eq(organizations.id, m.organizationId))
      .leftJoin(subscriptionTiers, eq(subscriptionTiers.id, c.tierId))
      .leftJoin(
        courseSubscriptionPlans,
        eq(courseSubscriptionPlans.id, c.courseSubscriptionPlanId)
      )
      .leftJoin(courses, eq(courses.id, courseSubscriptionPlans.courseId))
      .leftJoin(subscriptions, eq(subscriptions.id, m.subscriptionId))
      .leftJoin(
        courseSubscriptions,
        eq(courseSubscriptions.id, m.courseSubscriptionId)
      )
      .where(where)
      .orderBy(asc(m.createdAt), asc(m.id));
    return pageAt
      ? await query.limit(pageAt.limit).offset(pageAt.offset)
      : await query;
  }

  private async priceMoveViews(
    rows: PriceMoveRead[],
    now: Date
  ): Promise<HeldPriceMove[]> {
    const people = await this.peopleById(
      rows.flatMap(({ move }) => [
        move.retryRequestedByUserId,
        move.resolvedByUserId,
      ])
    );
    return rows.map((row) => heldPriceMoveOf(row, people, now));
  }

  /** One move as the Queue shows it, read after an action's write. */
  private async priceMoveView(
    moveId: string,
    now: Date
  ): Promise<HeldPriceMove> {
    const [view] = await this.priceMoveViews(
      [await this.priceMoveRead(moveId)],
      now
    );
    if (!view) throw new InternalServiceError('A price move did not read');
    return view;
  }

  /** Stopped-change reads for the changes `where` names, oldest stop first. */
  private async stoppedChangeRows(
    where: SQL,
    pageAt?: { limit: number; offset: number }
  ): Promise<StoppedChangeRead[]> {
    const c = priceChanges;
    const query = this.db
      .select({
        change: c,
        organization: {
          name: organizations.name,
          deletedAt: organizations.deletedAt,
        },
        planName: sql<
          string | null
        >`COALESCE(${subscriptionTiers.name}, ${courses.title})`,
      })
      .from(c)
      .innerJoin(organizations, eq(organizations.id, c.organizationId))
      .leftJoin(subscriptionTiers, eq(subscriptionTiers.id, c.tierId))
      .leftJoin(
        courseSubscriptionPlans,
        eq(courseSubscriptionPlans.id, c.courseSubscriptionPlanId)
      )
      .leftJoin(courses, eq(courses.id, courseSubscriptionPlans.courseId))
      .where(where)
      .orderBy(asc(c.stoppedAt), asc(c.id));
    return pageAt
      ? await query.limit(pageAt.limit).offset(pageAt.offset)
      : await query;
  }

  /** The cards, with each change's waiting count in one grouped read. */
  private async stoppedChangeViews(
    rows: StoppedChangeRead[],
    now: Date
  ): Promise<StoppedPriceChange[]> {
    if (rows.length === 0) return [];
    const m = subscriptionPriceMoves;
    const [waiting, people] = await Promise.all([
      this.db
        .select({
          changeId: m.priceChangeId,
          waiting: count(),
        })
        .from(m)
        .where(
          and(
            inArray(
              m.priceChangeId,
              rows.map(({ change }) => change.id)
            ),
            inArray(m.state, ['due', 'notified'])
          )
        )
        .groupBy(m.priceChangeId),
      this.peopleById(
        rows.flatMap(({ change }) => [
          change.createdByUserId,
          change.restartRequestedByUserId,
        ])
      ),
    ]);
    const waitingOf = new Map(
      waiting.map((row) => [row.changeId, row.waiting])
    );
    const restartsAt = nextPriceMovesRunAfter(now).toISOString();
    return rows.map(({ change, organization, planName }) => ({
      changeId: change.id,
      organization: {
        id: change.organizationId,
        name: organization.name,
        deleted: organization.deletedAt !== null,
      },
      plan: priceMovePlanOf(change, planName),
      fromAmountCents: change.fromAmountCents,
      newAmountCents: change.newAmountCents,
      savedAt: change.createdAt.toISOString(),
      savedBy: personOf(people, change.createdByUserId),
      // A stopped change has all three (check_price_changes_stopped_set).
      stoppedAt: toIso(change.stoppedAt) ?? '',
      stoppedReason: change.stoppedReason ?? '',
      stoppedErrorId: change.stoppedErrorId ?? '',
      waiting: waitingOf.get(change.id) ?? 0,
      total: change.totalCount,
      restart:
        restartPending(change) && change.restartRequestedAt
          ? {
              requestedAt: change.restartRequestedAt.toISOString(),
              by: personOf(people, change.restartRequestedByUserId),
              at: restartsAt,
            }
          : null,
    }));
  }

  // ==========================================================================
  // Shared reads
  // ==========================================================================

  /**
   * What a charge paid for (`sourcesOfCharges`). None is a 404: support never
   * refunds a charge we hold no record of (the Stripe sandbox is shared with
   * other environments).
   */
  private async sourceOfCharge(
    chargeId: string,
    readCharge: () => Promise<Stripe.Charge>
  ): Promise<ChargeSource> {
    const source = (await this.sourcesOfCharges([chargeId], readCharge)).get(
      chargeId
    );
    if (!source) {
      throw new NotFoundError('No record of this charge', { chargeId });
    }
    return source;
  }

  /**
   * What each charge paid for, from our records, in this order: its
   * platform-fee slice (every charge has one), else a refund recorded on it
   * that names a purchase, else a dispute, else, for a purchase recorded
   * before charge ids were (D8), Stripe's PaymentIntent. A charge with none
   * is absent from the map. Each step reads only the charges the steps
   * before it left, so one charge costs what it always did, and a page of
   * them costs at most four queries. `readCharge` answers null for a charge
   * Stripe doesn't hold; its other errors propagate.
   */
  private async sourcesOfCharges(
    chargeIds: readonly string[],
    readCharge: (chargeId: string) => Promise<Stripe.Charge | null>
  ): Promise<Map<string, ChargeSource>> {
    const found = new Map<string, ChargeSource>();
    const take = (
      chargeId: string | null,
      source: ChargeSource | undefined
    ) => {
      if (chargeId && source && !found.has(chargeId)) {
        found.set(chargeId, source);
      }
    };
    const left = () => unique(chargeIds).filter((id) => !found.has(id));

    let remaining = left();
    if (remaining.length === 0) return found;
    const fees = await this.db
      .select({
        chargeId: payouts.stripeChargeId,
        purchaseId: payouts.purchaseId,
        subscriptionId: payouts.subscriptionId,
        courseSubscriptionId: payouts.courseSubscriptionId,
      })
      .from(payouts)
      .where(
        and(
          inArray(payouts.stripeChargeId, remaining),
          eq(payouts.payoutType, 'platform_fee')
        )
      );
    for (const row of fees) take(row.chargeId, sourceFromIds(row));

    remaining = left();
    if (remaining.length === 0) return found;
    const named = await this.db
      .select({
        chargeId: refunds.stripeChargeId,
        purchaseId: refunds.purchaseId,
      })
      .from(refunds)
      .where(
        and(
          inArray(refunds.stripeChargeId, remaining),
          isNotNull(refunds.purchaseId)
        )
      );
    for (const row of named) {
      take(
        row.chargeId,
        row.purchaseId
          ? { type: 'purchase', purchaseId: row.purchaseId }
          : undefined
      );
    }

    remaining = left();
    if (remaining.length === 0) return found;
    const disputed = await this.db
      .select({
        chargeId: disputes.stripeChargeId,
        purchaseId: disputes.purchaseId,
        subscriptionId: disputes.subscriptionId,
        courseSubscriptionId: disputes.courseSubscriptionId,
      })
      .from(disputes)
      .where(inArray(disputes.stripeChargeId, remaining));
    for (const row of disputed) take(row.chargeId, sourceFromIds(row));

    remaining = left();
    if (remaining.length === 0) return found;
    const chargeByIntent = new Map<string, string>();
    const read = await Promise.all(
      remaining.map(async (chargeId) => ({
        chargeId,
        charge: await readCharge(chargeId),
      }))
    );
    for (const { chargeId, charge } of read) {
      const paymentIntentId = charge ? paymentIntentIdOf(charge) : null;
      if (paymentIntentId) chargeByIntent.set(paymentIntentId, chargeId);
    }
    if (chargeByIntent.size === 0) return found;
    const bought = await this.db
      .select({
        id: purchases.id,
        paymentIntentId: purchases.stripePaymentIntentId,
      })
      .from(purchases)
      .where(
        inArray(purchases.stripePaymentIntentId, [...chargeByIntent.keys()])
      );
    for (const row of bought) {
      take(
        row.paymentIntentId
          ? (chargeByIntent.get(row.paymentIntentId) ?? null)
          : null,
        { type: 'purchase', purchaseId: row.id }
      );
    }
    return found;
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
        stripeSubscriptionId: table.stripeSubscriptionId,
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
        stripeSubscriptionId: row.stripeSubscriptionId,
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
   * Each ref names its purchase: a failed refund's comes from
   * `purchasesOfRefunds`, a debt's from its slice.
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
        paidAt: Date;
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
        paidAt: Date;
      }
    >();
    const purchaseIds = unique(refs.map((ref) => ref.purchaseId));
    if (purchaseIds.length > 0) {
      const rows = await this.db
        .select({
          id: purchases.id,
          amountCents: purchases.amountPaidCents,
          // As search's purchase branch.
          paidAt: sql<Date>`COALESCE(${purchases.purchasedAt}, ${purchases.createdAt})`,
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
          paidAt: new Date(row.paidAt),
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
          paidAt: new Date(row.paidAt),
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
    const debtIds = steps
      .filter((step) => step.status === 'debt')
      .map((step) => step.id);
    const stepIds = steps.map((step) => step.id);
    const [causes, reviews, credits] = await Promise.all([
      this.causeFacts(steps),
      debtIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              payoutReversalId: refundReviews.payoutReversalId,
              resolution: refundReviews.resolution,
              attemptedReversalCents: refundReviews.attemptedReversalCents,
              resolvedAt: refundReviews.resolvedAt,
            })
            .from(refundReviews)
            .where(inArray(refundReviews.payoutReversalId, debtIds)),
      stepIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({ credit: payeeCredits, repayStatus: payouts.status })
            .from(payeeCredits)
            .leftJoin(payouts, eq(payouts.id, payeeCredits.repayPayoutId))
            .where(inArray(payeeCredits.payoutReversalId, stepIds)),
    ]);
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const reviewOf = new Map(
      reviews.flatMap((review) =>
        review.payoutReversalId ? [[review.payoutReversalId, review]] : []
      )
    );
    const needsPerson = await payeeCreditsNeedingAPerson(
      this.db,
      credits.map(({ credit }) => credit)
    );
    return {
      credits: new Map(
        credits.map(({ credit, repayStatus }) => [
          credit.payoutReversalId,
          {
            id: credit.id,
            effect: credit.effect,
            amountCents: credit.amountCents,
            settledAs: credit.settledAs,
            resolution: credit.resolution,
            repayPayout: credit.repayPayoutId
              ? { id: credit.repayPayoutId, status: repayStatus ?? 'pending' }
              : null,
            needsPerson: needsPerson.has(credit.id),
            siblingTook: needsPerson.get(credit.id)?.siblingTook ?? false,
            action: creditAction(
              {
                ...credit,
                needsPerson: needsPerson.has(credit.id),
                siblingTook: needsPerson.get(credit.id)?.siblingTook ?? false,
              },
              {
                repaidByPayoutId:
                  stepById.get(credit.payoutReversalId)?.repaidByPayoutId ??
                  null,
              },
              reviewOf.get(credit.payoutReversalId) ?? null
            ),
          },
        ])
      ),
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
      disputeDates: new Map(
        [...causes.values()].flatMap((cause) =>
          cause.openedAt === null
            ? []
            : [
                [
                  cause.id,
                  {
                    openedAt: cause.openedAt,
                    wonAt: cause.disputeStatus === 'won' ? cause.wonAt : null,
                  },
                ],
              ]
        )
      ),
      lateWins: new Map(
        [...causes.values()].flatMap((cause) =>
          cause.lateWin ? [[cause.id, cause.lateWin]] : []
        )
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

  /**
   * Each refund's and dispute's own amount, and a dispute's current status,
   * when it opened (Stripe's `created`) and when its outcome was applied.
   */
  private async causeFacts(
    refs: ReadonlyArray<{ causeType: string; causeId: string }>
  ): Promise<
    Map<
      string,
      {
        id: string;
        amountCents: number | null;
        disputeStatus: string | null;
        openedAt: string | null;
        wonAt: string | null;
        /** A late win's loss date (Codex-2hxff.70); null for any other cause. */
        lateWin: { lostOn: string | null } | null;
      }
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
              openedAt: disputes.stripeCreatedAt,
              outcomeAppliedAt: disputes.outcomeAppliedAt,
              lateWonAt: disputes.lateWonAt,
              lostAppliedAt: disputes.lostAppliedAt,
            })
            .from(disputes)
            .where(inArray(disputes.stripeDisputeId, disputeIds)),
    ]);
    const facts = new Map<
      string,
      {
        id: string;
        amountCents: number | null;
        disputeStatus: string | null;
        openedAt: string | null;
        wonAt: string | null;
        /** A late win's loss date (Codex-2hxff.70); null for any other cause. */
        lateWin: { lostOn: string | null } | null;
      }
    >();
    for (const row of refundRows) {
      facts.set(causeKey('refund', row.id), {
        id: row.id,
        amountCents: row.amountCents,
        disputeStatus: null,
        openedAt: null,
        wonAt: null,
        lateWin: null,
      });
    }
    for (const row of disputeRows) {
      facts.set(causeKey('dispute', row.id), {
        id: row.id,
        amountCents: row.amountCents,
        disputeStatus: row.status,
        openedAt: row.openedAt.toISOString(),
        wonAt: toIso(row.outcomeAppliedAt),
        lateWin: row.lateWonAt ? { lostOn: toIso(row.lostAppliedAt) } : null,
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

// ─── Fee notices: helpers (Codex-2hxff.33) ───────────────────────────────────

/** How many told-another-way marks a fee card names. */
const TOLD_ANOTHER_WAY_SHOWN = 20;

/** A fee rise that hasn't started: waiting for its emails, or dated later. */
function notStartedRise(now: Date) {
  return and(
    eq(feeChanges.kind, 'rise'),
    isNull(feeChanges.voidedAt),
    or(isNull(feeChanges.effectiveFrom), gt(feeChanges.effectiveFrom, now))
  );
}

/**
 * An announcement that hasn't gone through, for a rise that hasn't started.
 * Joiners' too (Q4): they don't hold the date, but they still need telling.
 */
function notToldYet(now: Date) {
  return and(
    eq(feeChangeNotices.kind, 'announce'),
    inArray(feeChangeNotices.state, ['failed', 'unknown']),
    notStartedRise(now)
  );
}

/** The level a change was saved on (its scope CHECK guarantees the keys). */
function feeLevelOfChange(change: FeeChangeRow): FeeLevel {
  if (change.scope === 'creator' && change.organizationId && change.creatorId) {
    return {
      scope: 'creator',
      organizationId: change.organizationId,
      creatorId: change.creatorId,
    };
  }
  if (change.scope === 'org' && change.organizationId) {
    return { scope: 'org', organizationId: change.organizationId };
  }
  return { scope: 'platform' };
}

const FEE_LINE_VALUES = [
  'platformFeePercent',
  'orgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
] as const;

/** Each value that moves; one line when both kinds of sale move alike. */
function feeLines(before: LevelFees, after: LevelFees): FeeChangeLine[] {
  const lines: FeeChangeLine[] = [];
  for (const value of FEE_LINE_VALUES) {
    const one = { from: before.oneOff[value], to: after.oneOff[value] };
    const sub = {
      from: before.subscription[value],
      to: after.subscription[value],
    };
    if (one.from === sub.from && one.to === sub.to) {
      if (one.from !== one.to) lines.push({ value, context: 'both', ...one });
      continue;
    }
    if (one.from !== one.to) lines.push({ value, context: 'one_off', ...one });
    if (sub.from !== sub.to) {
      lines.push({ value, context: 'subscription', ...sub });
    }
  }
  return lines;
}

// ─── Price moves: helpers (Codex-2hxff.85, .86) ──────────────────────────────

/** A move as the Queue reads it. */
interface PriceMoveRead {
  move: SubscriptionPriceMove;
  change: Pick<
    PriceChange,
    | 'kind'
    | 'tierId'
    | 'courseSubscriptionPlanId'
    | 'interval'
    | 'fromAmountCents'
    | 'newAmountCents'
    | 'createdAt'
  >;
  subscriber: { name: string; email: string; deletedAt: Date | null };
  organization: { name: string; deletedAt: Date | null };
  /** The tier's name, or the course's title. */
  planName: string | null;
  /** The subscription's status now, either kind. */
  subscriptionStatus: string | null;
  /** It has an open chargeback (`disputed_at`), either kind. */
  subscriptionDisputed: boolean;
}

/** A stopped change as its card reads it. */
interface StoppedChangeRead {
  change: PriceChange;
  organization: { name: string; deletedAt: Date | null };
  planName: string | null;
}

/** A change saved after another for the same tier or plan and interval. */
interface NewerPriceChange {
  id: string;
  createdAt: Date;
  newAmountCents: number;
}

/**
 * The run a queued row waits for: the next one, or, when the run set the
 * row's next try later, the first run at or after it (the claim takes a row
 * whose next try has come).
 */
function queuedRunFor(now: Date, nextAttemptAt: Date | null): Date {
  return nextAttemptAt && nextAttemptAt > now
    ? nextPriceMovesRunAfter(new Date(nextAttemptAt.getTime() - 1))
    : nextPriceMovesRunAfter(now);
}

/**
 * On Queue › Price moves: not closed, and held, or queued again by Retry and
 * still with the run (due, or told with the move still to write).
 */
function onPriceMovesQueue(): SQL {
  const m = subscriptionPriceMoves;
  return sql`${m.resolvedAt} IS NULL AND (${m.state} = 'held' OR (${m.state} IN ('due', 'notified') AND ${m.retryRequestedAt} IS NOT NULL))`;
}

/** A stopped change on the badge: nobody has pressed Restart since it stopped. */
function stoppedAwaitingRestart(): SQL {
  const c = priceChanges;
  return sql`${c.state} = 'stopped' AND (${c.restartRequestedAt} IS NULL OR ${c.restartRequestedAt} <= ${c.stoppedAt})`;
}

/**
 * Support pressed Restart after the latest stop. The run restarts a stopped
 * change whose `restart_requested_at` is after its `stopped_at`; a press from
 * before a later stop is history.
 */
function restartPending(
  change: Pick<PriceChange, 'restartRequestedAt' | 'stoppedAt'>
): boolean {
  return (
    change.restartRequestedAt !== null &&
    change.stoppedAt !== null &&
    change.restartRequestedAt > change.stoppedAt
  );
}

/** The statuses a price change writes moves for (§2.3); any other has ended. */
const PRICE_MOVE_LIVE_STATUSES: readonly string[] = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.CANCELLING,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.PAUSED,
];

function isLivePriceMoveStatus(status: string | null): boolean {
  return status !== null && PRICE_MOVE_LIVE_STATUSES.includes(status);
}

/**
 * Why Retry or Close can't act on a move now, or null when it can: it must
 * be held and not closed. Retry also needs a live subscription and no newer
 * price for the plan, or it would tell them about the older price; Close
 * needs neither, since closing tells nobody anything.
 */
function refusedPriceMove(
  move: SubscriptionPriceMove,
  check:
    | {
        action: 'retry';
        newer: NewerPriceChange | undefined;
        ended: boolean;
      }
    | { action: 'close' }
): PriceMoveNotHeldReason | null {
  // The run closes a retried row `retried_ok` when it ends moved or set
  // aside: that one is answered by its state, not as support's close.
  if (move.resolvedAt !== null && move.resolution !== 'retried_ok') {
    return 'resolved';
  }
  if (move.state === 'superseded') return 'superseded';
  if (move.state === 'scheduled' || move.state === 'unchanged') return 'moved';
  if (move.state === 'skipped') return 'skipped';
  if (move.state !== 'held') {
    return move.retryRequestedAt !== null ? 'queued' : 'in_progress';
  }
  if (move.resolvedAt !== null) return 'resolved';
  if (check.action === 'close') return null;
  if (check.newer) return 'superseded';
  if (check.ended) return 'subscription_ended';
  return null;
}

const SKIPPED_MESSAGES: Readonly<Record<string, string>> = {
  moving_away:
    'They are moving to another plan, so this price no longer applies to them.',
  other_interval:
    'They now pay on another billing interval, so this price no longer applies to them.',
  no_items: 'The run found nothing on their subscription to move.',
  ended:
    'Their subscription ended before the run reached them, so there is nothing to move.',
};

const CLOSED_AS: Readonly<Record<string, string>> = {
  moved_by_hand: 'moved by hand',
  not_needed: 'no move needed',
  retried_ok: 'moved after a retry',
};

/**
 * The 409 for a move Retry or Close can't act on. Its message and details
 * reach support's page (`mapErrorToResponse`), so they say why in plain
 * words, with nothing internal.
 */
function priceMoveNotHeld(
  reason: PriceMoveNotHeldReason,
  action: 'retry' | 'close',
  move: SubscriptionPriceMove,
  read: PriceMoveRead,
  newer: NewerPriceChange | undefined
): ConflictError {
  const plan = read.planName ?? 'this plan';
  const messages: Record<PriceMoveNotHeldReason, string> = {
    superseded: newer
      ? `A newer price for ${plan} replaced this one ${londonWhen(newer.createdAt)}, so they are emailed about that instead.`
      : `A newer price for ${plan} replaced this one, so they are emailed about that instead.`,
    moved:
      move.state === 'unchanged'
        ? 'They are already on the new price.'
        : 'Their move is already scheduled: the hourly run got there first.',
    skipped:
      SKIPPED_MESSAGES[move.skipReason ?? ''] ??
      'The hourly run set this one aside, so there is nothing to move.',
    subscription_ended:
      'Their subscription has ended, so there is nothing to move. Close it as not needed.',
    resolved: `This one is already closed: ${CLOSED_AS[move.resolution ?? ''] ?? 'closed by support'}.`,
    queued:
      action === 'retry'
        ? 'This one is already queued for the next run.'
        : 'This one is queued for the next run. If the run holds it again, close it then.',
    in_progress: "The hourly run is still working on this one: it isn't held.",
  };
  return new ConflictError(messages[reason], {
    code: 'PRICE_MOVE_NOT_HELD',
    reason,
    moveId: move.id,
    state: move.state,
    ...(reason === 'superseded' && newer
      ? {
          supersededById: newer.id,
          supersededAt: newer.createdAt.toISOString(),
          newAmountCents: newer.newAmountCents,
        }
      : {}),
    ...(reason === 'skipped' ? { skipReason: move.skipReason } : {}),
    ...(reason === 'resolved'
      ? {
          resolution: move.resolution,
          resolvedAt: toIso(move.resolvedAt),
          resolvedByUserId: move.resolvedByUserId,
        }
      : {}),
    ...(reason === 'queued'
      ? {
          retryRequestedAt: toIso(move.retryRequestedAt),
          retryRequestedByUserId: move.retryRequestedByUserId,
        }
      : {}),
  });
}

function notStoppedMessage(state: string): string {
  if (state === 'running') {
    return 'This price change is running: the hourly run is already emailing its subscribers.';
  }
  if (state === 'done') {
    return 'This price change has finished: there is nothing to restart.';
  }
  return 'A newer price replaced this one, so there is nothing to restart.';
}

// Built on first use, not at module scope: a module-scope call would keep
// this file in every bundle that imports the barrel (bank-payouts.ts).
let londonWhen_: Intl.DateTimeFormat | undefined;

/** "at 10:30 on 4 Nov 2026", on the London clock. */
function londonWhen(at: Date): string {
  londonWhen_ ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const part: Record<string, string> = {};
  for (const { type, value } of londonWhen_.formatToParts(at)) {
    part[type] = value;
  }
  return `at ${part.hour}:${part.minute} on ${part.day} ${part.month} ${part.year}`;
}

function personOf(
  people: Map<string, SupportPerson>,
  userId: string | null
): SupportPerson | null {
  return userId ? (people.get(userId) ?? null) : null;
}

function priceMovePlanOf(
  change: Pick<
    PriceChange,
    'kind' | 'tierId' | 'courseSubscriptionPlanId' | 'interval'
  >,
  name: string | null
): PriceMovePlan {
  // check_price_changes_kind and _interval guarantee these.
  return {
    kind: change.kind === 'course_plan' ? 'course_plan' : 'tier',
    id: change.tierId ?? change.courseSubscriptionPlanId ?? '',
    name: name ?? '',
    interval: change.interval === 'year' ? 'year' : 'month',
  };
}

function heldPriceMoveOf(
  row: PriceMoveRead,
  people: Map<string, SupportPerson>,
  now: Date
): HeldPriceMove {
  const { move, change } = row;
  const status: HeldPriceMove['status'] =
    move.resolvedAt !== null
      ? 'closed'
      : move.state === 'held'
        ? 'held'
        : 'queued';
  const ended = !isLivePriceMoveStatus(row.subscriptionStatus);
  const closedBy = move.resolution;
  return {
    moveId: move.id,
    priceChangeId: move.priceChangeId,
    status,
    action:
      status === 'held' && !ended
        ? move.noticeAt !== null
          ? 'retry_move'
          : 'retry'
        : null,
    subscriber: {
      userId: move.userId,
      name: row.subscriber.name,
      email: row.subscriber.email,
      deleted: row.subscriber.deletedAt !== null,
    },
    organization: {
      id: move.organizationId,
      name: row.organization.name,
      deleted: row.organization.deletedAt !== null,
    },
    plan: priceMovePlanOf(change, row.planName),
    fromAmountCents: change.fromAmountCents,
    newAmountCents: change.newAmountCents,
    heldReason: move.heldReason as PriceMoveHeldReason | null,
    lastError: move.lastError,
    alertErrorId: move.alertErrorId,
    attempts: move.attempts,
    lastTriedAt: toIso(move.attemptedAt),
    noticeAt: toIso(move.noticeAt),
    effectiveAt: toIso(move.effectiveAt),
    subscriptionEnded: ended,
    retry: move.retryRequestedAt
      ? {
          requestedAt: move.retryRequestedAt.toISOString(),
          by: personOf(people, move.retryRequestedByUserId),
        }
      : null,
    queuedFor:
      status === 'queued'
        ? queuedRunFor(now, move.nextAttemptAt).toISOString()
        : null,
    // Owner D1, "Wait while disputed", mirroring the sweep: it defers a live
    // member with an open chargeback by a day, after its ended check, so a
    // row nothing will run (closed, or the subscription ended) is not waiting.
    waitsForDispute: status !== 'closed' && !ended && row.subscriptionDisputed,
    resolution:
      move.resolvedAt &&
      (closedBy === 'moved_by_hand' || closedBy === 'not_needed')
        ? {
            kind: closedBy,
            note: move.resolutionNote ?? '',
            resolvedAt: move.resolvedAt.toISOString(),
            by: personOf(people, move.resolvedByUserId),
          }
        : null,
    createdAt: move.createdAt.toISOString(),
  };
}
