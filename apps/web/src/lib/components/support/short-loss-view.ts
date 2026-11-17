/**
 * What the charge page says about a blocked payment owed what Stripe won't
 * refund (`ChargeDetail.shortLoss`; owner D59-D64; mockup
 * docs/handover/phase3-sources/pause-trials/support-short-loss.html, S1-S5,
 * A1-A4), and what "Paid another way" says once it has an answer.
 *
 * Owed after a chargeback lost for less than the payment (`short`), or again
 * after support paid the rest and the chargeback was won late
 * (`owed_again`). Support pays it outside Stripe and marks it on the charge
 * page, at its stage. Every answer but one that may not have saved, or a
 * session that ended, closes the dialog with one of these notices, and the
 * page reloads the charge.
 */

import type {
  ChargeShortLoss,
  NotOwedAfterLossReason,
  OwedAgainAfterLateWin,
  PaidAnotherWayResult,
} from '@codex/admin';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { SettleNotice } from './settle-notice';
import { formatDay } from './support-format';

/** When it was marked paid another way at its stage (the second mark once owed again), or null. */
export function shortLossMarkedOn(shortLoss: ChargeShortLoss): string | null {
  return shortLoss.stage === 'owed_again'
    ? shortLoss.paidAgainOn
    : shortLoss.paidAnotherWayOn;
}

/** Owed again's words: what was paid, when, and what was refunded through Stripe. */
function owedAgainWords(shortLoss: OwedAgainAfterLateWin) {
  return {
    lost: formatPrice(shortLoss.lostCents),
    owed: formatPrice(shortLoss.owedCents),
    paid: formatPrice(shortLoss.paidAnotherWayCents),
    date: formatDay(shortLoss.paidAnotherWayOn),
    refunded: formatPrice(shortLoss.refundedThroughStripeCents),
  };
}

type OwedAgainBody = (
  words: ReturnType<typeof owedAgainWords> & { amount: string }
) => string;

/** Owed again's alert body, by kind, and with a refund through Stripe or none (A1, A4). */
const OWED_AGAIN_BODY: Record<
  ChargeShortLoss['kind'],
  { plain: OwedAgainBody; refunded: OwedAgainBody }
> = {
  unavailable: {
    plain: (words) => m.support_owed_again_body_unavailable(words),
    refunded: (words) => m.support_owed_again_refunded_unavailable(words),
  },
  duplicate: {
    plain: (words) => m.support_owed_again_body_duplicate(words),
    refunded: (words) => m.support_owed_again_refunded_duplicate(words),
  },
};

/**
 * The refund card's alert while it is owed, in place of the block: what is
 * owed and why, and how the amounts add up (S1, A1, A4). `amountCents` is
 * what the buyer paid.
 */
export function shortLossAlert(
  shortLoss: ChargeShortLoss,
  amountCents: number
): { lead: string; body: string } {
  const amount = formatPrice(amountCents);
  if (shortLoss.stage === 'owed_again') {
    const words = { ...owedAgainWords(shortLoss), amount };
    const body = OWED_AGAIN_BODY[shortLoss.kind];
    return {
      lead: m.support_owed_again_lead(words),
      body: (shortLoss.refundedThroughStripeCents > 0
        ? body.refunded
        : body.plain)(words),
    };
  }
  const words = {
    amount,
    lost: formatPrice(shortLoss.lostCents),
    owed: formatPrice(shortLoss.owedCents),
  };
  return {
    lead: m.support_short_loss_lead(words),
    body:
      shortLoss.kind === 'duplicate'
        ? m.support_short_loss_body_duplicate(words)
        : m.support_short_loss_body_unavailable(words),
  };
}

/** The line under the refunded-outside-Stripe block once marked at its stage (S3, A3), or null. */
export function shortLossPaidNote(shortLoss: ChargeShortLoss): string | null {
  if (shortLoss.stage === 'owed_again') {
    if (!shortLoss.paidAgainOn) return null;
    return m.support_owed_again_paid_note({
      ...owedAgainWords(shortLoss),
      date2: formatDay(shortLoss.paidAgainOn),
    });
  }
  if (!shortLoss.paidAnotherWayOn) return null;
  return m.support_short_loss_paid_note({
    lost: formatPrice(shortLoss.lostCents),
    owed: formatPrice(shortLoss.owedCents),
  });
}

/** The charge card's Amount line: where the money went, and what is owed (S1, S3, A1, A3). */
export function shortLossAmountLine(
  shortLoss: ChargeShortLoss,
  amountCents: number
): string {
  const amount = formatPrice(amountCents);
  if (shortLoss.stage === 'owed_again') {
    const words = { ...owedAgainWords(shortLoss), amount };
    return shortLoss.paidAgainOn
      ? m.support_amount_paid_again({
          ...words,
          date2: formatDay(shortLoss.paidAgainOn),
        })
      : m.support_amount_owed_again(words);
  }
  const words = {
    amount,
    lost: formatPrice(shortLoss.lostCents),
    owed: formatPrice(shortLoss.owedCents),
  };
  return shortLoss.paidAnotherWayOn
    ? m.support_amount_short_loss_paid({
        ...words,
        date: formatDay(shortLoss.paidAnotherWayOn),
      })
    : m.support_amount_short_loss_owed(words);
}

/** One line of the confirm's facts. */
export interface PaidAnotherWayFact {
  label: string;
  amountCents: number;
  /** The last line: what is owed, to pay another way. */
  owed: boolean;
}

/**
 * The confirm's facts, which add up to what is owed (S2, A2, A4): what the
 * buyer paid (`paidCents`), then what the bank returned, or, owed again,
 * what was refunded through Stripe (only when there is any) and what the
 * first mark paid another way; last, what is owed.
 */
export function paidAnotherWayFacts(
  shortLoss: ChargeShortLoss,
  paidCents: number
): PaidAnotherWayFact[] {
  const paid = {
    label: m.support_short_loss_fact_paid(),
    amountCents: paidCents,
    owed: false,
  };
  if (shortLoss.stage === 'short') {
    return [
      paid,
      {
        label: m.support_short_loss_fact_lost(),
        amountCents: shortLoss.lostCents,
        owed: false,
      },
      {
        label: m.support_short_loss_fact_owed(),
        amountCents: shortLoss.owedCents,
        owed: true,
      },
    ];
  }
  const refunded =
    shortLoss.refundedThroughStripeCents > 0
      ? [
          {
            label: m.support_owed_again_fact_refunded(),
            amountCents: shortLoss.refundedThroughStripeCents,
            owed: false,
          },
        ]
      : [];
  return [
    paid,
    ...refunded,
    {
      label: m.support_owed_again_fact_paid_before({
        date: formatDay(shortLoss.paidAnotherWayOn),
      }),
      amountCents: shortLoss.paidAnotherWayCents,
      owed: false,
    },
    {
      label: m.support_owed_again_fact_owed(),
      amountCents: shortLoss.owedCents,
      owed: true,
    },
  ];
}

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
