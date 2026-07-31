/**
 * Journeys / Landing-Page-Builder shared contracts (Codex-2pryk.2.1 · WP-0).
 *
 * The CONTRACT BARRIER for the Landing-Page-Builder & Guided-Journeys build.
 * Everything downstream composes on the shapes frozen here:
 *   - WP-1 SCHEMA         — `landing_pages.sections` / `.brandOverrides` jsonb
 *                           `$type<>()`, the §6.1 content access policy columns,
 *                           and the `entitlements` grant row.
 *   - WP-2 RESOLVER       — implements {@link EntitlementResolver} in @codex/access.
 *   - WP-3/4/5/7 SURFACES — the FE renderer, dashboard, studio builder + reporting
 *                           mock against these + the FE aggregation in
 *                           `apps/web/src/lib/page-builder`.
 *
 * Placement: this is a CROSS-WORKER contract module. It lives in
 * `@codex/shared-types` (zero runtime deps) rather than `$lib/page-builder`
 * because BE packages — the Drizzle schema (`@codex/database`) and the resolver
 * (`@codex/access`) — cannot import an apps/web `$lib` module. `$lib/page-builder`
 * re-exports everything here so the FE still imports one inert surface (the same
 * shape as `$lib/utils/subdomain` re-exporting `@codex/urls`).
 *
 * TYPES ONLY — no runtime, no DB, no resolver implementation. Grounded in
 * `docs/design/course-journeys/SPEC.md` §4/§6 + `HARDENING.md` §G, verified against
 * the live brand-editor precedents this build clones.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Page model (D1 — SPEC §4 + §4.1)
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle status shared by `landing_pages` and `courses` (SPEC §4 / §5). */
export type PageStatus = 'draft' | 'published' | 'archived';

/**
 * Section types shipped by the course-page template (SPEC §4.1 — the prototype's
 * section set). The renderer maps a KNOWN type → Svelte component and SKIPS
 * unknown types (forward-compatible), so the stored {@link PageSection.type} is a
 * widenable `string`, not this union — this catalogue constrains only what the
 * BUILDER may add and what the default template ships. A future page type
 * (retreat, …) registers its own section-type set.
 */
export type CourseSectionType =
  | 'hero'
  | 'introVideo'
  | 'ache'
  | 'turn'
  | 'reel'
  | 'map'
  | 'feel'
  | 'proof'
  | 'guide'
  | 'faq'
  | 'invite';

/**
 * Per-section config bag — section-type-specific copy/props (headline, mediaId,
 * testimonial ids, …). The exact PER-TYPE prop schema is owned by the WP-3
 * renderer + WP-5 editor; the frozen contract fixes only the envelope.
 */
export type SectionProps = Record<string, unknown>;

/**
 * One composable section INSTANCE (SPEC §4.1). Order is array position;
 * on/off is {@link PageSection.enabled}; copy/config is {@link PageSection.props}.
 * `type` is a widenable `string` (not {@link CourseSectionType}) so the renderer
 * can skip an unknown section type without a decode error (forward-compatible).
 */
export interface PageSection {
  readonly id: string;
  type: string;
  enabled: boolean;
  /**
   * Which composition of {@link PageSection.type} the renderer draws (SPEC §4.1 —
   * "options per component"). OPTIONAL + widenable `string`: the renderer/catalog
   * supplies a per-type default when unset, and an unknown variant falls back to
   * the type's default composition (forward-compatible, like {@link PageSection.type}).
   */
  variant?: string;
  /**
   * Optional builder display label for the outline row + inspector title (e.g.
   * "Hero", "Hero copy" for a duplicate). Unset → the type's catalogue label.
   * Purely editorial; the public renderer ignores it.
   */
  name?: string;
  props: SectionProps;
}

