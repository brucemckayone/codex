# Security Code Review - Codex Platform

**Date**: 2026-04-07
**Reviewer**: Claude Opus 4.6 (1M context)
**Scope**: Full codebase security audit covering authentication, authorization, input validation, data scoping, rate limiting, worker-to-worker auth, secrets handling, and OWASP Top 10

## Review History

| Pass | Date | Notes |
|---|---|---|
| 1 | 2026-04-07 | Initial audit. 5 Medium, 15 Low, 0 High/Critical |
| 2 | 2026-04-07 | Verified all findings against source. Corrected 3 false positives, added 4 new findings (1 Medium, 3 Low). Upgraded 1 finding to Medium. Net: 4 Medium, 17 Low |
| 3 | 2026-04-07 | Verified IDOR finding (downgraded to Low), verified ILIKE finding (confirmed). Added 3 new findings: XSS via `{@html}` in ProseContent (Medium), nip.io in checkout redirect domains (Medium), StructuredData `</script>` injection (Low). Removed 1 false positive (10.2 session expiry is a design choice, not a finding). Net: 5 Medium, 16 Low |

---

## Executive Summary

The Codex platform demonstrates a **strong security posture** overall. The `procedure()` abstraction provides a consistent, centralized enforcement point for authentication, authorization, input validation, and error handling across all workers. Key strengths include:

- Comprehensive session authentication with KV caching and DB fallback
- HMAC-SHA256 worker-to-worker authentication with replay prevention
- Timing-safe comparison functions throughout
- Consistent input validation via Zod schemas
- Proper error mapping that never exposes internal details in production
- Soft deletes enforced at the query helper level
- Zero `as any` casts in production code (verified via grep)
- SVG sanitization properly called in the image processing pipeline
- All Stripe webhook endpoints verified with `verifyStripeSignature()` middleware
- RunPod webhook verified with timing-safe HMAC comparison
- R2 key validation with `isValidR2Key()` blocks path traversal (`..`, `//`, URL-encoded variants, null bytes)
- Login redirect validation correctly prevents open redirects (`startsWith('/')` and `!startsWith('//')`)
- No insecure deserialization patterns (`JSON.parse` only after HMAC signature verification)
- Checkout redirect URLs whitelisted by domain (but see Finding 9.6 re nip.io)

Several issues were identified ranging from **Medium** to **Low** severity. No **Critical** or **High** vulnerabilities were found. The findings below are ordered by severity.

---

## Findings

### 1. Authentication (AuthN)

#### 1.1 Auth Rate Limiting Only Applied to Login Endpoint

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `workers/auth/src/middleware/rate-limiter.ts:24` |
| **Verified** | Pass 2: Confirmed. Line 24 checks `c.req.path === '/api/auth/email/login' && c.req.method === 'POST'` exclusively. |
| **Description** | The auth rate limiter only applies to `POST /api/auth/email/login`. Registration (`POST /api/auth/email/register`), password reset (`POST /api/auth/email/send-reset-password-email`), and email verification endpoints are not rate-limited. Note: the auth worker's CLAUDE.md and security CLAUDE.md both state `rateLimit: 'auth'` should apply to "login, register, password reset". |
| **Risk** | An attacker could brute-force registration to enumerate valid emails, or spam password reset endpoints to flood user inboxes and potentially overwhelm the email provider. |
| **Recommendation** | Extend the rate limiter condition to cover `/api/auth/email/register`, `/api/auth/email/send-reset-password-email`, and `/api/auth/email/reset-password`. |

#### 1.2 Email Enumeration via Login Error Messages

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `workers/auth/src/auth-config.ts:119-124` |
| **Verified** | Pass 2: Confirmed. Comment at lines 119-123 explicitly acknowledges the trade-off. `requireEmailVerification: true` causes BetterAuth to return a specific "email not verified" error on login. |
| **Description** | BetterAuth returns a 403 with a specific "email not verified" message on login, which leaks account existence. The code includes a comment acknowledging this trade-off. |
| **Risk** | Attackers can determine whether an email address is registered. Accepted trade-off per code comment. |
| **Recommendation** | Documented and accepted. No action needed unless stricter anti-enumeration is required. |

#### 1.3 Test Endpoints Guarded by Environment Check Only

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `workers/auth/src/index.ts:97-126` and `workers/auth/src/index.ts:134-222` |
| **Verified** | Pass 2: Confirmed. Lines 98 and 136 use `c.env.ENVIRONMENT || ENV_NAMES.DEVELOPMENT` as fallback. `createEnvValidationMiddleware` at line 55 lists `ENVIRONMENT` as `optional`, not `required`. If `ENVIRONMENT` is unset, it defaults to `'development'`, which passes the guard. |
| **Description** | Two test-only endpoints (`/api/test/verification-token/:email` and `/api/test/fast-register`) are guarded by an `ENVIRONMENT` environment variable check. If `ENVIRONMENT` is not set in production, the fallback `ENV_NAMES.DEVELOPMENT` causes the guard to pass. The `/api/test/fast-register` endpoint bypasses email verification and can create users with any role string (including `platform_owner`). |
| **Risk** | If deployed to production with a missing `ENVIRONMENT` variable, attackers could create verified users with arbitrary roles without email verification, or retrieve verification tokens for any email address. |
| **Recommendation** | (1) Make `ENVIRONMENT` a required env var in the auth worker's `createEnvValidationMiddleware`. (2) Add a defense-in-depth check: require an additional secret header for test endpoints, or move them to a separate route module excluded from production builds. |

