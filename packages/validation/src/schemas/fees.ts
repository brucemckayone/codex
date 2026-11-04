/**
 * Dated fee changes (Codex-2hxff.33; batch C1 Part B data design §3): the
 * platform owner's cancel, and the Studio's read of a person's upcoming
 * fees.
 */

import { z } from 'zod';
import { uuidSchema } from '../primitives';

/** `:changeId` on POST /api/admin/fees/changes/:changeId/cancel. */
export const feeChangeIdParamsSchema = z.object({ changeId: uuidSchema });

export type FeeChangeIdParams = z.infer<typeof feeChangeIdParamsSchema>;

/**
 * GET /fees/upcoming (ecom-api). With an organisation: its owner's rows, for
 * Billing and Payouts. Without: the caller's creator rows everywhere, for
 * Earnings.
 */
export const upcomingFeesQuerySchema = z.object({
  organizationId: uuidSchema.optional(),
});

export type UpcomingFeesQuery = z.infer<typeof upcomingFeesQuerySchema>;
