/**
 * Journey remote-function CONTRACTS (Codex-2pryk.2.1 · WP-0).
 *
 * The frozen signatures + return types for the SvelteKit remote functions that
 * feed the journey surfaces (HARDENING §G item d). WP-3/4/5/7 IMPLEMENT these as
 * `query()` / `command()` in apps/web `*.remote.ts` files (mirroring
 * `$lib/remote/library.remote.ts`); until then FE surfaces mock against these
 * shapes and BE knows what to produce.
 *
 * These are READ-MODEL ENVELOPES. The load-bearing, frozen parts are the
 * function names, their params, the top-level return shape, and the access
 * fields (`canView`/`canEnterCourse`, `via`). The nested presentational fields
 * are grounded in the prototype (`docs/design/course-journeys/prototype/`) +
 * FRONTEND-MAP §E and MAY be extended by WP-3/WP-4 as surfaces are built —
 * additive only.
 *
 * INERT + public-bundle safe: types only, no component imports — lives under
 * `$lib/page-builder` (CE-4 boundary gate scanned root).
 */
import type { PageBuilderState, PageStatus } from '@codex/shared-types';

// ── Shared read-model atoms ──────────────────────────────────────────────────

/**
 * The canonical access-source lexicon (pins the drift HARDENING §A flagged:
 * "members"/"via membership"/"subscribers"/"Included" collapse to ONE set mapped
 * to SPEC §6.1). This is the library's "why can I see this" signal.
 */
export type LibraryAccessSource =
  | 'free'
  | 'purchased'
  | 'included_in_tier'
  | 'part_of_course';

/** Practice/content kinds (`content.contentType`), presented per-type by surfaces. */
export type JourneyContentType = 'video' | 'audio' | 'written';

export interface JourneyPracticeView {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: JourneyContentType;
  /** Flat practice index within the course (`stage.sortOrder` ⋈ `practice.sortOrder`). */
  sortOrder: number;
  /** Completion — dashboard / in-course only; omitted on the public sales page. */
  completed?: boolean;
}

export interface JourneyStageView {
  id: string;
  name: string;
  gloss: string | null;
  sortOrder: number;
  practices: JourneyPracticeView[];
}

/**
 * STUDIO curriculum-editor mirror (Codex-03cwh) — the structural twin of the BE
 * `EditorPracticeView` (`@codex/shared-types`). A SUPERSET of
 * {@link JourneyPracticeView}: the editor inspector's media-slot needs the
 * linked content's picker metadata (title/type/thumbnail/publish status) the
 * public view omits, and the editor shows DRAFT-content practices too.
 */
export interface EditorPracticeView {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: JourneyContentType;
  /** Publish status of the LINKED CONTENT (draft ⇒ not yet member-visible). */
  status: PageStatus;
  thumbnailUrl: string | null;
  /**
   * Runtime of the linked media; `null` for a written practice or unprobed media.
   * Feeds the builder map's "≈ N min in all" cue.
   */
  durationSeconds: number | null;
  sortOrder: number;
}

/** An ordered stage with its practice pool, as the studio editor reads it. */
export interface EditorStageView {
  id: string;
  name: string;
  gloss: string | null;
  sortOrder: number;
  practices: EditorPracticeView[];
}

/** The full admin curriculum the studio editor loads for one course. */
export interface EditorCurriculum {
  courseId: string;
  stages: EditorStageView[];
}

/**
 * One "Choose from your library" PICKER option (Codex-03cwh). A projection of
 * the org's existing content the editor can attach as a practice — sourced from
 * the reused content-list read, NOT a new endpoint. Shaped so a picked option
 * drops straight into an {@link EditorPracticeView} (by `contentId`).
 */
export interface CurriculumContentOption {
  contentId: string;
  title: string;
  contentType: JourneyContentType;
  /** Publish status — the picker flags drafts (attachable, but not yet live). */
  status: PageStatus;
  thumbnailUrl: string | null;
}

export interface JourneyCourseView {
  id: string;
  slug: string;
  title: string;
  kicker: string | null;
  lede: string | null;
  status: PageStatus;
  /** One-off purchase price; null = not sold standalone (§5). */
  priceCents: number | null;
  stageCount: number;
  practiceCount: number;
}

export interface JourneyTestimonialView {
  id: string;
  quote: string;
  authorName: string;
  authorContext: string | null;
  sortOrder: number;
}

/** A persisted landing page = the editable {@link PageBuilderState} + its row identity. */
export interface JourneyPageRecord extends PageBuilderState {
  id: string;
  organizationId: string;
  publishedAt: string | null;
}

/** Progress rollup = `practice_completions ⋈ stage_practices`, scoped to the enrollment (§11). */
export interface JourneyProgress {
  completed: number;
  total: number;
  /** 0–100, integer. */
  pct: number;
}

// ── Return shapes, per surface ───────────────────────────────────────────────

/** Public sales/landing page (SSR shell+stream). No `canView` on the shell. */
export interface JourneyCoursePage {
  page: JourneyPageRecord;
  course: JourneyCourseView;
  stages: JourneyStageView[];
  testimonials: JourneyTestimonialView[];
}

