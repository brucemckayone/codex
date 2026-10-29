/**
 * Creator debts, one row per person: the words (Codex-2hxff.30, .73;
 * mock-b-support D1-D2; owner decisions Q2, Q4, Q7).
 *
 * Display only. The totals, the state and the Q4 clock are the server's
 * (`CreatorDebtPerson`); this module puts them into words. A balance Stripe
 * couldn't be read for says so and never reads £0.00.
 */

import type { CreatorDebtPerson, QueueCause } from '@codex/admin';
import { formatPence } from '$lib/utils/bank-payouts';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  type BadgeTreatment,
  causeLine,
  closesIfWon,
  formatDay,
  roleLabel,
} from './support-format';

export function debtorName(person: CreatorDebtPerson): string {
  return person.payee.name || m.support_debt_unnamed();
}

/** "Creator", "Organisation owner", or both. */
export function personRoles(person: CreatorDebtPerson): string {
  return person.payee.roles.map(roleLabel).join(' · ');
}

/** Where it stands (Q4): the badge. */
export function standsBadge(state: CreatorDebtPerson['state']): BadgeTreatment {
  switch (state) {
    case 'to_invoice':
      return { label: m.support_debts_state_to_invoice(), variant: 'warning' };
    case 'needs_settling':
      return {
        label: m.support_debts_state_needs_settling(),
        variant: 'warning',
      };
    default:
      return { label: m.support_debts_state_recovering(), variant: 'warning' };
  }
}

function daysLeft(days: number): string {
  return days === 1
    ? m.support_days_in_one()
    : m.support_days_in({ count: String(days) });
}

/** Any of the person's debts whose chargeback is still open. */
function causes(person: CreatorDebtPerson): QueueCause[] {
  return [
    ...person.stripeHeld.map((held) => held.cause),
    ...person.recordedDebts.flatMap((debt) => (debt.cause ? [debt.cause] : [])),
  ];
}

/** Where it stands: the lines under the badge. */
export function clockLines(person: CreatorDebtPerson): string[] {
  const lines: string[] = [];
  // Over £50 that Stripe collected from the platform at 180 days: still
  // theirs to pay, and support's until invoices ship (AMENDMENT 2, P6).
  if (person.collectedCents !== null && person.collectedAt !== null) {
    lines.push(
      m.support_debts_collected({
        amount: formatPrice(person.collectedCents),
        date: formatDay(person.collectedAt),
      })
    );
  }
  const clock = person.clock;
  if (clock) {
    const date = formatDay(clock.on);
    if (clock.kind === 'invoice') {
      lines.push(
        clock.daysLeft > 0
          ? m.support_debts_clock_invoice({
              date,
              left: daysLeft(clock.daysLeft),
            })
          : m.support_debts_clock_invoice_due({ date })
      );
    } else {
      lines.push(
        clock.daysLeft > 0
          ? m.support_debts_clock_writes_off({
              date,
              left: daysLeft(clock.daysLeft),
            })
          : m.support_debts_clock_writes_off_due({ date })
      );
    }
  } else if (person.recordedDebts.length > 0) {
    lines.push(m.support_debts_clock_refused());
  }
  if (causes(person).some(closesIfWon))
    lines.push(m.support_debt_closes_if_won());
  return lines;
}

export interface BalanceCell {
  /** The live balance, signed ("−£8.40"); null when Stripe wasn't read. */
  amount: string | null;
  negative: boolean;
  sub: string | null;
}

/** The Stripe balance column (D1, D2). */
export function balanceCell(person: CreatorDebtPerson): BalanceCell {
  const { live, availableCents } = person.stripe;
  if (!live || availableCents === null) {
    return {
      amount: null,
      negative: false,
      sub: m.support_debts_balance_unread(),
    };
  }
  const negative = availableCents < 0;
  return {
    amount: formatPence(availableCents),
    negative,
    sub: negative
      ? m.support_debts_balance_paused()
      : person.state === 'needs_settling'
        ? m.support_debts_balance_refused()
        : null,
  };
}

/** Under Owes, when Stripe's part of it couldn't be read just now. */
export function owesSub(person: CreatorDebtPerson): string | null {
  return !person.stripe.live && person.stripeOwedCents > 0
    ? m.support_debts_as_recorded()
    : null;
}

/** Back so far: waits for Stripe ("—") rather than guessing. */
export function backText(person: CreatorDebtPerson): string {
  return person.backCents === null
    ? m.support_debts_back_unknown()
    : formatPrice(person.backCents);
}

/** The phone list's balance line: "Stripe balance −£8.40 · back so far £6.00". */
export function phoneBalanceLine(person: CreatorDebtPerson): string {
  const cell = balanceCell(person);
  const balance = cell.amount
    ? m.support_debts_phone_balance({ amount: cell.amount })
    : (cell.sub ?? '');
  return m.support_debts_phone_back({ balance, back: backText(person) });
}

/** A debt line's cause, after its title: organisation, buyer, refund or chargeback. */
export function debtCauseLine(
  organizationName: string | null,
  buyerName: string | null,
  cause: QueueCause | null
): string {
  return [organizationName, causeLine(buyerName, cause)]
    .filter(Boolean)
    .join(' · ');
}
