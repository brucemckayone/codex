/**
 * Server-side hooks for session validation and security
 *
 * Runs on every request to:
 * 1. Generate request ID for tracing
 * 2. Validate session with Auth Worker
 * 3. Apply security headers
 * 4. Handle global errors
 */

import { COOKIES } from '@codex/constants';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { nanoid } from 'nanoid';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import type { SessionData, UserData } from '$lib/types';

/**
 * Session validation hook
 * Runs on every request, validates session with Auth Worker
 */
const sessionHook: Handle = async ({ event, resolve }) => {
  // Generate request ID for tracing
  event.locals.requestId = nanoid(10);

  // Extract session cookie
  const sessionCookie = event.cookies.get(COOKIES.SESSION_NAME);

  if (sessionCookie) {
    try {
      const api = createServerApi(event.platform);
      const data = await api.fetch<{ user?: UserData; session?: SessionData }>(
        'auth',
        '/api/auth/session',
        sessionCookie
      );

      // BetterAuth returns { user, session } structure
      event.locals.user = data.user ?? null;
      event.locals.session = data.session ?? null;
      event.locals.userId = data.user?.id ?? null;
    } catch (error) {
      // Auth worker unavailable - log and treat as unauthenticated
      logger.error('Session validation failed', {
        requestId: event.locals.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      event.locals.user = null;
      event.locals.session = null;
      event.locals.userId = null;
    }
  } else {
    event.locals.user = null;
    event.locals.session = null;
    event.locals.userId = null;
  }

  return resolve(event);
};

/**
 * Security headers hook
 * Applies security headers to all responses
 */
const securityHook: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Add security headers
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Request-Id', event.locals.requestId);

  return response;
};

/**
 * Combine hooks in sequence
 */
export const handle = sequence(sessionHook, securityHook);

/**
 * Global error handler
 * Logs errors with request context and tracks in analytics
 */
export const handleError: HandleServerError = async ({ error, event }) => {
  const errorId = event.locals.requestId;

  // Use centralized logger
  logger.trackError(error instanceof Error ? error : new Error(String(error)), {
    requestId: errorId,
    url: event.url.href,
    method: event.url.search,
  });

  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
};
