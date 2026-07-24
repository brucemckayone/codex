/**
 * Purchase Service Types
 *
 * Type definitions for purchase operations and responses.
 */

import type {
  Content,
  Purchase as DbPurchase,
  NewPurchase,
} from '@codex/database/schema';

/**
 * Purchase record from database
 * Re-export from schema for convenience
 */
export type Purchase = DbPurchase;

/**
 * New purchase insert type
 * Re-export from schema for convenience
 */
export type NewPurchaseInput = NewPurchase;

/**
 * Purchase with content details (joined query result)
 */
export interface PurchaseWithContent extends Purchase {
  content: Pick<
    Content,
    'id' | 'title' | 'slug' | 'thumbnailUrl' | 'contentType'
  >;
}

/**
 * Stripe Checkout session creation result
 */
export interface CheckoutSessionResult {
  /** Stripe Checkout session URL for redirect */
  sessionUrl: string;
  /** Stripe session ID */
  sessionId: string;
}

/**
 * Metadata for completing purchase (from Stripe webhook)
 */
export interface CompletePurchaseMetadata {
  /** Content ID being purchased */
  contentId: string;
  /** Customer ID making purchase */
  customerId: string;
  /** Organization ID (nullable) */
  organizationId: string | null;
  /** Amount paid in cents */
  amountPaidCents: number;
  /** Currency code (default: 'gbp') */
  currency?: string;
  /** Application fee Stripe actually collected (from PaymentIntent), for reconciliation */
  stripeApplicationFeeCents?: number | null;
  /** Stripe charge id (PaymentIntent.latest_charge). Required for payouts ledger writes
   * and as `source_transaction` for the secondary organization-fee transfer. */
  stripeChargeId?: string | null;
}

/**
 * Metadata for completing a one-off COURSE purchase (Codex-2pryk WP-6).
 *
 * Mirrors {@link CompletePurchaseMetadata} but targets a course. There is no
 * `organizationId` field: courses are ALWAYS org-owned, so the org (and the
 * creator to pay) is resolved authoritatively from the `courses` row, never
 * trusted from Stripe metadata.
 */
export interface CompleteCoursePurchaseMetadata {
  /** Course ID being purchased */
  courseId: string;
  /** Customer ID making purchase */
  customerId: string;
  /** Amount paid in cents */
  amountPaidCents: number;
  /** Currency code (default: 'gbp') */
  currency?: string;
  /** Application fee Stripe actually collected (from PaymentIntent), for reconciliation */
  stripeApplicationFeeCents?: number | null;
  /** Stripe charge id (PaymentIntent.latest_charge) — required for payouts ledger + source_transaction. */
  stripeChargeId?: string | null;
}

/**
 * Purchase list item for account payment history
 */
export interface PurchaseListItem {
  id: string;
  customerId: string;
  createdAt: string; // ISO 8601 timestamp
  contentId: string;
  contentTitle: string;
  amountCents: number;
  status: 'completed' | 'pending' | 'failed' | 'refunded';
}

/**
 * Sale list item for the studio Sales ledger (org-scoped).
 *
 * Mirrors a `purchases` row joined with `content` and `users`, flattened into
 * the shape the studio table consumes directly. `creatorPayoutCents` is the
 * org's net for that row (frontend labels it "Your share").
 *
 * Dates are ISO 8601 strings — serialised in the worker route so the SvelteKit
 * remote layer doesn't re-coerce Date instances.
 */
export interface SaleListItem {
  id: string;
  purchasedAt: string | null;
  createdAt: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string;
  contentId: string;
  contentTitle: string;
  contentSlug: string;
  amountPaidCents: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  platformFeeCents: number;
  organizationFeeCents: number;
  creatorPayoutCents: number;
  refundedAt: string | null;
  refundAmountCents: number | null;
  refundReason: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  stripePaymentIntentId: string;
}

/**
 * Sales summary KPIs for the studio Sales ledger header tiles.
 *
 * - `grossCents` includes completed + refunded (gross amount actually
 *   collected by Stripe before refunds)
 * - `netCents` is the org's share — sum of `creatorPayoutCents` +
 *   `organizationFeeCents` on completed rows
 * - `refundedCents` is the sum of `refundAmountCents` on refunded rows
 * - `count` is the number of completed sales rows in the window
 */
export interface SalesStats {
  grossCents: number;
  netCents: number;
  refundedCents: number;
  count: number;
  currency: string;
}

/**
 * Checkout session verification result
 *
 * Session status values from Stripe API (2025):
 * - open: Session created, not yet completed, can expire
 * - complete: Payment processing finished successfully
 * - expired: Session expired, customer cannot complete
 *
 * Source: Stripe API docs - https://docs.stripe.com/api/checkout/sessions/object
 */
export interface CheckoutSessionVerifyResult {
  /** Stripe session status: open | complete | expired */
  sessionStatus: 'complete' | 'expired' | 'open';
  /** Purchase record (if payment completed) */
  purchase?: {
    /** Purchase record ID */
    id: string;
    /** Content ID purchased */
    contentId: string;
    /** Amount paid in cents */
    amountPaidCents: number;
    /** ISO 8601 timestamp of purchase */
    purchasedAt: string;
  };
  /** Content details (for success page display) */
  content?: {
    /** Content ID */
    id: string;
    /** Content title */
    title: string;
    /** Thumbnail URL (optional) */
    thumbnailUrl?: string;
    /** Content type (video, audio, etc.) */
    contentType: string;
  };
}
