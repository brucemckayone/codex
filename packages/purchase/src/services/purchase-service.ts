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
  CONTENT_STATUS,
  CURRENCY,
  PURCHASE_STATUS,
} from '@codex/constants';
import { isUniqueViolation, toIso } from '@codex/database';
import {
  content,
  contentAccess,
  payouts,
  purchases,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type {
  CreateCheckoutInput,
  PurchaseQueryInput,
  SalesQueryInput,
  SalesStatsQueryInput,
} from '@codex/validation';
import {
  createCheckoutSchema,
  createPortalSessionSchema,
  extractPlainText,
  getPurchaseSchema,
  purchaseQuerySchema,
  salesQuerySchema,
  salesStatsQuerySchema,
} from '@codex/validation';
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  ForbiddenError,
  NotFoundError,
  PaymentProcessingError,
  PurchaseNotFoundError,
} from '../errors';
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

import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CheckoutSessionResult,
  CheckoutSessionVerifyResult,
  CompletePurchaseMetadata,
  Purchase,
  PurchaseListItem,
  PurchaseWithContent,
  SaleListItem,
  SalesStats,
} from '../types';
import type { FeeConfigService } from './fee-config-service';
import {
  applyMinPlatformFeeFloor,
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
} from './revenue-calculator';

/**
 * Configuration for `PurchaseService`.
 *
 * Adds optional `feeConfig` (Codex-m644n) so the one-off purchase flow can
 * resolve DB-configurable fees via the 3-tier fallback chain. When absent,
 * the service uses the `DEFAULT_*` constants — bit-for-bit pre-Codex-m644n
 * behaviour (covered by existing tests).
 */
interface PurchaseServiceConfig extends ServiceConfig {
  feeConfig?: FeeConfigService;
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

function coercePurchaseStatus(s: string): PurchaseListStatus {
  return (PURCHASE_LIST_STATUSES as readonly string[]).includes(s)
    ? (s as PurchaseListStatus)
    : PURCHASE_STATUS.PENDING;
}

/**
 * Purchase Service Class
 *
 * Handles purchase operations with Stripe integration.
 */
export class PurchaseService extends BaseService {
  private readonly stripe: Stripe;
  private readonly feeConfig: FeeConfigService | undefined;

