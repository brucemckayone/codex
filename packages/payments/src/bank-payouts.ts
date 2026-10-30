/**
 * Bank payouts: a creator's money reaches their bank only after the 14-day
 * refund window (Codex-2hxff.29, owner Q1), and a balance below zero is
 * Stripe's to hold and recover (Codex-2hxff.30, Q2 and Q4).
 *
 * Every Connect account is on manual payouts with bank debit off. Once a day,
 * on the hourly cron's run whose London hour is 8, `runBankPayouts` pays each
 * account the part of its available balance that is from charges more than
 * 14 × 24 h old:
 *
 *   payout = available − held,   held = pend ≤ young ? young − pend : young
 *
 * where `young` is the net of the transfers whose charge is under 14 × 24 h
 * old. Pending money has not settled, and settlement (3 business days, 7 days
 * on a new account) is always inside 14 days, so it is always young: the young
 * money already spendable is `young − pend`. A transfer is judged by its
 * charge's time, never its own, so a day-40 drain of a day-1 sale goes out at
 * the next run, and a re-pay (no `source_transaction`) is never young.
 *
 * Stripe keeps a balance per source type ("pot") and pays out from one at a
 * time, so each pot is paid on its own formula (owner, HIGH-1: "Pay each pot
 * separately"). In GBP there is one today: `card` holds cards and non-legacy
 * bank debits, Bacs included.
 *
 * The same reads give Studio its next bank payout, the young money a covered
 * chargeback is using, and the negative-balance clock. Design:
 * batch-b-data-design.md §3.2, §3.3, §4.1-§4.2; docs/payments/connect-and-payouts.md
 * → Payout timing.
 */

import { REFUND_WINDOW_DAYS, stripeEnvMetadata } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  connectBalances,
  content,
  courses,
  organizations,
  type PayoutType,
  payoutReversals,
  payouts,
  purchases,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';
import { pendingReductionsFor } from './clawback';

/** The refund window the hold waits out: 14 × 24 h, as `refundWindow` measures it. */
export const BANK_HOLD_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** The London hour of the one hourly cron run that pays out each day. */
export const BANK_PAYOUT_LONDON_HOUR = 8;

/** Q4: a debt over this is invoiced at 90 days; at or under it, Stripe collects it at 180. */
export const DEBT_INVOICE_THRESHOLD_CENTS = 5000;
export const DEBT_INVOICE_AFTER_DAYS = 90;
/** Stripe zeroes a balance negative this long from the platform's reserve (S11). */
export const STRIPE_WRITE_OFF_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const LONDON = 'Europe/London';

// ─── The London clock ──────────────────────────────────────────────────────

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Built on first use, not at module scope: a module-scope call would keep
// this file in every bundle that imports the @codex/payments barrel.
let londonParts_: Intl.DateTimeFormat | undefined;

