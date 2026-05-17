/**
 * @codex/agreements — AgreementService integration tests
 *
 * Covers the full state machine with BOTH positive AND negative paths
 * per the `feedback_security_deep_test` memory: money-touching and
 * authorisation code MUST have rejection tests, not just happy paths.
 *
 * Schema fixtures: created inline via the test-utils factories so each
 * test owns its data. The neon-testing CI plugin gives this file an
 * ephemeral branch; locally we share the LOCAL_PROXY DB across tests
 * but every test uses unique slugs to avoid collisions.
 *
 * Per `feedback_service_error_test_instanceof`: assertions use
 * `toBeInstanceOf(Class)` and `err.name === 'ClassName'`. NEVER use
 * `err.constructor.name` — Vite/esbuild minify class names to single
 * letters and the assertion will silently pass on the wrong type.
 */

import { randomUUID } from 'node:crypto';
import * as schema from '@codex/database/schema';
import { ForbiddenError, NotFoundError } from '@codex/service-errors';
import {
  cleanupDatabase,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgreementNotFoundError,
  InvalidProposalStateError,
  ShareExceedsAvailableError,
} from '../../errors';
import { AgreementService } from '../agreement-service';

// ─── Fixture helpers ──────────────────────────────────────────────────────

interface OrgFixture {
  orgId: string;
  ownerId: string;
  creatorAId: string;
  creatorBId: string;
  outsiderId: string;
}

/**
 * Seed an org with one owner + two creators + one outsider (not a member).
 *
 * Returns the IDs the test cases use. We deliberately do NOT set
 * `organizations.owner_id` — that column doesn't exist (per WP-1
 * discovery #1); ownership comes from the membership row with
 * `role='owner', status='active'`.
 */
