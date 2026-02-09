/**
 * tRPC-style Procedure Pattern
 *
 * Replaces withPolicy() + createAuthenticatedHandler() with a single
 * procedure() function that combines all concerns:
 *
 * - Policy enforcement (auth, RBAC, IP whitelist, org membership)
 * - Input validation (Zod schemas)
 * - Error handling (mapErrorToResponse)
 * - Response envelope ({ data: T })
 * - Service injection (lazy-loaded ctx.services)
 *
 * @example
 * ```typescript
 * import { procedure } from '@codex/worker-utils';
 *
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
 * ```
 */

export type { OrganizationMembership } from './helpers';
// Helper exports (for advanced use cases)
export {
  enforceIPWhitelist,
  enforcePolicyInline,
  generateRequestId,
  getClientIP,
  validateInput,
} from './helpers';
export * from './multipart-procedure';
// org-helpers: dynamically imported in helpers.ts for code-splitting inside procedure().
// Re-exported here for direct use by route handlers.
export { checkOrganizationMembership } from './org-helpers';
// Main procedure function
export { procedure } from './procedure';
export type { ServiceRegistryResult } from './service-registry';
// Service registry factory
export { createServiceRegistry } from './service-registry';
// Type exports
export type {
  AuthLevel,
  InferInput,
  InputSchema,
  ProcedureConfig,
  ProcedureContext,
  ProcedureHandler,
  ProcedurePolicy,
  ServiceRegistry,
  SessionForAuth,
  UserForAuth,
} from './types';