#### 1.4 nip.io Wildcard in Trusted Origins

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `workers/auth/src/auth-config.ts:144` |
| **Verified** | Pass 3: Confirmed. Line 144 includes `'http://*.nip.io'` unconditionally in `trustedOrigins`. This is NOT gated behind an environment check -- it is always included regardless of `ENVIRONMENT` value. Note: This is one of THREE locations where nip.io is allowed without environment gating (see also 8.1 CORS middleware and 9.6 checkout redirects). |
| **Description** | `trustedOrigins` includes `'http://*.nip.io'` without environment gating. nip.io resolves any IP, meaning any attacker-controlled subdomain on nip.io would be trusted. |
| **Risk** | Low in practice since this only affects BetterAuth's origin checking for CSRF-like protections, and other defenses (SameSite cookies, Secure flag) exist. However, it broadens the trust surface unnecessarily in production. |
| **Recommendation** | Gate all three nip.io entries (auth trusted origins, CORS middleware, checkout redirect domains) behind `env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT`. |

---

### 2. Authorization (AuthZ)

#### 2.1 Organization `get()` and `list()` Not Scoped by Creator -- DOWNGRADED

| Field | Value |
|---|---|
| **Severity** | Low (downgraded from Medium) |
| **File** | `packages/organization/src/services/organization-service.ts:142-151` (get) and `:279-337` (list) |
| **Verified** | Pass 2: Confirmed that `get()` at line 144 uses `whereNotDeleted(organizations)` without creator scoping, and `list()` at line 287 similarly. However, on review of the business model, organizations are **intentionally public entities** -- their slugs become subdomains, and the public endpoints (`/public/:slug`, `/public/:slug/info`) serve org data to unauthenticated users. The `get()` and `list()` methods are used internally for both public and authenticated flows. The **org-api CLAUDE.md** itself incorrectly states "MUST scope all queries with `scopedNotDeleted(organizations, creatorId)`" but the actual `OrganizationService.get()` signature does not accept `creatorId` -- it was never designed to be creator-scoped. |
| **Risk** | Low. Organizations are semi-public by design (they become subdomains). The `list()` endpoint at the worker level (`GET /api/organizations`) requires `auth: 'required'` and could expose all orgs, but this serves the org switcher functionality. |
| **Recommendation** | Update the `@codex/organization` CLAUDE.md to accurately reflect that org `get()`/`getBySlug()` are intentionally public lookups, while mutation methods (`update`/`delete`) are protected at the route level via `requireOrgManagement`. The doc/code mismatch is a maintenance risk, not a security vulnerability. |

#### 2.2 Admin-API Uses `requireOrgManagement` Instead of `platform_owner`

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `workers/admin-api/src/index.ts` (all endpoints) |
| **Verified** | Pass 2: Confirmed. All admin-api endpoints use `auth: 'required', requireOrgMembership: true, requireOrgManagement: true` (lines 91-94 and all subsequent procedure calls). The admin-api CLAUDE.md states "all endpoints require `auth: 'platform_owner'`" but the implementation allows any org owner/admin. |
| **Description** | The admin-api uses `requireOrgManagement: true` which grants access to any user with `owner` or `admin` role in the organization, not just `platform_owner` users. This is actually reasonable -- it allows org admins to manage their own org's analytics and content. |
| **Risk** | Low. This appears to be by design (the code comments say "admin dashboard for platform owner's organization" but the access model permits org-level admins). The only risk is documentation confusion. |
| **Recommendation** | Update the admin-api CLAUDE.md to accurately reflect the `requireOrgManagement` access model instead of claiming `platform_owner` only. |

#### 2.3 Subscription Stats Endpoint Uses User-Supplied Org ID Instead of Policy-Validated Org ID -- DOWNGRADED

