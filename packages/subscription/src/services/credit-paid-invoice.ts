/**
 * An invoice that customer credit paid some or all of (Codex-2hxff.97, owner
 * decision "Alert support").
 *
 * Each member has ONE Stripe customer across every organisation
 * (`users.stripe_customer_id`), so a credit left on its balance by one
 * subscription pays the next bill of any other: another tier, another org, a
 * course. The payment handlers split what the card paid (`amount_paid`), so
 * that bill's creator is paid on the card part only, and nothing when the
 * credit covers it all. Nothing here changes the split, the payouts or
 * access; it tells support, once per invoice, so a person can look.
 *
 * Once per invoice: the first alert marks the invoice at Stripe
 * (`codex_credit_alerted`), and a replayed delivery re-reads the invoice and
 * stays silent. Nothing handles `invoice.updated`, so the mark cannot loop
 * back through the webhooks. It fails toward alerting: an unreadable invoice
 * alerts, and the alert is logged before the mark is written.
 */

import { describeThrown } from '@codex/service-errors';
import type Stripe from 'stripe';

/** Invoice metadata: when the credit-paid alert went out (ISO time). */
export const CREDIT_ALERTED_KEY = 'codex_credit_alerted';

interface CreditAlertLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * The pence the customer's credit paid on this invoice: 0 for a bill the
 * card paid alone, or one with nothing to pay.
 */
export function creditCoveredCents(
  invoice: Pick<Stripe.Invoice, 'starting_balance' | 'total'>
): number {
  const startingBalance = invoice.starting_balance ?? 0;
  const total = invoice.total ?? 0;
  if (startingBalance >= 0 || total <= 0) return 0;
  return Math.min(-startingBalance, total);
}

/**
 * Log one support alert when credit paid some or all of `invoice`, then mark
 * it. Ids and amounts only. Never throws: the payment handler goes on as it
 * would without it.
 */
export async function alertIfCreditPaid(
  deps: { stripe: Stripe; obs: CreditAlertLogger },
  invoice: Stripe.Invoice,
  ids: {
    stripeSubscriptionId: string;
    subscriptionId: string | null;
    organizationId: string | null;
    kind: 'tier' | 'course';
  }
): Promise<void> {
  const covered = creditCoveredCents(invoice);
  const invoiceId = invoice.id;
  if (covered === 0 || !invoiceId) return;

  // The event's copy can predate the mark, so the live invoice is read.
  let alerted = false;
  try {
    const live = await deps.stripe.invoices.retrieve(invoiceId);
    alerted = Boolean(live.metadata?.[CREDIT_ALERTED_KEY]);
  } catch (error) {
    deps.obs.warn(
      'Could not re-read a credit-paid invoice; alerting in case this is its first delivery',
      { invoiceId, error: describeThrown(error) }
    );
  }
  if (alerted) return;

  deps.obs.error(
    'Customer credit paid a subscription invoice: its creator is paid on what the card paid, and support must review it',
    {
      errorId: crypto.randomUUID(),
      invoiceId,
      stripeSubscriptionId: ids.stripeSubscriptionId,
      subscriptionId: ids.subscriptionId,
      organizationId: ids.organizationId,
      kind: ids.kind,
      creditCoveredCents: covered,
      amountPaidCents: invoice.amount_paid,
    }
  );

  try {
    await deps.stripe.invoices.update(invoiceId, {
      metadata: { [CREDIT_ALERTED_KEY]: new Date().toISOString() },
    });
  } catch (error) {
    deps.obs.warn(
      'Could not mark a credit-paid invoice as alerted; a replay may alert again',
      { invoiceId, error: describeThrown(error) }
    );
  }
}
