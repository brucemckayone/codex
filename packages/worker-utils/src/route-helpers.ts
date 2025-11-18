/**
 * Route Handler Helpers
 *
 * Unified route handler with automatic schema validation and type inference.
 * Supports GET, POST, PATCH, DELETE with automatic body parsing detection.
 *
 * Changes from previous version:
 * - Merged createAuthenticatedHandler and createAuthenticatedGetHandler
 * - Auto-detects when to parse body based on schema
 * - Enriches context with request metadata (ID, IP, user agent)
 * - Supports enriched context for advanced use cases
 */

import { mapErrorToResponse } from '@codex/service-errors';
import type {
  AuthenticatedContext,
  EnrichedAuthContext,
  HonoEnv,
} from '@codex/shared-types';
import type { Context } from 'hono';
import { type ZodError, type ZodSchema, z } from 'zod';

/**
 * Format validation error response
 */
export function formatValidationError(zodError: ZodError) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: zodError.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      })),
    },
  };
}

/**
 * Extended context with validated data
 */
type ValidatedContext<TValidated> = AuthenticatedContext<HonoEnv> & {
  validated: TValidated;
};

/**
 * Enriched validated context with request metadata
 * Used when useEnrichedContext option is enabled
 */
type EnrichedValidatedContext<TValidated> = EnrichedAuthContext<HonoEnv> & {
  validated: TValidated;
};

/**
 * Schema definition for request validation
 * Accepts plain object with optional params, query, and body schemas
 */
type RequestSchema = {
  params?: ZodSchema;
  query?: ZodSchema;
  body?: ZodSchema;
};

/**
 * Infer validated type from request schema
 */
type InferSchemaType<T extends RequestSchema> = {
  [K in keyof T]: T[K] extends ZodSchema ? z.infer<T[K]> : never;
};

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  // Simple UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extract client IP from Cloudflare headers
 */
