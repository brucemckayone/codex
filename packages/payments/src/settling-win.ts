/**
 * A chargeback won and its outcome not yet applied: the win has not settled,
 * so its creators' pay-back is still being written (Codex-2hxff.70; late-win
 * data design §4.7). A normal win's moments before its re-pay, and a late
 * win's undo, alike. One rule for every part that waits on it, so they never
 * disagree:
 *
 * - support refuses a refund meanwhile (`CHARGEBACK_SETTLING`, by
 *   `isSettlingWin`);
 * - a refund's clawback waits for it (clawback.ts `waitForWinToSettle`, by
 *   `settlingWinSql`);
 * - the win's re-pay rows stay unpaid until it settles (payout-ledger.ts
 *   `isDrainablePayout`, by `settlingWinSql`). The hold must last as long as
 *   the wait: the waiting refund's share comes off those rows.
 *
 * It has a module of its own because the clawback imports the payout ledger:
 * from here, both read it with no import cycle.
 */

import { disputes } from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
import { type SQL, sql } from 'drizzle-orm';

/**
 * A refund's clawback waiting for a won chargeback on its charge to settle
 * (clawback.ts `waitForWinToSettle`). Still a `ServiceUnavailableError`, so
 * it is transient: the webhook answers 500, Stripe redelivers, and the
 * hourly retry tries again. But waiting is not a fault (late-win data design
 * §11): the webhook logs it at warn, not as an alert. A late win's own
 * refund meets it on every delivery until its outcome is marked.
 */
export class WinSettlingError extends ServiceUnavailableError {
  constructor(context: { chargeId: string; disputeId: string }) {
    super(
      "A chargeback on this charge was just won and is being paid back; the refund's clawback waits for it",
      context
    );
  }
}

/** The rule on a dispute row already read. */
export function isSettlingWin(dispute: {
  status: string;
  outcomeAppliedAt: Date | null;
}): boolean {
  return dispute.status === 'won' && dispute.outcomeAppliedAt === null;
}

/** `isSettlingWin` in SQL, on `disputes` (unaliased) in the caller's query. */
export function settlingWinSql(): SQL {
  return sql`(${disputes.status} = 'won' AND ${disputes.outcomeAppliedAt} IS NULL)`;
}