function londonParts(at: Date): LondonParts {
  londonParts_ ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of londonParts_.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** The London calendar date of an instant, `YYYY-MM-DD`. */
export function londonDate(at: Date): string {
  const { year, month, day } = londonParts(at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * True on the one hourly run that pays out: London hour 8, which is 08:00 UTC
 * in winter and 07:00 UTC in summer. The clocks change at 01:00 UTC, so a
 * change day still has exactly one.
 */
export function isBankPayoutRun(scheduledTime: Date | number): boolean {
  return londonParts(new Date(scheduledTime)).hour === BANK_PAYOUT_LONDON_HOUR;
}

/** 08:00 London on a London calendar date (month 1-12; day may overflow). */
function london0800On(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day, BANK_PAYOUT_LONDON_HOUR);
  const seen = londonParts(new Date(guess));
  const offsetMs =
    Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second
    ) - guess;
  return new Date(guess - offsetMs);
}

/**
 * The first payout run strictly after `at`. The job pays a charge's money at
 * the first run more than 14 × 24 h after it, so this is the bank date of
 * `charge time + BANK_HOLD_MS`.
 */
export function firstLondon0800After(at: Date): Date {
  const { year, month, day } = londonParts(at);
  const sameDay = london0800On(year, month, day);
  if (sameDay.getTime() > at.getTime()) return sameDay;
  return london0800On(year, month, day + 1);
}

/**
 * Whole London calendar days from `from` to `to`. The 180-day write-off and
 * the 3-day refusal alert count these, never 24-hour blocks: across a clock
 * change the same morning run is an hour nearer or further, so day 180's run
 * of an episode that began in winter falls an hour short of 180 × 24 h.
 */
export function londonDaysBetween(from: Date, to: Date): number {
  const dayNumber = (at: Date) => {
    const { year, month, day } = londonParts(at);
    return Date.UTC(year, month - 1, day) / DAY_MS;
  };
  return dayNumber(to) - dayNumber(from);
}

/** The London date `days` calendar days after `at`'s own, `YYYY-MM-DD`. */
function londonDatePlusDays(at: Date, days: number): string {
  const { year, month, day } = londonParts(at);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** The longest a cron wake can run (a scheduled handler's wall-clock limit). */
export const BANK_PAYOUT_WAKE_MS = 15 * 60 * 1000;

/**
 * The first run that pays money transferred at `at`. The cron's own drain
 * (`cronDrain`) runs in the 08:00 wake before the job reads any account, so
 * its transfer goes that morning. Any other transfer, even one made between
 * 08:00 and 08:15 (an `account.updated` or `/connect/me/sync` drain), may
 * land after the job read the account, so it goes at the first run strictly
 * after: a date is never early (review r2 LOW-1).
 */
function runPayingTransferAt(at: Date, cronDrain: boolean): Date {
  if (!cronDrain) return firstLondon0800After(at);
  const { year, month, day } = londonParts(at);
  const thisMorning = london0800On(year, month, day);
  const sinceRun = at.getTime() - thisMorning.getTime();
  return sinceRun >= 0 && sinceRun < BANK_PAYOUT_WAKE_MS
    ? thisMorning
    : firstLondon0800After(at);
}

// ─── What the job reads from Stripe ────────────────────────────────────────

/** The pot a payment with no stated source type is in, and payouts' default. */
const CARD_POT = 'card';

/**
 * One source type's part of a balance. Stripe keeps each separately and a
 * payout draws on one (`source_type`): `card` (cards and non-legacy bank
 * debits, Bacs included), `bank_account` (legacy US ACH) or `fpx`.
 */
export interface GbpPot {
  sourceType: string;
  availableCents: number;
  pendingCents: number;
}

/** An account's GBP balance, in pence. `availableCents` can be below zero (S11). */
export interface GbpBalance {
  availableCents: number;
  pendingCents: number;
  /** By source type, `card` first. Absent: one `card` pot holding the totals. */
  pots?: readonly GbpPot[];
}

type BalanceFunds = readonly {
  amount: number;
  currency: string;
  // Stripe's own SourceTypes interface; read by key, so any type name counts.
  source_types?: object;
}[];

/**
 * The GBP totals and pots. A fund without a source-type breakdown is all
 * `card`, the pot a payout draws on by default.
 */
export function gbpBalance(
  balance: Pick<Stripe.Balance, 'available' | 'pending'>
): GbpBalance {
  const pots = new Map<string, GbpPot>();
  const add = (
    funds: BalanceFunds,
    part: 'availableCents' | 'pendingCents'
  ) => {
    let total = 0;
    for (const fund of funds) {
      if (fund.currency !== 'gbp') continue;
      total += fund.amount;
      const byType = Object.entries(fund.source_types ?? {}).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      );
      for (const [sourceType, cents] of byType.length > 0
        ? byType
        : [[CARD_POT, fund.amount] as const]) {
        const pot = pots.get(sourceType) ?? {
          sourceType,
          availableCents: 0,
          pendingCents: 0,
        };
        pot[part] += cents;
        pots.set(sourceType, pot);
      }
    }
    return total;
  };
  const availableCents = add(balance.available, 'availableCents');
  const pendingCents = add(balance.pending, 'pendingCents');
  return {
    availableCents,
    pendingCents,
    pots: [...pots.values()].sort(
      (a, b) =>
        Number(b.sourceType === CARD_POT) - Number(a.sourceType === CARD_POT) ||
        a.sourceType.localeCompare(b.sourceType)
    ),
  };
}

/** A balance's pots; one `card` pot of the totals when it has none. */
function potsOf(balance: GbpBalance): readonly GbpPot[] {
  return (
    balance.pots ?? [
      {
        sourceType: CARD_POT,
        availableCents: balance.availableCents,
        pendingCents: balance.pendingCents,
      },
    ]
  );
}

/** One transfer to the account, as the formula reads it. */
export interface BankTransfer {
  /** `tr_…`: matches `payouts.stripe_transfer_id`. */
  id: string;
  /** What is still in the account from it: `amount − amount_reversed`, pence. */
  netCents: number;
  /**
   * When its sale was charged, ms. Null for a transfer with no
   * `source_transaction` (a re-pay from the platform balance): never young.
   */
  chargeCreatedMs: number | null;
  /** The pot it landed in (`Transfer.source_type`). Absent: `card`. */
  sourceType?: string;
}

/**
 * Reads a listed transfer, or null for one that isn't GBP. The list is
 * expanded with `data.source_transaction`; were a source ever left as a bare
 * id, the transfer's own `created` stands in for the charge's. A charge is
 * never later than its transfer, so that can only hold money longer.
 */
export function toBankTransfer(transfer: Stripe.Transfer): BankTransfer | null {
  if (transfer.currency !== 'gbp') return null;
  const source = transfer.source_transaction;
  let chargeCreatedMs: number | null = null;
  if (typeof source === 'string') {
    chargeCreatedMs = transfer.created * 1000;
  } else if (source) {
    chargeCreatedMs =
      ('created' in source && typeof source.created === 'number'
        ? source.created
        : transfer.created) * 1000;
  }
  return {
    id: transfer.id,
    netCents: transfer.amount - transfer.amount_reversed,
    chargeCreatedMs,
    sourceType: transfer.source_type || CARD_POT,
  };
}

/** Young at `runAt`: its charge is at or after `runAt − 14 × 24 h`. */
function isYoung(transfer: BankTransfer, runAt: Date): boolean {
  return (
    transfer.chargeCreatedMs !== null &&
    transfer.chargeCreatedMs >= runAt.getTime() - BANK_HOLD_MS
  );
}

/** The net of the transfers young at `runAt`. */
export function youngCents(
  transfers: readonly BankTransfer[],
  runAt: Date
): number {
  return transfers
    .filter((transfer) => isYoung(transfer, runAt))
    .reduce((sum, transfer) => sum + transfer.netCents, 0);
}

// ─── The formula ───────────────────────────────────────────────────────────

export interface BankPayoutPlan {
  youngCents: number;
  heldCents: number;
  /** What to pay out now; 0 when there is nothing older than the window. */
  payoutCents: number;
  /**
   * Pending held more than the young money, so it holds old money (a slow
   * payment method; card settlement never does this). ALL the young money is
   * then held, which can pay old money late but never young money early.
   */
  pendingExceedsYoung: boolean;
}

/** §3.2's formula, for one account at run `runAt`. */
export function planBankPayout(input: {
  runAt: Date;
  balance: GbpBalance;
  transfers: readonly BankTransfer[];
}): BankPayoutPlan {
  const { availableCents, pendingCents } = input.balance;
  const young = youngCents(input.transfers, input.runAt);
  const pendingExceedsYoung = pendingCents > young;
  const heldCents = pendingExceedsYoung ? young : young - pendingCents;
  return {
    youngCents: young,
    heldCents,
    payoutCents: Math.max(0, availableCents - heldCents),
    pendingExceedsYoung,
  };
}

/** One pot's plan: §3.2 on that pot's own balance and transfers. */
export interface BankPotPlan extends BankPayoutPlan {
  sourceType: string;
  availableCents: number;
  pendingCents: number;
}

/**
 * §3.2 for each pot (owner, HIGH-1: "Pay each pot separately"). A young
 * transfer holds only the pot it landed in, and a debt in one pot is never
 * netted against another: Stripe keeps them apart and recovers each from its
 * own later earnings. With one `card` pot this is `planBankPayout`.
 */
export function planBankPayouts(input: {
  runAt: Date;
  balance: GbpBalance;
  transfers: readonly BankTransfer[];
}): BankPotPlan[] {
  return potsOf(input.balance).map((pot) => ({
    sourceType: pot.sourceType,
    availableCents: pot.availableCents,
    pendingCents: pot.pendingCents,
    ...planBankPayout({
      runAt: input.runAt,
      balance: pot,
      transfers: input.transfers.filter(
        (transfer) => (transfer.sourceType ?? CARD_POT) === pot.sourceType
      ),
    }),
  }));
}

/**
 * The next bank payout Studio shows: the first run, from the next one on, at
 * which the job would pay anything, and how much. By then every penny that is
 * no longer young has settled, so the amount is
 * `(available + pending) − young(run)`. Only the next run and the runs at which
 * a listed young transfer comes of age can change it. While the balance is
 * covering a take-back, the next run can pay nothing and a later one some
 * (mock-b-studio E6).
 */
export function projectNextPayout(input: {
  now: Date;
  balance: GbpBalance;
  transfers: readonly BankTransfer[];
}): { on: string; amountCents: number } | null {
  const total = input.balance.availableCents + input.balance.pendingCents;
  if (total <= 0) return null;
  const nextRun = firstLondon0800After(input.now);
  const runs = new Map<number, Date>([[nextRun.getTime(), nextRun]]);
  for (const transfer of input.transfers) {
    if (transfer.chargeCreatedMs === null || transfer.netCents <= 0) continue;
    const run = firstLondon0800After(
      new Date(transfer.chargeCreatedMs + BANK_HOLD_MS)
    );
    if (run.getTime() > nextRun.getTime()) runs.set(run.getTime(), run);
  }
  for (const run of [...runs.values()].sort(
    (a, b) => a.getTime() - b.getTime()
  )) {
    const amountCents = total - youngCents(input.transfers, run);
    if (amountCents > 0) return { on: londonDate(run), amountCents };
  }
  return null;
}

// ─── What went towards a take-back (amendment 3) ───────────────────────────

/**
 * A sale whose money should still be in the Stripe balance: paid to the
 * account and not yet sent to the bank.
 */
export interface UnsentSale {
  payoutId: string;
  /** What is in Stripe from it at the reading: what was sent less the take-backs done by then, pence. */
  netCents: number;
  /** The sale's date (its charge's where Stripe gave it, else the row's), which orders the sharing. */
  soldAt: Date;
}

/** What went towards a take-back instead of the bank, sale by sale. */
export interface TowardsTakeBack {
  /** U − T, clamped to [0, U]. */
  cents: number;
  /** Oldest sale first, and only sales with something towards. */
  rows: Array<{ payoutId: string; towardsCents: number }>;
}

/**
 * Amendment 3 (owner, 2026-10-29: "Exact amounts, oldest first"). Money
 * leaves a Stripe balance oldest first, whether by our bank payout or by
 * covering a take-back, so what should be in Stripe (U, the unsent sales)
 * less what is (T) went towards a take-back, from the oldest sale on (sale
 * date, then id). Each sale's share is at most its net; the rest of it goes
 * to the bank on its bank day. Below zero, T < 0 and all of U went towards
 * it. The one rule for Studio's covering card, the Earnings rows and Org
 * Payouts, so they can't disagree.
 */
export function towardsTakeBack(input: {
  sales: readonly UnsentSale[];
  inStripeCents: number;
}): TowardsTakeBack {
  const sales = input.sales
    .filter((sale) => sale.netCents > 0)
    .sort(
      (a, b) =>
        a.soldAt.getTime() - b.soldAt.getTime() ||
        (a.payoutId < b.payoutId ? -1 : a.payoutId > b.payoutId ? 1 : 0)
    );
  const owed = sales.reduce((sum, sale) => sum + sale.netCents, 0);
  const cents = Math.min(owed, Math.max(0, owed - input.inStripeCents));
  const rows: TowardsTakeBack['rows'] = [];
  let left = cents;
  for (const sale of sales) {
    if (left <= 0) break;
    const towardsCents = Math.min(sale.netCents, left);
    rows.push({ payoutId: sale.payoutId, towardsCents });
    left -= towardsCents;
  }
  return { cents, rows };
}

/** One of the payee's sent ledger rows, as the sharing reads it. */
export interface LedgerSale {
  payoutId: string;
  /** `tr_…`: matches a listed `BankTransfer`. */
  stripeTransferId: string;
  /**
   * What the drain sent: the amount less the reductions made before sending,
   * by the drain's own definition (`pendingReductionsFor`), pence.
   */
  sentCents: number;
  /** The take-backs that moved money out of it (`takeBackMovedMoney`), each with when it was done. */
  takeBacks: ReadonlyArray<{ at: Date; cents: number }>;
  createdAt: Date;
  /**
   * When its charge was made, from Stripe's transfer list (`withChargeTimes`).
   * Absent: the row's `createdAt` stands in, which is never earlier.
   */
  chargedAt?: Date;
  /** When its transfer was made (`resolved_at`, else the row's). */
  transferredAt: Date;
  /** False for a re-pay row: no charge to wait out. */
  hasCharge: boolean;
}

/** Which unsent sales a sharing reads, and the reading it is cut off at. */
export interface UnsentWindow {
  /** The first run that paid nothing to the bank, or the next run. */
  from: Date;
  /** The reading T is from: what was sent and taken back by then counts. */
  readAt: Date;
  manualPayoutsSince: Date;
}

/**
 * The end of what a run's snapshot holds. The wake's earlier steps (the
 * dispute reconcile, the cron's own drain) run before the job reads any
 * account, so their transfers and take-backs are in the balance it records,
 * stamped with the run (review r5 LOW). One from anywhere else in the wake
 * after the job read the account counts too: rare.
 */
export function runReadingEnd(runAt: Date): Date {
  return new Date(runAt.getTime() + BANK_PAYOUT_WAKE_MS - 1);
}

/** Transferred by the reading, and after the switch to manual payouts. */
function sentInWindow(row: LedgerSale, window: UnsentWindow): boolean {
  const at = row.transferredAt.getTime();
  return (
    at <= window.readAt.getTime() && at >= window.manualPayoutsSince.getTime()
  );
}

/** What was in Stripe from a row at a reading: sent, less what was taken back by then. */
function valueAt(row: LedgerSale, readAt: Date): number {
  return row.takeBacks.reduce(
    (left, step) =>
      step.at.getTime() <= readAt.getTime() ? left - step.cents : left,
    row.sentCents
  );
}

/**
 * The sales that should still be in Stripe at a reading: transferred by then
 * and after the switch to manual payouts, not paid by any run before `from`,
 * and each valued as it was then, so a refund after an episode cleared
 * leaves that episode's figures as they were (review r5 MED-2). Each is
 * judged by the EARLIEST run that could have paid it (a transfer in the
 * 08:00 wake may have gone that morning), by its charge's time where Stripe
 * gave it, as the job judges it, so a sale is never counted as unsent once
 * it may have gone, and `towards` is never overstated.
 *   - No episode: `from` is the next run, read now.
 *   - Below zero: `negative_since` (or the first run that pays nothing), read now.
 *   - The last ended episode: `cleared_since`, read at `runReadingEnd(cleared_at)`.
 */
export function unsentSales(
  rows: readonly LedgerSale[],
  window: UnsentWindow
): UnsentSale[] {
  return rows.flatMap((row) => {
    if (!sentInWindow(row, window)) return [];
    const soldAt = row.chargedAt ?? row.createdAt;
    const run = bankRunFor(row.hasCharge, soldAt, row.transferredAt, true);
    if (run.getTime() < window.from.getTime()) return [];
    const netCents = valueAt(row, window.readAt);
    return netCents > 0 ? [{ payoutId: row.payoutId, netCents, soldAt }] : [];
  });
}

/** Each row with its charge's time, where the list has its transfer. */
export function withChargeTimes(
  rows: readonly LedgerSale[],
  transfers: readonly BankTransfer[]
): LedgerSale[] {
  const charged = new Map<string, number>();
  for (const transfer of transfers) {
    if (transfer.chargeCreatedMs !== null) {
      charged.set(transfer.id, transfer.chargeCreatedMs);
    }
  }
  return rows.map((row) => {
    const ms = charged.get(row.stripeTransferId);
    return row.chargedAt || ms === undefined
      ? row
      : { ...row, chargedAt: new Date(ms) };
  });
}

/**
 * The transfers to list so `unsentSales` can judge a window's rows by their
 * charge's time, or null when none needs it (review r5 LOW). A row recorded
 * days after its charge (webhooks redelivered after an outage, the dispute
 * reconcile) is dated later than the job, which reads the charge from
 * Stripe, dates it: by its row it would stay unsent after the job paid it.
 * Only a row sent before the run before `from` and due at or after `from` by
 * its own date can be either, so only those with no charge time yet are
 * asked for. A transfer is made at most a day before its row says (an
 * earlier attempt's, recorded by a later drain), so the span opens a day
 * early and closes a minute late, and a row whose transfer a list from
 * `listedSince` would have held, but didn't, is not on this account (a
 * replaced one) and is not asked for again.
 */
export function chargeTimesWanted(
  rows: readonly LedgerSale[],
  window: UnsentWindow,
  listedSince: Date | null = null
): { since: Date; until: Date } | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row.hasCharge || row.chargedAt || !sentInWindow(row, window)) {
      continue;
    }
    if (
      listedSince &&
      row.transferredAt.getTime() - DAY_MS >= listedSince.getTime()
    ) {
      continue;
    }
    if (valueAt(row, window.readAt) <= 0) continue;
    const from = window.from.getTime();
    // Sent at or after the run before `from`: unsent whenever its charge.
    if (runPayingTransferAt(row.transferredAt, true).getTime() >= from) {
      continue;
    }
    // Paid by its own date already, and its charge was no later.
    if (
      bankRunFor(true, row.createdAt, row.transferredAt, true).getTime() < from
    ) {
      continue;
    }
    first = Math.min(first, row.transferredAt.getTime());
    last = Math.max(last, row.transferredAt.getTime());
  }
  return first === Number.POSITIVE_INFINITY
    ? null
    : { since: new Date(first - DAY_MS), until: new Date(last + 60_000) };
}