| Field | Value |
|---|---|
| **Severity** | Low (downgraded from Medium) |
| **File** | `workers/ecom-api/src/routes/subscriptions.ts:163-164` |
| **Verified** | Pass 3: Investigated the full org resolution flow in `helpers.ts:396-489`. The `requireOrgManagement` policy resolves org ID from: (1) URL params, (2) subdomain extraction, (3) `organizationId` query parameter. For `/subscriptions/stats?organizationId=X` coming from the SvelteKit server to localhost, subdomain extraction returns null (line 46 of `org-helpers.ts` -- `hostname.includes('localhost')` returns null), so the query parameter fallback is used. The policy resolves `organizationId = X` from the query param (line 436-438) and validates membership against that SAME value. The handler then uses `ctx.input.query.organizationId` which is also `X`. Both values come from the same query string, so there is no IDOR in the normal SSR flow. |
| **Risk** | A subtle IDOR could occur ONLY if: (a) the ecom-api worker is directly reachable via an org subdomain in production (not through the SvelteKit server), AND (b) the subdomain resolves to org A while the query param specifies org B. In this scenario, `ctx.organizationId = org_A` (from subdomain) but `ctx.input.query.organizationId = org_B` (user-supplied). The membership check would validate against org A, but stats would be queried for org B. However, the current architecture routes all ecom-api calls through the SvelteKit server to localhost. |
| **Recommendation** | Defense-in-depth: Change line 164 to use `ctx.organizationId` instead of `ctx.input.query.organizationId`, matching the pattern used in the adjacent `subscribers` endpoint at line 180 (`ctx.organizationId as string`). This eliminates the subtle discrepancy regardless of deployment topology. |

#### 2.4 Organization `update()` and `delete()` Accept ID Without Service-Level Ownership Check

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/organization/src/services/organization-service.ts:184-225` (update) and `:237-265` (delete) |
| **Verified** | Pass 2: Confirmed. These methods accept an org ID without userId. However, the route-level `requireOrgManagement: true` policy ensures only org owners/admins reach these handlers. Defense-in-depth concern only. |
| **Recommendation** | Consider adding a `userId` parameter for belt-and-suspenders validation, consistent with ContentService patterns. |

---

### 3. Input Validation

#### 3.1 Auth Worker Fast-Register Endpoint Lacks Input Validation

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `workers/auth/src/index.ts:142-147` |
| **Verified** | Pass 2: Confirmed. Line 142 uses `c.req.json<{...}>()` with only a basic null check at lines 149-151. The `role` field accepts any string value and is passed directly to BetterAuth's sign-up at line 179. |
| **Description** | The `/api/test/fast-register` endpoint uses raw JSON parsing without Zod validation. The `role` field accepts any string, which could create users with invalid or elevated roles. |
| **Risk** | Combined with Finding 1.3 (env guard bypass), this could allow creation of `platform_owner` users in a misconfigured production deployment. |
| **Recommendation** | Add Zod validation: `emailSchema` for email, role against `AUTH_ROLES` enum, password minimum length. |

#### 3.2 All `procedure()` Endpoints Properly Validated

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed. Grepped for `c.req.json()` in workers -- only found in test endpoints (auth fast-register) and webhook signature verification middleware (which reads raw body for HMAC verification, not user input). All procedure-based handlers use Zod schemas. |

#### 3.3 SVG Sanitization Properly Applied for Logos -- RESOLVED

| Field | Value |
|---|---|
| **Severity** | N/A (False positive from Pass 1, resolved) |
| **Verified** | Pass 2: **Confirmed safe.** `ALLOWED_LOGO_MIME_TYPES` at `packages/validation/src/schemas/settings.ts:45-50` includes `image/svg+xml`. The `ImageProcessingService.processOrgLogo()` at `packages/image-processing/src/service.ts:360-366` explicitly checks for SVG MIME type and calls `sanitizeSvgContent()` before storage. SVG content is properly sanitized. |

#### 3.4 ILIKE Search Queries Do Not Escape Wildcard Characters

| Field | Value |
|---|---|
| **Severity** | Low |
| **Files** | `packages/content/src/services/content-service.ts:692-693`, `packages/content/src/services/content-service.ts:806-807`, `packages/organization/src/services/organization-service.ts:292-293`, `packages/admin/src/services/customer-management-service.ts:69-70` |
| **Verified** | Pass 3: Confirmed all 4 locations still use unescaped `%${search}%`. The one properly escaped implementation at `packages/access/src/services/ContentAccessService.ts:636` uses `search.replace(/%/g, '\\%').replace(/_/g, '\\_')`. |
| **Description** | Search parameters are interpolated directly into `ilike()` patterns as `%${search}%` without escaping SQL `LIKE` wildcard characters (`%` and `_`). Only `ContentAccessService` at line 636 properly escapes wildcards. |
| **Risk** | Low. This is not SQL injection (Drizzle parameterizes the value). Users can craft search terms that match unintended patterns (e.g., `%` matches all records, `_` matches any single character). This is a minor annoyance in practice -- the worst case is returning more results than expected. The Zod input schemas limit search string length, preventing megabyte-sized wildcard strings. |
| **Recommendation** | Apply the same escaping pattern used in `ContentAccessService.listUserLibrary()` to all search implementations: `search.replace(/%/g, '\\%').replace(/_/g, '\\_')`. |

---

### 4. Data Scoping

#### 4.1 Content Service Properly Scoped

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed via grep. Every `findFirst` and `findMany` in `ContentService` uses `scopedNotDeleted(content, creatorId)` or `withCreatorScope()`. Media service similarly scoped. 25+ scoped query calls verified. |

#### 4.2 Admin Content Management Re-fetches Without Org Scope

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/admin/src/services/content-management-service.ts:184-185` and `:248-249` |
| **Verified** | Pass 2: Confirmed. Line 184 uses `eq(schema.content.id, contentId)` without org scope for the re-fetch after publish. The initial check at lines 139-143 correctly scopes by `organizationId`. Within the same transaction, the content ID was validated, so this is a defense-in-depth concern. |
| **Recommendation** | Add `eq(schema.content.organizationId, organizationId)` to re-fetch queries for consistency. |

