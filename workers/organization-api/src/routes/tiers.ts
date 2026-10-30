/**
 * Subscription Tier Management Endpoints
 *
 * RESTful API for managing subscription tiers within an organization.
 * Mounted at /api/organizations/:id/tiers
 *
 * Endpoints:
 * - POST   /                       - Create subscription tier (optionally copying another's items)
 * - GET    /                       - List tiers (public, no auth required)
 * - GET    /access-summary         - Per-tier film/course counts + gaps (studio)
 * - PATCH  /:tierId                - Update tier
 * - DELETE /:tierId?onlyHere=&moveTo= - Soft-delete tier, saying what happens to items only in it
 * - GET    /:tierId/delete-impact  - What deleting it would leave only there (studio)
 * - GET    /:tierId/items          - The tier checklist's rows (studio)
 * - POST   /:tierId/items          - The tier checklist's delta save (studio)
 * - POST   /reorder                - Reorder tiers (display only)
 *
 * Plan access by ticks: Codex-2hxff.91. The studio reads are uncached: counts,
 * closed items and gaps never go on a public or cached route.
 */

import { CacheType, VersionedCache, type WaitUntilFn } from '@codex/cache';
import type { HonoEnv } from '@codex/shared-types';
import {
  createTierSchema,
  deleteTierQuerySchema,
  planItemsDeltaSchema,
  planItemsQuerySchema,
  reorderTiersSchema,
  updateTierSchema,
  uuidSchema,
} from '@codex/validation';
import { cachedRead, PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Write-through the tier cache after a mutation.
 * Fire-and-forget via waitUntil — never blocks the mutation response.
 *
 * `cache.set` puts the freshly-listed tiers straight into the current slot:
 * 1 read + 1 write, where the previous `invalidate()` + `get()` pair cost
 * 2 writes + 2 reads and spent its second write re-fetching from the DB a
 * value this handler was about to hold anyway (Codex-kgrdp.8). On the free
 * tier's account-wide 1,000 writes/day, halving the writes on every
 * create/update/delete/reorder is the point.
 *
 * The version is deliberately NOT bumped any more. A tier change does not
 * alter org members or org settings, which share this `id`, so staling them
 * only forced each to spend a write of its own on its next read.
 *
 * `set` awaits its own put, so this single waitUntil genuinely covers the
 * write — no second waitUntil inside the cache is needed.
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
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV,
    waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
  });
  ctx.executionCtx.waitUntil(
    (async () => {
      const tiers = await ctx.services.tier.listTiers(orgId);
      await cache.set(orgId, CacheType.ORG_TIERS, tiers, { ttl: 86400 });
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
      if (ctx.input.body.copyAccessFromTierId) {
        // The copy changed which tiers the org's items are in (the public
        // list carries them). A new tier has no subscribers: catalogue only.
        await ctx.services.planAccess.afterTierAccessChange(orgId, []);
      }
      return tier;
    },
  })
);

/**
 * GET /api/organizations/:id/tiers/access-summary
 * Per-tier film and course counts, the guidance-note gaps and the org's
 * eligible / closed / ineligible film counts. Registered before every
 * `/:tierId` route (Hono matches in registration order).
 */
app.get(
  '/access-summary',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { params: orgIdParamSchema },
    handler: async (ctx) =>
      ctx.services.planAccess.getAccessSummary(ctx.organizationId),
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
      return await cachedRead(
        ctx,
        orgId,
        CacheType.ORG_TIERS,
        () => ctx.services.tier.listTiers(orgId),
        { ttl: 86400 }
      );
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
      query: deleteTierQuerySchema,
    },
    successStatus: 204,
    handler: async (ctx) => {
      const orgId = ctx.organizationId;
      const { tierId } = ctx.input.params;
      const choice = ctx.input.query;
      await ctx.services.tier.deleteTier(tierId, orgId, choice);
      warmTierCache(ctx, orgId);
      // The deleted tier's ticks are gone and, on a move, its only-here
      // items are in `moveTo`: bump the catalogue and those subscribers.
      await ctx.services.planAccess.afterTierAccessChange(
        orgId,
        choice.onlyHere === 'move' ? (choice.moveTo ?? []) : []
      );
      return null;
    },
  })
);

/**
 * GET /api/organizations/:id/tiers/:tierId/delete-impact
 * The delete dialog's preview. The delete recomputes in its transaction.
 */
app.get(
  '/:tierId/delete-impact',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { params: orgTierParamSchema },
    handler: async (ctx) =>
      ctx.services.planAccess.getDeleteImpact(
        ctx.organizationId,
        ctx.input.params.tierId
      ),
  })
);

/**
 * GET /api/organizations/:id/tiers/:tierId/items
 * One page of the tier checklist ("What's in {tier}").
 */
app.get(
  '/:tierId/items',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { params: orgTierParamSchema, query: planItemsQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.planAccess.listTierItems(
        ctx.organizationId,
        ctx.input.params.tierId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/organizations/:id/tiers/:tierId/items
 * The tier checklist's save: a capped, idempotent delta of adds and removes.
 * The default `api` rate limit, which this worker binds.
 */
app.post(
  '/:tierId/items',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: { params: orgTierParamSchema, body: planItemsDeltaSchema },
    handler: async (ctx) =>
      ctx.services.planAccess.setTierItems(
        ctx.organizationId,
        ctx.input.params.tierId,
        ctx.input.body
      ),
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
