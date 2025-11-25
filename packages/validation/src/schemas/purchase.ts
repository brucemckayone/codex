import { z } from 'zod';
import { positiveIntSchema, urlSchema, uuidSchema } from '../primitives';

/**
 * Purchase Validation Schemas
 *
 * Validates Stripe Checkout integration and purchase query operations.
 *
 * Design principles:
 * - Security-first: Prevent XSS in URLs, validate UUIDs
 * - Database alignment: purchaseStatusEnum matches CHECK constraint
 * - Clear error messages: Actionable feedback for API responses
 * - Type inference: Export TypeScript types via z.infer
 *
 * Database constraint alignment:
 * - status enum: pending, completed, refunded, failed (line 261 in ecommerce.ts)
 * - amountPaidCents: non-negative integer (line 304 in ecommerce.ts)
 */

/**
 * Purchase status enum
 * Aligns with database CHECK constraint: purchases.status
 * CHECK (status IN ('pending', 'completed', 'refunded', 'failed'))
 */
export const purchaseStatusEnum = z.enum(
  ['pending', 'completed', 'refunded', 'failed'],
  {
    message: 'Status must be pending, completed, refunded, or failed',
  }
);

/**
 * Create Checkout Session Schema
 *
 * Used for POST /api/checkout to initiate Stripe Checkout
 *
 * Security:
 * - contentId: UUID validation prevents injection
 * - URLs: HTTP/HTTPS only, blocks javascript: and data: URIs
 *
 * Validates:
 * - contentId: UUID of content to purchase
 * - successUrl: Redirect URL after successful payment (HTTP/HTTPS)
 * - cancelUrl: Redirect URL if user cancels (HTTP/HTTPS)
 */
export const createCheckoutSchema = z.object({
  contentId: uuidSchema,
  successUrl: urlSchema,
  cancelUrl: urlSchema,
});

/**
 * Purchase Query Schema
 *
 * Used for GET /api/purchases with filters
 *
 * Validates:
 * - page: Pagination page number (default: 1, max: 1000)
 * - limit: Items per page (default: 20, max: 100)
 * - status: Optional filter by purchase status
 * - contentId: Optional filter by content UUID
 *
 * Pagination bounds:
 * - Max page 1000 prevents excessive database offsets
 * - Max limit 100 prevents large query results
 */
export const purchaseQuerySchema = z.object({
  page: positiveIntSchema
    .max(1000, 'Must be 1000 or less')
    .optional()
    .default(1),
  limit: positiveIntSchema
    .max(100, 'Must be 100 or less')
    .optional()
    .default(20),
  status: purchaseStatusEnum.optional(),
  contentId: uuidSchema.optional(),
});

/**
 * Get Purchase Schema
 *
 * Used for GET /api/purchases/:id
 *
 * Validates:
 * - id: UUID of purchase record
 */
export const getPurchaseSchema = z.object({
  id: uuidSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Type inference for purchase schemas
 * Single source of truth for TypeScript types
 */
export type PurchaseStatus = z.infer<typeof purchaseStatusEnum>;
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type PurchaseQueryInput = z.infer<typeof purchaseQuerySchema>;
export type GetPurchaseInput = z.infer<typeof getPurchaseSchema>;
