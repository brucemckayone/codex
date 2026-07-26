/**
 * CourseJourneyService (Codex-2pryk · Round-D · Codex-776gg · SPEC §11 / §14).
 *
 * The MEMBER-SURFACE read side of a course — everything the dashboard and the
 * in-course player need AFTER entitlement is decided. This is deliberately
 * separate from:
 *   - the entitlement DECISION (`ContentAccessService.canEnterCourse` / `canView`),
 *   - the streaming URL mint (`ContentAccessService.getStreamingUrl`),
 *   - the monetization OFFER (`CourseAccessService.getCourseOffer`).
 *
 * It owns only the curriculum + progress projections (SPEC §11):
 *   - {@link getCourseBySlug}       — resolve a course summary from (orgId, slug).
 *   - {@link getCourseDashboard}    — enrollment + ordered stages + the
 *     `practice_completions ⋈ stage_practices` rollup scoped to the user.
 *   - {@link getInCoursePractice}   — one practice + the ordered playlist +
 *     server-known completions + resume position (the signed stream URL is
 *     composed by the route via `ContentAccessService`, the single signing
 *     authority — this service NEVER signs).
 *   - {@link recordPracticeCompletion} — idempotent completion write (the
 *     `uq_practice_completion_user_content` index makes a repeat a no-op).
 *
 * Reads are per-request, user-scoped, and never cross-user cached (HARDENING §E).
 * The routes gate the dashboard/practice reads on `canEnterCourse` upstream, so
 * this service composes the shapes and does NOT re-run the entitlement decision.
 */

