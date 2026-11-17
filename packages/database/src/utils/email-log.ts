/**
 * The email log's one answer to "did this email go?" (owner, 2026-11-09).
 *
 * notifications-api writes an `email_audit_logs` row `pending` before it
 * calls the provider, then sets `success` or `failed`. A send cut short (the
 * caller's 5 s abort cancelling the callee, an invocation killed at its
 * wall, a failed status write) leaves the row `pending` for good, so a
 * `pending` row may be an email that never went. It counts as sent only
 * while it may still be in flight; one left by an earlier run counts as NOT
 * sent, and the email goes again: a duplicate is harmless, a missing one
 * defeats its purpose.
 *
 * Every morning reader asks this (the agreement sweep, the fee step and the
 * price-moves step), so they can't drift. A test send never counts.
 */

import { type SQL, sql } from 'drizzle-orm';
import { emailAuditLogs } from '../schema/notifications';

/**
 * A test send's whole email-log metadata. The test-send route renders the
 * caller's data, and the sweeps read the log's metadata for their own keys
 * (`agreementId`, `feeNoticeId`, `priceMoveId`), so the log keeps only this.
 * One definition for the writer (notifications' send path) and the readers
 * (`notATestSend`).
 */
export const TEST_SEND_METADATA = { testSend: true } as const;

/**
 * The marker as a stored row holds it: the writer stores
 * `JSON.stringify(TEST_SEND_METADATA)`, `{"testSend":true}`, or that with an
 * opt-out's keys after it, so the comparison is that text without its
 * braces, found anywhere. JSON escapes every quote inside a string, so a real
 * send's values can't contain it.
 */
const TEST_SEND_MARKER = JSON.stringify(TEST_SEND_METADATA).slice(1, -1);

/** The row is not a test send's. A row with no metadata is not one. */
export function notATestSend(): SQL {
  return sql`coalesce(strpos(${emailAuditLogs.metadata}, ${TEST_SEND_MARKER}), 0) = 0`;
}

/**
 * How long a `pending` row may still be in flight: 15 minutes, the Cron
 * Trigger's wall. Every reader runs in a cron invocation, every send starts
 * inside one (no send starts after the 8-minute send budget, and each is
 * aborted at 5 s, so a whole retry chain of three tries is well inside), and
 * nothing it started outlives it. So a row made more than 15 minutes before
 * this run started belongs to an invocation that has ended: its outcome is
 * not coming. It is also well under the hour between price-moves runs, the
 * readers' most frequent, so a row left by the run before always reads as
 * not sent.
 */
export const EMAIL_IN_FLIGHT_MS = 15 * 60 * 1000;

/**
 * The row shows its email went: `success`, or `pending` and made within
 * EMAIL_IN_FLIGHT_MS before `now` (a send of this run, or of one running
 * beside it, may be on its way), and not a test send. `now` is the run's
 * own clock. `failed` (every try failed) and `skipped` (an opt-out, before
 * any send) never count.
 */
export function emailLogShowsSent(now: Date): SQL {
  const inFlightSince = new Date(now.getTime() - EMAIL_IN_FLIGHT_MS);
  return sql`((${emailAuditLogs.status} = 'success'
      OR (${emailAuditLogs.status} = 'pending' AND ${emailAuditLogs.createdAt} > ${inFlightSince}::timestamptz))
    AND ${notATestSend()})`;
}
