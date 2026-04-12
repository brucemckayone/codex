# Backend Workers & API Routes -- Code Review

**Date**: 2026-04-07
**Scope**: All 9 workers in `/workers/`
**Reviewer**: Claude Opus 4.6

---

## Review History

| Pass | Date | Notes |
|------|------|-------|
| 1 | 2026-04-07 | Initial review, 40 findings |
| 2 | 2026-04-07 | Verification pass. Corrected 5 errors from Pass 1, removed 2 false positives, added 12 new findings. |
| 3 | 2026-04-07 | Deep-dive pass. Verified Pass 2 findings against source. Corrected 1 finding (subscription stats IDOR narrowed), added 5 new findings from webhook/error/PII deep-dive. Cross-referenced with 02-services.md and 03-security.md. |

### Pass 3 Changes

| Change | Detail |
|--------|--------|
| **NARROWED finding O1** | `/public/:slug` runtime crash confirmed -- `ctx.services.settings` getter throws when `organizationId` is undefined (service-registry.ts:263-264). No fallback exists. Endpoint is broken in its current form. |
| **NARROWED finding 2.3 from security report** | Subscription stats IDOR is real but only exploitable when requests arrive via subdomain routing (production). In local dev (localhost), both the policy and handler read `organizationId` from the same query param. Added precise conditions. |
| **CONFIRMED `rateLimit: 'auth'` misuse** | 8 endpoints verified. Auth preset = 5/15min (confirmed in constants/src/limits.ts:26-29 and security rate-limit test). Too restrictive for content management and checkout. |
| **CONFIRMED email provider cache key** | `auth/src/email.ts:35` stores raw `RESEND_API_KEY` in the comparison string. Low risk (never logged), but the key should be hashed. |
| **NEW finding W1** | Checkout webhook handler swallows all errors silently, preventing Stripe retries for transient failures. |
| **NEW finding W2** | RunPod webhook returns detailed error responses via `mapErrorToResponse()` instead of acknowledging receipt. Transient DB failures cause 500s but RunPod may not retry. |
| **NEW finding W3** | Stripe `transfers.create()` calls in `executeTransfers()` lack idempotency keys. Webhook retries could create duplicate transfers. |
| **NEW finding W4** | `handleInvoicePaymentSucceeded()` DB update + transfers not wrapped in transaction. Partial completion possible. |
| **NEW finding P1** | Auth worker logs user email address in error message (email.ts:74), violating CLAUDE.md PII rules. |
| **REMOVED false positive** from Pass 2 corrections: E6 already correctly downgraded. No further changes needed. |

---

## Executive Summary -- Top 5 Findings

1. **Admin-API auth policy mismatch with CLAUDE.md** -- The admin-api CLAUDE.md specifies `auth: 'platform_owner'` for all endpoints, but every route actually uses `auth: 'required'` + `requireOrgMembership: true` + `requireOrgManagement: true`. This is a weaker authorization model that permits any org owner/admin, not just the platform owner. Security-relevant discrepancy.

2. **Auth worker rate limiting only covers login, not registration** -- `createAuthRateLimiter()` only applies when `path === '/api/auth/email/login'` (line 24 of `rate-limiter.ts`). Registration, password reset, and other auth endpoints are unprotected, contradicting both the auth CLAUDE.md (which documents `auth` rate limiting on register) and the security CLAUDE.md ("`rateLimit: 'auth'` on ALL authentication endpoints").

3. **`GET /api/organizations/public/:slug` crashes at runtime** -- At `organizations.ts:178`, this public no-auth endpoint calls `ctx.services.settings.getBranding()`. The `settings` getter in the service registry (`service-registry.ts:262-268`) throws when `organizationId` is undefined. Since `auth: 'none'` causes `enforcePolicyInline` to return immediately (helpers.ts:222-223), org context is never resolved. The `organizationId` passed to `createServiceRegistry` is `undefined`. The sibling endpoint `/public/:slug/info` (line 330) works correctly by using `fetchPublicOrgInfo()` which creates its own DB client and `BrandingSettingsService` scoped to the resolved org ID. This confirms `/public/:slug` is broken.

4. **Checkout webhook handler swallows ALL errors, preventing Stripe retries for transient failures** -- `handleCheckoutCompleted` (checkout.ts:164-179) catches all errors and returns without throwing. This means `createWebhookHandler` never sees the error, always returns 200 to Stripe, and transient failures (DB connection reset, etc.) are never retried. In contrast, `handleSubscriptionWebhook` and `handleConnectWebhook` let errors propagate to `createWebhookHandler`, which correctly classifies them as transient (500, Stripe retries) or permanent (200, acknowledged). The checkout handler bypasses this classification entirely.

5. **Stripe transfers lack idempotency keys** -- `executeTransfers()` (subscription-service.ts:845-855) calls `stripe.transfers.create()` without an `idempotencyKey`. If a webhook is retried (e.g., due to a network timeout after the transfer succeeded), the same transfer could be created twice. The `transfer_group` parameter is informational only and does not prevent duplicate transfers. This is a financial correctness issue.

---

## Per-Worker Findings

### 1. Auth Worker (`workers/auth/`)

