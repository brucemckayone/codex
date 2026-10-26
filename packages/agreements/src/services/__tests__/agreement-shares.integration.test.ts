/**
 * One pool, one writer at a time, and the share read from the proposal
 * (Codex-2hxff.19; docs/payments/agreements.md §What an agreement is,
 * §Negotiating).
 *
 * - AGR-13: the active shares of one revenue type in one organisation never
 *   add up to more than 100%, even when two creators accept at once. Each
 *   accept locks only its own proposal, so without the pool's advisory lock
 *   both read the sum before either wrote, and both passed.
 * - AGR-04: one thread per organisation, creator and revenue type, even when
 *   two proposes land at once. A new proposal has no row to lock.
 * - AGR-08: the 100% check, the termination email and the creator's reads
 *   take the share from the accepted proposal through `current_proposal_id`,
 *   never from the legacy `organization_fee_percentage`. Every fixture here
 *   sets that column to a WRONG value, so a read of it shows.
 *
 * Real DB: the races need two transactions at once (`setupTestDatabase` is
 * the WebSocket pool). The local database is shared with other sessions, so
 * every row hangs off this file's own organisations and users, and they are
 * deleted in afterAll.
 */

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  InvalidProposalStateError,
  ShareExceedsAvailableError,
} from '../../errors';
import { AgreementService } from '../agreement-service';

/** Rounds per race: one interleaving can miss a race; several do not. */
const ROUNDS = 4;

