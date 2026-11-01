/**
 * Words for the Studio note about a fee rise that hasn't started
 * (`UpcomingFeeNote`, Codex-2hxff.33 F5; batch C1 Part B page 1).
 *
 * Display only: which rises a person sees, and their dates, are the server's
 * answer (`GET /fees/upcoming`). These helpers put each changing value into
 * one clause, and an item's clauses into the lead sentence and one quiet
 * line, as drawn:
 *
 * - N1 dated: "From 5 December 2026, Codex's fee rises from 10% to 12% of
 *   each sale."
 * - N2 not dated yet: the earliest date, "… at the earliest", and the line
 *   that it can only move later (owner decision Q1).
 * - N5 a mixed change (F1): one sentence, one date for every part.
 * - N6 two changes: one line per change, each with its own date.
 * - N7 a smaller rise (F2): the figure first told, struck through.
 * - N9 a minimum transfer switched on (F9).
 *
 * Seeing the note isn't being told: a person whose email failed sees it too,
 * so "We emailed you" is only said when `announcedAt` is set.
 *
 * Dates are London dates: the start is a UK midnight, and in summer that is
 * 23:00 UTC the day before.
 */

import type { UpcomingFeeChange, UpcomingFeeLine } from '@codex/purchase';
import { formatShareBps } from '$lib/components/studio/ownership/ownership-view';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';

const TIME_ZONE = 'Europe/London';

/** `5 December 2026`: the start, always with its year. */
const startFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});
/** `3 November`: when we emailed, a recent day. */
const toldFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
});

export function formatStartDate(iso: string): string {
  return startFormatter.format(new Date(iso));
}

function formatToldDate(iso: string): string {
  return toldFormatter.format(new Date(iso));
}

/** A fee value as it reads: `12%`, `25p`, `£5.00`. */
export function formatFeeValue(
  value: UpcomingFeeLine['value'],
  amount: number
): string {
  if (value === 'platformFeePercent' || value === 'orgFeePercent') {
    return formatShareBps(amount);
  }
  return amount > 0 && amount < 100 ? `${amount}p` : formatPrice(amount);
}

/** The sale a line applies to, in the reader's role. */
function salesWords(line: UpcomingFeeLine, named: boolean): string {
  const base =
    line.as === 'owner'
      ? line.context === 'one_off'
        ? m.fee_note_sales_owner_one_off()
        : line.context === 'subscription'
          ? m.fee_note_sales_owner_subscription()
          : m.fee_note_sales_owner()
      : line.context === 'one_off'
        ? m.fee_note_sales_creator_one_off()
        : line.context === 'subscription'
          ? m.fee_note_sales_creator_subscription()
          : m.fee_note_sales_creator();
  if (!named || line.as === 'owner') return base;
  return line.organizationName
    ? m.fee_note_sales_in_org({ sales: base, org: line.organizationName })
    : m.fee_note_sales_orgless();
}

/**
 * One changing value as a clause. `named`: the same value moves differently
 * in two of the reader's organisations, so each clause says where.
 */
export function lineClause(line: UpcomingFeeLine, named = false): string {
  const from = formatFeeValue(line.value, line.from);
  const to = formatFeeValue(line.value, line.to);
  const rises = line.to > line.from;
  const sales = salesWords(line, named);
  const org = line.organizationName ?? '';
  switch (line.value) {
    case 'platformFeePercent':
      if (line.as === 'owner') {
        return rises
          ? m.fee_note_clause_platform_owner_rises({ from, to, sales })
          : m.fee_note_clause_platform_owner_falls({ from, to, sales });
      }
      return rises
        ? m.fee_note_clause_platform_creator_rises({ from, to, sales })
        : m.fee_note_clause_platform_creator_falls({ from, to, sales });
    case 'minPlatformFeeCents':
      if (line.context === 'both' && !named) {
        return rises
          ? m.fee_note_clause_min_fee_rises({ from, to })
          : m.fee_note_clause_min_fee_falls({ from, to });
      }
      return rises
        ? m.fee_note_clause_min_fee_on_rises({ from, to, sales })
        : m.fee_note_clause_min_fee_on_falls({ from, to, sales });
    case 'orgFeePercent':
      if (line.as === 'owner') {
        return rises
          ? m.fee_note_clause_org_owner_rises({ org, from, to, sales })
          : m.fee_note_clause_org_owner_falls({ org, from, to, sales });
      }
      return rises
        ? m.fee_note_clause_org_creator_rises({ org, from, to, sales })
        : m.fee_note_clause_org_creator_falls({ org, from, to, sales });
    case 'minTransferCents':
      if (!rises) return m.fee_note_clause_transfer_falls({ from, to });
      return line.from === 0
        ? m.fee_note_clause_transfer_on({ to })
        : m.fee_note_clause_transfer_rises({ from, to });
  }
}

const sameMove = (a: UpcomingFeeLine, b: UpcomingFeeLine) =>
  a.value === b.value &&
  a.context === b.context &&
  a.from === b.from &&
  a.to === b.to;

/**
 * The clauses of one change. A creator in two organisations gets one clause
 * for a value that moves alike in both (N4: "one line covers every
 * organisation"). An organisation's own share always names it.
 */
