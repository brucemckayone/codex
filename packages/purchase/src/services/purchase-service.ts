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
import {
  content,
  contentAccess,
  purchases,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type {
  CreateCheckoutInput,
  PurchaseQueryInput,
} from '@codex/validation';
import {
  createCheckoutSchema,
  createPortalSessionSchema,
  extractPlainText,
  getPurchaseSchema,
  purchaseQuerySchema,
} from '@codex/validation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  ForbiddenError,
  PaymentProcessingError,
  PurchaseNotFoundError,
} from '../errors';

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
} from '../types';
import {
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
} from './revenue-calculator';

/**
 * Purchase Service Class
 *
 * Handles purchase operations with Stripe integration.
 */
export class PurchaseService extends BaseService {
  private readonly stripe: Stripe;

  /**
   * Initialize purchase service
   *
   * @param config - Service configuration (db, environment)
   * @param stripe - Stripe client instance
   */
  constructor(config: ServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
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

      // Calculate application fee (platform's cut) for destination charges
      const applicationFeeCents = creatorConnect?.chargesEnabled
        ? Math.ceil(
            (contentRecord.priceCents * DEFAULT_PLATFORM_FEE_PERCENTAGE) / 10000
          )
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

      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: CURRENCY.GBP,
              unit_amount: contentRecord.priceCents,
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
        ...(creatorConnect?.chargesEnabled && applicationFeeCents !== undefined
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
          organizationId: contentRecord.organizationId, // Must exist (validated above)
          creatorId: contentRecord.creatorId,
        },
        client_reference_id: customerId,
      });

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
        error instanceof AlreadyPurchasedError
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
      return await this.db.transaction(async (tx) => {
        // Step 1: Check for existing purchase (idempotency)
        const existing = await tx.query.purchases.findFirst({
          where: eq(purchases.stripePaymentIntentId, stripePaymentIntentId),
        });

        if (existing) {
          // Already processed - return existing
          return existing;
        }

        // Step 2: Get active fee configurations
        // Phase 1: Use defaults (10% platform, 0% org)
        // Future: Query platformFeeConfig and agreements tables
        const platformFeePercentage = DEFAULT_PLATFORM_FEE_PERCENTAGE; // 1000 = 10%
        const orgFeePercentage = DEFAULT_ORG_FEE_PERCENTAGE; // 0 = 0%

        // Step 3: Calculate revenue split
        const revenueSplit = calculateRevenueSplit(
          metadata.amountPaidCents,
          platformFeePercentage,
          orgFeePercentage
        );

        // Step 3.5: Fetch organizationId from content if not in metadata
        let organizationId = metadata.organizationId;
        if (!organizationId) {
          const contentRecord = await tx.query.content.findFirst({
            where: eq(content.id, metadata.contentId),
            columns: { organizationId: true },
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

          organizationId = contentRecord.organizationId;
        }

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

        // Step 5: Grant content access atomically
        await tx.insert(contentAccess).values({
          userId: metadata.customerId,
          contentId: metadata.contentId,
          organizationId: organizationId, // Use same fetched value
          accessType: ACCESS_TYPES.PURCHASED,
          expiresAt: null, // Permanent access for purchases
        });

        return purchase;
      });
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
      const purchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.contentId, contentId),
          eq(purchases.customerId, customerId),
          eq(purchases.status, PURCHASE_STATUS.COMPLETED)
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
    const validStatuses = new Set<PurchaseListItem['status']>([
      PURCHASE_STATUS.COMPLETED,
      PURCHASE_STATUS.PENDING,
      PURCHASE_STATUS.FAILED,
      PURCHASE_STATUS.REFUNDED,
    ]);

    return {
      items: result.items.map(
        (p): PurchaseListItem => ({
          id: p.id,
          customerId: p.customerId,
          createdAt:
            p.createdAt instanceof Date
              ? p.createdAt.toISOString()
              : p.createdAt,
          contentId: p.contentId,
          contentTitle: p.content.title,
          amountCents: p.amountPaidCents,
          status: validStatuses.has(p.status as PurchaseListItem['status'])
            ? (p.status as PurchaseListItem['status'])
            : PURCHASE_STATUS.PENDING,
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
   * Allows customers to manage their billing (view invoices, update payment methods).
   * Looks up or creates a Stripe customer by email, then creates a portal session.
   *
   * @param email - Customer's email address
   * @param userId - Codex user ID (stored in Stripe customer metadata)
   * @param returnUrl - URL to redirect to after portal session
   * @returns Portal session URL
   * @throws {PaymentProcessingError} If Stripe portal session creation fails
   */
  async createPortalSession(
    email: string,
    userId: string,
    returnUrl: string
  ): Promise<{ url: string }> {
    const validated = createPortalSessionSchema.parse({ returnUrl });

    try {
      // Step 1: Look up existing Stripe customer by email
      const customers = await this.stripe.customers.list({
        email,
        limit: 1,
      });

      let customer = customers.data[0];

      // Step 2: If no customer found, create one
      if (!customer) {
        customer = await this.stripe.customers.create({
          email,
          metadata: { userId },
        });
      }

      // Step 3: Create billing portal session
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: validated.returnUrl,
      });

      return { url: session.url };
    } catch (error) {
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
}
