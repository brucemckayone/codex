/**
 * Every agreement email opens a page that exists for its recipient
 * (Codex-2hxff.20 AGR-10; docs/payments/agreements.md §Emails):
 *
 * - the owner: their organisation Studio's revenue-share page, on the org's
 *   own subdomain;
 * - the creator: the thread on the creators subdomain, by a PROPOSAL id
 *   (the page reads one), or their negotiations list after a decline.
 *
 * Every link used to be `${WEB_APP_URL}/studio/negotiations/<id>?orgId=…` on
 * the apex host, which has no Studio, and the termination email carried the
 * AGREEMENT's id, which the creator page cannot open.
 *
 * Real DB, inline dispatch (no `waitUntil`), a spy mailer. The local
 * database is shared with other sessions, so every row hangs off this file's
 * own organisations and users, and they are deleted in afterAll.
 */

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { AgreementService } from '../agreement-service';

describe('agreement email links (AGR-10)', () => {
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

  /** An organisation with an owner and one creator, both active members. */
  async function team() {
    const [ownerId, creatorId] = await seedTestUsers(db, 2);
    userIds.push(ownerId, creatorId);
    const slug = createUniqueSlug('agr-links');
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Links Org', slug })
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
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
    ]);
    // A new proposal goes only to a creator account (Codex-2hxff.76).
    await db
      .update(schema.users)
      .set({ role: 'creator' })
      .where(eq(schema.users.id, creatorId));
    return { orgId: org.id, slug, ownerId, creatorId };
  }

  function withMailer(environment = 'test') {
    const mailer = vi.fn();
    const service = new AgreementService({ db, environment, mailer });
    return { service, mailer };
  }

  /** The link in the one email sent to `userId` since the last clear. */
  function linkTo(mailer: Mock, userId: string): string | undefined {
    const calls = mailer.mock.calls.filter(([p]) => p.userId === userId);
    expect(calls).toHaveLength(1);
    return calls[0]?.[0].data.deepLinkUrl;
  }

  const ownerPage = (slug: string) =>
    `http://${slug}.lvh.me:3000/studio/monetisation/revenue-share`;
  const creatorThread = (proposalId: string) =>
    `http://creators.lvh.me:3000/studio/negotiations/${proposalId}`;
  const CREATOR_LIST = 'http://creators.lvh.me:3000/studio/negotiations';

  async function propose(
    service: AgreementService,
    fx: Awaited<ReturnType<typeof team>>
  ) {
    return service.proposeAgreement({
      organizationId: fx.orgId,
      creatorId: fx.creatorId,
      revenueType: 'subscription',
      sharePercent: 3000,
      termMonths: 6,
      proposedByUserId: fx.ownerId,
    });
  }

  it("a proposal sends the creator to the thread, by the proposal's id", async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    expect(linkTo(mailer, fx.creatorId)).toBe(creatorThread(proposal.id));
  });

  it("a creator's counter sends the owner to the organisation's revenue-share page", async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    mailer.mockClear();
    await service.counterPropose({
      proposalId: proposal.id,
      sharePercent: 3500,
      termMonths: 6,
      counteredByUserId: fx.creatorId,
    });
    expect(linkTo(mailer, fx.ownerId)).toBe(ownerPage(fx.slug));
  });

  it('an owner counter sends the creator to the thread', async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    const counter = await service.counterPropose({
      proposalId: proposal.id,
      sharePercent: 3500,
      termMonths: 6,
      counteredByUserId: fx.creatorId,
    });
    mailer.mockClear();
    const ownerCounter = await service.counterPropose({
      proposalId: counter.id,
      sharePercent: 3200,
      termMonths: 6,
      counteredByUserId: fx.ownerId,
    });
    expect(linkTo(mailer, fx.creatorId)).toBe(creatorThread(ownerCounter.id));
  });

  it('an accept sends each side to its own page', async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    mailer.mockClear();
    await service.acceptProposal({
      proposalId: proposal.id,
      acceptedByUserId: fx.creatorId,
    });
    expect(linkTo(mailer, fx.creatorId)).toBe(creatorThread(proposal.id));
    expect(linkTo(mailer, fx.ownerId)).toBe(ownerPage(fx.slug));
  });

  it('a decline sends the creator to the negotiations list, the owner to revenue share', async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    mailer.mockClear();
    await service.declineProposal({
      proposalId: proposal.id,
      declinedByUserId: fx.creatorId,
    });
    // A round-1 decline leaves no open, countered or accepted proposal, and
    // the creator's thread route finds a thread only through one: the
    // thread link would 404, so the list (which shows it under "Past").
    expect(linkTo(mailer, fx.creatorId)).toBe(CREATOR_LIST);
    expect(linkTo(mailer, fx.ownerId)).toBe(ownerPage(fx.slug));
  });

  it("an owner's termination sends the creator to the thread by its PROPOSAL id, not the agreement's", async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    const agreement = await service.acceptProposal({
      proposalId: proposal.id,
      acceptedByUserId: fx.creatorId,
    });
    mailer.mockClear();
    await service.terminateAgreement({
      agreementId: agreement.id,
      terminatedByUserId: fx.ownerId,
    });
    const link = linkTo(mailer, fx.creatorId);
    expect(link).toBe(creatorThread(proposal.id));
    expect(link).not.toContain(agreement.id);
  });

  it("a creator's termination sends the owner to revenue share", async () => {
    const fx = await team();
    const { service, mailer } = withMailer();
    const proposal = await propose(service, fx);
    const agreement = await service.acceptProposal({
      proposalId: proposal.id,
      acceptedByUserId: fx.creatorId,
    });
    mailer.mockClear();
    await service.terminateAgreement({
      agreementId: agreement.id,
      terminatedByUserId: fx.creatorId,
    });
    expect(linkTo(mailer, fx.ownerId)).toBe(ownerPage(fx.slug));
  });

  it('on staging, both sides stay on staging hosts', async () => {
    const fx = await team();
    const { service, mailer } = withMailer('staging');
    const proposal = await propose(service, fx);
    mailer.mockClear();
    await service.acceptProposal({
      proposalId: proposal.id,
      acceptedByUserId: fx.creatorId,
    });
    expect(linkTo(mailer, fx.creatorId)).toBe(
      `https://creators-staging.revelations.studio/studio/negotiations/${proposal.id}`
    );
    expect(linkTo(mailer, fx.ownerId)).toBe(
      `https://${fx.slug}-staging.revelations.studio/studio/monetisation/revenue-share`
    );
  });

  it('an owner whose organisation row is gone gets no email, logged at ERROR with an errorId', async () => {
    // Orgs are soft-deleted and `lookupOrg` reads those too, so a missing
    // row is a data-integrity fault: without it there is no Studio to link
    // the owner to, and someone misses an email.
    const fx = await team();
    const { service, mailer } = withMailer();
    const internals = service as unknown as {
      lookupOrg: (id: string) => Promise<unknown>;
      obs: { error: (msg: string, ctx: unknown) => void };
    };
    const proposal = await propose(service, fx);
    mailer.mockClear();
    vi.spyOn(internals, 'lookupOrg').mockResolvedValue(null);
    const error = vi.spyOn(internals.obs, 'error');

    await service.counterPropose({
      proposalId: proposal.id,
      sharePercent: 3500,
      termMonths: 6,
      counteredByUserId: fx.creatorId,
    });

    expect(mailer).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'agreement notification skipped: organisation not found',
      expect.objectContaining({
        errorId: expect.any(String),
        organizationId: fx.orgId,
        recipientUserId: fx.ownerId,
      })
    );
  });
});
