/**
 * What the charge page says about a blocked payment owed what Stripe won't
 * refund (`ChargeDetail.shortLoss`; owner D59-D71; mockup
 * docs/handover/phase3-sources/pause-trials/support-short-loss.html, S1-S5,
 * A1-A4, B3-B5), and what "Paid another way" says once it has an answer.
 *
 * Owed after a chargeback lost for less than the payment (`short`), or again
 * after support paid the rest and the chargeback was won late
 * (`owed_again`). Support pays it outside Stripe and marks it on the charge
 * page, at its stage. Owed whatever marks exist (`owedCents` above 0): each
 * mark adds what it paid (D66), and the parts what is owed adds up from are
 * named, each only when there is one (B3). Marked with nothing owed, the
 * page shows one total paid another way with its dates (D68). Every answer
 * but one that may not have saved, or a session that ended, closes the
 * dialog with one of these notices, and the page reloads the charge.
 */

import type {
  ChargeShortLoss,
  NotOwedAfterLossReason,
  OwedAgainAfterLateWin,
  PaidAnotherWayResult,
  ShortAfterLoss,
} from '@codex/admin';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { SettleNotice } from './settle-notice';
import { formatDay } from './support-format';

/** Something is owed now, at its stage: the alert and the action show, whatever marks exist (D66). */
export function shortLossOwes(shortLoss: ChargeShortLoss): boolean {
  return shortLoss.owedCents > 0;
}

/** Sentences, one after another. */
function sentences(parts: ReadonlyArray<string | null>): string {
  return parts
    .filter((part): part is string => part !== null)
    .reduce((first, second) => m.support_sentences_two({ first, second }));
}

/** When each stage was marked, as the brackets list them (D68): the first, then the second. */
function markDates(...isoDates: ReadonlyArray<string | null>): string {
  const [first, second] = isoDates
    .filter((iso): iso is string => iso !== null)
    .map((iso) => formatDay(iso));
  if (first === undefined) return '';
  return second === undefined
    ? first
    : m.support_paid_another_way_dates({ first, second });
}

/** Owed again's words: what was paid, when, and what came back. */
function owedAgainWords(shortLoss: OwedAgainAfterLateWin) {
  return {
    lost: formatPrice(shortLoss.lostCents),
    owed: formatPrice(shortLoss.owedCents),
    paid: formatPrice(shortLoss.paidAnotherWayCents),
    date: formatDay(shortLoss.paidAnotherWayOn),
    refunded: formatPrice(shortLoss.refundedThroughStripeCents),
    elsewhere: formatPrice(shortLoss.refundedElsewhereCents),
  };
}

type OwedAgainBody = (
  words: ReturnType<typeof owedAgainWords> & { amount: string }
) => string;

/**
 * Owed again's alert body, by kind, and by what has come back besides: a
 * refund through Stripe (A4), one settled refunded another way (D66), both,
 * or neither (A1).
 */
const OWED_AGAIN_BODY: Record<
  ChargeShortLoss['kind'],
  Record<'plain' | 'refunded' | 'elsewhere' | 'both', OwedAgainBody>
> = {
  unavailable: {
    plain: (words) => m.support_owed_again_body_unavailable(words),
    refunded: (words) => m.support_owed_again_refunded_unavailable(words),
    elsewhere: (words) => m.support_owed_again_elsewhere_unavailable(words),
    both: (words) => m.support_owed_again_both_unavailable(words),
  },
  duplicate: {
    plain: (words) => m.support_owed_again_body_duplicate(words),
    refunded: (words) => m.support_owed_again_refunded_duplicate(words),
    elsewhere: (words) => m.support_owed_again_elsewhere_duplicate(words),
    both: (words) => m.support_owed_again_both_duplicate(words),
  },
};

