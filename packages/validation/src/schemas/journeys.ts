import type { BrandTokenOverrides } from '@codex/shared-types';
import { z } from 'zod';
import { createSlugSchema, priceCentsSchema, uuidSchema } from '../primitives';

/**
 * Journey member-surface route inputs (Codex-2pryk · Round-D · Codex-776gg).
 *
 * The validated inputs for the content-api journey routes the Round-D seam
 * calls (SPEC §11 / §14):
 *   - `/api/access/courses/:courseId/can-enter`      → {@link canEnterCourseParamsSchema}
 *   - `/api/access/content/:contentId/can-view`      → {@link canViewParamsSchema}
 *   - `/api/journeys/content/:contentId/courses`     → {@link contentCoursesParamsSchema}
 *   - `/api/journeys/courses/by-slug`                → {@link courseBySlugQuerySchema}
 *   - `/api/journeys/courses/:courseId/dashboard`    → {@link courseParamsSchema}
 *   - `/api/journeys/courses/:courseId/practices/:contentSlug`
 *                                                    → {@link inCoursePracticeParamsSchema}
 *   - `/api/journeys/practices/completions` (POST)   → {@link recordCompletionBodySchema}
 *
 * Params use explicit ids (`courseId` / `contentId`) rather than a bare `:id`
 * so the `procedure()` org resolver never mistakes them for an org id
 * (feedback_procedure_resolver_id_param). Slug bounds mirror the schema columns
 * (`courses.slug` varchar(160), `content.slug` varchar(500)).
 */

/** `courseId` path param (uuid) — course dashboard + can-enter routes. */
export const courseParamsSchema = z.object({
  courseId: uuidSchema,
});
export type CourseParams = z.infer<typeof courseParamsSchema>;

/** `courseId` path param for the can-enter entitlement gate. */
export const canEnterCourseParamsSchema = courseParamsSchema;
export type CanEnterCourseParams = z.infer<typeof canEnterCourseParamsSchema>;

/** `contentId` path param (uuid) — can-view entitlement check. */
export const canViewParamsSchema = z.object({
  contentId: uuidSchema,
});
export type CanViewParams = z.infer<typeof canViewParamsSchema>;

/**
 * `contentId` path param (uuid) — the PUBLIC "which published course(s) contain
 * this content" cross-link read (Codex-2pryk.3.10, standalone content viewer).
 */
export const contentCoursesParamsSchema = z.object({
  contentId: uuidSchema,
});
export type ContentCoursesParams = z.infer<typeof contentCoursesParamsSchema>;

/** `(organizationId, slug)` query — resolve a course summary by its slug. */
export const courseBySlugQuerySchema = z.object({
  organizationId: uuidSchema,
  slug: createSlugSchema(160),
});
export type CourseBySlugQuery = z.infer<typeof courseBySlugQuerySchema>;

/**
 * `organizationId` query — list an org's PUBLISHED courses for the /explore
 * discovery rail (`GET /api/journeys/courses`). Fully public; the org id is the
 * only scope. No pagination: an org's published-course count is small and the
 * rail renders them all.
 */
export const listPublishedCoursesQuerySchema = z.object({
  organizationId: uuidSchema,
});
export type ListPublishedCoursesQuery = z.infer<
  typeof listPublishedCoursesQuerySchema
>;

/**
 * `organizationId` query — list the caller's enrolled courses in ONE org for the
 * member library "Your journeys" shelf. The user is derived from the session,
 * NEVER a query param (IDOR); `organizationId` only narrows the scope.
 */
export const userEnrollmentsQuerySchema = z.object({
  organizationId: uuidSchema,
});
export type UserEnrollmentsQuery = z.infer<typeof userEnrollmentsQuerySchema>;

/** `(courseId, contentSlug)` path params — resolve one in-course practice. */
export const inCoursePracticeParamsSchema = z.object({
  courseId: uuidSchema,
  contentSlug: createSlugSchema(500),
});
export type InCoursePracticeParams = z.infer<
  typeof inCoursePracticeParamsSchema
>;

