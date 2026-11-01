/**
 * Words for Admin › Queue › Fee notices (Codex-2hxff.33 F4, F8; batch C1
 * Part B page 5, F1-F10).
 *
 * Display only: who a rise waits for, how many are told and the date are the
 * server's answer. These helpers say it as drawn. Dates and times are London
 * time, as on the other support pages.
 */

import type {
  FeeChangeCard,
  FeeChangeLine,
  FeeNoticeItem,
  SupportPerson,
} from '@codex/admin';
import { memberFirstName } from '$lib/components/studio/departure-impact';
import { formatShareBps } from '$lib/components/studio/ownership/ownership-view';
import type { SupportCommandFailure } from '$lib/remote/support-failure';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { SettleNotice } from './settle-notice';
import {
  formatDay,
  formatShortDay,
  formatTime,
  personName,
} from './support-format';

const TIME_ZONE = 'Europe/London';
const DAY_MS = 86_400_000;
/** The 30 days a rise waits after the last person is told (F4). */
const NOTICE_DAYS = 30;

const longDayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});
const dayMonthFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
});
const londonDayKey = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
});
const dayOfMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  timeZone: TIME_ZONE,
});
const monthKey = new Intl.DateTimeFormat('en-GB', {
  month: 'numeric',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

/** `5 December 2026` */
export function formatLongDay(iso: string): string {
  return longDayFormatter.format(new Date(iso));
}

/** `5 December` */
export function formatDayMonth(iso: string): string {
  return dayMonthFormatter.format(new Date(iso));
}

/** `4 Nov, 10:42` */
function shortDayTime(iso: string): string {
  return `${formatShortDay(iso)}, ${formatTime(iso)}`;
}

/** How many London days `iso` is after `now`'s: 0 today, 1 tomorrow. */
function daysFromToday(iso: string, now: Date): number {
  const day = (d: Date) => Date.parse(londonDayKey.format(d));
  return Math.round((day(new Date(iso)) - day(now)) / DAY_MS);
}

/** `tomorrow at 08:00`, `today at 08:00`, `on 6 Nov at 08:00`. */
export function runWhen(iso: string, now: Date = new Date()): string {
  const time = formatTime(iso);
  const days = daysFromToday(iso, now);
  if (days === 0) return m.support_queue_fees_when_today({ time });
  if (days === 1) return m.support_queue_fees_when_tomorrow({ time });
  return m.support_queue_fees_when_on({ date: formatShortDay(iso), time });
}

// ── A change's lines ──────────────────────────────────────────────────────

function lineValue(line: FeeChangeLine, amount: number): string {
  if (line.value === 'platformFeePercent' || line.value === 'orgFeePercent') {
    return formatShareBps(amount);
  }
  return amount > 0 && amount < 100 ? `${amount}p` : formatPrice(amount);
}

/** What a line moves, named: "Codex's fee", "Hollow Oak Films's share". */
function lineLabel(line: FeeChangeLine, card: FeeChangeCard): string {
  switch (line.value) {
    case 'platformFeePercent':
      return m.support_queue_fees_value_platform();
    case 'orgFeePercent':
      return card.organization
        ? m.support_queue_fees_value_org({ org: card.organization.name })
        : m.support_queue_fees_value_org_default();
    case 'minPlatformFeeCents':
      return m.support_queue_fees_value_min_fee();
    case 'minTransferCents':
      return m.support_queue_fees_value_min_transfer();
  }
}

function contextTail(line: FeeChangeLine): string {
  if (line.context === 'one_off')
    return ` ${m.support_queue_fees_context_one_off()}`;
  if (line.context === 'subscription') {
    return ` ${m.support_queue_fees_context_subscription()}`;
  }
  return '';
}

/** The card's title: "Codex's fee: 10% → 12% of each sale". */
export function changeTitle(card: FeeChangeCard): string {
  return card.lines
    .map((line) => {
      const label = lineLabel(line, card);
      const from = lineValue(line, line.from);
      const to = lineValue(line, line.to);
      const move =
        line.value === 'platformFeePercent'
          ? m.support_queue_fees_title_each_sale({ label, from, to })
          : m.support_queue_fees_title_line({ label, from, to });
      return `${move}${contextTail(line)}`;
    })
    .join(' · ');
}

/** A row's short form: "Codex's fee 10% → 12%". */
export function changeShort(card: FeeChangeCard): string {
  return card.lines
    .map(
      (line) =>
        `${m.support_queue_fees_short_line({
          label: lineLabel(line, card),
          from: lineValue(line, line.from),
          to: lineValue(line, line.to),
        })}${contextTail(line)}`
    )
    .join(' · ');
}

/** Who and when: "Everyone without their own fee setting · saved 2 Nov 2026, 14:20 by Jordan Reid". */
export function changeSub(card: FeeChangeCard): string {
  const whom =
    card.scope === 'platform'
      ? m.support_queue_fees_whom_platform()
      : card.scope === 'org'
        ? m.support_queue_fees_whom_org({ org: card.organization?.name ?? '' })
        : m.support_queue_fees_whom_creator({
            creator: personName(card.creator),
            org: card.organization?.name ?? '',
          });
  const when = `${formatDay(card.savedAt)}, ${formatTime(card.savedAt)}`;
  const saved = card.savedBy
    ? m.support_queue_fees_saved_by({ when, name: personName(card.savedBy) })
    : m.support_queue_fees_saved({ when });
  return `${whom} · ${saved}`;
}

export interface CardBadge {
  variant: 'warning' | 'info';
  label: string;
}

export function changeBadge(card: FeeChangeCard): CardBadge {
  if (card.effectiveFrom) {
    return {
      variant: 'info',
      label: m.support_queue_fees_badge_starts({
        date: formatDay(card.effectiveFrom),
      }),
    };
  }
  if (card.listed === null) {
    return {
      variant: 'info',
      label: m.support_queue_fees_badge_first_emails({
        date: formatShortDay(card.firstEmailsAt ?? card.savedAt),
      }),
    };
  }
  return {
    variant: 'warning',
    label: m.support_queue_fees_badge_waiting({
      count: String(card.waitingFor),
    }),
  };
}

/** One fact on the card: the main words, a bold part, and a small line. */
export interface CardFact {
  term: string;
  text: string;
  strong?: string;
  /** After the bold part. */
  after?: string;
  small?: string;
  /** An id at the end of the small line, in mono. */
  smallMono?: string;
}

function toldAnotherWayLines(card: FeeChangeCard): string[] {
  return card.toldAnotherWay.map((told) =>
    m.support_queue_fees_told_another_way_by({
      name: personName(told.person),
      by: personName(told.by),
      date: formatShortDay(told.at),
      time: formatTime(told.at),
    })
  );
}

function toldFact(card: FeeChangeCard): CardFact {
  const term = m.support_queue_fees_fact_told();
  if (card.listed === null) {
    return {
      term,
      text: m.support_queue_fees_told_nobody_yet(),
      small: card.firstEmailsAt
        ? m.support_queue_fees_first_emails_at({
            time: formatTime(card.firstEmailsAt),
            date: formatShortDay(card.firstEmailsAt),
          })
        : undefined,
    };
  }
  const told = card.told.byEmail + card.told.anotherWay;
  const text = m.support_queue_fees_told_of({
    told: told.toLocaleString('en-GB'),
    listed: card.listed.toLocaleString('en-GB'),
  });
  if (card.effectiveFrom && card.joiners.waiting > 0) {
    return { term, text, small: m.support_queue_fees_told_everyone_listed() };
  }
  const parts = [
    ...(card.told.byEmail > 0
      ? [
          m.support_queue_fees_told_by_email({
            count: card.told.byEmail.toLocaleString('en-GB'),
          }),
        ]
      : []),
    ...toldAnotherWayLines(card),
  ];
  return { term, text, small: parts.length > 0 ? parts.join('; ') : undefined };
}

function joinersFact(card: FeeChangeCard): CardFact {
  const term = m.support_queue_fees_fact_joined();
  const { total, told, waiting } = card.joiners;
  if (total === 0) return { term, text: m.support_queue_fees_joined_nobody() };
  if (waiting === 0) {
    return {
      term,
      text: m.support_queue_fees_joined_told({ count: String(total) }),
    };
  }
  return {
    term,
    text: m.support_queue_fees_joined_some_waiting({
      count: String(total),
      told: String(told),
      waiting: String(waiting),
    }),
  };
}

function startsFact(card: FeeChangeCard): CardFact {
  const term = m.support_queue_fees_fact_starts();
  if (!card.effectiveFrom) {
    return {
      term,
      text: m.support_queue_fees_starts_once_told(),
      strong: formatLongDay(card.earliestFrom),
    };
  }
  const date = formatLongDay(card.effectiveFrom);
  if (card.joiners.waiting > 0) {
    return {
      term,
      text: '',
      strong: date,
      small: card.lastToldAt
        ? m.support_queue_fees_starts_set_on({
            date: formatShortDay(card.lastToldAt),
          })
        : undefined,
    };
  }
  const end = card.lastToldAt
    ? new Date(Date.parse(card.lastToldAt) + NOTICE_DAYS * DAY_MS).toISOString()
    : null;
  return {
    term,
    text: '',
    strong: date,
    after: m.support_queue_fees_starts_midnight(),
    small:
      card.lastToldAt && end
        ? m.support_queue_fees_starts_told_by({
            told: shortDayTime(card.lastToldAt),
            end: shortDayTime(end),
          })
        : undefined,
  };
}

export function changeFacts(card: FeeChangeCard): CardFact[] {
  return [toldFact(card), joinersFact(card), startsFact(card)];
}

// ── A person not told yet ─────────────────────────────────────────────────

/** "Creator · Hollow Oak Films, Northlight Collective; Owner · …" */
export function noticeRoles(item: FeeNoticeItem): string {
  const names = (as: 'creator' | 'owner') =>
    item.roles
      .filter((role) => role.as === as)
      .map(
        (role) => role.organizationName ?? m.support_queue_fees_role_orgless()
      );
  const parts: string[] = [];
  const creator = names('creator');
  const owner = names('owner');
  if (creator.length > 0) {
    parts.push(m.support_queue_fees_role_creator({ orgs: creator.join(', ') }));
  }
  if (owner.length > 0) {
    parts.push(m.support_queue_fees_role_owner({ orgs: owner.join(', ') }));
  }
  return parts.join('; ');
}

/** The row's "Fee rise" cell: the change, and when it was saved or starts. */
export function noticeRise(
  item: FeeNoticeItem,
  card: FeeChangeCard | undefined
): { text: string; sub: string } {
  return {
    text: card ? changeShort(card) : m.support_queue_fees_rise_unknown(),
    sub: item.changeEffectiveFrom
      ? m.support_queue_fees_rise_starts({
          date: formatShortDay(item.changeEffectiveFrom),
        })
      : m.support_queue_fees_rise_saved({
          date: formatShortDay(item.changeSavedAt),
        }),
  };
}

/** What happened, in plain words. */
export function noticeWhat(item: FeeNoticeItem): string {
  if (item.state === 'unknown') return m.support_queue_fees_what_unknown();
  if (item.reason === 'no_address')
    return m.support_queue_fees_what_no_address();
  if (item.reason === 'skipped') return m.support_queue_fees_what_skipped();
  return m.support_queue_fees_what_refused();
}

/** "tried 3 Nov", "tried 3 and 4 Nov", "tried 4 times since 3 Nov". */
function triedWords(item: FeeNoticeItem): string {
  const first = item.waitingSince;
  const last = item.lastTriedAt ?? item.waitingSince;
  if (item.attempts <= 1) {
    return m.support_queue_fees_tried_once({ date: formatShortDay(last) });
  }
  if (item.attempts === 2) {
    const sameMonth =
      monthKey.format(new Date(first)) === monthKey.format(new Date(last));
    return m.support_queue_fees_tried_twice({
      first: sameMonth
        ? dayOfMonth.format(new Date(first))
        : formatShortDay(first),
      last: formatShortDay(last),
    });
  }
  return m.support_queue_fees_tried_times({
    count: String(item.attempts),
    date: formatShortDay(first),
  });
}

/**
 * The line under "what happened": the address, what was tried, and what the
 * run does next. On a phone the address is left out where the drawn row
 * leaves it out.
 */
export function noticeNext(
  item: FeeNoticeItem,
  where: 'table' | 'phone',
  now: Date = new Date()
): string {
  const address =
    item.person.email || m.support_queue_fees_no_address_on_file();
  if (item.state === 'unknown') {
    const days = daysFromToday(item.nextTryAt, now);
    const next =
      days === 0
        ? m.support_queue_fees_unknown_next_today()
        : days === 1
          ? m.support_queue_fees_unknown_next_tomorrow()
          : m.support_queue_fees_unknown_next_later();
    return where === 'table' ? `${address} · ${next}` : capitalise(next);
  }
  const tries = m.support_queue_fees_tries_again({
    when: runWhen(item.nextTryAt, now),
  });
  if (!item.onList) {
    const joiner = m.support_queue_fees_joiner_holds_nothing();
    return where === 'table'
      ? `${address} · ${joiner} · ${tries}`
      : capitalise(joiner);
  }
  return `${address} · ${triedWords(item)} · ${tries}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── The mark ──────────────────────────────────────────────────────────────

/** Stands in for the bold date while a sentence is composed. */
export const DATE_MARK = '\u0000';

/** The first word of a support person's name, as the drawn copy says it. */
export function firstName(person: SupportPerson): string {
  return memberFirstName(person.name) ?? personName(person);
}

export interface MarkWords {
  title: string;
  description: string;
  counts: string;
  /** What follows the mark. `DATE_MARK` stands for the bold `date`. */
  follows: string | null;
  date: string | null;
  submit: string;
  placeholder: string;
}

export function markWords(
  item: FeeNoticeItem,
  card: FeeChangeCard | undefined,
  now: Date = new Date()
): MarkWords {
  const name = personName(item.person);
  const first = firstName(item.person);
  const rise = card ? changeTitle(card) : m.support_queue_fees_rise_unknown();
  let follows: string | null = null;
  let date: string | null = null;
  if (!item.onList) {
    follows = m.support_queue_fees_mark_joiner({ name: first });
  } else if (card && !card.effectiveFrom) {
    if (card.waitingFor <= 1) {
      follows = m.support_queue_fees_mark_last({
        name: first,
        date: DATE_MARK,
      });
      date = formatLongDay(card.earliestFrom);
    } else {
      const others = card.waitingFor - 1;
      follows =
        others === 1
          ? m.support_queue_fees_mark_others_one()
          : m.support_queue_fees_mark_others({ count: String(others) });
    }
  }
  return {
    title: m.support_queue_fees_mark_title({ name }),
    description: m.support_queue_fees_mark_description({
      rise,
      date: formatShortDay(item.changeSavedAt),
    }),
    counts: m.support_queue_fees_mark_counts({
      name: first,
      when: m.support_queue_fees_mark_when({
        date: formatShortDay(now.toISOString()),
        time: formatTime(now.toISOString()),
      }),
    }),
    follows,
    date,
    submit: m.support_queue_fees_mark_submit({ name }),
    placeholder: m.support_queue_fees_mark_placeholder({
      date: formatShortDay(now.toISOString()),
    }),
  };
}

/** The notice after a mark that went through (F4). */
export function markedNotice(
  item: FeeNoticeItem,
  change: { effectiveFrom: string | null; waitingFor: number }
): SettleNotice {
  const lead = m.support_queue_fees_marked_lead({
    name: personName(item.person),
  });
  if (change.effectiveFrom) {
    return {
      variant: 'success',
      lead,
      text: m.support_queue_fees_marked_dated({
        date: formatLongDay(change.effectiveFrom),
      }),
    };
  }
  return {
    variant: 'success',
    lead,
    text:
      change.waitingFor === 1
        ? m.support_queue_fees_marked_waiting_one()
        : change.waitingFor > 1
          ? m.support_queue_fees_marked_waiting({
              count: String(change.waitingFor),
            })
          : '',
  };
}

/** The next 08:00 UTC run after `now`, which sends the "it's off" emails. */
function nextDailyRun(now: Date): string {
  const run = new Date(now);
  run.setUTCHours(8, 0, 0, 0);
  if (run.getTime() <= now.getTime()) run.setTime(run.getTime() + DAY_MS);
  return run.toISOString();
}

/**
 * A refusal that closes the dialog, as a notice (F6), or null when the
 * dialog stays open to try again.
 */
export function markRefusalNotice(
  item: FeeNoticeItem,
  answer: SupportCommandFailure,
  now: Date = new Date()
): SettleNotice | null {
  const first = firstName(item.person);
  switch (answer.detailsCode) {
    case 'FEE_CHANGE_NOT_WAITING':
      if (answer.voidReason === 'cancelled' && answer.voidedAt) {
        const run = nextDailyRun(now);
        const days = daysFromToday(run, now);
        return {
          variant: 'warning',
          lead: m.support_queue_fees_refused_cancelled_lead({
            time: formatTime(answer.voidedAt),
          }),
          text: m.support_queue_fees_refused_cancelled({
            when:
              days === 0
                ? m.support_queue_fees_off_today({ time: formatTime(run) })
                : m.support_queue_fees_off_tomorrow({ time: formatTime(run) }),
          }),
        };
      }
      return {
        variant: 'warning',
        text: answer.message ?? m.support_queue_fees_refused_not_waiting(),
      };
    case 'FEE_NOTICE_ALREADY_TOLD':
      if (answer.state === 'told_another_way' && answer.toldAt) {
        return {
          variant: 'info',
          text: m.support_queue_fees_refused_already_marked({
            name: first,
            time: formatTime(answer.toldAt),
          }),
        };
      }
      if (answer.state === 'sent' && answer.acceptedAt) {
        return {
          variant: 'info',
          text: m.support_queue_fees_refused_already_sent({
            name: first,
            time: formatTime(answer.acceptedAt),
          }),
        };
      }
      return {
        variant: 'info',
        text: answer.message ?? m.support_queue_fees_refused_already_told(),
      };
    case 'FEE_NOTICE_NOT_NEEDED':
      return {
        variant: 'info',
        text: answer.message ?? m.support_queue_fees_refused_not_needed(),
      };
    default:
      return null;
  }
}
