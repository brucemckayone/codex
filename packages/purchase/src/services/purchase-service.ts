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
  stripeEnvMetadata,
} from '@codex/constants';
import { isUniqueViolation, toIso } from '@codex/database';
import {
  content,
  contentAccess,
  courses,
  entitlements,
  purchases,
  type RefundStatus,
  refunds,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  type ClawbackCharge,
  type LedgerDeps,
  listClawableRefunds,
  recordPlatformFee,
  recordSlice,
  resolveOrganisationPayee,
  reverseCharge,
} from '@codex/payments';
import {
  BaseService,
  type ServiceConfig,
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
  CourseAlreadyOwnedError,
  CourseNotPurchasableError,
  ForbiddenError,
  NotFoundError,
  PaymentProcessingError,
  PurchaseNotFoundError,
} from '../errors';
import { findActiveCreatorAgreementShare } from './agreement-share';
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

import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CheckoutSessionResult,
  CheckoutSessionVerifyResult,
  CompleteCoursePurchaseMetadata,
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
  private readonly mailer: PurchaseMailer | undefined;
  private readonly webAppUrl: string | undefined;
  private readonly portalConfigurationId: string | undefined;

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

      // `withStaleCustomerRecovery` resolves a customer id and self-heals
      // a stale `users.stripe_customer_id` (deleted-in-Stripe or seed-only
      // synthetic) by clearing the cache and recreating once. Same pattern
      // as `SubscriptionService.createCheckoutSession`.
      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        {
          userId: customerId,
          email: user.email,
          environment: this.environment,
        },
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

        // Codex-69t7c WP5: `organizationId` is legitimately nullable now.
        // Org-scoped purchases populate it (from metadata or the content row);
        // orgless creator-direct (bi-party) purchases have `null`. The Phase-1
        // "personal content cannot be purchased" throw is removed.
        const organizationId =
          metadata.organizationId ?? contentRecord.organizationId;

        // Step 3: Resolve fees via FeeConfigService when available (Codex-m644n).
        //
        // Codex-69t7c WP5: branch on org presence.
        //   - org-scoped → getFeesForCreator(orgId, creatorId) — platform leg
        //     PLUS the org's per-creator override (unchanged tri-party path).
        //   - orgless (bi-party) → getFeesPlatform() — platform-only fees; there
        //     is no organization to carve a slice for, so the org leg is forced
        //     to ZERO below regardless of any default `orgFeePercent`.
        // Falls back to legacy constants when no resolver is injected — preserves
        // the pre-m644n behaviour covered by existing tests.
        const fees = this.feeConfig
          ? organizationId
            ? await this.feeConfig.getFeesForCreator(
                organizationId,
                contentRecord.creatorId,
                'one_off'
              )
            : await this.feeConfig.getFeesPlatform('one_off')
          : {
              platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
              orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
              minPlatformFeeCents: 0,
              minTransferCents: 0,
            };

        // Step 3a (Codex-rzfjw / WP-4): override `orgFeePercent` with the
        // uploader's content_purchase agreement when one exists.
        //
        // Decision Q1: content-purchase revenue is attributed to the
        // uploader (`content.creatorId`), and THAT creator's
        // revenue_type='content_purchase' agreement determines the split.
        // Per-content overrides are out of scope (future epic).
        //
        // Decision Q2: creator share is snapshotted on the proposal;
        // platform fee is read fresh (we keep `fees.platformFeePercent`
        // from FeeConfigService above).
        //
        // The agreement's share is read from `agreementProposals
        // .proposedCreatorSharePercent` via `current_proposal_id` so
        // this read works for both pre-WP-1 backfilled rows (migration
        // 0072 synthesised a proposal) and new agreements.
        //
        // Codex-xz61z (I5): pin `purchasedAt` once and reuse in all
        // three Q3 predicates. Previously three `new Date()` calls
        // could produce slightly different millisecond values when
        // executed back-to-back, which is harmless in practice but
        // makes the predicate non-deterministic — webhook replays
        // can land on the wrong side of an agreement boundary that
        // occurred mid-millisecond.
        // Codex-69t7c WP5: the creator-org agreement lookup is org-scoped, so
        // it only runs for org-scoped purchases. Orgless (bi-party) content has
        // no organization and therefore no `creator_organization_agreements`
        // row — skip the query entirely (it would also fail to typecheck
        // against the nullable `organizationId`).
        const purchasedAt = metadata.paidAt ?? new Date();
        // Codex-2pryk WP-6: agreement lookup hoisted to the shared
        // `findActiveCreatorAgreementShare` (reused by the course-purchase +
        // course-subscription payout paths so all three apply IDENTICAL
        // Decision-Q3 agreement math). Returns the creator's share in basis
        // points, or null when no active agreement brackets `purchasedAt`.
        const agreementSharePercent = organizationId
          ? await findActiveCreatorAgreementShare(tx, {
              organizationId,
              creatorId: contentRecord.creatorId,
              revenueType: 'content_purchase',
              at: purchasedAt,
            })
          : null;

        // Codex-69t7c WP5: for orgless (bi-party) purchases the org leg is
        // ALWAYS zero — there is no organization to pay, so the creator keeps
        // 100% of the post-platform amount. We force `0` here rather than
        // trusting `fees.orgFeePercent`, which for the platform-fee config can
        // carry a non-zero default that would otherwise strand a slice with no
        // recipient. For org-scoped purchases: if an agreement is present,
        // derive the org's cut from 10000 - creator_share; otherwise fall
        // through to the FeeConfigService-resolved value (the Q1 fallback —
        // "org keeps 100% of post-platform" unless an admin overrode it).
        const effectiveOrgFeePercent = !organizationId
          ? 0
          : agreementSharePercent != null
            ? 10_000 - agreementSharePercent
            : fees.orgFeePercent;

        // Codex-69t7c WP5 hardening (d): record the orgless org-fee-zero
        // override decision explicitly. For a bi-party (orgless) purchase the
        // org fee leg is forced to 0 regardless of the platform-fee config's
        // default `orgFeePercent`; log that override so the decision is
        // auditable rather than silently folded into the split below.
        if (!organizationId) {
          this.obs.info('orgless_org_fee_override', {
            contentId: metadata.contentId,
            creatorId: contentRecord.creatorId,
            stripePaymentIntentId,
            configOrgFeePercent: fees.orgFeePercent,
            effectiveOrgFeePercent: 0,
            reason: 'bi_party_no_org_recipient',
          });
        }

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
          effectiveOrgFeePercent
        );
        const revenueSplit = applyMinPlatformFeeFloor(
          metadata.amountPaidCents,
          rawSplit,
          fees.minPlatformFeeCents
        );

        // Codex-rzfjw: emit one observability event per purchase split
        // for end-to-end auditability of the agreements payout pipeline.
        this.obs.info('payout_split_computed', {
          purchaseId: undefined,
          contentId: metadata.contentId,
          organizationId,
          creatorId: contentRecord.creatorId,
          amountPaidCents: metadata.amountPaidCents,
          platformFeeCents: revenueSplit.platformFeeCents,
          organizationFeeCents: revenueSplit.organizationFeeCents,
          creatorPayoutCents: revenueSplit.creatorPayoutCents,
          agreementApplied: agreementSharePercent != null,
          source: 'content_purchase',
        });

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
            purchasedAt,
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

        // Step 5a (Codex-2pryk WP-6): write the greenfield `entitlements` grant
        // the resolver reads. Additive to `contentAccess` + `verifyPurchase`
        // (the resolver unions all three). Org-scoped ONLY — `entitlements`
        // requires a non-null org, so orgless (bi-party) content writes no grant
        // row and stays covered by `verifyPurchase` alone. Idempotent on replay.
        if (organizationId) {
          await writeContentPurchaseEntitlement(tx, {
            userId: metadata.customerId,
            organizationId,
            contentId: metadata.contentId,
            purchaseId: purchase.id,
          });
        }

        return {
          purchase,
          isNew: true,
          revenueSplit,
          creatorId: contentRecord.creatorId,
          organizationId,
        } as const;
      });

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

      // Double-purchase guard: a completed course purchase already grants a
      // permanent entitlement, so block a second checkout (mirrors the content
      // path's AlreadyPurchasedError guard).
      const existing = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.customerId, customerId),
          eq(purchases.courseId, validated.courseId),
          eq(purchases.status, PURCHASE_STATUS.COMPLETED)
        ),
      });
      if (existing) {
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

      const session = await withStaleCustomerRecovery(
        { db: this.db, stripe: this.stripe },
        {
          userId: customerId,
          email: user.email,
          environment: this.environment,
        },
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
          }),
        {
          onStaleRecovery: (info) =>
            this.obs.warn(
              'Stale users.stripe_customer_id detected; clearing and retrying',
              { ...info, courseId: validated.courseId }
            ),
        }
      );

      if (!session.url) {
        throw new PaymentProcessingError('Checkout session URL not generated', {
          sessionId: session.id,
        });
      }

      return { sessionUrl: session.url, sessionId: session.id };
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
        throw new PaymentProcessingError(
          'Failed to create course checkout session',
          { stripeError: error.message, courseId: validated.courseId }
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

        const course = await tx.query.courses.findFirst({
          where: eq(courses.id, metadata.courseId),
          columns: { organizationId: true, creatorId: true },
        });
        if (!course) {
          throw new PaymentProcessingError(
            'Course not found during purchase completion',
            { courseId: metadata.courseId, stripePaymentIntentId }
          );
        }

        // Courses are ALWAYS org-owned — the org is authoritative from the row.
        const organizationId = course.organizationId;

        const fees = this.feeConfig
          ? await this.feeConfig.getFeesForCreator(
              organizationId,
              course.creatorId,
              'one_off'
            )
          : {
              platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENTAGE,
              orgFeePercent: DEFAULT_ORG_FEE_PERCENTAGE,
              minPlatformFeeCents: 0,
              minTransferCents: 0,
            };

        // HARDENING §H4(a): course purchases reuse the creator's
        // `content_purchase` revenue-share agreement terms.
        const purchasedAt = metadata.paidAt ?? new Date();
        const agreementSharePercent = await findActiveCreatorAgreementShare(
          tx,
          {
            organizationId,
            creatorId: course.creatorId,
            revenueType: 'content_purchase',
            at: purchasedAt,
          }
        );
        const effectiveOrgFeePercent =
          agreementSharePercent != null
            ? 10_000 - agreementSharePercent
            : fees.orgFeePercent;

        const rawSplit = calculateRevenueSplit(
          metadata.amountPaidCents,
          fees.platformFeePercent,
          effectiveOrgFeePercent
        );
        const revenueSplit = applyMinPlatformFeeFloor(
          metadata.amountPaidCents,
          rawSplit,
          fees.minPlatformFeeCents
        );

        this.obs.info('payout_split_computed', {
          purchaseId: undefined,
          courseId: metadata.courseId,
          organizationId,
          creatorId: course.creatorId,
          amountPaidCents: metadata.amountPaidCents,
          platformFeeCents: revenueSplit.platformFeeCents,
          organizationFeeCents: revenueSplit.organizationFeeCents,
          creatorPayoutCents: revenueSplit.creatorPayoutCents,
          agreementApplied: agreementSharePercent != null,
          source: 'course_purchase',
        });

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
              courseId: metadata.courseId,
            }
          );
        }

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
            status: PURCHASE_STATUS.COMPLETED,
            purchasedAt,
            platformFeeCents: revenueSplit.platformFeeCents,
            organizationFeeCents: revenueSplit.organizationFeeCents,
            creatorPayoutCents: revenueSplit.creatorPayoutCents,
            platformAgreementId: null,
            creatorOrgAgreementId: null,
          })
          .returning();

        if (!purchase) {
          throw new PaymentProcessingError('Failed to create purchase record', {
            stripePaymentIntentId,
          });
        }

        // Grant the course entitlement (the resolver's READ target) + auto-enroll,
        // atomically with the purchase row. Idempotent on replay.
        await writeCoursePurchaseEntitlement(tx, {
          userId: metadata.customerId,
          organizationId,
          courseId: metadata.courseId,
          purchaseId: purchase.id,
        });

        return {
          purchase,
          isNew: true,
          revenueSplit,
          creatorId: course.creatorId,
          organizationId,
        } as const;
      });

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
      this.obs.error('Failed to complete course purchase', {
        error: error instanceof Error ? error.message : String(error),
        stripePaymentIntentId,
        customerId: metadata.customerId,
        courseId: metadata.courseId,
        amountPaidCents: metadata.amountPaidCents,
      });
      this.handleError(error, 'completeCoursePurchase');
    }
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
   * A replayed webhook re-records an existing purchase's slices from the split
   * stored on it. The ledger skips every slice already there, so this only
   * adds one the first delivery never wrote — the worker died between
   * committing the purchase and writing its slices, or an insert failed and
   * the webhook was retried (Codex-2hxff.11). Until this, a replay skipped the
   * ledger entirely and such a slice was never paid.
   *
   * A purchase refunded or disputed since is left alone: adding a slice now
   * would pay out money the buyer has been given back.
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
      // Said out loud: if the first delivery lost a slice, a PARTIAL refund
      // leaves part of it owed, and only a person can settle that.
      this.obs.warn('Replay left a refunded or disputed purchase unrepaired', {
        purchaseId: purchase.id,
        status: purchase.status,
        refundedAt: purchase.refundedAt?.toISOString() ?? null,
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
      // Build WHERE conditions. Codex-2pryk WP-6: this is the CONTENT purchase
      // history (joins + returns content). Course purchases (contentId NULL) are
      // a distinct shape surfaced via the library/enrollments shelf, not here —
      // scope them out so the `content` join is always present.
      const conditions = [
        eq(purchases.customerId, customerId),
        isNotNull(purchases.contentId),
      ];

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
          // `content` is guaranteed present — getPurchaseHistory scopes to
          // content purchases (contentId NOT NULL) — so its id is the target.
          contentId: p.content.id,
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
   * not carry our metadata, so we list sessions by `payment_intent`; the session
   * carries { customerId, contentId, organizationId } (validated against the
   * SAME `checkoutSessionMetadataSchema` the booking webhook uses) + amount_total.
   *
   * MINIMAL by design (Codex-aa08z decision): we INSERT only the purchase row —
   * we deliberately do NOT run `writePurchasePayouts`. A refund arriving before
   * completion means NO funds were ever transferred to Connect accounts, so there
   * is nothing to pay out and nothing to claw back. The fee columns carry a
   * default split purely to satisfy the `amount = platform + org + creator` CHECK
   * (bookkeeping — no payout executes). The later `checkout.session.completed`
   * no-ops via `completePurchase`'s idempotency check, so no transfer ever fires
   * for this refunded sale. The after-transfer clawback case (refund AFTER
   * transfers settled) is the separate, still-open policy decision Codex-13v21 —
   * intentionally NOT touched here.
   *
   * Returns the purchase, or `null` when the session/metadata cannot be resolved
   * (caller then exits cleanly with 200, exactly as the old drop branch did).
   * Bubbles transient Stripe/DB errors so the webhook 5xx's and Stripe retries.
   */
  async ensurePurchaseDataPresent(
    paymentIntentId: string
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

    const parsed = checkoutSessionMetadataSchema.safeParse(
      session.metadata ?? {}
    );
    const amountPaidCents = session.amount_total;
    if (!parsed.success || amountPaidCents === null) {
      this.obs.warn(
        'Purchase self-heal: checkout session missing/invalid metadata or amount',
        { paymentIntentId, sessionId: session.id }
      );
      return null;
    }
    const { customerId, contentId, organizationId } = parsed.data;

    // The purchases CHECK constraint requires
    // amount = platformFee + organizationFee + creatorPayout, so we cannot leave
    // the fee columns at 0. Compute a split with DEFAULT percentages (org leg 0
    // for orgless content). This is bookkeeping only: the row is refunded
    // immediately and writePurchasePayouts is NEVER called, so no funds move and
    // the exact per-org fee config is immaterial — the split just has to balance.
    const split = calculateRevenueSplit(
      amountPaidCents,
      DEFAULT_PLATFORM_FEE_PERCENTAGE,
      organizationId ? DEFAULT_ORG_FEE_PERCENTAGE : 0
    );

    try {
      const [inserted] = await this.db
        .insert(purchases)
        .values({
          customerId,
          contentId,
          organizationId,
          amountPaidCents,
          currency: CURRENCY.GBP,
          stripePaymentIntentId: paymentIntentId,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
          platformFeeCents: split.platformFeeCents,
          organizationFeeCents: split.organizationFeeCents,
          creatorPayoutCents: split.creatorPayoutCents,
        })
        .returning();
      // `.returning()` always yields the inserted row here; `?? null` only
      // satisfies the array-index `| undefined` that TS infers.
      return inserted ?? null;
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
   * Process a refund from a charge.refunded webhook event.
   *
   * Flow:
   * 1. Ensure the purchase row exists (self-heal ordering race #4, Codex-aa08z)
   * 2. Update purchase status to 'refunded'
   * 3. Revoke content access (soft delete)
   * 4. Claw back each refund's share of the payout slices
   *
   * Idempotent. An already-refunded purchase skips steps 2-3 but still runs
   * step 4: what each refund did is recorded per slice (payout_reversals), so
   * a redelivery does only what is left, and a later partial refund of the
   * same charge is clawed back too (Codex-2hxff.8).
   */
  async processRefund(
    paymentIntentId: string,
    refundDetails: {
      /** The refunded charge: its id and amount, the clawback's denominator. */
      charge: ClawbackCharge;
      stripeRefundId?: string;
      refundAmountCents?: number;
      refundReason?: string;
    }
  ): Promise<{ userId: string } | undefined> {
    try {
      // Self-heal ordering race #4 (Codex-aa08z): if charge.refunded beat
      // checkout.session.completed, the row won't exist yet — rebuild it from
      // the Stripe checkout session so the refund is recorded (no transfers).
      const purchase = await this.ensurePurchaseDataPresent(paymentIntentId);

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

        // Revoke content access (soft delete) — content purchases only. Course
        // purchases grant no contentAccess row (they use entitlements).
        if (purchase.contentId) {
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

      // Step: claw back the payout slices (Codex-h69cg), out of the
      // transaction because it talks to Stripe. The purchase is already
      // recorded refunded above; a clawback step that must be retried rejects
      // after every other step, and the webhook's 500 has Stripe redeliver.
      await this.clawBackRefunds(purchase.id, refundDetails.charge);

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
  ): Promise<{ userId: string; orgId: string | null } | undefined> {
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

        // Content purchases only — course purchases grant no contentAccess row.
        if (purchase.contentId) {
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

        // Content-purchase sessions populate the purchase + content blocks.
        // Course-purchase sessions (content join null) return sessionStatus only
        // — the course success surface reads its own offer, not this shape.
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
        { db: this.db, stripe: this.stripe },
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
      // Codex-2pryk WP-6: the Sales ledger's SaleListItem shape is content-
      // shaped (contentTitle/contentSlug). Scope to content purchases so the
      // `content` join is always present; course sales get their own reporting
      // surface (WP-7) rather than being force-fit into the content columns.
      const conditions = [
        eq(purchases.organizationId, orgId),
        isNotNull(purchases.contentId),
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
      // Content-only, to match `listSales` (course sales report separately, WP-7)
      // so the header tiles and the table below them agree.
      const conditions = [
        eq(purchases.organizationId, orgId),
        isNotNull(purchases.contentId),
      ];

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
