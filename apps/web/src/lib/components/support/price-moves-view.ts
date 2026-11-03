/**
 * Words for Admin › Queue › Price moves (Codex-2hxff.85 M1, .86; batch C1
 * Part B page 6, M1-M11).
 *
 * Display only: who is held, why, and what each action does are the
 * server's answer (`HeldPriceMove.action`, `heldReason`, `queuedFor`). These
 * helpers say it as drawn. Every action is a database flip that the next
 * hourly run acts on, so the words say when the run is, never "done".
 */

import type {
  HeldPriceMove,
  PriceMovePlan,
  PriceMoveRetried,
  StoppedPriceChange,
} from '@codex/admin';
import { PRICE_EMAILS_PER_RUN } from '$lib/components/studio/price-note-view';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { CardBadge, CardFact } from './fee-notices-view';
import { firstName, formatLongDay } from './fee-notices-view';
import type { SettleNotice } from './settle-notice';
import {
  formatDay,
  formatShortDay,
  formatTime,
  personName,
} from './support-format';

/** Five minutes after the run: when its answer is worth looking for (M2). */
const LOOK_AFTER_MS = 5 * 60_000;

/** "Pro, monthly" */
export function planLabel(plan: PriceMovePlan): string {
  return plan.interval === 'year'
    ? m.support_queue_moves_plan_annual({ name: plan.name })
    : m.support_queue_moves_plan_monthly({ name: plan.name });
}

/** "£12.00 → £14.00" */
export function moveAmounts(from: number, to: number): string {
  return m.support_queue_moves_amounts({
    from: formatPrice(from),
    to: formatPrice(to),
  });
}

/** "£12.00/mo" */
function perInterval(cents: number, plan: PriceMovePlan): string {
  return plan.interval === 'year'
    ? m.support_queue_moves_per_year({ amount: formatPrice(cents) })
    : m.support_queue_moves_per_month({ amount: formatPrice(cents) });
}

/** "Hollow Oak Films · Pro, monthly" */
export function movePlace(item: {
  organization: { name: string };
  plan: PriceMovePlan;
}): string {
  return m.support_queue_moves_place({
    org: item.organization.name,
    plan: planLabel(item.plan),
  });
}

/** The address a held row shows, or "no address on file". */
export function moveAddress(item: HeldPriceMove): string {
  return item.subscriber.email || m.support_queue_moves_no_address_on_file();
}

export interface WhyHeld {
  text: string;
  sub: string;
  /** A Stripe code at the end of `sub`, in mono. */
  mono?: string;
}

/** "Tried 3 times, last on 30 Oct at 17:00" */
function triedLine(item: HeldPriceMove): string {
  if (!item.lastTriedAt) {
    return m.support_queue_moves_tried_times({ count: String(item.attempts) });
  }
  return m.support_queue_moves_tried_last({
    count: String(item.attempts),
    date: formatShortDay(item.lastTriedAt),
    time: formatTime(item.lastTriedAt),
  });
}

/** Support pressed Retry, and the run held it again after its three tries (M4). */
export function retriedAgain(item: HeldPriceMove): boolean {
  return item.status === 'held' && item.retry !== null;
}

/**
 * An address that refused every try, again after a retry, won't start
 * working by retrying: Close… comes first, and Retry is the quiet one (M4).
 */
export function closeComesFirst(item: HeldPriceMove): boolean {
  return retriedAgain(item) && item.heldReason === 'notice_refused';
}

