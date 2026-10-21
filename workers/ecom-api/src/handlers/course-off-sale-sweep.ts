/**
 * Hourly: cancel, at period end, the course subscriptions a creator's removal
 * did not reach (Codex-2hxff.64; owner: "50 at once, rest hourly").
 *
 * A removal cancels up to 50 straight away. A creator with more subscribers,
 * or a Stripe call that failed, leaves rows here: live subscriptions to a
 * course with `off_sale_at` set and not yet cancelling. This runs inside the
 * payouts sweep's hourly wake, so it adds no cron trigger and no extra
 * database wake time.
 *
 * Never throws: a failure is logged and the next hour retries.
 */

import type { WebhookServices } from '@codex/worker-utils';

/** Per hourly run; anything left waits for the next hour. */
export const COURSE_OFF_SALE_SWEEP_LIMIT = 200;

interface SweepLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export async function runCourseOffSaleSweep(
  services: Pick<WebhookServices['services'], 'courseSubscription'>,
  obs: SweepLogger
): Promise<void> {
  try {
    const result = await services.courseSubscription.cancelForCoursesOffSale({
      limit: COURSE_OFF_SALE_SWEEP_LIMIT,
    });
    if (result.cancelled > 0 || result.failed > 0 || result.remaining > 0) {
      obs.info('course off-sale sweep ran', result);
    }
  } catch (error) {
    obs.error('course off-sale sweep failed', {
      errorId: crypto.randomUUID(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
