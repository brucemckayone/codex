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

import { agreementsInForce, isEnvName } from '@codex/agreements';
import type { VersionedCache } from '@codex/cache';
import {
  BILLING_INTERVAL,
  CHECKOUT_SESSION_KIND,
  CURRENCY,
  STRIPE_ENV_METADATA_KEY,
  SUBSCRIPTION_STATUS,
  stripeEnvMetadata,
  TIER_CHANGE_PREVIEW_TTL_MS,
} from '@codex/constants';
import {
  dateWindow,
  isForeignKeyViolation,
  isUniqueViolation,
  toIso,
} from '@codex/database';
import {
  connectBalances,
  organizationFollowers,
  organizationMemberships,
  type PayoutType,
  payoutReversals,
  payouts,
  priceChanges,
  stripeConnectAccounts,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  assertGbpOnly,
  type BankPayoutRunSummary,
  bankOnFor,
  type ClawbackCharge,
  type ClearedEpisode,
  claimPayoutAttempts,
  findTransfersForPayouts,
  isBankPayoutRun,
  isDrainablePayout,
  issueRefund,
  type LedgerDeps,
  listClawableRefunds,
  londonDate,
  type OrganisationPayee,
  type PayeeAccounts,
  type PlatformFailureTally,
  payeeAccountIds,
  payoutReleasedBankFields,
  pendingReductionsFor,
  platformFailureTally,
  type RecordSliceInput,
  type RecordSliceOutcome,
  type ReleasedSlice,
  recordPlatformFee,
  recordSplitOnce,
  recordTransferFailure,
  renewPayoutAttempt,
  reportPlatformFailures,
  resolveInvoiceCharge,
  resolveOrganisationPayee,
  retryFailedClawbacks,
  reverseCharge,
  reverseEarlierRefundsAfterCommit,
  runBankPayouts,
  settlePayoutPaid,
  settleTransfer,
  takeBackMovedMoney,
  type WaitingSetup,
  waitingMoney,
} from '@codex/payments';
import {
  applyMinPlatformFeeFloor,
  CheckoutReservations,
  checkoutIdempotencyKey,
  type FeeConfig,
  type FeeContext,
  type FeeResolver,
  stripeErrorCode,
  toStripeTime,
  withStaleCustomerRecovery,
} from '@codex/purchase';
import {
  BaseService,
  describeThrown,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
  ServiceUnavailableError,
  ValidationError,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import { buildOrgUrlFromEnv } from '@codex/urls';
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadySubscribedError,
  ConflictError,
  ConnectAccountNotReadyError,
  ForbiddenError,
  MoveAlreadyLandedError,
  PendingMoveKeepFirstError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  SubscriptionPaymentRequiredError,
  SubscriptionScheduledElsewhereError,
  TierChangeCancellingError,
  TierChangeIntervalWhileMovingError,
  TierChangePreviewExpiredError,
  TierChangeTwoStepsError,
  TierNotFoundError,
} from '../errors';
import {
  billingScheduleUpdate,
  isHalfMadeSchedule,
  isOurSchedule,
  onLastPhase,
  phaseTwoPriceId,
  scheduleIdOf,
  scheduleNeedsFinishing,
  type WaitingBilling,
} from './billing-change';
import { alertIfCreditPaid } from './credit-paid-invoice';
import {
  addMonthsClamped,
  CLEAR_PENDING_PRICE_METADATA,
  ensurePriceActive,
  isDefinitiveStripeRefusal,
  type PriceChangeNoticeMailer,
  rejoinTierPriceChange,
} from './pending-price-change';
import {
  type PriceMoveStepOptions,
  type PriceMoveStepResult,
  runPriceMoveStep,
} from './price-moves-sweep';
import { calculateRevenueSplit } from './revenue-split';
import {
  mapStripeSubscriptionStatus,
  resolveStatus,
} from './stripe-status-mapper';
import {
  cancelLostDisputeSubscription,
  type DisputedSubscription,
  type DisputeInput,
  pauseBilling,
  pauseDisputedSubscription,
  restoreDisputedSubscription,
} from './subscription-dispute';
import {
  cancelAndRefundDuplicate,
  isDuplicateSubscription,
} from './subscription-duplicates';
import {
  type InvalidationReason,
  invalidateForUser,
  type WaitUntilFn,
} from './subscription-invalidation';
import {
  cancelForFullRefund,
  type RefundCancellation,
  type RefundedCharge,
} from './subscription-refund';
import {
  billingChangeMetadata,
  CLEAR_HOLD_METADATA,
  CLEAR_MOVE_METADATA,
  classifyTierChange,
  flipMetadata,
  keepMetadata,
  livePendingPrice,
  MOVE_TIER_ID_KEY,
  moveMetadata,
  readWaitingMove,
  startsNewPeriod,
  type TierChangeKind,
  tierChangeQuote,
  type WaitingMove,
  waitsForBilling,
} from './tier-move';

type Subscription = typeof subscriptions.$inferSelect;
type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
type Tx = Parameters<
  Parameters<typeof import('@codex/database')['dbWs']['transaction']>[0]
>[0];

/**
 * The statuses of a user's one live subscription to an org: the ones
 * `uq_active_subscription_per_user_org` allows once per user and org.
 */
const LIVE_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.CANCELLING,
];

/**
 * A write from `from` to `to` would bring a row back to live: an old
 * subscription revived (an `unpaid` one paid), or a first payment completing.
 */
function revives(from: string, to: string): boolean {
  return !isLiveStatus(from) && isLiveStatus(to);
}

function isLiveStatus(status: string): boolean {
  const live: readonly string[] = LIVE_STATUSES;
  return live.includes(status);
}

/** A tier-change preview's `prorationDate` may run ahead of our clock by this much. */
const PRORATION_DATE_CLOCK_SKEW_MS = 60 * 1000;

/**
 * What a tier change does once it is allowed (data design §1), with what a
 * preview and a commit both need: see `SubscriptionService.planTierChange`.
 */
interface TierChangePlan {
  kind: TierChangeKind;
  sub: Subscription;
  newTierId: string;
  newPriceId: string;
  billingInterval: 'month' | 'year';
  /** The target tier's price on the chosen billing: the next bill. */
  newRecurringAmount: number;
  live: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  /** The change already waiting (a move, or a change of billing), if any. */
  move: WaitingMove | null;
  /**
   * The monthly Price and amount a change leaving yearly billing waits for
   * (Codex-2hxff.97). For C(b), `newPriceId` and `newRecurringAmount` are the
   * target's YEARLY Price, put on now.
   */
  billing: { priceId: string; amountCents: number } | null;
  /** Our schedule, when one is attached (`isOurSchedule`). */
  schedule: Stripe.SubscriptionSchedule | null;
}

/**
 * How a change that happens now is prorated. An upgrade charges the
 * part-period difference; a same-price switch moves no money (Q4). A switch
 * into yearly starts a new period today (.96) and is always invoiced at once,
 * the unused month against the year (review C1 cycle 2, L3): with the year
 * never below the month (`YearlyPriceBelowMonthlyError`) that bill is never
 * negative, so nothing is left as credit on the member's one customer. Any
 * other switch of billing period is as before.
 */
function nowProration(
  plan: Pick<
    TierChangePlan,
    'kind' | 'newRecurringAmount' | 'sub' | 'move' | 'billingInterval'
  >
): 'always_invoice' | 'create_prorations' | 'none' {
  if (plan.kind === 'upgrade') return 'always_invoice';
  if (plan.kind === 'lateral' || plan.kind === 'downgrade') return 'none';
  // C(b): the plan now on yearly billing, as an upgrade (dearer) or a
  // same-price switch, against what the year was paid at.
  if (plan.kind === 'change_then_billing_wait') {
    const paid = plan.move?.holdAmountCents ?? plan.sub.amountCents;
    return plan.newRecurringAmount > paid ? 'always_invoice' : 'none';
  }
  if (startsNewPeriod(plan.kind, plan.billingInterval)) return 'always_invoice';
  return plan.newRecurringAmount > plan.sub.amountCents
    ? 'always_invoice'
    : 'create_prorations';
}

/** The idempotency-key prefix of a change made now, by its proration. */
const NOW_CHANGE_KEY_PREFIX = {
  always_invoice: 'upgrade',
  create_prorations: 'switch',
  none: 'lateral',
} as const;

/**
 * A row with no move waiting: the three columns go together, and a waiting
 * change of billing only beside them (the CHECKs).
 */
const NO_PENDING_MOVE = {
  pendingTierId: null,
  pendingTierFrom: null,
  heldAmountCents: null,
  pendingBillingInterval: null,
  pendingAmountCents: null,
} as const;

/** Waiting moves the hourly backstop flips per run (data design §5.2). */
const TIER_MOVE_BACKSTOP_LIMIT = 50;

/**
 * The backstop takes a move this long after its renewal: before then the
 * renewal's own `customer.subscription.updated` is the flip's.
 */
const TIER_MOVE_HOUR_MS = 60 * 60 * 1000;
const TIER_MOVE_BACKSTOP_GRACE_MS = TIER_MOVE_HOUR_MS;

/**
 * Payees one payouts sweep claims (Codex-2hxff.13). Each costs an
 * `accounts.retrieve` and, when payable, a drain; the rest wait for the next
 * run, least recently checked first.
 */
const SWEEP_PAYEE_LIMIT = 50;

/**
 * The subscription has ended at Stripe: `canceled` is terminal
 * (https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses),
 * and an `incomplete_expired` one never started and never will.
 */
function endedAtStripeStatus(status: Stripe.Subscription.Status): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

/**
 * The columns a subscriber's own reads ({@link SubscriptionService.getSubscription},
 * {@link SubscriptionService.getUserSubscriptions}) leave out (Codex-mbs2l):
 * the org's revenue-share terms, which is what the fee split is, and the
 * internal bookkeeping fields. Every ecom route that returns these reads
 * answers the subscriber, never the org. A `false` entry excludes that column
 * and keeps the rest; `satisfies` catches a misspelt key, which drizzle would
 * drop without a word. Because a column added later IS read, the service test
 * fails until every column of `subscriptions` is listed here or on its
 * visible list, so a new money column cannot reach subscribers unnoticed.
 */
export const SUBSCRIBER_HIDDEN_COLUMNS = {
  platformFeeCents: false,
  organizationFeeCents: false,
  creatorPayoutCents: false,
  duplicateOfSubscriptionId: false,
  duplicateSettledAt: false,
  churnReason: false,
  // A waiting move reaches the subscriber as `pendingTierChange` instead,
  // with the target's name and billing (Codex-2hxff.16). `heldAmountCents`
  // stays visible: the account card shows it while a move waits.
  pendingTierId: false,
  pendingTierFrom: false,
  // A waiting change of billing reaches them the same way (Codex-2hxff.97),
  // and the schedule carrying it is Stripe's bookkeeping.
  pendingBillingInterval: false,
  pendingAmountCents: false,
  stripeScheduleId: false,
} as const satisfies Partial<Record<keyof Subscription, false>>;

/**
 * A subscription as its subscriber reads it. apps/web's wire types are built
 * on this, so a column hidden here leaves the web's types too.
 */
export type SubscriberSubscription = Omit<
  Subscription,
  keyof typeof SUBSCRIBER_HIDDEN_COLUMNS
>;

/**
 * A change that waits for the renewal (Codex-2hxff.16, data design §2.3), as
 * the pricing page, the paywall and the account card read it: "Moving to
 * Basic on 12 November · Keep current plan". Until then the member keeps the
 * current tier, and `heldAmountCents` is what they pay.
 *
 * Leaving yearly billing waits for the year's end too (Codex-2hxff.97): a
 * change of billing alone, or of plan and billing together. One Keep undoes
 * the whole change (Q4).
 */
export interface PendingTierChange {
  /**
   * What waits: `plan`, a move to a cheaper plan on the same billing;
   * `billing`, a switch to monthly billing on the same plan ("Keep yearly
   * billing"); `plan_and_billing`, another plan billed monthly ("Keep current
   * plan").
   */
  kind: 'plan' | 'billing' | 'plan_and_billing';
  tierId: string;
  tierName: string;
  /**
   * The next bill, at the target's price on `billingInterval`. For a plan
   * move it is the row's `amountCents`; for a change of billing the row's
   * `amountCents` is still the yearly price paid now.
   */
  amountCents: number;
  /** The billing the change lands on: the waiting interval for a change of billing. */
  billingInterval: 'month' | 'year';
  /** ISO: the renewal the move lands on (`pending_tier_from`). */
  effectiveAt: string;
  /**
   * A price change on the target that lands after the move (T6), or null:
   * the newest change on the target they have been told about
   * (`subscription_price_moves`, scheduled, or told with its Stripe write
   * still to land), as their own email named it. Read from our record, never
   * from Stripe.
   */
  laterPrice: null | { amountCents: number; effectiveAt: string };
}

export interface SubscriptionWithTier extends SubscriberSubscription {
  tier: SubscriptionTier;
  pendingTierChange: PendingTierChange | null;
}

export interface SubscriptionWithOrg extends SubscriberSubscription {
  tier: SubscriptionTier;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  pendingTierChange: PendingTierChange | null;
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

/**
 * Display status for a `payouts` row in the studio payouts table
 * (Codex-zqaxo). Derived from the persisted `resolvedAt`,
 * `stripeTransferId`, and `reason` columns — there is no `status` column
 * on the table itself.
 */
export type PayoutDisplayStatus =
  | 'pending'
  | 'resolved'
  | 'failed'
  | 'reversed'
  | 'cancelled_by_refund'
  | 'cancelled_by_dispute';

/**
 * Read-model returned by `SubscriptionService.listSubscribers` (studio
 * Subscribers page — Codex-z27ml).
 *
 * Joins the `subscriptions` row with the subscribing `users` row and the
 * `subscriptionTiers` row, flattened into a single shape the studio table
 * consumes directly. All dates are ISO strings — serialised at the service
 * boundary so the worker → JSON → SvelteKit remote pipeline is lossless.
 *
 * `userName` is nullable because BetterAuth allows users without a display
 * name; the UI falls back to `userEmail` in that case.
 */
export interface SubscriberListItem {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  userAvatarUrl: string | null;
  tierId: string;
  tierName: string;
  status: string;
  billingInterval: string;
  amountCents: number;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  churnReason: string | null;
  createdAt: string;
}

/**
 * Read-model returned by `SubscriptionService.listPayoutsByOrg`. The
 * creator denorm fields (`creatorName`, `creatorEmail`, `creatorAvatarUrl`)
 * come from a LEFT JOIN on `users` — null when the user row has been
 * removed but the payout history remains.
 *
 * Dates are serialised as ISO strings so the worker→Hono→JSON boundary
 * is lossless and the SvelteKit remote-function consumer can pass them
 * straight to `formatDate`.
 */
export interface PayoutWithCreator {
  id: string;
  // Null for `platform_fee` rows — the platform isn't a user, so there is no
  // recipient creatorId. UI must handle this case (e.g. render "Platform" label).
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  creatorAvatarUrl: string | null;
  amountCents: number;
  currency: string;
  reason: string;
  status: PayoutDisplayStatus;
  resolvedAt: string | null;
  stripeTransferId: string | null;
  createdAt: string;
  // PR3 additions (Codex-05vp8): payoutType + subscriber denorm
  payoutType: PayoutType;
  subscriberName: string | null;
  subscriberEmail: string | null;
  // Codex-h69cg: tri-party ledger source — drives the studio Source filter
  // chip and lets the UI render "Purchase · Org fee" vs "Subscription · Org fee".
  sourceType: 'purchase' | 'subscription';
  // Codex-6nt4l: transaction grouping. All 3 sibling rows of one charge share
  // the same `transferGroup` value (set by ledger writers in h69cg). The UI
  // groups by this key into a header + indented children layout.
  // Nullable for pre-h69cg historical rows — UI falls back to row.id.
  transferGroup: string | null;
  purchaseId: string | null;
  subscriptionId: string | null;
  stripeChargeId: string | null;
  /**
   * The London date (`YYYY-MM-DD`) this row's money goes, or went, to the
   * payee's bank: the daily payout run 14 days after the sale (Codex-2hxff.29,
   * `bankOnFor`). Null when unpaid, or while Stripe's own schedule pays the
   * payee's account.
   */
  bankOn: string | null;
}

/**
 * Per-creator aggregate row for the `/studio/payouts` right rail
 * (Codex-6nt4l). One row per user who has received a `creator_payout` or
 * `organization_fee` payout — `platform_fee` rows are excluded because the
 * platform is not a per-creator recipient.
 *
 * Aggregation runs in-memory over the same row set as `listPayoutsByOrg`
 * (shared filter clause via `buildPayoutConditions`) so filter chips reshape
 * both surfaces consistently. Mirrors `AdminAnalyticsService.getRevenueByCreator`
 * — Map-based accumulation over a single SELECT, not SQL GROUP BY.
 *
 * `userId` is non-nullable: the DB CHECK constraint on `payouts` enforces
 * `payout_type = 'platform_fee' OR user_id IS NOT NULL`, and we filter out
 * platform_fee rows at query time. The org owner appears here too, flagged
 * via `isOrgOwner` for the role badge — they are not split into a separate
 * section.
 *
 * Owner attribution: `organization_fee` rows write `userId = orgOwnerId`,
 * so the owner's totals INCLUDE the org fee share alongside any
 * `creator_payout` rows they personally received. Non-owner creators see
 * only their `creator_payout` rows. The badge is the visual cue for this
 * asymmetry.
 */
export interface CreatorPayoutBreakdown {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isOrgOwner: boolean;
  totalPaidCents: number;
  purchasePaidCents: number;
  subscriptionPaidCents: number;
  // Codex-6nt4l: subset of `totalPaidCents` from `organization_fee` rows.
  // Always 0 for non-owners. For org owners this is the slice of their
  // headline total that's the platform's per-charge org cut — surfaced
  // on the card so the owner's apples-to-creators comparison stays honest.
  orgFeePaidCents: number;
  transactionCount: number;
  needsAttentionCount: number;
  lastPaidAt: string | null;
}

/**
 * Filter options shared by `listPayoutsByOrg` and
 * `getPayoutsByCreatorBreakdown`. Extracted so both surfaces reshape together
 * when the user toggles a filter chip — see `buildPayoutConditions`.
 *
 * `status='all'` and `sourceType='all'` are explicit no-ops; absence of the
 * field is treated identically (default applied at the validation boundary).
 */
type PayoutFilterOptions = {
  status?:
    | 'all'
    | 'pending'
    | 'paid'
    | 'resolved'
    | 'failed'
    | 'reversed'
    | 'cancelled_by_refund'
    | 'cancelled_by_dispute'
    | 'needs_attention';
  sourceType?: 'all' | 'purchase' | 'subscription';
  fromDate?: string;
  toDate?: string;
  /** Rows transferred on or after this: `bankOnFor`'s transferredAt. */
  transferredFrom?: string;
};

/**
 * Aggregate KPI numbers powering the `/studio/payouts` summary row.
 *
 * - `earnedInPeriodCents` honours the date window passed by the UI (default 30d)
 * - `totalEarnedCents` / `inTransitCents` / `needsAttentionCount` are lifetime
 *
 * All four aggregates share the org-scoping invariant — never relax to
 * user-only scoping; a creator can belong to multiple orgs.
 */
export interface PayoutSummary {
  earnedInPeriodCents: number;
  totalEarnedCents: number;
  inTransitCents: number;
  needsAttentionCount: number;
}

/**
 * A single creator-owned payout row for the creator earnings hub
 * (Codex-69t7c.7 / WP7). Unlike {@link PayoutWithCreator} (the org-table view)
 * this omits creator identity (it IS the caller) and subscriber denorm (a
 * creator must not see who paid inside another org — cross-org privacy). It
 * keeps `organizationId` so the hub can group "earned from each org".
 */
export interface CreatorPayoutRow {
  id: string;
  organizationId: string | null;
  amountCents: number;
  currency: string;
  reason: string;
  status: PayoutDisplayStatus;
  payoutType: PayoutType;
  sourceType: 'purchase' | 'subscription';
  resolvedAt: string | null;
  stripeTransferId: string | null;
  transferGroup: string | null;
  createdAt: string;
  purchaseId: string | null;
  subscriptionId: string | null;
  stripeChargeId: string | null;
  /** As on {@link PayoutWithCreator}: when this row's money reaches the bank. */
  bankOn: string | null;
  /**
   * A `reversed` row's take-back: when Stripe took the money back (London
   * `YYYY-MM-DD`) and why, from its latest step that moved money. Null
   * otherwise.
   */
  takenBack: { causeType: 'refund' | 'dispute'; on: string } | null;
}

/**
 * Money waiting for the creator to set up payouts (Codex-2hxff.34), from the
 * same query as the monthly email (`waitingMoney`), so the Earnings banner
 * and the email cannot disagree. Across every organisation, as creator and
 * as owner.
 */
export interface CreatorWaitingMoney {
  totalCents: number;
  /** ISO: the oldest waiting row. */
  oldestAt: string;
  organisations: Array<{
    organizationId: string | null;
    name: string | null;
    /** The organisation's own share, paid to its owner. */
    asOwner: boolean;
    cents: number;
  }>;
  setup: WaitingSetup;
}

/**
 * Creator earnings KPIs (Codex-69t7c.7 / WP7) — the userId-scoped counterpart
 * of {@link PayoutSummary}. Same four numbers, INVERSE scoping invariant:
 * where `PayoutSummary` must NEVER relax to user-only scope (an org's KPIs
 * can't leak other orgs), this one is DELIBERATELY user-scoped ACROSS every
 * org that paid the creator. Only `creator_payout` + `creator_payout_to_owner`
 * count — `organization_fee`/`platform_fee` are never a creator's personal
 * earnings (consistent with the WP6 / Codex-h3864 fix).
 */
export interface CreatorEarningsSummary {
  earnedInPeriodCents: number;
  totalEarnedCents: number;
  inTransitCents: number;
  needsAttentionCount: number;
  /** Null when nothing is waiting for setup. */
  waiting: CreatorWaitingMoney | null;
}

/**
 * Payout types that count as a creator's PERSONAL earnings (Codex-69t7c.7).
 * Excludes `organization_fee` (the platform's per-charge org cut — attributed
 * to the owner's userId but NOT personal earnings, see WP6) and `platform_fee`
 * (no creator recipient). The single source of truth for the creator-scope
 * payout filter, shared by the list query and the earnings-summary aggregates.
 */
const CREATOR_EARNING_PAYOUT_TYPES = [
  'creator_payout',
  'creator_payout_to_owner',
] as const satisfies readonly PayoutType[];

/**
 * "Needs attention" counts stuck charges, not ledger rows (Codex-2hxff.15,
 * SUB-20): a charge's slices share its id, so one stuck sale reads 1, and two
 * stuck renewals of one subscription (one transfer group) read 2 — in both
 * summaries and the by-creator table alike. A row with no charge id falls
 * back to its transfer group, then to itself.
 */
const NEEDS_ATTENTION_CHARGES = sql<number>`count(DISTINCT COALESCE(${payouts.stripeChargeId}, ${payouts.transferGroup}, ${payouts.id}::text))::int`;

/**
 * Map the persisted `payouts.status` column to the UI display vocabulary.
 *
 * Storage column: `'paid' | 'pending' | 'failed'` (CHECK-enforced).
 * UI vocabulary keeps the legacy term `'resolved'` for one release so existing
 * `/studio/payouts?status=resolved` URLs and the current filter chip continue
 * to work. PR 3 (UI rebuild) introduces a `'paid'` chip and PR 4 drops the
 * alias.
 */
function derivePayoutStatus(status: string): PayoutDisplayStatus {
  if (status === 'paid') return 'resolved';
  if (status === 'failed') return 'failed';
  if (status === 'reversed') return 'reversed';
  if (status === 'cancelled_by_refund') return 'cancelled_by_refund';
  if (status === 'cancelled_by_dispute') return 'cancelled_by_dispute';
  return 'pending';
}

/**
 * Email payload shape returned by webhook handlers.
 * Mirrors SendEmailToWorkerParams so the handler can pass it directly
 * to sendEmailToWorker() without composing email data itself.
 */
export interface WebhookEmailPayload {
  to: string;
  toName?: string;
  templateName: string;
  category: 'transactional' | 'marketing' | 'digest';
  userId?: string;
  data: Record<string, string | number | boolean>;
}

/**
 * Result returned by webhook handler methods.
 * Contains all side-effect data the handler needs (cache invalidation, email).
 *
 * `userId` + `orgId` feed the shared `invalidateForUser` helper so each
 * subscription lifecycle event bumps both COLLECTION_USER_LIBRARY and,
 * when an org is involved, COLLECTION_USER_SUBSCRIPTION. See
 * docs/payments/access.md ("Keeping caches in step").
 */
export interface WebhookHandlerResult {
  /** User ID for cache invalidation (COLLECTION_USER_LIBRARY) */
  userId?: string;
  /**
   * Organization ID for the per-org subscription cache bump
   * (COLLECTION_USER_SUBSCRIPTION). Optional because a few events
   * (e.g. malformed webhook with missing metadata) legitimately have
   * no org context — the helper skips the subscription bump in that case.
   */
  orgId?: string;
  /** Composed email payload ready for sendEmailToWorker() */
  email?: WebhookEmailPayload;
}

/**
 * Result of `verifyCheckoutSession()` — what the /subscription/success page
 * reads. `subscription` appears once our row for the session exists.
 */
export interface SubscriptionCheckoutVerifyResult {
  sessionStatus: 'complete' | 'expired' | 'open';
  subscription?: {
    id: string;
    organizationId: string;
    tierId: string;
    tierName: string;
    organizationName: string;
    organizationSlug: string;
    startedAt: string;
    /**
     * Set when this subscription is a duplicate (Codex-2hxff.15): the
     * subscription it repeats, which the user keeps. This one is cancelled
     * and refunded, so the page says so instead of confirming it
     * (Codex-o4jvw).
     */
    duplicateOf?: { id: string; tierId: string; tierName: string };
  };
}

/**
 * Result of `previewTierChange()` — drives the proration confirmation dialog.
 *
 * `prorationDate` is the canonical timestamp the preview was computed at.
 * Callers MUST pass it back into `changeTier()` so the actual proration
 * matches the preview exactly (Stripe re-runs the calculation otherwise).
 */
export interface TierChangePreview {
  /** Net amount the customer pays NOW (proration delta, in pence). */
  amountDueCents: number;
  /**
   * The lines the customer sees: the proration charges and credits, and for
   * a switch into yearly billing every line of the invoice, the new year's
   * own charge included, so the lines add up to what is charged
   * (Codex-2hxff.96).
   */
  prorationLineItems: Array<{
    description: string | null;
    amountCents: number;
  }>;
  /** Recurring price after the switch (next-period charge, in pence). */
  newRecurringAmountCents: number;
  /** Recurring billing interval after the switch. */
  newRecurringInterval: 'month' | 'year';
  /** Unix timestamp — pass back to `changeTier()` to lock in the same proration. */
  prorationDate: number;
  /** True when the change charges now (the part-period difference). */
  isUpgrade: boolean;
  /**
   * When the PLAN changes (Codex-2hxff.16): `now`, or `period_end` for a
   * move to a cheaper plan, which keeps the current plan, and charges
   * nothing, until the renewal. A change of billing that waits says so in
   * `billingChange`.
   */
  takesEffect: 'now' | 'period_end';
  /**
   * When the new price is first billed — used in "then £X starting …" copy.
   * The current period's end, except for a switch of billing period, which
   * Stripe starts afresh today, so its next bill is one new period away.
   */
  currentPeriodEnd: Date;
  /**
   * Set for a switch into yearly billing only: what the dialog shows, which
   * the page passes back to `changeTier()` to be re-checked before the write
   * (`tierChangeQuote`, Codex-2hxff.96).
   */
  quote?: string;
  /**
   * The part that waits for the end of the paid year when leaving yearly
   * billing (Codex-2hxff.97; states A, B and C(b)), or null. `amountCents` is
   * the monthly bill from `effectiveAt` (ISO), the renewal. For A and B the
   * plan waits with it (`takesEffect: 'period_end'`, nothing due today); for
   * C(b) the plan changes now on yearly billing (`takesEffect: 'now'`, the
   * upgrade's figures above) and only the billing waits.
   */
  billingChange: null | {
    interval: 'month';
    amountCents: number;
    effectiveAt: string;
  };
  /**
   * The waiting change this one replaces (latest wins), or null: for "then
   * £5 a month instead of £50 a year" (state D). `interval` and
   * `amountCents` are what the waiting change would bill.
   */
  replaces: null | {
    tierId: string;
    tierName: string;
    interval: 'month' | 'year';
    amountCents: number;
  };
}

/**
 * Extended configuration for `SubscriptionService`.
 *
 * Adds optional `cache` + `waitUntil` injection so every public mutation
 * method can internally call the shared `invalidateForUser` helper without
 * route/webhook layers having to remember to do it themselves.
 *
 * When both are provided, mutations fire-and-forget a bump of the two
 * per-user KV version keys (library + per-org subscription) on success.
 * When either is absent, invalidation is a silent no-op — the service still
 * works for callers (narrow unit tests, legacy harnesses) that don't need
 * cache bumps. This mirrors the `revocation?: AccessRevocation` pattern on
 * `ContentAccessService` in `@codex/access`.
 */
interface SubscriptionServiceConfig extends ServiceConfig {
  /**
   * Optional versioned cache used to bump `COLLECTION_USER_LIBRARY` and
   * `COLLECTION_USER_SUBSCRIPTION` version keys after successful mutations.
   * Must be paired with `waitUntil`; providing only one is a wiring bug —
   * the service gracefully degrades to no-op in that case rather than
   * blocking on an unscheduled promise.
   */
  cache?: VersionedCache;
  /**
   * Optional `ExecutionContext.waitUntil` (or equivalent) used to schedule
   * fire-and-forget KV writes after the response is returned.
   */
  waitUntil?: WaitUntilFn;
  /**
   * Sends the 30-day price-change notice for the hourly price-moves step
   * (`runPriceMoves`, tiers and course plans alike) and reports whether
   * notifications-api accepted it. The registry wires
   * `sendEmailToWorkerAwaited(env, params)`. A subscriber moves only after
   * their notice is accepted (D-P3, Codex-2hxff.43). Required, like every
   * money dependency (Codex-2hxff.55); a test uses `createTestMoneyDeps()`.
   */
  mailer: PriceChangeNoticeMailer;
  /**
   * Optional base URL used to construct the subscription management link
   * embedded in the price-change notice. Webhook handlers already accept
   * a `webAppUrl` argument per method — surfacing it on config here is
   * cleaner for the hourly price-moves step, which has no request. When
   * absent, the template falls back to a relative `/account/subscriptions`
   * path so the email still renders; operator review can fix the absolute
   * URL without needing to re-send.
   */
  webAppUrl?: string;
  /**
   * DB-configurable fee resolver (Codex-m644n). Required (Codex-2hxff.55,
   * docs/payments/architecture.md rule A4): there is no constant fallback.
   *
   * The subscription invoice flows resolve platform/org fees via
   * `feeConfig.getFeesForOrg(orgId, 'subscription')`. The per-creator fan-out
   * inside `executeTransfers` additionally consults
   * `getFeesForCreator(orgId, creatorId, 'subscription')` so two creators in
   * the same invoice can receive different splits when one has a negotiated
   * override.
   */
  feeConfig: FeeResolver;
  /**
   * Mailer thunk used by `resolvePendingPayouts` (WP-10 — Codex-69t7c.10) to
   * fire a `payout-released` notification after pending payouts transition to
   * paid. The service stays unaware of Bindings / ExecutionContext. Required
   * (Codex-2hxff.55); a failed send never fails the payout.
   */
  payoutMailer: PayoutReleasedMailer;
}

/**
 * Fire-and-forget email dispatch used by the payout-released notification
 * (WP-10 — Codex-69t7c.10). Fires after pending payouts transition to paid
 * in `resolvePendingPayouts`. Matches `SendEmailToWorkerParams` so the
 * registry wires `sendEmailToWorker(env, ctx, params)`; the service stays
 * unaware of Bindings / ExecutionContext.
 */
export type PayoutReleasedMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'payout-released';
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

export class SubscriptionService extends BaseService {
  private readonly stripe: Stripe;
  private readonly cache: VersionedCache | undefined;
  private readonly waitUntil: WaitUntilFn | undefined;
  private readonly mailer: PriceChangeNoticeMailer;
  private readonly payoutMailer: PayoutReleasedMailer;
  private readonly webAppUrl: string | undefined;
  private readonly feeConfig: FeeResolver;
  private readonly checkoutReservations: CheckoutReservations;

  constructor(config: SubscriptionServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.cache = config.cache;
    this.waitUntil = config.waitUntil;
    this.mailer = config.mailer;
    this.payoutMailer = config.payoutMailer;
    this.webAppUrl = config.webAppUrl;
    this.feeConfig = config.feeConfig;
    this.checkoutReservations = new CheckoutReservations(
      this.db,
      stripe,
      this.obs
    );
  }

  /**
   * Resolve fee config for a payout (Codex-m644n, Codex-5794i).
   *
   * `ctx` selects the policy: `'subscription'` carries SUBSCRIPTION_ORG_PERCENT
   * (15%), `'one_off'` carries ORG_PERCENT (10%).
   *
   * Used by:
   * - subscription invoice path (per-org + per-creator) with `'subscription'`
   * - resolvePendingPayouts retry — `'one_off'` for purchase-sourced rows,
   *   `'subscription'` for sub-sourced rows. Without this branch a low
   *   purchase payout could pile up indefinitely behind the subscription
   *   min-transfer floor.
   *
   * `at` is the sale's own time (Codex-2hxff.33, data design §1.4): an
   * invoice's split resolves the fee in force at `invoice.created`, so a
   * fee change dated between the invoice and its webhook never re-prices it.
   * Absent: now.
   */
  private async resolvePayoutFees(
    orgId: string | null,
    ctx: FeeContext,
    creatorId?: string,
    at?: Date
  ): Promise<FeeConfig> {
    // Codex-69t7c WP5: orgless rows have no org to resolve per-creator or
    // per-org overrides against — use the platform-level fee policy, which
    // owns the same `minTransferCents` floor the org/creator configs carry.
    if (orgId === null) {
      return this.feeConfig.getFeesPlatform(ctx, at);
    }
    return creatorId
      ? this.feeConfig.getFeesForCreator(orgId, creatorId, ctx, at)
      : this.feeConfig.getFeesForOrg(orgId, ctx, at);
  }

  /**
   * Compute a final revenue split for the subscription path: resolves
   * DB-configurable fees by orgId, runs the pure split math, then applies
   * the min-platform-fee floor (Codex-m644n).
   *
   * Used by invoice creation, recurring invoice updates, and tier-change
   * proration — all of which need an identical (split, fees) pair that
   * satisfies the `amount = platform + org + creator` CHECK constraint.
   * An invoice's split passes the invoice's own time as `at`.
   */
  private async computeSubscriptionSplit(
    orgId: string,
    amountCents: number,
    at?: Date
  ): Promise<{
    platformFeeCents: number;
    organizationFeeCents: number;
    creatorPayoutCents: number;
  }> {
    const orgFees = await this.resolvePayoutFees(
      orgId,
      'subscription',
      undefined,
      at
    );
    const rawSplit = calculateRevenueSplit(
      amountCents,
      orgFees.platformFeePercent,
      orgFees.orgFeePercent
    );
    return applyMinPlatformFeeFloor(
      amountCents,
      rawSplit,
      orgFees.minPlatformFeeCents
    );
  }

