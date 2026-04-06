/**
 * Subscription Tier Management Endpoints
 *
 * RESTful API for managing subscription tiers within an organization.
 * Mounted at /api/organizations/:id/tiers
 *
 * Endpoints:
 * - POST   /                 - Create subscription tier
 * - GET    /                 - List tiers (public, no auth required)
 * - PATCH  /:tierId          - Update tier
 * - DELETE /:tierId          - Soft-delete tier
 * - POST   /reorder          - Reorder tiers
 */

import { createDbClient } from '@codex/database';
import { createStripeClient } from '@codex/purchase';
import type { HonoEnv } from '@codex/shared-types';
import { TierService } from '@codex/subscription';
import {
  createTierSchema,
  reorderTiersSchema,
  updateTierSchema,
  uuidSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

const orgIdParamSchema = z.object({ id: uuidSchema });
const orgTierParamSchema = z.object({ id: uuidSchema, tierId: uuidSchema });

/**
 * Lazily create TierService from request context.
 */
function getTierService(env: HonoEnv['Bindings']): TierService {
  const db = createDbClient(env);
  const stripe = createStripeClient(env.STRIPE_SECRET_KEY as string);
  return new TierService(
    { db, environment: env.ENVIRONMENT ?? 'development' },
    stripe
  );
}

/**
 * POST /api/organizations/:id/tiers
 * Create a subscription tier for the org.
 * Requires org management permission (owner/admin).
 */
app.post(
  '/',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { body: createTierSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const orgId = ctx.organizationId as string;
      const service = getTierService(ctx.env);
      return await service.createTier(orgId, ctx.input.body);
    },
  })
);

/**
 * GET /api/organizations/:id/tiers
 * List active tiers for an org. Public — no auth required.
 * Used by the storefront pricing page.
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'optional' },
    input: { params: orgIdParamSchema },
    handler: async (ctx) => {
      const orgId = ctx.input.params.id;
      const service = getTierService(ctx.env);
      const tiers = await service.listTiers(orgId);
      return tiers;
    },
  })
);

/**
 * PATCH /api/organizations/:id/tiers/:tierId
 * Update a tier's name, description, or prices.
 */
app.patch(
  '/:tierId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: orgTierParamSchema,
      body: updateTierSchema,
    },
    handler: async (ctx) => {
      const orgId = ctx.organizationId as string;
      const { tierId } = ctx.input.params;
      const service = getTierService(ctx.env);
      return await service.updateTier(tierId, orgId, ctx.input.body);
    },
  })
);

/**
 * DELETE /api/organizations/:id/tiers/:tierId
 * Soft-delete a tier. Fails if active subscribers exist.
 */
app.delete(
  '/:tierId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: orgTierParamSchema,
    },
    successStatus: 204,
    handler: async (ctx) => {
      const orgId = ctx.organizationId as string;
      const { tierId } = ctx.input.params;
      const service = getTierService(ctx.env);
      await service.deleteTier(tierId, orgId);
      return null;
    },
  })
);

/**
 * POST /api/organizations/:id/tiers/reorder
 * Reorder tiers. Accepts ordered array of tier IDs.
 */
app.post(
  '/reorder',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { body: reorderTiersSchema },
    successStatus: 204,
    handler: async (ctx) => {
      const orgId = ctx.organizationId as string;
      const service = getTierService(ctx.env);
      await service.reorderTiers(orgId, ctx.input.body.tierIds);
      return null;
    },
  })
);

export default app;
