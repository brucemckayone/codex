/**
 * Plan access on the content write path (Codex-2hxff.91, design §2.4 #6-7,
 * §3.1, owner U2 and U11).
 *
 * The tier SWITCH (`content.is_tier_gated`) is the gate; the ticks
 * (`content_tier_access`) say which tiers open the item. A gated item with
 * no tick is CLOSED, never free. These tests pin the editor's side of that:
 * a partial PATCH never undoes the ticks, the effective-row invariants hold,
 * a foreign or deleted tier writes nothing, publish needs a tick, and a
 * closed item without a price is hidden from public lists.
 *
 * DB-backed. Every row it writes is its own (own orgs, unique slugs) and is
 * deleted in afterAll.
 */

import {
  content,
  contentTierAccess,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  gateContentToTiers,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TierRequiredToPublishError } from '../../errors';
import { ContentService } from '../content-service';

describe('ContentService — plan access (Codex-2hxff.91)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let orgId: string;
  let otherOrgId: string;
  let basicId: string;
  let premiumId: string;
  let deletedTierId: string;
  let foreignTierId: string;
  const orgIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId] = (await seedTestUsers(db, 1)) as [string];
    // Payout-ready, so publish is decided by the tier rule alone.
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));

    for (const _ of [0, 1]) {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({ slug: createUniqueSlug('pa-org') })
          )
          .returning()
      );
      orgIds.push(org.id);
    }
    [orgId, otherOrgId] = orgIds as [string, string];

    const tier = async (org: string, sortOrder: number, deleted = false) =>
      takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org, {
              sortOrder,
              ...(deleted ? { deletedAt: new Date(), isActive: false } : {}),
            })
          )
          .returning()
      ).id;
    basicId = await tier(orgId, 1);
    premiumId = await tier(orgId, 2);
    deletedTierId = await tier(orgId, 3, true);
    foreignTierId = await tier(otherOrgId, 1);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(content).where(inArray(content.organizationId, orgIds));
      await db.delete(content).where(eq(content.creatorId, creatorId));
      await db
        .delete(subscriptionTiers)
        .where(inArray(subscriptionTiers.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));
    }
    await teardownTestDatabase();
  });

  const written = (
    overrides: Partial<CreateContentInput> = {}
  ): CreateContentInput =>
    ({
      organizationId: orgId,
      title: 'Plan access film',
      slug: createUniqueSlug('pa'),
      contentType: 'written',
      contentBody: 'Body',
      priceCents: 0,
      tags: [],
      ...overrides,
    }) as CreateContentInput;

  /** The editor's refusal of a tier outside the org: its id, nothing more. */
  const isTiersNotInOrg = (bad: string) => (error: unknown) =>
    error instanceof ValidationError &&
    JSON.stringify(error.context) === JSON.stringify({ invalidTierIds: [bad] });

  async function ticksOf(contentId: string): Promise<string[]> {
    const rows = await db
      .select({ tierId: contentTierAccess.tierId })
      .from(contentTierAccess)
      .innerJoin(
        subscriptionTiers,
        eq(subscriptionTiers.id, contentTierAccess.tierId)
      )
      .where(eq(contentTierAccess.contentId, contentId))
      .orderBy(asc(subscriptionTiers.sortOrder));
    return rows.map((r) => r.tierId);
  }

  async function rowOf(contentId: string) {
    return takeFirst(
      await db
        .select({
          isTierGated: content.isTierGated,
          isFree: content.isFree,
        })
        .from(content)
        .where(eq(content.id, contentId))
    );
  }

  async function gatedDraft(tierIds: string[]): Promise<string> {
    const created = await service.create(
      written({ isTierGated: true, includedInTierIds: tierIds }),
      creatorId
    );
    return created.id;
  }

  describe('create', () => {
    it('writes the switch and EXACTLY the ticked set (a bundle, not a ladder)', async () => {
      const created = await service.create(
        written({ isTierGated: true, includedInTierIds: [premiumId] }),
        creatorId
      );

      expect(created.isTierGated).toBe(true);
      expect(created.isFree).toBe(false);
      expect(created.includedInTierIds).toEqual([premiumId]);
      expect(await ticksOf(created.id)).toEqual([premiumId]);
    });

    it('expands the LEGACY single tier to that tier and every dearer one', async () => {
      const created = await service.create(
        written({ includedInTierId: basicId }),
        creatorId
      );

      expect(created.isTierGated).toBe(true);
      expect(await ticksOf(created.id)).toEqual([basicId, premiumId]);
      // The phase-1 shim: the lowest ticked tier.
      expect(created.includedInTierId).toBe(basicId);
    });

    it('allows a gated item with no tier: CLOSED, not free', async () => {
      const created = await service.create(
        written({ isTierGated: true, includedInTierIds: [] }),
        creatorId
      );

      expect(created.isTierGated).toBe(true);
      expect(created.isFree).toBe(false);
      expect(await ticksOf(created.id)).toEqual([]);
    });
  });

  describe('a partial PATCH (§2.4 #6)', () => {
    it('without includedInTierIds leaves the ticks', async () => {
      const id = await gatedDraft([basicId, premiumId]);

      const updated = await service.update(id, { title: 'Renamed' }, creatorId);

      expect(updated.includedInTierIds).toEqual([basicId, premiumId]);
      expect(await ticksOf(id)).toEqual([basicId, premiumId]);
    });

    it('includedInTierIds: [] empties them; the item stays gated, closed and NOT free', async () => {
      const id = await gatedDraft([basicId]);

      const updated = await service.update(
        id,
        { includedInTierIds: [] },
        creatorId
      );

      expect(await ticksOf(id)).toEqual([]);
      expect(updated.isTierGated).toBe(true);
      expect(updated.isFree).toBe(false);
      expect(await rowOf(id)).toEqual({ isTierGated: true, isFree: false });
    });

    it('isTierGated: false deletes the ticks (I1)', async () => {
      const id = await gatedDraft([basicId, premiumId]);

      const updated = await service.update(
        id,
        { isTierGated: false },
        creatorId
      );

      expect(updated.isTierGated).toBe(false);
      expect(updated.includedInTierIds).toEqual([]);
      expect(await ticksOf(id)).toEqual([]);
    });

    it('a stated set REPLACES the ticks (no tier implies another)', async () => {
      const id = await gatedDraft([basicId]);

      await service.update(id, { includedInTierIds: [premiumId] }, creatorId);

      expect(await ticksOf(id)).toEqual([premiumId]);
    });
  });

  describe('validation (§2.4 #7) — refused, and nothing written', () => {
    // Functions, because the tier ids exist only once beforeAll has run.
    it.each([
      ['isFree + isTierGated', () => ({ isFree: true, isTierGated: true })],
      [
        'orgless + gated',
        () => ({
          organizationId: undefined,
          isTierGated: true,
          includedInTierIds: [],
        }),
      ],
      [
        'gated + followers',
        () => ({ isTierGated: true, isFollowerGated: true }),
      ],
      ['gated + team', () => ({ isTierGated: true, isTeamOnly: true })],
      ['gated + course-only', () => ({ isTierGated: true, courseOnly: true })],
      [
        'legacy includedInTierId + includedInTierIds',
        () => ({ includedInTierId: basicId, includedInTierIds: [basicId] }),
      ],
    ] as Array<
      [string, () => Partial<CreateContentInput>]
    >)('create: %s', async (_name, overrides) => {
      const input = written(overrides());

      await expect(service.create(input, creatorId)).rejects.toThrow();
      const rows = await db
        .select({ id: content.id })
        .from(content)
        .where(eq(content.slug, input.slug));
      expect(rows).toEqual([]);
    });

    it('a tier from another org, or a deleted tier, is a ValidationError on create', async () => {
      for (const bad of [foreignTierId, deletedTierId]) {
        const input = written({
          isTierGated: true,
          includedInTierIds: [basicId, bad],
        });

        await expect(service.create(input, creatorId)).rejects.toSatisfy(
          isTiersNotInOrg(bad)
        );
        const rows = await db
          .select({ id: content.id })
          .from(content)
          .where(eq(content.slug, input.slug));
        expect(rows).toEqual([]);
      }
    });

    it('a tier from another org, or a deleted tier, is a ValidationError on update, and the ticks stay', async () => {
      const id = await gatedDraft([basicId]);

      for (const bad of [foreignTierId, deletedTierId]) {
        await expect(
          service.update(id, { includedInTierIds: [premiumId, bad] }, creatorId)
        ).rejects.toSatisfy(isTiersNotInOrg(bad));
      }
      expect(await ticksOf(id)).toEqual([basicId]);
    });

    it('a partial that makes the EFFECTIVE row gated and free is refused (I2)', async () => {
      const id = await gatedDraft([basicId]);

      await expect(
        service.update(id, { isFree: true }, creatorId)
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await rowOf(id)).toEqual({ isTierGated: true, isFree: false });
    });

    it('a partial that adds a follower gate to a gated row is refused (I4)', async () => {
      const id = await gatedDraft([basicId]);

      await expect(
        service.update(id, { isFollowerGated: true }, creatorId)
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await ticksOf(id)).toEqual([basicId]);
    });
  });

  describe('publish (owner U2)', () => {
    it('refuses subscriber content with no tier ticked, with a code the web matches', async () => {
      const id = await gatedDraft([]);

      const error = await service.publish(id, creatorId).catch((e) => e);

      expect(error).toBeInstanceOf(TierRequiredToPublishError);
      expect(error.context).toEqual({
        contentId: id,
        code: 'TIER_REQUIRED_TO_PUBLISH',
      });
      expect((await service.get(id, creatorId))?.status).toBe('draft');
    });

    it('a tick on a DELETED tier does not count', async () => {
      const id = await gatedDraft([basicId]);
      // A raw tick on a deleted tier (the sweep would remove it; this proves
      // the check reads live tiers only, should one ever survive).
      await db.insert(contentTierAccess).values({
        contentId: id,
        tierId: deletedTierId,
        organizationId: orgId,
      });
      await db
        .delete(contentTierAccess)
        .where(eq(contentTierAccess.tierId, basicId));

      await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
        TierRequiredToPublishError
      );
    });

    it('publishes once a tier is ticked; publish and unpublish both return the tiers', async () => {
      const id = await gatedDraft([premiumId]);

      const published = await service.publish(id, creatorId);
      expect(published.status).toBe('published');
      expect(published.includedInTierIds).toEqual([premiumId]);
      const unpublished = await service.unpublish(id, creatorId);
      expect(unpublished.includedInTierIds).toEqual([premiumId]);
      expect(unpublished.includedInTierId).toBe(premiumId);
    });

    it('a PAID item behind the switch with no tier may publish: it is on sale', async () => {
      const created = await service.create(
        written({
          isPurchasable: true,
          priceCents: 900,
          isTierGated: true,
          includedInTierIds: [],
        }),
        creatorId
      );

      expect((await service.publish(created.id, creatorId)).status).toBe(
        'published'
      );
    });
  });

  describe('public lists hide a CLOSED item without a price (owner U11)', () => {
    async function publishedWith(opts: {
      tierIds: string[];
      priceCents?: number;
    }): Promise<{ id: string; slug: string }> {
      const priced = (opts.priceCents ?? 0) > 0;
      const created = await service.create(
        written({
          isTierGated: true,
          includedInTierIds: [basicId],
          ...(priced
            ? { isPurchasable: true, priceCents: opts.priceCents }
            : {}),
        }),
        creatorId
      );
      await service.publish(created.id, creatorId);
      // The tier rule applies at publish; what the list sees is the set the
      // item has NOW (a delete with "keep" can empty it while published).
      await gateContentToTiers(db, {
        contentId: created.id,
        organizationId: orgId,
        tierIds: opts.tierIds,
      });
      return { id: created.id, slug: created.slug };
    }

    const listIds = async () =>
      (
        await service.listPublic({
          orgId,
          page: 1,
          limit: 100,
          sort: 'oldest',
        })
      ).items.map((i) => i.id);

    it('closed, no price: hidden from the catalogue; its own page still loads', async () => {
      const closed = await publishedWith({ tierIds: [] });

      expect(await listIds()).not.toContain(closed.id);
      const bySlug = await service.listPublic({
        orgId,
        slug: closed.slug,
        page: 1,
        limit: 1,
        sort: 'oldest',
      });
      expect(bySlug.items.map((i) => i.id)).toEqual([closed.id]);
      expect(bySlug.items[0]?.includedInTierIds).toEqual([]);
    });

    it('closed WITH a price stays listed (it is a paid item); a ticked item is listed', async () => {
      const pricedClosed = await publishedWith({
        tierIds: [],
        priceCents: 900,
      });
      const ticked = await publishedWith({ tierIds: [premiumId] });

      const ids = await listIds();
      expect(ids).toContain(pricedClosed.id);
      expect(ids).toContain(ticked.id);
      const tickedRow = (
        await service.listPublic({
          orgId,
          slug: ticked.slug,
          page: 1,
          limit: 1,
          sort: 'oldest',
        })
      ).items[0];
      expect(tickedRow?.includedInTierIds).toEqual([premiumId]);
    });
  });

  describe('a tick on a SWITCHED-OFF tier opens the item to nobody new (owner U13)', () => {
    // Its own org, so the inactive tier never joins the ladder the legacy
    // expansion above reads.
    let u13OrgId: string;
    let activeId: string;
    let inactiveId: string;
    let deletedId: string;

    beforeAll(async () => {
      u13OrgId = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({ slug: createUniqueSlug('pa-u13') })
          )
          .returning()
      ).id;
      orgIds.push(u13OrgId);
      const tier = async (
        sortOrder: number,
        overrides: { isActive?: boolean; deletedAt?: Date } = {}
      ) =>
        takeFirst(
          await db
            .insert(subscriptionTiers)
            .values(createTestTierInput(u13OrgId, { sortOrder, ...overrides }))
            .returning()
        ).id;
      activeId = await tier(1);
      inactiveId = await tier(2, { isActive: false });
      // Deleted with `is_active` still on, a row no delete writes (it clears
      // both), so the test pins the deleted_at check on its own.
      deletedId = await tier(3, { deletedAt: new Date() });
    });

    /** Published on the active tier, then given exactly `tierIds`. */
    async function publishedOn(
      tierIds: string[],
      priceCents = 0
    ): Promise<string> {
      const created = await service.create(
        written({
          organizationId: u13OrgId,
          isTierGated: true,
          includedInTierIds: [activeId],
          ...(priceCents > 0 ? { isPurchasable: true, priceCents } : {}),
        }),
        creatorId
      );
      await service.publish(created.id, creatorId);
      // A raw write: the editor refuses a deleted tier, but a tick on one
      // must still open nothing should it ever survive the delete's sweep.
      await gateContentToTiers(db, {
        contentId: created.id,
        organizationId: u13OrgId,
        tierIds,
      });
      return created.id;
    }

    /** What both catalogues list: the public list and the signed-in browse. */
    async function catalogues(): Promise<{
      listed: string[];
      browsed: string[];
    }> {
      const listed = await service.listPublic({
        orgId: u13OrgId,
        page: 1,
        limit: 100,
        sort: 'oldest',
      });
      const browsed = await service.list(
        creatorId,
        { organizationId: u13OrgId, status: 'published' },
        { page: 1, limit: 100 },
        { scope: 'browse' }
      );
      return {
        listed: listed.items.map((i) => i.id),
        browsed: browsed.items.map((i) => i.id),
      };
    }

    it('ticked only on an inactive tier, no price: hidden from both catalogues', async () => {
      const id = await publishedOn([inactiveId]);

      const { listed, browsed } = await catalogues();
      expect(listed).not.toContain(id);
      expect(browsed).not.toContain(id);
    });

    it('ticked only on a soft-deleted tier, no price: hidden from both catalogues', async () => {
      const id = await publishedOn([deletedId]);

      const { listed, browsed } = await catalogues();
      expect(listed).not.toContain(id);
      expect(browsed).not.toContain(id);
    });

    it('listed once an ACTIVE tick is added, and the set still names the inactive tier', async () => {
      const id = await publishedOn([inactiveId]);
      expect((await catalogues()).listed).not.toContain(id);

      await gateContentToTiers(db, {
        contentId: id,
        organizationId: u13OrgId,
        tierIds: [activeId, inactiveId],
      });

      const { listed, browsed } = await catalogues();
      expect(listed).toContain(id);
      expect(browsed).toContain(id);
      // The wire keeps every live tick: the inactive tier's members still see
      // "Included", and the web names only the tiers on sale.
      const row = (
        await service.listPublic({
          orgId: u13OrgId,
          page: 1,
          limit: 100,
          sort: 'oldest',
        })
      ).items.find((i) => i.id === id);
      expect([...(row?.includedInTierIds ?? [])].sort()).toEqual(
        [activeId, inactiveId].sort()
      );
    });

    it('ticked only on an inactive tier WITH a price: listed, as any paid item', async () => {
      const id = await publishedOn([inactiveId], 900);

      const { listed, browsed } = await catalogues();
      expect(listed).toContain(id);
      expect(browsed).toContain(id);
    });
  });
});
