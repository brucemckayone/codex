export const STRIPE_EVENTS = {
  // Purchase (Phase 1)
  CHECKOUT_COMPLETED: 'checkout.session.completed',
  // Subscription lifecycle
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  SUBSCRIPTION_PAUSED: 'customer.subscription.paused',
  SUBSCRIPTION_RESUMED: 'customer.subscription.resumed',
  SUBSCRIPTION_TRIAL_WILL_END: 'customer.subscription.trial_will_end',
  // Invoices (subscription renewals)
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  // Connect
  ACCOUNT_UPDATED: 'account.updated',
  ACCOUNT_DEAUTHORIZED: 'account.application.deauthorized',
  // Refunds
  CHARGE_REFUNDED: 'charge.refunded',
  // A refund's status changed. A refund still pending when charge.refunded
  // arrived is clawed back once this reports it succeeded or failed
  // (Codex-2hxff.8).
  REFUND_UPDATED: 'refund.updated',
  // A refund failed, possibly after it succeeded. Handled with refund.updated:
  // the clawback stands and the failure is recorded for support.
  REFUND_FAILED: 'refund.failed',
  // Disputes (treated as refunds for access purposes — purchase.disputedAt
  // is set and contentAccess is soft-deleted via processDispute)
  CHARGE_DISPUTE_CREATED: 'charge.dispute.created',
  // The rest of a dispute's life (Codex-2hxff.9): each records the dispute's
  // status, and a won or lost one is acted on once.
  CHARGE_DISPUTE_UPDATED: 'charge.dispute.updated',
  CHARGE_DISPUTE_CLOSED: 'charge.dispute.closed',
  CHARGE_DISPUTE_FUNDS_WITHDRAWN: 'charge.dispute.funds_withdrawn',
  CHARGE_DISPUTE_FUNDS_REINSTATED: 'charge.dispute.funds_reinstated',
  // Dashboard-drift detection + sync-back: tier metadata edited outside
  // Codex (e.g. in Stripe Dashboard) mirrors back into subscriptionTiers.
  // product.updated → mirror name/description.
  // price.created   → adopt as canonical for the tier+interval, archive old.
  // price.updated   → log-only (archive-without-replacement is operator drift).
  // Q1 product decision: Dashboard editing is in-bounds and auto-propagates.
  PRODUCT_UPDATED: 'product.updated',
  PRICE_CREATED: 'price.created',
  PRICE_UPDATED: 'price.updated',
} as const;

/**
 * Stripe dispute statuses, grouped by what they mean here (Codex-2hxff.9;
 * docs/payments/dispute-record.md).
 *
 * - An INQUIRY takes no money: it holds the sale's unpaid payouts, nothing more
 *   (owner decision Q1).
 * - An open CHARGEBACK has taken the disputed amount: paid slices are reversed
 *   by its share, unpaid ones held.
 * - CLOSED is final. `won` is paid back, `lost` keeps the reversals and
 *   cancels the held slices; an inquiry that closed or was prevented took
 *   nothing.
 */
export const DISPUTE_INQUIRY_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
] as const;
export const DISPUTE_CHARGEBACK_OPEN_STATUSES = [
  'needs_response',
  'under_review',
] as const;
export const DISPUTE_CLOSED_STATUSES = [
  'won',
  'lost',
  'warning_closed',
  'prevented',
] as const;

/**
 * The Stripe metadata key naming the environment that created an object — the
 * worker's `ENVIRONMENT` (`production`, `development`, `test`).
 *
 * Production and local development share ONE Stripe sandbox, so both receive
 * every event. Each environment tags what it creates and ignores events about
 * what another environment created (docs/payments/operations.md → Environments
 * and Stripe accounts; Codex-2hxff.5).
 */
export const STRIPE_ENV_METADATA_KEY = 'codex_env';

/** `{ codex_env: environment }` — spread into the metadata of every Stripe object we create. */
export function stripeEnvMetadata(environment: string): Record<string, string> {
  return { [STRIPE_ENV_METADATA_KEY]: environment };
}

/**
 * True only when `metadata` names a DIFFERENT environment.
 *
 * Untagged is NOT foreign: every object created before tagging began — every
 * existing subscription among them — carries no tag, and treating it as foreign
 * would silently stop production renewals. So: tagged AND different.
 */
export function isForeignStripeEnvironment(
  metadata: Readonly<Record<string, string>> | null | undefined,
  environment: string
): boolean {
  const tag = metadata?.[STRIPE_ENV_METADATA_KEY];
  return typeof tag === 'string' && tag !== '' && tag !== environment;
}

/**
 * The metadata key on a support refund naming its decision: the idempotency
 * key `support_refund_{charge}_{refundCount}_{amount}` (Codex-2hxff.28 §5).
 * A repeat of the same submit finds the refund by it and answers `replayed`.
 * Written by `SupportService.issueRefund` (@codex/admin).
 */
export const STRIPE_SUPPORT_KEY_METADATA_KEY = 'codex_support_key';

/**
 * The metadata key on a support refund naming who in support issued it
 * (Codex-2hxff.28, Q3). Written by `SupportService.issueRefund`; read back by
 * the refund webhook (`supportRequesterOf`, @codex/purchase) into
 * `refunds.requested_by_user_id`. A Dashboard refund carries none.
 */
export const STRIPE_REQUESTED_BY_METADATA_KEY = 'codex_requested_by';

export const PURCHASE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

/** `checkout_sessions.status` (Codex-2hxff.14). */
export const CHECKOUT_SESSION_STATUS = {
  OPEN: 'open',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
} as const;

