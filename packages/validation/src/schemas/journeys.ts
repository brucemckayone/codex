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
