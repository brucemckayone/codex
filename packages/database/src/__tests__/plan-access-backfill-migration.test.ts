/**
 * Migration 0120's backfill (Codex-2hxff.91, design §6.2).
 *
 * The migration turns the old single tier (`content.included_in_tier_id`, "this
 * tier and every tier above it") into the tier switch plus explicit ticks, and
 * must reproduce what the access decision serves TODAY:
 *   - the switch goes on for EVERY row with a tier, orgless rows included (they
 *     are denied today; with the switch on and no tick they stay denied, never
 *     the free fallthrough);
 *   - the ticks are every LIVE tier of the CONTENT's org at or above the gating
 *     tier's sort order, inactive tiers included;
 *   - course ticks on soft-deleted tiers are swept once.
 *
 * The test database already has 0120's DDL, so this runs the migration's own
 * backfill statements against pre-migration-shaped rows inside ONE transaction
 * that is always rolled back: the shared database is left as it was. A second
 * run changes nothing (the statements are idempotent).
 *
 * Real DB. Skips when DB_METHOD is not configured (fee-config-schema.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.resolve(here, '../migrations/0120_plan_access_ticks.sql'),
  'utf8'
);

/** 0120's data statements, as the migrator runs them: one per breakpoint. */
const STATEMENTS = MIGRATION.split('--> statement-breakpoint').map((s) =>
  s.trim()
);
const BACKFILL = STATEMENTS.filter(
  (s) =>
    s.includes('UPDATE "content" SET "is_tier_gated"') ||
    s.includes('INSERT INTO "content_tier_access"') ||
    s.includes('DELETE FROM "course_tier_access"')
);

/** Thrown to roll the fixture transaction back once the rows are read. */
class Rollback extends Error {}