/**
 * The payee's OWN sent rows (`payouts.user_id`; every organisation and their
 * own) transferred on or after `since`, paid or since reversed, each with
 * what the drain sent and the take-backs that moved money, with when: what
 * `unsentSales` values at a reading. A reversed row stays, so an ended
 * episode can value it as it was at the clearing (review r5 MED-2). A sale
 * unsent at a run on or after `from` was transferred at most 15 days before
 * it (14 days' hold and the run after), so `since` = `from` − 16 days.
 */
export async function ledgerSalesSince(
  db: DatabaseClient,
  userId: string,
  since: Date
): Promise<LedgerSale[]> {
  const sentRows = and(
    eq(payouts.userId, userId),
    inArray(payouts.status, ['paid', 'reversed']),
    isNotNull(payouts.stripeTransferId),
    ne(payouts.payoutType, 'platform_fee'),
    sql`COALESCE(${payouts.resolvedAt}, ${payouts.createdAt}) >= ${since.toISOString()}::timestamptz`
  );
  const rows = await db
    .select({
      payoutId: payouts.id,
      stripeTransferId: payouts.stripeTransferId,
      amountCents: payouts.amountCents,
      createdAt: payouts.createdAt,
      resolvedAt: payouts.resolvedAt,
      stripeChargeId: payouts.stripeChargeId,
    })
    .from(payouts)
    .where(sentRows);
  if (rows.length === 0) return [];
  // The drain sends `amountCents` less these (review r5 MED-1): the same
  // function, so what it sent and what this reads can't drift apart.
  const reductions = await pendingReductionsFor(
    db,
    rows.map((row) => row.payoutId)
  );
  const steps = await db
    .select({
      payoutId: payoutReversals.payoutId,
      cents: payoutReversals.amountCents,
      resolvedAt: payoutReversals.resolvedAt,
      createdAt: payoutReversals.createdAt,
    })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
    .where(and(sentRows, takeBackMovedMoney()));
  const takeBacks = new Map<string, Array<{ at: Date; cents: number }>>();
  for (const step of steps) {
    const list = takeBacks.get(step.payoutId) ?? [];
    list.push({ at: step.resolvedAt ?? step.createdAt, cents: step.cents });
    takeBacks.set(step.payoutId, list);
  }
  return rows.flatMap((row) =>
    row.stripeTransferId
      ? [
          {
            payoutId: row.payoutId,
            stripeTransferId: row.stripeTransferId,
            sentCents: row.amountCents - (reductions.get(row.payoutId) ?? 0),
            takeBacks: takeBacks.get(row.payoutId) ?? [],
            createdAt: row.createdAt,
            transferredAt: row.resolvedAt ?? row.createdAt,
            hasCharge: row.stripeChargeId !== null,
          },
        ]
      : []
  );
}

/** How far before a window's first run its sales can have been transferred, with a day's margin. */
export const UNSENT_LOOKBACK_MS = BANK_HOLD_MS + 2 * DAY_MS;

// ─── A balance below zero ──────────────────────────────────────────────────

export type DebtRule =
  | { kind: 'invoice'; on: string }
  | { kind: 'stripe_writes_off'; on: string };

