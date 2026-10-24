/**
 * Purchase Service
 *
 * Manages purchase lifecycle and Stripe Checkout integration.
 *
 * Key Responsibilities:
 * - Create Stripe Checkout sessions for content purchases
 * - Complete purchases after Stripe payment confirmation (webhook)
 * - Verify purchase status for access control
 * - Query purchase history with filters
 * - Calculate and store immutable revenue splits
 *
 * Transaction Safety:
 * - completePurchase() uses transaction for atomic purchase + access grant
 * - Idempotent by stripePaymentIntentId (prevents duplicate purchases)
 *
 * Organization Scoping:
 * - All queries scoped to customerId
 * - Purchase records immutable after creation
 *
 * @module purchase-service
 */

import {
  ACCESS_TYPES,
  CHECKOUT_SESSION_KIND,
  CONTENT_STATUS,
  CURRENCY,
  canBeSold,
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  FEES,
  PRICE_LIMITS,
  PURCHASE_STATUS,
  stripeEnvMetadata,
} from '@codex/constants';
import {
  type DatabaseClient,
  isUniqueViolation,
  toIso,
  withPagination,
} from '@codex/database';
import {
  content,
  contentAccess,
  courses,
  type Dispute,
  disputes,
  entitlements,
  payoutReversals,
  purchases,
  type RefundStatus,
  refunds,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  assertGbpOnly,
  type ClawbackCharge,
  issueRefund,
  type LedgerDeps,
  listChargeRefunds,
  listClawableRefunds,
  recordPlatformFee,
  recordSlice,
  repayDispute,
  resolveOrganisationPayee,
  reverseCharge,
  reverseEarlierRefunds,
} from '@codex/payments';
import {
  AfterCommitError,
  BaseService,
  type ServiceConfig,
  ServiceUnavailableError,
  StripeNotConfiguredError,
} from '@codex/service-errors';
import type {
  CreateCheckoutInput,
  CreateCourseCheckoutInput,
  PurchaseQueryInput,
  SalesQueryInput,
  SalesStatsQueryInput,
} from '@codex/validation';
import {
  checkoutSessionMetadataSchema,
  courseCheckoutSessionMetadataSchema,
  createCheckoutSchema,
  createCourseCheckoutSchema,
  createPortalSessionSchema,
  extractPlainText,
  getPurchaseSchema,
  purchaseQuerySchema,
  salesQuerySchema,
  salesStatsQuerySchema,
} from '@codex/validation';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  CourseAlreadyOwnedError,
  CourseNotPurchasableError,
  ForbiddenError,
  NotFoundError,
  PaymentProcessingError,
  PurchaseNotFoundError,
} from '../errors';
import {
  type CreatorAgreementShare,
  findActiveCreatorAgreementShare,
} from './agreement-share';
import {
  CheckoutReservations,
  checkoutIdempotencyKey,
  stripeErrorCode,
  toStripeTime,
} from './checkout-reservations';
import {
  writeContentPurchaseEntitlement,
  writeCoursePurchaseEntitlement,
} from './entitlement-writer';
import { withStaleCustomerRecovery } from './resolve-customer';

/**
 * Type guard for Stripe errors
 * Stripe errors have a 'type' property that starts with 'Stripe'
 */
function isStripeError(error: unknown): error is Error & { type: string } {
  return (
    error instanceof Error &&
    'type' in error &&
    typeof error.type === 'string' &&
    error.type.startsWith('Stripe')
  );
}

const REFUND_STATUSES: ReadonlySet<string> = new Set<RefundStatus>([
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
]);

/** A status the `refunds` table admits (its CHECK). */
function isRefundStatus(status: string | null): status is RefundStatus {
  return status !== null && REFUND_STATUSES.has(status);
}

/**
 * How far along a dispute is: an inquiry, then a chargeback, then final. A
 * dispute's row only moves to a higher rank (`recordDispute`).
 */
const DISPUTE_STATUS_RANK: ReadonlyMap<string, number> = new Map([
  ['warning_needs_response', 0],
  ['warning_under_review', 1],
  ['needs_response', 2],
  ['under_review', 3],
  ['won', 4],
  ['lost', 4],
  ['warning_closed', 4],
  ['prevented', 4],
]);
const FINAL_DISPUTE_RANK = 4;

/** A chargeback that took the money and was not won: open, or lost. */
const HOLDING_DISPUTE_STATUSES: readonly string[] = [
  ...DISPUTE_CHARGEBACK_OPEN_STATUSES,
  'lost',
];

/**
 * Whether the dispute still holds its sale, read under a share lock on its
 * row (a win's record then waits for the caller's commit). A dispute with no
 * row holds: nothing has closed it.
 */
async function disputeStillHolds(
  tx: Tx,
  stripeDisputeId: string
): Promise<boolean> {
  const [dispute] = await tx
    .select({ status: disputes.status })
    .from(disputes)
    .where(eq(disputes.stripeDisputeId, stripeDisputeId))
    .limit(1)
    .for('share');
  return !dispute || HOLDING_DISPUTE_STATUSES.includes(dispute.status);
}

/** `DISPUTE_STATUS_RANK` in SQL, for the upsert's guard. */
function disputeRank(status: SQL): SQL {
  // The ranks are literals: a bound THEN parameter would be typed text.
  const cases = [...DISPUTE_STATUS_RANK].map(
    ([name, rank]) => sql`WHEN ${name} THEN ${sql.raw(String(rank))}`
  );
  return sql`(CASE ${status} ${sql.join(cases, sql` `)} END)`;
}

import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CheckoutSessionResult,
  CheckoutSessionVerifyResult,
  CompleteCoursePurchaseMetadata,
  CompletePurchaseMetadata,
  Purchase,
  PurchaseListItem,
  PurchaseWithItem,
  SaleListItem,
  SalesStats,
} from '../types';
import type { FeeConfigService } from './fee-config-service';
import {
  applyMinPlatformFeeFloor,
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  type RevenueSplit,
} from './revenue-calculator';

/**
 * Fire-and-forget email dispatch used by the purchase payout path.
 *
 * Matches the shape of `SendEmailToWorkerParams` from `@codex/worker-utils`
 * so the registry can wire `sendEmailToWorker(env, ctx, params)` directly.
 * Returns `void` — failures are the mailer's concern. The purchase money
 * path MUST NOT block or throw on notification failure.
 */
export type PurchaseMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'creator-connect-needed';
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

/**
 * Configuration for `PurchaseService`.
 *
 * Adds optional `feeConfig` (Codex-m644n) so the one-off purchase flow can
 * resolve DB-configurable fees via the 3-tier fallback chain. When absent,
 * the service uses the `DEFAULT_*` constants — bit-for-bit pre-Codex-m644n
 * behaviour (covered by existing tests).
 *
 * Adds optional `mailer` (WP-10 — Codex-69t7c.10): when wired, fires a
 * `creator-connect-needed` notification fire-and-forget after a pending
 * `creator_payout` row is parked. Notification failure MUST NOT block or
 * roll back the payout ledger write.
 *
 * Adds optional `webAppUrl` to build the dashboard deep-link embedded in
 * payout notifications. When absent the URL is omitted gracefully.
 */
interface PurchaseServiceConfig extends ServiceConfig {
  feeConfig?: FeeConfigService;
  mailer?: PurchaseMailer;
  webAppUrl?: string;
  /**
   * The locked Billing Portal configuration (`bpc_...`, from
   * `STRIPE_PORTAL_CONFIGURATION_ID`): payment methods and invoices only, with
   * cancelling, plan switching and pausing off. Optional so a worker that never
   * opens a portal still boots; `createPortalSession` refuses without it rather
   * than fall back to the account default, which allows cancelling
   * (Codex-2hxff.4).
   */
  portalConfigurationId?: string;
}

/**
 * Build SQL conditions for the studio Sales date window. The window applies
 * to `purchases.purchasedAt` for completed rows AND `purchases.createdAt` for
 * pending/failed rows (which never set `purchasedAt`) — so a support operator
 * looking for a row by the attempted-payment date still finds it.
 *
 * Returns 0, 1, or 2 SQL clauses based on which bounds are provided. The
 * caller pushes the result into its conditions array via spread.
 */
function purchaseDateWindow(fromDate?: string, toDate?: string): SQL[] {
  const conditions: SQL[] = [];
  if (fromDate) {
    const from = new Date(fromDate);
    const cond = or(
      gte(purchases.purchasedAt, from),
      and(isNull(purchases.purchasedAt), gte(purchases.createdAt, from))
    );
    if (cond) conditions.push(cond);
  }
  if (toDate) {
    const to = new Date(toDate);
    const cond = or(
      lte(purchases.purchasedAt, to),
      and(isNull(purchases.purchasedAt), lte(purchases.createdAt, to))
    );
    if (cond) conditions.push(cond);
  }
  return conditions;
}

/**
 * Status values valid for the studio Sales ledger / customer purchase
 * history list. The DB CHECK constraint on `purchases.status` enforces
 * the same enum, so the fallback to PENDING in coercePurchaseStatus is
 * defensive — it would only fire on schema drift that bypassed the
 * constraint (e.g. raw SQL migration).
 */
const PURCHASE_LIST_STATUSES = [
  PURCHASE_STATUS.COMPLETED,
  PURCHASE_STATUS.PENDING,
  PURCHASE_STATUS.FAILED,
  PURCHASE_STATUS.REFUNDED,
] as const;

type PurchaseListStatus = (typeof PURCHASE_LIST_STATUSES)[number];

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * A new purchase row's outcome: completed, or, for a second payment for an
 * item the buyer owns, a duplicate of that purchase (Codex-2hxff.14). A
 * duplicate stays `pending` until Stripe has refunded it, so no reader counts
 * money as returned that is not. Its split columns keep what the sale would
 * have paid; no slice is ever recorded for it.
 */
function purchaseOutcomeFields(duplicateOfPurchaseId: string | undefined) {
  return duplicateOfPurchaseId
    ? { status: PURCHASE_STATUS.PENDING, duplicateOfPurchaseId }
    : { status: PURCHASE_STATUS.COMPLETED };
}

/**
 * A second payment for an item the buyer already owned (Codex-2hxff.14):
 * `pending` while its refund is owed, `refunded` once Stripe has made it.
 */
export function isDuplicatePayment(
  purchase: Pick<Purchase, 'duplicateOfPurchaseId'>
): boolean {
  return purchase.duplicateOfPurchaseId != null;
}

function coercePurchaseStatus(s: string): PurchaseListStatus {
  return (PURCHASE_LIST_STATUSES as readonly string[]).includes(s)
    ? (s as PurchaseListStatus)
    : PURCHASE_STATUS.PENDING;
}

/**
 * What a checkout session sold, read from its metadata with the booking
 * webhook's own schemas: a course session (`kind: 'course'`; PAY-11) or a
 * content one. Null when it parses as neither.
 */
function selfHealedSale(metadata: Stripe.Metadata): {
  customerId: string;
  target:
    | { contentId: string; organizationId: string | null }
    | { courseId: string };
} | null {
  if (metadata.kind === 'course') {
    const course = courseCheckoutSessionMetadataSchema.safeParse(metadata);
    return course.success
      ? {
          customerId: course.data.customerId,
          target: { courseId: course.data.courseId },
        }
      : null;
  }
  const item = checkoutSessionMetadataSchema.safeParse(metadata);
  return item.success
    ? {
        customerId: item.data.customerId,
        target: {
          contentId: item.data.contentId,
          organizationId: item.data.organizationId,
        },
      }
    : null;
}

/**
 * Purchase Service Class
 *
 * Handles purchase operations with Stripe integration.
 */
export class PurchaseService extends BaseService {
  private readonly stripe: Stripe;
  private readonly feeConfig: FeeConfigService | undefined;
  private readonly mailer: PurchaseMailer | undefined;
  private readonly webAppUrl: string | undefined;
  private readonly portalConfigurationId: string | undefined;
  private readonly checkoutReservations: CheckoutReservations;

  /**
   * Initialize purchase service
   *
   * @param config - Service configuration (db, environment, optional feeConfig, optional mailer)
   * @param stripe - Stripe client instance
   */
  constructor(config: PurchaseServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.feeConfig = config.feeConfig;
    this.mailer = config.mailer;
    this.webAppUrl = config.webAppUrl;
    this.portalConfigurationId = config.portalConfigurationId;
    this.checkoutReservations = new CheckoutReservations(
      this.db,
      stripe,
      this.obs
    );
  }

