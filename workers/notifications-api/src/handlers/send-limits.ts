/**
 * The 08:00 wake's limits on sending (Codex-2hxff.33, .100), shared by its
 * three steps. The agreement sweep, the money sweep and the fee step run one
 * after another inside the cron's 15-minute wall, so a slow email provider in
 * one must not use up the time of the steps after it.
 */

/**
 * How long one send may take, as the price-moves step's
 * PRICE_NOTICE_TIMEOUT_MS. A send still running then ends as a send error
 * does in that step: the fee step's is `unknown` (it MAY have gone, so the
 * next run checks the email log first), the money sweep's is failed and not
 * retried, and the agreement sweep's row is tried again the next morning.
 */
export const SEND_TIMEOUT_MS = 5_000;

/**
 * No send starts after this, counted from the wake's start (a step's own
 * start when it has none), as the price-moves step's
 * PRICE_MOVES_TIME_BUDGET_MS. One budget for the three steps: whatever the
 * earlier ones spend, the later ones don't get, and the work after the fee
 * step's sends (its dates and alert) still runs inside the wall.
 */
export const SENDS_TIME_BUDGET_MS = 8 * 60 * 1000;
