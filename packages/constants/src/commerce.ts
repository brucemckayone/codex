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

export const PURCHASE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  INCOMPLETE: 'incomplete',
  PAUSED: 'paused',
} as const;

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
} as const;

export const CURRENCY = {
  GBP: 'gbp',
  USD: 'usd',
  EUR: 'eur',
} as const;
