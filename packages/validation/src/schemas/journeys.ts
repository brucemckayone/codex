import type { BrandTokenOverrides, PageSection } from '@codex/shared-types';
import { z } from 'zod';
import { createSlugSchema, uuidSchema } from '../primitives';

/**
 * Journey member-surface route inputs (Codex-2pryk · Round-D · Codex-776gg).
 *
 * The validated inputs for the content-api journey routes the Round-D seam
 * calls (SPEC §11 / §14):
 *   - `/api/access/courses/:courseId/can-enter`      → {@link canEnterCourseParamsSchema}
 *   - `/api/access/content/:contentId/can-view`      → {@link canViewParamsSchema}
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

/** `(organizationId, slug)` query — resolve a course summary by its slug. */
export const courseBySlugQuerySchema = z.object({
  organizationId: uuidSchema,
  slug: createSlugSchema(160),
});
export type CourseBySlugQuery = z.infer<typeof courseBySlugQuerySchema>;

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
 * Studio journey-insights query (Codex-2pryk · Round-D · Codex-776gg · WP-7) —
 * `GET /api/journeys/insights`. Owner/admin only via `requireOrgManagement`.
 *
 * `organizationId` is consumed ONLY by the `procedure()` org resolver; the route
 * re-derives the authoritative scope from `ctx.organizationId` (session
 * membership) and never trusts this value for authorization. `period` selects
 * the reporting window (defaults to 30 days).
 */
export const journeyInsightsQuerySchema = z.object({
  organizationId: uuidSchema,
  courseId: uuidSchema,
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});
export type JourneyInsightsQuery = z.infer<typeof journeyInsightsQuerySchema>;

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
 * A single page section. Typed as `PageSection` (so the inferred save body is
 * assignable to the service input without a cast) with a light runtime guard —
 * each section must be a non-null object. Deep structural validation of the
 * section union is deferred to the renderer + a follow-up (the write path is
 * `requireOrgManagement`, and the render path sanitises HTML).
 */
export const pageSectionSchema = z.custom<PageSection>(
  (value) => typeof value === 'object' && value !== null,
  { message: 'each section must be an object' }
);

/**
 * Save-journey-page body — the editable page record (frozen `JourneyPageRecord`
 * minus the server-owned `organizationId`/`publishedAt`, which the service
 * derives). `sections`/`brandOverrides` carry their FE types via `z.custom` so
 * the inferred type is assignable to the service input with no boundary cast.
 */
export const saveJourneyPageBodySchema = z.object({
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
});
export type SaveJourneyPageBody = z.infer<typeof saveJourneyPageBodySchema>;