/**
 * Q4, on Stripe's figure: over £50 is invoiced 90 days after the balance went
 * below zero; £50 or less is written off when Stripe collects it at 180 days.
 * Worked out from what is owed NOW (studio S1, option A), so a debt that
 * drops to £50 switches rule, and one that grows past it after day 90 is due.
 * The date is counted in London calendar days, as the episode's end is.
 */
export function debtRule(owedCents: number, negativeSince: Date): DebtRule {
  const days =
    owedCents > DEBT_INVOICE_THRESHOLD_CENTS
      ? DEBT_INVOICE_AFTER_DAYS
      : STRIPE_WRITE_OFF_AFTER_DAYS;
  const on = londonDatePlusDays(negativeSince, days);
  return owedCents > DEBT_INVOICE_THRESHOLD_CENTS
    ? { kind: 'invoice', on }
    : { kind: 'stripe_writes_off', on };
}

/** What the daily check knew of the account before this read (`connect_balances`). */
export interface BalanceEpisodeState {
  negativeSince: Date | null;
  checkedAt: Date | null;
  /** The last reading; during an episode, its last negative one. */
  availableCents: number | null;
}

export type BalanceEpisodeChange =
  | { kind: 'none' }
  | { kind: 'started'; negativeSince: Date; negativeAfter: Date | null }
  | {
      kind: 'cleared';
      /** The episode's start, kept as `cleared_since` (bankOn moves its runs). */
      since: Date;
      clearedAt: Date;
      reason: 'recovered' | 'stripe_collected';
      /** What was owed at the episode's last negative reading, pence; null if unknown. */
      owedCents: number | null;
    };

/**
 * §4.1's states. The first check that sees `available < 0` starts an episode,
 * remembering the last check before it (the take-back lies between the two).
 * The first check back at or above zero ends it, keeping what was owed at the
 * last negative reading (the written-off email names it). An episode of 180
 * London calendar days or more ended because Stripe collected it from the
 * platform (S11); telling the two apart exactly would need a
 * balance-transactions read, and the reason only changes an email's wording.
 */
export function nextBalanceEpisode(
  before: BalanceEpisodeState,
  availableCents: number,
  now: Date
): BalanceEpisodeChange {
  if (before.negativeSince === null) {
    return availableCents < 0
      ? { kind: 'started', negativeSince: now, negativeAfter: before.checkedAt }
      : { kind: 'none' };
  }
  if (availableCents < 0) return { kind: 'none' };
  const longEnough =
    londonDaysBetween(before.negativeSince, now) >= STRIPE_WRITE_OFF_AFTER_DAYS;
  const last = before.availableCents;
  return {
    kind: 'cleared',
    since: before.negativeSince,
    clearedAt: now,
    reason: longEnough ? 'stripe_collected' : 'recovered',
    owedCents: last !== null && last < 0 ? -last : null,
  };
}

// ─── What took a balance below zero ────────────────────────────────────────

/** How far before `negative_since` a take-back can be its cause, when the last check above zero is unknown. */
export const TAKE_BACK_LOOKBACK_DAYS = 7;

/** At most this many take-backs are named for one episode. */
const EPISODE_TAKE_BACKS_LIMIT = 20;

export type TakeBackCause = 'refund' | 'dispute';

/**
 * A `payout_reversals` step that took money out of the payee's Stripe
 * balance: a done transfer reversal, or a done cancellation that reversed a
 * late transfer. A pending reduction or a retained fee moved nothing.
 */
export function takeBackMovedMoney(): SQL {
  return sql`(${payoutReversals.status} = 'done' AND (${payoutReversals.kind} = 'transfer_reversal' OR (${payoutReversals.kind} = 'cancellation' AND ${payoutReversals.stripeReversalId} IS NOT NULL)))`;
}

/**
 * One refund or chargeback that could have taken the balance below zero: all
 * of the payee's steps for it, summed. A solo owner-creator's chargeback is
 * two steps (the organisation's share and the creator share), one cause.
 */
export interface EpisodeTakeBack {
  causeType: TakeBackCause;
  /** The payee's steps for this cause, summed, pence. */
  cents: number;
  /** When Stripe took it back: its latest step's `resolved_at`. */
  at: Date;
  /** The sale's content, course or tier name. */
  title: string | null;
  /** The sale's organisation; null for an orgless sale. */
  organizationId: string | null;
  organisationName: string | null;
  /**
   * The payout types the steps came from, sorted: `organization_fee` and
   * `creator_payout_to_owner` are the organisation's share, `creator_payout`
   * the creator share.
   */
  payoutTypes: PayoutType[];
}

function isPayoutType(value: string): value is PayoutType {
  return (
    value === 'platform_fee' ||
    value === 'organization_fee' ||
    value === 'creator_payout' ||
    value === 'creator_payout_to_owner'
  );
}

/**
 * The take-backs on the payee's OWN slices (`payouts.user_id`) that could
 * have taken their balance below zero, one per cause (a refund or a
 * dispute, its steps summed), newest first, at most 20 causes: steps done
 * after the last check above zero (`negative_after`, else 7 days before) and
 * up to the check that saw it below (`negative_since`). One rule for the M7
 * email and Studio's below-zero card (packages/payments/CLAUDE.md). Empty:
 * the cause is unknown, and the caller keeps its generic line.
 */
export async function episodeTakeBacks(
  db: DatabaseClient,
  episode: {
    userId: string;
    negativeSince: Date;
    negativeAfter: Date | null;
  }
): Promise<EpisodeTakeBack[]> {
  const from = episodeCausesFrom(episode.negativeSince, episode.negativeAfter);
  const latest = sql`MAX(${payoutReversals.resolvedAt})`;
  const rows = await db
    .select({
      causeType: payoutReversals.causeType,
      cents: sql<number>`SUM(${payoutReversals.amountCents})::int`,
      at: sql<Date | string | null>`${latest}`,
      // One sale per cause, so one title; MIN only satisfies GROUP BY.
      title: sql<
        string | null
      >`MIN(COALESCE(${content.title}, ${courses.title}, ${subscriptionTiers.name}))`,
      organizationId: payouts.organizationId,
      organisationName: organizations.name,
      payoutTypes: sql<
        string[]
      >`array_agg(DISTINCT ${payouts.payoutType} ORDER BY ${payouts.payoutType})`,
    })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
    .leftJoin(organizations, eq(organizations.id, payouts.organizationId))
    .leftJoin(purchases, eq(purchases.id, payouts.purchaseId))
    .leftJoin(content, eq(content.id, purchases.contentId))
    .leftJoin(courses, eq(courses.id, purchases.courseId))
    .leftJoin(subscriptions, eq(subscriptions.id, payouts.subscriptionId))
    .leftJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
    .where(
      and(
        eq(payouts.userId, episode.userId),
        takeBackMovedMoney(),
        gt(payoutReversals.resolvedAt, from),
        lte(payoutReversals.resolvedAt, episode.negativeSince)
      )
    )
    .groupBy(
      payoutReversals.causeType,
      payoutReversals.causeId,
      payouts.organizationId,
      organizations.name
    )
    .orderBy(sql`${latest} DESC`, asc(payoutReversals.causeId))
    .limit(EPISODE_TAKE_BACKS_LIMIT);
  return rows.flatMap(({ causeType, at, payoutTypes, ...row }) =>
    at !== null && (causeType === 'refund' || causeType === 'dispute')
      ? [
          {
            ...row,
            causeType,
            at: new Date(at),
            payoutTypes: payoutTypes.filter(isPayoutType),
          },
        ]
      : []
  );
}

/**
 * Where an episode's causes start: the last check above zero
 * (`negative_after`), else 7 days before the check that saw it below.
 */
export function episodeCausesFrom(
  negativeSince: Date,
  negativeAfter: Date | null
): Date {
  return (
    negativeAfter ??
    new Date(negativeSince.getTime() - TAKE_BACK_LOOKBACK_DAYS * DAY_MS)
  );
}

/**
 * The one kind of take-back among `causes`, or null: none, a mix, or as
 * many as are named, when an older one could be the other kind.
 */
export function takeBackKind(
  causes: readonly { causeType: TakeBackCause }[]
): TakeBackCause | null {
  const first = causes[0]?.causeType;
  if (!first || causes.length >= EPISODE_TAKE_BACKS_LIMIT) return null;
  return causes.every((cause) => cause.causeType === first) ? first : null;
}

