# Observability: how a log line is made today

`packages/observability/CLAUDE.md` covers the client's API and redaction. This page covers what calls it, and how far a request ID travels.

## Worker requests

`createWorker` mounts these in order (`packages/worker-utils/src/worker-factory.ts:232-237, 312`):

1. **Request tracking** (`createRequestTrackingMiddleware`, `middleware.ts:691-713`). The ID is the inbound `X-Request-ID` header if there is one. Otherwise it is `generateRequestId()`, a Math.random UUIDv4 (`procedure/helpers.ts:38-44`), not `cf-ray`. The ID is stored as `c.requestId` (so `ctx.requestId`) and sent back as the `X-Request-ID` response header. CORS exposes that header (`middleware.ts:141`).
2. **Observability** (`createObservabilityMiddleware`, `middleware.ts:591-612`). It builds a new client for each request from `c.env.ENVIRONMENT` (default `development`), calls `setRequestId`, and stores the client as `c.obs`. When the request ends it logs one `Request processed` line at **info** with url, method, duration, status and userAgent (`index.ts:241-250`).
3. **`onError` → `createErrorHandler`** (`middleware.ts:466-521`). It logs `Unhandled error` with message, `code`, `cause`, stack, path, method and requestId. It answers `{ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }`. The real message and 5 stack lines are sent only when ENVIRONMENT resolves to `development` or `test`.

`info`, `warn` and `error` print in every environment. Only `debug` and a `perf()` under its threshold are limited to `development` (`index.ts:272-350`).

## Where the output goes

Workers Logs (`"observability": { "enabled": true }`) is on for all 8 API workers and `apps/web` (e.g. `workers/auth/wrangler.jsonc:20-21`, `apps/web/wrangler.jsonc:27-29`), not dev-cdn. It is the only destination: no Analytics Engine, Logpush, tail consumer, Sentry or alerting exists. `ANALYTICS?` in `apps/web/src/app.d.ts:33-34` is a type with no binding.

## Correlation stops at each hop

- **Web**: `hooks.server.ts:204` mints `locals.requestId = nanoid(10)` on every request and ignores any inbound header. `:260` returns it as `X-Request-Id`.
- **Web → worker**: the server API client sends only Content-Type and the session Cookie (`apps/web/src/lib/server/api.ts:702-712`). Each worker therefore mints its own ID, and the web's ID never reaches a worker log.
- **Worker → worker**: nothing sends `X-Request-Id`. `HEADERS.REQUEST_ID` (`packages/constants/src/mime.ts:83`) is never used.
- **traceparent**: nothing reads it or sends it.

## The web app's logger

`apps/web/src/lib/observability.ts:41-64` exports one module-level `web-app` client, `development` under vite dev and `production` in every build (deployed dev and staging included, so hashed redaction there too). The request ID goes in as metadata (`lib/server/error-log-context.ts:24-36`, `hooks.server.ts:225`), not through `setRequestId`.

## Browser failures

- A production browser prints nothing; warn and error records go to `POST /api/client-log` by `fetch(keepalive)` (`apps/web/src/lib/client-log.ts:39, 216-221`), redacted in the browser and again on the server. Bounds: 8 KB a record; per tab 10 a minute, 100 an hour, the same error once per 5 minutes (`client-log.ts:10-21, 40-43`).
- `hooks.client.ts:19-51` logs `handleError` (except 404s), uncaught `error` events and `unhandledrejection`.
- The route only accepts same-origin requests and logs each record under the fixed message `client.log` (`apps/web/src/routes/api/client-log/+server.ts:1-18, 101`).
