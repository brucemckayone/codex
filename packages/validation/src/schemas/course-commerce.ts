import { z } from 'zod';
import { priceCentsSchema, uuidSchema } from '../primitives';
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
 * Org context for the studio course-monetisation mutations. These routes carry
 * no `:orgId` path segment and worker-to-worker calls have no subdomain, so
 * `procedure()` resolves the org from `?organizationId=` — declared here so a
 * missing/malformed value is a 400 at the edge rather than an org-resolution
 * failure deeper in.
 */
export const courseMonetisationOrgQuerySchema = z.object({
  organizationId: uuidSchema,
});

/**
 * BODY of the create/re-price course-subscription-plan mutation (one live plan
 * per course). Drives the Stripe Product + monthly/annual Price sync.
 *
 * `courseId` is deliberately NOT here — it is the path segment
 * (`PUT /studio/courses/:courseId/subscription-plan`), so the resource identity
 * has exactly one source and a path/body disagreement cannot arise.
 */
export const upsertCourseSubscriptionPlanSchema = z
  .object({
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
 * BODY of the tier-access mutation: the EXACT set of org tiers that unlock a
 * course (SPEC §7 tier-access, "not just min-tier"). Replaces the course's
 * tier-access rows with `tierIds`; an empty array clears them.
 *
 * The N1 guarantee (every tier must belong to the course's org) is enforced by
 * the service write-path guard AND the `course_tier_access` composite FKs.
 * `courseId` is the path segment, not a body field — see
 * {@link upsertCourseSubscriptionPlanSchema}.
 */
export const setCourseTierAccessSchema = z.object({
  tierIds: z
    .array(uuidSchema)
    .max(50, 'Cannot grant more than 50 tiers to one course'),
});

/**
 * INPUT of the studio pricing panel's monetisation write (Codex-2pryk.2.4.2) —
 * the builder-side composite that fans out to the two `/studio/courses/:courseId`
 * mutations: the subscription plan and the tier-access set.
 *
 * A TOTAL write, like the journey sell-media body: `tierIds` is the
 * exact set (`[]` clears), and `subscriptionEnabled: false` WITHDRAWS the plan
 * rather than leaving the previous one silently on sale. An incremental shape
 * could only ever add a way in, never remove one — which is the whole reason the
 * panel's "off" position did nothing before.
 *
 * FLAT rather than nested (`subscription: { … } | null`) on purpose: SvelteKit's
 * `command()` infers a `.nullable()` field as OPTIONAL, so a nested nullable
 * object arrives as `undefined` and every consumer has to re-derive "was it off,
 * or was the key just missing?". Flat nullable prices make that unambiguous.
 *
 * The PRICE RULES are deliberately NOT here — `min(100)` and
 * `priceAnnual <= priceMonthly * 12` live in
 * {@link upsertCourseSubscriptionPlanSchema}, which the ecom-api route validates
 * on the way in. Restating them would mean two places to change one rule, and
 * the worker is the authority. This schema's only cross-field concern (an enabled
 * subscription needs both prices) is enforced by the caller so it can name which
 * field is missing.
 */
export const updateCourseMonetisationInputSchema = z
  .object({
    courseId: uuidSchema,
    subscriptionEnabled: z.boolean().default(false),
    subscriptionPriceMonthly: priceCentsSchema,
    subscriptionPriceAnnual: priceCentsSchema,
    tierIds: z
      .array(uuidSchema)
      .max(50, 'Cannot grant more than 50 tiers to one course'),
  })
  .strict();

export type CourseOfferParams = z.infer<typeof courseOfferParamsSchema>;
export type CourseMonetisationOrgQuery = z.infer<
  typeof courseMonetisationOrgQuerySchema
>;
export type UpsertCourseSubscriptionPlanInput = z.infer<
  typeof upsertCourseSubscriptionPlanSchema
>;
export type CreateCourseSubscriptionCheckoutInput = z.infer<
  typeof createCourseSubscriptionCheckoutSchema
>;
export type SetCourseTierAccessInput = z.infer<
  typeof setCourseTierAccessSchema
>;
export type UpdateCourseMonetisationInput = z.infer<
  typeof updateCourseMonetisationInputSchema
>;
