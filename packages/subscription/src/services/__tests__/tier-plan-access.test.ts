/**
 * TierService plan access (Codex-2hxff.91, design §3.3 and §3.4, §2.4 #4-5).
 *
 * Two of the three writers of `content_tier_access` live in TierService:
 * - create with "Include everything from…" copies EXACTLY the source tier's
 *   set (live, gated films of the org; live courses), never on a replay;
 * - delete sweeps the tier's ticks in both tables. Items ONLY in it need a
 *   choice: "keep" leaves them in no tier (a subscribers-only film is then
 *   CLOSED, never free), "move" ticks them on the chosen tiers first. With no
 *   choice while such items exist the delete is refused and nothing changes.
 *
 * DB-backed. Every org and row it writes is its own and is deleted in
 * afterAll.
 */

import {
  content,
  contentTierAccess,
  courses,
  courseTierAccess,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestOrganizationInput,
  createTestTierInput,
  createUniqueSlug,
  gateContentToTiers,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
} from 'vitest';
import { TierHasOnlyItemsError, TierNotFoundError } from '../../errors';
import { TierService } from '../tier-service';

describe('TierService — plan access (Codex-2hxff.91)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: TierService;
  let creatorId: string;
  const orgIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    [creatorId] = (await seedTestUsers(db, 1)) as [string];
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new TierService({ db, dbWs: db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    if (db && orgIds.length > 0) {
      await db.delete(content).where(inArray(content.organizationId, orgIds));
      await db.delete(courses).where(inArray(courses.organizationId, orgIds));
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

  /** An org whose payee has a ready Connect account (createTier needs it). */
  async function org(slug: string): Promise<string> {
    const row = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(slug) }))
        .returning()
    );
    orgIds.push(row.id);
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(row.id, creatorId))
      .onConflictDoUpdate({
        target: stripeConnectAccounts.userId,
        set: { organizationId: row.id },
      });
    await setTestOrganisationPayee(db, row.id, creatorId);
    return row.id;
  }

  async function tier(orgId: string, sortOrder: number): Promise<string> {
    return takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { sortOrder }))
        .returning()
    ).id;
  }

  /** A film in `tierIds` (gated). `tierIds: []` = gated and CLOSED. */
  async function film(
    orgId: string,
    tierIds: string[],
    overrides: Parameters<typeof createTestContentInput>[1] = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            isFree: false,
            isTierGated: true,
            status: 'published',
            publishedAt: new Date(),
            ...overrides,
          })
        )
        .returning()
    );
    await gateContentToTiers(db, {
      contentId: row.id,
      organizationId: orgId,
      tierIds,
    });
    return row.id;
  }

  async function course(
    orgId: string,
    tierIds: string[],
    deleted = false
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('pa-course'),
          title: 'Plan access course',
          ...(deleted ? { deletedAt: new Date() } : {}),
        })
        .returning()
    );
    if (tierIds.length > 0) {
      await db.insert(courseTierAccess).values(
        tierIds.map((tierId) => ({
          courseId: row.id,
          tierId,
          organizationId: orgId,
        }))
      );
    }
    return row.id;
  }

  const filmsIn = async (tierId: string) =>
    (
      await db
        .select({ id: contentTierAccess.contentId })
        .from(contentTierAccess)
        .where(eq(contentTierAccess.tierId, tierId))
    )
      .map((r) => r.id)
      .sort();

  const coursesIn = async (tierId: string) =>
    (
      await db
        .select({ id: courseTierAccess.courseId })
        .from(courseTierAccess)
        .where(eq(courseTierAccess.tierId, tierId))
    )
      .map((r) => r.id)
      .sort();

  const rowOf = async (contentId: string) =>
    takeFirst(
      await db
        .select({
          isTierGated: content.isTierGated,
          isFree: content.isFree,
          isPurchasable: content.isPurchasable,
          legacy: content.legacyIncludedInTierId,
        })
        .from(content)
        .where(eq(content.id, contentId))
    );

  const isLive = async (tierId: string) =>
    (
      await db
        .select({ id: subscriptionTiers.id })
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.id, tierId),
            isNull(subscriptionTiers.deletedAt)
          )
        )
    ).length === 1;

  const input = (copyAccessFromTierId?: string | null) => ({
    submissionId: crypto.randomUUID(),
    name: 'Copied',
    priceMonthly: 1500,
    priceAnnual: 15000,
    ...(copyAccessFromTierId !== undefined ? { copyAccessFromTierId } : {}),
  });

  // ─── create with "Include everything from…" (§3.3) ─────────────────

  describe('createTier with copyAccessFromTierId', () => {
    it('copies EXACTLY the source tier: its live gated films and live courses, nothing else', async () => {
      const orgId = await org('pa-copy');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const proOnly = await film(orgId, [pro]);
      const both = await film(orgId, [basic, pro]);
      await film(orgId, [basic]); // Basic only: not Pro's
      await film(orgId, [pro], { deletedAt: new Date() }); // deleted
      const proCourse = await course(orgId, [pro]);
      await course(orgId, [basic]);
      await course(orgId, [pro], true); // deleted course
      // A raw tick on an UNGATED row (I1 forbids it; the copy must skip it).
      const ungated = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: orgId,
              contentType: 'written',
            })
          )
          .returning()
      );
      await db
        .insert(contentTierAccess)
        .values({ contentId: ungated.id, tierId: pro, organizationId: orgId });

      const created = await service.createTier(orgId, input(pro));

      expect(await filmsIn(created.id)).toEqual([proOnly, both].sort());
      expect(await coursesIn(created.id)).toEqual([proCourse]);
      // The source keeps its own set.
      expect(await filmsIn(pro)).toContain(proOnly);
    });

    it('copies nothing without a source', async () => {
      const orgId = await org('pa-nocopy');
      const pro = await tier(orgId, 1);
      await film(orgId, [pro]);
      await course(orgId, [pro]);

      for (const source of [undefined, null]) {
        const created = await service.createTier(orgId, input(source));
        expect(await filmsIn(created.id)).toEqual([]);
        expect(await coursesIn(created.id)).toEqual([]);
      }
    });

    it('a replay of the same submission returns the first tier and copies nothing again', async () => {
      const orgId = await org('pa-replay');
      const pro = await tier(orgId, 1);
      const proFilm = await film(orgId, [pro]);
      // Stripe answers a repeated idempotency key with the first response.
      const products = stripe.products.create as Mock;
      const firstProduct = products.getMockImplementation();
      const byKey = new Map<string, unknown>();
      products.mockImplementation(
        (params: unknown, options?: { idempotencyKey?: string }) => {
          const key = options?.idempotencyKey ?? crypto.randomUUID();
          if (!byKey.has(key)) byKey.set(key, firstProduct?.(params, options));
          return byKey.get(key);
        }
      );
      const request = input(pro);

      const first = await service.createTier(orgId, request);
      // The creator unticks the copied film before the retry lands.
      await db
        .delete(contentTierAccess)
        .where(eq(contentTierAccess.tierId, first.id));
      const replay = await service.createTier(orgId, request);

      expect(replay.id).toBe(first.id);
      expect(await filmsIn(first.id)).toEqual([]);
      expect(await filmsIn(pro)).toEqual([proFilm]);
    });

    it('refuses a source from another org, or a deleted one, before any Stripe call', async () => {
      const orgId = await org('pa-src');
      const elsewhere = await tier(await org('pa-src-other'), 1);
      const gone = await tier(orgId, 1);
      await db
        .update(subscriptionTiers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(subscriptionTiers.id, gone));

      for (const source of [elsewhere, gone]) {
        await expect(
          service.createTier(orgId, input(source))
        ).rejects.toBeInstanceOf(TierNotFoundError);
      }
      expect(stripe.products.create).not.toHaveBeenCalled();
    });

    it('a source deleted mid-flight is refused inside the transaction: no tier, and the Product is archived', async () => {
      const orgId = await org('pa-midflight');
      const pro = await tier(orgId, 1);
      await film(orgId, [pro]);
      const products = stripe.products.create as Mock;
      const proceed = products.getMockImplementation();
      products.mockImplementation(async (...args: unknown[]) => {
        // Passes the fail-fast check, then the source goes.
        await db
          .update(subscriptionTiers)
          .set({ deletedAt: new Date(), isActive: false })
          .where(eq(subscriptionTiers.id, pro));
        return proceed?.(...args);
      });

      await expect(
        service.createTier(orgId, input(pro))
      ).rejects.toBeInstanceOf(TierNotFoundError);

      const live = await db
        .select({ id: subscriptionTiers.id })
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.organizationId, orgId),
            isNull(subscriptionTiers.deletedAt)
          )
        );
      expect(live).toEqual([]);
      const archived = (stripe.products.update as Mock).mock.calls.filter(
        ([, params]) => params?.active === false
      );
      expect(archived).toHaveLength(1);
    });
  });

  // ─── delete with reassignment (§3.4, §2.4 #4-5) ────────────────────

  describe('deleteTier', () => {
    it('refuses with no choice while items are ONLY here: 409 with the counts, and nothing changes', async () => {
      const orgId = await org('pa-del-refuse');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const onlyHere = await film(orgId, [basic]);
      await film(orgId, [basic, pro]); // also in Pro: not only here
      const onlyHereCourse = await course(orgId, [basic]);

      const error = await service.deleteTier(basic, orgId).catch((e) => e);

      expect(error).toBeInstanceOf(TierHasOnlyItemsError);
      expect(error.context).toEqual({
        tierId: basic,
        filmCount: 1,
        courseCount: 1,
        code: 'TIER_HAS_ONLY_ITEMS',
      });
      expect(await isLive(basic)).toBe(true);
      expect(await filmsIn(basic)).toContain(onlyHere);
      expect(await coursesIn(basic)).toEqual([onlyHereCourse]);
    });

    it('needs no choice when every item is in another tier too; the lowest remaining tier becomes the legacy value', async () => {
      const orgId = await org('pa-del-free');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const shared = await film(orgId, [basic, pro]);
      expect((await rowOf(shared)).legacy).toBe(basic);

      await service.deleteTier(basic, orgId);

      expect(await isLive(basic)).toBe(false);
      expect(await filmsIn(basic)).toEqual([]);
      expect(await filmsIn(pro)).toEqual([shared]);
      expect((await rowOf(shared)).legacy).toBe(pro);
    });

    it('"keep": a subscribers-only film is CLOSED (gated, no tier, not free, legacy kept); a paid film stays for sale; a course is in no tier', async () => {
      const orgId = await org('pa-del-keep');
      const basic = await tier(orgId, 1);
      const subscribersOnly = await film(orgId, [basic]);
      const paid = await film(orgId, [basic], {
        isPurchasable: true,
        priceCents: 900,
      });
      const onlyHereCourse = await course(orgId, [basic]);

      await service.deleteTier(basic, orgId, { onlyHere: 'keep' });

      expect(await rowOf(subscribersOnly)).toEqual({
        isTierGated: true,
        isFree: false,
        isPurchasable: false,
        // Phase 1-2: under old code a NULL here reads as free.
        legacy: basic,
      });
      expect(await rowOf(paid)).toMatchObject({
        isTierGated: true,
        isFree: false,
        isPurchasable: true,
      });
      expect(await filmsIn(basic)).toEqual([]);
      expect(await coursesIn(basic)).toEqual([]);
      expect(
        await db
          .select()
          .from(courseTierAccess)
          .where(eq(courseTierAccess.courseId, onlyHereCourse))
      ).toEqual([]);
    });

    it('"move": the only-here films and courses are ticked on the targets; the old tier\'s ticks are gone from BOTH tables', async () => {
      const orgId = await org('pa-del-move');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const premium = await tier(orgId, 3);
      const onlyHere = await film(orgId, [basic]);
      const onlyHereCourse = await course(orgId, [basic]);

      await service.deleteTier(basic, orgId, {
        onlyHere: 'move',
        moveTo: [pro, premium],
      });

      expect(await filmsIn(pro)).toEqual([onlyHere]);
      expect(await filmsIn(premium)).toEqual([onlyHere]);
      expect(await coursesIn(pro)).toEqual([onlyHereCourse]);
      expect(await coursesIn(premium)).toEqual([onlyHereCourse]);
      expect(await filmsIn(basic)).toEqual([]);
      expect(await coursesIn(basic)).toEqual([]);
      expect((await rowOf(onlyHere)).legacy).toBe(pro);
    });

    it('"move" of more item × target pairs than one VALUES list can bind (65,535 parameters) still lands every tick (L3)', async () => {
      const orgId = await org('pa-del-move-big');
      // 440 films × 50 targets = 22,000 pairs: 66,000 parameters as VALUES.
      const FILMS = 440;
      const TARGETS = 50;
      const tierRows = await db
        .insert(subscriptionTiers)
        .values(
          Array.from({ length: TARGETS + 1 }, (_, i) =>
            createTestTierInput(orgId, {
              name: `Big move ${i + 1}`,
              sortOrder: i + 1,
            })
          )
        )
        .returning({ id: subscriptionTiers.id });
      const [doomed, ...targets] = tierRows.map((t) => t.id) as [
        string,
        ...string[],
      ];
      const filmRows = await db
        .insert(content)
        .values(
          Array.from({ length: FILMS }, () =>
            createTestContentInput(creatorId, {
              organizationId: orgId,
              contentType: 'written',
              isFree: false,
              isTierGated: true,
              status: 'published',
              publishedAt: new Date(),
            })
          )
        )
        .returning({ id: content.id });
      await db.insert(contentTierAccess).values(
        filmRows.map((f) => ({
          contentId: f.id,
          tierId: doomed,
          organizationId: orgId,
        }))
      );

      await service.deleteTier(doomed, orgId, {
        onlyHere: 'move',
        moveTo: targets,
      });

      const [moved] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contentTierAccess)
        .where(inArray(contentTierAccess.tierId, targets));
      expect(moved?.count).toBe(FILMS * TARGETS);
      expect(await filmsIn(doomed)).toEqual([]);
      expect(await isLive(doomed)).toBe(false);
    });

    it("refuses a move to itself or to another org's tier, and nothing changes", async () => {
      const orgId = await org('pa-del-badmove');
      const basic = await tier(orgId, 1);
      const elsewhere = await tier(await org('pa-del-badmove-other'), 1);
      const onlyHere = await film(orgId, [basic]);

      for (const moveTo of [[basic], [elsewhere]]) {
        await expect(
          service.deleteTier(basic, orgId, { onlyHere: 'move', moveTo })
        ).rejects.toBeInstanceOf(ValidationError);
      }
      expect(await isLive(basic)).toBe(true);
      expect(await filmsIn(basic)).toEqual([onlyHere]);
    });

    it("touches no other org's ticks", async () => {
      const orgA = await org('pa-del-scope-a');
      const orgB = await org('pa-del-scope-b');
      const tierA = await tier(orgA, 1);
      const tierB = await tier(orgB, 1);
      const filmB = await film(orgB, [tierB]);

      await service.deleteTier(tierA, orgA);

      expect(await filmsIn(tierB)).toEqual([filmB]);
      expect((await rowOf(filmB)).legacy).toBe(tierB);
    });
  });
});
