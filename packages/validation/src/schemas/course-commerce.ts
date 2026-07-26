import { z } from 'zod';
import { uuidSchema } from '../primitives';
import { checkoutRedirectUrlSchema } from './purchase';
import { billingIntervalEnum } from './subscription';

/**
 * Course monetization validation (Codex-2pryk WP-6 · SPEC §7).
 *
 * The three course-access paths' write inputs:
 *   - one-off course purchase checkout   → see `createCourseCheckoutSchema` (purchase.ts)
 *   - course-specific subscription        → `createCourseSubscriptionCheckoutSchema` + plan CRUD here
 *   - org tier → course grant             → `setCourseTierAccessSchema` here
 *
 * Prices are GBP integer pence. Redirect URLs reuse the host-allowlisted
 * checkout schema (open-redirect prevention).
 */

/**
 * Create/replace the course-specific subscription PLAN (one live plan per
 * course). Drives the Stripe Product + monthly/annual Price sync.
 */
export const upsertCourseSubscriptionPlanSchema = z
  .object({
    courseId: uuidSchema,
    priceMonthly: z
      .number()
      .int('Price must be a whole number (pence)')
      .min(100, 'Minimum price is £1.00 (100 pence)')
      .max(10000000, 'Maximum price is £100,000'),
    priceAnnual: z
      .number()
      .int('Price must be a whole number (pence)')
      .min(100, 'Minimum price is £1.00 (100 pence)')
      .max(10000000, 'Maximum price is £100,000'),
  })
  .refine((data) => data.priceAnnual <= data.priceMonthly * 12, {
    message: 'Annual price must offer equal or better value than monthly',
    path: ['priceAnnual'],
  });

/**
 * Start a course-specific subscription checkout. `courseId` + interval are the
 * inputs; the plan + its Stripe Price are resolved server-side.
 */
export const createCourseSubscriptionCheckoutSchema = z.object({
  courseId: uuidSchema,
  billingInterval: billingIntervalEnum,
  successUrl: checkoutRedirectUrlSchema,
  cancelUrl: checkoutRedirectUrlSchema,
});

/** Path params for the public course-offer read (`GET /courses/:courseId/offer`). */
export const courseOfferParamsSchema = z.object({
  courseId: uuidSchema,
});

/**
 * Set the EXACT set of org tiers that unlock a course (SPEC §7 tier-access:
 * "not just min-tier"). Replaces the course's tier-access rows with `tierIds`.
 * The N1 guarantee (every tier must belong to the course's org) is enforced by
 * the service write-path guard AND the `course_tier_access` composite FKs.
 */
export const setCourseTierAccessSchema = z.object({
  courseId: uuidSchema,
  tierIds: z
    .array(uuidSchema)
    .max(50, 'Cannot grant more than 50 tiers to one course'),
});

export type CourseOfferParams = z.infer<typeof courseOfferParamsSchema>;
export type UpsertCourseSubscriptionPlanInput = z.infer<
  typeof upsertCourseSubscriptionPlanSchema
>;
export type CreateCourseSubscriptionCheckoutInput = z.infer<
  typeof createCourseSubscriptionCheckoutSchema
>;
export type SetCourseTierAccessInput = z.infer<
  typeof setCourseTierAccessSchema
>;
