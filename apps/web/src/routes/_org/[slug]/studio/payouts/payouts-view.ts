/**
 * Org Studio → Payouts: the 14-day hold's view logic (Codex-2hxff.29, .30).
 * The page renders these; the tests exercise them directly.
 *
 * The organisation's share is paid to its owner's one Connect account, so
 * the hold applies to it as on Earnings: each owner-share row reaches the
 * owner's bank on its own date (`bankOn`, the sale plus 14 days, paid at
 * 08:00 London). A creator's share is in the creator's own account, whose
 * balance the owner can't see, so it gets no date here.
 */

import {
  type BalanceCause,
  type BalanceView,
  type BankLineRow,
  bankDayHasRun,
  bankLineFor,
  type ConnectState,
  formatDay,
  formatPence,
  moreTakeBacks,
  towardsOf,
} from '$lib/utils/bank-payouts';
import * as m from '$paraglide/messages';

/** The slices paid to the organisation's owner. */
const OWNER_SHARE_TYPES: ReadonlySet<string> = new Set([
  'organization_fee',
  'creator_payout_to_owner',
]);

export function isOwnerShare(payoutType: string): boolean {
  return OWNER_SHARE_TYPES.has(payoutType);
}

interface HeldRow {
  id: string;
  payoutType: string;
  amountCents: number;
  bankOn: string | null;
}

export interface HeldForBank {
  /** The organisation's share still in the owner's Stripe balance. */
  cents: number;
  /** The next bank day, and what goes on it; null when nothing is held. */
  next: { on: string; cents: number } | null;
}

/**
 * "Held for 14 days", owner-share rows only, read from the same per-sale
 * `towardsCents` as each row's bank line (AMENDMENT 3), so the two agree:
 * - above zero: what of each sale still goes to the bank (its amount less
 *   what went towards a take-back) on a bank day not yet run;
 * - below zero: what of the share is going towards the take-back now (all of
 *   it, first), with no next day: nothing pays while below zero.
 */
export function heldForBank(
  rows: readonly HeldRow[],
  now: Date,
  balance: BalanceView | null = null
): HeldForBank {
  const owner = rows.filter(
    (row): row is HeldRow & { bankOn: string } =>
      isOwnerShare(row.payoutType) && row.bankOn !== null
  );
  if (balance?.negative) {
    const cents = owner.reduce((sum, row) => {
      const towards = towardsOf(row.id, balance);
      return towards.live
        ? sum + Math.min(towards.cents, row.amountCents)
        : sum;
    }, 0);
    return { cents, next: null };
  }
  const coming = owner.flatMap((row) => {
    const rest =
      row.amountCents -
      Math.min(towardsOf(row.id, balance).cents, row.amountCents);
    return rest > 0 && !bankDayHasRun(row.bankOn, now)
      ? [{ on: row.bankOn, cents: rest }]
      : [];
  });
  const cents = coming.reduce((sum, row) => sum + row.cents, 0);
  const nextOn = coming.map((row) => row.on).sort()[0];
  if (!nextOn) return { cents, next: null };
  const nextCents = coming
    .filter((row) => row.on === nextOn)
    .reduce((sum, row) => sum + row.cents, 0);
  return { cents, next: { on: nextOn, cents: nextCents } };
}

/** The owner's balance as the card reads it. */
type OwnerBalance = BalanceView & { manualPayouts: boolean };

/** A remote query's answer so far, as kit's `Query` carries it. */
export interface Read<T> {
  current: T | undefined;
  loading?: boolean;
  error?: unknown;
}

/** Undefined while in flight (a retry included), 'failed', or the answer. */
function settled<T>(read: Read<T> | null): T | 'failed' | undefined {
  if (!read || read.loading) return undefined;
  if (read.error) return 'failed';
  return read.current;
}

/**
 * The owner's balance from the two reads: undefined while either is in
 * flight, null when the owner has no Connect account (the balance route
 * 404s, so it isn't asked), 'failed' when either read failed.
 */
