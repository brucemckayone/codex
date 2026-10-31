/**
 * The fee emails' wording (Codex-2hxff.33; batch C1 Part B fee-email.html
 * E1-E5): every field the fee step sends, composed here.
 *
 * The renderer has no conditionals and blanks any token not on a template's
 * allowlist, so the opening sentence, the change lines and the example are
 * whole sentences built from the person's fees before and after, per role.
 * Pure: the step reads the data, these put it into words, and
 * `__tests__/fee-notice-copy.test.ts` renders these very payloads against
 * the seed's copy, so a renamed field can't render blank.
 */

import type {
  FeeNoticeRole,
  FeeNoticeRoleValues,
  FeeNoticeValues,
} from '@codex/database/schema';
import { exampleOneOffSplit } from '@codex/payments';
import { formatGbp } from './money-notice-copy';

/** Q1 (A): the date can only move later, and the email says so. */
export const FEE_RULE_SENTENCE =
  "The date can move later, never earlier: if we can't reach everyone this affects straight away, it starts 30 days after the last person is told. Studio always shows the current date.";

const EXAMPLE_GROSS_CENTS = 1000;

/** The organisation names and slugs a person's roles refer to. */
export type OrgNames = ReadonlyMap<string, { name: string; slug: string }>;

/** "10%", "12.5%". */
export function formatPercent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** "88p" under a pound, else "£7.92" (as the payout terms write them). */
export function formatPence(cents: number): string {
  return cents < 100 && cents >= 0 ? `${cents}p` : formatGbp(cents);
}

