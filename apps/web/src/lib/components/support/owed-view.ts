/**
 * Owed to creators: the words for the queue's third tab, its dialog and the
 * charge page's line (Codex-2hxff.72/.73, mock-b-support O1-O9, C1-C2).
 *
 * Display only. What is owed, and the one thing support can do with it now,
 * are the server's (`OwedToCreatorItem.action`, `HistoryCredit.action`): this
 * module puts them into words and builds what the dialog needs from either
 * place. Nothing here works out an amount: Re-pay pays the server's
 * `repayCents`.
 *
 * A `needs_person` row (MED-3, "Check in Stripe, then decide") offers Re-pay
 * and Not owed, and both need a note of what support saw in Stripe.
 */

import type {
  ChargeDetail,
  CheckedOwedToCreator,
  HistoryLine,
  OwedToCreatorAction,
  OwedToCreatorItem,
  ResolvedOwedToCreator,
  Slice,
} from '@codex/admin';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { SettleNotice } from './settle-notice';
import {
  causeLine,
  payeeName,
  resolutionLabel,
  roleLabel,
} from './support-format';

/**
 * What the Resolve dialog needs, from a queue row or a charge page line.
 * `effect` and `settledAs` are null on the charge page, whose history line
 * doesn't carry them: the dialog then says it in words true of either.
 */
export interface CreditTarget {
  creditId: string;
  payeeName: string;
  /** What Stripe took, or the cancelled share. */
  amountCents: number;
  causeType: 'refund' | 'dispute';
  effect: OwedToCreatorItem['effect'] | null;
  settledAs: OwedToCreatorItem['settledAs'] | null;
  stripeReversalId: string | null;
  /** The item, the buyer and the cause, as the row's From column says them. */
  description: string;
  /** A `needs_person` row: support checks in Stripe, and every choice needs a note. */
  needsPerson: boolean;
}

export function owedPayeeName(item: OwedToCreatorItem): string {
  return item.payee?.name || m.support_debt_unnamed();
}

export function owedRole(item: OwedToCreatorItem): string | null {
  return item.payee ? roleLabel(item.payee.role) : null;
}

/**
 * The Owed column: what Stripe took; on a needs-person row, the cancelled
 * share Re-pay would pay; on a needs-check row, the step's share, if taken.
 */
export function owedAmountCents(item: OwedToCreatorItem): number {
  return item.amountCents ?? item.repayCents ?? item.stepAmountCents;
}

/** What Re-pay pays: the server's `repayCents`. */
function repayAmountCents(item: OwedToCreatorItem): number {
  return item.repayCents ?? owedAmountCents(item);
}

/** Under the amount while it is not known to be owed. */
export function owedAmountNote(
  item: OwedToCreatorItem,
  where: 'table' | 'phone'
): string | null {
  const amount = formatPrice(owedAmountCents(item));
  if (item.state === 'needs_check') {
    return where === 'table'
      ? m.support_owed_if_taken()
      : m.support_owed_if_taken_phone({ amount });
  }
  if (item.state === 'needs_person') {
    return where === 'table'
      ? m.support_owed_if_owed()
      : m.support_owed_if_owed_phone({ amount });
  }
  return null;
}

export function owedFrom(item: OwedToCreatorItem): string {
  return causeLine(item.buyerName, item.cause);
}

export interface OwedWhat {
  text: string;
  /** Small lines under it: the take-back id (mono), then notes. */
  subs: Array<{ text: string; mono?: boolean }>;
}

/** What happened, in the row's own words (O1). */
export function owedWhat(item: OwedToCreatorItem): OwedWhat {
  const dispute = item.cause.type === 'dispute';
  const subs: OwedWhat['subs'] = [];
  let text: string;
  if (item.state === 'needs_person') {
    text = m.support_owed_what_needs_person();
    subs.push({ text: m.support_owed_what_needs_person_note() });
  } else if (item.effect === 'unverified' || item.state === 'needs_check') {
    text = m.support_owed_what_unverified();
    subs.push({ text: m.support_owed_what_unverified_note() });
  } else if (item.effect === 'slice_cancelled') {
    text = dispute
      ? m.support_owed_what_cancelled_dispute()
      : m.support_owed_what_cancelled_refund();
    subs.push({ text: m.support_owed_what_cancelled_note() });
  } else {
    text =
      item.settledAs === 'debt'
        ? m.support_owed_what_landed_debt()
        : item.settledAs === 'done'
          ? m.support_owed_what_landed_done()
          : dispute
            ? m.support_owed_what_landed_dispute()
            : m.support_owed_what_landed_refund();
    if (item.stripeReversalId) {
      subs.push({ text: item.stripeReversalId, mono: true });
    }
  }
  if (item.debt) {
    subs.push({
      text:
        item.debt.resolution === null
          ? m.support_owed_debt_open({
              name: owedPayeeName(item),
              amount: formatPrice(item.debt.owedCents),
            })
          : m.support_owed_debt_closed({
              resolution: resolutionLabel(item.debt.resolution),
            }),
    });
  }
  if (item.action === 'settle_by_hand') {
    subs.push({ text: m.support_owed_settle_by_hand() });
  }
  return { text, subs };
}

