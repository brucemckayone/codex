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

import { CacheType, VersionedCache, type WaitUntilFn } from '@codex/cache';
import type { HonoEnv } from '@codex/shared-types';
import {
  createTierSchema,
  reorderTiersSchema,
  updateTierSchema,
  uuidSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Write-through: invalidate + re-warm the tier cache.
 * Fire-and-forget via waitUntil — never blocks the mutation response.
 */
function warmTierCache(
  ctx: {
    env: { CACHE_KV?: import('@cloudflare/workers-types').KVNamespace };
    executionCtx: { waitUntil: WaitUntilFn };
    services: { tier: { listTiers(orgId: string): Promise<unknown> } };
  },
  orgId: string
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  ctx.executionCtx.waitUntil(
    (async () => {
      await cache.invalidate(orgId);
      await cache.get(
        orgId,
        CacheType.ORG_TIERS,
        () => ctx.services.tier.listTiers(orgId),
        {
          ttl: 86400,
        }
      );
    })().catch(() => {})
  );
}

const app = new Hono<HonoEnv>();

const orgIdParamSchema = z.object({ id: uuidSchema });
const orgTierParamSchema = z.object({ id: uuidSchema, tierId: uuidSchema });

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
      const orgId = ctx.organizationId;
      const tier = await ctx.services.tier.createTier(orgId, ctx.input.body);
      warmTierCache(ctx, orgId);
      return tier;
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
      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        return await cache.get(
          orgId,
          CacheType.ORG_TIERS,
          () => ctx.services.tier.listTiers(orgId),
          { ttl: 86400 }
        );
      }
      return await ctx.services.tier.listTiers(orgId);
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
      const orgId = ctx.organizationId;
      const { tierId } = ctx.input.params;
      const tier = await ctx.services.tier.updateTier(
        tierId,
        orgId,
        ctx.input.body
      );
      warmTierCache(ctx, orgId);
      return tier;
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
      const orgId = ctx.organizationId;
      const { tierId } = ctx.input.params;
      await ctx.services.tier.deleteTier(tierId, orgId);
      warmTierCache(ctx, orgId);
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
      const orgId = ctx.organizationId;
      await ctx.services.tier.reorderTiers(orgId, ctx.input.body.tierIds);
      warmTierCache(ctx, orgId);
      return null;
    },
  })
);

export default app;