  /**
   * Create Stripe Checkout session for content purchase
   *
   * Business Logic:
   * - Verifies content exists, is published, and has price > 0
   * - Checks for existing completed purchase (throws AlreadyPurchasedError)
   * - Creates Stripe Checkout session with metadata
   * - Returns session URL for redirect
   *
   * Security:
   * - Validates content is purchasable
   * - Prevents duplicate purchases
   * - Metadata includes contentId and customerId for webhook processing
   *
   * @param input - Checkout creation data
   * @param customerId - ID of the customer making purchase
   * @returns Checkout session URL and session ID
   * @throws {ContentNotPurchasableError} If content is free, not published, or deleted
   * @throws {AlreadyPurchasedError} If customer already purchased content
   * @throws {PaymentProcessingError} If Stripe session creation fails
   *
   * @example
   * const result = await purchaseService.createCheckoutSession({
   *   contentId: 'content-123',
   *   successUrl: 'https://example.com/success',
   *   cancelUrl: 'https://example.com/cancel',
   * }, 'customer-456');
   * // Returns: { sessionUrl: 'https://checkout.stripe.com/...', sessionId: 'cs_...' }
   */
  async createCheckoutSession(
    input: CreateCheckoutInput,
    customerId: string
  ): Promise<CheckoutSessionResult> {
    // Validate input
    const validated = createCheckoutSchema.parse(input);

    try {
      // Step 1: Get content and validate it's purchasable
      const contentRecord = await this.db.query.content.findFirst({
        where: and(
          eq(content.id, validated.contentId),
          isNull(content.deletedAt)
        ),
      });

      if (!contentRecord) {
        throw new ContentNotPurchasableError(validated.contentId, 'deleted', {
          reason: 'Content not found or deleted',
        });
      }

      // Codex-69t7c WP5: the Phase-1 "must belong to an organization" gate is
      // removed. Orgless creator-direct (bi-party) content is purchasable —
      // `content.organizationId IS NULL` is a valid, supported state. The
      // creator slice routes to the creator's single Connect account (by
      // userId) and NO organization_fee leg is written. Everything downstream
      // (purchases.organizationId, payouts.organizationId, the webhook
      // checkoutSessionMetadataSchema) is already nullable.

      // Check content is published
      if (contentRecord.status !== CONTENT_STATUS.PUBLISHED) {
        throw new ContentNotPurchasableError(
          validated.contentId,
          'not_published',
          {
            reason: 'Content must be published to be purchasable',
            status: contentRecord.status,
          }
        );
      }

      if (contentRecord.priceCents === null || contentRecord.priceCents <= 0) {
        throw new ContentNotPurchasableError(validated.contentId, 'free', {
          priceCents: contentRecord.priceCents,
        });
      }
      // Validation refuses 1p–99p (Codex-2hxff.32). This catches a row priced
      // before that rule, rather than letting Stripe refuse it at Checkout.
      if (contentRecord.priceCents < PRICE_LIMITS.MIN_CENTS) {
        throw new ContentNotPurchasableError(
          validated.contentId,
          'below_minimum_price',
          { priceCents: contentRecord.priceCents }
        );
      }
      // Only what a purchase would open is sold (Codex-2hxff.14): marked
      // purchasable, and not course-only, team-only, followers-only or orgless
      // with a tier. Before this a buyer could pay and then be refused access.
      if (!canBeSold(contentRecord)) {
        throw new ContentNotPurchasableError(
          validated.contentId,
          'not_sold_separately'
        );
      }

      // Step 2: Check for existing purchase
      const existingPurchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.customerId, customerId),
          eq(purchases.contentId, validated.contentId),
          eq(purchases.status, PURCHASE_STATUS.COMPLETED)
        ),
      });

      if (existingPurchase) {
        throw new AlreadyPurchasedError(validated.contentId, customerId);
      }

      // Codex-h69cg (Option B): purchases use the PLATFORM CHARGE model, not
      // destination charges. The charge lands fully on the platform's balance,
      // and `writePurchasePayouts` issues TWO secondary transfers (creator +
      // org) using `source_transaction: chargeId` post-webhook.
      //
      // Why the switch from destination charges (Option A):
      //   - Destination charges auto-create a transfer for the FULL charge
      //     amount to the destination Connect account, consuming the entire
      //     source-linked balance. A secondary `transfers.create` with
      //     `source_transaction` then fails:
      //       "Transfers using this transaction as a source must not exceed
      //        the source amount." (there's already one for £X using it)
      //   - Inflating `application_fee_amount` to cover platform+org does NOT
      //     carve out a source-linked slice for a third party — the app fee
      //     reimburses the platform after the destination transfer, leaving
      //     zero source-linked balance.
      //   - Confirmed against Stripe docs (Context7): platform charges allow
      //     multiple transfers from one source_transaction up to charge.amount.
      //
      // No application_fee_amount, no transfer_data.destination here.

      // Step 4: Create Stripe Checkout session
      // Convert TipTap JSON description to plain text for Stripe
      const plainDescription = extractPlainText(contentRecord.description);

      // Resolve the Codex user's unified Stripe Customer id so every
      // checkout across every org routes to the SAME `cus_...` object
      // (Codex-ssfes). `customer_email` used to be passed here, but Stripe
      // does NOT dedupe on email — it creates a fresh Customer per session.
      // resolveOrCreateCustomer (Codex-49gev) reads users.stripe_customer_id,
      // falls back to email-match against Stripe, then creates with an
      // idempotency key, persisting the id on first hit. A missing user row
      // throws NotFoundError — let it propagate; a caller hitting checkout
      // with an unknown customerId is a bug, not a payment failure.
      const [user] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, customerId))
        .limit(1);

      if (!user?.email) {
        throw new NotFoundError('User email not found for checkout', {
          customerId,
          contentId: validated.contentId,
        });
      }

      // Hoist captured non-null `priceCents` BEFORE the closure. TypeScript
      // loses narrowing of property accesses (`contentRecord.priceCents`)
      // across closure boundaries — the local preserves the narrowed `number`
      // type we already validated earlier in this function.
      //
      // Codex-69t7c WP5: `organizationId` is intentionally NOT non-null here —
      // orgless (bi-party) content has `organizationId === null`, which is a
      // supported purchase. Only `priceCents` is a hard invariant at this point
      // (the free/unpriced guard above already rejected null/<=0).
      const priceCents = contentRecord.priceCents;
      const organizationId = contentRecord.organizationId;
      if (priceCents === null) {
        // Already validated upstream; this guards the type narrowing only.
        throw new PaymentProcessingError('Content missing price at checkout', {
          contentId: validated.contentId,
        });
      }

      // One open session per buyer and item (Codex-2hxff.14): a second tab
      // gets the first tab's Stripe page back.
      const reserved = await this.checkoutReservations.reserve({
        kind: CHECKOUT_SESSION_KIND.PURCHASE,
        customerId,
        contentId: validated.contentId,
        amountCents: priceCents,
      });
      if (reserved.url && reserved.stripeSessionId) {
        return {
          sessionUrl: reserved.url,
          sessionId: reserved.stripeSessionId,
        };
      }

      // `withStaleCustomerRecovery` resolves a customer id and self-heals
      // a stale `users.stripe_customer_id` (deleted-in-Stripe or seed-only
      // synthetic) by clearing the cache and recreating once. Same pattern
      // as `SubscriptionService.createCheckoutSession`.
      return await this.checkoutReservations.create(reserved, () =>
        withStaleCustomerRecovery(
          { db: this.db, stripe: this.stripe, obs: this.obs },
          {
            userId: customerId,
            email: user.email,
            environment: this.environment,
          },
          (resolvedCustomerId) =>
            this.stripe.checkout.sessions.create(
              {
                mode: 'payment',
                payment_method_types: ['card'],
                customer: resolvedCustomerId,
                line_items: [
                  {
                    price_data: {
                      currency: CURRENCY.GBP,
                      unit_amount: priceCents,
                      product_data: {
                        name: contentRecord.title,
                        description: plainDescription
                          ? plainDescription.slice(0, 500)
                          : undefined,
                        images: contentRecord.thumbnailUrl
                          ? [contentRecord.thumbnailUrl]
                          : undefined,
                      },
                    },
                    quantity: 1,
                  },
                ],
                // Codex-h69cg Option B: platform charge — no transfer_data,
                // no application_fee_amount. Funds land on the platform's
                // balance and are split via secondary transfers in
                // `writePurchasePayouts` (creator + org), each linked to the
                // charge via `source_transaction`.
                success_url: validated.successUrl,
                cancel_url: validated.cancelUrl,
                // Codex-69t7c WP5: `organizationId` is OMITTED for orgless
                // (bi-party) content. Stripe metadata values must be strings, so
                // we cannot pass `null`; and an empty string would fail the
                // webhook's `uuidSchema` round-trip in checkoutSessionMetadataSchema.
                // Omitting the key lets that schema's `.default(null)` re-derive
                // `null` on the completePurchase side.
                metadata: {
                  contentId: validated.contentId,
                  customerId,
                  ...(organizationId !== null ? { organizationId } : {}),
                  creatorId: contentRecord.creatorId,
                  contentTitle: contentRecord.title,
                  ...stripeEnvMetadata(this.environment),
                },
                // Onto the PaymentIntent, from which Stripe snapshots it onto the
                // Charge — so charge.refunded and friends carry the tag too.
                payment_intent_data: {
                  metadata: stripeEnvMetadata(this.environment),
                },
                client_reference_id: customerId,
                expires_at: toStripeTime(reserved.expiresAt),
              },
              {
                idempotencyKey: checkoutIdempotencyKey(
                  reserved,
                  resolvedCustomerId
                ),
              }
            ),
          {
            onStaleRecovery: (info) =>
              this.obs.warn(
                'Stale users.stripe_customer_id detected; clearing and retrying',
                { ...info, contentId: validated.contentId }
              ),
          }
        )
      );
    } catch (error) {
      if (
        error instanceof ContentNotPurchasableError ||
        error instanceof AlreadyPurchasedError ||
        error instanceof NotFoundError ||
        error instanceof PaymentProcessingError
      ) {
        throw error;
      }

      // Wrap Stripe errors. Its message is logged, never sent (SEC-02).
      if (isStripeError(error)) {
        const context = { contentId: validated.contentId };
        throw new PaymentProcessingError('Failed to create checkout session', {
          ...context,
          errorId: this.logStripeFailure(
            'Stripe failed to create a checkout session',
            error,
            context
          ),
        });
      }

      this.handleError(error, 'createCheckoutSession');
    }
  }

  // ─── One open checkout per buyer and item (Codex-2hxff.14) ─────────────────

  /**
   * The booking webhook: this session was paid (Codex-2hxff.14). The buyer's
   * next checkout for the item is refused because they own it, so this is a
   * record, not a gate.
   */
  async markCheckoutSessionCompleted(stripeSessionId: string): Promise<void> {
    try {
      await this.checkoutReservations.markCompleted(stripeSessionId);
    } catch (error) {
      this.handleError(error, 'markCheckoutSessionCompleted');
    }
  }

  // ─── A second payment for an owned item (Codex-2hxff.14) ───────────────────

  /**
   * Take the per-buyer, per-item advisory lock, then look again. The lock
   * serialises payments for the same buyer and item landing at once, so
   * exactly one completes; the partial unique index on completed purchases
   * backs it.
   *
   * - `replay`: this PaymentIntent's own row, written by a concurrent delivery
   *   of the same event while this one waited for the lock.
   * - `ownerId`: the buyer's completed purchase of the item, if they own it.
   */
  private async lockForItem(
    tx: Tx,
    customerId: string,
    target: { contentId: string } | { courseId: string },
    paymentIntentId: string
  ): Promise<{ replay?: Purchase; ownerId?: string }> {
    const [item, itemId] =
      'contentId' in target
        ? [eq(purchases.contentId, target.contentId), target.contentId]
        : [eq(purchases.courseId, target.courseId), target.courseId];
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${customerId}:${itemId}`}))`
    );
    const replay = await tx.query.purchases.findFirst({
      where: eq(purchases.stripePaymentIntentId, paymentIntentId),
    });
    if (replay) return { replay };
    const owner = await tx.query.purchases.findFirst({
      where: and(
        eq(purchases.customerId, customerId),
        item,
        eq(purchases.status, PURCHASE_STATUS.COMPLETED)
      ),
      columns: { id: true },
    });
    return { ownerId: owner?.id };
  }

  /**
   * Refund a duplicate payment in full (owner decision "Block, then refund")
   * and mark it `refunded`. Safe to repeat: a replayed webhook asks Stripe
   * again under the same key, and a charge already refunded counts as done.
   * Its `charge.refunded` then records the refund and emails the buyer that
   * they keep the item.
   *
   * If Stripe refuses, the row stays `pending`: the buyer is owed the money,
   * and nothing reports it as returned. The failure is logged with Stripe's
   * code and thrown as retryable whatever its cause, so Stripe redelivers the
   * event through its retry window: a refusal such as a low platform balance
   * can clear. One that never clears (a disputed charge) ends with the
   * dispute, or with support (owner decision: a failed refund is held for
   * support).
   */
  private async refundDuplicatePayment(purchase: Purchase): Promise<Purchase> {
    let refundId: string | null;
    try {
      ({ refundId } = await issueRefund(this.stripe, {
        paymentIntentId: purchase.stripePaymentIntentId,
        reason: 'duplicate',
        idempotencyKey: `refund_duplicate_${purchase.stripePaymentIntentId}`,
        environment: this.environment,
      }));
    } catch (error) {
      this.obs.error('Duplicate payment could not be refunded', {
        errorId: crypto.randomUUID(),
        purchaseId: purchase.id,
        stripePaymentIntentId: purchase.stripePaymentIntentId,
        code: stripeErrorCode(error),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableError(
        'Duplicate payment refund failed; it will be retried',
        { purchaseId: purchase.id }
      );
    }
    // A bound instant, not now(): the query text stays the same on every
    // request, so Hyperdrive can cache it (data-access contract, rule 6).
    const refundedAt = new Date();
    const [refunded] = await this.db
      .update(purchases)
      .set({
        status: PURCHASE_STATUS.REFUNDED,
        refundedAt: sql`COALESCE(${purchases.refundedAt}, ${refundedAt})`,
        refundAmountCents: sql`COALESCE(${purchases.refundAmountCents}, ${purchases.amountPaidCents})`,
        stripeRefundId: sql`COALESCE(${purchases.stripeRefundId}, ${refundId})`,
      })
      .where(eq(purchases.id, purchase.id))
      .returning();
    this.obs.warn('Duplicate payment refunded', {
      purchaseId: purchase.id,
      stripePaymentIntentId: purchase.stripePaymentIntentId,
      contentId: purchase.contentId,
      courseId: purchase.courseId,
      alreadyRefunded: refundId === null,
    });
    return refunded ?? purchase;
  }

  /**
   * After the commit: a duplicate payment is refunded unless it already has
   * been, and pays no one, so it never reaches the payout slices.
   */
  private async settleDuplicatePayment(purchase: Purchase): Promise<Purchase> {
    return purchase.status === PURCHASE_STATUS.REFUNDED
      ? purchase
      : this.refundDuplicatePayment(purchase);
  }

  /**
   * The hourly sweep's retry of duplicate refunds still owed (Codex-2hxff.15).
   * The webhook retries a refused one only while Stripe redelivers; after that
   * a `pending` duplicate would sit unseen. Each is tried once and one failure
   * never stops the rest (`refundDuplicatePayment` has logged it). What stays
   * owed is returned for the sweep to alert on and support to settle.
   */
  async settleOwedDuplicates(params: {
    olderThanMs: number;
    limit: number;
  }): Promise<{
    settled: number;
    stillOwed: Array<{ id: string; stripePaymentIntentId: string }>;
  }> {
    const owed = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          isNotNull(purchases.duplicateOfPurchaseId),
          eq(purchases.status, PURCHASE_STATUS.PENDING),
          lt(purchases.createdAt, new Date(Date.now() - params.olderThanMs))
        )
      )
      .orderBy(purchases.createdAt)
      .limit(params.limit);

    let settled = 0;
    const stillOwed: Array<{ id: string; stripePaymentIntentId: string }> = [];
    for (const purchase of owed) {
      try {
        await this.refundDuplicatePayment(purchase);
        settled++;
      } catch (error) {
        // A refused refund was logged as it was thrown; anything else (the
        // row update after a refund Stripe made) is logged here.
        if (!(error instanceof ServiceUnavailableError)) {
          this.obs.error('Owed duplicate refund could not be settled', {
            errorId: crypto.randomUUID(),
            purchaseId: purchase.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        stillOwed.push({
          id: purchase.id,
          stripePaymentIntentId: purchase.stripePaymentIntentId,
        });
      }
    }
    return { settled, stillOwed };
  }

  /** The title of the content or course a purchase is for. */
  private async itemTitle(
    purchase: Pick<Purchase, 'contentId' | 'courseId'>
  ): Promise<string | null> {
    if (purchase.contentId) {
      const row = await this.db.query.content.findFirst({
        where: eq(content.id, purchase.contentId),
        columns: { title: true },
      });
      return row?.title ?? null;
    }
    if (purchase.courseId) {
      const row = await this.db.query.courses.findFirst({
        where: eq(courses.id, purchase.courseId),
        columns: { title: true },
      });
      return row?.title ?? null;
    }
    return null;
  }

  /**
   * Does the buyer hold another completed purchase of this purchase's item?
   * Then a refund or dispute of this one leaves their access alone: the
   * shared `content_access` row and the item are still theirs.
   */
  private async keepsItemElsewhere(
    db: Tx | DatabaseClient,
    purchase: Pick<Purchase, 'id' | 'customerId' | 'contentId' | 'courseId'>
  ): Promise<boolean> {
    const item = purchase.contentId
      ? eq(purchases.contentId, purchase.contentId)
      : purchase.courseId
        ? eq(purchases.courseId, purchase.courseId)
        : undefined;
    if (!item) return false;
    const [other] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.customerId, purchase.customerId),
          item,
          eq(purchases.status, PURCHASE_STATUS.COMPLETED),
          ne(purchases.id, purchase.id)
        )
      )
      .limit(1);
    return other !== undefined;
  }

  /**
   * Complete purchase after Stripe payment confirmation
   *
   * Called by Stripe webhook handler after successful payment.
   *
   * Business Logic:
   * - IDEMPOTENT: Returns existing purchase if already completed
   * - Calculates revenue split from fee agreements or defaults
   * - Creates purchase record with immutable revenue snapshot
   * - Grants content access atomically in same transaction
   * - Sets status='completed' and purchasedAt = the payment time
   *   (metadata.paidAt — the webhook event's created — else now)
   *
   * Transaction Safety:
   * - Purchase + contentAccess created atomically
   * - Rollback if either operation fails
   *
   * @param stripePaymentIntentId - Stripe payment intent ID (unique constraint)
   * @param metadata - Session metadata from Stripe
   * @returns Created or existing purchase record
   * @throws {PaymentProcessingError} If purchase creation fails
   *
   * @example
   * const purchase = await purchaseService.completePurchase(
   *   'pi_123abc',
   *   {
   *     contentId: 'content-123',
   *     customerId: 'customer-456',
   *     organizationId: 'org-789',
   *     amountPaidCents: 2999,
   *     currency: 'gbp',
   *   }
   * );
   * // Returns: Purchase with status='completed', revenue split calculated
   */
  async completePurchase(
    stripePaymentIntentId: string,
    metadata: CompletePurchaseMetadata
  ): Promise<Purchase> {
    try {
      // GBP in, GBP out (Codex-2hxff.23 PAY-25): every slice is transferred in
      // pounds, so a sale in another currency is refused before its purchase
      // or any slice is written. A 400: the webhook acknowledges it and Stripe
      // does not redeliver.
      assertGbpOnly(metadata.currency, {
        stripePaymentIntentId,
        contentId: metadata.contentId,
      });
      const txResult = await this.db.transaction(async (tx) => {
        // Step 1: Check for existing purchase (idempotency)
        const existing = await tx.query.purchases.findFirst({
          where: eq(purchases.stripePaymentIntentId, stripePaymentIntentId),
        });

        if (existing) {
          // Already processed - return existing. Its slices are re-recorded
          // after the transaction (repairPurchasePayouts): the ledger skips
          // the ones already there, so a replay never transfers twice.
          return { purchase: existing, isNew: false } as const;
        }

        // A second payment for content the buyer already owns is recorded
        // refunded and grants nothing; it is refunded after the commit
        // (Codex-2hxff.14, "Block, then refund").
        const { replay, ownerId: duplicateOf } = await this.lockForItem(
          tx,
          metadata.customerId,
          { contentId: metadata.contentId },
          stripePaymentIntentId
        );
        if (replay) return { purchase: replay, isNew: false } as const;
        const isDuplicate = duplicateOf !== undefined;

        // Codex-xz61z (I5): pin `purchasedAt` once, so a replay cannot land
        // on the other side of an agreement boundary mid-millisecond.
        const purchasedAt = metadata.paidAt ?? new Date();
        const { creatorId, organizationId, revenueSplit, agreement } =
          await this.resolvePurchaseSplit(tx, {
            target: {
              contentId: metadata.contentId,
              organizationId: metadata.organizationId,
            },
            amountCents: metadata.amountPaidCents,
            // At the checkout's start (Codex-2hxff.64 Q1).
            at: metadata.offerAt ?? purchasedAt,
            stripePaymentIntentId,
            stripeApplicationFeeCents: metadata.stripeApplicationFeeCents,
            duplicatePayment: isDuplicate,
          });

        // Step 4: Create purchase record
        const [purchase] = await tx
          .insert(purchases)
          .values({
            customerId: metadata.customerId,
            contentId: metadata.contentId,
            organizationId: organizationId, // Fetched from content if needed
            amountPaidCents: metadata.amountPaidCents,
            currency: metadata.currency || CURRENCY.GBP,
            stripePaymentIntentId,
            purchasedAt,
            platformFeeCents: revenueSplit.platformFeeCents,
            organizationFeeCents: revenueSplit.organizationFeeCents,
            creatorPayoutCents: revenueSplit.creatorPayoutCents,
            // Fee configuration replaced platform agreements: the platform
            // fee has no agreement row to point at, so this stays null.
            platformAgreementId: null,
            // The creator agreement this sale was split by, if any
            // (Codex-2hxff.19 AGR-06).
            creatorOrgAgreementId: agreement?.agreementId ?? null,
            ...purchaseOutcomeFields(duplicateOf),
          })
          .returning();

        if (!purchase) {
          throw new PaymentProcessingError('Failed to create purchase record', {
            stripePaymentIntentId,
          });
        }

        // A duplicate grants nothing (the first purchase did) and pays no
        // one; the post-commit step refunds it, as for a replay of it.
        if (isDuplicate) {
          return { purchase, isNew: false } as const;
        }

        // Step 5: grant access atomically with the purchase.
        await this.grantPurchaseAccess(tx, purchase);

        return {
          purchase,
          isNew: true,
          revenueSplit,
          creatorId,
          organizationId,
        } as const;
      });

      // A duplicate payment, first delivery or replay, is refunded and pays
      // no one: no slices, and no repair of slices it never had.
      if (isDuplicatePayment(txResult.purchase)) {
        return this.settleDuplicatePayment(txResult.purchase);
      }

      // Step 6 (post-commit): record the slices in the payouts ledger and
      // transfer the payable ones. Out-of-transaction so a Stripe API failure
      // can't roll back the purchase + access grant. On a webhook replay
      // (`isNew: false`) the slices are re-recorded from the purchase's stored
      // split — the ledger skips the ones already there (Codex-2hxff.11).
      const { stripeChargeId } = metadata;
      if (txResult.isNew && stripeChargeId) {
        await this.recordPayoutsAfterCommit(
          txResult.purchase,
          stripeChargeId,
          () =>
            this.writePurchasePayouts({
              purchase: txResult.purchase,
              revenueSplit: txResult.revenueSplit,
              creatorId: txResult.creatorId,
              organizationId: txResult.organizationId,
              stripeChargeId,
            })
        );
      } else if (stripeChargeId) {
        await this.recordPayoutsAfterCommit(
          txResult.purchase,
          stripeChargeId,
          () => this.repairPurchasePayouts(txResult.purchase, stripeChargeId)
        );
      } else if (txResult.isNew && !metadata.stripeChargeId) {
        // Codex-69t7c WP5 hardening (a): a completed purchase with no
        // stripeChargeId means writePurchasePayouts is skipped entirely, so
        // NO creator_payout row is ever written — the creator (org-scoped OR
        // orgless) is never paid for this sale. That is a money-loss event,
        // not a recoverable warning: escalate to error with a correlatable
        // errorId so it is loud in the log aggregator / Sentry-via-logs.
        const errorId = crypto.randomUUID();
        this.obs.error(
          'Purchase completed without stripeChargeId — payouts ledger entries skipped; creator will NOT be paid',
          {
            errorId,
            purchaseId: txResult.purchase.id,
            creatorId: txResult.creatorId,
            organizationId: txResult.organizationId,
            stripePaymentIntentId,
          }
        );
      }

      return txResult.purchase;
    } catch (error) {
      // An AfterCommitError's purchase did complete; its own step logged it.
      if (!(error instanceof AfterCommitError)) {
        this.obs.error('Failed to complete purchase', {
          error: error instanceof Error ? error.message : String(error),
          stripePaymentIntentId,
          customerId: metadata.customerId,
          contentId: metadata.contentId,
          amountPaidCents: metadata.amountPaidCents,
        });
      }
      this.handleError(error, 'completePurchase');
    }
  }

  // ─── Course purchase (Codex-2pryk WP-6 · SPEC §7 path 1) ─────────────────────

  /**
   * Create a Stripe Checkout session for a one-off COURSE purchase.
   *
   * The course analogue of {@link createCheckoutSession}: `mode: 'payment'`,
   * platform-charge (Option B) so the SAME `writePurchasePayouts` fan-out splits
   * the charge post-webhook. The session metadata is tagged `kind: 'course'` so
   * the `checkout.session.completed` handler routes to
   * {@link completeCoursePurchase}. Org + creator are NOT in metadata — they are
   * re-derived from the `courses` row at completion (courses are always
   * org-owned), so a tampered session can never redirect the payout.
   */
  async createCourseCheckoutSession(
    input: CreateCourseCheckoutInput,
    customerId: string
  ): Promise<CheckoutSessionResult> {
    const validated = createCourseCheckoutSchema.parse(input);

    try {
      const course = await this.db.query.courses.findFirst({
        where: and(
          eq(courses.id, validated.courseId),
          isNull(courses.deletedAt)
        ),
      });

      if (!course) {
        throw new CourseNotPurchasableError(validated.courseId, 'deleted');
      }
      if (course.status !== CONTENT_STATUS.PUBLISHED) {
        throw new CourseNotPurchasableError(
          validated.courseId,
          'not_published',
          {
            status: course.status,
          }
        );
      }
      if (course.priceCents === null || course.priceCents <= 0) {
        throw new CourseNotPurchasableError(validated.courseId, 'no_price', {
          priceCents: course.priceCents,
        });
      }
      // Mirrors the content path: a course priced before the £1.00 rule.
      if (course.priceCents < PRICE_LIMITS.MIN_CENTS) {
        throw new CourseNotPurchasableError(
          validated.courseId,
          'below_minimum_price',
          { priceCents: course.priceCents }
        );
      }

      // Double-purchase guard: a buyer who owns the course cannot check out
      // for it again (purchases.md; Codex-2hxff.14). Owning is a completed
      // purchase or a live purchase or support-grant entitlement. A course
      // plan subscriber rents it, so they may still buy it outright.
      const [existing, liveEntitlement] = await Promise.all([
        this.db.query.purchases.findFirst({
          where: and(
            eq(purchases.customerId, customerId),
            eq(purchases.courseId, validated.courseId),
            eq(purchases.status, PURCHASE_STATUS.COMPLETED)
          ),
          columns: { id: true },
        }),
        this.db.query.entitlements.findFirst({
          where: and(
            eq(entitlements.userId, customerId),
            eq(entitlements.courseId, validated.courseId),
            inArray(entitlements.source, ['course_purchase', 'grant']),
            isNull(entitlements.revokedAt)
          ),
          columns: { id: true },
        }),
      ]);
      if (existing || liveEntitlement) {
        throw new CourseAlreadyOwnedError(validated.courseId, customerId);
      }

      const [user] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, customerId))
        .limit(1);
      if (!user?.email) {
        throw new NotFoundError('User email not found for checkout', {
          customerId,
          courseId: validated.courseId,
        });
      }

      // Hoist the narrowed price across the closure boundary (TS drops the
      // property narrowing inside the callback — same reason as the content path).
      const priceCents = course.priceCents;

      const reserved = await this.checkoutReservations.reserve({
        kind: CHECKOUT_SESSION_KIND.PURCHASE,
        customerId,
        courseId: validated.courseId,
        amountCents: priceCents,
      });
      if (reserved.url && reserved.stripeSessionId) {
        return {
          sessionUrl: reserved.url,
          sessionId: reserved.stripeSessionId,
        };
      }

      return await this.checkoutReservations.create(reserved, () =>
        withStaleCustomerRecovery(
          { db: this.db, stripe: this.stripe, obs: this.obs },
          {
            userId: customerId,
            email: user.email,
            environment: this.environment,
          },
          (resolvedCustomerId) =>
            this.stripe.checkout.sessions.create(
              {
                mode: 'payment',
                payment_method_types: ['card'],
                customer: resolvedCustomerId,
                line_items: [
                  {
                    price_data: {
                      currency: CURRENCY.GBP,
                      unit_amount: priceCents,
                      product_data: {
                        name: course.title,
                        description: course.lede
                          ? course.lede.slice(0, 500)
                          : undefined,
                      },
                    },
                    quantity: 1,
                  },
                ],
                success_url: validated.successUrl,
                cancel_url: validated.cancelUrl,
                // `kind: 'course'` discriminates this from a content purchase at the
                // webhook. organizationId is deliberately omitted (re-derived server
                // side from the course row).
                metadata: {
                  kind: 'course',
                  courseId: validated.courseId,
                  customerId,
                  courseTitle: course.title,
                  ...stripeEnvMetadata(this.environment),
                },
                payment_intent_data: {
                  metadata: stripeEnvMetadata(this.environment),
                },
                client_reference_id: customerId,
                expires_at: toStripeTime(reserved.expiresAt),
              },
              {
                idempotencyKey: checkoutIdempotencyKey(
                  reserved,
                  resolvedCustomerId
                ),
              }
            ),
          {
            onStaleRecovery: (info) =>
              this.obs.warn(
                'Stale users.stripe_customer_id detected; clearing and retrying',
                { ...info, courseId: validated.courseId }
              ),
          }
        )
      );
    } catch (error) {
      if (
        error instanceof CourseNotPurchasableError ||
        error instanceof CourseAlreadyOwnedError ||
        error instanceof NotFoundError ||
        error instanceof PaymentProcessingError
      ) {
        throw error;
      }
      if (isStripeError(error)) {
        const context = { courseId: validated.courseId };
        throw new PaymentProcessingError(
          'Failed to create course checkout session',
          {
            ...context,
            errorId: this.logStripeFailure(
              'Stripe failed to create a course checkout session',
              error,
              context
            ),
          }
        );
      }
      this.handleError(error, 'createCourseCheckoutSession');
    }
  }

  /**
   * Complete a one-off COURSE purchase after Stripe payment confirmation.
   *
   * The course analogue of {@link completePurchase}: same immutable revenue-split
   * snapshot, same idempotency (by `stripePaymentIntentId`), and the SAME
   * `writePurchasePayouts` Option-B fan-out (keyed on the purchase id, so a
   * `purchases` row with a `courseId` target flows through unchanged). Differs
   * only in the resource: it writes a `course_purchase` entitlement + auto-enrolls
   * (via {@link writeCoursePurchaseEntitlement}) instead of a `contentAccess` row.
   *
   * Per HARDENING §H4(a) course purchases REUSE `content_purchase` agreement
   * share terms — the agreement lookup uses `revenueType: 'content_purchase'`.
   */
  async completeCoursePurchase(
    stripePaymentIntentId: string,
    metadata: CompleteCoursePurchaseMetadata
  ): Promise<Purchase> {
    try {
      // GBP only, before anything is written (PAY-25; see completePurchase).
      assertGbpOnly(metadata.currency, {
        stripePaymentIntentId,
        courseId: metadata.courseId,
      });
      const txResult = await this.db.transaction(async (tx) => {
        // Idempotency — a webhook replay returns the existing purchase and skips
        // payouts (the first-write path already ran; transfer idempotency keys
        // protect the money side either way).
        const existing = await tx.query.purchases.findFirst({
          where: eq(purchases.stripePaymentIntentId, stripePaymentIntentId),
        });
        if (existing) {
          return { purchase: existing, isNew: false } as const;
        }

        // A second payment for a course the buyer already bought is recorded
        // refunded and grants nothing (Codex-2hxff.14, "Block, then refund").
        const { replay, ownerId: duplicateOf } = await this.lockForItem(
          tx,
          metadata.customerId,
          { courseId: metadata.courseId },
          stripePaymentIntentId
        );
        if (replay) return { purchase: replay, isNew: false } as const;
        const isDuplicate = duplicateOf !== undefined;

        const purchasedAt = metadata.paidAt ?? new Date();
        // Courses are ALWAYS org-owned: the org is authoritative from the row.
        // HARDENING §H4(a): the split reuses the creator's `content_purchase`
        // agreement terms.
        const { creatorId, organizationId, revenueSplit, agreement } =
          await this.resolvePurchaseSplit(tx, {
            target: { courseId: metadata.courseId },
            amountCents: metadata.amountPaidCents,
            // At the checkout's start (Codex-2hxff.64 Q1).
            at: metadata.offerAt ?? purchasedAt,
            stripePaymentIntentId,
            stripeApplicationFeeCents: metadata.stripeApplicationFeeCents,
            duplicatePayment: isDuplicate,
          });

        const [purchase] = await tx
          .insert(purchases)
          .values({
            customerId: metadata.customerId,
            // Split target — course, not content (CHECK enforces exactly one).
            courseId: metadata.courseId,
            organizationId,
            amountPaidCents: metadata.amountPaidCents,
            currency: metadata.currency || CURRENCY.GBP,
            stripePaymentIntentId,
            purchasedAt,
            platformFeeCents: revenueSplit.platformFeeCents,
            organizationFeeCents: revenueSplit.organizationFeeCents,
            creatorPayoutCents: revenueSplit.creatorPayoutCents,
            // Fee configuration replaced platform agreements (as above).
            platformAgreementId: null,
            creatorOrgAgreementId: agreement?.agreementId ?? null,
            ...purchaseOutcomeFields(duplicateOf),
          })
          .returning();

        if (!purchase) {
          throw new PaymentProcessingError('Failed to create purchase record', {
            stripePaymentIntentId,
          });
        }

        // A duplicate grants nothing and pays no one; refunded post-commit.
        if (isDuplicate) {
          return { purchase, isNew: false } as const;
        }

        // Grant the course entitlement (the resolver's READ target) + auto-enroll,
        // atomically with the purchase row. Idempotent on replay.
        await this.grantPurchaseAccess(tx, purchase);

        return {
          purchase,
          isNew: true,
          revenueSplit,
          creatorId,
          organizationId,
        } as const;
      });

      // A duplicate payment, first delivery or replay: refund it, pay no one.
      if (isDuplicatePayment(txResult.purchase)) {
        return this.settleDuplicatePayment(txResult.purchase);
      }

      // Post-commit payouts — REUSE the Option-B fan-out verbatim. A course
      // purchase row carries a `courseId` target; `writePurchasePayouts` only
      // reads `purchase.id` + the split, so it splits the charge identically.
      const { stripeChargeId } = metadata;
      if (txResult.isNew && stripeChargeId) {
        await this.recordPayoutsAfterCommit(
          txResult.purchase,
          stripeChargeId,
          () =>
            this.writePurchasePayouts({
              purchase: txResult.purchase,
              revenueSplit: txResult.revenueSplit,
              creatorId: txResult.creatorId,
              organizationId: txResult.organizationId,
              stripeChargeId,
            })
        );
      } else if (stripeChargeId) {
        // A replay re-records the slices; the ledger skips the ones already
        // there (Codex-2hxff.11).
        await this.recordPayoutsAfterCommit(
          txResult.purchase,
          stripeChargeId,
          () => this.repairPurchasePayouts(txResult.purchase, stripeChargeId)
        );
      } else if (txResult.isNew && !metadata.stripeChargeId) {
        const errorId = crypto.randomUUID();
        this.obs.error(
          'Course purchase completed without stripeChargeId — payouts ledger entries skipped; creator will NOT be paid',
          {
            errorId,
            purchaseId: txResult.purchase.id,
            creatorId: txResult.creatorId,
            organizationId: txResult.organizationId,
            stripePaymentIntentId,
          }
        );
      }

      return txResult.purchase;
    } catch (error) {
      if (!(error instanceof AfterCommitError)) {
        this.obs.error('Failed to complete course purchase', {
          error: error instanceof Error ? error.message : String(error),
          stripePaymentIntentId,
          customerId: metadata.customerId,
          courseId: metadata.courseId,
          amountPaidCents: metadata.amountPaidCents,
        });
      }
      this.handleError(error, 'completeCoursePurchase');
    }
  }

  /**
   * How a sale is split (Codex-2hxff.68): the item's creator and
   * organisation, the fees configured for them, and the creator's agreement in
   * force at `at`. Completion and the self-heal (a refund that beat its
   * checkout) both store exactly this, so a self-healed purchase is paid from
   * its real split, not a default one.
   *
   * - **Organisation.** A content sale's comes from its session metadata, else
   *   the content row; it is legitimately null for orgless creator-direct
   *   (bi-party) content (Codex-69t7c WP5). A course's is always the course
   *   row's: courses are org-owned.
   * - **Fees** (Codex-m644n) come from `FeeConfigService` when injected,
   *   else the legacy constants. Org-scoped sales read the platform leg PLUS
   *   the org's per-creator override (`getFeesForCreator`); orgless ones read
   *   platform-only fees.
   * - **The agreement** (Codex-rzfjw, Decisions Q1–Q3): the uploader's
   *   `content_purchase` agreement, which course purchases reuse too
   *   (HARDENING §H4(a)). Its creator share is snapshotted on the proposal;
   *   the platform fee is read fresh. The lookup is org-scoped, so orgless
   *   content has none.
   * - **The organisation's cut** is `10000 - creator share` under an
   *   agreement, else the configured `orgFeePercent`. For orgless content it
   *   is ALWAYS zero: there is no organisation to pay, and a non-zero default
   *   would strand a slice with no recipient. That override is logged.
   * - **The split** is `calculateRevenueSplit`, then the min-platform-fee
   *   floor, applied here rather than in the calculator to keep its math pure.
   *   The DB CHECK `amount = platform + org + creator` holds by construction.
   *
   * A Stripe application fee that differs from the computed platform fee is
   * logged, never thrown.
   */
  private async resolvePurchaseSplit(
    tx: Tx,
    params: {
      target:
        | { contentId: string; organizationId: string | null }
        | { courseId: string };
      amountCents: number;
      at: Date;
      stripePaymentIntentId: string;
      stripeApplicationFeeCents?: number | null;
      /** Computed for the record; a duplicate is refunded, never paid out. */
      duplicatePayment: boolean;
    }
  ): Promise<{
    creatorId: string;
    organizationId: string | null;
    revenueSplit: RevenueSplit;
    agreement: CreatorAgreementShare | null;
  }> {
    const { target, amountCents, stripePaymentIntentId } = params;
    const itemIds =
      'contentId' in target
        ? { contentId: target.contentId }
        : { courseId: target.courseId };
    let creatorId: string;
    let organizationId: string | null;
    if ('contentId' in target) {
      const row = await tx.query.content.findFirst({
        where: eq(content.id, target.contentId),
        columns: { organizationId: true, creatorId: true },
      });
      if (!row) {
        throw new PaymentProcessingError(
          'Content not found during purchase completion',
          { contentId: target.contentId, stripePaymentIntentId }
        );
      }
      creatorId = row.creatorId;
      organizationId = target.organizationId ?? row.organizationId;
    } else {
      const row = await tx.query.courses.findFirst({
        where: eq(courses.id, target.courseId),
        columns: { organizationId: true, creatorId: true },
      });
      if (!row) {
        throw new PaymentProcessingError(
          'Course not found during purchase completion',
          { courseId: target.courseId, stripePaymentIntentId }
        );
      }
      creatorId = row.creatorId;
      organizationId = row.organizationId;
    }

    const fees = this.feeConfig
      ? organizationId
        ? await this.feeConfig.getFeesForCreator(
            organizationId,
            creatorId,
            'one_off'
          )
        : await this.feeConfig.getFeesPlatform('one_off')
      : {
          platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
          orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
          minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
          minTransferCents: 0,
        };

    const agreement = organizationId
      ? await findActiveCreatorAgreementShare(tx, {
          organizationId,
          creatorId,
          revenueType: 'content_purchase',
          at: params.at,
          obs: this.obs,
        })
      : null;

    const effectiveOrgFeePercent = !organizationId
      ? 0
      : agreement
        ? 10_000 - agreement.sharePercent
        : fees.orgFeePercent;
    if (!organizationId) {
      this.obs.info('orgless_org_fee_override', {
        ...itemIds,
        creatorId,
        stripePaymentIntentId,
        configOrgFeePercent: fees.orgFeePercent,
        effectiveOrgFeePercent: 0,
        reason: 'bi_party_no_org_recipient',
      });
    }

    const revenueSplit = applyMinPlatformFeeFloor(
      amountCents,
      calculateRevenueSplit(
        amountCents,
        fees.platformFeePercent,
        effectiveOrgFeePercent
      ),
      fees.minPlatformFeeCents
    );

    // Codex-rzfjw: one event per purchase split, for end-to-end
    // auditability of the agreements payout pipeline.
    this.obs.info('payout_split_computed', {
      purchaseId: undefined,
      ...itemIds,
      organizationId,
      creatorId,
      amountPaidCents: amountCents,
      platformFeeCents: revenueSplit.platformFeeCents,
      organizationFeeCents: revenueSplit.organizationFeeCents,
      creatorPayoutCents: revenueSplit.creatorPayoutCents,
      agreementApplied: agreement !== null,
      source: 'contentId' in target ? 'content_purchase' : 'course_purchase',
      duplicatePayment: params.duplicatePayment,
    });

    const { stripeApplicationFeeCents } = params;
    if (
      stripeApplicationFeeCents != null &&
      stripeApplicationFeeCents !== revenueSplit.platformFeeCents
    ) {
      this.obs.warn(
        'Platform fee mismatch: Stripe-collected application fee differs from calculated split',
        {
          stripeApplicationFeeCents,
          calculatedPlatformFeeCents: revenueSplit.platformFeeCents,
          amountPaidCents: amountCents,
          stripePaymentIntentId,
          ...itemIds,
        }
      );
    }

    return { creatorId, organizationId, revenueSplit, agreement };
  }

  /**
   * Grant what a completed purchase buys, in its transaction. Idempotent, so
   * a replay or a self-healed purchase (Codex-2hxff.68) writes the same rows.
   *
   * - Content: the `contentAccess` row (an upsert, so a re-purchase after a
   *   refund un-deletes it) and the `content_purchase` entitlement the
   *   resolver reads (Codex-2pryk WP-6), additive to `contentAccess` and
   *   `verifyPurchase`. An orgless sale's grant has no organisation
   *   (Codex-2hxff.21).
   * - Course: the `course_purchase` entitlement, plus enrolment.
   */
  private async grantPurchaseAccess(tx: Tx, purchase: Purchase): Promise<void> {
    if (purchase.contentId) {
      await tx
        .insert(contentAccess)
        .values({
          userId: purchase.customerId,
          contentId: purchase.contentId,
          organizationId: purchase.organizationId,
          accessType: ACCESS_TYPES.PURCHASED,
          expiresAt: null, // Permanent access for purchases
        })
        .onConflictDoUpdate({
          target: [contentAccess.userId, contentAccess.contentId],
          set: {
            deletedAt: null, // Un-delete the soft-deleted row
            accessType: ACCESS_TYPES.PURCHASED,
            updatedAt: new Date(),
          },
        });
      await writeContentPurchaseEntitlement(tx, {
        userId: purchase.customerId,
        organizationId: purchase.organizationId,
        contentId: purchase.contentId,
        purchaseId: purchase.id,
      });
      return;
    }
    if (!purchase.courseId || !purchase.organizationId) {
      // The CHECK gives every purchase one target, and a course always has an
      // organisation: unreachable unless the schema drifted.
      throw new PaymentProcessingError(
        'Purchase has no item to grant access to',
        { purchaseId: purchase.id }
      );
    }
    await writeCoursePurchaseEntitlement(tx, {
      userId: purchase.customerId,
      organizationId: purchase.organizationId,
      courseId: purchase.courseId,
      purchaseId: purchase.id,
    });
  }

  /**
   * Record a purchase's slices in the payouts ledger and pay the ones whose
   * payee can be paid (Option B platform charge model — Codex-h69cg): the
   * charge lands on the platform balance and secondary transfers, linked by
   * `source_transaction`, carve out the creator and organisation slices.
   *
   * Every slice goes through `recordSlice` (Codex-2hxff.11): its row is
   * reserved by a unique key BEFORE any transfer, so calling this again for
   * the same charge — a webhook replay, at any age — adds only a slice that
   * is missing and never transfers twice.
   *
   * - `platform_fee`: paid, retained on the platform balance, no transfer.
   * - `creator_payout`: transferred to the creator, or pending in their name
   *   until their payouts are set up (they are emailed to finish).
   * - `organization_fee`: transferred to whoever owned the organisation at
   *   the payment time; pending in their name until they can be paid; held as
   *   `no_owner` if it had no owner (Codex-2hxff.37).
   *
   * A failed transfer is recorded as `failed` and retried by the drains. A
   * failed INSERT is thrown: the webhook answers by its cause and Stripe
   * retries, and this runs again on the redelivery.
   */
  private async writePurchasePayouts(params: {
    purchase: Purchase;
    revenueSplit: {
      platformFeeCents: number;
      organizationFeeCents: number;
      creatorPayoutCents: number;
    };
    creatorId: string;
    // Codex-69t7c WP5: nullable for orgless (bi-party) purchases. When null the
    // org-fee leg is unreachable (organizationFeeCents is forced to 0 upstream),
    // and the payout rows carry organizationId=null (payouts.organization_id is
    // nullable). The creator slice still routes by userId.
    organizationId: string | null;
    stripeChargeId: string;
  }): Promise<void> {
    const {
      purchase,
      revenueSplit,
      creatorId,
      organizationId,
      stripeChargeId,
    } = params;
    const ledger = this.ledger();
    const source = { sourceType: 'purchase', purchaseId: purchase.id } as const;
    const transferGroup = `purchase_${purchase.id}`;

    await recordPlatformFee(ledger, {
      amountCents: revenueSplit.platformFeeCents,
      organizationId,
      source,
      stripeChargeId,
      transferGroup,
    });

    // The creator's single account (one per user, Codex-69t7c).
    if (revenueSplit.creatorPayoutCents > 0) {
      const [creatorConnect] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId))
        .limit(1);
      const outcome = await recordSlice(ledger, {
        payoutType: 'creator_payout',
        amountCents: revenueSplit.creatorPayoutCents,
        organizationId,
        source,
        stripeChargeId,
        transferGroup,
        // The purchase charge already has a transfer group; Stripe rejects a
        // second one alongside source_transaction.
        sendTransferGroup: false,
        payee: { userId: creatorId, account: creatorConnect },
        idempotencyKey: `${stripeChargeId}_creator`,
        metadata: { purchase_id: purchase.id },
        // The agreement the purchase was split by (Codex-2hxff.19 AGR-06).
        creatorOrgAgreementId: purchase.creatorOrgAgreementId,
      });
      // Only a freshly reserved row: a replay ('exists') never re-sends it.
      if (outcome?.kind === 'pending') {
        await this.notifyCreatorConnectNeeded(
          creatorId,
          organizationId,
          revenueSplit.creatorPayoutCents
        );
      }
    }

    // Codex-2hxff.2: the org slice goes to whoever owned the org at the
    // payment time — the same instant the agreement lookup used. Orgless
    // purchases never carve an org slice (forced to 0 upstream).
    if (organizationId !== null && revenueSplit.organizationFeeCents > 0) {
      const orgPayee = await resolveOrganisationPayee(
        this.db,
        organizationId,
        purchase.purchasedAt ?? purchase.createdAt,
        this.obs
      );
      await recordSlice(ledger, {
        payoutType: 'organization_fee',
        amountCents: revenueSplit.organizationFeeCents,
        organizationId,
        source,
        stripeChargeId,
        transferGroup,
        sendTransferGroup: false,
        payee: orgPayee
          ? { userId: orgPayee.userId, account: orgPayee.account }
          : null,
        idempotencyKey: `${stripeChargeId}_org_fee`,
        metadata: { purchase_id: purchase.id },
      });
    }
  }

  /**
   * Run a purchase's post-commit ledger write. The purchase and its access
   * grant have committed by now, so a failure is logged as exactly that —
   * not as a purchase that failed — with an errorId, and rethrown: the
   * webhook answers by its cause, and a redelivery's replay re-records the
   * missing slices. Acknowledged (a permanent cause), the slices stay
   * missing until someone replays the event, so the errorId is the handle.
   *
   * Then any refund or chargeback of the charge is clawed back from them
   * (Codex-2hxff.67): one handled between the purchase's commit and this
   * write found no slices to claw back. Its failure is logged once, by the
   * clawback (with its purchase, charge and an errorId), and rethrown as an
   * `AfterCommitError` carrying the purchase, so the webhook still does what
   * follows from the purchase alone.
   */
  private async recordPayoutsAfterCommit(
    purchase: Purchase,
    stripeChargeId: string,
    write: () => Promise<void>
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.obs.error(
        'Purchase committed but its payout slices were not all recorded; a redelivery re-records them',
        {
          errorId: crypto.randomUUID(),
          purchaseId: purchase.id,
          stripeChargeId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
    try {
      await reverseEarlierRefunds(
        { ...this.ledger(), obs: this.obs },
        {
          chargeId: stripeChargeId,
          source: { sourceType: 'purchase', purchaseId: purchase.id },
        }
      );
    } catch (error) {
      throw new AfterCommitError(
        'The purchase completed, but a refund or chargeback before its payout was not clawed back',
        purchase,
        error
      );
    }
  }

  private ledger(): LedgerDeps {
    return {
      db: this.db,
      stripe: this.stripe,
      obs: this.obs,
      environment: this.environment,
    };
  }

  /**
   * Log a Stripe failure for support and return the errorId the client gets
   * instead (Codex-2hxff.23 SEC-02). A ServiceError's context is sent to the
   * client verbatim as `details`, so Stripe's own message never goes in it.
   * `warn` is for a failure the caller caused, such as a session id that
   * does not exist; anything else is an error.
   */
  private logStripeFailure(
    message: string,
    error: Error & { type: string },
    context: Record<string, unknown>,
    level: 'error' | 'warn' = 'error'
  ): string {
    const errorId = crypto.randomUUID();
    this.obs[level](message, {
      errorId,
      ...context,
      stripeType: error.type,
      code: stripeErrorCode(error),
      error: error.message,
    });
    return errorId;
  }

  /**
   * A replayed webhook re-records an existing purchase's slices from the split
   * stored on it. The ledger skips every slice already there, so this only
   * adds one the first delivery never wrote — the worker died between
   * committing the purchase and writing its slices, or an insert failed and
   * the webhook was retried (Codex-2hxff.11). Until this, a replay skipped the
   * ledger entirely and such a slice was never paid.
   *
   * A PARTLY refunded purchase is re-recorded too (Codex-2hxff.68): the
   * refund is clawed back from the added slices straight after
   * (`recordPayoutsAfterCommit` runs `reverseEarlierRefunds`), so each payee
   * nets what a refund after the payout leaves. That is also how a purchase
   * rebuilt by a refund that beat its checkout is first paid.
   *
   * A purchase refunded in full or disputed since is left alone: it owes no
   * one, or its dispute decides what it owes.
   */
  private async repairPurchasePayouts(
    purchase: Purchase,
    stripeChargeId: string
  ): Promise<void> {
    if (
      purchase.status !== PURCHASE_STATUS.COMPLETED ||
      purchase.refundedAt ||
      purchase.disputedAt
    ) {
      this.obs.warn('Replay left a refunded or disputed purchase unrepaired', {
        purchaseId: purchase.id,
        status: purchase.status,
        refundedAt: purchase.refundedAt?.toISOString() ?? null,
        refundAmountCents: purchase.refundAmountCents,
        disputedAt: purchase.disputedAt?.toISOString() ?? null,
      });
      return;
    }
    const creatorId = await this.findPurchaseCreator(purchase);
    if (!creatorId) {
      this.obs.error('Cannot re-record a purchase: its creator is unknown', {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        courseId: purchase.courseId,
      });
      return;
    }
    await this.writePurchasePayouts({
      purchase,
      revenueSplit: {
        platformFeeCents: purchase.platformFeeCents,
        organizationFeeCents: purchase.organizationFeeCents,
        creatorPayoutCents: purchase.creatorPayoutCents,
      },
      creatorId,
      organizationId: purchase.organizationId,
      stripeChargeId,
    });
  }

  /**
   * The creator paid for a purchase: its content's, or its course's. Read by
   * id alone, soft-deleted rows included, on purpose: the id comes from the
   * purchase, the result never leaves the server, and the creator of content
   * deleted since must still be paid.
   */
  private async findPurchaseCreator(
    purchase: Purchase
  ): Promise<string | undefined> {
    if (purchase.contentId) {
      const row = await this.db.query.content.findFirst({
        where: eq(content.id, purchase.contentId),
        columns: { creatorId: true },
      });
      return row?.creatorId;
    }
    if (purchase.courseId) {
      const row = await this.db.query.courses.findFirst({
        where: eq(courses.id, purchase.courseId),
        columns: { creatorId: true },
      });
      return row?.creatorId;
    }
    return undefined;
  }

  /**
   * WP-10 (Codex-69t7c.10): tell a creator money is waiting for them to set
   * up payouts. Best-effort and fire-and-forget: a notification miss must
   * never block or reverse the payout.
   */
  private async notifyCreatorConnectNeeded(
    creatorId: string,
    organizationId: string | null,
    amountCents: number
  ): Promise<void> {
    if (!this.mailer) return;
    try {
      const [creatorRow] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, creatorId))
        .limit(1);
      if (!creatorRow?.email) return;
      const dashboardUrl = this.webAppUrl
        ? `${this.webAppUrl}/studio/earnings`
        : '/studio/earnings';
      void this.mailer({
        to: creatorRow.email,
        templateName: 'creator-connect-needed',
        category: 'transactional',
        userId: creatorId,
        organizationId,
        data: {
          creatorName: creatorRow.email, // fallback; template can resolve display name
          amountFormatted: `£${(amountCents / 100).toFixed(2)}`,
          dashboardUrl,
        },
      });
    } catch (err) {
      this.obs.warn('creator-connect-needed notification dispatch failed', {
        creatorId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Verify if customer has purchased content
   *
   * Used for access control decisions.
   *
   * @param contentId - Content ID to check
   * @param customerId - Customer ID to check
   * @returns true if customer has completed purchase, false otherwise
   *
   * @example
   * const hasPurchased = await purchaseService.verifyPurchase('content-123', 'customer-456');
   * if (hasPurchased) {
   *   // Grant access to content
   * }
   */
  async verifyPurchase(
    contentId: string,
    customerId: string
  ): Promise<boolean> {
    try {
      // A disputed purchase keeps `status='completed'` by design (Stripe's
      // semantics — a chargeback doesn't refund until the dispute resolves)
      // so a status-only filter would still grant access during the
      // dispute window. processDispute soft-deletes the contentAccess
      // row but a caller using verifyPurchase directly would miss that.
      // Filter `disputedAt IS NULL` here to keep verifyPurchase aligned
      // with the access-revocation invariant.
      const purchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.contentId, contentId),
          eq(purchases.customerId, customerId),
          eq(purchases.status, PURCHASE_STATUS.COMPLETED),
          isNull(purchases.disputedAt)
        ),
      });

      return !!purchase;
    } catch (error) {
      this.handleError(error, 'verifyPurchase');
    }
  }

  /**
   * Get purchase history for customer with filters
   *
   * Security:
   * - Scoped to customerId
   * - Only returns customer's own purchases
   *
   * Features:
   * - Pagination (page, limit)
   * - Filter by status
   * - Filter by contentId
   * - Content AND course purchases, each joined with its item
   * - Sort by purchasedAt DESC
   *
   * @param customerId - Customer ID
   * @param filters - Query filters
   * @returns Paginated purchase history with the bought item's details
   *
   * @example
   * const history = await purchaseService.getPurchaseHistory('customer-123', {
   *   page: 1,
   *   limit: 20,
   *   status: 'completed',
   * });
   * // Returns: { items: [...], pagination: { total: 42, page: 1, limit: 20, totalPages: 3 } }
   */
  async getPurchaseHistory(
    customerId: string,
    filters: PurchaseQueryInput
  ): Promise<PaginatedListResponse<PurchaseWithItem>> {
    const validated = purchaseQuerySchema.parse(filters);

    try {
      // Both kinds (Codex-2hxff.21). A row targets exactly one of content or a
      // course (the split-FK CHECK), so exactly one of the two joins is filled.
      const conditions = [eq(purchases.customerId, customerId)];

      if (validated.status) {
        conditions.push(eq(purchases.status, validated.status));
      }

      if (validated.contentId) {
        conditions.push(eq(purchases.contentId, validated.contentId));
      }

      const { limit, offset } = withPagination({
        page: validated.page,
        limit: validated.limit,
      });

      // Run paginated SELECT and COUNT in parallel to cut one DB round-trip
      const [items, countResult] = await Promise.all([
        this.db.query.purchases.findMany({
          where: and(...conditions),
          limit,
          offset,
          orderBy: [desc(purchases.purchasedAt)],
          with: {
            content: {
              columns: {
                id: true,
                title: true,
                slug: true,
                thumbnailUrl: true,
                contentType: true,
              },
            },
            course: {
              columns: { id: true, title: true, slug: true },
            },
          },
        }),
        this.db
          .select({ total: count() })
          .from(purchases)
          .where(and(...conditions)),
      ]);
      const total = countResult[0]?.total ?? 0;

      return {
        items,
        pagination: {
          page: validated.page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.handleError(error, 'getPurchaseHistory');
    }
  }

  /**
   * Format purchase history for client consumption
   *
   * Maps raw PurchaseWithItem records into PurchaseListItem DTOs
   * with validated status values and ISO date strings.
   *
   * @param result - Raw purchase history from getPurchaseHistory()
   * @returns Paginated response with formatted PurchaseListItem items
   */
  formatPurchasesForClient(
    result: PaginatedListResponse<PurchaseWithItem>
  ): PaginatedListResponse<PurchaseListItem> {
    return {
      items: result.items.map(
        (p): PurchaseListItem => ({
          id: p.id,
          customerId: p.customerId,
          createdAt: toIso(p.createdAt),
          kind: p.courseId !== null ? 'course' : 'content',
          contentId: p.contentId,
          contentTitle: p.content?.title ?? null,
          courseId: p.courseId,
          courseTitle: p.course?.title ?? null,
          amountCents: p.amountPaidCents,
          status: coercePurchaseStatus(p.status),
        })
      ),
      pagination: result.pagination,
    };
  }

  /**
   * Get single purchase by ID
   *
   * Security:
   * - Verifies purchase belongs to customer
   * - Returns 404 if purchase doesn't exist
   * - Returns 403 if purchase exists but belongs to different customer
   *
   * @param purchaseId - Purchase ID
   * @param customerId - Customer ID for authorization
   * @returns Purchase record
   * @throws {PurchaseNotFoundError} If purchase doesn't exist (404)
   * @throws {ForbiddenError} If purchase exists but user doesn't own it (403)
   *
   * @example
   * const purchase = await purchaseService.getPurchase('purchase-123', 'customer-456');
   * // Automatically throws if not found or not authorized
   */
  async getPurchase(purchaseId: string, customerId: string): Promise<Purchase> {
    const validated = getPurchaseSchema.parse({ id: purchaseId });

    try {
      // Query scoped by both ID and customer — prevents cross-user access
      const purchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.id, validated.id),
          eq(purchases.customerId, customerId)
        ),
      });

      if (!purchase) {
        throw new PurchaseNotFoundError(validated.id);
      }

      return purchase;
    } catch (error) {
      if (error instanceof PurchaseNotFoundError) {
        throw error;
      }
      this.handleError(error, 'getPurchase');
    }
  }

  /**
   * Ensure a purchase row exists for a payment_intent, self-healing the
   * ordering race #4 (Codex-aa08z) where `charge.refunded` arrives BEFORE
   * `checkout.session.completed` (the event that normally INSERTs the row).
   *
   * Without this, `processRefund` found no row, logged WARN + returned 200, so
   * the refund was never recorded — refund tracking lost, access left granted.
   *
   * Fast path: row already present (normal ordering / replay) → return it.
   *
   * Slow path: rebuild from the Stripe checkout session. The PaymentIntent does
   * not carry our metadata, so we list sessions by `payment_intent`. The
   * session's metadata is validated against the SAME schemas the booking
   * webhook uses: a content session's `{ customerId, contentId,
   * organizationId }`, or a course session's `{ kind: 'course', customerId,
   * courseId }` (PAY-11), plus `amount_total`.
   *
   * The row is the one completion would write (Codex-2hxff.68): the REAL split
   * (`resolvePurchaseSplit`, with the agreement in force when the checkout
   * session was created, as completion resolves it), after the same GBP check
   * (PAY-25). `purchasedAt` is the payment time the caller passes (the
   * charge's `created`). No slice is written here: the later
   * `checkout.session.completed` replays into `repairPurchasePayouts`.
   * - **Refunded in full** (`refundedInFull`): the row is written `refunded`,
   *   with the refund, in the same transaction, and grants nothing. The
   *   replay then pays no one.
   * - **Otherwise** it is written `completed` with its access grant, and the
   *   caller records the partial refund on it (P-1: access is kept). The
   *   replay records the slices and claws the refund back from them, so each
   *   payee nets what a refund after the payout leaves.
   *
   * Returns the purchase, or `null` when the session/metadata cannot be resolved
   * (caller then exits cleanly with 200, exactly as the old drop branch did).
   * Bubbles transient Stripe/DB errors so the webhook 5xx's and Stripe retries.
   */
  async ensurePurchaseDataPresent(
    paymentIntentId: string,
    options: {
      paidAt?: Date;
      /** The charge is refunded in full: what to record on a rebuilt row. */
      refundedInFull?: {
        refundAmountCents: number;
        stripeRefundId: string | null;
        refundReason: string | null;
      };
    } = {}
  ): Promise<Purchase | null> {
    // Fast path: row already exists (normal delivery order, or a replay).
    const existing = await this.db.query.purchases.findFirst({
      where: eq(purchases.stripePaymentIntentId, paymentIntentId),
    });
    if (existing) return existing;

    // Slow path: reconstruct from the checkout session that created this PI.
    const sessions = await this.stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });
    // Optional-chain the response shape: a malformed/empty Stripe reply should
    // clean-exit (return null → caller 200s), never throw.
    const session = sessions?.data?.[0];
    if (!session) {
      this.obs.warn(
        'Purchase self-heal: no checkout session found for payment_intent',
        { paymentIntentId }
      );
      return null;
    }

    const sold = selfHealedSale(session.metadata ?? {});
    const amountPaidCents = session.amount_total;
    if (!sold || amountPaidCents === null) {
      this.obs.warn(
        'Purchase self-heal: checkout session missing/invalid metadata or amount',
        { paymentIntentId, sessionId: session.id }
      );
      return null;
    }
    const { customerId, target } = sold;
    const itemIds =
      'contentId' in target
        ? { contentId: target.contentId }
        : { courseId: target.courseId };
    // GBP only, before a split is computed (PAY-25), as completion refuses it.
    assertGbpOnly(session.currency, {
      stripePaymentIntentId: paymentIntentId,
      ...itemIds,
    });
    const { refundedInFull } = options;
    const purchasedAt = options.paidAt ?? new Date();
    // The checkout's start, as completion takes it (Codex-2hxff.64 Q1).
    const offerAt = Number.isFinite(session.created)
      ? new Date(session.created * 1000)
      : purchasedAt;

    try {
      // Under the same lock as completion (Codex-2hxff.14), so a rebuild and
      // a completion of the buyer's other payment for the item cannot both
      // write a completed purchase. A buyer who already owns the item paid
      // twice: this one is rebuilt as the duplicate it is, granting nothing.
      return await this.db.transaction(async (tx) => {
        const { replay, ownerId } = await this.lockForItem(
          tx,
          customerId,
          itemIds,
          paymentIntentId
        );
        if (replay) return replay;
        const split = await this.resolvePurchaseSplit(tx, {
          target,
          amountCents: amountPaidCents,
          at: offerAt,
          stripePaymentIntentId: paymentIntentId,
          duplicatePayment: ownerId !== undefined,
        });
        const [inserted] = await tx
          .insert(purchases)
          .values({
            customerId,
            ...itemIds,
            organizationId: split.organizationId,
            amountPaidCents,
            currency: session.currency || CURRENCY.GBP,
            stripePaymentIntentId: paymentIntentId,
            purchasedAt,
            platformFeeCents: split.revenueSplit.platformFeeCents,
            organizationFeeCents: split.revenueSplit.organizationFeeCents,
            creatorPayoutCents: split.revenueSplit.creatorPayoutCents,
            platformAgreementId: null,
            creatorOrgAgreementId: split.agreement?.agreementId ?? null,
            ...purchaseOutcomeFields(ownerId),
            // Refunded already: never granted, so nothing is left to revoke.
            ...(refundedInFull && {
              ...refundedInFull,
              status: PURCHASE_STATUS.REFUNDED,
              refundedAt: new Date(),
            }),
          })
          .returning();
        if (!inserted) {
          throw new PaymentProcessingError('Failed to create purchase record', {
            stripePaymentIntentId: paymentIntentId,
          });
        }
        if (ownerId === undefined && !refundedInFull) {
          await this.grantPurchaseAccess(tx, inserted);
        }
        this.obs.info('Purchase self-heal: rebuilt from its checkout session', {
          purchaseId: inserted.id,
          paymentIntentId,
          ...itemIds,
          duplicatePayment: ownerId !== undefined,
          refundedInFull: refundedInFull !== undefined,
        });
        return inserted;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Concurrent completePurchase / self-heal raced us to insert — re-select.
        const raced = await this.db.query.purchases.findFirst({
          where: eq(purchases.stripePaymentIntentId, paymentIntentId),
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Process a refund of a purchase's charge (`charge.refunded`; and
   * `refund.updated`, which re-runs the clawback).
   *
   * Flow:
   * 1. Ensure the purchase row exists (self-heal ordering race #4, Codex-aa08z)
   * 2. Record the refund on the purchase:
   *    - a FULL refund (the charge refunded in full) makes it `refunded` and
   *      ends access: content access soft-deleted, its entitlement revoked;
   *    - a PARTIAL refund keeps access (owner decision P-1, "Keep access"):
   *      the purchase stays `completed`, with the amount refunded so far.
   *    Each refund itself is a `refunds` row (`recordChargeRefunds`).
   * 3. Claw back each refund's share of the payout slices
   *
   * Idempotent. An already-refunded purchase skips step 2 but still runs
   * step 3: what each refund did is recorded per slice (payout_reversals), so
   * a redelivery does only what is left (Codex-2hxff.8).
   */
  async processRefund(
    paymentIntentId: string,
    refundDetails: {
      /** The refunded charge: its id and amount, the clawback's denominator. */
      charge: ClawbackCharge;
      /** The newest refund of the charge. */
      stripeRefundId?: string;
      /**
       * How much of the charge is refunded so far: Stripe's cumulative
       * `charge.amount_refunded`. At least the charge's amount is a full
       * refund. Absent, the refund is taken to be full.
       */
      refundAmountCents?: number;
      refundReason?: string;
      /**
       * When the charge was paid (its `created`): the purchase date of a
       * purchase the refund rebuilds because it beat the checkout.
       */
      paidAt?: Date;
    }
  ): Promise<
    | {
        userId: string;
        accessEnded: boolean;
        duplicatePayment: boolean;
        /** The item's title, for the refund email (charges carry none). */
        itemTitle: string | null;
      }
    | undefined
  > {
    try {
      // Self-heal ordering race #4 (Codex-aa08z): if charge.refunded beat
      // checkout.session.completed, the row won't exist yet — rebuild it from
      // the Stripe checkout session so the refund is recorded (no transfers
      // yet: completion records them, Codex-2hxff.68).
      const refundedCents =
        refundDetails.refundAmountCents ?? refundDetails.charge.amountCents;
      const isFull = refundedCents >= refundDetails.charge.amountCents;
      const refundFields = {
        updatedAt: new Date(),
        refundAmountCents: refundedCents,
        stripeRefundId: refundDetails.stripeRefundId ?? null,
        refundReason: refundDetails.refundReason ?? null,
      };
      const purchase = await this.ensurePurchaseDataPresent(paymentIntentId, {
        paidAt: refundDetails.paidAt,
        // A purchase rebuilt for a full refund is written refunded, granting
        // nothing (below, it takes the already-refunded path).
        refundedInFull: isFull
          ? {
              refundAmountCents: refundedCents,
              stripeRefundId: refundFields.stripeRefundId,
              refundReason: refundFields.refundReason,
            }
          : undefined,
      });

      if (!purchase) {
        this.obs.warn('Refund for unknown purchase', { paymentIntentId });
        return;
      }

      // Idempotent: already refunded — still return the userId so the caller
      // can re-bump the library cache (KV version increments are monotonic
      // and cheap; idempotent at the Stripe layer, not the cache layer).
      if (purchase.status === PURCHASE_STATUS.REFUNDED) {
        this.obs.info('Refund already processed', {
          purchaseId: purchase.id,
          paymentIntentId,
        });
        // The purchase is recorded; the clawback is not gated by it.
        await this.clawBackRefunds(purchase.id, refundDetails.charge);
        // A duplicate payment's buyer keeps the item through their first
        // purchase, and so does anyone who bought it again (Codex-2hxff.14).
        return {
          userId: purchase.customerId,
          accessEnded: !(await this.keepsItemElsewhere(this.db, purchase)),
          duplicatePayment: isDuplicatePayment(purchase),
          itemTitle: await this.itemTitle(purchase),
        };
      }

      if (!isFull) {
        // P-1: the buyer keeps access. The amount only grows, so a stale
        // redelivery never lowers it.
        await this.db
          .update(purchases)
          .set(refundFields)
          .where(
            and(
              eq(purchases.id, purchase.id),
              eq(purchases.status, PURCHASE_STATUS.COMPLETED),
              or(
                isNull(purchases.refundAmountCents),
                lt(purchases.refundAmountCents, refundedCents)
              )
            )
          );
      }
      let keptElsewhere = false;
      if (isFull) {
        // Atomically update purchase status AND revoke content access
        await this.db.transaction(async (tx) => {
          // Update purchase status to refunded with tracking fields
          await tx
            .update(purchases)
            .set({
              ...refundFields,
              status: PURCHASE_STATUS.REFUNDED,
              refundedAt: new Date(),
            })
            .where(eq(purchases.id, purchase.id));

          // Revoke content access (soft delete) — content purchases only. Course
          // purchases grant no contentAccess row (they use entitlements). The
          // row is per buyer and item, shared by every purchase of it, so it
          // stays while another completed purchase still grants it
          // (Codex-2hxff.14).
          keptElsewhere = await this.keepsItemElsewhere(tx, purchase);
          if (purchase.contentId && !keptElsewhere) {
            await tx
              .update(contentAccess)
              .set({ deletedAt: new Date() })
              .where(
                and(
                  eq(contentAccess.userId, purchase.customerId),
                  eq(contentAccess.contentId, purchase.contentId),
                  isNull(contentAccess.deletedAt)
                )
              );
          }

          // Codex-2pryk WP-6: revoke the entitlement this purchase granted
          // (content_purchase OR course_purchase — both carry sourceRef=purchase.id).
          // Without this a refund would leave a LIVE grant the resolver still
          // honours (access-integrity bug). Keyed on sourceRef so one statement
          // covers either target. Idempotent (no-op if already revoked / absent).
          await tx
            .update(entitlements)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(entitlements.sourceRef, purchase.id),
                isNull(entitlements.revokedAt)
              )
            );
        });
      }

      // Step: claw back the payout slices (Codex-h69cg), out of the
      // transaction because it talks to Stripe. The purchase is already
      // recorded above; a clawback step that must be retried rejects after
      // every other step, and the webhook's 500 has Stripe redeliver.
      await this.clawBackRefunds(purchase.id, refundDetails.charge);

      this.obs.info('Refund processed', {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        customerId: purchase.customerId,
        paymentIntentId,
        refundedCents,
        accessEnded: isFull && !keptElsewhere,
      });

      // Return the purchaser's userId so the webhook route can bump
      // COLLECTION_USER_LIBRARY — refunded content disappears from the
      // user's library on their next fetch. No orgId: one-time purchases
      // are content-scoped, not org-scoped, so only the library cache bumps.
      return {
        userId: purchase.customerId,
        accessEnded: isFull && !keptElsewhere,
        duplicatePayment: isDuplicatePayment(purchase),
        itemTitle: await this.itemTitle(purchase),
      };
    } catch (error) {
      this.handleError(error, 'processRefund');
    }
  }

  /**
   * Claw back each refund of the charge from this purchase's payout slices
   * (@codex/payments `reverseCharge`, Codex-2hxff.56, .8). Only a refund that
   * succeeded or failed is clawed back; one still pending is clawed back when
   * `refund.updated` re-runs processRefund (owner decision Q1).
   */
  private async clawBackRefunds(
    purchaseId: string,
    charge: ClawbackCharge
  ): Promise<void> {
    await reverseCharge(
      { ...this.ledger(), obs: this.obs },
      {
        charge,
        source: { sourceType: 'purchase', purchaseId },
        refunds: () => listClawableRefunds(this.stripe, charge.id),
      }
    );
  }

  /**
   * Record a refund as Stripe reports it (`refunds`; owner decisions
   * 2026-10-19). One row per Stripe refund, for any source; `purchaseId` is
   * set when the charge is a purchase's. A failed row is support's to settle,
   * and the clawback is left standing (see the table).
   *
   * A stale event never moves a row backwards: `failed` and `canceled` are
   * final, and `succeeded` does not return to pending. Returns true when this
   * call wrote the refund's status (a new row, or a newer status), so a
   * redelivered event does not raise an alert again. A status Stripe has
   * added since is logged and not written.
   */
  async recordRefund(refund: {
    stripeRefundId: string;
    stripeChargeId: string;
    /** The charge's PaymentIntent, which finds the purchase if it is one. */
    paymentIntentId: string | null;
    amountCents: number;
    currency: string;
    status: string | null;
    reason: string | null;
    failureReason: string | null;
    stripeCreatedAt: Date;
  }): Promise<boolean> {
    try {
      const { status } = refund;
      if (!isRefundStatus(status)) {
        this.obs.warn('Refund has a status the refunds table does not know', {
          refundId: refund.stripeRefundId,
          status,
        });
        return false;
      }
      const [purchase] = refund.paymentIntentId
        ? await this.db
            .select({ id: purchases.id })
            .from(purchases)
            .where(eq(purchases.stripePaymentIntentId, refund.paymentIntentId))
            .limit(1)
        : [];
      const written = await this.db
        .insert(refunds)
        .values({
          stripeRefundId: refund.stripeRefundId,
          stripeChargeId: refund.stripeChargeId,
          purchaseId: purchase?.id ?? null,
          amountCents: refund.amountCents,
          currency: refund.currency,
          status,
          reason: refund.reason,
          failureReason: refund.failureReason,
          stripeCreatedAt: refund.stripeCreatedAt,
        })
        .onConflictDoUpdate({
          target: refunds.stripeRefundId,
          set: { status, failureReason: refund.failureReason },
          // Forward only: Stripe does not deliver events in order.
          setWhere: sql`${refunds.status} <> excluded.status AND ${refunds.status} NOT IN ('failed', 'canceled') AND NOT (${refunds.status} = 'succeeded' AND excluded.status IN ('pending', 'requires_action'))`,
        })
        .returning();
      return written.length > 0;
    } catch (error) {
      this.handleError(error, 'recordRefund');
    }
  }

  /**
   * Record every refund of a charge, as Stripe lists them, in `refunds`
   * (`charge.refunded`; owner decision 2026-10-19, "One refunds table"). The
   * event names no refund: `charge.refunds` is no longer sent. Returns them
   * newest first, so the caller can name the newest on the purchase.
   */
  async recordChargeRefunds(charge: {
    id: string;
    paymentIntentId: string | null;
  }): Promise<Stripe.Refund[]> {
    try {
      const listed = await listChargeRefunds(this.stripe, charge.id);
      for (const refund of listed) {
        await this.recordRefund({
          stripeRefundId: refund.id,
          stripeChargeId: charge.id,
          paymentIntentId: charge.paymentIntentId,
          amountCents: refund.amount,
          currency: refund.currency,
          status: refund.status,
          reason: refund.reason ?? null,
          failureReason: refund.failure_reason ?? null,
          stripeCreatedAt: new Date(refund.created * 1000),
        });
      }
      return [...listed].sort(
        (a, b) => b.created - a.created || b.id.localeCompare(a.id)
      );
    } catch (error) {
      this.handleError(error, 'recordChargeRefunds');
    }
  }

  /**
   * Claim the charge's refunds not yet emailed to the buyer, oldest first, so
   * each refund is emailed once (owner decision 2026-10-19, "One per refund").
   * The claim sets `notified_at` before the email is sent, so a redelivery
   * finds nothing; an email that then fails to send is not retried. A refund
   * that failed or was canceled is never emailed, nor one still waiting on the
   * customer (`requires_action`).
   */
  async claimRefundEmails(
    chargeId: string
  ): Promise<Array<{ stripeRefundId: string; amountCents: number }>> {
    try {
      const claimed = await this.db
        .update(refunds)
        .set({ notifiedAt: new Date() })
        .where(
          and(
            eq(refunds.stripeChargeId, chargeId),
            isNull(refunds.notifiedAt),
            inArray(refunds.status, ['pending', 'succeeded'])
          )
        )
        .returning();
      return claimed
        .sort(
          (a, b) =>
            a.stripeCreatedAt.getTime() - b.stripeCreatedAt.getTime() ||
            a.stripeRefundId.localeCompare(b.stripeRefundId)
        )
        .map((row) => ({
          stripeRefundId: row.stripeRefundId,
          amountCents: row.amountCents,
        }));
    } catch (error) {
      this.handleError(error, 'claimRefundEmails');
    }
  }

  /**
   * Process a dispute from a `charge.dispute.created` webhook event.
   *
   * Disputes are treated identically to refunds for access purposes:
   * - Mark `disputedAt = now()` on the purchase (status stays 'completed'
   *   until the dispute resolves — this keeps the purchase_status CHECK
   *   constraint happy and matches Stripe's semantics where a disputed
   *   charge is still a completed payment until it is evaluated)
   * - Soft-delete matching `contentAccess` rows (the content disappears
   *   from the user's library on the next fetch — same as refund)
   *
   * Idempotent: if the purchase already has `disputedAt` set, this is a
   * near-no-op — we still return `{ userId, orgId }` so the webhook
   * handler can re-invalidate the library cache and re-write the
   * AccessRevocation KV key (both are monotonic / idempotent at their
   * respective layers).
   *
   * Purchases are org-scoped (`organizationId` is NOT NULL on the
   * `purchases` table), so unlike `processRefund` we can always return
   * `orgId`. The webhook handler then writes
   * `AccessRevocation.revoke(userId, orgId, 'refund')` — the revocation
   * reason enum intentionally doesn't include 'dispute' because it's
   * observability-only and disputes are the same access-reducing class
   * as refunds.
   *
   * @param paymentIntentId - The payment intent ID from the disputed charge
   * @param disputeDetails - Optional Stripe dispute metadata
   * @returns `{ userId, orgId }` when a matching purchase exists; `void` otherwise
   */
  async processDispute(
    paymentIntentId: string,
    disputeDetails?: {
      stripeDisputeId?: string;
      disputeReason?: string;
    }
  ): Promise<
    | {
        userId: string;
        orgId: string | null;
        /**
         * False when the buyer keeps the item through another purchase (a
         * dispute of a duplicate payment, say): the caller then writes no
         * org-wide streaming block (Codex-2hxff.14).
         */
        accessEnded: boolean;
      }
    | undefined
  > {
    try {
      const purchase = await this.db.query.purchases.findFirst({
        where: eq(purchases.stripePaymentIntentId, paymentIntentId),
      });

      if (!purchase) {
        this.obs.warn('Dispute for unknown purchase', { paymentIntentId });
        return;
      }

      // Idempotent: already disputed — still return scope so the caller
      // can bump library cache + re-write revocation monotonically.
      if (purchase.disputedAt) {
        this.obs.info('Dispute already processed', {
          purchaseId: purchase.id,
          paymentIntentId,
        });
        return {
          userId: purchase.customerId,
          orgId: purchase.organizationId,
          accessEnded: !(await this.keepsItemElsewhere(this.db, purchase)),
        };
      }

      // Atomically mark the purchase as disputed AND revoke content access.
      let keptElsewhere = false;
      const stillHolds = await this.db.transaction(async (tx) => {
        // Only while the dispute still holds the sale: the hourly reconcile
        // re-runs an open chargeback (Codex-2hxff.58), and a win recorded
        // meanwhile must not be undone. Under a share lock on its row, that
        // win is either seen here, or waits for this commit and its restore
        // runs after.
        if (
          disputeDetails?.stripeDisputeId &&
          !(await disputeStillHolds(tx, disputeDetails.stripeDisputeId))
        ) {
          return false;
        }
        await tx
          .update(purchases)
          .set({
            updatedAt: new Date(),
            disputedAt: new Date(),
            disputeReason: disputeDetails?.disputeReason ?? null,
            stripeDisputeId: disputeDetails?.stripeDisputeId ?? null,
          })
          .where(eq(purchases.id, purchase.id));

        // Content purchases only — course purchases grant no contentAccess row.
        // The row is shared by every purchase of the item, so it stays while
        // another completed purchase still grants it (Codex-2hxff.14).
        keptElsewhere = await this.keepsItemElsewhere(tx, purchase);
        if (purchase.contentId && !keptElsewhere) {
          await tx
            .update(contentAccess)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(contentAccess.userId, purchase.customerId),
                eq(contentAccess.contentId, purchase.contentId),
                isNull(contentAccess.deletedAt)
              )
            );
        }

        // Codex-2pryk WP-6: a dispute is access-reducing like a refund — revoke
        // the entitlement this purchase granted (content_purchase / course_purchase)
        // by sourceRef so the resolver stops honouring it. Idempotent.
        await tx
          .update(entitlements)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(entitlements.sourceRef, purchase.id),
              isNull(entitlements.revokedAt)
            )
          );
        return true;
      });
      if (!stillHolds) {
        this.obs.info('Dispute no longer holds the sale; access not paused', {
          purchaseId: purchase.id,
          paymentIntentId,
          stripeDisputeId: disputeDetails?.stripeDisputeId,
        });
        return {
          userId: purchase.customerId,
          orgId: purchase.organizationId,
          accessEnded: false,
        };
      }

      this.obs.info('Dispute processed', {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        customerId: purchase.customerId,
        organizationId: purchase.organizationId,
        paymentIntentId,
        stripeDisputeId: disputeDetails?.stripeDisputeId,
        accessEnded: !keptElsewhere,
      });

      return {
        userId: purchase.customerId,
        orgId: purchase.organizationId,
        accessEnded: !keptElsewhere,
      };
    } catch (error) {
      this.handleError(error, 'processDispute');
    }
  }

  /**
   * Record a dispute as Stripe reports it (`disputes`; Codex-2hxff.9, design
   * in docs/payments/dispute-record.md). One row per Stripe dispute, for any
   * source; `purchaseId` is set when the charge is a purchase's. An open row
   * holds the charge's unpaid payouts (`isDrainablePayout`).
   *
   * Forward only, because Stripe does not deliver events in order: an inquiry
   * may become a chargeback, and a final status (`won`, `lost`,
   * `warning_closed`, `prevented`) never changes. Returns the row as it now
   * stands, which is what the caller acts on, not the event's snapshot. A
   * status Stripe adds later is logged and not written.
   */
  async recordDispute(dispute: {
    stripeDisputeId: string;
    stripeChargeId: string;
    paymentIntentId: string | null;
    amountCents: number;
    currency: string;
    status: string;
    reason: string | null;
    stripeCreatedAt: Date;
  }): Promise<Dispute | undefined> {
    try {
      const { status } = dispute;
      if (!DISPUTE_STATUS_RANK.has(status)) {
        this.obs.warn('Dispute has a status the disputes table does not know', {
          disputeId: dispute.stripeDisputeId,
          status,
        });
        return undefined;
      }
      const [purchase] = dispute.paymentIntentId
        ? await this.db
            .select({ id: purchases.id })
            .from(purchases)
            .where(eq(purchases.stripePaymentIntentId, dispute.paymentIntentId))
            .limit(1)
        : [];
      await this.db
        .insert(disputes)
        .values({
          stripeDisputeId: dispute.stripeDisputeId,
          stripeChargeId: dispute.stripeChargeId,
          purchaseId: purchase?.id ?? null,
          amountCents: dispute.amountCents,
          currency: dispute.currency,
          status,
          reason: dispute.reason,
          stripeCreatedAt: dispute.stripeCreatedAt,
        })
        .onConflictDoUpdate({
          target: disputes.stripeDisputeId,
          set: { status, amountCents: dispute.amountCents },
          // Forward only; the amount may still be corrected until it closes.
          setWhere: sql`${disputeRank(sql`${disputes.status}`)} < ${disputeRank(sql`excluded.status`)} OR (${disputeRank(sql`${disputes.status}`)} < ${sql.raw(String(FINAL_DISPUTE_RANK))} AND ${disputes.status} = excluded.status AND ${disputes.amountCents} <> excluded.amount_cents)`,
        });
      const [current] = await this.db
        .select()
        .from(disputes)
        .where(eq(disputes.stripeDisputeId, dispute.stripeDisputeId))
        .limit(1);
      return current;
    } catch (error) {
      this.handleError(error, 'recordDispute');
    }
  }

  /**
   * Claw back this purchase's slices for every cause on the charge: its
   * refunds, and the chargebacks recorded in `disputes` (the dispute webhook).
   * No purchase for the PaymentIntent (a subscription's charge): nothing.
   */
  async clawBackPurchaseCharge(
    paymentIntentId: string,
    charge: ClawbackCharge
  ): Promise<void> {
    try {
      const [purchase] = await this.db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
        .limit(1);
      if (!purchase) return;
      await this.clawBackRefunds(purchase.id, charge);
    } catch (error) {
      this.handleError(error, 'clawBackPurchaseCharge');
    }
  }

  /**
   * A WON dispute restores the buyer's access (owner decision P-2): the
   * disputed mark is cleared, and the content access and entitlement it
   * revoked are restored. A purchase refunded since keeps its access ended.
   * Idempotent. Returns the buyer, for the library cache.
   */
  async restoreDisputedPurchase(
    paymentIntentId: string
  ): Promise<{ userId: string; orgId: string | null } | undefined> {
    try {
      const purchase = await this.db.query.purchases.findFirst({
        where: eq(purchases.stripePaymentIntentId, paymentIntentId),
      });
      if (!purchase) return undefined;
      const scope = {
        userId: purchase.customerId,
        orgId: purchase.organizationId,
      };
      if (!purchase.disputedAt) return scope;

      await this.db.transaction(async (tx) => {
        await tx
          .update(purchases)
          .set({ disputedAt: null, updatedAt: new Date() })
          .where(eq(purchases.id, purchase.id));
        if (purchase.status !== PURCHASE_STATUS.COMPLETED) return;
        if (purchase.contentId) {
          await tx
            .update(contentAccess)
            .set({ deletedAt: null })
            .where(
              and(
                eq(contentAccess.userId, purchase.customerId),
                eq(contentAccess.contentId, purchase.contentId),
                isNotNull(contentAccess.deletedAt)
              )
            );
        }
        await tx
          .update(entitlements)
          .set({ revokedAt: null })
          .where(
            and(
              eq(entitlements.sourceRef, purchase.id),
              isNotNull(entitlements.revokedAt)
            )
          );
      });
      this.obs.info('Won dispute restored access', {
        purchaseId: purchase.id,
        paymentIntentId,
      });
      return scope;
    } catch (error) {
      this.handleError(error, 'restoreDisputedPurchase');
    }
  }

  /**
   * A LOST dispute: the buyer keeps the money, so the purchase becomes
   * `refunded` and its access stays ended (owner decision Q3). The amount
   * refunded so far gains the disputed amount, capped at what was paid.
   * Idempotent. Returns the buyer, for the library cache.
   */
  async processLostDispute(
    paymentIntentId: string,
    disputedCents: number
  ): Promise<
    { userId: string; orgId: string | null; accessEnded: boolean } | undefined
  > {
    try {
      const purchase = await this.db.query.purchases.findFirst({
        where: eq(purchases.stripePaymentIntentId, paymentIntentId),
      });
      if (!purchase) return undefined;
      // A buyer who keeps the item through another purchase (the lost dispute
      // was of a duplicate payment) keeps its access row and gets no
      // org-wide streaming block (Codex-2hxff.14).
      const keptElsewhere = await this.keepsItemElsewhere(this.db, purchase);
      const scope = {
        userId: purchase.customerId,
        orgId: purchase.organizationId,
        accessEnded: !keptElsewhere,
      };
      if (purchase.status === PURCHASE_STATUS.REFUNDED) return scope;

      const now = new Date();
      await this.db.transaction(async (tx) => {
        await tx
          .update(purchases)
          .set({
            status: PURCHASE_STATUS.REFUNDED,
            refundedAt: now,
            refundAmountCents: Math.min(
              purchase.amountPaidCents,
              (purchase.refundAmountCents ?? 0) + disputedCents
            ),
            updatedAt: now,
          })
          .where(eq(purchases.id, purchase.id));
        // Revoked when the dispute opened; again here, in case it never was.
        // Not while another completed purchase still grants it.
        if (purchase.contentId && !keptElsewhere) {
          await tx
            .update(contentAccess)
            .set({ deletedAt: now })
            .where(
              and(
                eq(contentAccess.userId, purchase.customerId),
                eq(contentAccess.contentId, purchase.contentId),
                isNull(contentAccess.deletedAt)
              )
            );
        }
        await tx
          .update(entitlements)
          .set({ revokedAt: now })
          .where(
            and(
              eq(entitlements.sourceRef, purchase.id),
              isNull(entitlements.revokedAt)
            )
          );
      });
      this.obs.info('Lost dispute recorded the purchase as refunded', {
        purchaseId: purchase.id,
        paymentIntentId,
        disputedCents,
      });
      return scope;
    } catch (error) {
      this.handleError(error, 'processLostDispute');
    }
  }

  /**
   * A WON dispute's money (owner decision Q2): what it clawed back from every
   * source's slices is paid back by new pending payout rows the next sweep
   * pays (@codex/payments `repayDispute`). The held slices are released by
   * the dispute closing. Then the outcome is marked applied.
   */
  async settleWonDispute(stripeDisputeId: string): Promise<void> {
    try {
      await repayDispute(
        { ...this.ledger(), obs: this.obs },
        { disputeId: stripeDisputeId }
      );
      await this.markDisputeOutcomeApplied(stripeDisputeId);
    } catch (error) {
      this.handleError(error, 'settleWonDispute');
    }
  }

  /** A final status has been acted on: a redelivery stops at the record. */
  async markDisputeOutcomeApplied(stripeDisputeId: string): Promise<void> {
    try {
      await this.db
        .update(disputes)
        .set({ outcomeAppliedAt: new Date() })
        .where(
          and(
            eq(disputes.stripeDisputeId, stripeDisputeId),
            isNull(disputes.outcomeAppliedAt)
          )
        );
    } catch (error) {
      this.handleError(error, 'markDisputeOutcomeApplied');
    }
  }

  /**
   * The hourly dispute reconcile's second source (Codex-2hxff.58): disputes
   * that reached a final status whose outcome was never applied (a won
   * dispute not re-paid, a lost one whose held slices were never cut, an
   * inquiry whose close never released them), of any age but last updated
   * before `updatedBefore`: a row written in the last minutes is still the
   * webhook's, mid-way through its outcome. Oldest first. The reconcile skips
   * any its event source already handled in the same run.
   */
  async findDisputesToReconcile(
    limit: number,
    updatedBefore: Date
  ): Promise<Array<Pick<Dispute, 'stripeDisputeId' | 'status'>>> {
    try {
      return await this.db
        .select({
          stripeDisputeId: disputes.stripeDisputeId,
          status: disputes.status,
        })
        .from(disputes)
        .where(
          and(
            inArray(disputes.status, [...DISPUTE_CLOSED_STATUSES]),
            isNull(disputes.outcomeAppliedAt),
            lt(disputes.updatedAt, updatedBefore)
          )
        )
        .orderBy(asc(disputes.updatedAt), asc(disputes.stripeDisputeId))
        .limit(limit);
    } catch (error) {
      this.handleError(error, 'findDisputesToReconcile');
    }
  }

  /**
   * The recorded state of these disputes, for the reconcile to compare with
   * Stripe's (Codex-2hxff.58). A dispute with no row is simply absent.
   */
  async findDisputeRecords(
    stripeDisputeIds: string[]
  ): Promise<
    Array<Pick<Dispute, 'stripeDisputeId' | 'status' | 'outcomeAppliedAt'>>
  > {
    if (stripeDisputeIds.length === 0) return [];
    try {
      return await this.db
        .select({
          stripeDisputeId: disputes.stripeDisputeId,
          status: disputes.status,
          outcomeAppliedAt: disputes.outcomeAppliedAt,
        })
        .from(disputes)
        .where(inArray(disputes.stripeDisputeId, stripeDisputeIds));
    } catch (error) {
      this.handleError(error, 'findDisputeRecords');
    }
  }

  /**
   * How many clawback steps this dispute wrote, of any kind or status. A
   * `prevented` dispute should have none (Codex-2hxff.59 item 5).
   */
  async countDisputeReversalSteps(stripeDisputeId: string): Promise<number> {
    try {
      const [row] = await this.db
        .select({ steps: count() })
        .from(payoutReversals)
        .where(
          and(
            eq(payoutReversals.causeType, 'dispute'),
            eq(payoutReversals.causeId, stripeDisputeId)
          )
        );
      return row?.steps ?? 0;
    } catch (error) {
      this.handleError(error, 'countDisputeReversalSteps');
    }
  }

  /**
   * Verify Stripe checkout session status
   *
   * Queries Stripe API for session details and checks for completed purchase.
   * Used by success page to show purchase confirmation.
   *
   * Stripe API Best Practices (2025):
   * - Use stripe.checkout.sessions.retrieve() with session ID
   * - Session.status can be: 'open' | 'complete' | 'expired'
   * - Session.payment_intent contains payment intent ID when complete
   * - Session.metadata.customer_id contains our customerId (set during createCheckoutSession)
   * - Handle StripeInvalidRequestError for invalid session IDs (404)
   *
   * Security:
   * - Validates session belongs to authenticated user (metadata.customer_id)
   * - Returns 403 if session exists but belongs to different user
   *
   * @param sessionId - Stripe checkout session ID (cs_xxx format)
   * @param customerId - Authenticated user ID (for ownership check)
   * @returns Session status with optional purchase and content details
   * @throws {PaymentProcessingError} If Stripe API fails
   * @throws {ForbiddenError} If session belongs to different user
   *
   * @example
   * const result = await purchaseService.verifyCheckoutSession('cs_xxx', 'user-123');
   * // Returns: { sessionStatus: 'complete', purchase: {...}, content: {...} }
   */
  async verifyCheckoutSession(
    sessionId: string,
    customerId: string
  ): Promise<CheckoutSessionVerifyResult> {
    try {
      // Query Stripe API for session details
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      // Verify session belongs to user (metadata.customerId)
      // Note: We set customerId in metadata during createCheckoutSession (line 227)
      if (session.metadata?.customerId !== customerId) {
        throw new ForbiddenError(
          'Checkout session does not belong to authenticated user',
          {
            sessionId,
          }
        );
      }

      const result: CheckoutSessionVerifyResult = {
        // Stripe API may return null for status, default to 'open' for safety
        sessionStatus:
          (session.status as 'complete' | 'expired' | 'open') ?? 'open',
      };

      // If payment complete, query purchase record with content join
      // payment_intent is only present when session status is 'complete'
      if (result.sessionStatus === 'complete' && session.payment_intent) {
        const purchase = await this.db.query.purchases.findFirst({
          where: and(
            eq(
              purchases.stripePaymentIntentId,
              session.payment_intent as string
            ),
            eq(purchases.customerId, customerId)
          ),
          with: {
            content: {
              columns: {
                id: true,
                title: true,
                thumbnailUrl: true,
                contentType: true,
              },
            },
            course: { columns: { id: true, title: true } },
          },
        });

        // A second payment for an item the buyer owns: the page says it is
        // being refunded rather than confirming a purchase (Codex-o4jvw).
        if (purchase && isDuplicatePayment(purchase)) {
          result.duplicatePayment = true;
        }

        // Course-purchase sessions populate the course block only: the
        // journey success page needs to know our row exists, not a receipt.
        if (purchase?.course) {
          result.course = {
            id: purchase.course.id,
            title: purchase.course.title,
          };
        }

        // Content-purchase sessions populate the purchase + content blocks.
        if (purchase?.purchasedAt && purchase.content) {
          result.purchase = {
            id: purchase.id,
            contentId: purchase.content.id,
            amountPaidCents: purchase.amountPaidCents,
            purchasedAt: purchase.purchasedAt.toISOString(),
          };
          result.content = {
            id: purchase.content.id,
            title: purchase.content.title,
            thumbnailUrl: purchase.content.thumbnailUrl ?? undefined,
            contentType: purchase.content.contentType,
          };
        }
      }

      return result;
    } catch (error) {
      // Re-throw ForbiddenError
      if (error instanceof ForbiddenError) {
        throw error;
      }

      // Stripe-specific error handling (2025 patterns)
      // StripeInvalidRequestError: Invalid session ID (404)
      // StripeConnectionError: Network failure (500)
      // StripeAPIError: Other Stripe errors
      // Stripe's own message is logged, never sent (SEC-02). A session id
      // Stripe does not know came from the client (a stale or invented
      // success URL), so it is a warning; an outage or API failure is an
      // error.
      if (isStripeError(error)) {
        const notFound = error.type === 'StripeInvalidRequestError';
        const message = notFound
          ? 'Checkout session not found'
          : error.type === 'StripeConnectionError'
            ? 'Failed to connect to Stripe API'
            : 'Failed to verify checkout session';
        throw new PaymentProcessingError(message, {
          sessionId,
          errorId: this.logStripeFailure(
            `Stripe checkout session verify failed: ${message}`,
            error,
            { sessionId, customerId },
            notFound ? 'warn' : 'error'
          ),
        });
      }

      this.handleError(error, 'verifyCheckoutSession');
    }
  }

  /**
   * Create Stripe Billing Portal session
   *
   * Allows customers to manage their billing (view invoices, update payment
   * methods) — and nothing else. Every session passes the locked portal
   * configuration, so a subscription can only be cancelled, switched or paused
   * in our own UI and our database and Stripe never disagree about it
   * (docs/payments/subscriptions.md → Billing portal). Delegates Customer resolution to `resolveOrCreateCustomer`
   * (Codex-49gev) so portal sessions open the SAME `cus_...` the user's
   * checkout sessions use — one Stripe Customer per Codex user across every
   * org (Codex-pkqxd / Codex-ssfes).
   *
   * @param email - Customer's email address (still required for first-time
   *   resolution when users.stripe_customer_id is NULL)
   * @param userId - Codex user ID (used for lookup + idempotency key)
   * @param returnUrl - URL to redirect to after portal session
   * @returns Portal session URL
   * @throws {StripeNotConfiguredError} If no portal configuration is set —
   *   never open the account-default portal, which allows cancelling.
   * @throws {NotFoundError} If the Codex user row is missing/soft-deleted.
   * @throws {PaymentProcessingError} If Stripe portal session creation fails.
   */
  async createPortalSession(
    email: string,
    userId: string,
    returnUrl: string
  ): Promise<{ url: string }> {
    const validated = createPortalSessionSchema.parse({ returnUrl });

    const configuration = this.portalConfigurationId;
    if (!configuration) {
      // The client gets the generic STRIPE_NOT_CONFIGURED message; the operator
      // gets the binding name here.
      this.obs.error(
        'STRIPE_PORTAL_CONFIGURATION_ID is not set; refusing to open the default (unlocked) billing portal',
        { userId }
      );
      throw new StripeNotConfiguredError();
    }

    try {
      // Resolve the unified Customer id (cached on the user row, reused by
      // every checkout + portal across every org) and self-heal if the cache
      // is stale. NotFoundError and PaymentProcessingError from the
      // resolution step propagate untouched — the catch below only wraps
      // raw Stripe errors from billingPortal.sessions.create.
      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe, obs: this.obs },
        { userId, email, environment: this.environment },
        (stripeCustomerId) =>
          this.stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: validated.returnUrl,
            configuration,
          }),
        {
          onStaleRecovery: (info) =>
            this.obs.warn(
              'Stale users.stripe_customer_id detected; clearing and retrying',
              { ...info }
            ),
        }
      );

      return { url: session.url };
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof PaymentProcessingError
      ) {
        throw error;
      }

      if (isStripeError(error)) {
        throw new PaymentProcessingError(
          'Failed to create billing portal session',
          {
            userId,
            errorId: this.logStripeFailure(
              'Stripe failed to create a billing portal session',
              error,
              { userId }
            ),
          }
        );
      }

      this.handleError(error, 'createPortalSession');
    }
  }

  /**
   * List sales for an organization (studio Sales ledger).
   *
   * Inverse of `getPurchaseHistory` (which is customer-scoped). Returns every
   * purchase that landed on `orgId` with `customer` + `content` joined and
   * flattened into a `SaleListItem` shape suitable for direct table render.
   *
   * Composite index `idx_purchases_org_status_purchased` covers the common
   * (orgId, status, purchasedAt) access pattern; date-range filters use the
   * `idx_purchases_org_status_created` fallback when only `createdAt` is
   * meaningful (pending rows have no `purchasedAt`).
   */
  async listSales(
    orgId: string,
    filters: SalesQueryInput
  ): Promise<PaginatedListResponse<SaleListItem>> {
    const validated = salesQuerySchema.parse(filters);

    try {
      return await this.querySalesLedger(
        [eq(purchases.organizationId, orgId)],
        validated
      );
    } catch (error) {
      this.handleError(error, 'listSales');
    }
  }

  /**
   * List a solo creator's own sales: their content sold outside any
   * organisation (Codex-2hxff.21). The same rows, filters and shape as
   * {@link listSales}, so the creator's Sales page reuses the org page's code.
   */
  async listMySales(
    creatorId: string,
    filters: SalesQueryInput
  ): Promise<PaginatedListResponse<SaleListItem>> {
    const validated = salesQuerySchema.parse(filters);

    try {
      return await this.querySalesLedger(
        this.soloSalesScope(creatorId),
        validated
      );
    } catch (error) {
      this.handleError(error, 'listMySales');
    }
  }

  /**
   * Aggregate KPIs for the studio Sales ledger header tiles.
   *
   * Single round-trip SUM aggregation scoped to `orgId` + optional date
   * window. Returns pence (GBP) for `*Cents` fields and an integer `count`
   * of *completed* sales rows (refunded rows still contribute to `grossCents`
   * but not to `count` — `count` is the headline "sales made" number).
   *
   * Net is org-perspective: `creatorPayoutCents + organizationFeeCents`. The
   * frontend labels this "your share". Platform fee is intentionally excluded
   * — that's the platform's cut, not the org's.
   */
  async getSalesStats(
    orgId: string,
    filters: SalesStatsQueryInput
  ): Promise<SalesStats> {
    const validated = salesStatsQuerySchema.parse(filters);

    try {
      return await this.aggregateSalesStats(
        [eq(purchases.organizationId, orgId)],
        validated
      );
    } catch (error) {
      this.handleError(error, 'getSalesStats');
    }
  }

  /**
   * The header KPIs for a solo creator's own sales, under the scope of
   * {@link listMySales}. An orgless sale has no organisation fee, so the net
   * is the creator's payout.
   */
  async getMySalesStats(
    creatorId: string,
    filters: SalesStatsQueryInput
  ): Promise<SalesStats> {
    const validated = salesStatsQuerySchema.parse(filters);

    try {
      return await this.aggregateSalesStats(
        this.soloSalesScope(creatorId),
        validated
      );
    } catch (error) {
      this.handleError(error, 'getMySalesStats');
    }
  }

  /**
   * Which purchases are a solo creator's sales: orgless, and of content they
   * created. `organization_id IS NULL` is what keeps an organisation's sale of
   * the same creator's content out — that sale is on the organisation's ledger.
   */
  private soloSalesScope(creatorId: string): SQL[] {
    return [
      isNull(purchases.organizationId),
      inArray(
        purchases.contentId,
        this.db
          .select({ id: content.id })
          .from(content)
          .where(eq(content.creatorId, creatorId))
      ),
    ];
  }

  /**
   * The Sales ledger rows under one seller's `scope`: an organisation's, or a
   * solo creator's. Shared by {@link listSales} and {@link listMySales}, so
   * the filters, ordering and row shape cannot drift apart.
   *
   * `status: 'disputed'` is a query convenience — it's not a DB status, so we
   * map it to `disputedAt IS NOT NULL` regardless of the underlying status
   * (a row can be both completed AND disputed).
   */
  private async querySalesLedger(
    scope: SQL[],
    validated: SalesQueryInput
  ): Promise<PaginatedListResponse<SaleListItem>> {
    // Codex-2pryk WP-6: the Sales ledger's SaleListItem shape is content-
    // shaped (contentTitle/contentSlug). Scope to content purchases so the
    // `content` join is always present; course sales get their own reporting
    // surface (WP-7) rather than being force-fit into the content columns.
    // A duplicate payment is no sale: it is refunded and pays no one
    // (Codex-2hxff.14).
    const conditions = [
      ...scope,
      isNotNull(purchases.contentId),
      isNull(purchases.duplicateOfPurchaseId),
    ];

    if (validated.status === 'disputed') {
      conditions.push(isNotNull(purchases.disputedAt));
    } else if (validated.status) {
      conditions.push(eq(purchases.status, validated.status));
    }

    if (validated.contentId) {
      conditions.push(eq(purchases.contentId, validated.contentId));
    }
    if (validated.customerId) {
      conditions.push(eq(purchases.customerId, validated.customerId));
    }

    // Date range applies to `purchasedAt` for completed rows. We OR against
    // `createdAt` so pending/failed rows (which never set `purchasedAt`)
    // still surface inside the window — useful for support triage where the
    // operator is looking for a row by the date the customer attempted to pay.
    conditions.push(
      ...purchaseDateWindow(validated.fromDate, validated.toDate)
    );

    const { limit, offset } = withPagination({
      page: validated.page,
      limit: validated.limit,
    });

    const [items, countResult] = await Promise.all([
      this.db.query.purchases.findMany({
        where: and(...conditions),
        limit,
        offset,
        // Completed rows sort by purchasedAt; pending/failed rows fall back
        // to createdAt via coalesce so the most-recent row is always first.
        orderBy: [
          desc(sql`COALESCE(${purchases.purchasedAt}, ${purchases.createdAt})`),
        ],
        with: {
          content: {
            columns: { id: true, title: true, slug: true },
          },
          customer: {
            columns: { id: true, name: true, email: true },
          },
        },
      }),
      this.db
        .select({ total: count() })
        .from(purchases)
        .where(and(...conditions)),
    ]);
    const total = countResult[0]?.total ?? 0;

    // `content` is guaranteed present (conditions filter contentId NOT NULL);
    // the type predicate narrows the relation to non-null without an `as` cast.
    const formatted: SaleListItem[] = items
      .filter(
        (p): p is typeof p & { content: NonNullable<typeof p.content> } =>
          p.content !== null
      )
      .map((p) => ({
        id: p.id,
        purchasedAt: toIso(p.purchasedAt),
        createdAt: toIso(p.createdAt),
        customerId: p.customerId,
        customerName: p.customer.name,
        customerEmail: p.customer.email,
        contentId: p.content.id,
        contentTitle: p.content.title,
        contentSlug: p.content.slug,
        amountPaidCents: p.amountPaidCents,
        currency: p.currency,
        status: coercePurchaseStatus(p.status) as SaleListItem['status'],
        platformFeeCents: p.platformFeeCents,
        organizationFeeCents: p.organizationFeeCents,
        creatorPayoutCents: p.creatorPayoutCents,
        refundedAt: toIso(p.refundedAt),
        refundAmountCents: p.refundAmountCents,
        refundReason: p.refundReason,
        disputedAt: toIso(p.disputedAt),
        disputeReason: p.disputeReason,
        stripePaymentIntentId: p.stripePaymentIntentId,
      }));

    return {
      items: formatted,
      pagination: {
        page: validated.page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * The Sales header KPIs under one seller's `scope`. Shared by
   * {@link getSalesStats} and {@link getMySalesStats}.
   */
  private async aggregateSalesStats(
    scope: SQL[],
    validated: SalesStatsQueryInput
  ): Promise<SalesStats> {
    // Content-only, to match the ledger (course sales report separately, WP-7)
    // so the header tiles and the table below them agree. Duplicate payments
    // are excluded there too: refunded, they would inflate gross and refunds.
    const conditions = [
      ...scope,
      isNotNull(purchases.contentId),
      isNull(purchases.duplicateOfPurchaseId),
      ...purchaseDateWindow(validated.fromDate, validated.toDate),
    ];

    const [agg] = await this.db
      .select({
        // Gross: amount collected on completed OR refunded rows (refunded
        // rows reflect money that *was* collected before being given back).
        grossCents: sql<number>`COALESCE(SUM(${purchases.amountPaidCents}) FILTER (WHERE ${purchases.status} IN ('completed','refunded')), 0)::int`,
        // Net to the seller: their share on completed rows only. Refunded rows
        // already returned the customer's money so they zero out for net.
        netCents: sql<number>`COALESCE(SUM(${purchases.creatorPayoutCents} + ${purchases.organizationFeeCents}) FILTER (WHERE ${purchases.status} = 'completed'), 0)::int`,
        // Partial refunds too: they leave the purchase completed (P-1).
        refundedCents: sql<number>`COALESCE(SUM(${purchases.refundAmountCents}), 0)::int`,
        count: sql<number>`COUNT(*) FILTER (WHERE ${purchases.status} = 'completed')::int`,
      })
      .from(purchases)
      .where(and(...conditions));

    return {
      grossCents: agg?.grossCents ?? 0,
      netCents: agg?.netCents ?? 0,
      refundedCents: agg?.refundedCents ?? 0,
      count: agg?.count ?? 0,
      currency: CURRENCY.GBP,
    };
  }
}
