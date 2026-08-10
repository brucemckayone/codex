/**
 * Shared Stripe Connect readiness signal for monetisation UI surfaces.
 *
 * The backend hard-gates taking money on Connect readiness — e.g.
 * TierService.requireActiveConnect throws ConnectAccountNotReadyError (HTTP 422)
 * unless the resolved Connect account has BOTH `chargesEnabled` and
 * `payoutsEnabled`. This helper mirrors that gate on the frontend so studio
 * surfaces (tier creation, subscribers empty-state, …) can block/prompt
 * proactively instead of surfacing an opaque "failed to save" error only on
 * submit.
 *
 * Keep this the single definition of "ready to take money" so every surface
 * stays consistent with the backend.
 */
export interface ConnectReadinessStatus {
  isConnected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: string | null;
  /**
   * True when the live Stripe requirements fetch FAILED. Distinguishes "no
   * outstanding requirements" from "we couldn't check right now" — without it a
   * surface renders an implied all-clear over a status it never verified.
   * Optional for backward-compat with older payloads.
   */
  requirementsFetchFailed?: boolean;
}

/**
 * True when the Connect account is fully able to take money: connected,
 * charges + payouts enabled, and the account status is `active`.
 */
export function isConnectReady(status: ConnectReadinessStatus): boolean {
  return (
    status.isConnected &&
    status.chargesEnabled &&
    status.payoutsEnabled &&
    status.status === 'active'
  );
}

/**
 * Every state a money surface needs to distinguish, as STRING discriminants.
 *
 * String, not boolean-literal, discriminants: `apps/web` compiles with
 * `strictNullChecks` OFF, where boolean-literal discriminants do not narrow a
 * union. A `state === 'stripe_missing'` check narrows; a `blocked === true`
 * check silently does not.
 *
 * The `stripe_*` members mean "money physically cannot move". The remaining
 * members mean "the rails work, but there is nothing to sell / nobody buying".
 */
export type MoneyReadinessState =
  | 'stripe_missing'
  | 'stripe_incomplete'
  | 'stripe_restricted'
  | 'stripe_disabled'
  | 'stripe_unknown'
  | 'no_tiers'
  | 'no_subscribers'
  | 'ready';

export interface MoneyReadiness {
  state: MoneyReadinessState;
  /**
   * True only when money DEFINITIVELY cannot move: no account, an unfinished
   * one, or one Stripe has restricted/disabled. Drives whether a surface warns
   * ABOVE its content rather than only inside an empty state — the case this
   * helper exists for is an org with real subscribers and no payout account,
   * where the list is NOT empty and every surface used to stay silent.
   *
   * `stripe_unknown` is deliberately NOT blocking. It means "we could not reach
   * Stripe to check", which is an advisory about our own knowledge, not a
   * verdict about the account. Conflating the two told of-blood-and-bones — an
   * org with an active account, charges and payouts all enabled — to "set up
   * payments before you can be paid", because its seeded `acct_local_dev_obab`
   * cannot be verified against the real Stripe API and so reports
   * `requirementsFetchFailed`. A surface that wants to show the advisory must
   * test for `state === 'stripe_unknown'` explicitly.
   */
  blocking: boolean;
  /** Alert variant. Only ever a `status.css`-derived semantic, never a tint. */
  tone: 'error' | 'warning' | 'info' | 'success';
  /** Whether the org has people paying it right now. Selects the copy. */
  hasSubscribers: boolean;
}

export interface MoneyReadinessContext {
  hasTiers: boolean;
  subscriberCount: number;
}

/**
 * Resolve one money-readiness verdict from Connect status + org context.
 *
 * ORDER IS LOAD-BEARING. Every `stripe_*` state resolves before `no_tiers`,
 * because an org with no Stripe account and no tiers is blocked on Stripe, not
 * on tiers — telling it to "add a tier" sends it to a disabled button. The
 * hard-stop states (`disabled`, `restricted`) resolve before `stripe_unknown`,
 * because a known block is more actionable than an unverified one.
 */
export function moneyReadiness(
  status: ConnectReadinessStatus,
  { hasTiers, subscriberCount }: MoneyReadinessContext
): MoneyReadiness {
  const hasSubscribers = subscriberCount > 0;
  /** The states in which money definitively cannot move. */
  const BLOCKING = new Set<MoneyReadinessState>([
    'stripe_missing',
    'stripe_incomplete',
    'stripe_restricted',
    'stripe_disabled',
  ]);

  const of = (
    state: MoneyReadinessState,
    tone: MoneyReadiness['tone']
  ): MoneyReadiness => ({
    state,
    tone,
    blocking: BLOCKING.has(state),
    hasSubscribers,
  });

  // No row at all — nothing has ever been started.
  if (!status.isConnected) return of('stripe_missing', 'warning');

  // Stripe has actively switched the account off. `isConnected` is true for a
  // disabled account, so without this branch it fell through to the neutral
  // "Not connected" label while the button offered to "Continue Setup".
  if (status.status === 'disabled') return of('stripe_disabled', 'error');
  if (status.status === 'restricted') return of('stripe_restricted', 'error');

  // Connected but not cleared to take money: mid-onboarding, or charges /
  // payouts still switched off.
  if (!isConnectReady(status)) return of('stripe_incomplete', 'warning');

  // Ready as far as we know — but we failed to verify against Stripe, so say
  // so rather than implying an all-clear we never confirmed.
  if (status.requirementsFetchFailed) return of('stripe_unknown', 'info');

  if (!hasTiers) return of('no_tiers', 'info');
  if (!hasSubscribers) return of('no_subscribers', 'info');
  return of('ready', 'success');
}
