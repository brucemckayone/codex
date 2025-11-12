/**
 * Route Handler Helpers
 *
 * Utilities for reducing boilerplate in route handlers.
 */

import type { Context } from 'hono';
import type { ZodSchema } from 'zod';
import type { HonoEnv, AuthenticatedContext } from '@codex/shared-types';
import { mapErrorToResponse } from '@codex/service-errors';

/**
 * Format validation error response
 */
export function formatValidationError(zodError: any) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: zodError.errors.map((err: any) => ({
        path: err.path.join('.'),
        message: err.message,
      })),
    },
  };
}

/**
 * Check if user is authenticated and return user or throw error
 */
export function requireUser(c: Context<HonoEnv>) {
  const user = c.get('user');
  if (!user) {
    return null;
  }
  return user;
}

/**
 * Create an authenticated route handler with automatic validation and error handling
 *
 * @example
 * ```typescript
 * app.post('/', createAuthenticatedHandler({
 *   schema: createContentSchema,
 *   handler: async (input, ctx) => {
 *     const service = createContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });
 *     return service.create(input, ctx.user.id);
 *   }
 * }));
 * ```
 */
export function createAuthenticatedHandler<TInput, TOutput>(options: {
  schema?: ZodSchema<TInput>;
  handler: (
    input: TInput,
    context: AuthenticatedContext<HonoEnv>
  ) => Promise<TOutput>;
  successStatus?: 200 | 201 | 204;
}) {
  const { schema, handler, successStatus = 200 } = options;

  return async (c: Context<HonoEnv>) => {
    try {
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

      let input: TInput;
      if (schema) {
        const body = await c.req.json();
        const result = schema.safeParse(body);

        if (!result.success) {
          return c.json(formatValidationError(result.error), 400);
        }

        input = result.data;
      } else {
        input = (await c.req.json()) as TInput;
      }

      const context: AuthenticatedContext<HonoEnv> = {
        user,
        session,
        env: c.env,
      };

      const output = await handler(input, context);

      return c.json({ data: output }, successStatus);
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(response, statusCode);
    }
  };
}

/**
 * Create a simple GET handler with authentication
 */
export function createAuthenticatedGetHandler<TOutput>(options: {
  handler: (context: AuthenticatedContext<HonoEnv>) => Promise<TOutput>;
}) {
  const { handler } = options;

  return async (c: Context<HonoEnv>) => {
    try {
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

      const context: AuthenticatedContext<HonoEnv> = {
        user,
        session,
        env: c.env,
      };

      const output = await handler(context);

      return c.json({ data: output });
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(response, statusCode);
    }
  };
}

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
