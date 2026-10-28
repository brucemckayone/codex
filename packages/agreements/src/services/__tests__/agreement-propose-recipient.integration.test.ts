/**
 * Who a new proposal can name (owner decisions 2026-10-27; Codex-2hxff.76,
 * .77; docs/payments/agreements.md, "What an agreement is").
 *
 * - Only a member whose PLATFORM role can enter the creators' Studio
 *   (creator, admin or platform_owner): that is where a creator negotiates,
 *   and every link in an agreement's emails goes there. Joining an
 *   organisation leaves the platform role alone, so an invited customer used
 *   to receive a proposal they could never open ("Creator accounts only").
 * - Never a subscriber, whatever their account (accepted until now).
 * - Never the owner. They are already paid the creator and the organisation
 *   slice of their own sales, and the whole pool with no subscription
 *   agreements, so an agreement with yourself changes nothing.
 *
 * Counter and accept check the same three things (review of .76/.77). A
 * thread opened before these rules, or one whose creator has since become the
 * owner, must not end in an agreement the rules refuse.
 *
 * Each refusal is a 422 whose client-facing context is the reason only,
 * written before anything is stored or emailed.
 *
 * Real DB, a spy mailer, inline dispatch. The local database is shared with
 * other sessions, so every row hangs off this file's own organisations and
 * users, and they are deleted in afterAll.
 */

import * as schema from '@codex/database/schema';
import { ForbiddenError } from '@codex/service-errors';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AgreementRecipientRefusal,
  RecipientCannotHoldAgreementError,
} from '../../errors';
import { AgreementService } from '../agreement-service';