/**
 * Per-page brand overrides (D6 — "inherit by default, override per-page").
 * Structurally MIRRORS the brand-editor's editable state
 * (`apps/web/src/lib/brand-editor/types.ts` `BrandEditorState`) so the page
 * builder reuses the same colour/token controls; every field is optional — an
 * unset field inherits the org brand.
 *
 * Kept a STANDALONE structural type (deliberately NOT `Partial<BrandEditorState>`)
 * so this cross-worker contract carries no apps/web `$lib` dependency. It is an
 * EXACT structural mirror of the brand editor's editable state, every field made
 * optional (D6). The mirror is enforced at COMPILE TIME, not by convention: see
 * the drift guard in `apps/web/src/lib/page-builder/brand-overrides-guard.ts`,
 * which fails `pnpm typecheck` if this type and `BrandEditorState` diverge on any
 * shared key. **A future edit to either type must keep them structurally equal.**
 * Backs `landing_pages.brandOverrides` jsonb `$type<BrandTokenOverrides>()`.
 */
export interface BrandTokenOverrides {
  primaryColor?: string;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  fontBody?: string | null;
  fontHeading?: string | null;
  radius?: number;
  density?: number;
  logoUrl?: string | null;
  /** Per-token fine-tune overrides. null value = auto-derive from primary. */
  tokenOverrides?: Record<string, string | null>;
  /**
   * Dark-theme colour overrides. null = auto-derive from light values.
   * Structural mirror of the brand editor's `Partial<ThemeColors> | null`.
   */
  darkOverrides?: {
    primaryColor?: string;
    secondaryColor?: string | null;
    accentColor?: string | null;
    backgroundColor?: string | null;
  } | null;
  /** Dark-theme fine-tune overrides (parallel to tokenOverrides). */
  darkTokenOverrides?: Record<string, string | null> | null;
  heroLayout?: string;
}

/**
 * The page-builder DOCUMENT MODEL — the editable draft a builder session mutates
 * and the {@link PagePreviewMessage} preview payload streams to the framed page
 * (SPEC §4 / §9). Analogue of the brand editor's `BrandEditorState`: it holds the
 * EDITABLE page fields only — the persisted row's `id` / `organizationId` /
 * `creatorId` / timestamps live on the row, not the draft. The builder store
 * (WP-5) wraps this in a `saved` / `pending` runes spine cloned from
 * `brand-editor-store.svelte.ts`.
 */
export interface PageBuilderState {
  /** 'course' now; 'retreat' etc. later (D1). */
  pageType: string;
  slug: string;
  title: string;
  status: PageStatus;
  /** 'course' → the domain object this page presents (polymorphic; §4). */
  subjectType: string | null;
  /** → `courses.id` (validated in the service layer; §4). */
  subjectId: string | null;
  brandOverrides: BrandTokenOverrides | null;
  /**
   * Page-level SEO / share metadata (optional; unset → derive from `title`).
   * Additive WP-5 editor field — the SEO builder mode writes it; the public page
   * head reads it. Backs `landing_pages.seo` jsonb.
   */
  seo?: PageSeo;
  /**
   * The page's offer summary — which ways-in are presented (optional). Additive
   * WP-5 editor field for the Pricing builder mode. The AUTHORITATIVE access rule
   * still lives on the course/content policy (SPEC §6.1); this is the page's
   * presentation of it. Backs `landing_pages.offer` jsonb.
   */
  offer?: PageOffer;
  /** Ordered, typed, toggleable (§4.1). */
  sections: PageSection[];
}

/** Page-level SEO / social-share metadata (D1 · WP-5 editor-additive). */
export interface PageSeo {
  /** Meta title; unset → the page `title`. */
  title?: string;
  description?: string;
  /** → a media item id for the 1200×630 share image. */
  shareImageId?: string | null;
}

/**
 * The page's presentation of the journey's ways-in (D1 · WP-5 editor-additive).
 * NOT the source of truth for access — that is the per-content
 * {@link ContentAccessPolicy} + tiers (SPEC §6.1); this only drives what the
 * sales page shows. Prices are pence, GBP.
 */
