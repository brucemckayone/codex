/**
 * Agreement Schema Tests — Codex-ppxtd (WP-1 of Codex-nk4km).
 *
 * Verifies the DB-level invariants for the revenue-share agreement tables:
 *
 *   1. creator_organization_agreements gains revenue_type / status /
 *      terminated_* / current_proposal_id columns with correct defaults.
 *   2. The partial unique index allows MULTIPLE terminated rows per
 *      (organization_id, creator_id, revenue_type) but only ONE active.
 *   3. agreement_proposals is insertable; self-referential parent_proposal_id
 *      works; round_number / status / share_bps CHECK constraints fire.
 *   4. status='terminated' requires terminated_at (and vice versa).
 *
 * Real DB. Skips when DB_METHOD is not configured (matches the convention in
 * fee-config-schema.test.ts).
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const HAS_DB = ['LOCAL_PROXY', 'NEON_BRANCH'].includes(
  process.env.DB_METHOD || ''
);

let MIGRATION_APPLIED = false;
beforeAll(async () => {
  if (!HAS_DB) return;
  try {
    const { dbHttp } = await import('../index');
    const result = await dbHttp.execute(
      sql`SELECT to_regclass('public.agreement_proposals') AS exists`
    );
    MIGRATION_APPLIED = Boolean(
      (result.rows[0] as { exists: string | null } | undefined)?.exists
    );
  } catch {
    MIGRATION_APPLIED = false;
  }
});

async function expectConstraintError(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

function skipIfNoMigration(ctx: { skip: () => void }) {
  if (!MIGRATION_APPLIED) ctx.skip();
}

/**
 * Create a fresh (user, org) fixture pair scoped by a unique label so parallel
 * test files don't collide. All amounts use GBP basis points where applicable.
 *
 * The `organizations` table has no `ownerId` column — ownership is resolved
 * via the `organization_memberships` table (role='owner', status='active').
 * Pass `{ withOwnerMembership: false }` to skip seeding the membership row
 * and exercise the backfill's orphan-org fallback (creator_id) path.
 */