describe('agreement shares (AGR-04, AGR-08, AGR-13)', () => {
  let db: Database;
  let service: AgreementService;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
    service = new AgreementService({
      db,
      environment: 'test',
    });
  });

  afterAll(async () => {
    if (orgIds.length > 0) {
      await db
        .delete(schema.creatorOrganizationAgreements)
        .where(
          inArray(schema.creatorOrganizationAgreements.organizationId, orgIds)
        );
      await db
        .delete(schema.agreementProposals)
        .where(inArray(schema.agreementProposals.organizationId, orgIds));
      await db
        .delete(schema.organizationMemberships)
        .where(inArray(schema.organizationMemberships.organizationId, orgIds));
      await db
        .delete(schema.organizations)
        .where(inArray(schema.organizations.id, orgIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    await teardownTestDatabase();
  });

  /** An organisation with an owner and two creators, all active members. */
  async function team() {
    const [ownerId, creatorA, creatorB] = await seedTestUsers(db, 3);
    userIds.push(ownerId, creatorA, creatorB);
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Shares Org', slug: createUniqueSlug('agr-shares') })
      .returning();
    if (!org) throw new Error('organisation not seeded');
    orgIds.push(org.id);
    await db.insert(schema.organizationMemberships).values([
      {
        organizationId: org.id,
        userId: ownerId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: org.id,
        userId: creatorA,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: org.id,
        userId: creatorB,
        role: 'creator',
        status: 'active',
      },
    ]);
    return { orgId: org.id, ownerId, creatorA, creatorB };
  }

  /**
   * An active subscription agreement whose proposal says `share` and whose
   * legacy column says something else (`legacyShare`).
   */
  async function agreement(
    fx: { orgId: string; ownerId: string },
    creatorId: string,
    share: number,
    legacyShare: number
  ) {
    const effectiveFrom = new Date(Date.now() - 60_000);
    const [proposal] = await db
      .insert(schema.agreementProposals)
      .values({
        organizationId: fx.orgId,
        creatorId,
        revenueType: 'subscription',
        roundNumber: 1,
        proposedByUserId: fx.ownerId,
        proposedByRole: 'owner',
        proposedCreatorSharePercent: share,
        proposedEffectiveFrom: effectiveFrom,
        status: 'accepted',
      })
      .returning();
    if (!proposal) throw new Error('proposal not seeded');
    await db.insert(schema.creatorOrganizationAgreements).values({
      organizationId: fx.orgId,
      creatorId,
      organizationFeePercentage: 10_000 - legacyShare,
      revenueType: 'subscription',
      status: 'active',
      currentProposalId: proposal.id,
      effectiveFrom,
    });
  }

  /** The pool's active shares, as the payment resolver reads them. */
  async function activeShares(orgId: string): Promise<number[]> {
    const rows = await db
      .select({ share: schema.agreementProposals.proposedCreatorSharePercent })
      .from(schema.creatorOrganizationAgreements)
      .innerJoin(
        schema.agreementProposals,
        eq(
          schema.agreementProposals.id,
          schema.creatorOrganizationAgreements.currentProposalId
        )
      )
      .where(
        and(
          eq(schema.creatorOrganizationAgreements.organizationId, orgId),
          eq(schema.creatorOrganizationAgreements.revenueType, 'subscription'),
          eq(schema.creatorOrganizationAgreements.status, 'active')
        )
      );
    return rows.map((r) => r.share);
  }

  const propose = (
    fx: { orgId: string; ownerId: string },
    creatorId: string,
    sharePercent: number
  ) =>
    service.proposeAgreement({
      organizationId: fx.orgId,
      creatorId,
      revenueType: 'subscription',
      sharePercent,
      termMonths: null,
      proposedByUserId: fx.ownerId,
    });

  it('two creators accepting at once (60% + 50%): exactly one wins and the pool stays within 100%', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const fx = await team();
      // Both fit while nothing is active yet, so both proposals are made.
      const forA = await propose(fx, fx.creatorA, 6000);
      const forB = await propose(fx, fx.creatorB, 5000);

      const results = await Promise.allSettled([
        service.acceptProposal({
          proposalId: forA.id,
          acceptedByUserId: fx.creatorA,
        }),
        service.acceptProposal({
          proposalId: forB.id,
          acceptedByUserId: fx.creatorB,
        }),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won, `round ${round}`).toHaveLength(1);
      expect(lost[0]?.reason).toBeInstanceOf(ShareExceedsAvailableError);
      const shares = await activeShares(fx.orgId);
      expect(shares).toHaveLength(1);
      expect(shares.reduce((sum, s) => sum + s, 0)).toBeLessThanOrEqual(10_000);
    }
  });

  it('two proposes for one creator at once leave one open thread', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const fx = await team();

      const results = await Promise.allSettled([
        propose(fx, fx.creatorA, 3000),
        propose(fx, fx.creatorA, 3500),
      ]);

      expect(
        results.filter((r) => r.status === 'fulfilled'),
        `round ${round}`
      ).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected');
      expect(lost?.reason).toBeInstanceOf(InvalidProposalStateError);
      const open = await db
        .select({ id: schema.agreementProposals.id })
        .from(schema.agreementProposals)
        .where(
          and(
            eq(schema.agreementProposals.organizationId, fx.orgId),
            eq(schema.agreementProposals.creatorId, fx.creatorA),
            eq(schema.agreementProposals.revenueType, 'subscription'),
            inArray(schema.agreementProposals.status, ['open', 'countered'])
          )
        );
      expect(open).toHaveLength(1);
    }
  });

  it("the 100% check sums the proposals' shares, not the legacy column", async () => {
    const fx = await team();
    // B holds 70% by its proposal; the legacy column claims 10%.
    await agreement(fx, fx.creatorB, 7000, 1000);

    // 70% + 31% is over; by the legacy column it would be 41%.
    await expect(propose(fx, fx.creatorA, 3100)).rejects.toBeInstanceOf(
      ShareExceedsAvailableError
    );
    // 70% + 30% fits exactly.
    await expect(propose(fx, fx.creatorA, 3000)).resolves.toMatchObject({
      status: 'open',
    });
  });

  it("the termination email quotes the proposal's share, not the legacy column", async () => {
    const fx = await team();
    const mailer = vi.fn();
    const withMailer = new AgreementService({
      db,
      environment: 'test',
      mailer,
    });
    const proposal = await propose(fx, fx.creatorA, 3000);
    const accepted = await withMailer.acceptProposal({
      proposalId: proposal.id,
      acceptedByUserId: fx.creatorA,
    });
    // The legacy column drifts to claim 90%.
    await db
      .update(schema.creatorOrganizationAgreements)
      .set({ organizationFeePercentage: 1000 })
      .where(eq(schema.creatorOrganizationAgreements.id, accepted.id));
    mailer.mockClear();

    await withMailer.terminateAgreement({
      agreementId: accepted.id,
      terminatedByUserId: fx.ownerId,
    });

    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0]?.[0]).toMatchObject({
      templateName: 'agreement-terminated',
      data: { sharePercentDisplay: '30%' },
    });
  });

  it("the creator's and the organisation's reads carry the proposal's share", async () => {
    const fx = await team();
    await agreement(fx, fx.creatorA, 3000, 9000);
    await agreement(fx, fx.creatorB, 2000, 500);

    const forOrg = await service.getActiveAgreements({
      organizationId: fx.orgId,
    });
    expect(
      Object.fromEntries(
        forOrg.map((a) => [a.creatorId, a.creatorSharePercent])
      )
    ).toEqual({ [fx.creatorA]: 3000, [fx.creatorB]: 2000 });

    const [own] = await service.getActiveAgreementsForCreator({
      creatorId: fx.creatorA,
    });
    expect(own?.creatorSharePercent).toBe(3000);

    const [ended] = await db
      .update(schema.creatorOrganizationAgreements)
      .set({ status: 'terminated', terminatedAt: new Date() })
      .where(
        and(
          eq(schema.creatorOrganizationAgreements.organizationId, fx.orgId),
          eq(schema.creatorOrganizationAgreements.creatorId, fx.creatorB)
        )
      )
      .returning();
    const past = await service.getTerminatedAgreementsForCreator({
      creatorId: fx.creatorB,
    });
    expect(past.find((a) => a.id === ended?.id)?.creatorSharePercent).toBe(
      2000
    );
  });

  // Only an `open` proposal makes a thread open. A declined or withdrawn
  // counter leaves its parent `countered` for good, and counting that as in
  // flight refused every later proposal for the creator.
  it.each([
    'declined',
    'withdrawn',
  ] as const)('a thread whose counter was %s can be proposed again', async (ending) => {
    const fx = await team();
    const first = await propose(fx, fx.creatorA, 3000);
    const counter = await service.counterPropose({
      proposalId: first.id,
      sharePercent: 5000,
      termMonths: null,
      counteredByUserId: fx.creatorA,
    });
    if (ending === 'declined') {
      await service.declineProposal({
        proposalId: counter.id,
        declinedByUserId: fx.ownerId,
      });
    } else {
      await service.withdrawProposal({
        proposalId: counter.id,
        withdrawnByUserId: fx.creatorA,
      });
    }

    await expect(propose(fx, fx.creatorA, 4000)).resolves.toMatchObject({
      status: 'open',
      roundNumber: 1,
    });
  });

  it('every read that meets an agreement with no proposal logs it, with an errorId', async () => {
    const fx = await team();
    // An active agreement whose proposal link is gone; its review date is
    // due, so the reminder scan meets it too.
    const [orphan] = await db
      .insert(schema.creatorOrganizationAgreements)
      .values({
        organizationId: fx.orgId,
        creatorId: fx.creatorB,
        organizationFeePercentage: 2000,
        revenueType: 'subscription',
        status: 'active',
        currentProposalId: null,
        effectiveFrom: new Date(Date.now() - 60_000),
        effectiveUntil: new Date(Date.now() + 10 * 86_400_000),
      })
      .returning();
    if (!orphan) throw new Error('orphan agreement not seeded');
    const obs = (
      service as unknown as {
        obs: { error: (message: string, meta?: unknown) => void };
      }
    ).obs;
    const logged = vi.spyOn(obs, 'error');
    const reported = () =>
      logged.mock.calls.filter(
        ([message, meta]) =>
          message === 'agreement has no current proposal; it pays nothing' &&
          (meta as { agreementId?: string }).agreementId === orphan.id &&
          typeof (meta as { errorId?: unknown }).errorId === 'string'
      ).length;

    try {
      // The lists.
      const [listed] = await service.getActiveAgreements({
        organizationId: fx.orgId,
      });
      expect(listed?.creatorSharePercent).toBeNull();
      expect(reported()).toBe(1);

      // The review-reminder scan.
      const expiring = await service.findExpiringAgreements({ daysAhead: 30 });
      expect(
        expiring.find((e) => e.agreement.id === orphan.id)?.agreement
          .creatorSharePercent
      ).toBeNull();
      expect(reported()).toBe(2);

      // The 100% check (it counts 0).
      await propose(fx, fx.creatorA, 9000);
      expect(reported()).toBe(3);

      // The termination email (it quotes 0).
      await service.terminateAgreement({
        agreementId: orphan.id,
        terminatedByUserId: fx.ownerId,
      });
      expect(reported()).toBe(4);
    } finally {
      logged.mockRestore();
    }
  });
});
