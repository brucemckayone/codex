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