/**
 * Mark-complete body. `source` mirrors the `practice_completions.source` CHECK
 * (`'auto'` for a 100%-finish media signal, `'manual'` for an explicit
 * mark-complete / written practice).
 */
export const recordCompletionBodySchema = z.object({
  contentId: uuidSchema,
  source: z.enum(['auto', 'manual']),
});
export type RecordCompletionBody = z.infer<typeof recordCompletionBodySchema>;

/**
 * Public journey DISCOVERY list query (Codex-oi2w4) —
 * `GET /api/journeys/published`. Fully PUBLIC (`auth: 'optional'`): lists
 * PUBLISHED course-journeys for the org home "featured" rail + the Explore grid.
 * `organizationId` is resolved web-side from the request host and passed here
 * (same as the sales-page reads). `featured` (accepted only as the literal
 * `'true'`, so no boolean-coercion ambiguity) narrows to the creator-featured
 * rail; `limit` caps the page size (1–50).
 */
export const listPublishedJourneysQuerySchema = z.object({
  organizationId: uuidSchema,
  featured: z.literal('true').optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ListPublishedJourneysQuery = z.infer<
  typeof listPublishedJourneysQuerySchema
>;

/**
 * Studio journey-insights query (Codex-2pryk · Round-D · Codex-776gg · WP-7) —
 * `GET /api/journeys/insights`. Owner/admin only via `requireOrgManagement`.
 *
 * `organizationId` is consumed ONLY by the `procedure()` org resolver; the route
 * re-derives the authoritative scope from `ctx.organizationId` (session
 * membership) and never trusts this value for authorization. `period` selects
 * the reporting window (defaults to 30 days).
 *
 * The journey key is the LANDING-PAGE id, not the course id (Codex-xo3bl). Every
 * studio journey surface addresses a journey by its landing-page id — that is
 * what `/studio/journeys/[id]/…` carries and what `listJourneys` returns — so
 * the route resolves `pageId → courses.id` via `resolveCourseIdForPage` before
 * the course-keyed aggregation runs, exactly as the curriculum routes do. This
 * field previously read `courseId`, and the client dutifully sent the page id
 * into a `courses.id` lookup: every insights request 404'd as
 * `NotFoundError('Course not found')`. Both are UUIDs, so no validation caught
 * it — the ONLY guard against re-confusing them is the parameter name.
 */
export const journeyInsightsQuerySchema = z.object({
  organizationId: uuidSchema,
  pageId: uuidSchema,
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});
export type JourneyInsightsQuery = z.infer<typeof journeyInsightsQuerySchema>;

/**
 * Studio index BATCH-revenue query (Codex-9p47t) — `GET
 * /api/journeys/insights/org-revenue`. Owner/admin only via
 * `requireOrgManagement`. Returns authoritative gross revenue per journey keyed
 * by landing-page id (the figure `listJourneysForOrg` omits to avoid drift).
 * `organizationId` is consumed ONLY by the `procedure()` org resolver; the route
 * re-derives the authoritative scope from `ctx.organizationId`. No `courseId` —
 * this is org-wide. `period` defaults to 30 days (matching the badge label).
 */
export const orgJourneyRevenueQuerySchema = z.object({
  organizationId: uuidSchema,
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});
export type OrgJourneyRevenueQuery = z.infer<
  typeof orgJourneyRevenueQuerySchema
>;

/**
 * ── CREATOR / STUDIO management inputs (Codex-isr02 · page-builder write path) ──
 *
 * All creator routes are `requireOrgManagement`; `organizationId` is consumed
 * ONLY by the `procedure()` org resolver (which validates the caller manages it),
 * and the handler forwards `ctx.organizationId` — never these client values — for
 * scoping. Included here purely so the resolver can pick the org off the query.
 */

/** Page status enum, mirrors the `landing_pages`/`courses` status CHECK. */
export const journeyPageStatusSchema = z.enum([
  'draft',
  'published',
  'archived',
]);

/** Org-only query — create (POST) + get-for-builder (GET) org resolution. */
export const journeyOrgQuerySchema = z.object({
  organizationId: uuidSchema,
});
export type JourneyOrgQuery = z.infer<typeof journeyOrgQuerySchema>;

/** Studio index list query — org + optional status filter. */
export const journeyStudioListQuerySchema = z.object({
  organizationId: uuidSchema,
  status: journeyPageStatusSchema.optional(),
});
export type JourneyStudioListQuery = z.infer<
  typeof journeyStudioListQuerySchema
>;

/** `:pageId` path param (uuid) — get-for-builder + save routes. Explicit id name
 * (not `:id`) so the org resolver never mistakes it for an org id
 * (feedback_procedure_resolver_id_param). */
export const journeyPageParamsSchema = z.object({
  pageId: uuidSchema,
});
export type JourneyPageParams = z.infer<typeof journeyPageParamsSchema>;

/** Create-journey body — title + page type. Org comes from the resolver. */
export const createJourneyBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  pageType: z.enum(['course', 'landing']),
});
export type CreateJourneyBody = z.infer<typeof createJourneyBodySchema>;