  /**
   * Initialize purchase service
   *
   * @param config - Service configuration (db, environment, optional feeConfig)
   * @param stripe - Stripe client instance
   */
  constructor(config: PurchaseServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.feeConfig = config.feeConfig;
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

      // Phase 1: Paid content must belong to an organization
      if (contentRecord.organizationId == null) {
        throw new ContentNotPurchasableError(
          validated.contentId,
          'not_published',
          {
            reason:
              'Content must belong to an organization to be purchasable (Phase 1)',
          }
        );
      }

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

      // Step 3: Look up creator's Connect account for revenue transfer
      const [creatorConnect] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(
          and(
            eq(stripeConnectAccounts.userId, contentRecord.creatorId),
            eq(
              stripeConnectAccounts.organizationId,
              contentRecord.organizationId!
            )
          )
        )
        .limit(1);

      // Application fee for the destination charge MUST cover the platform
      // slice AND the org slice (Codex-h69cg). Stripe routes
      // `charge.amount - application_fee_amount` directly to the creator's
      // Connect account; the remainder lands in the platform's balance.
      // From that platform balance we make a SECOND `transfers.create` to
      // the org (in `writePurchasePayouts`) — that transfer is NOT linked
      // to the charge via `source_transaction` because the destination-
      // charge mechanism has already scheduled all non-application-fee
      // funds for transfer to the creator. Allocating the org's share via
      // a separate `transfers.create` from the platform's general balance
      // is the only correct shape.
      const splitForFee = creatorConnect?.chargesEnabled
        ? calculateRevenueSplit(
            contentRecord.priceCents,
            DEFAULT_PLATFORM_FEE_PERCENTAGE,
            DEFAULT_ORG_FEE_PERCENTAGE
          )
        : undefined;
      const applicationFeeCents = splitForFee
        ? splitForFee.platformFeeCents + splitForFee.organizationFeeCents
        : undefined;

      if (!creatorConnect?.chargesEnabled) {
        this.obs.warn(
          'Creator Connect account not ready — purchase will proceed but revenue stays in platform account',
          {
            creatorId: contentRecord.creatorId,
            organizationId: contentRecord.organizationId,
            contentId: validated.contentId,
            connectStatus: creatorConnect?.status ?? 'missing',
          }
        );
      }

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

      // Hoist captured non-null fields BEFORE the closure. TypeScript loses
      // narrowing of property accesses (`contentRecord.priceCents`,
      // `contentRecord.organizationId`) across closure boundaries — locals
      // preserve the narrowed `number` / `string` types we already validated
      // earlier in this function.
      const priceCents = contentRecord.priceCents;
      const organizationId = contentRecord.organizationId;
      if (priceCents === null || organizationId === null) {
        // Already validated upstream; this guards the type narrowing only.
        throw new PaymentProcessingError(
          'Content missing price or organization at checkout',
          { contentId: validated.contentId }
        );
      }

      // `withStaleCustomerRecovery` resolves a customer id and self-heals
      // a stale `users.stripe_customer_id` (deleted-in-Stripe or seed-only
      // synthetic) by clearing the cache and recreating once. Same pattern
      // as `SubscriptionService.createCheckoutSession`.
      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        { userId: customerId, email: user.email },
        (resolvedCustomerId) =>
          this.stripe.checkout.sessions.create({
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
            // Destination charges: Stripe routes payment to creator, platform keeps fee
            ...(creatorConnect?.chargesEnabled &&
            applicationFeeCents !== undefined
              ? {
                  payment_intent_data: {
                    application_fee_amount: applicationFeeCents,
                    transfer_data: {
                      destination: creatorConnect.stripeAccountId,
                    },
                  },
                }
              : {}),
            success_url: validated.successUrl,
            cancel_url: validated.cancelUrl,
            metadata: {
              contentId: validated.contentId,
              customerId,
              organizationId,
              creatorId: contentRecord.creatorId,
              contentTitle: contentRecord.title,
            },
            client_reference_id: customerId,
          }),
        {
          onStaleRecovery: (info) =>
            this.obs.warn(
              'Stale users.stripe_customer_id detected; clearing and retrying',
              { ...info, contentId: validated.contentId }
            ),
        }
      );

      if (!session.url) {
        throw new PaymentProcessingError('Checkout session URL not generated', {
          sessionId: session.id,
        });
      }

