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
 * - Never the owner making it. They are already paid the creator and the
 *   organisation slice of their own sales, and the whole pool with no
 *   subscription agreements, so an agreement with yourself changes nothing.
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

  /** The refusal, its 422, its client-facing context, and nothing written. */
  async function expectRefused(
    fx: Awaited<ReturnType<typeof team>>,
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
    await expectRefused(fx, propose(fx, fx.ownerId), 'self');
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
});