/**
 * The row's one main action (Q9-Q11, OQ4, MED-3): Re-pay, Count against this
 * debt, or Check Stripe again; a needs-person row's Re-pay (`decide`) asks
 * for a note. A row only a person can settle by hand has none: Not owed, on
 * every row, is how it leaves once it is settled.
 */
export function owedMainAction(
  item: OwedToCreatorItem
): { kind: 'repay' | 'count_against_debt' | 'check'; label: string } | null {
  switch (item.action) {
    case 'repay':
    case 'decide':
      return {
        kind: 'repay',
        label: m.support_repay_submit({
          amount: formatPrice(repayAmountCents(item)),
        }),
      };
    case 'count_against_debt':
      return {
        kind: 'count_against_debt',
        label: m.support_owed_action_count(),
      };
    case 'check':
      return { kind: 'check', label: m.support_owed_action_check() };
    default:
      return null;
  }
}

export function targetFromItem(item: OwedToCreatorItem): CreditTarget {
  const parts = [item.title ?? m.support_unknown_item(), owedFrom(item)];
  return {
    creditId: item.creditId,
    payeeName: owedPayeeName(item),
    amountCents: repayAmountCents(item),
    causeType: item.cause.type,
    effect: item.effect,
    settledAs: item.settledAs,
    stripeReversalId: item.stripeReversalId,
    description: parts.join(' · '),
    needsPerson: item.state === 'needs_person',
  };
}

/** The person a slice's money goes to: an organisation's slice, its owner. */
export function slicePayeeName(slice: Slice): string {
  return slice.payee?.name || payeeName(slice);
}

/**
 * The charge page's line (C1): its credit, while Re-pay or Count against
 * this debt is on offer. Not owed and Check Stripe again stay in the queue
 * (owner Q8): the charge page gets just the money action.
 */
export function targetFromLine(
  detail: ChargeDetail,
  slice: Slice,
  line: HistoryLine
): CreditTarget | null {
  const credit = line.credit;
  if (
    !credit ||
    credit.amountCents === null ||
    (credit.action !== 'repay' && credit.action !== 'count_against_debt')
  ) {
    return null;
  }
  const title =
    detail.source.type === 'purchase'
      ? (detail.source.item?.title ?? m.support_unknown_item())
      : detail.source.planName;
  const cause =
    line.causeType === 'dispute'
      ? m.support_history_cause_dispute_plain()
      : line.causeAmountCents === null
        ? m.support_history_cause_refund_plain()
        : m.support_history_cause_refund({
            amount: formatPrice(line.causeAmountCents),
          });
  return {
    creditId: credit.creditId,
    payeeName: slicePayeeName(slice),
    amountCents: credit.amountCents,
    causeType: line.causeType,
    effect: null,
    settledAs: null,
    stripeReversalId: null,
    description: [title, detail.buyer.name, cause].join(' · '),
    needsPerson: false,
  };
}

/** The button on a charge page line: what `targetFromLine` opens. */
export function lineActionLabel(line: HistoryLine): string | null {
  const credit = line.credit;
  if (!credit || credit.amountCents === null) return null;
  if (credit.action === 'repay') {
    return m.support_repay_submit({ amount: formatPrice(credit.amountCents) });
  }
  if (credit.action === 'count_against_debt')
    return m.support_owed_action_count();
  return null;
}

/** "after the chargeback was won": when the late take-back came. */
function afterPhrase(target: CreditTarget): string {
  if (target.settledAs === 'debt') return m.support_credit_after_debt();
  if (target.settledAs === 'done') return m.support_credit_after_done();
  if (target.settledAs === null) return m.support_credit_after_settled();
  return target.causeType === 'dispute'
    ? m.support_credit_after_dispute()
    : m.support_credit_after_refund();
}

export interface CreditDialogWords {
  title: string;
  /** The body, sentence by sentence. */
  body: string[];
  /** "£9.00 is what Stripe took:", followed by the take-back id. */
  reference: { lead: string; id: string } | null;
  submit: string;
  noteRequired: boolean;
  /** The note's label: "What you saw in Stripe" on a needs-person row. */
  noteLabel: string;
}

