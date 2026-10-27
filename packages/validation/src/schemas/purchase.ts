import { z } from 'zod';
import { urlSchema, userIdSchema, uuidSchema } from '../primitives';
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
 * The platform's own domains, for checkout redirect URLs. Prevents open
 * redirect attacks by whitelisting trusted domains.
 */
const TRUSTED_REDIRECT_DOMAINS = [
  // Production
  'revelations.studio',
  'codex.revelations.studio',
  'app.revelations.studio',
  // Staging
  'codex-staging.revelations.studio',
  'app-staging.revelations.studio',
];

/**
 * Development hosts: localhost and 127.0.0.1 are unreachable externally, and
 * lvh.me resolves to 127.0.0.1. Development, test and CI return to them
 * (e2e runs on them); production refuses them ({@link isProductionRedirectUrl}).
 */
const DEV_REDIRECT_HOSTS = ['localhost', '127.0.0.1', 'lvh.me'];

/** Allowed domains for checkout redirect URLs, in every environment. */
const ALLOWED_REDIRECT_DOMAINS = [
  ...TRUSTED_REDIRECT_DOMAINS,
  ...DEV_REDIRECT_HOSTS,
];

/**
 * The hostname is one of `domains`, or a subdomain of one
 * (e.g., preview-123.revelations.studio).
 */
function isOnDomain(url: URL, domains: readonly string[]): boolean {
  const hostname = url.hostname.toLowerCase();
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

/**
 * Checkout redirect URL schema with domain whitelisting
 * Prevents open redirect attacks by only allowing trusted domains
 *
 * Security:
 * - HTTP/HTTPS protocol only (prevents javascript:, data: URIs)
 * - Domain whitelist prevents redirects to untrusted sites
 * - Localhost allowed, in every environment: this schema does not know which
 *   it runs in. A production worker also applies
 *   {@link isProductionRedirectUrl} (Codex-2hxff.79)
 */
export const checkoutRedirectUrlSchema = urlSchema.refine(
  (url) => {
    try {
      return isOnDomain(new URL(url), ALLOWED_REDIRECT_DOMAINS);
    } catch {
      return false;
    }
  },
  {
    message: `Redirect URL must be on a trusted domain (${ALLOWED_REDIRECT_DOMAINS.join(', ')})`,
  }
);

/**
 * Whether a production checkout may return to `url` (Codex-2hxff.79): https,
 * and on one of the platform's own domains, so never a development host
 * (localhost, 127.0.0.1, lvh.me). The schema above stays the same in every
 * environment, because it cannot tell them apart. The worker knows its
 * environment, so it applies this rule on top, in production only.
 */
export function isProductionRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      isOnDomain(parsed, TRUSTED_REDIRECT_DOMAINS)
    );
  } catch {
    return false;
  }
}

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
 * Create Course Checkout Session Schema (Codex-2pryk WP-6)
 *
 * One-off COURSE purchase checkout. Same shape as {@link createCheckoutSchema}
 * but targets a course. The org + creator (payout recipient) are resolved
 * server-side from the `courses` row, never accepted from the client.
 */
