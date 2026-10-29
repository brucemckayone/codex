/**
 * The money sweep's wording: every field it sends, composed here
 * (Codex-2hxff.34, .30; mock-b-studio emails.html M1-M3, M7-M10).
 *
 * The renderer has no conditionals and blanks any token not on a template's
 * allowlist, so the sender composes every either/or as a whole sentence.
 * Pure: the sweep reads the data, these put it into words, and the renderer
 * test (`packages/notifications/.../money-emails.test.ts`) renders these very
 * payloads against the seed's copy, so a renamed field can't render blank.
 */

import { debtRule, londonDate, type WaitingMoney } from '@codex/payments';

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

/** £1,234.56, or −£8.40 for a negative amount (a real minus sign). */
export function formatGbp(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const pounds = (Math.abs(cents) / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}£${pounds}`;
}

/** A London `YYYY-MM-DD` as "14 Sep 2026", or "14 Sep" without the year. */
function dayOf(isoDate: string, withYear: boolean): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const label = `${day} ${MONTHS[(month ?? 1) - 1]}`;
  return withYear ? `${label} ${year}` : label;
}

/** An instant as its London day: "14 Sep 2026". */
export function londonDay(at: Date, withYear = true): string {
  return dayOf(londonDate(at), withYear);
}

const SETUP_WORDING: Record<
  WaitingMoney['setup'],
  { statusSentence: string; buttonLabel: string }
> = {
  not_started: {
    statusSentence:
      "Your payouts aren't set up yet, so we can't send it. Connect a Stripe account from your Earnings page and we'll send it.",
    buttonLabel: 'Set up payouts',
  },
  incomplete: {
    statusSentence:
      "You started setting up payouts with Stripe but didn't finish, so we can't send it yet. Return to Stripe from your Earnings page to finish, and we'll send it.",
    buttonLabel: 'Finish setting up payouts',
  },
  paused: {
    statusSentence:
      "Stripe has paused your payouts while it reviews your account, so we can't send it yet. Stripe may need something from you: open your Earnings page and choose Resume onboarding to see what it needs.",
    buttonLabel: 'Open your Earnings page',
  },
};

/** The greeting: the person's name, else "there" (a token can't be null). */
export function greetingName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'there';
}

/** One line per organisation, joined with " · " (the body escapes HTML). */
export function organisationLines(waiting: WaitingMoney): string {
  return waiting.organisations
    .map((org) => {
      const name = org.name ?? 'Your own sales';
      const label = org.asOwner
        ? `${name} (organisation's share, as owner)`
        : name;
      return `${label}: ${formatGbp(org.cents)}`;
    })
    .join(' · ');
}

/** The `payouts-waiting` fields (emails.html M1-M3). */
export function waitingReminderData(
  waiting: WaitingMoney,
  userName: string,
  dashboardUrl: string
): Record<string, string> {
  const wording = SETUP_WORDING[waiting.setup];
  return {
    userName,
    totalFormatted: formatGbp(waiting.totalCents),
    organisationLines: organisationLines(waiting),
    waitingSince: londonDay(waiting.oldestAt),
    statusSentence: wording.statusSentence,
    buttonLabel: wording.buttonLabel,
    dashboardUrl,
  };
}

/** A take-back step that could have started the episode. */
export interface TakeBack {
  cents: number;
  causeType: string;
  at: Date;
  title: string | null;
  organisationName: string | null;
}

/**
 * The below-zero email's cause and its paid-back line (emails.html M7, M8).
 * `takeBacks` is newest first. A chargeback can be paid back if the bank
 * decides for us; a refund can't, so its line is empty.
 */
export function takeBackSentences(takeBacks: readonly TakeBack[]): {
  takeBackSentence: string;
  paidBackSentence: string;
} {
  const [latest, ...others] = takeBacks;
  if (!latest) {
    return {
      takeBackSentence:
        'Money was taken back from your Stripe balance for a refund or a chargeback.',
      paidBackSentence: '',
    };
  }
  const what = latest.causeType === 'dispute' ? 'A chargeback' : 'A refund';
  const on = latest.title ? `‘${latest.title}’` : 'one of your sales';
  const org = latest.organisationName ? ` (${latest.organisationName})` : '';
  const amount = formatGbp(latest.cents);
  const more =
    others.length === 0
      ? ''
      : others.length === 1
        ? ', along with one other take-back'
        : `, along with ${others.length} other take-backs`;
  return {
    takeBackSentence: `${what} on ${on}${org} took back ${amount} on ${londonDay(latest.at, false)}${more}.`,
    paidBackSentence:
      latest.causeType === 'dispute'
        ? `If the buyer's bank decides for us, the ${amount} is paid back to you.`
        : '',
  };
}

