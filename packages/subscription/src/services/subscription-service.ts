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

import type { VersionedCache } from '@codex/cache';
import {
  BILLING_INTERVAL,
  CURRENCY,
  FEES,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import { dateWindow, isUniqueViolation, toIso } from '@codex/database';
import {
  creatorOrganizationAgreements,
  organizationFollowers,
  organizationMemberships,
  organizations,
  type PayoutType,
  payouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  applyMinPlatformFeeFloor,
  type FeeConfig,
  type FeeConfigService,
  type FeeContext,
  resolvePrimaryConnect,
  withStaleCustomerRecovery,
} from '@codex/purchase';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
  UnsupportedCurrencyError,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import {
  aliasedTable,
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadySubscribedError,
  ConnectAccountNotReadyError,
  ForbiddenError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  SubscriptionPaymentRequiredError,
  TierNotFoundError,
} from '../errors';
import { calculateRevenueSplit } from './revenue-split';
import { mapStripeSubscriptionStatus } from './stripe-status-mapper';
import {
  type InvalidationReason,
  invalidateForUser,
  type WaitUntilFn,
} from './subscription-invalidation';

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
  | 'cancelled_by_refund';

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
    | 'needs_attention';
  sourceType?: 'all' | 'purchase' | 'subscription';
  fromDate?: string;
  toDate?: string;
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
  return 'pending';
}

/**
 * Options for `SubscriptionService.propagateTierPriceToActiveSubscriptions`.
 *
 * All fields are optional — sensible defaults apply when omitted. The
 * proration policy is surfaced as a named parameter because Q1 product
 * may overturn the `create_prorations` default at any time (see bead
 * Codex-3xyyb and the separate follow-up for the policy decision).
 */
export interface PropagateTierPriceOptions {
  /**
   * Stripe proration behaviour for the mid-cycle Price swap. Defaults to
   * `'create_prorations'` — matches Stripe's default, charges the
   * difference on the next invoice. `'none'` defers the new amount to
   * the next billing cycle without any immediate adjustment.
   * `'always_invoice'` invoices the proration amount immediately rather
   * than adding it to the next invoice.
   */
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
  /**
   * Upper bound on concurrent Stripe API calls per batch. Stripe's
   * per-account rate limit is 25 req/sec (test) / 100 req/sec (live) —
   * the default keeps us conservatively below both, with retries
   * protected by the deterministic idempotency key. Values below 1 are
   * clamped to 1.
   */
  batchSize?: number;
  /**
   * Delay in milliseconds inserted between batches. Suppresses trailing
   * delay after the last batch. Values below 0 are clamped to 0.
   */
  interBatchDelayMs?: number;
  /**
   * Optional additional org scope. When provided, restricts the set of
   * affected subscriptions to those belonging to the given org. Both
   * call sites know the org (tier is org-scoped) and pass this through
   * as a defense-in-depth check — even if a tier id somehow collided
   * with another org's subscription, we would not touch it.
   */
  organizationId?: string;
}

/**
 * Result shape returned by
 * `SubscriptionService.propagateTierPriceToActiveSubscriptions`.
 *
 * Informational only — DB state for the per-subscription amount is
 * reconciled by the existing `customer.subscription.updated` webhook
 * that Stripe emits for each updated subscription. Callers should not
 * branch on these counts for correctness; they exist for observability.
 */
export interface PropagateTierPriceResult {
  /** Number of active/cancelling subscriptions discovered for the tier. */
  total: number;
  /** Subscriptions whose Stripe Price was successfully swapped. */
  updated: number;
  /** Subscriptions whose swap failed (logged individually via obs.error). */
  failed: number;
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
 * docs/subscription-cache-audit/phase-1-p0.md for the gap matrix.
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
 * Result of `previewTierChange()` — drives the proration confirmation dialog.
 *
 * `prorationDate` is the canonical timestamp the preview was computed at.
 * Callers MUST pass it back into `changeTier()` so the actual proration
 * matches the preview exactly (Stripe re-runs the calculation otherwise).
 */
export interface TierChangePreview {
  /** Net amount the customer pays NOW (proration delta, in pence). */
  amountDueCents: number;
  /** Proration line items (charges and credits) the customer sees. */
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
  /** True if the new recurring amount exceeds the current subscription amount. */
  isUpgrade: boolean;
  /** End of the current billing period — used in "next charge on" copy. */
  currentPeriodEnd: Date;
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
   * Optional mailer thunk used by `propagateTierPriceToActiveSubscriptions`
   * (Codex-7kc83) to notify each affected subscriber that their Stripe
   * Price is being swapped. Service stays unaware of the notifications-api
   * transport — the registry wires this to `sendEmailToWorker(env, ctx,
   * params)` so the service can call it synchronously inside the per-sub
   * success branch without threading `Bindings` or `ExecutionContext`.
   * When absent (narrow unit tests, legacy harnesses), price-change
   * propagation still succeeds; only the email side-effect is skipped.
   */
  mailer?: TierPriceChangeMailer;
  /**
   * Optional base URL used to construct the subscription management link
   * embedded in the price-change notice. Webhook handlers already accept
   * a `webAppUrl` argument per method — surfacing it on config here is
   * cleaner for propagation because the call site is deep inside a
   * background tail rather than a request handler. When absent, the
   * template falls back to a relative `/account/subscriptions` path so
   * the email still renders; operator review can fix the absolute URL
   * without needing to re-send.
   */
  webAppUrl?: string;
  /**
   * Optional DB-configurable fee resolver (Codex-m644n).
   *
   * When provided, the subscription invoice flows resolve platform/org fees
   * via `feeConfig.getFeesForOrg(orgId, 'subscription')` instead of the
   * `FEES.*` code constants. The per-creator fan-out inside `executeTransfers`
   * additionally consults `getFeesForCreator(orgId, creatorId, 'subscription')`
   * so two creators in the same invoice can receive different splits when one
   * has a negotiated override.
   *
   * When absent (narrow unit tests, legacy harnesses), the service falls
   * back to the `FEES.*` constants — bit-for-bit pre-Codex-m644n behaviour.
   */
  feeConfig?: FeeConfigService;
}

/**
 * Fire-and-forget email dispatch used by price-change propagation.
 * Matches the shape of `SendEmailToWorkerParams` from `@codex/worker-utils`
 * so the registry can wire `sendEmailToWorker(env, ctx, params)` directly
 * into this slot. Returns `void` — failures are the mailer's concern
 * (notifications-api audit log on the remote side).
 */
type TierPriceChangeMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'subscription-tier-price-change';
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

/**
 * Read the source-charge id from an invoice's inline `payments.data[0]`.
 * Returns null when payments are not expanded — see resolveInvoiceCharge
 * for the full fallback chain to recover the charge in that case.
 */
function extractInvoiceCharge(invoice: Stripe.Invoice): string | null {
  const payment = invoice.payments?.data?.[0];
  const charge = payment?.payment?.charge;
  return typeof charge === 'string' ? charge : null;
}

function extractInvoicePaymentIntent(invoice: Stripe.Invoice): string | null {
  const payment = invoice.payments?.data?.[0];
  const pi = payment?.payment?.payment_intent;
  return typeof pi === 'string' ? pi : null;
}

export class SubscriptionService extends BaseService {
  private readonly stripe: Stripe;
  private readonly cache: VersionedCache | undefined;
  private readonly waitUntil: WaitUntilFn | undefined;
  private readonly mailer: TierPriceChangeMailer | undefined;
  private readonly webAppUrl: string | undefined;
  private readonly feeConfig: FeeConfigService | undefined;

  constructor(config: SubscriptionServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.cache = config.cache;
    this.waitUntil = config.waitUntil;
    this.mailer = config.mailer;
    this.webAppUrl = config.webAppUrl;
    this.feeConfig = config.feeConfig;
  }

  /**
   * Resolve fee config for a payout (Codex-m644n, Codex-5794i).
   *
   * `ctx` selects the policy: `'subscription'` carries SUBSCRIPTION_ORG_PERCENT
   * (15%), `'one_off'` carries ORG_PERCENT (10%). The fallback path (no
   * FeeConfigService injected) honours the same split via constants — so
   * legacy unit tests don't accidentally drift between policies.
   *
   * Used by:
   * - subscription invoice path (per-org + per-creator) with `'subscription'`
   * - resolvePendingPayouts retry — `'one_off'` for purchase-sourced rows,
   *   `'subscription'` for sub-sourced rows. Without this branch a low
   *   purchase payout could pile up indefinitely behind the subscription
   *   min-transfer floor.
   */
  private async resolvePayoutFees(
    orgId: string,
    ctx: FeeContext,
    creatorId?: string
  ): Promise<FeeConfig> {
    if (!this.feeConfig) {
      return {
        platformFeePercent: FEES.PLATFORM_PERCENT,
        orgFeePercent:
          ctx === 'subscription'
            ? FEES.SUBSCRIPTION_ORG_PERCENT
            : FEES.ORG_PERCENT,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      };
    }
    return creatorId
      ? this.feeConfig.getFeesForCreator(orgId, creatorId, ctx)
      : this.feeConfig.getFeesForOrg(orgId, ctx);
  }