export const createCourseCheckoutSchema = z.object({
  courseId: uuidSchema,
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
 * - customerId: Better Auth user ID validation (alphanumeric string)
 * - contentId: UUID validation prevents injection
 * - organizationId: Optional UUID, transforms empty string to null
 * - amountCents: Already validated from Stripe API, but documented for clarity
 *
 * Validates:
 * - customerId: Codex user ID (Better Auth format) who completed purchase
 * - contentId: Content being purchased (UUID)
 * - organizationId: Optional creator's organization (UUID or null)
 */
export const checkoutSessionMetadataSchema = z.object({
  customerId: userIdSchema,
  contentId: uuidSchema,
  organizationId: uuidSchema.nullable().default(null),
  contentTitle: z.string().optional(),
});

/**
 * Course Checkout Session Metadata Schema (Codex-2pryk WP-6)
 *
 * Validates metadata on a one-off COURSE checkout session. `kind: 'course'`
 * discriminates it from the content metadata at the webhook so the handler
 * routes to `completeCoursePurchase`. `organizationId` is NOT carried — it is
 * re-derived from the course row server-side (courses are always org-owned).
 */
export const courseCheckoutSessionMetadataSchema = z.object({
  kind: z.literal('course'),
  customerId: userIdSchema,
  courseId: uuidSchema,
  courseTitle: z.string().optional(),
});

/**
 * Create Portal Session Schema
 *
 * Used for POST /checkout/portal-session to create a Stripe billing portal session
 *
 * Security:
 * - returnUrl: Uses checkout redirect URL validator (whitelisted domains only)
 *
 * Validates:
 * - returnUrl: Redirect URL after portal interaction (whitelisted domains only)
 */
export const createPortalSessionSchema = z.object({
  returnUrl: checkoutRedirectUrlSchema,
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
export type CreateCourseCheckoutInput = z.infer<
  typeof createCourseCheckoutSchema
>;
export type CourseCheckoutSessionMetadata = z.infer<
  typeof courseCheckoutSessionMetadataSchema
>;
export type PurchaseQueryInput = z.infer<typeof purchaseQuerySchema>;
export type GetPurchaseInput = z.infer<typeof getPurchaseSchema>;
export type CheckoutSessionMetadata = z.infer<
  typeof checkoutSessionMetadataSchema
>;
export type CreatePortalSessionInput = z.infer<
  typeof createPortalSessionSchema
>;

/**
 * Verify Checkout Session Schema
 *
 * Used for GET /api/checkout/verify to check Stripe session status
 *
 * Validates:
 * - session_id: Stripe checkout session ID (non-empty string)
 */
export const verifyCheckoutSessionSchema = z.object({
  session_id: z.string().min(1),
});

/**
 * Type inference for verifyCheckoutSessionSchema
 * Single source of truth for TypeScript types
 */
export type VerifyCheckoutSessionInput = z.infer<
  typeof verifyCheckoutSessionSchema
>;

/**
 * Complete Checkout Session Schema
 *
 * Used for POST /checkout/complete: the success page asks for the purchase
 * its session stands for to be recorded on arrival (Codex-2hxff.22). Only the
 * id comes from the client; everything else is read from Stripe's session.
 *
 * Validates:
 * - sessionId: Stripe checkout session ID (non-empty, at most 255 characters)
 */
export const completeCheckoutSessionSchema = z.object({
  sessionId: z.string().min(1).max(255),
});

export type CompleteCheckoutSessionInput = z.infer<
  typeof completeCheckoutSessionSchema
>;

// ============================================================================
// Org-scoped Sales schemas (studio Sales ledger — Codex-1csms)
// ============================================================================

/**
 * Sales Query Schema (org-scoped)
 *
 * Used by GET /sales on ecom-api to list every purchase landing on an org.
 * The inverse view of `purchaseQuerySchema` (which is customer-scoped).
 *
 * Filters:
 * - status: optional purchase status (also accepts 'disputed' which is not a
 *   DB status but a query convenience flag — handler maps to `disputedAt IS NOT NULL`)
 * - contentId: scope to a single piece of content
 * - customerId: scope to a single buyer (free-text BetterAuth ID)
 * - fromDate / toDate: closed interval on `purchases.purchasedAt`
 *
 * `organizationId` is intentionally NOT here — it's re-derived from the
 * authenticated session's owner membership in the route handler so the
 * client cannot point this query at a different org.
 */
export const salesQuerySchema = paginationSchema.extend({
  status: z
    .enum(['pending', 'completed', 'refunded', 'failed', 'disputed'])
    .optional(),
  contentId: uuidSchema.optional(),
  customerId: userIdSchema.optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * Sales Stats Query Schema (org-scoped)
 *
 * Used by GET /sales/stats. Same date window semantics as `salesQuerySchema`
 * but no pagination — returns headline KPI totals.
 */
export const salesStatsQuerySchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export type SalesQueryInput = z.infer<typeof salesQuerySchema>;
export type SalesStatsQueryInput = z.infer<typeof salesStatsQuerySchema>;