export function dialogWords(
  target: CreditTarget,
  action: OwedToCreatorAction
): CreditDialogWords {
  const name = target.payeeName;
  const amount = formatPrice(target.amountCents);
  const noteLabel = target.needsPerson
    ? m.support_credit_note_label_decide()
    : m.support_note_label();
  if (action === 'count_against_debt') {
    return {
      title: m.support_credit_count_title({ name, amount }),
      body: [m.support_credit_count_body({ name, amount })],
      reference: null,
      submit: m.support_owed_action_count(),
      noteRequired: false,
      noteLabel,
    };
  }
  if (action === 'not_owed') {
    return {
      title: m.support_credit_not_owed_title({ name, amount }),
      body: [m.support_credit_not_owed_body({ name })],
      reference: null,
      submit: m.support_credit_not_owed_submit(),
      noteRequired: true,
      noteLabel,
    };
  }
  if (target.needsPerson) {
    return {
      title: m.support_credit_repay_title({ name, amount }),
      body: [
        m.support_sentences_two({
          first: m.support_credit_decide_body({ name, amount }),
          second: m.support_credit_repay_writes({ name, amount }),
        }),
      ],
      reference: null,
      submit: m.support_credit_repay_submit({ amount, name }),
      noteRequired: true,
      noteLabel,
    };
  }
  const what =
    target.effect === 'slice_cancelled'
      ? m.support_credit_repay_cancelled({
          name,
          amount,
          after: afterPhrase(target),
        })
      : m.support_credit_repay_taken({
          name,
          amount,
          after: afterPhrase(target),
        });
  return {
    title: m.support_credit_repay_title({ name, amount }),
    body: [
      m.support_sentences_two({
        first: what,
        second: m.support_credit_repay_writes({ name, amount }),
      }),
    ],
    reference: target.stripeReversalId
      ? {
          lead: m.support_credit_repay_ref({ amount }),
          id: target.stripeReversalId,
        }
      : null,
    submit: m.support_credit_repay_submit({ amount, name }),
    noteRequired: false,
    noteLabel,
  };
}

/** The notice once a resolve went through. Names and amounts as sent. */
export function resolvedNotice(
  target: CreditTarget,
  result: ResolvedOwedToCreator
): SettleNotice {
  const name = target.payeeName;
  const amount = formatPrice(result.amountCents ?? target.amountCents);
  switch (result.resolution) {
    case 'repaid':
      return {
        variant: 'success',
        text: m.support_credit_repaid({ name, amount }),
      };
    case 'debt_collected':
      return {
        variant: 'success',
        text: m.support_credit_counted({ name, amount }),
      };
    default:
      return {
        variant: 'success',
        text: m.support_credit_not_owed_done({ name }),
      };
  }
}

/** Codes that mean the row offers something else now: the list is refreshed. */
const CHANGED_CODES = new Set([
  'CREDIT_DEBT_STILL_OPEN',
  'CREDIT_DEBT_ALREADY_CLOSED',
  'CREDIT_NOT_COUNTABLE',
  'CREDIT_NEEDS_CHECK',
]);

/**
 * A refusal that closes the dialog, as a notice; null for one the dialog
 * stays open for (a missing note, a session that ended, a failure).
 */
export function refusalNotice(
  failure: SupportCommandFailure
): SettleNotice | null {
  if (failure.detailsCode === 'ALREADY_SETTLED') {
    return { variant: 'info', text: m.support_settle_already() };
  }
  if (failure.detailsCode === 'CREDIT_SETTLE_BY_HAND') {
    return { variant: 'info', text: m.support_credit_settle_by_hand() };
  }
  if (failure.detailsCode && CHANGED_CODES.has(failure.detailsCode)) {
    return { variant: 'info', text: m.support_credit_changed() };
  }
  if (failure.status === 404) {
    return { variant: 'info', text: m.support_settle_gone() };
  }
  if (failure.status === 409) {
    return { variant: 'info', text: m.support_settle_already() };
  }
  return null;
}

/** What "Check Stripe again" found (O5, O6), or why it didn't run. */
export function checkNotice(
  target: CreditTarget,
  answer:
    | { outcome: 'done'; result: CheckedOwedToCreator }
    | SupportCommandFailure
): SettleNotice {
  const name = target.payeeName;
  if (answer.outcome === 'done') {
    const { result } = answer;
    if (result.outcome === 'owed') {
      const amount = formatPrice(result.amountCents ?? target.amountCents);
      return {
        variant: 'success',
        text:
          result.action === 'count_against_debt'
            ? m.support_credit_check_owed_count({ name, amount })
            : m.support_credit_check_owed({ name, amount }),
      };
    }
    if (result.outcome === 'not_owed') {
      return {
        variant: 'success',
        text: m.support_credit_check_not_owed({ name }),
      };
    }
    if (result.outcome === 'needs_person') {
      return { variant: 'info', text: m.support_credit_check_needs_person() };
    }
    return {
      variant: 'warning',
      lead: m.support_credit_check_unknown_lead(),
      text: m.support_credit_check_unknown_body(),
    };
  }
  if (answer.status === 401 || answer.status === 403) {
    return {
      variant: 'warning',
      lead: m.support_outcome_signed_out_lead(),
      text: m.support_settle_session_ended(),
    };
  }
  return (
    refusalNotice(answer) ?? {
      variant: 'warning',
      text: m.support_credit_check_failed(),
    }
  );
}