/** Why the row is held, in plain words, and what was tried. */
export function whyHeld(item: HeldPriceMove): WhyHeld {
  if (item.status === 'held' && item.subscriptionEnded) {
    return {
      text: m.support_queue_moves_why_ended(),
      sub: m.support_queue_moves_why_ended_sub(),
    };
  }
  const why = baseWhy(item);
  if (!retriedAgain(item) || !item.retry) return why;
  const retried = m.support_queue_moves_retried_by({
    name: personName(item.retry.by),
    date: formatShortDay(item.retry.requestedAt),
  });
  if (item.heldReason === 'notice_refused') {
    return {
      text: m.support_queue_moves_why_refused_again(),
      sub: [
        retried,
        lowerFirst(triedLine(item)),
        m.support_queue_moves_refused_again_hint(),
      ].join(' · '),
    };
  }
  return { ...why, sub: `${retried} · ${why.sub}` };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function baseWhy(item: HeldPriceMove): WhyHeld {
  const tried = triedLine(item);
  const count = String(item.attempts);
  switch (item.heldReason) {
    case 'notice_refused':
      return { text: m.support_queue_moves_why_refused(), sub: tried };
    case 'notice_unknown':
      return {
        text: m.support_queue_moves_why_unknown(),
        sub: m.support_queue_moves_why_unknown_sub({ count }),
      };
    case 'no_address':
      return {
        text: m.support_queue_moves_why_no_address(),
        sub: m.support_queue_moves_why_no_address_sub({ count }),
      };
    case 'notice_skipped':
      return {
        text: m.support_queue_moves_why_skipped(),
        sub: m.support_queue_moves_tried_times({ count }),
      };
    case 'move_refused':
    case 'move_unknown': {
      const emailed = item.noticeAt ?? item.createdAt;
      const told = item.effectiveAt
        ? m.support_queue_moves_told_date({ date: formatDay(item.effectiveAt) })
        : null;
      if (item.heldReason === 'move_refused') {
        return {
          text: m.support_queue_moves_why_move_refused({
            date: formatShortDay(emailed),
            time: formatTime(emailed),
          }),
          sub: [
            told,
            item.lastError ? m.support_queue_moves_stripe_said() : null,
          ]
            .filter(Boolean)
            .join(' · '),
          mono: item.lastError ?? undefined,
        };
      }
      return {
        text: m.support_queue_moves_why_move_unknown({
          date: formatShortDay(emailed),
          time: formatTime(emailed),
        }),
        sub: [told, m.support_queue_moves_checked_stripe({ count })]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'read_failed':
      return {
        text: m.support_queue_moves_why_read_failed(),
        sub: m.support_queue_moves_tried_times({ count }),
      };
    case 'same_amount_write_failed':
      return {
        text: m.support_queue_moves_why_same_amount(),
        sub: m.support_queue_moves_tried_times({ count }),
      };
    default:
      return { text: m.support_queue_moves_why_other(), sub: tried };
  }
}

/** "Queued for 11:00 · Jordan Reid" (M2): the row waits for the run. */
export function queuedLine(item: HeldPriceMove): string | null {
  if (item.status !== 'queued' || !item.queuedFor) return null;
  const time = formatTime(item.queuedFor);
  return item.retry?.by
    ? m.support_queue_moves_queued_by({ time, name: personName(item.retry.by) })
    : m.support_queue_moves_queued({ time });
}

// ── Answers ───────────────────────────────────────────────────────────────

/** What Retry queued, as the notice says it (M2, M3). */
export function retriedNotice(
  item: HeldPriceMove,
  answer: PriceMoveRetried
): SettleNotice {
  const name = personName(item.subscriber);
  const run = formatTime(answer.nextRunAt);
  if (answer.move.noticeAt !== null) {
    const told = answer.move.effectiveAt ?? item.effectiveAt;
    return {
      variant: 'success',
      lead: m.support_queue_moves_retried_move_lead({ name, time: run }),
      text: told
        ? m.support_queue_moves_retried_move({ date: formatLongDay(told) })
        : m.support_queue_moves_retried_move_undated(),
    };
  }
  return {
    variant: 'success',
    lead: m.support_queue_moves_retried_lead({ name, time: run }),
    text: m.support_queue_moves_retried({
      time: formatTime(
        new Date(Date.parse(answer.nextRunAt) + LOOK_AFTER_MS).toISOString()
      ),
    }),
  };
}

/**
 * A refusal of Retry or Close, as a notice (M6). Its `message` is already
 * the server's plain words. A Retry already queued is a second press after a
 * lost answer: it reads as done.
 */
export function moveRefusalNotice(
  item: HeldPriceMove,
  action: 'retry' | 'close',
  answer: SupportCommandFailure
): SettleNotice | null {
  if (answer.detailsCode !== 'PRICE_MOVE_NOT_HELD') return null;
  const text = answer.message ?? m.support_queue_moves_not_held();
  if (answer.reason === 'queued' && action === 'retry') {
    return { variant: 'info', text };
  }
  const name = personName(item.subscriber);
  return {
    variant: 'warning',
    lead:
      action === 'retry'
        ? m.support_queue_moves_nothing_to_retry({ name })
        : m.support_queue_moves_nothing_to_close({ name }),
    text,
  };
}

/** A Retry or Restart that didn't run (a 5xx, a dropped connection). */
export function moveFailedNotice(): SettleNotice {
  return { variant: 'warning', text: m.support_queue_moves_action_failed() };
}

/** What Close did (M5). */
export function closedNotice(
  item: HeldPriceMove,
  resolution: 'moved_by_hand' | 'not_needed'
): SettleNotice {
  const lead = m.support_queue_moves_closed_lead({
    name: personName(item.subscriber),
  });
  return resolution === 'moved_by_hand'
    ? { variant: 'success', lead, text: m.support_queue_moves_closed_by_hand() }
    : {
        variant: 'success',
        lead,
        text: m.support_queue_moves_closed_not_needed({
          price: perInterval(item.fromAmountCents, item.plan),
        }),
      };
}

/** The Close dialog's words (M5). */
export function closeWords(item: HeldPriceMove) {
  return {
    title: m.support_queue_moves_close_title({
      name: personName(item.subscriber),
    }),
    description: `${movePlace(item)} · ${moveAmounts(item.fromAmountCents, item.newAmountCents)}`,
    body: m.support_queue_moves_close_body({
      name: firstName(item.subscriber),
      price: perInterval(item.fromAmountCents, item.plan),
    }),
  };
}

// ── A stopped change (M7, M8) ─────────────────────────────────────────────

/** The run's cause, in words: the run writes a code, never a sentence. */
function stoppedCause(reason: string): string {
  switch (reason) {
    case 'template_missing':
      return m.support_queue_moves_stopped_template_missing();
    case 'worker_auth':
      return m.support_queue_moves_stopped_worker_auth();
    default:
      return m.support_queue_moves_stopped_notice_refused();
  }
}

export function stoppedTitle(change: StoppedPriceChange): string {
  return m.support_queue_moves_stopped_title({
    place: movePlace(change),
    amounts: moveAmounts(change.fromAmountCents, change.newAmountCents),
  });
}

export function stoppedSub(change: StoppedPriceChange): string {
  const when = `${formatDay(change.savedAt)}, ${formatTime(change.savedAt)}`;
  return change.savedBy
    ? m.support_queue_moves_stopped_saved_by({
        when,
        name: personName(change.savedBy),
      })
    : m.support_queue_moves_stopped_saved({ when });
}

export function stoppedBadge(change: StoppedPriceChange): CardBadge {
  return change.restart
    ? {
        variant: 'info',
        label: m.support_queue_moves_badge_restarts({
          time: formatTime(change.restart.at),
        }),
      }
    : { variant: 'warning', label: m.support_queue_moves_badge_stopped() };
}

/**
 * How many the hourly run emails, as the Studio note says it ("1,125"): the
 * server's `PRICE_MOVES_PER_RUN`, through the note's `PRICE_EMAILS_PER_RUN`.
 */
function perRun(): string {
  return PRICE_EMAILS_PER_RUN.toLocaleString('en-GB');
}

/** The run's hour: "14:00", whatever minute it stopped at. */
function runHour(iso: string): string {
  return `${formatTime(iso).slice(0, 2)}:00`;
}

export function stoppedFacts(change: StoppedPriceChange): CardFact[] {
  const waiting =
    change.waiting === 1
      ? m.support_queue_moves_stopped_waiting_one({
          price: perInterval(change.fromAmountCents, change.plan),
        })
      : m.support_queue_moves_stopped_waiting({
          count: change.waiting.toLocaleString('en-GB'),
          price: perInterval(change.fromAmountCents, change.plan),
        });
  const next = change.restart
    ? m.support_queue_moves_stopped_next_restarted({
        name: personName(change.restart.by),
        time: formatTime(change.restart.requestedAt),
        run: formatTime(change.restart.at),
        perRun: perRun(),
      })
    : m.support_queue_moves_stopped_next();
  return [
    {
      term: m.support_queue_moves_fact_what(),
      text: stoppedCause(change.stoppedReason),
      small: m.support_queue_moves_stopped_run({
        run: runHour(change.stoppedAt),
        date: formatShortDay(change.stoppedAt),
      }),
      smallMono: change.stoppedErrorId,
    },
    { term: m.support_queue_moves_fact_waiting(), text: waiting },
    { term: m.support_queue_moves_fact_next(), text: next },
  ];
}

/** What Restart asked for, as the notice says it (M8). */
export function restartedNotice(
  change: StoppedPriceChange,
  nextRunAt: string
): SettleNotice {
  const saver = change.savedBy
    ? m.support_queue_moves_restarted_note_of({
        name: firstName(change.savedBy),
      })
    : m.support_queue_moves_restarted_note_org();
  return {
    variant: 'success',
    lead: m.support_queue_moves_restarted_lead(),
    text: m.support_queue_moves_restarted({
      time: formatTime(nextRunAt),
      org: change.organization.name,
      count: change.waiting.toLocaleString('en-GB'),
      plan: change.plan.name,
      perRun: perRun(),
      saver,
    }),
  };
}

/** Restart refused: the change isn't stopped. The server's words. */
export function restartRefusalNotice(
  answer: SupportCommandFailure
): SettleNotice | null {
  if (answer.detailsCode !== 'PRICE_CHANGE_NOT_STOPPED') return null;
  return {
    variant: 'info',
    text: answer.message ?? m.support_queue_moves_not_stopped(),
  };
}
