/**
 * What the charge page shows after support presses Refund (Codex-2hxff.28,
 * mockup B3 and the error table in data design §1).
 *
 * The support errors are told apart by `details.code`, never by the
 * top-level class code: `CHARGE_CHANGED` (412), `STRIPE_REFUSED` (422) and
 * `REFUND_WINDOW_CLOSED` (422) would otherwise be indistinguishable from each
 * other's neighbours under `PRECONDITION_FAILED` / `BUSINESS_LOGIC_ERROR`.
 */

import type { RefundPreview, SupportRefundResult } from '@codex/admin';
import type { SupportCommandFailure } from '$lib/remote/support-failure';

/** What `issueSupportRefund` answers. */
export type IssueRefundAnswer =
  | { outcome: 'done'; result: SupportRefundResult }
  | SupportCommandFailure;

export type RefundOutcome =
  /** Stripe made it: `pending`, `succeeded`, or (rarely, at once) `failed`. */
  | {
      kind: 'made';
      refund: SupportRefundResult['refund'];
      preview: RefundPreview;
    }
  /** The same decision was already made: nothing new was refunded. */
  | { kind: 'replayed'; refund: SupportRefundResult['refund'] }
  /** Someone refunded it meanwhile; the page reloads it. */
  | { kind: 'changed'; seenRefundIds: string[] }
  | { kind: 'refused'; stripeCode: string }
  | { kind: 'window_closed'; closesAt: string | null }
  | { kind: 'chargeback'; disputeStatus: string | null }
  | { kind: 'nothing_left' }
  | { kind: 'too_large'; maxCents: number | null }
  | { kind: 'already_submitted' }
  /** Anything else, a 5xx included: Stripe may not have answered. */
  | { kind: 'failed' };

export type RefundOutcomeKind = RefundOutcome['kind'];

export function refundOutcomeOf(
  answer: IssueRefundAnswer,
  context: { preview: RefundPreview; seenRefundIds: string[] }
): RefundOutcome {
  if (answer.outcome === 'done') {
    return answer.result.replayed
      ? { kind: 'replayed', refund: answer.result.refund }
      : {
          kind: 'made',
          refund: answer.result.refund,
          preview: context.preview,
        };
  }
  switch (answer.detailsCode) {
    case 'CHARGE_CHANGED':
      return { kind: 'changed', seenRefundIds: context.seenRefundIds };
    case 'STRIPE_REFUSED':
      return { kind: 'refused', stripeCode: answer.stripeCode ?? 'unknown' };
    case 'REFUND_WINDOW_CLOSED':
      return { kind: 'window_closed', closesAt: answer.closesAt };
    case 'CHARGE_HAS_CHARGEBACK':
      return { kind: 'chargeback', disputeStatus: answer.disputeStatus };
    case 'NOTHING_LEFT_TO_REFUND':
      return { kind: 'nothing_left' };
    case 'REFUND_AMOUNT_TOO_LARGE':
      return { kind: 'too_large', maxCents: answer.maxCents };
    case 'REFUND_ALREADY_SUBMITTED':
      return { kind: 'already_submitted' };
    default:
      return { kind: 'failed' };
  }
}

/**
 * The outcomes after which what the page shows is known to be out of date, so
 * it reloads the charge once (Q10). The others offer "Reload the charge":
 * Stripe refused, or never answered, and nothing changed.
 */
export function reloadsCharge(outcome: RefundOutcome): boolean {
  return !['refused', 'already_submitted', 'failed'].includes(outcome.kind);
}

/** A refund exists, so the queue's counts may have moved with it. */
export function refreshesCounts(outcome: RefundOutcome): boolean {
  return outcome.kind === 'made' || outcome.kind === 'replayed';
}

/**
 * Pounds as typed (`7.50`, `£7.5`, `1,000`) to pence, or null when it is not
 * an amount. String arithmetic, not `parseFloat`, so `7.29` is 729p exactly.
 */
export function parsePounds(text: string): number | null {
  const value = text.replace(/[£,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const pence =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(pence) ? pence : null;
}