/** Studio home / index row, with `live` reporting rollups. */
export interface JourneyListItem {
  id: string;
  pageType: string;
  subjectType: string | null;
  slug: string;
  title: string;
  status: PageStatus;
  tagline: string | null;
  /** Course-only rollups — null for a plain landing page. */
  stageCount: number | null;
  practiceCount: number | null;
  enrolledCount: number | null;
  /** `live` provenance (purchases + subscriptions). */
  revenueCents: number | null;
  updatedAt: string;
}

/**
 * Progress state of an enrolled journey (library shelf + continue rail).
 * FE mirror of `@codex/shared-types` `JourneyProgressStatus`.
 */
export type JourneyProgressStatus = 'not-started' | 'in-progress' | 'completed';

/**
 * A journey as a PUBLIC discovery card (Codex-oi2w4 — the org home "featured
 * journeys" rail + the Explore grid). FE mirror of `@codex/shared-types`
 * `JourneyCardView` (structurally identical by design). Fully public — no
 * per-user state.
 */
export interface JourneyCardView {
  pageId: string;
  /** Org-scoped landing-page slug → the public sell page (`/journeys/:slug`). */
  slug: string;
  title: string;
  kicker: string | null;
  tagline: string | null;
  courseId: string;
  courseSlug: string;
  /** One-off purchase price in GBP pence; null = membership-only. */
  priceCents: number | null;
  stageCount: number;
  practiceCount: number;
  featured: boolean;
  /**
   * Public CDN URL for the course cover, or null when the creator has not
   * uploaded one. Never a raw R2 key. `JourneyCard` MUST render its typographic
   * fallback on null, with no layout shift (Codex-eqh0z).
   */
  coverImageUrl: string | null;
}

/**
 * The journey's SELL MEDIA — the four media refs the sales page's `introVideo` /
 * `reel` / `guide` sections resolve their primary content from, plus the still
 * cover (Codex-eqh0z). FE mirror of `@codex/shared-types` `JourneySellMedia`.
 *
 * The three video ids and the guide portrait are `media_items` refs; the cover is
 * NOT (`media_items` is CHECK-constrained to video/audio, so a still image
 * cannot live there) — it arrives already resolved to a CDN URL.
 */
export interface JourneySellMedia {
  courseId: string;
  introVideoMediaId: string | null;
  previewVideoMediaId: string | null;
  guideVideoMediaId: string | null;
  guidePortraitMediaId: string | null;
  coverImageUrl: string | null;
}

/**
 * A journey the current user is enrolled in (Codex-oi2w4 — the library "Your
 * journeys" shelf + continue rail). FE mirror of `@codex/shared-types`
 * `EnrolledJourneyCard`. The discovery card + the user's progress rollup.
 */
export interface EnrolledJourneyCard extends JourneyCardView {
  completedPractices: number;
  totalPractices: number;
  /** 0–100, integer. */
  percent: number;
  status: JourneyProgressStatus;
  enrolledAt: string;
  lastActivityAt: string | null;
  completedAt: string | null;
}

/**
 * Member journey portal (non-SSR; the route's `+page.server.ts` runs the
 * `canEnterCourse` gate before this resolves — §6.4 / HARDENING §E).
 */
export interface JourneyDashboardData {
  course: JourneyCourseView;
  stages: JourneyStageView[];
  canEnterCourse: boolean;
  enrolledAt: string | null;
  lastActivityAt: string | null;
  progress: JourneyProgress;
}

/** One owned journey shelf entry (library grouped by course — §8.4 / §14.6). */
export interface JourneyLibraryCourse {
  course: JourneyCourseView;
  via: LibraryAccessSource;
  progress: JourneyProgress;
  canEnterCourse: boolean;
}

/** One owned standalone content item in the library. */
export interface JourneyLibraryContentItem {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: JourneyContentType;
  via: LibraryAccessSource;
  /** Set for `part_of_course` items → the standalone page can offer "open in course". */
  courseSlug: string | null;
}

/** The user's journeys shelf + owned content, grouped by source. */
export interface JourneyLibrary {
  journeys: JourneyLibraryCourse[];
  content: JourneyLibraryContentItem[];
}

// ── Remote-function signature aliases ────────────────────────────────────────
// WP-3/4/5/7 implement these as query()/command() in apps/web `*.remote.ts`.
// The alias names the CONTRACT (params → resolved value); the wire wrapper
// (query/command) and Zod input schema are the implementer's concern.

/** Public sales page read (WP-3). Returns null when no published page matches. */
export type GetCoursePageQuery = (input: {
  slug: string;
}) => Promise<JourneyCoursePage | null>;

/** Member dashboard read (WP-4). Returns null when the course does not exist. */
export type GetCourseDashboardQuery = (input: {
  slug: string;
}) => Promise<JourneyDashboardData | null>;

/** Library shelf read (WP-4). Self-scoped to the session user; empty for guests. */
export type GetJourneyLibraryQuery = () => Promise<JourneyLibrary>;

/** Studio home list (WP-5), reactive off the org + a status filter. */
export type ListJourneysQuery = (input: {
  organizationId: string;
  status?: PageStatus;
}) => Promise<JourneyListItem[]>;

/** Load a page draft into the studio builder (WP-5). Null when not found. */
export type GetJourneyForBuilderQuery = (input: {
  id: string;
}) => Promise<JourneyPageRecord | null>;