/**
 * What a sharing's money went towards (Studio's "went towards the
 * chargeback" or "the refund"): the one kind of every take-back that moved
 * the payee's money after `after` and by the reading `upTo`, by
 * `episodeTakeBacks`, the below-zero card's rule. The window runs to the
 * reading, so a take-back during an episode counts too. A window wider than
 * needed can only make it null, never the wrong kind.
 */
export async function towardsKind(
  db: DatabaseClient,
  window: { userId: string; after: Date; upTo: Date }
): Promise<TakeBackCause | null> {
  return takeBackKind(
    await episodeTakeBacks(db, {
      userId: window.userId,
      negativeSince: window.upTo,
      negativeAfter: window.after,
    })
  );
}

// ─── Bank dates for Studio and the payout-released email ───────────────────

/**
 * "Goes to your bank on …" for one ledger row (§3.3), or null: unpaid, or
 * paid to an account Stripe's own schedule still pays out. A sale's money
 * goes at the first run 14 × 24 h after the row (written after the charge,
 * so never earlier than the job's real date), and not before the run that
 * first sees its transfer (a drain can release an old sale late; one inside
 * the morning wake goes that morning). A re-pay has no charge and goes at
 * the run that first sees its transfer.
 */
export function bankOnFor(
  row: {
    status: string;
    stripeTransferId: string | null;
    stripeChargeId: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  },
  manualPayoutsSince: Date | null,
  clearedEpisode: ClearedEpisode | null = null
): string | null {
  if (row.status !== 'paid' || !row.stripeTransferId) return null;
  const transferredAt = row.resolvedAt ?? row.createdAt;
  if (!manualPayoutsSince || manualPayoutsSince > transferredAt) return null;
  // Read later from the row, which can't say which drain paid it: the first
  // run strictly after, so a sale the cron's own drain paid at 08:00 shows the
  // next morning (a day late) rather than any other drain's a day early.
  const run = bankRunFor(
    row.stripeChargeId !== null,
    row.createdAt,
    transferredAt,
    false
  );
  // Nothing goes to the bank while the balance is below zero, so a run inside
  // the last episode that ended moves to the run that saw it clear: that run
  // records its snapshot and then pays what is above zero.
  if (
    clearedEpisode &&
    run.getTime() >= clearedEpisode.since.getTime() &&
    run.getTime() < clearedEpisode.clearedAt.getTime()
  ) {
    return londonDate(runAtOrAfter(clearedEpisode.clearedAt));
  }
  return londonDate(run);
}

/**
 * The last below-zero episode that ended (`connect_balances.cleared_since`,
 * `cleared_at`): from the run that first saw it to the run that saw it
 * clear. Only the last is kept, so an older episode's runs can't be moved.
 */
export interface ClearedEpisode {
  since: Date;
  clearedAt: Date;
}

/** The payout run at or after `at`: `at` itself when it is one. */
function runAtOrAfter(at: Date): Date {
  const { year, month, day } = londonParts(at);
  const sameDay = london0800On(year, month, day);
  return sameDay.getTime() >= at.getTime()
    ? sameDay
    : london0800On(year, month, day + 1);
}

function bankRunFor(
  hasCharge: boolean,
  createdAt: Date,
  transferredAt: Date,
  cronDrain: boolean
): Date {
  const transferRun = runPayingTransferAt(transferredAt, cronDrain);
  if (!hasCharge) return transferRun;
  // The job holds a sale until it is MORE than 14 × 24 h old: strictly after.
  const holdRun = firstLondon0800After(
    new Date(createdAt.getTime() + BANK_HOLD_MS)
  );
  return holdRun > transferRun ? holdRun : transferRun;
}

/** One creator slice a drain just paid, for the payout-released email. */
export interface ReleasedSlice {
  cents: number;
  createdAt: Date;
  /** False for a re-pay row: no charge, so it goes at the next run. */
  hasCharge: boolean;
}

/** The three `payout-released` fields (§5.4); each is one line (§14). */
export interface PayoutReleasedBankFields {
  bankSentence: string;
  bankLines: string;
  bankDate: string;
}

/** Today's line, still true for an account Stripe's schedule pays out. */
const STRIPE_SCHEDULE_SENTENCE =
  'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.';

let dayFormat_: Intl.DateTimeFormat | undefined;
let shortDayFormat_: Intl.DateTimeFormat | undefined;

/** "Thu 29 Oct" */
function formatDay(at: Date): string {
  dayFormat_ ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return dayFormat_.format(at);
}

/** "10 Nov" */
function formatShortDay(at: Date): string {
  shortDayFormat_ ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    day: 'numeric',
    month: 'short',
  });
  return shortDayFormat_.format(at);
}

const pounds = (cents: number) => `£${(cents / 100).toFixed(2)}`;

/**
 * The `payout-released` email's bank timing (mock-b-studio M5, M6), from what
 * the drain actually paid and the account's real state, so it is true before
 * and after the switch to manual payouts. `bankSentence` is the whole
 * paragraph, including the bank's own "within 2 working days".
 */
export function payoutReleasedBankFields(input: {
  slices: readonly ReleasedSlice[];
  manualPayouts: boolean;
  now: Date;
  /** Paid by the cron's own drain, ahead of the bank payout in its wake. */
  cronDrain?: boolean;
}): PayoutReleasedBankFields {
  const total = input.slices.reduce((sum, slice) => sum + slice.cents, 0);
  if (!input.manualPayouts) {
    return {
      bankSentence: STRIPE_SCHEDULE_SENTENCE,
      bankLines: `To your bank on your Stripe payout schedule: ${pounds(total)}`,
      bankDate: 'Within 2 business days',
    };
  }
  const cronDrain = input.cronDrain ?? false;
  const nextRun = runPayingTransferAt(input.now, cronDrain);
  let oldCents = 0;
  let youngCentsTotal = 0;
  let last = nextRun;
  for (const slice of input.slices) {
    const run = bankRunFor(
      slice.hasCharge,
      slice.createdAt,
      input.now,
      cronDrain
    );
    if (run.getTime() === nextRun.getTime()) {
      oldCents += slice.cents;
    } else {
      youngCentsTotal += slice.cents;
      if (run.getTime() > last.getTime()) last = run;
    }
  }
  const next = formatDay(nextRun);
  const lastShort = formatShortDay(last);
  if (youngCentsTotal === 0) {
    return {
      bankSentence: `Every sale in it is more than 14 days old, so it goes to your bank at the next daily payout, on ${next}. Your bank usually shows it within 2 working days.`,
      bankLines: `To your bank on ${next}: ${pounds(total)}`,
      bankDate: next,
    };
  }
  if (oldCents === 0) {
    return {
      bankSentence: `It is from sales in the last 14 days: each goes to your bank 14 days after its sale, the last on ${lastShort}. Your bank usually shows a payout within 2 working days.`,
      bankLines: `14 days after each sale: ${pounds(total)}, the last on ${lastShort}`,
      bankDate: formatDay(last),
    };
  }
  return {
    bankSentence: `${pounds(oldCents)} is from sales more than 14 days old, so it goes to your bank at the next daily payout, on ${next}. The other ${pounds(youngCentsTotal)} is from sales in the last 14 days: each follows 14 days after its sale, the last on ${lastShort}. Your bank usually shows a payout within 2 working days.`,
    bankLines: `To your bank on ${next}: ${pounds(oldCents)} · Then 14 days after each sale: ${pounds(youngCentsTotal)}, the last on ${lastShort}`,
    bankDate: formatDay(last),
  };
}

// ─── Reading an account from Stripe ────────────────────────────────────────

/**
 * Each of the job's Stripe calls gives up after 10 s and is retried once: the
 * SDK's 80 s default would let a few slow accounts outrun the cron's
 * wall-clock time. A retried `payouts.create` replays its idempotency key.
 */
export const BANK_PAYOUT_STRIPE_REQUEST = {
  timeout: 10_000,
  maxNetworkRetries: 1,
} as const satisfies Stripe.RequestOptions;

/**
 * At most this many pages of 100 transfers in 14 days (10,000; each page is
 * one call). More is refused, never guessed: an incomplete list could pay
 * young money early.
 */
export const BANK_TRANSFER_LIST_MAX_PAGES = 100;

/**
 * An account with more transfers in 14 days than the job reads. It is not
 * paid out until someone looks, so the job raises it as an error alert.
 * The context stays empty: a 500's context is logged, not sent (Codex-adcgb),
 * and the account id is on `stripeAccountId`. Studio maps this to 503.
 */
export class BankTransferListTooLongError extends InternalServiceError {
  readonly stripeAccountId: string;

  constructor(stripeAccountId: string) {
    super('Too many transfers in 14 days to read for a bank payout');
    this.stripeAccountId = stripeAccountId;
  }
}