#### 4.3 Transcoding Service Webhook Handler Queries Without Creator Scope

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/transcoding/src/services/transcoding-service.ts:274` and webhook handler |
| **Verified** | Pass 2: Confirmed. Webhook operations are system-level (RunPod callbacks) authenticated via HMAC, not user-initiated. Intentionally unscoped. |
| **Recommendation** | Acceptable for webhook/internal operations. Add a comment documenting the intentional lack of creator scoping. |

---

### 5. Rate Limiting

#### 5.1 Public Branding Endpoints Missing Explicit Rate Limit -- DOWNGRADED

| Field | Value |
|---|---|
| **Severity** | Low (downgraded from Medium) |
| **File** | `workers/organization-api/src/routes/organizations.ts:164` and `:333` |
| **Verified** | Pass 2: Confirmed. Lines 164 and 333 use `policy: { auth: 'none' }` without explicit `rateLimit`. However, the `enforcePolicyInline` at `packages/worker-utils/src/procedure/helpers.ts:207` sets `rateLimit: policy.rateLimit ?? 'api'` -- meaning the default `'api'` preset (100 req/min) is always applied. The adjacent endpoints at lines 376 and 416 explicitly specify `rateLimit: 'api'` for clarity, but the behavior is identical. |
| **Risk** | Minimal. The implicit default provides the same protection. |
| **Recommendation** | Add explicit `rateLimit: 'api'` for code clarity and to prevent regression if defaults change. This is a code quality issue, not a security gap. |

#### 5.2 Subscription Cancel/Reactivate Missing Strict Rate Limit

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `workers/ecom-api/src/routes/subscriptions.ts:113-131` (cancel) and `:136-152` (reactivate) |
| **Verified** | Pass 2: Confirmed. Cancel and reactivate use default `'api'` rate limit (100 req/min). Checkout and change-tier correctly use `rateLimit: 'auth'` (5 req/15min). |
| **Recommendation** | Add `rateLimit: 'auth'` or `rateLimit: 'strict'` to cancel and reactivate for consistency with other mutation endpoints. |

---

### 6. Worker-to-Worker Auth

#### 6.1 HMAC Implementation is Sound

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed. `packages/security/src/worker-auth.ts` implements: (1) Timestamp-based replay prevention with 60s clock skew and 300s max age, (2) Constant-time comparison with XOR accumulator and max-length iteration for different-length strings, (3) Proper key derivation via `crypto.subtle.importKey`, (4) Signature covers `timestamp:body`. |

#### 6.2 Worker Auth Flag Uses Type Assertion

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/security/src/worker-auth.ts:200` |
| **Verified** | Pass 2: Confirmed. `c.set('workerAuth' as never, true as never)`. This is the **only** `as never` usage in production code (verified via grep -- the only other instance is in a test file). |
| **Risk** | The `workerAuth` context key is only set by the worker-auth middleware after successful HMAC verification. The `as never` bypass is for Hono's type system, not a security bypass. |
| **Recommendation** | Define `workerAuth` in the Hono context Variables type in `@codex/shared-types`. Low priority. |

---

### 7. Secrets & PII

#### 7.1 No Hardcoded Secrets Found in Production Code

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed. Grepped for `.env*` files in packages -- no results. All secrets accessed via `c.env.*` bindings. No hardcoded credentials found. |

#### 7.2 Console Logging in Email Provider Factory

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/notifications/src/providers/index.ts:27-44`, `packages/cloudflare-clients/src/cache/client.ts:36` |
| **Verified** | Pass 2: Confirmed. The `createEmailProvider()` function uses `console.log` at lines 27, 33, 39 and `console.warn` at line 44 for provider selection logging. These log provider type, not sensitive data. The MailHog provider at `packages/notifications/src/providers/mailhog-provider.ts:55-56` logs email subject and recipient to console. |
| **Risk** | Low. Console logging is appropriate for development providers. The MailHog provider logs email `to` address, which could be PII in a misconfigured production environment. |
| **Recommendation** | Ensure the MailHog provider cannot be selected in production (it requires `config.mailhogUrl` to be set, which is a dev-only config). |

#### 7.3 Error Context Includes User Roles in Forbidden Responses

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/worker-utils/src/procedure/helpers.ts:348-349` and `:386-389` |
| **Verified** | Pass 2: Confirmed. Line 348 includes `{ userRole: user.role, required: AUTH_ROLES.PLATFORM_OWNER }` and line 387 includes `{ userRoles, required: mergedPolicy.roles }`. These are passed as `context` to `ForbiddenError`, which is then included as `details` in the API response via `mapErrorToResponse` at `packages/service-errors/src/error-mapper.ts:95`. |
| **Risk** | 403 responses reveal the user's current role(s), aiding reconnaissance. |
| **Recommendation** | Remove `userRole`/`userRoles` from error context, or strip context from 403 responses in `mapErrorToResponse`. |

