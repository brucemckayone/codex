/**
 * tRPC-style Procedure Function
 *
 * Combines policy enforcement, input validation, service injection,
 * error handling, and response envelope into a single declarative function.
 *
 * @example
 * ```typescript
 * app.post('/api/content',
 *   procedure({
 *     policy: POLICY_PRESETS.creator(),
 *     input: { body: createContentSchema },
 *     successStatus: 201,
 *     handler: async (ctx) => {
 *       return await ctx.services.content.create(ctx.input.body, ctx.user.id);
 *     },
 *   })
 * );
 * ```
 */

import type { ObservabilityClient } from '@codex/observability';
import { mapErrorToResponse } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import {
  enforcePolicyInline,
  resolveCacheControl,
  validateInput,
} from './helpers';
import { PaginatedResult } from './paginated-result';

import { createServiceRegistry } from './service-registry';
import type {
  InputSchema,
  ProcedureConfig,
  ProcedureContext,
  ProcedureHandler,
  ProcedurePolicy,
} from './types';
import {
  buildBaseProcedureContext,
  createBackgroundTracker,
} from './upload-shared';

/**
 * Create a tRPC-style procedure handler
 *
 * Unifies:
 * - Policy enforcement (auth, RBAC, IP whitelist, org membership)
 * - Input validation (Zod schemas for params/query/body)
 * - Error handling (mapErrorToResponse)
 * - Response envelope (auto-wraps in { data: T })
 * - Service injection (lazy-loaded ctx.services)
 *
 * @param config - Procedure configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Public endpoint
 * app.get('/api/featured',
 *   procedure({
 *     policy: { auth: 'none' },
 *     handler: async (ctx) => {
 *       return await ctx.services.content.getFeatured();
 *     },
 *   })
 * );
 *
 * // Authenticated with validation
 * app.post('/api/content',
 *   procedure({
 *     policy: { auth: 'required', roles: ['creator'] },
 *     input: { body: createContentSchema },
 *     successStatus: 201,
 *     handler: async (ctx) => {
 *       return await ctx.services.content.create(ctx.input.body, ctx.user.id);
 *     },
 *   })
 * );
 *
 * // Delete with 204 No Content
 * app.delete('/api/content/:id',
 *   procedure({
 *     policy: { auth: 'required' },
 *     input: { params: z.object({ id: z.string().uuid() }) },
 *     successStatus: 204,
 *     handler: async (ctx) => {
 *       await ctx.services.content.delete(ctx.input.params.id, ctx.user.id);
 *       return null;
 *     },
 *   })
 * );
 * ```
 */
export function procedure<
  const TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
>(config: ProcedureConfig<TPolicy, TInput, TOutput>): ProcedureHandler {
  const {
    policy = { auth: 'required' } as TPolicy,
    input,
    handler,
    successStatus = 200,
  } = config;

  // Pre-compute if body parsing needed
  const needsBody = input ? 'body' in input : false;

  return async (c: Context<HonoEnv>) => {
    const obs = c.get('obs') as ObservabilityClient | undefined;

    // Get organization ID from context (may be set by earlier middleware or policy enforcement)
    let organizationId = c.get('organizationId');

    // Create service registry with cleanup
    // Note: organizationId may be undefined initially, updated after policy enforcement
    let registry: Awaited<ReturnType<typeof createServiceRegistry>>['registry'];
    let cleanup: (() => Promise<void>) | undefined;

    // Handler-registered background work (ctx.background). Cleanup is chained
    // after this settles — see createBackgroundTracker for why waitUntil alone
    // is unsafe for background DB access.
    const tracker = createBackgroundTracker();

    try {
      // ====================================================================
      // Step 1: Enforce Policy (auth, RBAC, IP, org membership)
      // ====================================================================
      await enforcePolicyInline(c, policy, obs);

      // Re-fetch organization ID after policy enforcement (may have been set)
      organizationId = c.get('organizationId');

      // ====================================================================
      // Step 2: Create Service Registry (after org context is resolved)
      // ====================================================================
      // Awaited: the registry resolves a Hyperdrive client here (which
      // dynamically imports node-postgres) BEFORE returning, because its
      // service getters are synchronous.
      const registryResult = await createServiceRegistry(
        c.env,
        obs,
        organizationId,
        c.executionCtx,
        // Hyperdrive binding selection is DERIVED from the declared cache
        // preset (Codex-s1i7h). Passing it here — rather than letting the
        // registry guess, or each route choose — is what keeps the choice out
        // of 199 call sites. An absent preset resolves to the cache-disabled
        // binding, so a route that never opted in cannot be given a 75-second
        // staleness window by accident.
        policy?.cache
      );
      registry = registryResult.registry;
      cleanup = registryResult.cleanup;

      // ====================================================================
      // Step 3: Validate Input
      // ====================================================================
      const validatedInput = await validateInput(c, input, needsBody);

      // ====================================================================
      // Step 4: Build Procedure Context
      // ====================================================================
      const ctx: ProcedureContext<TPolicy, TInput> = buildBaseProcedureContext<
        TPolicy,
        TInput
      >(c, organizationId, validatedInput, registry, obs, tracker.background);

      // ====================================================================
      // Step 5: Execute Handler
      // ====================================================================
      const result = await handler(ctx);

      // ====================================================================
      // Step 6: Return Response with Automatic Envelope
      // ====================================================================
      // The declared cache preset, emitted once, here — no route hand-writes a
      // Cache-Control and no route can forget one. `resolveCacheControl`
      // defaults an undeclared policy to `private`, and the auth-to-preset
      // table is enforced in the type system (see `CachePolicyRule`), so an
      // authenticated route cannot reach this line holding a shared-cache
      // window.
      //
      // SUCCESS PATH ONLY, deliberately. Emitting the preset before the handler
      // would put a route's 60s public window on its 429s and 403s too, and an
      // edge-cached rate-limit response is a self-inflicted outage. Error
      // responses therefore keep the header-less behaviour they have today.
      //
      // A router-level middleware that sets Cache-Control AFTER `await next()`
      // would still win, and NOTHING SHOULD DO THAT. Both instances are gone:
      // content-api's `public.ts` and `journeys.ts` wildcards were deleted when
      // their routes adopted presets. Re-adding one moves the decision out of the
      // policy, where the auth-to-preset type rule cannot see it — which is how
      // `organizations.ts` would have stamped `public` on eight authenticated
      // responses. Declare `cache` on the route instead.
      c.header('Cache-Control', resolveCacheControl(policy));

      if (successStatus === 204) {
        return c.body(null, 204);
      }

      // List responses: PaginatedResult emits { items, pagination } at top level
      if (result instanceof PaginatedResult) {
        return c.json(
          { items: result.items, pagination: result.pagination },
          successStatus
        );
      }
      // Single-item responses: wrapped in { data: T }
      return c.json({ data: result }, successStatus);
    } catch (error) {
      // ====================================================================
      // Step 7: Error Handling
      // ====================================================================
      const { statusCode, response } = mapErrorToResponse(error, { obs });
      return c.json(response, statusCode);
    } finally {
      // ====================================================================
      // Step 8: Cleanup Services
      // ====================================================================
      // Only cleanup if registry was created.
      // Chained AFTER ctx.background work so tearing down the DB pool cannot
      // pull the connection out from under a still-running background task.
      if (cleanup) {
        const runCleanup = cleanup;
        c.executionCtx.waitUntil(tracker.settled().then(() => runCleanup()));
      }
    }
  };
}
