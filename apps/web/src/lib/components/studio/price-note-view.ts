/**
 * Words for what a creator is told about a price change (Codex-2hxff.85 M3,
 * .86; batch C1 Part B page 4).
 *
 * - The Edit Tier dialog's line before saving (owner decision Q7): P1, who
 *   will be emailed; P8, a change still going out that the save replaces.
 * - The note after saving, on the tier row and in the Offer panel
 *   (`PriceChangeNote`): P2 saved, P3/P4 done, P5/P6 mid-run, P7 paused,
 *   P9 a newer price replacing a running one, P10 the read failed.
 *
 * Display only: who is due, emailed, moved or held, and when the runs are,
 * are the server's answer (`PriceChangeProgress`). The server gives one item
 * per interval; one save stamps each interval it changed with the same
 * `createdAt`, so a note covers one save: "New prices saved" names both.
 *
 * Times are London times, as the hourly run's are.
 */

import type { PriceChangeProgress } from '@codex/subscription';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';

const TIME_ZONE = 'Europe/London';
const DAY_MS = 86_400_000;
/** Q8: a finished note leaves by itself 14 days after the last email. */
const DONE_SHOWN_FOR_MS = 14 * DAY_MS;

/**
 * People the hourly run emails at most, the server's `PRICE_MOVES_PER_RUN`
 * (`@codex/subscription`, not imported: it would bring the service package
 * into the browser). A test pins the two together.
 */
export const PRICE_EMAILS_PER_RUN = 1125;

export interface EditTierHint {
  /** `emailed` is P1, with the mail icon; `going_out` is P8, a warning. */
  kind: 'emailed' | 'going_out';
  lead: string;
  body: string;
}

type Interval = PriceChangeProgress['interval'];

interface PricePair {
  monthly: unknown;
  annual: unknown;
}

const moved = (next: unknown, saved: unknown) =>
  typeof next === 'number' && Number.isFinite(next) && next !== saved;

/**
 * The line, or null when there is nothing to say: no price moved, or nobody
 * subscribes to the tier. A price field left empty is not a new price.
 */
export function editTierHint(input: {
  name: string;
  subscribers: number;
  saved: { monthly: number; annual: number };
  next: PricePair;
}): EditTierHint | null {
  const monthly = moved(input.next.monthly, input.saved.monthly);
  const annual = moved(input.next.annual, input.saved.annual);
  if ((!monthly && !annual) || input.subscribers <= 0) return null;
  const { name } = input;
  if (monthly && annual) {
    return {
      kind: 'emailed',
      lead:
        input.subscribers === 1
          ? m.price_note_edit_lead_one({ name })
          : m.price_note_edit_lead({
              count: count(input.subscribers),
              name,
            }),
      body: m.price_note_edit_body(),
    };
  }
  // One interval moved: the tier's count covers both, so it isn't said.
  return {
    kind: 'emailed',
    lead: monthly
      ? m.price_note_edit_lead_monthly({ name })
      : m.price_note_edit_lead_annual({ name }),
    body: m.price_note_edit_body_one(),
  };
}

/**
 * P8: a price the creator is changing again while its emails are still
 * going out. Saving replaces it (latest wins), so everyone is emailed about
 * the new price, the people already told included. When both moved prices
 * are still sending, one warning names both, its counts summed ("monthly
 * and annual are counted together"). Latest wins per interval, so a price
 * left as it was is never part of it. Null when no moved price is sending.
 */