export const CHECKOUT_SESSION_TIMING = {
  /** How long a buyer has to pay (owner decision 2026-10-21, "30 minutes"). */
  TTL_MS: 30 * 60 * 1000,
  /**
   * Added to the expiry sent to Stripe, which must be at least 30 minutes
   * after ITS creation time; ours is computed a moment earlier.
   */
  STRIPE_FLOOR_SLACK_MS: 60 * 1000,
  /** An open session with less left than this is replaced, not reused. */
  MIN_REMAINING_TO_REUSE_MS: 5 * 60 * 1000,
} as const;

/** What a reserved checkout session sells (Codex-2hxff.15). */
export const CHECKOUT_SESSION_KIND = {
  PURCHASE: 'purchase',
  SUBSCRIPTION: 'subscription',
} as const;

/**
 * How long a tier-change preview's price stands (owner decision 2026-10-22,
 * "10 min, then review again"). An older one is refused and the subscriber
 * is shown a fresh preview, so they pay what they were shown.
 */
export const TIER_CHANGE_PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * How long support can refund a payment: 14 × 24 hours from Stripe's
 * `charge.created`, so a renewal's window runs from that renewal (owner
 * decisions 2026-10-13 and 2026-10-24, Q1; Codex-2hxff.28). Only the support
 * refund route enforces it: Dashboard refunds and the platform's own
 * (duplicates, early cancels) are not support decisions. `refundWindow` in
 * @codex/payments is the one reader.
 */
export const REFUND_WINDOW_DAYS = 14;

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  INCOMPLETE: 'incomplete',
  PAUSED: 'paused',
} as const;

/**
 * The statuses under which a subscription (org tier or course plan) grants
 * access. `past_due` is one of them: a failed renewal keeps access while
 * Stripe retries the card, and access ends when Stripe cancels (owner
 * decision P-3, docs/payments/subscriptions.md#failed-payments). Every access
 * gate reads this one list, so the two subscription kinds cannot drift apart.
 */
export const ACCESS_GRANTING_SUBSCRIPTION_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.CANCELLING,
  SUBSCRIPTION_STATUS.PAST_DUE,
] as const;

/** Whether a subscription in `status` grants access (see the list above). */
export function subscriptionStatusGrantsAccess(
  status: string | null | undefined
): boolean {
  return (
    status != null &&
    (ACCESS_GRANTING_SUBSCRIPTION_STATUSES as readonly string[]).includes(
      status
    )
  );
}

/**
 * The course subscription statuses a creator's removal cancels at period end
 * (Codex-2hxff.64). `paused` is included: it still renews when resumed.
 * `cancelling` is not: it already ends. The cancel
 * (`cancelForCoursesOffSale`) and the Remove dialog's preview count both read
 * this list, so the owner is shown exactly what will be cancelled.
 */
export const OFF_SALE_CANCELLABLE_COURSE_SUBSCRIPTION_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.PAUSED,
] as const;

/**
 * Structured churn-reason taxonomy for subscription cancellation (Q7).
 *
 * Persisted on `subscriptions.churn_reason` alongside the existing free-text
 * `cancel_reason`. The 'other' option is the only value that requires the
 * free-text field to be set — all others can stand alone.
 *
 * This const is the single source of truth for the allowed values, shared
 * between the DB CHECK constraint (packages/database) and the Zod enum
 * (packages/validation) so a taxonomy change touches exactly one file.
 */
export const CHURN_REASON = {
  TOO_EXPENSIVE: 'too_expensive',
  NOT_ENOUGH_CONTENT: 'not_enough_content',
  FOUND_ALTERNATIVE: 'found_alternative',
  NOT_USING_IT: 'not_using_it',
  TECHNICAL_ISSUES: 'technical_issues',
  OTHER: 'other',
} as const;

export const CHURN_REASON_VALUES = Object.values(CHURN_REASON) as [
  string,
  ...string[],
];

export type ChurnReason = (typeof CHURN_REASON)[keyof typeof CHURN_REASON];

export const BILLING_INTERVAL = {
  MONTH: 'month',
  YEAR: 'year',
} as const;

export const CONNECT_ACCOUNT_STATUS = {
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  RESTRICTED: 'restricted',
  DISABLED: 'disabled',
} as const;

export const FEES = {
  PLATFORM_PERCENT: 1000, // 10.00% of gross
  // 10% of post-platform-fee on one-off purchases. Codex-h69cg shipped the
  // ledger row + secondary `transfers.create` that delivers this slice to the
  // org's Connect account. Override per-org via the `fee_config_org` table.
  ORG_PERCENT: 1000,
  SUBSCRIPTION_ORG_PERCENT: 1500, // 15.00% of post-platform-fee for subscriptions
  // The platform never takes less than this from a sale (owner decision
  // 2026-10-13: a £1 sale earns 10p at 10%, but Stripe charges about 21p).
  // The code default, so every environment and every fresh database applies
  // it; fee_config_platform.min_platform_fee_cents overrides it when a row
  // exists. docs/payments/fees-and-splits.md.
  MIN_PLATFORM_FEE_CENTS: 25,
} as const;

/**
 * The range every price must sit in, in pence: content, courses, tiers and
 * course subscription plans alike (owner decision 2026-10-13). Stripe refuses
 * card charges under £0.30, and at £1.00 the 25p minimum platform fee still
 * covers a UK card fee (about 1.5% + 20p). docs/payments/purchases.md.
 */
export const PRICE_LIMITS = {
  MIN_CENTS: 100, // £1.00
  MAX_CENTS: 10_000_000, // £100,000
} as const;

export const CURRENCY = {
  GBP: 'gbp',
  USD: 'usd',
  EUR: 'eur',
} as const;
