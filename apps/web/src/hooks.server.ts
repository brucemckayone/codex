/**
 * Server-side hooks for session validation and security
 *
 * Runs on every request to:
 * 1. Generate request ID for tracing
 * 2. Validate session with Auth Worker
 * 3. Apply security headers
 * 4. Handle global errors
 */

import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { nanoid } from 'nanoid';
import type { SessionData, UserData } from '$lib/types';

/**
 * Default worker URLs for local development
 */
const DEFAULT_AUTH_URL = 'http://localhost:42069';

/**
 * Session validation hook
 * Runs on every request, validates session with Auth Worker
 */
const sessionHook: Handle = async ({ event, resolve }) => {
  // Generate request ID for tracing
  event.locals.requestId = nanoid(10);

  // Get worker URLs from platform bindings
  const authUrl = event.platform?.env?.AUTH_WORKER_URL ?? DEFAULT_AUTH_URL;

  // Extract session cookie
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      const response = await fetch(`${authUrl}/api/auth/session`, {
        headers: {
          Cookie: `codex-session=${sessionCookie}`,
        },
      });

      if (response.ok) {
        // Cast response to expected type
        const data = (await response.json()) as {
          user?: UserData;
          session?: SessionData;
        };
        // BetterAuth returns { user, session } structure
        event.locals.user = data.user ?? null;
        event.locals.session = data.session ?? null;
        event.locals.userId = data.user?.id ?? null;
      } else {
        // Invalid session - clear locals
        event.locals.user = null;
        event.locals.session = null;
        event.locals.userId = null;
      }
    } catch (error) {
      // Auth worker unavailable - log and treat as unauthenticated
      console.error(
        `[${event.locals.requestId}] Session validation failed:`,
        error
      );
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

// import { i18n } from '$lib/i18n';

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

  console.error(`[${errorId}] Unhandled error:`, error);

  // Track in analytics if available
  event.platform?.env?.ANALYTICS?.writeDataPoint({
    indexes: ['errors'],
    blobs: [
      event.url.pathname,
      error instanceof Error ? error.name : 'UnknownError',
      error instanceof Error ? error.message : String(error),
    ],
  });

  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
};