/**
 * One design AXIS: a CLOSED enum that DEGRADES instead of rejecting.
 *
 * `.optional().catch(undefined)` is the whole point. A future client sending an
 * axis value this deployment does not know must not fail the entire page save —
 * losing every other edit on the page to one unrecognised enum member would be a
 * far worse outcome than dropping that one value. The unknown value is stripped to
 * `undefined`, `resolveDesign` then falls back to the axis default, and the
 * creator sees the section render normally rather than a 400 they cannot explain.
 *
 * The alternative — leaving the axes unvalidated — is what `z.custom` gave us: an
 * arbitrary string reaching `resolveDesign` and being emitted as a `data-jp-*`
 * attribute value that matches no CSS rule, so the section silently renders with
 * defaults and the creator sees a control that appears to do nothing.
 */
const designAxis = <const T extends readonly [string, ...string[]]>(
  values: T
) => z.enum(values).optional().catch(undefined);

/**
 * The nine design axes (`docs/design/journey-sections/02-axis-contract.md` A5).
 * Mirrors `SectionDesign` in `@codex/shared-types`; unknown KEYS are stripped by
 * `z.object`'s default behaviour and unknown VALUES by the per-axis `.catch`.
 */
export const sectionDesignSchema = z.object({
  width: designAxis(['narrow', 'text', 'wide', 'full']),
  density: designAxis(['compact', 'regular', 'airy', 'vast']),
  surface: designAxis(['bare', 'tint', 'panel', 'invert', 'media']),
  edge: designAxis(['none', 'hairline', 'soft', 'heavy', 'offset']),
  align: designAxis(['start', 'center']),
  type: designAxis(['restrained', 'balanced', 'expressive', 'monumental']),
  accent: designAxis(['text', 'fill', 'edge', 'glow', 'none']),
  motion: designAxis(['none', 'fade', 'rise', 'stagger', 'drift']),
  media: designAxis(['bleed', 'frame', 'mask', 'inset', 'none']),
});
export type SectionDesignBody = z.infer<typeof sectionDesignSchema>;

/**
 * A single page section — a REAL structural schema (contract amendment A5).
 *
 * This was `z.custom<PageSection>(v => typeof v === 'object' && v !== null)`: a
 * type assertion with a predicate, not a schema. It validated NOTHING structural,
 * so adding `design` to the TypeScript interface would have bought no validation
 * at all.
 *
 * Three fields stay deliberately LOOSE, and tightening any of them would reject
 * data the platform already stores:
 *   - `type` is an OPEN string. The renderer skips an unrecognised type rather
 *     than erroring (that is what makes a future page template additive), so the
 *     schema must accept one too.
 *   - `variant` is an OPEN string for the same reason, and concretely: the seeded
 *     `studio-alpha` page stores `variant: "default"`, which is not a declared
 *     variant of any type. An enum here would 400 a real page on save.
 *   - `props` is a PASSTHROUGH record. Its per-type shape is owned by the renderer
 *     + editor, not by this contract, and `render/coerce.ts` already treats every
 *     field as untrusted at the read boundary.
 *
 * `props` carries `.default({})` rather than being required: `.default()` only
 * widens the INPUT type while the output stays required, so the inferred body is
 * still assignable to the service input with no boundary cast — the same idiom
 * `updateJourneyOfferBodySchema` uses.
 *
 * That assignability is what replaces the old `z.custom<PageSection>` type
 * assertion, and it is CHECKED rather than asserted: the save route hands
 * `ctx.input.body` straight to `CourseJourneyService.saveJourneyPage`, whose input
 * declares `sections: PageSection[]`, so any drift between this schema and the
 * frozen contract fails `pnpm typecheck` at that call site.
 */
