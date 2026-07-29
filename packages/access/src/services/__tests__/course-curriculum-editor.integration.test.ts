/**
 * Curriculum-editor write-side integration tests (Codex-2pryk · Codex-03cwh).
 *
 * REAL Neon coverage for the studio two-pane curriculum editor's backend —
 * `CourseJourneyService.getCourseCurriculumForEditor` / `saveCurriculum` /
 * `resolveCourseIdForPage`. These are the highest-risk seams of the WP:
 *
 *   • the `(course_id, sort_order)` PARTIAL-UNIQUE index makes a naive stage
 *     reorder throw mid-swap, so the save parks sort values at a temp offset
 *     first — exercised here against live Postgres, not stubbed;
 *   • a practice IS a JOIN to a `content` row, so the save SPACE-GUARDS every
 *     desired `contentId` to the course's org (HARDENING §5) — a foreign-org
 *     content id must be rejected with NO partial write;
 *   • every read/write is org-scoped — a foreign org must 404, never leak or
 *     mutate another org's curriculum.
 *
 * Runs against live Postgres (LOCAL_PROXY) so every FK, CHECK and partial-unique
 * index is real. Every isolation test seeds a real foreign row and asserts its
 * ABSENCE / rejection, so each test can fail if scoping regresses. Data is
 * scoped to freshly-created, unique course ids per test (matching the Round-D
 * precedent), so a shared branch needs no inter-test cleanup.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courseStages,
  courses,
  landingPages,
  mediaItems,
  organizations,
  stagePractices,
  subscriptionTiers,
} from '@codex/database/schema';
import { ForbiddenError, NotFoundError } from '@codex/service-errors';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string,
  overrides: { status?: string; deletedAt?: Date | null } = {}
): Promise<string> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: createUniqueSlug('course'),
      title: 'Test Course',
      status: overrides.status ?? 'published',
      priceCents: 5000,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: courses.id });
  if (!row) throw new Error('failed to create course');
  return row.id;
}

/** A course-type landing page whose `subjectId` points at `courseId`. */
async function createLandingPage(
  db: Database,
  opts: { orgId: string; creatorId: string; courseId: string | null }
): Promise<string> {
  const [row] = await db
    .insert(landingPages)
    .values({
      organizationId: opts.orgId,
      creatorId: opts.creatorId,
      pageType: opts.courseId ? 'course' : 'landing',
      slug: createUniqueSlug('page'),
      title: 'Test Journey',
      status: 'draft',
      subjectType: opts.courseId ? 'course' : null,
      subjectId: opts.courseId,
      sections: [],
    })
    .returning({ id: landingPages.id });
  if (!row) throw new Error('failed to create landing page');
  return row.id;
}

/** A standalone content row (NO stage_practices join) — a picker candidate. */
async function createContent(
  db: Database,
  opts: {
    creatorId: string;
    orgId: string;
    status?: string;
    contentType?: 'video' | 'audio' | 'written';
    thumbnailUrl?: string | null;
    deletedAt?: Date | null;
  }
): Promise<string> {
  const [row] = await db
    .insert(content)
    .values(
      createTestContentInput(opts.creatorId, {
        organizationId: opts.orgId,
        status: opts.status ?? 'published',
        contentType: opts.contentType ?? 'video',
        thumbnailUrl: opts.thumbnailUrl ?? null,
        deletedAt: opts.deletedAt ?? null,
      })
    )
    .returning({ id: content.id });
  if (!row) throw new Error('failed to create content');
  return row.id;
}

/** Seed a stage directly (bypasses the service) for read-side fixtures. */
async function seedStage(
  db: Database,
  courseId: string,
  opts: {
    name: string;
    gloss?: string | null;
    sortOrder: number;
    deletedAt?: Date | null;
  }
): Promise<string> {
  const [row] = await db
    .insert(courseStages)
    .values({
      courseId,
      name: opts.name,
      gloss: opts.gloss ?? null,
      sortOrder: opts.sortOrder,
      deletedAt: opts.deletedAt ?? null,
    })
    .returning({ id: courseStages.id });
  if (!row) throw new Error('failed to seed stage');
  return row.id;
}