/** Which of owed again's bodies: by what has come back besides the first mark. */
function owedAgainBody(shortLoss: OwedAgainAfterLateWin): OwedAgainBody {
  const body = OWED_AGAIN_BODY[shortLoss.kind];
  const refunded = shortLoss.refundedThroughStripeCents > 0;
  const elsewhere = shortLoss.refundedElsewhereCents > 0;
  if (refunded && elsewhere) return body.both;
  if (refunded) return body.refunded;
  return elsewhere ? body.elsewhere : body.plain;
}

/**
 * The short loss's alert body, one sentence per part (S1, B3, B4): why the
 * buyer is owed it all back, what has come back through Stripe, what was
 * refunded another way, what was paid another way, each only when there is
 * one, then the bank's sentence, which ends with what to pay.
 */
function shortLossBody(shortLoss: ShortAfterLoss, amount: string): string {
  return sentences([
    shortLoss.kind === 'duplicate'
      ? m.support_short_loss_why_duplicate({ amount })
      : m.support_short_loss_why_unavailable({ amount }),
    shortLoss.refundedThroughStripeCents > 0
      ? m.support_short_loss_refunded_stripe({
          refunded: formatPrice(shortLoss.refundedThroughStripeCents),
        })
      : null,
    shortLoss.refundedElsewhereCents > 0
      ? m.support_short_loss_refunded_elsewhere({
          refunded: formatPrice(shortLoss.refundedElsewhereCents),
        })
      : null,
    shortLoss.paidAnotherWayCents !== null && shortLoss.paidAnotherWayOn
      ? m.support_short_loss_paid_before({
          paid: formatPrice(shortLoss.paidAnotherWayCents),
          date: formatDay(shortLoss.paidAnotherWayOn),
        })
      : null,
    m.support_short_loss_bank({
      lost: formatPrice(shortLoss.lostCents),
      owed: formatPrice(shortLoss.owedCents),
    }),
  ]);
}

/**
 * The refund card's alert while it is owed, in place of the block: what is
 * owed and why, and how the amounts add up (S1, A1, A4, B3, B4).
 * `amountCents` is what the buyer paid.
 */
export function shortLossAlert(
  shortLoss: ChargeShortLoss,
  amountCents: number
): { lead: string; body: string } {
  const amount = formatPrice(amountCents);
  if (shortLoss.stage === 'owed_again') {
    const words = { ...owedAgainWords(shortLoss), amount };
    return {
      lead: m.support_owed_again_lead(words),
      body: owedAgainBody(shortLoss)(words),
    };
  }
  return {
    lead: m.support_short_loss_lead({ owed: formatPrice(shortLoss.owedCents) }),
    body: shortLossBody(shortLoss, amount),
  };
}

/**
 * The line under the refunded-outside-Stripe block once marked at its stage
 * and nothing is owed (S3, A3, B5), or null: everything paid another way, as
 * one total (D68).
 */
export function shortLossPaidNote(shortLoss: ChargeShortLoss): string | null {
  if (shortLossOwes(shortLoss)) return null;
  if (shortLoss.stage === 'owed_again') {
    if (!shortLoss.paidAgainOn) return null;
    return m.support_owed_again_paid_note({
      paid: formatPrice(shortLoss.paidAnotherWayCents),
      dates: markDates(shortLoss.paidAnotherWayOn, shortLoss.paidAgainOn),
    });
  }
  if (shortLoss.paidAnotherWayCents === null) return null;
  return m.support_short_loss_paid_note({
    lost: formatPrice(shortLoss.lostCents),
    paid: formatPrice(shortLoss.paidAnotherWayCents),
  });
}

/**
 * The charge card's Amount line: where the money went, and what is owed
 * (S1, S3, A1, A3, B4, B5). Once marked with nothing owed, one total paid
 * another way, with when each stage was marked (D68; a second mark at the
 * same stage keeps its first date, D71).
 */
