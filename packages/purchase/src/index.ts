/**
 * @codex/purchase
 *
 * Purchase service package for Codex platform.
 *
 * Provides:
 * - PurchaseService: Stripe Checkout integration and purchase management
 * - Revenue calculator: Calculate platform/org/creator revenue splits
 * - Error classes: Domain-specific purchase errors
 * - Types: Purchase records and service types
 *
 * @example
 * import { PurchaseService, calculateRevenueSplit } from '@codex/purchase';
 * import { createDbClient } from '@codex/database';
 * import Stripe from 'stripe';
 *
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
 * const purchaseService = new PurchaseService(
 *   { db: createDbClient(c.env), environment: 'production' },
 *   stripe
 * );
 *
 * // Create checkout session
 * const session = await purchaseService.createCheckoutSession({
 *   contentId: 'content-123',
 *   successUrl: 'https://example.com/success',
 *   cancelUrl: 'https://example.com/cancel',
 * }, 'customer-456');
 *
 * // Calculate revenue split
 * const split = calculateRevenueSplit(2999, 1000, 0);
 * // { platformFeeCents: 300, organizationFeeCents: 0, creatorPayoutCents: 2699 }
 */

// Re-export validation schemas for convenience
export {
  type CreateCheckoutInput,
  createCheckoutSchema,
  type GetPurchaseInput,
  getPurchaseSchema,
  type PurchaseQueryInput,
  type PurchaseStatus,
  purchaseQuerySchema,
  purchaseStatusEnum,
} from '@codex/validation';
// Error classes
export {
  AlreadyPurchasedError,
  BusinessLogicError,
  ConflictError,
  ContentNotPurchasableError,
  ForbiddenError,
  InternalServiceError,
  isPurchaseServiceError,
  NotFoundError,
  PaymentProcessingError,
  PurchaseNotFoundError,
  type PurchaseServiceError,
  RevenueCalculationError,
  ValidationError,
  wrapError,
} from './errors';
// Service
export { PurchaseService } from './services/purchase-service';
// Revenue calculator
export {
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  type RevenueSplit,
} from './services/revenue-calculator';
// Stripe client factory
export { createStripeClient, verifyWebhookSignature } from './stripe-client';
// Types
export type {
  CheckoutSessionResult,
  CompletePurchaseMetadata,
  NewPurchaseInput,
  Purchase,
  PurchaseWithContent,
} from './types';