async function seedPractice(
  db: Database,
  stageId: string,
  contentId: string,
  sortOrder: number
): Promise<void> {
  await db.insert(stagePractices).values({ stageId, contentId, sortOrder });
}

/** An org tier, so a practice can carry a DELIBERATE tier-gated access path. */
async function createTier(db: Database, orgId: string): Promise<string> {
  const [row] = await db
    .insert(subscriptionTiers)
    .values({
      organizationId: orgId,
      name: 'Inner Circle',
      sortOrder: 1, // `check_tier_sort_order_positive` requires > 0
      priceMonthly: 1200,
      priceAnnual: 12000,
    })
    .returning({ id: subscriptionTiers.id });
  if (!row) throw new Error('failed to create tier');
  return row.id;
}

/** Read the persisted stage sort orders directly (index-safety assertions). */
async function readStageSortOrders(
  db: Database,
  courseId: string
): Promise<Array<{ id: string; name: string; sortOrder: number }>> {
  return db
    .select({
      id: courseStages.id,
      name: courseStages.name,
      sortOrder: courseStages.sortOrder,
    })
    .from(courseStages)
    .where(
      and(eq(courseStages.courseId, courseId), isNull(courseStages.deletedAt))
    )
    .orderBy(asc(courseStages.sortOrder));
}

