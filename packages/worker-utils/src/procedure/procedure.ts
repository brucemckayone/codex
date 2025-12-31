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
  generateRequestId,
  getClientIP,
  validateInput,
} from './helpers';

import { createServiceRegistry } from './service-registry';
import type {
  InputSchema,
  ProcedureConfig,
  ProcedureContext,
  ProcedureHandler,
  ProcedurePolicy,
} from './types';

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
    let registry: ReturnType<typeof createServiceRegistry>['registry'];
    let cleanup: () => Promise<void>;

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
      const registryResult = createServiceRegistry(c.env, obs, organizationId);
      registry = registryResult.registry;
      cleanup = registryResult.cleanup;

      // ====================================================================
      // Step 3: Validate Input
      // ====================================================================
      const validatedInput = await validateInput(c, input, needsBody);

      // ====================================================================
      // Step 4: Build Procedure Context
      // ====================================================================
      const ctx: ProcedureContext<TPolicy, TInput> = {
        user: c.get('user') as ProcedureContext<TPolicy, TInput>['user'],
        session: c.get('session') as ProcedureContext<
          TPolicy,
          TInput
        >['session'],
        input: validatedInput as ProcedureContext<TPolicy, TInput>['input'],
        requestId: c.get('requestId') || generateRequestId(),
        clientIP: c.get('clientIP') || getClientIP(c),
        userAgent: c.req.header('User-Agent') || 'unknown',
        organizationId: organizationId as ProcedureContext<
          TPolicy,
          TInput
        >['organizationId'],
        organizationRole: c.get('organizationRole'),
        env: c.env,
        obs,
        services: registry,
      };

      // ====================================================================
      // Step 5: Execute Handler
      // ====================================================================
      const result = await handler(ctx);

      // ====================================================================
      // Step 6: Return Response with Automatic Envelope
      // ====================================================================
      if (successStatus === 204) {
        return c.body(null, 204);
      }

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
      // Only cleanup if registry was created
      if (cleanup!) {
        c.executionCtx.waitUntil(cleanup());
      }
    }
  };
}
