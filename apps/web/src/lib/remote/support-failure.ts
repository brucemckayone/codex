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
 * Anything but an `ApiError` had no answer behind it: the fetch to admin-api
 * threw (a dropped connection) or the success body would not parse, so the
 * worker may still have acted. Returning it skips the `handleError` hook a
 * throw would reach, so it is logged here, as `toCommandFailure` does
 * (subscription.remote.ts, Codex-2hxff.66): the command, the ids it acted
 * on, the status and the error's name. Never the error's text: a parse
 * error quotes the body, which can name a person.
 *
 * A plain module, not part of the `.remote.ts` file, so it can be tested
 * without `$app/server`.
 */

import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';

export interface SupportCommandFailure {
  /** A string discriminant: apps/web has strictNullChecks off. */
  outcome: 'failed';
  status: number;
  /** The worker's top-level code, often a class code such as `CONFLICT`. */
  code: string | null;
  /** The worker's `details.code`: the support error's own code. */
  detailsCode: string | null;
  /**
   * The worker's text, for a 4xx only: a 5xx may carry internals. No page
   * shows it: each words a refusal from its codes in en.json (W4), so a
   * change to a service's message can't change support's screen.
   */
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
  /**
   * `REPAY_BLOCKED_BY_LATER_CAUSE`: `chargeback` or `later_refunds`.
   * `PRICE_MOVE_NOT_HELD`: why there is nothing to retry or close.
   */
  reason: string | null;
  /** `PRICE_MOVE_NOT_HELD` `skipped`: why the run set it aside, such as `moving_away`. */
  skipReason: string | null;
  /** `PRICE_MOVE_NOT_HELD` `resolved`: how support closed it, such as `moved_by_hand`. */
  resolution: string | null;
  /** `PRICE_MOVE_NOT_HELD` `superseded`: when the newer price was saved (ISO). */
  supersededAt: string | null;
  /** `FEE_CHANGE_NOT_WAITING`: `cancelled`, `cut_below_today` or `replaced_by_bigger`. */
  voidReason: string | null;
  /** `FEE_CHANGE_NOT_WAITING`: when the rise was called off (ISO). */
  voidedAt: string | null;
  /** `FEE_NOTICE_ALREADY_TOLD`: `sent` or `told_another_way`. */
  state: string | null;
  /** `FEE_NOTICE_ALREADY_TOLD`: when they were marked told (ISO). */
  toldAt: string | null;
  /** `FEE_NOTICE_ALREADY_TOLD`: when their email went through (ISO). */
  acceptedAt: string | null;
  /** `FEE_NOTICE_ALREADY_TOLD`: who marked them told, by name. */
  toldByName: string | null;
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

/**
 * `commandName` and `ids` name the command and what it acted on, for the
 * no-answer log line only: ids, never an email or a note.
 */
export function toSupportFailure(
  error: unknown,
  commandName: string,
  ids: Record<string, string>
): SupportCommandFailure {
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
      skipReason: field(details, 'skipReason', 'string'),
      resolution: field(details, 'resolution', 'string'),
      supersededAt: field(details, 'supersededAt', 'string'),
      voidReason: field(details, 'voidReason', 'string'),
      voidedAt: field(details, 'voidedAt', 'string'),
      state: field(details, 'state', 'string'),
      toldAt: field(details, 'toldAt', 'string'),
      acceptedAt: field(details, 'acceptedAt', 'string'),
      toldByName: field(details, 'toldByName', 'string'),
    };
  }
  logger.error(`support command ${commandName} failed with no API answer`, {
    ...ids,
    status: 500,
    errorName: error instanceof Error ? error.name : typeof error,
  });
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
    skipReason: null,
    resolution: null,
    supersededAt: null,
    voidReason: null,
    voidedAt: null,
    state: null,
    toldAt: null,
    acceptedAt: null,
    toldByName: null,
  };
}