export function ownerBalanceOf<B>(
  status: Read<{ isConnected: boolean }> | null,
  balance: Read<B> | null
): B | null | 'failed' | undefined {
  const account = settled(status);
  if (account === 'failed') return 'failed';
  if (account === undefined) return undefined;
  if (!account.isConnected) return null;
  return settled(balance);
}

/** The Held card's rows from their read. */
export function heldRowsOf(
  read: Read<{
    items: readonly HeldRow[];
    pagination: { totalPages: number };
  }> | null
): { items: readonly HeldRow[]; totalPages: number } | 'failed' | undefined {
  const page = settled(read);
  if (page === 'failed') return 'failed';
  if (page === undefined) return undefined;
  return { items: page.items, totalPages: page.pagination.totalPages };
}

export type HeldCard =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  /** More rows than one page: a partial sum is never shown as the whole. */
  | { kind: 'too_many' }
  | {
      kind: 'shown';
      cents: number;
      /** Below zero, all of it covers the chargeback; otherwise the next day. */
      detail: 'covering' | { on: string; cents: number } | null;
    };

/**
 * What the "Held for 14 days" card shows. It needs both reads: the
 * organisation's recent paid rows, and the owner's balance (for below zero).
 * Neither a read in flight nor a failed one shows a figure.
 */
export function heldCard(input: {
  /** Undefined while it loads; null when the owner has no Connect account. */
  balance: OwnerBalance | null | 'failed' | undefined;
  /** One page of the organisation's recent paid rows. */
  rows:
    | { items: readonly HeldRow[]; totalPages: number }
    | 'failed'
    | undefined;
  now: Date;
}): HeldCard {
  const { balance, rows } = input;
  // No account: nothing of the organisation's share waits for a bank day.
  if (balance === null) return { kind: 'hidden' };
  if (balance === 'failed' || rows === 'failed') return { kind: 'failed' };
  if (balance === undefined || rows === undefined) return { kind: 'loading' };
  const held = heldForBank(rows.items, input.now, balance);
  // Stripe's own schedule still pays this account: no hold to show.
  if (!balance.manualPayouts && held.cents === 0) return { kind: 'hidden' };
  if (rows.totalPages > 1) return { kind: 'too_many' };
  return {
    kind: 'shown',
    cents: held.cents,
    detail: balance.negative ? 'covering' : held.next,
  };
}

/**
 * The below-zero alert's cause line (P2): the latest take-back. A sale in
 * this organisation is named; it reads as "the organisation's share" only
 * when every pound came from the owner's share of it (not the owner's own
 * creator share). Another organisation's sale is not named here, nor is the
 * owner's own.
 */
export function orgCauseLine(
  causes: readonly BalanceCause[] | undefined,
  organizationId: string | undefined
): string {
  const [latest, ...others] = causes ?? [];
  if (!latest) return m.payouts_negative_cause();
  const here =
    organizationId !== undefined && latest.organizationId === organizationId;
  const share =
    here &&
    latest.payoutTypes !== undefined &&
    latest.payoutTypes.length > 0 &&
    latest.payoutTypes.every(isOwnerShare);
  const what = here
    ? latest.title
      ? m.earnings_cause_titled({ title: latest.title })
      : m.payouts_cause_untitled_here()
    : latest.organizationId
      ? m.payouts_cause_other_org()
      : m.payouts_cause_own_sale();
  const parts = {
    what,
    amount: formatPence(latest.cents),
    date: formatDay(latest.on),
    more: moreTakeBacks(others.length),
  };
  if (latest.causeType === 'dispute') {
    return share
      ? m.payouts_negative_cause_here_chargeback(parts)
      : m.payouts_negative_cause_elsewhere_chargeback(parts);
  }
  return share
    ? m.payouts_negative_cause_here_refund(parts)
    : m.payouts_negative_cause_elsewhere_refund(parts);
}

/** A ledger row's bank line: owner-share rows only. */
export function ownerBankLine(
  row: BankLineRow & { payoutType: string },
  ctx: {
    /** The owner's own Connect state, as Earnings reads it. */
    connectState: ConnectState;
    balance: BalanceView | null | undefined;
    now: Date;
  }
): string | null {
  if (!isOwnerShare(row.payoutType)) return null;
  return bankLineFor(row, ctx);
}
