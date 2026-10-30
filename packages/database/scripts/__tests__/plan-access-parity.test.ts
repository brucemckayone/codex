/**
 * The plan-access parity check (Codex-2hxff.91; design §6.3, §6.5, review M1
 * and L6).
 *
 * The DB test seeds one row of every shape inside ONE transaction that is
 * always rolled back, runs the script's own queries against it, then runs the
 * check-A fix and the queries again. The database may hold other rows, so each
 * assertion reads only this test's ids.
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  CHECK_A_FIX_STATEMENTS,
  exitCodeFor,
  looserUnderRollback,
  type ParityFindings,
  readParity,
  targetProblem,
} from '../plan-access-parity';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

const CLEAN: ParityFindings = {
  switchOffWithLegacyTier: [],
  ladderNotTicked: [],
  tickedNotLadder: [],
  closedWithNoLegacyTier: [],
};

describe('plan-access parity: exit code and target', () => {
  it('fails on check A alone; check C fails only before a rollback', () => {
    expect(exitCodeFor(CLEAN, { preRollback: true })).toBe(0);
    expect(
      exitCodeFor(
        { ...CLEAN, switchOffWithLegacyTier: ['a'] },
        { preRollback: false }
      )
    ).toBe(1);
    const looser = { ...CLEAN, ladderNotTicked: ['b'] };
    expect(exitCodeFor(looser, { preRollback: false })).toBe(0);
    expect(exitCodeFor(looser, { preRollback: true })).toBe(1);
    // A narrowed row is stricter under the old code: never a rollback blocker.
    expect(
      exitCodeFor({ ...CLEAN, tickedNotLadder: ['c'] }, { preRollback: true })
    ).toBe(0);
  });

  it('C is the closed rows plus the ladder-wider rows, once each', () => {
    expect(
      looserUnderRollback({
        ...CLEAN,
        ladderNotTicked: ['y', 'x'],
        closedWithNoLegacyTier: ['x', 'z'],
      })
    ).toEqual(['x', 'y', 'z']);
  });

  it('refuses an unnamed or contradictory target', () => {
    expect(targetProblem({})).toMatch(/DB_METHOD is not set/);
    expect(targetProblem({ DB_METHOD: 'PRODUCTION' })).toMatch(
      /requires DATABASE_URL/
    );
    expect(
      targetProblem({ DB_METHOD: 'PRODUCTION', DATABASE_URL: 'postgres://p' })
    ).toBeNull();
    expect(
      targetProblem({
        DB_METHOD: 'LOCAL_PROXY',
        DATABASE_URL: 'postgres://prod',
        DATABASE_URL_LOCAL_PROXY: 'postgres://local',
      })
    ).toMatch(/CONTRADICTION/);
    expect(
      targetProblem({
        DB_METHOD: 'LOCAL_PROXY',
        DATABASE_URL: 'postgres://local',
        DATABASE_URL_LOCAL_PROXY: 'postgres://local',
      })
    ).toBeNull();
  });
});

describe('plan-access parity: the queries', () => {
  it.skipIf(!HAS_DB)(
    'finds every shape, and the check-A fix closes the window without widening a bundle',
    async () => {
      const { dbWs } = await import('../../src');
      const {
        content,
        contentTierAccess,
        organizations,
        subscriptionTiers,
        users,
      } = await import('../../src/schema');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let observed: unknown;

      await dbWs
        .transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              id: `pa-parity-${suffix}`,
              name: 'Parity',
              email: `pa-parity-${suffix}@example.test`,
            })
            .returning({ id: users.id });
          const [org] = await tx
            .insert(organizations)
            .values({ name: 'Parity', slug: `pa-parity-${suffix}` })
            .returning({ id: organizations.id });
          if (!user || !org) throw new Error('fixtures not inserted');

          const tier = async (sortOrder: number, deletedAt?: Date) => {
            const [row] = await tx
              .insert(subscriptionTiers)
              .values({
                organizationId: org.id,
                name: `T${sortOrder}`,
                sortOrder,
                priceMonthly: 500 * sortOrder,
                priceAnnual: 5000 * sortOrder,
                ...(deletedAt ? { deletedAt, isActive: false } : {}),
              })
              .returning({ id: subscriptionTiers.id });
            if (!row) throw new Error('tier not inserted');
            return row.id;
          };
          const t1 = await tier(1);
          const t2 = await tier(2);
          const t3Deleted = await tier(3, new Date());
          const t4 = await tier(4);

          const item = async (
            key: string,
            shape: {
              gated: boolean;
              legacy: string | null;
              ticks?: string[];
              orgless?: boolean;
              priceCents?: number;
              deleted?: boolean;
            }
          ) => {
            const [row] = await tx
              .insert(content)
              .values({
                creatorId: user.id,
                organizationId: shape.orgless ? null : org.id,
                title: key,
                slug: `pa-parity-${key}-${suffix}`,
                contentType: 'written',
                isFree: !shape.gated && shape.legacy === null,
                isTierGated: shape.gated,
                legacyIncludedInTierId: shape.legacy,
                isPurchasable: (shape.priceCents ?? 0) > 0,
                priceCents: shape.priceCents ?? null,
                deletedAt: shape.deleted ? new Date() : null,
              })
              .returning({ id: content.id });
            if (!row) throw new Error('content not inserted');
            if (shape.ticks?.length) {
              await tx.insert(contentTierAccess).values(
                shape.ticks.map((tierId) => ({
                  contentId: row.id,
                  tierId,
                  organizationId: org.id,
                }))
              );
            }
            return row.id;
          };

          const ids = {
            // The old studio's "Subscribers, T2 and above" after 0120 ran.
            windowSave: await item('window-save', {
              gated: false,
              legacy: t2,
            }),
            // Check A counts soft-deleted rows too, as 0120 step 5 does.
            windowSaveDeleted: await item('window-save-deleted', {
              gated: false,
              legacy: t2,
              deleted: true,
            }),
            ladder: await item('ladder', {
              gated: true,
              legacy: t1,
              ticks: [t1, t2, t4],
            }),
            bundle: await item('bundle', {
              gated: true,
              legacy: t1,
              ticks: [t1, t4],
            }),
            // A tier delete with "keep": the legacy value is the deleted tier.
            keep: await item('keep', { gated: true, legacy: t3Deleted }),
            // An old-studio edit in the window, T1-and-above → T2-and-above.
            narrowed: await item('narrowed', {
              gated: true,
              legacy: t2,
              ticks: [t1, t2, t4],
            }),
            closed: await item('closed', { gated: true, legacy: null }),
            closedOrgless: await item('closed-orgless', {
              gated: true,
              legacy: null,
              orgless: true,
            }),
            closedPriced: await item('closed-priced', {
              gated: true,
              legacy: null,
              priceCents: 500,
            }),
            closedDeleted: await item('closed-deleted', {
              gated: true,
              legacy: null,
              deleted: true,
            }),
            ungated: await item('ungated', { gated: false, legacy: null }),
          };
          const ours = new Set(Object.values(ids));
          const mine = (found: ParityFindings) => ({
            switchOffWithLegacyTier: found.switchOffWithLegacyTier.filter(
              (id) => ours.has(id)
            ),
            ladderNotTicked: found.ladderNotTicked.filter((id) => ours.has(id)),
            tickedNotLadder: found.tickedNotLadder.filter((id) => ours.has(id)),
            closedWithNoLegacyTier: found.closedWithNoLegacyTier.filter((id) =>
              ours.has(id)
            ),
          });
          const sorted = (list: string[]) => [...list].sort();
          const ticksOf = async (contentId: string) =>
            (
              await tx
                .select({ tierId: contentTierAccess.tierId })
                .from(contentTierAccess)
                .innerJoin(
                  subscriptionTiers,
                  eq(subscriptionTiers.id, contentTierAccess.tierId)
                )
                .where(eq(contentTierAccess.contentId, contentId))
                .orderBy(asc(subscriptionTiers.sortOrder))
            ).map((r) => r.tierId);

          const before = mine(await readParity(tx));

          for (const statement of CHECK_A_FIX_STATEMENTS)
            await tx.execute(statement);
          const afterFix = mine(await readParity(tx));
          const fixedFlags = await tx
            .select({ id: content.id, isTierGated: content.isTierGated })
            .from(content)
            .where(
              inArray(content.id, [ids.windowSave, ids.windowSaveDeleted])
            );
          const fixedTicks = {
            windowSave: await ticksOf(ids.windowSave),
            bundle: await ticksOf(ids.bundle),
          };
          for (const statement of CHECK_A_FIX_STATEMENTS)
            await tx.execute(statement);
          const afterSecondFix = mine(await readParity(tx));

          observed = {
            before,
            afterFix,
            afterSecondFix,
            fixedFlags: fixedFlags.every((f) => f.isTierGated),
            fixedTicks,
            expected: {
              before: {
                switchOffWithLegacyTier: sorted([
                  ids.windowSave,
                  ids.windowSaveDeleted,
                ]),
                ladderNotTicked: sorted([ids.bundle, ids.keep]),
                tickedNotLadder: [ids.narrowed],
                closedWithNoLegacyTier: sorted([ids.closed, ids.closedOrgless]),
              },
              afterFix: {
                switchOffWithLegacyTier: [],
                ladderNotTicked: sorted([ids.bundle, ids.keep]),
                tickedNotLadder: [ids.narrowed],
                closedWithNoLegacyTier: sorted([ids.closed, ids.closedOrgless]),
              },
              // The window row gets its ladder; the bundle keeps its gap.
              fixedTicks: { windowSave: [t2, t4], bundle: [t1, t4] },
            },
          };
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });

      const result = observed as {
        before: ParityFindings;
        afterFix: ParityFindings;
        afterSecondFix: ParityFindings;
        fixedFlags: boolean;
        fixedTicks: unknown;
        expected: {
          before: ParityFindings;
          afterFix: ParityFindings;
          fixedTicks: unknown;
        };
      };
      const sortAll = (f: ParityFindings) => ({
        switchOffWithLegacyTier: [...f.switchOffWithLegacyTier].sort(),
        ladderNotTicked: [...f.ladderNotTicked].sort(),
        tickedNotLadder: [...f.tickedNotLadder].sort(),
        closedWithNoLegacyTier: [...f.closedWithNoLegacyTier].sort(),
      });
      expect(sortAll(result.before)).toEqual(result.expected.before);
      expect(sortAll(result.afterFix)).toEqual(result.expected.afterFix);
      expect(result.fixedFlags).toBe(true);
      expect(result.fixedTicks).toEqual(result.expected.fixedTicks);
      expect(result.afterSecondFix).toEqual(result.afterFix);
    }
  );
});
