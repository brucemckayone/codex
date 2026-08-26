/**
 * Course monetization routes (Codex-2pryk WP-6 · SPEC §7).
 *
 * GET /courses/:courseId/offer — the public read composing all three §7
 * acquisition paths (one-off purchase, course subscription, org-tier access)
 * plus, for an authenticated viewer, whether they already hold access. Backs
 * the sales-page + course-landing pricing surfaces.
 *
 * This router is PUBLIC (`auth: 'optional'`, no org guard). The management
 * mutations (subscription-plan upsert/withdraw, tier access) are org-guarded and
 * live in the sibling `course-monetisation.ts`, mounted at `/studio/courses`.
 * Do not add a mutation here.
 */

import type { CourseOffer, HonoEnv } from '@codex/shared-types';
import { courseOfferParamsSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const courses = new Hono<HonoEnv>();

/**
 * GET /courses/:courseId/offer
 *
 * Optional auth: anonymous callers get the offer with `entitled: false`; an
 * authenticated caller additionally learns whether they already hold access.
 */
courses.get(
  '/:courseId/offer',
  procedure({
    policy: { auth: 'optional', rateLimit: 'api' },
    input: { params: courseOfferParamsSchema },
    handler: async (ctx): Promise<CourseOffer> => {
      return ctx.services.courseAccess.getCourseOffer(
        ctx.input.params.courseId,
        ctx.user?.id ?? null
      );
    },
  })
);

export default courses;
