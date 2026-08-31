/**
 * Server-side hooks for session validation and security
 *
 * Runs on every request to:
 * 1. Terminate junk reserved hosts (cdn*, preview, …) with a cached 404
 * 2. Serve public CDN assets that the wildcard route shadows off R2
 * 3. Generate request ID for tracing and validate session with Auth Worker
 * 4. Apply security headers
 * 5. Handle global errors
 */

import { APP_SUBDOMAINS, CACHE_PRESETS, COOKIES } from '@codex/constants';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { nanoid } from 'nanoid';
import { dev } from '$app/environment';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { isPublicCdnHost, tryServeCdnAsset } from '$lib/server/cdn-proxy';
import { getSubdomainContext } from '$lib/utils/subdomain';

/**
 * Is this hostname a frontend alias of THIS worker? `codex` and `creators`
 * (plus their `-staging` / preview variants) are reserved, but they sit on
 * dedicated (non-wildcard) routes in `apps/web/wrangler.jsonc` that point at
 * this same worker — the reroute hook serves them real pages. The junk-host
 * filter below must never intercept them.
 */
function isAppFrontendHost(hostname: string): boolean {
  const firstLabel = hostname.split('.')[0];
  return APP_SUBDOMAINS.some(
    (app) => firstLabel === app || firstLabel.startsWith(`${app}-`)
  );
}

/**
 * Reserved labels this worker serves real pages for — the exhaust list that
 * keeps the junk filter below off live product surface. Every entry is a
 * verified-live hostname, not a hypothetical:
 * - `app` / `platform` — the platform frontends (the "Platform frontends"
 *   group in `STATIC_RESERVED_SUBDOMAINS`). `app` is additionally whitelisted
 *   as a PRODUCTION checkout-redirect domain (`ALLOWED_REDIRECT_DOMAINS` in
 *   packages/validation/src/schemas/purchase.ts): Stripe sends paying
 *   customers back to `app.*` success URLs, so a day-cached constant 404
 *   here would break a live payment flow.
 * - `staging` — the staging apex (staging.revelations.studio).
 * - `local` — the Cloudflare tunnel apex (local.revelations.studio).
 */
const SERVED_RESERVED_SUBDOMAINS = new Set([
  'app',
  'platform',
  'staging',
  'local',
]);

/**
 * Pure decision for the junk-host hook: should this hostname be terminated
 * with a bare 404 before any SvelteKit work happens?
 *
 * True ONLY for reserved infrastructure subdomains that nothing in this app
 * serves — scanner traffic to `cdn`, `cdn-dev`, `cdn-resources*`, `cdn-media*`,
 * `preview`, `api`, … which otherwise burns a full SSR pass (session
 * validation, reroute, rendered 404 page) on the account's most expensive
 * worker. Everything else keeps its exact current path:
 * - apex / www / unknown hosts → platform context, never reserved;
 * - `creators` → creator context, never reserved;
 * - organization slugs (incl. unknown ones — they NEED the DB resolution to
 *   produce the normal org 404 page, never 404 them here);
 * - public CDN hosts `cdn-assets*` / `cdn-platform*` → served from R2 by
 *   cdnAssetHook, which runs right after this hook;
 * - frontend aliases of this worker (`codex*`, `creators*`) → dedicated
 *   routes above;
 * - the reserved labels this worker actually serves →
 *   SERVED_RESERVED_SUBDOMAINS.
 */
export function shouldShortCircuitHost(hostname: string): boolean {
  const context = getSubdomainContext(hostname);
  if (context.type !== 'reserved') return false;
  if (isPublicCdnHost(hostname)) return false;
  if (isAppFrontendHost(hostname)) return false;
  return !SERVED_RESERVED_SUBDOMAINS.has(context.subdomain);
}

/**
 * Junk-host short-circuit hook (measured 2026-08-31).
 *
 * Requests to reserved-but-unmatched subdomains used to fall through the whole
 * pipeline and render a full 404 page — 406 of 599 cdn* requests/24h were
 * 404s. This hook answers them at the edge with a constant 404 and a day-long
 * edge cache window, so repeat probes never re-invoke the worker.
 *
 * `cdn-resources*` / `cdn-media*` landing here is the private-bucket security
 * control WORKING (see cdn-proxy.ts header) — same 404 verdict, now cheap.
 * Do not try to serve them.
 *
 * Like cdnAssetHook, this response deliberately carries no session validation
 * and no app security headers: there is no user, no page, and the body is a
 * constant.
 */
export const junkHostHook: Handle = async ({ event, resolve }) => {
  if (!shouldShortCircuitHost(event.url.hostname)) return resolve(event);

  const response = new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // `CACHE_PRESETS.asset` — the existing public window (24h edge), the
      // same preset cdnAssetHook's responses carry. A hand-written
      // `public, max-age=86400, s-maxage=86400` is off-vocabulary and fails
      // check-data-access-contract (RULE 3, no waivers by design).
      'cache-control': CACHE_PRESETS.asset,
    },
  });

  // Best-effort edge-cache write so repeat probes are answered without
  // re-invoking the worker. The Cache API is GET-only and absent in some
  // runtimes (vitest/jsdom), and a cache failure must NEVER break the 404.
  // Awaited, not waitUntil: workerd cancels un-awaited promises the moment
  // the response returns (Codex-e32xz).
  if (event.request.method === 'GET' && typeof caches !== 'undefined') {
    try {
      const cache = await caches.open('junk-host-404');
      await cache.put(event.request, response.clone());
    } catch {
      // Swallowed on purpose — the response below is already correct; only
      // the cache write is lost.
    }
  }

  return response;
};

/**
 * Public CDN asset hook (WP-2 · Codex-fc5oh.2)
 *
 * The production `*.revelations.studio/*` worker route shadows the R2 custom
 * domains cdn-assets / cdn-platform (worker routes win over R2 custom domains).
 * This hook serves those public assets straight from the bound R2 bucket so
 * thumbnails/logos/branding resolve instead of 500ing in SvelteKit.
 *
 * Runs right after the junk-host filter and short-circuits — a public asset
 * must never trigger session validation or carry app security headers. See
 * cdn-proxy.ts for why only the public buckets are handled here.
 */
const cdnAssetHook: Handle = async ({ event, resolve }) => {
  const response = await tryServeCdnAsset(event);
  return response ?? resolve(event);
};

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
 *
 * junkHostHook MUST stay first: it is the cheap terminator for reserved-junk
 * hosts, and it defers (returns resolve(...)) for exactly the hosts the hooks
 * behind it serve — cdnAssetHook's public CDN hosts above all.
 */
export const handle = sequence(
  junkHostHook,
  cdnAssetHook,
  sessionHook,
  securityHook,
  cdnRewriteHook
);

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
