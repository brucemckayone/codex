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
  /** Ordered, typed, toggleable (§4.1). */
  sections: PageSection[];
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
