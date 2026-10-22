/**
 * A course that earns money needs its creator's payouts set up to go live, and
 * to take on a new way to pay once it is live (owner, 2026-10-22: courses
 * follow the content rule — Codex-2hxff.14).
 *
 * "Earns money" is any way in `getCourseOffer` presents: a one-off price
 * (`courses.price_cents`), a live course subscription plan, or tier access.
 * Every write that can open one is covered here:
 *
 *   - `saveJourneyPage` → the publish cascade, the ONLY write that makes a
 *     course published. Checked on the move into published, never on an
 *     autosave of a page that is already live.
 *   - `updateJourneyOffer` → a one-off price set or changed on a live course.
 *   - `CourseAccessService.setTierAccess` → a tier added to a live course.
 *
 * Every refusal asserts nothing was written (the transaction rolled back), and
 * every rule has a payout-ready control, so a test can only pass for the gate's
 * reason. Real Postgres; the rows this file creates are deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { CreatorPayoutsRequiredError } from '@codex/content';
import {
  courseSubscriptionPlans,
  courses,
  courseTierAccess,
  landingPages,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CourseAccessService } from '../course-access-service';
import { CourseJourneyService } from '../course-journey-service';

function offerBag(oneOffPriceCents: number | null) {
  return {
    tiersEnabled: false,
    subscriptionEnabled: false,
    subscriptionPriceCents: null,
    oneOffEnabled: oneOffPriceCents !== null,
    oneOffPriceCents,
  };
}

describe('course payouts gate (Codex-2hxff.14)', () => {
  let db: Database;
  let journeys: CourseJourneyService;
  let courseAccess: CourseAccessService;
  let creatorId: string;
  let orgId: string;
  let tierId: string;
  let otherTierId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    journeys = new CourseJourneyService({ db, environment: 'test' });
    courseAccess = new CourseAccessService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Payouts Gate Org', slug: createUniqueSlug('payouts') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create test org');
    orgId = org.id;

    const [tier, otherTier] = await db
      .insert(subscriptionTiers)
      .values([
        createTestTierInput(orgId, { sortOrder: 1 }),
        createTestTierInput(orgId, { sortOrder: 2 }),
      ])
      .returning({ id: subscriptionTiers.id });
    if (!tier || !otherTier) throw new Error('failed to create tiers');
    tierId = tier.id;
    otherTierId = otherTier.id;
  });

  afterEach(async () => {
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
  });

  afterAll(async () => {
    if (db && orgId) {
      await db
        .delete(landingPages)
        .where(eq(landingPages.organizationId, orgId));
      // Cascades to the course's plan and tier-access rows.
      await db.delete(courses).where(eq(courses.organizationId, orgId));
      await db
        .delete(subscriptionTiers)
        .where(eq(subscriptionTiers.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await teardownTestDatabase();
  });

  async function makeCreatorPayable(): Promise<void> {
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));
  }

  /** A draft course journey: its page and its subject course. */
  async function seedJourney(): Promise<{
    pageId: string;
    courseId: string;
    slug: string;
    title: string;
  }> {
    const title = `Payouts ${randomUUID().slice(0, 8)}`;
    const { id: pageId, slug } = await journeys.createJourney(
      orgId,
      creatorId,
      { title, pageType: 'course' }
    );
    const loaded = await journeys.getJourneyForBuilder(orgId, pageId);
    if (!loaded?.subjectId) throw new Error('course subject missing');
    return { pageId, courseId: loaded.subjectId, slug, title };
  }

  function saveAs(
    journey: { pageId: string; slug: string; title: string },
    status: 'draft' | 'published',
    title = journey.title
  ) {
    return journeys.saveJourneyPage(orgId, {
      id: journey.pageId,
      title,
      slug: journey.slug,
      status,
      sections: [],
      brandOverrides: null,
    });
  }

  async function readState(journey: { pageId: string; courseId: string }) {
    const [course] = await db
      .select({ status: courses.status, priceCents: courses.priceCents })
      .from(courses)
      .where(eq(courses.id, journey.courseId));
    const [page] = await db
      .select({ status: landingPages.status, offer: landingPages.offer })
      .from(landingPages)
      .where(eq(landingPages.id, journey.pageId));
    return { course, page };
  }

  /** A journey that is already LIVE, published while its creator was payable. */
  async function seedLiveJourney(
    priceCents: number | null
  ): Promise<Awaited<ReturnType<typeof seedJourney>>> {
    const journey = await seedJourney();
    await makeCreatorPayable();
    if (priceCents !== null) {
      await journeys.updateJourneyOffer(
        orgId,
        journey.pageId,
        offerBag(priceCents)
      );
    }
    await saveAs(journey, 'published');
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
    return journey;
  }

  async function grantedTiers(courseId: string): Promise<string[]> {
    const rows = await db
      .select({ tierId: courseTierAccess.tierId })
      .from(courseTierAccess)
      .where(eq(courseTierAccess.courseId, courseId));
    return rows.map((row) => row.tierId).sort();
  }

  describe('publishing a course (saveJourneyPage cascade)', () => {
    it('refuses a course with a one-off price when the creator has no Connect account, and rolls the page back too', async () => {
      const journey = await seedJourney();
      // A draft may be priced freely — publishing is what is checked.
      await journeys.updateJourneyOffer(orgId, journey.pageId, offerBag(1200));

      await expect(saveAs(journey, 'published')).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );

      const { course, page } = await readState(journey);
      expect(course?.status).toBe('draft');
      expect(page?.status).toBe('draft');
    });

    it('refuses a course sold only by a course subscription plan', async () => {
      const journey = await seedJourney();
      await db.insert(courseSubscriptionPlans).values({
        courseId: journey.courseId,
        priceMonthly: 900,
        priceAnnual: 9000,
        isActive: true,
      });

      await expect(saveAs(journey, 'published')).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );
      expect((await readState(journey)).course?.status).toBe('draft');
    });

    it('refuses a course included only in a membership tier', async () => {
      const journey = await seedJourney();
      await courseAccess.setTierAccess(orgId, journey.courseId, [tierId]);

      await expect(saveAs(journey, 'published')).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );
      expect((await readState(journey)).course?.status).toBe('draft');
    });

    it('publishes a FREE course with no Connect account at all', async () => {
      const journey = await seedJourney();

      await saveAs(journey, 'published');

      expect((await readState(journey)).course?.status).toBe('published');
    });

    it('publishes a priced course once the creator is payout-ready', async () => {
      const journey = await seedJourney();
      await journeys.updateJourneyOffer(orgId, journey.pageId, offerBag(1200));
      await makeCreatorPayable();

      await saveAs(journey, 'published');

      expect((await readState(journey)).course?.status).toBe('published');
    });

    it('does not re-check a page that is ALREADY live — an autosave never fails on payouts', async () => {
      const journey = await seedLiveJourney(1200);

      // The creator's payouts lapsed after publishing; the builder autosaves.
      await saveAs(journey, 'published', 'Renamed while live');

      const { course } = await readState(journey);
      expect(course?.status).toBe('published');
    });
  });

  describe('pricing a LIVE course (updateJourneyOffer)', () => {
    it('refuses a one-off price added or changed without payouts, and writes neither the price nor the offer bag', async () => {
      const free = await seedLiveJourney(null);
      await expect(
        journeys.updateJourneyOffer(orgId, free.pageId, offerBag(1500))
      ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
      const freeState = await readState(free);
      expect(freeState.course?.priceCents).toBeNull();
      expect(freeState.page?.offer).toBeNull();

      const priced = await seedLiveJourney(1200);
      await expect(
        journeys.updateJourneyOffer(orgId, priced.pageId, offerBag(1800))
      ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
      expect((await readState(priced)).course?.priceCents).toBe(1200);
    });

    it('allows resending the same price, and turning the price off, without payouts', async () => {
      const journey = await seedLiveJourney(1200);

      await journeys.updateJourneyOffer(orgId, journey.pageId, offerBag(1200));
      expect((await readState(journey)).course?.priceCents).toBe(1200);

      await journeys.updateJourneyOffer(orgId, journey.pageId, offerBag(null));
      expect((await readState(journey)).course?.priceCents).toBeNull();
    });

    it('allows a price on a live course once the creator is payout-ready', async () => {
      const journey = await seedLiveJourney(null);
      await makeCreatorPayable();

      await journeys.updateJourneyOffer(orgId, journey.pageId, offerBag(1500));

      expect((await readState(journey)).course?.priceCents).toBe(1500);
    });
  });

  describe('tier access on a LIVE course (setTierAccess)', () => {
    it('refuses a tier added without payouts and writes nothing', async () => {
      const journey = await seedLiveJourney(null);

      await expect(
        courseAccess.setTierAccess(orgId, journey.courseId, [tierId])
      ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
      expect(await grantedTiers(journey.courseId)).toEqual([]);
    });

    it('allows resending the same tiers, and removing tiers, without payouts', async () => {
      const journey = await seedLiveJourney(null);
      await makeCreatorPayable();
      await courseAccess.setTierAccess(orgId, journey.courseId, [
        tierId,
        otherTierId,
      ]);
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));

      await courseAccess.setTierAccess(orgId, journey.courseId, [
        otherTierId,
        tierId,
      ]);
      expect(await grantedTiers(journey.courseId)).toEqual(
        [tierId, otherTierId].sort()
      );

      await courseAccess.setTierAccess(orgId, journey.courseId, [tierId]);
      expect(await grantedTiers(journey.courseId)).toEqual([tierId]);

      await courseAccess.setTierAccess(orgId, journey.courseId, []);
      expect(await grantedTiers(journey.courseId)).toEqual([]);
    });

    it('allows a tier added to a live course once the creator is payout-ready', async () => {
      const journey = await seedLiveJourney(null);
      await makeCreatorPayable();

      await courseAccess.setTierAccess(orgId, journey.courseId, [tierId]);

      expect(await grantedTiers(journey.courseId)).toEqual([tierId]);
    });
  });
});
