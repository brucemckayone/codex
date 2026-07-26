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
import {
  BaseService,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@codex/service-errors';
import type {
  BrandTokenOverrides,
  CompletionSource,
  CourseDashboardData,
  CourseSellPreview,
  CourseSellPreviewClip,
  EnrolledJourneyCard,
  InCoursePracticeData,
  JourneyCardView,
  JourneyCoursePage,
  JourneyCourseSummary,
  JourneyEnrollment,
  JourneyListItem,
  JourneyPageRecord,
  JourneyPractice,
  JourneyProgressStatus,
  JourneyStage,
  JourneyStageView,
  JourneyTestimonialView,
  PageSection,
  PageStatus,
  PlaylistEntry,
  PracticeCompletionRecord,
  PracticeContentType,
} from '@codex/shared-types';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

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
   * The transaction-capable WS client. The registry injects `getSharedDb()` (the
   * WS driver) as `this.db`, but `BaseService.db`'s static type doesn't expose the
   * full interactive-transaction signature — this narrow getter recovers it for
   * the create/save write paths (mirrors `CourseAccessService.txDb`), avoiding an
   * `as any` blast at each call site.
   */
  private get txDb(): typeof import('@codex/database').dbWs {
    return this.db as typeof import('@codex/database').dbWs;
  }

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

  // ══════════════════════════════════════════════════════════════════════════
  // MEMBER DISCOVERY (Codex-oi2w4 · home / explore / library surfacing)
  //
  // The public browse reads that make journeys REACHABLE from the member space.
  // `listPublishedJourneys` is a fully PUBLIC read (no per-user state, no
  // `canView`) for the home "featured" rail + the Explore grid.
  // `listEnrolledJourneys` is a PER-USER read (the library "Your journeys" shelf
  // + continue rail) — the route supplies the SESSION `userId`; the org scopes
  // the results to the space being browsed. Both count only the MEMBER-visible
  // (published) curriculum so the surfaced counts match the public sell page.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List the org's PUBLISHED course-journeys as public discovery cards (SPEC
   * §8.5). Scoped to non-deleted, PUBLISHED `course`-type landing pages whose
   * subject is a PUBLISHED, non-deleted course in the SAME org (a journey with a
   * missing/unpublished subject never surfaces). `opts.featured` narrows to the
   * creator-featured rail (home); ordering is featured-first, then `sortOrder`,
   * then newest-published, so both surfaces get a stable, curated sequence.
   * Fully PUBLIC — carries no per-user state.
   */
  async listPublishedJourneys(
    organizationId: string,
    opts: { featured?: boolean; limit?: number } = {}
  ): Promise<JourneyCardView[]> {
    try {
      const rows = await this.db
        .select({
          pageId: landingPages.id,
          slug: landingPages.slug,
          title: landingPages.title,
          featured: landingPages.featured,
          courseId: courses.id,
          courseSlug: courses.slug,
          kicker: courses.kicker,
          lede: courses.lede,
          priceCents: courses.priceCents,
        })
        .from(landingPages)
        // Inner join guards the polymorphic subject (HARDENING §C): only a
        // journey bound to a live course in this org can surface.
        .innerJoin(
          courses,
          and(
            eq(courses.id, landingPages.subjectId),
            eq(courses.organizationId, organizationId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .where(
          and(
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.subjectType, 'course'),
            eq(landingPages.status, CONTENT_STATUS.PUBLISHED),
            isNull(landingPages.deletedAt),
            opts.featured ? eq(landingPages.featured, true) : undefined
          )
        )
        .orderBy(
          desc(landingPages.featured),
          asc(landingPages.sortOrder),
          desc(landingPages.publishedAt)
        )
        .limit(opts.limit ?? 24);

      // Dedupe by courseId — one card per subject course. The create path binds
      // one landing page per course (1:1), but nothing enforces it; guard against
      // >1 published page for the same course surfacing as duplicate cards
      // (mirrors listEnrolledJourneys' dedupe). Ordering above keeps the leading
      // (featured / earliest-sorted) page as the survivor.
      const seen = new Set<string>();
      const unique = rows.filter((r) => {
        if (seen.has(r.courseId)) return false;
        seen.add(r.courseId);
        return true;
      });

      const counts = await this.loadPublishedCurriculumCounts(
        unique.map((r) => r.courseId)
      );

      return unique.map((r) => {
        const count = counts.get(r.courseId);
        return {
          pageId: r.pageId,
          slug: r.slug,
          title: r.title,
          kicker: r.kicker,
          tagline: r.lede,
          courseId: r.courseId,
          courseSlug: r.courseSlug,
          priceCents: r.priceCents,
          stageCount: count?.stageCount ?? 0,
          practiceCount: count?.practiceCount ?? 0,
          featured: r.featured,
        };
      });
    } catch (error) {
      this.handleError(error, 'listPublishedJourneys');
    }
  }

  /**
   * List the journeys the given user is ENROLLED in, within `organizationId`,
   * as enrolled cards with a progress rollup (SPEC §8.4 / §11). Scoped to the
   * user's `course_enrollments` whose course is a PUBLISHED, non-deleted course
   * in the org with a PUBLISHED landing page. Progress = completed vs total
   * PUBLISHED practices; `status` derives from the enrollment's `completedAt`
   * (authoritative) then the completion count. Newest activity first.
   *
   * `userId` is the SESSION user (the route never trusts a client id); the org
   * scopes the shelf to the space being browsed. Returns `[]` for a user with no
   * enrollments in the org.
   */
  async listEnrolledJourneys(
    userId: string,
    organizationId: string
  ): Promise<EnrolledJourneyCard[]> {
    try {
      const rows = await this.db
        .select({
          pageId: landingPages.id,
          slug: landingPages.slug,
          title: landingPages.title,
          featured: landingPages.featured,
          courseId: courses.id,
          courseSlug: courses.slug,
          kicker: courses.kicker,
          lede: courses.lede,
          priceCents: courses.priceCents,
          enrolledAt: courseEnrollments.enrolledAt,
          lastActivityAt: courseEnrollments.lastActivityAt,
          completedAt: courseEnrollments.completedAt,
        })
        .from(courseEnrollments)
        .innerJoin(
          courses,
          and(
            eq(courses.id, courseEnrollments.courseId),
            eq(courses.organizationId, organizationId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .innerJoin(
          landingPages,
          and(
            eq(landingPages.subjectId, courses.id),
            eq(landingPages.subjectType, 'course'),
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.status, CONTENT_STATUS.PUBLISHED),
            isNull(landingPages.deletedAt)
          )
        )
        .where(eq(courseEnrollments.userId, userId))
        .orderBy(desc(courseEnrollments.lastActivityAt));

      // Dedupe by courseId — a course is expected to have ONE journey page, but
      // guard against >1 published page pointing at the same course (keep the
      // first, i.e. the most-recently-active by the ORDER BY above).
      const seen = new Set<string>();
      const unique = rows.filter((r) => {
        if (seen.has(r.courseId)) return false;
        seen.add(r.courseId);
        return true;
      });
      if (unique.length === 0) return [];

      const courseIds = unique.map((r) => r.courseId);
      const [counts, completedByCourse] = await Promise.all([
        this.loadPublishedCurriculumCounts(courseIds),
        this.loadCompletedPracticeCounts(userId, courseIds),
      ]);

      return unique.map((r) => {
        const total = counts.get(r.courseId)?.practiceCount ?? 0;
        const stageCount = counts.get(r.courseId)?.stageCount ?? 0;
        // Clamp: a completion of a since-unpublished practice must never push the
        // numerator past the (published) denominator.
        const completed = Math.min(
          completedByCourse.get(r.courseId) ?? 0,
          total
        );
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const status: JourneyProgressStatus = r.completedAt
          ? 'completed'
          : completed > 0
            ? 'in-progress'
            : 'not-started';
        return {
          pageId: r.pageId,
          slug: r.slug,
          title: r.title,
          kicker: r.kicker,
          tagline: r.lede,
          courseId: r.courseId,
          courseSlug: r.courseSlug,
          priceCents: r.priceCents,
          stageCount,
          practiceCount: total,
          featured: r.featured,
          completedPractices: completed,
          totalPractices: total,
          percent,
          status,
          enrolledAt: r.enrolledAt.toISOString(),
          lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        };
      });
    } catch (error) {
      this.handleError(error, 'listEnrolledJourneys');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CREATOR / STUDIO management (Codex-isr02 · the page-builder write path)
  //
  // The AUTHORING side of a journey — list / load-for-builder / create / save.
  // Distinct from the member reads above: these are org-MANAGEMENT operations.
  // The content-api routes gate them with `requireOrgManagement` and forward the
  // SESSION-derived org; every method here ALSO scopes to `organizationId` as
  // defence-in-depth, so a manager of org A can never read or write org B's pages.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List the org's journeys for the studio index (frozen `ListJourneysQuery`).
   * A MANAGEMENT view — every non-deleted page the ORG owns (not per-creator),
   * newest-edited first, optional `status` filter. Course-type pages carry live
   * curriculum rollups (stage/practice/enrolled counts) + the course `lede` as
   * tagline; plain landing pages get nulls. `revenueCents` is null here —
   * accurate, disjoint course revenue is the per-journey Insights read
   * (`CourseInsightsService`), never duplicated across the index (a heavy per-row
   * money join that would risk drifting from the authoritative figure).
   */
  async listJourneysForOrg(
    organizationId: string,
    status?: PageStatus
  ): Promise<JourneyListItem[]> {
    try {
      const pageRows = await this.db
        .select({
          id: landingPages.id,
          pageType: landingPages.pageType,
          subjectType: landingPages.subjectType,
          subjectId: landingPages.subjectId,
          slug: landingPages.slug,
          title: landingPages.title,
          status: landingPages.status,
          updatedAt: landingPages.updatedAt,
        })
        .from(landingPages)
        .where(
          and(
            eq(landingPages.organizationId, organizationId),
            isNull(landingPages.deletedAt),
            status ? eq(landingPages.status, status) : undefined
          )
        )
        .orderBy(desc(landingPages.updatedAt));

      const courseIds = pageRows
        .filter((p) => p.subjectType === 'course' && p.subjectId !== null)
        .map((p) => p.subjectId as string);

      const rollups = await this.loadCourseRollups(organizationId, courseIds);

      return pageRows.map((p) => {
        const roll =
          p.subjectType === 'course' && p.subjectId
            ? rollups.get(p.subjectId)
            : undefined;
        return {
          id: p.id,
          pageType: p.pageType,
          subjectType: p.subjectType,
          slug: p.slug,
          title: p.title,
          status: p.status as PageStatus,
          tagline: roll?.tagline ?? null,
          stageCount: roll?.stageCount ?? null,
          practiceCount: roll?.practiceCount ?? null,
          enrolledCount: roll?.enrolledCount ?? null,
          revenueCents: null,
          updatedAt: p.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      this.handleError(error, 'listJourneysForOrg');
    }
  }

  /**
   * Load a page draft into the studio builder (frozen `GetJourneyForBuilderQuery`).
   * Scoped to `(id, org)` among non-deleted pages — a foreign or missing id
   * resolves to `null` (IDOR-safe: never leaks another org's page). ANY status
   * (drafts included) — the builder edits unpublished pages.
   */
  async getJourneyForBuilder(
    organizationId: string,
    pageId: string
  ): Promise<JourneyPageRecord | null> {
    try {
      const [row] = await this.db
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
            eq(landingPages.id, pageId),
            eq(landingPages.organizationId, organizationId),
            isNull(landingPages.deletedAt)
          )
        )
        .limit(1);

      if (!row) return null;
      return {
        id: row.id,
        organizationId: row.organizationId,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        pageType: row.pageType,
        slug: row.slug,
        title: row.title,
        status: row.status as PageStatus,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        brandOverrides: (row.brandOverrides as BrandTokenOverrides) ?? null,
        sections: (row.sections as PageSection[]) ?? [],
      };
    } catch (error) {
      this.handleError(error, 'getJourneyForBuilder');
    }
  }

  /**
   * Create a new journey/page (as a draft) and return its page id + slug. For a
   * `course` page this is a TWO-ROW create — a `courses` row (the curriculum
   * subject) + a `landing_pages` row bound to it via `subjectType`/`subjectId` —
   * in ONE transaction, so a half-created journey can never exist. A `landing`
   * page creates only the page row. The slug is derived from the title and made
   * unique within the org (both tables share the org slug-space); resolution runs
   * inside the transaction, and the org-unique partial index is the final arbiter
   * if two creates race.
   */
  async createJourney(
    organizationId: string,
    creatorId: string,
    input: { title: string; pageType: string }
  ): Promise<{ id: string; slug: string }> {
    try {
      const title = input.title.trim();
      if (!title) {
        throw new ValidationError('A journey needs a title');
      }
      const pageType = input.pageType === 'landing' ? 'landing' : 'course';
      const base = slugifyTitle(title);

      return await this.txDb.transaction(async (tx) => {
        // Resolve a free org-unique slug, checking BOTH tables that share the
        // org slug-space (landing_pages + courses) among non-deleted rows. The
        // partial-unique index is the final arbiter if two creates race (this
        // SELECT is not a lock); on exhaustion we throw rather than fall through
        // to a colliding insert (review L3).
        let slug: string | null = null;
        for (let n = 1; n < 1000; n++) {
          const candidate = n === 1 ? base : `${base}-${n}`;
          const [pageClash] = await tx
            .select({ id: landingPages.id })
            .from(landingPages)
            .where(
              and(
                eq(landingPages.organizationId, organizationId),
                eq(landingPages.slug, candidate),
                isNull(landingPages.deletedAt)
              )
            )
            .limit(1);
          const [courseClash] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(
              and(
                eq(courses.organizationId, organizationId),
                eq(courses.slug, candidate),
                isNull(courses.deletedAt)
              )
            )
            .limit(1);
          if (!pageClash && !courseClash) {
            slug = candidate;
            break;
          }
        }
        if (!slug) {
          throw new ConflictError(
            'Could not find an available slug for this title — try a different title'
          );
        }

        let subjectId: string | null = null;
        if (pageType === 'course') {
          const [course] = await tx
            .insert(courses)
            .values({
              organizationId,
              creatorId,
              slug,
              title,
              status: 'draft',
            })
            .returning({ id: courses.id });
          if (!course) {
            throw new Error('createJourney: course insert returned no row');
          }
          subjectId = course.id;
        }

        const [page] = await tx
          .insert(landingPages)
          .values({
            organizationId,
            creatorId,
            pageType,
            slug,
            title,
            status: 'draft',
            subjectType: pageType === 'course' ? 'course' : null,
            subjectId,
            sections: [],
          })
          .returning({ id: landingPages.id, slug: landingPages.slug });
        if (!page) {
          throw new Error('createJourney: landing page insert returned no row');
        }

        return { id: page.id, slug: page.slug };
      });
    } catch (error) {
      this.handleError(error, 'createJourney');
    }
  }

  /**
   * Persist the builder's draft (the frozen save command). Scoped to `(id, org)`
   * among non-deleted pages — a foreign/missing id throws `NotFoundError` (never a
   * silent cross-org write). A changed slug is collision-checked against the org's
   * other non-deleted pages first, so it surfaces as a `ConflictError` (409)
   * rather than a raw unique-violation. Publishing a COURSE page ALSO publishes
   * its subject course, so the public sales page — `getCoursePage` requires BOTH
   * page and course published — goes live in one action.
   */
  async saveJourneyPage(
    organizationId: string,
    // The editable fields the save touches. A structural subset of the frozen
    // `JourneyPageRecord` (minus the server-owned id-scoping fields) — declared
    // inline rather than via `Omit` because SvelteKit's `command()` infers the
    // `.nullable()` fields as optional, and a narrow accepts-what-it-uses shape
    // stays assignable from that without a boundary cast. `subjectType`/
    // `subjectId` are read from the persisted row, never the client payload.
    record: {
      id: string;
      title: string;
      slug: string;
      status: PageStatus;
      sections: PageSection[];
      brandOverrides?: BrandTokenOverrides | null;
    }
  ): Promise<void> {
    try {
      const status: PageStatus = record.status;
      const nextSlug = record.slug.trim();
      if (!nextSlug) {
        throw new ValidationError('A journey needs a slug');
      }

      await this.txDb.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: landingPages.id,
            slug: landingPages.slug,
            publishedAt: landingPages.publishedAt,
            subjectType: landingPages.subjectType,
            subjectId: landingPages.subjectId,
          })
          .from(landingPages)
          .where(
            and(
              eq(landingPages.id, record.id),
              eq(landingPages.organizationId, organizationId),
              isNull(landingPages.deletedAt)
            )
          )
          .limit(1);

        if (!existing) {
          throw new NotFoundError('Journey page not found');
        }

        // A slug change must respect the org-unique slug-space → 409, not a raw
        // constraint error.
        if (nextSlug !== existing.slug) {
          const [clash] = await tx
            .select({ id: landingPages.id })
            .from(landingPages)
            .where(
              and(
                eq(landingPages.organizationId, organizationId),
                eq(landingPages.slug, nextSlug),
                isNull(landingPages.deletedAt)
              )
            )
            .limit(1);
          if (clash && clash.id !== record.id) {
            throw new ConflictError(`The slug "${nextSlug}" is already in use`);
          }
        }

        const publishing = status === 'published';
        const nowPublishedAt =
          publishing && !existing.publishedAt ? new Date() : undefined;

        await tx
          .update(landingPages)
          .set({
            title: record.title,
            slug: nextSlug,
            status,
            sections: record.sections,
            brandOverrides: record.brandOverrides,
            ...(nowPublishedAt ? { publishedAt: nowPublishedAt } : {}),
          })
          .where(
            and(
              eq(landingPages.id, record.id),
              eq(landingPages.organizationId, organizationId)
            )
          );

        // Publishing a course page publishes its subject course too (getCoursePage
        // requires BOTH published), so one "Publish" makes the sales page live.
        if (
          publishing &&
          existing.subjectType === 'course' &&
          existing.subjectId
        ) {
          await tx
            .update(courses)
            .set({
              status: 'published',
              ...(nowPublishedAt ? { publishedAt: nowPublishedAt } : {}),
            })
            .where(
              and(
                eq(courses.id, existing.subjectId),
                eq(courses.organizationId, organizationId),
                isNull(courses.deletedAt)
              )
            );
        }
      });
    } catch (error) {
      this.handleError(error, 'saveJourneyPage');
    }
  }

  // ── Private read helpers ──────────────────────────────────────────────────

  /**
   * Curriculum + enrolment rollups for a set of course ids (BATCHED — no N+1),
   * scoped to the org. Returns a map keyed by courseId; `tagline` is the course
   * `lede`. Counts cover non-deleted stages, their practice associations, and
   * enrolments. A course with no matching row simply doesn't appear in the map.
   */
  private async loadCourseRollups(
    organizationId: string,
    courseIds: string[]
  ): Promise<
    Map<
      string,
      {
        tagline: string | null;
        stageCount: number;
        practiceCount: number;
        enrolledCount: number;
      }
    >
  > {
    const map = new Map<
      string,
      {
        tagline: string | null;
        stageCount: number;
        practiceCount: number;
        enrolledCount: number;
      }
    >();
    if (courseIds.length === 0) return map;

    // Course lede (tagline) — org-scoped, non-deleted. Seeds the map.
    const courseRows = await this.db
      .select({ id: courses.id, lede: courses.lede })
      .from(courses)
      .where(
        and(
          inArray(courses.id, courseIds),
          eq(courses.organizationId, organizationId),
          isNull(courses.deletedAt)
        )
      );
    for (const c of courseRows) {
      map.set(c.id, {
        tagline: c.lede ?? null,
        stageCount: 0,
        practiceCount: 0,
        enrolledCount: 0,
      });
    }

    // Stage counts + practice-association counts (practices left-joined to their
    // non-deleted stage), grouped by course.
    const stageRows = await this.db
      .select({
        courseId: courseStages.courseId,
        stageCount: sql<number>`count(distinct ${courseStages.id})`,
        practiceCount: sql<number>`count(${stagePractices.stageId})`,
      })
      .from(courseStages)
      .leftJoin(stagePractices, eq(stagePractices.stageId, courseStages.id))
      .where(
        and(
          inArray(courseStages.courseId, courseIds),
          isNull(courseStages.deletedAt)
        )
      )
      .groupBy(courseStages.courseId);
    for (const s of stageRows) {
      const entry = map.get(s.courseId);
      if (entry) {
        entry.stageCount = Number(s.stageCount);
        entry.practiceCount = Number(s.practiceCount);
      }
    }

    // Enrolment counts.
    const enrolRows = await this.db
      .select({
        courseId: courseEnrollments.courseId,
        enrolledCount: sql<number>`count(*)`,
      })
      .from(courseEnrollments)
      .where(inArray(courseEnrollments.courseId, courseIds))
      .groupBy(courseEnrollments.courseId);
    for (const e of enrolRows) {
      const entry = map.get(e.courseId);
      if (entry) entry.enrolledCount = Number(e.enrolledCount);
    }

    return map;
  }

  /**
   * Batched MEMBER-visible curriculum counts for a set of courses (no N+1):
   * non-deleted stages and their PUBLISHED, non-deleted practices. This is the
   * count a member actually sees (matches the public sales page + the progress
   * denominator) — distinct from {@link loadCourseRollups}, whose `practiceCount`
   * counts ALL stage→practice associations for the studio view regardless of the
   * content's publish state. Courses with no matching stage simply don't appear.
   */
  private async loadPublishedCurriculumCounts(
    courseIds: string[]
  ): Promise<Map<string, { stageCount: number; practiceCount: number }>> {
    const map = new Map<
      string,
      { stageCount: number; practiceCount: number }
    >();
    if (courseIds.length === 0) return map;

    const rows = await this.db
      .select({
        courseId: courseStages.courseId,
        stageCount: sql<number>`count(distinct ${courseStages.id})`,
        // count(content.id) counts only the rows where the published-content
        // join matched — i.e. member-visible practices.
        practiceCount: sql<number>`count(${content.id})`,
      })
      .from(courseStages)
      .leftJoin(stagePractices, eq(stagePractices.stageId, courseStages.id))
      .leftJoin(
        content,
        and(
          eq(content.id, stagePractices.contentId),
          eq(content.status, CONTENT_STATUS.PUBLISHED),
          isNull(content.deletedAt)
        )
      )
      .where(
        and(
          inArray(courseStages.courseId, courseIds),
          isNull(courseStages.deletedAt)
        )
      )
      .groupBy(courseStages.courseId);

    for (const r of rows) {
      map.set(r.courseId, {
        stageCount: Number(r.stageCount),
        practiceCount: Number(r.practiceCount),
      });
    }
    return map;
  }

  /**
   * Batched count of a user's completed practices per course (no N+1). A
   * completion counts only when its content is a PUBLISHED, non-deleted practice
   * of a non-deleted stage in one of `courseIds` — so the numerator can never
   * exceed {@link loadPublishedCurriculumCounts}'s denominator. Keyed by courseId;
   * a course with no completions simply doesn't appear.
   */
  private async loadCompletedPracticeCounts(
    userId: string,
    courseIds: string[]
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (courseIds.length === 0) return map;

    const rows = await this.db
      .select({
        courseId: courseStages.courseId,
        completed: sql<number>`count(distinct ${practiceCompletions.contentId})`,
      })
      .from(practiceCompletions)
      .innerJoin(
        stagePractices,
        eq(stagePractices.contentId, practiceCompletions.contentId)
      )
      .innerJoin(
        courseStages,
        and(
          eq(courseStages.id, stagePractices.stageId),
          isNull(courseStages.deletedAt)
        )
      )
      .innerJoin(
        content,
        and(
          eq(content.id, practiceCompletions.contentId),
          eq(content.status, CONTENT_STATUS.PUBLISHED),
          isNull(content.deletedAt)
        )
      )
      .where(
        and(
          eq(practiceCompletions.userId, userId),
          inArray(courseStages.courseId, courseIds)
        )
      )
      .groupBy(courseStages.courseId);

    for (const r of rows) {
      map.set(r.courseId, Number(r.completed));
    }
    return map;
  }

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
 * Slugify a title → a URL-safe, org-unique-able base (lowercase, alnum, single
 * dashes, no leading/trailing dash). Mirrors the FE `createJourneyMock` slug rule
 * so builder behaviour is unchanged; the empty case falls back to `'untitled'`.
 */
function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
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
