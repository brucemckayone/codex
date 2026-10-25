/**
 * Support refunds remote functions: the platform-owner /admin pages
 * (Codex-2hxff.28; design docs/handover/phase3-sources/support-refunds/).
 *
 * Every call reaches an admin-api route with `auth: 'platform_owner'`; the
 * /admin layout's guard only hides the pages, the worker is the gate. Nothing
 * is cached: support must see the state now.
 *
 * Reads are queries. A 4xx is forwarded with its message and code
 * (`forwardClientErrors`), so a page can tell "no record of this charge"
 * (404) from a failure. Writes are commands that ANSWER a refusal instead of
 * throwing it, with the support error's own code from `details.code`
 * (`toSupportFailure`): the refund form shows a different state for each.
 */

import {
  stripeChargeIdSchema,
  supportChargeSearchQuerySchema,
  supportIssueRefundSchema,
  supportQueueQuerySchema,
  supportResolveCreatorDebtSchema,
  supportResolveFailedRefundSchema,
} from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';
import { toSupportFailure } from './support-failure';

function supportApi() {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).support;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** Charges found by an exact key (`q`), newest first. */
export const searchSupportCharges = query(
  supportChargeSearchQuerySchema,
  async (input) => forwardClientErrors(() => supportApi().searchCharges(input))
);

/** One charge, as one answer: header, split, refunds and chargebacks. */
export const getSupportCharge = query(stripeChargeIdSchema, async (chargeId) =>
  forwardClientErrors(() => supportApi().getCharge(chargeId))
);

/**
 * What refunding `amountCents` would take back. `refundCount` is not sent:
 * it keys the query to the charge state the preview was worked out for, so a
 * preview cached before someone else's refund is never shown after it.
 */
export const getRefundPreview = query(
  z.object({
    chargeId: stripeChargeIdSchema,
    amountCents: z.number().int().min(1),
    refundCount: z.number().int().min(0),
  }),
  async ({ chargeId, amountCents }) =>
    forwardClientErrors(() => supportApi().previewRefund(chargeId, amountCents))
);

/** The queue's two counts, for the nav badge. */
export const getSupportQueueCounts = query(async () =>
  forwardClientErrors(() => supportApi().getQueueCounts())
);

/** Failed refunds waiting for a person, oldest first. */
export const listFailedRefunds = query(supportQueueQuerySchema, async (input) =>
  forwardClientErrors(() => supportApi().listFailedRefunds(input))
);

/** Creator debts waiting for a person, oldest first. */
export const listCreatorDebts = query(supportQueueQuerySchema, async (input) =>
  forwardClientErrors(() => supportApi().listCreatorDebts(input))
);

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refund the charge. `expectedRefundCount` is the count the page showed: the
 * route refuses with `CHARGE_CHANGED` if the charge has more refunds now.
 */
export const issueSupportRefund = command(
  supportIssueRefundSchema.extend({ chargeId: stripeChargeIdSchema }),
  async ({ chargeId, ...body }) => {
    try {
      const result = await supportApi().issueRefund(chargeId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);

/** Settle a failed refund: made another way, or re-pay the payees (with a note). */
export const resolveFailedRefund = command(
  z.object({
    refundId: z.string().uuid(),
    body: supportResolveFailedRefundSchema,
  }),
  async ({ refundId, body }) => {
    try {
      const result = await supportApi().resolveFailedRefund(refundId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);

/** Settle a creator debt. `dispute_won` is not a choice: the schema refuses it. */
export const resolveCreatorDebt = command(
  z.object({
    reviewId: z.string().uuid(),
    body: supportResolveCreatorDebtSchema,
  }),
  async ({ reviewId, body }) => {
    try {
      const result = await supportApi().resolveCreatorDebt(reviewId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);