      return {
        sessionUrl: session.url,
        sessionId: session.id,
      };
    } catch (error) {
      if (
        error instanceof ContentNotPurchasableError ||
        error instanceof AlreadyPurchasedError ||
        error instanceof NotFoundError ||
        error instanceof PaymentProcessingError
      ) {
        throw error;
      }

      // Wrap Stripe errors
      if (isStripeError(error)) {
        throw new PaymentProcessingError('Failed to create checkout session', {
          stripeError: error.message,
          contentId: validated.contentId,
        });
      }

      this.handleError(error, 'createCheckoutSession');
    }
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
   * - Sets status='completed' and purchasedAt=now
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
      const txResult = await this.db.transaction(async (tx) => {
        // Step 1: Check for existing purchase (idempotency)
        const existing = await tx.query.purchases.findFirst({
          where: eq(purchases.stripePaymentIntentId, stripePaymentIntentId),
        });

        if (existing) {
          // Already processed - return existing; skip payouts work since the
          // first-write path already attempted it (idempotency on transfers
          // is provided by the deterministic `${chargeId}_org_fee` key).
          return { purchase: existing, isNew: false } as const;
        }

        // Step 2: Fetch content for org + creator scope (needed for fee resolution).
        // Codex-m644n moved this above the fee lookup so the FeeConfigService
        // fallback chain can walk creator-override → org-default → platform
        // → constants. The org/creator pair anchors all three lookups.
        const contentRecord = await tx.query.content.findFirst({
          where: eq(content.id, metadata.contentId),
          columns: { organizationId: true, creatorId: true },
        });

        if (!contentRecord) {
          throw new PaymentProcessingError(
            'Content not found during purchase completion',
            {
              contentId: metadata.contentId,
              stripePaymentIntentId,
            }
          );
        }

        const organizationId =
          metadata.organizationId ?? contentRecord.organizationId;

        // Phase 1: Personal content (organizationId = null) cannot be purchased
        if (!organizationId) {
          throw new PaymentProcessingError(
            'Personal content purchases not supported - content must belong to an organization',
            {
              contentId: metadata.contentId,
              stripePaymentIntentId,
            }
          );
        }

        // Step 3: Resolve fees via FeeConfigService when available (Codex-m644n).
        // Falls back to legacy constants when no resolver is injected — preserves
        // the pre-m644n behaviour covered by existing tests.
        const fees = this.feeConfig
          ? await this.feeConfig.getFeesForCreator(
              organizationId,
              contentRecord.creatorId,
              'one_off'
            )
          : {
              platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
              orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
              minPlatformFeeCents: 0,
              minTransferCents: 0,
            };

        // Step 4: Calculate revenue split, then apply min-platform-fee floor.
        // The floor is enforced in the caller (not in calculateRevenueSplit)
        // to keep the math pure. When (amount * pct / 10000) < minFee, we
        // override the platform component to the floor and subtract from the
        // creator pool, then from the org fee if the pool can't cover it. The
        // DB CHECK constraint `amount = platform + org + creator` is preserved
        // by construction.
        const rawSplit = calculateRevenueSplit(
          metadata.amountPaidCents,
          fees.platformFeePercent,
          fees.orgFeePercent
        );
        const revenueSplit = applyMinPlatformFeeFloor(
          metadata.amountPaidCents,
          rawSplit,
          fees.minPlatformFeeCents
        );

        // Step 4a: Reconcile Stripe-collected fee against calculated split.
        // If the application fee Stripe actually charged differs from what
        // calculateRevenueSplit() produces, something drifted — log but don't throw.
        if (
          metadata.stripeApplicationFeeCents != null &&
          metadata.stripeApplicationFeeCents !== revenueSplit.platformFeeCents
        ) {
          this.obs.warn(
            'Platform fee mismatch: Stripe-collected application fee differs from calculated split',
            {
              stripeApplicationFeeCents: metadata.stripeApplicationFeeCents,
              calculatedPlatformFeeCents: revenueSplit.platformFeeCents,
              amountPaidCents: metadata.amountPaidCents,
              stripePaymentIntentId,
              contentId: metadata.contentId,
            }
          );
        }

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
            status: PURCHASE_STATUS.COMPLETED,
            purchasedAt: new Date(),
            platformFeeCents: revenueSplit.platformFeeCents,
            organizationFeeCents: revenueSplit.organizationFeeCents,
            creatorPayoutCents: revenueSplit.creatorPayoutCents,
            // Phase 1: No agreement IDs (using defaults)
            platformAgreementId: null,
            creatorOrgAgreementId: null,
          })
          .returning();

        if (!purchase) {
          throw new PaymentProcessingError('Failed to create purchase record', {
            stripePaymentIntentId,
          });
        }

        // Step 5: Grant content access atomically (upsert handles re-purchase after refund)
        await tx
          .insert(contentAccess)
          .values({
            userId: metadata.customerId,
            contentId: metadata.contentId,
            organizationId: organizationId, // Use same fetched value
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

        return {
          purchase,
          isNew: true,
          revenueSplit,
          creatorId: contentRecord.creatorId,
          organizationId,
        } as const;
      });