function getClientIP(c: Context<HonoEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Real-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Get user permissions from user data
 * TODO: Enhance this with actual permission logic
 */
function getUserPermissions(
  user: NonNullable<AuthenticatedContext['user']>
): string[] {
  // Basic role-based permissions
  const permissions: string[] = ['user'];

  if (user.role) {
    permissions.push(user.role);
  }

  return permissions;
}

/**
 * Unified authenticated route handler with automatic body parsing detection
 *
 * Replaces both createAuthenticatedHandler and createAuthenticatedGetHandler.
 * Auto-detects whether to parse body based on presence of `body` in schema.
 *
 * Features:
 * - Automatic body parsing for POST/PATCH/PUT (when body schema provided)
 * - Schema validation with type inference
 * - Request metadata enrichment (optional)
 * - Consistent error handling
 * - 204 No Content support
 *
 * @example Basic usage (GET)
 * ```typescript
 * app.get('/:id', createAuthenticatedHandler({
 *   schema: {
 *     params: z.object({ id: uuidSchema }),
 *   },
 *   handler: async (_c, ctx) => {
 *     return service.get(ctx.validated.params.id, ctx.user.id);
 *   }
 * }));
 * ```
 *
 * @example With body (POST)
 * ```typescript
 * app.post('/', createAuthenticatedHandler({
 *   schema: {
 *     body: createContentSchema,
 *   },
 *   handler: async (_c, ctx) => {
 *     return service.create(ctx.validated.body, ctx.user.id);
 *   },
 *   successStatus: 201
 * }));
 * ```
 *
 * @example With enriched context
 * ```typescript
 * app.post('/', createAuthenticatedHandler({
 *   schema: { body: createContentSchema },
 *   useEnrichedContext: true,
 *   handler: async (_c, ctx) => {
 *     // ctx now includes: requestId, clientIP, userAgent, permissions
 *     console.log('Request from:', ctx.clientIP, ctx.requestId);
 *     return service.create(ctx.validated.body, ctx.user.id);
 *   }
 * }));
 * ```
 */
export function createAuthenticatedHandler<
  TSchema extends RequestSchema,
  TValidated = InferSchemaType<TSchema>,
  TOutput = unknown,
  TUseEnriched extends boolean = false,
>(options: {
  schema: TSchema;
  handler: TUseEnriched extends true
    ? (
        c: Context<HonoEnv>,
        context: EnrichedValidatedContext<TValidated>
      ) => Promise<TOutput>
    : (
        c: Context<HonoEnv>,
        context: ValidatedContext<TValidated>
      ) => Promise<TOutput>;
  successStatus?: 200 | 201 | 204;
  useEnrichedContext?: TUseEnriched;
}) {
  const {
    schema,
    handler,
    successStatus = 200,
    useEnrichedContext = false as TUseEnriched,
  } = options;

  // Detect if body parsing is needed based on schema
  const needsBody = 'body' in schema;

  // Build combined Zod schema from the request schema
  const combinedSchema = z.object(
    schema as Record<string, ZodSchema>
  ) as ZodSchema;

  return async (c: Context<HonoEnv>) => {
    try {
      // ========================================================================
      // Authentication Check
      // ========================================================================

      const user = c.get('user');
      if (!user) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          },
          401
        );
      }

      const session = c.get('session');

      // ========================================================================
      // Request Data Extraction
      // ========================================================================

      // Build rawData object based on what's needed
      const rawData: {
        params?: unknown;
        query?: unknown;
        body?: unknown;
      } = {
        params: c.req.param(),
        query: c.req.query(),
      };

      // Only parse body if schema expects it
      if (needsBody) {
        try {
          rawData.body = await c.req.json();
        } catch {
          return c.json(
            {
              error: {
                code: 'INVALID_JSON',
                message: 'Request body must be valid JSON',
              },
            },
            400
          );
        }
      }

      // ========================================================================
      // Schema Validation
      // ========================================================================

      const result = combinedSchema.safeParse(rawData);

      if (!result.success) {
        return c.json(formatValidationError(result.error), 400);
      }

      // ========================================================================
      // Context Preparation
      // ========================================================================

      if (useEnrichedContext) {
        // Enriched context with request metadata
        const requestId = c.get('requestId') || generateRequestId();
        const clientIP = c.get('clientIP') || getClientIP(c);
        const userAgent = c.req.header('User-Agent') || 'unknown';
        const organizationId = c.get('organizationId');
        const permissions = getUserPermissions(user);

        const enrichedContext: EnrichedValidatedContext<TValidated> = {
          user,
          session,
          env: c.env,
          requestId,
          clientIP,
          userAgent,
          organizationId,
          permissions,
          validated: result.data as TValidated,
        };

        const output = await (
          handler as (
            c: Context<HonoEnv>,
            ctx: EnrichedValidatedContext<TValidated>
          ) => Promise<TOutput>
        )(c, enrichedContext);

        if (successStatus === 204) {
          return c.body(null, 204);
        }

        return c.json({ data: output }, successStatus);
      } else {
        // Standard context
        const context: ValidatedContext<TValidated> = {
          user,
          session,
          env: c.env,
          validated: result.data as TValidated,
        };

        const output = await (
          handler as (
            c: Context<HonoEnv>,
            ctx: ValidatedContext<TValidated>
          ) => Promise<TOutput>
        )(c, context);

        if (successStatus === 204) {
          return c.body(null, 204);
        }

        return c.json({ data: output }, successStatus);
      }
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(response, statusCode);
    }
  };
}

/**
 * Deprecated: Use createAuthenticatedHandler instead
 *
 * This function is kept for backwards compatibility.
 * It's now just an alias to createAuthenticatedHandler.
 *
 * @deprecated Use createAuthenticatedHandler - it auto-detects body parsing
 */
export const createAuthenticatedGetHandler = createAuthenticatedHandler;

/**
 * Wrap a handler function with error handling
 */
export function withErrorHandling<T>(
  handler: (c: Context<HonoEnv>) => Promise<T>
) {
  return async (c: Context<HonoEnv>) => {
    try {
      return await handler(c);
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(response, statusCode);
    }
  };
}
