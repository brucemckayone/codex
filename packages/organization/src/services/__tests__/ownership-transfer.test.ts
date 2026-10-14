/**
 * Organisation ownership transfer (Codex-2hxff.2) — data-design §13.
 *
 * Real Neon test DB: the rules under test are a partial unique index, row
 * locks and multi-statement transactions, which a mocked db cannot exercise.
 *
 * Every write path ends by asserting the invariant the payout resolver relies
 * on: exactly one active owner membership, and exactly one open ownership
 * period, for the same user.
 */

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, isNull } from 'drizzle-orm';
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
  ConflictError,
  ForbiddenError,
  IneligibleOwnershipRecipientError,
  NotOrganisationOwnerError,
  OwnershipConfirmationMismatchError,
  OwnershipOfferNotOpenError,
} from '../../errors';
import {
  OrganizationService,
  type OwnershipMailer,
} from '../organization-service';

const ORG_NAME = 'Studio Alpha';

describe('ownership transfer', () => {
  let db: Database;
  let mailer: ReturnType<typeof vi.fn<OwnershipMailer>>;
  let pending: Promise<unknown>[];
  let service: OrganizationService;

  let orgId: string;
  let ownerId: string;
  let adminId: string;
  let creatorId: string;
  let memberId: string;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    mailer = vi.fn<OwnershipMailer>();
    pending = [];
    service = new OrganizationService({
      db,
      environment: 'test',
      ownershipMailer: mailer,
      webAppUrl: 'http://lvh.me:3000',
      waitUntil: (p) => {
        pending.push(p);
      },
    });

    [ownerId, adminId, creatorId, memberId] = await seedTestUsers(db, 4);
    const org = await service.create(
      { name: ORG_NAME, slug: createUniqueSlug('ownership') },
      ownerId
    );
    orgId = org.id;
    await db.insert(schema.organizationMemberships).values([
      {
        organizationId: orgId,
        userId: adminId,
        role: 'admin',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: memberId,
        role: 'member',
        status: 'active',
      },
    ]);
  });

  /** Drain the fire-and-forget email dispatch. */
  async function emails() {
    await Promise.all(pending);
    return mailer.mock.calls.map(([params]) => params);
  }

  /** Drain, then forget, the emails sent so far (dispatch is async). */
  async function clearEmails() {
    await Promise.all(pending);
    pending = [];
    mailer.mockClear();
  }

  async function roleOf(userId: string) {
    const row = await db.query.organizationMemberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.organizationId, orgId), eq(m.userId, userId)),
    });
    return row?.role;
  }

  async function offerRow(offerId: string) {
    return db.query.organizationOwnershipOffers.findFirst({
      where: (o, { eq }) => eq(o.id, offerId),
    });
  }

  /** The invariant the payout resolver relies on. */
  async function expectOwnerAndPeriodAgree(expectedOwner: string) {
    const owners = await db
      .select({ userId: schema.organizationMemberships.userId })
      .from(schema.organizationMemberships)
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, orgId),
          eq(schema.organizationMemberships.role, 'owner'),
          eq(schema.organizationMemberships.status, 'active')
        )
      );
    const open = await db
      .select({ userId: schema.organizationOwnershipPeriods.userId })
      .from(schema.organizationOwnershipPeriods)
      .where(
        and(
          eq(schema.organizationOwnershipPeriods.organizationId, orgId),
          isNull(schema.organizationOwnershipPeriods.endedAt)
        )
      );
    expect(owners).toEqual([{ userId: expectedOwner }]);
    expect(open).toEqual([{ userId: expectedOwner }]);
  }

  const offer = (recipientUserId = creatorId, confirmName = ORG_NAME) =>
    service.offerOwnership(orgId, ownerId, { recipientUserId, confirmName });

  describe('accept', () => {
    it('swaps the roles and moves the period at one instant', async () => {
      const created = await offer();

      const change = await service.acceptOwnershipOffer(
        orgId,
        created.id,
        creatorId
      );

      expect(change).toMatchObject({
        ownerUserId: creatorId,
        previousOwnerUserId: ownerId,
      });
      expect(await roleOf(creatorId)).toBe('owner');
      expect(await roleOf(ownerId)).toBe('admin');
      expect((await offerRow(created.id))?.status).toBe('accepted');

      const periods = await db.query.organizationOwnershipPeriods.findMany({
        where: (p, { eq }) => eq(p.organizationId, orgId),
        orderBy: (p, { asc }) => [asc(p.startedAt)],
      });
      expect(periods).toHaveLength(2);
      const [before, after] = periods;
      expect(before).toMatchObject({ userId: ownerId, source: 'created' });
      expect(after).toMatchObject({
        userId: creatorId,
        source: 'transfer',
        offerId: created.id,
        endedAt: null,
      });
      // Closed and opened at the same `t`: no instant is unowned or owned twice.
      expect(before?.endedAt?.getTime()).toBe(after?.startedAt.getTime());
      expect(after?.startedAt.toISOString()).toBe(change.ownerSince);

      await expectOwnerAndPeriodAgree(creatorId);
    });

    it('emails the new owner, the previous owner and every other admin', async () => {
      const created = await offer();
      await clearEmails();

      await service.acceptOwnershipOffer(orgId, created.id, creatorId);

      const sent = await emails();
      expect(sent.map((e) => e.templateName)).toEqual(
        expect.arrayContaining(['ownership-transferred'])
      );
      expect(sent.map((e) => e.userId).sort()).toEqual(
        [ownerId, adminId, creatorId].sort()
      );
      expect(sent[0]?.data).toMatchObject({
        orgName: ORG_NAME,
        deepLinkUrl: expect.stringContaining('/studio/settings'),
      });
    });

    it('refuses anyone but the recipient', async () => {
      const created = await offer();

      await expect(
        service.acceptOwnershipOffer(orgId, created.id, adminId)
      ).rejects.toThrow(ForbiddenError);
      await expectOwnerAndPeriodAgree(ownerId);
    });

    it('refuses a second accept (the offer is no longer open)', async () => {
      const created = await offer();
      await service.acceptOwnershipOffer(orgId, created.id, creatorId);

      await expect(
        service.acceptOwnershipOffer(orgId, created.id, creatorId)
      ).rejects.toThrow(OwnershipOfferNotOpenError);
    });

    it('withdraws the offer when the offerer is no longer the owner', async () => {
      const created = await offer();
      await service.reassignOwner(orgId, adminId);
      // Support's reassignment already withdrew it (support_reassigned).
      expect((await offerRow(created.id))?.withdrawnReason).toBe(
        'support_reassigned'
      );

      await expect(
        service.acceptOwnershipOffer(orgId, created.id, creatorId)
      ).rejects.toThrow(OwnershipOfferNotOpenError);
      await expectOwnerAndPeriodAgree(adminId);
    });

    it('refuses an expired offer and marks it expired', async () => {
      const created = await offer();
      await db
        .update(schema.organizationOwnershipOffers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.organizationOwnershipOffers.id, created.id));

      await expect(
        service.acceptOwnershipOffer(orgId, created.id, creatorId)
      ).rejects.toThrow(OwnershipOfferNotOpenError);
      expect((await offerRow(created.id))?.status).toBe('expired');
      await expectOwnerAndPeriodAgree(ownerId);
    });
  });

  describe('offer', () => {
    it('emails the recipient', async () => {
      const created = await offer();

      expect(created).toMatchObject({
        status: 'open',
        recipientUserId: creatorId,
        offeredByUserId: ownerId,
      });
      const sent = await emails();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        templateName: 'ownership-offered',
        userId: creatorId,
        data: { orgName: ORG_NAME },
      });
    });

    it('accepts the name trimmed and case-insensitively', async () => {
      await expect(offer(creatorId, '  studio ALPHA ')).resolves.toMatchObject({
        status: 'open',
      });
    });

    it('refuses a mistyped name', async () => {
      await expect(offer(creatorId, 'Studio Beta')).rejects.toThrow(
        OwnershipConfirmationMismatchError
      );
      await expect(offer(creatorId, 'Studio Beta')).rejects.toMatchObject({
        code: 'CONFIRM_NAME_MISMATCH',
        statusCode: 400,
      });
    });

    it('refuses a non-owner, including an admin', async () => {
      await expect(
        service.offerOwnership(orgId, adminId, {
          recipientUserId: creatorId,
          confirmName: ORG_NAME,
        })
      ).rejects.toThrow(NotOrganisationOwnerError);
    });

    it('refuses a member, a stranger and the owner themselves', async () => {
      const [stranger] = await seedTestUsers(db, 1);
      for (const recipient of [memberId, stranger, ownerId]) {
        await expect(offer(recipient)).rejects.toThrow(
          IneligibleOwnershipRecipientError
        );
      }
    });

    it('allows one open offer at a time', async () => {
      await offer(creatorId);
      await expect(offer(adminId)).rejects.toThrow(ConflictError);
    });

    it('lets a new offer replace an expired one', async () => {
      const first = await offer(creatorId);
      await db
        .update(schema.organizationOwnershipOffers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.organizationOwnershipOffers.id, first.id));

      await expect(offer(adminId)).resolves.toMatchObject({ status: 'open' });
      expect((await offerRow(first.id))?.status).toBe('expired');
    });
  });

  describe('withdraw and decline', () => {
    it('the owner withdraws; no email', async () => {
      const created = await offer();
      await clearEmails();

      const withdrawn = await service.withdrawOwnershipOffer(
        orgId,
        created.id,
        ownerId
      );

      expect(withdrawn).toMatchObject({
        status: 'withdrawn',
        withdrawnReason: 'owner_cancelled',
      });
      expect(await emails()).toHaveLength(0);
      await expect(
        service.acceptOwnershipOffer(orgId, created.id, creatorId)
      ).rejects.toThrow(OwnershipOfferNotOpenError);
    });

    it('only the owner withdraws', async () => {
      const created = await offer();
      await expect(
        service.withdrawOwnershipOffer(orgId, created.id, creatorId)
      ).rejects.toThrow(NotOrganisationOwnerError);
    });

    it('the recipient declines; the owner is emailed', async () => {
      const created = await offer();
      await clearEmails();

      const declined = await service.declineOwnershipOffer(
        orgId,
        created.id,
        creatorId
      );

      expect(declined.status).toBe('declined');
      const sent = await emails();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        templateName: 'ownership-offer-closed',
        userId: ownerId,
        data: { outcome: 'declined' },
      });
      await expectOwnerAndPeriodAgree(ownerId);
    });

    it('only the recipient declines', async () => {
      const created = await offer();
      await expect(
        service.declineOwnershipOffer(orgId, created.id, adminId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('the recipient stops being eligible', () => {
    it('demoting them to member withdraws the offer and tells the owner', async () => {
      const created = await offer();
      await clearEmails();

      await service.updateMemberRole(orgId, creatorId, 'member');

      expect(await offerRow(created.id)).toMatchObject({
        status: 'withdrawn',
        withdrawnReason: 'recipient_ineligible',
      });
      const sent = await emails();
      expect(sent[0]).toMatchObject({
        templateName: 'ownership-offer-closed',
        userId: ownerId,
        data: { outcome: 'withdrawn' },
      });
    });

    it('a change between admin and creator keeps the offer open', async () => {
      const created = await offer();
      await service.updateMemberRole(orgId, creatorId, 'admin');
      expect((await offerRow(created.id))?.status).toBe('open');
    });

    it('removing them withdraws the offer', async () => {
      const created = await offer();
      await service.removeMember(orgId, creatorId);
      expect(await offerRow(created.id)).toMatchObject({
        status: 'withdrawn',
        withdrawnReason: 'recipient_ineligible',
      });
    });
  });

  describe('support reassignment', () => {
    it('moves ownership, withdraws the open offer, and emails the team', async () => {
      const created = await offer();
      await clearEmails();

      const change = await service.reassignOwner(orgId, adminId);

      expect(change).toMatchObject({
        ownerUserId: adminId,
        previousOwnerUserId: ownerId,
      });
      expect(await offerRow(created.id)).toMatchObject({
        status: 'withdrawn',
        withdrawnReason: 'support_reassigned',
      });
      const period = await db.query.organizationOwnershipPeriods.findFirst({
        where: (p, { and, eq, isNull }) =>
          and(eq(p.organizationId, orgId), isNull(p.endedAt)),
      });
      expect(period?.source).toBe('support');
      expect(
        (await emails()).every(
          (e) => e.templateName === 'ownership-transferred'
        )
      ).toBe(true);
      await expectOwnerAndPeriodAgree(adminId);
    });

    it('refuses a member', async () => {
      await expect(service.reassignOwner(orgId, memberId)).rejects.toThrow(
        IneligibleOwnershipRecipientError
      );
      await expectOwnerAndPeriodAgree(ownerId);
    });
  });

  describe('reads', () => {
    it('the owner sees the management fields', async () => {
      const created = await offer();

      const view = await service.getOwnership(orgId, ownerId);

      expect(view.viewerRole).toBe('owner');
      expect(view.owner.userId).toBe(ownerId);
      expect(view.openOffer?.id).toBe(created.id);
      expect(view.eligibleRecipients?.map((r) => r.userId).sort()).toEqual(
        [adminId, creatorId].sort()
      );
      expect(view.lastOutcome).toBeNull();
    });

    it('an admin sees the owner but not the offer or the management fields', async () => {
      await offer();

      const view = await service.getOwnership(orgId, adminId);

      expect(view.viewerRole).toBe('admin');
      expect(view.openOffer).toBeNull();
      expect(view.eligibleRecipients).toBeUndefined();
      expect(view.lastOutcome).toBeUndefined();
    });

    it('the recipient sees their offer, and whether they can be paid', async () => {
      const created = await offer();
      const view = await service.getOwnership(orgId, creatorId);
      expect(view.openOffer?.id).toBe(created.id);
      // No Connect account seeded for them: state 6 prompts payouts setup.
      expect(view.openOffer?.recipient.payoutsReady).toBe(false);
    });

    it("the new owner does not see the previous owner's offer as their outcome", async () => {
      const created = await offer();
      await service.acceptOwnershipOffer(orgId, created.id, creatorId);

      const view = await service.getOwnership(orgId, creatorId);

      expect(view.viewerRole).toBe('owner');
      expect(view.lastOutcome).toBeNull();
    });

    it('a member is refused', async () => {
      await expect(service.getOwnership(orgId, memberId)).rejects.toThrow(
        ForbiddenError
      );
    });

    it('the owner sees an expired offer as the last outcome', async () => {
      const created = await offer();
      await db
        .update(schema.organizationOwnershipOffers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.organizationOwnershipOffers.id, created.id));

      const view = await service.getOwnership(orgId, ownerId);

      expect(view.openOffer).toBeNull();
      expect(view.lastOutcome?.status).toBe('expired');
    });

    it('my-membership carries the pending offer for the recipient only', async () => {
      const created = await offer();

      const recipient = await service.getMyMembership(orgId, creatorId);
      const admin = await service.getMyMembership(orgId, adminId);

      expect(recipient.pendingOwnershipOffer).toMatchObject({
        offerId: created.id,
        offeredByName: expect.any(String),
      });
      expect(admin.pendingOwnershipOffer).toBeNull();
    });

    it('my-membership drops an expired offer from the banner', async () => {
      const created = await offer();
      await db
        .update(schema.organizationOwnershipOffers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.organizationOwnershipOffers.id, created.id));

      const recipient = await service.getMyMembership(orgId, creatorId);

      expect(recipient.pendingOwnershipOffer).toBeNull();
    });
  });
});