  /**
   * Compute a final revenue split for the subscription path: resolves
   * DB-configurable fees by orgId, runs the pure split math, then applies
   * the min-platform-fee floor (Codex-m644n).
   *
   * Used by invoice creation, recurring invoice updates, and tier-change
   * proration — all of which need an identical (split, fees) pair that
   * satisfies the `amount = platform + org + creator` CHECK constraint.
   */
  private async computeSubscriptionSplit(
    orgId: string,
    amountCents: number
  ): Promise<{
    platformFeeCents: number;
    organizationFeeCents: number;
    creatorPayoutCents: number;
  }> {
    const orgFees = await this.resolvePayoutFees(orgId, 'subscription');
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

      // Validate Connect account — resolved through the canonical
      // organizations.primary_connect_account_user_id so orgs with
      // multiple Connect accounts (one per user) route to the same
      // account for every tier op and revenue transfer.
      const connectAccount = await resolvePrimaryConnect(this.db, orgId);

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

      // `withStaleCustomerRecovery` resolves the unified Stripe Customer id
      // and self-heals when `users.stripe_customer_id` is stale. Two
      // real-world causes for the stale state:
      //   1. Operator deleted the customer in the Stripe dashboard.
      //   2. (Dev only) A seed wrote a synthetic id that never existed.
      // The helper clears the cache, mints a fresh customer, and retries the
      // session create exactly once. A second `resource_missing` propagates.
      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        { userId, email: user.email },
        (stripeCustomerId) =>
          this.stripe.checkout.sessions.create({
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
            },
            subscription_data: {
              metadata: {
                codex_user_id: userId,
                codex_organization_id: orgId,
                codex_tier_id: tierId,
              },
            },
          }),
        {
          onStaleRecovery: (info) =>
            this.obs.warn(
              'Stale users.stripe_customer_id detected; clearing and retrying',
              { ...info, orgId, tierId, billingInterval }
            ),
        }
      );

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
   */
  async verifyCheckoutSession(
    sessionId: string,
    userId: string
  ): Promise<{
    sessionStatus: 'complete' | 'expired' | 'open';
    subscription?: {
      id: string;
      organizationId: string;
      tierId: string;
      tierName: string;
      organizationName: string;
      organizationSlug: string;
      startedAt: string;
    };
  }> {
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

      const result: {
        sessionStatus: 'complete' | 'expired' | 'open';
        subscription?: {
          id: string;
          organizationId: string;
          tierId: string;
          tierName: string;
          organizationName: string;
          organizationSlug: string;
          startedAt: string;
        };
      } = {
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
        where: eq(subscriptions.stripeSubscriptionId, stripeSubId),
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
      }

      return result;
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;

      if (
        error instanceof Error &&
        'type' in error &&
        (error as { type?: string }).type === 'StripeInvalidRequestError'
      ) {
        throw new SubscriptionCheckoutError('Checkout session not found', {
          stripeError: error.message,
          sessionId,
        });
      }

      this.handleError(error, 'verifyCheckoutSession');
    }
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
   * inserts subscription + follower + membership in one transaction. The
   * unique constraint on `stripe_subscription_id` makes this safe under
   * concurrent self-heal + create-event delivery.
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

    // Initial amount: latest_invoice.amount_paid — matches handleInvoicePaymentSucceeded.
    // Subsequent invoice.payment_succeeded writes overwrite this with the actual
    // charged amount, so a 0 from a trial-only sub heals to the real amount on first bill.
    let amountCents = 0;
    const latestInvoice = stripeSub.latest_invoice;
    if (latestInvoice && typeof latestInvoice === 'object') {
      amountCents = latestInvoice.amount_paid;
    } else if (typeof latestInvoice === 'string') {
      const invoice = await this.stripe.invoices.retrieve(latestInvoice);
      amountCents = invoice.amount_paid;
    }

    const item = stripeSub.items.data[0];
    const billingInterval =
      item?.price?.recurring?.interval === 'year'
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;
    const periodStart = item?.current_period_start ?? 0;
    const periodEnd = item?.current_period_end ?? 0;

    const split = await this.computeSubscriptionSplit(orgId, amountCents);

