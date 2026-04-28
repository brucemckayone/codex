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
import { dev } from '$app/environment';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';

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
      // Use modern API helper with cookies for type safety
      const api = createServerApi(event.platform, event.cookies);
      const timer = logger.startTimer('session-validation', { threshold: 500 });
      const data = await api.auth.getSession();
      timer.end({ path: event.url.pathname });

      // BetterAuth returns { user, session } on success, or null when
      // the session cookie is invalid/expired (still HTTP 200)
      event.locals.user = data?.user ?? null;
      event.locals.session = data?.session ?? null;
      event.locals.userId = data?.user?.id ?? null;
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
  // Take ownership of Permissions-Policy so platform/edge defaults (Cloudflare's
  // auto-injected `browsing-topics=()`) don't leak into the response and trigger
  // "Unrecognized feature" warnings in browsers without Topics API. Mirrors the
  // value `packages/security` emits for workers.
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()'
  );
  response.headers.set('X-Request-Id', event.locals.requestId);

  // HSTS: 2-year max-age + subdomains. Production-only — pinning HTTPS on
  // a developer's browser via lvh.me would block local HTTP dev, and
  // preview/staging deploys without zone-level HSTS get worker-level
  // protection from this header.
  if (!dev) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains'
    );
  }

  return response;
};

/**
 * Dev-only: rewrite CDN URLs for LAN access via nip.io
 *
 * API workers return CDN URLs as http://localhost:4100/... (via R2_PUBLIC_URL_BASE).
 * When accessing the app from a mobile device over LAN using nip.io DNS,
 * "localhost" on the phone points to the phone itself. This hook rewrites
 * those URLs to use the nip.io hostname so the mobile browser reaches dev-cdn.
 */
const cdnRewriteHook: Handle = async ({ event, resolve }) => {
  if (!dev) return resolve(event);

  const host = event.url.hostname;
  if (!host.endsWith('nip.io')) return resolve(event);

  const ipMatch = host.match(/(\d+\.\d+\.\d+\.\d+)\.nip\.io$/);
  if (!ipMatch) return resolve(event);

  const from = 'localhost:4100';
  const to = `${ipMatch[1]}.nip.io:4100`;

  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll(from, to),
  });

  // transformPageChunk covers HTML; intercept JSON for __data.json & remote functions
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) return response;

  if (contentType.includes('application/json')) {
    const body = await response.text();
    if (!body.includes(from)) return new Response(body, response);
    return new Response(body.replaceAll(from, to), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  return response;
};

/**
 * Combine hooks in sequence
 */
export const handle = sequence(sessionHook, securityHook, cdnRewriteHook);

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

  // In dev mode, expose the real error message for debugging (production
  // keeps the sanitised "unexpected error" message to avoid leaking internals).
  if (dev) {
    const msg = error instanceof Error ? error.message : String(error);
    return { message: msg, code: 'INTERNAL_ERROR' };
  }

  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
};