**Files reviewed**: `src/index.ts`, `src/auth-config.ts`, `src/email.ts`, `src/middleware/rate-limiter.ts`, `src/middleware/index.ts`, `src/types.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| A1 | **High** | `middleware/rate-limiter.ts:24` | Rate limiting only covers `POST /api/auth/email/login`. Registration (`/email/register`), password reset (`/email/send-reset-password-email`), and other auth endpoints are unprotected against brute force. The auth CLAUDE.md documents `auth` rate limiting on register. The `@codex/security` CLAUDE.md says "MUST use `rateLimit: 'auth'` on ALL authentication endpoints (login, register, reset)". |
| A2 | **Medium** | `index.ts:97-126` | The `/api/test/verification-token/:email` endpoint does not use `procedure()`. It constructs its own response envelope (`c.json({ token, email })`) which doesn't follow the `{ data: T }` convention. Acceptable since it's test-only and guarded by environment check, but should use procedure pattern for consistency. |
| A3 | **Medium** | `index.ts:134-222` | The `/api/test/fast-register` endpoint has a raw `as unknown as AuthBindings` type cast at line 135 and creates ad-hoc `createDbClient(env)` at line 154. Test-only code, but still violates the service registry rule and has no input validation (line 142 uses raw `c.req.json<>` with a type assertion instead of Zod validation). |
| A4 | **Low** | `index.ts:165` | Hardcoded fallback URL `http://localhost:42069` in the fast-register synthetic request. Should use `getServiceUrl()` from `@codex/constants`. The same pattern appears at line 172 for the Origin header. |
| A5 | **Low** | `auth-config.ts:141-144` | Hardcoded trusted origins include `http://localhost:42069` and `http://lvh.me:3000` / `http://lvh.me:5173`. These should use constants from `@codex/constants` for maintainability. |
| A6 | **Low** | `email.ts:35` | `getEmailProvider()` cache key includes the raw `RESEND_API_KEY` value in a plain string comparison (`const key = \`${env.USE_MOCK_EMAIL}:${env.RESEND_API_KEY}\``). The key is stored in `cachedProviderKey` at module scope. While never logged or exposed externally, the API key should be hashed (e.g., SHA-256 digest) rather than stored as-is in a comparison string. Pass 3: Confirmed by reading email.ts:34-42. |
| A7 | **Info** | `index.ts:36` | Auth worker `createWorker()` omits `enableCors` and `enableRequestTracking` flags. Per `worker-factory.ts:214-216`, defaults are `true`, so these are implicitly enabled. The explicit `enableSecurityHeaders: false` is correct and documented (custom security headers applied via `securityHeadersMiddleware` at line 228). |
| P1 | **Low** | `email.ts:74` | **NEW (Pass 3)**: User email address logged in error message: `Failed to send verification email for user ${user.email}: ${result.error}`. The CLAUDE.md rule states "NEVER log PII (passwords, tokens, emails)". The ObservabilityClient at `packages/observability` is intended to provide PII redaction, but this raw string interpolation bypasses any redaction. Should log a user ID instead. |

#### Positive Notes
- BetterAuth delegation pattern is well-documented and correct.
- Cross-subdomain cookie setup with `.nip.io` support is thorough.
- KV secondary storage for session caching via `createKVSecondaryStorage` is clean.
- HTML escaping in `email.ts:21-28` prevents XSS in verification emails.

---

### 2. Content-API Worker (`workers/content-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/content.ts`, `src/routes/media.ts`, `src/routes/content-access.ts`, `src/routes/public.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| C1 | **Medium** | `routes/content.ts:285`, `routes/media.ts:321` | Delete endpoints use `rateLimit: 'auth'` (5 req/15min, designed for login brute-force prevention) but the JSDoc says "Stricter rate limit for deletion". The `auth` preset is 5/15min -- far too restrictive for content management operations. The `strict` preset (20/min) would be more appropriate. Same issue on org delete at `organizations.ts:566`. |
| C2 | **Medium** | `routes/content-access.ts:15` | `new Hono()` created without generic type parameter `<HonoEnv>`. This is the only route file across all workers without the type parameter (confirmed via grep). While Hono's type inference may compensate when procedure() sets context variables, explicit typing prevents type drift. |
| C3 | **Low** | `routes/content.ts:49-52` | The `Logger` interface is defined locally (`interface Logger { warn(...) }`) to avoid an `@codex/observability` dependency. The same pattern is duplicated in `settings.ts:44-47`. Could be extracted to `@codex/shared-types` or `@codex/observability`. |
| C4 | **Low** | `routes/media.ts:257` | `ctx.env.MEDIA_API_URL` is used directly for the worker-to-worker call. While this works because the value comes from wrangler config, it bypasses the documented `getServiceUrl()` convention from `@codex/constants`. |
| C5 | **Info** | `routes/public.ts:45-48` | Cache-Control middleware applied as a blanket `*` route with 5-minute public cache for content. This is clean and correct. |

#### Positive Notes
- Excellent use of `procedure()` patterns throughout all routes.
- `bumpOrgContentVersion()` helper (lines 58-75) is well-implemented (fire-and-forget via `waitUntil`, proper error handling with `.catch()`).
- `successStatus: 201` for POST create and `204` for DELETE are consistently applied.
- Role-based access (`AUTH_ROLES.CREATOR`, `AUTH_ROLES.ADMIN`) consistently used on mutation endpoints.
- `PaginatedResult` used correctly on all list endpoints.
- `multipartProcedure` for thumbnail upload (line 318) and `binaryUploadProcedure` for media upload (line 172) show proper use of specialized procedure variants.

---

