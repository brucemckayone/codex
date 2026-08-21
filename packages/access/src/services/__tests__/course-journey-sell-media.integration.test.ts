/**
 * CourseJourneyService sell-media + cover — the journey MEDIA write path (Codex-eqh0z).
 *
 * Runs against live Postgres so the org guard, the `guide` jsonb merge and the
 * transaction rollback are all exercised for real.
 *
 * Before these methods existed, `courses.introVideoMediaId` /
 * `previewVideoMediaId` / `guideVideoMediaId` / `guide.portraitMediaId` were
 * READ-ONLY codebase-wide — `getCourseSellPreview` projected them but nothing
 * could ever set them — so the sales page's `introVideo`, `reel` and `guide`
 * sections could never show their primary content. `courses` also had no
 * still-image column at all, which is why `JourneyCard` was typographic-only.
 *
 * The invariants under test:
 *   1. Every slot round-trips: a set id is readable back off the row.
 *   2. A FOREIGN media id (creator with no active membership in the org) is
 *      rejected with `ForbiddenError` and writes NOTHING — not even the slots
 *      that were legitimate in the same call.
 *   3. Clearing works — `null` unsets a slot rather than being ignored (a
 *      merge-shaped API could only ever set, never unset).
 *   4. The `guide` jsonb MERGE preserves name/bio/quote; a bare
 *      `{ portraitMediaId }` write would destroy the guide's identity.
 *   5. A foreign / non-course / soft-deleted page is `NotFoundError` — never a
 *      cross-org write (mirrors `updateJourneyOffer`'s guard).
 *   6. The cover key persists, clears, and is resolved to a `md.webp` CDN URL —
 *      never handed to a client as a raw R2 key.
 *   7. An inactive (invited/removed) membership does NOT grant attachment — the
 *      guard checks `status = 'active'`, not mere row existence.
 *   8. The A27 slots (`heroMediaId` / `signatureMediaId`, Codex-wqxv4) round-trip,
 *      are covered by the SAME org guard, and — the part that actually matters —
 *      are PROJECTED onto the public sell-preview payload. A15's finding was that
 *      two slots persisted and nothing public read them, so a new slot is not
 *      done until the served payload carries it.
 *
 * Falsifiability: every assertion re-reads the persisted row, so dropping the
 * org guard, the merge, the null-clear, or the URL resolution fails the test.
 */