/** One account's balance, read on the account. */
export async function readGbpBalance(
  stripe: Stripe,
  stripeAccountId: string,
  request: Stripe.RequestOptions = BANK_PAYOUT_STRIPE_REQUEST
): Promise<GbpBalance> {
  return gbpBalance(
    await stripe.balance.retrieve(
      {},
      { ...request, stripeAccount: stripeAccountId }
    )
  );
}

/**
 * The platform's transfers to the account created since `since` (and up to
 * `until`, when given), every page, each with its charge. A young transfer is
 * never older than its charge, so `since = runAt − 14 × 24 h` lists every one
 * young at `runAt` or later. Throws when there are more than the page cap: an
 * incomplete list could pay young money early.
 */
export async function listBankTransfers(
  stripe: Stripe,
  stripeAccountId: string,
  since: Date,
  request: Stripe.RequestOptions = BANK_PAYOUT_STRIPE_REQUEST,
  until?: Date
): Promise<BankTransfer[]> {
  const transfers: BankTransfer[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < BANK_TRANSFER_LIST_MAX_PAGES; page++) {
    const list = await stripe.transfers.list(
      {
        destination: stripeAccountId,
        created: {
          gte: Math.floor(since.getTime() / 1000),
          ...(until ? { lte: Math.ceil(until.getTime() / 1000) } : {}),
        },
        limit: 100,
        expand: ['data.source_transaction'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      request
    );
    for (const transfer of list.data) {
      const read = toBankTransfer(transfer);
      if (read) transfers.push(read);
    }
    const last = list.data.at(-1);
    if (!list.has_more || !last) return transfers;
    startingAfter = last.id;
  }
  throw new BankTransferListTooLongError(stripeAccountId);
}

// ─── The daily job ─────────────────────────────────────────────────────────

/**
 * How many London calendar days of refusals before support hears of it. Days,
 * not 72 h: across the spring change day 3's run is an hour short of 72 h.
 */
export const BANK_PAYOUT_FAILING_ALERT_DAYS = 3;

/**
 * Accounts per run, least recently checked first, so the ones not reached
 * today go first tomorrow (a read that fails leaves `checked_at` too).
 *
 * Sized to the invocation's subrequest budget, not to time (review r2 LOW-2).
 * A paid-plan Worker gets 10,000 subrequests per invocation by default, KV
 * included (developers.cloudflare.com/workers/platform/limits); ecom-api
 * sets no `limits`. The database is one WebSocket pool, so its queries don't
 * count. The same wake's other sweeps first take at most about 4,000
 * (disputes 50, the drain's 50 payees and their transfers, owed duplicates
 * 50, course off-sale 200, clawback retries 100, each a few calls plus
 * retries), which leaves 6,000. One account is about 6: the balance 1, one
 * page of transfers 1, a payout per pot 1, two Studio-cache invalidations
 * 2, and 1 for a retry. 6,000 / 6 = 1,000. Reaching it is an error alert:
 * the budget needs raising (`limits.subrequests`) before accounts wait days.
 * At 4 at a time and about 0.5 s each, 1,000 also fit the 15 minutes.
 */
export const BANK_PAYOUT_ACCOUNT_LIMIT = 1000;
const BANK_PAYOUT_CONCURRENCY = 4;

interface BankPayoutLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface BankPayoutDeps {
  db: DatabaseClient;
  stripe: Stripe;
  obs: BankPayoutLogger;
  /** Tags each payout with `codex_env` (Codex-2hxff.5). */
  environment: string;
  /**
   * Drops the person's cached Studio balance (§9) after a payout or a
   * negative-balance change. Fire-and-forget; must not throw.
   */
  invalidateBalance: (userId: string) => void;
  /** Tests only: a smaller `BANK_PAYOUT_ACCOUNT_LIMIT`. */
  accountLimit?: number;
}

/**
 * One run's tally. `paid`, `insufficient`, `alreadyPaid` and a refused payout's
 * `failed` count payouts, one per pot (one pot today, so one per account);
 * the rest count accounts.
 */
export interface BankPayoutRunSummary {
  runDate: string;
  accounts: number;
  paid: number;
  paidCents: number;
  /** Available below zero: Stripe holds it (Q2); nothing can be paid. */
  negative: number;
  /** Nothing older than the window to pay. */
  nothingOld: number;
  /** Stripe has payouts off on the account: read and recorded, not paid. */
  payoutsOff: number;
  /** `balance_insufficient`: skipped today, never retried in this run. */
  insufficient: number;
  /** Stripe already has today's payout under its key. */
  alreadyPaid: number;
  failed: number;
  /**
   * Accounts the run never finished because Cloudflare's subrequest budget
   * ran out (0 normally). Those it never read keep their older
   * `checked_at`, so they go first tomorrow.
   */
  accountsLeft: number;
}

type PayoutOutcome =
  | { kind: 'insufficient'; code: 'balance_insufficient' }
  | { kind: 'already_paid' }
  /** Stripe answered no: the payout was not made. */
  | { kind: 'refused'; code: string }
  /** No answer (an outage, a timeout): it may exist; tomorrow's balance read decides. */
  | { kind: 'unknown'; code: string };

function field(error: unknown, name: string): unknown {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

/**
 * Cloudflare's "Too many subrequests": the invocation's budget is spent, so
 * every later Stripe call fails the same way and the run must stop (review
 * r3 LOW-2). The Stripe SDK wraps the fetch error as a StripeConnectionError
 * whose `detail` is the original.
 */
export function isSubrequestLimit(error: unknown): boolean {
  let at: unknown = error;
  for (let depth = 0; at && depth < 3; depth++) {
    const message = field(at, 'message');
    if (typeof message === 'string' && /too many subrequests/i.test(message)) {
      return true;
    }
    at = field(at, 'detail') ?? field(at, 'cause');
  }
  return false;
}

/** Sort a failed `payouts.create`: definitive, or outcome unknown, never guessed. */
export function classifyPayoutFailure(error: unknown): PayoutOutcome {
  const type = String(field(error, 'type') ?? '');
  const code = String(field(error, 'code') ?? (type || 'unknown')).slice(0, 64);
  const status = field(error, 'statusCode');
  if (code === 'balance_insufficient') return { kind: 'insufficient', code };
  if (type === 'StripeIdempotencyError' && code !== 'idempotency_key_in_use') {
    return { kind: 'already_paid' };
  }
  if (
    !type.startsWith('Stripe') ||
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeRateLimitError' ||
    typeof status !== 'number' ||
    status === 409 ||
    status === 429 ||
    status >= 500
  ) {
    return { kind: 'unknown', code };
  }
  return { kind: 'refused', code };
}

type BankAccountRow = Pick<
  typeof connectBalances.$inferSelect,
  | 'stripeAccountId'
  | 'userId'
  | 'negativeSince'
  | 'checkedAt'
  | 'availableCents'
  | 'lastErrorCode'
  | 'failingSince'
> & {
  /** The current account's flag; null for a replaced account (still paid, S5's 90 days). */
  payoutsEnabled: boolean | null;
};

/**
 * Every account switched to manual payouts, from OUR database, so a shared
 * Stripe sandbox never leaks another environment's. Least recently checked
 * first, so the ones not reached today go first tomorrow; one on a failing
 * streak after all the others. Each one's balance is
 * read and recorded, including a current account Stripe has payouts off on:
 * a balance can still go below zero there, and support's Creator debts and
 * the Q4 clock read the episode (review MED-3). Only the payout waits for
 * `payouts_enabled`.
 */
function bankPayoutAccounts(
  db: DatabaseClient,
  limit: number
): Promise<BankAccountRow[]> {
  return db
    .select({
      stripeAccountId: connectBalances.stripeAccountId,
      userId: connectBalances.userId,
      negativeSince: connectBalances.negativeSince,
      checkedAt: connectBalances.checkedAt,
      availableCents: connectBalances.availableCents,
      lastErrorCode: connectBalances.lastErrorCode,
      failingSince: connectBalances.failingSince,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(connectBalances)
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.stripeAccountId, connectBalances.stripeAccountId)
    )
    .where(isNotNull(connectBalances.manualPayoutsSince))
    .orderBy(
      // An account Stripe keeps refusing, its balance read included, goes
      // last: a read that fails every day writes no `checked_at`, and would
      // otherwise head the queue for good (review r3 LOW-3).
      sql`${connectBalances.failingSince} IS NOT NULL`,
      sql`${connectBalances.checkedAt} ASC NULLS FIRST`,
      asc(connectBalances.stripeAccountId)
    )
    .limit(limit);
}

/**
 * Record this morning's balance and the episode it moves (§4.1). The write is
 * guarded on the episode as read, so a change made meanwhile is left for the
 * next run. Returns whether the episode changed, and the debt over £50 Stripe
 * collected from the platform, if this write recorded one.
 *
 * Amendment 2 (§14, "Over £50 stays support's to_invoice case until P6"): an
 * episode that ends `stripe_collected` owing more than £50 is added to
 * `collected_owed_cents`, first `collected_at` kept, in this same write. Only
 * the P6 follow-up clears them; a new episode never touches them.
 */
async function recordSnapshot(
  db: DatabaseClient,
  account: BankAccountRow,
  balance: GbpBalance,
  now: Date
): Promise<{ changed: boolean; collectedCents: number | null }> {
  const change = nextBalanceEpisode(account, balance.availableCents, now);
  const collectedCents =
    change.kind === 'cleared' &&
    change.reason === 'stripe_collected' &&
    change.owedCents !== null &&
    change.owedCents > DEBT_INVOICE_THRESHOLD_CENTS
      ? change.owedCents
      : null;
  const episode =
    change.kind === 'started'
      ? {
          negativeSince: change.negativeSince,
          negativeAfter:
            change.negativeAfter && change.negativeAfter < change.negativeSince
              ? change.negativeAfter
              : null,
        }
      : change.kind === 'cleared'
        ? {
            negativeSince: null,
            negativeAfter: null,
            clearedSince: change.since,
            clearedAt: change.clearedAt,
            // T for the ended episode's sharing (amendment 3).
            clearedBalanceCents: balance.availableCents + balance.pendingCents,
            clearedReason: change.reason,
            // Only here: it keeps the last episode's figure until the next
            // one clears (the written-off email, M10).
            clearedOwedCents: change.owedCents,
            ...(collectedCents !== null
              ? {
                  collectedOwedCents: sql`COALESCE(${connectBalances.collectedOwedCents}, 0) + ${collectedCents}`,
                  collectedAt: sql`COALESCE(${connectBalances.collectedAt}, ${now.toISOString()}::timestamptz)`,
                }
              : {}),
          }
        : {};
  const written = await db
    .update(connectBalances)
    .set({
      availableCents: balance.availableCents,
      pendingCents: balance.pendingCents,
      checkedAt: now,
      ...episode,
    })
    .where(
      and(
        eq(connectBalances.stripeAccountId, account.stripeAccountId),
        account.negativeSince
          ? eq(connectBalances.negativeSince, account.negativeSince)
          : isNull(connectBalances.negativeSince)
      )
    )
    .returning();
  return {
    changed: change.kind !== 'none',
    collectedCents: written.length > 0 ? collectedCents : null,
  };
}

/**
 * What one account's run came to: one result before any payout is asked for,
 * else one per pot asked (one pot today).
 */
type AccountResult =
  | { kind: 'paid'; cents: number }
  | {
      kind:
        | 'negative'
        | 'nothing_old'
        | 'payouts_off'
        | 'insufficient'
        | 'already_paid';
    }
  | { kind: 'failed' }
  /** Cloudflare's subrequest budget ran out: the run stops here. */
  | { kind: 'budget_spent' };

/**
 * A run that had nothing to ask Stripe for ends a run of refusals: the 3-day
 * mark counts consecutive refused runs, so a refusal weeks later is a new
 * one and can alert again (review LOW-4).
 */
async function endRefusals(
  db: DatabaseClient,
  account: BankAccountRow
): Promise<void> {
  if (account.failingSince === null && account.lastErrorCode === null) return;
  await db
    .update(connectBalances)
    .set({ lastErrorCode: null, failingSince: null })
    .where(eq(connectBalances.stripeAccountId, account.stripeAccountId));
}

async function payOutAccount(
  deps: BankPayoutDeps,
  account: BankAccountRow,
  runAt: Date,
  runDate: string
): Promise<AccountResult[]> {
  const { db, stripe, obs } = deps;
  const { stripeAccountId, userId } = account;

  let balance: GbpBalance;
  try {
    balance = await readGbpBalance(stripe, stripeAccountId);
  } catch (error) {
    if (isSubrequestLimit(error)) return [{ kind: 'budget_spent' }];
    obs.warn('bank_payout.skipped: balance read failed; tried again tomorrow', {
      stripeAccountId,
      code: field(error, 'code'),
      requestId: field(error, 'requestId'),
      error: error instanceof Error ? error.message : String(error),
    });
    // Stripe answered no (access lost, say): a streak like a refused
    // payout's, which also sends the account to the back of the order. An
    // outage or a timeout leaves it first for tomorrow.
    const outcome = classifyPayoutFailure(error);
    if (outcome.kind === 'refused') {
      await recordRefusal(
        deps,
        account,
        { code: outcome.code, sourceType: null },
        runAt,
        null
      );
    }
    return [{ kind: 'failed' }];
  }

  // Stamped with the run, not the wall clock: it is the 08:00 snapshot, and
  // the episode and the 3-day mark are measured run to run.
  const now = runAt;
  const snapshot = await recordSnapshot(db, account, balance, now);
  if (snapshot.changed) deps.invalidateBalance(userId);
  if (snapshot.collectedCents !== null) {
    obs.error(
      'bank_payout.debt_collected: Stripe collected a debt over £50 from the platform; support invoices it (P6)',
      {
        errorId: crypto.randomUUID(),
        stripeAccountId,
        collectedCents: snapshot.collectedCents,
        runDate,
      }
    );
  }
  // Nothing is paid while the account's total available is zero or below,
  // whatever one pot holds: the episode reads the total, and Studio says
  // payouts resume once it's back above zero (review r2 LOW-4).
  if (balance.availableCents <= 0) {
    await endRefusals(db, account);
    return [{ kind: balance.availableCents < 0 ? 'negative' : 'nothing_old' }];
  }
  // Read and recorded above; Stripe won't pay it out while payouts are off.
  if (account.payoutsEnabled === false) {
    await endRefusals(db, account);
    return [{ kind: 'payouts_off' }];
  }

  let transfers: BankTransfer[];
  try {
    transfers = await listBankTransfers(
      stripe,
      stripeAccountId,
      new Date(runAt.getTime() - BANK_HOLD_MS)
    );
  } catch (error) {
    if (isSubrequestLimit(error)) return [{ kind: 'budget_spent' }];
    if (error instanceof BankTransferListTooLongError) {
      // Every morning would skip it the same way: it needs a person.
      obs.error(
        'bank_payout.too_many_transfers: this account is not paid out until the cap is raised',
        {
          errorId: crypto.randomUUID(),
          stripeAccountId,
          maxTransfers: BANK_TRANSFER_LIST_MAX_PAGES * 100,
          runDate,
        }
      );
      return [{ kind: 'failed' }];
    }
    obs.warn(
      'bank_payout.skipped: transfer list failed; tried again tomorrow',
      {
        stripeAccountId,
        code: field(error, 'code'),
        requestId: field(error, 'requestId'),
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return [{ kind: 'failed' }];
  }

  const plans = planBankPayouts({ runAt, balance, transfers });
  for (const plan of plans) {
    if (plan.pendingExceedsYoung) {
      obs.warn('bank_payout.pending_exceeds_young', {
        stripeAccountId,
        sourceType: plan.sourceType,
        pendingCents: plan.pendingCents,
        youngCents: plan.youngCents,
      });
    }
  }
  const due = plans.filter((plan) => plan.payoutCents > 0);
  if (due.length === 0) {
    await endRefusals(db, account);
    return [{ kind: 'nothing_old' }];
  }

  // One payout per pot, each under its own key; a refusal skips only its pot.
  const results: AccountResult[] = [];
  const made: Stripe.Payout[] = [];
  let refusal: Refusal | null = null;
  for (const plan of due) {
    const { sourceType } = plan;
    try {
      const payout = await stripe.payouts.create(
        {
          amount: plan.payoutCents,
          currency: 'gbp',
          // Every pot Stripe reports is asked for, even one this code has no
          // name for: a refusal counts into the 3-day alert, so money can't
          // sit in a pot unseen.
          source_type: sourceType as Stripe.PayoutCreateParams.SourceType,
          metadata: {
            ...stripeEnvMetadata(deps.environment),
            type: 'bank_payout',
            run_date: runDate,
            source_type: sourceType,
          },
        },
        {
          ...BANK_PAYOUT_STRIPE_REQUEST,
          stripeAccount: stripeAccountId,
          idempotencyKey: `bank_payout_${stripeAccountId}_${runDate}_${sourceType}`,
        }
      );
      made.push(payout);
      results.push({ kind: 'paid', cents: payout.amount });
      obs.info('bank_payout.paid', {
        stripeAccountId,
        sourceType,
        payoutId: payout.id,
        amountCents: payout.amount,
        runDate,
      });
    } catch (error) {
      if (isSubrequestLimit(error)) {
        results.push({ kind: 'budget_spent' });
        break;
      }
      const outcome = logPayoutFailure(
        obs,
        stripeAccountId,
        sourceType,
        plan.payoutCents,
        error
      );
      if (outcome.kind === 'insufficient' || outcome.kind === 'refused') {
        refusal ??= { code: outcome.code, sourceType };
      }
      results.push({
        kind:
          outcome.kind === 'insufficient' || outcome.kind === 'already_paid'
            ? outcome.kind
            : 'failed',
      });
    }
  }

  const last = made.at(-1);
  try {
    if (last) {
      await db
        .update(connectBalances)
        .set({
          lastPayoutId: last.id,
          lastPayoutCents: last.amount,
          lastPayoutAt: now,
          // A paid run ends a streak, unless another pot was refused in it.
          ...(refusal ? {} : { lastErrorCode: null, failingSince: null }),
        })
        .where(eq(connectBalances.stripeAccountId, stripeAccountId));
    }
    if (refusal) {
      await recordRefusal(deps, account, refusal, now, account.checkedAt);
    }
  } catch (error) {
    // Nothing moved: the run's own per-account error.
    if (!last) throw error;
    // The money moved; only our record of it is behind. Tomorrow's balance
    // read starts from the real balance, so nothing is paid twice.
    obs.error('bank_payout.paid_but_not_recorded', {
      errorId: crypto.randomUUID(),
      stripeAccountId,
      payoutId: last.id,
      payoutIds: made.map((payout) => payout.id),
      amountCents: made.reduce((sum, payout) => sum + payout.amount, 0),
      runDate,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (last) deps.invalidateBalance(userId);
  return results;
}

/** A pot's payout Stripe answered no to, or had too little for. */
interface Refusal {
  code: string;
  /** The pot refused; null when it was the balance read. */
  sourceType: string | null;
}

/** Log one pot's failed `payouts.create`, and say what it was. */
function logPayoutFailure(
  obs: BankPayoutLogger,
  stripeAccountId: string,
  sourceType: string,
  amountCents: number,
  error: unknown
): PayoutOutcome {
  const outcome = classifyPayoutFailure(error);
  const requestId = field(error, 'requestId');
  const meta = { stripeAccountId, sourceType, amountCents, requestId };
  if (outcome.kind === 'already_paid') {
    obs.info(
      'bank_payout.already_paid: Stripe has today’s payout under its key',
      meta
    );
  } else if (outcome.kind === 'insufficient') {
    obs.warn(
      'bank_payout.insufficient: skipped today; counts towards the 3-day alert',
      meta
    );
  } else {
    obs.warn(
      outcome.kind === 'refused'
        ? 'bank_payout.skipped: Stripe refused the payout'
        : 'bank_payout.skipped: no answer from Stripe; tomorrow’s balance read decides',
      { ...meta, code: outcome.code }
    );
  }
  return outcome;
}

/**
 * A refused pot (`balance_insufficient` included: Stripe holding money our
 * figures say is there is money stuck) is recorded on the account, and once
 * it has been refused for 3 London days running support hears of it ONCE: on
 * the first refused run past that mark, which is the one whose previous check
 * was still before it (a run with nothing to ask for ends the streak,
 * `endRefusals`). Neither is retried in the run: "skip today".
 */
async function recordRefusal(
  deps: BankPayoutDeps,
  account: BankAccountRow,
  refusal: Refusal,
  now: Date,
  /**
   * The account's previous check, which says whether the mark was already
   * passed (and support told). A failed balance read has none, since its
   * reads write no `checked_at`: null, and it is told on the run exactly 3
   * London days in.
   */
  previousCheck: Date | null
): Promise<void> {
  const { stripeAccountId } = account;
  const failingSince = account.failingSince ?? now;
  await deps.db
    .update(connectBalances)
    .set({ lastErrorCode: refusal.code, failingSince })
    .where(eq(connectBalances.stripeAccountId, stripeAccountId));
  const days = (at: Date) => londonDaysBetween(failingSince, at);
  const passedBefore =
    previousCheck === null
      ? days(now) > BANK_PAYOUT_FAILING_ALERT_DAYS
      : days(previousCheck) >= BANK_PAYOUT_FAILING_ALERT_DAYS;
  if (days(now) >= BANK_PAYOUT_FAILING_ALERT_DAYS && !passedBefore) {
    deps.obs.error(
      'Stripe has refused this account’s bank payouts for 3 days: check the account and its bank details in Stripe',
      {
        errorId: crypto.randomUUID(),
        stripeAccountId,
        sourceType: refusal.sourceType,
        failingSince: failingSince.toISOString(),
        code: refusal.code,
      }
    );
  }
}

/**
 * The daily bank payout (§3.2): every switched account's balance is read and
 * recorded (so a negative balance is tracked even with nothing to pay), and
 * the money older than the 14-day window is paid out. Each account is
 * isolated; the run itself never throws past one account. `runAt` is the
 * cron's `scheduledTime`, so a re-run of the same morning computes the same
 * cut-off and replays the same key.
 */
export async function runBankPayouts(
  deps: BankPayoutDeps,
  runAt: Date
): Promise<BankPayoutRunSummary> {
  const runDate = londonDate(runAt);
  const limit = deps.accountLimit ?? BANK_PAYOUT_ACCOUNT_LIMIT;
  const accounts = await bankPayoutAccounts(deps.db, limit);
  if (accounts.length === limit) {
    const [flagged] = await deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectBalances)
      .where(isNotNull(connectBalances.manualPayoutsSince));
    deps.obs.error(
      'bank_payout.account_limit: more accounts than one run can pay; the rest go first tomorrow. Raise ecom-api limits.subrequests and BANK_PAYOUT_ACCOUNT_LIMIT',
      {
        errorId: crypto.randomUUID(),
        runDate,
        limit,
        flaggedAccounts: flagged?.count ?? null,
      }
    );
  }
  const summary: BankPayoutRunSummary = {
    runDate,
    accounts: accounts.length,
    paid: 0,
    paidCents: 0,
    negative: 0,
    nothingOld: 0,
    payoutsOff: 0,
    insufficient: 0,
    alreadyPaid: 0,
    failed: 0,
    accountsLeft: 0,
  };

  let next = 0;
  let done = 0;
  // The first "Too many subrequests" stops the run: every later call would
  // fail the same way, one warning each (review r3 LOW-2).
  let budgetSpent = false;
  const worker = async () => {
    while (!budgetSpent && next < accounts.length) {
      const account = accounts[next++];
      if (!account) break;
      let results: AccountResult[];
      try {
        results = await payOutAccount(deps, account, runAt, runDate);
      } catch (error) {
        deps.obs.error('bank_payout.account_failed', {
          errorId: crypto.randomUUID(),
          stripeAccountId: account.stripeAccountId,
          runDate,
          error: error instanceof Error ? error.message : String(error),
        });
        results = [{ kind: 'failed' }];
      }
      for (const result of results) {
        if (result.kind === 'paid') {
          summary.paid++;
          summary.paidCents += result.cents;
        } else if (result.kind === 'negative') summary.negative++;
        else if (result.kind === 'nothing_old') summary.nothingOld++;
        else if (result.kind === 'payouts_off') summary.payoutsOff++;
        else if (result.kind === 'insufficient') summary.insufficient++;
        else if (result.kind === 'already_paid') summary.alreadyPaid++;
        else summary.failed++;
      }
      if (results.some((result) => result.kind === 'budget_spent')) {
        budgetSpent = true;
      } else {
        done++;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(BANK_PAYOUT_CONCURRENCY, accounts.length) },
      worker
    )
  );

  if (budgetSpent) {
    summary.accountsLeft = accounts.length - done;
    deps.obs.error(
      'bank_payout.subrequest_limit: the run ran out of Cloudflare subrequests and stopped; the rest go first tomorrow. Raise ecom-api limits.subrequests or lower BANK_PAYOUT_ACCOUNT_LIMIT',
      {
        errorId: crypto.randomUUID(),
        runDate,
        accountsDone: done,
        accountsLeft: summary.accountsLeft,
      }
    );
  }

  deps.obs.info('bank_payout.run', { ...summary });
  return summary;
}
