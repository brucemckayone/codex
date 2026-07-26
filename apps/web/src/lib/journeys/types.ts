/**
 * Journey member-surface view types (Codex-2pryk · WP-4).
 *
 * The shapes the course DASHBOARD and IN-COURSE PLAYER consume. These are the
 * FE-facing projections of the WP-1 schema (`courses`, `course_stages`,
 * `stage_practices`, `course_enrollments`, `practice_completions`) — NOT the raw
 * Drizzle rows. The Round-D seam (`$lib/server/journeys/round-d-seam.ts`)
 * produces them; the real `@codex/access` API will return the same shapes when
 * the web→worker plumbing lands, so the UI never changes.
 *
 * Universal module (no server-only imports) so both the server seam and the
 * client components / progress store can import it.
 */

/**
 * Practice content type (SPEC §14.3). Drives the D-E completion boundary:
 *   - `video` / `audio` → completion AUTO-writes on genuine 100% finish.
 *   - `written`         → completion is an EXPLICIT "Mark complete" action.
 * Mirrors `content.contentType` (`'video' | 'audio' | 'written'`).
 */
export type PracticeContentType = 'video' | 'audio' | 'written';

/** How a `practice_completions` row was written (SPEC §11 / schema CHECK). */
export type CompletionSource = 'manual' | 'auto';

/** A summary of a course, enough to render chrome + build URLs. */
export interface JourneyCourseSummary {
  id: string;
  slug: string | null;
  title: string;
  organizationSlug: string | null;
  /**
   * One-line course framing (the sell lede), surfaced on the member dashboard
   * header. Optional/additive: summary builders that don't need it (e.g. the
   * gate's by-slug resolver) may omit it.
   */
  lede?: string | null;
}

/**
 * The PUBLISHED course(s) that include a content item as a practice — the
 * standalone content page's journey cross-link (Codex-2pryk.3.10, F19/F20).
 * FE mirror of `@codex/shared-types`' `ContentCourseLinks` (must stay equal).
 * `courses` is empty when the item belongs to no published course (the
 * cross-link is then omitted); the FE renders the primary (first) course.
 */
export interface ContentCourseLinks {
  courses: JourneyCourseSummary[];
}

/**
 * One practice (a `content` row inside a stage), as the member surfaces read it.
 * `durationSeconds` is present for media (drives the resume + finish signal).
 */
export interface JourneyPractice {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: PracticeContentType;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  sortOrder: number;
}

/** An ordered stage (a "gate") with its concurrent practice pool (SPEC §5). */
export interface JourneyStage {
  id: string;
  name: string;
  gloss: string | null;
  sortOrder: number;
  practices: JourneyPractice[];
}

/** The current user's enrollment in a course (SPEC §11). */
export interface JourneyEnrollment {
  courseId: string;
  enrolledAt: string;
  lastActivityAt: string | null;
  /** Stamped when every required practice is complete. */
  completedAt: string | null;
}

/**
 * A completion the SERVER knows about — the `practice_completions` row, the
 * SOURCE OF TRUTH for course progress (SPEC §11 / D-E). Hydrated into the
 * progress store so live queries reflect server truth on first paint.
 */
export interface PracticeCompletionRecord {
  contentId: string;
  completedAt: string;
  source: CompletionSource;
}

/**
 * Everything the dashboard needs after the `canEnterCourse` gate passes:
 * enrollment, the ordered curriculum, and the server-known completions.
 */
export interface CourseDashboardData {
  course: JourneyCourseSummary;
  enrollment: JourneyEnrollment;
  stages: JourneyStage[];
  completions: PracticeCompletionRecord[];
}

/** One row of the in-course playlist rail (the whole course sequence, flattened). */
export interface PlaylistEntry {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: PracticeContentType;
  stageId: string;
  stageName: string;
  sortOrder: number;
}

/**
 * Everything the in-course player needs after `canEnterCourse` (+ `canView` for
 * the stream) pass. `streamingUrl` / `waveformUrl` are signed R2 URLs for media;
 * `null` for `written` practices (their body renders from `bodyHtml`).
 */
export interface InCoursePracticeData {
  course: JourneyCourseSummary;
  stage: { id: string; name: string };
  practice: JourneyPractice;
  /** Signed HLS URL — media only; null for written / when stream not viewable. */
  streamingUrl: string | null;
  waveformUrl: string | null;
  /** Rendered body HTML for `written` practices; null for media. */
  bodyHtml: string | null;
  /** Resume position for media (seconds). */
  initialProgressSeconds: number;
  /** The whole course sequence, for the playlist rail + prev/next. */
  playlist: PlaylistEntry[];
  /** Server-known completions across the course (hydrates the store). */
  completions: PracticeCompletionRecord[];
}

/**
 * Per-course progress rollup for the member library "Your journeys" shelf
 * (SPEC §8.4). The FE-facing twin of `@codex/shared-types`'
 * `EnrolledCourseProgress` — the SAME `practice_completions ⋈ stage_practices`
 * rollup the dashboard computes, summarised to a journey card's numbers.
 */
export interface EnrolledCourseProgress {
  done: number;
  total: number;
  /** Integer 0–100; `0` when the course has no practices. */
  percent: number;
  status: 'not-started' | 'in-progress' | 'completed';
  /** Most recent completion timestamp (ISO), or `null`. */
  lastCompletedAt: string | null;
  /** First incomplete practice in course order — the resume target; `null` when done/empty. */
  nextPracticeSlug: string | null;
  /** Title of {@link nextPracticeSlug} — the "Next · …" resume label. */
  nextPracticeTitle: string | null;
}

/**
 * One enrolled course as the member LIBRARY "Your journeys" shelf reads it
 * (SPEC §8.4). FE-facing twin of `@codex/shared-types`' `EnrolledCourseSummary`
 * (the content-api serialises the structurally-identical shape). Strictly
 * scoped to `(user, org)` by the worker — never another user's enrollments.
 */
export interface EnrolledCourseSummary {
  course: {
    id: string;
    slug: string | null;
    title: string;
    organizationSlug: string | null;
    kicker: string | null;
    lede: string | null;
    guideName: string | null;
  };
  enrollment: JourneyEnrollment;
  /** `course_enrollments.source` (e.g. `course_purchase`) → access badge. */
  enrollmentSource: string;
  progress: EnrolledCourseProgress;
}