export function shortLossAmountLine(
  shortLoss: ChargeShortLoss,
  amountCents: number
): string {
  const amount = formatPrice(amountCents);
  if (shortLoss.stage === 'owed_again') {
    if (shortLossOwes(shortLoss)) {
      return m.support_amount_owed_again({
        ...owedAgainWords(shortLoss),
        amount,
      });
    }
    return m.support_amount_paid_again({
      amount,
      paid: formatPrice(shortLoss.paidAnotherWayCents),
      dates: markDates(shortLoss.paidAnotherWayOn, shortLoss.paidAgainOn),
    });
  }
  const lost = formatPrice(shortLoss.lostCents);
  const owed = formatPrice(shortLoss.owedCents);
  const paid =
    shortLoss.paidAnotherWayCents === null
      ? null
      : formatPrice(shortLoss.paidAnotherWayCents);
  if (paid === null) {
    return m.support_amount_short_loss_owed({ amount, lost, owed });
  }
  return shortLossOwes(shortLoss)
    ? m.support_amount_short_loss_owed_paid({ amount, lost, paid, owed })
    : m.support_amount_short_loss_paid({
        amount,
        lost,
        paid,
        dates: markDates(shortLoss.paidAnotherWayOn),
      });
}

/** One line of the confirm's facts. */
export interface PaidAnotherWayFact {
  label: string;
  amountCents: number;
  /** The last line: what is owed, to pay another way. */
  owed: boolean;
}

/** A fact, only when there is any of it. */
function factIf(label: string, amountCents: number): PaidAnotherWayFact[] {
  return amountCents > 0 ? [{ label, amountCents, owed: false }] : [];
}

/**
 * The confirm's facts, which add up to what is owed (S2, A2, A4, B3, B4):
 * what the buyer paid (`paidCents`), what was refunded through Stripe and
 * what was refunded another way (only when there is any), what was paid
 * another way so far, what the bank returned while the chargeback stands
 * lost; last, what is owed.
 */
export function paidAnotherWayFacts(
  shortLoss: ChargeShortLoss,
  paidCents: number
): PaidAnotherWayFact[] {
  const before = [
    {
      label: m.support_short_loss_fact_paid(),
      amountCents: paidCents,
      owed: false,
    },
    ...factIf(
      m.support_owed_again_fact_refunded(),
      shortLoss.refundedThroughStripeCents
    ),
    ...factIf(
      m.support_fact_refunded_elsewhere(),
      shortLoss.refundedElsewhereCents
    ),
  ];
  if (shortLoss.stage === 'short') {
    const paidBefore =
      shortLoss.paidAnotherWayCents !== null && shortLoss.paidAnotherWayOn
        ? factIf(
            m.support_owed_again_fact_paid_before({
              date: formatDay(shortLoss.paidAnotherWayOn),
            }),
            shortLoss.paidAnotherWayCents
          )
        : [];
    return [
      ...before,
      ...paidBefore,
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
  return [
    ...before,
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

/**
 * What follows the mark, the confirm's last line (S2, A2, B4): the first
 * mark also blocks every Stripe refund on the charge; once anything is
 * marked, the charge is blocked already, and a first-stage mark says it adds
 * to what was marked (D66).
 */
export function paidAnotherWayFollows(shortLoss: ChargeShortLoss): string {
  if (shortLoss.stage === 'owed_again') {
    return m.support_owed_again_dialog_follows();
  }
  if (shortLoss.paidAnotherWayCents === null) {
    return m.support_short_loss_dialog_follows();
  }
  return m.support_sentences_two({
    first: m.support_short_loss_dialog_adds({
      owed: formatPrice(shortLoss.owedCents),
      paid: formatPrice(shortLoss.paidAnotherWayCents),
      total: formatPrice(shortLoss.paidAnotherWayCents + shortLoss.owedCents),
    }),
    second: m.support_owed_again_dialog_follows(),
  });
}

/**
 * The mark's body: what the page showed. What was paid another way so far
 * is how the route knows a repeat now that each mark adds (D66).
 */
export function paidAnotherWayBody(shortLoss: ChargeShortLoss) {
  return {
    stripeDisputeId: shortLoss.stripeDisputeId,
    expectedOwedCents: shortLoss.owedCents,
    expectedPaidAnotherWayCents: shortLoss.paidAnotherWayCents,
    stage: shortLoss.stage,
  };
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