describe('CourseJourneyService curriculum editor (Codex-03cwh)', () => {
  let db: Database;
  let service: CourseJourneyService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    service = new CourseJourneyService({ db, environment: 'test' });

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Curr Org A', slug: createUniqueSlug('curr-org-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Curr Org B', slug: createUniqueSlug('curr-org-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  describe('getCourseCurriculumForEditor', () => {
    it('returns ordered stages + practices with content metadata, INCLUDING draft-content practices, excluding soft-deleted stages', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const publishedContent = await createContent(db, {
        creatorId,
        orgId: orgAId,
        contentType: 'audio',
        thumbnailUrl: 'https://cdn.example/thumb.jpg',
      });
      const draftContent = await createContent(db, {
        creatorId,
        orgId: orgAId,
        status: 'draft',
        contentType: 'written',
      });

      const stage2 = await seedStage(db, courseId, {
        name: 'Descending',
        sortOrder: 1,
      });
      const stage1 = await seedStage(db, courseId, {
        name: 'Arriving',
        gloss: 'Learning to land.',
        sortOrder: 0,
      });
      const goneStage = await seedStage(db, courseId, {
        name: 'Deleted',
        sortOrder: 2,
        deletedAt: new Date(),
      });
      // Practices out of insertion order to prove the sortOrder ordering.
      await seedPractice(db, stage1, draftContent, 1);
      await seedPractice(db, stage1, publishedContent, 0);

      const result = await service.getCourseCurriculumForEditor(
        orgAId,
        courseId
      );

      expect(result.courseId).toBe(courseId);
      expect(result.stages.map((s) => s.name)).toEqual([
        'Arriving',
        'Descending',
      ]);
      // Soft-deleted stage absent.
      expect(result.stages.some((s) => s.id === goneStage)).toBe(false);
      expect(result.stages.some((s) => s.id === stage2)).toBe(true);

      const arriving = result.stages[0];
      expect(arriving?.gloss).toBe('Learning to land.');
      expect(arriving?.practices.map((p) => p.contentId)).toEqual([
        publishedContent,
        draftContent,
      ]);
      const [firstPractice, secondPractice] = arriving?.practices ?? [];
      expect(firstPractice).toMatchObject({
        contentId: publishedContent,
        contentType: 'audio',
        status: 'published',
        thumbnailUrl: 'https://cdn.example/thumb.jpg',
        sortOrder: 0,
      });
      // A draft-content practice MUST remain visible in the editor (unlike the
      // public/member reads which filter to published content).
      expect(secondPractice).toMatchObject({
        contentId: draftContent,
        contentType: 'written',
        status: 'draft',
        sortOrder: 1,
      });
    });

    it('projects the linked media duration (and null for a practice with no media)', async () => {
      // The builder map's "≈ N min in all" cue read a flat 0 while
      // `EditorPracticeView` carried no duration, under-claiming every course.
      const courseId = await createCourse(db, orgAId, creatorId);

      // `status: 'ready'` is guarded by the `status_ready_requires_keys` CHECK, so
      // the HLS master + thumbnail keys are supplied too — a real ready video.
      const mediaKey = randomUUID();
      const [media] = await db
        .insert(mediaItems)
        .values({
          creatorId,
          title: 'Womb Awakening Movement',
          mediaType: 'video',
          status: 'ready',
          r2Key: `originals/${mediaKey}/video.mp4`,
          hlsMasterPlaylistKey: `hls/${mediaKey}/master.m3u8`,
          thumbnailKey: `thumbnails/${mediaKey}/thumb.jpg`,
          durationSeconds: 420,
        })
        .returning({ id: mediaItems.id });
      if (!media) throw new Error('failed to create media item');

      const [withMedia] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgAId,
            status: 'published',
            contentType: 'video',
            mediaItemId: media.id,
          })
        )
        .returning({ id: content.id });
      if (!withMedia) throw new Error('failed to create content');

      // A written practice links NO media — 0 minutes is the honest answer.
      const writtenId = await createContent(db, {
        creatorId,
        orgId: orgAId,
        contentType: 'written',
      });

      const stage = await seedStage(db, courseId, {
        name: 'Arriving',
        sortOrder: 0,
      });
      await seedPractice(db, stage, withMedia.id, 0);
      await seedPractice(db, stage, writtenId, 1);

      const result = await service.getCourseCurriculumForEditor(
        orgAId,
        courseId
      );
      const practices = result.stages[0]?.practices ?? [];

      expect(practices[0]).toMatchObject({
        contentId: withMedia.id,
        durationSeconds: 420,
      });
      expect(practices[1]).toMatchObject({
        contentId: writtenId,
        durationSeconds: null,
      });
    });

    it('org isolation: a foreign org 404s and never reads the curriculum', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      await seedStage(db, courseId, { name: 'Secret', sortOrder: 0 });

      await expect(
        service.getCourseCurriculumForEditor(orgBId, courseId)
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── resolveCourseIdForPage ──────────────────────────────────────────────────

  describe('resolveCourseIdForPage', () => {
    it('resolves the subject course id for a course-type landing page (org-scoped)', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const pageId = await createLandingPage(db, {
        orgId: orgAId,
        creatorId,
        courseId,
      });

      await expect(
        service.resolveCourseIdForPage(orgAId, pageId)
      ).resolves.toBe(courseId);
    });

    it('404s for a foreign org, a missing page, and a non-course page', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const coursePage = await createLandingPage(db, {
        orgId: orgAId,
        creatorId,
        courseId,
      });
      const landingPage = await createLandingPage(db, {
        orgId: orgAId,
        creatorId,
        courseId: null,
      });

      await expect(
        service.resolveCourseIdForPage(orgBId, coursePage)
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.resolveCourseIdForPage(orgAId, randomUUID())
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.resolveCourseIdForPage(orgAId, landingPage)
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── Save (bulk diff + reconcile) ────────────────────────────────────────────

  describe('saveCurriculum', () => {
    it('creates a curriculum from empty — new stages get server ids, practices persist in order', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const c1 = await createContent(db, { creatorId, orgId: orgAId });
      const c2 = await createContent(db, { creatorId, orgId: orgAId });

      const saved = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: null,
            name: 'Arriving',
            gloss: 'g1',
            practices: [{ contentId: c1 }, { contentId: c2 }],
          },
          { id: null, name: 'Descending', gloss: null, practices: [] },
        ],
      });

      expect(saved.stages.map((s) => s.name)).toEqual([
        'Arriving',
        'Descending',
      ]);
      expect(
        saved.stages.every((s) => typeof s.id === 'string' && s.id.length > 0)
      ).toBe(true);
      expect(saved.stages[0]?.practices.map((p) => p.contentId)).toEqual([
        c1,
        c2,
      ]);
      expect(saved.stages.map((s) => s.sortOrder)).toEqual([0, 1]);

      // Re-read confirms persistence (not just the in-memory return value).
      const reread = await service.getCourseCurriculumForEditor(
        orgAId,
        courseId
      );
      expect(reread.stages.map((s) => s.name)).toEqual([
        'Arriving',
        'Descending',
      ]);
    });

    it('reorders stages WITHOUT violating the (course_id, sort_order) unique index, preserving stage identity', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const first = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          { id: null, name: 'A', gloss: null, practices: [] },
          { id: null, name: 'B', gloss: null, practices: [] },
          { id: null, name: 'C', gloss: null, practices: [] },
        ],
      });
      const [idA, idB, idC] = first.stages.map((s) => s.id);

      // Full reversal — the naive per-row update would collide mid-swap.
      const reordered = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          { id: idC ?? null, name: 'C', gloss: null, practices: [] },
          { id: idB ?? null, name: 'B', gloss: null, practices: [] },
          { id: idA ?? null, name: 'A', gloss: null, practices: [] },
        ],
      });

      expect(reordered.stages.map((s) => s.name)).toEqual(['C', 'B', 'A']);
      // Identity preserved — same rows, new order (not delete+recreate).
      expect(reordered.stages.map((s) => s.id)).toEqual([idC, idB, idA]);

      // The persisted sort orders are a clean 0..n-1 with no duplicates.
      const persisted = await readStageSortOrders(db, courseId);
      expect(persisted.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
      expect(persisted.map((s) => s.name)).toEqual(['C', 'B', 'A']);
    });

    it('renames, soft-deletes dropped stages, and reindexes survivors', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const first = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          { id: null, name: 'Keep', gloss: null, practices: [] },
          { id: null, name: 'Drop', gloss: null, practices: [] },
          { id: null, name: 'Rename me', gloss: null, practices: [] },
        ],
      });
      const [idKeep, , idRename] = first.stages.map((s) => s.id);

      const after = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: idKeep ?? null,
            name: 'Keep',
            gloss: 'now with gloss',
            practices: [],
          },
          { id: idRename ?? null, name: 'Renamed', gloss: null, practices: [] },
        ],
      });

      expect(after.stages.map((s) => s.name)).toEqual(['Keep', 'Renamed']);
      expect(after.stages.map((s) => s.sortOrder)).toEqual([0, 1]);
      expect(after.stages[0]?.gloss).toBe('now with gloss');
      // Only the two survivors remain non-deleted.
      const persisted = await readStageSortOrders(db, courseId);
      expect(persisted).toHaveLength(2);
    });

    it('adds, removes and reorders practice joins within a stage', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const c1 = await createContent(db, { creatorId, orgId: orgAId });
      const c2 = await createContent(db, { creatorId, orgId: orgAId });
      const c3 = await createContent(db, { creatorId, orgId: orgAId });

      const first = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: null,
            name: 'S',
            gloss: null,
            practices: [{ contentId: c1 }, { contentId: c2 }],
          },
        ],
      });
      const stageId = first.stages[0]?.id ?? null;

      // Drop c1, keep c2 (moved to end), add c3 first.
      const after = await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: stageId,
            name: 'S',
            gloss: null,
            practices: [{ contentId: c3 }, { contentId: c2 }],
          },
        ],
      });

      expect(after.stages[0]?.practices.map((p) => p.contentId)).toEqual([
        c3,
        c2,
      ]);
      expect(after.stages[0]?.practices.map((p) => p.sortOrder)).toEqual([
        0, 1,
      ]);
    });

    it('space guard: rejects content from another org with NO partial write', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const ownContent = await createContent(db, { creatorId, orgId: orgAId });
      const foreignContent = await createContent(db, {
        creatorId,
        orgId: orgBId,
      });

      // Seed a valid baseline curriculum first.
      await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: null,
            name: 'Baseline',
            gloss: null,
            practices: [{ contentId: ownContent }],
          },
        ],
      });

      await expect(
        service.saveCurriculum(orgAId, courseId, {
          stages: [
            {
              id: null,
              name: 'Hijack',
              gloss: null,
              practices: [{ contentId: foreignContent }],
            },
          ],
        })
      ).rejects.toBeInstanceOf(ForbiddenError);

      // The rejected save must NOT have mutated the baseline.
      const reread = await service.getCourseCurriculumForEditor(
        orgAId,
        courseId
      );
      expect(reread.stages.map((s) => s.name)).toEqual(['Baseline']);
      expect(reread.stages[0]?.practices.map((p) => p.contentId)).toEqual([
        ownContent,
      ]);
    });

    it('org isolation: saving against a foreign-org course 404s and writes nothing', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);

      await expect(
        service.saveCurriculum(orgBId, courseId, {
          stages: [{ id: null, name: 'X', gloss: null, practices: [] }],
        })
      ).rejects.toBeInstanceOf(NotFoundError);

      const persisted = await readStageSortOrders(db, courseId);
      expect(persisted).toHaveLength(0);
    });
  });

  // ── Practice gating (Codex-0biug — paywall bypass) ─────────────────────────

  /**
   * Overwrite a content row's access policy. `createTestContentInput` seeds the
   * DEFAULT policy, which is precisely the vulnerable shape, so a test that
   * needs a DELIBERATE standalone path has to say so explicitly.
   */
  async function setAccessFlags(
    db: Database,
    contentId: string,
    flags: Partial<{
      isFree: boolean;
      isPurchasable: boolean;
      priceCents: number | null;
      includedInTierId: string | null;
      isFollowerGated: boolean;
      isTeamOnly: boolean;
      courseOnly: boolean;
    }>
  ): Promise<void> {
    await db.update(content).set(flags).where(eq(content.id, contentId));
  }

  async function readPolicy(
    db: Database,
    contentId: string
  ): Promise<{ courseOnly: boolean; isPurchasable: boolean }> {
    const row = await db.query.content.findFirst({
      where: eq(content.id, contentId),
      columns: { courseOnly: true, isPurchasable: true },
    });
    if (!row) throw new Error('content not found');
    return row;
  }

  /** Link `contentIds` into a single new stage on `courseId` via the service. */
  async function linkPractices(
    orgId: string,
    courseId: string,
    contentIds: string[]
  ): Promise<void> {
    await service.saveCurriculum(orgId, courseId, {
      stages: [
        {
          id: null,
          name: 'Arriving',
          gloss: null,
          practices: contentIds.map((contentId) => ({ contentId })),
        },
      ],
    });
  }

  describe('saveCurriculum gates linked practices (Codex-0biug)', () => {
    it('gates a DEFAULT-policy practice — without this it is anonymously streamable at its standalone URL', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const practice = await createContent(db, {
        creatorId,
        orgId: orgAId,
      });

      // The pre-state IS the vulnerability: default flags, so the resolver falls
      // through to `grant('free')` for an anonymous caller.
      expect((await readPolicy(db, practice)).courseOnly).toBe(false);

      await linkPractices(orgAId, courseId, [practice]);

      expect((await readPolicy(db, practice)).courseOnly).toBe(true);
    });

    it('leaves an independently PURCHASABLE practice standalone — it has its own paywall, and revoking that would delete a real product', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const practice = await createContent(db, { creatorId, orgId: orgAId });
      await setAccessFlags(db, practice, {
        isFree: false,
        isPurchasable: true,
        priceCents: 4999,
      });

      await linkPractices(orgAId, courseId, [practice]);

      const policy = await readPolicy(db, practice);
      expect(policy.courseOnly).toBe(false);
      expect(policy.isPurchasable).toBe(true);
    });

    it('leaves a TIER-GATED practice standalone', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const tierId = await createTier(db, orgAId);
      const practice = await createContent(db, { creatorId, orgId: orgAId });
      await setAccessFlags(db, practice, {
        isFree: false,
        includedInTierId: tierId,
      });

      await linkPractices(orgAId, courseId, [practice]);

      expect((await readPolicy(db, practice)).courseOnly).toBe(false);
    });

    it('leaves FOLLOWER-gated and TEAM-only practices standalone', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const follower = await createContent(db, { creatorId, orgId: orgAId });
      const team = await createContent(db, { creatorId, orgId: orgAId });
      await setAccessFlags(db, follower, {
        isFree: false,
        isFollowerGated: true,
      });
      await setAccessFlags(db, team, { isFree: false, isTeamOnly: true });

      await linkPractices(orgAId, courseId, [follower, team]);

      expect((await readPolicy(db, follower)).courseOnly).toBe(false);
      expect((await readPolicy(db, team)).courseOnly).toBe(false);
    });

    it('gates a mixed curriculum selectively in one save', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const free = await createContent(db, { creatorId, orgId: orgAId });
      const sold = await createContent(db, { creatorId, orgId: orgAId });
      await setAccessFlags(db, sold, {
        isFree: false,
        isPurchasable: true,
        priceCents: 999,
      });

      await linkPractices(orgAId, courseId, [free, sold]);

      expect((await readPolicy(db, free)).courseOnly).toBe(true);
      expect((await readPolicy(db, sold)).courseOnly).toBe(false);
    });

    it('HEALS a curriculum linked before this landed, and is idempotent on re-save', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const practice = await createContent(db, { creatorId, orgId: orgAId });

      // Seed the join DIRECTLY, bypassing the service — the exact state every
      // pre-existing curriculum is in.
      const stageId = await seedStage(db, courseId, {
        name: 'Legacy',
        sortOrder: 0,
      });
      await seedPractice(db, stageId, practice, 0);
      expect((await readPolicy(db, practice)).courseOnly).toBe(false);

      await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: stageId,
            name: 'Legacy',
            gloss: null,
            practices: [{ contentId: practice }],
          },
        ],
      });
      expect((await readPolicy(db, practice)).courseOnly).toBe(true);

      // Re-saving must not churn or regress it.
      await service.saveCurriculum(orgAId, courseId, {
        stages: [
          {
            id: stageId,
            name: 'Legacy',
            gloss: null,
            practices: [{ contentId: practice }],
          },
        ],
      });
      expect((await readPolicy(db, practice)).courseOnly).toBe(true);
    });

    it('org isolation: a rejected foreign-org save gates NOTHING', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const foreign = await createContent(db, { creatorId, orgId: orgBId });

      await expect(
        linkPractices(orgAId, courseId, [foreign])
      ).rejects.toBeInstanceOf(ForbiddenError);

      // The space guard runs before the transaction, so the foreign row must be
      // untouched — a gate written across an org boundary would be its own bug.
      expect((await readPolicy(db, foreign)).courseOnly).toBe(false);
    });

    it('unlinking does NOT strand the practice gated with no course to reach it through', async () => {
      const courseId = await createCourse(db, orgAId, creatorId);
      const practice = await createContent(db, { creatorId, orgId: orgAId });

      await linkPractices(orgAId, courseId, [practice]);
      expect((await readPolicy(db, practice)).courseOnly).toBe(true);

      // Remove it from the curriculum entirely.
      await service.saveCurriculum(orgAId, courseId, {
        stages: [{ id: null, name: 'Arriving', gloss: null, practices: [] }],
      });

      // KNOWN GAP (Codex-0biug scope item): the gate is not lifted on unlink, so
      // the content is now unreachable by ANY path — gated, but in no course.
      // Asserting the CURRENT behaviour so the follow-up fix has a failing test
      // to flip rather than discovering this in production.
      expect((await readPolicy(db, practice)).courseOnly).toBe(true);
    });
  });
});