import {
  courses,
  landingPages,
  mediaItems,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import { ForbiddenError, NotFoundError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

/** A TOTAL sell-media bag — every slot explicitly set or explicitly null. */
function mediaBag(
  overrides: Partial<{
    introVideoMediaId: string | null;
    previewVideoMediaId: string | null;
    guideVideoMediaId: string | null;
    guidePortraitMediaId: string | null;
    heroMediaId: string | null;
    signatureMediaId: string | null;
  }> = {}
) {
  return {
    introVideoMediaId: null,
    previewVideoMediaId: null,
    guideVideoMediaId: null,
    guidePortraitMediaId: null,
    heroMediaId: null,
    signatureMediaId: null,
    ...overrides,
  };
}

describe('CourseJourneyService sell media + cover (journey media write path)', () => {
  let db: Database;
  let svc: CourseJourneyService;

  /** Creator with an ACTIVE membership in org A — owns the attachable media. */
  let creatorId: string;
  /** Creator with NO membership in org A — owns the FOREIGN media. */
  let outsiderId: string;
  /** Creator whose org-A membership is `invited`, not `active`. */
  let invitedId: string;

  let orgAId: string;
  let orgBId: string;

  /** Course page in org A with a live subject course. */
  let pageId: string;
  let courseId: string;
  /** Plain (non-course) landing page in org A. */
  let landingPageId: string;
  /** Course page in org B — org A must never write it. */
  let foreignPageId: string;
  /** Soft-deleted course page in org A. */
  let deletedPageId: string;

  /** Attachable media (creator is an active org-A member). */
  let introId: string;
  let reelId: string;
  let guideVideoId: string;
  let portraitId: string;
  /** A27 (Codex-wqxv4) — the hero still and the guide's signature mark. */
  let heroId: string;
  let signatureId: string;
  /** Media owned by a non-member — must be refused. */
  let foreignMediaId: string;
  /** Media owned by an invited-but-not-active member — must be refused. */
  let invitedMediaId: string;
  /** Attachable media that is SOFT-DELETED — must be refused. */
  let deletedMediaId: string;

  async function seedMedia(
    ownerId: string,
    label: string,
    opts: { deleted?: boolean } = {}
  ): Promise<string> {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(ownerId, {
          title: `sell-media ${label}`,
          status: 'ready',
          ...(opts.deleted ? { deletedAt: new Date() } : {}),
        })
      )
      .returning({ id: mediaItems.id });
    if (!row) throw new Error(`failed to seed media ${label}`);
    return row.id;
  }

  async function seedCoursePage(
    orgId: string,
    label: string,
    opts: { pageDeleted?: boolean } = {}
  ): Promise<{ pageId: string; courseId: string }> {
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug(`${label}-course`),
        title: `${label} course`,
        status: 'draft',
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

  /** Re-read the persisted media columns straight off the row. */
  async function readCourse(id: string) {
    const [row] = await db
      .select({
        introVideoMediaId: courses.introVideoMediaId,
        previewVideoMediaId: courses.previewVideoMediaId,
        guideVideoMediaId: courses.guideVideoMediaId,
        heroMediaId: courses.heroMediaId,
        signatureMediaId: courses.signatureMediaId,
        guide: courses.guide,
        coverImageKey: courses.coverImageKey,
      })
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    return row;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    [creatorId, outsiderId, invitedId] = await seedTestUsers(db, 3);
    if (!creatorId || !outsiderId || !invitedId) {
      throw new Error('failed to seed test users');
    }

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Media Org A', slug: createUniqueSlug('media-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Media Org B', slug: createUniqueSlug('media-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    // `media_items` has no `organization_id`; creator MEMBERSHIP is the org
    // boundary, so the memberships below are what make media attachable or not.
    await db.insert(organizationMemberships).values([
      {
        organizationId: orgAId,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      },
      // Present but NOT active — must not grant attachment.
      {
        organizationId: orgAId,
        userId: invitedId,
        role: 'creator',
        status: 'invited',
      },
      // The outsider is a member of a DIFFERENT org, so "has a membership
      // somewhere" is not mistaken for "may attach here".
      {
        organizationId: orgBId,
        userId: outsiderId,
        role: 'owner',
        status: 'active',
      },
    ]);

    ({ pageId, courseId } = await seedCoursePage(orgAId, 'live'));
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
        slug: createUniqueSlug('plain-media-page'),
        title: 'Plain landing page',
        status: 'draft',
        subjectType: null,
        subjectId: null,
        sections: [],
      })
      .returning({ id: landingPages.id });
    if (!plain) throw new Error('failed to seed plain landing page');
    landingPageId = plain.id;

    introId = await seedMedia(creatorId, 'intro');
    reelId = await seedMedia(creatorId, 'reel');
    guideVideoId = await seedMedia(creatorId, 'guide-video');
    portraitId = await seedMedia(creatorId, 'portrait');
    heroId = await seedMedia(creatorId, 'hero');
    signatureId = await seedMedia(creatorId, 'signature');
    foreignMediaId = await seedMedia(outsiderId, 'foreign');
    invitedMediaId = await seedMedia(invitedId, 'invited');
    deletedMediaId = await seedMedia(creatorId, 'deleted', { deleted: true });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('persists all six slots and reads them back off the course row', async () => {
    const returned = await svc.updateJourneySellMedia(
      orgAId,
      pageId,
      mediaBag({
        introVideoMediaId: introId,
        previewVideoMediaId: reelId,
        guideVideoMediaId: guideVideoId,
        guidePortraitMediaId: portraitId,
        heroMediaId: heroId,
        signatureMediaId: signatureId,
      })
    );

    expect(returned.courseId).toBe(courseId);
    expect(returned.introVideoMediaId).toBe(introId);
    expect(returned.previewVideoMediaId).toBe(reelId);
    expect(returned.guideVideoMediaId).toBe(guideVideoId);
    expect(returned.guidePortraitMediaId).toBe(portraitId);
    expect(returned.heroMediaId).toBe(heroId);
    expect(returned.signatureMediaId).toBe(signatureId);

    // Re-read the row: the return value must not be the only evidence.
    const row = await readCourse(courseId);
    expect(row?.introVideoMediaId).toBe(introId);
    expect(row?.previewVideoMediaId).toBe(reelId);
    expect(row?.guideVideoMediaId).toBe(guideVideoId);
    expect(row?.guide?.portraitMediaId).toBe(portraitId);
    expect(row?.heroMediaId).toBe(heroId);
    expect(row?.signatureMediaId).toBe(signatureId);
  });

  it('getJourneySellMedia projects the persisted slots for the builder', async () => {
    const read = await svc.getJourneySellMedia(orgAId, pageId);
    expect(read).toMatchObject({
      courseId,
      introVideoMediaId: introId,
      previewVideoMediaId: reelId,
      guideVideoMediaId: guideVideoId,
      guidePortraitMediaId: portraitId,
      heroMediaId: heroId,
      signatureMediaId: signatureId,
    });
  });

  // ── Clearing ──────────────────────────────────────────────────────────────

  it('clears a slot when sent null, leaving the others intact', async () => {
    const returned = await svc.updateJourneySellMedia(
      orgAId,
      pageId,
      mediaBag({
        introVideoMediaId: null, // cleared
        previewVideoMediaId: reelId, // kept
        guideVideoMediaId: guideVideoId,
        guidePortraitMediaId: portraitId,
      })
    );

    expect(returned.introVideoMediaId).toBeNull();
    expect(returned.previewVideoMediaId).toBe(reelId);

    const row = await readCourse(courseId);
    expect(row?.introVideoMediaId).toBeNull();
    expect(row?.previewVideoMediaId).toBe(reelId);
  });

  it('clears every slot, including the guide portrait inside the jsonb', async () => {
    await svc.updateJourneySellMedia(orgAId, pageId, mediaBag());

    const row = await readCourse(courseId);
    expect(row?.introVideoMediaId).toBeNull();
    expect(row?.previewVideoMediaId).toBeNull();
    expect(row?.guideVideoMediaId).toBeNull();
    expect(row?.guide?.portraitMediaId ?? null).toBeNull();
    expect(row?.heroMediaId).toBeNull();
    expect(row?.signatureMediaId).toBeNull();
  });

  // ── The guide jsonb merge ─────────────────────────────────────────────────

  it('merges the portrait into the guide bag without destroying name/bio/quote', async () => {
    await db
      .update(courses)
      .set({
        guide: {
          name: 'Ama Osei',
          bio: 'Twenty years of practice.',
          quote: 'Begin where you are.',
        },
      })
      .where(eq(courses.id, courseId));

    await svc.updateJourneySellMedia(
      orgAId,
      pageId,
      mediaBag({ guidePortraitMediaId: portraitId })
    );

    const row = await readCourse(courseId);
    // The whole point: a bare `{ portraitMediaId }` write would have erased these.
    expect(row?.guide?.name).toBe('Ama Osei');
    expect(row?.guide?.bio).toBe('Twenty years of practice.');
    expect(row?.guide?.quote).toBe('Begin where you are.');
    expect(row?.guide?.portraitMediaId).toBe(portraitId);
  });

  it('clearing the portrait leaves the rest of the guide bag standing', async () => {
    await svc.updateJourneySellMedia(orgAId, pageId, mediaBag());

    const row = await readCourse(courseId);
    expect(row?.guide?.name).toBe('Ama Osei');
    expect(row?.guide?.bio).toBe('Twenty years of practice.');
    expect(row?.guide?.portraitMediaId ?? null).toBeNull();
  });

  // ── Org scoping on the media ids ──────────────────────────────────────────

  it('rejects a FOREIGN media id with ForbiddenError and writes nothing', async () => {
    // Seed a known-good baseline so "writes nothing" is falsifiable.
    await svc.updateJourneySellMedia(
      orgAId,
      pageId,
      mediaBag({ introVideoMediaId: introId })
    );
    const before = await readCourse(courseId);

    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({
          // Legitimate id in the same call — it must NOT be partially applied.
          previewVideoMediaId: reelId,
          guideVideoMediaId: foreignMediaId,
        })
      )
    ).rejects.toThrow(ForbiddenError);

    const after = await readCourse(courseId);
    expect(after?.introVideoMediaId).toBe(before?.introVideoMediaId);
    expect(after?.previewVideoMediaId).toBeNull();
    expect(after?.guideVideoMediaId).toBeNull();
  });

  // The exact hole a new slot opens: `assertMediaItemsInOrg` takes a hand-written
  // list of ids, so a slot added to the write but NOT to that list would accept
  // another org's media. Asserted per new slot rather than in aggregate, so a
  // half-wired guard names which slot leaked.
  it.each([
    ['heroMediaId'],
    ['signatureMediaId'],
  ] as const)('rejects a FOREIGN media id in the A27 slot %s and writes nothing', async (slot) => {
    await svc.updateJourneySellMedia(
      orgAId,
      pageId,
      mediaBag({ introVideoMediaId: introId })
    );

    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({
          introVideoMediaId: introId,
          [slot]: foreignMediaId,
        })
      )
    ).rejects.toThrow(ForbiddenError);

    const after = await readCourse(courseId);
    expect(after?.heroMediaId).toBeNull();
    expect(after?.signatureMediaId).toBeNull();
  });

  it('rejects media whose owner has a non-active membership', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({ introVideoMediaId: invitedMediaId })
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects a SOFT-DELETED media item', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({ introVideoMediaId: deletedMediaId })
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects a media id that does not exist at all', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({ introVideoMediaId: crypto.randomUUID() })
      )
    ).rejects.toThrow(ForbiddenError);
  });

  // ── Page scoping ──────────────────────────────────────────────────────────

  it('refuses to write a FOREIGN org’s page', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        foreignPageId,
        mediaBag({ introVideoMediaId: introId })
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses a soft-deleted page', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        deletedPageId,
        mediaBag({ introVideoMediaId: introId })
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses a plain (non-course) landing page — it has no media to carry', async () => {
    await expect(
      svc.updateJourneySellMedia(
        orgAId,
        landingPageId,
        mediaBag({ introVideoMediaId: introId })
      )
    ).rejects.toThrow(NotFoundError);
  });

  // ── Cover ─────────────────────────────────────────────────────────────────

  it('persists the cover key and resolves it to an md.webp CDN URL', async () => {
    const key = `courses/${courseId}/cover`;
    const set = await svc.setCourseCoverImageKey(orgAId, pageId, key);
    expect(set).toEqual({ courseId, coverImageKey: key });
    expect((await readCourse(courseId))?.coverImageKey).toBe(key);

    const read = await svc.getJourneySellMedia(
      orgAId,
      pageId,
      'https://cdn.example.test'
    );
    // The client must never see the raw key — only the resolved variant URL.
    expect(read.coverImageUrl).toBe(`https://cdn.example.test/${key}/md.webp`);
  });

  it('reports a null cover URL when no CDN base is configured', async () => {
    const read = await svc.getJourneySellMedia(orgAId, pageId, undefined);
    // A half-formed URL would render as a broken image; null makes the card fall
    // back to its typographic form instead.
    expect(read.coverImageUrl).toBeNull();
  });

  it('clears the cover key', async () => {
    const cleared = await svc.setCourseCoverImageKey(orgAId, pageId, null);
    expect(cleared.coverImageKey).toBeNull();
    expect((await readCourse(courseId))?.coverImageKey).toBeNull();

    const read = await svc.getJourneySellMedia(
      orgAId,
      pageId,
      'https://cdn.example.test'
    );
    expect(read.coverImageUrl).toBeNull();
  });

  it('refuses to set a cover on a foreign org’s page', async () => {
    await expect(
      svc.setCourseCoverImageKey(orgAId, foreignPageId, 'courses/x/cover')
    ).rejects.toThrow(NotFoundError);
  });

  // ── The cover reaches the public card projections ──────────────────────────

  it('surfaces the resolved cover URL on the published discovery cards', async () => {
    const key = `courses/${courseId}/cover`;
    await svc.setCourseCoverImageKey(orgAId, pageId, key);
    // The card lists only surface PUBLISHED pages + courses.
    await db
      .update(courses)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(courses.id, courseId));
    await db
      .update(landingPages)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(landingPages.id, pageId));

    const journeys = await svc.listPublishedJourneys(orgAId, {
      r2PublicUrlBase: 'https://cdn.example.test',
    });
    const card = journeys.find((j) => j.courseId === courseId);
    expect(card?.coverImageUrl).toBe(`https://cdn.example.test/${key}/md.webp`);

    const explore = await svc.listPublishedCourses(
      orgAId,
      'https://cdn.example.test'
    );
    expect(explore.find((c) => c.id === courseId)?.coverImageUrl).toBe(
      `https://cdn.example.test/${key}/md.webp`
    );
  });

  it('reports a null cover on the cards when the course has none', async () => {
    await svc.setCourseCoverImageKey(orgAId, pageId, null);

    const journeys = await svc.listPublishedJourneys(orgAId, {
      r2PublicUrlBase: 'https://cdn.example.test',
    });
    expect(
      journeys.find((j) => j.courseId === courseId)?.coverImageUrl
    ).toBeNull();
  });

  // ── The PUBLIC projection (contract A27, Codex-wqxv4) ─────────────────────
  //
  // A slot that persists but is never PROJECTED is the exact dead end A15 found
  // and A27 must not repeat: the builder saves an id, the public page reads
  // nothing, and no test fails. So these assert the served payload, not the row.
  describe('getCourseSellPreview projects the A27 stills', () => {
    const CDN = 'https://cdn.example.test';

    beforeAll(async () => {
      // The projection is published-only, and `seedCoursePage` seeds a draft.
      await db
        .update(courses)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(courses.id, courseId));
    });

    it('resolves the hero and signature to CDN thumbnail URLs', async () => {
      await svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({ heroMediaId: heroId, signatureMediaId: signatureId })
      );

      const [heroMedia] = await db
        .select({ thumbnailKey: mediaItems.thumbnailKey })
        .from(mediaItems)
        .where(eq(mediaItems.id, heroId))
        .limit(1);
      const [signatureMedia] = await db
        .select({ thumbnailKey: mediaItems.thumbnailKey })
        .from(mediaItems)
        .where(eq(mediaItems.id, signatureId))
        .limit(1);

      const preview = await svc.getCourseSellPreview(courseId, CDN);

      // `toStill`, not `toClip`: `media_items` is CHECK-constrained to
      // video/audio, so the still a creator picks for a hero IS the item's
      // thumbnail. Compared against the seeded key so a projection that returned
      // some other media's thumbnail would fail.
      expect(preview?.heroImageUrl).toBe(`${CDN}/${heroMedia?.thumbnailKey}`);
      expect(preview?.signatureUrl).toBe(
        `${CDN}/${signatureMedia?.thumbnailKey}`
      );
    });

    it('projects null for both when the slots are cleared', async () => {
      await svc.updateJourneySellMedia(orgAId, pageId, mediaBag());

      const preview = await svc.getCourseSellPreview(courseId, CDN);
      expect(preview?.heroImageUrl).toBeNull();
      expect(preview?.signatureUrl).toBeNull();
    });

    it('projects null with no CDN base configured rather than a relative key', async () => {
      await svc.updateJourneySellMedia(
        orgAId,
        pageId,
        mediaBag({ heroMediaId: heroId })
      );

      const preview = await svc.getCourseSellPreview(courseId, undefined);
      // A bare R2 key served to a browser is a broken image, not a degraded one.
      expect(preview?.heroImageUrl).toBeNull();
    });
  });
});
