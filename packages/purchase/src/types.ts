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
