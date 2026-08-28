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
import type { CourseGuide } from '@codex/database/schema';
import {
  content,
  courseEnrollments,
  courseStages,
  courses,
  courseTestimonials,
  landingPages,
  mediaItems,
  organizationMemberships,
  organizations,
  practiceCompletions,
  stagePractices,
  videoPlayback,
} from '@codex/database/schema';
import {
  BaseService,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@codex/service-errors';
import type {
  BrandTokenOverrides,
  CompletionSource,
  ContentCourseLinks,
  CourseCardSummary,
  CourseDashboardData,
  CourseSellPreview,
  CourseSellPreviewClip,
  EditorCurriculum,
  EditorPracticeView,
  EditorStageView,
  EnrolledCourseProgress,
  EnrolledCourseSummary,
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
  JourneySellMedia,
  JourneyStage,
  JourneyStageView,
  JourneyTestimonialView,
  PageOffer,
  PageSection,
  PageStatus,
  PlaylistEntry,
  PracticeCompletionRecord,
  PracticeContentType,
  SectionDesign,
} from '@codex/shared-types';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

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
 * Narrow a stored `content.status` varchar to the shared {@link PageStatus}
 * union. The DB CHECK guarantees one of these; fall back to `'draft'` for any
 * legacy/unexpected value (defensive, mirrors {@link toPracticeContentType}).
 */
function toPageStatus(value: string | null): PageStatus {
  return value === 'published' || value === 'archived' ? value : 'draft';
}

/**
 * Resolve a stored `courses.coverImageKey` to its public CDN URL (Codex-eqh0z).
 *
 * Same raw-key → CDN-URL convention as `resolveCategoryCoverUrl` in
 * `content-api/routes/category-cover-url.ts`: `ImageProcessingService.
 * processCourseCover` writes `{sm,md,lg}.webp` under the base key, and cards
 * serve the `md` variant. The base is env-owned, so the ROUTE supplies it and
 * the service resolves — the same split `getCourseSellPreview` already uses.
 *
 * Returns null when there is no cover OR no configured base, so a client never
 * receives a raw R2 key and never receives a half-formed URL. A null cover is a
 * legitimate state: the card renders its typographic fallback.
 */
function resolveCourseCoverUrl(
  coverImageKey: string | null | undefined,
  r2PublicUrlBase: string | undefined
): string | null {
  return coverImageKey && r2PublicUrlBase
    ? `${r2PublicUrlBase}/${coverImageKey}/md.webp`
    : null;
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
   * Resolve the PUBLISHED course(s) that include a content item as a practice —
   * the standalone content page's journey cross-link (Codex-2pryk.3.10, F19/F20).
   *
   * Walks `stage_practices → course_stages → courses` for `contentId`, scoped to
   * PUBLISHED, non-deleted courses whose stage is non-deleted. Fully PUBLIC: NO
   * `canView` / entitlement gate — it reveals only published-course public chrome
   * (title/slug/org), never body or stream, so it is safe to serve anonymously
   * (mirrors {@link getCourseBySlug} / the public sales-page reads). A practice
   * can appear in several stages of the same course, so rows are deduped by
   * course id. Returns `{ courses: [] }` when the item belongs to no published
   * course (→ the FE omits the cross-link).
   */
  async getContentCourses(contentId: string): Promise<ContentCourseLinks> {
    try {
      const rows = await this.db
        .select({
          id: courses.id,
          slug: courses.slug,
          title: courses.title,
          organizationSlug: organizations.slug,
        })
        .from(stagePractices)
        .innerJoin(courseStages, eq(courseStages.id, stagePractices.stageId))
        .innerJoin(courses, eq(courses.id, courseStages.courseId))
        .leftJoin(organizations, eq(organizations.id, courses.organizationId))
        .where(
          and(
            eq(stagePractices.contentId, contentId),
            isNull(courseStages.deletedAt),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .orderBy(asc(courses.title));

      // Dedup by course id (a practice may sit in >1 stage of one course),
      // preserving the first title-ordered occurrence for deterministic output.
      const byId = new Map<string, JourneyCourseSummary>();
      for (const row of rows) {
        if (byId.has(row.id)) continue;
        byId.set(row.id, {
          id: row.id,
          slug: row.slug,
          title: row.title,
          organizationSlug: row.organizationSlug ?? null,
        });
      }
      return { courses: [...byId.values()] };
    } catch (error) {
      this.handleError(error, 'getContentCourses');
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
          design: landingPages.design,
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
          // The page's LOOK, fed to `SectionRenderer`'s `pageDesign` prop, where
          // `resolveDesign` resolves it per axis under each section's own
          // override. Spread-when-present rather than `?? undefined`: `design` is
          // optional on the record, and a row written before the F-B2 migration
          // (or by an older deployment) must resolve to the axis DEFAULTS, not to
          // an explicit empty bundle.
          ...(pageRow.design
            ? { design: pageRow.design as SectionDesign }
            : {}),
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
   * Resolve a course sales page for the STUDIO LIVE-PREVIEW iframe (Codex-isr02
   * P0b-2). Structurally identical to {@link getCoursePage} but ANY status
   * (draft / published / archived), so a creator can preview an UNPUBLISHED
   * draft in the builder before it goes live. This is NEVER a public read: the
   * content-api route gates it with `requireOrgManagement` (owner/admin of THIS
   * org), and this method still scopes every query to `organizationId` as
   * defence-in-depth. {@link getCoursePage} remains the only unauthenticated
   * by-slug read and stays published-only.
   *
   * The initial payload can be minimal for a brand-new draft (empty
   * sections/stages) — the builder streams live sections + brand overrides over
   * the page-preview bridge, which the public sell page overlays on top.
   */
  async getCoursePagePreview(
    organizationId: string,
    slug: string
  ): Promise<JourneyCoursePage | null> {
    try {
      // The landing page by org-scoped slug — ANY status (draft included).
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
          design: landingPages.design,
        })
        .from(landingPages)
        .where(
          and(
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.slug, slug),
            isNull(landingPages.deletedAt)
          )
        )
        .limit(1);

      if (!pageRow) return null;
      if (pageRow.subjectType !== 'course' || !pageRow.subjectId) return null;

      // The subject course — ANY status, org-scoped (guards a cross-org subjectId).
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
            isNull(courses.deletedAt)
          )
        )
        .limit(1);

      if (!courseRow) return null;

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
          // The page's LOOK, fed to `SectionRenderer`'s `pageDesign` prop, where
          // `resolveDesign` resolves it per axis under each section's own
          // override. Spread-when-present rather than `?? undefined`: `design` is
          // optional on the record, and a row written before the F-B2 migration
          // (or by an older deployment) must resolve to the axis DEFAULTS, not to
          // an explicit empty bundle.
          ...(pageRow.design
            ? { design: pageRow.design as SectionDesign }
            : {}),
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
      this.handleError(error, 'getCoursePagePreview');
    }
  }

  /**
   * Resolve the PUBLIC 30s sell-preview media for a course: the intro-film and
   * practice-reel clips (SPEC §10), the guide's portrait still and talking-head
   * clip (journey-sections contract A15), and the hero still plus the guide's
   * signature (contract A27, Codex-wqxv4) — the streamed,
   * off-critical-path payload of the sales page. PUBLIC: NO auth, NO `canView` (HARDENING §E). The clips reuse the
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
          guideVideoMediaId: courses.guideVideoMediaId,
          // A27: the hero still + the guide's signature. Real columns (unlike the
          // portrait below), so they select and write like the three videos.
          heroMediaId: courses.heroMediaId,
          signatureMediaId: courses.signatureMediaId,
          // The portrait ref lives INSIDE the `guide` jsonb bag, not in a column
          // of its own — `updateJourneySellMedia` read-then-merges it there.
          guide: courses.guide,
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

      const guidePortraitMediaId = courseRow.guide?.portraitMediaId ?? null;

      const mediaIds = [
        courseRow.introVideoMediaId,
        courseRow.previewVideoMediaId,
        courseRow.guideVideoMediaId,
        guidePortraitMediaId,
        courseRow.heroMediaId,
        courseRow.signatureMediaId,
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

      // Resolve one media id → a public STILL. The portrait is a `media_items`
      // ref, and `media_items` is CHECK-constrained to video/audio, so the still
      // the creator picked is the item's `thumbnailKey` — NOT `hlsPreviewKey`,
      // which is why the portrait cannot go through `toClip`.
      const toStill = (mediaId: string | null): string | null => {
        if (!mediaId) return null;
        const media = previewByMediaId.get(mediaId);
        if (!media?.thumbnailKey || !r2PublicUrlBase) return null;
        return `${r2PublicUrlBase}/${media.thumbnailKey}`;
      };

      return {
        intro: toClip(courseRow.introVideoMediaId),
        reel: toClip(courseRow.previewVideoMediaId),
        // Contract amendment A15: both guide slots were WRITE-ONLY codebase-wide
        // — the builder's pickers persisted them and no public read projected
        // them, so the guide section could never show a portrait or a clip.
        guidePortraitUrl: toStill(guidePortraitMediaId),
        guideClip: toClip(courseRow.guideVideoMediaId),
        // Contract amendment A27 (Codex-wqxv4): the hero image and the guide's
        // signature. Both go through `toStill` for the reason its own comment
        // gives — `media_items` is video/audio-only, so the still a creator picks
        // is the item's `thumbnailKey`. `hero.full-bleed` / `hero.poster` /
        // `guide.letter` are named after media that, until now, no column held.
        heroImageUrl: toStill(courseRow.heroMediaId),
        // The SAME item, resolved both ways: `toStill` for the modes that only
        // draw it, `toClip` for the modes that play it. Before this the manifest
        // was thrown away here, so a creator's hero video could only ever appear
        // as its own poster frame (Codex-uj4jc).
        heroClip: toClip(courseRow.heroMediaId),
        signatureUrl: toStill(courseRow.signatureMediaId),
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
   *
   * `r2PublicUrlBase` (env-owned, supplied by the route) resolves each course's
   * `coverImageKey` to a CDN URL — the same treatment
   * {@link listPublishedCourses} and {@link listEnrolledJourneys} already give
   * their cards. Omit it and every card reports `null` and renders the shared
   * brand cover (Codex-tnwnu).
   */
  async listEnrolledCourses(
    userId: string,
    organizationId: string,
    r2PublicUrlBase?: string
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
          coverImageKey: courses.coverImageKey,
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

      // THREE queries for the whole shelf, not three PER COURSE. The Neon HTTP
      // driver makes one round trip per statement, so the old per-row
      // `loadStages` + `loadCompletions` pair was O(N) round trips in
      // catalogue size (Codex-kgrdp.23 defect 2).
      const stagesByCourse = await this.loadStagesForCourses(
        rows.map((row) => row.courseId)
      );
      const allCompletions = await this.loadCompletions(
        userId,
        [...stagesByCourse.values()].flat()
      );

      const summaries: EnrolledCourseSummary[] = [];
      for (const row of rows) {
        const stages = stagesByCourse.get(row.courseId) ?? [];
        // Completions MUST be narrowed to this course's practices before the
        // rollup: `rollUpEnrollment` derives `lastCompletedAt` by reducing over
        // every record it is handed, so a cross-course superset would report
        // another journey's completion date on this card.
        const courseContentIds = new Set(
          stages.flatMap((stage) => stage.practices.map((p) => p.contentId))
        );
        const completions = allCompletions.filter((c) =>
          courseContentIds.has(c.contentId)
        );
        summaries.push({
          course: {
            id: row.courseId,
            slug: row.slug,
            title: row.title,
            organizationSlug: row.organizationSlug ?? null,
            kicker: row.kicker ?? null,
            lede: row.lede ?? null,
            guideName: row.guide?.name ?? null,
            coverImageUrl: resolveCourseCoverUrl(
              row.coverImageKey,
              r2PublicUrlBase
            ),
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

  /**
   * List an org's PUBLISHED, non-deleted courses as discovery card summaries —
   * the /explore "Journeys" rail (SPEC §8.5). Fully PUBLIC: no entitlement, no
   * `canView` (HARDENING §E course-sell row) — the same public-chrome surface as
   * {@link getCoursePage}, just the list shape. Ordered most-recently-published
   * first (`publishedAt DESC`), with `createdAt DESC` as a stable tiebreaker for
   * courses published in the same instant (or with a null `publishedAt`). Backed
   * by `idx_courses_org_status (organizationId, status, publishedAt)`. Returns
   * `[]` when the org has no published courses.
   *
   * Each row also carries the SELL PAGE identity — `pageId`/`pageSlug` from the
   * published `course`-type landing page that presents it (Codex-xzwl5). The
   * public journey URL resolves `landing_pages.slug`, so a caller linking by
   * `courses.slug` builds a DIFFERENT url than the org-landing rail (which links
   * by the page) whenever the two have drifted. Callers building a sales-page
   * link MUST prefer `pageSlug`/`pageId`. The join is a LEFT join: it reconciles
   * the link, it deliberately does NOT filter the list — a course staying
   * published without a live page is prevented at the WRITE path instead (see
   * {@link cascadeCourseFromPage}) — so `null` means "no published page found"
   * and the course's own slug stays the only thing to link by.
   *
   * `r2PublicUrlBase` (env-owned, supplied by the route) resolves each course's
   * `coverImageKey` to a CDN URL; omit it and every card reports `null` and
   * renders its typographic fallback.
   */
  async listPublishedCourses(
    organizationId: string,
    r2PublicUrlBase?: string
  ): Promise<CourseCardSummary[]> {
    try {
      const rows = await this.db
        .select({
          id: courses.id,
          slug: courses.slug,
          title: courses.title,
          kicker: courses.kicker,
          lede: courses.lede,
          guide: courses.guide,
          priceCents: courses.priceCents,
          pageId: landingPages.id,
          pageSlug: landingPages.slug,
          coverImageKey: courses.coverImageKey,
        })
        .from(courses)
        .leftJoin(
          landingPages,
          and(
            eq(landingPages.subjectId, courses.id),
            eq(landingPages.subjectType, 'course'),
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.status, CONTENT_STATUS.PUBLISHED),
            isNull(landingPages.deletedAt)
          )
        )
        .where(
          and(
            eq(courses.organizationId, organizationId),
            eq(courses.status, CONTENT_STATUS.PUBLISHED),
            isNull(courses.deletedAt)
          )
        )
        .orderBy(
          desc(courses.publishedAt),
          desc(courses.createdAt),
          // Deterministic winner when >1 published page sells one course (1:1 is
          // the create path's convention, not a constraint).
          asc(landingPages.sortOrder),
          asc(landingPages.id)
        );

      // One card per course — the left join fans out for a course fronted by
      // several published pages; the ordering above fixes which one survives.
      // The dedupe is REQUIRED here even though the cover work did not need it:
      // that branch had no landing-page join, so its map could not fan out.
      // Combining the two without this emits a duplicate card per extra page.
      const seen = new Set<string>();
      return rows
        .filter((row) => {
          if (seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        })
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          kicker: row.kicker,
          lede: row.lede,
          guideName: row.guide?.name ?? null,
          priceCents: row.priceCents,
          pageId: row.pageId,
          pageSlug: row.pageSlug,
          coverImageUrl: resolveCourseCoverUrl(
            row.coverImageKey,
            r2PublicUrlBase
          ),
        }));
    } catch (error) {
      this.handleError(error, 'listPublishedCourses');
    }
  }

  /**
   * List the org's PUBLISHED course-journeys as public discovery cards (SPEC
   * §8.5). Scoped to non-deleted, PUBLISHED `course`-type landing pages whose
   * subject is a PUBLISHED, non-deleted course in the SAME org (a journey with a
   * missing/unpublished subject never surfaces). `opts.featured` narrows to the
   * creator-featured rail (home); ordering is featured-first, then `sortOrder`,
   * then newest-published, so both surfaces get a stable, curated sequence.
   * Fully PUBLIC — carries no per-user state.
   *
   * `opts.r2PublicUrlBase` (env-owned, supplied by the route) resolves each
   * subject course's `coverImageKey` to a CDN URL; omit it and every card
   * reports `null` and renders its typographic fallback.
   */
  async listPublishedJourneys(
    organizationId: string,
    opts: {
      featured?: boolean;
      limit?: number;
      r2PublicUrlBase?: string;
    } = {}
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
          coverImageKey: courses.coverImageKey,
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
          coverImageUrl: resolveCourseCoverUrl(
            r.coverImageKey,
            opts.r2PublicUrlBase
          ),
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
   *
   * `r2PublicUrlBase` (env-owned, supplied by the route) resolves each subject
   * course's `coverImageKey` to a CDN URL; omit it and every card reports `null`
   * and renders its typographic fallback.
   */
  async listEnrolledJourneys(
    userId: string,
    organizationId: string,
    r2PublicUrlBase?: string
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
          coverImageKey: courses.coverImageKey,
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
          coverImageUrl: resolveCourseCoverUrl(
            r.coverImageKey,
            r2PublicUrlBase
          ),
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
   *
   * `featured` is selected so the studio's feature-on-homepage toggle can render its
   * CURRENT state — {@link setJourneyFeatured} is the write, this is the read that
   * makes it visible. Carried for EVERY status, since the flag is orthogonal to
   * publish state (a featured draft is stored intent with no public effect).
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
          featured: landingPages.featured,
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
          featured: p.featured,
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
          offer: landingPages.offer,
          design: landingPages.design,
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
        // `offer` is optional on the draft; an unpriced page has no bag yet, so
        // the pricing panel opens with every path off rather than a stale guess.
        ...(row.offer ? { offer: row.offer as PageOffer } : {}),
        // The page's LOOK — what the builder's preset picker renders as selected.
        // Every page created since F-B2 holds an explicit bundle (Signal on
        // create, Candlelit on the migrated rows), so the absent case only covers
        // a row written by an older deployment: the picker then shows no preset
        // selected, which is honest — the page really is rendering at the axis
        // defaults.
        ...(row.design ? { design: row.design as SectionDesign } : {}),
      };
    } catch (error) {
      this.handleError(error, 'getJourneyForBuilder');
    }
  }

  /**
   * The design bundle a NEW page is born with — **Signal** (research §4.8), the
   * recommended platform default: a contemporary/product look for the creator
   * with no design opinion.
   *
   * WHY IT IS WRITTEN EXPLICITLY (amendment A21) rather than left to
   * `SECTION_DESIGN_DEFAULTS`: an implicit default is invisible. A page storing no
   * `design` renders *like something* while the builder's preset picker shows
   * NOTHING selected — so the creator sees a control that appears dead, and the
   * first preset they pick looks like it changed the page when it merely made the
   * existing look explicit. An explicit stored bundle is inspectable, diffable and
   * editable. Same argument as the Candlelit migration, applied to new pages
   * instead of old ones.
   *
   * These nine values are ALSO declared in the builder's preset table
   * (`apps/web/src/lib/components/page-builder/design-vocabulary.ts` →
   * `SECTION_DESIGN_PRESETS` → `signal`), because a package cannot import from
   * `apps/web` and the presets are builder-UI vocabulary. `design-vocabulary.test.ts`
   * pins that copy to these exact values, so a drift fails `pnpm --filter web test`
   * rather than silently making a new page's stored bundle match no preset in the
   * picker.
   */
  private static readonly NEW_PAGE_DESIGN: SectionDesign = {
    width: 'wide',
    density: 'regular',
    surface: 'panel',
    edge: 'hairline',
    align: 'start',
    type: 'balanced',
    accent: 'fill',
    motion: 'rise',
    media: 'frame',
  };

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
            // An EXPLICIT look, never the implicit axis defaults (A21) — see
            // {@link CourseJourneyService.NEW_PAGE_DESIGN}.
            design: CourseJourneyService.NEW_PAGE_DESIGN,
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
   * other non-deleted pages AND courses first (they share one org slug-space), so
   * it surfaces as a `ConflictError` (409) rather than a raw unique-violation.
   *
   * For a COURSE page the subject course is kept in LOCKSTEP with the page
   * (Codex-xzwl5) — see {@link cascadeCourseFromPage}. Publishing the page
   * publishes the course (so the public sales page, which requires BOTH, goes
   * live in one action), unpublishing it unpublishes the course, and the course's
   * `slug`/`title` follow the page's.
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
      /**
       * The page's LOOK (the preset picker's write). OPTIONAL and treated as
       * "leave alone" when absent — never as "clear it". A client that does not
       * know about the axes (or a save issued before the draft finished loading)
       * must not silently wipe a stored bundle and drop the page back to the
       * neutral axis defaults, which for a migrated page means visibly losing its
       * appearance. There is deliberately no way to clear it: A21 requires every
       * page to hold an explicit bundle.
       */
      design?: SectionDesign;
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

        const subjectCourseId =
          existing.subjectType === 'course' ? existing.subjectId : null;

        // A slug change must respect the org-unique slug-space → 409, not a raw
        // constraint error. That space spans BOTH tables (`createJourney`
        // resolves against both), and the cascade below now writes the subject
        // course's slug too, so a rename is checked against courses as well —
        // otherwise a collision with an unrelated course would escape this guard
        // and surface as a raw `uq_courses_org_slug` violation.
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

          const [courseClash] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(
              and(
                eq(courses.organizationId, organizationId),
                eq(courses.slug, nextSlug),
                isNull(courses.deletedAt)
              )
            )
            .limit(1);
          if (courseClash && courseClash.id !== subjectCourseId) {
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
            ...(record.design ? { design: record.design } : {}),
            ...(nowPublishedAt ? { publishedAt: nowPublishedAt } : {}),
          })
          .where(
            and(
              eq(landingPages.id, record.id),
              eq(landingPages.organizationId, organizationId)
            )
          );

        if (subjectCourseId) {
          await this.cascadeCourseFromPage(tx, {
            organizationId,
            pageId: record.id,
            courseId: subjectCourseId,
            status,
            slug: nextSlug,
            title: record.title,
            publishedAt: nowPublishedAt,
          });
        }
      });
    } catch (error) {
      this.handleError(error, 'saveJourneyPage');
    }
  }

  /**
   * Bring a course page's SUBJECT COURSE into lockstep with the page it is sold
   * through (Codex-xzwl5). Runs inside {@link saveJourneyPage}'s transaction, so
   * page and course move together or not at all.
   *
   * STATUS — the page's status is mirrored onto the course. Publish already
   * cascaded (`getCoursePage` requires BOTH rows published, so one "Publish" has
   * to move both); the missing reverse is what made a journey impossible to take
   * down. `courses.status` is the ONLY gate on `listPublishedCourses` (the
   * /explore rail), `getCourseBySlug` (the public by-slug read),
   * `getContentCourses`, `getCourseSellPreview` and the enrolled shelves — so an
   * unpublished page whose course stayed `published` left the journey listed and
   * reachable everywhere except its own sales page, which 404'd. Cascading the
   * course status fixes all of those at once; filtering any single listing on
   * "has a published landing page" would have fixed exactly one.
   *
   * Nothing else in the codebase ever writes `courses.status`, so this cascade
   * makes "the course is published ⟺ a page sells it" a real invariant rather
   * than a per-read filter.
   *
   * A course MAY be fronted by more than one page (nothing enforces 1:1 — see
   * {@link listPublishedJourneys}' dedupe), so unpublishing one page only takes
   * the course down when no OTHER published page still sells it.
   *
   * SLUG/TITLE — the page is the journey's public identity (`/journeys/:slug`
   * resolves `landing_pages.slug`), so the course follows it. A course keeping
   * its creation-time slug is what let the /explore link (course slug) and the
   * org-landing link (page slug) resolve to different URLs after a rename.
   *
   * A zero-row update means the subject course is soft-deleted or foreign: the
   * page would then claim a subject whose status/slug it cannot govern, which is
   * the divergence this method exists to close, so it throws (mirrors
   * {@link updateJourneyOffer}'s zero-row guard) and rolls the save back.
   */
  private async cascadeCourseFromPage(
    tx: Parameters<Parameters<typeof this.txDb.transaction>[0]>[0],
    input: {
      organizationId: string;
      pageId: string;
      courseId: string;
      status: PageStatus;
      slug: string;
      title: string;
      publishedAt: Date | undefined;
    }
  ): Promise<void> {
    let courseStatus: PageStatus = input.status;

    if (input.status !== CONTENT_STATUS.PUBLISHED) {
      const [otherLivePage] = await tx
        .select({ id: landingPages.id })
        .from(landingPages)
        .where(
          and(
            eq(landingPages.organizationId, input.organizationId),
            eq(landingPages.subjectType, 'course'),
            eq(landingPages.subjectId, input.courseId),
            eq(landingPages.status, CONTENT_STATUS.PUBLISHED),
            isNull(landingPages.deletedAt),
            ne(landingPages.id, input.pageId)
          )
        )
        .limit(1);
      if (otherLivePage) courseStatus = CONTENT_STATUS.PUBLISHED;
    }

    const updated = await tx
      .update(courses)
      .set({
        slug: input.slug,
        title: input.title,
        status: courseStatus,
        ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      })
      .where(
        and(
          eq(courses.id, input.courseId),
          eq(courses.organizationId, input.organizationId),
          isNull(courses.deletedAt)
        )
      )
      .returning({ id: courses.id });

    if (updated.length === 0) {
      throw new NotFoundError('Journey course not found');
    }
  }

  /**
   * Persist the journey's OFFER — which ways-in the sales page presents and what
   * they cost (pence, GBP). This is the ONLY write path to a course's price.
   *
   * Two rows move together in ONE transaction, and that pairing is the point:
   *   - `landing_pages.offer` — the page's PRESENTATION of the ways-in (which
   *     toggles are on, the teaser prices the sell page shows).
   *   - `courses.price_cents` — the AUTHORITATIVE one-off price. It is what
   *     `deriveCheckoutOffers` reads, so a journey whose page says "£12 one-off"
   *     while this column is NULL renders "not open for enrolment just now".
   *     Writing them apart is what allowed that divergence, hence one transaction.
   *
   * Turning the one-off path OFF nulls `price_cents` — "not sold standalone" (§5),
   * the same state a never-priced course is in.
   *
   * Scoped to `(pageId, organizationId, deletedAt IS NULL)` — a foreign or missing
   * page throws `NotFoundError`, never a silent cross-org write (mirrors
   * {@link saveJourneyPage}'s guard). The subject course is re-checked inside the
   * transaction: a soft-deleted or foreign course would make the price update
   * match zero rows, re-opening the very divergence this method closes, so it
   * throws instead.
   *
   * @returns the persisted offer (the caller's saved baseline).
   */
  async updateJourneyOffer(
    organizationId: string,
    pageId: string,
    // Declared inline (not `PageOffer`) because the persisted bag is TOTAL —
    // every path explicitly on or off — while `PageOffer`'s fields are all
    // optional for the render side. The validated body satisfies this.
    offer: {
      tiersEnabled: boolean;
      subscriptionEnabled: boolean;
      subscriptionPriceCents: number | null;
      oneOffEnabled: boolean;
      oneOffPriceCents: number | null;
    }
  ): Promise<PageOffer> {
    try {
      // An ENABLED path with no price is the silent-failure shape: the sales page
      // advertises a way in that the checkout cannot price, so it shows nothing.
      // Reject it at the boundary rather than persisting an unsellable offer.
      if (offer.oneOffEnabled && offer.oneOffPriceCents === null) {
        throw new ValidationError(
          'Set a one-off price, or turn the one-off path off'
        );
      }
      if (offer.subscriptionEnabled && offer.subscriptionPriceCents === null) {
        throw new ValidationError(
          'Set a monthly price, or turn the course subscription off'
        );
      }

      return await this.txDb.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: landingPages.id,
            subjectType: landingPages.subjectType,
            subjectId: landingPages.subjectId,
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

        if (!existing) {
          throw new NotFoundError('Journey page not found');
        }

        const isCoursePage =
          existing.subjectType === 'course' && existing.subjectId !== null;

        // A plain landing page has no course to sell, so a one-off purchase has
        // nowhere authoritative to live. Fail loudly rather than persist a toggle
        // no checkout can honour.
        if (offer.oneOffEnabled && !isCoursePage) {
          throw new ValidationError(
            'Only a course journey can be sold as a one-off purchase'
          );
        }

        await tx
          .update(landingPages)
          .set({ offer })
          .where(
            and(
              eq(landingPages.id, pageId),
              eq(landingPages.organizationId, organizationId)
            )
          );

        if (isCoursePage && existing.subjectId) {
          const updated = await tx
            .update(courses)
            .set({
              priceCents: offer.oneOffEnabled ? offer.oneOffPriceCents : null,
            })
            .where(
              and(
                eq(courses.id, existing.subjectId),
                eq(courses.organizationId, organizationId),
                isNull(courses.deletedAt)
              )
            )
            .returning({ id: courses.id });

          // Zero rows ⇒ the subject course is gone or foreign. The offer bag
          // would then claim a price the checkout can never read — roll back.
          if (updated.length === 0) {
            throw new NotFoundError('Journey course not found');
          }
        }

        return offer;
      });
    } catch (error) {
      this.handleError(error, 'updateJourneyOffer');
    }
  }

  /**
   * Feature (or un-feature) a journey portal on the org homepage — the ONLY write
   * path to `landing_pages.featured`.
   *
   * {@link listPublishedJourneys} has READ this column since it shipped: it filters
   * on it for the home rail (`opts.featured`) and orders featured-first for both
   * surfaces. Nothing ever wrote it, so the column was reachable only by raw SQL or
   * a seed and the rail could not be curated from the studio at all — every org's
   * "featured" rail was permanently whatever the seed happened to set.
   *
   * A SEPARATE route from the page save (`PUT :pageId`) deliberately, for the
   * reason `saveJourneyPageBodySchema`'s own doc-comment records: that body is
   * `.strict()` and shared with the builder's AUTOSAVE. Folding `featured` in would
   * either 400 every existing save (which omits the key) or — under a non-strict
   * widening — accept the value, discard it, and report "Page saved", which is the
   * silent-drop failure `offer` and `seo` already caused there. Curation is also a
   * different gesture from authoring: a creator features a finished portal from the
   * studio index without reopening or republishing its body.
   *
   * ORTHOGONAL TO PUBLISH STATUS (mirrors how `content.featured` is documented):
   * `listPublishedJourneys` filters `status = 'published'` independently of this
   * flag, so featuring a draft is harmless — it stores intent and has no public
   * effect until the page publishes. This method therefore does NOT gate on status;
   * refusing to feature a draft would only force creators into a publish-then-
   * feature ordering the read side does not require.
   *
   * Scoped to `(pageId, organizationId, deletedAt IS NULL)` — all three predicates
   * are load-bearing. Without the org clause any authenticated creator who manages
   * ANY org could feature another org's portal onto their own homepage rail, so the
   * update is scoped rather than the read pre-checked. `.returning()` + a zero-row
   * guard is the only way to tell "no such page in this org" from "updated": an
   * UPDATE without it reports success for zero matched rows, which would report a
   * cross-tenant or soft-deleted target as a successful feature (mirrors
   * {@link updateJourneyOffer}'s zero-row guard).
   *
   * `updatedAt` is NOT set here — `landing_pages.updatedAt` carries
   * `.$onUpdate(() => new Date())`, so Drizzle stamps it on every update. Setting it
   * by hand is what the sibling mutations deliberately avoid.
   */
  async setJourneyFeatured(
    organizationId: string,
    pageId: string,
    featured: boolean
  ): Promise<void> {
    try {
      const updated = await this.db
        .update(landingPages)
        .set({ featured })
        .where(
          and(
            eq(landingPages.id, pageId),
            eq(landingPages.organizationId, organizationId),
            isNull(landingPages.deletedAt)
          )
        )
        // Bare `.returning()` — `BaseService.db`'s HTTP-client type does not
        // expose the projected overload (only the tx client does), exactly as
        // `setCourseCoverImageKey` documents. The ROW COUNT is what this guard
        // needs, and a bare returning still carries it.
        .returning();

      if (updated.length === 0) {
        throw new NotFoundError('Journey page not found');
      }
    } catch (error) {
      this.handleError(error, 'setJourneyFeatured');
    }
  }

  // ── Sell media + cover (Codex-eqh0z — the media WRITE path) ────────────────
  //
  // Before this, `courses.introVideoMediaId` / `previewVideoMediaId` /
  // `guideVideoMediaId` / `guide.portraitMediaId` were READ-ONLY codebase-wide:
  // `getCourseSellPreview` projected them, but nothing could ever set them, so
  // the `introVideo`, `reel` and `guide` sections could never show their primary
  // content. These three methods are that missing write path.

  /**
   * Read the journey's SELL MEDIA — the four `media_items` refs the sales page's
   * `introVideo` / `reel` / `guide` sections resolve, plus the still cover URL.
   *
   * Org-scoped through {@link resolveCourseIdForPage} (a foreign, missing, or
   * non-course page 404s), then re-scoped on the course row itself as
   * defence-in-depth. `r2PublicUrlBase` is env-owned and supplied by the route.
   */
  async getJourneySellMedia(
    organizationId: string,
    pageId: string,
    r2PublicUrlBase?: string
  ): Promise<JourneySellMedia> {
    try {
      const courseId = await this.resolveCourseIdForPage(
        organizationId,
        pageId
      );

      const [row] = await this.db
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
        .where(
          and(
            eq(courses.id, courseId),
            eq(courses.organizationId, organizationId),
            isNull(courses.deletedAt)
          )
        )
        .limit(1);

      if (!row) {
        throw new NotFoundError('Journey course not found');
      }

      return {
        courseId,
        introVideoMediaId: row.introVideoMediaId,
        previewVideoMediaId: row.previewVideoMediaId,
        guideVideoMediaId: row.guideVideoMediaId,
        guidePortraitMediaId: row.guide?.portraitMediaId ?? null,
        heroMediaId: row.heroMediaId,
        signatureMediaId: row.signatureMediaId,
        coverImageUrl: resolveCourseCoverUrl(
          row.coverImageKey,
          r2PublicUrlBase
        ),
      };
    } catch (error) {
      this.handleError(error, 'getJourneySellMedia');
    }
  }

  /**
   * Persist the journey's SELL MEDIA — a TOTAL write of the six media slots.
   *
   * Total, not merge: every slot is set to exactly what the caller sends, so
   * `null` CLEARS. A merge shape could only ever set a video, never unset one,
   * which is why the validated body defaults each absent slot to `null`.
   *
   * SCOPING — every non-null id is verified BEFORE the write (see
   * {@link assertMediaItemsInOrg}): the media must exist, be non-deleted, and
   * belong to a creator holding an ACTIVE membership in this org. A foreign id
   * throws `ForbiddenError` and NOTHING is written — `media_items` carries no
   * `organization_id`, so creator-membership is the org boundary, and the FK
   * alone would happily accept another org's media.
   *
   * `guide.portraitMediaId` lives inside the `guide` jsonb, so it is merged into
   * the existing bag rather than replacing it — writing a bare
   * `{ portraitMediaId }` would silently destroy the guide's name/bio/quote.
   * The read-then-merge runs INSIDE the transaction so a concurrent guide edit
   * cannot interleave.
   *
   * @returns the persisted shape (the caller's saved baseline).
   */
  async updateJourneySellMedia(
    organizationId: string,
    pageId: string,
    input: {
      introVideoMediaId: string | null;
      previewVideoMediaId: string | null;
      guideVideoMediaId: string | null;
      guidePortraitMediaId: string | null;
      /** A27 (Codex-wqxv4) — the hero still. */
      heroMediaId: string | null;
      /** A27 (Codex-wqxv4) — the guide's signature mark. */
      signatureMediaId: string | null;
    }
  ): Promise<JourneySellMedia> {
    try {
      const courseId = await this.resolveCourseIdForPage(
        organizationId,
        pageId
      );

      // Validate the ids BEFORE opening the transaction — a rejected write must
      // leave no trace, and a ForbiddenError here is cheaper than a rollback.
      await this.assertMediaItemsInOrg(organizationId, [
        input.introVideoMediaId,
        input.previewVideoMediaId,
        input.guideVideoMediaId,
        input.guidePortraitMediaId,
        input.heroMediaId,
        input.signatureMediaId,
      ]);

      return await this.txDb.transaction(async (tx) => {
        const [existing] = await tx
          .select({ guide: courses.guide })
          .from(courses)
          .where(
            and(
              eq(courses.id, courseId),
              eq(courses.organizationId, organizationId),
              isNull(courses.deletedAt)
            )
          )
          .limit(1);

        if (!existing) {
          throw new NotFoundError('Journey course not found');
        }

        // Merge the portrait into the existing guide bag. A portrait with no
        // guide at all still needs somewhere to live, so seed a minimal bag
        // (`name: ''`) rather than dropping the creator's selection silently.
        const guide: CourseGuide | null =
          input.guidePortraitMediaId === null && !existing.guide
            ? null
            : {
                ...(existing.guide ?? { name: '' }),
                ...(input.guidePortraitMediaId === null
                  ? { portraitMediaId: undefined }
                  : { portraitMediaId: input.guidePortraitMediaId }),
              };

        const updated = await tx
          .update(courses)
          .set({
            introVideoMediaId: input.introVideoMediaId,
            previewVideoMediaId: input.previewVideoMediaId,
            guideVideoMediaId: input.guideVideoMediaId,
            heroMediaId: input.heroMediaId,
            signatureMediaId: input.signatureMediaId,
            guide,
          })
          .where(
            and(
              eq(courses.id, courseId),
              eq(courses.organizationId, organizationId),
              isNull(courses.deletedAt)
            )
          )
          .returning({
            introVideoMediaId: courses.introVideoMediaId,
            previewVideoMediaId: courses.previewVideoMediaId,
            guideVideoMediaId: courses.guideVideoMediaId,
            heroMediaId: courses.heroMediaId,
            signatureMediaId: courses.signatureMediaId,
            guide: courses.guide,
            coverImageKey: courses.coverImageKey,
          });

        // Zero rows ⇒ the course was soft-deleted between the resolve and the
        // write. Reporting success would tell the builder its media persisted
        // when it did not, so roll back and 404 instead.
        const [row] = updated;
        if (!row) {
          throw new NotFoundError('Journey course not found');
        }

        return {
          courseId,
          introVideoMediaId: row.introVideoMediaId,
          previewVideoMediaId: row.previewVideoMediaId,
          guideVideoMediaId: row.guideVideoMediaId,
          guidePortraitMediaId: row.guide?.portraitMediaId ?? null,
          heroMediaId: row.heroMediaId,
          signatureMediaId: row.signatureMediaId,
          // The cover is written by its own multipart endpoint; echo the stored
          // key unresolved-to-null here rather than inventing a base URL.
          coverImageUrl: null,
        };
      });
    } catch (error) {
      this.handleError(error, 'updateJourneySellMedia');
    }
  }

  /**
   * Persist (or clear) the subject course's cover R2 key, org-scoped.
   *
   * The DB half of the cover upload: `ImageProcessingService.processCourseCover`
   * owns the R2 variants and returns the base key, and this owns the scoped
   * write — the same split `categories` uses, so no scope logic is duplicated in
   * the image layer. Pass `null` to clear (the R2 objects are left in place;
   * keys are deterministic per course, so a later re-upload overwrites them).
   *
   * @returns the persisted key (null when cleared).
   */
  async setCourseCoverImageKey(
    organizationId: string,
    pageId: string,
    coverImageKey: string | null
  ): Promise<{ courseId: string; coverImageKey: string | null }> {
    try {
      const courseId = await this.resolveCourseIdForPage(
        organizationId,
        pageId
      );

      const updated = await this.db
        .update(courses)
        .set({ coverImageKey })
        .where(
          and(
            eq(courses.id, courseId),
            eq(courses.organizationId, organizationId),
            isNull(courses.deletedAt)
          )
        )
        // Bare `.returning()` — `BaseService.db`'s HTTP-client type does not
        // expose the projected overload (only the tx client does).
        .returning();

      const [row] = updated;
      if (!row) {
        throw new NotFoundError('Journey course not found');
      }
      return { courseId, coverImageKey: row.coverImageKey };
    } catch (error) {
      this.handleError(error, 'setCourseCoverImageKey');
    }
  }

  /**
   * Guard: every non-null media id exists, is non-deleted, and belongs to a
   * creator with an ACTIVE membership in `organizationId`. Throws
   * `ForbiddenError` naming the offending id otherwise.
   *
   * `media_items` has NO `organization_id` column — its only link to an org is
   * `creatorId → organization_memberships`. So creator-membership IS the org
   * boundary here, and it has to be checked explicitly: the FK on
   * `courses.intro_video_media_id` references `media_items(id)` with no org
   * predicate, so without this check a manager of org A could attach org B's
   * private media to org A's public sales page and the database would accept it.
   *
   * Nulls are skipped (clearing a slot needs no ownership) and duplicates are
   * de-duplicated, so one id used in two slots costs one row.
   */
  private async assertMediaItemsInOrg(
    organizationId: string,
    mediaIds: readonly (string | null)[]
  ): Promise<void> {
    const wanted = [...new Set(mediaIds.filter((id): id is string => !!id))];
    if (wanted.length === 0) return;

    const rows = await this.db
      .selectDistinct({ id: mediaItems.id })
      .from(mediaItems)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, mediaItems.creatorId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active')
        )
      )
      .where(and(inArray(mediaItems.id, wanted), isNull(mediaItems.deletedAt)));

    const allowed = new Set(rows.map((r) => r.id));
    const rejected = wanted.find((id) => !allowed.has(id));
    if (rejected) {
      // ForbiddenError, not NotFoundError: the caller IS authenticated and IS an
      // org manager — the media simply is not theirs to attach. A 404 would read
      // as "bad id" and invite a retry loop against another org's id space.
      throw new ForbiddenError('Media item does not belong to this space', {
        mediaItemId: rejected,
      });
    }
  }

  // ── Curriculum editor (Codex-03cwh — admin two-pane editor) ────────────────

  /**
   * Resolve the subject COURSE id for a landing-page id, org-scoped. The
   * curriculum editor addresses a journey by its landing-page id (the studio
   * URL `/studio/journeys/[id]/curriculum`), but the curriculum belongs to the
   * subject course. Scoped to `(id, organizationId, deletedAt IS NULL)` — a
   * foreign, missing, or non-course page throws `NotFoundError` (never a
   * cross-org read; mirrors {@link saveJourneyPage}'s guard shape).
   */
  async resolveCourseIdForPage(
    organizationId: string,
    pageId: string
  ): Promise<string> {
    try {
      const [page] = await this.db
        .select({
          subjectId: landingPages.subjectId,
          subjectType: landingPages.subjectType,
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
      if (!page || page.subjectType !== 'course' || !page.subjectId) {
        throw new NotFoundError('Journey course not found');
      }
      return page.subjectId;
    } catch (error) {
      this.handleError(error, 'resolveCourseIdForPage');
    }
  }

  /**
   * The admin CURRICULUM for the studio editor. Distinct from
   * {@link loadStages}/{@link loadPublicStages}: the editor must show practices
   * whose linked content is still a DRAFT (a curriculum is built before its
   * media publishes), so it does NOT filter to PUBLISHED content — it returns
   * each practice's publish `status` for the inspector instead. Scoped to
   * `(id, organizationId, deletedAt IS NULL)`; a foreign/missing course throws
   * `NotFoundError` (mirrors `CourseInsightsService.getInsights`).
   */
  async getCourseCurriculumForEditor(
    organizationId: string,
    courseId: string
  ): Promise<EditorCurriculum> {
    try {
      await this.assertCourseInOrg(organizationId, courseId);
      const stages = await this.loadEditorStages(courseId);
      return { courseId, stages };
    } catch (error) {
      this.handleError(error, 'getCourseCurriculumForEditor');
    }
  }

  /**
   * Persist the WHOLE curriculum for a course in ONE transaction. The editor is
   * "edit locally → Save", so this diffs the desired stages/practices against
   * the persisted state and reconciles atomically:
   *   - a desired stage with a known id → renamed + reordered; an unknown/null
   *     id → inserted (server-assigned id); a persisted stage absent from the
   *     desired set → soft-deleted.
   *   - practices are the `stage_practices` JOIN; every desired `contentId` is
   *     SPACE-GUARDED (must be non-deleted content in the course's org —
   *     HARDENING §5) then reconciled per stage (insert new joins, hard-delete
   *     removed, rewrite `sortOrder`).
   *
   * The `(courseId, sortOrder)` UNIQUE index (partial on non-deleted) forbids a
   * naive reorder — a mid-swap collision — so stage sort values are first parked
   * at a high temporary offset, then written to their final `0..n-1` positions
   * within the same tx. Returns the freshly-persisted curriculum.
   */
  async saveCurriculum(
    organizationId: string,
    courseId: string,
    input: {
      stages: Array<{
        id: string | null;
        name: string;
        gloss: string | null;
        practices: Array<{ contentId: string }>;
      }>;
    }
  ): Promise<EditorCurriculum> {
    try {
      await this.assertCourseInOrg(organizationId, courseId);

      // Space guard (HARDENING §5): every desired practice must point at
      // non-deleted content in THIS course's org. The picker only offers such
      // content, so a mismatch is tampering — reject the whole save.
      const desiredContentIds = [
        ...new Set(
          input.stages.flatMap((s) => s.practices.map((p) => p.contentId))
        ),
      ];
      if (desiredContentIds.length > 0) {
        const okRows = await this.db
          .select({ id: content.id })
          .from(content)
          .where(
            and(
              inArray(content.id, desiredContentIds),
              eq(content.organizationId, organizationId),
              isNull(content.deletedAt)
            )
          );
        if (okRows.length !== desiredContentIds.length) {
          throw new ForbiddenError(
            'A practice references content outside this organization'
          );
        }
      }

      await this.txDb.transaction(async (tx) => {
        const existing = await tx
          .select({ id: courseStages.id })
          .from(courseStages)
          .where(
            and(
              eq(courseStages.courseId, courseId),
              isNull(courseStages.deletedAt)
            )
          );
        const existingIds = new Set(existing.map((s) => s.id));

        // 1. Soft-delete stages the editor dropped — they leave the partial
        //    unique index, freeing their sort slots.
        const keptIds = new Set(
          input.stages
            .map((s) => s.id)
            .filter((id): id is string => id !== null && existingIds.has(id))
        );
        const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
        if (toDelete.length > 0) {
          await tx
            .update(courseStages)
            .set({ deletedAt: new Date() })
            .where(inArray(courseStages.id, toDelete));
        }

        // 2. Park every surviving/new stage at a disjoint temporary sort offset,
        //    vacating the final 0..n-1 range so step 3 cannot collide.
        const TEMP_OFFSET = 1_000_000;
        const resolvedIds: string[] = []; // final real id per desired stage, in order
        let temp = TEMP_OFFSET;
        for (const s of input.stages) {
          if (s.id !== null && existingIds.has(s.id)) {
            await tx
              .update(courseStages)
              .set({ name: s.name, gloss: s.gloss, sortOrder: temp })
              .where(eq(courseStages.id, s.id));
            resolvedIds.push(s.id);
          } else {
            const [row] = await tx
              .insert(courseStages)
              .values({
                courseId,
                name: s.name,
                gloss: s.gloss,
                sortOrder: temp,
              })
              .returning({ id: courseStages.id });
            if (!row) {
              throw new Error('saveCurriculum: stage insert returned no row');
            }
            resolvedIds.push(row.id);
          }
          temp++;
        }

        // 3. Write the final 0..n-1 sort positions (the range is now free).
        for (const [i, stageId] of resolvedIds.entries()) {
          await tx
            .update(courseStages)
            .set({ sortOrder: i })
            .where(eq(courseStages.id, stageId));
        }

        // 4. Reconcile practices per stage (the join has no sort unique index).
        for (const [i, stageId] of resolvedIds.entries()) {
          const stage = input.stages[i];
          if (!stage) continue;
          const desired = stage.practices;
          const current = await tx
            .select({ contentId: stagePractices.contentId })
            .from(stagePractices)
            .where(eq(stagePractices.stageId, stageId));
          const currentSet = new Set(current.map((c) => c.contentId));
          const desiredSet = new Set(desired.map((p) => p.contentId));

          const removeIds = [...currentSet].filter((c) => !desiredSet.has(c));
          if (removeIds.length > 0) {
            await tx
              .delete(stagePractices)
              .where(
                and(
                  eq(stagePractices.stageId, stageId),
                  inArray(stagePractices.contentId, removeIds)
                )
              );
          }
          for (const [j, practice] of desired.entries()) {
            if (currentSet.has(practice.contentId)) {
              await tx
                .update(stagePractices)
                .set({ sortOrder: j })
                .where(
                  and(
                    eq(stagePractices.stageId, stageId),
                    eq(stagePractices.contentId, practice.contentId)
                  )
                );
            } else {
              await tx.insert(stagePractices).values({
                stageId,
                contentId: practice.contentId,
                sortOrder: j,
              });
            }
          }
        }

        // 5. GATE the linked practices (Codex-0biug — paywall bypass).
        //
        // A practice created in the studio carries the DEFAULT access policy,
        // and `ContentService.create` derives `isFree: true` whenever no other
        // flag is set. That flag set lands on the terminal `return grant('free')`
        // in `content-access/access-decision.ts`, so the practice was streamable
        // by an ANONYMOUS visitor at its standalone `/content/[slug]` URL — the
        // course gate gave no protection because it guards the JOURNEY routes,
        // not this second door to the same media.
        //
        // `courseOnly` is the existing fix that was never applied: the resolver
        // checks it FIRST and suppresses every standalone path regardless of the
        // other flags (schema/content.ts:270), so setting it alone is sufficient
        // — `isFree` is deliberately left untouched (it still drives display
        // badges, and it can no longer grant access once `courseOnly` wins).
        //
        // SURGICAL BY DESIGN — the predicate gates ONLY content with no
        // deliberately-configured standalone path. Content that is independently
        // purchasable, tier-gated, follower-gated or team-only already has its
        // own paywall, and selling it both standalone AND inside a course is a
        // legitimate creator choice this must not silently revoke. Filtering on
        // `courseOnly = false` also keeps the write idempotent, so re-saving an
        // existing curriculum heals practices linked before this landed without
        // re-writing rows that are already gated.
        if (desiredContentIds.length > 0) {
          await tx
            .update(content)
            .set({ courseOnly: true })
            .where(
              and(
                inArray(content.id, desiredContentIds),
                eq(content.organizationId, organizationId),
                isNull(content.deletedAt),
                eq(content.courseOnly, false),
                eq(content.isPurchasable, false),
                isNull(content.includedInTierId),
                eq(content.isFollowerGated, false),
                eq(content.isTeamOnly, false)
              )
            );
        }
      });

      return await this.getCourseCurriculumForEditor(organizationId, courseId);
    } catch (error) {
      this.handleError(error, 'saveCurriculum');
    }
  }

  // ── Private read helpers ──────────────────────────────────────────────────

  /**
   * Guard: the course exists, is non-deleted, and belongs to `organizationId`.
   * Throws `NotFoundError` otherwise (never leaks a foreign course). Mirrors the
   * `(id, organizationId, deletedAt IS NULL)` guard in `CourseInsightsService`.
   */
  private async assertCourseInOrg(
    organizationId: string,
    courseId: string
  ): Promise<void> {
    const [course] = await this.db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.id, courseId),
          eq(courses.organizationId, organizationId),
          isNull(courses.deletedAt)
        )
      )
      .limit(1);
    if (!course) {
      throw new NotFoundError('Course not found');
    }
  }

  /**
   * The editor's stage+practice read — the {@link loadStages} shape WITHOUT the
   * PUBLISHED filter (drafts must remain visible in the editor) and WITH the
   * linked content's publish `status` for the inspector.
   */
  private async loadEditorStages(courseId: string): Promise<EditorStageView[]> {
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
        status: content.status,
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
          // NO `status = PUBLISHED` filter — the editor shows draft practices.
          isNull(content.deletedAt)
        )
      )
      .orderBy(asc(stagePractices.sortOrder));

    const byStage = new Map<string, EditorPracticeView[]>();
    for (const row of practiceRows) {
      const practice: EditorPracticeView = {
        contentId: row.contentId,
        slug: row.slug,
        title: row.title,
        contentType: toPracticeContentType(row.contentType),
        status: toPageStatus(row.status),
        thumbnailUrl: row.thumbnailUrl ?? row.mediaThumbnailKey ?? null,
        // From the already-joined media item — null for a written practice, or
        // media whose duration was never probed.
        durationSeconds: row.mediaDurationSeconds ?? null,
        sortOrder: row.sortOrder,
      };
      const list = byStage.get(row.stageId);
      if (list) list.push(practice);
      else byStage.set(row.stageId, [practice]);
    }

    return stageRows.map((stage) => ({
      id: stage.id,
      name: stage.name,
      gloss: stage.gloss,
      sortOrder: stage.sortOrder,
      practices: (byStage.get(stage.id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder
      ),
    }));
  }

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
        lede: courses.lede,
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
      lede: row.lede ?? null,
      organizationSlug: row.organizationSlug ?? null,
    };
  }

  /**
   * Load the ordered curriculum: non-deleted stages (by `sortOrder`) each with
   * their PUBLISHED, non-deleted practice content (by `stage_practices.sortOrder`).
   * Two bounded queries (stages, then practices) so a stage with no practices
   * still appears. `durationSeconds` / `thumbnailUrl` fall back to the media item.
   *
   * Thin wrapper over {@link loadStagesForCourses} so the grouping logic exists
   * once. Callers loading MORE THAN ONE course must call the batched form
   * directly — see Codex-kgrdp.23 defect 2.
   */
  private async loadStages(courseId: string): Promise<JourneyStage[]> {
    const byCourse = await this.loadStagesForCourses([courseId]);
    return byCourse.get(courseId) ?? [];
  }

  /**
   * Batched {@link loadStages}: the curriculum for MANY courses in TWO queries
   * total, regardless of how many courses are asked for.
   *
   * WHY THIS EXISTS: `packages/database` builds its client on
   * `drizzle-orm/neon-http`, which makes one HTTPS round trip PER SQL STATEMENT
   * (no pooling, no pipelining) at ~81ms each. A per-course loop therefore costs
   * 3 serialized round trips per enrolled course — O(N) in catalogue size, and a
   * measured contributor to edge 504s on `/journeys/**` (Codex-kgrdp.23).
   * Statement count is round-trip count here, so batching is the only lever.
   *
   * Courses with no stages are absent from the returned map; callers coalesce
   * with `?? []`.
   */
  private async loadStagesForCourses(
    courseIds: readonly string[]
  ): Promise<Map<string, JourneyStage[]>> {
    const byCourse = new Map<string, JourneyStage[]>();
    if (courseIds.length === 0) return byCourse;

    const uniqueCourseIds = [...new Set(courseIds)];

    const stageRows = await this.db
      .select({
        id: courseStages.id,
        courseId: courseStages.courseId,
        name: courseStages.name,
        gloss: courseStages.gloss,
        sortOrder: courseStages.sortOrder,
      })
      .from(courseStages)
      .where(
        and(
          inArray(courseStages.courseId, uniqueCourseIds),
          isNull(courseStages.deletedAt)
        )
      )
      .orderBy(asc(courseStages.sortOrder));

    if (stageRows.length === 0) return byCourse;

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

    // `stageRows` is already ascending by `sortOrder`, so grouping in row order
    // preserves per-course stage order.
    for (const stage of stageRows) {
      const journeyStage: JourneyStage = {
        id: stage.id,
        name: stage.name,
        gloss: stage.gloss,
        sortOrder: stage.sortOrder,
        practices: (practicesByStage.get(stage.id) ?? []).sort(
          (a, b) => a.sortOrder - b.sortOrder
        ),
      };
      const existing = byCourse.get(stage.courseId);
      if (existing) existing.push(journeyStage);
      else byCourse.set(stage.courseId, [journeyStage]);
    }

    return byCourse;
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