export const pageSectionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).max(60),
  enabled: z.boolean(),
  variant: z.string().max(60).optional(),
  name: z.string().max(200).optional(),
  design: sectionDesignSchema.optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Page-level SEO / share metadata (`PageBuilderState.seo`) — the SEO panel's
 * write, and what the public sell page's `<svelte:head>` reads for its meta
 * title + description.
 *
 * Bounds are the SEO-practical ones, not the column's: a title over ~60 chars and
 * a description over ~160 are already truncated by search engines, so 160/320
 * leaves generous room while still refusing a pasted essay. Both are
 * `.optional()` and neither carries `.min(1)` — CLEARING a field is expressed as
 * the EMPTY STRING, which must persist so the head's `||` fallbacks resume
 * deriving from the page title / course lede. Rejecting `''` would leave a
 * creator unable to undo their own override.
 *
 * `.trim()` (a transform that keeps the ZodString type) is safe here for the same
 * reason it is on `title` below; `.transform()`/`.default()` are not, per the note
 * on the body schema.
 *
 * `.strict()`, and it declares ALL THREE keys of `PageSeo` rather than only the
 * two the panel edits today. The bag ROUND-TRIPS — the builder loads it whole
 * from `getJourneyForBuilder` and sends it whole back — so a key this schema
 * dropped would be silently lost on the next save, and a key it rejected would
 * make an otherwise-valid page unsaveable. `shareImageId` therefore persists
 * already; what is missing is a CONTROL for it, and the panel says so.
 */
export const pageSeoSchema = z
  .object({
    title: z.string().trim().max(160).optional(),
    description: z.string().trim().max(320).optional(),
    shareImageId: uuidSchema.nullable().optional(),
  })
  .strict();
export type PageSeoBody = z.infer<typeof pageSeoSchema>;

/**
 * Save-journey-page body — the editable page record (frozen `JourneyPageRecord`
 * minus the server-owned `organizationId`/`publishedAt`, which the service
 * derives). `sections` is validated structurally by {@link pageSectionSchema};
 * `brandOverrides` still carries its FE type via `z.custom` so the inferred type
 * is assignable to the service input with no boundary cast.
 *
 * `.strict()` because this endpoint does NOT own the whole builder draft. The
 * pricing panel's `offer` belongs to `updateJourneyOfferBodySchema` — under Zod's
 * default strip it was accepted, discarded, and reported as "Page saved". A key
 * this endpoint cannot honour must 400.
 *
 * `seo` IS now declared (Codex-2j8nq): migration 0090 added the
 * `landing_pages.seo` jsonb column and `saveJourneyPage` writes it, so this is a
 * key the endpoint can honour. It was deliberately absent before — under
 * `.strict()` a declared-but-unpersistable field is WORSE than a rejected one,
 * because the save accepts it, discards it and reports success. That is why the
 * SEO panel's two meta fields shipped DISABLED rather than as live inputs.
 * `.optional()`, and the service treats absent as LEAVE ALONE (never as clear) —
 * see {@link pageSeoSchema} on how clearing is expressed.
 *
 * `design` (the PAGE-level look) IS now declared — F-B2 added the
 * `landing_pages.design` column, the service write and the `SavePagePayload`
 * field, so the key this endpoint accepts is a key it can honour. It stayed out of
 * F-A deliberately: under `.strict()` a declared-but-unpersistable field is worse
 * than a rejected one, because the save would accept it, discard it, and report
 * "Page saved".
 *
 * It is `.optional()` and the service treats absent as LEAVE ALONE, never as
 * clear — a client that predates the axes must not wipe a page's stored look.
 */
