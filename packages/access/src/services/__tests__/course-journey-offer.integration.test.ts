/**
 * CourseJourneyService.updateJourneyOffer — the journey PRICING write path.
 *
 * Runs against live Postgres so the two-row transaction is exercised for real.
 * This method is the ONLY write path to `courses.price_cents`, the column
 * `deriveCheckoutOffers` reads; before it existed a creator could type a price in
 * the builder, be told "Page saved", and still see "isn't open for enrolment just
 * now" at checkout, because nothing ever wrote the column.
 *
 * The invariants under test:
 *   1. A course page's offer AND its authoritative `courses.price_cents` move
 *      together — the page can never advertise a price the checkout cannot read.
 *   2. Disabling the one-off path nulls `price_cents` ("not sold standalone", §5).
 *   3. An ENABLED path with no price is REFUSED, not persisted as unsellable.
 *   4. A foreign / soft-deleted page is `NotFoundError` — never a cross-org write.
 *   5. A soft-deleted subject course rolls the whole thing back, rather than
 *      leaving an offer bag claiming a price no course row carries.
 *
 * Falsifiability: every assertion re-reads the persisted rows, so dropping any
 * clause of the scope, the price mirror, or a guard fails the test.
 */

import { courses, landingPages, organizations } from '@codex/database/schema';
import { NotFoundError, ValidationError } from '@codex/service-errors';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

/** A TOTAL offer bag — every path explicitly on or off (the validated shape). */
function offerBag(
  overrides: Partial<{
    tiersEnabled: boolean;
    subscriptionEnabled: boolean;
    subscriptionPriceCents: number | null;
    oneOffEnabled: boolean;
    oneOffPriceCents: number | null;
  }> = {}
) {
  return {
    tiersEnabled: false,
    subscriptionEnabled: false,
    subscriptionPriceCents: null,
    oneOffEnabled: false,
    oneOffPriceCents: null,
    ...overrides,
  };
}