export function stillGoingOutHint(input: {
  /** This tier's (or plan's) changes, as the progress read gave them. */
  changes: readonly PriceChangeProgress[];
  saved: PricePair;
  next: PricePair;
}): EditTierHint | null {
  const intervals: Array<[Interval, unknown, unknown]> = [
    ['month', input.next.monthly, input.saved.monthly],
    ['year', input.next.annual, input.saved.annual],
  ];
  const sending: PriceChangeProgress[] = [];
  for (const [interval, next, saved] of intervals) {
    if (!moved(next, saved)) continue;
    const change = input.changes.find(
      (c) =>
        c.interval === interval &&
        c.state === 'running' &&
        c.counts.emailed > 0 &&
        c.counts.due > 0
    );
    if (change) sending.push(change);
  }
  const [first] = sending;
  if (!first) return null;
  const sum = (field: keyof PriceChangeProgress['counts']) =>
    count(sending.reduce((n, c) => n + c.counts[field], 0));
  const total = sum('total');
  const emailed = sum('emailed');
  if (sending.length > 1) {
    const old = prices(sending, (c) => c.newAmountCents);
    return {
      kind: 'going_out',
      lead: m.price_note_going_out_lead_both({ to: old, emailed, total }),
      body: m.price_note_going_out_body_both({ old, total, emailed }),
    };
  }
  return {
    kind: 'going_out',
    lead: m.price_note_going_out_lead({
      to: perInterval(first.newAmountCents, first.interval),
      emailed,
      total,
    }),
    body: m.price_note_going_out_body({
      amount: formatPrice(first.newAmountCents),
      total,
      emailed,
    }),
  };
}

// ── The note after saving ─────────────────────────────────────────────────

/** Whose price changed: a tier, by name, or the course the panel edits. */
export type PriceNoteSubject =
  | { kind: 'tier'; name: string }
  | { kind: 'course' };

export interface PriceNoteCount {
  value: string;
  label: string;
}

export interface PriceNoteView {
  /** The changes it covers. Dismiss writes `price-change:<id>` for each. */
  ids: string[];
  /** One save: the subject and its `createdAt`. Check again keys on it. */
  key: string;
  icon: 'mail' | 'clock' | 'pause' | 'alert';
  tone: 'info' | 'warning';
  /** In bold. */
  lead: string;
  text: string;
  /** Emails sent, as a percentage, while it runs. */
  bar: number | null;
  counts: PriceNoteCount[];
  meta: string | null;
  action: 'check' | 'dismiss' | null;
  /** The last run it reflects, for Check again's comparison. */
  lastRunAt: string | null;
}

/** What a Check again press saw: which note, when, and its last run then. */
export interface PriceNoteCheck {
  key: string;
  at: string;
  lastRunAt: string | null;
}

export const dismissalKey = (changeId: string) => `price-change:${changeId}`;

/**
 * The notes for one subject's changes, newest first: one per save. A
 * replaced change has no note of its own (the newer one says it replaced
 * it, P9), nor does a change with nobody to tell. A finished note goes 14
 * days after its last email (Q8), or when dismissed (`isDismissed`).
 *
 * A newer save also replaces a DONE change's note (owner decision,
 * 2026-11-01): the done change for the same subject and interval that
 * finished within 14 days before the newer save. The server links only
 * running and stopped changes (`supersededById`), so the done one is found
 * here: the newest such. Inside that window nobody has moved yet, since
 * each move waits 30 days after the person's email. Outside it, the newer
 * note reads as a plain save (P2). The link is a fact about the price, so
 * it holds after the done note was dismissed.
 */
