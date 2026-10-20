/**
 * Organisation ownership (Codex-2hxff.2)
 *
 * One owner per organisation. Only the owner can hand it on: they offer it to
 * an active admin or creator, who accepts or declines within 7 days. The
 * contract is `docs/payments/connect-and-payouts.md → Organisation ownership`.
 *
 * Mounted at: /api/organizations/:id/ownership
 *
 * Endpoints:
 * - GET  /                          - Owner, open offer, and (for the owner) the
 *                                     management fields
 * - POST /offers                    - The owner offers ownership
 * - POST /offers/:offerId/withdraw  - The owner withdraws the open offer
 * - POST /offers/:offerId/accept    - The recipient accepts
 * - POST /offers/:offerId/decline   - The recipient declines
 *
 * Every route needs an active membership; who may do what (the owner, the
 * recipient) is enforced in `OrganizationService`, because no policy flag
 * means "the owner". The writes use the `strict` rate limit.
 */

import type { HonoEnv } from '@codex/shared-types';
import { offerOwnershipSchema, uuidSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateMemberCaches } from '../utils/membership-invalidation';

const app = new Hono<HonoEnv>();

const orgParams = z.object({ id: uuidSchema });
const offerParams = z.object({ id: uuidSchema, offerId: uuidSchema });

/**
 * GET /api/organizations/:id/ownership
 *
 * Returns: the ownership view (200). Owner-only fields are omitted for
 * everyone else; the open offer and the active agreements are shown to the
 * owner and to the offer's recipient only.
 * Security: active owner, admin or creator (others 403).
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: { params: orgParams },
    handler: async (ctx) => {
      const orgId = ctx.input.params.id;
      const view = await ctx.services.organization.getOwnership(
        orgId,
        ctx.user.id
      );

      const isOwner = view.viewerRole === 'owner';
      const isRecipient = view.openOffer?.recipient.userId === ctx.user.id;
      if (!isOwner && !isRecipient) return view;

      const agreements =
        await ctx.services.agreements.getActiveAgreementSummaries(orgId);
      return {
        ...view,
        activeAgreements: agreements.map(
          ({ creatorName, revenueType, shareBps, since }) => ({
            creatorName,
            revenueType,
            shareBps,
            since,
          })
        ),
        // The offer dialog warns an owner with no subscription agreement that
        // their subscription income stops after a transfer.
        ...(isOwner && {
          ownerHasSubscriptionAgreement: agreements.some(
            (a) =>
              a.creatorId === view.owner.userId &&
              a.revenueType === 'subscription'
          ),
        }),
      };
    },
  })
);

/**
 * POST /api/organizations/:id/ownership/offers
 *
 * Body: { recipientUserId, confirmName }
 * Returns: the offer (201). Emails the recipient.
 * Security: the owner only (403 NOT_ORGANISATION_OWNER otherwise).
 */
app.post(
  '/offers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      rateLimit: 'strict',
    },
    input: { params: orgParams, body: offerOwnershipSchema },
    successStatus: 201,
    handler: async (ctx) =>
      ctx.services.organization.offerOwnership(
        ctx.input.params.id,
        ctx.user.id,
        ctx.input.body
      ),
  })
);

/**
 * POST /api/organizations/:id/ownership/offers/:offerId/withdraw
 *
 * Returns: the offer (200).
 * Security: the owner only.
 */
app.post(
  '/offers/:offerId/withdraw',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      rateLimit: 'strict',
    },
    input: { params: offerParams },
    handler: async (ctx) =>
      ctx.services.organization.withdrawOwnershipOffer(
        ctx.input.params.id,
        ctx.input.params.offerId,
        ctx.user.id
      ),
  })
);

/**
 * POST /api/organizations/:id/ownership/offers/:offerId/accept
 *
 * Returns: { ownerUserId, ownerSince, previousOwnerUserId } (200). The caller
 * is now the owner and the previous owner an admin, so BOTH users' membership
 * caches are busted, exactly as a role change does.
 * Security: the offer's recipient only.
 */
app.post(
  '/offers/:offerId/accept',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      rateLimit: 'strict',
    },
    input: { params: offerParams },
    handler: async (ctx) => {
      const orgId = ctx.input.params.id;
      const change = await ctx.services.organization.acceptOwnershipOffer(
        orgId,
        ctx.input.params.offerId,
        ctx.user.id
      );
      invalidateMemberCaches(ctx, orgId, change.ownerUserId, ctx.obs);
      invalidateMemberCaches(ctx, orgId, change.previousOwnerUserId, ctx.obs);
      return change;
    },
  })
);

/**
 * POST /api/organizations/:id/ownership/offers/:offerId/decline
 *
 * Returns: the offer (200). Emails the owner.
 * Security: the offer's recipient only.
 */
app.post(
  '/offers/:offerId/decline',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      rateLimit: 'strict',
    },
    input: { params: offerParams },
    handler: async (ctx) =>
      ctx.services.organization.declineOwnershipOffer(
        ctx.input.params.id,
        ctx.input.params.offerId,
        ctx.user.id
      ),
  })
);

export default app;