export const saveJourneyPageBodySchema = z
  .object({
    id: uuidSchema,
    pageType: z.string().min(1).max(30),
    // A plain (transform-free) required slug validator — NOT `createSlugSchema`,
    // whose `.transform().pipe()` makes SvelteKit's `command()` infer the field as
    // OPTIONAL, breaking assignability to the (required-slug) service input. Same
    // format rule, validated not rewritten (the builder sends an already-slugified
    // value); a malformed slug is rejected rather than silently coerced.
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must be lowercase letters, numbers and hyphens (no leading/trailing hyphen)'
      ),
    title: z.string().trim().min(1).max(500),
    status: journeyPageStatusSchema,
    subjectType: z.string().max(30).nullable(),
    subjectId: uuidSchema.nullable(),
    brandOverrides: z.custom<BrandTokenOverrides>().nullable(),
    sections: z.array(pageSectionSchema),
    design: sectionDesignSchema.optional(),
    seo: pageSeoSchema.optional(),
  })
  .strict();
export type SaveJourneyPageBody = z.infer<typeof saveJourneyPageBodySchema>;

/**
 * Journey OFFER body — the page's ways-in + their prices (`PATCH
 * /api/journeys/studio/journeys/:pageId/offer`). Prices are pence, GBP
 * (`priceCentsSchema`); `null` means "no price set".
 *
 * Deliberately `.strict()`: pricing is a commerce mutation, so an unrecognised
 * key is a client bug that must 400 rather than be silently dropped (the failure
 * mode that made the pricing panel swallow input while reporting success).
 *
 * The toggles carry `.default(false)` so the persisted bag is always TOTAL —
 * every path is explicitly on or off, never absent-and-therefore-ambiguous.
 * `.default()` only widens the INPUT type (the field becomes optional for the
 * caller) while the output stays required, so the inferred body is still
 * assignable to the service input with no boundary cast.
 *
 * The cross-field rule — an ENABLED path needs a price — lives in
 * `CourseJourneyService.updateJourneyOffer` as a typed `ValidationError`, not
 * here: it is a business invariant (an enabled-but-priceless path silently
 * collapses the checkout to "not open for enrolment"), and keeping it out of Zod
 * avoids wrapping the object in a `ZodEffects` that `command()` mis-infers.
 */
export const updateJourneyOfferBodySchema = z
  .object({
    tiersEnabled: z.boolean().default(false),
    subscriptionEnabled: z.boolean().default(false),
    subscriptionPriceCents: priceCentsSchema,
    oneOffEnabled: z.boolean().default(false),
    oneOffPriceCents: priceCentsSchema,
  })
  .strict();
export type UpdateJourneyOfferBody = z.infer<
  typeof updateJourneyOfferBodySchema
>;

/**
 * Journey SELL-MEDIA body — the four `media_items` refs the sales page's
 * `introVideo` / `reel` / `guide` sections resolve their primary content from
 * (`PATCH /api/journeys/studio/journeys/:pageId/media`; Codex-eqh0z).
 *
 * A TOTAL write, mirroring {@link updateJourneyOfferBodySchema}: every slot
 * carries `.nullable().default(null)`, so an omitted slot CLEARS rather than
 * being ambiguously absent, and the persisted row always says exactly which
 * slots are filled. This is what makes "clear a video" expressible at all — a
 * PATCH-merge shape could only ever set, never unset.
 *
 * `.strict()` for the same reason the offer body is: a key this endpoint cannot
 * honour is a client bug that must 400, not be silently dropped (the failure
 * mode that had the builder's `media` control writing a decorative string).
 *
 * The cover is deliberately NOT here — it is a still image, uploaded as
 * multipart to `POST …/cover`, not a `media_items` id.
 *
 * NOTE for callers: SvelteKit's `command()` infers a `.nullable()` field as
 * OPTIONAL, so the remote wrapper must re-supply `?? null` per slot (the same
 * quirk `updateJourneyOffer`'s remote documents).
 */