#### 7.4 Raw `Error` Throws in Production Service Code

| Field | Value |
|---|---|
| **Severity** | Low |
| **Files** | `packages/transcoding/src/services/transcoding-service.ts:106,109,112,171`, `packages/notifications/src/services/template-service.ts:112,285,443`, `packages/notifications/src/services/notifications-service.ts:65,222`, `packages/platform-settings/src/services/branding-settings-service.ts:218,330`, `packages/access/src/services/ContentAccessService.ts:1005-1017`, `packages/cloudflare-clients/src/r2/services/r2-service.ts:157,186` |
| **Description** | Multiple production service files throw raw `new Error(...)` instead of typed `ServiceError` subclasses. Per CLAUDE.md strict rules: "MUST throw typed ServiceError subclasses -- NEVER throw raw strings or generic Error." Most of these are in constructor validation (config checks) or post-insert null checks. |
| **Risk** | Low. Raw `Error` instances are caught by `mapErrorToResponse` which returns a generic 500 "unexpected error occurred" message, so no internal details leak. However, they bypass the structured error handling pattern and lose error classification (these would all appear as 500s instead of more appropriate 400/422 status codes). |
| **Recommendation** | Replace config validation `new Error()` with `ValidationError` and post-insert null checks with `InternalServiceError`. This improves error classification and monitoring without security impact. |

---

### 8. CORS Configuration

#### 8.1 CORS Fallback Returns First Origin When No Match

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/worker-utils/src/middleware.ts:101` |
| **Verified** | Pass 3: Confirmed. When no CORS origin pattern matches, the middleware returns `exactMatchOrigins[0] || 'http://localhost:3000'`. The returned origin does NOT reflect the attacker's origin -- it returns the first configured origin. Browsers will reject the response because the `Access-Control-Allow-Origin` header won't match the requesting origin. |
| **Description** | When no CORS origin pattern matches, a fallback origin is returned instead of denying the request. |
| **Risk** | Low. The CORS spec says the browser rejects the response when the `Access-Control-Allow-Origin` header doesn't match the requesting origin. The TODO comment at line 66 (`///TODO: lets verify these are the real ports we are supposed to be authorizing against`) suggests the exact-match localhost ports may not be accurately configured. |
| **Recommendation** | (1) Return `null` or an empty string when no origin matches to make denial explicit. (2) Audit the hardcoded localhost ports against actual service ports in `SERVICE_PORTS`. |

#### 8.2 nip.io Allowed in CORS Without Environment Gating

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/worker-utils/src/middleware.ts:91` |
| **Verified** | Pass 3: Confirmed. The CORS pattern `/^http:\/\/([\w-]+\.)*\d+\.\d+\.\d+\.\d+\.nip\.io(:\d+)?$/` is always included in `allowedPatterns` regardless of `ENVIRONMENT`. Combined with `credentials: true` at line 103, this allows credentialed CORS from any `*.nip.io` origin. |
| **Description** | The CORS middleware unconditionally allows any HTTP origin matching `*.{ip}.nip.io` with credentials. In production, this means an attacker controlling a nip.io subdomain could issue cross-origin requests. |
| **Risk** | Low in practice. The pattern only matches `http://` (not `https://`), and production cookies are set with `Secure: true`, so browsers would not send cookies over HTTP. However, this should still be environment-gated as defense-in-depth. See also Finding 1.4 (auth trusted origins) and Finding 9.6 (checkout redirects) for the same nip.io pattern in other subsystems. |
| **Recommendation** | Gate the nip.io CORS pattern behind an environment check: only include it when `c.env?.ENVIRONMENT === 'development'`. Apply the same gating to the lvh.me pattern. |

---

### 9. OWASP Top 10

#### 9.1 SQL Injection: Mitigated

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed. All database queries use Drizzle ORM's parameterized query builder. No raw SQL string concatenation found. Even `ilike()` calls use Drizzle's parameterized values (the wildcard-escaping issue in 3.4 is separate from SQL injection). |

#### 9.2 XSS: URL Schema Protection in Place -- WITH EXCEPTIONS

| Field | Value |
|---|---|
| **Severity** | N/A (Partial positive finding -- see 9.5 and 9.7 for exceptions) |
| **Verified** | Pass 3: Confirmed. `urlSchema` blocks `javascript:` and `data:` protocols. SVG sanitization is properly called via `sanitizeSvgContent()` in the image processing pipeline. CSP headers applied to all workers. No `eval()` or `new Function()` in production code (verified via grep). However, `{@html}` is used in two locations (see 9.5 and 9.7). |

#### 9.3 CSRF: SameSite Cookies Provide Primary Protection

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `workers/auth/src/auth-config.ts:81` |
| **Verified** | Pass 2: Confirmed. Line 81 sets `sameSite: 'lax'`. `httpOnly: true` at line 82. `secure` is conditional on environment at lines 83-85 (only enabled when not development/test, which is correct). |
| **Recommendation** | Current protection is adequate for modern browsers. |

