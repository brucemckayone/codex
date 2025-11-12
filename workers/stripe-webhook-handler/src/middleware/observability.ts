/**
 * Observability Middleware
 *
 * Provides request timing, error tracking, and logging for webhook handlers.
 * Creates ObservabilityClient and makes it available in context.
 */

import { Context, Next } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import type { StripeWebhookEnv } from '../types';

/**
 * Observability middleware
 *
 * Creates an ObservabilityClient and request timer for each request.
 * The client is available via c.get('obs') in all handlers.
 *
 * @returns Hono middleware handler
 */
export function createObservabilityMiddleware() {
  return async (c: Context<StripeWebhookEnv>, next: Next) => {
    const obs = new ObservabilityClient(
      'stripe-webhook-handler',
      c.env.ENVIRONMENT || 'development'
    );

    // Make observability client available in context
    c.set('obs', obs);

    // Track request timing
    const timer = createRequestTimer(obs, c.req);
    await next();
    timer.end(c.res.status);
  };
}

/**
 * Error handler with observability tracking
 *
 * @param serviceName - Name of the service for logging
 * @returns Error handler function
 */
export function createObservabilityErrorHandler(serviceName: string) {
  return (err: Error, c: Context<StripeWebhookEnv>) => {
    const obs =
      c.get('obs') ||
      new ObservabilityClient(serviceName, c.env.ENVIRONMENT || 'development');

    obs.trackError(err, {
      url: c.req.url,
      method: c.req.method,
    });

    return c.text('Internal Server Error', 500);
  };
}