      // Step 6 (post-commit): write tri-party payouts ledger rows and execute
      // the secondary org-fee transfer. Out-of-transaction so a Stripe API
      // failure can't roll back the purchase + access grant. On a webhook
      // replay (`isNew: false`) we skip — the first-write path already ran,
      // and Stripe idempotency keys protect the transfer side either way.
      if (txResult.isNew && metadata.stripeChargeId) {
        await this.writePurchasePayouts({
          purchase: txResult.purchase,
          revenueSplit: txResult.revenueSplit,
          creatorId: txResult.creatorId,
          organizationId: txResult.organizationId,
          stripeChargeId: metadata.stripeChargeId,
        });
      } else if (txResult.isNew && !metadata.stripeChargeId) {
        this.obs.warn(
          'Purchase completed without stripeChargeId — payouts ledger entries skipped',
          {
            purchaseId: txResult.purchase.id,
            stripePaymentIntentId,
          }
        );
      }

      return txResult.purchase;
    } catch (error) {
      this.obs.error('Failed to complete purchase', {
        error: error instanceof Error ? error.message : String(error),
        stripePaymentIntentId,
        customerId: metadata.customerId,
        contentId: metadata.contentId,
        amountPaidCents: metadata.amountPaidCents,
      });
      this.handleError(error, 'completePurchase');
    }
  }

  /**
   * Write tri-party payouts ledger rows for a freshly-completed purchase and
   * execute the secondary organization-fee transfer (Option A hybrid model).
   *
   * - `platform_fee`: status='paid' immediately; the platform retains its
   *   slice via `application_fee_amount` on the destination charge — no
   *   transfer call needed. `stripeChargeId` satisfies the paid invariant.
   * - `creator_payout`: status='paid' immediately; the destination charge
   *   already routed creator funds at charge time. `stripeChargeId` satisfies
   *   the paid invariant (no `stripeTransferId` for destination charges).
   * - `organization_fee`: requires a follow-up `transfers.create` pulling
   *   from the creator's destination-charged balance via `source_transaction`.
   *   On success: status='paid' with `stripeTransferId`. On Connect-not-ready:
   *   status='pending' with reason='connect_not_ready' for sweep to retry.
   *   On Stripe failure: status='failed' with reason='transfer_failed'.
   *
   * Per-row error isolation: a failure in any one branch logs + continues so
   * one bad insert never poisons the rest of the ledger writes. Mirrors the
   * pattern enforced for subscription executeTransfers (Codex-vv77x).
   */
  private async writePurchasePayouts(params: {
    purchase: Purchase;
    revenueSplit: {
      platformFeeCents: number;
      organizationFeeCents: number;
      creatorPayoutCents: number;
    };
    creatorId: string;
    organizationId: string;
    stripeChargeId: string;
  }): Promise<void> {
    const {
      purchase,
      revenueSplit,
      creatorId,
      organizationId,
      stripeChargeId,
    } = params;
    const transferGroup = `purchase_${purchase.id}`;
    const now = new Date();

    // 1. Platform fee — retained via application_fee_amount, no transfer call.
    if (revenueSplit.platformFeeCents > 0) {
      try {
        await this.db.insert(payouts).values({
          userId: null,
          organizationId,
          purchaseId: purchase.id,
          amountCents: revenueSplit.platformFeeCents,
          payoutType: 'platform_fee',
          status: 'paid',
          sourceType: 'purchase',
          stripeChargeId,
          transferGroup,
          resolvedAt: now,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          this.obs.error('Failed to insert platform_fee payout row', {
            purchaseId: purchase.id,
            stripeChargeId,
            amountCents: revenueSplit.platformFeeCents,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 2. Creator payout — destination charge already moved money.
    if (revenueSplit.creatorPayoutCents > 0) {
      try {
        await this.db.insert(payouts).values({
          userId: creatorId,
          organizationId,
          purchaseId: purchase.id,
          amountCents: revenueSplit.creatorPayoutCents,
          payoutType: 'creator_payout',
          status: 'paid',
          sourceType: 'purchase',
          stripeChargeId,
          transferGroup,
          resolvedAt: now,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          this.obs.error('Failed to insert creator_payout payout row', {
            purchaseId: purchase.id,
            creatorId,
            stripeChargeId,
            amountCents: revenueSplit.creatorPayoutCents,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 3. Organization fee — requires a secondary transfer (Option A hybrid).
    if (revenueSplit.organizationFeeCents <= 0) {
      return;
    }

    const [orgConnect] = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.organizationId, organizationId))
      .limit(1);

    if (!orgConnect?.chargesEnabled) {
      try {
        await this.db.insert(payouts).values({
          userId: orgConnect?.userId ?? null,
          organizationId,
          purchaseId: purchase.id,
          amountCents: revenueSplit.organizationFeeCents,
          payoutType: 'organization_fee',
          status: 'pending',
          sourceType: 'purchase',
          reason: 'connect_not_ready',
          stripeChargeId,
          transferGroup,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          this.obs.error(
            'Failed to record pending org_fee payout (connect_not_ready)',
            {
              purchaseId: purchase.id,
              organizationId,
              amountCents: revenueSplit.organizationFeeCents,
              error: err instanceof Error ? err.message : String(err),
            }
          );
        }
      }
      return;
    }

    try {
      // `source_transaction` is REQUIRED here: the destination charge's
      // funds sit in the platform's pending balance until `available_on`
      // (~T+2 for GBP). Without source_transaction the transfer pulls from
      // available balance and fails with "insufficient funds" until that
      // window passes. source_transaction bypasses the wait by linking
      // the transfer to the application_fee_amount allocation against the
      // charge — which we inflated in `createCheckoutSession` to cover
      // platform + org slices.
      //
      // `transfer_group` is OMITTED on purpose: destination charges auto-
      // set their own transfer_group for the creator-bound auto-transfer,
      // and Stripe rejects passing both source_transaction and a custom
      // transfer_group together with `"You cannot use transfer_group if
      // the source_transaction already has one set."`. The charge id
      // remains traceable via metadata.stripe_charge_id and the row's
      // own `stripeChargeId` column.
      const transfer = await this.stripe.transfers.create(
        {
          amount: revenueSplit.organizationFeeCents,
          currency: CURRENCY.GBP,
          destination: orgConnect.stripeAccountId,
          source_transaction: stripeChargeId,
          metadata: {
            purchase_id: purchase.id,
            type: 'organization_fee',
            stripe_charge_id: stripeChargeId,
          },
        },
        { idempotencyKey: `${stripeChargeId}_org_fee` }
      );
      try {
        await this.db.insert(payouts).values({
          userId: orgConnect.userId,
          organizationId,
          purchaseId: purchase.id,
          amountCents: revenueSplit.organizationFeeCents,
          payoutType: 'organization_fee',
          status: 'paid',
          sourceType: 'purchase',
          stripeTransferId: transfer.id,
          stripeChargeId,
          transferGroup,
          resolvedAt: now,
        });
      } catch (insertErr) {
        if (!isUniqueViolation(insertErr)) {
          this.obs.error(
            'Org-fee transfer succeeded but payouts ledger insert failed',
            {
              purchaseId: purchase.id,
              organizationId,
              stripeTransferId: transfer.id,
              amountCents: revenueSplit.organizationFeeCents,
              error:
                insertErr instanceof Error
                  ? insertErr.message
                  : String(insertErr),
            }
          );
        }
      }
    } catch (transferErr) {
      this.obs.error('Org-fee transfer failed', {
        purchaseId: purchase.id,
        organizationId,
        amountCents: revenueSplit.organizationFeeCents,
        error:
          transferErr instanceof Error
            ? transferErr.message
            : String(transferErr),
      });
      try {
        await this.db.insert(payouts).values({
          userId: orgConnect.userId,
          organizationId,
          purchaseId: purchase.id,
          amountCents: revenueSplit.organizationFeeCents,
          payoutType: 'organization_fee',
          status: 'failed',
          sourceType: 'purchase',
          reason: 'transfer_failed',
        });
      } catch (insertErr) {
        if (!isUniqueViolation(insertErr)) {
          this.obs.error('Failed to record failed org_fee payout row', {
            purchaseId: purchase.id,
            organizationId,
            amountCents: revenueSplit.organizationFeeCents,
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
   * - Join with content for details
   * - Sort by purchasedAt DESC
   *
   * @param customerId - Customer ID
   * @param filters - Query filters
   * @returns Paginated purchase history with content details
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
  ): Promise<PaginatedListResponse<PurchaseWithContent>> {
    const validated = purchaseQuerySchema.parse(filters);

    try {
      // Build WHERE conditions
      const conditions = [eq(purchases.customerId, customerId)];

      if (validated.status) {
        conditions.push(eq(purchases.status, validated.status));
      }

      if (validated.contentId) {
        conditions.push(eq(purchases.contentId, validated.contentId));
      }

      // Calculate offset
      const offset = (validated.page - 1) * validated.limit;

      // Run paginated SELECT and COUNT in parallel to cut one DB round-trip
      const [items, countResult] = await Promise.all([
        this.db.query.purchases.findMany({
          where: and(...conditions),
          limit: validated.limit,
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
          },
        }),
        this.db
          .select({ total: count() })
          .from(purchases)
          .where(and(...conditions)),
      ]);
      const total = countResult[0]?.total ?? 0;

      return {
        items: items as PurchaseWithContent[],
        pagination: {
          page: validated.page,
          limit: validated.limit,
          total,
          totalPages: Math.ceil(total / validated.limit),
        },
      };
    } catch (error) {
      this.handleError(error, 'getPurchaseHistory');
    }
  }

  /**
   * Format purchase history for client consumption
   *
   * Maps raw PurchaseWithContent records into PurchaseListItem DTOs
   * with validated status values and ISO date strings.
   *
   * @param result - Raw purchase history from getPurchaseHistory()
   * @returns Paginated response with formatted PurchaseListItem items
   */
  formatPurchasesForClient(
    result: PaginatedListResponse<PurchaseWithContent>
  ): PaginatedListResponse<PurchaseListItem> {
    return {
      items: result.items.map(
        (p): PurchaseListItem => ({
          id: p.id,
          customerId: p.customerId,
          createdAt: toIso(p.createdAt),
          contentId: p.contentId,
          contentTitle: p.content.title,
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
   * Process a refund from a charge.refunded webhook event.
   *
   * Flow:
   * 1. Look up purchase by stripePaymentIntentId
   * 2. Update purchase status to 'refunded'
   * 3. Revoke content access (soft delete)
   *
   * Idempotent: If purchase is already refunded, this is a no-op.
   */
  async processRefund(
    paymentIntentId: string,
    refundDetails?: {
      stripeRefundId?: string;
      refundAmountCents?: number;
      refundReason?: string;
    }
  ): Promise<{ userId: string } | void> {
    try {
      const purchase = await this.db.query.purchases.findFirst({
        where: eq(purchases.stripePaymentIntentId, paymentIntentId),
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
        return { userId: purchase.customerId };
      }

      // Atomically update purchase status AND revoke content access
      await this.db.transaction(async (tx) => {
        // Update purchase status to refunded with tracking fields
        await tx
          .update(purchases)
          .set({
            status: PURCHASE_STATUS.REFUNDED,
            updatedAt: new Date(),
            refundedAt: new Date(),
            refundAmountCents: refundDetails?.refundAmountCents ?? null,
            stripeRefundId: refundDetails?.stripeRefundId ?? null,
            refundReason: refundDetails?.refundReason ?? null,
          })
          .where(eq(purchases.id, purchase.id));

        // Revoke content access (soft delete)
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
      });

      // Step: reverse payouts ledger rows + the org-fee transfer (Codex-h69cg).
      // Out-of-transaction because it talks to Stripe; per-row error isolation
      // so one bad reversal can never block the refund acknowledgement (Stripe
      // would retry the webhook, but the refund itself has already been
      // recorded on the purchases row above).
      await this.reversePayoutsForPurchase(purchase.id);

      this.obs.info('Refund processed', {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        customerId: purchase.customerId,
        paymentIntentId,
      });

      // Return the purchaser's userId so the webhook route can bump
      // COLLECTION_USER_LIBRARY — refunded content disappears from the
      // user's library on their next fetch. No orgId: one-time purchases
      // are content-scoped, not org-scoped, so only the library cache bumps.
      return { userId: purchase.customerId };
    } catch (error) {
      this.handleError(error, 'processRefund');
    }
  }

  /**
   * Reverse the payouts ledger rows + secondary org-fee transfer for a
   * refunded purchase.
   *
   * - Destination-charge legs (`platform_fee`, `creator_payout`): the actual
   *   money movement is auto-reversed by Stripe when `refunds.create` runs
   *   against the source charge (with default settings). We mark these rows
   *   `status='reversed'` so the ledger reflects reality.
   * - Secondary `organization_fee` transfer: not auto-reversed by Stripe (it
   *   was a separate `transfers.create` call). Issue `transfers.createReversal`
   *   for each row with a `stripeTransferId`, with a deterministic idempotency
   *   key so webhook replays are safe.
   *
   * Idempotent: rows already at `status='reversed'` are no-ops.
   */
  private async reversePayoutsForPurchase(purchaseId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, purchaseId));

    if (rows.length === 0) return;

    for (const row of rows) {
      if (row.status === 'reversed') continue;

      // Reverse the Stripe transfer when one exists. Only `organization_fee`
      // rows from the secondary transfer carry `stripeTransferId` on the
      // purchase pipeline; destination-charge legs do not.
      if (row.stripeTransferId) {
        try {
          await this.stripe.transfers.createReversal(
            row.stripeTransferId,
            {
              amount: row.amountCents,
              metadata: {
                purchase_id: purchaseId,
                payout_id: row.id,
                type: 'refund_reversal',
              },
            },
            { idempotencyKey: `${row.stripeTransferId}_reversal` }
          );
        } catch (reverseErr) {
          this.obs.error('Failed to reverse Stripe transfer for refund', {
            purchaseId,
            payoutId: row.id,
            stripeTransferId: row.stripeTransferId,
            error:
              reverseErr instanceof Error
                ? reverseErr.message
                : String(reverseErr),
          });
          // Continue — do not block remaining row updates or the webhook ack.
        }
      }

      try {
        await this.db
          .update(payouts)
          .set({
            status: 'reversed',
            resolvedAt: row.resolvedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(payouts.id, row.id));
      } catch (updateErr) {
        this.obs.error('Failed to mark payouts row as reversed', {
          purchaseId,
          payoutId: row.id,
          error:
            updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      }
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
  ): Promise<{ userId: string; orgId: string } | void> {
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
        };
      }

      // Atomically mark the purchase as disputed AND revoke content access.
      await this.db.transaction(async (tx) => {
        await tx
          .update(purchases)
          .set({
            updatedAt: new Date(),
            disputedAt: new Date(),
            disputeReason: disputeDetails?.disputeReason ?? null,
            stripeDisputeId: disputeDetails?.stripeDisputeId ?? null,
          })
          .where(eq(purchases.id, purchase.id));

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
      });

      this.obs.info('Dispute processed', {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        customerId: purchase.customerId,
        organizationId: purchase.organizationId,
        paymentIntentId,
        stripeDisputeId: disputeDetails?.stripeDisputeId,
      });

      return {
        userId: purchase.customerId,
        orgId: purchase.organizationId,
      };
    } catch (error) {
      this.handleError(error, 'processDispute');
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
          where: eq(
            purchases.stripePaymentIntentId,
            session.payment_intent as string
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
          },
        });

        if (purchase?.purchasedAt) {
          result.purchase = {
            id: purchase.id,
            contentId: purchase.contentId,
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
      if (
        error instanceof Error &&
        'type' in error &&
        error.type === 'StripeInvalidRequestError'
      ) {
        throw new PaymentProcessingError('Checkout session not found', {
          stripeError: error.message,
          sessionId,
        });
      }

      if (
        error instanceof Error &&
        'type' in error &&
        error.type === 'StripeConnectionError'
      ) {
        throw new PaymentProcessingError('Failed to connect to Stripe API', {
          stripeError: error.message,
          sessionId,
        });
      }

      // Wrap other Stripe errors
      if (isStripeError(error)) {
        throw new PaymentProcessingError('Failed to verify checkout session', {
          stripeError: error.message,
          sessionId,
        });
      }

      this.handleError(error, 'verifyCheckoutSession');
    }
  }

  /**
   * Create Stripe Billing Portal session
   *
   * Allows customers to manage their billing (view invoices, update payment
   * methods). Delegates Customer resolution to `resolveOrCreateCustomer`
   * (Codex-49gev) so portal sessions open the SAME `cus_...` the user's
   * checkout sessions use — one Stripe Customer per Codex user across every
   * org (Codex-pkqxd / Codex-ssfes).
   *
   * @param email - Customer's email address (still required for first-time
   *   resolution when users.stripe_customer_id is NULL)
   * @param userId - Codex user ID (used for lookup + idempotency key)
   * @param returnUrl - URL to redirect to after portal session
   * @returns Portal session URL
   * @throws {NotFoundError} If the Codex user row is missing/soft-deleted.
   * @throws {PaymentProcessingError} If Stripe portal session creation fails.
   */
  async createPortalSession(
    email: string,
    userId: string,
    returnUrl: string
  ): Promise<{ url: string }> {
    const validated = createPortalSessionSchema.parse({ returnUrl });

    try {
      // Resolve the unified Customer id (cached on the user row, reused by
      // every checkout + portal across every org) and self-heal if the cache
      // is stale. NotFoundError and PaymentProcessingError from the
      // resolution step propagate untouched — the catch below only wraps
      // raw Stripe errors from billingPortal.sessions.create.
      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        { userId, email },
        (stripeCustomerId) =>
          this.stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: validated.returnUrl,
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
            stripeError: error.message,
            userId,
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
   *
   * `status: 'disputed'` is a query convenience — it's not a DB status, so we
   * map it to `disputedAt IS NOT NULL` regardless of the underlying status
   * (a row can be both completed AND disputed).
   */
  async listSales(
    orgId: string,
    filters: SalesQueryInput
  ): Promise<PaginatedListResponse<SaleListItem>> {
    const validated = salesQuerySchema.parse(filters);

    try {
      const conditions = [eq(purchases.organizationId, orgId)];

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

      const offset = (validated.page - 1) * validated.limit;

      const [items, countResult] = await Promise.all([
        this.db.query.purchases.findMany({
          where: and(...conditions),
          limit: validated.limit,
          offset,
          // Completed rows sort by purchasedAt; pending/failed rows fall back
          // to createdAt via coalesce so the most-recent row is always first.
          orderBy: [
            desc(
              sql`COALESCE(${purchases.purchasedAt}, ${purchases.createdAt})`
            ),
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

      const formatted: SaleListItem[] = items.map((p) => ({
        id: p.id,
        purchasedAt: toIso(p.purchasedAt),
        createdAt: toIso(p.createdAt),
        customerId: p.customerId,
        customerName: p.customer.name,
        customerEmail: p.customer.email,
        contentId: p.contentId,
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
          limit: validated.limit,
          total,
          totalPages: Math.ceil(total / validated.limit),
        },
      };
    } catch (error) {
      this.handleError(error, 'listSales');
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
      const conditions = [eq(purchases.organizationId, orgId)];

      conditions.push(
        ...purchaseDateWindow(validated.fromDate, validated.toDate)
      );

      const [agg] = await this.db
        .select({
          // Gross: amount collected on completed OR refunded rows (refunded
          // rows reflect money that *was* collected before being given back).
          grossCents: sql<number>`COALESCE(SUM(${purchases.amountPaidCents}) FILTER (WHERE ${purchases.status} IN ('completed','refunded')), 0)::int`,
          // Net to org: their share on completed rows only. Refunded rows
          // already returned the customer's money so they zero out for net.
          netCents: sql<number>`COALESCE(SUM(${purchases.creatorPayoutCents} + ${purchases.organizationFeeCents}) FILTER (WHERE ${purchases.status} = 'completed'), 0)::int`,
          refundedCents: sql<number>`COALESCE(SUM(${purchases.refundAmountCents}) FILTER (WHERE ${purchases.status} = 'refunded'), 0)::int`,
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
    } catch (error) {
      this.handleError(error, 'getSalesStats');
    }
  }
}
