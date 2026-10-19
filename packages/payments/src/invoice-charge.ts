/**
 * The one invoice → charge resolver, shared by org-tier and course
 * subscriptions (the `invoiceCharge` seam in docs/payments/architecture.md
 * §4.3). Every invoice payout is keyed on the charge this returns: it is the
 * `source_transaction` of each transfer and the per-charge ledger key.
 *
 * It used to be written twice. The course copy read only `payment.charge`,
 * which Stripe surfaces only when the charge has no PaymentIntent — and a
 * card-paid invoice always has one, so its payment arrives as
 * `{ type: 'payment_intent', payment_intent }`. Every course-subscription
 * invoice therefore resolved no charge and recorded no payouts
 * (Codex-2hxff.50).
 */

import type Stripe from 'stripe';

/** The source-charge id on an invoice's first payment, when Stripe surfaces it. */
function extractInvoiceCharge(invoice: Stripe.Invoice): string | null {
  const charge = invoice.payments?.data?.[0]?.payment?.charge;
  return typeof charge === 'string' ? charge : null;
}

function extractInvoicePaymentIntent(invoice: Stripe.Invoice): string | null {
  const pi = invoice.payments?.data?.[0]?.payment?.payment_intent;
  return typeof pi === 'string' ? pi : null;
}

/**
 * Resolve the source charge id for a paid invoice.
 *
 * Why: Stripe 2024+ invoice payloads omit `payments.data` unless the
 * invoice is retrieved with `expand: ['payments']`. The raw webhook
 * event is an immutable snapshot, so the inline shape is almost always
 * empty in production. Without this fallback chain, no transfer is ever
 * made (Codex-zdbhg).
 *
 * Order of resolution:
 *   1. Inline `payments.data[0]` on the supplied invoice (test fixtures + cache hits)
 *   2. Retrieve the invoice with `expand: ['payments']` (canonical Stripe 2024+ path)
 *   3. If we have a payment_intent but no charge, `paymentIntents.retrieve → latest_charge`
 *   4. Final fallback: `charges.list({ payment_intent })` — rare race after PI confirmation
 */
export async function resolveInvoiceCharge(
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<string | null> {
  let chargeId = extractInvoiceCharge(invoice);
  let piId = extractInvoicePaymentIntent(invoice);

  if (!chargeId && !piId && invoice.id) {
    const expanded = await stripe.invoices.retrieve(invoice.id, {
      expand: ['payments'],
    });
    chargeId = extractInvoiceCharge(expanded);
    piId = extractInvoicePaymentIntent(expanded);
  }

  if (chargeId) return chargeId;
  if (!piId) return null;

  const pi = await stripe.paymentIntents.retrieve(piId);
  if (typeof pi.latest_charge === 'string') return pi.latest_charge;

  // Idempotency-drift invariant: charges.list returns the most recent
  // charge for this PI. We assume Stripe sets pi.latest_charge once and
  // never reassigns. If that invariant breaks (e.g., PI re-charge after
  // a failure), the chargeId resolved here could differ across webhook
  // retries → idempotency keys diverge → a transfer may be made twice.
  const charges = await stripe.charges.list({
    payment_intent: piId,
    limit: 1,
  });
  const first = charges.data?.[0];
  return typeof first?.id === 'string' ? first.id : null;
}