#### 9.4 Broken Access Control: Mostly Mitigated

| Field | Value |
|---|---|
| **Verified** | Pass 2: Confirmed. `procedure()` defaults to `auth: 'required'` at line 203 of `helpers.ts`. Only 6 endpoints use `auth: 'none'` across all workers -- 2 in content-api (public content browsing) and 4 in organization-api (public branding/info/creators/members), all with `rateLimit: 'api'` (explicit or default). |

#### 9.5 XSS: `{@html}` in ProseContent With Unsanitized TipTap Output -- NEW

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `apps/web/src/lib/components/editor/ProseContent.svelte:19` and `apps/web/src/lib/editor/render.ts:19-21` |
| **Description** | The `ProseContent` component renders HTML via Svelte's `{@html html}` at line 19. The HTML is generated by `renderContentBody()` in `render.ts`, which has two code paths: (1) TipTap JSON path (line 20-21): calls `generateHTML(content.contentBodyJson, getRenderExtensions('full'))` -- this does NOT sanitize the output. TipTap's `generateHTML` faithfully renders the JSON document, including any raw HTML nodes or attributes that were stored. (2) Markdown path (line 26-30): correctly sanitizes via `DOMPurify.sanitize(rawHtml)`. |
| **Risk** | A creator (authenticated user with content editing privileges) could craft a malicious `contentBodyJson` document (e.g., by directly calling the API rather than using the editor) that includes `<script>`, `onerror`, or other XSS payloads in the JSON structure. When rendered by `generateHTML()` and injected via `{@html}`, this would execute in the context of any user viewing the content page. The attack surface is limited to authenticated creators who can save content, but the impact is stored XSS affecting all viewers. |
| **Recommendation** | Apply `DOMPurify.sanitize()` to the output of `generateHTML()` before returning from `renderContentBody()`. This matches the pattern already used for the markdown path and ensures consistent sanitization regardless of content format. |

#### 9.6 nip.io in Checkout Redirect Domain Whitelist -- NEW

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `packages/validation/src/schemas/purchase.ts:40` |
| **Description** | The `ALLOWED_REDIRECT_DOMAINS` array includes `'nip.io'` unconditionally (not gated by environment). The `checkoutRedirectUrlSchema` at line 63 checks `hostname.endsWith('.nip.io')`, which means any `*.nip.io` hostname passes validation. Since nip.io resolves to whatever IP is in the subdomain, an attacker could register `evil.attacker.nip.io` and submit it as a `successUrl` or `cancelUrl` for Stripe checkout. After payment completes, the user would be redirected to the attacker's domain. |
| **Risk** | An attacker could create a checkout session with `successUrl: 'https://phishing-site.1.2.3.4.nip.io/steal-session'`. After a legitimate payment, the user would be redirected to the attacker's site. The attacker's page could display a convincing "payment confirmed" page while harvesting credentials or session data from URL parameters. Note: Stripe itself doesn't forward sensitive data in the redirect URL, but the user's trust is exploited. |
| **Recommendation** | (1) Remove `'nip.io'` from `ALLOWED_REDIRECT_DOMAINS` entirely, or (2) gate it behind an environment check so it's only allowed in development. This also applies to `'lvh.me'` and `'localhost'` -- consider reading the allowed domains from an environment variable rather than hardcoding development domains in production code. |

#### 9.7 StructuredData Component Vulnerable to `</script>` Injection -- NEW

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `apps/web/src/lib/components/seo/StructuredData.svelte:28` |
| **Description** | The `StructuredData` component uses `{@html \`<script type="application/ld+json">${jsonLd}</script>\`}` where `jsonLd = JSON.stringify(data)`. `JSON.stringify` does NOT escape `</script>` sequences. If any field in the structured data `Record<string, unknown>` contains the string `</script>`, it would close the script tag early, allowing arbitrary HTML injection in the page head. |
| **Risk** | Low. The structured data is constructed server-side from trusted API responses (org names, content titles, URLs). An attacker would need to store a value containing `</script>` in a field that gets included in structured data (e.g., an org name or content title). Input validation with `createSanitizedStringSchema` trims and bounds lengths but does not strip HTML tags from string values. However, the scope of what reaches StructuredData is limited to server-controlled data. |
| **Recommendation** | Replace `JSON.stringify(data)` with a version that escapes `</script>` sequences: `JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>')`. Alternatively, use the standard pattern: `.replace(/</g, '\\u003c')`. |

#### 9.8 Security Headers: Comprehensive

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed at `packages/security/src/headers.ts`. All workers get CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), Permissions-Policy (disables geo/mic/camera/payment), and HSTS (production only, max-age=31536000 with includeSubDomains and preload). |

#### 9.9 Open Redirect: Login Redirect Properly Validated

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 3: Confirmed at `apps/web/src/routes/(auth)/login/+page.server.ts:109-114`. The login redirect parameter is validated with `redirectTo.startsWith('/') && !redirectTo.startsWith('//')`, correctly preventing protocol-relative URL attacks (`//evil.com`) and absolute URL attacks. Falls back to `/library` if validation fails. |

