/**
 * Purchase Service Types
 *
 * Type definitions for purchase operations and responses.
 */

import type {
  Content,
  Course,
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
 * Purchase with the bought item's details (joined query result). A purchase
 * targets exactly one of content or a course, so exactly one is non-null.
 */
export interface PurchaseWithItem extends Purchase {
  /** `null` for a course purchase. */
  content: Pick<
    Content,
    'id' | 'title' | 'slug' | 'thumbnailUrl' | 'contentType'
  > | null;
  /** `null` for a content purchase. */
  course: Pick<Course, 'id' | 'title' | 'slug'> | null;
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
  /**
   * When the customer paid — the webhook event's `created`, which a redelivery
   * keeps. Becomes `purchasedAt`, the instant the org payee resolves at, so a
   * late or retried webhook after an ownership transfer still pays the owner at
   * the sale (Codex-2hxff.2). The agreement resolves at `offerAt` when given.
   * Defaults to now.
   */
  paidAt?: Date;
  /**
   * When the checkout session was created: the moment the buyer was offered
   * the item at its price. The creator's agreement resolves here, not at
   * payment (owner decision 2026-10-21, Codex-2hxff.64 Q1): a checkout opened
   * before the creator was removed, and paid after, keeps the split they held
   * when it started. Defaults to `paidAt`.
   */
  offerAt?: Date;
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
  /** When the customer paid — see {@link CompletePurchaseMetadata.paidAt}. */
  paidAt?: Date;
  /** When the checkout started — see {@link CompletePurchaseMetadata.offerAt}. */
  offerAt?: Date;
}

/**
 * Purchase list item for account payment history: content AND course
 * purchases. `kind` says which pair is set; the other pair is `null`.
 */
export interface PurchaseListItem {
  id: string;
  customerId: string;
  createdAt: string; // ISO 8601 timestamp
  kind: 'content' | 'course';
  contentId: string | null;
  contentTitle: string | null;
  courseId: string | null;
  courseTitle: string | null;
  amountCents: number;
  status: 'completed' | 'pending' | 'failed' | 'refunded';
  /**
   * ISO 8601: when a chargeback on this payment opened (Codex-2hxff.60). A
   * dispute is open while `status` is still `'completed'`. A win clears it; a
   * loss keeps it on a row that is now `'refunded'`.
   */
  disputedAt: string | null;
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
 * - `refundedCents` is the sum of `refundAmountCents`: refunded rows, and
 *   completed rows a partial refund left completed (P-1)
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
 * The charge behind a checkout's PaymentIntent, as the payouts pipeline needs
 * it (`PurchaseService.retrievePaymentIntentCharge`).
 */
export interface PaymentIntentCharge {
  /** `latest_charge`: every payout slice's `source_transaction`. */
  stripeChargeId: string | null;
  /** The application fee Stripe was told to collect, for reconciliation. */
  stripeApplicationFeeCents: number | null;
  /** When the charge was made, when the lookup expanded it. */
  chargedAt?: Date;
}

/**
 * Where a checkout session stands, from Stripe's session and our purchase row
 * for it together (Codex-2hxff.22). The success page acts on this alone:
 * Stripe's `complete` only says the buyer paid, not that we recorded it.
 *
 * - `open` / `expired`: Stripe's own status; nothing was paid.
 * - `unpaid`: complete but not paid. Unreachable while checkout is card-only.
 * - `recording`: paid, and our row is not there yet (or is an old `pending` /
 *   `failed` one). The page asks for it to be recorded.
 * - `unlocked`: our completed, undisputed purchase.
 * - `duplicate`: a second payment for an item the buyer owns, being refunded.
 * - `refunded` / `paused`: no longer active, refunded or held by an open bank
 *   dispute. The page says so once and stops checking.
 */
export type CheckoutSessionState =
  | 'open'
  | 'expired'
  | 'unpaid'
  | 'recording'
  | 'unlocked'
  | 'duplicate'
  | 'refunded'
  | 'paused';

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
  /** Where the session stands once our record is read too. */
  state: CheckoutSessionState;
  /**
   * What Stripe says the buyer paid for the session (`amount_total`, pence),
   * once it is complete. The success page shows it while our record is on
   * its way, before `purchase` exists.
   */
  amountTotalCents?: number;
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
  /**
   * Content details (for success page display). From our row; while a
   * content session is still `recording`, from the item the session names.
   */
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
  /**
   * Course details, for a course-purchase session (the journey success page).
   * Present once our purchase row exists, as `purchase` is for content.
   */
  course?: {
    /** Course ID */
    id: string;
    /** Course title */
    title: string;
  };
  /**
   * Set when this session's payment repeated a purchase the buyer already
   * had (`duplicate_of_purchase_id`, Codex-2hxff.14). It is being refunded in
   * full, so the success page says so instead of confirming a purchase
   * (Codex-o4jvw).
   */
  duplicatePayment?: true;
}