export interface PageOffer {
  tiersEnabled?: boolean;
  subscriptionEnabled?: boolean;
  subscriptionPriceCents?: number | null;
  oneOffEnabled?: boolean;
  oneOffPriceCents?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Access & entitlements (D2 — SPEC §6, the greenfield core)
// ─────────────────────────────────────────────────────────────────────────────

/** What an entitlement grants a right OVER (SPEC §6.2). Extensible: 'page' | 'bundle'. */
export type ResourceType = 'content' | 'course';

/**
 * The source of a STORED entitlement grant row (SPEC §6.2). These are the only
 * values ever inserted; use this union for the DB write-path CHECK.
 */
export type StoredEntitlementSource =
  | 'content_purchase'
  | 'course_purchase'
  | 'course_subscription'
  | 'grant';

/**
 * Every source the RESOLVER may report, including the derived one.
 *
 * `tier_subscription` is RESOLVER-OUTPUT-ONLY (SPEC §6.2 [H]): tier access is
 * DERIVED live from the user's active `subscriptions` row + the tier→resource
 * mappings, never materialised as a row — so tier changes take effect instantly
 * and can't strand a stale grant. Keep `tier_subscription` OUT of any DB
 * write-path CHECK; it appears only in resolver output. Persisted rows are typed
 * {@link StoredEntitlementSource}.
 */
export type EntitlementSource = StoredEntitlementSource | 'tier_subscription';

/**
 * Per-content access POLICY (SPEC §6.1) — separable, non-exclusive flags that
 * REPLACE the single `content.accessType` enum. Stored on `content` (WP-1),
 * read by the resolver (WP-2).
 *
 * `courseOnly=true` suppresses EVERY standalone path regardless of the other
 * flags — the content is reachable ONLY via a course entitlement.
 * `isFree` / `isPurchasable` / `includedInTierId` may combine freely.
 *
 * The legacy `accessType` CHECK maps (HARDENING §H2): `free`→`isFree`,
 * `paid`→`isPurchasable`, `subscribers`→`includedInTierId`,
 * `followers`→`isFollowerGated`, `team`→`isTeamOnly`.
 */
export interface ContentAccessPolicy {
  isFree: boolean;
  /** Paired with {@link ContentAccessPolicy.priceCents} for a one-off content purchase. */
  isPurchasable: boolean;
  priceCents: number | null;
  /** Included in this org tier AND ABOVE (by `subscription_tiers.sortOrder`). */
  includedInTierId: string | null;
  courseOnly: boolean;
  /** [H2] Free to org followers / opt-in (was accessType 'followers'). */
  isFollowerGated: boolean;
  /** [H2] Management/staff-only (was accessType 'team'); also covered by the resolver role-bypass. */
  isTeamOnly: boolean;
}

/**
 * A granted right (SPEC §6.2 — the `entitlements` grant record).
 *
 * `userId` is TEXT, not uuid ([H] — `users.id` is `text('id')`). A STORED row
 * carries a {@link StoredEntitlementSource}; the resolver may synthesise a
 * DERIVED `tier_subscription` grant that is never persisted (see
 * {@link EntitlementSource}).
 */
export interface Entitlement {
  id: string;
  /** TEXT — `users.id` is `text('id')`, not uuid ([H]). */
  userId: string;
  organizationId: string;
  resourceType: ResourceType;
  resourceId: string;
  source: EntitlementSource;
  /** purchase id / subscription id / course_subscription id. */
  sourceRef: string | null;
  /** ISO-8601 timestamp. */
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * The two-question access resolver (SPEC §6.3). WP-2 IMPLEMENTS this interface in
 * `@codex/access` (co-located with `getStreamingUrl`, which gates on `canView`);
 * WP-0 freezes only the SIGNATURE. The implementation folds in the arms the SPEC
 * pseudocode omits but live code requires (HARDENING §B.6): the management-role
 * bypass (owner/admin/creator see all org content) and the orgless-content-with-
 * tier fail-closed deny.
 *
 * `userId` is `null` for anonymous visitors (public sales pages / free content).
 * Both questions are DB-backed and authorization-sensitive → async, per-request,
 * and NEVER cross-user cached (SPEC §12 / `cache/CLAUDE.md`).
 *
 *   - {@link EntitlementResolver.canView} — may the user open this content
 *     ANYWHERE? Gates `getStreamingUrl`.
 *   - {@link EntitlementResolver.canEnterCourse} — may the user open this course's
 *     DASHBOARD / journey? Course-scoped, so shared content never leaks course
 *     access.
 *
 * The `?notenrolled` surface state (SPEC §6.3 / §14.2) is
 * `canView && !canEnterCourse` — computed by the caller from the two answers, so
 * no third method is needed.
 *
 * {@link EntitlementResolver.canEnterCoursesBatch} resolves MANY courses in ONE
 * query — REQUIRED for a dashboard/library grid to avoid N+1 on Neon HTTP
 * (HARDENING §D / §E / §12).
 */
export interface EntitlementResolver {
  canView(userId: string | null, contentId: string): Promise<boolean>;
  canEnterCourse(userId: string | null, courseId: string): Promise<boolean>;
  canEnterCoursesBatch(
    userId: string | null,
    courseIds: readonly string[]
  ): Promise<ReadonlyMap<string, boolean>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monetization — the course offer (SPEC §7, owned by WP-6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One of the three ways a course can be acquired (SPEC §7). Discriminates the
 * pricing panel on the sales-page builder and the offer surface on the course
 * landing page.
 *
 *   - `purchase`       — one-off, permanent (`courses.priceCents`).
 *   - `subscription`   — course-specific recurring (`course_subscription_plans`).
 *   - `tier`           — included in one or more org subscription tiers
 *                        (`course_tier_access`, exact tier match, not min-tier).
 */
export type CourseAccessPath = 'purchase' | 'subscription' | 'tier';

/** One org tier that unlocks a course (SPEC §7 tier-access path). */
export interface CourseTierOffer {
  tierId: string;
  tierName: string;
  /** Lowest active price across intervals, in GBP pence — for "from £X" copy. */
  priceMonthly: number;
  priceAnnual: number;
}

/**
 * The complete monetization offer for one course (SPEC §7) — every acquisition
 * path a viewer can take, plus whether they ALREADY hold access. Returned by the
 * offer read (WP-6), consumed by the sales page + course landing.
 *
 * A path is present in `paths` only when it is actually purchasable/enterable
 * (published course + configured price/plan/tier). `entitled=true` means the
 * viewer already holds a live entitlement (any source) and should see "enter"
 * rather than "buy". Amounts are GBP integer pence.
 */
export interface CourseOffer {
  courseId: string;
  organizationId: string;
  /** Ordered subset of the three paths, only those currently available. */
  paths: CourseAccessPath[];
  /** One-off purchase, when `courses.priceCents` is set. */
  purchase: { priceCents: number } | null;
  /** Course-specific subscription, when an active plan exists. */
  subscription: {
    planId: string;
    priceMonthly: number;
    priceAnnual: number;
  } | null;
  /** Org tiers that include this course (exact grants). */
  tiers: CourseTierOffer[];
  /** True when the viewer already holds a live entitlement over the course. */
  entitled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Member surfaces — dashboard + in-course player (SPEC §11 / §14, owned by WP-4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The FE-facing projections the course DASHBOARD and IN-COURSE PLAYER consume
 * (SPEC §11 / §14) — NOT the raw Drizzle rows. Round-D (Codex-776gg) wires the
 * web→worker plumbing that produces these: `CourseJourneyService` (@codex/access)
 * returns them, the content-api journey routes serialise them, and the web
 * `api.access.*` client hands them to the FE unchanged.
 *
 * These are the CONTRACT-HOME copies of the shapes authored for the WP-4 mock in
 * `apps/web/src/lib/journeys/types.ts`. That FE module is a universal ($lib) type
 * bag the components/store/seam import directly; this cross-worker mirror lets the
 * BE packages — which cannot import an apps/web `$lib` module — produce the exact
 * same shapes. The two are STRUCTURALLY IDENTICAL by design (a future edit to
 * either must keep them equal), so the Phase-2 seam swap is a no-op for callers.
 */

/**
 * Practice content type (SPEC §14.3). Drives the D-E completion boundary:
 * `video`/`audio` auto-complete on genuine 100% finish; `written` is an explicit
 * "Mark complete". Mirrors `content.contentType`.
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
 * The PUBLISHED course(s) that include a given content item as a practice —
 * resolved via `stage_practices → course_stages → courses` (Codex-2pryk.3.10,
 * standalone content viewer). Powers the journey cross-link on the standalone
 * content page: the breadcrumb signpost (F19), the "part of a journey" context,
 * and the free-content upsell (F20).
 *
 * Fully PUBLIC read — scoped to PUBLISHED, non-deleted courses (via non-deleted
 * stages), so it never leaks a draft/archived course. `courses` is empty when
 * the item belongs to no published course (→ the cross-link is omitted
 * gracefully). A content item can sit in more than one course; the FE renders
 * the primary (first) one.
 */
export interface ContentCourseLinks {
  courses: JourneyCourseSummary[];
}

/**
 * A published course as it surfaces in DISCOVERY — the /explore "Journeys" rail
 * (SPEC §8.5). The minimal PUBLIC projection needed to render a journey card and
 * link to its sales page: no curriculum, no entitlement, no signed media. Same
 * public-chrome surface as {@link JourneyCoursePage} (NO `canView`; HARDENING §E
 * course-sell row), just the list shape. Returned by
 * `CourseJourneyService.listPublishedCourses`.
 */
export interface CourseCardSummary {
  id: string;
  /** Org-scoped COURSE slug (`courses.slug`) — not the sales-page URL basis. */
  slug: string;
  title: string;
  /** Eyebrow line above the title (`courses.kicker`), or null. */
  kicker: string | null;
  /** Short tagline / lede (`courses.lede`), or null. */
  lede: string | null;
  /** The guide's display name (`courses.guide.name`), or null. */
  guideName: string | null;
  /** One-off purchase price in GBP pence (`courses.priceCents`); null = not sold standalone. */
  priceCents: number | null;
  /**
   * The published landing page that SELLS this course (`landing_pages.id`), or
   * null when none was found. The sales-page URL basis is the PAGE
   * (`/journeys/{pageSlug}` resolves `landing_pages.slug`), so link builders MUST
   * prefer these over `slug`/`id` — linking by the course slug is what made
   * /explore and the org-landing rail resolve to different URLs (Codex-xzwl5).
   */
  pageId: string | null;
  /** Org-scoped PAGE slug — the sales-page URL basis (`/journeys/{pageSlug}`). */
  pageSlug: string | null;
  /**
   * Public CDN URL for the course cover (`courses.coverImageKey` → `md.webp`),
   * or null when the creator has not uploaded one. Never the raw R2 key. The
   * card MUST render its typographic fallback on null (Codex-eqh0z).
   */
  coverImageUrl: string | null;
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
 * SOURCE OF TRUTH for course progress (SPEC §11 / D-E).
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

// ─────────────────────────────────────────────────────────────────────────────
// Member library "Your journeys" shelf (SPEC §8.4 — the WP-11 enrolled-courses read)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-course progress rollup for the member library "Your journeys" shelf
 * (SPEC §8.4 / §11). The SAME `practice_completions ⋈ stage_practices` rollup the
 * dashboard computes, summarised to the numbers a journey card renders.
 */
export interface EnrolledCourseProgress {
  /** Completed practices across the whole course. */
  done: number;
  /** Total published practices in the course. */
  total: number;
  /** Integer 0–100; `0` when the course has no practices. */
  percent: number;
  /**
   * Card status: no practices done (or none exist) → `not-started`; every
   * practice done → `completed`; otherwise `in-progress`.
   */
  status: 'not-started' | 'in-progress' | 'completed';
  /** Most recent completion timestamp (ISO), or `null` when nothing is done. */
  lastCompletedAt: string | null;
  /**
   * First incomplete practice in course order (stage → practice sortOrder) — the
   * "Continue" / resume target. `null` when the course is complete or empty.
   */
  nextPracticeSlug: string | null;
  /** Title of {@link nextPracticeSlug} — the "Next · …" resume label. */
  nextPracticeTitle: string | null;
}

/**
 * One enrolled course as the member LIBRARY "Your journeys" shelf reads it
 * (SPEC §8.4): the course chrome, the caller's enrollment, the enrollment
 * `source` (drives the access-source badge), and the progress rollup. Returned by
 * `CourseJourneyService.listEnrolledCourses`, STRICTLY scoped to
 * `(userId, organizationId)` — never another user's enrollments.
 */
export interface EnrolledCourseSummary {
  course: {
    id: string;
    slug: string | null;
    title: string;
    organizationSlug: string | null;
    kicker: string | null;
    lede: string | null;
    /** The course guide's display name (`courses.guide.name`), or `null`. */
    guideName: string | null;
    /**
     * Public CDN URL for the course cover (`courses.coverImageKey` resolved
     * against `R2_PUBLIC_URL_BASE`), or `null` when the creator uploaded none or
     * the worker has no configured CDN base. Never a raw R2 key.
     *
     * Added by Codex-tnwnu: the library's journey cards had no cover field at
     * all, so they were the only journey surface structurally unable to render a
     * photo and were permanently stuck on the typographic fallback.
     */
    coverImageUrl: string | null;
  };
  enrollment: JourneyEnrollment;
  /**
   * The `course_enrollments.source` (e.g. `course_purchase`, `course_subscription`,
   * `tier_subscription`, `first_access`) — mapped to the card's access badge.
   */
  enrollmentSource: string;
  progress: EnrolledCourseProgress;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public sales-page read-model (SPEC §4/§5/§10 — the WP-3 course-sell surface)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cross-worker mirror of the FE public sales read-model
 * (`apps/web/src/lib/page-builder/journey-queries.ts`). The content-api produces
 * these shapes; the FE `$lib/page-builder` types are the structurally-identical
 * mirror the renderer consumes (BE packages cannot import an apps/web `$lib`
 * type — same dual-home pattern as {@link JourneyCourseSummary} ↔
 * `$lib/journeys/types`). Additive-only against the WP-0 freeze; a change here
 * MUST keep the FE mirror structurally equal.
 */

/** One practice on the PUBLIC sales page — no completion/media (public shell). */
export interface JourneyPracticeView {
  contentId: string;
  slug: string | null;
  title: string;
  contentType: PracticeContentType;
  sortOrder: number;
  /** Completion — dashboard / in-course only; omitted on the public sales page. */
  completed?: boolean;
}

/** An ordered stage with its practice pool, as the public sales page reads it. */
export interface JourneyStageView {
  id: string;
  name: string;
  gloss: string | null;
  sortOrder: number;
  practices: JourneyPracticeView[];
}

/** The course chrome + rollups shown on the sales page (SPEC §5). */
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

/** One testimonial rendered by the `proof` section. */
export interface JourneyTestimonialView {
  id: string;
  quote: string;
  authorName: string;
  authorContext: string | null;
  sortOrder: number;
}

/** A persisted landing page = the editable {@link PageBuilderState} + row identity. */
export interface JourneyPageRecord extends PageBuilderState {
  id: string;
  organizationId: string;
  publishedAt: string | null;
}

/**
 * A studio-index row (Codex-isr02 · creator management view). One journey/page a
 * creator owns, with `live` course rollups. Mirrors the FE-frozen `JourneyListItem`
 * (`apps/web/.../page-builder/journey-queries.ts`) — the same parallel-def pattern
 * `JourneyPageRecord` uses, since BE packages cannot import an apps/web module.
 * Course-only rollups are `null` for a plain (non-course) landing page.
 */
export interface JourneyListItem {
  id: string;
  pageType: string;
  subjectType: string | null;
  slug: string;
  title: string;
  status: PageStatus;
  tagline: string | null;
  stageCount: number | null;
  practiceCount: number | null;
  enrolledCount: number | null;
  /** `live` provenance (completed one-off purchases for the subject course). */
  revenueCents: number | null;
  /**
   * Creator-flagged for the org-homepage "featured" rail (`landing_pages.featured`
   * — the same column {@link JourneyCardView.featured} carries on the public side).
   * Surfaced on the studio index so the featured toggle can render its CURRENT
   * state; without it the control would have to guess, and every studio render
   * would show an un-featured portal as off.
   *
   * Orthogonal to `status`: `listPublishedJourneys` filters `status = 'published'`
   * independently, so a featured DRAFT is a harmless stored intent with no public
   * effect until the page publishes.
   */
  featured: boolean;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDIO curriculum-editor read-model (Codex-03cwh — admin two-pane editor)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One practice as the STUDIO CURRICULUM EDITOR reads it — a SUPERSET of the
 * public {@link JourneyPracticeView}. A practice IS a join to a `content` row
 * (`stage_practices.contentId`), so the editor inspector's media-slot needs the
 * linked content's picker metadata (title/type/thumbnail/publish status) that
 * the public sales view deliberately omits. Additive against the WP-0 freeze; the
 * FE mirror in `apps/web/src/lib/page-builder/journey-queries.ts` MUST stay
 * structurally equal.
 */
export interface EditorPracticeView {
  /** The linked `content` row id (the join's `contentId`). */
  contentId: string;
  /** Public slug of the linked content; null when unslugged. */
  slug: string | null;
  /** Linked content title — the media-slot label + tree row text. */
  title: string;
  contentType: PracticeContentType;
  /** Publish status of the LINKED CONTENT (draft ⇒ not yet member-visible). */
  status: PageStatus;
  /** Poster/thumbnail for the media-slot; null when the content has none. */
  thumbnailUrl: string | null;
  /**
   * Runtime of the linked media, or `null` for a written practice / media with no
   * probed duration. Drives the builder map's "≈ N min in all" cue, which read a
   * flat 0 while this field was absent — an under-claim on every course.
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

/**
 * The full admin curriculum payload the studio editor loads for one course:
 * ordered non-deleted stages, each with its ordered practices + picker metadata.
 * The content-library PICKER options are read separately (the reused org
 * content-list endpoint) — this payload is only the CURRENT curriculum.
 */
export interface EditorCurriculum {
  courseId: string;
  stages: EditorStageView[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Member-facing DISCOVERY read-model (Codex-oi2w4 — home / explore / library)
// ─────────────────────────────────────────────────────────────────────────────

/** Progress state of an enrolled journey (library shelf + continue rail). */
export type JourneyProgressStatus = 'not-started' | 'in-progress' | 'completed';

/**
 * A journey as a PUBLIC discovery card (Codex-oi2w4 — the org home "featured
 * journeys" rail + the Explore grid). A PUBLISHED, course-type landing page
 * joined to its PUBLISHED subject course, plus the member-visible curriculum
 * rollups. Fully PUBLIC: carries no per-user state and no `canView`. Mirrored
 * FE-side in `apps/web/.../page-builder/journey-queries.ts` (structurally
 * identical by design — the same dual-home pattern as {@link JourneyListItem}).
 */
export interface JourneyCardView {
  /** The landing-page (journey portal) id. */
  pageId: string;
  /** Org-scoped landing-page slug → the public sell page (`/journeys/:slug`). */
  slug: string;
  title: string;
  /** Course eyebrow above the title (e.g. "Foundation course"). */
  kicker: string | null;
  /** Course lede — the one-line invitation under the title. */
  tagline: string | null;
  /** Subject course id + slug (build the dashboard / enrol URL). */
  courseId: string;
  courseSlug: string;
  /** One-off purchase price in GBP pence; null = membership-only / not sold standalone. */
  priceCents: number | null;
  stageCount: number;
  /** MEMBER-visible (published, non-deleted) practice count — matches the sell page. */
  practiceCount: number;
  /** Creator-flagged for the home "featured" rail (`landing_pages.featured`). */
  featured: boolean;
  /**
   * Public CDN URL for the course cover (`courses.coverImageKey` → `md.webp`),
   * or null when the creator has not uploaded one. Never the raw R2 key. The
   * card MUST render its typographic fallback on null (Codex-eqh0z).
   */
  coverImageUrl: string | null;
}

/**
 * The journey's SELL MEDIA — the four media refs the sales page's `introVideo`,
 * `reel` and `guide` sections resolve their primary content from, plus the still
 * cover (Codex-eqh0z). All five are creator-owned and independently clearable.
 *
 * The three video ids and the guide portrait are `media_items` refs (they reuse
 * the transcoding pipeline; SPEC §10). The cover is NOT a `media_items` ref —
 * `media_items` is CHECK-constrained to ('video','audio'), so a still image
 * cannot live there; it is an R2 key on `courses`, resolved to a CDN URL here.
 */
export interface JourneySellMedia {
  /** The subject course these refs live on (`landing_pages.subjectId`). */
  courseId: string;
  /** 30s intro film — the `introVideo` section's clip. */
  introVideoMediaId: string | null;
  /** Practice reel — the `reel` section's clip. */
  previewVideoMediaId: string | null;
  /** The guide's talking-head clip. */
  guideVideoMediaId: string | null;
  /** The guide's portrait still (`courses.guide.portraitMediaId`). */
  guidePortraitMediaId: string | null;
  /** Cover CDN URL (`md.webp`), or null when no cover is uploaded. */
  coverImageUrl: string | null;
}

/**
 * A journey the CURRENT USER is enrolled in (Codex-oi2w4 — the library "Your
 * journeys" shelf + "Jump back in" continue rail). The discovery card plus the
 * user's progress rollup and status. Per-user: the route reads `userId` from the
 * session, never the client. `percent`/`completedPractices` are scoped to the
 * SAME published curriculum as {@link JourneyCardView.practiceCount}, so the
 * numerator can never exceed the denominator.
 */
export interface EnrolledJourneyCard extends JourneyCardView {
  /** Completed practices (from `practice_completions`) for this user. */
  completedPractices: number;
  /** Total published, non-deleted practices in the course. */
  totalPractices: number;
  /** 0–100, integer; 0 when the course has no published practices yet. */
  percent: number;
  status: JourneyProgressStatus;
  enrolledAt: string;
  lastActivityAt: string | null;
  /** Stamped when the enrollment is complete (drives the `completed` status). */
  completedAt: string | null;
}

/** Public sales/landing page envelope (SSR shell+stream). No `canView` on the shell. */
export interface JourneyCoursePage {
  page: JourneyPageRecord;
  course: JourneyCourseView;
  stages: JourneyStageView[];
  testimonials: JourneyTestimonialView[];
}

/**
 * One public preview clip (SPEC §10). The sales page shows the existing 30s
 * `preview.m3u8` — resolved from `mediaItems.hlsPreviewKey` to a public CDN URL,
 * NO signing, NO `canView` (HARDENING §E course-sell row). Structurally mirrors
 * the FE `PreviewMedia` (`$lib/page-builder/render`).
 */
export interface CourseSellPreviewClip {
  /** HLS manifest URL for the 30s public preview clip. */
  playlistUrl: string;
  /** Optional decorative poster shown before play. */
  posterUrl: string | null;
  /** Advisory duration (seconds) for a "N sec preview" affordance. */
  durationSeconds: number | null;
}

/**
 * The STREAMED sell-preview payload of the sales page: the public intro-film and
 * reel clips. Either clip is null when the course has no such media (or its
 * preview has not transcoded). Mirrors the FE `SellPreview`.
 */
export interface CourseSellPreview {
  /** The intro-film clip (the `introVideo` section → `courses.introVideoMediaId`). */
  intro: CourseSellPreviewClip | null;
  /** The practice-preview clip (the `reel` section → `courses.previewVideoMediaId`). */
  reel: CourseSellPreviewClip | null;
}