describe('who a proposal can name (Codex-2hxff.76, .77)', () => {
  let db: Database;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
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

  /**
   * An organisation with an owner (who has a creator account, as owners do)
   * and one other member, with the given membership and platform roles.
   */
  async function team(recipient: {
    membershipRole: string;
    platformRole: string;
  }) {
    const [ownerId, recipientId] = await seedTestUsers(db, 2);
    userIds.push(ownerId, recipientId);
    const [org] = await db
      .insert(schema.organizations)
      .values({
        name: 'Recipient Org',
        slug: createUniqueSlug('agr-recipient'),
      })
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
        userId: recipientId,
        role: recipient.membershipRole,
        status: 'active',
      },
    ]);
    await db
      .update(schema.users)
      .set({ role: 'creator' })
      .where(eq(schema.users.id, ownerId));
    await db
      .update(schema.users)
      .set({ role: recipient.platformRole })
      .where(eq(schema.users.id, recipientId));
    const mailer = vi.fn();
    const service = new AgreementService({ db, environment: 'test', mailer });
    return { orgId: org.id, ownerId, recipientId, service, mailer };
  }

  function propose(
    fx: Awaited<ReturnType<typeof team>>,
    creatorId: string = fx.recipientId
  ) {
    return fx.service.proposeAgreement({
      organizationId: fx.orgId,
      creatorId,
      revenueType: 'subscription',
      sharePercent: 3000,
      termMonths: 6,
      proposedByUserId: fx.ownerId,
    });
  }

  async function proposalsIn(orgId: string) {
    return db
      .select({ id: schema.agreementProposals.id })
      .from(schema.agreementProposals)
      .where(eq(schema.agreementProposals.organizationId, orgId));
  }

  /** The refusal: a 422 whose client-facing context is the reason only. */
  async function expectRefusal(
    attempt: Promise<unknown>,
    reason: AgreementRecipientRefusal
  ) {
    const error = await attempt.then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(RecipientCannotHoldAgreementError);
    expect(error).toMatchObject({
      name: 'RecipientCannotHoldAgreementError',
      statusCode: 422,
      context: { reason },
    });
    expect(Object.keys((error as { context: object }).context)).toEqual([
      'reason',
    ]);
  }

  /** A refused proposal: the refusal, and nothing stored or emailed. */
  async function expectRefused(
    fx: Awaited<ReturnType<typeof team>>,
    attempt: Promise<unknown>,
    reason: AgreementRecipientRefusal
  ) {
    await expectRefusal(attempt, reason);
    expect(await proposalsIn(fx.orgId)).toHaveLength(0);
    expect(fx.mailer).not.toHaveBeenCalled();
  }

  it.each([
    'creator',
    'admin',
    'platform_owner',
  ])('a member whose platform role is %s can be proposed to', async (platformRole) => {
    const fx = await team({ membershipRole: 'creator', platformRole });
    const proposal = await propose(fx);
    expect(proposal).toMatchObject({
      creatorId: fx.recipientId,
      status: 'open',
    });
    expect(fx.mailer).toHaveBeenCalledTimes(1);
  });

  it.each([
    'creator',
    'member',
    'admin',
  ])('a member in the %s role with a customer account is refused', async (membershipRole) => {
    const fx = await team({ membershipRole, platformRole: 'customer' });
    await expectRefused(fx, propose(fx), 'no_creator_account');
  });

  it('a subscriber is refused, even with a creator account', async () => {
    const fx = await team({
      membershipRole: 'subscriber',
      platformRole: 'creator',
    });
    await expectRefused(fx, propose(fx), 'subscriber');
  });

  it('the owner proposing to themselves is refused', async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'creator',
    });
    await expectRefused(fx, propose(fx, fx.ownerId), 'owner');
  });

  it('someone outside the organisation is still refused as a non-member', async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'creator',
    });
    const [outsiderId] = await seedTestUsers(db, 1);
    userIds.push(outsiderId);
    await db
      .update(schema.users)
      .set({ role: 'creator' })
      .where(eq(schema.users.id, outsiderId));
    await expect(propose(fx, outsiderId)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(await proposalsIn(fx.orgId)).toHaveLength(0);
  });

  // ── A thread opened before these rules: counter and accept check too ──

  /**
   * An open proposal written straight to the table, as one made before the
   * rules was. `by: 'creator'` makes it the creator's counter-offer, which
   * the OWNER accepts or counters.
   */
  async function openThread(
    fx: Awaited<ReturnType<typeof team>>,
    by: 'owner' | 'creator' = 'owner'
  ) {
    const [proposal] = await db
      .insert(schema.agreementProposals)
      .values({
        organizationId: fx.orgId,
        creatorId: fx.recipientId,
        revenueType: 'subscription',
        roundNumber: 1,
        proposedByUserId: by === 'owner' ? fx.ownerId : fx.recipientId,
        proposedByRole: by,
        proposedCreatorSharePercent: 3000,
        proposedTermMonths: 6,
        proposedEffectiveFrom: new Date(Date.now() - 60_000),
        status: 'open',
      })
      .returning();
    if (!proposal) throw new Error('proposal not seeded');
    return proposal;
  }

  /** The thread is as it was: still open, and no agreement came of it. */
  async function expectUnchanged(
    fx: Awaited<ReturnType<typeof team>>,
    proposalId: string
  ) {
    const [row] = await db
      .select({ status: schema.agreementProposals.status })
      .from(schema.agreementProposals)
      .where(eq(schema.agreementProposals.id, proposalId));
    expect(row?.status).toBe('open');
    expect(await proposalsIn(fx.orgId)).toHaveLength(1);
    const agreements = await db
      .select({ id: schema.creatorOrganizationAgreements.id })
      .from(schema.creatorOrganizationAgreements)
      .where(eq(schema.creatorOrganizationAgreements.organizationId, fx.orgId));
    expect(agreements).toHaveLength(0);
    expect(fx.mailer).not.toHaveBeenCalled();
  }

  const accept = (
    fx: Awaited<ReturnType<typeof team>>,
    proposalId: string,
    by: string
  ) => fx.service.acceptProposal({ proposalId, acceptedByUserId: by });
  const counter = (
    fx: Awaited<ReturnType<typeof team>>,
    proposalId: string,
    by: string
  ) =>
    fx.service.counterPropose({
      proposalId,
      sharePercent: 3500,
      termMonths: 6,
      counteredByUserId: by,
    });

  it('a customer-account member cannot accept or counter a proposal made before the rules', async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'customer',
    });
    const proposal = await openThread(fx);
    await expectRefusal(
      accept(fx, proposal.id, fx.recipientId),
      'no_creator_account'
    );
    await expectRefusal(
      counter(fx, proposal.id, fx.recipientId),
      'no_creator_account'
    );
    await expectUnchanged(fx, proposal.id);
  });

  it("the owner cannot accept or counter such a member's counter-offer either", async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'customer',
    });
    const proposal = await openThread(fx, 'creator');
    await expectRefusal(
      accept(fx, proposal.id, fx.ownerId),
      'no_creator_account'
    );
    await expectRefusal(
      counter(fx, proposal.id, fx.ownerId),
      'no_creator_account'
    );
    await expectUnchanged(fx, proposal.id);
  });

  it('a subscriber cannot accept a proposal made before the rules', async () => {
    const fx = await team({
      membershipRole: 'subscriber',
      platformRole: 'creator',
    });
    const proposal = await openThread(fx);
    await expectRefusal(accept(fx, proposal.id, fx.recipientId), 'subscriber');
    await expectUnchanged(fx, proposal.id);
  });

  it('a creator who has since become the owner cannot accept or counter their own proposal', async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'creator',
    });
    const proposal = await openThread(fx);
    // Ownership passes to the creator: one active owner at a time, so the
    // old owner steps down first.
    await db
      .update(schema.organizationMemberships)
      .set({ role: 'admin' })
      .where(eq(schema.organizationMemberships.userId, fx.ownerId));
    await db
      .update(schema.organizationMemberships)
      .set({ role: 'owner' })
      .where(eq(schema.organizationMemberships.userId, fx.recipientId));
    await expectRefusal(accept(fx, proposal.id, fx.recipientId), 'owner');
    await expectRefusal(counter(fx, proposal.id, fx.recipientId), 'owner');
    await expectUnchanged(fx, proposal.id);
  });

  it('a creator account still accepts (control)', async () => {
    const fx = await team({
      membershipRole: 'creator',
      platformRole: 'creator',
    });
    const proposal = await openThread(fx);
    const agreement = await accept(fx, proposal.id, fx.recipientId);
    expect(agreement).toMatchObject({
      creatorId: fx.recipientId,
      status: 'active',
    });
  });
});