/** A London calendar date: "4 December 2026", or "3 November" without the year. */
export function londonLongDate(at: Date, withYear = true): string {
  return at.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

function orgName(names: OrgNames, organizationId: string | null): string {
  if (!organizationId) return 'your own';
  return names.get(organizationId)?.name ?? 'your organisation';
}

/** Possessive: "Hollow Oak Films’", "Northlight’s". */
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

const OUR_FEE_VALUES: ReadonlyArray<keyof FeeNoticeValues> = [
  'platformFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
];

function valueLine(
  role: FeeNoticeRole,
  names: OrgNames,
  key: keyof FeeNoticeValues,
  context: 'both' | 'one_off' | 'subscription',
  from: number,
  to: number
): string {
  const arrow = (a: string, b: string) => `${a} → ${b}`;
  switch (key) {
    case 'platformFeePercent':
      return `Our fee: ${arrow(formatPercent(from), formatPercent(to))} of each sale`;
    case 'minPlatformFeeCents':
      return `Our minimum fee on a sale: ${arrow(formatPence(from), formatPence(to))}`;
    case 'minTransferCents':
      return `Smallest payment we send: ${arrow(
        from === 0 ? 'none' : formatPence(from),
        to === 0 ? 'none' : formatPence(to)
      )}. Anything smaller waits until it adds up`;
    case 'orgFeePercent': {
      const whose = possessive(orgName(names, role.organizationId));
      const where =
        context === 'one_off'
          ? ' on sales and courses'
          : context === 'subscription'
            ? ' on course subscription payments'
            : '';
      const of = role.as === 'owner' ? 'sales' : 'your sales';
      return `${whose} share of ${of}${where}: ${arrow(formatPercent(from), formatPercent(to))} of what’s left after our fee, where no revenue-share agreement applies`;
    }
  }
}

/** Every value that moves in one role, merged across the two kinds of sale. */
function roleLines(
  before: FeeNoticeRoleValues,
  after: FeeNoticeRoleValues,
  names: OrgNames
): { lines: string[]; ourFeeOnly: boolean } {
  const lines: string[] = [];
  let ourFeeOnly = true;
  for (const key of [
    'platformFeePercent',
    'orgFeePercent',
    'minPlatformFeeCents',
    'minTransferCents',
  ] as const) {
    const one = { from: before.oneOff[key], to: after.oneOff[key] };
    const sub = { from: before.subscription[key], to: after.subscription[key] };
    const moves = one.from !== one.to || sub.from !== sub.to;
    if (!moves) continue;
    if (!OUR_FEE_VALUES.includes(key)) ourFeeOnly = false;
    if (one.from === sub.from && one.to === sub.to) {
      lines.push(valueLine(before, names, key, 'both', one.from, one.to));
      continue;
    }
    if (one.from !== one.to) {
      lines.push(valueLine(before, names, key, 'one_off', one.from, one.to));
    }
    if (sub.from !== sub.to) {
      lines.push(
        valueLine(before, names, key, 'subscription', sub.from, sub.to)
      );
    }
  }
  return { lines, ourFeeOnly };
}

function roleWhere(role: FeeNoticeRole, names: OrgNames): string {
  if (role.as === 'owner') {
    return `On ${possessive(orgName(names, role.organizationId))} share`;
  }
  return role.organizationId
    ? `On your sales in ${orgName(names, role.organizationId)}`
    : 'On your own sales';
}

/**
 * The change lines, one per moving value, each ending in a full stop so they
 * still read when a mail client runs them together. A person with several
 * roles whose lines differ gets each prefixed with where it applies; when
 * every role moves alike, one set of lines covers them (E1's note).
 */
export function changeLines(
  before: FeeNoticeRoleValues[],
  after: FeeNoticeRoleValues[],
  names: OrgNames
): { text: string; ourFeeOnly: boolean } {
  const perRole = before.map((role, index) => {
    const next = after[index];
    return {
      role,
      ...(next
        ? roleLines(role, next, names)
        : { lines: [], ourFeeOnly: true }),
    };
  });
  const moving = perRole.filter((r) => r.lines.length > 0);
  const ourFeeOnly = moving.every((r) => r.ourFeeOnly);
  const first = moving[0]?.lines.join('\n');
  const alike = moving.every((r) => r.lines.join('\n') === first);
  const lines = alike
    ? (moving[0]?.lines ?? [])
    : moving.flatMap((r) =>
        r.lines.map((line) => `${roleWhere(r.role, names)}: ${line}`)
      );
  return {
    text: [...new Set(lines)].map((line) => `${line}.`).join('\n'),
    ourFeeOnly,
  };
}

/** "your sales", "Hollow Oak Films’ sales", or both joined. */
function whoseSales(roles: FeeNoticeRole[], names: OrgNames): string {
  const parts: string[] = [];
  if (roles.some((r) => r.as === 'creator')) parts.push('your sales');
  const owned = [
    ...new Set(
      roles
        .filter((r) => r.as === 'owner' && r.organizationId)
        .map((r) => r.organizationId as string)
    ),
  ];
  for (const orgId of owned) {
    parts.push(`${possessive(orgName(names, orgId))} sales`);
  }
  return parts.join(' and on ');
}

/**
 * The worked £10 example (E1, E2), for the first role whose one-off take
 * moves: a creator's own take, else the organisation's share. Blank when
 * £10 shows no difference (a minimum-fee change only).
 */
export function exampleLine(
  before: FeeNoticeRoleValues[],
  after: FeeNoticeRoleValues[],
  names: OrgNames
): string {
  for (const [index, role] of before.entries()) {
    const next = after[index];
    if (!next) continue;
    const orgless = role.organizationId === null;
    const was = exampleOneOffSplit(role.oneOff, EXAMPLE_GROSS_CENTS, orgless);
    const will = exampleOneOffSplit(next.oneOff, EXAMPLE_GROSS_CENTS, orgless);
    const lead = `For example: on a ${formatGbp(EXAMPLE_GROSS_CENTS)} sale with no revenue-share agreement,`;
    if (role.as === 'creator' && was.creatorCents !== will.creatorCents) {
      return `${lead} you get ${formatPence(will.creatorCents)} (today ${formatPence(was.creatorCents)}).`;
    }
    if (role.as === 'owner' && was.orgCents !== will.orgCents) {
      const whose = possessive(orgName(names, role.organizationId));
      return `${lead} ${whose} share is ${formatPence(will.orgCents)} (today ${formatPence(was.orgCents)}).`;
    }
  }
  return '';
}

export interface FeeNoticeCopyInput {
  userName: string;
  kind: 'announce' | 'smaller';
  roles: FeeNoticeRole[];
  before: FeeNoticeRoleValues[];
  after: FeeNoticeRoleValues[];
  names: OrgNames;
  /** The date this email names: the change's, or the earliest it can be. */
  startsOn: Date;
  /** The change has its date: the rule sentence is not needed. */
  dated: boolean;
  /** Not on the first list (F8): the welcome sentence. */
  joiner: boolean;
  /** A bigger rise replacing an earlier one (F2). */
  replaces: boolean;
  /** For `smaller`: when the reader was first told. */
  announcedAt: Date | null;
  studioUrl: string;
}

/** The `fee-change-notice` fields (E1-E3, E5). */
export function feeChangeNoticeData(
  input: FeeNoticeCopyInput
): Record<string, string> {
  const lines = changeLines(input.before, input.after, input.names);
  const whose = whoseSales(input.roles, input.names) || 'your sales';
  const date = londonLongDate(input.startsOn);
  const what = lines.ourFeeOnly
    ? `our fee on ${whose}`
    : `the fees on ${whose}`;
  let leadSentence: string;
  let subjectLine: string;
  let headline: string;
  let closingSentence: string;
  if (input.kind === 'smaller') {
    const on = input.announcedAt
      ? `On ${londonLongDate(input.announcedAt, false)}`
      : 'Earlier';
    leadSentence = `${on} we told you about a rise in ${what}. We’ve made that rise smaller. ${
      input.dated
        ? 'The date hasn’t changed.'
        : 'It still starts only once everyone it affects has been told.'
    }`;
    subjectLine = 'The fee rise we told you about is smaller';
    headline = 'Our fee rise is smaller';
    closingSentence = 'Sales before then keep today’s fees.';
  } else {
    const verb = lines.ourFeeOnly ? 'raising' : 'changing';
    const opening = input.joiner
      ? 'You’ve joined while a rise in our fees is on its way, so here is the notice everyone else had. '
      : input.replaces
        ? 'This replaces the fee rise we told you about before. It is bigger, so its 30 days start again. '
        : '';
    leadSentence = `${opening}We’re ${verb} ${what}. Nothing changes before ${date}.`;
    subjectLine = lines.ourFeeOnly
      ? `Our fee on ${whose} is rising from ${date}`
      : `The fees on ${whose} are changing from ${date}`;
    headline = 'Our fee is changing';
    closingSentence =
      'Sales before then keep today’s fees. A subscription payment is split by the fees in force when its invoice is raised. What your buyers pay doesn’t change.';
  }
  return {
    userName: input.userName,
    subjectLine,
    headline,
    leadSentence,
    changeLines: lines.text,
    effectiveDate: date,
    exampleLine: exampleLine(input.before, input.after, input.names),
    closingSentence,
    ruleSentence: input.dated ? '' : FEE_RULE_SENTENCE,
    studioUrl: input.studioUrl,
    buttonLabel: 'See it in Studio',
  };
}

export interface FeeCancelledCopyInput {
  userName: string;
  roles: FeeNoticeRole[];
  /** As they were told. */
  toldBefore: FeeNoticeRoleValues[];
  toldAfter: FeeNoticeRoleValues[];
  /** What is in force now, per role, after the cancel. */
  now: FeeNoticeRoleValues[];
  names: OrgNames;
  announcedAt: Date | null;
  /** The date their email named. */
  toldStartsOn: Date | null;
}

/**
 * The `fee-change-cancelled` fields (E4): what they were told would change,
 * and each of those values as it stands now ("stays at 10%", or the lower
 * figure after a cut below today).
 */
export function feeChangeCancelledData(
  input: FeeCancelledCopyInput
): Record<string, string> {
  const told = changeLines(input.toldBefore, input.toldAfter, input.names);
  const whose = whoseSales(input.roles, input.names) || 'your sales';
  const what = told.ourFeeOnly ? `our fee on ${whose}` : `the fees on ${whose}`;
  const from = input.toldStartsOn
    ? ` from ${londonLongDate(input.toldStartsOn)}`
    : '';
  const kept: string[] = [];
  input.toldBefore.forEach((role, index) => {
    const after = input.toldAfter[index];
    const now = input.now[index];
    if (!after || !now) return;
    for (const key of [
      'platformFeePercent',
      'orgFeePercent',
      'minPlatformFeeCents',
      'minTransferCents',
    ] as const) {
      const contexts = [
        ['oneOff', 'one_off'],
        ['subscription', 'subscription'],
      ] as const;
      // Our fee and its minimums are the same for both kinds of sale.
      const alike =
        role.oneOff[key] === role.subscription[key] &&
        after.oneOff[key] === after.subscription[key];
      for (const [ctx, context] of alike ? [contexts[0]] : contexts) {
        if (role[ctx][key] === after[ctx][key]) continue;
        const value = now[ctx][key];
        const label = valueLine(
          role,
          input.names,
          key,
          alike ? 'both' : context,
          value,
          value
        ).split(':')[0];
        const figure = key.endsWith('Percent')
          ? formatPercent(value)
          : key === 'minTransferCents' && value === 0
            ? 'none'
            : formatPence(value);
        kept.push(
          value === role[ctx][key]
            ? `${label}: stays at ${figure}`
            : `${label}: now ${figure}`
        );
      }
    }
  });
  return {
    userName: input.userName,
    announcedOn: input.announcedAt
      ? londonLongDate(input.announcedAt, false)
      : 'an earlier date',
    changeSentence: `${what} would rise${from}. We’ve cancelled that rise.`,
    keptLines: [...new Set(kept)].map((line) => `${line}.`).join('\n'),
  };
}