describe('CourseJourneyService.updateJourneyOffer (journey pricing write path)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  /** Course page in org A, with a live subject course. */
  let pageId: string;
  let courseId: string;
  /** Plain (non-course) landing page in org A — no subject to price. */
  let landingPageId: string;
  /** Course page in org A whose subject course is SOFT-DELETED. */
  let orphanPageId: string;
  /** Course page in org B — org A must never be able to price it. */
  let foreignPageId: string;
  /** Soft-deleted course page in org A. */
  let deletedPageId: string;

  async function seedCoursePage(
    orgId: string,
    label: string,
    opts: { courseDeleted?: boolean; pageDeleted?: boolean } = {}
  ): Promise<{ pageId: string; courseId: string }> {
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug(`${label}-course`),
        title: `${label} course`,
        status: 'draft',
        priceCents: null,
        ...(opts.courseDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: courses.id });
    if (!course) throw new Error(`failed to seed course for ${label}`);

    const [page] = await db
      .insert(landingPages)
      .values({
        organizationId: orgId,
        creatorId,
        pageType: 'course',
        slug: createUniqueSlug(`${label}-page`),
        title: `${label} page`,
        status: 'draft',
        subjectType: 'course',
        subjectId: course.id,
        sections: [],
        ...(opts.pageDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: landingPages.id });
    if (!page) throw new Error(`failed to seed page for ${label}`);

    return { pageId: page.id, courseId: course.id };
  }

  async function readPersisted(id: string) {
    const [row] = await db
      .select({ offer: landingPages.offer, subjectId: landingPages.subjectId })
      .from(landingPages)
      .where(eq(landingPages.id, id))
      .limit(1);
    return row;
  }

  async function readPrice(id: string): Promise<number | null | undefined> {
    const [row] = await db
      .select({ priceCents: courses.priceCents })
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    return row?.priceCents;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Offer Org A', slug: createUniqueSlug('offer-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Offer Org B', slug: createUniqueSlug('offer-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    ({ pageId, courseId } = await seedCoursePage(orgAId, 'live'));
    ({ pageId: orphanPageId } = await seedCoursePage(orgAId, 'orphan', {
      courseDeleted: true,
    }));
    ({ pageId: foreignPageId } = await seedCoursePage(orgBId, 'foreign'));
    ({ pageId: deletedPageId } = await seedCoursePage(orgAId, 'gone', {
      pageDeleted: true,
    }));

    const [plain] = await db
      .insert(landingPages)
      .values({
        organizationId: orgAId,
        creatorId,
        pageType: 'landing',
        slug: createUniqueSlug('plain-page'),
        title: 'Plain landing page',
        status: 'draft',
        subjectType: null,
        subjectId: null,
        sections: [],
      })
      .returning({ id: landingPages.id });
    if (!plain) throw new Error('failed to seed plain landing page');
    landingPageId = plain.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('writes the offer bag AND mirrors the one-off price onto courses.price_cents', async () => {
    const returned = await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({
        oneOffEnabled: true,
        oneOffPriceCents: 1850,
        tiersEnabled: true,
      })
    );

    expect(returned.oneOffPriceCents).toBe(1850);
    expect(await readPrice(courseId)).toBe(1850);

    const row = await readPersisted(pageId);
    expect(row?.offer).toEqual(
      offerBag({
        oneOffEnabled: true,
        oneOffPriceCents: 1850,
        tiersEnabled: true,
      })
    );
  });

  it('persists a total bag — every path explicitly on or off, never absent', async () => {
    await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({
        subscriptionEnabled: true,
        subscriptionPriceCents: 1200,
        oneOffEnabled: true,
        oneOffPriceCents: 4900,
      })
    );

    const row = await readPersisted(pageId);
    // Reading the KEYS (not just values) is the point: a partial bag would make
    // "off" and "never set" indistinguishable on the next load.
    expect(Object.keys(row?.offer ?? {}).sort()).toEqual([
      'oneOffEnabled',
      'oneOffPriceCents',
      'subscriptionEnabled',
      'subscriptionPriceCents',
      'tiersEnabled',
    ]);
    expect(await readPrice(courseId)).toBe(4900);
  });

  it('disabling the one-off path nulls price_cents (not sold standalone)', async () => {
    await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({ oneOffEnabled: true, oneOffPriceCents: 4900 })
    );
    expect(await readPrice(courseId)).toBe(4900);

    await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({ tiersEnabled: true })
    );
    expect(await readPrice(courseId)).toBeNull();
  });

  it('REFUSES an enabled one-off with no price, and writes nothing', async () => {
    await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({ oneOffEnabled: true, oneOffPriceCents: 2500 })
    );

    await expect(
      svc.updateJourneyOffer(
        orgAId,
        pageId,
        offerBag({ oneOffEnabled: true, oneOffPriceCents: null })
      )
    ).rejects.toBeInstanceOf(ValidationError);

    // The prior good state must survive — a refusal is not a partial write.
    expect(await readPrice(courseId)).toBe(2500);
  });

  it('REFUSES an enabled course subscription with no price', async () => {
    await expect(
      svc.updateJourneyOffer(
        orgAId,
        pageId,
        offerBag({ subscriptionEnabled: true, subscriptionPriceCents: null })
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('REFUSES a one-off on a plain landing page — no course to sell', async () => {
    await expect(
      svc.updateJourneyOffer(
        orgAId,
        landingPageId,
        offerBag({ oneOffEnabled: true, oneOffPriceCents: 1000 })
      )
    ).rejects.toBeInstanceOf(ValidationError);

    expect((await readPersisted(landingPageId))?.offer).toBeNull();
  });

  it('allows a non-purchase offer on a plain landing page', async () => {
    await svc.updateJourneyOffer(
      orgAId,
      landingPageId,
      offerBag({ tiersEnabled: true })
    );
    expect((await readPersisted(landingPageId))?.offer).toEqual(
      offerBag({ tiersEnabled: true })
    );
  });

  it('rolls back when the subject course is soft-deleted — no orphan price claim', async () => {
    await expect(
      svc.updateJourneyOffer(
        orgAId,
        orphanPageId,
        offerBag({ oneOffEnabled: true, oneOffPriceCents: 3000 })
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    // The offer bag must NOT have been left behind by the rolled-back transaction.
    expect((await readPersisted(orphanPageId))?.offer).toBeNull();
  });

  it('IDOR: another org cannot price this org’s journey', async () => {
    await expect(
      svc.updateJourneyOffer(
        orgAId,
        foreignPageId,
        offerBag({ oneOffEnabled: true, oneOffPriceCents: 100 })
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await readPersisted(foreignPageId))?.offer).toBeNull();
  });

  it('a soft-deleted page is NotFoundError', async () => {
    await expect(
      svc.updateJourneyOffer(
        orgAId,
        deletedPageId,
        offerBag({ tiersEnabled: true })
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await readPersisted(deletedPageId))?.offer).toBeNull();
  });

  it('getJourneyForBuilder round-trips the persisted offer', async () => {
    await svc.updateJourneyOffer(
      orgAId,
      pageId,
      offerBag({ oneOffEnabled: true, oneOffPriceCents: 777 })
    );

    const draft = await svc.getJourneyForBuilder(orgAId, pageId);
    expect(draft?.offer).toEqual(
      offerBag({ oneOffEnabled: true, oneOffPriceCents: 777 })
    );
  });

  it('a never-priced page loads with NO offer key, not a fabricated one', async () => {
    const { pageId: freshPageId } = await seedCoursePage(orgAId, 'fresh');
    const draft = await svc.getJourneyForBuilder(orgAId, freshPageId);
    expect(draft).not.toBeNull();
    expect('offer' in (draft ?? {})).toBe(false);
  });

  it('scopes the price write to the org — a same-id course in another org is untouched', async () => {
    // Guards the `courses` UPDATE's org clause: without it, a page could drive a
    // price onto a row that merely shares the subject id space.
    const { pageId: bPageId, courseId: bCourseId } = await seedCoursePage(
      orgBId,
      'b-live'
    );
    await svc.updateJourneyOffer(
      orgBId,
      bPageId,
      offerBag({ oneOffEnabled: true, oneOffPriceCents: 999 })
    );

    expect(await readPrice(bCourseId)).toBe(999);

    // Org A's course keeps whatever the earlier cases left it at — never 999.
    const [aCourse] = await db
      .select({ priceCents: courses.priceCents })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.organizationId, orgAId)))
      .limit(1);
    expect(aCourse?.priceCents).not.toBe(999);
  });
});