### 3. Organization-API Worker (`workers/organization-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/organizations.ts`, `src/routes/members.ts`, `src/routes/settings.ts`, `src/routes/tiers.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| O1 | **High** | `routes/organizations.ts:178` | `GET /public/:slug` calls `ctx.services.settings.getBranding()` but has `policy: { auth: 'none' }` without `requireOrgMembership`. The `settings` service getter in `service-registry.ts:262-268` throws if `organizationId` is undefined. Since `auth: 'none'` causes `enforcePolicyInline` to return immediately (helpers.ts:222-223), org context is never resolved. `organizationId` is undefined when passed to `createServiceRegistry` (procedure.ts:132). Accessing `ctx.services.settings` triggers the getter which throws: `'organizationId required for settings service'`. Pass 3 confirmed: this is NOT dead code -- it's a live endpoint that crashes on every request. The sibling endpoint `/public/:slug/info` (line 330) works correctly using `fetchPublicOrgInfo()` with a standalone `createDbClient` and explicit `organizationId`. |
| O2 | **High** | `routes/organizations.ts:227-228` | `createDbClient(ctx.env)` called directly in `fetchPublicOrgInfo()`. Creates an ad-hoc DB client and `BrandingSettingsService` instead of using `ctx.services`. Justified by the comment ("Can't use ctx.services.settings -- requires requireOrgMembership"), but the correct fix is adding a public branding service to the registry or allowing the settings service to accept an explicit org ID parameter. |
| O3 | **Medium** | `routes/settings.ts:69` | `createDbClient(env)` inside `updateBrandCache()`. This function creates its own DB client each time it runs. Used from both route handlers and org creation. |
| O4 | **Medium** | `routes/settings.ts:188-189` | Inside `invalidateBrandAndCache()`, another `createDbClient(ctx.env)` call to resolve the org slug for cache invalidation. Three separate `createDbClient` calls in this file alone. |
| O5 | **Medium** | `routes/tiers.ts:47`, `tiers.ts:87`, `tiers.ts:110`, `tiers.ts:134` | `ctx.organizationId as string` type assertion used in POST, PATCH, DELETE, and reorder handlers. The `requireOrgManagement: true` policy guarantees it's set at runtime, but the assertion masks type-safety. A type guard or non-null assertion (`!`) would be more expressive. |
| O6 | **Medium** | `routes/settings.ts:51-52` | Duplicate JSDoc comment opener -- `/**` appears on consecutive lines 51-52. Syntactically harmless (parsed as two nested comments) but indicates sloppy editing. |
| O7 | **Low** | `routes/organizations.ts:447-466` | `GET /api/organizations/:id` uses `auth: 'required'` without scoping by `creatorId`. Any authenticated user can fetch any org by ID. This may be intentional (orgs are semi-public), but should be explicitly documented given the strict scoping rules. |
| O8 | **Low** | `routes/tiers.ts:44` | POST create tier is missing `input: { params: orgIdParamSchema }` for the `:id` URL param. The org ID comes from `ctx.organizationId` (resolved by the `requireOrgManagement` policy), but other tier endpoints (GET, PATCH, DELETE) do validate params with `orgIdParamSchema` or `orgTierParamSchema`. Inconsistent. |
| O9 | **Info** | `routes/tiers.ts:58-67` | GET list tiers uses `auth: 'optional'` (public storefront pricing). This is correct and well-documented. |

#### Positive Notes
- Cache invalidation is thorough (BRAND_KV, CACHE_KV, VersionedCache) with proper `waitUntil` usage.
- Public endpoints correctly use `auth: 'none'` with `rateLimit: 'api'`.
- Settings CRUD is clean with proper `requireOrgManagement` on all mutation endpoints.
- `updateBrandCache` as a named exported function enables reuse from org creation.
- `VersionedCache` integration for public org info (30-min TTL) is well-implemented.

---

### 4. Ecom-API Worker (`workers/ecom-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/checkout.ts`, `src/routes/purchases.ts`, `src/routes/subscriptions.ts`, `src/routes/connect.ts`, `src/handlers/checkout.ts`, `src/handlers/subscription-webhook.ts`, `src/handlers/connect-webhook.ts`, `src/middleware/verify-signature.ts`, `src/utils/webhook-handler.ts`, `src/utils/error-classification.ts`, `src/utils/metadata.ts`, `src/utils/dev-webhook-router.ts`, `src/types.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| W1 | **High** | `handlers/checkout.ts:164-179` | **NEW (Pass 3)**: Checkout webhook handler catches ALL errors and never rethrows. The outer try/catch at line 164 logs the error but does not throw, so `createWebhookHandler` (webhook-handler.ts:61) always returns `{ received: true }` with 200 status. This means transient failures (DB connection reset, Neon timeout) are acknowledged as permanent, preventing Stripe from retrying. Compare with `handleSubscriptionWebhook` and `handleConnectWebhook` which correctly let errors propagate to `createWebhookHandler` for transient/permanent classification via `isTransientError()`. The result: a failed checkout.session.completed webhook (e.g., due to a momentary DB outage) silently loses the purchase with no retry. |
| E1 | **Medium** | `src/utils/metadata.ts` (entire file) | Dead code. This 134-line file exports `validateMetadata`, `validateMetadataStrict`, `extractField`, `hasRequiredFields`, `safeExtractMetadata`, and `formatValidationErrors`. None of these are imported anywhere in the worker (confirmed via grep -- only self-references and a GEMINI.md mention). The actual checkout handler at `handlers/checkout.ts:83` uses `checkoutSessionMetadataSchema` from `@codex/validation` directly. Should be deleted. |
| E2 | **Medium** | `routes/subscriptions.ts:94-106` | The `change-tier` handler calls `changeTier()` then immediately calls `getSubscription()` to return the updated state. This is two DB round-trips where one would suffice if `changeTier()` returned the updated subscription. Same pattern on `cancel` (lines 119-129) and `reactivate` (lines 142-151). Three endpoints with redundant DB queries. |
| E3 | **Medium** | `routes/checkout.ts:92` | `rateLimit: 'auth'` on `/checkout/create` but the JSDoc at line 75 says "Strict rate limiting: 10 requests/minute". The `auth` preset is actually 5/15min, not 10/min. The comment is misleading. Same mismatch on `/checkout/portal-session` (line 139) and `/subscriptions/checkout` (line 37). |
| E4 | **Low** | `routes/subscriptions.ts:89`, `113`, `136` | `change-tier`, `cancel`, and `reactivate` use `POST` when they could be `PATCH` per REST conventions (they modify an existing subscription resource). |
| E5 | **Low** | `handlers/checkout.ts:110` | `DATABASE_URL_LOCAL_PROXY` accessed via type assertion `(c.env as Record<string, string | undefined>)`. This cast is used in all three webhook handlers (`checkout.ts:120`, `subscription-webhook.ts:32`, `connect-webhook.ts:27`). Should add `DATABASE_URL_LOCAL_PROXY` to the shared `Bindings` type in `@codex/shared-types`. |
| E6 | **Info** | `src/index.ts:46-54` | Ecom-api omits `enableCors`, `enableSecurityHeaders`, and `enableRequestTracking` in `createWorker()`. Per `worker-factory.ts:214-216`, all three default to `true`, so this is functionally identical to explicit `true`. Style inconsistency, not a security gap. |