    try {
      await (this.db as typeof import('@codex/database').dbWs).transaction(
        async (tx) => {
          await tx.insert(subscriptions).values({
            userId,
            organizationId: orgId,
            tierId,
            stripeSubscriptionId: stripeSubId,
            stripeCustomerId:
              typeof stripeSub.customer === 'string'
                ? stripeSub.customer
                : stripeSub.customer.id,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            billingInterval,
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
            amountCents,
            platformFeeCents: split.platformFeeCents,
            organizationFeeCents: split.organizationFeeCents,
            creatorPayoutCents: split.creatorPayoutCents,
          });

          // Auto-follow: subscribers implicitly follow the org. Follower
          // persists after cancellation; user must explicitly unfollow.
          await tx
            .insert(organizationFollowers)
            .values({ organizationId: orgId, userId })
            .onConflictDoNothing();

          // BUG-016: Upsert membership with role=subscriber (backward compat).
          // Preserve higher roles (owner/admin/creator) on conflict.
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
                role: sql`CASE WHEN ${organizationMemberships.role} IN ('owner', 'admin', 'creator') THEN ${organizationMemberships.role} ELSE 'subscriber' END`,
                updatedAt: new Date(),
              },
            });
        }
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Concurrent self-heal or create-event raced us to insert. Re-select
        // and return justInserted=false so caller skips the "just inserted"
        // log line — the row is now present either way.
        const [raced] = await this.db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
          .limit(1);
        if (raced) {
          return { subscription: raced, justInserted: false };
        }
        throw error;
      }
      throw error;
    }

    const [inserted] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);
    if (!inserted) {
      // Should be unreachable — INSERT just succeeded. Defensive throw so a
      // truly impossible state surfaces as 5xx (Stripe retry) instead of NPE.
      throw new InternalServiceError(
        'ensureSubscriptionDataPresent: row missing after successful insert',
        { stripeSubscriptionId: stripeSubId }
      );
    }

    if (context.knownStripeSub) {
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
  ): Promise<WebhookHandlerResult | void> {
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
    let amountCents = 0;
    const latestInvoice = stripeSubscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice === 'object') {
      amountCents = latestInvoice.amount_paid;
    } else if (typeof latestInvoice === 'string') {
      const invoice = await this.stripe.invoices.retrieve(latestInvoice);
      amountCents = invoice.amount_paid;
    }

    const item = stripeSubscription.items.data[0];
    const billingInterval =
      item?.price?.recurring?.interval === 'year'
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH;

    const email = await this.buildSubscriptionCreatedEmail(
      userId,
      tierId,
      stripeSubscription,
      amountCents,
      billingInterval,
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
    billingInterval: string,
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
   * Resolve the source charge id for a paid invoice.
   *
   * Why: Stripe 2024+ invoice payloads omit `payments.data` unless the
   * invoice is retrieved with `expand: ['payments']`. The raw webhook
   * event is an immutable snapshot, so the inline shape is almost always
   * empty in production. Without this fallback chain, executeTransfers
   * never runs (Codex-zdbhg).
   *
   * Order of resolution:
   *   1. Inline `payments.data[0]` on the supplied invoice (test fixtures + cache hits)
   *   2. Retrieve the invoice with `expand: ['payments']` (canonical Stripe 2024+ path)
   *   3. If we have a payment_intent but no charge, `paymentIntents.retrieve → latest_charge`
   *   4. Final fallback: `charges.list({ payment_intent })` — rare race after PI confirmation
   */
  private async resolveInvoiceCharge(
    stripeInvoice: Stripe.Invoice
  ): Promise<string | null> {
    let chargeId = extractInvoiceCharge(stripeInvoice);
    let piId = extractInvoicePaymentIntent(stripeInvoice);

    if (!chargeId && !piId && stripeInvoice.id) {
      const expanded = await this.stripe.invoices.retrieve(stripeInvoice.id, {
        expand: ['payments'],
      });
      chargeId = extractInvoiceCharge(expanded);
      piId = extractInvoicePaymentIntent(expanded);
    }

    if (chargeId) return chargeId;
    if (!piId) return null;

    const pi = await this.stripe.paymentIntents.retrieve(piId);
    if (typeof pi.latest_charge === 'string') return pi.latest_charge;

    // Idempotency-drift invariant: charges.list returns the most recent
    // charge for this PI. We assume Stripe sets pi.latest_charge once and
    // never reassigns. If that invariant breaks (e.g., PI re-charge after
    // a failure), the chargeId resolved here could differ across webhook
    // retries → idempotency keys diverge → executeTransfers may double-pay.
    const charges = await this.stripe.charges.list({
      payment_intent: piId,
      limit: 1,
    });
    const first = charges.data?.[0];
    return typeof first?.id === 'string' ? first.id : null;
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
  ): Promise<WebhookHandlerResult | void> {
    // Stripe v19+: subscription ID is in parent.subscription_details
    const subDetails = stripeInvoice.parent?.subscription_details;
    const stripeSubId =
      typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : (subDetails?.subscription?.id ?? null);
    if (!stripeSubId) return;

    // Resolve the source charge for transfers. Webhook payloads in Stripe
    // 2024+ do NOT include expanded `payments.data` by default — the field
    // is only populated when explicitly expanded on retrieve. Without the
    // expand-fallback chain below, every real invoice.payment_succeeded
    // event silently skipped transfers (Codex-zdbhg).
    const sourceTransaction = await this.resolveInvoiceCharge(stripeInvoice);
    if (!sourceTransaction) {
      this.obs.warn(
        'Invoice has no charge or payment intent, skipping transfers',
        { invoiceId: stripeInvoice.id }
      );
      return;
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

    // Fetch the Stripe subscription for period dates (v19+: on items)
    const stripeSub = await this.stripe.subscriptions.retrieve(stripeSubId);
    const subItem = stripeSub.items.data[0];
    const periodStart = subItem?.current_period_start ?? 0;
    const periodEnd = subItem?.current_period_end ?? 0;

    // Update period dates and recalculate split (DB-configurable fees, Codex-m644n).
    const amountCents = stripeInvoice.amount_paid;
    const split = await this.computeSubscriptionSplit(
      sub.organizationId,
      amountCents
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

    // GBP-only enforcement (Codex-yv18n): explicitly reject non-GBP charges
    // before triggering transfers. executeTransfers and downstream
    // stripe.transfers.create() are hardcoded to CURRENCY.GBP — silently
    // letting a non-GBP invoice through would cause a currency mismatch at
    // Stripe. Cross-currency support is a tracked future feature.
    this.assertGbpOnly(stripeInvoice.currency, {
      invoiceId: stripeInvoice.id,
      subscriptionId: sub.id,
      stripeSubscriptionId: stripeSubId,
    });

    // Execute revenue transfers
    await this.executeTransfers(
      sub.id,
      sub.organizationId,
      sourceTransaction,
      split.platformFeeCents,
      split.organizationFeeCents,
      split.creatorPayoutCents
    );

    this.obs.info('Invoice payment processed', {
      subscriptionId: sub.id,
      invoiceId: stripeInvoice.id,
      amountCents,
    });

    // Build renewal email only for recurring invoices (not first payment)
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
          priceFormatted: `£${((stripeInvoice.amount_paid ?? 0) / 100).toFixed(2)}`,
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
  ): Promise<WebhookHandlerResult | void> {
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
        userId = sub.userId;
        orgId = sub.organizationId;

        await this.db
          .update(subscriptions)
          .set({
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));

        this.obs.info('Subscription status updated to past_due', {
          stripeSubscriptionId: stripeSubId,
        });
      }
    }

    // Build payment-failed email
    let email: WebhookEmailPayload | undefined;
    if (stripeInvoice.customer_email) {
      email = {
        to: stripeInvoice.customer_email,
        toName: stripeInvoice.customer_name || undefined,
        templateName: 'payment-failed',
        category: 'transactional',
        data: {
          userName: stripeInvoice.customer_name || 'there',
          planName: stripeInvoice.lines.data[0]?.description || 'Subscription',
          priceFormatted: `£${((stripeInvoice.amount_due ?? 0) / 100).toFixed(2)}`,
          retryDate: stripeInvoice.next_payment_attempt
            ? new Date(
                stripeInvoice.next_payment_attempt * 1000
              ).toLocaleDateString('en-GB')
            : 'soon',
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
   */
  async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription
  ): Promise<WebhookHandlerResult | void> {
    const stripeSubId = stripeSubscription.id;

    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1);

    if (!sub) return;

    // Shared mapper prevents field drift (V1/V2/V5 in the audit). Passing
    // `sub.status` as the fallback preserves DB state if Stripe reports a
    // status that doesn't map onto the Codex enum (e.g. 'trialing'). Cast
    // is safe: status is constrained at insert by subscriptionStatusSchema.
    const mapped = mapStripeSubscriptionStatus(
      stripeSubscription,
      sub.status as (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS]
    );
    const newTierId = mapped.tierId;

    await this.db
      .update(subscriptions)
      .set({
        status: mapped.status,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        ...(newTierId && newTierId !== sub.tierId && { tierId: newTierId }),
        ...(mapped.billingInterval && {
          billingInterval: mapped.billingInterval,
        }),
        ...(mapped.amountCents !== null && {
          amountCents: mapped.amountCents,
        }),
        ...(mapped.currentPeriodStart && {
          currentPeriodStart: mapped.currentPeriodStart,
        }),
        ...(mapped.currentPeriodEnd && {
          currentPeriodEnd: mapped.currentPeriodEnd,
        }),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    this.obs.info('Subscription updated from webhook', {
      subscriptionId: sub.id,
      status: mapped.status,
      cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
    });

    // Orchestrator hook: tier changes, status flips (active ↔ cancelling
    // ↔ past_due) all affect library visibility + subscription badge —
    // bump both per-user version keys.
    this.invalidateIfConfigured(
      sub.userId,
      sub.organizationId,
      'subscription_updated'
    );

    return { userId: sub.userId, orgId: sub.organizationId };
  }

  /**
   * Handle customer.subscription.deleted — subscription cancelled/expired.
   *
   * Returns a result object with:
   * - userId for cache invalidation
   * - email payload for the subscription-cancelled notification
   *
   * @param stripeSubscription The Stripe subscription object
   * @param webAppUrl The web app base URL for email links (optional)
   */
  async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription,
    webAppUrl?: string
  ): Promise<WebhookHandlerResult> {
    const stripeSubId = stripeSubscription.id;
    const metadata = stripeSubscription.metadata ?? {};
    const userId = metadata.codex_user_id;
    const orgId = metadata.codex_organization_id;

    // Atomic: subscription cancel + membership demotion commit together.
    // A DB hiccup between these two writes previously left the
    // subscription cancelled but the user still listed as an active
    // `subscriber` role — inconsistent state the access layer can't
    // reason about.
    await (this.db as typeof import('@codex/database').dbWs).transaction(
      async (tx) => {
        await tx
          .update(subscriptions)
          .set({
            status: SUBSCRIPTION_STATUS.CANCELLED,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

        // BUG-016: Deactivate membership only when the role is 'subscriber'
        // — preserves higher roles (owner/admin/creator).
        if (userId && orgId) {
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
        }
      }
    );

    this.obs.info('Subscription deleted/cancelled from webhook', {
      stripeSubscriptionId: stripeSubId,
    });

    // Build cancellation email
    const email = userId
      ? await this.buildSubscriptionCancelledEmail(
          userId,
          stripeSubscription,
          webAppUrl
        )
      : undefined;

    // Orchestrator hook: deletion is access-reducing — bump both caches
    // so other devices flip off library entries + subscription badge
    // within one visibility tick. Skipped when metadata missing userId.
    this.invalidateIfConfigured(
      userId || undefined,
      orgId || undefined,
      'subscription_deleted'
    );

    return {
      userId: userId || undefined,
      orgId: orgId || undefined,
      email: email ?? undefined,
    };
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

    // Use the shared mapper with ACTIVE as the fallback — resume's
    // expected outcome is that the subscription is active, even if Stripe
    // reports an unmapped status like 'trialing'.
    const mapped = mapStripeSubscriptionStatus(
      stripeSubscription,
      SUBSCRIPTION_STATUS.ACTIVE
    );
    const nextStatus = mapped.status;

    await this.db
      .update(subscriptions)
      .set({
        status: nextStatus,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

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
   * charged a different amount than they confirmed.
   *
   * Reuses the same tier-existence + price-configured guards as `changeTier()`
   * so a preview that succeeds is a strong signal the commit will too.
   */
  async previewTierChange(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year'
  ): Promise<TierChangePreview> {
    try {
      const sub = await this.getSubscriptionOrThrow(userId, orgId);

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

      const stripeSub = await this.stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId
      );
      const itemId = stripeSub.items.data[0]?.id;

      if (!itemId) {
        throw new SubscriptionCheckoutError('No subscription item found');
      }

      const newRecurringAmountCents =
        billingInterval === BILLING_INTERVAL.MONTH
          ? newTier.priceMonthly
          : newTier.priceAnnual;

      const prorationDate = Math.floor(Date.now() / 1000);

      const preview = await this.stripe.invoices.createPreview({
        subscription: sub.stripeSubscriptionId,
        subscription_details: {
          items: [{ id: itemId, price: newPriceId }],
          proration_date: prorationDate,
          proration_behavior: 'always_invoice',
        },
      });

      const prorationLineItems = preview.lines.data
        .filter(
          (line) => line.parent?.subscription_item_details?.proration === true
        )
        .map((line) => ({
          description: line.description,
          amountCents: line.amount,
        }));

      return {
        amountDueCents: preview.amount_due,
        prorationLineItems,
        newRecurringAmountCents,
        newRecurringInterval: billingInterval,
        prorationDate,
        isUpgrade: newRecurringAmountCents > sub.amountCents,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
    } catch (error) {
      this.handleError(error, 'previewTierChange');
    }
  }

  /**
   * Change subscription tier (upgrade or downgrade).
   *
   * Branches on direction:
   *
   * - **Upgrade** (new recurring price > current `amountCents`): Stripe is
   *   asked to invoice the prorated difference IMMEDIATELY
   *   (`proration_behavior: 'always_invoice'` +
   *   `payment_behavior: 'error_if_incomplete'`). If the charge fails
   *   (declined card, 3DS challenge), Stripe REVERTS the price update on
   *   its side — we throw `SubscriptionPaymentRequiredError` (HTTP 402)
   *   and the local row is untouched. Stripe is authoritative; the
   *   subscription stays on the old tier with no reconciliation needed.
   *
   * - **Downgrade** (Phase 1 fallback): keeps existing
   *   `proration_behavior: 'create_prorations'` — credit applied to next
   *   invoice, immediate effect. Phase 2 replaces this with a scheduled
   *   change via `stripe.subscriptionSchedules.create` so the higher tier
   *   stays active until the current period ends.
   *
   * `prorationDate` should be the Unix timestamp returned by
   * `previewTierChange()` so the commit-time charge matches the preview to
   * the penny. Stripe re-runs the proration calculation against
   * `Date.now()` if omitted.
   */
  async changeTier(
    userId: string,
    orgId: string,
    newTierId: string,
    billingInterval: 'month' | 'year',
    prorationDate?: number
  ): Promise<{ userId: string; orgId: string; subscription: Subscription }> {
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

      const newRecurringAmount =
        billingInterval === BILLING_INTERVAL.MONTH
          ? newTier.priceMonthly
          : newTier.priceAnnual;
      const isUpgrade = newRecurringAmount > sub.amountCents;
      const effectiveProrationDate =
        prorationDate ?? Math.floor(Date.now() / 1000);

      try {
        await this.stripe.subscriptions.update(
          sub.stripeSubscriptionId,
          {
            items: [{ id: itemId, price: newPriceId }],
            proration_behavior: isUpgrade
              ? 'always_invoice'
              : 'create_prorations',
            // Pin proration to the preview's timestamp so the customer
            // pays exactly what the dialog showed them.
            proration_date: effectiveProrationDate,
            // Upgrade-only: require the proration invoice to clear before
            // the subscription transitions. On 402, Stripe reverts the
            // price update; we map to SubscriptionPaymentRequiredError so
            // the route surfaces a friendly "card declined" toast and
            // the local row stays untouched.
            ...(isUpgrade && {
              payment_behavior: 'error_if_incomplete' as const,
            }),
            metadata: {
              codex_tier_id: newTierId,
              codex_user_id: userId,
              codex_organization_id: orgId,
            },
          },
          isUpgrade
            ? {
                idempotencyKey: `upgrade_${sub.id}_${effectiveProrationDate}`,
              }
            : undefined
        );
      } catch (stripeError) {
        const statusCode = (stripeError as { statusCode?: number })?.statusCode;
        if (isUpgrade && statusCode === 402) {
          // Stripe rejected the proration invoice. The price update was
          // reverted on Stripe's side — the subscription stays on the
          // old tier. Throw the typed 402 so the route returns a clean
          // "payment required" response and the UI prompts the user to
          // update their payment method.
          throw new SubscriptionPaymentRequiredError(
            'Payment for the upgrade was declined. Update your payment method and try again.',
            {
              userId,
              organizationId: orgId,
              newTierId,
              billingInterval,
              stripeMessage: (stripeError as Error).message,
              // Surface the prorationDate the failed commit pinned to
              // Stripe so the pricing dialog can branch "needs fresh
              // preview" vs "transient payment failure" by comparing
              // against the dialog's local preview state.
              prorationDate: effectiveProrationDate,
              // tierIdAtCommit lets the dialog correlate the 402 back to
              // the specific tier row the commit targeted (defensive
              // against dialog state drift between submit and response).
              tierIdAtCommit: newTierId,
            }
          );
        }
        throw stripeError;
      }

      // BUG-020: Stripe update succeeded — now update local record.
      // If this DB write fails, the Stripe subscription is already changed.
      // The customer.subscription.updated webhook (handleSubscriptionUpdated)
      // will reconcile local state from Stripe's metadata, so eventual
      // consistency is guaranteed. We log the failure for observability.
      //
      // amountCents is mirrored synchronously from the chosen tier's stored
      // price so the account/subscriptions UI reflects the new price the
      // moment changeTier returns. The webhook still reconciles as a safety
      // net, but we don't depend on it (e.g. dev envs without stripe listen
      // forwarding would otherwise show a stale price indefinitely).
      //
      // The three split fields are recomputed alongside amountCents because
      // the row carries a CHECK constraint:
      //   amount_cents = platform_fee + org_fee + creator_payout
      // Updating amountCents alone would silently violate it.
      // DB-configurable fees (Codex-m644n) — falls back to FEES.* constants
      // when FeeConfigService is not injected (legacy tests).
      const newSplit = await this.computeSubscriptionSplit(
        orgId,
        newRecurringAmount
      );
      try {
        await this.db
          .update(subscriptions)
          .set({
            tierId: newTierId,
            billingInterval,
            amountCents: newRecurringAmount,
            platformFeeCents: newSplit.platformFeeCents,
            organizationFeeCents: newSplit.organizationFeeCents,
            creatorPayoutCents: newSplit.creatorPayoutCents,
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
        // Don't re-throw — the Stripe change is authoritative and the webhook
        // (customer.subscription.updated) will bring local state into sync.
      }

      this.obs.info('Subscription tier changed', {
        subscriptionId: sub.id,
        oldTierId: sub.tierId,
        newTierId,
        billingInterval,
      });

      // Orchestrator hook: tier change affects both library (new tier
      // may unlock/lock content) and subscription badge. Bump both
      // per-user version keys. Runs AFTER Stripe.subscriptions.update
      // succeeded; the local DB update is best-effort (BUG-020 — the
      // webhook reconciles) so we invalidate unconditionally on Stripe
      // success, mirroring the previous route-level behaviour.
      this.invalidateIfConfigured(userId, orgId, 'change_tier');

      // Return { userId, orgId, subscription } so the route handler can
      // feed invalidateForUser without round-tripping the DB. The
      // subscription reflects the in-memory view prior to the Stripe update
      // — callers that need the post-update DB state should re-fetch.
      return { userId, orgId, subscription: sub };
    } catch (error) {
      this.handleError(error, 'changeTier');
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

      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await this.db
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.CANCELLING,
          cancelReason: reason ?? null,
          churnReason: churnReason ?? null,
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
   *   - DB: `status` flipped to 'active', `updatedAt` bumped.
   *   - Orchestrator hook fires with reason `'subscription_resumed'` —
   *     same reason as the webhook handler so observability groups
   *     webhook-driven + user-initiated resumes under one tag.
   *
   * Revocation CLEAR is owned by the route layer (mirrors reactivate —
   * see `workers/ecom-api/src/routes/subscriptions.ts`).
   *
   * Idempotency: Stripe resume is idempotent on the subscription id (a
   * second call on an already-active sub is a no-op upstream), so an
   * idempotency key is defensive rather than strictly required. We pass
   * one anyway per `packages/subscription/CLAUDE.md`.
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

      await this.stripe.subscriptions.resume(
        sub.stripeSubscriptionId,
        { billing_cycle_anchor: 'unchanged' },
        { idempotencyKey: `resume_${sub.stripeSubscriptionId}` }
      );

      await this.db
        .update(subscriptions)
        .set({
          status: SUBSCRIPTION_STATUS.ACTIVE,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      this.obs.info('Subscription resumed by user', {
        subscriptionId: sub.id,
        organizationId,
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

    const conditions = [eq(subscriptions.organizationId, orgId)];
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
  private buildPayoutConditions(orgId: string, options: PayoutFilterOptions) {
    const { status = 'all', sourceType = 'all', fromDate, toDate } = options;
    const conditions = [eq(payouts.organizationId, orgId)];

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
    } else if (status === 'needs_attention') {
      conditions.push(inArray(payouts.status, ['pending', 'failed']));
    }

    if (sourceType === 'purchase' || sourceType === 'subscription') {
      conditions.push(eq(payouts.sourceType, sourceType));
    }

    conditions.push(...dateWindow(payouts.createdAt, fromDate, toDate));

    return conditions;
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
        .where(
          and(eq(payouts.organizationId, orgId), eq(payouts.status, 'paid'))
        ),
      this.db
        .select({
          sum: sql<number>`COALESCE(SUM(${payouts.amountCents}),0)::int`,
        })
        .from(payouts)
        .where(
          and(eq(payouts.organizationId, orgId), eq(payouts.status, 'pending'))
        ),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(payouts)
        .where(
          and(
            eq(payouts.organizationId, orgId),
            inArray(payouts.status, ['pending', 'failed'])
          )
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
        acc.totalPaidCents += row.amountCents;
        if (row.sourceType === 'purchase') {
          acc.purchasePaidCents += row.amountCents;
        } else if (row.sourceType === 'subscription') {
          acc.subscriptionPaidCents += row.amountCents;
        }
        // Track the `organization_fee` slice separately so the owner
        // card can disclose "of which £X org fee" — keeps the owner's
        // headline comparable to non-owner creator cards.
        if (row.payoutType === 'organization_fee') {
          acc.orgFeePaidCents += row.amountCents;
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

      // Pre-h69cg historical rows have no `transferGroup`. Falling back to
      // the row id keeps the dedup correct (1 row = 1 transaction) rather
      // than collapsing all ungrouped rows into a single bucket.
      const groupKey = row.transferGroup ?? row.payoutId;
      acc._transferGroups.add(groupKey);

      // `needsAttentionCount` dedupes by the SAME key as `transactionCount`
      // — under h69cg's 3-sibling-row model, one failed charge produces 3
      // pending/failed rows that share a transferGroup. Counting per-row
      // would render "1 transaction · 3 needs attention" for one stuck
      // payout, which reads as 3 separate problems.
      //
      // `min_transfer_floor` is excluded: rows below Stripe's minimum
      // transfer threshold are held as pending until aggregate-and-sweep
      // catches up — they're not an exception the operator needs to act
      // on. Multi-creator orgs with small revshares hit this constantly.
      if (
        (row.status === 'pending' || row.status === 'failed') &&
        row.reason !== 'min_transfer_floor'
      ) {
        acc._needsAttentionGroups.add(groupKey);
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
   * Called when a Connect account transitions to chargesEnabled + payoutsEnabled.
   * For each unresolved payout:
   *   - Attempts stripe.transfers.create()
   *   - On success: sets resolvedAt and stripeTransferId
   *   - On failure: logs and continues to the next payout (batch is best-effort)
   *
   * Returns the count of successfully resolved payouts.
   */
  async resolvePendingPayouts(
    orgId: string,
    stripeAccountId: string
  ): Promise<{ resolved: number; failed: number }> {
    let resolved = 0;
    let failed = 0;

    // Query all unresolved payouts for this org that belong to the user
    // whose Connect account just became active.
    const [connectAccount] = await this.db
      .select({ userId: stripeConnectAccounts.userId })
      .from(stripeConnectAccounts)
      .where(
        and(
          eq(stripeConnectAccounts.stripeAccountId, stripeAccountId),
          eq(stripeConnectAccounts.organizationId, orgId)
        )
      )
      .limit(1);

    if (!connectAccount) {
      this.obs.warn('resolvePendingPayouts: Connect account not found', {
        organizationId: orgId,
        stripeAccountId,
      });
      return { resolved: 0, failed: 0 };
    }

    const unresolvedPayouts = await this.db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.userId, connectAccount.userId),
          eq(payouts.organizationId, orgId),
          eq(payouts.status, 'pending')
        )
      );

    if (unresolvedPayouts.length === 0) {
      return { resolved: 0, failed: 0 };
    }

    this.obs.info('Resolving pending payouts', {
      organizationId: orgId,
      stripeAccountId,
      userId: connectAccount.userId,
      count: unresolvedPayouts.length,
    });

    for (const payout of unresolvedPayouts) {
      try {
        // GBP-only enforcement (Codex-yv18n): honour the row's currency but
        // explicitly reject any non-GBP value. Historical rows that somehow
        // lack the column fall back to CURRENCY.GBP (schema default is 'gbp'
        // but defence-in-depth never hurts).
        const payoutCurrency = (payout.currency || CURRENCY.GBP).toLowerCase();
        this.assertGbpOnly(payoutCurrency, {
          pendingPayoutId: payout.id,
          subscriptionId: payout.subscriptionId,
          organizationId: orgId,
        });

        // Codex-m644n: min-transfer floor gate. Walk the per-creator override
        // chain so a low-volume creator with a high floor accumulates further
        // while a high-volume creator clears immediately. Leaves the existing
        // pending row in place (unresolved) so a later resolution attempt picks
        // it up — no new row inserted to avoid duplicating the amount on retry.
        // Codex-5794i: policy follows the row's sourceType (see resolvePayoutFees).
        const payoutFees = await this.resolvePayoutFees(
          orgId,
          payout.sourceType === 'purchase' ? 'one_off' : 'subscription',
          payout.userId ?? undefined
        );
        if (payout.amountCents < payoutFees.minTransferCents) {
          this.obs.info(
            'resolvePendingPayouts: skipping payout below min-transfer floor',
            {
              pendingPayoutId: payout.id,
              userId: payout.userId,
              organizationId: orgId,
              amountCents: payout.amountCents,
              minTransferCents: payoutFees.minTransferCents,
            }
          );
          continue;
        }

        // Codex-dbzkg: when the row was funded by a tracked platform charge
        // (purchase or subscription), pass source_transaction so the retry
        // draws from THAT charge's source-linked balance, not general
        // platform balance. Without it the platform double-pays — the
        // original charge sits source-linked indefinitely and the retry
        // pulls unrelated funds.
        const transfer = await this.stripe.transfers.create(
          {
            amount: payout.amountCents,
            currency: payoutCurrency,
            destination: stripeAccountId,
            ...(payout.stripeChargeId
              ? { source_transaction: payout.stripeChargeId }
              : {}),
            metadata: {
              pending_payout_id: payout.id,
              subscription_id: payout.subscriptionId,
              purchase_id: payout.purchaseId,
              source_type: payout.sourceType,
              type: 'pending_payout_resolution',
            },
          },
          { idempotencyKey: `payout_${payout.id}` }
        );

        await this.db
          .update(payouts)
          .set({
            status: 'paid',
            resolvedAt: new Date(),
            stripeTransferId: transfer.id,
          })
          .where(eq(payouts.id, payout.id));

        resolved++;
      } catch (error) {
        failed++;
        this.obs.error('Failed to resolve pending payout', {
          pendingPayoutId: payout.id,
          subscriptionId: payout.subscriptionId,
          amountCents: payout.amountCents,
          error: (error as Error).message,
        });
        // Continue to next payout — don't fail the whole batch
      }
    }

    this.obs.info('Pending payout resolution complete', {
      organizationId: orgId,
      stripeAccountId,
      resolved,
      failed,
      total: unresolvedPayouts.length,
    });

    return { resolved, failed };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Throw `UnsupportedCurrencyError` unless `currency` is GBP (or absent).
   *
   * Centralises the GBP-only guard shared by `handleInvoicePaymentSucceeded`
   * and `resolvePendingPayouts`. Both downstream paths feed
   * `stripe.transfers.create()` which is hardcoded to `CURRENCY.GBP`; this
   * guard prevents silent currency mismatch. Cross-currency support is a
   * tracked future feature (Codex-yv18n).
   *
   * Passing `null`/`undefined` is treated as "no currency on this Stripe
   * object" and skipped — preserves the prior behaviour of letting Stripe
   * payloads without a `currency` field through (the schema default for
   * payouts is 'gbp', so the row branch normalises before calling).
   */
  private assertGbpOnly(
    currency: string | null | undefined,
    context: Record<string, unknown>
  ): void {
    if (!currency) return;
    const normalised = currency.toLowerCase();
    if (normalised === CURRENCY.GBP) return;
    throw new UnsupportedCurrencyError(normalised, [CURRENCY.GBP], context);
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

  // ─── Tier Price Propagation (Q1.2 — Codex-3xyyb) ───────────────────────────

  /**
   * Propagate a tier's new Stripe Price ID to EVERY active/cancelling
   * subscription currently on that tier. Q1.2 of the subscription audit
   * epic (Codex-kqmvd) closes the gap where Q1.1's sync-back (and the
   * existing Codex-UI `updateTier` flow) updated the tier record but left
   * in-flight subscriptions billing on the superseded Price.
   *
   * Design contract:
   * - Scope: subscriptions with `tierId = tierId` AND status IN
   *   ('active', 'cancelling'). `paused`, `past_due`, `cancelled`,
   *   `incomplete` are deliberately SKIPPED — swapping a Price under a
   *   paused subscription triggers an unwanted reactivation path, and a
   *   cancelled sub has no ongoing billing to reprice. The status list
   *   mirrors the PR #5 filter (`getSubscriptionOrThrow`) minus
   *   `past_due` (past-due subs are awaiting retry; changing their Price
   *   mid-flight creates Stripe edge cases — they'll re-sync on the next
   *   invoice attempt).
   * - For each subscription: retrieve the live Stripe sub to get its
   *   item id, then call `stripe.subscriptions.update` with the new
   *   Price and the caller's proration policy (default
   *   `create_prorations`). Stripe emits `customer.subscription.updated`
   *   which flows through the existing `handleSubscriptionUpdated`
   *   webhook → shared status mapper → our DB `amountCents` update.
   *   We do NOT write the DB directly from this path — one write path
   *   for subscription price changes keeps webhook-reconciliation
   *   semantics intact.
   * - Idempotency: each Stripe call uses a deterministic idempotency key
   *   `tier-price-propagate:${subId}:${newPriceId}`, so retries on
   *   partial batch failure reissue the same mutation safely. If a
   *   subscription already carries the new Price (e.g. prior run
   *   succeeded before the failure point), Stripe treats the replay as
   *   a no-op — the idempotency key protects us without requiring a
   *   pre-check round trip.
   * - Batching: subscriptions are processed in parallel batches of
   *   `batchSize` (default 8) with `interBatchDelayMs` (default 50ms)
   *   between batches to respect Stripe's per-account rate limit (25
   *   req/sec test, 100 req/sec live). A tier with 500 subs completes
   *   in ~2.5s at the default settings — well within a `waitUntil`
   *   fire-and-forget budget.
   * - Per-sub error handling: one failed update MUST NOT abort the
   *   batch. Failures are logged via `this.obs.error` with the offending
   *   subscriptionId + error, and we continue. After all batches, an
   *   aggregate error log fires if `failed > 0`. Callers (webhook
   *   handler, UI-driven tier update) treat this method as
   *   fire-and-forget — they never surface individual failures.
   *
   * Called from:
   * - `TierService.applyStripePriceCreated` (Dashboard sync-back)
   * - `TierService.updateTier` (Codex-UI price change)
   *
   * Both call sites invoke AFTER the DB persist + cache bump succeeds,
   * so a propagation failure does not roll back the tier price change —
   * the canonical Price lives on the tier; this method just fans out
   * the billing effect. An operator can re-run propagation manually by
   * re-adopting the same Price (no-op on the tier, re-runs against
   * current active subs).
   *
   * @param tierId — subscription tier whose price changed
   * @param newStripePriceId — canonical Stripe Price id the tier now points at
   * @param options — see `PropagateTierPriceOptions`
   * @returns `{ total, updated, failed }` counts — informational only;
   *          the webhook path is authoritative for DB state.
   */
  async propagateTierPriceToActiveSubscriptions(
    tierId: string,
    newStripePriceId: string,
    options: PropagateTierPriceOptions = {}
  ): Promise<PropagateTierPriceResult> {
    const prorationBehavior = options.prorationBehavior ?? 'create_prorations';
    const batchSize = Math.max(1, options.batchSize ?? 8);
    const interBatchDelayMs = Math.max(0, options.interBatchDelayMs ?? 50);

    try {
      const conditions = [
        eq(subscriptions.tierId, tierId),
        inArray(subscriptions.status, [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.CANCELLING,
        ]),
      ];
      if (options.organizationId) {
        conditions.push(
          eq(subscriptions.organizationId, options.organizationId)
        );
      }

      // Left-join users + tiers so the per-sub success branch can dispatch
      // the price-change notice email (Codex-7kc83) without a second round
      // trip per subscription. Tiers are LEFT-joined because the tier could
      // be soft-deleted between propagation runs and the archived-tier
      // semantic lets reads still resolve (see subscription CLAUDE.md).
      // Users LEFT-join preserves the propagation path even when a user
      // somehow has no email (shouldn't happen — email is the BetterAuth
      // primary key material — but we skip the email not the Stripe swap).
      const rows = await this.db
        .select({
          id: subscriptions.id,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          organizationId: subscriptions.organizationId,
          userId: subscriptions.userId,
          billingInterval: subscriptions.billingInterval,
          amountCents: subscriptions.amountCents,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          userEmail: users.email,
          userName: users.name,
          tierName: subscriptionTiers.name,
          tierPriceMonthly: subscriptionTiers.priceMonthly,
          tierPriceAnnual: subscriptionTiers.priceAnnual,
        })
        .from(subscriptions)
        .leftJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(
          subscriptionTiers,
          eq(subscriptionTiers.id, subscriptions.tierId)
        )
        .where(and(...conditions));

      if (rows.length === 0) {
        this.obs.info('Tier price propagation: no active subscriptions', {
          tierId,
          newStripePriceId,
        });
        return { total: 0, updated: 0, failed: 0 };
      }

      let updated = 0;
      let failed = 0;
      const errors: Array<{
        subscriptionId: string;
        stripeSubscriptionId: string;
        error: string;
      }> = [];

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (row) => {
            const stripeSub = await this.stripe.subscriptions.retrieve(
              row.stripeSubscriptionId
            );
            const itemId = stripeSub.items.data[0]?.id;
            if (!itemId) {
              throw new InternalServiceError(
                'Stripe subscription has no items to update'
              );
            }

            await this.stripe.subscriptions.update(
              row.stripeSubscriptionId,
              {
                items: [{ id: itemId, price: newStripePriceId }],
                proration_behavior: prorationBehavior,
              },
              {
                idempotencyKey: `tier-price-propagate:${row.id}:${newStripePriceId}`,
              }
            );
          })
        );

        for (const [idx, result] of results.entries()) {
          const row = batch[idx];
          // `batch[idx]` is always defined inside a `results.entries()`
          // loop — `Promise.allSettled` returns an array of the same
          // length as the input. The guard is strictly to satisfy
          // `noUncheckedIndexedAccess`; in practice it cannot fire.
          if (!row) continue;
          if (result.status === 'fulfilled') {
            updated++;
            // Q1.3 (Codex-7kc83): notify the subscriber that their
            // Stripe Price is changing. Fire-and-forget — mailer is
            // already inside the background `waitUntil` tail that
            // wraps the propagator, so we don't add our own. A failed
            // email MUST NOT fail the propagation; the mailer handles
            // its own error suppression (see `sendEmailToWorker`).
            this.dispatchTierPriceChangeEmail(row, newStripePriceId, {
              tierId,
              prorationBehavior,
            });
          } else {
            failed++;
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            errors.push({
              subscriptionId: row.id,
              stripeSubscriptionId: row.stripeSubscriptionId,
              error: message,
            });
            this.obs.error(
              'Tier price propagation: subscription update failed',
              {
                tierId,
                newStripePriceId,
                subscriptionId: row.id,
                stripeSubscriptionId: row.stripeSubscriptionId,
                organizationId: row.organizationId,
                error: message,
              }
            );
          }
        }

        // Inter-batch delay to stay under Stripe's per-account rate
        // limit. Only sleep when another batch follows — avoids a
        // trailing delay after the last batch.
        if (i + batchSize < rows.length && interBatchDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, interBatchDelayMs)
          );
        }
      }

      if (failed > 0) {
        this.obs.error(
          'Tier price propagation completed with failures (operator review required)',
          {
            tierId,
            newStripePriceId,
            total: rows.length,
            updated,
            failed,
            sampleErrors: errors.slice(0, 5),
          }
        );
      } else {
        this.obs.info('Tier price propagation complete', {
          tierId,
          newStripePriceId,
          total: rows.length,
          updated,
          prorationBehavior,
        });
      }

      return { total: rows.length, updated, failed };
    } catch (error) {
      this.handleError(error, 'propagateTierPriceToActiveSubscriptions');
    }
  }

  /**
   * Dispatch the `subscription-tier-price-change` email for a single
   * subscription that was just successfully swapped by
   * `propagateTierPriceToActiveSubscriptions` (Q1.3 — Codex-7kc83).
   *
   * Design contract:
   * - Called ONLY in the per-sub fulfilled branch — a failed Stripe
   *   update does not trigger an email (the subscription is still on
   *   the old Price; nothing to notify). A failed email MUST NOT fail
   *   the propagation loop.
   * - Copy is neutral regarding direction: reads correctly whether the
   *   new price is higher, lower, or equal to the old price. The
   *   template surfaces both values plus the effective date + a
   *   manage-subscription URL for cancellation before the change
   *   takes effect.
   * - Amounts are GBP pence; we format using the same `£X.XX` helper
   *   the other subscription lifecycle emails use (see
   *   `buildSubscriptionCreatedEmail`).
   * - Effective date = the next billing cycle. Stripe's
   *   `create_prorations` invoices the delta on the NEXT invoice — so
   *   "effective from the next billing cycle" is the correct framing
   *   regardless of proration override. We use the subscription's
   *   `currentPeriodEnd` as the effective date; that's the boundary
   *   between the old-price period and the new-price period.
   * - Category is `transactional` — billing lifecycle emails are
   *   legally required in many jurisdictions (UK/EU typically 30 days
   *   notice for increases) and bypass the notification-preferences
   *   opt-out per `NotificationsService.sendEmail`.
   *
   * Missing email / missing tier (defensive — BetterAuth enforces
   * email on users and propagation already filtered by active status
   * scoped to the tier) is logged at warn level and skipped without
   * affecting the propagation result counts.
   */
  private dispatchTierPriceChangeEmail(
    row: {
      id: string;
      stripeSubscriptionId: string;
      organizationId: string;
      userId: string;
      billingInterval: string;
      amountCents: number;
      currentPeriodEnd: Date;
      userEmail: string | null;
      userName: string | null;
      tierName: string | null;
      tierPriceMonthly: number | null;
      tierPriceAnnual: number | null;
    },
    newStripePriceId: string,
    context: { tierId: string; prorationBehavior: string }
  ): void {
    if (!this.mailer) {
      // No mailer wired (unit test harness). Propagation succeeds
      // without side-effect — silent no-op to match the `cache` /
      // `waitUntil` graceful-degrade semantics elsewhere on the
      // service.
      return;
    }

    if (!row.userEmail) {
      this.obs.warn(
        'Tier price propagation: subscriber has no email; skipping notice',
        {
          tierId: context.tierId,
          newStripePriceId,
          subscriptionId: row.id,
          userId: row.userId,
          organizationId: row.organizationId,
        }
      );
      return;
    }

    // Old price = the subscription's current `amountCents` snapshot
    // (this is the amount that was billing immediately before the
    // swap). New price = the tier's now-authoritative pence amount
    // for the subscription's billing interval. Annual subscribers
    // see the annual column; monthly subscribers see the monthly
    // column.
    const newPriceCents =
      row.billingInterval === 'year'
        ? row.tierPriceAnnual
        : row.tierPriceMonthly;

    if (newPriceCents === null || newPriceCents === undefined) {
      this.obs.warn(
        'Tier price propagation: could not resolve new price amount; skipping notice',
        {
          tierId: context.tierId,
          newStripePriceId,
          subscriptionId: row.id,
          billingInterval: row.billingInterval,
        }
      );
      return;
    }

    const oldPriceFormatted = `£${(row.amountCents / 100).toFixed(2)}`;
    const newPriceFormatted = `£${(newPriceCents / 100).toFixed(2)}`;

    // Effective date = the end of the CURRENT billing period
    // (== start of the first period that bills at the new price).
    // Matches "effective from the next billing cycle" regardless of
    // the caller's proration override: Stripe always respects period
    // boundaries for the actual Price swap, `create_prorations` only
    // governs whether the mid-cycle delta is invoiced now or rolled
    // into the next invoice.
    const effectiveDate = row.currentPeriodEnd
      ? row.currentPeriodEnd.toLocaleDateString('en-GB')
      : 'your next billing cycle';

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
          planName: row.tierName || 'your subscription',
          oldPriceFormatted,
          newPriceFormatted,
          billingInterval: row.billingInterval,
          effectiveDate,
          manageUrl: `${this.webAppUrl ?? ''}/account/subscriptions`,
        },
      });
    } catch (error) {
      // The mailer itself is expected to be fire-and-forget and not
      // throw — but catch synchronously anyway so a mis-wired
      // implementation can never take down the propagation loop.
      this.obs.warn(
        'Tier price propagation: mailer threw synchronously; notice skipped',
        {
          tierId: context.tierId,
          newStripePriceId,
          subscriptionId: row.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Resolve the org owner's userId from organization_memberships.
   * Returns null if no owner membership is found.
   */
  private async resolveOrgOwnerId(orgId: string): Promise<string | null> {
    const [owner] = await this.db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.role, 'owner')
        )
      )
      .limit(1);

    return owner?.userId ?? null;
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
    creatorPayoutCents: number
  ): Promise<void> {
    const transferGroup = `sub_${subscriptionId}`;

    // Platform fee — retained in the platform Stripe balance at charge time;
    // no transfer call needed. Tri-party ledger parity (Codex-h69cg): one
    // platform_fee row per invoice so /studio/payouts can attribute platform
    // revenue alongside org_fee + creator_payout. status='paid' is satisfied
    // by stripeChargeId per the OR-allow paid invariant.
    //
    // Webhook-replay safe: platform_fee rows have a null stripeTransferId so
    // the `uq_payouts_stripe_transfer_id` partial unique index does NOT catch
    // a duplicate insert on the second webhook fire. Pre-check via SELECT for
    // an existing row keyed on (subscriptionId, stripeChargeId, 'platform_fee')
    // — exactly one such row should exist per invoice charge.
    if (platformFeeCents > 0) {
      try {
        const existingPlatformRow = await this.db
          .select({ id: payouts.id })
          .from(payouts)
          .where(
            and(
              eq(payouts.subscriptionId, subscriptionId),
              eq(payouts.stripeChargeId, chargeId),
              eq(payouts.payoutType, 'platform_fee')
            )
          )
          .limit(1);

        if (existingPlatformRow.length === 0) {
          await this.db.insert(payouts).values({
            userId: null,
            organizationId: orgId,
            subscriptionId,
            amountCents: platformFeeCents,
            payoutType: 'platform_fee',
            status: 'paid',
            sourceType: 'subscription',
            stripeChargeId: chargeId,
            transferGroup,
            resolvedAt: new Date(),
          });
        }
      } catch (insertError) {
        if (!isUniqueViolation(insertError)) {
          this.obs.error('Failed to insert platform_fee payout row', {
            subscriptionId,
            organizationId: orgId,
            chargeId,
            amountCents: platformFeeCents,
            error: (insertError as Error).message,
          });
        }
      }
    }

    // Get org's Connect account via the canonical primary user FK so
    // transfers route to the same account checkout validated against.
    const orgConnect = await resolvePrimaryConnect(this.db, orgId);

    // Transfer org fee
    if (orgConnect?.chargesEnabled && orgFeeCents > 0) {
      try {
        const transfer = await this.stripe.transfers.create(
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
        // Record success in the ledger. The unique partial index on
        // stripe_transfer_id collapses webhook double-fires to a single row;
        // any other DB error gets logged loud — money moved but the ledger
        // missed the entry, which is a data-integrity event worth paging on.
        try {
          await this.db.insert(payouts).values({
            userId: orgConnect.userId,
            organizationId: orgId,
            subscriptionId,
            amountCents: orgFeeCents,
            payoutType: 'organization_fee',
            status: 'paid',
            stripeTransferId: transfer.id,
            stripeChargeId: chargeId,
            transferGroup,
            resolvedAt: new Date(),
          });
        } catch (insertError) {
          if (!isUniqueViolation(insertError)) {
            this.obs.error(
              'Org transfer succeeded but payouts ledger insert failed',
              {
                subscriptionId,
                organizationId: orgId,
                stripeTransferId: transfer.id,
                amountCents: orgFeeCents,
                error: (insertError as Error).message,
              }
            );
          }
        }
      } catch (transferError) {
        this.obs.error('Org transfer failed, accumulating as pending payout', {
          subscriptionId,
          organizationId: orgId,
          amountCents: orgFeeCents,
          error: (transferError as Error).message,
        });
        try {
          await this.db.insert(payouts).values({
            userId: orgConnect.userId,
            organizationId: orgId,
            subscriptionId,
            amountCents: orgFeeCents,
            payoutType: 'organization_fee',
            status: 'failed',
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
      // Accumulate if Connect not ready — resolve the org owner's userId
      const ownerId =
        orgConnect?.userId ?? (await this.resolveOrgOwnerId(orgId));
      if (!ownerId) {
        this.obs.error(
          'Cannot record pending payout: no Connect account and no org owner found',
          { subscriptionId, organizationId: orgId, amountCents: orgFeeCents }
        );
      } else {
        try {
          await this.db.insert(payouts).values({
            userId: ownerId,
            organizationId: orgId,
            subscriptionId,
            amountCents: orgFeeCents,
            payoutType: 'organization_fee',
            status: 'pending',
            reason: 'connect_not_ready',
          });
        } catch (insertError) {
          this.obs.error(
            'Failed to record pending payout (Connect not ready)',
            {
              subscriptionId,
              organizationId: orgId,
              amountCents: orgFeeCents,
              error: (insertError as Error).message,
            }
          );
        }
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
          const transfer = await this.stripe.transfers.create(
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
          try {
            await this.db.insert(payouts).values({
              userId: orgConnect.userId,
              organizationId: orgId,
              subscriptionId,
              amountCents: creatorPayoutCents,
              payoutType: 'creator_payout_to_owner',
              status: 'paid',
              stripeTransferId: transfer.id,
              stripeChargeId: chargeId,
              transferGroup,
              resolvedAt: new Date(),
            });
          } catch (insertError) {
            if (!isUniqueViolation(insertError)) {
              this.obs.error(
                'Creator-pool transfer to owner succeeded but payouts ledger insert failed',
                {
                  subscriptionId,
                  organizationId: orgId,
                  stripeTransferId: transfer.id,
                  amountCents: creatorPayoutCents,
                  error: (insertError as Error).message,
                }
              );
            }
          }
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
          // BUG-036: Wrap pending payout insert in try/catch so a DB failure
          // doesn't crash the entire transfer flow.
          try {
            await this.db.insert(payouts).values({
              userId: orgConnect.userId,
              organizationId: orgId,
              subscriptionId,
              amountCents: creatorPayoutCents,
              payoutType: 'creator_payout_to_owner',
              status: 'failed',
              reason: 'transfer_failed',
            });
          } catch (insertError) {
            this.obs.error(
              'Failed to record pending payout for creator pool to owner',
              {
                subscriptionId,
                organizationId: orgId,
                amountCents: creatorPayoutCents,
                error: (insertError as Error).message,
              }
            );
          }
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

      // Codex-m644n: per-creator min-transfer floor. Walk the override chain
      // for this specific (org, creator) pair — Creator A and Creator B can
      // carry different `minTransferCents` thresholds even in the same invoice.
      // When the calculated amount falls below this creator's floor, accumulate
      // as pending with reason='min_transfer_floor' instead of firing a Stripe
      // transfer. The next invoice payment will re-roll the floor evaluation.
      const creatorFees = await this.resolvePayoutFees(
        orgId,
        'subscription',
        agreement.creatorId
      );
      if (creatorAmount < creatorFees.minTransferCents) {
        this.obs.info('Creator payout below min-transfer floor, accumulating', {
          subscriptionId,
          creatorId: agreement.creatorId,
          amountCents: creatorAmount,
          minTransferCents: creatorFees.minTransferCents,
        });
        try {
          await this.db.insert(payouts).values({
            userId: agreement.creatorId,
            organizationId: orgId,
            subscriptionId,
            amountCents: creatorAmount,
            payoutType: 'creator_payout',
            status: 'pending',
            reason: 'min_transfer_floor',
          });
        } catch (insertError) {
          this.obs.error(
            'Failed to record pending payout (min_transfer_floor)',
            {
              subscriptionId,
              creatorId: agreement.creatorId,
              amountCents: creatorAmount,
              error: (insertError as Error).message,
            }
          );
        }
        continue;
      }

      const creatorConnect = connectByCreator.get(agreement.creatorId);

      if (creatorConnect?.chargesEnabled) {
        try {
          const transfer = await this.stripe.transfers.create(
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
          try {
            await this.db.insert(payouts).values({
              userId: agreement.creatorId,
              organizationId: orgId,
              subscriptionId,
              amountCents: creatorAmount,
              payoutType: 'creator_payout',
              status: 'paid',
              stripeTransferId: transfer.id,
              stripeChargeId: chargeId,
              transferGroup,
              resolvedAt: new Date(),
            });
          } catch (insertError) {
            if (!isUniqueViolation(insertError)) {
              this.obs.error(
                'Creator transfer succeeded but payouts ledger insert failed',
                {
                  subscriptionId,
                  creatorId: agreement.creatorId,
                  stripeTransferId: transfer.id,
                  amountCents: creatorAmount,
                  error: (insertError as Error).message,
                }
              );
            }
          }
        } catch (transferError) {
          this.obs.error('Creator transfer failed, accumulating as pending', {
            subscriptionId,
            creatorId: agreement.creatorId,
            amountCents: creatorAmount,
            error: (transferError as Error).message,
          });
          // BUG-036: Wrap pending payout insert in try/catch so a DB failure
          // doesn't crash the entire transfer flow.
          try {
            await this.db.insert(payouts).values({
              userId: agreement.creatorId,
              organizationId: orgId,
              subscriptionId,
              amountCents: creatorAmount,
              payoutType: 'creator_payout',
              status: 'failed',
              reason: 'transfer_failed',
            });
          } catch (insertError) {
            this.obs.error(
              'Failed to record pending payout for creator transfer failure',
              {
                subscriptionId,
                creatorId: agreement.creatorId,
                amountCents: creatorAmount,
                error: (insertError as Error).message,
              }
            );
          }
        }
      } else {
        // Accumulate pending payout
        // BUG-036: Wrap pending payout insert in try/catch so a DB failure
        // doesn't crash the entire transfer flow.
        try {
          await this.db.insert(payouts).values({
            userId: agreement.creatorId,
            organizationId: orgId,
            subscriptionId,
            amountCents: creatorAmount,
            payoutType: 'creator_payout',
            status: 'pending',
            reason: creatorConnect ? 'connect_restricted' : 'connect_not_ready',
          });
        } catch (insertError) {
          this.obs.error(
            'Failed to record pending payout (Connect not ready)',
            {
              subscriptionId,
              creatorId: agreement.creatorId,
              amountCents: creatorAmount,
              error: (insertError as Error).message,
            }
          );
        }

        this.obs.warn('Creator payout accumulated (Connect not ready)', {
          creatorId: agreement.creatorId,
          amountCents: creatorAmount,
          subscriptionId,
        });
      }
    }
  }

  // ─── Pending Payout Sweep (Codex-vv77x) ─────────────────────────────────
  //
  // Hybrid event+sweep resolution pattern per Stripe docs:
  //   1. account.updated webhook is the primary trigger (connect-webhook.ts:73)
  //   2. Webhooks retry for 3 days then drop — this sweep is the safety net
  //   3. Periodic sweep groups payouts by (orgId, userId) — each unique
  //      pair maps to one Connect account — and asks Stripe for current state
  //   4. If the Connect account is now charges_enabled && payouts_enabled,
  //      delegate to resolvePendingPayouts(orgId, stripeAccountId) which owns
  //      the actual transfer loop.
  //   5. olderThanMinutes guards against racing the webhook on freshly inserted
  //      rows — only sweep rows old enough that the webhook would already have
  //      fired by now if it was going to.

  /**
   * Sweep pending payouts rows older than `olderThanMinutes`,
   * group by (organizationId, userId), and attempt resolution for each
   * group whose Connect account now reports charges_enabled && payouts_enabled.
   *
   * Returns aggregate counters for observability; never throws on a
   * per-group failure — failures are isolated and counted.
   */
  async sweepUnresolvedPayouts(olderThanMinutes = 15): Promise<{
    groupsScanned: number;
    groupsResolved: number;
    groupsSkipped: number;
    errors: number;
  }> {
    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    // Distinct (orgId, userId) pairs with at least one unresolved row older
    // than the threshold. We deliberately do NOT join to stripeConnectAccounts
    // here — we want the sweep to surface orphan pending rows whose Connect
    // account row may have been re-keyed, and the per-group lookup below
    // handles the missing-account case (logs warn + returns 0).
    const groups = await this.db
      .selectDistinct({
        organizationId: payouts.organizationId,
        userId: payouts.userId,
      })
      .from(payouts)
      .where(
        and(eq(payouts.status, 'pending'), lt(payouts.attemptedAt, threshold))
      );

    const groupsScanned = groups.length;
    let groupsResolved = 0;
    let groupsSkipped = 0;
    let errors = 0;

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
      // Codex-h69cg: payouts.userId and .organizationId are nullable to admit
      // platform_fee rows. Those are always status='paid' so they would never
      // appear in this sweep, but defence-in-depth: skip any group missing
      // either field — it can't be routed to a Connect account anyway.
      if (!group.organizationId || !group.userId) {
        groupsSkipped++;
        continue;
      }
      try {
        // Find the Connect account row for this (orgId, userId) so we can
        // look up the stripeAccountId. If the row is missing (rare — a
        // Connect account was deleted but its payouts survived
        // because of ON DELETE behaviour) skip this group; it will be
        // re-attempted on the next sweep window.
        const [connect] = await this.db
          .select({ stripeAccountId: stripeConnectAccounts.stripeAccountId })
          .from(stripeConnectAccounts)
          .where(
            and(
              eq(stripeConnectAccounts.organizationId, group.organizationId),
              eq(stripeConnectAccounts.userId, group.userId)
            )
          )
          .limit(1);

        if (!connect) {
          this.obs.warn(
            'sweepUnresolvedPayouts: connect row missing for pending group',
            {
              organizationId: group.organizationId,
              userId: group.userId,
            }
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

        await this.resolvePendingPayouts(
          group.organizationId,
          connect.stripeAccountId
        );
        groupsResolved++;
      } catch (error) {
        errors++;
        this.obs.error('sweepUnresolvedPayouts: per-group failure', {
          organizationId: group.organizationId,
          userId: group.userId,
          error: (error as Error).message,
        });
        // Continue to next group — don't fail the whole sweep
      }
    }

    this.obs.info('sweepUnresolvedPayouts: complete', {
      olderThanMinutes,
      groupsScanned,
      groupsResolved,
      groupsSkipped,
      errors,
    });

    return { groupsScanned, groupsResolved, groupsSkipped, errors };
  }
}