export function priceChangeNotes(input: {
  /** Every change the read gave, so a replaced one can be found. */
  all: readonly PriceChangeProgress[];
  /** This subject's: `tierId` (or the plan) already matched. */
  changes: readonly PriceChangeProgress[];
  subject: PriceNoteSubject;
  now: Date;
  check?: PriceNoteCheck | null;
  isDismissed?: (key: string) => boolean;
}): PriceNoteView[] {
  const groups = new Map<string, PriceChangeProgress[]>();
  const doneReplaced = new Map<string, PriceChangeProgress>();
  for (const change of input.changes) {
    if (change.state === 'superseded' || change.counts.total === 0) continue;
    const key = `${subjectOf(change)}:${change.createdAt}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
    const done = doneChangeReplacedBy(change, input.all);
    if (done) doneReplaced.set(change.id, done);
  }
  const replacedIds = new Set([...doneReplaced.values()].map((c) => c.id));
  const views: PriceNoteView[] = [];
  for (const [key, group] of groups) {
    const ids = group.map((c) => c.id);
    if (ids.some((id) => replacedIds.has(id))) continue;
    if (
      input.isDismissed &&
      ids.some((id) => input.isDismissed?.(dismissalKey(id)))
    ) {
      continue;
    }
    // What each change replaced, for the P9 words: the change it superseded
    // (one per interval), else the done one. A done change behind a
    // superseded one has no note either, but the words name the latest.
    const replaced = group.flatMap((change) => {
      const superseded = input.all.filter(
        (c) => c.supersededById === change.id
      );
      if (superseded.length > 0) return superseded;
      const done = doneReplaced.get(change.id);
      return done ? [done] : [];
    });
    const view = noteFor({
      key,
      group: sortByInterval(group),
      replaced,
      subject: input.subject,
      now: input.now,
      check: input.check?.key === key ? input.check : null,
    });
    if (view) views.push(view);
  }
  return views;
}

function subjectOf(change: PriceChangeProgress): string | null {
  return change.tierId ?? change.courseSubscriptionPlanId;
}

/**
 * The done change `newer` replaces: same subject and interval, saved before
 * it, and finished within 14 days before it was saved. The newest one.
 */
function doneChangeReplacedBy(
  newer: PriceChangeProgress,
  all: readonly PriceChangeProgress[]
): PriceChangeProgress | null {
  const savedAt = Date.parse(newer.createdAt);
  let found: PriceChangeProgress | null = null;
  for (const c of all) {
    if (c.id === newer.id || c.state !== 'done' || !c.doneAt) continue;
    if (subjectOf(c) !== subjectOf(newer) || c.interval !== newer.interval) {
      continue;
    }
    const since = savedAt - Date.parse(c.doneAt);
    if (Date.parse(c.createdAt) >= savedAt || since < 0) continue;
    if (since >= DONE_SHOWN_FOR_MS) continue;
    if (!found || Date.parse(c.createdAt) > Date.parse(found.createdAt)) {
      found = c;
    }
  }
  return found;
}

function noteFor(input: {
  key: string;
  group: PriceChangeProgress[];
  replaced: PriceChangeProgress[];
  subject: PriceNoteSubject;
  now: Date;
  check: PriceNoteCheck | null;
}): PriceNoteView | null {
  const { group, subject, now } = input;
  const sum = (field: keyof PriceChangeProgress['counts']) =>
    group.reduce((n, c) => n + c.counts[field], 0);
  const total = sum('total');
  const emailed = sum('emailed');
  const scheduled = sum('scheduled');
  const held = sum('held');
  const due = sum('due');
  const retrying = sum('retrying');
  const both = group.length > 1;
  const to = prices(group, (c) => c.newAmountCents);
  const from = prices(group, (c) => c.fromAmountCents);
  const lastRunAt = latest(group.map((c) => c.lastRunAt));
  const base = {
    ids: group.map((c) => c.id),
    key: input.key,
    lastRunAt,
  };

  if (group.some((c) => c.state === 'stopped')) {
    return {
      ...base,
      icon: 'pause',
      tone: 'warning',
      lead: m.price_note_paused_lead({ who: everyone(subject), to }),
      text: m.price_note_paused_body({ from }),
      bar: null,
      counts: [
        { value: count(emailed), label: m.price_note_count_emailed() },
        { value: count(due), label: m.price_note_count_waiting() },
      ],
      meta: null,
      action: null,
    };
  }

  const running = group.filter((c) => c.state === 'running');
  if (running.length > 0) {
    // Only a running change has runs ahead.
    const nextRunAt = earliest(running.map((c) => c.nextRunAt));
    const at = nextRunAt ? when(nextRunAt, now) : m.price_note_when_next_run();
    if (emailed === 0 && retrying === 0 && held === 0) {
      return {
        ...base,
        ...savedWords(input, total, at),
        bar: null,
        counts: [],
        meta: null,
        action: null,
      };
    }
    const counts: PriceNoteCount[] = [
      { value: count(emailed), label: m.price_note_count_emailed() },
      { value: count(scheduled), label: m.price_note_count_scheduled() },
    ];
    if (due - retrying > 0) {
      counts.push({
        value: count(due - retrying),
        label: m.price_note_count_to_email(),
      });
    }
    if (retrying > 0) {
      counts.push({
        value: count(retrying),
        label: m.price_note_count_retrying({ time: at }),
      });
    }
    if (held > 0) {
      counts.push({ value: count(held), label: m.price_note_count_held() });
    }
    const doneBy = latest(running.map((c) => c.estimatedDoneAt));
    return {
      ...base,
      icon: 'mail',
      tone: 'info',
      lead: m.price_note_running_lead({ who: yours(subject, total), to }),
      text: m.price_note_moves_keeps({ from }),
      bar: Math.round((emailed / total) * 100),
      counts,
      meta: runningMeta({
        check: input.check,
        lastRunAt,
        nextRunAt,
        doneBy,
        due,
        retrying,
        held,
        now,
      }),
      action: 'check',
    };
  }

  // Done. The note leaves by itself 14 days after the last email (Q8).
  const doneAt = latest(group.map((c) => c.doneAt));
  if (doneAt && now.getTime() - Date.parse(doneAt) >= DONE_SHOWN_FOR_MS) {
    return null;
  }
  const notEmailed = Math.min(held, Math.max(0, total - emailed));
  const notMoved = held - notEmailed;
  const what = both ? m.price_note_what_prices() : m.price_note_what_price();
  const counts: PriceNoteCount[] = [
    { value: count(emailed), label: m.price_note_count_emailed() },
    { value: count(scheduled), label: m.price_note_count_scheduled() },
  ];
  if (notEmailed > 0) {
    counts.push({
      value: count(notEmailed),
      label: m.price_note_count_not_emailed(),
    });
  }
  if (notMoved > 0) {
    counts.push({ value: count(notMoved), label: m.price_note_count_held() });
  }
  const meta: string[] = [];
  if (held > 0) {
    const keeps = prices(
      group.filter((c) => c.counts.held > 0),
      (c) => c.fromAmountCents
    );
    const args = { count: count(held), from: keeps };
    meta.push(
      notMoved === 0
        ? m.price_note_done_held_not_emailed(args)
        : notEmailed === 0
          ? m.price_note_done_held_not_moved(args)
          : m.price_note_done_held_both(args)
    );
  }
  if (doneAt) {
    meta.push(
      daysFrom(doneAt, now) === 0
        ? m.price_note_finished_today({ time: clock(doneAt) })
        : m.price_note_finished_on({
            date: dayMonth(doneAt),
            time: clock(doneAt),
          })
    );
  }
  return {
    ...base,
    icon: 'mail',
    tone: 'info',
    lead: doneLead(subject, { total, emailed, what }),
    text: m.price_note_moves(),
    bar: null,
    counts,
    meta: meta.length > 0 ? meta.join(' ') : null,
    action: 'dismiss',
  };
}

/** P2, or P9 when it replaced a running one: before the first run. */
function savedWords(
  input: {
    group: PriceChangeProgress[];
    replaced: PriceChangeProgress[];
    subject: PriceNoteSubject;
  },
  total: number,
  at: string
): Pick<PriceNoteView, 'icon' | 'tone' | 'lead' | 'text'> {
  const { group, subject } = input;
  const both = group.length > 1;
  const to = prices(group, (c) => c.newAmountCents);
  const from = prices(group, (c) => c.fromAmountCents);
  if (input.replaced.length > 0) {
    const replaced = sortByInterval(input.replaced);
    const old = prices(replaced, (c) => c.newAmountCents);
    const told = replaced.reduce((n, c) => n + c.counts.emailed, 0);
    // "about £10.00 … about £9.00": one price needs no interval.
    const toWord = both ? to : formatPrice(group[0]?.newAmountCents);
    const oldWord =
      replaced.length > 1 ? old : formatPrice(replaced[0]?.newAmountCents);
    const who = all(subject, total);
    return {
      icon: 'clock',
      tone: 'info',
      lead: both
        ? m.price_note_replaces_lead_both({ to, old })
        : m.price_note_replaces_lead({ to, old }),
      text: [
        told > 0
          ? m.price_note_replaces_start({
              who,
              to: toWord,
              time: at,
              told: count(told),
              old: oldWord,
            })
          : m.price_note_replaces_start_none_told({
              who,
              to: toWord,
              time: at,
            }),
        m.price_note_moves(),
      ].join(' '),
    };
  }
  const who = yours(subject, total);
  if (subject.kind === 'course') {
    return {
      icon: 'clock',
      tone: 'info',
      lead: both
        ? m.price_note_saved_lead_course()
        : m.price_note_saved_lead_course_one_price(),
      text: [
        m.price_note_saved_start_course({ who, time: at }),
        m.price_note_saved_moves_to_course({ to }),
      ].join(' '),
    };
  }
  return {
    icon: 'clock',
    tone: 'info',
    lead: both
      ? m.price_note_saved_lead_tier()
      : m.price_note_saved_lead_tier_one_price(),
    text: [
      both
        ? m.price_note_saved_start_tier({ who, time: at })
        : m.price_note_saved_start_tier_one_price({ who, time: at }),
      m.price_note_saved_moves_to({ to, from }),
    ].join(' '),
  };
}

/** P5's line, or P6's once Check again found the same run. */
function runningMeta(input: {
  check: PriceNoteCheck | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  doneBy: string | null;
  due: number;
  retrying: number;
  held: number;
  now: Date;
}): string | null {
  const { lastRunAt, nextRunAt, doneBy, now } = input;
  const perRun = count(PRICE_EMAILS_PER_RUN);
  if (input.check && input.check.lastRunAt === lastRunAt && lastRunAt) {
    const parts = [
      m.price_note_checked({
        time: clock(input.check.at),
        run: runPhrase(lastRunAt, now),
      }),
    ];
    if (input.due > PRICE_EMAILS_PER_RUN && nextRunAt && doneBy) {
      parts.push(
        m.price_note_checked_next({
          perRun,
          time: when(nextRunAt, now),
          done: when(doneBy, now),
        })
      );
    } else if (input.due > 0 && nextRunAt) {
      parts.push(m.price_note_checked_rest({ time: when(nextRunAt, now) }));
    }
    return parts.join(' ');
  }
  const parts: string[] = [];
  if (input.due - input.retrying > 0 && doneBy) {
    parts.push(m.price_note_running_rate({ perRun, time: when(doneBy, now) }));
  }
  if (input.held > 0) {
    parts.push(m.price_note_running_held({ count: count(input.held) }));
  }
  if (lastRunAt) {
    parts.push(m.price_note_running_as_of({ run: runPhrase(lastRunAt, now) }));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function doneLead(
  subject: PriceNoteSubject,
  { total, emailed, what }: { total: number; emailed: number; what: string }
): string {
  if (emailed >= total) {
    if (total === 1) {
      return subject.kind === 'tier'
        ? m.price_note_done_one_tier({ name: subject.name, what })
        : m.price_note_done_one_course({ what });
    }
    return m.price_note_done_all({ who: counted(subject, total), what });
  }
  return m.price_note_done_some({
    emailed: count(emailed),
    who: counted(subject, total),
    what,
  });
}

// ── Who, prices and times ─────────────────────────────────────────────────

/** "your 23 Pro subscribers", "the 38 people subscribed to this course". */
function yours(subject: PriceNoteSubject, total: number): string {
  if (subject.kind === 'tier') {
    return total === 1
      ? m.price_note_who_tier_one({ name: subject.name })
      : m.price_note_who_tier({ count: count(total), name: subject.name });
  }
  return total === 1
    ? m.price_note_who_course_one()
    : m.price_note_who_course({ count: count(total) });
}

/** "all 6,240 Members subscribers"; one person is "your 1 …". */
function all(subject: PriceNoteSubject, total: number): string {
  if (total === 1) return yours(subject, total);
  return subject.kind === 'tier'
    ? m.price_note_who_all_tier({ count: count(total), name: subject.name })
    : m.price_note_who_all_course({ count: count(total) });
}

/** "23 Pro subscribers": after "All" and "22 of". */
function counted(subject: PriceNoteSubject, total: number): string {
  return subject.kind === 'tier'
    ? m.price_note_count_tier({ count: count(total), name: subject.name })
    : m.price_note_count_course({ count: count(total) });
}

/** "your Members subscribers": nobody counted. */
function everyone(subject: PriceNoteSubject): string {
  return subject.kind === 'tier'
    ? m.price_note_everyone_tier({ name: subject.name })
    : m.price_note_everyone_course();
}

function count(n: number): string {
  return n.toLocaleString('en-GB');
}

function perInterval(cents: number, interval: Interval): string {
  const price = formatPrice(cents);
  return interval === 'month'
    ? m.price_note_per_month({ price })
    : m.price_note_per_year({ price });
}

/** "£14.00/mo or £140.00/yr", monthly first. */
function prices(
  changes: readonly PriceChangeProgress[],
  amount: (c: PriceChangeProgress) => number
): string {
  const [first, second] = sortByInterval(changes).map((c) =>
    perInterval(amount(c), c.interval)
  );
  if (!first) return '';
  return second ? m.price_note_or({ first, second }) : first;
}

function sortByInterval(
  changes: readonly PriceChangeProgress[]
): PriceChangeProgress[] {
  return [...changes].sort((a, b) =>
    a.interval === b.interval ? 0 : a.interval === 'month' ? -1 : 1
  );
}

function latest(values: Array<string | null>): string | null {
  return values.reduce<string | null>(
    (best, v) => (v && (!best || Date.parse(v) > Date.parse(best)) ? v : best),
    null
  );
}

function earliest(values: Array<string | null>): string | null {
  return values.reduce<string | null>(
    (best, v) => (v && (!best || Date.parse(v) < Date.parse(best)) ? v : best),
    null
  );
}

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
// The full month in sentences, as the fee note (`upcoming-fee-view.ts`)
// and the Studio mockups write it: "on 3 November".
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

/** `16:00` */
function clock(iso: string): string {
  return clockFormatter.format(new Date(iso));
}

/** `2 November` */
function dayMonth(iso: string): string {
  return dayMonthFormatter.format(new Date(iso));
}

/** London days from `now`'s to `iso`'s: 0 today, 1 tomorrow, -1 yesterday. */
function daysFrom(iso: string, now: Date): number {
  const day = (d: Date) => Date.parse(londonDayKey.format(d));
  return Math.round((day(new Date(iso)) - day(now)) / DAY_MS);
}

/** A time ahead: `18:00`, `09:00 tomorrow`, `09:00 on 3 November`. */
function when(iso: string, now: Date): string {
  const days = daysFrom(iso, now);
  const time = clock(iso);
  if (days === 0) return time;
  if (days === 1) return m.price_note_when_tomorrow({ time });
  return m.price_note_when_on({ time, date: dayMonth(iso) });
}

/**
 * A run behind: `the 16:00 run`, `yesterday's 23:00 run`, `the 23:00 run on
 * 31 October`.
 */
function runPhrase(iso: string, now: Date): string {
  const days = daysFrom(iso, now);
  const time = clock(iso);
  if (days === 0) return m.price_note_run_today({ time });
  if (days === -1) return m.price_note_run_yesterday({ time });
  return m.price_note_run_on({ time, date: dayMonth(iso) });
}