  /**
   * Internal orchestrator hook.
   *
   * Called at the end of every public mutation method (cancel, changeTier,
   * reactivate) and the side-effecting webhook handlers (created, updated,
   * deleted, payment_succeeded, payment_failed) to bump per-user KV version
   * keys. Routes/webhooks no longer need to call `invalidateForUser`
   * directly — the service owns invalidation so it can never be forgotten.
   *
   * Graceful degrade:
   *   - No-op when `cache` or `waitUntil` weren't injected (e.g. unit tests
   *     that construct the service without the orchestrator wiring). The
   *     mutation still succeeds; only the cache bump is skipped.
   *   - No-op when `userId` is missing. Webhook handlers legitimately
   *     return results with no user context (e.g. malformed event) — we
   *     don't want to fail the whole handler for a missing id.
   *   - Fire-and-forget: `invalidateForUser` schedules both bumps on
   *     `waitUntil` with `.catch` guards, so a KV outage can never surface
   *     out of this method.
   *
   * Must only be called after a successful mutation — on failure, the
   * caller throws and this method is never reached. See the orchestrator
   * test (`subscription-service-orchestrator.test.ts`) for the
   * ordering + failure-path contracts.
   */
  private invalidateIfConfigured(
    userId: string | undefined,
    orgId: string | undefined,
    reason: InvalidationReason
  ): void {
    if (!this.cache || !this.waitUntil) return;
    if (!userId) return;
    try {
      invalidateForUser(
        this.cache,
        this.waitUntil,
        { userId, orgId, reason },
        { logger: this.obs }
      );
    } catch (error) {
      // Defensive: `invalidateForUser` validates userId and throws
      // `ValidationError` on an empty string. We've already guarded above,
      // but keeping this catch means a future helper change (or an
      // unexpected mock harness behaviour) can never crash the mutation.
      this.obs.warn(
        'SubscriptionService.invalidateIfConfigured: invalidateForUser threw synchronously',
        {
          reason,
          userId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
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

      // Validate Connect account — the current owner's, the account every
      // tier op and revenue transfer for this org routes to (Codex-2hxff.2).
      const connectAccount = (await resolveOrganisationPayee(this.db, orgId))
        ?.account;

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

      // Q4 (Codex-pkqxd / Codex-ssfes): resolve the Codex user's unified
      // Stripe Customer id so every checkout across every org routes to the
      // SAME `cus_...` object. Previously BUG-022 claimed `customer_email`
      // caused Stripe to reuse an existing Customer — that is NOT how Stripe
      // behaves: `customer_email` creates a fresh Customer per session.
      // Codex now explicitly reuses via resolveOrCreateCustomer, which
      // reads users.stripe_customer_id, falls back to an email match
      // against Stripe, then creates with a deterministic idempotency key
      // and persists the id for every future session.
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

      // One open checkout per buyer and org, as for purchases (Codex-2hxff.15,
      // owner decision "Block early"): a second tab gets the first tab's
      // Stripe page back; another tier or interval replaces it. A payment
      // that slips past this anyway is a duplicate, cancelled and refunded
      // when it completes.
      const reserved = await this.checkoutReservations.reserve({
        kind: CHECKOUT_SESSION_KIND.SUBSCRIPTION,
        customerId: userId,
        organizationId: orgId,
        stripePriceId,
        amountCents:
          billingInterval === BILLING_INTERVAL.MONTH
            ? tier.priceMonthly
            : tier.priceAnnual,
      });
      if (reserved.url && reserved.stripeSessionId) {
        return {
          sessionUrl: reserved.url,
          sessionId: reserved.stripeSessionId,
        };
      }

      // `withStaleCustomerRecovery` resolves the unified Stripe Customer id
      // and self-heals when `users.stripe_customer_id` is stale. Two
      // real-world causes for the stale state:
      //   1. Operator deleted the customer in the Stripe dashboard.
      //   2. (Dev only) A seed wrote a synthetic id that never existed.
      // The helper clears the cache, mints a fresh customer, and retries the
      // session create exactly once. A second `resource_missing` propagates.
      const session = await this.checkoutReservations.create(reserved, () =>
        withStaleCustomerRecovery(
          { db: this.db, stripe: this.stripe, obs: this.obs },
          { userId, email: user.email, environment: this.environment },
          (stripeCustomerId) =>
            this.stripe.checkout.sessions.create(
              {
                mode: 'subscription',
                customer: stripeCustomerId,
                line_items: [{ price: stripePriceId, quantity: 1 }],
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                  codex_user_id: userId,
                  codex_organization_id: orgId,
                  codex_tier_id: tierId,
                  codex_billing_interval: billingInterval,
                  ...stripeEnvMetadata(this.environment),
                },
                // Every invoice snapshots these into
                // parent.subscription_details.metadata — the tag the webhook
                // guard reads on renewals (Codex-2hxff.5).
                subscription_data: {
                  metadata: {
                    codex_user_id: userId,
                    codex_organization_id: orgId,
                    codex_tier_id: tierId,
                    ...stripeEnvMetadata(this.environment),
                  },
                },
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
                { ...info, orgId, tierId, billingInterval }
              ),
          }
        )
      );

      this.obs.info('Subscription checkout session created', {
        sessionId: session.sessionId,
        organizationId: orgId,
        tierId,
        billingInterval,
      });

      return session;
    } catch (error) {
      this.handleError(error, 'createCheckoutSession');
    }
  }

  /**
   * The webhook: this subscription checkout was paid (Codex-2hxff.15). The
   * buyer's next checkout for the org is refused because they subscribe, so
   * this is a record, not a gate: a failure is logged and swallowed, never
   * failing the event (a redelivery would resend the welcome email).
   */
  async markCheckoutSessionCompleted(stripeSessionId: string): Promise<void> {
    try {
      await this.checkoutReservations.markCompleted(stripeSessionId);
    } catch (error) {
      this.obs.error(
        'Paid subscription checkout could not be marked completed',
        {
          errorId: crypto.randomUUID(),
          stripeSessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  // ─── Verification ──────────────────────────────────────────────────────────

  /**
   * Verify a Stripe subscription-mode checkout session.
   *
   * Retrieves the session from Stripe and, if complete, looks up the
   * subscription row we've recorded for it. Used by the /subscription/success
   * landing page to gate the "Go to Library" hand-off on the webhook having
   * landed — otherwise the user can arrive at /library before
   * `checkout.session.completed` has fired and see nothing.
   *
   * Mirrors `PurchaseService.verifyCheckoutSession`:
   * - `session.status` → 'open' | 'complete' | 'expired'
   * - Ownership enforced via `metadata.codex_user_id`
   * - Returns a `subscription` object only when the row actually exists in
   *   our DB (caller treats its absence as "still processing" and retries)
   * - A duplicate's `subscription` carries `duplicateOf`, the subscription
   *   the user keeps (Codex-o4jvw)
   */
  async verifyCheckoutSession(
    sessionId: string,
    userId: string
  ): Promise<SubscriptionCheckoutVerifyResult> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      // Session metadata ownership check. Our checkout route writes
      // codex_user_id into metadata at session creation (see
      // createCheckoutSession() above) — that's our authoritative source.
      if (session.metadata?.codex_user_id !== userId) {
        throw new ForbiddenError(
          'Checkout session does not belong to authenticated user',
          { sessionId }
        );
      }

      const result: SubscriptionCheckoutVerifyResult = {
        sessionStatus:
          (session.status as 'complete' | 'expired' | 'open') ?? 'open',
      };

      if (result.sessionStatus !== 'complete') return result;

      const stripeSubId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

      if (!stripeSubId) return result;

      // The subscription row is created by handleSubscriptionCreated() in
      // response to the webhook. Callers poll this endpoint until the row
      // appears, so an absent row here is expected, not an error.
      const row = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.stripeSubscriptionId, stripeSubId),
          eq(subscriptions.userId, userId)
        ),
        with: {
          tier: { columns: { name: true } },
          organization: { columns: { name: true, slug: true } },
        },
      });

      if (row) {
        result.subscription = {
          id: row.id,
          organizationId: row.organizationId,
          tierId: row.tierId,
          tierName: row.tier.name,
          organizationName: row.organization.name,
          organizationSlug: row.organization.slug,
          startedAt: row.createdAt.toISOString(),
        };
        // A duplicate (isDuplicateSubscription) names the subscription the
        // user keeps; the page shows that one's tier.
        if (row.duplicateOfSubscriptionId) {
          result.subscription.duplicateOf = await this.keptSubscriptionOf(
            row.duplicateOfSubscriptionId,
            userId
          );
        }
      }

      return result;
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;

      if (
        error instanceof Error &&
        'type' in error &&
        (error as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        // A stale or made-up session_id: the client's mistake, so a warning.
        // The context goes to the client, so it carries the errorId and
        // Stripe's message is logged instead (Codex-2hxff.23, SEC-02).
        const errorId = crypto.randomUUID();
        this.obs.warn('Stripe refused the checkout session lookup', {
          errorId,
          sessionId,
          code: stripeErrorCode(error),
          error: error.message,
        });
        throw new SubscriptionCheckoutError('Checkout session not found', {
          sessionId,
          errorId,
        });
      }

      // A connection or API failure: handleError logs it at error.
      this.handleError(error, 'verifyCheckoutSession');
    }
  }