#### Positive Notes
- The `createWebhookHandler()` factory (webhook-handler.ts) is excellent -- eliminates duplication across 6 webhook endpoints with proper transient vs permanent error classification.
- `verifyStripeSignature()` middleware is well-structured with per-endpoint secret selection via path matching.
- `isTransientError()` is thoughtfully implemented with conservative defaults (unknown = permanent, preventing retry storms).
- Proper `waitUntil` usage for cache invalidation in checkout handler.
- `createPerRequestDbClient` with `finally { await cleanup() }` pattern is consistently used across all webhook handlers.
- Subscription and Connect routes are well-structured with proper `procedure()` usage.
- Dev webhook router (`routeDevWebhook`) is a clean solution for local development with the Stripe CLI.

---

### 5. Admin-API Worker (`workers/admin-api/`)

**Files reviewed**: `src/index.ts`, `src/types.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| D1 | **High** | `index.ts` (all routes) | **Auth policy mismatch with documentation.** The CLAUDE.md says "All endpoints require `auth: 'platform_owner'`" but every route uses `auth: 'required'` + `requireOrgMembership: true` + `requireOrgManagement: true`. These are fundamentally different: `auth: 'platform_owner'` checks for the `platform_owner` role on the user record (see `helpers.ts:345-346`), while `requireOrgManagement` only checks that the user is an `owner` or `admin` of some org. Any org admin can access the admin-api, not just the platform owner. |
| D2 | **Medium** | `index.ts:72-77` | Manual rate limiting via middleware on `/api/*` using `RATE_LIMIT_PRESETS.api` instead of per-route `procedure({ policy: { rateLimit: 'api' } })`. This applies rate limiting in addition to whatever procedure might apply, creating double rate limiting. Not broken, but inconsistent with other workers. |
| D3 | **Medium** | `index.ts:354-372` | `POST /api/admin/customers/:customerId/grant-access/:contentId` returns `{ success: true }` at line 369 instead of the created access grant. Per CLAUDE.md conventions, POST create endpoints should return `{ data: T }` with `successStatus: 201`. This endpoint has neither `successStatus: 201` nor returns the created resource. |
| D4 | **Low** | `index.ts:1-2` | `/* eslint-disable -- force wrangler reload */` followed by `/* eslint-enable */`. This is a workaround to trigger file change detection. Should be removed or replaced with a proper solution. |
| D5 | **Low** | `types.ts:14-18` | `AdminVariables` extends `Variables` with `organizationId` and optional `perRequestDb`. The `perRequestDb` field appears unused -- no middleware sets it, and procedure uses the service registry's shared DB client instead. Dead scaffolding. |
| D6 | **Info** | `index.ts` | All routes are defined inline in `index.ts` (~400 lines, 12 endpoints). Other workers extract routes into `/routes/*.ts` files. While functional, this is inconsistent with the project's file organization pattern. |

#### Positive Notes
- Consistent use of `procedure()` throughout.
- `successStatus: 204` correctly used for DELETE.
- `PaginatedResult` used correctly on all list endpoints.
- Good input validation with dedicated admin schemas from `@codex/validation`.
- `statusFilter` mapping at line 214 correctly converts `'all'` to `undefined` for the service layer.

---

### 6. Identity-API Worker (`workers/identity-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/users.ts`, `src/routes/membership.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| I1 | **Medium** | `index.ts:58` | `MEDIA_BUCKET` is listed as `optional` in env validation, but the `identity` service getter in the service registry (`service-registry.ts:534`) requires `ASSETS_BUCKET || MEDIA_BUCKET` and throws if both are missing. `ASSETS_BUCKET` is not listed in env validation at all. If both buckets are absent, the identity service (avatar upload) will crash at runtime with an unhelpful generic Error instead of a clean startup validation error. |
| I2 | **Low** | `routes/users.ts:160-197` | Notification preferences endpoints (`GET/PUT /api/user/notification-preferences`) exist here AND in `notifications-api/routes/preferences.ts` (`GET/PUT /api/notifications/preferences`). The frontend only uses the identity-api version (confirmed: `apps/web/src/lib/server/api.ts:340` calls `/api/user/notification-preferences`). The notifications-api version is dead code from the frontend's perspective. |
| I3 | **Low** | `routes/membership.ts:40` | `checkOrganizationMembership` is imported from `@codex/worker-utils` rather than from a service. This is a utility function that directly queries the database, creating a layer inconsistency where some DB access goes through services and some through utilities. |
| I4 | **Info** | `routes/users.ts:126-158` | `upgrade-to-creator` handler at line 143 correctly awaits KV session invalidation (not fire-and-forget) with clear comments explaining why: "the redirect that follows needs the cache cleared before the browser's next request arrives." Good pattern. |

#### Positive Notes
- Session KV invalidation after role upgrade correctly `await`ed with proper error handling.
- Worker-to-worker auth (`auth: 'worker'`) correctly used for the membership lookup endpoint.
- Clean separation between internal (HMAC) and user-facing (session) endpoints.
- `multipartProcedure` correctly used for avatar upload with file validation.

---

### 7. Notifications-API Worker (`workers/notifications-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/templates.ts`, `src/routes/preview.ts`, `src/routes/preferences.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| N1 | **High** | `routes/preview.ts:75` | `createDbClient(ctx.env)` called directly in the `test-send` handler to query `emailTemplates`. This bypasses the service registry. The template lookup (`db.query.emailTemplates.findFirst(...)`) at line 78 should be a method on `TemplateService`. The access check at line 87 already delegates to `ctx.services.templates.checkTemplateAccess()`, showing the service exists and is available. The template fetch should go through the service too. |
| N2 | **Medium** | `index.ts:82-83` | Two route modules mounted on the same prefix: `app.route('/api/templates', templateRoutes)` and `app.route('/api/templates', previewRoutes)`. While Hono supports this (routes from both modules are registered), it's confusing for maintainability. The preview routes (`/:id/preview` and `/:id/test-send`) would conflict with template routes if any template route also used `/:id/...`. Better to merge into one route file or use a sub-prefix. |
| N3 | **Low** | `routes/templates.ts:41` | Global template routes use `auth: AUTH_ROLES.PLATFORM_OWNER`. This is the correct approach per CLAUDE.md. However, it's inconsistent with admin-api which claims to use `platform_owner` but actually uses `requireOrgManagement`. The notifications-api is the one doing it right. |
| N4 | **Low** | `routes/preferences.ts` | These preference endpoints (`GET/PUT /api/notifications/preferences`) duplicate the identity-api's notification preferences endpoints. Frontend only uses the identity-api version. This file may be dead code from the frontend's perspective. |

#### Positive Notes
- Template scoping (global/org/creator) is well-structured with proper auth policies per scope.
- Proper use of `successStatus: 201` for create and `204` for delete across all template endpoints.
- `PaginatedResult` correctly used on list endpoints.
- `AUTH_ROLES.PLATFORM_OWNER` used as constant reference rather than string literal.
- `rateLimit: 'strict'` correctly applied to preview and test-send endpoints (20/min).

---

### 8. Media-API Worker (`workers/media-api/`)

**Files reviewed**: `src/index.ts`, `src/routes/transcoding.ts`, `src/routes/webhook.ts`, `src/middleware/verify-runpod-signature.ts`, `src/durable-objects/orphaned-file-cleanup-do.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| W2 | **Medium** | `routes/webhook.ts:106-113` | **NEW (Pass 3)**: RunPod webhook handler returns error responses via `mapErrorToResponse()` for any exception (including transient DB failures). This returns 4xx/5xx error bodies to RunPod. Unlike the Stripe pattern (which returns 200 for permanent errors and 500 for transient ones to control retry behaviour), this gives RunPod a mix of status codes that may or may not trigger retries depending on RunPod's webhook retry policy. If RunPod does not retry on 500, transient failures are lost. If it does retry on 400 (validation error), permanent failures cause retry storms. The Stripe webhook handler pattern (`createWebhookHandler` with `isTransientError()`) should be adapted for RunPod. |
| M1 | **Medium** | `routes/webhook.ts:78` | `createDbClient(c.env)` called directly in the webhook handler. This is an accepted exception for webhooks (per CLAUDE.md), but this handler also instantiates `TranscodingService` manually (lines 89-95), duplicating the configuration logic that exists in the service registry. Specifically, the `webhookBaseUrl` fallback logic (line 94: `c.env.API_URL || 'http://localhost:4002'`) differs from the service registry's version which also checks `TRANSCODING_WEBHOOK_URL` (service-registry.ts:409-411). |
| M2 | **Medium** | `routes/webhook.ts:94` | Hardcoded fallback URL `'http://localhost:4002'` for `webhookBaseUrl`. The service registry version at `service-registry.ts:409-412` checks `TRANSCODING_WEBHOOK_URL`, then `API_URL`, then falls back to `'http://localhost:4002'`. The webhook handler skips the `TRANSCODING_WEBHOOK_URL` check. Configuration drift between two instantiation paths. |
| M3 | **Low** | `index.ts:117` | Type cast `(c.env as Record<string, string>).WORKER_SHARED_SECRET` in the orphan cleanup DO route. Should use the proper `HonoEnv['Bindings']` type or the DO's `Env` interface. |
| M4 | **Low** | `middleware/verify-runpod-signature.ts:280` | `(c.set as (key: string, value: string) => void)('rawBody', body)` -- type assertion to work around Hono's type system. This suggests `rawBody` should be added to the `Variables` type in `@codex/shared-types`. |
| M5 | **Low** | `index.ts:56-58` | No `standardDatabaseCheck` in `healthCheck` config. Unlike all other workers (except dev-cdn), the media-api omits a database health check. Since the webhook route directly creates DB clients and the transcoding routes access DB via the service registry, DB health should be checked. |
| M6 | **Info** | `index.ts:125` | The orphan cleanup DO handler (`app.all('/internal/orphan-cleanup/*')`) uses `c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }` type cast. This is necessary because the DO binding isn't in the shared `Bindings` type, but it would be cleaner to extend the Bindings type for this worker. |

#### Positive Notes
- Worker-to-worker HMAC auth (`auth: 'worker'`) correctly used on internal transcoding trigger.
- RunPod HMAC verification is thorough with timing-safe comparison (`timingSafeEqual`), timestamp validation, and replay protection (clock skew check at line 246).
- Durable Object for orphaned file cleanup is well-designed with alarm-based scheduling and proper error handling.
- `waitUntil` correctly used for RunPod dispatch in transcoding trigger (line 56).

---

### 9. Dev-CDN Worker (`workers/dev-cdn/`)

**Files reviewed**: `src/index.ts`

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| X1 | **Low** | `index.ts:57` | CORS headers include `'access-control-allow-headers': '*'`. While this is dev-only, using `*` for allow-headers doesn't work for requests with `Authorization` header unless `access-control-allow-credentials` is also false (which it is here, implicitly). Acceptable for dev-only. |
| X2 | **Info** | `index.ts` | This worker does not use `createWorker()`. It exports a plain `{ fetch }` handler. Acceptable since it's dev-only and doesn't need middleware, auth, or health checks. |

#### Positive Notes
- Dual-mode design (CDN + S3-compatible) is clever and well-documented.
- S3-style XML error responses for boto3 compatibility is a nice touch.
- Clear bucket mapping with both dev and production names.
- Never deployed to production (confirmed in comments and wrangler config).

---

## Cross-Cutting Concerns

### 1. `createWorker()` Configuration Consistency

| Worker | `enableRequestTracking` | `enableCors` | `enableSecurityHeaders` |
|--------|:-----------------------:|:------------:|:-----------------------:|
| auth | default (true) | default (true) | **false** (custom) |
| content-api | **explicit true** | **explicit true** | **explicit true** |
| organization-api | **explicit true** | **explicit true** | **explicit true** |
| ecom-api | default (true) | default (true) | default (true) |
| admin-api | default (true) | default (true) | default (true) |
| identity-api | **explicit true** | **explicit true** | **explicit true** |
| notifications-api | **explicit true** | **explicit true** | **explicit true** |
| media-api | **explicit true** | **explicit true** | **explicit true** |

**Correction from Pass 1**: All defaults are `true` (verified in `worker-factory.ts:214-216`). Ecom-api and admin-api are NOT missing security features -- they inherit defaults. This is a style inconsistency, not a security gap. Five workers explicitly set flags to `true` (redundant but clear); three rely on defaults (concise but implicit).

**Recommendation**: Either always be explicit or always use defaults. Being explicit is clearer and safer against future default changes.

### 2. Service Registry Bypass (`createDbClient` in route handlers)

The strict rule says: "MUST use `ctx.services.*` from the service registry for all services in `procedure()` handlers."

Violations found (excluding webhook handlers and test code):

| File | Line | Context |
|------|------|---------|
| `notifications-api/routes/preview.ts` | 75 | Template lookup in test-send handler |
| `organization-api/routes/organizations.ts` | 227 | Public branding fetcher (no org membership) |
| `organization-api/routes/settings.ts` | 69 | Brand cache update function |
| `organization-api/routes/settings.ts` | 189 | Slug lookup for cache invalidation |

The organization-api violations are partly justified (public endpoints can't use org-scoped services), but the correct solution is adding a public branding service to the registry that accepts an explicit org ID parameter rather than relying on the middleware-resolved `organizationId`.

### 3. Auth Policy Inconsistency (platform_owner)

Two different approaches to admin authorization exist:

| Worker | Approach | Effect |
|--------|----------|--------|
| notifications-api (global templates) | `auth: AUTH_ROLES.PLATFORM_OWNER` | Only users with `platform_owner` role (checked at `helpers.ts:345-346`) |
| admin-api (all endpoints) | `auth: 'required'` + `requireOrgManagement: true` | Any user who is `owner` or `admin` of ANY org |

These are NOT equivalent. The admin-api approach is more permissive. If a platform has multiple organizations, any org admin can access admin analytics for their org. If admin-api is meant to be platform-owner-only, it should use `auth: 'platform_owner'`.

### 4. Rate Limiting Approach Varies

| Worker | Rate Limit Approach |
|--------|-------------------|
| auth | Custom middleware (login only -- incomplete) |
| content-api | Per-route via `procedure()` |
| organization-api | Per-route via `procedure()` |
| ecom-api | Middleware on `/webhooks/*` + per-route on API endpoints |
| admin-api | Middleware on `/api/*` only (no per-route) |
| identity-api | Per-route via `procedure()` |
| notifications-api | Per-route via `procedure()` |
| media-api | Per-route via `procedure()` |

**Recommendation**: Standardize on `procedure({ policy: { rateLimit } })` everywhere. The middleware-level rate limiting in admin-api is redundant and could conflict with procedure-level limits. The auth worker's rate limiting is dangerously incomplete (login only).

### 5. Duplicated Notification Preferences Endpoints

Both `identity-api` and `notifications-api` expose notification preferences endpoints:
- `identity-api`: `GET/PUT /api/user/notification-preferences` (used by frontend)
- `notifications-api`: `GET/PUT /api/notifications/preferences` (unused by frontend)

The frontend at `apps/web/src/lib/server/api.ts:340` only uses the identity-api version. The notifications-api version uses a different service (`ctx.services.preferences`) while the identity-api version uses `ctx.services.identity`. These may diverge in behavior. One should be removed.

### 6. Hardcoded Localhost URLs

Despite the strict rule "MUST use `getServiceUrl()` from `@codex/constants`", several hardcoded localhost URLs exist:

| File | Line | URL | Severity |
|------|------|-----|----------|
| `auth/src/index.ts` | 165, 172 | `http://localhost:42069` | Low (test-only code) |
| `auth/src/auth-config.ts` | 141-144 | `http://localhost:42069`, `http://lvh.me:3000`, `http://lvh.me:5173` | Low (trusted origins, acceptable) |
| `media-api/routes/webhook.ts` | 94 | `http://localhost:4002` | Medium (runtime fallback in webhook handler) |
| `service-registry.ts` | 412 | `http://localhost:4002` | Low (last resort fallback after env vars) |

### 7. `rateLimit: 'auth'` Misuse

The `auth` rate limit preset (5/15min) is designed specifically for brute-force prevention on login/register. It's being reused on several non-auth endpoints where it's too restrictive:

| File | Line | Endpoint | Issue |
|------|------|----------|-------|
| `content.ts` | 285 | DELETE `/api/content/:id` | 5/15min too strict for content management |
| `media.ts` | 321 | DELETE `/api/media/:id` | 5/15min too strict for media management |
| `organizations.ts` | 566 | DELETE `/api/organizations/:id` | 5/15min too strict for org management |
| `checkout.ts` | 92 | POST `/checkout/create` | JSDoc says 10/min but actual is 5/15min |
| `checkout.ts` | 139 | POST `/checkout/portal-session` | 5/15min for portal session creation |
| `subscriptions.ts` | 37 | POST `/subscriptions/checkout` | 5/15min for subscription checkout |
| `subscriptions.ts` | 92 | POST `/subscriptions/change-tier` | 5/15min for tier change |
| `transcoding.ts` | 79 | POST `/api/transcoding/retry/:id` | 5/15min for retry |

The `strict` preset (20/min) would be more appropriate for most of these. The `auth` preset should only be used for actual authentication endpoints.

### 8. Missing `ASSETS_BUCKET` in Environment Validation

Multiple workers use services that require `ASSETS_BUCKET` (identity, imageProcessing, settings) but no worker lists `ASSETS_BUCKET` in its `createEnvValidationMiddleware` `required` array:

| Worker | Service Needing Bucket | Env Validation |
|--------|----------------------|----------------|
| identity-api | `identity` (avatars) | `MEDIA_BUCKET` as optional |
| content-api | `imageProcessing` (thumbnails) | `MEDIA_BUCKET` is in R2 check, `ASSETS_BUCKET` not mentioned |
| organization-api | `settings` (logos) | Neither bucket in validation |

The service registry falls back to `MEDIA_BUCKET` when `ASSETS_BUCKET` is missing, but if BOTH are absent, the crash message is a generic Error, not a clean env validation failure.

### 9. `DATABASE_URL_LOCAL_PROXY` Type Inconsistency

All three ecom-api webhook handlers access `DATABASE_URL_LOCAL_PROXY` via `(c.env as Record<string, string | undefined>).DATABASE_URL_LOCAL_PROXY`. This env var should be added to the shared `Bindings` type in `@codex/shared-types` to eliminate the type assertion. Found at:
- `handlers/checkout.ts:120`
- `handlers/subscription-webhook.ts:32`
- `handlers/connect-webhook.ts:27`

### 10. Webhook Error Handling Inconsistency (NEW -- Pass 3)

Three distinct error handling patterns exist across webhook handlers:

| Handler | Pattern | Retry Behaviour |
|---------|---------|----------------|
| `handleCheckoutCompleted` | Catches all errors, never throws | Always returns 200 -- transient failures are lost forever |
| `handleSubscriptionWebhook` / `handleConnectWebhook` | Lets errors propagate to `createWebhookHandler` | 500 for transient (Stripe retries), 200 for permanent (acknowledged) |
| RunPod webhook (`media-api/routes/webhook.ts`) | Uses `mapErrorToResponse()` | Returns actual HTTP error codes -- RunPod retry policy unknown |

**Recommendation**: All Stripe webhook handlers should follow the subscription/connect pattern -- let errors propagate to `createWebhookHandler` for transient/permanent classification. The checkout handler should remove its outer try/catch or rethrow transient errors. The RunPod webhook should adopt a similar transient/permanent pattern if RunPod supports retry on 500.

### 11. Subscription Webhook Idempotency and Transaction Safety (NEW -- Pass 3)

Several concerns identified in the subscription webhook service layer (also documented in 02-services.md):

| Concern | Location | Risk |
|---------|----------|------|
| **No idempotency key on Stripe transfers** | `subscription-service.ts:845-855` | Webhook retry could duplicate financial transfers. Stripe `transfers.create()` should include an `idempotencyKey` derived from `subscriptionId + invoiceId + transferType`. |
| **DB update + transfers not in transaction** | `handleInvoicePaymentSucceeded:379-400` | If DB update succeeds but `executeTransfers` fails (or vice versa), state is inconsistent. Should be transactional, with transfers as a separate fire-and-forget step if they need to be non-transactional. |
| **TOCTOU in handleSubscriptionCreated** | `subscription-service.ts:237-288` | Idempotency check (line 237-248) + insert (line 271-288) not wrapped in a transaction. Concurrent webhook deliveries could race past the check. The unique constraint on `stripeSubscriptionId` provides defense-in-depth, but the resulting DB error would propagate as an unhandled Drizzle error (500 to Stripe, triggering retries). |
| **`pendingPayouts` insert inside catch block** | `subscription-service.ts:863-869` | If the `pendingPayouts` insert itself fails (constraint violation, DB error), the error is silently swallowed -- no pending payout recorded and no transfer completed. |

### 12. Subscription Stats IDOR (Cross-reference with 03-security.md Finding 2.3)

The subscription stats endpoint at `subscriptions.ts:163-164` uses `ctx.input.query.organizationId` (user-supplied query parameter) while the `requireOrgManagement` policy validates membership against a potentially different org (resolved from subdomain).

**Pass 3 analysis**: The IDOR is exploitable in production subdomain routing but NOT in local development. Here's why:

1. The `requireOrgManagement` policy resolves `organizationId` via three fallbacks (helpers.ts:404-444): URL params -> subdomain extraction -> query parameter.
2. In production, if a request arrives via `acme.revelations.studio`, subdomain extraction succeeds first (returns Acme's org ID). The membership check validates against Acme.
3. The handler then reads `ctx.input.query.organizationId`, which could be ANY org ID the user supplies in the query string (e.g., `?organizationId=<competitor-org-id>`).
4. The mismatch: policy validates membership for Acme, handler queries stats for competitor-org.
5. In local dev (localhost), subdomain extraction returns null (org-helpers.ts:46-48), so both the policy and handler read from the query param -- same value, no mismatch.

The adjacent `subscribers` endpoint (line 180) correctly uses `ctx.organizationId` (the policy-validated org ID). The fix is to change line 164 to use `ctx.organizationId as string`.

---

## Recommendations (Prioritized by Impact)

### Critical (Fix Now)

1. **Fix checkout webhook error handling** -- Remove the outer try/catch in `handleCheckoutCompleted` (checkout.ts:164-179) so errors propagate to `createWebhookHandler` for transient/permanent classification. Transient failures (DB connection reset) need to return 500 so Stripe retries. This is a data loss risk -- failed purchases are silently lost.

2. **Fix subscription stats IDOR** -- Change `subscriptions.ts:164` from `ctx.input.query.organizationId` to `ctx.organizationId as string`. Matches the pattern used in the adjacent `subscribers` endpoint.

3. **Add idempotency keys to Stripe transfers** -- In `executeTransfers()`, pass `idempotencyKey: \`transfer_${subscriptionId}_${invoiceId}_${type}\`` to `stripe.transfers.create()`. Without this, webhook retries can create duplicate financial transfers.

### High Priority

4. **Fix admin-api auth policy** -- Either update all admin-api routes to use `auth: 'platform_owner'` (matching CLAUDE.md and the notifications-api pattern), or update the CLAUDE.md to explicitly document the `requireOrgManagement` approach. This is a security-relevant discrepancy.

5. **Add rate limiting to auth registration endpoint** -- Update `createAuthRateLimiter()` to also cover `/api/auth/email/register` and `/api/auth/email/send-reset-password-email`. Unprotected registration enables account enumeration and resource exhaustion.

6. **Fix or remove `/api/organizations/public/:slug` endpoint** -- This endpoint at `organizations.ts:161-193` calls `ctx.services.settings.getBranding()` without org context, which crashes at runtime. Either fix it to use `fetchPublicOrgInfo()` like the `/info` sibling, or remove it if `/public/:slug/info` has superseded it.

7. **Eliminate `createDbClient` from route handlers** -- For `organization-api`, add a public branding service to the registry that doesn't require org membership. For `notifications-api/preview.ts`, add a `getTemplate(id)` method to `TemplateService`. For settings cache invalidation, refactor `updateBrandCache` to accept a DB client parameter.

### Medium Priority

8. **Fix `rateLimit: 'auth'` misuse** -- Replace `rateLimit: 'auth'` with `rateLimit: 'strict'` on content/media/org delete endpoints and checkout endpoints. The `auth` preset (5/15min) is designed for brute-force prevention, not general-purpose rate limiting.

9. **Wrap `handleInvoicePaymentSucceeded` DB update + transfers in transaction** -- The period update (line 379-391) and transfer execution (line 394-400) should be atomic. If transfers need to happen outside the transaction (because Stripe API calls shouldn't hold a DB lock), split into two phases: (1) transactional DB update with a `transfersPending` flag, (2) fire-and-forget transfer execution that clears the flag on success.

10. **Standardize RunPod webhook error handling** -- Adopt the transient/permanent classification pattern used for Stripe webhooks. Return 200 for all responses to RunPod, with logging for failures. Alternatively, implement the `createWebhookHandler` pattern with RunPod-specific `isTransientError()` logic.

11. **Delete dead code in ecom-api** -- Remove `src/utils/metadata.ts` (134 lines, entirely unused).

12. **Remove duplicate notification preferences endpoints** -- Remove either the `identity-api` or `notifications-api` version. The frontend only uses the `identity-api` version. The `notifications-api` version at `routes/preferences.ts` is dead code from the frontend's perspective.

13. **Fix double DB round-trip in subscription endpoints** -- Have `changeTier()`, `cancelSubscription()`, and `reactivateSubscription()` return the updated subscription so the handler doesn't need a separate `getSubscription()` call.

14. **Add `ASSETS_BUCKET` to environment validation** -- Workers using identity/imageProcessing/settings services should validate `ASSETS_BUCKET` (at least as optional) in their `createEnvValidationMiddleware`.

15. **Fix PII logging in auth email helper** -- Replace `user.email` in error message (email.ts:74) with a user ID or redacted email. Use ObservabilityClient's structured logging with redaction rather than string interpolation.

### Low Priority

16. **Extract the `Logger` interface** -- Used identically in `content.ts:49-52` and `settings.ts:44-47`. Move to `@codex/shared-types` or `@codex/observability`.

17. **Remove `eslint-disable` hack in admin-api** -- Find a proper solution for wrangler reload detection.

18. **Add database health check to media-api** -- All other workers include `standardDatabaseCheck` but media-api omits it despite using DB in webhook handlers.

19. **Standardize admin-api route organization** -- Extract routes from `index.ts` into `routes/analytics.ts`, `routes/content.ts`, `routes/customers.ts` to match the pattern used by all other workers.

20. **Add `rawBody` to shared Variables type** -- Eliminate the type assertion in `verify-runpod-signature.ts:280`.

21. **Add `DATABASE_URL_LOCAL_PROXY` to shared Bindings type** -- Eliminate the type assertion in all three ecom-api webhook handlers.

22. **Fix duplicate JSDoc opener** -- `organization-api/routes/settings.ts:51-52` has `/**` on consecutive lines.

23. **Add `HonoEnv` type parameter to `content-access.ts`** -- The only route file without explicit typing.

24. **Use REST-appropriate HTTP methods for subscription mutations** -- `change-tier`, `cancel`, `reactivate` should be `PATCH` on a subscription resource rather than `POST` to action endpoints.

25. **Hash email provider cache key** -- `auth/src/email.ts:35` stores raw `RESEND_API_KEY` in the comparison string. Use a SHA-256 digest instead.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Workers reviewed | 9 |
| Source files reviewed | 28 (route files) + 9 (index) + 11 (handlers/middleware/utils/types) |
| Total findings | 52 |
| Critical (fix now) | 3 (W1, subscription IDOR, transfer idempotency) |
| High severity | 5 (A1, O1, O2, D1, N1) |
| Medium severity | 17 |
| Low severity | 19 |
| Info | 8 |
| Dead code files | 1 (`metadata.ts`, 134 lines) |
| Dead code endpoints | 2 (notification preferences in notifications-api, possibly `/public/:slug` in org-api) |
| Service registry violations | 4 locations (excluding webhooks) |
| Hardcoded localhost URLs | 4 locations |
| `rateLimit: 'auth'` misuse | 8 endpoints |
| Webhook handler inconsistencies | 3 distinct patterns for error handling |
| Pass 1 errors corrected | 5 |
| Pass 1 false positives removed | 2 |
| New findings in Pass 2 | 12 |
| New findings in Pass 3 | 5 (W1, W2, W3/W4 financial, P1 PII, narrowed IDOR) |

### Severity Distribution

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 5 |
| Medium | 17 |
| Low | 19 |
| Info | 8 |

---

## Cross-Report Consistency (Pass 3)

### Overlapping findings with 03-security.md

| This Report | Security Report | Status |
|------------|----------------|--------|
| A1 (auth rate limiting) | 1.1 (auth rate limiting only on login) | **Consistent**. Both identify the same gap. |
| D1 (admin-api auth policy) | 2.2 (admin-api uses orgManagement not platform_owner) | **Consistent**. Security report downgraded to Low (doc mismatch); this report keeps High because it's the primary finding location. |
| Subscription stats IDOR | 2.3 (subscription stats IDOR via user-supplied orgId) | **Pass 3 narrowed**: exploitable only via subdomain routing, not local dev. Both reports should be updated. |
| O1 (/public/:slug crash) | Not in security report | **Expected**: security report focuses on access control, not runtime crashes. |

### Overlapping findings with 02-services.md

| This Report | Services Report | Status |
|------------|----------------|--------|
| W3/W4 (transfer idempotency, transaction safety) | C3 (subscription webhook handlers lack transactional idempotency) | **Consistent**. Services report identified the same concern from the service layer side. |
| W1 (checkout error swallowing) | Not in services report | **Expected**: services report covers service internals, not webhook handler wrappers. |

### Contradictions found: None.

All three reports are consistent. No findings contradict each other. The primary difference is perspective: this report focuses on worker routing and webhook handling, the services report on service layer patterns, and the security report on access control and data exposure.
