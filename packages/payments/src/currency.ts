/**
 * The platform takes and pays out GBP only. Every transfer is created in
 * `CURRENCY.GBP`, so money that arrives in another currency would be paid
 * out as if it were pounds. Each payment path calls this before it records
 * a split (Codex-2hxff.23 PAY-25 for purchases; invoices and the drains
 * already did). Cross-currency support is Codex-yv18n.
 */

import { CURRENCY } from '@codex/constants';
import { UnsupportedCurrencyError } from '@codex/service-errors';

/**
 * Throw `UnsupportedCurrencyError` unless `currency` is GBP (any case).
 *
 * `null`/`undefined` means the Stripe object carried no currency and is let
 * through, as the subscription paths always did: the ledger's own default is
 * 'gbp'. The error is a 400, so a webhook treats it as permanent and Stripe
 * does not redeliver.
 */
export function assertGbpOnly(
  currency: string | null | undefined,
  context: Record<string, unknown>
): void {
  if (!currency) return;
  const normalised = currency.toLowerCase();
  if (normalised === CURRENCY.GBP) return;
  throw new UnsupportedCurrencyError(normalised, [CURRENCY.GBP], context);
}