  /**
   * The subscription a duplicate repeats, which the user keeps. The column is
   * a foreign key, so a missing row is a broken invariant, not "not found".
   */
  private async keptSubscriptionOf(
    keptSubscriptionId: string,
    userId: string
  ): Promise<{ id: string; tierId: string; tierName: string }> {
    const kept = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, keptSubscriptionId),
        eq(subscriptions.userId, userId)
      ),
      columns: { id: true, tierId: true },
      with: { tier: { columns: { name: true } } },
    });
    if (!kept) {
      throw new InternalServiceError('Kept subscription missing', {
        subscriptionId: keptSubscriptionId,
      });
    }
    return { id: kept.id, tierId: kept.tierId, tierName: kept.tier.name };
  }

  // ─── Webhook Handlers ──────────────────────────────────────────────────────

  /**
   * Ensure subscription, follower, and membership rows exist for the given
   * Stripe subscription. Idempotent — safe to call from both the create-event
   * handler and the self-heal path in invoice handlers.
   *
   * Stripe does not guarantee webhook delivery order (Codex-t7psp): on a
   * fresh subscription, `invoice.payment_succeeded` can arrive BEFORE
   * `customer.subscription.created`. Without self-heal the invoice handler
   * would log "Invoice for unknown subscription" and drop the first payout.
   *
   * If the row is missing, retrieves the subscription from Stripe and
   * inserts subscription + follower + membership in one transaction, under
   * the per-user, per-org lock (`lockForSubscriber`), so concurrent
   * self-heal + create-event delivery yields one row.
   *
   * A second subscription to an org the user already holds a live one for
   * is inserted as its duplicate (Codex-2hxff.15, "Keep the first"):
   * `cancelled`, `duplicateOfSubscriptionId` set, no follower or membership.
   * The caller settles it (`settleDuplicate`) and returns an inert result.
   *
   * Does NOT fire side effects (welcome email, cache invalidation) — those
   * remain the create-event handler's responsibility so they run once per
   * Stripe delivery of `customer.subscription.created`, regardless of
   * whether the row was pre-inserted by self-heal.
   *
   * Returns:
   * - `{ subscription, justInserted: true }`  — we inserted the row in this call.
   * - `{ subscription, justInserted: false }` — row already existed (raced or earlier event).
   * - `null` — permanent failure (Stripe 404, missing metadata). Caller exits cleanly.
   *
   * Bubbles transient errors (Stripe 5xx, DB connection) so the procedure
   * layer returns 5xx and Stripe retries.
   */
  private async ensureSubscriptionDataPresent(
    stripeSubId: string,
    context: {
      invoiceId?: string;
      eventType: string;
      /** Pre-loaded Stripe subscription, avoids a second retrieve on the create path. */
      knownStripeSub?: Stripe.Subscription;
    }
  ): Promise<{ subscription: Subscription; justInserted: boolean } | null> {
    // Fast path: row already exists. No Stripe call, no insert.
    const [existing] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);
    if (existing) {
      return { subscription: existing, justInserted: false };
    }

    // Slow path: row missing. Retrieve from Stripe unless caller already has it.
    let stripeSub: Stripe.Subscription;
    if (context.knownStripeSub) {
      stripeSub = context.knownStripeSub;
    } else {
      try {
        stripeSub = await this.stripe.subscriptions.retrieve(stripeSubId);
      } catch (error) {
        if (
          error instanceof Error &&
          'type' in error &&
          (error as { type?: string }).type === 'StripeInvalidRequestError'
        ) {
          this.obs.warn(
            'Subscription self-heal failed: Stripe returned not-found',
            {
              stripeSubscriptionId: stripeSubId,
              invoiceId: context.invoiceId,
              eventType: context.eventType,
            }
          );
          return null;
        }
        throw error;
      }
    }

    // Defensive `?? {}` — handles minimal Stripe mocks in test harnesses
    // that omit the metadata field. Production payloads always have it.
    const metadata = stripeSub.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;
    const tierId = metadata.codex_tier_id;

    if (!userId || !orgId || !tierId) {
      this.obs.warn('Subscription webhook missing metadata', {
        stripeSubscriptionId: stripeSubId,
        metadata,
      });
      return null;
    }

    // The row's amount is the price billed each period, not what one invoice
    // took: an upgrade's proration invoice is a one-off (Codex-2hxff.15,
    // SUB-11). A price without a unit amount falls back to the latest invoice.
    const item = stripeSub.items.data[0];
    const amountCents =
      item?.price?.unit_amount ??
      (await this.latestInvoiceAmountPaid(stripeSub));
    const billingInterval =
      item?.price?.recurring?.interval === 'year'
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;
    const periodStart = item?.current_period_start ?? 0;
    const periodEnd = item?.current_period_end ?? 0;
    // Stripe's `canceled` is final: one first seen ended is a tombstone, and
    // grants nothing (no follower, no membership).
    const ended = endedAtStripeStatus(stripeSub.status);

    const split = await this.computeSubscriptionSplit(orgId, amountCents);

    let outcome: { subscription: Subscription; justInserted: boolean };
    try {
      outcome = await (
        this.db as typeof import('@codex/database').dbWs
      ).transaction(async (tx) => {
        const { replay, liveId } = await this.lockForSubscriber(tx, {
          userId,
          orgId,
          stripeSubId,
        });
        if (replay) return { subscription: replay, justInserted: false };

        // The membership comes FIRST, before any row that names the user
        // takes a KEY SHARE on it through its foreign key: the lock order
        // every path keeps (packages/organization/CLAUDE.md, Lock order). An
        // account deletion locks the user's memberships, then the user row;
        // a webhook holding that KEY SHARE while waiting on the membership
        // deadlocked with it (Codex-kk9nv.20). A duplicate or an ended
        // subscription grants nothing, so it writes no membership.
        if (!liveId && !ended) {
          await this.upsertSubscriberMembership(tx, orgId, userId);
        }

        const [row] = await tx
          .insert(subscriptions)
          .values({
            userId,
            organizationId: orgId,
            tierId,
            stripeSubscriptionId: stripeSubId,
            stripeCustomerId:
              typeof stripeSub.customer === 'string'
                ? stripeSub.customer
                : stripeSub.customer.id,
            // Stripe's own status, not a blanket ACTIVE: a FIRST invoice that
            // failed (invoice.payment_failed before .created) leaves the
            // subscription `incomplete`, which must not grant access. A
            // duplicate is `cancelled`, outside the one-live-per-user index.
            status: liveId
              ? SUBSCRIPTION_STATUS.CANCELLED
              : resolveStatus(
                  stripeSub.status,
                  stripeSub.cancel_at_period_end ?? false,
                  SUBSCRIPTION_STATUS.ACTIVE
                ),
            duplicateOfSubscriptionId: liveId ?? null,
            endedAt: ended ? new Date() : null,
            billingInterval,
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
            amountCents,
            platformFeeCents: split.platformFeeCents,
            organizationFeeCents: split.organizationFeeCents,
            creatorPayoutCents: split.creatorPayoutCents,
          })
          .returning();
        if (!row) {
          throw new InternalServiceError(
            'ensureSubscriptionDataPresent: insert returned no row',
            { stripeSubscriptionId: stripeSubId }
          );
        }
        if (liveId || ended) return { subscription: row, justInserted: true };

        // Auto-follow: subscribers implicitly follow the org. Follower
        // persists after cancellation; user must explicitly unfollow.
        await tx
          .insert(organizationFollowers)
          .values({ organizationId: orgId, userId })
          .onConflictDoNothing();

        return { subscription: row, justInserted: true };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A row written outside the lock raced us. Re-select and return
        // justInserted=false so caller skips the "just inserted" log line —
        // the row is now present either way.
        const [raced] = await this.db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
          .limit(1);
        if (raced) {
          return { subscription: raced, justInserted: false };
        }
        // The one-live-per-user index, by a live row written outside the
        // lock. Retryable rather than a quiet 200: the retry runs under the
        // lock and records this one as its duplicate (review T6).
        this.obs.error('Subscription insert hit the one-live index', {
          errorId: crypto.randomUUID(),
          stripeSubscriptionId: stripeSubId,
          organizationId: orgId,
          eventType: context.eventType,
        });
        throw new ServiceUnavailableError(
          'Subscription could not be recorded; it will be retried',
          { stripeSubscriptionId: stripeSubId }
        );
      }
      throw error;
    }
    if (!outcome.justInserted) return outcome;
    const inserted = outcome.subscription;

    if (isDuplicateSubscription(inserted)) {
      this.obs.warn('Second subscription to an org recorded as a duplicate', {
        subscriptionId: inserted.id,
        duplicateOfSubscriptionId: inserted.duplicateOfSubscriptionId,
        stripeSubscriptionId: stripeSubId,
        organizationId: orgId,
        eventType: context.eventType,
      });
    } else if (context.knownStripeSub) {
      this.obs.info('Subscription created from webhook', {
        stripeSubscriptionId: stripeSubId,
        organizationId: orgId,
        tierId,
        amountCents,
      });
    } else {
      // Self-heal path: the invoice handler (or similar) pre-inserted the row
      // before the create event arrived. Distinct log line so it's
      // greppable in production.
      this.obs.info('Subscription self-healed from Stripe API', {
        stripeSubscriptionId: stripeSubId,
        organizationId: orgId,
        tierId,
        invoiceId: context.invoiceId,
        eventType: context.eventType,
      });
    }

    return { subscription: inserted, justInserted: true };
  }

  /**
   * Take the per-user, per-org advisory lock, then look again (as
   * `PurchaseService.lockForItem`). It serialises the first events of two
   * subscriptions to one org landing at once, so exactly one becomes the
   * live one; `uq_active_subscription_per_user_org` backs it.
   *
   * - `replay`: this Stripe subscription's own row, written by a concurrent
   *   event while this one waited for the lock.
   * - `liveId`: the user's live subscription to the org under another Stripe
   *   id, which this one duplicates.
   */
  private async lockForSubscriber(
    tx: Tx,
    target: { userId: string; orgId: string; stripeSubId: string }
  ): Promise<{ replay?: Subscription; liveId?: string }> {
    const { userId, orgId, stripeSubId } = target;
    await this.lockSubscriber(tx, userId, orgId);
    const [replay] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);
    if (replay) return { replay };
    const [live] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.organizationId, orgId),
          inArray(subscriptions.status, LIVE_STATUSES)
        )
      )
      .limit(1);
    return { liveId: live?.id };
  }

  /** The lock every write that can make a user's row for an org live takes. */
  private async lockSubscriber(
    tx: Tx,
    userId: string,
    orgId: string
  ): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${userId}:${orgId}`}))`
    );
  }

  /**
   * The subscriber's membership: role `subscriber`, unless an ACTIVE row
   * already holds a team role (owner/admin/creator/member), which is kept
   * (BUG-016). An invited `member` who subscribes stays a member, so the
   * subscription ending (which deactivates `subscriber` rows only) never
   * drops them from the team (Codex-2hxff.15, owner decision 2026-10-22). A
   * removed member's inactive row re-enters as a subscriber: re-activating a
   * removed owner would break uq_org_memberships_one_active_owner (aborting
   * this insert after the customer has paid) or, in an org with no active
   * owner, hand them ownership and its money (Codex-2hxff.2). Both column
   * refs read the EXISTING row; SET expressions never see each other.
   */
  private async upsertSubscriberMembership(
    tx: Tx,
    orgId: string,
    userId: string
  ): Promise<void> {
    await tx
      .insert(organizationMemberships)
      .values({
        organizationId: orgId,
        userId,
        role: 'subscriber',
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [
          organizationMemberships.organizationId,
          organizationMemberships.userId,
        ],
        set: {
          status: 'active',
          role: sql`CASE WHEN ${organizationMemberships.status} = 'active' AND ${organizationMemberships.role} IN ('owner', 'admin', 'creator', 'member') THEN ${organizationMemberships.role} ELSE 'subscriber' END`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Bring a row back to live under the per-user, per-org lock — unless the
   * user has subscribed again meanwhile and holds another live subscription
   * to the org (owner decision 7): then nothing is written, and that one's id
   * is returned for `retireRevived`. Under the lock, so a new subscription
   * landing at once cannot also become live.
   */
  private async writeRevival(
    row: Subscription,
    write: (tx: Tx) => Promise<unknown>
  ): Promise<string | undefined> {
    return (this.db as typeof import('@codex/database').dbWs).transaction(
      async (tx) => {
        await this.lockSubscriber(tx, row.userId, row.organizationId);
        const otherId = await this.otherLiveId(tx, row);
        if (otherId) return otherId;
        await write(tx);
        return undefined;
      }
    );
  }

  /** The user's live subscription to the row's org other than this row. */
  private async otherLiveId(
    db: Pick<Tx, 'select'>,
    row: Pick<Subscription, 'id' | 'userId' | 'organizationId'>
  ): Promise<string | undefined> {
    const [other] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, row.userId),
          eq(subscriptions.organizationId, row.organizationId),
          ne(subscriptions.id, row.id),
          inArray(subscriptions.status, LIVE_STATUSES)
        )
      )
      .limit(1);
    return other?.id;
  }

  /**
   * An old subscription Stripe brought back to life (its open invoice paid
   * after `unpaid`) while the user had subscribed again (Codex-2hxff.15, owner
   * decision 7: "Cancel old, refund it"). The newer one is kept. ONLY the
   * invoice that revived this one is refunded (earlier invoices bought real
   * access), and it is cancelled at Stripe at once.
   *
   * Stripe first, both calls idempotent, and the REFUND before the cancel: a
   * cancel that went through ahead of a refused refund would end it at
   * Stripe, so the retry would no longer see a revival and the refund would
   * be lost. A refund refused leaves Stripe as it was; a cancel refused
   * after a good refund repeats that refund under its key. Then the row
   * becomes a tombstone. Any Stripe failure leaves the row as it was and is
   * retryable. The reviving invoice pays no one; the refund's own
   * `charge.refunded` emails the buyer.
   */
  private async retireRevived(
    row: Subscription,
    keptSubscriptionId: string,
    reviving?: { invoiceId: string; chargeId: string },
    live?: Stripe.Subscription
  ): Promise<void> {
    const context = {
      subscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
      keptSubscriptionId,
    };
    let refunded: { invoiceId: string; chargeId: string } | undefined;
    try {
      const atStripe =
        live ??
        (await this.stripe.subscriptions.retrieve(row.stripeSubscriptionId));
      // On `updated` the reviving payment is the latest invoice, if paid.
      refunded = reviving ?? (await this.paidLatestInvoice(atStripe));
      if (refunded) {
        await issueRefund(this.stripe, {
          chargeId: refunded.chargeId,
          reason: 'requested_by_customer',
          idempotencyKey: `refund_revived_${refunded.invoiceId}`,
          environment: this.environment,
        });
      }
      if (!endedAtStripeStatus(atStripe.status)) {
        await this.stripe.subscriptions.cancel(
          row.stripeSubscriptionId,
          {
            prorate: false,
            cancellation_details: {
              comment: 'Revived next to a newer subscription to the same org',
            },
          },
          { idempotencyKey: `revived_cancel_${row.stripeSubscriptionId}` }
        );
      }
    } catch (error) {
      this.obs.error(
        'Revived old subscription could not be cancelled and refunded',
        {
          errorId: crypto.randomUUID(),
          ...context,
          code: stripeErrorCode(error),
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new ServiceUnavailableError(
        'Revived subscription refund failed; it will be retried',
        { subscriptionId: row.id }
      );
    }
    // Under the lock, so an invoice event re-reading the row before paying
    // out sees it ended.
    const at = new Date();
    await (this.db as typeof import('@codex/database').dbWs).transaction(
      async (tx) => {
        await this.lockSubscriber(tx, row.userId, row.organizationId);
        await tx
          .update(subscriptions)
          .set({
            status: SUBSCRIPTION_STATUS.CANCELLED,
            cancelledAt: sql`COALESCE(${subscriptions.cancelledAt}, ${at})`,
            endedAt: sql`COALESCE(${subscriptions.endedAt}, ${at})`,
            updatedAt: at,
          })
          .where(eq(subscriptions.id, row.id));
      }
    );
    this.obs.warn(
      'Old subscription revived next to a newer one: cancelled, its reviving payment refunded',
      { ...context, refundedInvoiceId: refunded?.invoiceId }
    );
  }

  /** The row as it stands now, read under the per-user, per-org lock. */
  private async rereadUnderLock(
    row: Subscription
  ): Promise<Subscription | undefined> {
    return (this.db as typeof import('@codex/database').dbWs).transaction(
      async (tx) => {
        await this.lockSubscriber(tx, row.userId, row.organizationId);
        const [current] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, row.id))
          .limit(1);
        return current;
      }
    );
  }

  /**
   * A duplicate's invoice paid after it was settled — a delayed method such
   * as Bacs Direct Debit clears days later, and subscription checkouts don't
   * restrict the methods — is refunded too: always THAT invoice, under the
   * key `cancelAndRefundDuplicate` uses for it, so it is never refunded
   * twice (review T4).
   */
  private async refundDuplicateInvoice(
    row: Subscription,
    invoiceId: string,
    chargeId: string
  ): Promise<void> {
    try {
      await issueRefund(this.stripe, {
        chargeId,
        reason: 'duplicate',
        idempotencyKey: `refund_duplicate_${invoiceId}`,
        environment: this.environment,
      });
    } catch (error) {
      this.obs.error('Duplicate subscription invoice could not be refunded', {
        errorId: crypto.randomUUID(),
        subscriptionId: row.id,
        stripeSubscriptionId: row.stripeSubscriptionId,
        invoiceId,
        code: stripeErrorCode(error),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableError(
        'Duplicate subscription refund failed; it will be retried',
        { subscriptionId: row.id }
      );
    }
  }

  /** Whether Stripe has handed the whole charge back. */
  private async refundedInFull(chargeId: string): Promise<boolean> {
    const charge = await this.stripe.charges.retrieve(chargeId);
    return (
      charge.refunded ||
      (charge.amount > 0 && charge.amount_refunded >= charge.amount)
    );
  }

  /** The id of the subscription's latest invoice, expanded or not. */
  private latestInvoiceId(stripeSub: Stripe.Subscription): string | undefined {
    const latest = stripeSub.latest_invoice;
    return typeof latest === 'string' ? latest : (latest?.id ?? undefined);
  }

  /** The subscription's latest invoice with its charge, when it is paid. */
  private async paidLatestInvoice(
    stripeSub: Stripe.Subscription
  ): Promise<{ invoiceId: string; chargeId: string } | undefined> {
    const latest = stripeSub.latest_invoice;
    const invoice =
      typeof latest === 'string'
        ? await this.stripe.invoices.retrieve(latest)
        : latest;
    if (!invoice?.id || invoice.status !== 'paid' || invoice.amount_paid <= 0) {
      return undefined;
    }
    const chargeId = await resolveInvoiceCharge(this.stripe, invoice);
    if (!chargeId) {
      throw new InternalServiceError(
        'A paid invoice that revived a subscription has no charge to refund',
        { invoiceId: invoice.id }
      );
    }
    return { invoiceId: invoice.id, chargeId };
  }

  /** Our row for a Stripe subscription, if we hold one. */
  private async findByStripeId(
    stripeSubId: string
  ): Promise<Subscription | undefined> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);
    return row;
  }

  /**
   * Whether a later event must leave this row alone (Codex-2hxff.15): a
   * duplicate, settled first if it is still owed, or a tombstone. The handler
   * then returns an inert result: no status change, and no userId, orgId or
   * email, so the webhook writes no streaming block, clears none and sends
   * nothing.
   */
  private async isInert(row: Subscription): Promise<boolean> {
    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      return true;
    }
    return row.endedAt != null;
  }

  /** What the subscription's latest invoice took, in pence; 0 without one. */
  private async latestInvoiceAmountPaid(
    stripeSub: Stripe.Subscription
  ): Promise<number> {
    const latestInvoice = stripeSub.latest_invoice;
    if (latestInvoice && typeof latestInvoice === 'object') {
      return latestInvoice.amount_paid;
    }
    if (typeof latestInvoice === 'string') {
      const invoice = await this.stripe.invoices.retrieve(latestInvoice);
      return invoice.amount_paid;
    }
    return 0;
  }

  /**
   * After the commit: a duplicate subscription is cancelled at Stripe and
   * every payment it took refunded in full, unless that is done already
   * (Codex-2hxff.15, "Keep the first"). Each refund's `charge.refunded` sends
   * the buyer the one email ("you were already subscribed").
   *
   * If Stripe refuses, the row stays unsettled: the buyer is owed the money,
   * held for support. The failure is logged with Stripe's code and thrown as
   * retryable, so Stripe redelivers the event through its retry window, as
   * `PurchaseService.refundDuplicatePayment` does.
   */
  private async settleDuplicate(row: Subscription): Promise<void> {
    if (row.duplicateSettledAt) return;
    let refundedInvoices: number;
    try {
      ({ refundedInvoices } = await cancelAndRefundDuplicate(this.stripe, {
        stripeSubscriptionId: row.stripeSubscriptionId,
        environment: this.environment,
      }));
    } catch (error) {
      this.obs.error(
        'Duplicate subscription could not be cancelled and refunded',
        {
          errorId: crypto.randomUUID(),
          subscriptionId: row.id,
          duplicateOfSubscriptionId: row.duplicateOfSubscriptionId,
          stripeSubscriptionId: row.stripeSubscriptionId,
          code: stripeErrorCode(error),
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new ServiceUnavailableError(
        'Duplicate subscription refund failed; it will be retried',
        { subscriptionId: row.id }
      );
    }
    await this.db
      .update(subscriptions)
      .set({ duplicateSettledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.id, row.id),
          isNull(subscriptions.duplicateSettledAt)
        )
      );
    this.obs.warn('Duplicate subscription cancelled and refunded', {
      subscriptionId: row.id,
      duplicateOfSubscriptionId: row.duplicateOfSubscriptionId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      refundedInvoices,
    });
  }

  /**
   * Handle customer.subscription.created.
   * Ensures the subscription row exists (idempotent — honours prior
   * self-heal pre-insert) and fires create-event side effects: welcome
   * email + library/badge cache invalidation.
   *
   * Side effects ALWAYS fire on this event, even when the row pre-existed
   * (Codex-t7psp regression prevention). The previous "swallow on unique
   * violation" was incompatible with the self-heal pattern because it
   * silently dropped the welcome email + cache bump when self-heal got
   * here first. Cost: a Stripe redelivery of the create event will send
   * the welcome email twice. Mitigated long-term by event-id dedupe
   * (Codex-257ia, Layer D).
   *
   * @param stripeSubscription The Stripe subscription object
   * @param webAppUrl The web app base URL for email links (optional)
   */
  async handleSubscriptionCreated(
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult | undefined> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata ?? {};
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

    const result = await this.ensureSubscriptionDataPresent(stripeSubId, {
      eventType: 'customer.subscription.created',
      knownStripeSub: stripeSubscription,
    });
    if (!result) return;

    // A duplicate, first delivery or replay, is cancelled and refunded, and
    // one ended at Stripe has nothing to welcome: no email, no cache bump.
    if (await this.isInert(result.subscription)) return {};

    if (!result.justInserted) {
      // Row was pre-inserted by an earlier self-heal or a prior delivery
      // attempt that 5xx'd after INSERT. Fire side effects anyway — the
      // duplicate-email risk on redelivery is a known trade-off.
      this.obs.info(
        'Subscription already recorded, firing create-event side effects',
        { stripeSubscriptionId: stripeSubId }
      );
    }

    // Compute the amount actually charged for the welcome-email payload.
    // Matches handleInvoicePaymentSucceeded — use amount_paid, not unit_amount,
    // so trials/coupons/prorations show the correct figure.
    const amountCents = await this.latestInvoiceAmountPaid(stripeSubscription);

    const email = await this.buildSubscriptionCreatedEmail(
      userId,
      tierId,
      stripeSubscription,
      amountCents,
      webAppUrl
    );

    // Orchestrator hook: bump per-user library + per-org subscription
    // version keys. Runs AFTER the row is guaranteed present.
    this.invalidateIfConfigured(userId, orgId, 'subscription_created');

    return { userId, orgId, email: email ?? undefined };
  }

  /**
   * Build the subscription-created email payload.
   * Looks up tier name and user email from DB.
   */
  private async buildSubscriptionCreatedEmail(
    userId: string,
    tierId: string,
    stripeSubscription: Stripe.Subscription,
    amountCents: number,
    webAppUrl?: string
  ): Promise<WebhookEmailPayload | null> {
    // Look up user email
    const [user] = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.email) return null;

    // Look up tier name
    let planName = 'Subscription';
    const [tier] = await this.db
      .select({ name: subscriptionTiers.name })
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.id, tierId))
      .limit(1);
    if (tier) planName = tier.name;

    const item = stripeSubscription.items.data[0];
    const priceAmount = item?.price?.unit_amount ?? amountCents;
    const interval = item?.price?.recurring?.interval ?? 'month';

    return {
      to: user.email,
      toName: user.name || undefined,
      templateName: 'subscription-created',
      category: 'transactional',
      data: {
        userName: user.name || 'there',
        planName,
        priceFormatted: `£${(priceAmount / 100).toFixed(2)}`,
        billingInterval: interval,
        nextBillingDate: stripeSubscription.billing_cycle_anchor
          ? new Date(
              stripeSubscription.billing_cycle_anchor * 1000
            ).toLocaleDateString('en-GB')
          : 'See account page',
        manageUrl: `${webAppUrl || ''}/account/subscriptions`,
      },
    };
  }

  /**
   * Handle invoice.payment_succeeded for subscription renewals.
   * Extends subscription period and creates revenue transfers.
   *
   * Returns a result object with:
   * - email payload for the subscription-renewed notification (only for renewal invoices)
   *
   * @param stripeInvoice The Stripe invoice object
   * @param webAppUrl The web app base URL for email links (optional)
   */
  async handleInvoicePaymentSucceeded(
    stripeInvoice: Stripe.Invoice,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult | undefined> {
    // Stripe v19+: subscription ID is in parent.subscription_details
    const subDetails = stripeInvoice.parent?.subscription_details;
    const stripeSubId =
      typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : (subDetails?.subscription?.id ?? null);
    if (!stripeSubId) return;

    // GBP-only enforcement (Codex-yv18n): reject a non-GBP invoice BEFORE
    // anything is written. executeTransfers and stripe.transfers.create() are
    // hardcoded to CURRENCY.GBP, so letting one through would mismatch the
    // source charge at Stripe; and checking it after the self-heal and the
    // period UPDATE (as this did until Codex-2hxff.6) left a rewritten row with
    // no transfer or ledger row to match. Cross-currency support is a tracked
    // future feature.
    assertGbpOnly(stripeInvoice.currency, {
      invoiceId: stripeInvoice.id,
      stripeSubscriptionId: stripeSubId,
    });

    // Customer credit paid some or all of this bill: its creator is paid on
    // what the card paid, nothing when the credit covered it all, so support
    // is told once per invoice (Codex-2hxff.97). Before the no-charge path
    // below and the duplicate check, so both are covered. It never throws,
    // and changes nothing here.
    await alertIfCreditPaid(
      { stripe: this.stripe, obs: this.obs },
      stripeInvoice,
      {
        stripeSubscriptionId: stripeSubId,
        subscriptionId: null,
        organizationId:
          stripeInvoice.parent?.subscription_details?.metadata
            ?.codex_organization_id ?? null,
        kind: 'tier',
      }
    );

    // Resolve the source charge for transfers. Webhook payloads in Stripe
    // 2024+ do NOT include expanded `payments.data` by default — the field
    // is only populated when explicitly expanded on retrieve. Without the
    // expand-fallback chain below, every real invoice.payment_succeeded
    // event silently skipped transfers (Codex-zdbhg).
    //
    // No charge (credit paid it all, alerted above, or Stripe names none):
    // nothing is paid out, as before. The renewal itself still stands, so
    // the row, the receipt and the cache bump go on, as a course
    // subscription's do (review C1, SF-12).
    const sourceTransaction = await resolveInvoiceCharge(
      this.stripe,
      stripeInvoice
    );
    if (!sourceTransaction) {
      this.obs.warn(
        'Invoice has no charge or payment intent: renewal recorded, no transfers',
        { invoiceId: stripeInvoice.id, stripeSubscriptionId: stripeSubId }
      );
    }

    // Self-heal: if the subscription row is missing, retrieve from Stripe
    // and insert it (Codex-t7psp). Stripe does not guarantee webhook
    // delivery order — invoice.payment_succeeded routinely arrives before
    // customer.subscription.created on fresh subs. Without self-heal the
    // first payout would be silently lost.
    const presence = await this.ensureSubscriptionDataPresent(stripeSubId, {
      eventType: 'invoice.payment_succeeded',
      invoiceId: stripeInvoice.id,
    });
    if (!presence) return;
    const { subscription: sub } = presence;

    // A duplicate pays no one and restores nothing: every payment it took is
    // refunded (Codex-2hxff.15) — this one too, though it cleared after the
    // duplicate was settled.
    if (isDuplicateSubscription(sub)) {
      // Without a charge there is nothing of this invoice's to refund, and
      // a duplicate renews nothing: left as it always was.
      if (!sourceTransaction) return;
      await this.settleDuplicate(sub);
      await this.refundDuplicateInvoice(
        sub,
        stripeInvoice.id,
        sourceTransaction
      );
      return {};
    }

    // Fetch the Stripe subscription for period dates (v19+: on items)
    const stripeSub = await this.stripe.subscriptions.retrieve(stripeSubId);
    const subItem = stripeSub.items.data[0];
    const periodStart = subItem?.current_period_start ?? 0;
    const periodEnd = subItem?.current_period_end ?? 0;

    // The invoice's one clock: the agreements, the org's owner and the fees
    // in force when it was created (Codex-rzfjw, Codex-2hxff.2, .33).
    const invoiceCreatedAt =
      typeof stripeInvoice.created === 'number'
        ? new Date(stripeInvoice.created * 1000)
        : new Date();

    // The charge's split feeds the transfers (DB-configurable fees,
    // Codex-m644n). The row keeps the price billed each period, not this
    // invoice's amount: an upgrade's proration invoice is a one-off
    // (Codex-2hxff.15, SUB-11).
    const amountCents = stripeInvoice.amount_paid;
    const split = await this.computeSubscriptionSplit(
      sub.organizationId,
      amountCents,
      invoiceCreatedAt
    );

    // The live subscription's status, not a blanket ACTIVE: a late or
    // replayed invoice never revives one Stripe has cancelled (a refund, a
    // lost dispute), and a renewal keeps `cancel_at_period_end`.
    const status = resolveStatus(
      stripeSub.status,
      stripeSub.cancel_at_period_end ?? false,
      SUBSCRIPTION_STATUS.ACTIVE
    );

    // An ended subscription is a tombstone: a late or replayed invoice
    // changes nothing on the row and restores no access. Its charge is real,
    // so it is still split below, unless it was refunded in full.
    if (!sub.endedAt) {
      const priceCents = subItem?.price?.unit_amount ?? sub.amountCents;
      const rowSplit =
        priceCents === amountCents
          ? split
          : await this.computeSubscriptionSplit(
              sub.organizationId,
              priceCents,
              invoiceCreatedAt
            );
      const values = {
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        status,
        amountCents: priceCents,
        platformFeeCents: rowSplit.platformFeeCents,
        organizationFeeCents: rowSplit.organizationFeeCents,
        creatorPayoutCents: rowSplit.creatorPayoutCents,
        updatedAt: new Date(),
      };
      if (revives(sub.status, status)) {
        const keptId = await this.writeRevival(sub, (tx) =>
          tx
            .update(subscriptions)
            .set(values)
            .where(eq(subscriptions.id, sub.id))
        );
        if (keptId) {
          // Revived next to a newer subscription (owner decision 7). Only the
          // invoice that revived it — its latest — is refunded, and pays no
          // one. An older invoice redelivered now is not refunded and pays
          // out as usual, while the revival is retired all the same.
          const reviving = this.latestInvoiceId(stripeSub) === stripeInvoice.id;
          await this.retireRevived(
            sub,
            keptId,
            reviving && sourceTransaction
              ? { invoiceId: stripeInvoice.id, chargeId: sourceTransaction }
              : undefined,
            stripeSub
          );
          if (reviving) return {};
        }
      } else {
        await this.db
          .update(subscriptions)
          .set(values)
          .where(
            and(eq(subscriptions.id, sub.id), isNull(subscriptions.endedAt))
          );
      }
    }

    // Before paying out, the row as it stands now, read under the lock: a
    // revival another event is retiring at once may have ended it. Ended, or
    // not live at Stripe, the charge is checked too, and one refunded in full
    // pays no one rather than paying out only to be reversed. Stripe is asked
    // because the refund may be that revival's, made a moment ago and not
    // recorded yet. Every other refund before the payout is clawed back once
    // the slices exist (reverseEarlierRefunds, below).
    const current = (await this.rereadUnderLock(sub)) ?? sub;
    const ended = current.endedAt != null;
    if (!sourceTransaction) {
      return ended
        ? {}
        : this.renewalResult(sub, stripeInvoice, subItem, webAppUrl);
    }
    if (
      (ended || !isLiveStatus(status)) &&
      (await this.refundedInFull(sourceTransaction))
    ) {
      this.obs.info('Invoice refunded in full before its payout; no payout', {
        subscriptionId: sub.id,
        invoiceId: stripeInvoice.id,
      });
      return {};
    }

    // Execute revenue transfers.
    //
    // Codex-rzfjw (WP-4): pin agreement-lookup at invoice fire time
    // (Decision Q3 — no pro-rating, active-as-of-invoice-date). Webhook
    // replays of the same invoice get the same active-set even if the
    // agreement state has since changed (e.g. a creator terminated after
    // the invoice fired but before the webhook landed). Fees likewise.
    await this.executeTransfers(
      sub.id,
      sub.organizationId,
      sourceTransaction,
      split.platformFeeCents,
      split.organizationFeeCents,
      split.creatorPayoutCents,
      invoiceCreatedAt
    );
    // A refund or chargeback handled before this invoice found no slices to
    // claw back (Codex-2hxff.67): it is clawed back now, as if it had come
    // after. A redelivery runs it too, so a delivery that died in between
    // catches up. Its failure is raised at the end, with the result
    // (`AfterCommitError`), so the renewal's side effects still happen.
    const finish = await reverseEarlierRefundsAfterCommit(
      { ...this.ledger(), obs: this.obs },
      { chargeId: sourceTransaction, source: { sourceType: 'subscription' } }
    );

    this.obs.info('Invoice payment processed', {
      subscriptionId: sub.id,
      invoiceId: stripeInvoice.id,
      amountCents,
    });

    // No renewal email and no access cleared for an ended subscription.
    if (ended) return finish({});

    return finish(this.renewalResult(sub, stripeInvoice, subItem, webAppUrl));
  }

  /**
   * What a paid invoice of a live subscription returns, with or without a
   * payout: the renewal email (recurring invoices only, not the first
   * payment) and the cache bump.
   */
  private renewalResult(
    sub: Subscription,
    stripeInvoice: Stripe.Invoice,
    subItem: Stripe.SubscriptionItem | undefined,
    webAppUrl?: string
  ): WebhookHandlerResult {
    let email: WebhookEmailPayload | undefined;
    if (
      stripeInvoice.billing_reason === 'subscription_cycle' &&
      stripeInvoice.customer_email
    ) {
      // Use subscription's current_period_end for next billing date
      let nextBillingDate = 'See account page';
      if (subItem?.current_period_end) {
        nextBillingDate = new Date(
          subItem.current_period_end * 1000
        ).toLocaleDateString('en-GB');
      }

      email = {
        to: stripeInvoice.customer_email,
        toName: stripeInvoice.customer_name || undefined,
        templateName: 'subscription-renewed',
        category: 'transactional',
        data: {
          userName: stripeInvoice.customer_name || 'there',
          planName: stripeInvoice.lines.data[0]?.description || 'Subscription',
          // The bill, not what the card paid: credit may have paid some or
          // all of it (review C1 cycle 2, L5). `amount_paid` stays the split's.
          priceFormatted: `£${((stripeInvoice.total ?? stripeInvoice.amount_paid ?? 0) / 100).toFixed(2)}`,
          billingDate: new Date().toLocaleDateString('en-GB'),
          nextBillingDate,
          manageUrl: `${webAppUrl || ''}/account/subscriptions`,
        },
      };
    }

    // Orchestrator hook: renewal restores/continues access → bump both
    // caches so the user's library + subscription badge reflect the
    // current period end promptly.
    this.invalidateIfConfigured(
      sub.userId,
      sub.organizationId,
      'payment_succeeded'
    );

    return { userId: sub.userId, orgId: sub.organizationId, email };
  }

  /**
   * Handle invoice.payment_failed — update subscription status to past_due.
   *
   * Extracts the subscription ID from the invoice, updates the local
   * subscription record, and returns an email payload for the payment-failed
   * notification.
   *
   * @param stripeInvoice The Stripe invoice object
   * @param webAppUrl The web app base URL for email links (optional)
   */
  async handleInvoicePaymentFailed(
    stripeInvoice: Stripe.Invoice,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult | undefined> {
    // Stripe v19+: subscription ID is in parent.subscription_details
    const subDetails = stripeInvoice.parent?.subscription_details;
    const stripeSubId =
      typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : (subDetails?.subscription?.id ?? null);

    // Self-heal: ensure the subscription row exists before flipping status.
    // Same ordering race as race #1 — invoice.payment_failed can arrive
    // before customer.subscription.created on first-bill failure.
    let userId: string | undefined;
    let orgId: string | undefined;
    if (stripeSubId) {
      const presence = await this.ensureSubscriptionDataPresent(stripeSubId, {
        eventType: 'invoice.payment_failed',
        invoiceId: stripeInvoice.id,
      });
      if (presence) {
        const { subscription: sub } = presence;
        // A duplicate is refunded, and an ended subscription has nothing left
        // to retry: neither is asked to update a card.
        if (await this.isInert(sub)) return {};
        userId = sub.userId;
        orgId = sub.organizationId;

        // past_due GRANTS access while Stripe retries (owner decision P-3),
        // so only a subscription that was paid up may move to it. A failed
        // FIRST payment stays `incomplete`, and a late event never revives a
        // cancelled or paused row.
        const [moved] = await this.db
          .update(subscriptions)
          .set({
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(subscriptions.id, sub.id),
              inArray(subscriptions.status, [
                SUBSCRIPTION_STATUS.ACTIVE,
                SUBSCRIPTION_STATUS.PAST_DUE,
              ])
            )
          )
          .returning();

        if (moved) {
          this.obs.info('Subscription status updated to past_due', {
            stripeSubscriptionId: stripeSubId,
          });
        } else {
          this.obs.info(
            'Payment failed on a subscription not paid up; status kept',
            {
              stripeSubscriptionId: stripeSubId,
              status: sub.status,
            }
          );
        }
      }
    }

    // Build payment-failed email. Not after Stripe's LAST retry, which has no
    // next attempt to name (owner Q5, 2026-10-30): Stripe then ends the
    // subscription and the cancellation email follows.
    let email: WebhookEmailPayload | undefined;
    const nextAttempt = stripeInvoice.next_payment_attempt;
    if (!nextAttempt) {
      this.obs.info(
        'Payment failed with no retry left: no payment-failed email',
        {
          invoiceId: stripeInvoice.id,
          stripeSubscriptionId: stripeSubId,
        }
      );
    } else if (stripeInvoice.customer_email) {
      email = {
        to: stripeInvoice.customer_email,
        toName: stripeInvoice.customer_name || undefined,
        templateName: 'payment-failed',
        category: 'transactional',
        data: {
          userName: stripeInvoice.customer_name || 'there',
          planName: stripeInvoice.lines.data[0]?.description || 'Subscription',
          priceFormatted: `£${((stripeInvoice.amount_due ?? 0) / 100).toFixed(2)}`,
          retryDate: new Date(nextAttempt * 1000).toLocaleDateString('en-GB'),
          updatePaymentUrl: `${webAppUrl || ''}/account/subscriptions`,
        },
      };
    }

    // Orchestrator hook: payment failure flips status to past_due → bump
    // both caches so the subscription badge + library access reflect it
    // across devices. Skipped when userId lookup failed (unknown invoice).
    this.invalidateIfConfigured(userId, orgId, 'payment_failed');

    return { userId, orgId, email };
  }

  /**
   * Handle customer.subscription.trial_will_end — Stripe fires this ~3 days
   * before the trial ends. Access is NOT changing: the user is still inside
   * the trial and remains entitled until Stripe flips them onto a paid
   * period (handled by `invoice.payment_succeeded`) or cancels them via
   * `customer.subscription.deleted`.
   *
   * Responsibilities:
   *   - DB: no status change. Schema has no `trialEndingAt` column today
   *     (tracking it is out of scope — see the Codex-lvxev follow-up bead
   *     for template creation).
   *   - Cache: NO invalidation — the user's library + subscription badge
   *     stay unchanged, so there is nothing for other devices to re-fetch.
   *     Deliberately does NOT call `invalidateIfConfigured`.
   *   - Revocation: NOT written — access continues.
   *   - Notification: returns a `trial-ending-soon` email payload; the
   *     handler dispatches it via `sendEmailToWorker`. Template may not
   *     exist yet — the notifications service logs a warning and skips
   *     the send in that case, which is acceptable for this iteration.
   *
   * Returns `{ userId, orgId, trialEndAt, email }` on success. Returns
   * `undefined` when metadata is missing — webhook handler treats this as
   * a no-op and still returns 200 to Stripe.
   */
  async handleTrialWillEnd(
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<(WebhookHandlerResult & { trialEndAt: Date }) | undefined> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;

    if (!userId || !orgId) {
      this.obs.warn('Subscription trial_will_end webhook missing metadata', {
        stripeSubscriptionId: stripeSubId,
        metadata,
      });
      return undefined;
    }

    // A duplicate or an ended subscription has no trial to end for anyone.
    const row = await this.findByStripeId(stripeSubId);
    if (row && (await this.isInert(row))) return undefined;

    // Stripe exposes the trial boundary as `trial_end` (unix seconds).
    // Fall back to `current_period_end` on the item when `trial_end` is
    // absent — some older test fixtures don't set it, but Stripe always
    // does for a real trial_will_end event.
    const trialEndUnix =
      typeof stripeSubscription.trial_end === 'number'
        ? stripeSubscription.trial_end
        : (stripeSubscription.items.data[0]?.current_period_end ?? 0);
    const trialEndAt = new Date(trialEndUnix * 1000);

    this.obs.info('Subscription trial ending soon', {
      stripeSubscriptionId: stripeSubId,
      userId,
      organizationId: orgId,
      trialEndAt: trialEndAt.toISOString(),
    });

    // Build notification email. Looks up tier + user so the email can be
    // personalised. Template `trial-ending-soon` may not exist yet — the
    // notifications service will log a warning on missing templates and
    // this handler still returns successfully.
    const email = await this.buildTrialEndingSoonEmail(
      userId,
      stripeSubscription,
      trialEndAt,
      webAppUrl
    );

    // NO cache invalidation — access is unchanged. This is a deliberate
    // product decision asserted by the orchestrator test.
    return { userId, orgId, trialEndAt, email: email ?? undefined };
  }

  /**
   * Build the trial-ending-soon email payload.
   * Looks up user email/name and tier name from DB. Returns `null` when the
   * user row is missing or has no email (e.g. test fixture gap) — the
   * handler skips dispatch in that case.
   */
  private async buildTrialEndingSoonEmail(
    userId: string,
    stripeSubscription: Stripe.Subscription,
    trialEndAt: Date,
    webAppUrl?: string
  ): Promise<WebhookEmailPayload | null> {
    const [user] = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.email) return null;

    let planName = 'Subscription';
    const tierId = stripeSubscription.metadata?.codex_tier_id;
    if (tierId) {
      const [tier] = await this.db
        .select({ name: subscriptionTiers.name })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.id, tierId))
        .limit(1);
      if (tier) planName = tier.name;
    }

    return {
      to: user.email,
      toName: user.name || undefined,
      templateName: 'trial-ending-soon',
      category: 'transactional',
      userId,
      data: {
        userName: user.name || 'there',
        planName,
        trialEndDate: trialEndAt.toLocaleDateString('en-GB'),
        manageUrl: `${webAppUrl || ''}/account/subscriptions`,
      },
    };
  }

  /**
   * Handle customer.subscription.updated — tier changes, status changes.
   *
   * Returns a `WebhookHandlerResult` carrying `{ userId, orgId }` so the
   * webhook route can bump COLLECTION_USER_LIBRARY and
   * COLLECTION_USER_SUBSCRIPTION. Returns `void` when the subscription
   * row isn't found locally (early stripe event before our record exists).
   *
   * An update reporting `canceled` moves the row to `cancelled`, so access
   * ends at once, but leaves the tombstone to `customer.subscription.deleted`
   * (Codex-2hxff.15, lead decision): that first end is what deactivates the
   * membership, writes the streaming block and sends the email, none of which
   * the webhook does for an update.
   *
   * A waiting move to a cheaper tier (Codex-2hxff.16) is mirrored with the
   * rest, from the payload's `codex_move_*` / `codex_hold_*` metadata.
   */
  async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription
  ): Promise<WebhookHandlerResult | undefined> {
    return this.syncFromStripe(stripeSubscription, 'subscription_updated', {
      fromEvent: true,
    });
  }

  /**
   * Mirror a Stripe subscription onto our row: the webhook's update, and the
   * waiting-move paths that re-read the live subscription (the flip, Keep).
   * `reason` tags the cache bump.
   *
   * An event's snapshot can be stale: one written before a waiting change
   * was made, delivered after (Codex-2hxff.97, data design §4.4). Mirrored
   * as it is, it would clear the row's change, and the notice and Keep would
   * vanish until the next event, while Stripe still makes the change. So an
   * event without a waiting change, onto a row that holds one, is decided on
   * the LIVE subscription instead: one Stripe call, only then.
   */
  private async syncFromStripe(
    snapshot: Stripe.Subscription,
    reason: InvalidationReason,
    options: { fromEvent?: boolean } = {}
  ): Promise<WebhookHandlerResult | undefined> {
    let stripeSubscription = snapshot;
    const stripeSubId = stripeSubscription.id;

    // Ordering race #3 (Codex-1hvda): customer.subscription.updated can arrive
    // BEFORE customer.subscription.created. The old code dropped the event
    // (`if (!sub) return`), so the tier/status change AND its cache invalidation
    // were silently lost until the next version bump — stale library/badge for
    // minutes. Self-heal instead: ensureSubscriptionDataPresent inserts the row
    // from the Stripe payload we already hold; the UPDATE below then applies the
    // new tier/status/period on top (a semantic upsert). Passing knownStripeSub
    // avoids a redundant Stripe retrieve.
    const presence = await this.ensureSubscriptionDataPresent(stripeSubId, {
      eventType: 'customer.subscription.updated',
      knownStripeSub: stripeSubscription,
    });
    // null = permanent failure (Stripe 404 / missing metadata). Exit cleanly
    // with 200 exactly as the previous drop branch did.
    if (!presence) return;
    const sub = presence.subscription;
    // A duplicate is refunded and an ended subscription stays ended: a stale
    // payload saying `active` brings neither back (Codex-2hxff.15).
    if (await this.isInert(sub)) return undefined;

    if (
      options.fromEvent &&
      sub.pendingTierId &&
      !readWaitingMove(snapshot.metadata)
    ) {
      stripeSubscription =
        await this.stripe.subscriptions.retrieve(stripeSubId);
    }

    // Shared mapper prevents field drift (V1/V2/V5 in the audit). Passing
    // `sub.status` as the fallback preserves DB state if Stripe reports a
    // status that doesn't map onto the Codex enum (e.g. 'trialing'). Cast
    // is safe: status is constrained at insert by subscriptionStatusSchema.
    const mapped = mapStripeSubscriptionStatus(
      stripeSubscription,
      sub.status as (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS]
    );
    const newTierId = mapped.tierId;

    if (await this.endedAtStripe(sub, mapped.status)) {
      this.obs.warn('Late subscription event ignored: cancelled at Stripe', {
        subscriptionId: sub.id,
        stripeSubscriptionId: stripeSubId,
        eventStatus: stripeSubscription.status,
      });
      return undefined;
    }

    // The price's amount, with the reporting split recomputed from it: the
    // row's CHECK requires amount = platform + org + creator (SUB-11).
    const amountChange =
      mapped.amountCents !== null && mapped.amountCents !== sub.amountCents
        ? {
            amountCents: mapped.amountCents,
            ...(await this.computeSubscriptionSplit(
              sub.organizationId,
              mapped.amountCents
            )),
          }
        : {};

    const values = {
      status: mapped.status,
      cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
      ...(newTierId && newTierId !== sub.tierId && { tierId: newTierId }),
      ...(mapped.billingInterval && {
        billingInterval: mapped.billingInterval,
      }),
      ...amountChange,
      ...(mapped.currentPeriodStart && {
        currentPeriodStart: mapped.currentPeriodStart,
      }),
      ...(mapped.currentPeriodEnd && {
        currentPeriodEnd: mapped.currentPeriodEnd,
      }),
      // The waiting move, all three or none (the row's CHECK), and a change
      // of billing beside it.
      pendingTierId: mapped.pendingTierId,
      pendingTierFrom: mapped.pendingTierFrom,
      heldAmountCents: mapped.heldAmountCents,
      pendingBillingInterval: mapped.pendingBillingInterval,
      pendingAmountCents: mapped.pendingAmountCents,
      stripeScheduleId: mapped.stripeScheduleId,
      updatedAt: new Date(),
    };
    if (revives(sub.status, mapped.status)) {
      const keptId = await this.writeRevival(sub, (tx) =>
        tx.update(subscriptions).set(values).where(eq(subscriptions.id, sub.id))
      );
      // Revived next to a newer subscription: retired, and inert here — the
      // webhook clears no streaming block (owner decision 7).
      if (keptId) {
        await this.retireRevived(sub, keptId);
        return undefined;
      }
    } else {
      await this.db
        .update(subscriptions)
        .set(values)
        .where(eq(subscriptions.id, sub.id));
    }

    this.obs.info('Subscription updated from webhook', {
      subscriptionId: sub.id,
      status: mapped.status,
      cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
    });
    await this.alertIfPriceOffTier(
      stripeSubscription,
      sub.id,
      newTierId ?? sub.tierId,
      // A landed change of billing whose flip is still to be written bills
      // its target's Price already (not mirrored as waiting, but not off-tier).
      mapped.pendingTierId ??
        readWaitingMove(stripeSubscription.metadata)?.tierId ??
        null
    );

    // Orchestrator hook: tier changes, status flips (active ↔ cancelling
    // ↔ past_due) all affect library visibility + subscription badge —
    // bump both per-user version keys.
    this.invalidateIfConfigured(sub.userId, sub.organizationId, reason);

    // The ids drive the webhook's streaming block (on `unpaid`) and clear,
    // which are per user and org: an OLD row's update must not block or
    // clear the user's live subscription (review T5).
    if (
      !isLiveStatus(mapped.status) &&
      (await this.otherLiveId(
        this.db as typeof import('@codex/database').dbWs,
        sub
      ))
    ) {
      return {};
    }
    return { userId: sub.userId, orgId: sub.organizationId };
  }

  /**
   * The backstop for a price written over a change of plan (review C1, F1):
   * every Price a tier bills is on that tier's Stripe Product, so an item
   * Price on neither the member's tier's Product nor their waiting tier's is
   * a wrong bill. An alert, ids only; nothing is written, and the sync above
   * has mirrored the amount as Stripe holds it. A payload without the
   * Product, or a tier without one, is not checked.
   */
  private async alertIfPriceOffTier(
    stripeSubscription: Stripe.Subscription,
    subscriptionId: string,
    tierId: string | null,
    waitingTierId: string | null
  ): Promise<void> {
    const price = stripeSubscription.items?.data?.[0]?.price;
    const product =
      typeof price?.product === 'string' ? price.product : price?.product?.id;
    const tierIds = [tierId, waitingTierId].filter(
      (id): id is string => id !== null
    );
    if (!price || !product || tierIds.length === 0) return;
    try {
      const tiers = await this.db
        .select({ stripeProductId: subscriptionTiers.stripeProductId })
        .from(subscriptionTiers)
        .where(inArray(subscriptionTiers.id, tierIds));
      const products = tiers.flatMap((t) =>
        t.stripeProductId ? [t.stripeProductId] : []
      );
      if (products.length === 0 || products.includes(product)) return;
      this.obs.error(
        "Subscription bills a Price from another tier's Product: a price move or plan change may have been written over (support: check the Stripe subscription)",
        {
          errorId: crypto.randomUUID(),
          subscriptionId,
          stripeSubscriptionId: stripeSubscription.id,
          tierId,
          waitingTierId,
          stripePriceId: price.id,
          stripeProductId: product,
        }
      );
    } catch (error) {
      this.obs.error('Off-tier price check failed; the sync stands', {
        errorId: crypto.randomUUID(),
        subscriptionId,
        error: describeThrown(error),
      });
    }
  }

  /**
   * Handle customer.subscription.deleted — subscription cancelled/expired.
   *
   * Final (Codex-2hxff.15, SUB-09): the row becomes a tombstone (`endedAt`)
   * that no later or replayed event changes. With no row yet, the tombstone
   * is written from the payload, so a stale `updated` (its payload still
   * `active`) or a late invoice cannot insert the subscription live; next to
   * another live subscription it is that one's duplicate, and refunded.
   *
   * Side effects follow the subscription, not the user: the `subscriber`
   * membership is deactivated, and the result carries userId + orgId (the
   * streaming block) and the cancellation email, only when this ends the
   * subscription for the first time and the user holds no other live one for
   * the org. A late deletion of an old subscription, a duplicate's, or a
   * redelivery returns an inert `{}`.
   *
   * @param stripeSubscription The Stripe subscription object
   * @param webAppUrl The web app base URL for email links (optional)
   */
  async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult> {
    const row =
      (await this.findByStripeId(stripeSubscription.id)) ??
      (await this.writeTombstone(stripeSubscription));
    if (!row) return {};

    if (isDuplicateSubscription(row)) {
      await this.settleDuplicate(row);
      const at = new Date();
      await this.db
        .update(subscriptions)
        .set({
          endedAt: sql`COALESCE(${subscriptions.endedAt}, ${at})`,
          updatedAt: at,
        })
        .where(eq(subscriptions.id, row.id));
      return {};
    }

    return this.endSubscription(row, stripeSubscription, webAppUrl);
  }

  /**
   * End a subscription Stripe has deleted: the row becomes a tombstone.
   *
   * Only the first end, and only while the user holds no other live
   * subscription to the org, deactivates the `subscriber` membership and
   * returns userId + orgId (the streaming block) and the cancellation email.
   * Otherwise `{}`.
   */
  private async endSubscription(
    row: Subscription,
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult> {
    const { userId, organizationId: orgId } = row;

    // Atomic: subscription end + membership demotion commit together.
    // A DB hiccup between these two writes previously left the
    // subscription cancelled but the user still listed as an active
    // `subscriber` role — inconsistent state the access layer can't
    // reason about.
    const endsAccess = await (
      this.db as typeof import('@codex/database').dbWs
    ).transaction(async (tx) => {
      const [ended] = await tx
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLED,
          cancelledAt: new Date(),
          endedAt: new Date(),
          // A waiting move survives a cancel only until the subscription
          // ends (Codex-2hxff.16, T4): it goes with the tombstone.
          ...NO_PENDING_MOVE,
          updatedAt: new Date(),
        })
        .where(and(eq(subscriptions.id, row.id), isNull(subscriptions.endedAt)))
        .returning({ id: subscriptions.id });
      // Ended already: a redelivery, or the refund path ended it first.
      if (!ended) return false;

      if (await this.otherLiveId(tx, row)) return false;

      // BUG-016: Deactivate membership only when the role is 'subscriber'
      // — preserves the team roles (owner/admin/creator/member).
      await tx
        .update(organizationMemberships)
        .set({
          status: 'inactive',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, orgId),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.role, 'subscriber')
          )
        );
      return true;
    });

    this.obs.info('Subscription ended at Stripe', {
      stripeSubscriptionId: row.stripeSubscriptionId,
      subscriptionId: row.id,
      endsAccess,
    });
    if (!endsAccess) return {};

    // Build cancellation email
    const email = await this.buildSubscriptionCancelledEmail(
      userId,
      stripeSubscription,
      webAppUrl
    );

    // Orchestrator hook: deletion is access-reducing — bump both caches
    // so other devices flip off library entries + subscription badge
    // within one visibility tick.
    this.invalidateIfConfigured(userId, orgId, 'subscription_deleted');

    return { userId, orgId, email: email ?? undefined };
  }

  /**
   * `customer.subscription.deleted` before we hold a row: write it as a
   * tombstone from the payload. Only for a subscription of ours, tagged with
   * this environment and carrying the codex ids; anything else is logged and
   * skipped (undefined).
   *
   * It never had a row, so it never gave access. When the user holds another
   * live subscription to the org, it is that one's duplicate (owner decision
   * 2026-10-22, "refund every payment"): the caller settles it, refunding
   * what it took. Returns the row written, or the one recorded for it while
   * this waited for the lock (the caller ends that as usual).
   */
  private async writeTombstone(
    stripeSub: Stripe.Subscription
  ): Promise<Subscription | undefined> {
    const metadata = stripeSub.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;
    const tierId = metadata.codex_tier_id;
    const context = {
      stripeSubscriptionId: stripeSub.id,
      environment: metadata[STRIPE_ENV_METADATA_KEY],
    };
    if (
      metadata[STRIPE_ENV_METADATA_KEY] !== this.environment ||
      !userId ||
      !orgId ||
      !tierId
    ) {
      this.obs.warn(
        'Deleted subscription we hold no row for; no tombstone written',
        context
      );
      return undefined;
    }

    const item = stripeSub.items?.data?.[0];
    const amountCents = item?.price?.unit_amount ?? 0;
    const split = await this.computeSubscriptionSplit(orgId, amountCents);
    const now = new Date();
    try {
      return await (
        this.db as typeof import('@codex/database').dbWs
      ).transaction(async (tx) => {
        const { replay, liveId } = await this.lockForSubscriber(tx, {
          userId,
          orgId,
          stripeSubId: stripeSub.id,
        });
        if (replay) return replay;
        const [row] = await tx
          .insert(subscriptions)
          .values({
            userId,
            organizationId: orgId,
            tierId,
            stripeSubscriptionId: stripeSub.id,
            stripeCustomerId:
              typeof stripeSub.customer === 'string'
                ? stripeSub.customer
                : stripeSub.customer.id,
            status: SUBSCRIPTION_STATUS.CANCELLED,
            duplicateOfSubscriptionId: liveId ?? null,
            cancelledAt: now,
            endedAt: now,
            billingInterval:
              item?.price?.recurring?.interval === 'year'
                ? BILLING_INTERVAL.YEAR
                : BILLING_INTERVAL.MONTH,
            currentPeriodStart: item?.current_period_start
              ? new Date(item.current_period_start * 1000)
              : now,
            currentPeriodEnd: item?.current_period_end
              ? new Date(item.current_period_end * 1000)
              : now,
            amountCents,
            platformFeeCents: split.platformFeeCents,
            organizationFeeCents: split.organizationFeeCents,
            creatorPayoutCents: split.creatorPayoutCents,
          })
          .returning();
        this.obs.info(
          liveId
            ? 'Deleted subscription recorded as a duplicate'
            : 'Deleted subscription recorded as a tombstone',
          { ...context, duplicateOfSubscriptionId: liveId }
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.findByStripeId(stripeSub.id);
      }
      if (isForeignKeyViolation(error)) {
        // Its user, org or tier is not one we hold: nothing to keep ended.
        this.obs.warn(
          'Deleted subscription names ids we do not hold; no tombstone written',
          context
        );
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Handle customer.subscription.paused — Stripe billing pause.
   *
   * Access-reducing: the user loses access for the paused window. Unlike
   * `handleSubscriptionDeleted`, this is NOT terminal — Stripe will fire
   * `customer.subscription.resumed` (sibling bead Codex-rh0on) which flips
   * the subscription back to ACTIVE.
   *
   * Responsibilities:
   *   - DB: flip `subscriptions.status → 'paused'`. `cancelledAt` stays
   *     NULL (the subscription is not terminated).
   *   - Returns `{ userId, orgId }` extracted from Stripe metadata — same
   *     shape as `handleSubscriptionDeleted` so the webhook can pipe it
   *     into `revokeAccess(...)`.
   *   - Cache: orchestrator hook bumps library + subscription caches
   *     with `reason: 'subscription_paused'` (distinct from
   *     `subscription_deleted` for observability clarity).
   *
   * Revocation write is OWNED by the webhook handler (same pattern as
   * `handleSubscriptionDeleted`) — see `workers/ecom-api/src/handlers/
   * subscription-webhook.ts`.
   *
   * Returns a `WebhookHandlerResult` always (not void) so the webhook can
   * uniformly dispatch side-effects; ids are undefined when metadata
   * is malformed.
   */
  async handleSubscriptionPaused(
    stripeSubscription: Stripe.Subscription
  ): Promise<WebhookHandlerResult> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;

    // A duplicate is refunded and an ended subscription stays ended: neither
    // is paused, and neither gets a streaming block (Codex-2hxff.15).
    const row = await this.findByStripeId(stripeSubId);
    if (row && (await this.isInert(row))) return {};

    await this.db
      .update(subscriptions)
      .set({
        status: SUBSCRIPTION_STATUS.PAUSED,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    this.obs.info('Subscription paused from webhook', {
      stripeSubscriptionId: stripeSubId,
      userId,
      organizationId: orgId,
    });

    // Orchestrator hook: pause is access-reducing — bump both caches
    // so other devices drop library entries + subscription badge within
    // one visibility tick. Skipped when metadata missing userId.
    this.invalidateIfConfigured(
      userId || undefined,
      orgId || undefined,
      'subscription_paused'
    );

    return {
      userId: userId || undefined,
      orgId: orgId || undefined,
    };
  }

  /**
   * Handle customer.subscription.resumed — Stripe billing resume.
   *
   * Access-RESTORING counterpart to `handleSubscriptionPaused` (sibling bead
   * Codex-a0vk2). After a paused window the subscription flips back to
   * active and the revocation key written at pause time is cleared by the
   * webhook layer via `clearAccess`.
   *
   * Responsibilities:
   *   - DB: flip `subscriptions.status` back to `'active'` (the expected
   *     Stripe-reported status on resume). We trust the Stripe event's
   *     status when it's one of our recognised enum values, otherwise
   *     default to ACTIVE — this matches the behaviour of
   *     `handleSubscriptionUpdated` for unexpected statuses.
   *   - Returns `{ userId, orgId }` extracted from Stripe metadata — same
   *     shape as sibling handlers so the webhook can pipe it into
   *     `clearAccess(...)` uniformly.
   *   - Cache: orchestrator hook bumps library + subscription caches
   *     with `reason: 'subscription_resumed'` (distinct reason tag for
   *     observability parity with `'subscription_paused'`).
   *
   * Revocation CLEAR is OWNED by the webhook handler (same pattern as
   * `handleInvoicePaymentSucceeded`'s clear path) — see
   * `workers/ecom-api/src/handlers/subscription-webhook.ts`.
   *
   * Returns a `WebhookHandlerResult` always (not void) so the webhook can
   * uniformly dispatch side-effects; ids are undefined when metadata is
   * malformed — in that case `clearAccess` is naturally gated off and
   * degrades to a no-op.
   */
  async handleSubscriptionResumed(
    stripeSubscription: Stripe.Subscription
  ): Promise<WebhookHandlerResult> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;

    // A late `resumed` never revives a duplicate or an ended subscription,
    // and its inert result leaves the streaming block in place
    // (Codex-2hxff.15).
    const row = await this.findByStripeId(stripeSubId);
    if (row && (await this.isInert(row))) return {};

    // Use the shared mapper with ACTIVE as the fallback — resume's
    // expected outcome is that the subscription is active, even if Stripe
    // reports an unmapped status like 'trialing'.
    const mapped = mapStripeSubscriptionStatus(
      stripeSubscription,
      SUBSCRIPTION_STATUS.ACTIVE
    );
    const nextStatus = mapped.status;

    // A cancelled row whose deletion has not landed yet: back only if Stripe
    // has it live again.
    if (row && (await this.endedAtStripe(row, nextStatus))) {
      this.obs.warn('Late subscription event ignored: cancelled at Stripe', {
        subscriptionId: row.id,
        stripeSubscriptionId: stripeSubId,
        eventStatus: stripeSubscription.status,
      });
      return {};
    }

    const values = {
      status: nextStatus,
      cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
      updatedAt: new Date(),
    };
    if (row && revives(row.status, nextStatus)) {
      // Resumed next to a newer subscription: retired as any revival is
      // (owner decision 7), and inert, so no streaming block is cleared.
      const keptId = await this.writeRevival(row, (tx) =>
        tx.update(subscriptions).set(values).where(eq(subscriptions.id, row.id))
      );
      if (keptId) {
        await this.retireRevived(row, keptId);
        return {};
      }
    } else {
      await this.db
        .update(subscriptions)
        .set(values)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
    }

    this.obs.info('Subscription resumed from webhook', {
      stripeSubscriptionId: stripeSubId,
      userId,
      organizationId: orgId,
      status: nextStatus,
    });

    // Orchestrator hook: resume is access-RESTORING — bump both caches so
    // other devices flip library entries + subscription badge back on
    // within one visibility tick. Skipped when metadata missing userId.
    this.invalidateIfConfigured(
      userId || undefined,
      orgId || undefined,
      'subscription_resumed'
    );

    return {
      userId: userId || undefined,
      orgId: orgId || undefined,
    };
  }

  /**
   * Build the subscription-cancelled email payload.
   * Looks up user email/name and tier name from DB.
   */
  private async buildSubscriptionCancelledEmail(
    userId: string,
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<WebhookEmailPayload | null> {
    const [user] = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.email) return null;

    // Look up tier name
    let planName = 'Subscription';
    const tierId = stripeSubscription.metadata?.codex_tier_id;
    if (tierId) {
      const [tier] = await this.db
        .select({ name: subscriptionTiers.name })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.id, tierId))
        .limit(1);
      if (tier) planName = tier.name;
    }

    return {
      to: user.email,
      toName: user.name || undefined,
      templateName: 'subscription-cancelled',
      category: 'transactional',
      data: {
        userName: user.name || 'there',
        planName,
        accessEndDate: stripeSubscription.cancel_at
          ? new Date(stripeSubscription.cancel_at * 1000).toLocaleDateString(
              'en-GB'
            )
          : 'Immediately',
        resubscribeUrl: `${webAppUrl || ''}/account/subscriptions`,
      },
    };
  }

  // ─── Subscription Management ───────────────────────────────────────────────

  /**
   * Preview the proration that a tier change would produce, WITHOUT mutating
   * the subscription. Powers the confirmation dialog on the org pricing page.
   *
   * The returned `prorationDate` MUST be passed back to `changeTier()` so the
   * commit-time proration calculation matches the preview to the penny —
   * otherwise Stripe re-runs the calc against `Date.now()` and the user gets
   * charged a different amount than they confirmed. A switch into yearly
   * billing cannot be pinned that way (Stripe refuses `proration_date` with
   * `billing_cycle_anchor: 'now'`), so its preview also returns a `quote` the
   * page echoes back, and the commit re-checks it (Codex-2hxff.96).
   *
   * Reuses the same tier-existence + price-configured guards as `changeTier()`
   * so a preview that succeeds is a strong signal the commit will too,
   * including its refusal while the subscription is disputed
   * (`assertNotDisputed`, Codex-2hxff.60).
   */
  async previewTierChange(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year'
  ): Promise<TierChangePreview> {
    try {
      const plan = await this.planTierChange(
        userId,
        orgId,
        newTierId,
        billingInterval
      );
      const prorationDate = Math.floor(Date.now() / 1000);
      const periodEnd = new Date(plan.item.current_period_end * 1000);
      const replaces = await this.replacedChange(plan);

      // Leaving yearly billing (Codex-2hxff.97): the monthly bill starts at
      // the renewal. For A and B the plan waits with it and nothing happens
      // today, so Stripe is not asked; the period end is the live one, never
      // a month from today (nothing starts today). For C(b) the plan changes
      // now on yearly billing, previewed as any change now.
      if (plan.billing) {
        const billingChange = {
          interval: BILLING_INTERVAL.MONTH,
          amountCents: plan.billing.amountCents,
          effectiveAt: periodEnd.toISOString(),
        };
        const charges = nowProration(plan) === 'always_invoice';
        const shown =
          plan.kind === 'change_then_billing_wait' && charges
            ? await this.previewNow(plan, prorationDate)
            : {
                amountDueCents: 0,
                prorationLineItems: [],
                currentPeriodEnd: periodEnd,
              };
        return {
          ...shown,
          newRecurringAmountCents: plan.billing.amountCents,
          newRecurringInterval: BILLING_INTERVAL.MONTH,
          prorationDate,
          isUpgrade: plan.kind === 'change_then_billing_wait' && charges,
          takesEffect:
            plan.kind === 'change_then_billing_wait' ? 'now' : 'period_end',
          billingChange,
          replaces,
        };
      }

      // Nothing is prorated: a move waits for the renewal (it reads only the
      // live period end), and a same-price switch moves no money (Q4).
      if (plan.kind === 'downgrade' || plan.kind === 'lateral') {
        return {
          amountDueCents: 0,
          prorationLineItems: [],
          newRecurringAmountCents: plan.newRecurringAmount,
          newRecurringInterval: billingInterval,
          prorationDate,
          isUpgrade: false,
          takesEffect: plan.kind === 'downgrade' ? 'period_end' : 'now',
          currentPeriodEnd: periodEnd,
          billingChange: null,
          replaces,
        };
      }

      const shown = await this.previewNow(plan, prorationDate);
      return {
        ...shown,
        newRecurringAmountCents: plan.newRecurringAmount,
        newRecurringInterval: billingInterval,
        prorationDate,
        isUpgrade: nowProration(plan) === 'always_invoice',
        takesEffect: 'now',
        billingChange: null,
        replaces,
      };
    } catch (error) {
      this.handleError(error, 'previewTierChange');
    }
  }

  /**
   * Stripe's preview of a change made now at `at` (unix seconds), and what
   * the dialog shows from it. The preview and the confirm's re-check both
   * call this, so they ask Stripe the same question.
   *
   * Most changes are pinned to `at` by `proration_date`, which the write
   * repeats. A switch into yearly billing starts a new period today: it
   * passes `billing_cycle_anchor: 'now'` instead, because Stripe refuses
   * `proration_date` with it, so its credit runs to the moment of the write.
   * Its `quote` holds what the dialog showed, for the re-check
   * (Codex-2hxff.96). Stripe bills that new period as an ordinary line beside
   * the credit, not a proration, so it shows every line of the invoice: the
   * lines then add up to the charge, and the re-check compares them all. A
   * switch of billing period is next billed one new
   * period from `at`; an upgrade, at the old period's end.
   */
  private async previewNow(
    plan: TierChangePlan,
    at: number
  ): Promise<
    Pick<
      TierChangePreview,
      'amountDueCents' | 'prorationLineItems' | 'currentPeriodEnd' | 'quote'
    >
  > {
    const newPeriod = startsNewPeriod(plan.kind, plan.billingInterval);
    const preview = await this.stripe.invoices.createPreview({
      subscription: plan.sub.stripeSubscriptionId,
      subscription_details: {
        items: [{ id: plan.item.id, price: plan.newPriceId }],
        proration_behavior: 'always_invoice',
        ...(newPeriod
          ? { billing_cycle_anchor: 'now' as const }
          : { proration_date: at }),
      },
    });

    const prorationLineItems = preview.lines.data
      .filter(
        (line) =>
          newPeriod ||
          line.parent?.subscription_item_details?.proration === true
      )
      .map((line) => ({
        description: line.description,
        amountCents: line.amount,
      }));
    const currentPeriodEnd =
      plan.kind === 'upgrade' || plan.kind === 'change_then_billing_wait'
        ? new Date(plan.item.current_period_end * 1000)
        : new Date(
            addMonthsClamped(
              at,
              plan.billingInterval === BILLING_INTERVAL.YEAR ? 12 : 1
            ) * 1000
          );

    return {
      amountDueCents: preview.amount_due,
      prorationLineItems,
      currentPeriodEnd,
      ...(newPeriod && {
        quote: tierChangeQuote({
          amountDueCents: preview.amount_due,
          lineAmountsCents: prorationLineItems.map((line) => line.amountCents),
          nextBillAt: currentPeriodEnd,
        }),
      }),
    };
  }

  /**
   * The waiting change a pick replaces (latest wins), for the dialog's
   * "instead of": its tier, and what it would bill. A move to a cheaper plan
   * bills the Price already on the item; a change of billing, phase 2's.
   * Refused picks never reach here, so any waiting change is replaced.
   */
  private async replacedChange(
    plan: TierChangePlan
  ): Promise<TierChangePreview['replaces']> {
    const { move } = plan;
    if (!move) return null;
    const [tier] = await this.db
      .select({ name: subscriptionTiers.name })
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.id, move.tierId),
          eq(subscriptionTiers.organizationId, plan.sub.organizationId)
        )
      )
      .limit(1);
    return {
      tierId: move.tierId,
      tierName: tier?.name ?? '',
      interval:
        move.billing?.interval ??
        (plan.sub.billingInterval === BILLING_INTERVAL.YEAR
          ? BILLING_INTERVAL.YEAR
          : BILLING_INTERVAL.MONTH),
      amountCents:
        move.billing?.amountCents ??
        plan.item.price.unit_amount ??
        plan.sub.amountCents,
    };
  }

  /**
   * Change subscription tier (data design §1; owner decisions T1-T4, Q1-Q4).
   * "Up or down" is judged by price, comparing the plans on the member's
   * CURRENT billing period (Q1), against what they pay now: the held amount
   * while a move waits (§2.2 trap 2).
   *
   * - **Upgrade** (another tier, same billing, dearer): now. Stripe invoices
   *   the part-period difference at once (`always_invoice` +
   *   `payment_behavior: 'error_if_incomplete'`); a declined charge reverts
   *   the update on Stripe's side and throws `SubscriptionPaymentRequiredError`
   *   (402) with the row untouched.
   * - **Downgrade** (another tier, same billing, cheaper): waits for the end
   *   of the paid period (T1). One no-proration swap puts the cheaper Price
   *   on the item for the next bill, `codex_tier_id` (and so access) stays,
   *   and the move and hold marker are written (`scheduleTierMove`). Another
   *   cheaper choice replaces it (latest wins, T2). The renewal flips it
   *   (`applyDueTierMove`).
   * - **Same price** (Q4): now, with no proration: the tier changes at once
   *   and nothing is charged or credited; it replaces a waiting move.
   * - **The other billing period**: the same tier switches now, as before
   *   (a credit for unused time, or a charge). Another tier there switches
   *   now when it is not cheaper; a cheaper one takes two steps (T1), refused
   *   with `TIER_CHANGE_TWO_STEPS` and the first step to offer.
   *
   * Refused before Stripe is written to: while set to cancel (Q2), while a
   * chargeback is open (`assertNotDisputed`, Codex-2hxff.60), a change that
   * moves money now while a move waits (`PENDING_MOVE_KEEP_FIRST`, T2: the
   * item carries the cheaper Price, so Stripe would credit at the wrong
   * rate), and a billing switch while a move waits (Q3).
   *
   * `prorationDate` should be the Unix timestamp returned by
   * `previewTierChange()` so the commit-time charge matches the preview to
   * the penny. A preview's date stands for `TIER_CHANGE_PREVIEW_TTL_MS`; an
   * older one, one from the future, or one before the current period throws
   * `TierChangePreviewExpiredError` before Stripe is touched (Codex-2hxff.15,
   * SUB-12).
   *
   * A switch into yearly billing also needs the preview's `quote`: it cannot
   * be pinned to the preview's date, so it is previewed again just before
   * the write, and any difference from what the dialog showed throws
   * `TierChangePreviewExpiredError` before Stripe is written to
   * (Codex-2hxff.96). The page then shows the fresh figures to confirm. A
   * drift in the second between that re-check and the write is accepted.
   *
   * Every change bills the price read now: a change that waits, at the
   * renewal with no notice, and a change made now, at once (a cheaper plan
   * repriced past the current one is an upgrade by confirm). When the page
   * passes the preview's `newRecurringAmountCents`, a different price (one
   * saved since the preview) throws `TierChangePreviewExpiredError` before
   * Stripe is written to, so the member confirms the price they will pay
   * (review C1 cycle 2, L4; cycle 3, L4-a). For C(b) it is the monthly bill
   * the change waits for.
   */
  async changeTier(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year',
    prorationDate?: number,
    quote?: string,
    newRecurringAmountCents?: number
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
    try {
      const plan = await this.planTierChange(
        userId,
        orgId,
        newTierId,
        billingInterval,
        prorationDate === undefined
          ? undefined
          : (sub) => this.assertPreviewCurrent(prorationDate, sub, newTierId)
      );
      const effectiveProrationDate =
        prorationDate ?? Math.floor(Date.now() / 1000);

      if (startsNewPeriod(plan.kind, plan.billingInterval)) {
        if (!quote) {
          throw new ValidationError(
            'A switch to yearly billing needs the quote its preview returned.',
            { newTierId }
          );
        }
        const now = await this.previewNow(plan, Math.floor(Date.now() / 1000));
        if (now.quote !== quote) {
          throw new TierChangePreviewExpiredError({
            prorationDate: effectiveProrationDate,
            newTierId,
          });
        }
      }

      if (
        newRecurringAmountCents !== undefined &&
        newRecurringAmountCents !==
          (plan.billing?.amountCents ?? plan.newRecurringAmount)
      ) {
        throw new TierChangePreviewExpiredError({
          prorationDate: effectiveProrationDate,
          newTierId,
        });
      }

      if (plan.billing) {
        await this.waitForBillingChange(
          plan,
          plan.billing,
          effectiveProrationDate
        );
        // C(b) changes the plan now, and so the library.
        this.invalidateIfConfigured(
          userId,
          orgId,
          plan.kind === 'change_then_billing_wait'
            ? 'change_tier'
            : 'tier_move_scheduled'
        );
      } else if (plan.kind === 'downgrade') {
        await this.scheduleTierMove(plan, effectiveProrationDate);
        this.invalidateIfConfigured(userId, orgId, 'tier_move_scheduled');
      } else {
        await this.changeTierNow(plan, effectiveProrationDate);
        // A tier change affects both the library (the new tier may unlock or
        // lock content) and the subscription badge. After Stripe succeeded;
        // the local write is best-effort (BUG-020, the webhook reconciles).
        this.invalidateIfConfigured(userId, orgId, 'change_tier');
      }

      // The subscription reflects the in-memory view prior to the Stripe
      // update — callers that need the post-update state re-fetch.
      return { userId, orgId, subscription: plan.sub };
    } catch (error) {
      this.handleError(error, 'changeTier');
    }
  }

  /**
   * What a preview or a commit would do (data design §1): the member's
   * subscription, the target tier's Price, the live Stripe subscription and
   * the change. Every refusal is thrown here, before anything is written, so
   * a preview that succeeds is a strong signal the commit will too.
   * `beforeStripe` runs once the DB checks pass and before Stripe is read.
   */
  private async planTierChange(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year',
    beforeStripe?: (sub: Subscription) => void
  ): Promise<TierChangePlan> {
    const sub = await this.getSubscriptionOrThrow(userId, orgId);
    this.assertNotDisputed(sub, orgId);
    // Q2: picking a plan never reactivates a subscription set to cancel, and
    // a move would wait for a date the plan ends on anyway.
    if (
      sub.status === SUBSCRIPTION_STATUS.CANCELLING ||
      sub.cancelAtPeriodEnd
    ) {
      throw new TierChangeCancellingError(orgId);
    }

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

    beforeStripe?.(sub);

    const live = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId
    );
    const item = live.items.data[0];
    if (!item) {
      throw new SubscriptionCheckoutError('No subscription item found');
    }

    // A schedule we did not make is never written through (§3.4).
    const schedule = await this.ourScheduleOrThrow(live, orgId);

    // The move as Stripe holds it: the row can lag a write by a webhook.
    const move = readWaitingMove(live.metadata);
    const currentInterval =
      sub.billingInterval === BILLING_INTERVAL.YEAR
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;
    const priceOn = (interval: 'month' | 'year') =>
      interval === BILLING_INTERVAL.MONTH
        ? newTier.priceMonthly
        : newTier.priceAnnual;
    const priceIdOn = (interval: 'month' | 'year') =>
      interval === BILLING_INTERVAL.MONTH
        ? newTier.stripePriceMonthlyId
        : newTier.stripePriceAnnualId;

    const verdict = classifyTierChange({
      currentTierId: sub.tierId,
      currentInterval,
      currentAmountCents: move?.holdAmountCents ?? sub.amountCents,
      targetTierId: newTierId,
      targetInterval: billingInterval,
      targetAmountOnCurrentIntervalCents: priceOn(currentInterval),
      targetOnCurrentInterval: priceIdOn(currentInterval) !== null,
      waiting: move && {
        kind: move.billing ? 'billing' : 'plan',
        tierId: move.tierId,
      },
      cancelling: live.cancel_at_period_end === true,
    });
    if ('refused' in verdict) {
      switch (verdict.refused) {
        case 'cancelling':
          throw new TierChangeCancellingError(orgId);
        case 'keep_first':
          throw new PendingMoveKeepFirstError(orgId, newTierId);
        case 'interval_while_moving':
          throw new TierChangeIntervalWhileMovingError(orgId);
        case 'two_steps':
          throw new TierChangeTwoStepsError(orgId, {
            tierId: newTierId,
            billingInterval: currentInterval,
          });
      }
    }

    const billing = waitsForBilling(verdict.kind)
      ? { priceId: newPriceId, amountCents: priceOn(billingInterval) }
      : null;
    // C(b): the plan changes now on the member's current (yearly) billing.
    const nowOnYear = verdict.kind === 'change_then_billing_wait';
    const yearPriceId = priceIdOn(currentInterval);
    return {
      kind: verdict.kind,
      sub,
      newTierId,
      newPriceId: nowOnYear && yearPriceId ? yearPriceId : newPriceId,
      billingInterval,
      newRecurringAmount: nowOnYear
        ? priceOn(currentInterval)
        : priceOn(billingInterval),
      live,
      item,
      move,
      billing,
      schedule,
    };
  }

  /**
   * The schedule attached to `live`, when it is ours (billing-change.ts), or
   * null with none attached. Someone else's (one made in the Stripe
   * Dashboard, say) is refused before anything is written, with one alert
   * for support: writing through it would change or split its phases.
   */
  private async ourScheduleOrThrow(
    live: Stripe.Subscription,
    organizationId: string
  ): Promise<Stripe.SubscriptionSchedule | null> {
    const scheduleId = scheduleIdOf(live);
    if (!scheduleId) return null;
    const schedule =
      await this.stripe.subscriptionSchedules.retrieve(scheduleId);
    if (isOurSchedule(schedule, live.metadata)) return schedule;
    const errorId = crypto.randomUUID();
    this.obs.error(
      'Subscription is managed by a Stripe schedule that is not ours; nothing was changed (support: docs/payments/subscriptions.md → Waiting changes of billing)',
      {
        errorId,
        stripeSubscriptionId: live.id,
        stripeScheduleId: scheduleId,
        organizationId,
      }
    );
    throw new SubscriptionScheduledElsewhereError(organizationId, errorId);
  }

  /**
   * Let go of our schedule (Stripe's `release`): the subscription keeps its
   * items as they stand and nothing is invoiced (proof P2). `key` makes a
   * retry replay.
   */
  private async releaseSchedule(
    schedule: Pick<Stripe.SubscriptionSchedule, 'id'>,
    key: string
  ): Promise<void> {
    await this.stripe.subscriptionSchedules.release(
      schedule.id,
      {},
      { idempotencyKey: key }
    );
  }

  /**
   * A change that happens now (data design §1): upgrade, a switch of billing
   * period, or a same-price switch. Clears any pending price change (it
   * belonged to the old tier's Price, Codex-2hxff.3) and any waiting move.
   */
  private async changeTierNow(
    plan: TierChangePlan,
    effectiveProrationDate: number
  ): Promise<void> {
    const { sub, newTierId, newPriceId, billingInterval } = plan;
    const { userId, organizationId: orgId } = sub;
    const proration = nowProration(plan);

    // An item write would split a schedule's phase (proof P4). Ours carries a
    // change of billing this one replaces, or lingers from one that landed.
    if (plan.schedule) {
      await this.releaseSchedule(
        plan.schedule,
        `billing-release-now_${plan.schedule.id}_${effectiveProrationDate}`
      );
    }

    await this.writeChangeNow(
      plan,
      effectiveProrationDate,
      {
        codex_tier_id: newTierId,
        codex_user_id: userId,
        codex_organization_id: orgId,
        // A pending price change belonged to the OLD tier's Price; the
        // new tier's Price supersedes it (Codex-2hxff.3). A same-price
        // switch also replaces a waiting move (latest wins, Q4).
        ...CLEAR_PENDING_PRICE_METADATA,
        ...CLEAR_MOVE_METADATA,
        ...CLEAR_HOLD_METADATA,
      },
      // One key per subscription, target price and preview: a double
      // click replays, while upgrade → downgrade → the same upgrade with
      // a fresh preview makes three changes (Codex-2hxff.15, SUB-12).
      `${NOW_CHANGE_KEY_PREFIX[proration]}_${sub.id}_${newPriceId}_${effectiveProrationDate}`
    );

    // BUG-020: Stripe succeeded — now the local record. If this write fails,
    // customer.subscription.updated reconciles from Stripe's metadata; it is
    // logged, not rethrown. The amount is mirrored at once so the account
    // page shows the new price without waiting for the webhook, with the
    // split recomputed: the row's CHECK requires
    // amount_cents = platform_fee + org_fee + creator_payout (Codex-m644n).
    const newSplit = await this.computeSubscriptionSplit(
      orgId,
      plan.newRecurringAmount
    );
    try {
      await this.db
        .update(subscriptions)
        .set({
          tierId: newTierId,
          billingInterval,
          amountCents: plan.newRecurringAmount,
          platformFeeCents: newSplit.platformFeeCents,
          organizationFeeCents: newSplit.organizationFeeCents,
          creatorPayoutCents: newSplit.creatorPayoutCents,
          ...NO_PENDING_MOVE,
          ...(plan.schedule && { stripeScheduleId: null }),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } catch (dbError) {
      this.obs.error(
        'changeTier: DB update failed after Stripe succeeded — webhook will reconcile',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          oldTierId: sub.tierId,
          newTierId,
          billingInterval,
          error: (dbError as Error).message,
        }
      );
    }

    this.obs.info('Subscription tier changed', {
      subscriptionId: sub.id,
      oldTierId: sub.tierId,
      newTierId,
      billingInterval,
      kind: plan.kind,
      // A same-price switch replaced a waiting move (latest wins).
      replacedMoveTierId: plan.move?.tierId ?? null,
    });
  }

  /**
   * The Stripe write of a change made now: the target Price on the item,
   * prorated as `nowProration` says and pinned to the preview's date, with
   * `metadata`. A charge must clear first: on 402 Stripe reverts the update
   * and this throws `SubscriptionPaymentRequiredError`, nothing changed.
   */
  private async writeChangeNow(
    plan: TierChangePlan,
    effectiveProrationDate: number,
    metadata: Record<string, string>,
    idempotencyKey: string
  ): Promise<void> {
    const { sub, newTierId, newPriceId, billingInterval, item } = plan;
    const { userId, organizationId: orgId } = sub;
    const proration = nowProration(plan);
    const chargesNow = proration === 'always_invoice';
    const newPeriod = startsNewPeriod(plan.kind, plan.billingInterval);

    try {
      await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          items: [{ id: item.id, price: newPriceId }],
          proration_behavior: proration,
          // Pin proration to the preview's timestamp so the customer pays
          // exactly what the dialog showed them.
          ...(proration !== 'none' &&
            !newPeriod && {
              proration_date: effectiveProrationDate,
            }),
          // A switch into yearly billing starts its new period now, as the
          // dialog said (Codex-2hxff.96). Stripe refuses proration_date with
          // this anchor, so the credit runs to this write; `changeTier`
          // re-checked the dialog's figures just before it.
          ...(newPeriod && { billing_cycle_anchor: 'now' as const }),
          // A charge now must clear before the subscription changes. On 402
          // Stripe reverts the price update; we map it to
          // SubscriptionPaymentRequiredError and the row stays untouched.
          ...(chargesNow && {
            payment_behavior: 'error_if_incomplete' as const,
          }),
          metadata,
        },
        { idempotencyKey }
      );
    } catch (stripeError) {
      const statusCode = (stripeError as { statusCode?: number })?.statusCode;
      if (chargesNow && statusCode === 402) {
        // Stripe rejected the proration invoice and reverted the update: the
        // subscription stays on the old tier. The error's context is sent to
        // the client, so Stripe's own message is logged, not returned
        // (Codex-2hxff.23, SEC-02); the errorId in both ties them.
        const errorId = crypto.randomUUID();
        this.obs.warn('Tier upgrade payment declined by Stripe', {
          errorId,
          userId,
          organizationId: orgId,
          newTierId,
          code: stripeErrorCode(stripeError),
          error:
            stripeError instanceof Error
              ? stripeError.message
              : String(stripeError),
        });
        throw new SubscriptionPaymentRequiredError(
          'Payment for the upgrade was declined. Update your payment method and try again.',
          {
            userId,
            organizationId: orgId,
            newTierId,
            billingInterval,
            errorId,
            // The prorationDate the failed commit pinned, so the pricing
            // dialog can tell "needs a fresh preview" from "a transient
            // payment failure".
            prorationDate: effectiveProrationDate,
            // The tier row the commit targeted (defensive against dialog
            // state drift between submit and response).
            tierIdAtCommit: newTierId,
          }
        );
      }
      throw stripeError;
    }
  }

  /**
   * A move to a cheaper plan, waiting for the renewal (data design §2.1). One
   * Stripe update: the cheaper Price on the item with no proration (the
   * price-change machinery's immediate path, so the renewal Stripe drafts
   * bills it), the move, and on the FIRST move the hold marker. A replacement
   * keeps the hold keys: writing them again would record the first target's
   * price as held, and Keep would put the member on the wrong plan.
   *
   * The row at once, as for any change: the move's three columns and the
   * next bill in `amount_cents`. `tier_id`, and so access, is untouched.
   */
  private async scheduleTierMove(
    plan: TierChangePlan,
    effectiveProrationDate: number
  ): Promise<void> {
    const { sub, newTierId, newPriceId, item, live, move } = plan;
    const moveAt = item.current_period_end;
    const heldAmountCents =
      move?.holdAmountCents ?? item.price.unit_amount ?? sub.amountCents;

    // A cheaper plan on the current billing replaces a waiting change of
    // billing (Codex-2hxff.97, §2.4): its schedule goes first (an item write
    // would split its phase, proof P4), then the move below keeps its hold.
    if (plan.schedule) {
      await this.releaseSchedule(
        plan.schedule,
        `billing-release-move_${plan.schedule.id}_${effectiveProrationDate}`
      );
    }

    await this.stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: 'none',
        metadata: moveMetadata({
          currentTierId: sub.tierId,
          userId: sub.userId,
          organizationId: sub.organizationId,
          targetTierId: newTierId,
          moveAt,
          hold: move
            ? undefined
            : {
                priceId: item.price.id,
                amountCents: heldAmountCents,
                metadata: live.metadata,
              },
        }),
      },
      // Per preview, as the change-tier keys are: a double click replays,
      // while going back and forth (Basic, Pro, Basic) inside Stripe's
      // 24-hour window makes a new write each time instead of replaying the
      // first and doing nothing.
      {
        idempotencyKey: `move_${sub.id}_${newPriceId}_${moveAt}_${effectiveProrationDate}`,
      }
    );

    const split = await this.computeSubscriptionSplit(
      sub.organizationId,
      plan.newRecurringAmount
    );
    try {
      await this.db
        .update(subscriptions)
        .set({
          pendingTierId: newTierId,
          pendingTierFrom: new Date(moveAt * 1000),
          heldAmountCents,
          pendingBillingInterval: null,
          pendingAmountCents: null,
          ...(plan.schedule && { stripeScheduleId: null }),
          amountCents: plan.newRecurringAmount,
          platformFeeCents: split.platformFeeCents,
          organizationFeeCents: split.organizationFeeCents,
          creatorPayoutCents: split.creatorPayoutCents,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } catch (dbError) {
      // As for a change now (BUG-020): customer.subscription.updated mirrors
      // the move from the metadata.
      this.obs.error(
        'changeTier: DB update failed after the move was written — webhook will reconcile',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          tierId: sub.tierId,
          pendingTierId: newTierId,
          error: (dbError as Error).message,
        }
      );
    }

    this.obs.info(move ? 'tier_move.replaced' : 'tier_move.scheduled', {
      subscriptionId: sub.id,
      organizationId: sub.organizationId,
      tierId: sub.tierId,
      pendingTierId: newTierId,
      replacedTierId: move?.tierId ?? null,
      moveAt: new Date(moveAt * 1000).toISOString(),
    });
  }

  /**
   * A change that leaves yearly billing at the year's end (Codex-2hxff.97,
   * data design §2): A, the same plan; B, a cheaper plan (Q3); C(b), a dearer
   * or same-price plan now on yearly billing (Q1). Nothing is credited: the
   * paid year runs on, and a Stripe schedule puts the monthly Price on at the
   * renewal, flipping the tier in the same update (proofs P1, P5, P6).
   *
   * 1. The record on the subscription first, so every later event snapshot
   *    carries it (§4.4). C(b) writes it with its change now. A waiting move
   *    it replaces (D, Q2) has its held Price put back in the same write, as
   *    Keep's would (proof P7).
   * 2. The schedule from the subscription, unless ours is attached: a
   *    waiting change of billing is then replaced in place (latest wins,
   *    §2.4). C(b) writes the item, so it lets ours go first.
   * 3. Its phases: the paid year as it stands, then the monthly Price.
   *
   * If 2 or 3 fails for A or B, the record is put back as it was and the
   * error stands: nothing changed. C(b)'s plan has changed and been paid for,
   * so its record stays and the hourly backstop makes the schedule (§5.2).
   */
  private async waitForBillingChange(
    plan: TierChangePlan,
    billing: { priceId: string; amountCents: number },
    effectiveProrationDate: number
  ): Promise<void> {
    const { sub, item, live, move, newTierId } = plan;
    const planNow = plan.kind === 'change_then_billing_wait';
    const moveAt = item.current_period_end;
    // What the item carries for the rest of the year: C(b)'s new yearly
    // Price, a replaced move's held Price (put back), or the Price on it.
    const hold = planNow
      ? { priceId: plan.newPriceId, amountCents: plan.newRecurringAmount }
      : move
        ? { priceId: move.holdPriceId, amountCents: move.holdAmountCents }
        : {
            priceId: item.price.id,
            amountCents: item.price.unit_amount ?? sub.amountCents,
          };
    const putBack = !planNow && move !== null && move.billing === null;
    const record = billingChangeMetadata({
      tierId: planNow ? newTierId : sub.tierId,
      userId: sub.userId,
      organizationId: sub.organizationId,
      targetTierId: newTierId,
      moveAt,
      hold,
      // C(b) leaves the tier now, so a price change on it goes (as any change
      // now); otherwise one on the tier being left stays parked.
      parkedPendingPrice: planNow
        ? null
        : move
          ? move.parkedPendingPrice
          : livePendingPrice(live.metadata),
      billing: {
        interval: BILLING_INTERVAL.MONTH,
        priceId: billing.priceId,
        amountCents: billing.amountCents,
      },
    });

    let schedule = plan.schedule;
    if (schedule && (planNow || move?.billing == null)) {
      await this.releaseSchedule(
        schedule,
        `billing-release-change_${schedule.id}_${effectiveProrationDate}`
      );
      schedule = null;
    }

    // Step 1.
    if (planNow) {
      await this.writeChangeNow(
        plan,
        effectiveProrationDate,
        record,
        `${NOW_CHANGE_KEY_PREFIX[nowProration(plan)]}-billing_${sub.id}_${plan.newPriceId}_${effectiveProrationDate}`
      );
    } else {
      if (putBack && move)
        await ensurePriceActive(this.stripe, move.holdPriceId);
      await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          ...(putBack &&
            move && {
              items: [{ id: item.id, price: move.holdPriceId }],
              proration_behavior: 'none' as const,
            }),
          metadata: record,
        },
        {
          idempotencyKey: `billing_${sub.id}_${billing.priceId}_${moveAt}_${effectiveProrationDate}`,
        }
      );
    }

    // Steps 2 and 3.
    let scheduleId: string | null = null;
    let leftAttached = false;
    try {
      scheduleId = await this.setBillingSchedule({
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        schedule,
        priceId: billing.priceId,
        targetTierId: newTierId,
        moveAt,
        stamp: effectiveProrationDate,
        onLeftAttached: () => {
          leftAttached = true;
        },
      });
    } catch (error) {
      if (!planNow) {
        // A schedule still attached keeps the record beside it, so it reads
        // as ours: Keep, Cancel and a retry reach it, never "scheduled
        // elsewhere" (review C1, SF-3). setBillingSchedule has alerted.
        if (!leftAttached) {
          await this.putBackRecord(
            plan,
            record,
            putBack,
            effectiveProrationDate
          );
        }
        throw error;
      }
      this.obs.warn(
        'billing_change.schedule_failed: the plan changed now; the hourly backstop sets the change of billing',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          organizationId: sub.organizationId,
          error: describeThrown(error),
        }
      );
    }
    if (scheduleId === null && !planNow) {
      // Set to cancel since the read (cycle 2, L1): nothing was set, and the
      // record goes, as for any change refused while cancelling.
      await this.putBackRecord(plan, record, putBack, effectiveProrationDate);
      throw new TierChangeCancellingError(sub.organizationId);
    }

    const split = await this.computeSubscriptionSplit(
      sub.organizationId,
      hold.amountCents
    );
    try {
      await this.db
        .update(subscriptions)
        .set({
          ...(planNow && { tierId: newTierId }),
          amountCents: hold.amountCents,
          platformFeeCents: split.platformFeeCents,
          organizationFeeCents: split.organizationFeeCents,
          creatorPayoutCents: split.creatorPayoutCents,
          pendingTierId: newTierId,
          pendingTierFrom: new Date(moveAt * 1000),
          heldAmountCents: hold.amountCents,
          pendingBillingInterval: BILLING_INTERVAL.MONTH,
          pendingAmountCents: billing.amountCents,
          stripeScheduleId: scheduleId,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } catch (dbError) {
      // As for any change (BUG-020): customer.subscription.updated mirrors
      // the record and the schedule from Stripe.
      this.obs.error(
        'changeTier: DB update failed after the change of billing was written — webhook will reconcile',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          tierId: sub.tierId,
          pendingTierId: newTierId,
          error: describeThrown(dbError),
        }
      );
    }

    this.obs.info(
      move ? 'billing_change.replaced' : 'billing_change.scheduled',
      {
        subscriptionId: sub.id,
        organizationId: sub.organizationId,
        kind: plan.kind,
        tierId: sub.tierId,
        pendingTierId: newTierId,
        replacedTierId: move?.tierId ?? null,
        stripeScheduleId: scheduleId,
        moveAt: new Date(moveAt * 1000).toISOString(),
      }
    );
  }

  /**
   * A waiting change of billing's schedule (§2.2 steps 2-3): made from the
   * subscription, or `schedule` (ours) updated in place, its phases the paid
   * year as it stands and then `priceId` for a month with the flip. A schedule
   * made here whose update fails is let go, so no half-made one is left
   * attached. If that release fails too, it is one error alert and
   * `onLeftAttached` runs: the caller then keeps the record beside it, so
   * the untagged schedule still reads as ours (`isOurSchedule`; review C1,
   * SF-3). Never while the subscription is set to cancel:
   * `from_subscription` would undo the cancel (proof P10), so a cancel that
   * lands after the caller's read is put back and nothing is set (null).
   * Returns its id.
   */
  private async setBillingSchedule(args: {
    subscriptionId: string;
    stripeSubscriptionId: string;
    schedule: Stripe.SubscriptionSchedule | null;
    priceId: string;
    targetTierId: string;
    moveAt: number;
    /** What makes each attempt's keys its own: the preview's date, or the row's version. */
    stamp: number | string;
    /** The update failed and so did letting go of the schedule made for it. */
    onLeftAttached?: () => void;
  }): Promise<string | null> {
    const created = args.schedule
      ? null
      : await this.createBillingSchedule(args);
    // A Cancel that landed after the caller read the subscription (review
    // C1 cycle 2, L1): `from_subscription` moved it onto the schedule
    // (`end_behavior: 'cancel'`) and turned the subscription's own flag off
    // (proof P10), and the phase update would clear it for good. A member
    // set to cancel gets no schedule: let go of it, put the cancel back, and
    // set nothing (null). A failure here is one alert: the cancel may be lost.
    if (created?.end_behavior === 'cancel') {
      try {
        await this.restoreCancel(created, args.stripeSubscriptionId);
      } catch (error) {
        this.obs.error(
          'billing_change.cancel_restore_failed: a schedule was made from a subscription set to cancel, and putting the cancel back failed; the member may now renew (support: release the schedule if still attached, and set the subscription to cancel at its period end)',
          {
            errorId: crypto.randomUUID(),
            subscriptionId: args.subscriptionId,
            stripeSubscriptionId: args.stripeSubscriptionId,
            stripeScheduleId: created.id,
            error: describeThrown(error),
          }
        );
        throw error;
      }
      this.obs.info('billing_change.skipped_cancelling', {
        subscriptionId: args.subscriptionId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeScheduleId: created.id,
      });
      return null;
    }
    const base = args.schedule ?? created;
    if (!base) {
      throw new InternalServiceError('No subscription schedule to update', {
        subscriptionId: args.subscriptionId,
      });
    }
    try {
      await this.stripe.subscriptionSchedules.update(
        base.id,
        billingScheduleUpdate({
          schedule: base,
          priceId: args.priceId,
          flip: flipMetadata({ tierId: args.targetTierId }),
          environment: this.environment,
          envKey: STRIPE_ENV_METADATA_KEY,
          subscriptionId: args.subscriptionId,
        }),
        {
          idempotencyKey: `billing-sched-set_${base.id}_${args.priceId}_${args.moveAt}_${args.stamp}`,
        }
      );
    } catch (error) {
      if (created) {
        const released = await this.releaseSchedule(
          created,
          `billing-undo-sched_${created.id}`
        ).then(
          () => true,
          (releaseError: unknown) => {
            this.obs.error(
              "billing_change.undo_release_failed: our own schedule is left half made on the member's subscription, untagged, with the change's record kept beside it (support: release this schedule in Stripe; the hourly backstop then sets the change again from the record)",
              {
                errorId: crypto.randomUUID(),
                subscriptionId: args.subscriptionId,
                stripeSubscriptionId: args.stripeSubscriptionId,
                stripeScheduleId: created.id,
                updateError: describeThrown(error),
                error: describeThrown(releaseError),
              }
            );
            return false;
          }
        );
        if (!released) args.onLeftAttached?.();
      }
      throw error;
    }
    return base.id;
  }

  /**
   * The schedule made from the subscription, keyed per attempt. A create
   * whose answer was lost (a timeout or a 5xx, not a refusal:
   * `isDefinitiveStripeRefusal`) may have been made, so the subscription is
   * read again: an untagged schedule attached beside our record is the one
   * we made, taken up rather than left as an orphan that reads as someone
   * else's once the record is put back (review C1 cycle 2, L2). Anything
   * else throws the create's error, as before.
   */
  private async createBillingSchedule(args: {
    subscriptionId: string;
    stripeSubscriptionId: string;
    moveAt: number;
    stamp: number | string;
  }): Promise<Stripe.SubscriptionSchedule> {
    try {
      return await this.stripe.subscriptionSchedules.create(
        { from_subscription: args.stripeSubscriptionId },
        {
          idempotencyKey: `billing-sched_${args.subscriptionId}_${args.moveAt}_${args.stamp}`,
        }
      );
    } catch (error) {
      if (isDefinitiveStripeRefusal(error)) throw error;
      const made = await this.lostScheduleOf(args.stripeSubscriptionId).catch(
        (readError: unknown) => {
          this.obs.warn('billing_change.create_reread_failed', {
            subscriptionId: args.subscriptionId,
            stripeSubscriptionId: args.stripeSubscriptionId,
            error: describeThrown(readError),
          });
          return null;
        }
      );
      if (!made) throw error;
      this.obs.warn('billing_change.create_adopted', {
        subscriptionId: args.subscriptionId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeScheduleId: made.id,
        error: describeThrown(error),
      });
      return made;
    }
  }

  /** The half-made schedule of ours attached to the subscription now, or null. */
  private async lostScheduleOf(
    stripeSubscriptionId: string
  ): Promise<Stripe.SubscriptionSchedule | null> {
    const live = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const scheduleId = scheduleIdOf(live);
    if (!scheduleId) return null;
    const schedule =
      await this.stripe.subscriptionSchedules.retrieve(scheduleId);
    return isHalfMadeSchedule(schedule, live.metadata) ? schedule : null;
  }

  /**
   * Let go of a schedule that ends in a cancel and put the cancel back on
   * the subscription (proof P10: `from_subscription` moved it there).
   */
  private async restoreCancel(
    schedule: Pick<Stripe.SubscriptionSchedule, 'id'>,
    stripeSubscriptionId: string
  ): Promise<void> {
    await this.releaseSchedule(
      schedule,
      `billing-undo-cancelled_${schedule.id}`
    );
    await this.stripe.subscriptions.update(
      stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: `billing-recancel_${schedule.id}` }
    );
  }

  /**
   * Finish our schedule when it does not carry the waiting change its
   * record describes (`scheduleNeedsFinishing`; review C1 cycle 2, L2): it
   * is updated in place to the record, under a key of its own per repair
   * (the schedule, what phase 2 held, and the record's Price). A finished
   * one is left alone, so our update's own event writes nothing.
   *
   * Never against the member's later choice. A schedule that ends in a
   * cancel is let go and the cancel put back, as the create's check does
   * (cycle 2, L1); one on a subscription set to cancel is let go and the
   * record kept, as Cancel does. A Keep clears the record, and with it this
   * call: `billing` is read from the live subscription. Throws Stripe's
   * errors; the callers alert.
   */
  private async finishBillingSchedule(
    sub: Pick<Subscription, 'id'>,
    live: Stripe.Subscription,
    schedule: Stripe.SubscriptionSchedule,
    move: WaitingMove,
    billing: WaitingBilling
  ): Promise<'finished' | 'released' | 'none'> {
    const flip = flipMetadata({ tierId: move.tierId });
    if (!scheduleNeedsFinishing(schedule, billing.priceId, flip)) {
      return 'none';
    }
    if (schedule.end_behavior === 'cancel') {
      await this.restoreCancel(schedule, live.id);
      return 'released';
    }
    if (live.cancel_at_period_end) {
      await this.releaseSchedule(
        schedule,
        `billing-release-cancel_${schedule.id}`
      );
      return 'released';
    }
    await ensurePriceActive(this.stripe, billing.priceId);
    await this.setBillingSchedule({
      subscriptionId: sub.id,
      stripeSubscriptionId: live.id,
      schedule,
      priceId: billing.priceId,
      targetTierId: move.tierId,
      moveAt: move.at,
      stamp: `finish-${phaseTwoPriceId(schedule) ?? 'none'}`,
    });
    return 'finished';
  }

  /**
   * Put a subscription's metadata back as it was before a change of billing
   * whose schedule could not be set (§2.2): every key the record wrote takes
   * its earlier value, or goes. A replaced move's cheaper Price goes back on
   * the item too. Best effort: a failure here is one alert, and the hourly
   * backstop finishes the schedule from the record, since the member asked
   * for it.
   */
  private async putBackRecord(
    plan: TierChangePlan,
    record: Record<string, string>,
    putBack: boolean,
    effectiveProrationDate: number
  ): Promise<void> {
    const { sub, item, live } = plan;
    const earlier = Object.fromEntries(
      Object.keys(record).map((key) => [key, live.metadata?.[key] ?? ''])
    );
    try {
      await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          ...(putBack && {
            items: [{ id: item.id, price: item.price.id }],
            proration_behavior: 'none' as const,
          }),
          metadata: earlier,
        },
        {
          idempotencyKey: `billing-undo_${sub.id}_${item.current_period_end}_${effectiveProrationDate}`,
        }
      );
    } catch (error) {
      this.obs.error(
        'billing_change.undo_failed: a change of billing was recorded but its schedule could not be set; the hourly backstop sets it (support: docs/payments/subscriptions.md → Waiting changes of billing)',
        {
          errorId: crypto.randomUUID(),
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          organizationId: sub.organizationId,
          error: describeThrown(error),
        }
      );
    }
  }

  /**
   * The preview's price still stands (owner decision 2026-10-22: 10 minutes,
   * then "Prices changed, review again"). The date is the client's, so it is
   * bounded before Stripe sees it: within the preview's lifetime, at most a
   * little ahead of our clock, and inside the current billing period. Stripe
   * documents no bound of its own, and an unbounded date could buy an upgrade
   * for pennies or farm downgrade credit.
   */
  private assertPreviewCurrent(
    prorationDate: number,
    sub: Subscription,
    newTierId: string
  ): void {
    const now = Date.now();
    const at = prorationDate * 1000;
    if (
      at < now - TIER_CHANGE_PREVIEW_TTL_MS ||
      at > now + PRORATION_DATE_CLOCK_SKEW_MS ||
      prorationDate < Math.floor(sub.currentPeriodStart.getTime() / 1000)
    ) {
      throw new TierChangePreviewExpiredError({ prorationDate, newTierId });
    }
  }

  /**
   * Cancel subscription at period end.
   * Access retained until currentPeriodEnd.
   *
   * Two reason fields are recorded side-by-side:
   * - `reason` is the legacy free-text field (max 500 chars, optional).
   * - `churnReason` is the Q7 structured taxonomy (`CHURN_REASON` enum,
   *   optional). Both are persisted independently so churn analytics can
   *   aggregate on the enum while still surfacing long-tail free-text.
   */
  async cancelSubscription(
    userId: string,
    orgId: string,
    reason?: string,
    churnReason?: string
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

      // Stripe refuses `cancel_at_period_end` on a subscription its schedule
      // manages (proof P3). Ours, carrying a waiting change of billing, is let
      // go first; the record stays, so a reactivate sets it again (T4).
      const live = await this.stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId
      );
      const schedule = await this.ourScheduleOrThrow(live, orgId);
      if (schedule) {
        await this.releaseSchedule(
          schedule,
          `billing-release-cancel_${schedule.id}_${sub.updatedAt.getTime()}`
        );
      }

      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await this.db
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLING,
          cancelReason: reason ?? null,
          churnReason: churnReason ?? null,
          ...(schedule && { stripeScheduleId: null }),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription cancelled at period end', {
        subscriptionId: sub.id,
        organizationId: orgId,
      });

      // Orchestrator hook: cancel flips status → CANCELLING. Library +
      // subscription badge must reflect it on every device within one
      // visibility tick.
      this.invalidateIfConfigured(userId, orgId, 'cancel');

      // Return { userId, orgId, subscription } so the route handler can feed
      // invalidateForUser (library + per-org subscription caches).
      return { userId, orgId, subscription: sub };
    } catch (error) {
      this.handleError(error, 'cancelSubscription');
    }
  }

  /**
   * Resume a user-initiated PAUSED subscription.
   *
   * Access-RESTORING counterpart to a user pausing via Stripe's billing
   * portal. Unlike `handleSubscriptionResumed` (the webhook-driven path that
   * reacts to `customer.subscription.resumed` fired by Stripe), this method
   * is the user-initiated flow: the client clicks "Resume plan" on the
   * pricing page / SubscribeButton, we call Stripe's `subscriptions.resume`
   * API, and flip the local DB row back to 'active'.
   *
   * Parallel to `reactivateSubscription` (which handles the
   * `cancelling → active` path). This method handles only the
   * `paused → active` path — which is distinct because:
   *   - `paused` subscriptions are NOT returned by `getSubscriptionOrThrow`
   *     (its whitelist excludes PAUSED). We query directly and throw
   *     `SubscriptionNotFoundError` on miss so the behaviour matches
   *     reactivate's "must be in the expected state" contract.
   *   - Stripe's resume API uses a dedicated method, not
   *     `subscriptions.update(cancel_at_period_end: false)`.
   *
   * On success:
   *   - Stripe call with `billing_cycle_anchor: 'unchanged'` keeps the
   *     existing cycle so the user isn't silently re-billed.
   *   - DB: `status` set to what Stripe's response reports (normally
   *     'active'), `updatedAt` bumped.
   *   - Orchestrator hook fires with reason `'subscription_resumed'` —
   *     same reason as the webhook handler so observability groups
   *     webhook-driven + user-initiated resumes under one tag.
   *
   * Revocation CLEAR is owned by the route layer (mirrors reactivate —
   * see `workers/ecom-api/src/routes/subscriptions.ts`).
   *
   * Idempotency: the key is per pause, not per subscription — see the call.
   */
  async resumeSubscription(
    userId: string,
    organizationId: string
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
    try {
      const [sub] = await this.db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.organizationId, organizationId),
            eq(subscriptions.status, SUBSCRIPTION_STATUS.PAUSED)
          )
        )
        .limit(1);

      if (!sub) {
        // Same error as reactivate's "not cancelling" miss — a sub must be
        // PAUSED to be resumable. Scoping (userId + organizationId) means
        // a cross-user attempt lands here too: correct (no information
        // disclosure) and matches the behaviour of `getSubscriptionOrThrow`.
        throw new SubscriptionNotFoundError({
          userId,
          organizationId,
          expectedStatus: SUBSCRIPTION_STATUS.PAUSED,
        });
      }

      // Resuming would make it a second live subscription to the org if the
      // user has subscribed again since: refused before Stripe is asked, so
      // nothing resumes there either (review T6).
      const otherLive = await (
        this.db as typeof import('@codex/database').dbWs
      ).transaction(async (tx) => {
        await this.lockSubscriber(tx, userId, organizationId);
        return this.otherLiveId(tx, sub);
      });
      if (otherLive) {
        throw new AlreadySubscribedError(userId, organizationId);
      }

      // One key per pause (Codex-2hxff.15, SUB-13): the row's `updatedAt`
      // moves when it is paused and again when it resumes, so a double click
      // replays while the next pause's resume is a new request. A key per
      // subscription made a second resume within Stripe's 24 hours replay the
      // first, and do nothing.
      const resumed = await this.stripe.subscriptions.resume(
        sub.stripeSubscriptionId,
        { billing_cycle_anchor: 'unchanged' },
        {
          idempotencyKey: `resume_${sub.stripeSubscriptionId}_${sub.updatedAt.getTime()}`,
        }
      );

      // Stripe's own answer, not a blanket ACTIVE: a resume can leave it
      // paused or past due until an invoice is paid.
      const status = resolveStatus(
        resumed.status,
        resumed.cancel_at_period_end ?? false,
        SUBSCRIPTION_STATUS.ACTIVE
      );
      await this.db
        .update(subscriptions)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription resumed by user', {
        subscriptionId: sub.id,
        organizationId,
        status,
      });

      // Orchestrator hook: resume is access-RESTORING — bump both caches
      // so other devices drop the PAUSED badge and re-show library items
      // immediately. Same reason tag as the webhook-driven resume so
      // observability groups them together. Clearing the KV revocation
      // key is still owned by the route (parallel to reactivate —
      // see routes/subscriptions.ts clearAccessRevocation).
      this.invalidateIfConfigured(
        userId,
        organizationId,
        'subscription_resumed'
      );

      return { userId, orgId: organizationId, subscription: sub };
    } catch (error) {
      this.handleError(error, 'resumeSubscription');
    }
  }

  /**
   * Reactivate a subscription that was set to cancel_at_period_end.
   * Only works if still within the active period.
   */
  async reactivateSubscription(
    userId: string,
    orgId: string
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

      if (sub.status !== SUBSCRIPTION_STATUS.CANCELLING) {
        throw new SubscriptionCheckoutError(
          'Can only reactivate a subscription that is set to cancel'
        );
      }

      const reactivated = await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        { cancel_at_period_end: false }
      );

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

      // A change of billing that survived the cancel waits again (T4): its
      // schedule is set once the cancel is undone, never before (proof P10).
      await this.rescheduleBillingChange(sub, reactivated, 'reactivate');

      // Orchestrator hook: reactivation restores access — bump both
      // caches so other devices drop the CANCELLING badge immediately.
      // Clearing the KV revocation key is a separate concern still
      // owned by the route (see routes/subscriptions.ts clearAccessRevocation).
      this.invalidateIfConfigured(userId, orgId, 'reactivate');

      // Return { userId, orgId, subscription } so the route handler can feed
      // invalidateForUser (library + per-org subscription caches).
      return { userId, orgId, subscription: sub };
    } catch (error) {
      this.handleError(error, 'reactivateSubscription');
    }
  }

  /**
   * Keep current plan: undo a move to a cheaper plan before it lands
   * (Codex-2hxff.16, decision T2; data design §4). Its own path, not a
   * change of plan: through `changeTier` it would be an "upgrade" from the
   * cheaper Price on the item, charging a part-period difference for a period
   * already paid at the held price.
   *
   * Re-reads the live subscription and makes one update: the EXACT held Price
   * back on the item (`codex_hold_price_id`, never the tier's current Price,
   * so a grandfathered member stays grandfathered) with no proration, the
   * move and hold keys cleared, and a price change parked from the held tier
   * live again. Nothing is charged: the period was paid at the held price.
   * The row at once: no move, and `amount_cents` back to the held amount.
   *
   * Idempotent: with nothing waiting it changes nothing. After the renewal
   * the move lands on (the cheaper bill is raised) it is refused with
   * `MoveAlreadyLandedError` (409), and the page reads the subscription
   * again.
   */
  async keepCurrentPlan(
    userId: string,
    orgId: string
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);
      const live = await this.stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId
      );
      const schedule = await this.ourScheduleOrThrow(live, orgId);
      const move = readWaitingMove(live.metadata);
      if (!move) {
        // Nothing waits at Stripe. A row still showing a move lags it (a
        // flip or a Keep whose own write failed): mirror it from Stripe.
        if (sub.pendingTierId) {
          await this.syncFromStripe(live, 'tier_move_kept');
        }
        return { userId, orgId, subscription: sub };
      }

      const item = live.items.data[0];
      if (!item) {
        throw new SubscriptionCheckoutError('No subscription item found');
      }
      if (item.current_period_start >= move.at) {
        throw new MoveAlreadyLandedError(orgId);
      }

      if (move.billing) {
        await this.keepYearlyBilling(sub, move, schedule);
        this.invalidateIfConfigured(userId, orgId, 'tier_move_kept');
        return { userId, orgId, subscription: sub };
      }
      // A plan move's Keep writes the item: one of our schedules left over
      // from a change of billing that landed is let go first (proof P4).
      if (schedule) {
        await this.releaseSchedule(
          schedule,
          `billing-release-keep_${schedule.id}_${sub.updatedAt.getTime()}`
        );
      }

      // The held tier may have been repriced while the move waited, which
      // archived the held Price (Part A rule 3, F2).
      await ensurePriceActive(this.stripe, move.holdPriceId);
      await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          items: [{ id: item.id, price: move.holdPriceId }],
          proration_behavior: 'none',
          metadata: keepMetadata(move),
        },
        // Per row version (resume's pattern, SUB-13): Keep, then a new move,
        // then Keep again inside Stripe's 24 hours must make a second write,
        // not replay the first and do nothing.
        {
          idempotencyKey: `keep_${sub.id}_${move.holdPriceId}_${move.at}_${sub.updatedAt.getTime()}`,
        }
      );

      const split = await this.computeSubscriptionSplit(
        orgId,
        move.holdAmountCents
      );
      try {
        await this.db
          .update(subscriptions)
          .set({
            ...NO_PENDING_MOVE,
            amountCents: move.holdAmountCents,
            platformFeeCents: split.platformFeeCents,
            organizationFeeCents: split.organizationFeeCents,
            creatorPayoutCents: split.creatorPayoutCents,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));
      } catch (dbError) {
        // As for a tier change (BUG-020): customer.subscription.updated
        // mirrors the cleared move from Stripe.
        this.obs.error(
          'keepCurrentPlan: DB update failed after Stripe succeeded — webhook will reconcile',
          {
            subscriptionId: sub.id,
            stripeSubscriptionId: sub.stripeSubscriptionId,
            error: (dbError as Error).message,
          }
        );
      }

      await this.rejoinPriceChange(sub, move);

      this.invalidateIfConfigured(userId, orgId, 'tier_move_kept');
      return { userId, orgId, subscription: sub };
    } catch (error) {
      this.handleError(error, 'keepCurrentPlan');
    }
  }

  /**
   * Keep current plan for a waiting change of billing (Codex-2hxff.97, data
   * design §3.5; Q4: one Keep undoes the whole change). The schedule goes
   * (proof P2: the year then renews yearly), then one metadata write clears
   * the record and puts a parked price change back. No item write: the item
   * never changed, so nothing is charged and the amount stands.
   */
  private async keepYearlyBilling(
    sub: Subscription,
    move: WaitingMove,
    schedule: Stripe.SubscriptionSchedule | null
  ): Promise<void> {
    if (schedule) {
      await this.releaseSchedule(
        schedule,
        `billing-keep_${schedule.id}_${sub.updatedAt.getTime()}`
      );
    }
    await this.stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      { metadata: keepMetadata(move) },
      {
        idempotencyKey: `keep-billing_${sub.id}_${move.at}_${sub.updatedAt.getTime()}`,
      }
    );
    try {
      await this.db
        .update(subscriptions)
        .set({
          ...NO_PENDING_MOVE,
          stripeScheduleId: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } catch (dbError) {
      // As for a tier change (BUG-020): customer.subscription.updated
      // mirrors the cleared change from Stripe.
      this.obs.error(
        'keepCurrentPlan: DB update failed after Stripe succeeded — webhook will reconcile',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          error: describeThrown(dbError),
        }
      );
    }
    await this.rejoinPriceChange(sub, move);
  }

  /**
   * Set the schedule again for a change of billing whose record survived
   * (§4.3, §5.2): after a reactivate, or by the hourly backstop. Only while
   * the change still waits, nothing is attached and the subscription is not
   * set to cancel (`from_subscription` would undo that, proof P10). Phase
   * 2's Price may have been archived by a re-price since (proof P12): it is
   * made billable first. One of ours already attached but half made, or
   * carrying an earlier choice, is finished in place instead
   * (`finishBillingSchedule`, review C1 cycle 2, L2), or let go for a cancel
   * (`released`). Never throws: a failure is a warning, and the backstop
   * sets it within the hour. `skipped`: there was nothing to set.
   */
  private async rescheduleBillingChange(
    sub: Pick<Subscription, 'id' | 'stripeSubscriptionId' | 'organizationId'>,
    live: Stripe.Subscription | undefined,
    reason: 'reactivate' | 'backstop'
  ): Promise<'set' | 'skipped' | 'failed' | 'released'> {
    const move = readWaitingMove(live?.metadata);
    const item = live?.items?.data?.[0];
    if (
      !live ||
      !move?.billing ||
      !item ||
      item.current_period_start >= move.at
    ) {
      return 'skipped';
    }
    const attachedId = scheduleIdOf(live);
    if (attachedId === null && live.cancel_at_period_end) return 'skipped';
    try {
      let scheduleId: string | null;
      if (attachedId !== null) {
        const schedule =
          await this.stripe.subscriptionSchedules.retrieve(attachedId);
        if (!isOurSchedule(schedule, live.metadata)) return 'skipped';
        const outcome = await this.finishBillingSchedule(
          sub,
          live,
          schedule,
          move,
          move.billing
        );
        if (outcome === 'released') return 'released';
        if (outcome === 'none') return 'skipped';
        scheduleId = schedule.id;
      } else {
        await ensurePriceActive(this.stripe, move.billing.priceId);
        scheduleId = await this.setBillingSchedule({
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          schedule: null,
          priceId: move.billing.priceId,
          targetTierId: move.tierId,
          moveAt: move.at,
          // One attempt per renewal of the record and run: a retry after a
          // failure is a new attempt, not a replay of the failed one.
          stamp: `${reason}-${Date.now()}`,
        });
      }
      // Set to cancel since the read (cycle 2, L1): the cancel is back, and
      // a cancelling subscription gets no schedule until it is reactivated.
      // `released`, as the finish's: `live` is from before the cancel, so
      // it is not mirrored over the row (cycle 3).
      if (scheduleId === null) return 'released';
      await this.db
        .update(subscriptions)
        .set({ stripeScheduleId: scheduleId, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
      this.obs.info('billing_change.rescheduled', {
        subscriptionId: sub.id,
        organizationId: sub.organizationId,
        stripeScheduleId: scheduleId,
        reason,
      });
      return 'set';
    } catch (error) {
      this.obs.warn(
        'billing_change.reschedule_failed: the hourly backstop sets it again',
        {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          organizationId: sub.organizationId,
          reason,
          error: describeThrown(error),
        }
      );
      return 'failed';
    }
  }

  /**
   * Rejoin a price change the member was skipped for while moving away
   * (Part A rule 3; data design §2.3): one `due` row in
   * `subscription_price_moves` (`source = 'keep_current_plan'`), so the
   * hourly step gives them the usual 30-day notice and then moves them,
   * rather than leaving them on the old price unnoticed
   * (`rejoinTierPriceChange`). Whether the kept tier was repriced is decided
   * there, under the tier row's lock, so a save running at the same time is
   * seen (review C1, F3); a second Keep's change of its own on the same tier
   * (`uq_price_changes_live_tier`) runs it once more, onto the first's.
   *
   * Keep has already put them back at Stripe and on our row, so a failure
   * here does not fail it: it is one error alert with an errorId and the
   * ids, for support to add them (the BUG-020 pattern above).
   */
  private async rejoinPriceChange(
    sub: Subscription,
    move: WaitingMove
  ): Promise<void> {
    const ids = {
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      organizationId: sub.organizationId,
      tierId: sub.tierId,
      billingInterval: sub.billingInterval,
      heldPriceId: move.holdPriceId,
    };
    const rejoin = () =>
      (this.db as typeof import('@codex/database').dbWs).transaction((tx) =>
        rejoinTierPriceChange(tx, {
          subscriptionId: sub.id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          organizationId: sub.organizationId,
          userId: sub.userId,
          tierId: sub.tierId,
          interval:
            sub.billingInterval === BILLING_INTERVAL.YEAR ? 'year' : 'month',
          heldPriceId: move.holdPriceId,
          heldAmountCents: move.holdAmountCents,
          parkedPendingPriceId: move.parkedPendingPrice?.priceId ?? null,
          now: new Date(),
        })
      );
    try {
      const result = await rejoin().catch((error: unknown) => {
        if (isUniqueViolation(error)) return rejoin();
        throw error;
      });
      this.obs.info('tier_move.kept', {
        ...ids,
        droppedTierId: move.tierId,
        heldTierRepriced: result.outcome !== 'not_repriced',
        alreadyTold: result.outcome === 'already_told',
        rejoined: result.outcome,
        ...('changeId' in result && { priceChangeId: result.changeId }),
        ...(result.outcome === 'due' && { priceMoveId: result.moveId }),
      });
      if (result.outcome === 'live_change_mismatch') {
        this.obs.error(
          'tier_move.kept: the kept tier was repriced, but its live price change is for another Price, so no notice was recorded; the member stays on the old price (support: check the tier and add them to its price change)',
          {
            errorId: crypto.randomUUID(),
            ...ids,
            priceChangeId: result.changeId,
          }
        );
      }
    } catch (error) {
      this.obs.error(
        "tier_move.kept: the kept tier was repriced, and the price-change notice could not be recorded; the member stays on the old price (support: add them to the tier's price change)",
        {
          errorId: crypto.randomUUID(),
          ...ids,
          error: describeThrown(error),
        }
      );
    }
  }

  // ─── Waiting tier moves: the renewal flip (Codex-2hxff.16, §5) ────────────

  /**
   * Flip a move to a cheaper plan once its renewal has happened — called for
   * every org `customer.subscription.updated` (Stripe sends one at each
   * renewal), after the DB sync, beside the pending price swap.
   *
   * It costs a Stripe call only when the event carries a move or our row
   * holds one; the decision is made on the LIVE subscription, since events
   * arrive late and out of order. Once the live period started on or after
   * the move's date, `codex_tier_id` becomes the target and the move and hold
   * keys go; then the row is mirrored from Stripe, and both caches bumped.
   *
   * - No status gate: a past-due or paused subscription flips too (a must on
   *   the bead). The price swap refuses them (`canSwapNow`), and copying that
   *   would leave a member on the dearer plan's films while billed the
   *   cheaper price. Only an ended subscription (`canceled`,
   *   `incomplete_expired`) never flips.
   * - A stale event (written before the flip, delivered after it) has
   *   already put the move back on the row: the live subscription has none,
   *   so the row is mirrored from it again.
   * - `codex_pending_price_*` is left alone: a price change on the target
   *   (T6) lands later through `applyDuePendingPriceChange`.
   * - A target tier deleted while the move waited never gets the member
   *   (`blocked`). `deleteTier` counts movers before its transaction, so a
   *   move written in between gets past it. This is the design's "flip fails
   *   permanently" row: one `tier_move.apply_failed` alert (reason
   *   `target_tier_deleted`, unless `alertIfBlocked` is false), nothing
   *   thrown, and the member keeps the dearer plan at the cheaper price until
   *   support or Keep current plan resolves it.
   *
   * Throws Stripe's errors: the webhook rethrows a transient one (Stripe
   * redelivers) and alerts a permanent one; the hourly backstop retries.
   */
  async applyDueTierMove(
    eventSubscription: Pick<Stripe.Subscription, 'id' | 'metadata'>,
    options: { alertIfBlocked?: boolean } = {}
  ): Promise<'applied' | 'not_due' | 'none' | 'blocked'> {
    const row = await this.findByStripeId(eventSubscription.id);
    // A change of billing flips by its schedule at the renewal, and the sync
    // before this has already cleared the row's move: the schedule mirrored
    // on the row is what is left to let go of (Codex-2hxff.97, §4.1).
    if (
      !eventSubscription.metadata?.[MOVE_TIER_ID_KEY] &&
      !row?.pendingTierId &&
      !row?.stripeScheduleId
    ) {
      return 'none';
    }
    if (row && isDuplicateSubscription(row)) return 'none';

    const live = await this.stripe.subscriptions.retrieve(eventSubscription.id);
    if (endedAtStripeStatus(live.status)) {
      // Ended at Stripe: the move survives a cancel only until then (T4).
      // Dropped from the row too, or the backstop would pick it every hour.
      if (row?.pendingTierId || row?.stripeScheduleId) {
        await this.db
          .update(subscriptions)
          .set({
            ...NO_PENDING_MOVE,
            stripeScheduleId: null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, row.id));
      }
      return 'none';
    }
    const scheduleId = scheduleIdOf(live);
    const schedule = scheduleId
      ? await this.stripe.subscriptionSchedules.retrieve(scheduleId)
      : null;
    const ours =
      schedule !== null && isOurSchedule(schedule, live.metadata)
        ? schedule
        : null;
    const move = readWaitingMove(live.metadata);
    if (!move) {
      // A change of billing that landed: Stripe flipped the tier and cleared
      // the record with phase 2's metadata (proof P6). Letting go of the
      // schedule now frees the subscription for cancel and price changes,
      // rather than a month on when the phase ends.
      if (ours && onLastPhase(ours)) {
        await this.releaseSchedule(ours, `billing-release_${ours.id}`);
        await this.syncFromStripe(
          { ...live, schedule: null },
          'tier_move_applied'
        );
        this.obs.info('billing_change.applied', {
          subscriptionId: row?.id ?? null,
          stripeSubscriptionId: live.id,
          stripeScheduleId: ours.id,
          tierId: live.metadata?.codex_tier_id ?? null,
        });
        return 'applied';
      }
      // Flipped or kept already: a row still showing the move lags Stripe (a
      // stale event), so mirror it from the live subscription.
      if ((row?.pendingTierId || row?.stripeScheduleId) && !row.endedAt) {
        await this.syncFromStripe(live, 'tier_move_applied');
      }
      return 'none';
    }

    const item = live.items.data[0];
    if (!item || item.current_period_start < move.at) {
      // Before the renewal, our schedule is finished if it does not carry
      // the change yet (review C1 cycle 2, L2). A failure is one alert and
      // waits for the member's next event; nothing here is due to flip.
      if (item && row && ours && move.billing) {
        try {
          const outcome = await this.finishBillingSchedule(
            row,
            live,
            ours,
            move,
            move.billing
          );
          if (outcome !== 'none') {
            this.obs.info('billing_change.finished', {
              subscriptionId: row.id,
              stripeSubscriptionId: live.id,
              stripeScheduleId: ours.id,
              outcome,
            });
          }
        } catch (error) {
          this.obs.error(
            'billing_change.finish_failed: our schedule does not carry the waiting change of billing and could not be finished, or let go for a cancel; unless it is, the year renews yearly, or the cancel is lost (support: docs/payments/subscriptions.md → Waiting changes of billing)',
            {
              errorId: crypto.randomUUID(),
              subscriptionId: row.id,
              stripeSubscriptionId: live.id,
              stripeScheduleId: ours.id,
              organizationId: row.organizationId,
              endBehavior: ours.end_behavior,
              cancelAtPeriodEnd: live.cancel_at_period_end,
              error: describeThrown(error),
            }
          );
        }
      }
      return 'not_due';
    }

    const organizationId =
      row?.organizationId ?? live.metadata?.codex_organization_id ?? null;
    if (!(await this.isLiveTier(move.tierId, organizationId))) {
      if (options.alertIfBlocked ?? true) {
        this.obs.error('tier_move.apply_failed', {
          errorId: crypto.randomUUID(),
          reason: 'target_tier_deleted',
          subscriptionId: row?.id ?? null,
          stripeSubscriptionId: live.id,
          organizationId,
          tierId: live.metadata?.codex_tier_id ?? row?.tierId ?? null,
          targetTierId: move.tierId,
          message:
            'A waiting tier move targets a deleted tier and was not flipped; the member keeps the dearer plan at the cheaper price (support: docs/payments/subscriptions.md → Waiting moves)',
        });
      }
      return 'blocked';
    }

    // A change of billing whose renewal billed the year again: its schedule
    // was not there to switch the Price (let go by a cancel, say, and not
    // set again). Flipping the tier now would bill the old plan's yearly
    // Price on the new plan, so it is left for support, as a deleted target.
    const billedInterval = item.price.recurring?.interval;
    if (
      move.billing &&
      billedInterval &&
      billedInterval !== move.billing.interval
    ) {
      if (options.alertIfBlocked ?? true) {
        this.obs.error('tier_move.apply_failed', {
          errorId: crypto.randomUUID(),
          reason: 'billing_not_switched',
          subscriptionId: row?.id ?? null,
          stripeSubscriptionId: live.id,
          organizationId,
          tierId: live.metadata?.codex_tier_id ?? row?.tierId ?? null,
          targetTierId: move.tierId,
          message:
            'A waiting change of billing passed its renewal without its schedule; the renewal billed the old billing period (support: docs/payments/subscriptions.md → Waiting changes of billing)',
        });
      }
      return 'blocked';
    }

    // Phase 2's metadata missed (or a plan move): the flip as ever. Our
    // schedule, its change landed, is let go after it.
    const flipped = await this.stripe.subscriptions.update(
      live.id,
      { metadata: flipMetadata(move) },
      { idempotencyKey: `move-apply:${live.id}:${move.tierId}:${move.at}` }
    );
    if (ours) {
      await this.releaseSchedule(ours, `billing-release_${ours.id}`);
    }
    await this.syncFromStripe(
      ours ? { ...flipped, schedule: null } : flipped,
      'tier_move_applied'
    );
    this.obs.info('tier_move.applied', {
      subscriptionId: row?.id ?? null,
      stripeSubscriptionId: live.id,
      tierId: move.tierId,
      status: live.status,
    });
    return 'applied';
  }

  /** The tier exists in the organisation and is not deleted. */
  private async isLiveTier(
    tierId: string,
    organizationId: string | null
  ): Promise<boolean> {
    if (!organizationId) return false;
    const [tier] = await this.db
      .select({ id: subscriptionTiers.id })
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.organizationId, organizationId),
          isNull(subscriptionTiers.deletedAt)
        )
      )
      .limit(1);
    return tier !== undefined;
  }

  /**
   * The hourly backstop for a flip the webhook missed (data design §5.2): the
   * moves whose renewal is more than an hour past, oldest first, at most
   * `TIER_MOVE_BACKSTOP_LIMIT`, each through `applyDueTierMove`. About two
   * Stripe calls each. One row's failure never stops the rest; whatever is
   * still waiting afterwards is alerted, once, with its ids. Never throws.
   * It rides ecom-api's existing hourly wake: no polling.
   *
   * A move blocked by a deleted target stays waiting, so every run would
   * pick it. It is alerted at most once a day instead: on the run where it
   * is 1, 25, 49… whole hours overdue. `now` is the cron's scheduled time,
   * exactly an hour apart, so the overdue hours of successive runs are
   * consecutive and one run in every 24 alerts.
   */
  async runTierMoveBackstop(
    options: { limit?: number; graceMs?: number; now?: Date } = {}
  ): Promise<{
    checked: number;
    applied: number;
    left: number;
    blocked: number;
    /** Waiting changes of billing found without their schedule, and set again. */
    billingChecked: number;
    rescheduled: number;
  }> {
    const limit = options.limit ?? TIER_MOVE_BACKSTOP_LIMIT;
    const now = options.now ?? new Date();
    const before = new Date(
      now.getTime() - (options.graceMs ?? TIER_MOVE_BACKSTOP_GRACE_MS)
    );
    let rows: Array<{
      id: string;
      stripeSubscriptionId: string;
      pendingTierFrom: Date | null;
    }>;
    try {
      rows = await this.db
        .select({
          id: subscriptions.id,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          pendingTierFrom: subscriptions.pendingTierFrom,
        })
        .from(subscriptions)
        .where(
          and(
            isNotNull(subscriptions.pendingTierId),
            lt(subscriptions.pendingTierFrom, before),
            ne(subscriptions.status, SUBSCRIPTION_STATUS.CANCELLED)
          )
        )
        .orderBy(subscriptions.pendingTierFrom)
        .limit(limit);
    } catch (error) {
      this.obs.error('tier_move.apply_failed', {
        errorId: crypto.randomUUID(),
        stage: 'backstop_select',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        checked: 0,
        applied: 0,
        left: 0,
        blocked: 0,
        ...(await this.restoreBillingSchedules(now, limit)),
      };
    }

    let applied = 0;
    let blocked = 0;
    const left: Array<{
      subscriptionId: string;
      stripeSubscriptionId: string;
      outcome: string;
    }> = [];
    for (const row of rows) {
      const overdueHours = row.pendingTierFrom
        ? Math.floor(
            (now.getTime() - row.pendingTierFrom.getTime()) / TIER_MOVE_HOUR_MS
          )
        : 0;
      try {
        const outcome = await this.applyDueTierMove(
          { id: row.stripeSubscriptionId, metadata: {} },
          { alertIfBlocked: overdueHours % 24 === 1 }
        );
        if (outcome === 'blocked') {
          // Alerted by applyDueTierMove on its day; never in `left`, which
          // alerts every run.
          blocked += 1;
        } else if (outcome === 'applied') {
          applied += 1;
          this.obs.info('tier_move.backstop_applied', {
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
          });
        } else if (outcome === 'not_due') {
          left.push({
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            outcome,
          });
        }
      } catch (error) {
        left.push({
          subscriptionId: row.id,
          stripeSubscriptionId: row.stripeSubscriptionId,
          outcome: `failed: ${stripeErrorCode(error) ?? (error instanceof Error ? error.message : String(error))}`,
        });
      }
    }

    if (left.length > 0) {
      this.obs.error('tier_move.apply_failed', {
        errorId: crypto.randomUUID(),
        stage: 'backstop',
        message:
          'Waiting tier moves past their renewal could not be flipped; each member keeps the dearer plan at the cheaper price until they are (support: check the Stripe subscription)',
        left,
      });
    }
    return {
      checked: rows.length,
      applied,
      left: left.length,
      blocked,
      ...(await this.restoreBillingSchedules(now, limit)),
    };
  }

  /**
   * The backstop's second step (Codex-2hxff.97, data design §5.2): a waiting
   * change of billing whose schedule is missing. A reactivate or a C(b)
   * whose schedule write failed leaves one, as does an undo that could not
   * clear the record (the member asked for the change). Selected:
   * `pending_billing_interval` set, no `stripe_schedule_id`, live and not
   * set to cancel, the renewal still ahead; oldest first, at most `limit`.
   * With nothing broken it selects nothing and asks Stripe nothing. Each is
   * re-read live: a schedule there is mirrored only; else it is set again
   * (about three calls). Never throws; what is left is alerted once a run.
   */
  private async restoreBillingSchedules(
    now: Date,
    limit: number
  ): Promise<{ billingChecked: number; rescheduled: number }> {
    let rows: Array<
      Pick<Subscription, 'id' | 'stripeSubscriptionId' | 'organizationId'>
    >;
    try {
      rows = await this.db
        .select({
          id: subscriptions.id,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          organizationId: subscriptions.organizationId,
        })
        .from(subscriptions)
        .where(
          and(
            isNotNull(subscriptions.pendingBillingInterval),
            isNull(subscriptions.stripeScheduleId),
            inArray(subscriptions.status, [
              SUBSCRIPTION_STATUS.ACTIVE,
              SUBSCRIPTION_STATUS.PAST_DUE,
            ]),
            eq(subscriptions.cancelAtPeriodEnd, false),
            gt(subscriptions.pendingTierFrom, now)
          )
        )
        .orderBy(subscriptions.pendingTierFrom)
        .limit(limit);
    } catch (error) {
      this.obs.error('billing_change.backstop_failed', {
        errorId: crypto.randomUUID(),
        stage: 'select',
        error: describeThrown(error),
      });
      return { billingChecked: 0, rescheduled: 0 };
    }

    let rescheduled = 0;
    const left: Array<{
      subscriptionId: string;
      stripeSubscriptionId: string;
      outcome: string;
    }> = [];
    for (const row of rows) {
      try {
        const live = await this.stripe.subscriptions.retrieve(
          row.stripeSubscriptionId
        );
        const outcome = await this.rescheduleBillingChange(
          row,
          live,
          'backstop'
        );
        if (outcome === 'set') {
          rescheduled += 1;
        } else if (outcome === 'failed') {
          left.push({
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            outcome,
          });
        } else if (outcome === 'skipped') {
          // Nothing to set at Stripe (a schedule there, the record gone, or
          // set to cancel): the row lags it.
          await this.syncFromStripe(live, 'tier_move_scheduled');
        }
        // 'released': let go for a cancel; `live` still shows it attached,
        // and the events the release and the cancel fire mirror them.
      } catch (error) {
        left.push({
          subscriptionId: row.id,
          stripeSubscriptionId: row.stripeSubscriptionId,
          outcome: `failed: ${stripeErrorCode(error) ?? describeThrown(error)}`,
        });
      }
    }
    if (left.length > 0) {
      this.obs.error('billing_change.backstop_failed', {
        errorId: crypto.randomUUID(),
        stage: 'reschedule',
        message:
          'Waiting changes of billing have no schedule and could not be given one; each member renews on yearly billing unless one is set before the renewal (support: docs/payments/subscriptions.md → Waiting changes of billing)',
        left,
      });
    }
    return { billingChecked: rows.length, rescheduled };
  }

  /**
   * The hourly price-moves step (Codex-2hxff.86; price-moves-sweep.ts): tell
   * and move the people a price change recorded, tiers and course plans
   * alike, at most `PRICE_MOVES_PER_RUN` a run. Nothing on the 08:00 London
   * run. A member waiting to move to a repriced tier gets their caches
   * bumped once their later price is set, so their account shows it. Never
   * throws.
   */
  async runPriceMoves(
    scheduledTime: Date,
    options: Omit<PriceMoveStepOptions, 'now'> = {}
  ): Promise<PriceMoveStepResult> {
    return runPriceMoveStep(
      {
        db: this.db,
        stripe: this.stripe,
        mailer: this.mailer,
        obs: this.obs,
        webAppUrl: this.webAppUrl,
        onMoverScheduled: ({ userId, organizationId }) =>
          this.invalidateIfConfigured(
            userId,
            organizationId,
            'subscription_updated'
          ),
      },
      { ...options, now: scheduledTime }
    );
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get a user's current subscription for an org (with tier details), without
   * the fee split ({@link SUBSCRIBER_HIDDEN_COLUMNS}), and any move to a
   * cheaper plan waiting for the renewal (`pendingTierChange`).
   */
  async getSubscription(
    userId: string,
    orgId: string
  ): Promise<SubscriptionWithTier | null> {
    const result = await this.db.query.subscriptions.findFirst({
      columns: SUBSCRIBER_HIDDEN_COLUMNS,
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
    if (!result) return null;

    const moves = await this.pendingTierChanges([result]);
    return { ...result, pendingTierChange: moves.get(result.id) ?? null };
  }

  /**
   * The waiting move of each row that holds one (data design §2.3), by row
   * id: one read, joined to the target tier, and only when a row has a move
   * (`held_amount_cents` is set exactly when one waits). A second read finds
   * the later price, if any (`laterPrices`).
   */
  private async pendingTierChanges(
    rows: ReadonlyArray<{ id: string; heldAmountCents: number | null }>
  ): Promise<Map<string, PendingTierChange>> {
    const moving = rows
      .filter((row) => row.heldAmountCents !== null)
      .map((row) => row.id);
    const found = new Map<string, PendingTierChange>();
    if (moving.length === 0) return found;

    const targets = await this.db
      .select({
        id: subscriptions.id,
        currentTierId: subscriptions.tierId,
        tierId: subscriptions.pendingTierId,
        effectiveAt: subscriptions.pendingTierFrom,
        amountCents: subscriptions.amountCents,
        billingInterval: subscriptions.billingInterval,
        pendingBillingInterval: subscriptions.pendingBillingInterval,
        pendingAmountCents: subscriptions.pendingAmountCents,
        tierName: subscriptionTiers.name,
      })
      .from(subscriptions)
      .innerJoin(
        subscriptionTiers,
        eq(subscriptionTiers.id, subscriptions.pendingTierId)
      )
      .where(inArray(subscriptions.id, moving));
    const later = await this.laterPrices(moving);
    for (const target of targets) {
      if (!target.tierId || !target.effectiveAt) continue;
      // A change of billing lands on its own interval and first bill; the
      // row's amount is still the yearly price paid now (Codex-2hxff.97).
      const billing = target.pendingBillingInterval !== null;
      const interval = target.pendingBillingInterval ?? target.billingInterval;
      found.set(target.id, {
        kind: !billing
          ? 'plan'
          : target.tierId === target.currentTierId
            ? 'billing'
            : 'plan_and_billing',
        tierId: target.tierId,
        tierName: target.tierName,
        amountCents: target.pendingAmountCents ?? target.amountCents,
        billingInterval:
          interval === BILLING_INTERVAL.YEAR
            ? BILLING_INTERVAL.YEAR
            : BILLING_INTERVAL.MONTH,
        effectiveAt: target.effectiveAt.toISOString(),
        laterPrice: later.get(target.id) ?? null,
      });
    }
    return found;
  }

  /**
   * T6: a member waiting to move to a tier that was repriced moves at the
   * price they confirmed, then pays the new one from a later renewal. Their
   * `subscription_price_moves` row for the target's newest change they were
   * told about gives it: `scheduled`, or `notified` (told, the Stripe write
   * still to land) on a change still running. A row still `due` hasn't been
   * told, so it shows nothing yet; until then an earlier change they were
   * told about still stands, as it does at Stripe. Only a change on the
   * interval the move lands on counts: a change of billing leaves the
   * other one's prices behind (Codex-2hxff.97). One read, by row id
   * (`idx_price_moves_subscription`).
   */
  private async laterPrices(
    subscriptionIds: string[]
  ): Promise<Map<string, { amountCents: number; effectiveAt: string }>> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT ON (m."subscription_id") m."subscription_id",
             c."new_amount_cents", m."effective_at"
        FROM ${subscriptionPriceMoves} m
        JOIN ${priceChanges} c ON c."id" = m."price_change_id"
        JOIN ${subscriptions} s ON s."id" = m."subscription_id"
       WHERE m."subscription_id" IN (${sql.join(
         subscriptionIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
         AND c."tier_id" = s."pending_tier_id"
         AND c."interval" = COALESCE(s."pending_billing_interval", s."billing_interval")
         AND m."effective_at" IS NOT NULL
         AND (m."state" = 'scheduled'
              OR (m."state" = 'notified' AND c."state" = 'running'))
       ORDER BY m."subscription_id", c."created_at" DESC, c."id" DESC
    `);
    const found = new Map<
      string,
      { amountCents: number; effectiveAt: string }
    >();
    for (const row of result.rows as Array<{
      subscription_id: string;
      new_amount_cents: number;
      effective_at: string | Date;
    }>) {
      found.set(row.subscription_id, {
        amountCents: Number(row.new_amount_cents),
        effectiveAt: new Date(row.effective_at).toISOString(),
      });
    }
    return found;
  }

  /**
   * Get all of a user's active subscriptions across orgs, without the fee
   * split ({@link SUBSCRIBER_HIDDEN_COLUMNS}), each with any waiting move.
   */
  async getUserSubscriptions(userId: string): Promise<SubscriptionWithOrg[]> {
    const results = await this.db.query.subscriptions.findMany({
      columns: SUBSCRIBER_HIDDEN_COLUMNS,
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
        // The four fields the account page shows, never the row: a
        // subscriber is not a member, and the row carried the payee's user id
        // (Codex-kk6zx). The `as SubscriptionWithOrg[]` cast this replaced
        // let the whole row pass for these four.
        organization: {
          columns: { id: true, name: true, slug: true, logoUrl: true },
        },
      },
      orderBy: [desc(subscriptions.createdAt)],
    });

    const moves = await this.pendingTierChanges(results);
    return results.map((row) => ({
      ...row,
      pendingTierChange: moves.get(row.id) ?? null,
    }));
  }

  /**
   * List subscribers for an org (studio Subscribers page).
   *
   * Joins `subscriptions` with `users` and `subscriptionTiers` and flattens
   * the result into `SubscriberListItem` rows the studio table consumes
   * directly (no extra fetches needed for tier name or avatar).
   *
   * Filters:
   *  - `tierId` — narrow to a single tier (powers the tier chip group)
   *  - `status` — explicit status filter (overrides the default exclusion)
   *  - `includeCancelled` — when true, drops the BUG-023 default exclusion
   *    so cancelled rows appear in the list (ignored if `status` is set)
   *  - `search` — case-insensitive ILIKE across user name + email
   *
   * Default behaviour (no `status`, no `includeCancelled`) excludes
   * cancelled subscriptions — BUG-023 regression guard. The test
   * "excludes cancelled by default" in the test file pins this.
   */
  async listSubscribers(
    orgId: string,
    options: {
      page: number;
      limit: number;
      tierId?: string;
      status?: string;
      includeCancelled?: boolean;
      search?: string;
    }
  ): Promise<PaginatedListResponse<SubscriberListItem>> {
    const { page, limit, tierId, status, includeCancelled, search } = options;
    const offset = (page - 1) * limit;

    // A duplicate subscription was refunded and never subscribed anyone
    // (Codex-2hxff.15): it is no subscriber, cancelled or not.
    const conditions = [
      eq(subscriptions.organizationId, orgId),
      isNull(subscriptions.duplicateOfSubscriptionId),
    ];
    if (tierId) conditions.push(eq(subscriptions.tierId, tierId));
    if (status) {
      conditions.push(eq(subscriptions.status, status));
    } else if (!includeCancelled) {
      // BUG-023: Exclude cancelled subscriptions by default
      conditions.push(
        inArray(subscriptions.status, [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.CANCELLING,
          SUBSCRIPTION_STATUS.PAST_DUE,
        ])
      );
    }
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        sql`(${users.name} ILIKE ${pattern} OR ${users.email} ILIKE ${pattern})`
      );
    }

    const [rows, [totalResult]] = await Promise.all([
      this.db
        .select({
          id: subscriptions.id,
          userId: subscriptions.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatarUrl: sql<
            string | null
          >`COALESCE(${users.avatarUrl}, ${users.image})`,
          tierId: subscriptions.tierId,
          tierName: subscriptionTiers.name,
          status: subscriptions.status,
          billingInterval: subscriptions.billingInterval,
          amountCents: subscriptions.amountCents,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          cancelledAt: subscriptions.cancelledAt,
          churnReason: subscriptions.churnReason,
          createdAt: subscriptions.createdAt,
        })
        .from(subscriptions)
        .innerJoin(users, eq(subscriptions.userId, users.id))
        .innerJoin(
          subscriptionTiers,
          eq(subscriptions.tierId, subscriptionTiers.id)
        )
        .where(and(...conditions))
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .innerJoin(users, eq(subscriptions.userId, users.id))
        .innerJoin(
          subscriptionTiers,
          eq(subscriptions.tierId, subscriptionTiers.id)
        )
        .where(and(...conditions)),
    ]);

    const total = totalResult?.count ?? 0;

    const items: SubscriberListItem[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      userAvatarUrl: r.userAvatarUrl,
      tierId: r.tierId,
      tierName: r.tierName,
      status: r.status,
      billingInterval: r.billingInterval,
      amountCents: r.amountCents,
      currency: CURRENCY.GBP,
      currentPeriodStart: toIso(r.currentPeriodStart),
      currentPeriodEnd: toIso(r.currentPeriodEnd),
      cancelAtPeriodEnd: r.cancelAtPeriodEnd,
      cancelledAt: toIso(r.cancelledAt),
      churnReason: r.churnReason,
      createdAt: toIso(r.createdAt),
    }));

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
    // BUG-024: totalSubscribers should only count active/cancelling/past_due, not cancelled
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} IN ('active', 'cancelling', 'past_due'))::int`,
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

  /**
   * Codex-zqaxo / Codex-bxpmu: list payouts for an org owner's
   * `/studio/payouts` table.
   *
   * Scoping invariant (HARD): rows MUST be filtered by
   * `payouts.organizationId = orgId`. The route layer applies
   * `requireOrgManagement` so `orgId === ctx.organizationId`. Filtering by
   * `userId` here would leak cross-org payouts because a creator can belong
   * to multiple orgs — never relax to user-only scoping.
   *
   * Status filter semantics (reads the persisted `status` column directly —
   * the CHECK constraint guarantees the value is one of paid/pending/failed):
   *  - `pending`  → `status = 'pending'`
   *  - `resolved` → `status = 'paid'` (URL alias retained one release; PR 3
   *                 introduces the canonical `'paid'` chip)
   *  - `failed`   → `status = 'failed'`
   *  - `all`      → no status predicate
   *
   * The creator name/avatar denorm comes from a LEFT JOIN on `users` so a
   * deleted user row does not drop the payout from the table.
   */
  /**
   * Build the WHERE-clause predicate array shared by `listPayoutsByOrg` and
   * `getPayoutsByCreatorBreakdown`. Extracted so the table and the rail
   * always read from the SAME row set — when the user toggles a filter chip,
   * both surfaces reshape together rather than diverging.
   *
   * Status semantics match `listPayoutsByOrg`'s original inline logic:
   *  - `'paid'` and `'resolved'` both map to the persisted `status='paid'`
   *    (the legacy 'resolved' URL alias survives one release).
   *  - `'needs_attention'` is a single chip combining pending + failed.
   *  - `'all'` and missing status apply NO predicate.
   *
   * Date conditions use the helper `dateWindow(createdAt, from, to)` so empty
   * args produce no SQL clauses (rather than `WHERE TRUE`).
   */
  /**
   * Status/source/date predicates shared by EVERY payout surface — the org
   * table/rail (`buildPayoutConditions`) AND the creator earnings hub
   * (`buildCreatorPayoutConditions`). Carries NO scope predicate, so chip
   * semantics (a `needs_attention` chip means pending|failed everywhere) stay
   * single-sourced regardless of whether the caller scopes by org or by user.
   */
  private buildPayoutFilterConditions(options: PayoutFilterOptions) {
    const {
      status = 'all',
      sourceType = 'all',
      fromDate,
      toDate,
      transferredFrom,
    } = options;
    // Seed from dateWindow (SQL[], empty when no dates) into a fresh mutable
    // array so the element type is inferred without importing the SQL type.
    const conditions = [...dateWindow(payouts.createdAt, fromDate, toDate)];
    if (transferredFrom) {
      // The same transferredAt `bankOnFor` dates a row by (web r2 R2-L3).
      conditions.push(
        sql`COALESCE(${payouts.resolvedAt}, ${payouts.createdAt}) >= ${new Date(transferredFrom).toISOString()}::timestamptz`
      );
    }

    if (status === 'pending') {
      conditions.push(eq(payouts.status, 'pending'));
    } else if (status === 'paid' || status === 'resolved') {
      conditions.push(eq(payouts.status, 'paid'));
    } else if (status === 'failed') {
      conditions.push(eq(payouts.status, 'failed'));
    } else if (status === 'reversed') {
      conditions.push(eq(payouts.status, 'reversed'));
    } else if (status === 'cancelled_by_refund') {
      conditions.push(eq(payouts.status, 'cancelled_by_refund'));
    } else if (status === 'cancelled_by_dispute') {
      conditions.push(eq(payouts.status, 'cancelled_by_dispute'));
    } else if (status === 'needs_attention') {
      conditions.push(inArray(payouts.status, ['pending', 'failed']));
    }

    if (sourceType === 'purchase' || sourceType === 'subscription') {
      conditions.push(eq(payouts.sourceType, sourceType));
    }

    return conditions;
  }

  /**
   * Org-scoped payout predicate set (the `/studio/payouts` table + rail).
   * Scope predicate first, shared chip filters appended.
   */
  private buildPayoutConditions(orgId: string, options: PayoutFilterOptions) {
    return [
      eq(payouts.organizationId, orgId),
      ...this.buildPayoutFilterConditions(options),
    ];
  }

  /**
   * Creator-scoped payout predicate set (Codex-69t7c.7 / WP7). Scopes by the
   * acting user across ALL orgs and to their PERSONAL earning payout types
   * only ({@link CREATOR_EARNING_PAYOUT_TYPES}) — the `eq(userId)` predicate is
   * the security boundary that keeps one creator from reading another's
   * payouts. Shares the chip filters with the org surfaces.
   */
  private buildCreatorPayoutConditions(
    userId: string,
    options: PayoutFilterOptions
  ) {
    return [
      eq(payouts.userId, userId),
      inArray(payouts.payoutType, [...CREATOR_EARNING_PAYOUT_TYPES]),
      ...this.buildPayoutFilterConditions(options),
    ];
  }

  async listPayoutsByOrg(
    orgId: string,
    options: {
      page: number;
      limit: number;
    } & PayoutFilterOptions
  ): Promise<PaginatedListResponse<PayoutWithCreator>> {
    const { page, limit } = options;
    const offset = (page - 1) * limit;

    const conditions = this.buildPayoutConditions(orgId, options);

    // Alias the users table a second time so we can left-join the
    // subscriber (customer who paid the invoice) alongside the existing
    // creator (beneficiary) join. Drizzle aliasedTable returns a typed
    // proxy that participates in joins + select projection naturally.
    const subscriber = aliasedTable(users, 'subscriber');

    // Codex-e2773: paginate by transferGroup, not by row, so all siblings
    // of one charge land on the same page. NULL transferGroup (legacy
    // rows / writers that didn't set it) falls back to the row id so
    // each becomes its own pseudo-group. The "total" exposed to the UI
    // is the number of DISTINCT groups — pagination reflects the
    // operator's mental model (one charge = one row + banner).
    const groupKeyExpr = sql<string>`COALESCE(${payouts.transferGroup}, ${payouts.id}::text)`;
    const groupLatestExpr = sql<string>`MAX(${payouts.createdAt})`;

    const [windowedGroups, [totalResult]] = await Promise.all([
      this.db
        .select({ groupKey: groupKeyExpr })
        .from(payouts)
        .where(and(...conditions))
        .groupBy(groupKeyExpr)
        .orderBy(desc(groupLatestExpr))
        .limit(limit)
        .offset(offset),
      this.db
        .select({
          count: sql<number>`COUNT(DISTINCT ${groupKeyExpr})::int`,
        })
        .from(payouts)
        .where(and(...conditions)),
    ]);

    const groupKeys = windowedGroups.map((g) => g.groupKey);
    const total = totalResult?.count ?? 0;

    const items =
      groupKeys.length === 0
        ? []
        : await this.db
            .select({
              id: payouts.id,
              creatorId: payouts.userId,
              creatorName: users.name,
              creatorEmail: users.email,
              creatorAvatarUrl: users.image,
              amountCents: payouts.amountCents,
              currency: payouts.currency,
              reason: payouts.reason,
              status: payouts.status,
              payoutType: payouts.payoutType,
              resolvedAt: payouts.resolvedAt,
              stripeTransferId: payouts.stripeTransferId,
              createdAt: payouts.createdAt,
              subscriberName: subscriber.name,
              subscriberEmail: subscriber.email,
              sourceType: payouts.sourceType,
              // Codex-6nt4l: transaction grouping + drill-down hooks.
              transferGroup: payouts.transferGroup,
              purchaseId: payouts.purchaseId,
              subscriptionId: payouts.subscriptionId,
              stripeChargeId: payouts.stripeChargeId,
            })
            .from(payouts)
            .leftJoin(users, eq(payouts.userId, users.id))
            .leftJoin(
              subscriptions,
              eq(payouts.subscriptionId, subscriptions.id)
            )
            .leftJoin(subscriber, eq(subscriptions.userId, subscriber.id))
            .where(and(...conditions, inArray(groupKeyExpr, groupKeys)))
            // Codex-e2773: siblings in one transferGroup share createdAt to
            // ms precision (same webhook handler). Secondary keys on
            // payoutType + id stabilise the within-group order so the
            // banner-first/children-after render stays predictable.
            .orderBy(desc(payouts.createdAt), payouts.payoutType, payouts.id);

    const bankDates = await this.bankDatesFor(
      items.flatMap((row) => (row.creatorId ? [row.creatorId] : []))
    );
    const datesOf = (creatorId: string | null) =>
      creatorId ? bankDates.get(creatorId) : undefined;

    return {
      items: items.map((row) => ({
        id: row.id,
        creatorId: row.creatorId,
        creatorName: row.creatorName ?? null,
        creatorEmail: row.creatorEmail ?? null,
        creatorAvatarUrl: row.creatorAvatarUrl ?? null,
        amountCents: row.amountCents,
        currency: row.currency,
        reason: row.reason ?? '',
        status: derivePayoutStatus(row.status),
        resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
        stripeTransferId: row.stripeTransferId,
        createdAt: row.createdAt.toISOString(),
        payoutType: row.payoutType as PayoutType,
        subscriberName: row.subscriberName ?? null,
        subscriberEmail: row.subscriberEmail ?? null,
        sourceType: row.sourceType as 'purchase' | 'subscription',
        transferGroup: row.transferGroup ?? null,
        purchaseId: row.purchaseId ?? null,
        subscriptionId: row.subscriptionId ?? null,
        stripeChargeId: row.stripeChargeId ?? null,
        bankOn: bankOnFor(
          row,
          datesOf(row.creatorId)?.manualSince ?? null,
          datesOf(row.creatorId)?.cleared ?? null
        ),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * What `bankOn` needs per payee, from `connect_balances`:
   *   - `manualSince`: when the daily job started paying them out
   *     (`manual_payouts_since`), the earliest of their accounts (a payee
   *     normally has one; a replaced account keeps its row and is paid out);
   *   - `cleared`: the last below-zero episode that ended (`cleared_since`
   *     to `cleared_at`), the latest of their accounts. Only the last is
   *     kept, so an earlier episode's dates can't be moved.
   */
  private async bankDatesFor(
    userIds: string[]
  ): Promise<
    Map<string, { manualSince: Date; cleared: ClearedEpisode | null }>
  > {
    const dates = new Map<
      string,
      { manualSince: Date; cleared: ClearedEpisode | null }
    >();
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return dates;
    const rows = await this.db
      .select({
        userId: connectBalances.userId,
        manualPayoutsSince: connectBalances.manualPayoutsSince,
        clearedSince: connectBalances.clearedSince,
        clearedAt: connectBalances.clearedAt,
      })
      .from(connectBalances)
      .where(
        and(
          inArray(connectBalances.userId, ids),
          isNotNull(connectBalances.manualPayoutsSince)
        )
      );
    for (const row of rows) {
      if (!row.manualPayoutsSince) continue;
      const known = dates.get(row.userId);
      const cleared =
        row.clearedSince && row.clearedAt
          ? { since: row.clearedSince, clearedAt: row.clearedAt }
          : null;
      dates.set(row.userId, {
        manualSince:
          known && known.manualSince < row.manualPayoutsSince
            ? known.manualSince
            : row.manualPayoutsSince,
        cleared:
          known?.cleared &&
          (!cleared || known.cleared.clearedAt > cleared.clearedAt)
            ? known.cleared
            : cleared,
      });
    }
    return dates;
  }

  /**
   * Aggregate KPI numbers for the studio payouts summary row (Codex-05vp8).
   *
   * Four parallel aggregates — pattern from
   * `AdminAnalyticsService.getRevenueByCreator`. All scoped by org; the
   * date window only narrows `earnedInPeriodCents`. `inTransitCents` and
   * `needsAttentionCount` are lifetime so creators always see what's stuck
   * regardless of date filter.
   */
  async getPayoutSummary(
    orgId: string,
    options: { fromDate?: string; toDate?: string } = {}
  ): Promise<PayoutSummary> {
    const { fromDate, toDate } = options;

    // Three parallel aggregates:
    // 1. Paid earnings — one query returns both lifetime + windowed via
    //    CASE WHEN, saving a round-trip vs. two separate SUMs over the
    //    same WHERE clause. When no date window is set, the windowed
    //    column collapses to the lifetime aggregate.
    // 2. In-transit (status='pending') sum.
    // 3. Needs-attention (pending OR failed) count.
    //
    // The platform's own fee rows carry the org id but are not the org's
    // money, so every total leaves them out (Codex-2hxff.15, SUB-20).
    const orgScope = [
      eq(payouts.organizationId, orgId),
      ne(payouts.payoutType, 'platform_fee'),
    ];
    const dateConditions = dateWindow(payouts.createdAt, fromDate, toDate);
    const inPeriodSum =
      dateConditions.length === 0
        ? sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`
        : sql<number>`COALESCE(SUM(CASE WHEN ${and(...dateConditions)} THEN ${payouts.amountCents} ELSE 0 END),0)::int`;

    const [paid, inTransit, needsAttention] = await Promise.all([
      this.db
        .select({
          inPeriod: inPeriodSum,
          total: sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`,
        })
        .from(payouts)
        .where(and(...orgScope, eq(payouts.status, 'paid'))),
      this.db
        .select({
          sum: sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`,
        })
        .from(payouts)
        .where(and(...orgScope, eq(payouts.status, 'pending'))),
      this.db
        .select({ count: NEEDS_ATTENTION_CHARGES })
        .from(payouts)
        .where(
          and(...orgScope, inArray(payouts.status, ['pending', 'failed']))
        ),
    ]);

    return {
      earnedInPeriodCents: paid[0]?.inPeriod ?? 0,
      totalEarnedCents: paid[0]?.total ?? 0,
      inTransitCents: inTransit[0]?.sum ?? 0,
      needsAttentionCount: needsAttention[0]?.count ?? 0,
    };
  }

  /**
   * Creator earnings hub (Codex-69t7c.7 / WP7): the acting creator's OWN
   * payout rows across every org that paid them, newest first. Scoped by
   * `buildCreatorPayoutConditions` (userId + personal payout types) — the
   * `eq(userId)` predicate is the cross-creator isolation boundary. Unlike
   * `listPayoutsByOrg` this paginates per-row (not per-transferGroup): a
   * creator sees their individual slices, not an org operator's charge groups.
   */
  async listPayoutsForCreator(
    userId: string,
    options: {
      page: number;
      limit: number;
    } & PayoutFilterOptions
  ): Promise<PaginatedListResponse<CreatorPayoutRow>> {
    const { page, limit } = options;
    const offset = (page - 1) * limit;

    const conditions = this.buildCreatorPayoutConditions(userId, options);

    const [rows, [totalResult]] = await Promise.all([
      this.db
        .select({
          id: payouts.id,
          organizationId: payouts.organizationId,
          amountCents: payouts.amountCents,
          currency: payouts.currency,
          reason: payouts.reason,
          status: payouts.status,
          payoutType: payouts.payoutType,
          sourceType: payouts.sourceType,
          resolvedAt: payouts.resolvedAt,
          stripeTransferId: payouts.stripeTransferId,
          transferGroup: payouts.transferGroup,
          createdAt: payouts.createdAt,
          purchaseId: payouts.purchaseId,
          subscriptionId: payouts.subscriptionId,
          stripeChargeId: payouts.stripeChargeId,
        })
        .from(payouts)
        .where(and(...conditions))
        .orderBy(desc(payouts.createdAt), payouts.id)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(payouts)
        .where(and(...conditions)),
    ]);

    const total = totalResult?.count ?? 0;
    const [bankDates, takenBack] = await Promise.all([
      rows.length === 0
        ? undefined
        : this.bankDatesFor([userId]).then((dates) => dates.get(userId)),
      this.takenBackFor(
        userId,
        rows.filter((row) => row.status === 'reversed').map((row) => row.id)
      ),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId ?? null,
        amountCents: row.amountCents,
        currency: row.currency,
        reason: row.reason ?? '',
        status: derivePayoutStatus(row.status),
        payoutType: row.payoutType as PayoutType,
        sourceType: row.sourceType as 'purchase' | 'subscription',
        resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
        stripeTransferId: row.stripeTransferId,
        transferGroup: row.transferGroup ?? null,
        createdAt: row.createdAt.toISOString(),
        purchaseId: row.purchaseId ?? null,
        subscriptionId: row.subscriptionId ?? null,
        stripeChargeId: row.stripeChargeId ?? null,
        bankOn: bankOnFor(
          row,
          bankDates?.manualSince ?? null,
          bankDates?.cleared ?? null
        ),
        takenBack: takenBack.get(row.id) ?? null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Each reversed row's latest take-back that moved money, in one query for
   * the page, and only the caller's own rows (`payouts.user_id`).
   */
  private async takenBackFor(
    userId: string,
    payoutIds: readonly string[]
  ): Promise<Map<string, NonNullable<CreatorPayoutRow['takenBack']>>> {
    const latest = new Map<
      string,
      NonNullable<CreatorPayoutRow['takenBack']>
    >();
    if (payoutIds.length === 0) return latest;
    const steps = await this.db
      .select({
        payoutId: payoutReversals.payoutId,
        causeType: payoutReversals.causeType,
        resolvedAt: payoutReversals.resolvedAt,
      })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
      .where(
        and(
          eq(payouts.userId, userId),
          inArray(payoutReversals.payoutId, [...payoutIds]),
          takeBackMovedMoney(),
          isNotNull(payoutReversals.resolvedAt)
        )
      )
      .orderBy(desc(payoutReversals.resolvedAt));
    for (const step of steps) {
      const { causeType, resolvedAt } = step;
      if (latest.has(step.payoutId) || !resolvedAt) continue;
      if (causeType !== 'refund' && causeType !== 'dispute') continue;
      latest.set(step.payoutId, { causeType, on: londonDate(resolvedAt) });
    }
    return latest;
  }

  /**
   * Creator earnings KPIs (Codex-69t7c.7 / WP7) — the userId-scoped inverse of
   * {@link getPayoutSummary}. Three parallel aggregates over the creator's
   * personal payout rows (userId + `CREATOR_EARNING_PAYOUT_TYPES`) across all
   * orgs. `earnedInPeriodCents` honours the date window; the rest are lifetime.
   */
  async getEarningsSummaryForCreator(
    userId: string,
    options: { fromDate?: string; toDate?: string } = {}
  ): Promise<CreatorEarningsSummary> {
    const { fromDate, toDate } = options;

    // Reusable scope predicate (userId + personal payout types) shared by all
    // three aggregates, so an org-fee or another user's row can never inflate
    // a KPI.
    const creatorScope = [
      eq(payouts.userId, userId),
      inArray(payouts.payoutType, [...CREATOR_EARNING_PAYOUT_TYPES]),
    ];

    const dateConditions = dateWindow(payouts.createdAt, fromDate, toDate);
    const inPeriodSum =
      dateConditions.length === 0
        ? sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`
        : sql<number>`COALESCE(SUM(CASE WHEN ${and(...dateConditions)} THEN ${payouts.amountCents} ELSE 0 END),0)::int`;

    const [paid, inTransit, needsAttention, waiting] = await Promise.all([
      this.db
        .select({
          inPeriod: inPeriodSum,
          total: sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`,
        })
        .from(payouts)
        .where(and(...creatorScope, eq(payouts.status, 'paid'))),
      this.db
        .select({
          sum: sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`,
        })
        .from(payouts)
        .where(and(...creatorScope, eq(payouts.status, 'pending'))),
      this.db
        .select({ count: NEEDS_ATTENTION_CHARGES })
        .from(payouts)
        .where(
          and(...creatorScope, inArray(payouts.status, ['pending', 'failed']))
        ),
      // The banner's total is the email's (Codex-2hxff.34): every payee row,
      // as creator and as owner, so wider than the KPIs' creator scope.
      waitingMoney(this.db, { userId }),
    ]);

    return {
      earnedInPeriodCents: paid[0]?.inPeriod ?? 0,
      totalEarnedCents: paid[0]?.total ?? 0,
      inTransitCents: inTransit[0]?.sum ?? 0,
      needsAttentionCount: needsAttention[0]?.count ?? 0,
      waiting: waiting
        ? {
            totalCents: waiting.totalCents,
            oldestAt: waiting.oldestAt.toISOString(),
            organisations: waiting.organisations.map((organisation) => ({
              organizationId: organisation.organizationId,
              name: organisation.name,
              asOwner: organisation.asOwner,
              cents: organisation.cents,
            })),
            setup: waiting.setup,
          }
        : null,
    };
  }

  /**
   * Codex-6nt4l: per-creator aggregate for the `/studio/payouts` right rail.
   *
   * Returns one row per user who has received a `creator_payout` or
   * `organization_fee` payout for the org. `platform_fee` rows are excluded
   * (the platform isn't a per-creator recipient) — enforced by `IS NOT NULL`
   * on `payouts.userId`, which is the same predicate the DB CHECK constraint
   * uses to distinguish platform rows from beneficiary rows.
   *
   * The filter clause is shared with `listPayoutsByOrg` via
   * `buildPayoutConditions`, so toggling a Source/Status/Date chip reshapes
   * the table AND the rail consistently.
   *
   * Aggregation runs in-memory after a single SELECT, mirroring
   * `AdminAnalyticsService.getRevenueByCreator`. This keeps the surface
   * narrow (one row per payout × one Map merge) and avoids fragmenting the
   * filter logic across the SQL aggregator.
   *
   * `isOrgOwner` comes from a LEFT JOIN on `organizationMemberships` scoped
   * to (userId, organizationId). External creators paid via a
   * `creatorOrganizationAgreement` (no membership row) get `isOrgOwner:
   * false` — the LEFT JOIN yields a null role.
   *
   * Sorted by `totalPaidCents` desc — the operator's headline question is
   * "who has earned the most under this filter".
   */
  async getPayoutsByCreatorBreakdown(
    orgId: string,
    options: PayoutFilterOptions = {}
  ): Promise<CreatorPayoutBreakdown[]> {
    const conditions = this.buildPayoutConditions(orgId, options);
    conditions.push(isNotNull(payouts.userId));

    const rows = await this.db
      .select({
        userId: payouts.userId,
        payoutId: payouts.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.image,
        membershipRole: organizationMemberships.role,
        amountCents: payouts.amountCents,
        status: payouts.status,
        sourceType: payouts.sourceType,
        payoutType: payouts.payoutType,
        reason: payouts.reason,
        transferGroup: payouts.transferGroup,
        stripeChargeId: payouts.stripeChargeId,
        resolvedAt: payouts.resolvedAt,
      })
      .from(payouts)
      .leftJoin(users, eq(payouts.userId, users.id))
      .leftJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, payouts.userId),
          eq(organizationMemberships.organizationId, orgId)
        )
      )
      .where(and(...conditions));

    // Per-user accumulator — Sets for distinct-counting and a tracked max
    // timestamp for `lastPaidAt` so we can run one pass without a second
    // sort or SQL `MAX()` aggregate.
    type Accumulator = CreatorPayoutBreakdown & {
      _transferGroups: Set<string>;
      _needsAttentionGroups: Set<string>;
      _lastPaidAtMs: number;
    };
    const byUser = new Map<string, Accumulator>();

    for (const row of rows) {
      // The `IS NOT NULL` predicate filters at SQL level; this re-check
      // narrows the row.userId TypeScript type and is a no-op at runtime.
      if (!row.userId) continue;

      let acc = byUser.get(row.userId);
      if (!acc) {
        acc = {
          userId: row.userId,
          name: row.name ?? null,
          email: row.email ?? null,
          avatarUrl: row.avatarUrl ?? null,
          isOrgOwner: row.membershipRole === 'owner',
          totalPaidCents: 0,
          purchasePaidCents: 0,
          subscriptionPaidCents: 0,
          orgFeePaidCents: 0,
          transactionCount: 0,
          needsAttentionCount: 0,
          lastPaidAt: null,
          _transferGroups: new Set<string>(),
          _needsAttentionGroups: new Set<string>(),
          _lastPaidAtMs: 0,
        };
        byUser.set(row.userId, acc);
      }

      if (row.status === 'paid') {
        // `organization_fee` is the org-admin slice, NOT the user's personal
        // creator earnings — it is disclosed ONLY via `orgFeePaidCents` and must
        // never be folded into the per-creator `totalPaidCents` headline
        // (Codex-h3864). This keeps `totalPaidCents == purchasePaidCents +
        // subscriptionPaidCents` a clean "personal earnings" invariant; the
        // owner card surfaces the org slice separately as "of which £X org fee".
        if (row.payoutType === 'organization_fee') {
          acc.orgFeePaidCents += row.amountCents;
        } else {
          acc.totalPaidCents += row.amountCents;
          if (row.sourceType === 'purchase') {
            acc.purchasePaidCents += row.amountCents;
          } else if (row.sourceType === 'subscription') {
            acc.subscriptionPaidCents += row.amountCents;
          }
        }
        if (row.resolvedAt) {
          // Drizzle hands back `Date` for timestamp columns; defensive cast
          // covers driver variants that emit ISO strings.
          const ms =
            row.resolvedAt instanceof Date
              ? row.resolvedAt.getTime()
              : new Date(row.resolvedAt).getTime();
          if (Number.isFinite(ms) && ms > acc._lastPaidAtMs) {
            acc._lastPaidAtMs = ms;
            acc.lastPaidAt = toIso(row.resolvedAt);
          }
        }
      }

      // One transaction is one charge (Codex-2hxff.15): a subscription's
      // transfer group spans every renewal, so two renewals are two. A row
      // with no charge id falls back to its transfer group, and a pre-h69cg
      // row with neither to its own id (1 row = 1 transaction) rather than
      // collapsing all ungrouped rows into a single bucket.
      const chargeKey = row.stripeChargeId ?? row.transferGroup ?? row.payoutId;
      acc._transferGroups.add(chargeKey);

      // `needsAttentionCount` counts stuck charges by the SAME key as
      // `transactionCount`, as the summaries' NEEDS_ATTENTION_CHARGES does,
      // so all three agree — under h69cg's 3-sibling-row model, one failed
      // charge produces 3 pending/failed rows, which per-row would read as 3
      // separate problems.
      //
      // `min_transfer_floor` is excluded: rows below Stripe's minimum
      // transfer threshold are held as pending until aggregate-and-sweep
      // catches up — they're not an exception the operator needs to act
      // on. Multi-creator orgs with small revshares hit this constantly.
      if (
        (row.status === 'pending' || row.status === 'failed') &&
        row.reason !== 'min_transfer_floor'
      ) {
        acc._needsAttentionGroups.add(chargeKey);
      }
    }

    return (
      Array.from(byUser.values())
        .map(
          ({
            _transferGroups,
            _needsAttentionGroups,
            _lastPaidAtMs,
            ...rest
          }) => ({
            ...rest,
            transactionCount: _transferGroups.size,
            needsAttentionCount: _needsAttentionGroups.size,
            _lastPaidAtMs,
          })
        )
        // Primary sort: totalPaidCents desc. Secondary tie-breaker:
        // lastPaidAt desc (most-recently-paid first when totals match) —
        // matters for multi-creator orgs where N creators on identical
        // revshare percentages can hit the same totals across reloads.
        .sort((a, b) => {
          if (b.totalPaidCents !== a.totalPaidCents) {
            return b.totalPaidCents - a.totalPaidCents;
          }
          return b._lastPaidAtMs - a._lastPaidAtMs;
        })
        .map(({ _lastPaidAtMs: _unused, ...rest }) => rest)
    );
  }

  // ─── Pending Payout Resolution ──────────────────────────────────────────

  /**
   * BUG-014: Resolve accumulated pending payouts for a user within an org.
   *
   * Codex-69t7c WP5: `orgId` is `string | null`. Regardless of which value the
   * caller passes, the recipient is identified by the Connect account's
   * userId, and BOTH that user's org-scoped (organizationId = orgId) AND
   * orgless (organizationId IS NULL) pending rows are drained in one pass —
   * SQL `col = value` never matches NULL, so the orgless leg would otherwise
   * be stranded. A `null` orgId resolves ONLY the orgless leg.
   *
   * Every trigger now drains the whole payee instead
   * (`resolvePendingPayoutsForAccount`); this narrower form drains the same
   * way, within its scope.
   */
  async resolvePendingPayouts(
    orgId: string | null,
    stripeAccountId: string
  ): Promise<{ resolved: number; failed: number }> {
    return this.drainPayee(stripeAccountId, { orgId });
  }

  /**
   * Pay a payee everything they are owed and can be paid now
   * (Codex-2hxff.13; docs/payments/connect-and-payouts.md, "Releasing pending
   * money"): every drainable row in the name of the account's owner, in
   * every organisation, and their orgless rows. Called when their account
   * becomes payable (`account.updated`, `/connect/me/sync`) and by the hourly
   * sweep.
   *
   * Safe to call at any time and more than once: each row is claimed for one
   * attempt before it is sent, so a concurrent drain skips it, and a row
   * already paid is not drainable. Sends at most one payout-released email,
   * from what was actually paid.
   *
   * `platformFailures` is the hourly sweep's tally, so a short platform
   * balance is one error per sweep, not one per payee (Codex-r094t). Any
   * other caller leaves it out, and the drain reports its own run.
   *
   * `cronDrain` is the hourly cron's own drain, which runs ahead of the bank
   * payout in its wake: only its email may name this morning's payout
   * (review r2 LOW-1). Every other drain leaves it out.
   */
  async resolvePendingPayoutsForAccount(
    stripeAccountId: string,
    platformFailures?: PlatformFailureTally,
    options: { cronDrain?: boolean } = {}
  ): Promise<{ resolved: number; failed: number }> {
    return this.drainPayee(stripeAccountId, 'all', platformFailures, options);
  }

  /**
   * The drain behind both entry points. For each payout:
   *   - attempts stripe.transfers.create();
   *   - on success: marks it paid with its transfer;
   *   - on failure: records why and continues (`recordTransferFailure`).
   *
   * `scope` is `'all'` for the payee-wide drain, or `{ orgId }` for that
   * organisation plus the payee's orgless rows (`null`: orgless only).
   *
   * Platform-side failures (a short balance, a bad key) are each a warning
   * and ONE error for the run, raised at its first (Codex-r094t): this
   * drain's run, or the sweep's when it passes `sweepFailures`, which then
   * logs the run's summary itself.
   */
  private async drainPayee(
    stripeAccountId: string,
    scope: 'all' | { orgId: string | null },
    sweepFailures?: PlatformFailureTally,
    { cronDrain = false }: { cronDrain?: boolean } = {}
  ): Promise<{ resolved: number; failed: number }> {
    const scopeOrgId = scope === 'all' ? null : scope.orgId;
    const platformFailures = sweepFailures ?? platformFailureTally();
    let resolved = 0;
    let failed = 0;
    // What transferPendingGroup ACTUALLY paid to this user's creator slices —
    // the payout-released email must report this, not the pre-loop snapshot.
    let creatorPaidCents = 0;
    let creatorPaidCount = 0;
    const creatorPaidSlices: ReleasedSlice[] = [];
    // The organisations whose creator slices were paid, for the email.
    const creatorPaidOrgs = new Set<string | null>();

    // stripeAccountId is globally unique, so it alone identifies the account
    // (one account per user, Codex-69t7c — the org condition is dropped).
    const [connectAccount] = await this.db
      .select({ userId: stripeConnectAccounts.userId })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.stripeAccountId, stripeAccountId))
      .limit(1);

    if (!connectAccount) {
      this.obs.warn('resolvePendingPayouts: Connect account not found', {
        organizationId: scopeOrgId,
        payeeWide: scope === 'all',
        stripeAccountId,
      });
      return { resolved: 0, failed: 0 };
    }

    // Codex-69t7c WP5: a single Connect account belongs to ONE creator
    // (routed by userId), but that creator can accrue BOTH org-scoped
    // (tri-party) pending rows AND orgless (bi-party) rows (organizationId
    // IS NULL). SQL `col = value` never matches NULL, so an org filter alone
    // left every orgless `creator_payout` row invisible to the drain.
    const orgFilter =
      scope === 'all'
        ? undefined
        : scope.orgId === null
          ? isNull(payouts.organizationId)
          : or(
              eq(payouts.organizationId, scope.orgId),
              isNull(payouts.organizationId)
            );
    const unresolvedPayouts = await this.db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.userId, connectAccount.userId),
          // Failed transfers are retried too (Codex-2hxff.11): a `failed` row
          // keeps its charge id and stays payable — unless an old write path
          // failed it, or it waits for support (see isDrainablePayout).
          isDrainablePayout(),
          ...(orgFilter ? [orgFilter] : [])
        )
      );

    if (unresolvedPayouts.length === 0) {
      return { resolved: 0, failed: 0 };
    }

    this.obs.info('Resolving pending payouts', {
      organizationId: scopeOrgId,
      payeeWide: scope === 'all',
      stripeAccountId,
      userId: connectAccount.userId,
      count: unresolvedPayouts.length,
    });

    // Where an earlier attempt's transfer can be: this account, or one the
    // payee has since replaced (Codex-2hxff.47). Read once per payee.
    const accounts = await payeeAccountIds(this.db, connectAccount.userId);

    // Codex-iivne + Codex-69t7c WP5 + Codex-2hxff.13: group pending rows by
    // (organisation, sourceType) so a creator with many sub-threshold pending
    // rows gets resolved when the SUM clears the min-transfer floor, rather
    // than every row failing the per-row floor check and piling up. Fees
    // depend on the organisation (orgless → platform-only fees; an org → its
    // own and the creator's config) AND the sourceType, so each group is one
    // organisation's: a payee-wide drain spans several, and must never pay
    // one organisation's rows at another's fees.
    const groups = new Map<
      string,
      {
        orgId: string | null;
        sourceType: 'purchase' | 'subscription';
        rows: typeof unresolvedPayouts;
      }
    >();
    for (const payout of unresolvedPayouts) {
      const sourceType =
        payout.sourceType === 'purchase' ? 'purchase' : 'subscription';
      const key = `${payout.organizationId ?? 'orgless'}:${sourceType}`;
      const existing = groups.get(key);
      if (existing) {
        existing.rows.push(payout);
      } else {
        groups.set(key, {
          orgId: payout.organizationId,
          sourceType,
          rows: [payout],
        });
      }
    }

    for (const [key, { orgId: groupOrgId, sourceType, rows }] of groups) {
      // One group's failure (a Stripe lookup, a fee read) never blocks the
      // next. Its claimed rows come free when the lease runs out.
      const groupResult = await this.transferPendingGroup(
        rows,
        sourceType,
        groupOrgId,
        stripeAccountId,
        connectAccount.userId,
        accounts,
        platformFailures
      ).catch((error: unknown) => {
        this.obs.error('resolvePendingPayouts: group failed', {
          errorId: crypto.randomUUID(),
          organizationId: groupOrgId,
          userId: connectAccount.userId,
          group: key,
          rowCount: rows.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (!groupResult) {
        failed += rows.length;
        continue;
      }
      resolved += groupResult.resolved;
      failed += groupResult.failed;
      creatorPaidCents += groupResult.creatorPaidCents;
      creatorPaidCount += groupResult.creatorPaidCount;
      creatorPaidSlices.push(...groupResult.creatorPaidSlices);
      if (groupResult.creatorPaidCount > 0) creatorPaidOrgs.add(groupOrgId);
    }

    if (!sweepFailures) {
      reportPlatformFailures(this.ledger(), platformFailures, {
        organizationId: scopeOrgId,
        payeeWide: scope === 'all',
        stripeAccountId,
        userId: connectAccount.userId,
      });
    }

    this.obs.info('Pending payout resolution complete', {
      organizationId: scopeOrgId,
      payeeWide: scope === 'all',
      stripeAccountId,
      resolved,
      failed,
      total: unresolvedPayouts.length,
    });

    // WP-10 (Codex-69t7c.10): fire payout-released notification when at least
    // one creator_payout transitioned pending→paid. Fires ONCE per drain
    // (one notification per activation event, not per-row or per
    // organisation). Fire-and-forget post-loop — notification failure MUST
    // NOT roll back or block the already-committed transfers.
    //
    // Gate on creator_payout rows ONLY — organization_fee rows are the org
    // admin's slice, not the creator's personal earnings. Counted from what
    // transferPendingGroup actually paid, NOT from the pre-loop snapshot:
    // rows still under the aggregate min-transfer floor, or whose transfer
    // failed, are skipped above — the old snapshot-based amount told creators
    // money had been released when nothing moved.
    if (creatorPaidCount > 0) {
      try {
        const [[creatorRow], [balanceRow]] = await Promise.all([
          this.db
            .select({ email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, connectAccount.userId))
            .limit(1),
          // The account the money went to: on manual payouts, the daily job
          // sends it 14 days after each sale (Codex-2hxff.29).
          this.db
            .select({ manualPayoutsSince: connectBalances.manualPayoutsSince })
            .from(connectBalances)
            .where(eq(connectBalances.stripeAccountId, stripeAccountId))
            .limit(1),
        ]);

        if (creatorRow?.email) {
          const amountFormatted = `£${(creatorPaidCents / 100).toFixed(2)}`;
          // Earnings lives on the creators subdomain: the bare domain has no
          // studio route, so `${WEB_APP_URL}/studio/earnings` was a 404. Built
          // from the env name, never WEB_APP_URL's host (on staging that
          // parses to the production apex), as purchase-service's link is.
          const dashboardUrl = isEnvName(this.environment)
            ? buildOrgUrlFromEnv(
                this.environment,
                'creators',
                '/studio/earnings'
              )
            : '/studio/earnings';
          // The email names an organisation only when every creator slice
          // it reports is that organisation's.
          const [onlyOrg] = creatorPaidOrgs;
          const emailOrgId = creatorPaidOrgs.size === 1 ? onlyOrg : null;

          void this.payoutMailer({
            to: creatorRow.email,
            templateName: 'payout-released',
            category: 'transactional',
            userId: connectAccount.userId,
            organizationId: emailOrgId ?? null,
            data: {
              // Their name, as mock-b-studio M5 greets them, never the email
              // address; a string either way, since a null is refused.
              creatorName: creatorRow.name || 'there',
              amountFormatted,
              payoutCount: creatorPaidCount,
              dashboardUrl,
              // When it reaches the bank, from this account's real state, so
              // it is true before and after the switch (data design §5.4).
              // Release N's template doesn't use them yet; an unknown field
              // is dropped, never refused (§5.5).
              ...payoutReleasedBankFields({
                slices: creatorPaidSlices,
                manualPayouts: Boolean(balanceRow?.manualPayoutsSince),
                now: new Date(),
                cronDrain,
              }),
            },
          });
        }
      } catch (err) {
        // Swallow — notification failure must not surface after committed transfers.
        this.obs.warn('payout-released notification dispatch failed', {
          organizationId: scopeOrgId,
          stripeAccountId,
          creatorPaidCount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { resolved, failed };
  }

  /**
   * Codex-iivne: resolve one (userId, organisation, sourceType) group of
   * pending payouts. Caller has already filtered by Connect account userId, so
   * every row in `group` shares one recipient. Fee policy is looked up
   * once per call (was: per-row); floor evaluates against the SUM
   * (was: each row individually).
   *
   * Codex-69t7c WP5: `orgId` is `string | null`. A null org marks an orgless
   * (bi-party) group — fee/floor resolution routes through the platform-level
   * policy (getFeesPlatform) rather than per-org/per-creator config. The
   * transfer itself is identical: per-row GBP-guarded `stripe.transfers.create`
   * to the userId→single Connect account, verbatim `payout_${id}` idempotency
   * key, per-row error isolation.
   *
   * The schema invariant `uq_payouts_stripe_transfer_id` forbids
   * shared stripeTransferId across rows, so per-row transfers fire
   * after the group passes the floor gate.
   */
  private async transferPendingGroup(
    group: (typeof payouts.$inferSelect)[],
    sourceType: 'purchase' | 'subscription',
    orgId: string | null,
    stripeAccountId: string,
    userId: string,
    accounts: PayeeAccounts,
    platformFailures: PlatformFailureTally
  ): Promise<{
    resolved: number;
    failed: number;
    /** creator_payout rows that actually transitioned pending→paid here */
    creatorPaidCents: number;
    creatorPaidCount: number;
    /** The same rows, for the email's bank dates (Codex-2hxff.29). */
    creatorPaidSlices: ReleasedSlice[];
  }> {
    let resolved = 0;
    let failed = 0;
    let creatorPaidCents = 0;
    let creatorPaidCount = 0;
    const creatorPaidSlices: ReleasedSlice[] = [];

    const payoutFees = await this.resolvePayoutFees(
      orgId,
      sourceType === 'purchase' ? 'one_off' : 'subscription',
      userId
    );
    // Partial refunds reduce an unpaid slice before it is paid (Codex-2hxff.8).
    // This read only gates the group; the amounts sent are re-read below,
    // after the claim, when no reduction can change under the transfer.
    const gateReductions = await pendingReductionsFor(
      this.db,
      group.map((row) => row.id)
    );
    const totalCents = group.reduce(
      (sum, row) => sum + row.amountCents - (gateReductions.get(row.id) ?? 0),
      0
    );

    if (totalCents < payoutFees.minTransferCents) {
      this.obs.info(
        'resolvePendingPayouts: skipping group below aggregate min-transfer floor',
        {
          organizationId: orgId,
          userId,
          sourceType,
          totalCents,
          rowCount: group.length,
          minTransferCents: payoutFees.minTransferCents,
        }
      );
      return {
        resolved: 0,
        failed: 0,
        creatorPaidCents: 0,
        creatorPaidCount: 0,
        creatorPaidSlices,
      };
    }

    // Codex-2hxff.11: claim each row for one attempt (a 10-minute lease —
    // a second drain, or a write-time transfer still in flight, holds it off),
    // then ask Stripe for any transfer an EARLIER attempt already made for a
    // claimed row: its update may have failed after the money moved. Such a
    // row is settled, never sent again. The rest are sent with a key per
    // attempt — see claimPayoutAttempt for why one stable key is not enough.
    const attempts = await claimPayoutAttempts(
      this.db,
      group.map((payout) => payout.id)
    );
    const claimed = group.filter((payout) => attempts.has(payout.id));
    const reductions = await pendingReductionsFor(
      this.db,
      claimed.map((payout) => payout.id)
    );
    const payable = (payout: (typeof group)[number]) =>
      payout.amountCents - (reductions.get(payout.id) ?? 0);
    // On the payee's current account, and on a replaced one for a row with
    // an attempt on record (Codex-2hxff.47). `claimed` holds the rows as read
    // BEFORE the claim, so `lastRetryAt` is an earlier attempt's, not this one.
    const alreadySent = await findTransfersForPayouts(
      this.stripe,
      accounts,
      claimed,
      this.obs
    );

    const paid = (payout: (typeof group)[number]) => {
      resolved++;
      if (payout.payoutType === 'creator_payout') {
        creatorPaidCents += payable(payout);
        creatorPaidCount++;
        creatorPaidSlices.push({
          cents: payable(payout),
          createdAt: payout.createdAt,
          hasCharge: payout.stripeChargeId !== null,
        });
      }
    };

    for (const payout of claimed) {
      const earlier = alreadySent.get(payout.id);
      if (earlier) {
        this.obs.info('Pending payout already transferred; settling it', {
          pendingPayoutId: payout.id,
          stripeTransferId: earlier,
        });
        try {
          if (await settlePayoutPaid(this.db, payout.id, earlier)) {
            paid(payout);
          }
        } catch (error) {
          // Still pending with its lease: the next drain finds the same
          // transfer and settles it.
          failed++;
          this.obs.error('Could not settle a payout already transferred', {
            errorId: crypto.randomUUID(),
            pendingPayoutId: payout.id,
            stripeTransferId: earlier,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      // The lease was taken for the whole group; renew it for this row
      // before sending. If the group outlived it and another drain has
      // claimed the row since, that drain sends it, not this one.
      const attempt = attempts.get(payout.id) ?? 0;
      if (!(await renewPayoutAttempt(this.db, payout.id, attempt))) {
        this.obs.info('Pending payout claimed by another drain; skipping', {
          pendingPayoutId: payout.id,
          attempt,
        });
        continue;
      }

      const amountCents = payable(payout);
      if (amountCents <= 0) {
        // Reduced to nothing: only a refund of the whole charge does that, and
        // it cancels the row instead, so this is a ledger inconsistency.
        failed++;
        this.obs.error('A pending payout was reduced to nothing; not sent', {
          errorId: crypto.randomUUID(),
          pendingPayoutId: payout.id,
          grossCents: payout.amountCents,
          reducedCents: reductions.get(payout.id) ?? 0,
        });
        continue;
      }

      const idempotencyKey = `payout_${payout.id}_${attempt}`;
      let transfer: Stripe.Transfer;
      try {
        // GBP-only enforcement (Codex-yv18n) lives INSIDE the per-row
        // try/catch so a non-GBP row counts as a per-row failure (not a
        // group abort) — keeps mixed-currency batches partially recoverable.
        // It can never succeed, so the row is flagged for support at once.
        const payoutCurrency = (payout.currency || CURRENCY.GBP).toLowerCase();
        assertGbpOnly(payoutCurrency, {
          pendingPayoutId: payout.id,
          subscriptionId: payout.subscriptionId,
          organizationId: orgId,
        });
        // Codex-dbzkg: pass source_transaction when the row was funded
        // by a tracked platform charge so the retry pulls from THAT
        // charge's source-linked balance, not general platform balance.
        transfer = await this.stripe.transfers.create(
          {
            amount: amountCents,
            currency: payoutCurrency,
            destination: stripeAccountId,
            ...(payout.stripeChargeId
              ? { source_transaction: payout.stripeChargeId }
              : {}),
            metadata: {
              payout_id: payout.id,
              subscription_id: payout.subscriptionId,
              purchase_id: payout.purchaseId,
              source_type: payout.sourceType,
              type: 'pending_payout_resolution',
              ...stripeEnvMetadata(this.environment),
            },
          },
          { idempotencyKey }
        );
      } catch (error) {
        failed++;
        // Codex-vv77x: per-row error isolation — one Stripe failure never
        // blocks the remaining rows. The row stays payable for the next
        // drain, unless Stripe has refused it for good or too often: then it
        // waits for support, logged once (Codex-2hxff.48). A platform-side
        // failure goes on the run's tally (Codex-r094t). A refund that
        // cancelled the row meanwhile gets any transfer that landed reversed.
        await recordTransferFailure(
          this.ledger(),
          {
            payoutId: payout.id,
            destination: stripeAccountId,
            amountCents,
            idempotencyKey,
          },
          error,
          {
            organizationId: orgId,
            subscriptionId: payout.subscriptionId,
            purchaseId: payout.purchaseId,
            payoutType: payout.payoutType,
            sourceType,
            attempt,
          },
          platformFailures
        );
        continue;
      }

      try {
        // A refund may have cancelled the row while the transfer was in
        // flight: settleTransfer then reverses it rather than leave it paid.
        const settled = await settleTransfer(
          this.ledger(),
          payout.id,
          transfer.id
        );
        if (settled === 'settled' || settled === 'already_settled') {
          paid(payout);
        }
      } catch (error) {
        // The money moved; only the row is behind. The next drain finds the
        // transfer by its payout_id and settles the row.
        failed++;
        this.obs.error(
          'Pending payout transferred but its row was not marked paid; the next drain settles it',
          {
            errorId: crypto.randomUUID(),
            pendingPayoutId: payout.id,
            stripeTransferId: transfer.id,
            error: (error as Error).message,
          }
        );
      }
    }

    return {
      resolved,
      failed,
      creatorPaidCents,
      creatorPaidCount,
      creatorPaidSlices,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Refuse a tier change, and its preview, while a chargeback on one of the
   * subscription's invoices is open (`disputedAt` set): its access and billing
   * are paused until the dispute ends (Codex-2hxff.60). Called before any
   * Stripe call. The context is sent to the client: nothing about the dispute
   * itself.
   */
  private assertNotDisputed(sub: Subscription, orgId: string): void {
    if (!sub.disputedAt) return;
    throw new ConflictError(
      'The plan cannot be changed while a payment dispute on this subscription is open.',
      { code: 'SUBSCRIPTION_DISPUTED', organizationId: orgId }
    );
  }

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
   * The payouts-ledger dependencies for `recordSplitOnce` / `recordPlatformFee`
   * (Codex-2hxff.11).
   */
  private ledger(): LedgerDeps {
    return {
      db: this.db,
      stripe: this.stripe,
      obs: this.obs,
      environment: this.environment,
    };
  }

  /**
   * Codex-xz61z (I2): the organisation owner receives the whole creator pool
   * when an invoice pays no creator — no agreement matched the Q3 filter, or
   * every one carries a zero share. One `creator_payout_to_owner` slice per
   * charge, whichever branch fires, under one idempotency key
   * (`${chargeId}_creator_pool_owner`).
   *
   * Through the ledger (Codex-2hxff.11): pending in the payee's name until
   * they can be paid (Codex-2hxff.2 review — an ownership transfer may land
   * on someone who has not onboarded), and held as `no_owner` when the
   * organisation had no owner at the invoice's time (Codex-2hxff.37; it used
   * to be logged and dropped).
   */
  private creatorPoolToOwnerSlice(
    subscriptionId: string,
    orgId: string,
    chargeId: string,
    transferGroup: string,
    creatorPayoutCents: number,
    orgPayee: OrganisationPayee | undefined
  ): RecordSliceInput {
    return {
      payoutType: 'creator_payout_to_owner',
      amountCents: creatorPayoutCents,
      organizationId: orgId,
      source: { sourceType: 'subscription', subscriptionId },
      stripeChargeId: chargeId,
      transferGroup,
      sendTransferGroup: true,
      payee: orgPayee
        ? { userId: orgPayee.userId, account: orgPayee.account }
        : null,
      idempotencyKey: `${chargeId}_creator_pool_owner`,
      metadata: { subscription_id: subscriptionId },
    };
  }

  /**
   * Record an invoice charge's split once (Codex-2hxff.62; owner decision
   * 2026-10-21, "Keep its first split"): see `recordSplitOnce`. Returns, in
   * `slices` order, each slice recorded now (its outcome and the amount it
   * was recorded at) or `null`; `null` for the whole when an earlier delivery
   * already split the charge. Then the replay adds nothing, even if an
   * agreement accepted since is backdated to before the invoice — only a
   * slice missing entirely, from what is left of the charge's `grossCents`
   * (Codex-2hxff.49).
   */
  private async recordInvoiceSplit(
    subscriptionId: string,
    orgId: string,
    chargeId: string,
    grossCents: number,
    slices: RecordSliceInput[]
  ): Promise<Array<{
    outcome: RecordSliceOutcome;
    amountCents: number;
  } | null> | null> {
    const result = await recordSplitOnce(
      this.ledger(),
      { id: chargeId, grossCents },
      slices
    );
    if (result.kind !== 'recorded') {
      this.obs.info(
        result.kind === 'completed'
          ? 'Invoice already split by an earlier delivery that died part-way; the replay recorded only the slices it lacked'
          : 'Invoice already split by an earlier delivery; the replay keeps that split',
        { subscriptionId, organizationId: orgId, stripeChargeId: chargeId }
      );
      if (result.kind === 'already_split') return null;
    }
    return result.outcomes.map((outcome, index) => {
      const slice = result.slices[index];
      return outcome && slice
        ? { outcome, amountCents: slice.amountCents }
        : null;
    });
  }

  /**
   * The post-platform pool of an invoice charge whose recorded platform fee
   * differs from the one computed now: the fees changed between deliveries.
   * The recorded fee wins, and the pool is the gross minus it, split by the
   * organisation's fee-config share as a first delivery's is
   * (`calculateRevenueSplit`), so the slices sum to the gross (owner decision
   * 2026-10-23, "Keep recorded fee"; Codex-2hxff.49).
   */
  private async poolAfterRecordedFee(
    ids: { subscriptionId: string; orgId: string; chargeId: string },
    grossCents: number,
    computedFeeCents: number,
    recordedFeeCents: number,
    invoiceCreatedAt: Date
  ): Promise<{ organizationFeeCents: number; creatorPayoutCents: number }> {
    this.obs.warn(
      'A replay found a different platform fee on record; the rest of the charge is split from it',
      {
        subscriptionId: ids.subscriptionId,
        organizationId: ids.orgId,
        stripeChargeId: ids.chargeId,
        recordedFeeCents,
        computedFeeCents,
      }
    );
    const fees = await this.resolvePayoutFees(
      ids.orgId,
      'subscription',
      undefined,
      invoiceCreatedAt
    );
    return calculateRevenueSplit(
      Math.max(grossCents - recordedFeeCents, 0),
      0,
      fees.orgFeePercent
    );
  }

  /**
   * Claw back the subscription payout slices of a refunded invoice charge
   * (Codex-13v21) through the shared engine (@codex/payments `reverseCharge`,
   * Codex-2hxff.56). Stripe does NOT reverse separate `transfers.create`
   * calls, so without this the platform pays the whole refund while
   * creators keep their slices.
   *
   * Only `sourceType='subscription'` rows on the charge are reversed;
   * one-time purchase rows are PurchaseService.processRefund's, so running
   * both on every `charge.refunded` never reverses a transfer twice.
   *
   * Each refund's share is recorded per slice (payout_reversals),
   * so a redelivery does only what is left and a second partial refund is
   * clawed back too. A balance too low to cover it is a `refund_reviews` debt,
   * as for purchases (Codex-2hxff.8, D5).
   */
  async reverseSubscriptionPayoutsForCharge(
    charge: ClawbackCharge
  ): Promise<void> {
    await reverseCharge(
      { ...this.ledger(), obs: this.obs },
      {
        charge,
        source: { sourceType: 'subscription' },
        refunds: () => listClawableRefunds(this.stripe, charge.id),
      }
    );
  }

  /**
   * The hourly retry of clawback steps left `failed`, for every source: a
   * step Stripe refused does not make the webhook retry (Codex-2hxff.8).
   */
  async retryFailedClawbacks(olderThanMinutes = 15): Promise<{
    charges: number;
    retried: number;
    stillFailing: number;
  }> {
    return retryFailedClawbacks(
      { ...this.ledger(), obs: this.obs },
      { olderThanMinutes }
    );
  }

  /**
   * The daily bank payout (Codex-2hxff.29, .30). The hourly cron hands every
   * run's `scheduledTime` here, last; only the run whose London hour is 8
   * pays out, so there is no new cron and no new database wake. Null on the
   * other 23. Each paid or newly negative account's cached Studio balance is
   * dropped, which bumps that user's version key (once a day at most).
   */
  async runBankPayouts(
    scheduledTime: Date
  ): Promise<BankPayoutRunSummary | null> {
    if (!isBankPayoutRun(scheduledTime)) return null;
    const { cache, waitUntil } = this;
    return runBankPayouts(
      {
        ...this.ledger(),
        obs: this.obs,
        invalidateBalance: (userId) => {
          if (!cache || !waitUntil) return;
          waitUntil(
            cache.invalidate(userId).catch((error: unknown) => {
              this.obs.warn('Studio balance cache invalidation failed', {
                userId,
                error: error instanceof Error ? error.message : String(error),
              });
            })
          );
        },
      },
      scheduledTime
    );
  }

  /**
   * The hourly retry of duplicate subscriptions still owed their refund
   * (Codex-2hxff.15, review T8): a settle Stripe refused, and every retry of
   * its event refused too, leaves the duplicate unsettled once Stripe stops
   * redelivering. Settles the ones recorded more than `olderThanMs` ago, up to
   * `limit`. One row's failure never stops the batch: `settleDuplicate` logs
   * it (errorId, Stripe code) and it is returned in `stillOwed`.
   */
  async settleOwedDuplicates(options: {
    olderThanMs: number;
    limit: number;
  }): Promise<{
    settled: number;
    stillOwed: Array<{ id: string; stripeSubscriptionId: string }>;
  }> {
    const recordedBefore = new Date(Date.now() - options.olderThanMs);
    const owed = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          isNotNull(subscriptions.duplicateOfSubscriptionId),
          isNull(subscriptions.duplicateSettledAt),
          lt(subscriptions.createdAt, recordedBefore)
        )
      )
      .orderBy(subscriptions.createdAt)
      .limit(options.limit);

    let settled = 0;
    const stillOwed: Array<{ id: string; stripeSubscriptionId: string }> = [];
    for (const row of owed) {
      try {
        await this.settleDuplicate(row);
        settled++;
      } catch (error) {
        // A Stripe refusal is logged inside settleDuplicate; anything else
        // (the settle write) is logged here.
        if (!(error instanceof ServiceUnavailableError)) {
          this.obs.error('Owed duplicate subscription could not be settled', {
            errorId: crypto.randomUUID(),
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
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

  // ── Disputes (Codex-2hxff.9; docs/payments/subscription-disputes.md) ──

  /**
   * A chargeback opened on one of its invoices: access paused. Undefined for
   * a purchase's dispute. Billing is paused separately, after the clawback.
   */
  async pauseForDispute(
    input: DisputeInput
  ): Promise<DisputedSubscription | undefined> {
    const paused = await pauseDisputedSubscription(this.disputeDeps(), input);
    if (paused) {
      this.invalidateIfConfigured(
        paused.userId,
        paused.organizationId ?? undefined,
        'subscription_paused'
      );
    }
    return paused;
  }

  /** Billing paused while the chargeback is open (owner decision Q-A). */
  async pauseBillingForDispute(
    subscription: DisputedSubscription,
    stripeDisputeId: string
  ): Promise<void> {
    await pauseBilling(this.disputeDeps(), subscription, stripeDisputeId);
  }

  /** A won dispute: access and billing restored, unless another chargeback is open. */
  async restoreAfterDispute(
    input: DisputeInput
  ): Promise<
    { subscription: DisputedSubscription; restored: boolean } | undefined
  > {
    const result = await restoreDisputedSubscription(this.disputeDeps(), input);
    if (result?.restored) {
      this.invalidateIfConfigured(
        result.subscription.userId,
        result.subscription.organizationId ?? undefined,
        'subscription_resumed'
      );
    }
    return result;
  }

  /** A lost dispute: access ended, and the subscription cancelled at Stripe. */
  async cancelForLostDispute(
    input: DisputeInput
  ): Promise<DisputedSubscription | undefined> {
    const ended = await cancelLostDisputeSubscription(
      this.disputeDeps(),
      input
    );
    if (ended) {
      this.invalidateIfConfigured(
        ended.userId,
        ended.organizationId ?? undefined,
        'cancel'
      );
    }
    return ended;
  }

  // ── Refunds (Codex-2hxff.10; docs/payments/subscriptions.md#refunds) ──

  /**
   * A full refund of the latest payment: the subscription cancelled at Stripe
   * (owner decision P-4). The caller then applies the cancellation as for
   * `customer.subscription.deleted`, so access ends now rather than when that
   * event lands. Undefined for a partial refund, a purchase, or an earlier
   * payment. Tier and course subscriptions alike.
   */
  async cancelForFullRefund(
    charge: RefundedCharge
  ): Promise<RefundCancellation | undefined> {
    return cancelForFullRefund(this.disputeDeps(), charge);
  }

  private disputeDeps() {
    return { db: this.db, stripe: this.stripe, obs: this.obs };
  }

  /**
   * Whether an event that would bring a CANCELLED row back is stale: the
   * subscription has ended at Stripe, where `canceled` is final
   * (docs/payments/subscriptions.md#lifecycle-and-access: a late or replayed
   * event never brings back a subscription that has ended). Asked only in
   * that case, so it costs a Stripe call only then. A subscription Stripe
   * marked `unpaid` and the customer later paid is live again, and returns.
   */
  private async endedAtStripe(
    sub: Subscription,
    wouldBecome: string
  ): Promise<boolean> {
    if (
      sub.status !== SUBSCRIPTION_STATUS.CANCELLED ||
      wouldBecome === SUBSCRIPTION_STATUS.CANCELLED ||
      !sub.stripeSubscriptionId
    ) {
      return false;
    }
    const live = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId
    );
    return endedAtStripeStatus(live.status);
  }

  /**
   * Execute revenue transfers to org and creator(s) after invoice payment.
   * Uses source_transaction to link transfers to the charge.
   * Creators without active Connect accounts have their share accumulated.
   *
   * IMPORTANT (Codex-yv18n): This implementation is GBP-only. Every
   * stripe.transfers.create() call here hardcodes `currency: CURRENCY.GBP`.
   * Callers MUST reject non-GBP invoices BEFORE invoking executeTransfers —
   * see the currency guard in handleInvoicePaymentSucceeded() which throws
   * UnsupportedCurrencyError. Cross-currency support is tracked as a future
   * feature bead. Do NOT remove the call-site guard or add new call sites
   * without an equivalent guard + updating tests in
   * subscription-service.test.ts > "Currency GBP-only enforcement".
   */
  private async executeTransfers(
    subscriptionId: string,
    orgId: string,
    chargeId: string,
    platformFeeCents: number,
    orgFeeCents: number,
    creatorPayoutCents: number,
    invoiceCreatedAt: Date = new Date()
  ): Promise<void> {
    const transferGroup = `sub_${subscriptionId}`;

    // Every slice goes through the payouts ledger (Codex-2hxff.11): its row is
    // reserved by a per-charge unique key BEFORE any transfer, so nothing is
    // transferred twice. The split past the platform fee is reserved in one
    // go and only once (Codex-2hxff.62): a redelivered
    // invoice.payment_succeeded keeps the first delivery's split, even when
    // an agreement accepted since is in force at the invoice's time.
    const ledger = this.ledger();
    const source = { sourceType: 'subscription', subscriptionId } as const;

    // Platform fee — retained in the platform Stripe balance at charge time;
    // no transfer. One paid row per charge (Codex-h69cg, Codex-g9owu). A
    // replay keeps the fee an earlier delivery recorded, and the rest of the
    // charge is split from it (Codex-2hxff.49).
    const grossCents = platformFeeCents + orgFeeCents + creatorPayoutCents;
    const recordedFeeCents = await recordPlatformFee(ledger, {
      amountCents: platformFeeCents,
      organizationId: orgId,
      source,
      stripeChargeId: chargeId,
      transferGroup,
      unlessSplit: true,
    });
    const pool =
      recordedFeeCents === platformFeeCents
        ? { organizationFeeCents: orgFeeCents, creatorPayoutCents }
        : await this.poolAfterRecordedFee(
            { subscriptionId, orgId, chargeId },
            grossCents,
            platformFeeCents,
            recordedFeeCents,
            invoiceCreatedAt
          );

    // Codex-2hxff.2: the org slice and the no-agreement creator pool go to
    // whoever owned the org when the invoice was created — the same instant
    // the agreement lookup below uses — not the owner at processing time.
    const orgPayee = await resolveOrganisationPayee(
      this.db,
      orgId,
      invoiceCreatedAt,
      this.obs
    );

    // Codex-ez3tl (C1): query agreements BEFORE the org slice so the org's
    // amount reflects the post-platform residual when creator agreements
    // exist. Per the agreement-math.ts ADR header,
    // `proposed_creator_share_percent` is the creator's absolute fraction
    // of the POST-PLATFORM pool — NOT a relative weight. When agreements
    // exist the fee-config's static `orgFeePercent` is overridden: the org
    // gets the post-platform pool minus what the creators take, rounding
    // pennies included (Codex-2hxff.12).
    //
    // The agreements in force at invoice fire time: one rule for every
    // payment path (`agreementsInForce`, @codex/agreements). It reads the
    // accepted proposal's `proposed_creator_share_percent`, never the legacy
    // `organization_fee_percentage` column; keeps paying past the review date
    // (owner decision AGR-01); and returns one agreement per creator,
    // deterministically — a creator has one slice per charge
    // (uq_payouts_creator_slice_per_charge). It does NOT read membership: a
    // removal terminates the agreements at that moment (AGR-09), so an
    // invoice raised before it is still paid when this webhook lands after.
    const creatorAgreements = await agreementsInForce(this.db, {
      organizationId: orgId,
      revenueType: 'subscription',
      at: invoiceCreatedAt,
      obs: this.obs,
    });

    const postPlatformCents =
      pool.organizationFeeCents + pool.creatorPayoutCents;
    const totalShareBps = creatorAgreements.reduce(
      (sum, a) => sum + a.sharePercent,
      0
    );
    const orgSlice = (amountCents: number): RecordSliceInput => ({
      payoutType: 'organization_fee',
      amountCents,
      organizationId: orgId,
      source,
      stripeChargeId: chargeId,
      transferGroup,
      sendTransferGroup: true,
      // Pending in the payee's name until they can be paid, so it drains
      // to them even if ownership changes before they onboard; `no_owner`
      // if the organisation had none (Codex-2hxff.37).
      payee: orgPayee
        ? { userId: orgPayee.userId, account: orgPayee.account }
        : null,
      idempotencyKey: `${chargeId}_org_fee`,
      metadata: { subscription_id: subscriptionId },
    });

    // No creator is paid — no agreement matched, or every one carries a zero
    // share (e.g. legacy rows backfilled with org_fee=10000): the org keeps
    // its fee-config slice and its owner receives the creator pool.
    if (totalShareBps <= 0) {
      if (creatorAgreements.length > 0) {
        this.obs.info(
          'All active subscription agreements have zero creator share; routing pool to org owner',
          {
            organizationId: orgId,
            subscriptionId,
            agreementCount: creatorAgreements.length,
          }
        );
      }
      await this.recordInvoiceSplit(
        subscriptionId,
        orgId,
        chargeId,
        grossCents,
        [
          orgSlice(pool.organizationFeeCents),
          this.creatorPoolToOwnerSlice(
            subscriptionId,
            orgId,
            chargeId,
            transferGroup,
            pool.creatorPayoutCents,
            orgPayee
          ),
        ]
      );
      return;
    }

    // Distribute the post-platform pool by per-creator share basis points
    // (Codex-rzfjw, WP-4 of Codex-nk4km): `sharePercent` is the creator's
    // absolute slice of the POST-PLATFORM pool, per the agreement-math.ts ADR
    // header. The divisor is `max(totalShareBps, 10000)`: a well-formed config
    // (sum ≤ 10000, bounded by validateProposedShare) divides by 10000; an
    // oversum divides by the actual sum, so creators jointly never exceed the
    // pool.
    const shareDivisor = Math.max(totalShareBps, 10_000);
    const creatorShares = creatorAgreements.map((agreement) => ({
      ...agreement,
      amountCents: Math.floor(
        (postPlatformCents * agreement.sharePercent) / shareDivisor
      ),
    }));
    // The organisation's slice is what the creators do not take — INCLUDING
    // the pennies their floor()s leave behind. Owner decision 2026-10-13
    // (Codex-2hxff.12): rounding remainders go to the organisation and are
    // recorded, never left unrecorded on the platform balance. (It was
    // floor()ed separately, so up to a penny per creator went nowhere.)
    const effectiveOrgFeeCents =
      postPlatformCents -
      creatorShares.reduce((sum, c) => sum + c.amountCents, 0);
    const effectiveCreatorPoolCents = postPlatformCents - effectiveOrgFeeCents;

    // Batch-fetch all creator Connect accounts to avoid N+1 queries. Each
    // creator has one account keyed by userId (Codex-69t7c), independent of
    // which org this subscription belongs to.
    const creatorConnects = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(
        inArray(
          stripeConnectAccounts.userId,
          creatorShares.map((c) => c.creatorId)
        )
      );
    const connectByCreator = new Map(creatorConnects.map((c) => [c.userId, c]));

    // The whole split is planned first and recorded once (Codex-2hxff.62),
    // so every creator's slice is built before any row is written.
    const creatorSlices: Array<{
      creator: (typeof creatorShares)[number];
      minTransferCents: number;
      belowFloor: boolean;
      slice: RecordSliceInput;
    }> = [];
    for (const creator of creatorShares) {
      // Codex-xz61z (I4): exactly one log line per creator whose shape
      // matches its terminal state.
      if (creator.amountCents <= 0) {
        this.obs.info('payout_split_skipped', {
          subscriptionId,
          organizationId: orgId,
          creatorId: creator.creatorId,
          amountCents: creator.amountCents,
          sharePercent: creator.sharePercent,
          totalShareBps,
          pendingReason: 'zero_amount',
        });
        continue;
      }

      // Codex-m644n: per-creator min-transfer floor. Creator A and Creator B
      // can carry different `minTransferCents` in the same invoice. Below the
      // floor the slice is held pending ('min_transfer_floor'); the drains
      // release it once the creator's pending total clears the floor.
      const creatorFees = await this.resolvePayoutFees(
        orgId,
        'subscription',
        creator.creatorId,
        invoiceCreatedAt
      );
      const belowFloor = creator.amountCents < creatorFees.minTransferCents;

      creatorSlices.push({
        creator,
        minTransferCents: creatorFees.minTransferCents,
        belowFloor,
        slice: {
          payoutType: 'creator_payout',
          amountCents: creator.amountCents,
          organizationId: orgId,
          source,
          stripeChargeId: chargeId,
          transferGroup,
          sendTransferGroup: true,
          payee: {
            userId: creator.creatorId,
            account: connectByCreator.get(creator.creatorId),
          },
          ...(belowFloor ? { hold: 'min_transfer_floor' as const } : {}),
          // The agreement this slice was split by, on its row: an invoice has
          // no row of its own (Codex-2hxff.19).
          creatorOrgAgreementId: creator.agreementId,
          idempotencyKey: `${chargeId}_creator_${creator.creatorId}`,
          metadata: {
            subscription_id: subscriptionId,
            creator_id: creator.creatorId,
          },
        },
      });
    }

    const outcomes = await this.recordInvoiceSplit(
      subscriptionId,
      orgId,
      chargeId,
      grossCents,
      [orgSlice(effectiveOrgFeeCents), ...creatorSlices.map((c) => c.slice)]
    );
    if (!outcomes) return;

    for (const [index, entry] of creatorSlices.entries()) {
      const { creator, belowFloor, minTransferCents } = entry;
      // The organisation's slice is first, so creator i is outcome i + 1.
      // None: a replay completing the split found this slice recorded.
      const recorded = outcomes[index + 1];
      if (!recorded) continue;
      const { outcome } = recorded;
      this.obs.info(
        belowFloor ? 'payout_split_skipped' : 'payout_split_computed',
        {
          subscriptionId,
          organizationId: orgId,
          creatorId: creator.creatorId,
          amountCents: recorded.amountCents,
          sharePercent: creator.sharePercent,
          totalShareBps,
          postPlatformCents,
          effectiveOrgFeeCents,
          effectiveCreatorPoolCents,
          ...(belowFloor ? { minTransferCents } : {}),
          ...(recorded.amountCents === creator.amountCents
            ? {}
            : { computedAmountCents: creator.amountCents }),
          outcome: outcome.kind,
          actuallyTransferred:
            outcome.kind === 'paid' || outcome.kind === 'unsettled',
          pendingReason:
            outcome.kind === 'pending'
              ? outcome.reason
              : outcome.kind === 'failed'
                ? 'transfer_failed'
                : outcome.kind === 'held'
                  ? 'dispute_hold'
                  : undefined,
        }
      );
    }
  }

  // ─── Pending Payout Sweep (Codex-vv77x) ─────────────────────────────────
  //
  // Hybrid event+sweep resolution pattern per Stripe docs:
  //   1. account.updated and /connect/me/sync are the primary triggers
  //   2. Webhooks retry for 3 days then drop — this sweep is the safety net
  //   3. Each run CLAIMS a bounded batch of payees (Codex-2hxff.13): one
  //      UPDATE stamps `attempted_at` on their rows, so overlapping runs take
  //      disjoint payees and a payee who is not ready yet goes to the back
  //   4. For each, it asks Stripe for the account's current state and, if it
  //      is charges_enabled && payouts_enabled, drains the whole payee
  //      (resolvePendingPayoutsForAccount)
  //   5. olderThanMinutes guards against racing the webhook on freshly inserted
  //      rows — only sweep rows old enough that the webhook would already have
  //      fired by now if it was going to — and spaces out a payee's checks.

  /**
   * Give an ownerless organisation's held slices to their next owner, now
   * that it has one. `moveOwnership` hands them over as ownership moves,
   * but a slice written while that hand-over was committing is invisible to
   * its UPDATE (READ COMMITTED) and would wait forever; the sweep catches it
   * (Codex-2hxff.37). Returns how many rows moved.
   */
  private async rehomeHeldPayouts(orgId: string): Promise<number> {
    // Nobody owns it now: nothing can be re-homed (an owner who came and
    // went would have taken the held rows with them).
    if (!(await resolveOrganisationPayee(this.db, orgId))) return 0;

    const held = await this.db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.organizationId, orgId),
          isNull(payouts.userId),
          eq(payouts.reason, 'no_owner'),
          eq(payouts.status, 'pending')
        )
      );
    let rehomed = 0;
    // Each row's next owner is decided by its own time; there are rarely
    // any rows here, as the hand-over normally moves them.
    for (const row of held) {
      const payee = await resolveOrganisationPayee(
        this.db,
        orgId,
        row.createdAt,
        this.obs
      );
      if (!payee) continue;
      const moved = await this.db
        .update(payouts)
        .set({
          userId: payee.userId,
          reason: 'connect_not_ready',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payouts.id, row.id),
            isNull(payouts.userId),
            eq(payouts.status, 'pending')
          )
        )
        .returning();
      rehomed += moved.length;
    }
    if (rehomed > 0) {
      this.obs.info('Held payouts re-homed to the organisation owner', {
        organizationId: orgId,
        rehomed,
      });
    }
    return rehomed;
  }

  /**
   * Claim up to `limit` payees whose drainable rows were last checked before
   * `threshold`, least recently checked first (Codex-2hxff.13). A payee is a
   * user with a Connect account row (onboarded, or onboarding), or an
   * ownerless organisation for its held `no_owner` rows. A user who never
   * started onboarding has nothing to check at Stripe, so their rows are left
   * pending and untouched rather than take a place in the batch. A drainable
   * row with neither payee nor organisation can be claimed by no one; those
   * are counted and logged at error.
   *
   * One UPDATE: it stamps `attempted_at = now` on the claimed rows, under
   * `FOR UPDATE SKIP LOCKED`. So the run is bounded; a run that starts while
   * another is claiming skips the rows it holds, and one that starts after
   * finds them checked; and a payee who cannot be paid yet goes to the back
   * of the queue. No session lock: the pooler may hand each statement a
   * different connection. Two runs that start at the same instant can split
   * one payee's rows between them; both then drain that payee, and the
   * per-row attempt claims keep that to a repeated check, never a second
   * transfer.
   */
  private async claimSweepPayees(
    threshold: Date,
    limit: number,
    now: Date = new Date()
  ): Promise<Array<{ userId: string | null; organizationId: string | null }>> {
    const payeeKey = sql`CASE WHEN ${payouts.userId} IS NULL THEN 'org:' || ${payouts.organizationId}::text ELSE 'user:' || ${payouts.userId} END`;
    // Failed transfers are retried too (Codex-2hxff.11), unless an old write
    // path failed them or they wait for support (see isDrainablePayout).
    const drainable = and(
      isDrainablePayout(),
      lt(payouts.attemptedAt, threshold)
    );
    const due = and(
      drainable,
      sql`((${payouts.userId} IS NULL AND ${payouts.organizationId} IS NOT NULL) OR EXISTS (SELECT 1 FROM ${stripeConnectAccounts} WHERE ${stripeConnectAccounts.userId} = ${payouts.userId}))`
    );

    const [unroutable] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(payouts)
      .where(
        and(drainable, isNull(payouts.userId), isNull(payouts.organizationId))
      );
    if (unroutable && unroutable.count > 0) {
      this.obs.error(
        'sweepUnresolvedPayouts: owed rows with neither payee nor organisation; nobody can be paid them',
        { errorId: crypto.randomUUID(), rowCount: unroutable.count }
      );
    }

    const duePayees = this.db
      .select({ payeeKey })
      .from(payouts)
      .where(due)
      .groupBy(payeeKey)
      .orderBy(sql`min(${payouts.attemptedAt})`)
      .limit(limit);
    const claimable = this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(due, inArray(payeeKey, duePayees)))
      .for('update', { skipLocked: true });
    const claimed = await this.db
      .update(payouts)
      .set({ attemptedAt: now })
      .where(inArray(payouts.id, claimable))
      // Bare `.returning()`: the client union collapses the projected overload.
      .returning();

    const payees = new Map<
      string,
      { userId: string | null; organizationId: string | null }
    >();
    for (const row of claimed) {
      const key = row.userId
        ? `user:${row.userId}`
        : `org:${row.organizationId}`;
      if (!payees.has(key)) {
        payees.set(key, {
          userId: row.userId,
          organizationId: row.userId ? null : row.organizationId,
        });
      }
    }
    return [...payees.values()];
  }

  /**
   * The hourly safety net (Codex-vv77x, Codex-2hxff.13): claim a bounded
   * batch of payees with rows older than `olderThanMinutes`
   * (`claimSweepPayees`), and drain each one whose Connect account Stripe
   * now reports charges_enabled && payouts_enabled — all of their rows, in
   * every organisation (`resolvePendingPayoutsForAccount`). An ownerless
   * organisation's held rows are re-homed to its new owner, if it has one.
   *
   * A "group" in the counters is one claimed payee. Returns aggregate
   * counters for observability; never throws on a per-payee failure —
   * failures are isolated and counted.
   */
  async sweepUnresolvedPayouts(
    olderThanMinutes = 15,
    limit = SWEEP_PAYEE_LIMIT,
    /** The hourly cron's own drain (`resolvePendingPayoutsForAccount`). */
    { cronDrain = false }: { cronDrain?: boolean } = {}
  ): Promise<{
    groupsScanned: number;
    groupsResolved: number;
    groupsSkipped: number;
    errors: number;
  }> {
    const now = new Date();
    const threshold = new Date(now.getTime() - olderThanMinutes * 60 * 1000);

    // claimSweepPayees takes only payees with a Connect account row (plus
    // organisations with no owner): a payee who never onboarded cannot be
    // paid, and must not take a batch slot from one who can. Rows with no
    // payee and no organisation are counted and logged there.
    const groups = await this.claimSweepPayees(threshold, limit, now);

    const groupsScanned = groups.length;
    let groupsResolved = 0;
    let groupsSkipped = 0;
    let errors = 0;
    // A short platform balance fails every payee's rows alike: one error for
    // the sweep, at its first failure, not one per payee (Codex-r094t).
    const platformFailures = platformFailureTally();

    if (groupsScanned === 0) {
      this.obs.info('sweepUnresolvedPayouts: no pending groups', {
        olderThanMinutes,
      });
      return {
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      };
    }

    for (const group of groups) {
      // Codex-h69cg + Codex-69t7c WP5: payouts.userId and .organizationId are
      // both nullable. A null `userId` is the genuinely UNROUTABLE case —
      // platform_fee rows (always status='paid', so they shouldn't surface
      // here) or any row with no recipient — skip those. A null
      // `organizationId` is NOT unroutable: orgless (bi-party) creator_payout
      // rows carry organizationId=NULL but a real userId, and MUST be drained.
      // The original `!group.organizationId` guard skipped every orgless group,
      // so the cron safety-net never resolved orgless rows — stranding money.
      if (!group.userId) {
        // Only an ownerless organisation's held money has no payee (platform
        // fees are paid, so never here). Nothing can drain it until support
        // assigns an owner, so every sweep says so (Codex-2hxff.37).
        if (group.organizationId) {
          try {
            const rehomed = await this.rehomeHeldPayouts(group.organizationId);
            if (rehomed === 0) {
              this.obs.warn(
                'sweepUnresolvedPayouts: money held for an organisation with no owner',
                { organizationId: group.organizationId }
              );
            }
          } catch (error) {
            errors++;
            this.obs.error(
              'sweepUnresolvedPayouts: re-homing held payouts failed',
              {
                errorId: crypto.randomUUID(),
                organizationId: group.organizationId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
        groupsSkipped++;
        continue;
      }
      try {
        // Find the user's single Connect account (by userId, Codex-69t7c) so
        // we can look up the stripeAccountId. This resolves the recipient by
        // userId ALONE — independent of org — which is exactly what lets an
        // orgless group (organizationId=NULL) route to a Connect account. If
        // the row is missing (rare — a Connect account was deleted but its
        // payouts survived because of ON DELETE behaviour) skip this group; it
        // will be re-attempted on the next sweep window.
        const [connect] = await this.db
          .select({ stripeAccountId: stripeConnectAccounts.stripeAccountId })
          .from(stripeConnectAccounts)
          .where(eq(stripeConnectAccounts.userId, group.userId))
          .limit(1);

        if (!connect) {
          this.obs.warn(
            'sweepUnresolvedPayouts: connect row missing for pending group',
            { userId: group.userId }
          );
          groupsSkipped++;
          continue;
        }

        // Ask Stripe for current account state. The Connect account flags
        // change asynchronously after onboarding so we cannot trust the
        // DB-mirrored row — that is the bug this sweep exists to fix.
        const account = await this.stripe.accounts.retrieve(
          connect.stripeAccountId
        );

        const ready =
          account.charges_enabled === true && account.payouts_enabled === true;
        if (!ready) {
          groupsSkipped++;
          continue;
        }

        // The whole payee, every organisation (Codex-2hxff.13).
        await this.resolvePendingPayoutsForAccount(
          connect.stripeAccountId,
          platformFailures,
          { cronDrain }
        );
        groupsResolved++;
      } catch (error) {
        errors++;
        this.obs.error('sweepUnresolvedPayouts: per-group failure', {
          errorId: crypto.randomUUID(),
          userId: group.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next group — don't fail the whole sweep
      }
    }

    reportPlatformFailures(this.ledger(), platformFailures, {
      sweep: true,
      olderThanMinutes,
      groupsResolved,
    });

    this.obs.info('sweepUnresolvedPayouts: complete', {
      olderThanMinutes,
      limit,
      groupsScanned,
      groupsResolved,
      groupsSkipped,
      errors,
    });

    return { groupsScanned, groupsResolved, groupsSkipped, errors };
  }
}
