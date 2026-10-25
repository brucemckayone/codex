/**
 * Support refunds remote functions: the platform-owner /admin pages
 * (Codex-2hxff.28; design docs/handover/phase3-sources/support-refunds/).
 *
 * Every call reaches an admin-api route with `auth: 'platform_owner'`, and the
 * worker is the gate. A remote function is reachable without its page, though
 * (a direct request to `/_app/remote/…` never runs the /admin layout), so each
 * one repeats the layout's guard: anyone but the platform owner gets the same
 * 404, whatever they send, and no worker call is made. Kit validates the
 * input BEFORE the handler, so the guard runs inside the schema too
 * (`ownerOnly`): otherwise a malformed call would get kit's 400, naming the
 * schema's first issue, and show the function exists (Codex-2hxff.28 review,
 * R2-L4). Nothing is cached: support must see the state now.
 *
 * Reads are queries. A 4xx is forwarded with its message and code
 * (`forwardClientErrors`), so a page can tell "no record of this charge"
 * (404) from a failure. Writes are commands that ANSWER a refusal instead of
 * throwing it, with the support error's own code from `details.code`
 * (`toSupportFailure`): the refund form shows a different state for each.
 */

import { AUTH_ROLES } from '@codex/constants';
import {
  stripeChargeIdSchema,
  supportChargeSearchQuerySchema,
  supportIssueRefundSchema,
  supportQueueQuerySchema,
  supportResolveCreatorDebtSchema,
  supportResolveFailedRefundSchema,
} from '@codex/validation';
import { error, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';
import { toSupportFailure } from './support-failure';

/** The /admin layout's guard, repeated: a 404 for anyone but the platform owner. */
function requirePlatformOwner(): RequestEvent {
  const event = getRequestEvent();
  if (event.locals.user?.role !== AUTH_ROLES.PLATFORM_OWNER) {
    error(404, 'Not Found');
  }
  return event;
}

/**
 * The support client, for the platform owner only. Called OUTSIDE each
 * command's try, so the 404 is thrown to the caller rather than answered as a
 * refund failure.
 */
function supportApi() {
  const { platform, cookies } = requirePlatformOwner();
  return createServerApi(platform, cookies).support;
}

type StandardSchema = {
  readonly '~standard': { validate(value: unknown): unknown };
};

/**
 * `schema`, with the guard run first. Kit calls a schema's `validate`
 * synchronously inside the request, so `getRequestEvent()` works there. The
 * input and output types are the schema's own, so callers are typed as before.
 */
function ownerOnly<S extends StandardSchema>(schema: S): Pick<S, '~standard'> {
  const standard = schema['~standard'];
  return {
    '~standard': {
      ...standard,
      validate(value: unknown) {
        requirePlatformOwner();
        return standard.validate(value);
      },
    },
  } as Pick<S, '~standard'>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** Charges found by an exact key (`q`), newest first. */
export const searchSupportCharges = query(
  ownerOnly(supportChargeSearchQuerySchema),
  async (input) => {
    const api = supportApi();
    return forwardClientErrors(() => api.searchCharges(input));
  }
);

/** One charge, as one answer: header, split, refunds and chargebacks. */
export const getSupportCharge = query(
  ownerOnly(stripeChargeIdSchema),
  async (chargeId) => {
    const api = supportApi();
    return forwardClientErrors(() => api.getCharge(chargeId));
  }
);

/**
 * What refunding `amountCents` would take back. `refundCount` is not sent:
 * it keys the query to the charge state the preview was worked out for, so a
 * preview cached before someone else's refund is never shown after it.
 */
export const getRefundPreview = query(
  ownerOnly(
    z.object({
      chargeId: stripeChargeIdSchema,
      amountCents: z.number().int().min(1),
      refundCount: z.number().int().min(0),
    })
  ),
  async ({ chargeId, amountCents }) => {
    const api = supportApi();
    return forwardClientErrors(() => api.previewRefund(chargeId, amountCents));
  }
);

/**
 * The queue's two counts, for the nav badge. It takes nothing, but has a
 * schema all the same: kit refuses an argument to a schema-less query with a
 * 400 before the guard could run.
 */
export const getSupportQueueCounts = query(
  ownerOnly(z.undefined()),
  async () => {
    const api = supportApi();
    return forwardClientErrors(() => api.getQueueCounts());
  }
);

/** Failed refunds waiting for a person, oldest first. */
export const listFailedRefunds = query(
  ownerOnly(supportQueueQuerySchema),
  async (input) => {
    const api = supportApi();
    return forwardClientErrors(() => api.listFailedRefunds(input));
  }
);

/** Creator debts waiting for a person, oldest first. */
export const listCreatorDebts = query(
  ownerOnly(supportQueueQuerySchema),
  async (input) => {
    const api = supportApi();
    return forwardClientErrors(() => api.listCreatorDebts(input));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refund the charge. `expectedRefundCount` is the count the page showed: the
 * route refuses with `CHARGE_CHANGED` if the charge has more refunds now.
 */
export const issueSupportRefund = command(
  ownerOnly(
    supportIssueRefundSchema.extend({ chargeId: stripeChargeIdSchema })
  ),
  async ({ chargeId, ...body }) => {
    const api = supportApi();
    try {
      const result = await api.issueRefund(chargeId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);

/** Settle a failed refund: made another way, or re-pay the payees (with a note). */
export const resolveFailedRefund = command(
  ownerOnly(
    z.object({
      refundId: z.string().uuid(),
      body: supportResolveFailedRefundSchema,
    })
  ),
  async ({ refundId, body }) => {
    const api = supportApi();
    try {
      const result = await api.resolveFailedRefund(refundId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);

/** Settle a creator debt. `dispute_won` is not a choice: the schema refuses it. */
export const resolveCreatorDebt = command(
  ownerOnly(
    z.object({
      reviewId: z.string().uuid(),
      body: supportResolveCreatorDebtSchema,
    })
  ),
  async ({ reviewId, body }) => {
    const api = supportApi();
    try {
      const result = await api.resolveCreatorDebt(reviewId, body);
      return { outcome: 'done' as const, result };
    } catch (error) {
      return toSupportFailure(error);
    }
  }
);