export const updateJourneySellMediaBodySchema = z
  .object({
    introVideoMediaId: uuidSchema.nullable().default(null),
    previewVideoMediaId: uuidSchema.nullable().default(null),
    guideVideoMediaId: uuidSchema.nullable().default(null),
    guidePortraitMediaId: uuidSchema.nullable().default(null),
    // A27 (Codex-wqxv4): the hero still and the guide's signature. Same
    // total-write, `.nullable().default(null)` treatment as the four above, so an
    // omitted slot CLEARS. Both are `media_items` refs — the still resolved is
    // the picked item's thumbnail, since `media_items` is video/audio only.
    heroMediaId: uuidSchema.nullable().default(null),
    signatureMediaId: uuidSchema.nullable().default(null),
  })
  .strict();
export type UpdateJourneySellMediaBody = z.infer<
  typeof updateJourneySellMediaBodySchema
>;

/**
 * Journey FEATURED flag body — "feature this portal on the org homepage"
 * (`PATCH /api/journeys/studio/journeys/:pageId/featured`).
 *
 * `landing_pages.featured` has been readable since `listPublishedJourneys` shipped
 * (it filters on the column for the home rail and orders featured-first), but
 * nothing ever WROTE it — the flag was reachable only by raw SQL or a seed, so the
 * home rail could never be curated from the studio. This body is that write.
 *
 * A SEPARATE body from {@link saveJourneyPageBodySchema} deliberately, for the
 * reason that schema's own doc-comment records: it is `.strict()` and shared with
 * the builder's autosave, so adding `featured` there would either 400 every
 * existing save (which omits the key) or, under a non-strict widening, accept and
 * silently discard it while reporting "Page saved" — the exact silent-drop bug
 * `offer` and `seo` already caused. A distinct route gets a distinct body.
 *
 * `.strict()` for the same reason the offer/sell-media bodies are: an unrecognised
 * key is a client bug that must 400 rather than be dropped. No `.default()` —
 * featuring is an explicit two-state intent, so an absent `featured` is a
 * malformed request, not "false".
 */
export const setJourneyFeaturedBodySchema = z
  .object({
    featured: z.boolean(),
  })
  .strict();
export type SetJourneyFeaturedBody = z.infer<
  typeof setJourneyFeaturedBodySchema
>;

/**
 * ── STUDIO curriculum-editor inputs (Codex-03cwh · admin two-pane editor) ──
 *
 * The two-pane curriculum editor is owner/admin (`requireOrgManagement`). The
 * route addresses a journey by its landing-page `:pageId` (path param) and
 * takes `organizationId` in the query — consumed ONLY by the `procedure()` org
 * resolver; the handler forwards `ctx.organizationId` and resolves the subject
 * course from the page. A practice is a JOIN to a `content` row (never free
 * text), so its only editable field here is which content it points at.
 */

/** One practice in the save body — a reference to an existing content row. */
export const saveCurriculumPracticeSchema = z.object({
  contentId: uuidSchema,
});

/**
 * One stage in the save body. `id` is the persisted stage id for an existing
 * stage, or `null` for a stage the editor just added (the server assigns its
 * id). Bounds mirror the `course_stages` columns (`name` varchar(255); `gloss`
 * is `text`, capped defensively). A `contentId` may not repeat WITHIN a stage
 * (the `stage_practices` PK is `(stageId, contentId)`).
 */
export const saveCurriculumStageSchema = z.object({
  id: uuidSchema.nullable(),
  name: z.string().trim().min(1).max(255),
  gloss: z.string().trim().max(2000).nullable(),
  practices: z
    .array(saveCurriculumPracticeSchema)
    .max(200)
    .refine((ps) => new Set(ps.map((p) => p.contentId)).size === ps.length, {
      message: 'A practice can only appear once per stage',
    }),
});

/** Bulk-save body — the whole desired curriculum, reconciled server-side. */
export const saveCurriculumBodySchema = z.object({
  stages: z.array(saveCurriculumStageSchema).max(100),
});
export type SaveCurriculumBody = z.infer<typeof saveCurriculumBodySchema>;