export function changeClauses(lines: readonly UpcomingFeeLine[]): string[] {
  const clauses: string[] = [];
  const done = new Set<UpcomingFeeLine>();
  for (const line of lines) {
    if (done.has(line)) continue;
    if (line.value === 'orgFeePercent' || line.as === 'owner') {
      done.add(line);
      clauses.push(lineClause(line));
      continue;
    }
    const sameValue = lines.filter(
      (other) =>
        other.as === 'creator' &&
        other.value === line.value &&
        other.context === line.context
    );
    if (sameValue.every((other) => sameMove(other, line))) {
      for (const other of sameValue) done.add(other);
      clauses.push(lineClause(line));
    } else {
      done.add(line);
      clauses.push(lineClause(line, true));
    }
  }
  return clauses;
}

/** `A`, `A, and B`, `A, B, and C`: the parts of one change (N5). */
export function joinClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? '';
  return `${clauses.slice(0, -1).join(', ')}, ${m.fee_note_and()} ${clauses.at(-1)}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The first figure a smaller rise replaced, as first told (N7). */
function replacedFigure(item: UpcomingFeeChange): string | null {
  const line = item.lines.find((l) => l.replaced !== null);
  return line && line.replaced !== null
    ? formatFeeValue(line.value, line.replaced)
    : null;
}

/** A minimum transfer switched on, and nothing else (N9). */
function transferOnTo(item: UpcomingFeeChange): string | null {
  const [first] = item.lines;
  const only =
    first &&
    item.lines.every(
      (l) => l.value === 'minTransferCents' && l.from === 0 && l.to === first.to
    );
  return only ? formatFeeValue('minTransferCents', first.to) : null;
}

/** The quiet line: what "the date" means, and when we emailed. */
export interface FeeNoteMeta {
  text: string;
  /** N7: the figure first told, shown struck through inside `text`. */
  was: string | null;
}

export type FeeNoteView =
  | { kind: 'single'; lead: string; meta: FeeNoteMeta }
  | {
      kind: 'list';
      items: Array<{ changeId: string; when: string; text: string }>;
      meta: string;
    };

/** Stands in for the struck-through figure while the sentence is composed. */
export const WAS_MARK = '\u0000';

function singleMeta(item: UpcomingFeeChange, parts: number): FeeNoteMeta {
  const dated = item.effectiveFrom !== null;
  const emailed = item.announcedAt
    ? m.fee_note_meta_emailed({ date: formatToldDate(item.announcedAt) })
    : null;
  const withEmailed = (text: string) => (emailed ? `${text} ${emailed}` : text);
  // N8, a bigger rise replacing a waiting one, draws "This replaces the rise
  // to 12% we told you about on 3 November, so it has its own 30 days'
  // notice." The server doesn't link the replaced change yet, so it reads as
  // N2 below; its branch goes here when that field lands.
  const was = item.kind === 'smaller' ? replacedFigure(item) : null;
  if (was) {
    // N7 draws the smaller email's own date. Until the server sends it, its
    // own key says the first announcement's date.
    const toldSmaller = item.announcedAt
      ? m.fee_note_meta_emailed_smaller({
          date: formatToldDate(item.announcedAt),
        })
      : null;
    const text = m.fee_note_meta_smaller({ was: WAS_MARK });
    return {
      text: toldSmaller ? `${text} ${toldSmaller}` : text,
      was,
    };
  }
  const transferTo = transferOnTo(item);
  if (transferTo) {
    return {
      text: withEmailed(
        dated
          ? m.fee_note_meta_transfer({ to: transferTo })
          : m.fee_note_meta_transfer_earliest({ to: transferTo })
      ),
      was: null,
    };
  }
  if (parts > 1) {
    return {
      text: withEmailed(
        dated ? m.fee_note_meta_mixed() : m.fee_note_meta_mixed_earliest()
      ),
      was: null,
    };
  }
  return {
    text: withEmailed(
      dated ? m.fee_note_meta_dated() : m.fee_note_meta_earliest()
    ),
    was: null,
  };
}

/** The whole note, or null when there is nothing to say (N12). */
export function feeNoteView(
  items: readonly UpcomingFeeChange[]
): FeeNoteView | null {
  const shown = items.filter((item) => item.lines.length > 0);
  if (shown.length === 0) return null;
  if (shown.length === 1) {
    const [item] = shown;
    const clauses = changeClauses(item.lines);
    const change = joinClauses(clauses);
    const lead = item.effectiveFrom
      ? m.fee_note_lead_dated({
          date: formatStartDate(item.effectiveFrom),
          change,
        })
      : m.fee_note_lead_earliest({
          date: formatStartDate(item.earliestFrom),
          change: capitalise(change),
        });
    return { kind: 'single', lead, meta: singleMeta(item, clauses.length) };
  }
  return {
    kind: 'list',
    items: shown.map((item) => ({
      changeId: item.changeId,
      when: item.effectiveFrom
        ? m.fee_note_list_dated({ date: formatStartDate(item.effectiveFrom) })
        : m.fee_note_list_earliest({
            date: formatStartDate(item.earliestFrom),
          }),
      text: m.fee_note_list_change({
        change: joinClauses(changeClauses(item.lines)),
      }),
    })),
    meta: shown.every((item) => item.announcedAt !== null)
      ? m.fee_note_meta_list()
      : m.fee_note_meta_list_unsent(),
  };
}
