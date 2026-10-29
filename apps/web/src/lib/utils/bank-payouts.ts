/**
 * When a payout's money reaches the bank, as Studio shows it (Codex-2hxff.29,
 * .30). Shared by Studio → Earnings and Org Studio → Payouts.
 *
 * Bank payouts are manual: a daily job at 08:00 London pays out the money
 * from sales more than 14 days old. A row's `bankOn` (the API's London date)
 * is that run; the Stripe balance says when the balance is using the money
 * instead (covering a take-back, or below zero).
 */

import * as m from '$paraglide/messages';

/** The creator's Connect state, as Earnings derives it. */
export type ConnectState =
  | 'not_started'
  | 'incomplete'
  | 'pending_verification'
  | 'enabled'
  | 'fetch_failed';

type ConnectStatusShape =
  | {
      isConnected: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      status: string | null;
    }
  | { fetchFailed: true }
  | null
  | undefined;

/** The Connect state from `GET /connect/me/status`, as both pages read it. */
export function deriveConnectState(s: ConnectStatusShape): ConnectState {
  if (!s) return 'not_started';
  if ('fetchFailed' in s) return 'fetch_failed';
  if (!s.isConnected) return 'not_started';
  if (s.chargesEnabled && s.payoutsEnabled) return 'enabled';
  if (s.status === 'restricted' || s.status === 'disabled') {
    return 'pending_verification';
  }
  return 'incomplete';
}

// ── Money and days ──────────────────────────────────────────────────────────

/** £12.34; a negative amount uses a real minus sign: −£8.40. */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? '−' : '';
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

