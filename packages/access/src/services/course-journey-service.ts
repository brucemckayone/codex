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
  mediaItems,
  organizations,
  practiceCompletions,
  stagePractices,
  videoPlayback,
} from '@codex/database/schema';
import { BaseService } from '@codex/service-errors';
import type {
  CompletionSource,
  CourseDashboardData,
  InCoursePracticeData,
  JourneyCourseSummary,
  JourneyEnrollment,
  JourneyPractice,
  JourneyStage,
  PlaylistEntry,
  PracticeCompletionRecord,
  PracticeContentType,
} from '@codex/shared-types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Narrow a stored `content.contentType` varchar to the practice union. The DB
 * CHECK (`content_type IN ('video','audio','written')`) guarantees one of these;
 * fall back to `'video'` for any legacy/unexpected value (mirrors the library
 * aggregation's defensive default rather than throwing on a read path).
 */
function toPracticeContentType(value: string | null): PracticeContentType {
  return value === 'audio' || value === 'written' ? value : 'video';
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
