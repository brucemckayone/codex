# Code Review: Infrastructure, Shared Packages & Build Configuration

**Date:** 2026-04-07
**Scope:** `packages/worker-utils`, `packages/shared-types`, `packages/constants`, `packages/observability`, `packages/image-processing`, `packages/platform-settings`, `packages/test-utils`, `packages/cloudflare-clients`, root configs (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`), wrangler configs, all 22 package.json files, per-package tsconfigs

## Review History

| Pass | Date | Reviewer | Notes |
|---|---|---|---|
| 1 | 2026-04-07 | Agent (automated) | Initial analysis across all packages |
| 2 | 2026-04-07 | Agent (automated) | Source verification, corrected line numbers, found new issues (multipart error classes, double auth, Stripe client duplication, wrangler consistency), removed false positives |
| 3 | 2026-04-07 | Agent (automated) | Deep verification of all Pass 2 findings (all confirmed). New deep-dives: turbo pipeline cache inputs, wrangler staging KV gap (upgraded to HIGH), vite-plugin-dts across 3 packages, withTransaction misleading docs, full dependency graph analysis, per-package tsconfig audit. Corrected enableGlobalAuth worker count (8 not 9). Removed false positive on test cleanup. |

---

## Executive Summary (Top 5 Findings)

1. **Multipart/binary procedure error classes extend `Error`, not `ServiceError`** -- `FileTooLargeError`, `InvalidFileTypeError`, and `MissingFileError` in `multipart-procedure.ts` (lines 148-179) extend `Error`. When `mapErrorToResponse()` handles them, they fall through to the "unknown error" path and return a generic 500 "An unexpected error occurred" instead of a descriptive 400 response. Users uploading an oversized file get an opaque internal server error.

2. **6 staging environments missing KV namespace bindings** -- The auth, admin-api, ecom-api, content-api, organization-api, identity-api, and notifications-api workers do not declare `kv_namespaces` in their staging environment blocks. Wrangler environment overrides do NOT inherit KV bindings from the top level -- they must be explicitly redeclared. Deploying to staging will break session auth (`AUTH_SESSION_KV`) and rate limiting (`RATE_LIMIT_KV`). Only media-api correctly declares KV in staging.

3. **Significant code duplication in procedure variants** -- `procedure()`, `binaryUploadProcedure()`, and `multipartProcedure()` each duplicate the identical 8-step execution flow (policy enforcement, registry creation, input validation, context building, handler execution, response envelope, error handling, cleanup). A security patch to any step must be applied in three places.

4. **Observability hash mode silently degrades to mask mode** -- `ObservabilityClient` sets `mode: 'hash'` for production (line 143 of `index.ts`) but calls synchronous `redactSensitiveData()` which does not support hash mode -- it falls through to `return '[REDACTED]'` (line 98 of `redact.ts`). The async `redactSensitiveDataAsync()` is exported but never called by the client. Hash-based log correlation does not work in production.

5. **Root `tsconfig.json` missing references and paths for 7 packages** -- The `references` array has 22 entries but is missing `@codex/subscription`, `@codex/cache`, `@codex/notifications`, `@codex/transcoding`, `@codex/platform-settings`, `@codex/constants`, and `@codex/admin` (has paths but no reference). The `paths` map is missing the same 6 packages (except admin which has paths). `tsc -b` at root will not type-check these packages.

---

## Per-Package Findings

### 1. `@codex/worker-utils` -- Worker Factory, Procedure Handler, Service Registry

**Files reviewed:**
- `packages/worker-utils/src/procedure/procedure.ts` (202 lines)
- `packages/worker-utils/src/procedure/service-registry.ts` (579 lines)
- `packages/worker-utils/src/procedure/helpers.ts` (493 lines)
- `packages/worker-utils/src/procedure/types.ts` (290 lines)
- `packages/worker-utils/src/procedure/paginated-result.ts` (35 lines)
- `packages/worker-utils/src/procedure/org-helpers.ts` (148 lines)
- `packages/worker-utils/src/procedure/binary-upload-procedure.ts` (313 lines)
- `packages/worker-utils/src/procedure/multipart-procedure.ts` (376 lines)
- `packages/worker-utils/src/worker-factory.ts` (297 lines)
- `packages/worker-utils/src/middleware.ts` (757 lines)
- `packages/worker-utils/src/auth-middleware.ts` (384 lines)
- `packages/worker-utils/src/index.ts`
- `packages/worker-utils/package.json`

#### Strengths
- **Procedure pattern is well-designed**: The tRPC-style `procedure()` function is a clean abstraction that unifies auth, validation, error handling, and response envelopes. The conditional typing system (`UserForAuth<T>`, `SessionForAuth<T>`) provides excellent compile-time safety.
- **Service registry lazy loading**: The getter-based lazy instantiation is efficient -- services are only created when accessed, and a shared WebSocket connection is reused across services via `getSharedDb()`.
- **Comprehensive type inference**: `InferInput<T>` correctly maps Zod schemas to TypeScript types. `ProcedureContext` conditionally types `user` and `organizationId` based on policy configuration.
- **Good error boundaries**: The try/catch/finally pattern in procedure ensures cleanup always runs via `waitUntil`, and errors always flow through `mapErrorToResponse`.
- **ServiceRegistry interface is comprehensive**: The `ServiceRegistry` type in `types.ts` (lines 117-152) covers 19 service getters across 6 domains.

#### Issues

**CRITICAL: Multipart procedure file-validation errors return 500 instead of 400**

`FileTooLargeError`, `InvalidFileTypeError`, and `MissingFileError` in `multipart-procedure.ts` (lines 148-179) extend `Error`, not `ServiceError`. The platform rule is: "MUST throw typed ServiceError subclasses -- NEVER throw raw strings or generic Error."

When these errors propagate to the catch block (line 305), `mapErrorToResponse()` in `error-mapper.ts` checks `isServiceError(error)` (line 88 of `error-mapper.ts`), which returns false because `isServiceError` uses `error instanceof ServiceError` (line 133 of `base-errors.ts`). It then checks `error instanceof ZodError` (line 102), which also fails. The error falls through to the unknown error handler (line 149), which returns `500 INTERNAL_ERROR: "An unexpected error occurred"`.

*Verified:* Read all three error class definitions, the `mapErrorToResponse` function, and the multipart catch block. The full flow is confirmed.

*Fix:* Change all three classes to extend `ValidationError` from `@codex/service-errors`, or create file-specific subclasses of `ValidationError`.

**HIGH: Procedure variant duplication (confirmed)**

`procedure()`, `binaryUploadProcedure()`, and `multipartProcedure()` share an identical execution skeleton:

```
enforcePolicyInline -> createServiceRegistry -> validateInput -> build context -> execute handler -> envelope response -> catch error -> cleanup
```

Verified by reading all three files -- the pattern is byte-for-byte identical except for the body-parsing step. Any fix to the flow (e.g., a security patch to policy enforcement ordering) must be applied in 3 places.

*Recommendation:* Extract a `baseProcedure()` that handles the shared lifecycle and accepts a body-parsing strategy as a parameter.

**HIGH: Duplicate `generateRequestId()` and `getClientIP()` (confirmed)**

`generateRequestId()` (line 635) and `getClientIP()` (line 646) in `middleware.ts` are exact copies of the same functions in `procedure/helpers.ts` (lines 36, 49). The middleware versions are private (`function`, not `export function`), so they can be replaced with imports from helpers.

**HIGH: Monolithic service registry dependency graph (confirmed)**

`packages/worker-utils/package.json` lists 20 workspace dependencies including every service package (`@codex/access`, `@codex/admin`, `@codex/cache`, `@codex/cloudflare-clients`, `@codex/constants`, `@codex/content`, `@codex/database`, `@codex/identity`, `@codex/image-processing`, `@codex/notifications`, `@codex/observability`, `@codex/organization`, `@codex/platform-settings`, `@codex/purchase`, `@codex/security`, `@codex/service-errors`, `@codex/shared-types`, `@codex/subscription`, `@codex/transcoding`, `@codex/validation`). Since each worker imports `@codex/worker-utils`, every worker transitively depends on every service. While bundlers tree-shake unused code for production, this slows `pnpm install`, `turbo build`, and makes the dependency graph artificially dense.

*Recommendation:* Consider extracting the service registry into a separate entrypoint or using a plugin pattern where each worker registers only the services it needs.

**MEDIUM: Service registry creates 4 separate Stripe clients (confirmed)**

The `purchase` (line 300), `subscription` (line 325), `tier` (line 346), and `connect` (line 367) getters each independently call `createStripeClient(stripeKey)`. Each also independently validates `env.STRIPE_SECRET_KEY` with identical error messages. These 4 Stripe SDK instances each hold their own HTTP connection pools and configuration.

*Verification note:* The 4 clients all receive the same `stripeKey` value. There is no per-service Stripe configuration. A shared `getStripeClient()` helper (similar to `getSharedDb()`) would eliminate this.

**MEDIUM: Dead `_images` variable in service registry (confirmed)**

In `service-registry.ts`, `_images` is declared on line 98 as `ImageProcessingService | undefined` but never written to. The `images` getter on lines 427-429 delegates to `this.imageProcessing` instead, which uses the separate `_imageProcessing` variable (line 87). The `_images` variable is dead code.

**MEDIUM: Worker auth middleware execution pattern is fragile (confirmed)**

The worker auth check in `enforcePolicyInline()` (lines 246-274 of `helpers.ts`) uses a Promise wrapper around middleware execution with manual flag tracking. The same pattern repeats for session auth (lines 300-318). This is error-prone -- if the Promise resolves multiple times from different paths, behavior is undefined.

**MEDIUM: `enforcePolicyInline` creates ad-hoc DB clients for platform owner check (confirmed)**

In the platform owner check (lines 356-373 of `helpers.ts`), `enforcePolicyInline` dynamically imports `createDbClient` and creates a new HTTP DB client for the org lookup. This bypasses the service registry's shared connection pattern.

**MEDIUM: `enableGlobalAuth` is effectively dead code in `worker-factory.ts`**

All 8 workers that use `createWorker()` set `enableGlobalAuth: false` (verified by grep -- auth, content-api, organization-api, ecom-api, admin-api, identity-api, notifications-api, media-api). The 9th worker, dev-cdn, does not use `createWorker()` at all. The default value is `true` (line 217 of `worker-factory.ts`), meaning the global auth middleware application on line 283 (`app.use('/api/*', createSessionMiddleware({ required: true }))`) is never active. The factory code, config interface, and public routes logic for this feature are unnecessary complexity.

**LOW: CORS middleware has hardcoded localhost ports with TODO (confirmed)**

`middleware.ts` line 66 has a TODO about verifying hardcoded ports:

```typescript
'http://localhost:3000', ///TODO: lets verify these are the real ports we are supposed to be authorizing against
'http://localhost:5173',
'http://localhost:8787',
```

These should use `SERVICE_PORTS` from `@codex/constants` to stay in sync with actual port assignments.

**LOW: `ERROR_CODES` re-exported from two different sources (confirmed)**

`@codex/worker-utils` exports its own `ERROR_CODES` from `middleware.ts` (line 476) and `@codex/constants` exports `ERROR_CODES` from `errors.ts`. The objects have overlapping keys (`VALIDATION_ERROR`, `NOT_FOUND`, etc.) but the constants version has more domain-specific codes (`R2_SIGNING_ERROR`, `MEDIA_NOT_READY`). The middleware version should be removed in favor of importing from constants.

**LOW: `org-helpers.ts` creates ad-hoc DB clients per call (confirmed)**

Both `extractOrganizationFromSubdomain()` (line 75) and `checkOrganizationMembership()` (line 116) call `createDbClient(env)` to create a fresh HTTP client on each invocation. The TODO on line 111 acknowledges this should use KV caching. For org membership checks on every authenticated org-scoped request, this adds measurable latency.

---

### 2. `@codex/shared-types` -- TypeScript Contracts

**Files reviewed:**
- `packages/shared-types/src/api-responses.ts` (265 lines)
- `packages/shared-types/src/worker-types.ts` (249+ lines)
- `packages/shared-types/src/index.ts`
- `packages/shared-types/package.json`

#### Strengths
- **Zero runtime code**: Package is types-only as documented. No runtime imports leak into bundles.
- **Comprehensive response envelope types**: `ApiSingleEnvelope`, `ApiListEnvelope`, `ApiErrorEnvelope` accurately model the wire format.
- **Good separation**: API responses, worker types, and member types are in separate files.

#### Issues

**MEDIUM: `Bindings` type uses all optional properties (confirmed)**

Every field in the `Bindings` type (worker-types.ts line 14 onwards) is optional (`?`). This means accessing `env.DATABASE_URL` never produces a type error, even if a worker genuinely requires it. Workers get no compile-time warning when they forget to configure a binding.

The service registry compensates for this at runtime with explicit checks and throws (e.g., `if (!stripeKey) throw new Error(...)` on line 294), but compile-time safety would be better.

**LOW: Duplicate response type definitions (confirmed)**

`SingleItemResponse<T>` (line 117) and `ApiSingleEnvelope<T>` (line 77) in api-responses.ts are structurally identical (`{ data: T }`). Similarly, `PaginatedListResponse<T>` and `ApiListEnvelope<T>` are identical. The file comments explain the intended distinction, but in practice they are interchangeable.

**LOW: `@deprecated DeleteOrganizationResponse` still exported (confirmed)**

`DeleteOrganizationResponse` is marked `@deprecated` (line 127) but remains exported. Since DELETE now returns 204 No Content, this type is dead code.

---

### 3. `@codex/constants` -- Service Ports, URLs, Configuration

**Files reviewed:**
- `packages/constants/src/env.ts` (getServiceUrl, validateServiceUrl)
- `packages/constants/src/errors.ts` (ERROR_CODES, STATUS_CODES)
- `packages/constants/src/observability.ts` (SENSITIVE_KEYS, SENSITIVE_PATTERNS)
- `packages/constants/src/commerce.ts` (STRIPE_EVENTS, FEES, CURRENCY)
- `packages/constants/src/index.ts`
- `packages/constants/package.json`

#### Strengths
- **Single source of truth for ports**: `SERVICE_PORTS` is properly centralized.
- **SSRF protection in `getServiceUrl`**: Validates URLs, blocks private IPs in production, blocks cloud metadata services.
- **`RESERVED_SUBDOMAINS_SET`** provides O(1) lookup for slug validation.
- **Comprehensive sensitive key/pattern lists** for observability redaction.
- **Zero dependencies**: Package is self-contained (no workspace deps in `package.json`).
- **Currency constants correct**: `CURRENCY.GBP = 'gbp'` is properly defined (line 49 of commerce.ts).

#### Issues

**MEDIUM: `SENSITIVE_PATTERNS.RANDOM_SECRET` is overly broad (confirmed)**

`SENSITIVE_PATTERNS.RANDOM_SECRET = /[a-zA-Z0-9]{32,}/` (observability.ts line 75) matches any alphanumeric string of 32+ characters. This would match UUIDs (stripped of hyphens), long slugs, base64-encoded content, and other non-secret values, causing legitimate metadata to be redacted from logs.

**LOW: `getServiceUrl` switch statement is verbose (confirmed)**

The switch statement in `getServiceUrl()` (env.ts lines 249-305) has 9 nearly identical cases. Each case follows the same pattern and could be a lookup table.

**LOW: `UrlValidationError.code` type is `keyof typeof ERROR_CODES` (confirmed)**

This means `.code` must be any key from `ERROR_CODES` (19 possible values), but the error is only thrown with 3 specific codes. A narrower union type would be more precise.

---

### 4. `@codex/observability` -- Structured Logging

**Files reviewed:**
- `packages/observability/src/index.ts` (415 lines)
- `packages/observability/src/redact.ts` (305 lines)
- `packages/observability/package.json`

#### Strengths
- **Environment-aware output**: Dev gets colorized human-readable logs; production gets structured JSON.
- **PII redaction built in**: All `log()` calls pass through `redactSensitiveData()` automatically.
- **Performance tracking**: `perf()` and `startTimer()` methods with configurable thresholds.
- **Async hash mode exists**: `redactSensitiveDataAsync()` (redact.ts lines 202-271) correctly implements SHA-256 hashing.

#### Issues

**HIGH: Hash mode silently degrades in production (confirmed)**

`ObservabilityClient.log()` (line 159 of index.ts) calls the synchronous `redactSensitiveData()`:

```typescript
const safeMetadata = event.metadata
  ? redactSensitiveData(event.metadata, this.redactionOptions)
  : undefined;
```

The constructor sets `mode: 'hash'` for production (line 143). But `redactValue()` in redact.ts (lines 83-99) does not implement hash mode synchronously -- it falls through with a comment:

```typescript
// Hash mode handled asynchronously
return '[REDACTED]';
```

This means production logging silently degrades to mask-style redaction. Hash-based correlation, which is the stated purpose, does not work. Either `log()` should await `redactSensitiveDataAsync()`, or production should default to `'mask'`.

**MEDIUM: `vite-plugin-dts` is a runtime dependency (confirmed)**

In `package.json`, `vite-plugin-dts` is listed under `dependencies` (line 30) instead of `devDependencies`. This build tool should not be installed in production contexts.

---

### 5. `@codex/cloudflare-clients` -- R2 and KV Clients

**Files reviewed:**
- `packages/cloudflare-clients/src/r2/services/r2-service.ts` (200 lines)
- `packages/cloudflare-clients/src/r2/services/r2-signing-client.ts` (137 lines)
- `packages/cloudflare-clients/src/cache/client.ts` (116 lines)

#### Strengths
- **Retry logic with exponential backoff + jitter**: R2Service handles transient failures gracefully.
- **Dual client design**: `R2Service` (Worker runtime with binding) and `R2SigningClient` (standalone for tests/scripts) avoids coupling tests to the Worker runtime.
- **CachePurgeClient is well-designed**: Fire-and-forget pattern with batched purge requests (30 URL limit).
- **AbortSignal timeout**: `CachePurgeClient.purgeRequest` uses `AbortSignal.timeout(10_000)` to prevent hanging requests.

#### Issues

**LOW: `R2Service.isRetryable()` uses unchecked cast (confirmed)**

```typescript
private isRetryable(err: unknown) {
  const e = err as { status?: number };
```

Line 81. This could be a type guard instead for safety.

**LOW: `R2Service.generateSignedUrl` and `R2SigningClient.generateSignedUrl` are duplicated (confirmed)**

Both classes implement the same `GetObjectCommand` + `getSignedUrl` pattern. The R2SigningClient also has `generateSignedUploadUrl` which is also duplicated. Extracting a shared signing utility would eliminate ~30 lines of duplication.

---

### 6. `@codex/image-processing` -- Image Resize/Convert

**Files reviewed:**
- `packages/image-processing/src/service.ts` (100+ lines of header)
- `packages/image-processing/package.json`

#### Strengths
- **Defense-in-depth validation**: Checks MIME type, file size, and magic bytes.
- **SVG sanitization**: SVGs are sanitized before storage to prevent XSS.

#### Issues

**HIGH: Massive code duplication across image upload methods (confirmed from Pass 1)**

`processContentThumbnail()`, `processUserAvatar()`, and `processOrgLogo()` each repeat the same ~40-line pattern for variant upload, cleanup on failure, DB update, and orphan tracking. Extracting a `processAndUploadVariants(config)` method would cut significant duplication.

---

### 7. `@codex/platform-settings` -- Settings Facade

**Files reviewed:**
- `packages/platform-settings/src/index.ts` (49 lines)
- `packages/platform-settings/CLAUDE.md`
- `packages/platform-settings/package.json`

#### Strengths
- **Facade pattern** correctly aggregates branding, contact, and feature services behind a single interface.
- **Upsert pattern** ensures settings always exist (INSERT ON CONFLICT UPDATE).

No significant issues found. Well-scoped package with clear boundaries.

---

### 8. `@codex/test-utils` -- Test Infrastructure

**Files reviewed:**
- `packages/test-utils/src/database.ts` (418 lines)
- `packages/test-utils/src/factories.ts` (733 lines)
- `packages/test-utils/package.json`

#### Strengths
- **Comprehensive factories**: Content, media, organizations, memberships, auth entities, and Stripe events all have factory functions with proper type safety using schema types from `@codex/database`.
- **Good test isolation strategy**: Workflow-level Neon branching in CI, shared local DB with unique slugs.
- **Proper LOCAL_PROXY configuration**: The database module correctly sets `neonConfig.useSecureWebSocket = false` and configures the fetch endpoint for local development.
- **`setupTestDatabase()` is efficient**: It simply returns the pre-configured `productionDbWs` singleton (line 195) rather than creating new connections per test file. Connection reuse is good.

#### Issues

**MEDIUM: Stripe event factories default to USD currency (confirmed)**

```typescript
// factories.ts line 624
currency = 'usd',
// factories.ts line 709
currency = 'usd',
```

The platform default is GBP. Tests using default factory values will exercise the wrong currency path. This should be `'gbp'`.

**MEDIUM: `withTransaction()` does not auto-rollback on success**

`withTransaction()` (lines 364-375) wraps test code in `db.transaction()` but does NOT force a rollback. If `testFn` succeeds, the transaction commits and test data persists. The comment "Transaction will auto-rollback if testFn throws" is correct for the error case but misleading -- the function name and documentation suggest it provides test isolation, but it only isolates on failure. For true test isolation, it should throw an error after capturing the result to force rollback, or use a savepoint/rollback pattern.

*Mitigation:* No test files currently call `withTransaction()`, so this is dormant. But if anyone follows the GEMINI.md documentation which recommends it for "auto-rollback," their tests will commit data.

**LOW: `withNeonTestBranch()` is deprecated but still exported (confirmed)**

The function is documented as deprecated (line 90) and is a no-op (line 105), but remains in the public API. Tests that still call it are silently doing nothing.

**LOW: `vite-plugin-dts` is a runtime dependency (confirmed)**

Listed under `dependencies` (line 30 of package.json) instead of `devDependencies`.

---

## Build & Configuration Findings

### Root `tsconfig.json` (Pass 3: Full Audit)

**HIGH: Missing project references and paths for 7 packages (corrected from Pass 2)**

Verified the actual `tsconfig.json` (76 lines). Precise inventory:

**`references` array (22 entries):**
- Workers: auth, content-api, identity-api, organization-api, notifications-api, ecom-api, admin-api (7)
- Packages: access, database, validation, observability, cloudflare-clients, security, test-utils, content, organization, worker-utils, service-errors, shared-types, purchase, identity, image-processing (15)

**Missing from both `references` and `paths`:**

| Package | Has Reference | Has Paths |
|---|---|---|
| `@codex/subscription` | No | No |
| `@codex/cache` | No | No |
| `@codex/notifications` | No | No |
| `@codex/transcoding` | No | No |
| `@codex/platform-settings` | No | No |
| `@codex/constants` | No | No |

**`@codex/admin`**: Has `paths` entries (lines 68-69) but is missing from `references`. Path resolution works in the IDE but `tsc -b` at root will not type-check it.

**Missing workers from `references`:** `media-api` and `dev-cdn` are not in the `references` array. All other 7 workers are.

*Impact:* `tsc -b` at root will not type-check 6 packages plus 2 workers. IDE "Go to Definition" may not resolve across these package boundaries for the 6 packages missing from `paths`.

### Root `tsconfig.json` base config

**Strength: Strict mode is well-configured (confirmed)**

The base config at `config/tsconfig/base.json` enables:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `allowUnusedLabels: false`
- `allowUnreachableCode: false`
- `composite: true` + `incremental: true` (for project references)

### Per-Package `tsconfig.json` (Pass 3: Full Audit)

All 22 packages use identical tsconfig structure:
```json
{
  "extends": "../../config/tsconfig/package.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

No per-package tsconfig issues found. The `package.json` base config properly extends `base.json` and adds `outDir: "dist"` and `tsBuildInfoFile`. Test files are correctly excluded. This is healthy -- a single base config means compiler settings stay consistent across the monorepo.

### `turbo.json` (Pass 3: Deep Dive)

**Strength: Build pipeline is well-configured (confirmed)**

- `build` depends on `^build` (topological ordering) -- correct.
- `test` depends on `^build` (tests run against built packages) -- correct.
- Environment variable passthrough is explicit for tests.
- Cache is enabled for builds/tests.

**MEDIUM: `build` task missing `inputs` -- cache invalidation is too broad**

The `build` task has no `inputs` array:
```json
"build": {
  "dependsOn": ["^build"],
  "outputs": ["dist/**", ".svelte-kit/**", "build/**"],
  "cache": true
}
```

Without `inputs`, Turbo hashes ALL files in each package to determine cache validity. This means non-source changes (README edits, test file changes, CLAUDE.md updates) invalidate the build cache unnecessarily. Adding `"inputs": ["src/**"]` would limit cache invalidation to actual source changes.

Similarly, the `typecheck` and `lint` tasks have no `inputs` specification.

**LOW: `test` task lists 13 environment variables**

The `env` array in the `test` task (lines 18-33) lists 13 variables including all R2 credentials. Any change to these variables invalidates the cache for all test tasks. Consider if all of these are truly needed by every test suite -- most packages do not need R2 credentials.

**LOW: No `globalDependencies` for shared config files**

The turbo config does not declare `globalDependencies` for files that affect all tasks, such as `config/tsconfig/base.json`, `biome.json`, or `pnpm-lock.yaml`. Changes to these files should invalidate all caches. Turbo's default behavior includes `pnpm-lock.yaml` as a global hash input, so the lockfile is covered, but `base.json` and `biome.json` are not.

### `pnpm-workspace.yaml`

No issues. Correctly lists `apps/*`, `workers/*`, `packages/*`, and `e2e`.

### Root `package.json`

**MEDIUM: BetterAuth dependencies in root (confirmed)**

```json
"dependencies": {
  "@better-auth/core": "1.4.11",
  "@opentelemetry/api": "^1.9.0",
  "better-auth": "1.4.11"
}
```

Root-level `dependencies` (not `devDependencies`) for `better-auth` and `@opentelemetry/api`. `better-auth` should only be a dependency of the auth worker, not the root.

**LOW: Knip is configured (confirmed)**

Good -- `knip.json` exists for dead code detection. The `deadcode` script (`pnpm deadcode`) is available.

---

## Wrangler Configuration Consistency (Pass 3: Full Audit)

**Reviewed all 9 wrangler.jsonc files** across workers.

### Strengths
- **Consistent structure**: All workers use the same `compatibility_date: "2025-01-01"` and `compatibility_flags: ["nodejs_compat"]` (except dev-cdn which intentionally omits `compatibility_flags`).
- **Observability enabled globally**: All 8 API workers have `"observability": { "enabled": true }`.
- **Production environments are complete**: All production environment blocks properly redeclare their KV namespace bindings.
- **Test environments are complete**: All test environment blocks properly redeclare their KV namespace bindings.

### Issues

**HIGH: 6 staging environments missing KV namespace bindings (upgraded from LOW)**

Wrangler environment overrides are NOT inherited from the top-level config. When you declare a named environment (like `staging`), it gets a clean slate for bindings -- KV namespaces, R2 buckets, etc. must be explicitly redeclared in each environment block.

The following workers are missing `kv_namespaces` in their staging blocks:

| Worker | Missing from Staging | Impact |
|---|---|---|
| **auth** | `AUTH_SESSION_KV`, `RATE_LIMIT_KV` | **Session auth and rate limiting completely broken** |
| **admin-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV`, `CACHE_KV` | Auth and caching broken |
| **ecom-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV`, `CACHE_KV` | Auth and caching broken |
| **content-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV`, `CACHE_KV` | Auth and caching broken |
| **organization-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV`, `BRAND_KV`, `CACHE_KV` | Auth, branding, and caching broken |
| **identity-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV`, `CACHE_KV` | Auth and caching broken |
| **notifications-api** | `RATE_LIMIT_KV`, `AUTH_SESSION_KV` | Auth broken |

**Only media-api correctly declares KV namespaces in its staging block** (lines 174-182 of media-api's wrangler.jsonc).

Deploying any of the 6 affected workers to staging will result in runtime errors when they attempt to access KV bindings that don't exist. The auth worker is the most critical -- without `AUTH_SESSION_KV`, no session validation works across any staging worker.

**MEDIUM: KV namespace IDs are duplicated across 8 wrangler files**

The same KV namespace ID strings appear in every worker's wrangler.jsonc:
- `RATE_LIMIT_KV: "cea7153364974737b16870df08f31083"` -- 24 occurrences across 8 files
- `AUTH_SESSION_KV: "82d04a4236df4aac8e9d87793344f0ed"` -- 24 occurrences across 8 files
- `CACHE_KV: "c5e85d4c8ecb46f9a3e5d4d96a14e9f1"` -- 18 occurrences across 6 files

If a KV namespace needs to be rotated, all files must be updated. Consider extracting shared KV config.

**MEDIUM: auth worker has no CACHE_KV binding**

All workers except `auth` and `notifications-api` have a `CACHE_KV` binding. This means any procedure handler running in these workers that accesses services needing `env.CACHE_KV` (like ContentService's cache operations) will silently skip caching. While this may be intentional (auth doesn't need content caching), it should be documented.

**LOW: dev-cdn missing `compatibility_flags`**

The `dev-cdn` wrangler.jsonc does not include `"compatibility_flags": ["nodejs_compat"]` unlike all other workers. Since it's dev-only this is low risk, but inconsistency could cause confusion if someone tries to use Node.js APIs in dev-cdn.

---

## Package Dependency Graph Analysis (Pass 3: New Section)

### Dependency Map

Built from reading all 22 `package.json` files. Arrows indicate runtime `dependencies` (not `devDependencies`).

**Foundation Layer (no inter-foundation deps):**
- `constants` -- zero deps (confirmed)
- `shared-types` -- zero runtime deps (observability is devDep only)
- `observability` -- depends on `constants` + `vite-plugin-dts` (misplaced)
- `validation` -- depends on `constants`, `shared-types` + `vite-plugin-dts` (misplaced)
- `database` -- depends on `constants`, `observability`
- `service-errors` -- depends on `constants`, `database`, `observability`
- `security` -- depends on `constants`, `database`, `observability`

**Note:** `database` depends on `observability` (for logging) and `service-errors` depends on `database` (for DB error detection). This creates a chain: `constants -> observability -> [no dep]` and `constants -> database -> [constants, observability]` and `service-errors -> [constants, database, observability]`. No circular dependencies here.

**Utility Layer:**
- `cloudflare-clients` -- zero workspace deps (standalone, confirmed)
- `cache` -- depends on `observability`
- `image-processing` -- depends on `cloudflare-clients`, `database`, `service-errors`, `shared-types`, `transcoding`, `validation`
- `platform-settings` -- depends on `cloudflare-clients`, `constants`, `database`, `observability`, `service-errors`, `shared-types`, `validation`
- `test-utils` -- depends on `constants`, `database`, `shared-types` + `vite-plugin-dts` (misplaced)

**Service Layer:**
- `organization` -- depends on `constants`, `database`, `service-errors`, `shared-types`, `validation`
- `content` -- depends on `cache`, `cloudflare-clients`, `constants`, `database`, `image-processing`, `organization`, `service-errors`, `shared-types`, `transcoding`, `validation`
- `identity` -- depends on `cache`, `database`, `image-processing`, `observability`, `service-errors`, `shared-types`, `validation` + `vite-plugin-dts` (misplaced)
- `purchase` -- depends on `constants`, `database`, `service-errors`, `shared-types`, `validation`
- `subscription` -- depends on `constants`, `database`, `service-errors`, `shared-types`, `validation`
- `access` -- depends on `cloudflare-clients`, `constants`, `content`, `database`, `observability`, `purchase`, `service-errors`, `shared-types`, `validation`
- `notifications` -- depends on `constants`, `database`, `platform-settings`, `service-errors`, `shared-types`, `validation`
- `admin` -- depends on `cache`, `constants`, `content`, `database`, `service-errors`, `shared-types`, `validation`
- `transcoding` -- depends on `constants`, `database`, `service-errors`, `shared-types`, `validation`

**Hub (worker-utils):**
- `worker-utils` -- depends on ALL 20 other workspace packages

### Circular Dependency Check

**No circular dependencies found.** The dependency graph is a DAG (directed acyclic graph). Key relationships:
- `access -> content -> organization` (unidirectional)
- `access -> purchase` (unidirectional, purchase does NOT depend on access)
- `content -> image-processing -> transcoding` (unidirectional)
- `notifications -> platform-settings` (unidirectional)

### `vite-plugin-dts` Misplacement (Pass 3: Expanded)

`vite-plugin-dts` is a build tool that generates `.d.ts` declaration files. It should always be in `devDependencies`. Currently misplaced in `dependencies` in:

| Package | Location |
|---|---|
| `@codex/observability` | `dependencies` (line 30) |
| `@codex/validation` | `dependencies` (line 27) |
| `@codex/test-utils` | `dependencies` (line 30) |

Correctly placed in `devDependencies` in:
| Package | Location |
|---|---|
| `@codex/image-processing` | `devDependencies` (line 42) |
| `@codex/cache` | `devDependencies` (line 29) |
| `@codex/identity` | `devDependencies` (line 39) |

*Impact:* When any package depending on `observability`, `validation`, or `test-utils` installs, `vite-plugin-dts` and its transitive deps (TypeScript compiler API, `@vue/language-core`, etc.) are unnecessarily installed as production dependencies.

### Package Size/Scope Assessment

**Well-scoped packages:** `constants` (zero deps, pure values), `cache` (single concern), `cloudflare-clients` (R2/KV only), `platform-settings` (facade over 3 settings tables).

**Packages that could potentially merge:**
- `@codex/subscription` and `@codex/purchase` have nearly identical dependency sets and both handle Stripe-related concerns. However, they model distinct business domains (one-time purchases vs recurring subscriptions), so separation is reasonable.

**No packages need splitting.** The largest service package (`content`) has reasonable scope -- content CRUD, media lifecycle, and slug management are tightly related.

---

## Cross-Cutting Concerns

### 1. `as any` Usage

**Zero `as any` casts found** across all packages in scope. This is excellent discipline and matches the project rule "never use `as any`".

### 2. `@ts-expect-error` Usage

5 instances found, all legitimate:
- `packages/image-processing/vitest.setup.ts:8` -- test setup mock
- `packages/organization/vitest.setup.ts:9` -- test setup mock
- `packages/platform-settings/vitest.setup.ts:9` -- test setup mock
- `packages/validation/vitest.setup.ts:9` -- test setup mock
- `packages/constants/src/env.test.ts:112` -- testing invalid input (commented as such)

### 3. `console.log` Usage

The project rule is "MUST use ObservabilityClient -- NEVER use console.log directly." Violations found in production code (non-test, non-script):

- `packages/notifications/src/providers/index.ts` -- lines 27, 33, 39, 44 (provider selection logging in worker context)
- `packages/notifications/src/providers/mailhog-provider.ts` -- lines 55-56 (dev provider, acceptable)
- `packages/notifications/src/providers/console-provider.ts` -- intentional (mock email output)
- `packages/cloudflare-clients/src/cache/client.ts` -- line 36 (fallback logger when no ObservabilityClient provided)
- `packages/test-utils/src/database.ts` -- lines 147, 154 (connection retry logging, acceptable in test context)

The notifications provider factory (`packages/notifications/src/providers/index.ts`) uses `console.log` for provider selection logging. Since this runs in Workers, it should use ObservabilityClient.

### 4. Package Boundary Documentation Mismatch

The documented dependency graph in `packages/CLAUDE.md` shows:
```
worker-utils -> security, service-errors, shared-types, observability
```

But the actual `package.json` has 20 workspace dependencies. The discrepancy comes from the service registry pulling in every service package. The documentation should reflect the actual dependency graph.

### 5. Currency Consistency

Default currency in test factories is `'usd'` but platform default is `'gbp'`. This was found in:
- `packages/test-utils/src/factories.ts` lines 624, 709
- `packages/constants/src/commerce.ts` correctly defines `CURRENCY.GBP = 'gbp'`

### 6. Version Inconsistencies Across `package.json` Files

Minor inconsistencies in dependency versions:

| Dependency | Version in Some Packages | Version in Others |
|---|---|---|
| `typescript` | `^5.6.3` | `^5.7.3` |
| `@cloudflare/workers-types` | `^4.20241127.0` | `^4.20250102.0` / `^4.20250129.0` / `^4.20251014.0` |
| `vitest` | `^2.1.8` (image-processing) | `^4.0.2` (all others) |
| `vite` | `^6.4.1` (root) | `^7.2.2` (packages) |

The `vitest` mismatch in `image-processing` is notable -- it pins to `^2.1.8` while all other packages use `^4.0.2`. This could cause test behavior differences.

---

## Recommendations (Prioritized by Impact)

### P0 -- Fix Now

1. **Fix multipart procedure error classes** -- Change `FileTooLargeError`, `InvalidFileTypeError`, and `MissingFileError` to extend `ValidationError` from `@codex/service-errors` instead of `Error`. This is a user-facing bug -- file upload validation errors currently return opaque 500s.

2. **Fix staging wrangler KV namespace bindings** -- Add `kv_namespaces` blocks to the staging environment in all 6 affected workers (auth, admin-api, ecom-api, content-api, organization-api, identity-api, notifications-api). Copy the patterns from the production blocks. Without this fix, deploying to staging will break session auth and rate limiting across the entire platform.

3. **Fix observability hash mode regression** -- `ObservabilityClient` sets `mode: 'hash'` for production but calls sync `redactSensitiveData()` which silently falls back to `[REDACTED]`. Either make `log()` await `redactSensitiveDataAsync()` for hash mode, or change production default to `'mask'`.

4. **Fix root `tsconfig.json` references and paths** -- Add all 6 missing packages to `references` and `paths`. Add `@codex/admin` to `references`. Add `media-api` and `dev-cdn` to `references`. Without this, cross-package type checking and IDE navigation are broken for these packages.

### P1 -- Fix Soon

5. **Extract shared procedure base** -- Consolidate the duplicated execution flow in `procedure()`, `binaryUploadProcedure()`, and `multipartProcedure()` into a single base function. This eliminates triple-maintenance risk and reduces code by ~120 lines.

6. **Share Stripe client in service registry** -- Add a `getStripeClient()` lazy getter alongside `getSharedDb()` to eliminate 4 redundant `createStripeClient()` calls.

7. **Change test factory default currency to GBP** -- Update `factories.ts` Stripe event factories to default to `'gbp'` instead of `'usd'`.

8. **Remove duplicate `generateRequestId`/`getClientIP`** -- Delete the private copies in `middleware.ts` and import from `procedure/helpers.ts`.

9. **Move `vite-plugin-dts` to `devDependencies`** -- In `@codex/observability`, `@codex/validation`, and `@codex/test-utils`, this build tool is incorrectly listed as a runtime dependency. Move to `devDependencies` in all 3 packages.

10. **Add `inputs` to turbo build task** -- Add `"inputs": ["src/**"]` to the `build` task in `turbo.json` to prevent non-source changes from invalidating build caches.

### P2 -- Improve When Convenient

11. **Extract image upload variant pattern** -- The 3 upload methods in `ImageProcessingService` share ~40 lines of identical logic. Extract a `processAndUploadVariants()` helper.

12. **Add KV caching for org membership checks** -- The TODO on `org-helpers.ts` line 111 is a real performance concern. Every org-scoped request does a DB query for membership.

13. **Remove dead `_images` variable** from `service-registry.ts` line 98.

14. **Replace CORS hardcoded ports** -- Use `SERVICE_PORTS` from `@codex/constants` in the CORS middleware instead of hardcoded `localhost:XXXX` strings.

15. **Remove duplicate `ERROR_CODES`** -- Delete the `ERROR_CODES` object from `middleware.ts` and import from `@codex/constants` instead.

16. **Align `vitest` version in `image-processing`** -- Update from `^2.1.8` to `^4.0.2` to match all other packages.

17. **Fix `withTransaction()` documentation** -- Either make it actually rollback (throw after capturing result) or document that it commits on success and is NOT suitable for test isolation.

### P3 -- Nice to Have

18. **Remove or document `enableGlobalAuth`** -- All 8 workers set it to `false`. Either remove the feature from `createWorker()` or document that it exists for external consumers.

19. **Extract shared wrangler KV config** -- Reduce KV namespace ID duplication across 8 wrangler files.

20. **Split service registry from worker-utils** -- Consider a plugin pattern or separate entrypoint to reduce the dependency graph impact.

21. **Simplify `getServiceUrl` switch statement** -- Convert to a lookup table to reduce repetition.

22. **Tighten `Bindings` type** -- Add a `RequiredBindings` subset for fields every worker needs.

23. **Remove `DeleteOrganizationResponse`** -- It is deprecated and no longer used.

24. **Remove deprecated `withNeonTestBranch()`** -- It is a no-op and should be cleaned up.

25. **Update `packages/CLAUDE.md` dependency graph** -- Reflect that `worker-utils` depends on all service packages via the registry.

26. **Narrow `SENSITIVE_PATTERNS.RANDOM_SECRET`** -- The current `/[a-zA-Z0-9]{32,}/` is too broad; consider requiring mixed case or specific prefixes.

27. **Add `globalDependencies` to turbo.json** -- Include `config/tsconfig/base.json` and `biome.json` to ensure config changes invalidate all caches.

28. **Align TypeScript and workers-types versions** -- Standardize `typescript` to `^5.7.3` and `@cloudflare/workers-types` to the latest across all packages.
