/**
 * Middleware Chain Factory
 *
 * Creates standardized middleware chains for Cloudflare Workers.
 * Eliminates repetitive middleware setup across custom workers.
 *
 * @module middleware-chain
 */

import type { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import type { Context, Hono, MiddlewareHandler, Next } from 'hono';
import {
  createObservabilityMiddleware,
  createRequestTrackingMiddleware,
  createSecurityHeadersMiddleware,
} from './middleware';

/**
 * Configuration options for creating a standard middleware chain
 */
export interface MiddlewareChainOptions {
  /**
   * Service name for identification (used in observability)
   */
  serviceName: string;

  /**
   * Skip security headers middleware
   * @default false
   */
  skipSecurityHeaders?: boolean;

  /**
   * Skip request tracking middleware (UUID, IP, user agent)
   * @default false
   */
  skipRequestTracking?: boolean;

  /**
   * Enable observability middleware
   * @default false
   */
  enableObservability?: boolean;

  /**
   * Custom middleware to include in the chain
   * These are applied AFTER standard middleware
   */
  customMiddleware?: MiddlewareHandler<HonoEnv>[];
}

/**
 * Configuration for applying middleware chain to specific routes
 */
export interface ApplyMiddlewareChainOptions extends MiddlewareChainOptions {
  /**
   * Rate limit preset to apply to the route
   * If provided, rate limiting middleware will be included
   */
  rateLimitPreset?: keyof typeof RATE_LIMIT_PRESETS;

  /**
   * Custom rate limit configuration
   * If provided along with rateLimitPreset, this overrides preset values
   */
  rateLimitConfig?: Parameters<typeof rateLimit>[0];
}

/**
 * Creates a standard middleware chain for Cloudflare Workers
 *
 * The standard chain includes (in order):
 * 1. Request tracking (UUID, client IP, user agent) - unless skipRequestTracking is true
 * 2. Security headers - unless skipSecurityHeaders is true
 * 3. Observability middleware - if enableObservability is true
 * 4. Custom middleware - if provided
 *
 * @param options - Configuration options for the middleware chain
 * @returns Array of middleware handlers to apply
 *
 * @example Basic usage
 * ```typescript
 * const middleware = createStandardMiddlewareChain({
 *   serviceName: 'my-api',
 * });
 *
 * // Apply to all routes
 * middleware.forEach(m => app.use('*', m));
 * ```
 *
 * @example With custom middleware
 * ```typescript
 * const middleware = createStandardMiddlewareChain({
 *   serviceName: 'my-api',
 *   customMiddleware: [
 *     createAuthMiddleware(),
 *     createCustomMiddleware(),
 *   ],
 * });
 * ```
 *
 * @example Skip certain middleware
 * ```typescript
 * const middleware = createStandardMiddlewareChain({
 *   serviceName: 'my-api',
 *   skipSecurityHeaders: true,
 * });
 * ```
 */
export function createStandardMiddlewareChain(
  options: MiddlewareChainOptions
): MiddlewareHandler<HonoEnv>[] {
  const {
    serviceName,
    skipSecurityHeaders = false,
    skipRequestTracking = false,
    enableObservability = false,
    customMiddleware = [],
  } = options;

  const chain: MiddlewareHandler<HonoEnv>[] = [];

  // 1. Request tracking (should be first to set requestId, clientIP, userAgent)
  if (!skipRequestTracking) {
    chain.push(createRequestTrackingMiddleware());
  }

  // 2. Security headers
  if (!skipSecurityHeaders) {
    chain.push(createSecurityHeadersMiddleware());
  }

  // 3. Observability
  if (enableObservability) {
    chain.push(createObservabilityMiddleware(serviceName));
  }

  // 4. Custom middleware (applied last so they can access context from standard middleware)
  if (customMiddleware.length > 0) {
    chain.push(...customMiddleware);
  }

  return chain;
}

/**
 * Applies a standard middleware chain to a Hono app at a specific path
 *
 * This is a convenience function that creates a middleware chain and applies
 * it to the specified path pattern. Supports rate limiting configuration.
 *
 * @param app - Hono application instance
 * @param path - Path pattern to apply middleware to (e.g., '*', '/api/*', '/webhooks/*')
 * @param options - Configuration options including rate limiting
 *
 * @example Apply to all routes
 * ```typescript
 * const app = new Hono();
 * applyMiddlewareChain(app, '*', {
 *   serviceName: 'my-api',
 *   enableObservability: true,
 * });
 * ```
 *
 * @example Apply to specific routes with rate limiting
 * ```typescript
 * const app = new Hono();
 * applyMiddlewareChain(app, '/api/*', {
 *   serviceName: 'my-api',
 *   rateLimitPreset: 'api',
 * });
 *
 * applyMiddlewareChain(app, '/webhooks/*', {
 *   serviceName: 'my-api',
 *   rateLimitPreset: 'webhook',
 * });
 * ```
 *
 * @example With custom middleware
 * ```typescript
 * applyMiddlewareChain(app, '/admin/*', {
 *   serviceName: 'my-api',
 *   customMiddleware: [
 *     createAuthMiddleware(),
 *     createAdminCheckMiddleware(),
 *   ],
 *   rateLimitPreset: 'strict',
 * });
 * ```
 */
export function applyMiddlewareChain<T extends HonoEnv = HonoEnv>(
  app: Hono<T>,
  path: string,
  options: ApplyMiddlewareChainOptions
): void {
  const { rateLimitPreset, rateLimitConfig, ...chainOptions } = options;

  // Create standard middleware chain
  const middleware = createStandardMiddlewareChain(chainOptions);

  // Apply each middleware to the path
  for (const handler of middleware) {
    app.use(path, handler);
  }

  // Apply rate limiting if configured
  if (rateLimitPreset) {
    // Import rateLimit and RATE_LIMIT_PRESETS dynamically to avoid circular dependencies
    app.use(path, async (c: Context<T>, next: Next) => {
      // Rate limiting requires importing at runtime
      const { rateLimit, RATE_LIMIT_PRESETS } = await import('@codex/security');

      const config = rateLimitConfig || RATE_LIMIT_PRESETS[rateLimitPreset];

      return rateLimit({
        kv: c.env?.RATE_LIMIT_KV,
        ...config,
      })(c, next);
    });
  }
}

/**
 * Creates a reusable middleware chain builder for consistent configuration
 *
 * Useful when you need to apply the same middleware configuration to multiple
 * path patterns without repeating the options.
 *
 * @param baseOptions - Base configuration options to use for all chains
 * @returns Function that applies middleware to app with specified path and additional options
 *
 * @example
 * ```typescript
 * const app = new Hono();
 *
 * // Create a builder with common options
 * const applyMiddleware = createMiddlewareChainBuilder({
 *   serviceName: 'my-api',
 *   enableObservability: true,
 * });
 *
 * // Apply to different routes with different configs
 * applyMiddleware(app, '*', {});
 * applyMiddleware(app, '/api/*', { rateLimitPreset: 'api' });
 * applyMiddleware(app, '/webhooks/*', { rateLimitPreset: 'webhook' });
 * ```
 */
export function createMiddlewareChainBuilder(
  baseOptions: MiddlewareChainOptions
): <T extends HonoEnv = HonoEnv>(
  app: Hono<T>,
  path: string,
  additionalOptions?: Partial<ApplyMiddlewareChainOptions>
) => void {
  return <T extends HonoEnv = HonoEnv>(
    app: Hono<T>,
    path: string,
    additionalOptions?: Partial<ApplyMiddlewareChainOptions>
  ) => {
    const mergedOptions: ApplyMiddlewareChainOptions = {
      ...baseOptions,
      ...additionalOptions,
      // Merge custom middleware arrays
      customMiddleware: [
        ...(baseOptions.customMiddleware || []),
        ...(additionalOptions?.customMiddleware || []),
      ],
    };

    applyMiddlewareChain(app, path, mergedOptions);
  };
}
