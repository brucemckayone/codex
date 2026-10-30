/**
 * Plan access, the reading side (Codex-2hxff.91, design §2.4, §3.5, §4.2).
 *
 * A content item is behind tiers when its tier SWITCH (`is_tier_gated`) is
 * on; the tiers that open it are its ticks (`content_tier_access`), a SET (a
 * dearer tier is not implied). A gated item with NO tick is CLOSED: no
 * subscriber reaches it, and it is never free.
 *
 * Covered here, against REAL Postgres:
 * - §2.4 #1 the closed item, #2 the bundle, #3 decision = library (property),
 *   #8 the composite FKs and the org-change trigger;
 * - §3.5 the checklist write (idempotent delta, ineligible ids, payouts,
 *   paid → switch on, closedNow), §4.2 the summary and the delete impact.
 *
 * Every row it writes is its own (own orgs) and is deleted in afterAll.
 */

import { isPublicContent } from '@codex/constants';
import { ContentService, CreatorPayoutsRequiredError } from '@codex/content';
import {
  content,
  contentTierAccess,
  courseStages,
  courses,
  courseTierAccess,
  entitlements,
  organizationMemberships,
  organizations,
  stagePractices,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import { ValidationError } from '@codex/service-errors';
import {
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMoneyDeps,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  gateContentToTiers,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';
import { PlanAccessService } from '../plan-access-service';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY);

describe('plan access — decision, library, checklist (Codex-2hxff.91)', () => {
  let db: Database;
  let access: ContentAccessService;
  let plans: PlanAccessService;
  let contentService: ContentService;
  let creatorId: string;
  let unpaidCreatorId: string;
  const orgIds: string[] = [];
  const orphanContentIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, unpaidCreatorId] = (await seedTestUsers(db, 2)) as [
      string,
      string,
    ];
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));

    const purchaseService = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      {} as Stripe
    );
    const r2 = new Proxy(
      {},
      {
        get: () => {
          throw new Error('signing ran: written content has nothing to sign');
        },
      }
    ) as R2;
    access = new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });
    plans = new PlanAccessService({ db, environment: 'test' });
    contentService = new ContentService({ db, environment: 'test' });
  });

  afterAll(async () => {
    if (db) {
      if (orgIds.length > 0) {
        await db
          .delete(subscriptions)
          .where(inArray(subscriptions.organizationId, orgIds));
        await db
          .delete(entitlements)
          .where(inArray(entitlements.organizationId, orgIds));
        await db.delete(content).where(inArray(content.organizationId, orgIds));
        await db.delete(courses).where(inArray(courses.organizationId, orgIds));
        await db
          .delete(subscriptionTiers)
          .where(inArray(subscriptionTiers.organizationId, orgIds));
        await db
          .delete(organizationMemberships)
          .where(inArray(organizationMemberships.organizationId, orgIds));
        await db.delete(organizations).where(inArray(organizations.id, orgIds));
      }
      if (orphanContentIds.length > 0) {
        await db.delete(content).where(inArray(content.id, orphanContentIds));
      }
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ───────────────────────────────────────────────────────────

  async function org(slug: string): Promise<string> {
    const row = takeFirst(
      await db
        .insert(organizations)
        .values({ name: `Plan access ${slug}`, slug: createUniqueSlug(slug) })
        .returning({ id: organizations.id })
    );
    orgIds.push(row.id);
    return row.id;
  }

  async function tier(
    orgId: string,
    sortOrder: number,
    overrides: Parameters<typeof createTestTierInput>[1] = {}
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { sortOrder, ...overrides }))
        .returning({ id: subscriptionTiers.id })
    ).id;
  }

  /** A written film; `tierIds` puts it behind the switch on exactly those. */
  async function film(
    orgId: string,
    opts: {
      tierIds?: string[];
      creator?: string;
    } & Parameters<typeof createTestContentInput>[1] = {}
  ): Promise<string> {
    const { tierIds, creator, ...overrides } = opts;
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creator ?? creatorId, {
            organizationId: orgId,
            contentType: 'written',
            contentBody: 'The body',
            status: 'published',
            publishedAt: daysAgo(30),
            isFree: tierIds === undefined,
            ...(tierIds !== undefined ? { isTierGated: true } : {}),
            ...overrides,
          })
        )
        .returning({ id: content.id })
    );
    if (tierIds !== undefined) {
      await gateContentToTiers(db, {
        contentId: row.id,
        organizationId: orgId,
        tierIds,
      });
    }
    return row.id;
  }

  async function subscriber(
    orgId: string,
    tierId: string,
    periodStart = daysAgo(20)
  ): Promise<string> {
    const [userId] = (await seedTestUsers(db, 1)) as [string];
    await db.insert(subscriptions).values(
      createTestSubscriptionInput(userId, orgId, tierId, {
        currentPeriodStart: periodStart,
        currentPeriodEnd: daysFromNow(10),
      })
    );
    return userId;
  }

  async function libraryIds(userId: string, orgId: string) {
    const result = await access.listUserLibrary(userId, {
      page: 1,
      limit: 100,
      organizationId: orgId,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType: 'subscription',
      search: '',
    });
    return result.items.map((i) => i.content.id);
  }

  async function ticksOf(contentId: string): Promise<string[]> {
    return (
      await db
        .select({ tierId: contentTierAccess.tierId })
        .from(contentTierAccess)
        .where(eq(contentTierAccess.contentId, contentId))
    )
      .map((r) => r.tierId)
      .sort();
  }

  // ── §2.4 #1 the closed item ────────────────────────────────────────────

  describe('a CLOSED item (gated, no tier)', () => {
    let orgId: string;
    let closed: string;
    let tierIds: string[];

    beforeAll(async () => {
      orgId = await org('closed');
      tierIds = [await tier(orgId, 1), await tier(orgId, 2)];
      closed = await film(orgId, { tierIds: [] });
    });

    it('denies anonymous, a non-subscriber, and a subscriber on EVERY tier', async () => {
      const [outsider] = (await seedTestUsers(db, 1)) as [string];
      expect(await access.canView(null, closed)).toBe(false);
      expect(await access.canView(outsider, closed)).toBe(false);
      for (const t of tierIds) {
        const sub = await subscriber(orgId, t);
        expect(await access.canView(sub, closed)).toBe(false);
        expect(await libraryIds(sub, orgId)).not.toContain(closed);
      }
    });

    it('grants a buyer, a support grant, a course owner and a team member', async () => {
      const [buyer, granted, courseOwner, teammate] = (await seedTestUsers(
        db,
        4
      )) as [string, string, string, string];
      await db.insert(entitlements).values([
        {
          userId: buyer,
          organizationId: orgId,
          contentId: closed,
          source: 'content_purchase',
        },
        {
          userId: granted,
          organizationId: orgId,
          contentId: closed,
          source: 'grant',
          grantedByUserId: creatorId,
        },
      ]);
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('closed-course'),
            title: 'A course with the closed practice',
            status: 'published',
          })
          .returning({ id: courses.id })
      );
      const stage = takeFirst(
        await db
          .insert(courseStages)
          .values({ courseId: course.id, name: 'Stage 1', sortOrder: 1 })
          .returning({ id: courseStages.id })
      );
      await db
        .insert(stagePractices)
        .values({ stageId: stage.id, contentId: closed, sortOrder: 0 });
      await db.insert(entitlements).values({
        userId: courseOwner,
        organizationId: orgId,
        courseId: course.id,
        source: 'course_purchase',
      });
      await db.insert(organizationMemberships).values({
        userId: teammate,
        organizationId: orgId,
        role: 'admin',
        status: 'active',
      });

      for (const user of [buyer, granted, courseOwner, teammate]) {
        expect(await access.canView(user, closed)).toBe(true);
      }
    });

    it('is never public, and the public list carries no body for it', async () => {
      const row = takeFirst(
        await db.select().from(content).where(eq(content.id, closed))
      );
      expect(isPublicContent(row)).toBe(false);
      expect(row.isFree).toBe(false);

      const bySlug = await contentService.listPublic({
        orgId,
        slug: row.slug,
        page: 1,
        limit: 1,
        sort: 'oldest',
      });
      expect(bySlug.items).toHaveLength(1);
      expect(bySlug.items[0]?.contentBody ?? null).toBeNull();
      expect(bySlug.items[0]?.contentBodyJson ?? null).toBeNull();
    });
  });

  // ── §2.4 #2 the bundle ─────────────────────────────────────────────────

  it('a BUNDLE [Basic, Premium] skips Pro, though Pro is dearer than Basic — decision and library agree', async () => {
    const orgId = await org('bundle');
    const basic = await tier(orgId, 1, { priceMonthly: 500 });
    const pro = await tier(orgId, 2, { priceMonthly: 1000 });
    const premium = await tier(orgId, 3, { priceMonthly: 2000 });
    const item = await film(orgId, { tierIds: [basic, premium] });

    const verdicts: Record<string, [boolean, boolean]> = {};
    for (const [name, t] of [
      ['basic', basic],
      ['pro', pro],
      ['premium', premium],
    ] as const) {
      const sub = await subscriber(orgId, t);
      verdicts[name] = [
        await access.canView(sub, item),
        (await libraryIds(sub, orgId)).includes(item),
      ];
    }

    expect(verdicts).toEqual({
      basic: [true, true],
      pro: [false, false],
      premium: [true, true],
    });
  });

  // ── owner U13: a switched-off tier ─────────────────────────────────────

  it('a film ticked only on a SWITCHED-OFF tier: its members still watch it and keep it in their library, nobody else gets in, and the catalogue hides it (owner U13)', async () => {
    const orgId = await org('switched-off');
    const onSale = await tier(orgId, 1);
    const switchedOff = await tier(orgId, 2, { isActive: false });
    const item = await film(orgId, { tierIds: [switchedOff] });
    const member = await subscriber(orgId, switchedOff);
    const otherMember = await subscriber(orgId, onSale);

    expect(await access.canView(member, item)).toBe(true);
    expect(await libraryIds(member, orgId)).toContain(item);
    expect(await access.canView(otherMember, item)).toBe(false);
    expect(await libraryIds(otherMember, orgId)).not.toContain(item);
    // Closed to new viewers: no price, and no tier anyone can join.
    const listed = await contentService.listPublic({
      orgId,
      page: 1,
      limit: 100,
      sort: 'oldest',
    });
    expect(listed.items.map((i) => i.id)).not.toContain(item);
  });

  // ── §2.4 #3 decision = library, property style ─────────────────────────

  it('for every tier × every subset of three tiers × {published, off sale in period, off sale before period}: the library lists it ⇔ the decision grants it', async () => {
    const orgId = await org('property');
    const tiers = [
      await tier(orgId, 1),
      await tier(orgId, 2),
      await tier(orgId, 3),
    ];
    const subs = await Promise.all(tiers.map((t) => subscriber(orgId, t)));
    const states = {
      published: { status: 'published', offSaleAt: null },
      offSaleInPeriod: { status: 'archived', offSaleAt: daysAgo(5) },
      offSaleBeforePeriod: { status: 'archived', offSaleAt: daysAgo(25) },
    } as const;

    const items: Array<{ id: string; set: string[]; state: string }> = [];
    for (let mask = 0; mask < 8; mask += 1) {
      const set = tiers.filter((_, i) => mask & (1 << i));
      for (const [state, flags] of Object.entries(states)) {
        items.push({
          id: await film(orgId, { tierIds: set, ...flags }),
          set,
          state,
        });
      }
    }

    let granted = 0;
    for (const [i, sub] of subs.entries()) {
      const shelf = new Set(await libraryIds(sub, orgId));
      for (const item of items) {
        const decision = await access.canView(sub, item.id);
        const expected =
          item.set.includes(tiers[i] as string) &&
          item.state !== 'offSaleBeforePeriod';
        expect({ ...item, sub: i, decision }).toEqual({
          ...item,
          sub: i,
          decision: expected,
        });
        expect({ ...item, sub: i, listed: shelf.has(item.id) }).toEqual({
          ...item,
          sub: i,
          listed: decision,
        });
        if (decision) granted += 1;
      }
    }
    // Not vacuous: each tier is in 4 of the 8 sets × 2 open states.
    expect(granted).toBe(3 * 4 * 2);
  });

  // ── §2.4 #8 the FKs and the org-change trigger ─────────────────────────

  describe('the composite FKs (§2.4 #8)', () => {
    it('refuse a cross-org tick, either way round, with 23503', async () => {
      const orgA = await org('fk-a');
      const orgB = await org('fk-b');
      const tierB = await tier(orgB, 1);
      const filmA = await film(orgA, { tierIds: [] });

      for (const organizationId of [orgA, orgB]) {
        const error = await db
          .insert(contentTierAccess)
          .values({ contentId: filmA, tierId: tierB, organizationId })
          .catch((e: unknown) => e);
        const pg = (error as { cause?: { code?: string } }).cause ?? error;
        expect((pg as { code?: string }).code).toBe('23503');
      }
      expect(await ticksOf(filmA)).toEqual([]);
    });

    it('an org HARD delete with ticks succeeds; the item keeps its switch (orgless-denied, never free)', async () => {
      const orgId = await org('hard-delete');
      const t = await tier(orgId, 1);
      const item = await film(orgId, { tierIds: [t] });
      orphanContentIds.push(item);

      await db.delete(organizations).where(eq(organizations.id, orgId));

      const row = takeFirst(
        await db
          .select({
            organizationId: content.organizationId,
            isTierGated: content.isTierGated,
            isFree: content.isFree,
          })
          .from(content)
          .where(eq(content.id, item))
      );
      expect(row).toEqual({
        organizationId: null,
        isTierGated: true,
        isFree: false,
      });
      expect(await ticksOf(item)).toEqual([]);
      const [anyone] = (await seedTestUsers(db, 1)) as [string];
      expect(await access.canView(anyone, item)).toBe(false);
    });
  });

  // ── §3.5 the checklist write ───────────────────────────────────────────

  describe('PlanAccessService.setTierItems', () => {
    const none = { contentIds: [] as string[], courseIds: [] as string[] };

    it('is an idempotent delta: a replay leaves the same ticks and totals', async () => {
      const orgId = await org('delta');
      const basic = await tier(orgId, 1);
      const a = await film(orgId, { tierIds: [] });
      const b = await film(orgId, { tierIds: [basic] });
      const c = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('delta-course'),
            title: 'Delta course',
          })
          .returning({ id: courses.id })
      ).id;
      const delta = {
        add: { contentIds: [a], courseIds: [c] },
        remove: { contentIds: [b], courseIds: [] },
      };

      const first = await plans.setTierItems(orgId, basic, delta);
      const replay = await plans.setTierItems(orgId, basic, delta);

      expect(first).toEqual({
        films: 1,
        courses: 1,
        closedNow: { contentIds: [b] },
      });
      expect(replay).toEqual(first);
      expect(await ticksOf(a)).toEqual([basic]);
      expect(await ticksOf(b)).toEqual([]);
    });

    it('refuses ids it cannot include (free, followers, team, another org, deleted), naming them, and writes nothing', async () => {
      const orgId = await org('ineligible');
      const otherOrg = await org('ineligible-other');
      const basic = await tier(orgId, 1);
      const ok = await film(orgId, { tierIds: [] });
      const free = await film(orgId);
      const followers = await film(orgId, {
        isFree: false,
        isFollowerGated: true,
      });
      const team = await film(orgId, { isFree: false, isTeamOnly: true });
      const foreign = await film(otherOrg, { tierIds: [] });
      const deleted = await film(orgId, {
        tierIds: [],
        deletedAt: new Date(),
      });
      const deletedCourse = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('deleted-course'),
            title: 'Gone',
            deletedAt: new Date(),
          })
          .returning({ id: courses.id })
      ).id;
      const bad = [free, followers, team, foreign, deleted];

      const error = await plans
        .setTierItems(orgId, basic, {
          add: { contentIds: [ok, ...bad], courseIds: [deletedCourse] },
          remove: none,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).context).toEqual({
        invalidContentIds: bad,
        invalidCourseIds: [deletedCourse],
      });
      expect(await ticksOf(ok)).toEqual([]);
    });

    it('checks payouts only for a PUBLISHED item being added', async () => {
      const orgId = await org('payouts');
      const basic = await tier(orgId, 1);
      const published = await film(orgId, {
        tierIds: [],
        creator: unpaidCreatorId,
      });
      const draft = await film(orgId, {
        tierIds: [],
        creator: unpaidCreatorId,
        status: 'draft',
        publishedAt: null,
      });
      const alreadyIn = await film(orgId, {
        tierIds: [basic],
        creator: unpaidCreatorId,
      });
      const payable = await film(orgId, { tierIds: [] });

      const refusal = await plans
        .setTierItems(orgId, basic, {
          add: { contentIds: [published, payable], courseIds: [] },
          remove: none,
        })
        .catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(CreatorPayoutsRequiredError);
      // The context reaches the client: it names the refused ITEMS, never the
      // creator, who is another member of the team (review L5).
      const context = (refusal as CreatorPayoutsRequiredError).context;
      expect(context).toEqual({
        accessType: 'included_in_tier',
        contentIds: [published],
        courseIds: [],
        code: 'CREATOR_CONNECT_REQUIRED',
      });
      expect(JSON.stringify(context)).not.toContain(unpaidCreatorId);
      expect(await ticksOf(published)).toEqual([]);
      expect(await ticksOf(payable)).toEqual([]);

      // A draft is left to publish(); a re-add of a ticked item adds nothing.
      await expect(
        plans.setTierItems(orgId, basic, {
          add: { contentIds: [draft, alreadyIn], courseIds: [] },
          remove: none,
        })
      ).resolves.toMatchObject({ films: 2 });
    });

    it("turns a PAID film's switch on when added; removing never turns it off", async () => {
      const orgId = await org('paid-switch');
      const basic = await tier(orgId, 1);
      const paid = await film(orgId, {
        isFree: false,
        isPurchasable: true,
        priceCents: 900,
      });
      const switchOf = async () =>
        takeFirst(
          await db
            .select({
              isTierGated: content.isTierGated,
              isFree: content.isFree,
            })
            .from(content)
            .where(eq(content.id, paid))
        );

      await plans.setTierItems(orgId, basic, {
        add: { contentIds: [paid], courseIds: [] },
        remove: none,
      });
      expect(await switchOf()).toEqual({ isTierGated: true, isFree: false });

      const removed = await plans.setTierItems(orgId, basic, {
        add: none,
        remove: { contentIds: [paid], courseIds: [] },
      });
      expect(await switchOf()).toEqual({ isTierGated: true, isFree: false });
      // On sale, so not closed by the removal.
      expect(removed.closedNow.contentIds).toEqual([]);
    });

    it('names in closedNow only the subscribers-only films the request left in no tier', async () => {
      const orgId = await org('closed-now');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const onlyBasic = await film(orgId, { tierIds: [basic] });
      const alsoPro = await film(orgId, { tierIds: [basic, pro] });

      const result = await plans.setTierItems(orgId, basic, {
        add: none,
        remove: { contentIds: [onlyBasic, alsoPro], courseIds: [] },
      });

      expect(result.closedNow.contentIds).toEqual([onlyBasic]);
      expect(result.films).toBe(0);
    });

    it("refuses a deleted tier or another org's tier", async () => {
      const orgId = await org('dead-tier');
      const otherOrg = await org('dead-tier-other');
      const gone = await tier(orgId, 1, { deletedAt: new Date() });
      const foreign = await tier(otherOrg, 1);
      const item = await film(orgId, { tierIds: [] });

      for (const t of [gone, foreign]) {
        await expect(
          plans.setTierItems(orgId, t, {
            add: { contentIds: [item], courseIds: [] },
            remove: none,
          })
        ).rejects.toMatchObject({
          context: { tierId: t, code: 'TIER_NOT_FOUND' },
        });
      }
      expect(await ticksOf(item)).toEqual([]);
    });

    // ── races (review L1, L2): a held transaction stands in for the other
    // writer, holding the lock that writer takes, until it is released.

    type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

    /**
     * Runs `hold` in its own transaction, then waits for `release()` before
     * `finish` and the commit. `held` resolves once `hold` has run.
     */
    function heldTransaction(
      hold: (tx: Tx) => Promise<unknown>,
      finish: (tx: Tx) => Promise<unknown> = async () => {}
    ) {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready = () => {};
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = db.transaction(async (tx) => {
        await hold(tx);
        ready();
        await released;
        await finish(tx);
      });
      return { held, release, done };
    }

    /** 'waiting' when `promise` is still pending after 750 ms. */
    const stateAfterAWhile = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => 'finished',
          () => 'finished'
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('waiting'), 750)
        ),
      ]);

    it('a removal racing a delete of another tier the item is in waits for it, then names the item it closed (L1)', async () => {
      const orgId = await org('race-delete');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const item = await film(orgId, { tierIds: [basic, pro] });

      // Pro's delete, as deleteTier runs it: the tier FOR UPDATE first;
      // once released, the films ticked there, the sweep and the soft delete.
      const deleting = heldTransaction(
        (tx) =>
          tx
            .select({ id: subscriptionTiers.id })
            .from(subscriptionTiers)
            .where(eq(subscriptionTiers.id, pro))
            .for('update'),
        async (tx) => {
          await tx
            .select({ id: content.id })
            .from(content)
            .where(eq(content.id, item))
            .for('no key update');
          await tx
            .delete(contentTierAccess)
            .where(eq(contentTierAccess.tierId, pro));
          await tx
            .update(subscriptionTiers)
            .set({ deletedAt: new Date(), isActive: false })
            .where(eq(subscriptionTiers.id, pro));
        }
      );
      await deleting.held;
      const saving = plans.setTierItems(orgId, basic, {
        add: none,
        remove: { contentIds: [item], courseIds: [] },
      });
      const early = await stateAfterAWhile(saving);
      deleting.release();
      await deleting.done;

      expect(early).toBe('waiting');
      expect((await saving).closedNow.contentIds).toEqual([item]);
      expect(await ticksOf(item)).toEqual([]);
    });

    it("a course removal waits the same way for a delete of the course's other tier (L1)", async () => {
      const orgId = await org('race-delete-course');
      const basic = await tier(orgId, 1);
      const pro = await tier(orgId, 2);
      const courseId = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('race-course'),
            title: 'Race course',
          })
          .returning({ id: courses.id })
      ).id;
      await db.insert(courseTierAccess).values(
        [basic, pro].map((tierId) => ({
          courseId,
          tierId,
          organizationId: orgId,
        }))
      );

      const deleting = heldTransaction((tx) =>
        tx
          .select({ id: subscriptionTiers.id })
          .from(subscriptionTiers)
          .where(eq(subscriptionTiers.id, pro))
          .for('update')
      );
      await deleting.held;
      const saving = plans.setTierItems(orgId, basic, {
        add: none,
        remove: { contentIds: [], courseIds: [courseId] },
      });
      const early = await stateAfterAWhile(saving);
      deleting.release();
      await deleting.done;

      expect(early).toBe('waiting');
      await expect(saving).resolves.toMatchObject({ courses: 0 });
    });

    it('an editor save that makes a paid film team-only first: the checklist waits, re-checks and refuses it, and never turns its switch on (L2)', async () => {
      const orgId = await org('race-editor');
      const basic = await tier(orgId, 1);
      const paid = await film(orgId, {
        isFree: false,
        isPurchasable: true,
        priceCents: 900,
      });

      // The editor's UPDATE of the row, committed once released.
      const editing = heldTransaction((tx) =>
        tx
          .update(content)
          .set({ isTeamOnly: true, isPurchasable: false, priceCents: null })
          .where(eq(content.id, paid))
      );
      await editing.held;
      const saving = plans.setTierItems(orgId, basic, {
        add: { contentIds: [paid], courseIds: [] },
        remove: none,
      });
      const early = await stateAfterAWhile(saving);
      editing.release();
      await editing.done;

      expect(early).toBe('waiting');
      const error = await saving.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).context).toMatchObject({
        invalidContentIds: [paid],
      });
      const row = takeFirst(
        await db
          .select({ isTierGated: content.isTierGated })
          .from(content)
          .where(eq(content.id, paid))
      );
      expect(row.isTierGated).toBe(false);
      expect(await ticksOf(paid)).toEqual([]);
    });
  });

  // ── §4.2 summary and delete impact ─────────────────────────────────────

  describe('the summary and the delete impact', () => {
    let orgId: string;
    let basic: string;
    let pro: string;
    let inactive: string;
    let onlyBasic: string;
    let shared: string;
    let basicCourse: string;

    beforeAll(async () => {
      orgId = await org('summary');
      basic = await tier(orgId, 1, { priceMonthly: 500 });
      pro = await tier(orgId, 2, { priceMonthly: 1000 });
      inactive = await tier(orgId, 3, { priceMonthly: 1500, isActive: false });
      onlyBasic = await film(orgId, {
        tierIds: [basic],
        title: 'A only basic',
      });
      shared = await film(orgId, { tierIds: [basic, pro], title: 'B shared' });
      await film(orgId, { tierIds: [] }); // closed
      await film(orgId, {
        isFree: false,
        isPurchasable: true,
        priceCents: 900,
      }); // paid, in no tier
      await film(orgId); // free: ineligible
      basicCourse = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('summary-course'),
            title: 'C basic course',
          })
          .returning({ id: courses.id })
      ).id;
      await db.insert(courseTierAccess).values({
        courseId: basicCourse,
        tierId: basic,
        organizationId: orgId,
      });
      await db.insert(courses).values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('summary-course-none'),
        title: 'D course in no tier',
      });
      await subscriber(orgId, basic);
    });

    it('counts each tier, the gaps against cheaper ACTIVE tiers, and the catalogue', async () => {
      const summary = await plans.getAccessSummary(orgId);

      expect(summary).toMatchObject({
        eligibleFilms: 4,
        totalCourses: 2,
        closedFilms: 1,
        ineligibleFilms: 1,
      });
      const byTier = new Map(summary.tiers.map((t) => [t.tierId, t]));
      expect(byTier.get(basic)).toEqual({
        tierId: basic,
        films: 2,
        courses: 1,
        missingFromCheaper: [],
      });
      expect(byTier.get(pro)).toEqual({
        tierId: pro,
        films: 1,
        courses: 0,
        missingFromCheaper: [
          {
            cheaperTierId: basic,
            films: 1,
            courses: 1,
            sampleItems: [
              { kind: 'film', id: onlyBasic, title: 'A only basic' },
              { kind: 'course', id: basicCourse, title: 'C basic course' },
            ],
          },
        ],
      });
      // Inactive tiers are listed, but have no gaps of their own.
      expect(byTier.get(inactive)).toMatchObject({
        films: 0,
        missingFromCheaper: [],
      });
    });

    it('the delete impact splits only-here from also-elsewhere', async () => {
      const impact = await plans.getDeleteImpact(orgId, basic);

      expect(impact.liveSubscriberCount).toBe(1);
      expect(impact.onlyHere.films).toMatchObject({
        total: 1,
        closing: 1,
        staysForSale: 0,
      });
      expect(impact.onlyHere.films.items.map((i) => i.id)).toEqual([onlyBasic]);
      expect(impact.onlyHere.courses.total).toBe(1);
      expect(impact.alsoInOtherPlans).toEqual({ films: 1, courses: 0 });
      expect(
        await db
          .select({ id: contentTierAccess.contentId })
          .from(contentTierAccess)
          .where(
            and(
              eq(contentTierAccess.tierId, pro),
              eq(contentTierAccess.contentId, shared)
            )
          )
      ).toHaveLength(1);
    });
  });
});
