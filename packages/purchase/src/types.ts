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
  /** Currency code (default: 'usd') */
  currency?: string;
}

/**
 * Revenue split calculation result
 * Re-exported from revenue-calculator for convenience
 */
export type { RevenueSplit } from './services/revenue-calculator';