#### 9.10 Path Traversal: R2 Keys Properly Validated

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 3: Confirmed at `packages/transcoding/src/paths.ts:439-465`. The `isValidR2Key()` function checks for `..`, `//`, URL-encoded variants (`%2e`, `%2E`, `%2f`, `%2F`), backslashes, null bytes (`\0`, `%00`), and ensures the key starts with a non-empty segment. R2 keys are generated server-side using `getOriginalKey(creatorId, mediaId, filename)` and validated with `isValidR2Key()` before storage (line 107 of `media-service.ts`). The dev-cdn worker at `workers/dev-cdn/src/index.ts` passes raw URL paths to R2, but this worker is development-only (never deployed -- no `routes` in wrangler.jsonc). |

#### 9.11 Insecure Deserialization: Not Present

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 3: Confirmed. `JSON.parse` is only used in the RunPod webhook handler (`workers/media-api/src/routes/webhook.ts:64`) after HMAC signature verification. All other input parsing goes through `c.req.json()` (Hono's built-in parser) or Zod schema validation via `procedure()`. No `eval()`, `new Function()`, or `unserialize()` patterns found. |

---

### 10. Session Management

#### 10.1 Session Implementation is Robust

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Thoroughly reviewed `packages/security/src/session-auth.ts`. Includes: (1) KV cache with expiration validation at both read and write, (2) DB fallback with `expiresAt > new Date()` check, (3) Expired cache entries proactively deleted, (4) Fire-and-forget cache writes that don't block responses, (5) Session cookie extraction with regex escaping for cookie names (line 105), (6) BetterAuth token extraction (dot-separated format), (7) No PII logged (explicit comments at lines 201, 246, 413). |

---

### 11. Error Information Leakage

#### 11.1 Error Mapper Properly Sanitizes Unknown Errors

| Field | Value |
|---|---|
| **Severity** | N/A (Positive Finding) |
| **Verified** | Pass 2: Confirmed at `packages/service-errors/src/error-mapper.ts:149-154`. Unknown errors return `"An unexpected error occurred"` with no details. `includeStack` defaults to `false`. |

#### 11.2 ServiceError Context Passed Through to Responses

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `packages/service-errors/src/error-mapper.ts:90-98` |
| **Verified** | Pass 2: Confirmed. Line 95 sets `details: error.context`. Most errors include safe context (IDs only), but see Finding 7.3 for role leakage in ForbiddenError. |
| **Recommendation** | Consider implementing a whitelist of allowed context fields, or strip context from non-4xx responses. |

#### 11.3 Worker Auth and RunPod Error Responses Include Metadata

| Field | Value |
|---|---|
| **Severity** | Low |
| **Files** | `packages/security/src/worker-auth.ts:147-148,168-173` and `workers/media-api/src/middleware/verify-runpod-signature.ts:186-194,237-243` |
| **Verified** | Pass 2: Confirmed. Worker auth returns `required` header names and `maxAge`/`age` in error responses. RunPod signature verification similarly returns `required` header name and `maxAge`/`age` values. |
| **Risk** | These tell an attacker exactly which headers are needed and what the timing window is. However, the HMAC secret itself is not exposed, so the information value is limited. |
| **Recommendation** | Remove `required`, `maxAge`, and `age` from error responses in both middleware. Return only generic messages. |

---

## Summary Table

| # | Finding | Severity | Category | Status |
|---|---|---|---|---|
| 1.1 | Auth rate limiting only on login | **Medium** | AuthN | Confirmed |
| 1.2 | Email enumeration via error messages | Low | AuthN | Confirmed (accepted) |
| 1.3 | Test endpoints guarded by env check only | **Medium** | AuthN | Confirmed |
| 1.4 | nip.io wildcard in trusted origins | Low | AuthN | Confirmed |
| 2.1 | Organization get/list not creator-scoped | Low | AuthZ | Downgraded (by design) |
| 2.2 | Admin-API uses orgManagement not platform_owner | Low | AuthZ | Confirmed (doc mismatch) |
| 2.3 | Subscription stats uses user-supplied orgId | Low | AuthZ | Downgraded (same value in SSR flow) |
| 2.4 | Org update/delete no service-level ownership check | Low | AuthZ | Confirmed |
| 3.1 | Fast-register lacks input validation | **Medium** | Validation | Confirmed |
| 3.3 | SVG sanitization for logos | N/A | Validation | Resolved (false positive) |
| 3.4 | ILIKE search lacks wildcard escaping | Low | Validation | Confirmed |
| 4.2 | Admin re-fetch queries missing org scope | Low | Scoping | Confirmed |
| 4.3 | Transcoding webhook queries unscoped | Low | Scoping | Confirmed (by design) |
| 5.1 | Public branding endpoints missing explicit rate limit | Low | Rate Limiting | Downgraded (default applies) |
| 5.2 | Subscription cancel/reactivate missing strict rate limit | Low | Rate Limiting | Confirmed |
| 6.2 | Worker auth flag uses type assertion | Low | W2W Auth | Confirmed |
| 7.2 | Console logging in dev providers | Low | PII | Confirmed |
| 7.3 | Error context includes user roles | Low | PII | Confirmed |
| 7.4 | Raw `Error` throws in service code | Low | Errors | Confirmed |
| 8.1 | CORS fallback returns first origin | Low | CORS | Confirmed |
| 8.2 | **nip.io allowed in CORS without env gating** | Low | CORS | **NEW** |
| 9.3 | No CSRF token (SameSite only) | Low | OWASP | Confirmed |
| 9.5 | **`{@html}` in ProseContent with unsanitized TipTap output** | **Medium** | XSS | **NEW** |
| 9.6 | **nip.io in checkout redirect domain whitelist** | **Medium** | Open Redirect | **NEW** |
| 9.7 | **StructuredData `</script>` injection** | Low | XSS | **NEW** |
| 11.2 | ServiceError context passed to responses | Low | Info Leak | Confirmed |
| 11.3 | Worker auth/RunPod errors include metadata | Low | Info Leak | Confirmed |

### Severity Distribution

| Severity | Count | Change from Pass 2 |
|---|---|---|
| Critical | 0 | -- |
| High | 0 | -- |
| Medium | 5 | +2 new (9.5, 9.6), -1 downgraded (2.3 from Medium to Low) |
| Low | 16 | +3 new (8.2, 9.7, 2.3-downgraded), -1 removed (10.2 session expiry reclassified as design choice) |

**Final count: 5 Medium, 16 Low, 0 High/Critical.**

---

## Cross-Reference with 01-workers-api.md

The following findings from the workers API review (`01-workers-api.md`) overlap with or inform security findings:

| API Review Finding | Security Impact | Covered By |
|---|---|---|
| A1 (auth rate limiting only covers login) | Direct security gap | Finding 1.1 |
| A2/A3 (test endpoints without procedure) | Env guard bypass + no validation | Findings 1.3, 3.1 |
| O1 (`GET /public/:slug` crashes at runtime) | Availability concern, not exploitable | Not a security finding (crashes deny service, don't leak data) |
| O2 (direct `createDbClient()` in route handlers) | Bypasses service registry but not auth | Not a security finding (architectural concern) |
| D1 (admin-api auth policy mismatch) | Weaker auth than documented | Finding 2.2 |
| E1 (dead metadata.ts file) | No security impact | Not a security finding |
| C1 (delete rate limit uses `auth` preset) | Overly restrictive for content ops | Not a security finding (UX issue) |

---

## Positive Security Findings

These architectural decisions significantly strengthen the security posture:

1. **Centralized policy enforcement via `procedure()`** -- Authentication, authorization, rate limiting, and input validation are all handled in one place with `auth: 'required'` as the default.

2. **Zero `as any` casts** -- Verified via comprehensive grep. No type-safety bypasses in production code.

3. **Consistent use of `scopedNotDeleted()` in content/media** -- 25+ scoped query calls verified in ContentService and MediaItemService.

4. **Timing-safe comparisons everywhere** -- Worker-to-worker HMAC (`packages/security/src/worker-auth.ts`), RunPod webhook (`workers/media-api/src/middleware/verify-runpod-signature.ts`), and Stripe signature verification all use constant-time comparison.

5. **Soft deletes enforced** -- `db.delete()` only found in test utilities (`packages/test-utils/`, `packages/worker-utils/src/test-utils.ts`), never in production service code.

6. **Error responses never expose internals** -- `mapErrorToResponse()` returns generic messages for unknown errors. Stack traces disabled by default.

7. **All 6 Stripe webhook endpoints verified** -- Every webhook route in `workers/ecom-api/src/index.ts` (lines 136-189) uses `verifyStripeSignature()` middleware.

8. **Comprehensive security headers** -- All workers apply CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, and HSTS via `createWorker()`.

9. **No hardcoded secrets** -- All sensitive values come from environment bindings. No `.env` files in packages directory.

10. **SVG sanitization in pipeline** -- `sanitizeSvgContent()` is properly called in `ImageProcessingService.processOrgLogo()` before R2 storage.

11. **No `eval()` or `new Function()`** -- Verified via grep. No dynamic code execution in production.

12. **No raw request body access in procedure handlers** -- `c.req.json()` only used in test endpoints and signature verification middleware.

13. **R2 path traversal prevention** -- `isValidR2Key()` blocks `..`, `//`, URL-encoded traversal, null bytes, and backslashes. Keys are generated server-side with `getOriginalKey()`.

14. **Login redirect validation** -- Properly prevents open redirects via `startsWith('/')` and `!startsWith('//')` checks.

15. **Checkout redirect domain whitelist** -- `checkoutRedirectUrlSchema` restricts redirect URLs to known domains (with the nip.io exception noted in Finding 9.6).

16. **No insecure deserialization** -- `JSON.parse` only used after HMAC verification. All user input parsed through Zod schemas.