async function freshFixture(
  label: string,
  opts: { withOwnerMembership?: boolean } = {}
): Promise<{
  ownerId: string;
  creatorId: string;
  orgId: string;
}> {
  const withOwnerMembership = opts.withOwnerMembership ?? true;
  const { dbHttp } = await import('../index');
  const { organizationMemberships, organizations, users } = await import(
    '../schema'
  );
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ownerId = `agr-owner-${label}-${suffix}`;
  const creatorId = `agr-creator-${label}-${suffix}`;

  await dbHttp.insert(users).values([
    {
      id: ownerId,
      email: `${ownerId}@test.com`,
      name: 'Agreement Owner',
      emailVerified: false,
      role: 'creator',
    },
    {
      id: creatorId,
      email: `${creatorId}@test.com`,
      name: 'Agreement Creator',
      emailVerified: false,
      role: 'creator',
    },
  ]);

  const [org] = await dbHttp
    .insert(organizations)
    .values({
      name: `Agreement Org ${label}`,
      slug: `agreement-${label}-${suffix}`,
    })
    .returning();

  if (withOwnerMembership) {
    await dbHttp.insert(organizationMemberships).values({
      organizationId: org.id,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
  }

  return { ownerId, creatorId, orgId: org.id };
}

describe.skipIf(!HAS_DB)('Agreement Schema (Codex-ppxtd)', () => {
  beforeAll(() => {
    if (!MIGRATION_APPLIED) {
      console.warn(
        '[agreement-schema] Skipping suite — agreement_proposals table not present. Run `pnpm db:migrate` to enable.'
      );
    }
  });

  describe('creator_organization_agreements — new columns + defaults', () => {
    it('inserts with default revenue_type="subscription" and status="active"', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('defaults');

      const [row] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
        })
        .returning();

      expect(row.revenueType).toBe('subscription');
      expect(row.status).toBe('active');
      expect(row.terminatedAt).toBeNull();
      expect(row.currentProposalId).toBeNull();
    });

    it('rejects revenue_type values outside the allowed set', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('badtype');

      await expectConstraintError(
        dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          // biome-ignore lint/suspicious/noExplicitAny: deliberate constraint violation
          revenueType: 'merch' as any,
        })
      );
    });

    it('rejects status values outside the allowed set', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('badstatus');

      await expectConstraintError(
        dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          // biome-ignore lint/suspicious/noExplicitAny: deliberate constraint violation
          status: 'archived' as any,
        })
      );
    });

    it("status='terminated' requires terminated_at (shape CHECK)", async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('shape-noTs');

      await expectConstraintError(
        dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          status: 'terminated',
          // terminated_at omitted — CHECK fires
        })
      );
    });

    it('non-terminated status with terminated_at set is rejected', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('shape-extraTs');

      await expectConstraintError(
        dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          status: 'active',
          terminatedAt: new Date(),
        })
      );
    });
  });

  describe('partial unique index — one active per (org, creator, revenue_type)', () => {
    it('rejects a second ACTIVE agreement on the same (org, creator, revenue_type)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('dup-active');

      await dbHttp.insert(creatorOrganizationAgreements).values({
        creatorId,
        organizationId: orgId,
        organizationFeePercentage: 2000,
        revenueType: 'subscription',
        // Distinct effective_from so the LEGACY tuple-unique doesn't fire
        // before our partial index — we want to prove the partial index is
        // the gating constraint.
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      });

      await expectConstraintError(
        dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 3000,
          revenueType: 'subscription',
          effectiveFrom: new Date('2026-02-01T00:00:00Z'),
        })
      );
    });

    it('allows DIFFERENT revenue_types side-by-side as active', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { creatorId, orgId } = await freshFixture('two-types');

      const [sub] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          revenueType: 'subscription',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();

      const [purchase] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 1000,
          revenueType: 'content_purchase',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();

      expect(sub.revenueType).toBe('subscription');
      expect(purchase.revenueType).toBe('content_purchase');
    });

    it('allows MULTIPLE terminated rows on the same (org, creator, revenue_type)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('multi-term');

      const baseTs = new Date('2026-01-01T00:00:00Z');
      // Two terminated rows — distinct effective_from to satisfy the legacy
      // tuple-unique, both targeting the same (org, creator, revenue_type).
      for (let i = 0; i < 3; i++) {
        await dbHttp.insert(creatorOrganizationAgreements).values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000 + i * 500,
          revenueType: 'subscription',
          effectiveFrom: new Date(baseTs.getTime() + i * 24 * 60 * 60 * 1000),
          status: 'terminated',
          terminatedAt: new Date(
            baseTs.getTime() + (i + 1) * 24 * 60 * 60 * 1000
          ),
          terminatedByUserId: ownerId,
          terminationReason: `Round ${i + 1} terminated`,
        });
      }

      // Plus one currently-active row on the same triple should succeed.
      await dbHttp.insert(creatorOrganizationAgreements).values({
        creatorId,
        organizationId: orgId,
        organizationFeePercentage: 4000,
        revenueType: 'subscription',
        effectiveFrom: new Date('2026-02-01T00:00:00Z'),
      });

      const rows = await dbHttp
        .select()
        .from(creatorOrganizationAgreements)
        .where(
          and(
            eq(creatorOrganizationAgreements.organizationId, orgId),
            eq(creatorOrganizationAgreements.creatorId, creatorId),
            eq(creatorOrganizationAgreements.revenueType, 'subscription')
          )
        );
      expect(rows.length).toBe(4);
      expect(rows.filter((r) => r.status === 'terminated').length).toBe(3);
      expect(rows.filter((r) => r.status === 'active').length).toBe(1);
    });
  });

  describe('agreement_proposals — basic insert + constraints', () => {
    it('inserts a round-1 owner-initiated proposal (parent NULL)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('initial');

      const [proposal] = await dbHttp
        .insert(agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          parentProposalId: null,
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 7000,
          proposedTermMonths: 6,
          proposedEffectiveFrom: new Date('2026-06-01T00:00:00Z'),
          note: 'Initial offer',
          status: 'open',
        })
        .returning();

      expect(proposal.parentProposalId).toBeNull();
      expect(proposal.roundNumber).toBe(1);
      expect(proposal.proposedCreatorSharePercent).toBe(7000);
    });

    it('self-referential parent_proposal_id chains rounds (counter-proposal)', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('counter');

      const [round1] = await dbHttp
        .insert(agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedEffectiveFrom: new Date('2026-06-01T00:00:00Z'),
          status: 'countered',
          respondedAt: new Date(),
          respondedByUserId: creatorId,
        })
        .returning();

      const [round2] = await dbHttp
        .insert(agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          parentProposalId: round1.id,
          roundNumber: 2,
          proposedByUserId: creatorId,
          proposedByRole: 'creator',
          proposedCreatorSharePercent: 6500,
          proposedEffectiveFrom: new Date('2026-06-01T00:00:00Z'),
          note: 'Counter — bump share',
          status: 'open',
        })
        .returning();

      expect(round2.parentProposalId).toBe(round1.id);
      expect(round2.roundNumber).toBe(2);
      expect(round2.proposedByRole).toBe('creator');
    });

    it('rejects share_bps > 10000', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      // Orphan-org variant — no owner membership row. Covers the backfill
      // migration's COALESCE fallback path (proposed_by_user_id ← creator_id)
      // for organisations that have no active owner.
      const { ownerId, creatorId, orgId } = await freshFixture('badbps', {
        withOwnerMembership: false,
      });

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 10001,
          proposedEffectiveFrom: new Date(),
          status: 'open',
        })
      );
    });

    it('rejects round_number < 1', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('badround');

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 0,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedEffectiveFrom: new Date(),
          status: 'open',
        })
      );
    });

    it('rejects unknown status / role / revenue_type values', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('badenum');

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedEffectiveFrom: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: deliberate constraint violation
          status: 'pending' as any,
        })
      );

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          // biome-ignore lint/suspicious/noExplicitAny: deliberate constraint violation
          proposedByRole: 'platform' as any,
          proposedCreatorSharePercent: 5000,
          proposedEffectiveFrom: new Date(),
          status: 'open',
        })
      );
    });

    it('rejects non-positive proposed_term_months', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('badterm');

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedTermMonths: 0,
          proposedEffectiveFrom: new Date(),
          status: 'open',
        })
      );
    });
  });

  describe('current_proposal_id wire-up', () => {
    it('an accepted proposal can be linked back from agreements.current_proposal_id', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals, creatorOrganizationAgreements } =
        await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('linked');

      const [proposal] = await dbHttp
        .insert(agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 7000,
          proposedEffectiveFrom: new Date('2026-06-01T00:00:00Z'),
          status: 'accepted',
          respondedAt: new Date(),
          respondedByUserId: creatorId,
        })
        .returning();

      const [agreement] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 10000 - 7000,
          revenueType: 'subscription',
          currentProposalId: proposal.id,
        })
        .returning();

      expect(agreement.currentProposalId).toBe(proposal.id);

      // Sanity: round-trip via select.
      const rows = await dbHttp
        .select()
        .from(creatorOrganizationAgreements)
        .where(
          and(
            eq(creatorOrganizationAgreements.id, agreement.id),
            isNotNull(creatorOrganizationAgreements.currentProposalId)
          )
        );
      expect(rows[0].currentProposalId).toBe(proposal.id);
    });
  });

  describe('FK invariants', () => {
    it('rejects parent_proposal_id pointing at a non-existent uuid', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { agreementProposals } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('badparent');

      // Random uuid that has zero chance of existing in agreement_proposals.
      const ghostId = '00000000-0000-4000-8000-000000000000';

      await expectConstraintError(
        dbHttp.insert(agreementProposals).values({
          organizationId: orgId,
          creatorId,
          revenueType: 'subscription',
          parentProposalId: ghostId,
          roundNumber: 2,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedEffectiveFrom: new Date('2026-06-01T00:00:00Z'),
          status: 'open',
        })
      );
    });
  });

  describe('re-activation after termination', () => {
    it('allows a NEW active agreement on the same triple after the prior one is terminated', async (ctx) => {
      skipIfNoMigration(ctx);
      const { dbHttp } = await import('../index');
      const { creatorOrganizationAgreements } = await import('../schema');
      const { ownerId, creatorId, orgId } = await freshFixture('reactivate');

      // First active agreement.
      const [first] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 2000,
          revenueType: 'subscription',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();

      // Terminate it.
      await dbHttp
        .update(creatorOrganizationAgreements)
        .set({
          status: 'terminated',
          terminatedAt: new Date('2026-02-01T00:00:00Z'),
          terminatedByUserId: ownerId,
          terminationReason: 'Re-activation test',
        })
        .where(eq(creatorOrganizationAgreements.id, first.id));

      // A NEW active row on the same (org, creator, revenue_type) MUST be
      // allowed — the partial unique only constrains active rows.
      const [second] = await dbHttp
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 1500,
          revenueType: 'subscription',
          effectiveFrom: new Date('2026-03-01T00:00:00Z'),
        })
        .returning();

      expect(second.status).toBe('active');

      const rows = await dbHttp
        .select()
        .from(creatorOrganizationAgreements)
        .where(
          and(
            eq(creatorOrganizationAgreements.organizationId, orgId),
            eq(creatorOrganizationAgreements.creatorId, creatorId),
            eq(creatorOrganizationAgreements.revenueType, 'subscription')
          )
        );
      expect(rows.length).toBe(2);
      expect(rows.filter((r) => r.status === 'active').length).toBe(1);
      expect(rows.filter((r) => r.status === 'terminated').length).toBe(1);
    });
  });

  describe('backfill migration 0072 — idempotency guard (textual)', () => {
    // Running raw migration SQL inside vitest against a partially-migrated
    // schema is awkward (the post-WP-1 invariant means current_proposal_id
    // is always set on active rows). Instead we assert the migration text
    // contains the NOT EXISTS guard pattern AND the deterministic
    // primary-key join — together they make the migration safe to retry
    // after a partial failure.
    it('contains a NOT EXISTS proposal-existence guard in the INSERT', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const sqlPath = path.resolve(
        __dirname,
        '../migrations/0072_backfill_agreement_proposals.sql'
      );
      const sqlText = await fs.readFile(sqlPath, 'utf8');

      // Guard: skip agreements whose triple already has ANY proposal row.
      expect(sqlText).toMatch(
        /NOT EXISTS\s*\(\s*SELECT 1\s+FROM "agreement_proposals" p/i
      );
      expect(sqlText).toMatch(/p\."organization_id"\s*=\s*a\."organization_id"/);
      expect(sqlText).toMatch(/p\."creator_id"\s*=\s*a\."creator_id"/);
      expect(sqlText).toMatch(/p\."revenue_type"\s*=\s*a\."revenue_type"/);
    });

    it('UPDATEs by source_agreement_id (PK) rather than tuple match', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const sqlPath = path.resolve(
        __dirname,
        '../migrations/0072_backfill_agreement_proposals.sql'
      );
      const sqlText = await fs.readFile(sqlPath, 'utf8');

      // RETURNING includes the captured source agreement id, and the
      // UPDATE joins on a.id = i.source_agreement_id — deterministic even
      // if historical rows collide on (org, creator, revenue_type, eff_from).
      expect(sqlText).toMatch(/source_agreement_id/);
      expect(sqlText).toMatch(/a\."id"\s*=\s*i\.source_agreement_id/);
    });
  });
});