import { CONTENT_STATUS } from '@codex/constants';
import {
  content,
  courseEnrollments,
  courseStages,
  courses,
  courseTestimonials,
  landingPages,
  mediaItems,
  organizations,
  practiceCompletions,
  stagePractices,
  videoPlayback,
} from '@codex/database/schema';
import { BaseService } from '@codex/service-errors';
import type {
  BrandTokenOverrides,
  CompletionSource,
  CourseDashboardData,
  CourseSellPreview,
  CourseSellPreviewClip,
  EnrolledCourseProgress,
  EnrolledCourseSummary,
  InCoursePracticeData,
  JourneyCoursePage,
  JourneyCourseSummary,
  JourneyEnrollment,
  JourneyPractice,
  JourneyStage,
  JourneyStageView,
  JourneyTestimonialView,
  PageSection,
  PageStatus,
  PlaylistEntry,
  PracticeCompletionRecord,
  PracticeContentType,
} from '@codex/shared-types';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Narrow a stored `content.contentType` varchar to the practice union. The DB
 * CHECK (`content_type IN ('video','audio','written')`) guarantees one of these;
 * fall back to `'video'` for any legacy/unexpected value (mirrors the library
 * aggregation's defensive default rather than throwing on a read path).
 */
function toPracticeContentType(value: string | null): PracticeContentType {
  return value === 'audio' || value === 'written' ? value : 'video';
}

/**
 * Summarise the member-library journey-card rollup from the SAME curriculum +
 * completion shapes the dashboard uses (`practice_completions ⋈ stage_practices`,
 * SPEC §11). Flattens the curriculum in course order (stage → practice
 * `sortOrder`) so `nextPractice*` is the first incomplete step to resume.
 */
function rollUpEnrollment(
  stages: readonly JourneyStage[],
  completions: readonly PracticeCompletionRecord[]
): EnrolledCourseProgress {
  const completedIds = new Set(completions.map((c) => c.contentId));
  const ordered = [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((s) => [...s.practices].sort((a, b) => a.sortOrder - b.sortOrder));

  const total = ordered.length;
  const done = ordered.filter((p) => completedIds.has(p.contentId)).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const status: EnrolledCourseProgress['status'] =
    total === 0 || done === 0
      ? 'not-started'
      : done >= total
        ? 'completed'
        : 'in-progress';

  const next = ordered.find((p) => !completedIds.has(p.contentId)) ?? null;
  // ISO-8601 strings sort lexicographically, so a string max == the latest date.
  const lastCompletedAt = completions.reduce<string | null>(
    (max, c) => (max === null || c.completedAt > max ? c.completedAt : max),
    null
  );

  return {
    done,
    total,
    percent,
    status,
    lastCompletedAt,
    nextPracticeSlug: next?.slug ?? null,
    nextPracticeTitle: next?.title ?? null,
  };
}

export class CourseJourneyService extends BaseService {
  /**
   * Resolve the public course summary for `(organizationId, slug)`. Scoped to
   * PUBLISHED, non-deleted courses (member/public surface). Returns `null` when
   * no such course exists — the route maps that to `{ data: null }`.
   */
  async getCourseBySlug(
    organizationId: string,
    slug: string
  ): Promise<JourneyCourseSummary | null> {
    try {
      const [row] = await this.db
        .select({
          id: courses.id,
          slug: courses.slug,
          title: courses.title,
          organizationSlug: organizations.slug,
        })
        .from(courses)
        .leftJoin(organizations, eq(organizations.id, courses.organizationId))
        .where(
          and(
            eq(courses.organizationId, organizationId),
            eq(courses.slug, slug),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .limit(1);

      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        organizationSlug: row.organizationSlug ?? null,
      };
    } catch (error) {
      this.handleError(error, 'getCourseBySlug');
    }
  }

  /**
   * Resolve the PUBLIC course sales page for `(organizationId, slug)` — the
   * awaited shell of the WP-3 sell surface (SPEC §4/§5). This is a fully PUBLIC
   * read: NO `canView` / entitlement gate (HARDENING §E course-sell row). Scoped
   * to a PUBLISHED, non-deleted landing page whose subject is a PUBLISHED,
   * non-deleted course in the SAME org. Returns `null` when no such page exists
   * (→ the route maps that to `{ data: null }` → the load throws 404).
   *
   * The streamed sell-preview media is a separate read ({@link getCourseSellPreview})
   * so first paint / SEO never blocks on R2/CDN resolution.
   */
  async getCoursePage(
    organizationId: string,
    slug: string
  ): Promise<JourneyCoursePage | null> {
    try {
      // 1. The published landing page by org-scoped slug (partial-unique index).
      const [pageRow] = await this.db
        .select({
          id: landingPages.id,
          organizationId: landingPages.organizationId,
          publishedAt: landingPages.publishedAt,
          pageType: landingPages.pageType,
          slug: landingPages.slug,
          title: landingPages.title,
          status: landingPages.status,
          subjectType: landingPages.subjectType,
          subjectId: landingPages.subjectId,
          brandOverrides: landingPages.brandOverrides,
          sections: landingPages.sections,
        })
        .from(landingPages)
        .where(
          and(
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.slug, slug),
            eq(landingPages.status, CONTENT_STATUS.PUBLISHED),
            isNull(landingPages.deletedAt)
          )
        )
        .limit(1);

      if (!pageRow) return null;

      // A course-sell page must bind a course subject (validated here, not by an
      // FK — HARDENING §C polymorphic subject). Anything else has no curriculum.
      if (pageRow.subjectType !== 'course' || !pageRow.subjectId) return null;

      // 2. The subject course — PUBLISHED, non-deleted, and space-scoped to the
      //    SAME org as the page (guards a cross-org subjectId).
      const [courseRow] = await this.db
        .select({
          id: courses.id,
          slug: courses.slug,
          title: courses.title,
          kicker: courses.kicker,
          lede: courses.lede,
          status: courses.status,
          priceCents: courses.priceCents,
        })
        .from(courses)
        .where(
          and(
            eq(courses.id, pageRow.subjectId),
            eq(courses.organizationId, organizationId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .limit(1);

      if (!courseRow) return null;

      // 3. Curriculum + social proof (bounded, parallel).
      const [stages, testimonials] = await Promise.all([
        this.loadPublicStages(courseRow.id),
        this.loadTestimonials(courseRow.id),
      ]);

      const practiceCount = stages.reduce(
        (total, stage) => total + stage.practices.length,
        0
      );

      return {
        page: {
          id: pageRow.id,
          organizationId: pageRow.organizationId,
          publishedAt: pageRow.publishedAt?.toISOString() ?? null,
          pageType: pageRow.pageType,
          slug: pageRow.slug,
          title: pageRow.title,
          status: pageRow.status as PageStatus,
          subjectType: pageRow.subjectType,
          subjectId: pageRow.subjectId,
          brandOverrides:
            (pageRow.brandOverrides as BrandTokenOverrides) ?? null,
          sections: (pageRow.sections as PageSection[]) ?? [],
        },
        course: {
          id: courseRow.id,
          slug: courseRow.slug,
          title: courseRow.title,
          kicker: courseRow.kicker,
          lede: courseRow.lede,
          status: courseRow.status as PageStatus,
          priceCents: courseRow.priceCents,
          stageCount: stages.length,
          practiceCount,
        },
        stages,
        testimonials,
      };
    } catch (error) {
      this.handleError(error, 'getCoursePage');
    }
  }

  /**
   * Resolve the PUBLIC 30s sell-preview clips for a course's intro-film +
   * practice reel (SPEC §10) — the streamed, off-critical-path payload of the
   * sales page. PUBLIC: NO auth, NO `canView` (HARDENING §E). The clips reuse the
   * SAME public preview path the org-landing hero consumes —
   * `mediaItems.hlsPreviewKey` resolved to a CDN URL by plain concatenation with
   * `R2_PUBLIC_URL_BASE` (mirrors `content-api/routes/public.ts` `resolveR2Urls`);
   * NO R2 signing is ever involved. A clip is `null` when the course has no such
   * media, its preview has not transcoded (`hlsPreviewKey` null), or no CDN base
   * is configured. Returns `null` when the course is not published/non-deleted.
   */
  async getCourseSellPreview(
    courseId: string,
    r2PublicUrlBase: string | undefined
  ): Promise<CourseSellPreview | null> {
    try {
      const [courseRow] = await this.db
        .select({
          introVideoMediaId: courses.introVideoMediaId,
          previewVideoMediaId: courses.previewVideoMediaId,
        })
        .from(courses)
        .where(
          and(
            eq(courses.id, courseId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .limit(1);

      if (!courseRow) return null;

      const mediaIds = [
        courseRow.introVideoMediaId,
        courseRow.previewVideoMediaId,
      ].filter((id): id is string => id !== null);

      const previewByMediaId = new Map<
        string,
        {
          hlsPreviewKey: string | null;
          thumbnailKey: string | null;
          durationSeconds: number | null;
        }
      >();

      if (mediaIds.length > 0) {
        const mediaRows = await this.db
          .select({
            id: mediaItems.id,
            hlsPreviewKey: mediaItems.hlsPreviewKey,
            thumbnailKey: mediaItems.thumbnailKey,
            durationSeconds: mediaItems.durationSeconds,
          })
          .from(mediaItems)
          .where(inArray(mediaItems.id, mediaIds));
        for (const row of mediaRows) previewByMediaId.set(row.id, row);
      }

      // Resolve one media id → a public clip. Null unless a transcoded preview
      // key AND a CDN base exist (a preview-less clip has no playable manifest).
      const toClip = (mediaId: string | null): CourseSellPreviewClip | null => {
        if (!mediaId) return null;
        const media = previewByMediaId.get(mediaId);
        if (!media?.hlsPreviewKey || !r2PublicUrlBase) return null;
        return {
          playlistUrl: `${r2PublicUrlBase}/${media.hlsPreviewKey}`,
          posterUrl: media.thumbnailKey
            ? `${r2PublicUrlBase}/${media.thumbnailKey}`
            : null,
          durationSeconds: media.durationSeconds ?? null,
        };
      };

      return {
        intro: toClip(courseRow.introVideoMediaId),
        reel: toClip(courseRow.previewVideoMediaId),
      };
    } catch (error) {
      this.handleError(error, 'getCourseSellPreview');
    }
  }

  /**
   * Build the dashboard payload (SPEC §11). Returns `null` when the course is not
   * a published, non-deleted course. The route has already confirmed the caller
   * `canEnterCourse` (entitlement gate), so this only projects the data.
   *
   * NOTE (Round-D): if the entitled user has no `course_enrollments` row yet, a
   * TRANSIENT enrollment (enrolledAt = now) is synthesised so the dashboard
   * renders — SPEC §11 says an enrollment is created "on entitlement grant OR
   * first dashboard access". Persisting that row is owned by WP-6's grant path
   * (and a Phase-2 first-access write); this read never writes.
   */
  async getCourseDashboard(
    userId: string,
    courseId: string
  ): Promise<CourseDashboardData | null> {
    try {
      const course = await this.loadCourseSummaryById(courseId);
      if (!course) return null;

      const [enrollmentRow, stages] = await Promise.all([
        this.db.query.courseEnrollments.findFirst({
          where: and(
            eq(courseEnrollments.userId, userId),
            eq(courseEnrollments.courseId, courseId)
          ),
          columns: {
            courseId: true,
            enrolledAt: true,
            lastActivityAt: true,
            completedAt: true,
          },
        }),
        this.loadStages(courseId),
      ]);

      const completions = await this.loadCompletions(userId, stages);

      const enrollment: JourneyEnrollment = enrollmentRow
        ? {
            courseId: enrollmentRow.courseId,
            enrolledAt: enrollmentRow.enrolledAt.toISOString(),
            lastActivityAt: enrollmentRow.lastActivityAt?.toISOString() ?? null,
            completedAt: enrollmentRow.completedAt?.toISOString() ?? null,
          }
        : {
            // Transient first-access enrollment — see method NOTE.
            courseId,
            enrolledAt: new Date().toISOString(),
            lastActivityAt: null,
            completedAt: null,
          };

      return { course, enrollment, stages, completions };
    } catch (error) {
      this.handleError(error, 'getCourseDashboard');
    }
  }

  /**
   * Resolve one in-course practice by `(courseId, contentSlug)` plus the whole
   * ordered playlist, the user's course-wide completions, and the resume
   * position. `streamingUrl` / `waveformUrl` are left `null` — the route fills
   * them for media via `ContentAccessService.getStreamingUrl` (the single
   * signing + `canView` authority). `bodyHtml` carries the stored body for
   * `written` practices.
   *
   * Returns `null` when the practice is not a published, non-deleted practice of
   * the course.
   */
  async getInCoursePractice(
    userId: string,
    courseId: string,
    contentSlug: string
  ): Promise<InCoursePracticeData | null> {
    try {
      const course = await this.loadCourseSummaryById(courseId);
      if (!course) return null;

      const stages = await this.loadStages(courseId);

      // Find the target practice + its stage within the loaded curriculum.
      let stageMatch: { id: string; name: string } | null = null;
      let practiceMatch: JourneyPractice | null = null;
      for (const stage of stages) {
        const practice = stage.practices.find((p) => p.slug === contentSlug);
        if (practice) {
          stageMatch = { id: stage.id, name: stage.name };
          practiceMatch = practice;
          break;
        }
      }
      if (!stageMatch || !practiceMatch) return null;

      const [completions, progressSeconds, bodyHtml] = await Promise.all([
        this.loadCompletions(userId, stages),
        this.loadResumeSeconds(userId, practiceMatch.contentId),
        practiceMatch.contentType === 'written'
          ? this.loadContentBody(practiceMatch.contentId)
          : Promise.resolve(null),
      ]);

      return {
        course,
        stage: stageMatch,
        practice: practiceMatch,
        // Signed URLs are minted by the route via ContentAccessService.
        streamingUrl: null,
        waveformUrl: null,
        bodyHtml,
        initialProgressSeconds: progressSeconds,
        playlist: flattenPlaylist(stages),
        completions,
      };
    } catch (error) {
      this.handleError(error, 'getInCoursePractice');
    }
  }

  /**
   * Record a practice completion, idempotently. The
   * `uq_practice_completion_user_content` unique index makes a repeat a no-op:
   * `onConflictDoNothing()` inserts once, and a conflicting call reads back the
   * existing row so the caller always settles on the canonical record.
   */
  async recordPracticeCompletion(
    userId: string,
    contentId: string,
    source: CompletionSource
  ): Promise<PracticeCompletionRecord> {
    try {
      const [inserted] = await this.db
        .insert(practiceCompletions)
        .values({ userId, contentId, source })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        return {
          contentId: inserted.contentId,
          completedAt: inserted.completedAt.toISOString(),
          source: inserted.source as CompletionSource,
        };
      }

      // Conflict: a completion already exists — read it back (no-op repeat).
      const existing = await this.db.query.practiceCompletions.findFirst({
        where: and(
          eq(practiceCompletions.userId, userId),
          eq(practiceCompletions.contentId, contentId)
        ),
        columns: { contentId: true, completedAt: true, source: true },
      });
      if (!existing) {
        // onConflictDoNothing suppressed the insert but no row is present — a
        // concurrent delete raced us. Surface it rather than fabricate a record.
        throw new Error(
          'practice completion insert suppressed but no existing row found'
        );
      }
      return {
        contentId: existing.contentId,
        completedAt: existing.completedAt.toISOString(),
        source: existing.source as CompletionSource,
      };
    } catch (error) {
      this.handleError(error, 'recordPracticeCompletion');
    }
  }

  /**
   * List every course the caller is enrolled in within ONE org — the member
   * library "Your journeys" shelf (SPEC §8.4). STRICTLY scoped to
   * `(userId, organizationId)`: the enrollment join is filtered by `userId` and
   * the course by `organizationId` + PUBLISHED + non-deleted, so another user's
   * enrollments and other orgs' / draft courses can never surface (IDOR guard).
   *
   * Each row carries the course chrome (kicker / lede / guide name), the
   * enrollment, its access `source` (→ card badge), and the progress rollup —
   * the SAME `practice_completions ⋈ stage_practices` rollup the dashboard uses
   * (reusing {@link loadStages} + {@link loadCompletions}). One rollup pair of
   * bounded reads per enrolled course; enrollment counts are small in practice.
   */
  async listEnrolledCourses(
    userId: string,
    organizationId: string
  ): Promise<EnrolledCourseSummary[]> {
    try {
      const rows = await this.db
        .select({
          courseId: courses.id,
          slug: courses.slug,
          title: courses.title,
          kicker: courses.kicker,
          lede: courses.lede,
          guide: courses.guide,
          organizationSlug: organizations.slug,
          enrolledAt: courseEnrollments.enrolledAt,
          lastActivityAt: courseEnrollments.lastActivityAt,
          completedAt: courseEnrollments.completedAt,
          source: courseEnrollments.source,
        })
        .from(courseEnrollments)
        .innerJoin(courses, eq(courses.id, courseEnrollments.courseId))
        .leftJoin(organizations, eq(organizations.id, courses.organizationId))
        .where(
          and(
            eq(courseEnrollments.userId, userId),
            eq(courses.organizationId, organizationId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .orderBy(desc(courseEnrollments.enrolledAt));

      if (rows.length === 0) return [];

      const summaries: EnrolledCourseSummary[] = [];
      for (const row of rows) {
        const stages = await this.loadStages(row.courseId);
        const completions = await this.loadCompletions(userId, stages);
        summaries.push({
          course: {
            id: row.courseId,
            slug: row.slug,
            title: row.title,
            organizationSlug: row.organizationSlug ?? null,
            kicker: row.kicker ?? null,
            lede: row.lede ?? null,
            guideName: row.guide?.name ?? null,
          },
          enrollment: {
            courseId: row.courseId,
            enrolledAt: row.enrolledAt.toISOString(),
            lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
            completedAt: row.completedAt?.toISOString() ?? null,
          },
          enrollmentSource: row.source,
          progress: rollUpEnrollment(stages, completions),
        });
      }
      return summaries;
    } catch (error) {
      this.handleError(error, 'listEnrolledCourses');
    }
  }

  // ── Private read helpers ──────────────────────────────────────────────────

  /**
   * Course summary + org slug for a PUBLISHED, non-deleted course id.
   */
  private async loadCourseSummaryById(
    courseId: string
  ): Promise<JourneyCourseSummary | null> {
    const [row] = await this.db
      .select({
        id: courses.id,
        slug: courses.slug,
        title: courses.title,
        organizationSlug: organizations.slug,
      })
      .from(courses)
      .leftJoin(organizations, eq(organizations.id, courses.organizationId))
      .where(
        and(
          eq(courses.id, courseId),
          eq(courses.status, CONTENT_STATUS.PUBLISHED),
          isNull(courses.deletedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      organizationSlug: row.organizationSlug ?? null,
    };
  }

  /**
   * Load the ordered curriculum: non-deleted stages (by `sortOrder`) each with
   * their PUBLISHED, non-deleted practice content (by `stage_practices.sortOrder`).
   * Two bounded queries (stages, then practices) so a stage with no practices
   * still appears. `durationSeconds` / `thumbnailUrl` fall back to the media item.
   */
  private async loadStages(courseId: string): Promise<JourneyStage[]> {
    const stageRows = await this.db
      .select({
        id: courseStages.id,
        name: courseStages.name,
        gloss: courseStages.gloss,
        sortOrder: courseStages.sortOrder,
      })
      .from(courseStages)
      .where(
        and(eq(courseStages.courseId, courseId), isNull(courseStages.deletedAt))
      )
      .orderBy(asc(courseStages.sortOrder));

    if (stageRows.length === 0) return [];

    const stageIds = stageRows.map((s) => s.id);

    const practiceRows = await this.db
      .select({
        stageId: stagePractices.stageId,
        sortOrder: stagePractices.sortOrder,
        contentId: content.id,
        slug: content.slug,
        title: content.title,
        contentType: content.contentType,
        thumbnailUrl: content.thumbnailUrl,
        mediaThumbnailKey: mediaItems.thumbnailKey,
        mediaDurationSeconds: mediaItems.durationSeconds,
      })
      .from(stagePractices)
      .innerJoin(content, eq(content.id, stagePractices.contentId))
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .where(
        and(
          inArray(stagePractices.stageId, stageIds),
          eq(content.status, CONTENT_STATUS.PUBLISHED),
          isNull(content.deletedAt)
        )
      )
      .orderBy(asc(stagePractices.sortOrder));

    const practicesByStage = new Map<string, JourneyPractice[]>();
    for (const row of practiceRows) {
      const practice: JourneyPractice = {
        contentId: row.contentId,
        slug: row.slug,
        title: row.title,
        contentType: toPracticeContentType(row.contentType),
        durationSeconds: row.mediaDurationSeconds ?? null,
        thumbnailUrl: row.thumbnailUrl ?? row.mediaThumbnailKey ?? null,
        sortOrder: row.sortOrder,
      };
      const list = practicesByStage.get(row.stageId);
      if (list) list.push(practice);
      else practicesByStage.set(row.stageId, [practice]);
    }

    return stageRows.map((stage) => ({
      id: stage.id,
      name: stage.name,
      gloss: stage.gloss,
      sortOrder: stage.sortOrder,
      practices: (practicesByStage.get(stage.id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder
      ),
    }));
  }

  /**
   * Load the ordered curriculum for the PUBLIC sales page (SPEC §5): non-deleted
   * stages (by `sortOrder`), each with its PUBLISHED, non-deleted practices (by
   * `stage_practices.sortOrder`). Distinct from {@link loadStages} (the member
   * dashboard shape): the public view carries NO completion flag and NO media
   * (duration / thumbnail / stream) — the sell map lists titles + types only.
   */
  private async loadPublicStages(
    courseId: string
  ): Promise<JourneyStageView[]> {
    const stageRows = await this.db
      .select({
        id: courseStages.id,
        name: courseStages.name,
        gloss: courseStages.gloss,
        sortOrder: courseStages.sortOrder,
      })
      .from(courseStages)
      .where(
        and(eq(courseStages.courseId, courseId), isNull(courseStages.deletedAt))
      )
      .orderBy(asc(courseStages.sortOrder));

    if (stageRows.length === 0) return [];

    const stageIds = stageRows.map((s) => s.id);

    const practiceRows = await this.db
      .select({
        stageId: stagePractices.stageId,
        sortOrder: stagePractices.sortOrder,
        contentId: content.id,
        slug: content.slug,
        title: content.title,
        contentType: content.contentType,
      })
      .from(stagePractices)
      .innerJoin(content, eq(content.id, stagePractices.contentId))
      .where(
        and(
          inArray(stagePractices.stageId, stageIds),
          eq(content.status, CONTENT_STATUS.PUBLISHED),
          isNull(content.deletedAt)
        )
      )
      .orderBy(asc(stagePractices.sortOrder));

    const practicesByStage = new Map<string, JourneyStageView['practices']>();
    for (const row of practiceRows) {
      const practice = {
        contentId: row.contentId,
        slug: row.slug,
        title: row.title,
        contentType: toPracticeContentType(row.contentType),
        sortOrder: row.sortOrder,
      };
      const list = practicesByStage.get(row.stageId);
      if (list) list.push(practice);
      else practicesByStage.set(row.stageId, [practice]);
    }

    return stageRows.map((stage) => ({
      id: stage.id,
      name: stage.name,
      gloss: stage.gloss,
      sortOrder: stage.sortOrder,
      practices: (practicesByStage.get(stage.id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder
      ),
    }));
  }

  /**
   * The course's testimonials for the `proof` section, ordered by the curator's
   * `sortOrder`. Scoped to non-deleted rows.
   */
  private async loadTestimonials(
    courseId: string
  ): Promise<JourneyTestimonialView[]> {
    const rows = await this.db
      .select({
        id: courseTestimonials.id,
        quote: courseTestimonials.quote,
        authorName: courseTestimonials.authorName,
        authorContext: courseTestimonials.authorContext,
        sortOrder: courseTestimonials.sortOrder,
      })
      .from(courseTestimonials)
      .where(
        and(
          eq(courseTestimonials.courseId, courseId),
          isNull(courseTestimonials.deletedAt)
        )
      )
      .orderBy(asc(courseTestimonials.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      quote: row.quote,
      authorName: row.authorName,
      authorContext: row.authorContext ?? null,
      sortOrder: row.sortOrder,
    }));
  }

  /**
   * The user's completions across every practice in the course (the
   * `practice_completions ⋈ stage_practices` rollup, scoped to the user).
   */
  private async loadCompletions(
    userId: string,
    stages: readonly JourneyStage[]
  ): Promise<PracticeCompletionRecord[]> {
    const contentIds = stages.flatMap((s) =>
      s.practices.map((p) => p.contentId)
    );
    if (contentIds.length === 0) return [];

    const rows = await this.db
      .select({
        contentId: practiceCompletions.contentId,
        completedAt: practiceCompletions.completedAt,
        source: practiceCompletions.source,
      })
      .from(practiceCompletions)
      .where(
        and(
          eq(practiceCompletions.userId, userId),
          inArray(practiceCompletions.contentId, contentIds)
        )
      );

    return rows.map((row) => ({
      contentId: row.contentId,
      completedAt: row.completedAt.toISOString(),
      source: row.source as CompletionSource,
    }));
  }

  /** Resume position (seconds) for the user's playback of one content item. */
  private async loadResumeSeconds(
    userId: string,
    contentId: string
  ): Promise<number> {
    const row = await this.db.query.videoPlayback.findFirst({
      where: and(
        eq(videoPlayback.userId, userId),
        eq(videoPlayback.contentId, contentId)
      ),
      columns: { positionSeconds: true },
    });
    return row?.positionSeconds ?? 0;
  }

  /**
   * Stored body for a `written` practice. Returned verbatim — HTML sanitisation
   * for the rendered body is deferred to Phase 2 (the FE renderer / a
   * server-side sanitizer); there is no content-body renderer to reuse today.
   */
  private async loadContentBody(contentId: string): Promise<string | null> {
    const row = await this.db.query.content.findFirst({
      where: eq(content.id, contentId),
      columns: { contentBody: true },
    });
    return row?.contentBody ?? null;
  }
}

/**
 * Flatten the curriculum into the ordered player sequence: stages by
 * `sortOrder`, practices by `sortOrder` within a stage. Mirrors the FE
 * `$lib/journeys/rollup` `toPlaylist` (kept server-side because BE packages
 * cannot import an apps/web `$lib` helper).
 */
function flattenPlaylist(stages: readonly JourneyStage[]): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  const orderedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const stage of orderedStages) {
    const orderedPractices = [...stage.practices].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    for (const practice of orderedPractices) {
      entries.push({
        contentId: practice.contentId,
        slug: practice.slug,
        title: practice.title,
        contentType: practice.contentType,
        stageId: stage.id,
        stageName: stage.name,
        sortOrder: practice.sortOrder,
      });
    }
  }
  return entries;
}