/** The Q4 rule line, on the amount owed now (S1: decided by the data). */
export function ruleSentence(owedCents: number, negativeSince: Date): string {
  const rule = debtRule(owedCents, negativeSince);
  const on = dayOf(rule.on, true);
  return rule.kind === 'invoice'
    ? `Over £50: if more than £50 is still owed on ${on}, we'll send you an invoice for what's left.`
    : `£50 or less: if it's still below zero on ${on}, we'll write off what's left.`;
}

/**
 * The episode a balance notice belongs to: the account, its start, and the
 * last check above zero before it (`/<negative_after>`, left out when there
 * was none). Both bounds of the cause's window ride in the key because the
 * clearing write nulls them, and the recovered and written-off emails must
 * name the take-back the below-zero email named.
 */
export function episodeKey(
  stripeAccountId: string,
  negativeSince: Date,
  negativeAfter: Date | null
) {
  const key = `${stripeAccountId}:${negativeSince.toISOString()}`;
  return negativeAfter ? `${key}/${negativeAfter.toISOString()}` : key;
}

/** The episode's window, read back from its key; null for a key not made by `episodeKey`. */
export function episodeOf(
  periodKey: string
): { negativeSince: Date; negativeAfter: Date | null } | null {
  const at = periodKey.indexOf(':');
  if (at < 0) return null;
  const [since = '', after] = periodKey.slice(at + 1).split('/');
  const negativeSince = new Date(since);
  if (Number.isNaN(negativeSince.getTime())) return null;
  if (after === undefined) return { negativeSince, negativeAfter: null };
  const negativeAfter = new Date(after);
  return Number.isNaN(negativeAfter.getTime())
    ? null
    : { negativeSince, negativeAfter };
}

/** "the chargeback on ‘Winter Light’": the episode's latest take-back, inside a sentence. */
function causePhrase(latest: TakeBack | undefined): string {
  if (!latest) return 'a refund or a chargeback';
  const what = latest.causeType === 'dispute' ? 'the chargeback' : 'the refund';
  return latest.title
    ? `${what} on ‘${latest.title}’`
    : `${what} on one of your sales`;
}

/** The `stripe-balance-below-zero` fields (M7, M8). */
export function belowZeroData(input: {
  userName: string;
  availableCents: number;
  negativeSince: Date;
  takeBacks: readonly TakeBack[];
  dashboardUrl: string;
}): Record<string, string> {
  return {
    userName: input.userName,
    balanceFormatted: formatGbp(input.availableCents),
    ...takeBackSentences(input.takeBacks),
    ruleSentence: ruleSentence(-input.availableCents, input.negativeSince),
    dashboardUrl: input.dashboardUrl,
  };
}

/**
 * The `stripe-balance-recovered` fields (M9): what new sales covered, named
 * by its take-back. `leftCents` is what the below-zero email said was owed.
 */
export function recoveredData(input: {
  userName: string;
  availableCents: number;
  leftCents: number | null;
  takeBacks: readonly TakeBack[];
  dashboardUrl: string;
}): Record<string, string> {
  const cause = causePhrase(input.takeBacks[0]);
  return {
    userName: input.userName,
    balanceFormatted: formatGbp(input.availableCents),
    coveredSentence:
      input.leftCents !== null && input.leftCents > 0
        ? `New sales have covered the ${formatGbp(-input.leftCents)} left by ${cause}, so bank payouts have resumed.`
        : `New sales have covered what ${cause} left, so bank payouts have resumed.`,
    dashboardUrl: input.dashboardUrl,
  };
}

/** The `debt-written-off` fields (M10): £50 or less, written off at 180 days. */
export function writtenOffData(input: {
  userName: string;
  writtenOffCents: number;
  availableCents: number;
  negativeSince: Date;
  takeBacks: readonly TakeBack[];
  dashboardUrl: string;
}): Record<string, string> {
  const latest = input.takeBacks[0];
  return {
    userName: input.userName,
    amountFormatted: formatGbp(input.writtenOffCents),
    balanceFormatted: formatGbp(input.availableCents),
    sinceSentence: latest
      ? `Your Stripe balance had been below zero since ${causePhrase(latest)} on ${londonDay(latest.at)}.`
      : `Your Stripe balance had been below zero since ${londonDay(input.negativeSince)}.`,
    dashboardUrl: input.dashboardUrl,
  };
}
