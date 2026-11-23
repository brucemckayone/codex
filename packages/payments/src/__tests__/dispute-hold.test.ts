/**
 * The 120-day chargeback backstop's own failure (review r8 nit): one link can
 * run two backstops (the purchase sweep's held refunds and its failed
 * refunds waiting on a chargeback), so a failed check names which one, or
 * the two failure lines read the same.
 */

import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { alertChargebacksHeldTooLong } from '../dispute-hold';

describe('alertChargebacksHeldTooLong', () => {
  it('logs a failed check at error with its check label, and does not throw', async () => {
    const error = vi.fn();
    const db = {
      select: () => {
        throw new Error('connection lost');
      },
    };

    await expect(
      alertChargebacksHeldTooLong(
        { db: db as never, obs: { error } },
        {
          link: 'purchase',
          check: 'failed_refunds_waiting',
          owed: sql`SELECT NULL::uuid`,
          asOf: new Date(),
          limit: 10,
          message: 'Held too long',
        }
      )
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      link: 'purchase',
      check: 'failed_refunds_waiting',
      error: 'connection lost',
    });
  });
});
