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

import { content, contentAccess, purchases } from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type {
  CreateCheckoutInput,
  PurchaseQueryInput,
} from '@codex/validation';
import {
  createCheckoutSchema,
  getPurchaseSchema,
  purchaseQuerySchema,
} from '@codex/validation';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  ForbiddenError,
  PaymentProcessingError,
  PurchaseNotFoundError,
  wrapError,
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

import type {
  CheckoutSessionResult,
  CompletePurchaseMetadata,
  Purchase,
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
      if (contentRecord.status !== 'published') {
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

      // Phase 1: Paid content must belong to an organization
      if (!contentRecord.organizationId) {
        throw new ContentNotPurchasableError(
          validated.contentId,
          'not_published',
          {
            reason:
              'Content must belong to an organization to be purchasable (Phase 1)',
          }
        );
      }

      // Step 2: Check for existing purchase
      const existingPurchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.customerId, customerId),
          eq(purchases.contentId, validated.contentId),
          eq(purchases.status, 'completed')
        ),
      });

      if (existingPurchase) {
        throw new AlreadyPurchasedError(validated.contentId, customerId);
      }

      // Step 3: Create Stripe Checkout session
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: contentRecord.priceCents,
              product_data: {
                name: contentRecord.title,
                description: contentRecord.description || undefined,
                images: contentRecord.thumbnailUrl
                  ? [contentRecord.thumbnailUrl]
                  : undefined,
              },
            },
            quantity: 1,
          },
        ],
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

      throw wrapError(error, { customerId, contentId: validated.contentId });
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
   *     currency: 'usd',
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
            currency: metadata.currency || 'usd',
            stripePaymentIntentId,
            status: 'completed',
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
          accessType: 'purchased',
          expiresAt: null, // Permanent access for purchases
        });

        return purchase;
      });
    } catch (error) {
      this.obs?.error('Failed to complete purchase', {
        error: error instanceof Error ? error.message : String(error),
        stripePaymentIntentId,
        customerId: metadata.customerId,
        contentId: metadata.contentId,
        amountPaidCents: metadata.amountPaidCents,
      });
      throw wrapError(error, {
        stripePaymentIntentId,
        metadata,
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
      const purchase = await this.db.query.purchases.findFirst({
        where: and(
          eq(purchases.contentId, contentId),
          eq(purchases.customerId, customerId),
          eq(purchases.status, 'completed')
        ),
      });

      return !!purchase;
    } catch (error) {
      throw wrapError(error, { contentId, customerId });
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
   * // Returns: { items: [...], total: 42, page: 1, limit: 20 }
   */
  async getPurchaseHistory(
    customerId: string,
    filters: PurchaseQueryInput
  ): Promise<{
    items: PurchaseWithContent[];
    total: number;
    page: number;
    limit: number;
  }> {
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

      // Get purchases with content
      const items = await this.db.query.purchases.findMany({
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
      });

      // Get total count
      const countResult = await this.db
        .select({ count: purchases.id })
        .from(purchases)
        .where(and(...conditions));

      const total = countResult.length;

      return {
        items: items as PurchaseWithContent[],
        total,
        page: validated.page,
        limit: validated.limit,
      };
    } catch (error) {
      throw wrapError(error, { customerId, filters: validated });
    }
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
      // First query by ID only (no customer filter)
      const purchase = await this.db.query.purchases.findFirst({
        where: eq(purchases.id, validated.id),
      });

      // Not found - throw 404
      if (!purchase) {
        throw new PurchaseNotFoundError(validated.id);
      }

      // Found but doesn't belong to customer - throw 403
      if (purchase.customerId !== customerId) {
        throw new ForbiddenError('You do not have access to this purchase', {
          purchaseId: validated.id,
        });
      }

      // Success - return purchase
      return purchase;
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof PurchaseNotFoundError ||
        error instanceof ForbiddenError
      ) {
        throw error;
      }
      // Wrap unknown errors
      throw wrapError(error, { purchaseId, customerId });
    }
  }
}
