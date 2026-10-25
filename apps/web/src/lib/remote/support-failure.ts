/**
 * What a support command (`support.remote.ts`) answers when the worker
 * refuses it (Codex-2hxff.28).
 *
 * The support errors put their own code under a class code: `CHARGE_CHANGED`
 * sits in `details.code` under `PRECONDITION_FAILED`, `STRIPE_REFUSED` under
 * `BUSINESS_LOGIC_ERROR`, and so on (`@codex/admin` errors.ts). A page that
 * switched on the top-level code alone could not tell "someone refunded it
 * meanwhile" from "Stripe said no", so the failure carries both, as
 * `subscription.remote.ts`'s `toCommandFailure` does.
 *
 * Only the context fields the pages show are copied, each checked for its
 * type. They are client-facing by design (a ServiceError's context is sent as
 * `details`), and hold ids, codes, counts and amounts only.
 *
 * A plain module, not part of the `.remote.ts` file, so it can be tested
 * without `$app/server`.
 */

import { ApiError } from '$lib/api/errors';

export interface SupportCommandFailure {
  /** A string discriminant: apps/web has strictNullChecks off. */
  outcome: 'failed';
  status: number;
  /** The worker's top-level code, often a class code such as `CONFLICT`. */
  code: string | null;
  /** The worker's `details.code`: the support error's own code. */
  detailsCode: string | null;
  /** The worker's text, for a 4xx only: a 5xx may carry internals. */
  message: string | null;
  /** `STRIPE_REFUSED`: Stripe's code, such as `charge_disputed`. */
  stripeCode: string | null;
  /** `REFUND_WINDOW_CLOSED`: when the window closed (ISO). */
  closesAt: string | null;
  /** `CHARGE_CHANGED`: how many refunds the charge has now. */
  refundCount: number | null;
  /** `REFUND_AMOUNT_TOO_LARGE`: what is left to refund (pence). */
  maxCents: number | null;
  /** `CHARGE_HAS_CHARGEBACK`: the dispute's current status. */
  disputeStatus: string | null;
  /** `REPAY_BLOCKED_BY_LATER_CAUSE`: `chargeback` or `later_refunds`. */
  reason: string | null;
}

function field<T extends 'string' | 'number'>(
  details: unknown,
  key: string,
  type: T
): (T extends 'string' ? string : number) | null {
  if (!details || typeof details !== 'object') return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === type
    ? (value as T extends 'string' ? string : number)
    : null;
}

export function toSupportFailure(error: unknown): SupportCommandFailure {
  if (ApiError.isApiError(error)) {
    const details = error.details;
    const isClientError = error.status >= 400 && error.status < 500;
    return {
      outcome: 'failed',
      status: error.status,
      code: error.code ?? null,
      detailsCode: field(details, 'code', 'string'),
      message: isClientError ? error.message : null,
      stripeCode: field(details, 'stripeCode', 'string'),
      closesAt: field(details, 'closesAt', 'string'),
      refundCount: field(details, 'refundCount', 'number'),
      maxCents: field(details, 'maxCents', 'number'),
      disputeStatus: field(details, 'disputeStatus', 'string'),
      reason: field(details, 'reason', 'string'),
    };
  }
  return {
    outcome: 'failed',
    status: 500,
    code: null,
    detailsCode: null,
    message: null,
    stripeCode: null,
    closesAt: null,
    refundCount: null,
    maxCents: null,
    disputeStatus: null,
    reason: null,
  };
}
