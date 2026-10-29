/**
 * Studio → Earnings: the page's pure view logic (Codex-2hxff.29, .30, .34,
 * .87). The page renders these; the tests exercise them directly, so they
 * test the page's own rules rather than a copy of them.
 *
 * - The ledger's status vocabulary is the API's (`PayoutDisplayStatus`):
 *   a paid row is `resolved`, not `paid` (Codex-2hxff.87). The Paid chip
 *   matches `resolved`.
 * - Each row's bank line (mock-b-studio earnings.html E1-E6): when the money
 *   goes to the bank, or why it doesn't go on that date.
 * - Dates are London calendar days, the daily payout job's clock.
 */

import { formatDay, formatPence, londonDay } from '$lib/utils/bank-payouts';
import * as m from '$paraglide/messages';

// The bank-date helpers are shared with Org Studio → Payouts; the page and
// its tests read them from here.
export {
  type BalanceView,
  type BankLineRow,
  bankDayHasRun,
  bankLineFor,
  type ConnectState,
  deriveConnectState,
  formatDay,
  formatPence,
  negativeCauseLine,
  ruleLine,
} from '$lib/utils/bank-payouts';

// ── Status ──────────────────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'paid' | 'pending' | 'failed';
export type SourceFilter = 'all' | 'subscription' | 'purchase';

/** The Paid chip is the API's `resolved` (Codex-2hxff.87). */
export function matchesStatusFilter(
  status: string,
  filter: StatusFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'paid') return status === 'resolved';
  return status === filter;
}

export function filterPayouts<T extends { status: string; sourceType: string }>(
  items: T[],
  statusFilter: StatusFilter,
  sourceFilter: SourceFilter
): T[] {
  return items.filter(
    (p) =>
      matchesStatusFilter(p.status, statusFilter) &&
      (sourceFilter === 'all' || p.sourceType === sourceFilter)
  );
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'resolved':
      return m.earnings_status_paid();
    case 'pending':
      return m.earnings_status_pending();
    case 'failed':
      return m.earnings_status_failed();
    case 'reversed':
      return m.earnings_status_reversed();
    case 'cancelled_by_refund':
    case 'cancelled_by_dispute':
      return m.earnings_status_cancelled();
    default:
      return status;
  }
}

export type StatusTone = 'paid' | 'pending' | 'failed' | 'neutral';

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'resolved':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    default:
      return 'neutral';
  }
}

// ── The money waiting for setup (the banner, .34) ───────────────────────────

export interface WaitingView {
  totalCents: number;
  oldestAt: string;
  organisations: Array<{
    organizationId: string | null;
    name: string | null;
    asOwner: boolean;
    cents: number;
  }>;
}

/** One line per organisation, as the monthly email lists them (M1-M3). */
export function waitingLines(
  waiting: WaitingView
): Array<{ key: string; name: string; asOwner: boolean; amount: string }> {
  return waiting.organisations.map((org) => ({
    key: `${org.organizationId ?? 'own'}:${org.asOwner ? 'owner' : 'creator'}`,
    name: org.name ?? m.earnings_waiting_own_sales(),
    asOwner: org.asOwner,
    amount: formatPence(org.cents),
  }));
}

/** The London day the oldest waiting row was made: "14 Sep 2026". */
export function waitingSince(waiting: WaitingView): string {
  return formatDay(londonDay(new Date(waiting.oldestAt)), { year: true });
}

// ── The switch-over notice (OQ5) and the Q4 rule line ───────────────────────

const SWITCHOVER_NOTICE_MS = 14 * 24 * 60 * 60 * 1000;

/** Shown for the first 14 days after the account moved to the 14-day hold. */
export function switchoverNotice(
  manualPayoutsSince: string | null,
  now: Date
): string | null {
  if (!manualPayoutsSince) return null;
  const since = new Date(manualPayoutsSince);
  const age = now.getTime() - since.getTime();
  if (Number.isNaN(age) || age < 0 || age >= SWITCHOVER_NOTICE_MS) return null;
  return m.earnings_switchover_notice({
    date: formatDay(londonDay(since)),
  });
}
