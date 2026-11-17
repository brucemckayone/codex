/**
 * What "Paid another way" says once it has an answer (owner D61; mockup
 * docs/handover/phase3-sources/pause-trials/support-short-loss.html, S3-S5).
 *
 * A blocked payment whose chargeback was lost for less than the payment
 * leaves the buyer owed the rest (`ChargeDetail.shortLoss`). Support pays it
 * outside Stripe and marks it on the charge page. Every answer but one that
 * may not have saved, or a session that ended, closes the dialog with one of
 * these notices, and the page reloads the charge.
 */

import type {
  NotOwedAfterLossReason,
  PaidAnotherWayResult,
} from '@codex/admin';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { SettleNotice } from './settle-notice';
import { formatDay } from './support-format';

/** The mark was saved, or had been already (a repeat is a success). */
function paidAnotherWayNotice(
  result: PaidAnotherWayResult,
  buyer: string
): SettleNotice {
  const date = formatDay(result.paidAnotherWayOn);
  if (result.alreadyMarked) {
    return {
      variant: 'info',
      lead: m.support_short_loss_already_lead(),
      text: m.support_short_loss_already({ date }),
    };
  }
  return {
    variant: 'success',
    lead: m.support_short_loss_done_lead(),
    text: m.support_short_loss_done({
      owed: formatPrice(result.owedCents),
      buyer,
      date,
    }),
  };
}

/**
 * `NOT_OWED_AFTER_LOSS`'s reasons, worded. Read by any string, since the
 * answer's `reason` is one: a reason this page doesn't know is no notice.
 */
const NOT_OWED: ReadonlyMap<string, () => string> = new Map<
  NotOwedAfterLossReason,
  () => string
>([
  ['not_short', () => m.support_short_loss_refused_not_short()],
  ['no_lost_dispute', () => m.support_short_loss_refused_no_lost_dispute()],
  ['not_blocked', () => m.support_short_loss_refused_not_blocked()],
]);

/**
 * A refusal that closes the dialog: what's owed changed since the page loaded
 * (412 `SHORT_LOSS_CHANGED`), or nothing is owed after the loss any more (422
 * `NOT_OWED_AFTER_LOSS`, by its reason). Null for anything else: the dialog
 * keeps it as its own problem.
 */
function paidAnotherWayRefusal(
  answer: SupportCommandFailure
): SettleNotice | null {
  if (answer.detailsCode === 'SHORT_LOSS_CHANGED') {
    return {
      variant: 'warning',
      lead: m.support_short_loss_changed_lead(),
      text: m.support_short_loss_changed(),
    };
  }
  if (answer.detailsCode === 'NOT_OWED_AFTER_LOSS') {
    const words = NOT_OWED.get(answer.reason ?? '');
    return words ? { variant: 'warning', text: words() } : null;
  }
  return null;
}

/** What the dialog keeps open to say: sign in again, or try again. */
export type PaidAnotherWayProblem = 'session_ended' | 'failed';

/**
 * What an answer does: a notice for the page, and the dialog closes, or a
 * problem the dialog keeps. A 401 or a 403 is a session that ended; any
 * other refusal with no notice (a 5xx: it may not have saved) is `failed`,
 * and Try again sends the same mark, which is safe since a repeat succeeds.
 */
export function paidAnotherWayOutcome(
  answer:
    | { outcome: 'done'; result: PaidAnotherWayResult }
    | SupportCommandFailure,
  buyer: string
): { notice: SettleNotice } | { problem: PaidAnotherWayProblem } {
  if (answer.outcome === 'done') {
    return { notice: paidAnotherWayNotice(answer.result, buyer) };
  }
  const notice = paidAnotherWayRefusal(answer);
  if (notice) return { notice };
  return {
    problem:
      answer.status === 401 || answer.status === 403
        ? 'session_ended'
        : 'failed',
  };
}