describe('0120 plan-access backfill', () => {
  it('has exactly the three data statements, in order', () => {
    expect(BACKFILL).toHaveLength(3);
    expect(BACKFILL[0]).toContain(
      'UPDATE "content" SET "is_tier_gated" = true'
    );
    expect(BACKFILL[1]).toContain('INSERT INTO "content_tier_access"');
    expect(BACKFILL[2]).toContain('DELETE FROM "course_tier_access"');
    // migrate-direct.ts attaches no notice listener (Codex-2hxff.84).
    expect(MIGRATION).not.toMatch(/RAISE\s+NOTICE/i);
  });

  it.skipIf(!HAS_DB)(
    'reproduces the old ladder as ticks, keeps orgless rows gated, sweeps dead course ticks, and is idempotent',
    async () => {
      const { dbWs } = await import('../index');
      const {
        content,
        contentTierAccess,
        courseTierAccess,
        courses,
        organizations,
        subscriptionTiers,
        users,
      } = await import('../schema');
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let observed: unknown;

      await dbWs
        .transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              id: `pa-backfill-${suffix}`,
              name: 'Backfill',
              email: `pa-backfill-${suffix}@example.test`,
            })
            .returning({ id: users.id });
          const orgRows = await tx
            .insert(organizations)
            .values([
              { name: 'Backfill A', slug: `pa-backfill-a-${suffix}` },
              { name: 'Backfill B', slug: `pa-backfill-b-${suffix}` },
            ])
            .returning({ id: organizations.id });
          const [orgA, orgB] = orgRows;
          if (!user || !orgA || !orgB) throw new Error('fixtures not inserted');

          const tier = async (
            organizationId: string,
            sortOrder: number,
            extra: { deletedAt?: Date; isActive?: boolean } = {}
          ) => {
            const [row] = await tx
              .insert(subscriptionTiers)
              .values({
                organizationId,
                name: `T${sortOrder}`,
                sortOrder,
                priceMonthly: 500 * sortOrder,
                priceAnnual: 5000 * sortOrder,
                ...extra,
              })
              .returning({ id: subscriptionTiers.id });
            if (!row) throw new Error('tier not inserted');
            return row.id;
          };
          const a1 = await tier(orgA.id, 1);
          const a2 = await tier(orgA.id, 2);
          const a3Deleted = await tier(orgA.id, 3, { deletedAt: new Date() });
          const a4Inactive = await tier(orgA.id, 4, { isActive: false });
          const b1 = await tier(orgB.id, 1);

          // Pre-migration rows: the legacy column only, switch off, no ticks.
          const item = async (
            key: string,
            organizationId: string | null,
            legacy: string | null
          ) => {
            const [row] = await tx
              .insert(content)
              .values({
                creatorId: user.id,
                organizationId,
                title: key,
                slug: `pa-backfill-${key}-${suffix}`,
                contentType: 'written',
                isFree: legacy === null,
                isTierGated: false,
                legacyIncludedInTierId: legacy,
              })
              .returning({ id: content.id });
            if (!row) throw new Error('content not inserted');
            return row.id;
          };
          const fromA2 = await item('from-a2', orgA.id, a2);
          const fromA1 = await item('from-a1', orgA.id, a1);
          const orgless = await item('orgless', null, a1);
          const crossOrg = await item('cross-org', orgA.id, b1);
          const fromDeleted = await item('from-deleted', orgA.id, a3Deleted);
          const ungated = await item('ungated', orgA.id, null);

          const [course] = await tx
            .insert(courses)
            .values({
              organizationId: orgA.id,
              creatorId: user.id,
              slug: `pa-backfill-course-${suffix}`,
              title: 'Course',
            })
            .returning({ id: courses.id });
          if (!course) throw new Error('course not inserted');
          await tx.insert(courseTierAccess).values([
            { courseId: course.id, tierId: a1, organizationId: orgA.id },
            { courseId: course.id, tierId: a3Deleted, organizationId: orgA.id },
          ]);

          const ids = [fromA2, fromA1, orgless, crossOrg, fromDeleted, ungated];
          const read = async () => {
            const flags = await tx
              .select({ id: content.id, isTierGated: content.isTierGated })
              .from(content)
              .where(inArray(content.id, ids));
            const ticks = await tx
              .select({
                contentId: contentTierAccess.contentId,
                tierId: contentTierAccess.tierId,
              })
              .from(contentTierAccess)
              .innerJoin(
                subscriptionTiers,
                eq(subscriptionTiers.id, contentTierAccess.tierId)
              )
              .where(inArray(contentTierAccess.contentId, ids))
              .orderBy(asc(subscriptionTiers.sortOrder));
            const courseTicks = await tx
              .select({ tierId: courseTierAccess.tierId })
              .from(courseTierAccess)
              .where(eq(courseTierAccess.courseId, course.id));
            const tickSet = (id: string) =>
              ticks.filter((t) => t.contentId === id).map((t) => t.tierId);
            return {
              gated: Object.fromEntries(
                flags.map((f) => [f.id, f.isTierGated])
              ),
              ticks: Object.fromEntries(ids.map((id) => [id, tickSet(id)])),
              courseTicks: courseTicks.map((t) => t.tierId),
            };
          };

          for (const statement of BACKFILL)
            await tx.execute(sql.raw(statement));
          const first = await read();
          for (const statement of BACKFILL)
            await tx.execute(sql.raw(statement));
          const second = await read();

          observed = {
            first,
            second,
            expected: {
              gated: {
                [fromA2]: true,
                [fromA1]: true,
                [orgless]: true,
                [crossOrg]: true,
                [fromDeleted]: true,
                [ungated]: false,
              },
              ticks: {
                // At or above the gating tier; the deleted A3 is not a live
                // tier, the inactive A4 still is.
                [fromA2]: [a2, a4Inactive],
                [fromA1]: [a1, a2, a4Inactive],
                [orgless]: [],
                // The CONTENT's org's tiers at or above B1's sort order.
                [crossOrg]: [a1, a2, a4Inactive],
                // The decision never filtered the gating tier on deleted_at.
                [fromDeleted]: [a4Inactive],
                [ungated]: [],
              },
              courseTicks: [a1],
            },
          };
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });

      const { first, second, expected } = observed as {
        first: unknown;
        second: unknown;
        expected: unknown;
      };
      expect(first).toEqual(expected);
      expect(second).toEqual(first);
    }
  );
});
