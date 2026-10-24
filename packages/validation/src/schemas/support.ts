/**
 * Support refunds: the platform-owner refund screen and queue
 * (Codex-2hxff.28; data design §1). admin-api's `/api/admin/support/*`
 * routes validate their input with these.
 */

import { z } from 'zod';
import { uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';
import { hasNoNul, stripNul } from '../shared/search-schema';

/** The most rows one page of a support list holds. */
export const SUPPORT_LIST_MAX_LIMIT = 50;

/** The longest note support can write on a settlement. */
export const SUPPORT_NOTE_MAX_LENGTH = 500;

const supportPaginationSchema = paginationSchema.extend({
  limit: z.coerce
    .number()
    .int({ message: 'Must be a whole number' })
    .positive({ message: 'Must be greater than 0' })
    .max(SUPPORT_LIST_MAX_LIMIT, {
      message: `Must be ${SUPPORT_LIST_MAX_LIMIT} or less`,
    })
    .default(20),
});

/** A Stripe charge: `ch_…`, or `py_…` for a payment method that is not a card. */
export const stripeChargeIdSchema = z
  .string()
  .regex(/^(ch|py)_[A-Za-z0-9]{8,64}$/, { message: 'Invalid charge ID' });

/**
 * GET /api/admin/support/charges. `q` is matched exactly, never as free text:
 * an email (lower-cased), a purchase or subscription id, or a Stripe `sub_`,
 * `pi_`, `ch_` or `py_` id. Anything else finds nothing. So a NUL is refused,
 * not dropped: a rewritten identifier names a different row.
 */
export const supportChargeSearchQuerySchema = supportPaginationSchema.extend({
  q: z
    .string()
    .trim()
    .min(3, { message: 'Must be at least 3 characters' })
    .max(254, { message: 'Must be 254 characters or less' })
    .refine(hasNoNul, { message: 'Must not contain NUL' }),
});

export type SupportChargeSearchQuery = z.infer<
  typeof supportChargeSearchQuerySchema
>;

/** `:chargeId` on the charge routes. */
export const supportChargeParamsSchema = z.object({
  chargeId: stripeChargeIdSchema,
});

/** GET /api/admin/support/charges/:chargeId/refund-preview */
export const supportRefundPreviewQuerySchema = z.object({
  amountCents: z.coerce
    .number()
    .int({ message: 'Must be a whole number of pence' })
    .min(1, { message: 'Must be at least 1p' }),
});

/** Stripe's refund reasons support may give. */
export const supportRefundReasonEnum = z.enum([
  'requested_by_customer',
  'duplicate',
  'fraudulent',
]);

/**
 * POST /api/admin/support/charges/:chargeId/refunds. `expectedRefundCount` is
 * the refund count the page showed: the route refuses if the charge has more
 * now, and it is part of the refund's idempotency key.
 */
export const supportIssueRefundSchema = z.object({
  amountCents: z
    .number()
    .int({ message: 'Must be a whole number of pence' })
    .min(1, { message: 'Must be at least 1p' }),
  reason: supportRefundReasonEnum,
  expectedRefundCount: z
    .number()
    .int({ message: 'Must be a whole number' })
    .min(0, { message: 'Must be 0 or more' }),
});

export type SupportIssueRefundInput = z.infer<typeof supportIssueRefundSchema>;

/** The queue's two lists. */
export const supportQueueQuerySchema = supportPaginationSchema;

export type SupportQueueQuery = z.infer<typeof supportQueueQuerySchema>;

/**
 * Support's note on a settlement: free text, so a NUL is dropped, then it is
 * trimmed and capped. Absent is the empty note.
 */
const supportNoteSchema = z
  .string()
  .transform(stripNul)
  .pipe(
    z
      .string()
      .trim()
      .max(SUPPORT_NOTE_MAX_LENGTH, {
        message: `Must be ${SUPPORT_NOTE_MAX_LENGTH} characters or less`,
      })
  )
  .default('');

/** `:refundId` on the settle route: our `refunds` row, not Stripe's `re_`. */
export const supportRefundIdParamsSchema = z.object({ refundId: uuidSchema });

/**
 * POST /api/admin/support/refunds/:refundId/resolve. A note is required to
 * re-pay the payees: it is a money record (Q6).
 */
export const supportResolveFailedRefundSchema = z
  .object({
    resolution: z.enum(['refunded_elsewhere', 'creators_repaid']),
    note: supportNoteSchema,
  })
  .refine(
    (input) => input.resolution !== 'creators_repaid' || input.note !== '',
    { message: 'A note is required to re-pay the payees', path: ['note'] }
  );

export type SupportResolveFailedRefundInput = z.infer<
  typeof supportResolveFailedRefundSchema
>;

/** `:reviewId` on the creator-debt settle route. */
export const supportReviewIdParamsSchema = z.object({ reviewId: uuidSchema });

/**
 * POST /api/admin/support/creator-debts/:reviewId/resolve. `dispute_won` is
 * never accepted: the won-chargeback code writes it, with its re-pay (Q7). A
 * note is required for a transfer reversed by hand.
 */
export const supportResolveCreatorDebtSchema = z
  .object({
    resolution: z.enum([
      'creator_absorbed',
      'platform_absorbed',
      'manually_reversed',
    ]),
    note: supportNoteSchema,
  })
  .refine(
    (input) => input.resolution !== 'manually_reversed' || input.note !== '',
    {
      message: 'A note is required for a transfer reversed by hand',
      path: ['note'],
    }
  );

export type SupportResolveCreatorDebtInput = z.infer<
  typeof supportResolveCreatorDebtSchema
>;
