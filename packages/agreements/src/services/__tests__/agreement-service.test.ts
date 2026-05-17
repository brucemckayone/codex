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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

  // ── getProposalsForCreator / getOrgName (WP-8 — Codex-bw2wf) ───────────
  //
  // Both methods are load-bearing for the creator-side portfolio:
  //   - getProposalsForCreator powers /agreements/me/portfolio AND
  //     /agreements/me/threads/:proposalId enumeration. The latter cannot
  //     fall back to getActiveAgreementsForCreator because pending round-1
  //     proposals never have a creatorOrganizationAgreements row.
  //   - getOrgName surfaces the friendly org name in the portfolio rows.
  //
  // Per [[feedback-security-deep-test]]: positive + cross-tenant-pin
  // (negative) for any creator-scoped read. The cross-tenant pin is the
  // load-bearing invariant — without it, a creator could enumerate someone
  // else's proposals.

  describe('getProposalsForCreator', () => {
    it('returns proposals where creatorId matches', async () => {
      const fxA = await seedOrgFixture(db);
      const fxB = await seedOrgFixture(db);
      // Owner of org A proposes to creator A. Owner of org B proposes to
      // creator B (a different user fixture). Each has exactly one open
      // proposal in their own org.
      await service.proposeAgreement({
        organizationId: fxA.orgId,
        creatorId: fxA.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fxA.ownerId,
      });
      await service.proposeAgreement({
        organizationId: fxB.orgId,
        creatorId: fxB.creatorAId,
        revenueType: 'subscription',
        sharePercent: 4000,
        termMonths: 6,
        proposedByUserId: fxB.ownerId,
      });
      const forA = await service.getProposalsForCreator({
        creatorId: fxA.creatorAId,
      });
      expect(forA).toHaveLength(1);
      expect(forA[0]?.creatorId).toBe(fxA.creatorAId);
      expect(forA[0]?.organizationId).toBe(fxA.orgId);
    });

    it('honours status filter when passed (array form, WP-8 hardening for I1)', async () => {
      // Seed: 2 open + 1 declined + 1 withdrawn for creator A across two
      // orgs (the propose guard refuses 2 open threads on the same triple).
      const fxA = await seedOrgFixture(db);
      const fxB = await seedOrgFixture(db);
      // Two open proposals (different orgs).
      await service.proposeAgreement({
        organizationId: fxA.orgId,
        creatorId: fxA.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fxA.ownerId,
      });
      await service.proposeAgreement({
        organizationId: fxB.orgId,
        creatorId: fxB.creatorAId,
        revenueType: 'subscription',
        sharePercent: 2500,
        termMonths: 6,
        proposedByUserId: fxB.ownerId,
      });
      // A declined proposal (same triple as fxA's open, but fxA's open
      // must be declined first so the triple is terminal).
      const fxC = await seedOrgFixture(db);
      const toDecline = await service.proposeAgreement({
        organizationId: fxC.orgId,
        creatorId: fxC.creatorAId,
        revenueType: 'subscription',
        sharePercent: 2000,
        termMonths: 6,
        proposedByUserId: fxC.ownerId,
      });
      await service.declineProposal({
        proposalId: toDecline.id,
        declinedByUserId: fxC.creatorAId,
      });
      // A withdrawn proposal in yet another org.
      const fxD = await seedOrgFixture(db);
      const toWithdraw = await service.proposeAgreement({
        organizationId: fxD.orgId,
        creatorId: fxD.creatorAId,
        revenueType: 'subscription',
        sharePercent: 1500,
        termMonths: 6,
        proposedByUserId: fxD.ownerId,
      });
      await service.withdrawProposal({
        proposalId: toWithdraw.id,
        withdrawnByUserId: fxD.ownerId,
      });

      // Each fixture's creatorA is a distinct user; query each. The
      // status-filter assertion uses fxA (the open thread).
      const openOnly = await service.getProposalsForCreator({
        creatorId: fxA.creatorAId,
        status: ['open'],
      });
      expect(openOnly).toHaveLength(1);
      expect(openOnly[0]?.status).toBe('open');

      const allForA = await service.getProposalsForCreator({
        creatorId: fxA.creatorAId,
      });
      expect(allForA).toHaveLength(1);

      // Status filter as a single string also accepted.
      const declinedOnly = await service.getProposalsForCreator({
        creatorId: fxC.creatorAId,
        status: 'declined',
      });
      expect(declinedOnly).toHaveLength(1);
      expect(declinedOnly[0]?.status).toBe('declined');

      // Multi-status filter narrows correctly.
      const openOrDeclinedForA = await service.getProposalsForCreator({
        creatorId: fxA.creatorAId,
        status: ['open', 'declined', 'withdrawn'],
      });
      expect(openOrDeclinedForA).toHaveLength(1);
      expect(openOrDeclinedForA[0]?.status).toBe('open');
    });

    it('returns empty array when creator has no proposals', async () => {
      const result = await service.getProposalsForCreator({
        creatorId: randomUUID(),
      });
      expect(result).toEqual([]);
    });

    it('cross-tenant pin: returns nothing for a different creator', async () => {
      // Two orgs, two creator users. A proposal is seeded for creator A
      // ONLY. Querying for creator B's id must return zero rows even
      // though they exist as users in the database.
      const fx = await seedOrgFixture(db);
      await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const forB = await service.getProposalsForCreator({
        creatorId: fx.creatorBId,
      });
      expect(forB).toEqual([]);
    });

    it('returns proposals chronologically (oldest first)', async () => {
      // Three proposals in three different orgs, seeded in known order.
      // Drizzle's createdAt timestamps are server-set, so we lean on
      // insertion order rather than predetermined timestamps; that's
      // sufficient for asserting ASC ordering.
      const fxA = await seedOrgFixture(db);
      const p1 = await service.proposeAgreement({
        organizationId: fxA.orgId,
        creatorId: fxA.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fxA.ownerId,
      });
      // Counter (creates a child proposal in the same thread).
      const p2 = await service.counterPropose({
        proposalId: p1.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fxA.creatorAId,
      });
      const all = await service.getProposalsForCreator({
        creatorId: fxA.creatorAId,
      });
      expect(all.length).toBeGreaterThanOrEqual(2);
      const indexOfP1 = all.findIndex((p) => p.id === p1.id);
      const indexOfP2 = all.findIndex((p) => p.id === p2.id);
      // p1 was created first → must appear before p2 in the ASC list.
      expect(indexOfP1).toBeLessThan(indexOfP2);
    });
  });

  describe('getOrgName', () => {
    it('returns the human-readable name for an existing org', async () => {
      // seedOrgFixture inserts orgs with name "Test Org" — assert.
      const fx = await seedOrgFixture(db);
      const name = await service.getOrgName(fx.orgId);
      expect(name).toBe('Test Org');
    });

    it('returns the name for a soft-deleted org (lookup is intentionally inclusive)', async () => {
      // Per the docstring on lookupOrgName: soft-deleted orgs still
      // return their name — a recently-archived org with an outstanding
      // negotiation is still useful audit context for the portfolio UI.
      const fx = await seedOrgFixture(db);
      await db
        .update(schema.organizations)
        .set({ deletedAt: new Date() })
        .where(eq(schema.organizations.id, fx.orgId));
      const name = await service.getOrgName(fx.orgId);
      expect(name).toBe('Test Org');
    });

    it('returns null for an unknown org id', async () => {
      const name = await service.getOrgName(randomUUID());
      expect(name).toBeNull();
    });
  });

  // ── WP-4 payout-pipeline read filters (Codex-rzfjw) ────────────────────
  //
  // The payout pipeline at invoice time needs three new query shapes:
  //   - filter by revenueType (subscription vs content_purchase)
  //   - filter by activeAt (active-as-of-invoice-date — Decision Q3, no
  //     pro-rating)
  //   - lookup a single (org, creator, revenueType) tuple — the
  //     content-purchase pipeline does this per purchase keyed on the
  //     uploader (Decision Q1 — creator's-own-content scope)
  //
  // Money code. Positive + negative + edge tests each.
  describe('WP-4 payout-pipeline read filters', () => {
    it('getActiveAgreements filters by revenueType', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values([
        {
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          organizationFeePercentage: 7000,
          revenueType: 'subscription',
          status: 'active',
        },
        {
          organizationId: fx.orgId,
          creatorId: fx.creatorBId,
          organizationFeePercentage: 5000,
          revenueType: 'content_purchase',
          status: 'active',
        },
      ]);
      const subOnly = await service.getActiveAgreements({
        organizationId: fx.orgId,
        revenueType: 'subscription',
      });
      expect(subOnly).toHaveLength(1);
      expect(subOnly[0]?.creatorId).toBe(fx.creatorAId);
      const cpOnly = await service.getActiveAgreements({
        organizationId: fx.orgId,
        revenueType: 'content_purchase',
      });
      expect(cpOnly).toHaveLength(1);
      expect(cpOnly[0]?.creatorId).toBe(fx.creatorBId);
    });

    it('getActiveAgreements: terminated_at > activeAt still surfaces (Q3 no pro-rating)', async () => {
      // Decision Q3: whoever holds an active agreement at invoice fire
      // time receives the full cut. Terminated AFTER invoice date is
      // still active AS OF the invoice date.
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      const terminatedAt = new Date('2026-01-20T00:00:00Z'); // 5 days later
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'terminated', // status was flipped on termination
        terminatedAt,
        effectiveFrom: new Date('2025-12-01T00:00:00Z'),
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
        activeAt: invoiceAt,
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.creatorId).toBe(fx.creatorAId);
    });

    it('getActiveAgreements: terminated_at <= activeAt does NOT surface', async () => {
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      const terminatedAt = new Date('2026-01-10T00:00:00Z'); // 5 days before
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt,
        effectiveFrom: new Date('2025-12-01T00:00:00Z'),
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
        activeAt: invoiceAt,
      });
      expect(results).toHaveLength(0);
    });

    it('getActiveAgreements: effective_from > activeAt does NOT surface (future agreement)', async () => {
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      const effectiveFrom = new Date('2026-02-01T00:00:00Z'); // future
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom,
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
        activeAt: invoiceAt,
      });
      expect(results).toHaveLength(0);
    });

    it('getActiveAgreements: effective_until <= activeAt does NOT surface (legacy time-slice)', async () => {
      // Defence in depth: legacy `effective_until` filter still trims
      // any rows whose explicit end-date is in the past.
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom: new Date('2025-12-01T00:00:00Z'),
        effectiveUntil: new Date('2026-01-01T00:00:00Z'), // ended before invoice
      });
      const results = await service.getActiveAgreements({
        organizationId: fx.orgId,
        activeAt: invoiceAt,
      });
      expect(results).toHaveLength(0);
    });

    it('getActiveAgreement (singular): returns matching active row', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'content_purchase',
        status: 'active',
      });
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'content_purchase',
      });
      expect(result).not.toBeNull();
      expect(result?.creatorId).toBe(fx.creatorAId);
      expect(result?.revenueType).toBe('content_purchase');
    });

    it('getActiveAgreement: returns null when no matching agreement', async () => {
      const fx = await seedOrgFixture(db);
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
      });
      expect(result).toBeNull();
    });

    it('getActiveAgreement: wrong revenueType returns null', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
      });
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'content_purchase',
      });
      expect(result).toBeNull();
    });

    it('getActiveAgreement: terminated before activeAt returns null', async () => {
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt: new Date('2026-01-10T00:00:00Z'),
        effectiveFrom: new Date('2025-12-01T00:00:00Z'),
      });
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        activeAt: invoiceAt,
      });
      expect(result).toBeNull();
    });

    it('getActiveAgreement: terminated AFTER activeAt still returns the agreement (Q3)', async () => {
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt: new Date('2026-01-20T00:00:00Z'), // terminated AFTER invoice
        effectiveFrom: new Date('2025-12-01T00:00:00Z'),
      });
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        activeAt: invoiceAt,
      });
      expect(result).not.toBeNull();
    });

    it('getActiveAgreement: effective_from > activeAt returns null (not yet active)', async () => {
      const fx = await seedOrgFixture(db);
      const invoiceAt = new Date('2026-01-15T00:00:00Z');
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom: new Date('2026-02-01T00:00:00Z'),
      });
      const result = await service.getActiveAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        activeAt: invoiceAt,
      });
      expect(result).toBeNull();
    });

    it('getActiveAgreementsForCreator: revenueType filter scopes the portfolio', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values([
        {
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          organizationFeePercentage: 7000,
          revenueType: 'subscription',
          status: 'active',
        },
        {
          organizationId: fx.orgId,
          creatorId: fx.creatorAId,
          organizationFeePercentage: 5000,
          revenueType: 'content_purchase',
          status: 'active',
        },
      ]);
      const subOnly = await service.getActiveAgreementsForCreator({
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
      });
      expect(subOnly).toHaveLength(1);
      expect(subOnly[0]?.revenueType).toBe('subscription');
    });
  });

  // ─── Lifecycle notification dispatch (WP-5 — Codex-90de9) ──────────────
  //
  // The lifecycle methods fire a `mailer(params)` callback AFTER the
  // transaction commits. Tests below construct a NEW service instance
  // with a mock mailer so we can assert the email contract directly:
  // template name, recipient mapping, payload shape, and the
  // critical invariant that mailer failures NEVER roll back the
  // agreement state (notification is observation, not source of truth).

  describe('lifecycle notification dispatch (WP-5)', () => {
    function buildServiceWithMailer(): {
      serviceWithMailer: AgreementService;
      mailer: ReturnType<typeof vi.fn>;
    } {
      const mailer = vi.fn();
      const serviceWithMailer = new AgreementService({
        db,
        environment: 'test',
        mailer,
        webAppUrl: 'https://app.example.test',
      });
      return { serviceWithMailer, mailer };
    }

    it('proposeAgreement triggers agreement-proposed-by-owner addressed to the creator', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        note: 'A note for the recipient.',
        proposedByUserId: fx.ownerId,
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      const [call] = mailer.mock.calls;
      const params = call?.[0] as Record<string, unknown>;
      expect(params.templateName).toBe('agreement-proposed-by-owner');
      expect(params.category).toBe('transactional');
      expect(params.userId).toBe(fx.creatorAId);
      expect(params.organizationId).toBe(fx.orgId);
      const data = params.data as Record<string, string>;
      expect(data.sharePercentDisplay).toBe('30%');
      expect(data.termMonthsDisplay).toBe('6 months');
      expect(data.revenueTypeLabel).toBe('subscription');
      expect(data.note).toBe('A note for the recipient.');
      // Deep link includes the absolute base + org id
      expect(data.deepLinkUrl).toContain(
        'https://app.example.test/studio/negotiations/'
      );
      expect(data.deepLinkUrl).toContain(`orgId=${fx.orgId}`);
    });

    it('counterPropose by creator triggers agreement-countered-by-creator addressed to the proposing owner', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      mailer.mockClear();
      await serviceWithMailer.counterPropose({
        proposalId: proposal.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.templateName).toBe('agreement-countered-by-creator');
      expect(params.userId).toBe(fx.ownerId);
      const data = params.data as Record<string, string>;
      expect(data.sharePercentDisplay).toBe('40%');
    });

    it('counterPropose by owner triggers agreement-countered-by-owner addressed to the creator', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const counter = await serviceWithMailer.counterPropose({
        proposalId: proposal.id,
        sharePercent: 4000,
        termMonths: 6,
        counteredByUserId: fx.creatorAId,
      });
      mailer.mockClear();
      // Now the owner counters back
      await serviceWithMailer.counterPropose({
        proposalId: counter.id,
        sharePercent: 3500,
        termMonths: 6,
        counteredByUserId: fx.ownerId,
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.templateName).toBe('agreement-countered-by-owner');
      expect(params.userId).toBe(fx.creatorAId);
    });

    it('acceptProposal triggers agreement-accepted to BOTH parties (creator + owner)', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      mailer.mockClear();
      await serviceWithMailer.acceptProposal({
        proposalId: proposal.id,
        acceptedByUserId: fx.creatorAId,
      });
      expect(mailer).toHaveBeenCalledTimes(2);
      const recipientUserIds = mailer.mock.calls.map(
        (call) => (call[0] as Record<string, unknown>).userId
      );
      expect(new Set(recipientUserIds)).toEqual(
        new Set([fx.creatorAId, fx.ownerId])
      );
      for (const call of mailer.mock.calls) {
        const params = call[0] as Record<string, unknown>;
        expect(params.templateName).toBe('agreement-accepted');
        const data = params.data as Record<string, string>;
        expect(data.sharePercentDisplay).toBe('30%');
        expect(data.effectiveFromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('declineProposal triggers agreement-declined to BOTH parties', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      mailer.mockClear();
      await serviceWithMailer.declineProposal({
        proposalId: proposal.id,
        declinedByUserId: fx.creatorAId,
        reason: 'Need a different deal',
      });
      expect(mailer).toHaveBeenCalledTimes(2);
      const recipientUserIds = mailer.mock.calls.map(
        (call) => (call[0] as Record<string, unknown>).userId
      );
      expect(new Set(recipientUserIds)).toEqual(
        new Set([fx.creatorAId, fx.ownerId])
      );
      for (const call of mailer.mock.calls) {
        const params = call[0] as Record<string, unknown>;
        expect(params.templateName).toBe('agreement-declined');
        const data = params.data as Record<string, string>;
        expect(data.declineReason).toBe('Need a different deal');
      }
    });

    it('terminateAgreement (by creator) triggers agreement-terminated addressed to the org owner', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await serviceWithMailer.acceptProposal({
        proposalId: proposal.id,
        acceptedByUserId: fx.creatorAId,
      });
      mailer.mockClear();
      await serviceWithMailer.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.creatorAId, // creator terminates
        reason: 'Switching focus',
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.templateName).toBe('agreement-terminated');
      // Recipient is the OTHER party — the org owner
      expect(params.userId).toBe(fx.ownerId);
      const data = params.data as Record<string, string>;
      expect(data.terminationReason).toBe('Switching focus');
      expect(data.effectiveTerminationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('terminateAgreement (by owner) triggers agreement-terminated addressed to the creator', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      const agreement = await serviceWithMailer.acceptProposal({
        proposalId: proposal.id,
        acceptedByUserId: fx.creatorAId,
      });
      mailer.mockClear();
      await serviceWithMailer.terminateAgreement({
        agreementId: agreement.id,
        terminatedByUserId: fx.ownerId, // owner terminates
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.templateName).toBe('agreement-terminated');
      // Recipient is the OTHER party — the creator
      expect(params.userId).toBe(fx.creatorAId);
    });

    it('withdrawProposal does NOT fire any notification (silent withdrawal per epic plan)', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      const proposal = await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      mailer.mockClear();
      await serviceWithMailer.withdrawProposal({
        proposalId: proposal.id,
        withdrawnByUserId: fx.ownerId,
      });
      expect(mailer).not.toHaveBeenCalled();
    });

    it('mailer throwing does NOT roll back the agreement transaction', async () => {
      // Critical invariant: the agreement is the source of truth; the
      // notification is observation. A mailer transport failure (e.g.
      // notifications-api 500) must never undo the agreement state.
      const fx = await seedOrgFixture(db);
      const throwingMailer = vi.fn(() => {
        throw new Error('Simulated transport failure');
      });
      const serviceWithThrowingMailer = new AgreementService({
        db,
        environment: 'test',
        mailer: throwingMailer,
        webAppUrl: 'https://app.example.test',
      });
      // Should NOT throw — the dispatcher catches + logs the mailer
      // failure. Returned proposal is the persisted row.
      const proposal = await serviceWithThrowingMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe('open');
      // The DB row must exist
      const persisted = await db.query.agreementProposals.findFirst({
        where: eq(schema.agreementProposals.id, proposal.id),
      });
      expect(persisted).not.toBeUndefined();
      expect(throwingMailer).toHaveBeenCalledTimes(1);
    });

    it('service without a mailer wired silently no-ops (graceful degrade)', async () => {
      // Narrow unit tests / legacy harnesses without a mailer wired
      // must still succeed. The service-level `service` instance built
      // in `beforeAll` has no mailer; we reuse it here.
      const fx = await seedOrgFixture(db);
      const proposal = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: 6,
        proposedByUserId: fx.ownerId,
      });
      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe('open');
    });

    it('formats indefinite term (termMonths=null) as "Indefinite"', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: null,
        proposedByUserId: fx.ownerId,
      });
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      const data = params.data as Record<string, string>;
      expect(data.termMonthsDisplay).toBe('Indefinite');
    });

    it('formats content_purchase revenue type with hyphenated label', async () => {
      const fx = await seedOrgFixture(db);
      const { serviceWithMailer, mailer } = buildServiceWithMailer();
      await serviceWithMailer.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'content_purchase',
        sharePercent: 5000,
        termMonths: 12,
        proposedByUserId: fx.ownerId,
      });
      const params = mailer.mock.calls[0]?.[0] as Record<string, unknown>;
      const data = params.data as Record<string, string>;
      expect(data.revenueTypeLabel).toBe('content-purchase');
      expect(data.sharePercentDisplay).toBe('50%');
    });
  });

  // ─── findExpiringAgreements / markExpiringSoonSent (WP-? — Codex-tugez) ─
  //
  // The agreement-expiring-soon cron handler in notifications-api drives
  // this method daily. Tests cover the window-filter, idempotency gate,
  // and status filter — see project_revenue_share_decisions.md (Q3) for
  // why we don't pro-rate on mid-cycle termination.
  describe('findExpiringAgreements / markExpiringSoonSent', () => {
    /**
     * Helper: accept a proposal so we end up with an active agreement row
     * to test against. Returns the agreement id + the proposal so the
     * test can drive markExpiringSoonSent / direct UPDATE on the row.
     */
    async function seedActiveAgreement(
      fx: OrgFixture,
      options: {
        termMonths: number | null;
        effectiveFromOffsetDays?: number;
      } = { termMonths: 6 }
    ): Promise<string> {
      const proposal = await service.proposeAgreement({
        organizationId: fx.orgId,
        creatorId: fx.creatorAId,
        revenueType: 'subscription',
        sharePercent: 3000,
        termMonths: options.termMonths,
        proposedByUserId: fx.ownerId,
        effectiveFrom: options.effectiveFromOffsetDays
          ? new Date(Date.now() + options.effectiveFromOffsetDays * 86_400_000)
          : undefined,
      });
      const agreement = await service.acceptProposal({
        proposalId: proposal.id,
        acceptedByUserId: fx.creatorAId,
      });
      return agreement.id;
    }

    it('agreement expiring in 25 days IS returned (within 30-day window)', async () => {
      const fx = await seedOrgFixture(db);
      // 6-month term placed 5 months and 5 days ago -> ~25 days remaining.
      // Easier: compute backwards — set effectiveFrom such that
      // (effectiveFrom + termMonths*30 days) is 25 days from now.
      const desiredDaysUntilExpiry = 25;
      const termMonths = 6;
      const termMs = termMonths * 30 * 86_400_000;
      const effectiveFrom = new Date(
        Date.now() + desiredDaysUntilExpiry * 86_400_000 - termMs
      );

      // Custom path: insert directly because the proposal flow uses
      // computeEffectiveUntil with setUTCMonth (calendar months, not
      // 30-day chunks). We want the row, not the proposal flow under
      // test here.
      const effectiveUntil = new Date(effectiveFrom.getTime() + termMs);
      const [row] = await db
        .insert(schema.creatorOrganizationAgreements)
        .values({
          creatorId: fx.creatorAId,
          organizationId: fx.orgId,
          organizationFeePercentage: 7000, // 30% share
          revenueType: 'subscription',
          status: 'active',
          effectiveFrom,
          effectiveUntil,
        })
        .returning();
      if (!row) throw new Error('Failed to seed test agreement');

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(1);
      expect(expiring[0]?.agreement.id).toBe(row.id);
      expect(expiring[0]?.creator.id).toBe(fx.creatorAId);
      expect(expiring[0]?.orgName).toBe('Test Org');
    });

    it('agreement expiring in 35 days is NOT returned (outside window)', async () => {
      const fx = await seedOrgFixture(db);
      const desiredDaysUntilExpiry = 35;
      const termMs = 6 * 30 * 86_400_000;
      const effectiveFrom = new Date(
        Date.now() + desiredDaysUntilExpiry * 86_400_000 - termMs
      );
      const effectiveUntil = new Date(effectiveFrom.getTime() + termMs);
      await db.insert(schema.creatorOrganizationAgreements).values({
        creatorId: fx.creatorAId,
        organizationId: fx.orgId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom,
        effectiveUntil,
      });

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(0);
    });

    it('agreement with expiringSoonEmailSentAt already set is NOT returned', async () => {
      const fx = await seedOrgFixture(db);
      const effectiveFrom = new Date(Date.now() - 155 * 86_400_000); // -155 days
      const effectiveUntil = new Date(Date.now() + 25 * 86_400_000); // +25 days
      const [row] = await db
        .insert(schema.creatorOrganizationAgreements)
        .values({
          creatorId: fx.creatorAId,
          organizationId: fx.orgId,
          organizationFeePercentage: 7000,
          revenueType: 'subscription',
          status: 'active',
          effectiveFrom,
          effectiveUntil,
          expiringSoonEmailSentAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('Failed to seed agreement');

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(0);
    });

    it('terminated agreement is NOT returned (status filter)', async () => {
      const fx = await seedOrgFixture(db);
      const effectiveFrom = new Date(Date.now() - 155 * 86_400_000);
      const effectiveUntil = new Date(Date.now() + 25 * 86_400_000);
      await db.insert(schema.creatorOrganizationAgreements).values({
        creatorId: fx.creatorAId,
        organizationId: fx.orgId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'terminated',
        terminatedAt: new Date(),
        effectiveFrom,
        effectiveUntil,
      });

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(0);
    });

    it('indefinite agreement (effectiveUntil IS NULL) is NOT returned', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values({
        creatorId: fx.creatorAId,
        organizationId: fx.orgId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom: new Date(Date.now() - 30 * 86_400_000),
        effectiveUntil: null, // indefinite
      });

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(0);
    });

    it('agreement already past expiry (effectiveUntil <= now) is NOT returned', async () => {
      const fx = await seedOrgFixture(db);
      await db.insert(schema.creatorOrganizationAgreements).values({
        creatorId: fx.creatorAId,
        organizationId: fx.orgId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom: new Date(Date.now() - 200 * 86_400_000),
        effectiveUntil: new Date(Date.now() - 10 * 86_400_000), // expired 10 days ago
      });

      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(expiring).toHaveLength(0);
    });

    it('markExpiringSoonSent sets the timestamp and dedupes future scans', async () => {
      const fx = await seedOrgFixture(db);
      // Seed via the public propose+accept path so the agreement row is
      // produced by the same path the cron consumes.
      const agreementId = await seedActiveAgreement(fx, { termMonths: 1 });

      // Force the agreement into the window by direct UPDATE — the
      // calendar-month math from acceptProposal may not land within 30
      // days from now (depends on test clock).
      const effectiveUntil = new Date(Date.now() + 20 * 86_400_000);
      await db
        .update(schema.creatorOrganizationAgreements)
        .set({ effectiveUntil })
        .where(eq(schema.creatorOrganizationAgreements.id, agreementId));

      const before = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(before.find((r) => r.agreement.id === agreementId)).toBeDefined();

      await service.markExpiringSoonSent(agreementId);

      const after = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(after.find((r) => r.agreement.id === agreementId)).toBeUndefined();

      // Row is actually marked in DB
      const [row] = await db
        .select({
          sentAt: schema.creatorOrganizationAgreements.expiringSoonEmailSentAt,
        })
        .from(schema.creatorOrganizationAgreements)
        .where(eq(schema.creatorOrganizationAgreements.id, agreementId));
      expect(row?.sentAt).toBeInstanceOf(Date);
    });

    it('getFirstActiveOwnerContact returns the owner row when one exists', async () => {
      const fx = await seedOrgFixture(db);
      const contact = await service.getFirstActiveOwnerContact(fx.orgId);
      expect(contact).not.toBeNull();
      expect(contact?.id).toBe(fx.ownerId);
      expect(contact?.email).toContain('@');
    });

    it('getFirstActiveOwnerContact returns null for an org with no active owner', async () => {
      // Seed an org with NO owner membership at all.
      const [org] = await db
        .insert(schema.organizations)
        .values({ name: 'Orphan Org', slug: createUniqueSlug('orphan') })
        .returning();
      if (!org) throw new Error('Failed to seed orphan org');

      const contact = await service.getFirstActiveOwnerContact(org.id);
      expect(contact).toBeNull();
    });

    it('respects custom `now` for window calculation', async () => {
      const fx = await seedOrgFixture(db);
      // Expiry ~30 years in the future — would never appear with real now,
      // but appears when we pass a `now` that's only 25 days behind it.
      const futureExpiry = new Date('2056-06-01T00:00:00Z');
      const futureEffectiveFrom = new Date('2055-12-01T00:00:00Z');
      await db.insert(schema.creatorOrganizationAgreements).values({
        creatorId: fx.creatorAId,
        organizationId: fx.orgId,
        organizationFeePercentage: 7000,
        revenueType: 'subscription',
        status: 'active',
        effectiveFrom: futureEffectiveFrom,
        effectiveUntil: futureExpiry,
      });

      const withDefaultNow = await service.findExpiringAgreements({
        daysAhead: 30,
      });
      expect(withDefaultNow).toHaveLength(0);

      // Pass a `now` 25 days before futureExpiry → falls in the 30-day
      // window.
      const nearExpiry = new Date(futureExpiry.getTime() - 25 * 86_400_000);
      const withCustomNow = await service.findExpiringAgreements({
        daysAhead: 30,
        now: nearExpiry,
      });
      expect(withCustomNow).toHaveLength(1);
    });
  });
});
