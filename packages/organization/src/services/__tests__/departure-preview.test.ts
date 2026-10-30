/**
 * The departure preview (Codex-2hxff.64, data-design §6): what removing a
 * member would unwind, as counts the Studio's Remove dialog shows before the
 * owner confirms.
 *
 * Every count is scoped to ONE organisation and ONE creator. The cases below
 * seed the near misses beside each row that should count — another
 * organisation, another creator, drafts, deleted rows, already-cancelling
 * subscriptions — so a dropped predicate shows up as a wrong number.
 *
 * Real database (the package's Neon test branch). Subscriptions, course
 * subscriptions and agreements are read by whole-table jobs elsewhere, so the
 * rows this file creates there are deleted in `afterAll`.
 */

import { randomUUID } from 'node:crypto';
import * as schema from '@codex/database/schema';
import {
  createTestContentInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  gateContentFromTier,
  gateContentToTiers,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemberNotFoundError } from '../../errors';
import { OrganizationService } from '../organization-service';

const DAY_MS = 86_400_000;

describe('OrganizationService.getDeparturePreview', () => {
  let db: Database;
  let service: OrganizationService;
  let ownerId: string;
  let creatorId: string;
  let colleagueId: string;
  /** Subscribers: one active subscription per user per org, so each needs its own. */
  let subscriberIds: string[];

  const createdSubscriptionIds: string[] = [];
  const createdCourseSubscriptionIds: string[] = [];
  const createdAgreementIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    service = new OrganizationService({ db, environment: 'test' });
    [ownerId, creatorId, colleagueId] = await seedTestUsers(db, 3);
    subscriberIds = await seedTestUsers(db, 6);
  });

  afterAll(async () => {
    if (createdCourseSubscriptionIds.length > 0) {
      await db
        .delete(schema.courseSubscriptions)
        .where(
          inArray(schema.courseSubscriptions.id, createdCourseSubscriptionIds)
        );
    }
    if (createdSubscriptionIds.length > 0) {
      await db
        .delete(schema.subscriptions)
        .where(inArray(schema.subscriptions.id, createdSubscriptionIds));
    }
    if (createdAgreementIds.length > 0) {
      await db
        .delete(schema.creatorOrganizationAgreements)
        .where(
          inArray(schema.creatorOrganizationAgreements.id, createdAgreementIds)
        );
    }
    await teardownTestDatabase();
  });

  function subscriber(index: number): string {
    const id = subscriberIds[index];
    if (!id) throw new Error(`no subscriber ${index}`);
    return id;
  }

  /** An organisation with its owner, the creator and a colleague as members. */
  async function seedOrg(): Promise<string> {
    const org = await service.create(
      { name: `Preview Org ${Date.now()}`, slug: createUniqueSlug('preview') },
      ownerId
    );
    await db.insert(schema.organizationMemberships).values([
      {
        organizationId: org.id,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: org.id,
        userId: colleagueId,
        role: 'creator',
        status: 'active',
      },
    ]);
    return org.id;
  }

  async function seedItem(
    creator: string,
    organizationId: string | null,
    options: Partial<schema.NewContent> & {
      /** Behind the tier switch, ticked on exactly these tiers. */
      tierIds?: string[];
      /** Behind the tier switch on this tier and every dearer one (the
       *  old ladder, as the migration backfilled it). */
      fromTierId?: string;
    } = {}
  ): Promise<string> {
    const { tierIds, fromTierId, ...overrides } = options;
    const status = overrides.status ?? 'published';
    const gated = tierIds !== undefined || fromTierId !== undefined;
    const [row] = await db
      .insert(schema.content)
      .values(
        createTestContentInput(creator, {
          organizationId,
          status,
          publishedAt:
            status === 'published' ? new Date(Date.now() - DAY_MS) : null,
          ...overrides,
          ...(gated ? { isTierGated: true, isFree: false } : {}),
        })
      )
      .returning({ id: schema.content.id });
    if (!row) throw new Error('content not inserted');
    if (organizationId && tierIds !== undefined) {
      await gateContentToTiers(db, {
        contentId: row.id,
        organizationId,
        tierIds,
      });
    }
    if (organizationId && fromTierId !== undefined) {
      await gateContentFromTier(db, {
        contentId: row.id,
        organizationId,
        fromTierId,
      });
    }
    return row.id;
  }

  async function seedCourse(
    creator: string,
    organizationId: string,
    overrides: { status?: string; deletedAt?: Date } = {}
  ): Promise<string> {
    const status = overrides.status ?? 'published';
    const [row] = await db
      .insert(schema.courses)
      .values({
        organizationId,
        creatorId: creator,
        slug: createUniqueSlug('course'),
        title: 'A course',
        status,
        publishedAt:
          status === 'published' ? new Date(Date.now() - DAY_MS) : null,
        deletedAt: overrides.deletedAt ?? null,
      })
      .returning({ id: schema.courses.id });
    if (!row) throw new Error('course not inserted');
    return row.id;
  }

  /** A plan for the course, then one course subscription per entry. */
  async function seedCourseSubscriptions(
    courseId: string,
    organizationId: string,
    subscriptions: Array<{
      userId: string;
      status: string;
      cancelAtPeriodEnd?: boolean;
    }>
  ): Promise<void> {
    const [plan] = await db
      .insert(schema.courseSubscriptionPlans)
      .values({ courseId, priceMonthly: 999, priceAnnual: 9990 })
      .returning({ id: schema.courseSubscriptionPlans.id });
    if (!plan) throw new Error('plan not inserted');
    const now = Date.now();
    const rows = await db
      .insert(schema.courseSubscriptions)
      .values(
        subscriptions.map((sub) => ({
          userId: sub.userId,
          courseId,
          planId: plan.id,
          organizationId,
          stripeSubscriptionId: `sub_test_${randomUUID()}`,
          stripeCustomerId: `cus_test_${randomUUID().slice(0, 8)}`,
          status: sub.status,
          billingInterval: 'month',
          currentPeriodStart: new Date(now - DAY_MS),
          currentPeriodEnd: new Date(now + 29 * DAY_MS),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        }))
      )
      .returning({ id: schema.courseSubscriptions.id });
    createdCourseSubscriptionIds.push(...rows.map((row) => row.id));
  }

  async function seedTier(
    organizationId: string,
    sortOrder: number
  ): Promise<string> {
    const [row] = await db
      .insert(schema.subscriptionTiers)
      .values(
        createTestTierInput(organizationId, {
          name: `Tier ${sortOrder}`,
          sortOrder,
        })
      )
      .returning({ id: schema.subscriptionTiers.id });
    if (!row) throw new Error('tier not inserted');
    return row.id;
  }

  async function seedSubscription(
    userId: string,
    organizationId: string,
    tierId: string,
    status = 'active'
  ): Promise<void> {
    const [row] = await db
      .insert(schema.subscriptions)
      .values(
        createTestSubscriptionInput(userId, organizationId, tierId, {
          status,
          stripeSubscriptionId: `sub_test_${randomUUID()}`,
        })
      )
      .returning({ id: schema.subscriptions.id });
    if (!row) throw new Error('subscription not inserted');
    createdSubscriptionIds.push(row.id);
  }

  it('counts only what the creator has live in that organisation', async () => {
    const orgId = await seedOrg();
    const otherOrgId = await seedOrg();

    // Agreements: two active ones count; an earlier terminated one, a
    // colleague's and the creator's in another organisation do not.
    const agreement = (
      organizationId: string,
      creator: string,
      revenueType: 'subscription' | 'content_purchase',
      status: 'active' | 'terminated' = 'active'
    ) => ({
      organizationId,
      creatorId: creator,
      revenueType,
      organizationFeePercentage: 7000,
      status,
      // A terminated row carries its end, and started before the live one.
      ...(status === 'terminated'
        ? {
            effectiveFrom: new Date(Date.now() - 30 * DAY_MS),
            terminatedAt: new Date(Date.now() - 2 * DAY_MS),
          }
        : { effectiveFrom: new Date(Date.now() - DAY_MS) }),
    });
    const agreements = await db
      .insert(schema.creatorOrganizationAgreements)
      .values([
        agreement(orgId, creatorId, 'subscription'),
        agreement(orgId, creatorId, 'content_purchase'),
        agreement(orgId, creatorId, 'subscription', 'terminated'),
        agreement(orgId, colleagueId, 'subscription'),
        agreement(otherOrgId, creatorId, 'subscription'),
      ])
      .returning({ id: schema.creatorOrganizationAgreements.id });
    createdAgreementIds.push(...agreements.map((row) => row.id));

    // Content: two published items count.
    await seedItem(creatorId, orgId);
    await seedItem(creatorId, orgId);
    await seedItem(creatorId, orgId, { status: 'draft' });
    await seedItem(creatorId, orgId, { status: 'archived' });
    await seedItem(creatorId, orgId, { deletedAt: new Date() });
    await seedItem(colleagueId, orgId);
    await seedItem(creatorId, otherOrgId);
    await seedItem(creatorId, null);

    // Courses: two published ones count.
    const courseA = await seedCourse(creatorId, orgId);
    const courseB = await seedCourse(creatorId, orgId);
    const draftCourse = await seedCourse(creatorId, orgId, { status: 'draft' });
    const deletedCourse = await seedCourse(creatorId, orgId, {
      deletedAt: new Date(),
    });
    const colleaguesCourse = await seedCourse(colleagueId, orgId);
    const elsewhereCourse = await seedCourse(creatorId, otherOrgId);

    // Course subscriptions: the ones the departure cancels, on a course of
    // theirs on sale here. Four count: two on A, two on B. A paused one
    // counts, because the cancel takes it too.
    await seedCourseSubscriptions(courseA, orgId, [
      { userId: subscriber(0), status: 'active' },
      { userId: subscriber(1), status: 'past_due' },
      { userId: subscriber(2), status: 'cancelling', cancelAtPeriodEnd: true },
      { userId: subscriber(3), status: 'cancelled' },
    ]);
    await seedCourseSubscriptions(courseB, orgId, [
      { userId: subscriber(0), status: 'active' },
      { userId: subscriber(1), status: 'paused' },
    ]);
    for (const courseId of [
      draftCourse,
      deletedCourse,
      colleaguesCourse,
      elsewhereCourse,
    ]) {
      await seedCourseSubscriptions(
        courseId,
        courseId === elsewhereCourse ? otherOrgId : orgId,
        [{ userId: subscriber(0), status: 'active' }]
      );
    }

    // A tier subscriber, but none of the creator's content is in any tier.
    const tier = await seedTier(orgId, 1);
    await seedSubscription(subscriber(4), orgId, tier);

    await expect(
      service.getDeparturePreview(orgId, creatorId)
    ).resolves.toEqual({
      agreements: 2,
      contentOnSale: 2,
      coursesOnSale: 2,
      courseSubscriptions: 4,
      tierSubscribersAffected: 0,
    });
  });

  // An item reaches the subscribers of the tiers it is ticked on
  // (Codex-2hxff.91); `fromTierId` ticks the old ladder (T and every tier
  // above it, as migrated), so subscribers on those tiers lose the creator's
  // content at their next renewal.
  it('counts the tier subscribers who reach their work today, through the tier hierarchy or a course their tier unlocks', async () => {
    const orgId = await seedOrg();
    const otherOrgId = await seedOrg();
    const bronze = await seedTier(orgId, 1);
    const silver = await seedTier(orgId, 2);
    const gold = await seedTier(orgId, 3);

    await seedItem(creatorId, orgId, { fromTierId: silver });
    // None of these lowers the reach to bronze: a draft, content that never
    // reaches the tier arm, and a colleague's.
    await seedItem(creatorId, orgId, {
      status: 'draft',
      fromTierId: bronze,
    });
    await seedItem(creatorId, orgId, {
      fromTierId: bronze,
      courseOnly: true,
    });
    await seedItem(creatorId, orgId, {
      fromTierId: bronze,
      isFollowerGated: true,
    });
    await seedItem(colleagueId, orgId, { fromTierId: bronze });

    await seedSubscription(subscriber(0), orgId, bronze);
    await seedSubscription(subscriber(1), orgId, silver);
    await seedSubscription(subscriber(2), orgId, gold, 'past_due');
    await seedSubscription(subscriber(3), orgId, gold, 'cancelled');
    await seedSubscription(subscriber(4), orgId, silver, 'incomplete');
    // Another organisation's subscriber to the creator's content there.
    const elsewhereTier = await seedTier(otherOrgId, 1);
    await seedItem(creatorId, otherOrgId, { fromTierId: elsewhereTier });
    await seedSubscription(subscriber(5), otherOrgId, elsewhereTier);

    const before = await service.getDeparturePreview(orgId, creatorId);
    expect(before.tierSubscribersAffected).toBe(2);

    // Bronze unlocking a colleague's course, or a draft course of theirs,
    // changes nothing.
    const unlock = (courseId: string) =>
      db
        .insert(schema.courseTierAccess)
        .values({ courseId, tierId: bronze, organizationId: orgId });
    await unlock(await seedCourse(colleagueId, orgId));
    await unlock(await seedCourse(creatorId, orgId, { status: 'draft' }));
    const unchanged = await service.getDeparturePreview(orgId, creatorId);
    expect(unchanged.tierSubscribersAffected).toBe(2);

    // Bronze unlocking one of THEIR published courses brings bronze in.
    await unlock(await seedCourse(creatorId, orgId));
    const after = await service.getDeparturePreview(orgId, creatorId);
    expect(after.tierSubscribersAffected).toBe(3);
  });

  // A SET, not a ladder: a cheaper tier is not implied by a dearer one, and a
  // closed item (gated, no tier) reaches no subscriber at all.
  it('counts only the subscribers of the tiers an item is ticked on', async () => {
    const orgId = await seedOrg();
    const bronze = await seedTier(orgId, 1);
    const silver = await seedTier(orgId, 2);
    const gold = await seedTier(orgId, 3);
    await seedItem(creatorId, orgId, { tierIds: [bronze, gold] });
    await seedItem(creatorId, orgId, { tierIds: [] });

    await seedSubscription(subscriber(0), orgId, bronze);
    await seedSubscription(subscriber(1), orgId, silver);
    await seedSubscription(subscriber(2), orgId, gold);

    const preview = await service.getDeparturePreview(orgId, creatorId);
    expect(preview.tierSubscribersAffected).toBe(2);
  });

  it('is all zeros for a member with nothing to unwind', async () => {
    const orgId = await seedOrg();
    // The colleague has work on sale; the creator has none here.
    await seedItem(colleagueId, orgId);

    await expect(
      service.getDeparturePreview(orgId, creatorId)
    ).resolves.toEqual({
      agreements: 0,
      contentOnSale: 0,
      coursesOnSale: 0,
      courseSubscriptions: 0,
      tierSubscribersAffected: 0,
    });
  });

  it('refuses a user who is not a member of the organisation', async () => {
    const orgId = await seedOrg();
    const [outsider] = await seedTestUsers(db, 1);
    await seedItem(outsider, orgId);

    await expect(
      service.getDeparturePreview(orgId, outsider)
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