const LONDON = 'Europe/London';
const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** An instant's London calendar day and hour. */
function london(at: Date): { day: string; hour: number } {
  const parts = Object.fromEntries(
    londonParts.formatToParts(at).map((p) => [p.type, p.value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

/** An instant's London calendar day, `YYYY-MM-DD`. */
export function londonDay(at: Date): string {
  return london(at).day;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A London `YYYY-MM-DD` as "29 Oct", "Thu 29 Oct" or "24 Apr 2027". Built by
 * hand: en-GB's short month for September is "Sept" in current ICU.
 */
export function formatDay(
  isoDay: string,
  options: { weekday?: boolean; year?: boolean } = {}
): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  if (!year || !month || !day) return isoDay;
  const label = `${day} ${MONTHS[month - 1]}`;
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return [options.weekday ? weekday : null, label, options.year ? year : null]
    .filter(Boolean)
    .join(' ');
}

/** The daily payout runs at 08:00 London. */
const BANK_PAYOUT_HOUR = 8;

/** Whether the 08:00 run on `bankOn` has happened by `now`. */
export function bankDayHasRun(bankOn: string, now: Date): boolean {
  const { day, hour } = london(now);
  return bankOn < day || (bankOn === day && hour >= BANK_PAYOUT_HOUR);
}

// ── The bank line under a row's status ──────────────────────────────────────

/**
 * One refund or dispute behind a balance below zero (`MyStripeBalanceCause`):
 * the server groups the person's steps per cause and sums them, so a solo
 * owner-creator's one chargeback is one entry, never "one other take-back".
 */
export interface BalanceCause {
  causeType: 'refund' | 'dispute';
  cents: number;
  /** London `YYYY-MM-DD` when Stripe took it back. */
  on: string;
  title: string | null;
  organizationId: string | null;
  organisationName: string | null;
  /** The payout types it was taken from; missing reads as unknown. */
  payoutTypes?: readonly string[];
}

/** What went towards a take-back, sale by sale (`MyStripeBalanceTowards`). */
export interface TowardsView {
  cents: number;
  rows: ReadonlyArray<{ payoutId: string; towardsCents: number }>;
  /** What it went towards, when the server says; else the words name neither. */
  causeType?: 'refund' | 'dispute' | null;
}

/** What the rows need from `MyStripeBalance`. */
export interface BalanceView {
  /**
   * AMENDMENT 3, the one source for every row: what of each sale went
   * towards a take-back instead of the bank, shared oldest first. `live` is
   * now (covering a take-back, or below zero); `lastEpisode` the last
   * below-zero episode that ended. Missing reads as nothing.
   */
  towards?: {
    live: TowardsView | null;
    lastEpisode: TowardsView | null;
  };
  /**
   * `since`: the first run that pays nothing. `causes`: what took it there,
   * newest first; missing reads as none.
   */
  negative: {
    owedCents: number;
    since: string;
    causes?: readonly BalanceCause[];
  } | null;
}

/**
 * What of a sale went towards a take-back, and what it went towards. The
 * live state first (it is the whole current picture), else the last ended
 * episode's. Below zero, the live share goes towards the latest cause.
 */
export function towardsOf(
  payoutId: string,
  balance: BalanceView | null
): { cents: number; live: boolean; causeType: 'refund' | 'dispute' | null } {
  const towards = balance?.towards;
  const live = towards?.live?.rows.find((r) => r.payoutId === payoutId);
  if (live && live.towardsCents > 0) {
    // The server's own word first. Its null is deliberate (none, mixed, or
    // past the cap) and stays null; only an older payload with no field at
    // all falls back to the newest cause below zero.
    const sent = towards?.live?.causeType;
    const cause =
      sent !== undefined
        ? sent
        : (balance?.negative?.causes?.[0]?.causeType ?? null);
    return { cents: live.towardsCents, live: true, causeType: cause };
  }
  const ended = towards?.lastEpisode?.rows.find((r) => r.payoutId === payoutId);
  if (ended && ended.towardsCents > 0) {
    return {
      cents: ended.towardsCents,
      live: false,
      causeType: towards?.lastEpisode?.causeType ?? null,
    };
  }
  return { cents: 0, live: false, causeType: null };
}

function towardsWhat(causeType: 'refund' | 'dispute' | null): string {
  if (causeType === 'dispute') return m.earnings_towards_what_chargeback();
  if (causeType === 'refund') return m.earnings_towards_what_refund();
  return m.earnings_towards_what_unknown();
}

export interface BankLineRow {
  id: string;
  status: string;
  reason: string | null;
  amountCents: number;
  bankOn: string | null;
  /** A `reversed` row's take-back: when Stripe took it back, and why. */
  takenBack?: { causeType: 'refund' | 'dispute'; on: string } | null;
}

const WAITING_REASONS = new Set(['connect_not_ready', 'connect_restricted']);

/**
 * The line under a row's status badge, or null for none.
 *
 * - A pending row waiting for setup says what it waits for.
 * - A reversed row says when Stripe took its money back, and why (E5).
 * - With no balance read, a passed day is "Due to your bank", never "Sent".
 * - A paid row says when it goes, or went, to the bank, less what went
 *   towards a take-back (AMENDMENT 3: the server's `towardsCents`, the one
 *   source, covering E5 and E6 and an ended episode alike). While Stripe has
 *   payouts paused, a row not yet gone stays in the balance (E4).
 */
export function bankLineFor(
  row: BankLineRow,
  ctx: {
    connectState: ConnectState;
    /**
     * The Stripe balance: `undefined` while it loads, `null` when there is
     * none to read or the read failed (the dates from our ledger still show).
     */
    balance: BalanceView | null | undefined;
    now: Date;
  }
): string | null {
  if (row.status === 'pending') {
    if (!row.reason || !WAITING_REASONS.has(row.reason)) return null;
    switch (ctx.connectState) {
      case 'not_started':
        return m.earnings_bank_waiting_not_started();
      case 'incomplete':
        return m.earnings_bank_waiting_incomplete();
      case 'pending_verification':
        return m.earnings_bank_waiting_paused();
      default:
        return null;
    }
  }
  if (row.status === 'reversed') {
    if (!row.takenBack) return null;
    const date = formatDay(row.takenBack.on);
    return row.takenBack.causeType === 'dispute'
      ? m.earnings_bank_taken_back_chargeback({ date })
      : m.earnings_bank_taken_back_refund({ date });
  }
  if (row.status !== 'resolved' || !row.bankOn) return null;
  const bankOn = row.bankOn;
  const hasRun = bankDayHasRun(bankOn, ctx.now);
  // Paused: the job can't pay out, and we don't know since when, so a date
  // that has passed may not have been kept. Say nothing rather than "Sent".
  if (ctx.connectState === 'pending_verification') {
    return hasRun ? null : m.earnings_bank_paused();
  }
  // Until the balance is known, any date may be one the balance is using,
  // a passed one too: show none rather than a line that then changes.
  if (ctx.balance === undefined) return null;
  const date = formatDay(bankOn);
  // Unread (the read failed, or there is none): our ledger's date, never
  // "Sent", which only a read balance can back (owner, r3-L1).
  if (ctx.balance === null) {
    return hasRun
      ? m.earnings_bank_due_on({ date })
      : m.earnings_bank_goes_on({ date });
  }
  const towards = towardsOf(row.id, ctx.balance);
  if (towards.cents > 0) {
    const what = towardsWhat(towards.causeType);
    if (towards.cents >= row.amountCents) {
      return m.earnings_bank_towards_all({ what });
    }
    const parts = {
      towards: formatPence(towards.cents),
      rest: formatPence(row.amountCents - towards.cents),
      what,
      date,
    };
    return hasRun
      ? m.earnings_bank_towards_part_went(parts)
      : m.earnings_bank_towards_part_goes(parts);
  }
  return hasRun
    ? m.earnings_bank_sent_on({ date })
    : m.earnings_bank_goes_on({ date });
}

// ── What took the balance below zero (E5, P2) ───────────────────────────────

/** ", along with one other take-back": the causes besides the latest. */
export function moreTakeBacks(others: number): string {
  if (others === 0) return '';
  return others === 1
    ? m.earnings_cause_more_one()
    : m.earnings_cause_more_many({ count: String(others) });
}

/**
 * Earnings' cause line: the latest take-back, as the M7 email words it, or
 * the generic line when the cause isn't known.
 */
export function negativeCauseLine(
  causes: readonly BalanceCause[] | undefined
): string {
  const [latest, ...others] = causes ?? [];
  if (!latest) return m.earnings_negative_cause();
  const organisation = latest.organisationName;
  const what = latest.title
    ? organisation
      ? m.earnings_cause_titled_in({ title: latest.title, organisation })
      : m.earnings_cause_titled({ title: latest.title })
    : organisation
      ? m.earnings_cause_untitled_in({ organisation })
      : m.earnings_cause_untitled();
  const parts = {
    what,
    amount: formatPence(latest.cents),
    date: formatDay(latest.on),
    more: moreTakeBacks(others.length),
  };
  return latest.causeType === 'dispute'
    ? m.earnings_negative_cause_chargeback(parts)
    : m.earnings_negative_cause_refund(parts);
}

/** The Q4 rule, as Stripe's figure stands (S1: decided by the data). */
export function ruleLine(rule: {
  kind: 'invoice' | 'stripe_writes_off';
  on: string;
}): { label: string; text: string } {
  const date = formatDay(rule.on, { year: true });
  return rule.kind === 'invoice'
    ? {
        label: m.earnings_negative_rule_invoice_label(),
        text: m.earnings_negative_rule_invoice({ date }),
      }
    : {
        label: m.earnings_negative_rule_writes_off_label(),
        text: m.earnings_negative_rule_writes_off({ date }),
      };
}