async function seedOrgFixture(
  db: Database,
  options: { ownerActive?: boolean } = {}
): Promise<OrgFixture> {
  const [ownerId, creatorAId, creatorBId, outsiderId] = await seedTestUsers(
    db,
    4
  );

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: 'Test Org',
      slug: createUniqueSlug('agree-org'),
    })
    .returning();
  if (!org) throw new Error('Failed to seed test organization');

  // Owner membership (active by default; tests can mark inactive via
  // ownerActive=false to exercise the no-active-owner path).
  await db.insert(schema.organizationMemberships).values({
    organizationId: org.id,
    userId: ownerId,
    role: 'owner',
    status: options.ownerActive === false ? 'inactive' : 'active',
  });
  // Two creator memberships — for sibling-share and multi-creator paths.
  await db.insert(schema.organizationMemberships).values([
    {
      organizationId: org.id,
      userId: creatorAId,
      role: 'creator',
      status: 'active',
    },
    {
      organizationId: org.id,
      userId: creatorBId,
      role: 'creator',
      status: 'active',
    },
  ]);

  return {
    orgId: org.id,
    ownerId,
    creatorAId,
    creatorBId,
    outsiderId,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────

describe('AgreementService', () => {
  let db: Database;
  let service: AgreementService;

  beforeAll(async () => {
    db = setupTestDatabase();
    try {
      await validateDatabaseConnection(db);
    } catch (error) {
      console.warn(
        'Database connection failed - tests will be skipped:',
        (error as Error).message
      );
      throw error;
    }

    // Per PR #210 review, AgreementService no longer threads
    // FeeConfigService — share-validation reasons purely about the
    // post-platform pool. WP-4's payout pipeline reads the platform
    // fee fresh at invoice time elsewhere.
    service = new AgreementService({
      db,
      environment: 'test',
    });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // Each test starts with a clean slate. We use the shared cleanupDatabase
  // helper because it already orders FK deletions correctly (purchases
  // and contentAccess reference organizations with onDelete: 'restrict',
  // so they must go first). Users are preserved across tests for cheapness.
  //
  // Note: `cleanupDatabase` does NOT delete `organizationMemberships` —
  // the schema declares those FKs as `onDelete: 'cascade'` from
  // organizations, so the membership rows are wiped automatically when
  // the org rows go. The explicit delete here is defence-in-depth in
  // case a prior test happened to seed memberships against an org that
  // got rolled back; cheap insurance against test-ordering side effects
  // ([[feedback-test-cleanup-fk-ordering]]).
  beforeEach(async () => {
    await cleanupDatabase(db);
    await db.delete(schema.organizationMemberships);
  });

  // ── proposeAgreement ──────────────────────────────────────────────────

  describe('proposeAgreement', () => {
    it('owner can propose to existing creator member', async () => {
      const fx = await seedOrgFixture(db);
      const proposal = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        note: 'Hello',
        proposedByUserId: fx.ownerId,
      });
      expect(proposal.id).toBeDefined();
      expect(proposal.organizationId).toBe(fx.orgId);
      expect(proposal.creatorId).toBe(fx.creatorAId);
      expect(proposal.revenueType).toBe('subscription');
      expect(proposal.proposedCreatorSharePercent).toBe(3000);
      expect(proposal.proposedTermMonths).toBe(6);
      expect(proposal.note).toBe('Hello');
      expect(proposal.status).toBe('open');
      expect(proposal.proposedByRole).toBe('owner');
      expect(proposal.roundNumber).toBe(1);
      expect(proposal.parentProposalId).toBeNull();
    });

    it('non-owner cannot propose (Forbidden)', async () => {
      const fx = await seedOrgFixture(db);
      try {
        await service.proposeAgreement({
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          revenueType: 'subscription',
          sharePercent: 3000,
          termMonths: 6,
          proposedByUserId: fx.creatorAId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('cannot propose when target user is not an active member', async () => {
      const fx = await seedOrgFixture(db);
      try {
        await service.proposeAgreement({
          organizationId: fx.orgId,
          creatorId: fx.outsiderId,
          revenueType: 'subscription',
          sharePercent: 3000,
          termMonths: 6,
          proposedByUserId: fx.ownerId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('throws ShareExceedsAvailableError when proposal + active > 100% of post-platform pool', async () => {
      const fx = await seedOrgFixture(db);
      // Active 70% subscription agreement to creator B (orgFee=3000).
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorBId,
        organizationFeePercentage: 3000, // creator B has 70% share
        revenueType: 'subscription',
        status: 'active',
      });
      // 70% existing + 31% proposed = 101% of post-platform pool → fail.
      try {
        await service.proposeAgreement({
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          revenueType: 'subscription',
          sharePercent: 3100,
          termMonths: 6,
          proposedByUserId: fx.ownerId,
        });
        expect.fail('Expected ShareExceedsAvailableError');
      } catch (err) {
        expect(err).toBeInstanceOf(ShareExceedsAvailableError);
        expect((err as Error).name).toBe('ShareExceedsAvailableError');
      }
    });

    it('throws ForbiddenError when org has no active owner', async () => {
      const fx = await seedOrgFixture(db, { ownerActive: false });
      try {
        await service.proposeAgreement({
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          revenueType: 'subscription',
          sharePercent: 3000,
          termMonths: 6,
          proposedByUserId: fx.ownerId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('throws InvalidProposalStateError when an open proposal already exists for the triple', async () => {
      const fx = await seedOrgFixture(db);
      await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      try {
        await service.proposeAgreement({
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          revenueType: 'subscription',
          sharePercent: 2500,
          termMonths: 6,
          proposedByUserId: fx.ownerId,
        });
        expect.fail('Expected InvalidProposalStateError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidProposalStateError);
        expect((err as Error).name).toBe('InvalidProposalStateError');
      }
    });

    it('throws NotFoundError when organization id does not exist (I2)', async () => {
      // Per PR #210 review, missing-org throws the shared `NotFoundError`
      // with `{ resource: 'organization', organizationId }`. Previously
      // this leaked through `AgreementNotFoundError` with the wrong
      // context key (`agreementId`).
      // Note: shared NotFoundError doesn't set `this.name` so Vite/esbuild
      // minification collapses err.name to single letters under build.
      // We use `toBeInstanceOf` + the error CODE for type discrimination,
      // not err.name. ([[feedback-service-error-test-instanceof]])
      const bogusOrgId = randomUUID();
      try {
        await service.proposeAgreement({
          organizationId: bogusOrgId,
          creatorId: 'whatever',
          revenueType: 'subscription',
          sharePercent: 3000,
          termMonths: 6,
          proposedByUserId: 'whatever',
        });
        expect.fail('Expected NotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        const e = err as NotFoundError;
        expect(e.code).toBe('NOT_FOUND');
        const ctx = e.context as Record<string, unknown>;
        expect(ctx.resource).toBe('organization');
        expect(ctx.organizationId).toBe(bogusOrgId);
      }
    });

    // I4: re-opening a thread after every fully-terminal end state.
    // The implementation comment on `assertNoOpenThread` documents that
    // after declined/withdrawn/superseded/accepted (all terminal),
    // the bucket is free for a fresh round-1 proposal. Locking in
    // tests so a future refactor can't silently break the UX.

    it('allows re-opening a fully-terminal thread (after decline) — I4', async () => {
      const fx = await seedOrgFixture(db);
      const first = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      await service.declineProposal({
        proposalId: first.id,
        declinedByUserId: fx.creatorAId,
      });
      const second = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 2500,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      expect(second.status).toBe('open');
      expect(second.roundNumber).toBe(1);
      expect(second.parentProposalId).toBeNull();
    });

    it('allows re-opening after a withdraw — I4', async () => {
      const fx = await seedOrgFixture(db);
      const first = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      await service.withdrawProposal({
        proposalId: first.id,
        withdrawnByUserId: fx.ownerId,
      });
      const second = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 2500,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      expect(second.status).toBe('open');
      expect(second.roundNumber).toBe(1);
      expect(second.parentProposalId).toBeNull();
    });

    it('allows re-opening after terminating an active agreement — I4', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      await service.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.ownerId,
      });
      // Accepted proposal is terminal; thread is fully terminal once
      // the active agreement is terminated. Bucket is free.
      const second = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 2000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      expect(second.status).toBe('open');
      expect(second.roundNumber).toBe(1);
      expect(second.parentProposalId).toBeNull();
    });

    // I1: concurrency. A deterministic test would need controlled
    // scheduling we don't have here — locking in `it.todo` as a
    // tracking point. The implementation uses `SELECT ... FOR UPDATE`
    // on every status-mutating proposal/agreement lookup.
    it.todo(
      'locks proposal row to prevent concurrent accept/decline race — I1'
    );
  });

  // ── counterPropose ────────────────────────────────────────────────────

  describe('counterPropose', () => {
    it('creator can counter owner-proposed round-1', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const r2 = await service.counterPropose({
        proposalId: r1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      expect(r2.roundNumber).toBe(2);
      expect(r2.parentProposalId).toBe(r1.id);
      expect(r2.proposedByRole).toBe('creator');
      expect(r2.proposedCreatorSharePercent).toBe(4000);
      expect(r2.status).toBe('open');

      // Parent is now countered.
      const parentAfter = await db.query.agreementProposals.findFirst({
        where: eq(schema.agreementProposals.id, r1.id),
      });
      expect(parentAfter?.status).toBe('countered');
      expect(parentAfter?.respondedByUserId).toBe(fx.creatorAId);
    });

    it('owner can counter creator-counter (round 3, flipped role)', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const r2 = await service.counterPropose({
        proposalId: r1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      const r3 = await service.counterPropose({
        proposalId: r2.id,
        sharePercent: 3500,
        termMonths: 6,
        counteredByUserId: fx.ownerId,
      });
      expect(r3.roundNumber).toBe(3);
      expect(r3.proposedByRole).toBe('owner');
    });

    it('cannot counter an accepted proposal', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      try {
        await service.counterPropose({
          proposalId: r1.id,
          sharePercent: 2000,
          termMonths: 6,
          counteredByUserId: fx.creatorAId,
        });
        expect.fail('Expected InvalidProposalStateError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidProposalStateError);
      }
    });

    it('same-party cannot counter their own proposal (owner cannot counter owner-proposed)', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      try {
        await service.counterPropose({
          proposalId: r1.id,
          sharePercent: 2500,
          termMonths: 6,
          counteredByUserId: fx.ownerId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('rejects when share exceeds available pool', async () => {
      const fx = await seedOrgFixture(db);
      // Active 80% subscription agreement to creator B (orgFee=2000).
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorBId,
        organizationFeePercentage: 2000,
        revenueType: 'subscription',
        status: 'active',
      });
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 1000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      // 80% B + 21% creator A counter = 101% of post-platform pool → fail.
      try {
        await service.counterPropose({
          proposalId: r1.id,
          sharePercent: 2100,
          termMonths: 6,
          counteredByUserId: fx.creatorAId,
        });
        expect.fail('Expected ShareExceedsAvailableError');
      } catch (err) {
        expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      }
    });
  });

  // ── acceptProposal ────────────────────────────────────────────────────

  describe('acceptProposal', () => {
    it('counterparty accepts owner-proposed → active agreement + dual-write', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      expect(agreement.status).toBe('active');
      expect(agreement.revenueType).toBe('subscription');
      expect(agreement.currentProposalId).toBe(r1.id);
      // Dual-write invariant: organization_fee_percentage = 10000 - share.
      expect(agreement.organizationFeePercentage).toBe(7000);

      // The proposal is now accepted.
      const proposalAfter = await db.query.agreementProposals.findFirst({
        where: eq(schema.agreementProposals.id, r1.id),
      });
      expect(proposalAfter?.status).toBe('accepted');
      expect(proposalAfter?.respondedByUserId).toBe(fx.creatorAId);
    });

    it('accepting supersedes any open/countered sibling proposals in the thread', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      // Round 2 — creator counters.
      const r2 = await service.counterPropose({
        proposalId: r1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      // Owner accepts the counter.
      await service.acceptProposal({
        proposalId: r2.id,
        acceptedByUserId: fx.ownerId,
      });
      const r1After = await db.query.agreementProposals.findFirst({
        where: eq(schema.agreementProposals.id, r1.id),
      });
      // r1 was already 'countered' from r2's insertion; it stays
      // 'countered' (terminal for the round-1 row — supersede only
      // touches open+countered SIBLINGS not the accepted row itself).
      // Our query for siblings excluded r1's status='countered' status —
      // but per our service it transitions sibling open/countered to
      // 'superseded'. So r1 should be 'superseded' after acceptance.
      expect(r1After?.status).toBe('superseded');
    });

    it('accepting terminates the predecessor active agreement (auto-supersede)', async () => {
      const fx = await seedOrgFixture(db);
      // Pre-existing active agreement at 30%.
      const [previous] = await db
        .insert(schema.creatorOrganizationAgreements)
        .values({
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          organizationFeePercentage: 7000,
          revenueType: 'subscription',
          status: 'active',
        })
        .returning();
      if (!previous) throw new Error('seed failed');
      // Propose a new 40% agreement.
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 4000,
        termMonths: 12,
        proposedByUserId: fx.ownerId,
      });
      await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      // Previous row terminated.
      const previousAfter =
        await db.query.creatorOrganizationAgreements.findFirst({
          where: eq(schema.creatorOrganizationAgreements.id, previous.id),
        });
      expect(previousAfter?.status).toBe('terminated');
      expect(previousAfter?.terminatedByUserId).toBe(fx.creatorAId);
    });

    it('same-party cannot accept own proposal (owner cannot self-accept)', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      try {
        await service.acceptProposal({
          proposalId: r1.id,
          acceptedByUserId: fx.ownerId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('cannot accept an already-accepted proposal', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      try {
        await service.acceptProposal({
          proposalId: r1.id,
          acceptedByUserId: fx.creatorAId,
        });
        expect.fail('Expected InvalidProposalStateError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidProposalStateError);
      }
    });

    it('re-validates share at accept-time → throws if siblings have moved', async () => {
      const fx = await seedOrgFixture(db);
      // Propose 60% to creator A.
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 6000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      // Between propose and accept, a 50% agreement lands for creator B
      // (orgFee=5000 → share=5000). Now 50% B + 60% A = 110% of the
      // post-platform pool — accept-time re-validation must reject.
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorBId,
        organizationFeePercentage: 5000,
        revenueType: 'subscription',
        status: 'active',
      });
      try {
        await service.acceptProposal({
          proposalId: r1.id,
          acceptedByUserId: fx.creatorAId,
        });
        expect.fail('Expected ShareExceedsAvailableError');
      } catch (err) {
        expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      }
    });
  });

  // ── declineProposal ──────────────────────────────────────────────────

  describe('declineProposal', () => {
    it('counterparty declines open owner-proposed', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const declined = await service.declineProposal({
        proposalId: r1.id,
        declinedByUserId: fx.creatorAId,
        reason: 'Not enough share',
      });
      expect(declined.status).toBe('declined');
      expect(declined.declineReason).toBe('Not enough share');
      expect(declined.respondedByUserId).toBe(fx.creatorAId);
    });

    it('same-party cannot decline own proposal', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      try {
        await service.declineProposal({
          proposalId: r1.id,
          declinedByUserId: fx.ownerId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('cannot decline an already-terminal proposal', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      await service.declineProposal({
        proposalId: r1.id,
        declinedByUserId: fx.creatorAId,
      });
      try {
        await service.declineProposal({
          proposalId: r1.id,
          declinedByUserId: fx.creatorAId,
        });
        expect.fail('Expected InvalidProposalStateError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidProposalStateError);
      }
    });
  });

  // ── withdrawProposal ─────────────────────────────────────────────────

  describe('withdrawProposal', () => {
    it('proposing party (owner) can withdraw own owner-proposed', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const withdrawn = await service.withdrawProposal({
        proposalId: r1.id,
        withdrawnByUserId: fx.ownerId,
      });
      expect(withdrawn.status).toBe('withdrawn');
      expect(withdrawn.respondedByUserId).toBe(fx.ownerId);
    });

    it("counterparty cannot withdraw the proposing party's proposal", async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      try {
        await service.withdrawProposal({
          proposalId: r1.id,
          withdrawnByUserId: fx.creatorAId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('proposing creator can withdraw their counter-proposal', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const r2 = await service.counterPropose({
        proposalId: r1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      const withdrawn = await service.withdrawProposal({
        proposalId: r2.id,
        withdrawnByUserId: fx.creatorAId,
      });
      expect(withdrawn.status).toBe('withdrawn');
    });
  });

  // ── terminateAgreement ───────────────────────────────────────────────

  describe('terminateAgreement', () => {
    it('owner can terminate an active agreement', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      const terminated = await service.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.ownerId,
        reason: 'Business reasons',
      });
      expect(terminated.status).toBe('terminated');
      expect(terminated.terminationReason).toBe('Business reasons');
      expect(terminated.terminatedByUserId).toBe(fx.ownerId);
      expect(terminated.terminatedAt).toBeInstanceOf(Date);
    });

    it('the named creator can terminate their own agreement', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      const terminated = await service.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.creatorAId,
      });
      expect(terminated.status).toBe('terminated');
      expect(terminated.terminatedByUserId).toBe(fx.creatorAId);
    });

    it("outsider cannot terminate someone else's agreement", async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      try {
        await service.terminateAgreement({
          agreementId: agreement.id,
          terminatedByUserId: fx.outsiderId,
        });
        expect.fail('Expected ForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });

    it('cannot terminate an already-terminated agreement', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await service.acceptProposal({
        proposalId: r1.id,
        acceptedByUserId: fx.creatorAId,
      });
      await service.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.ownerId,
      });
      try {
        await service.terminateAgreement({
          agreementId: agreement.id,
          terminatedByUserId: fx.ownerId,
        });
        expect.fail('Expected InvalidProposalStateError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidProposalStateError);
      }
    });

    it('throws AgreementNotFoundError for non-existent agreement id', async () => {
      try {
        await service.terminateAgreement({
          agreementId: '00000000-0000-0000-0000-000000000000',
          terminatedByUserId: 'some-user',
        });
        expect.fail('Expected AgreementNotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(AgreementNotFoundError);
      }
    });
  });

  // ── getActiveAgreements / getActiveAgreementsForCreator ───────────────

  describe('read queries', () => {
    it('getActiveAgreements returns only active rows', async () => {
      const fx = await seedOrgFixture(db);
      // Create two: one active, one terminated.
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 6000,
        revenueType: 'subscription',
        status: 'active',
      });
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorBId,
        organizationFeePercentage: 5000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt: new Date(),
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
      });
      expect(results.length).toBe(1);
      expect(results[0]?.creatorId).toBe(fx.creatorAId);
    });

    it('getActiveAgreementsForCreator is multi-org isolated', async () => {
      const fx1 = await seedOrgFixture(db);
      const fx2 = await seedOrgFixture(db);
      // Creator A from fx1 also signed an agreement in fx2 via direct
      // seed (no need to wire memberships for this read test — the
      // read filters on creatorId, not on org membership).
      await db.insert(schema.creatorOrganizationAgreements).values([
        {
          organizationId: fx1.orgId,
          creatorId: fx1.creatorAId,
          organizationFeePercentage: 6000,
          revenueType: 'subscription',
          status: 'active',
        },
        {
          organizationId: fx2.orgId,
          // Use a NEW user not on fx2's team yet — the read service
          // doesn't enforce membership, just returns active rows where
          // creatorId matches. We deliberately reuse fx1.creatorAId here
          // to assert cross-org visibility.
          creatorId: fx1.creatorAId,
          organizationFeePercentage: 7000,
          revenueType: 'subscription',
          status: 'active',
        },
      ]);
      const results = await service.getActiveAgreementsForCreator({
        creatorId: fx1.creatorAId,
      });
      expect(results.length).toBe(2);
      const orgs = results.map((r) => r.organizationId).sort();
      expect(orgs).toEqual([fx1.orgId, fx2.orgId].sort());
    });

    it('getActiveAgreements excludes terminated rows', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 5000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt: new Date(),
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
      });
      expect(results.length).toBe(0);
    });

    it('getNegotiationThread returns proposals in chronological order', async () => {
      const fx = await seedOrgFixture(db);
      const r1 = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const r2 = await service.counterPropose({
        proposalId: r1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      const thread = await service.getNegotiationThread({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
      });
      expect(thread.length).toBe(2);
      expect(thread[0]?.id).toBe(r1.id);
      expect(thread[0]?.roundNumber).toBe(1);
      expect(thread[1]?.id).toBe(r2.id);
      expect(thread[1]?.roundNumber).toBe(2);
    });

    it('getNegotiationThread returns empty array when no thread exists', async () => {
      const fx = await seedOrgFixture(db);
      const thread = await service.getNegotiationThread({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
      });
      expect(thread).toEqual([]);
    });
  });
});
