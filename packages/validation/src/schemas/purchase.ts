import { z } from 'zod';
import { urlSchema, uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Purchase Validation Schemas
 *
 * Validates Stripe Checkout integration and purchase query operations.
 *
 * Design principles:
 * - Security-first: Prevent XSS in URLs, validate UUIDs, whitelist redirect domains
 * - Database alignment: purchaseStatusEnum matches CHECK constraint
 * - Clear error messages: Actionable feedback for API responses
 * - Type inference: Export TypeScript types via z.infer
 *
 * Database constraint alignment:
 * - status enum: pending, completed, refunded, failed (line 261 in ecommerce.ts)
 * - amountPaidCents: non-negative integer (line 304 in ecommerce.ts)
 *
 * Security:
 * - Checkout redirect URLs are whitelisted to prevent open redirect attacks
 */

/**
 * Allowed domains for checkout redirect URLs
 * Prevents open redirect attacks by whitelisting trusted domains
 */
const ALLOWED_REDIRECT_DOMAINS = [
  // Production
  'revelations.studio',
  'codex.revelations.studio',
  'app.revelations.studio',
  // Staging
  'codex-staging.revelations.studio',
  'app-staging.revelations.studio',
  // Development
  'localhost',
  '127.0.0.1',
];

/**
 * Checkout redirect URL schema with domain whitelisting
 * Prevents open redirect attacks by only allowing trusted domains
 *
 * Security:
 * - HTTP/HTTPS protocol only (prevents javascript:, data: URIs)
 * - Domain whitelist prevents redirects to untrusted sites
 * - Localhost allowed for development
 */
export const checkoutRedirectUrlSchema = urlSchema.refine(
  (url) => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Check if hostname exactly matches or is subdomain of allowed domains
      return ALLOWED_REDIRECT_DOMAINS.some((allowedDomain) => {
        // Exact match
        if (hostname === allowedDomain) return true;
        // Subdomain match (e.g., preview-123.revelations.studio)
        if (hostname.endsWith(`.${allowedDomain}`)) return true;
        return false;
      });
    } catch {
      return false;
    }
  },
  {
    message: `Redirect URL must be on a trusted domain (${ALLOWED_REDIRECT_DOMAINS.join(', ')})`,
  }
);

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
 * - Domain whitelist: Redirect URLs must be on trusted domains (prevents open redirect)
 *
 * Validates:
 * - contentId: UUID of content to purchase
 * - successUrl: Redirect URL after successful payment (whitelisted domains only)
 * - cancelUrl: Redirect URL if user cancels (whitelisted domains only)
 */
export const createCheckoutSchema = z.object({
  contentId: uuidSchema,
  successUrl: checkoutRedirectUrlSchema,
  cancelUrl: checkoutRedirectUrlSchema,
});

/**
 * Purchase Query Schema
 *
 * Used for GET /api/purchases with filters
 *
 * Extends pagination schema with purchase-specific filters:
 * - status: Optional filter by purchase status
 * - contentId: Optional filter by content UUID
 */
export const purchaseQuerySchema = paginationSchema.extend({
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

/**
 * Checkout Session Metadata Schema
 *
 * Validates metadata attached to Stripe checkout sessions.
 * Used by webhook handler to extract purchase details from completed checkout.
 *
 * Security:
 * - customerId: UUID validation prevents injection
 * - contentId: UUID validation prevents injection
 * - organizationId: Optional UUID, transforms empty string to null
 * - amountCents: Already validated from Stripe API, but documented for clarity
 *
 * Validates:
 * - customerId: Codex user ID (UUID) who completed purchase
 * - contentId: Content being purchased (UUID)
 * - organizationId: Optional creator's organization (UUID or null)
 */
export const checkoutSessionMetadataSchema = z.object({
  customerId: uuidSchema,
  contentId: uuidSchema,
  organizationId: uuidSchema
    .nullable()
    .default(null)
    .transform((val) => (val === '' ? null : val)),
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
export type CheckoutSessionMetadata = z.infer<
  typeof checkoutSessionMetadataSchema
>;
