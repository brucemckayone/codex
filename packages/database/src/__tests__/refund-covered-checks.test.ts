/**
 * Migration 0132's CHECKs on `refunds` (Codex-z1t3c review r8; owner D73).
 * A failed refund a later refund of everything owed paid is settled
 * `covered_by_refund` by the platform, naming that refund in
 * `covered_by_refund_id`. The code writes both together
 * (`coverFailedRefunds` in @codex/purchase), so without this pin a schema
 * edit that dropped or loosened either CHECK, then regenerated, would pass
 * every suite.
 *
 * Pins, on real rows inside ONE transaction that is always rolled back, each
 * refusal in its own savepoint:
 *   - an open failed refund, one settled by support, and one covered are
 *     accepted;
 *   - `covered_by_refund` only on a failed refund, and no resolution but the
 *     three (`check_refunds_resolution`, widened);
 *   - a coverer exactly when the resolution is `covered_by_refund`: none
 *     missing, none on another resolution, none on an open row
 *     (`check_refunds_covered_by`).
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/** The refused statement's SQLSTATE and constraint; drizzle wraps it in `cause`. */
function refusal(error: unknown): { code?: string; constraint?: string } {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  return {
    code: e.code ?? e.cause?.code,
    constraint: e.constraint ?? e.cause?.constraint,
  };
}

class Rollback extends Error {}

describe.skipIf(!HAS_DB)('0132 covered refunds: the refunds CHECKs', () => {
  it('accepts an open, a settled and a covered failed refund, and refuses each row its CHECKs forbid', async () => {
    const { dbWs } = await import('../index');
    const { refunds } = await import('../schema');
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id = (name: string) => `re_checks_${name}_${tag}`;
    const at = new Date(Date.UTC(2026, 10, 18, 12));
    const row = (name: string) => ({
      stripeRefundId: id(name),
      stripeChargeId: `ch_checks_${tag}`,
      amountCents: 500,
      currency: 'gbp',
      status: 'failed',
      stripeCreatedAt: at,
    });
    const insert = (
      name: string,
      status: string,
      resolution: string | null,
      coveredBy: string | null
    ) =>
      sql`INSERT INTO refunds (stripe_refund_id, stripe_charge_id, amount_cents, currency, status, stripe_created_at, resolution, resolved_at, covered_by_refund_id)
          VALUES (${id(name)}, ${`ch_checks_${tag}`}, 500, 'gbp', ${status}, ${at}, ${resolution}, ${resolution === null ? null : at}, ${coveredBy})`;

    const accepted: string[] = [];
    const refused: Record<string, { code?: string; constraint?: string }> = {};
    try {
      await dbWs.transaction(async (tx) => {
        await tx.insert(refunds).values([
          row('open'),
          {
            ...row('settled'),
            resolution: 'refunded_elsewhere',
            resolvedAt: at,
          },
          {
            ...row('covered'),
            resolution: 'covered_by_refund',
            resolvedAt: at,
            coveredByRefundId: id('coverer'),
          },
        ]);
        const kept = await tx
          .select({ id: refunds.stripeRefundId })
          .from(refunds)
          .where(
            inArray(refunds.stripeRefundId, [
              id('open'),
              id('settled'),
              id('covered'),
            ])
          );
        accepted.push(...kept.map((k) => k.id));

        const refuse = async (
          name: string,
          statement: ReturnType<typeof sql>
        ) => {
          try {
            await tx.transaction(async (savepoint) => {
              await savepoint.execute(statement);
            });
          } catch (error) {
            refused[name] = refusal(error);
          }
        };
        await refuse(
          'covered with no coverer',
          insert('a', 'failed', 'covered_by_refund', null)
        );
        await refuse(
          'a coverer on a refund settled elsewhere',
          insert('b', 'failed', 'refunded_elsewhere', id('coverer'))
        );
        await refuse(
          'a coverer on an open refund',
          insert('c', 'failed', null, id('coverer'))
        );
        await refuse(
          'covered on a refund that succeeded',
          insert('d', 'succeeded', 'covered_by_refund', id('coverer'))
        );
        await refuse(
          'a resolution of none of the three',
          insert('e', 'failed', 'paid_twice', null)
        );
        await refuse(
          'a covered refund moved to another resolution, keeping its coverer',
          sql`UPDATE refunds SET resolution = 'creators_repaid' WHERE stripe_refund_id = ${id('covered')}`
        );
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect(accepted).toHaveLength(3);
    const byCovered = { code: '23514', constraint: 'check_refunds_covered_by' };
    const byResolution = {
      code: '23514',
      constraint: 'check_refunds_resolution',
    };
    expect(refused).toEqual({
      'covered with no coverer': byCovered,
      'a coverer on a refund settled elsewhere': byCovered,
      'a coverer on an open refund': byCovered,
      'covered on a refund that succeeded': byResolution,
      'a resolution of none of the three': byResolution,
      'a covered refund moved to another resolution, keeping its coverer':
        byCovered,
    });
  });
});
