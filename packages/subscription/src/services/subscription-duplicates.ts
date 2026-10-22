/**
 * A second subscription to an org, or to a course plan, the user already
 * subscribes to (Codex-2hxff.15; owner decision 2026-10-22, "Keep the
 * first"). Stripe made and charged it before anything of ours could refuse
 * it: two payment pages paid before either subscription existed.
 *
 * The newcomer is recorded as a duplicate (`duplicate_of_*`, status
 * `cancelled`), so it grants, pays and emails nothing. It is then cancelled
 * at Stripe at once with no proration, and every payment it took is refunded
 * in full. Each refund's own `charge.refunded` sends the buyer the one email
 * ("you were already subscribed"). Cancelling comes first, so that event
 * finds the subscription already ended and cancels nothing else.
 */

import { issueRefund, resolveInvoiceCharge } from '@codex/payments';
import { InternalServiceError } from '@codex/service-errors';
import type Stripe from 'stripe';

/** A tier subscription row or a course-plan one. */
type DuplicateMarked =
  | { duplicateOfSubscriptionId: string | null }
  | { duplicateOfCourseSubscriptionId: string | null };

export function isDuplicateSubscription(row: DuplicateMarked): boolean {
  return (
    ('duplicateOfSubscriptionId' in row
      ? row.duplicateOfSubscriptionId
      : row.duplicateOfCourseSubscriptionId) != null
  );
}

/**
 * Cancel the duplicate at Stripe and refund every payment it took. Safe to
 * repeat: an ended subscription is not cancelled again, each refund is keyed
 * by its invoice, and a charge already refunded counts as done. Any failure
 * is thrown; the caller makes it retryable and leaves the row unsettled.
 */
export async function cancelAndRefundDuplicate(
  stripe: Stripe,
  params: { stripeSubscriptionId: string; environment: string }
): Promise<{ refundedInvoices: number }> {
  const { stripeSubscriptionId, environment } = params;
  const live = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  if (live.status !== 'canceled' && live.status !== 'incomplete_expired') {
    await stripe.subscriptions.cancel(
      stripeSubscriptionId,
      {
        prorate: false,
        cancellation_details: {
          comment: 'Duplicate subscription: the user already subscribed',
        },
      },
      { idempotencyKey: `dup_cancel_${stripeSubscriptionId}` }
    );
  }

  // A duplicate caught at its first event has one paid invoice; one that
  // slipped through before this fix may have renewed.
  const paid = await stripe.invoices.list({
    subscription: stripeSubscriptionId,
    status: 'paid',
    limit: 100,
  });
  let refundedInvoices = 0;
  for (const invoice of paid.data) {
    if (!invoice.id || invoice.amount_paid <= 0) continue;
    const chargeId = await resolveInvoiceCharge(stripe, invoice);
    if (!chargeId) {
      throw new InternalServiceError(
        'A paid invoice of a duplicate subscription has no charge to refund',
        { stripeSubscriptionId, invoiceId: invoice.id }
      );
    }
    await issueRefund(stripe, {
      chargeId,
      reason: 'duplicate',
      idempotencyKey: `refund_duplicate_${invoice.id}`,
      environment,
    });
    refundedInvoices++;
  }
  return { refundedInvoices };
}
