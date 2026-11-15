/**
 * Migration 0126's three CHECKs on `disputes` (Codex-2hxff.70; late-win data
 * design §3; docs/payments/dispute-record.md §10), and 0129's fourth
 * (Codex-h301h). They are the database's backstop for the late win: the code
 * refuses each of these moves first (the rank map, `recordLateWin`,
 * `claimLateWinBuyerEmail`), so without this a schema edit that dropped or
 * loosened one, then regenerated, would pass every suite (review MG3).
 *
 * Pins, on real rows inside ONE transaction that is always rolled back, each
 * refusal in its own savepoint:
 *   - every §10 state, and release step R18's hand-settled row, is accepted;
 *   - a late win on a row that isn't won (`check_disputes_late_won_status`),
 *     also as an UPDATE back to `lost`;
 *   - a late-win refund with no late win (`check_disputes_late_win_refund`);
 *   - a loss date kept with no late win (`check_disputes_lost_applied`);
 *   - a told buyer with no late win (`check_disputes_buyer_told`).
 *
 * And 0130's appeal CHECK (Codex-wzaoh; owner D34): `appeal_status` is NULL
 * or one of `DISPUTE_APPEAL_STATUSES` (`check_disputes_appeal_status`). That
 * a mark lives only on a lost row is held in code, NOT here: a CHECK binds
 * an older worker after a rollback too, and its late win, which doesn't
 * clear the mark, must still be recorded.
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

describe.skipIf(!HAS_DB)('0126 late win: the disputes CHECKs', () => {
  it('accepts every late-win state and refuses each move its CHECKs forbid', async () => {
    const { dbWs } = await import('../index');
    const { disputes } = await import('../schema');
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id = (name: string) => `du_checks_${name}_${tag}`;
    const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
    const row = (name: string) => ({
      stripeDisputeId: id(name),
      stripeChargeId: `ch_checks_${name}_${tag}`,
      amountCents: 1000,
      currency: 'gbp',
      stripeCreatedAt: day(1),
    });

    const accepted: string[] = [];
    const refused: Record<string, { code?: string; constraint?: string }> = {};
    try {
      await dbWs.transaction(async (tx) => {
        // §10's four states, and R18's (applied before its late win).
        await tx.insert(disputes).values([
          { ...row('lost_being_applied'), status: 'lost' },
          {
            ...row('lost_applied'),
            status: 'lost',
            outcomeAppliedAt: day(10),
          },
          {
            ...row('won_late_being_undone'),
            status: 'won',
            lateWonAt: day(20),
            lostAppliedAt: day(10),
          },
          {
            ...row('won_late_undone'),
            status: 'won',
            outcomeAppliedAt: day(21),
            lateWonAt: day(20),
            lostAppliedAt: day(10),
            lateWinRefundId: `re_checks_${tag}`,
            buyerToldAt: day(21),
          },
          {
            ...row('r18'),
            status: 'won',
            outcomeAppliedAt: day(10),
            lateWonAt: day(20),
            lostAppliedAt: day(10),
          },
        ]);
        const kept = await tx
          .select({ id: disputes.stripeDisputeId })
          .from(disputes)
          .where(
            inArray(disputes.stripeDisputeId, [
              id('lost_being_applied'),
              id('lost_applied'),
              id('won_late_being_undone'),
              id('won_late_undone'),
              id('r18'),
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
          'late win on a lost row',
          sql`INSERT INTO disputes (stripe_dispute_id, stripe_charge_id, amount_cents, currency, stripe_created_at, status, late_won_at)
              VALUES (${id('a')}, 'ch_a', 1000, 'gbp', ${day(1)}, 'lost', ${day(20)})`
        );
        await refuse(
          'late-win refund with no late win',
          sql`INSERT INTO disputes (stripe_dispute_id, stripe_charge_id, amount_cents, currency, stripe_created_at, status, late_win_refund_id)
              VALUES (${id('b')}, 'ch_b', 1000, 'gbp', ${day(1)}, 'won', 're_b')`
        );
        await refuse(
          'loss date with no late win',
          sql`INSERT INTO disputes (stripe_dispute_id, stripe_charge_id, amount_cents, currency, stripe_created_at, status, lost_applied_at)
              VALUES (${id('c')}, 'ch_c', 1000, 'gbp', ${day(1)}, 'lost', ${day(10)})`
        );
        // `won`, so this breaks only the told-buyer CHECK.
        await refuse(
          'a told buyer with no late win',
          sql`INSERT INTO disputes (stripe_dispute_id, stripe_charge_id, amount_cents, currency, stripe_created_at, status, buyer_told_at)
              VALUES (${id('d')}, 'ch_d', 1000, 'gbp', ${day(1)}, 'won', ${day(21)})`
        );
        await refuse(
          'a late win moved back to lost',
          sql`UPDATE disputes SET status = 'lost' WHERE stripe_dispute_id = ${id('won_late_undone')}`
        );
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect(accepted).toHaveLength(5);
    expect(refused).toEqual({
      'late win on a lost row': {
        code: '23514',
        constraint: 'check_disputes_late_won_status',
      },
      'late-win refund with no late win': {
        code: '23514',
        constraint: 'check_disputes_late_win_refund',
      },
      'loss date with no late win': {
        code: '23514',
        constraint: 'check_disputes_lost_applied',
      },
      'a told buyer with no late win': {
        code: '23514',
        constraint: 'check_disputes_buyer_told',
      },
      'a late win moved back to lost': {
        code: '23514',
        constraint: 'check_disputes_late_won_status',
      },
    });
  });
});

describe.skipIf(!HAS_DB)('0130 dispute appeals: the disputes CHECK', () => {
  it('accepts no appeal and each appeal stage, and an older worker’s late win that keeps the mark; refuses any other value', async () => {
    const { dbWs } = await import('../index');
    const { DISPUTE_APPEAL_STATUSES } = await import('@codex/constants');
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id = (name: string) => `du_appeal_${name}_${tag}`;
    const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
    const insert = (name: string, appeal: string | null) =>
      sql`INSERT INTO disputes (stripe_dispute_id, stripe_charge_id, amount_cents, currency, stripe_created_at, status, appeal_status)
          VALUES (${id(name)}, ${`ch_appeal_${name}_${tag}`}, 1000, 'gbp', ${day(1)}, 'lost', ${appeal})`;

    const accepted: string[] = [];
    const refused: Record<string, { code?: string; constraint?: string }> = {};
    try {
      await dbWs.transaction(async (tx) => {
        for (const appeal of [null, ...DISPUTE_APPEAL_STATUSES]) {
          await tx.execute(insert(appeal ?? 'none', appeal));
          accepted.push(appeal ?? 'none');
        }
        // 0126–0129's recordLateWin, which predates the mark: lost → won,
        // the mark left in place. The newer code clears it on the hourly
        // reconcile's first step. It must have written the row: a WHERE
        // that matched nothing would prove nothing.
        const lateWin = await tx.execute(
          sql`UPDATE disputes SET status = 'won', late_won_at = ${day(20)}, lost_applied_at = outcome_applied_at, outcome_applied_at = NULL
              WHERE stripe_dispute_id = ${id('appeal_under_review')} AND status = 'lost'
              RETURNING stripe_dispute_id, status, appeal_status`
        );
        expect(lateWin.rows).toEqual([
          {
            stripe_dispute_id: id('appeal_under_review'),
            status: 'won',
            appeal_status: 'appeal_under_review',
          },
        ]);
        accepted.push('an older late win keeping the mark');

        for (const appeal of ['lost', 'under_review', 'appeal_won']) {
          try {
            await tx.transaction(async (savepoint) => {
              await savepoint.execute(insert(appeal, appeal));
            });
          } catch (error) {
            refused[appeal] = refusal(error);
          }
        }
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect(accepted).toEqual([
      'none',
      'appeal_needs_response',
      'appeal_under_review',
      'an older late win keeping the mark',
    ]);
    const check = { code: '23514', constraint: 'check_disputes_appeal_status' };
    expect(refused).toEqual({
      lost: check,
      under_review: check,
      appeal_won: check,
    });
  });
});
