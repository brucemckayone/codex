# Security Reviewer

## Domain
Full codebase security audit — authentication, authorization, input validation, data scoping, rate limiting, worker-to-worker auth, secrets handling, CORS, session management, and OWASP Top 10.

## File Patterns
- `packages/security/src/**/*.ts`
- `packages/validation/src/**/*.ts`
- `packages/worker-utils/src/procedure/**/*.ts`
- `packages/worker-utils/src/middleware.ts`
- `packages/worker-utils/src/auth-middleware.ts`
- `packages/service-errors/src/**/*.ts`
- `workers/auth/src/**/*.ts`
- `workers/*/src/middleware/**/*.ts`
- `apps/web/src/routes/(auth)/**/*.ts`
- `apps/web/src/lib/components/editor/ProseContent.svelte`
- `apps/web/src/lib/components/seo/StructuredData.svelte`

## Checklist

### Authentication (AuthN)
- [CRITICAL] Rate limiting on ALL auth endpoints (login, register, password reset)
- [CRITICAL] Test endpoints guarded by reliable environment check (not optional env var)
- [WARN] Email enumeration mitigated or documented as accepted trade-off
- [WARN] Trusted origins gated behind environment checks (no dev domains in production)

### Authorization (AuthZ)
- [CRITICAL] No IDOR — handler uses policy-validated IDs, not user-supplied query params
- [CRITICAL] Admin endpoints use documented auth model (verify docs match code)
- [WARN] Service-level ownership checks match route-level policy
- [INFO] Public endpoints documented as intentionally unscoped

### Input Validation
- [CRITICAL] All procedure handlers use Zod schema validation
- [CRITICAL] No raw `c.req.json()` without validation in production code
- [WARN] ILIKE search queries escape `%` and `_` wildcards
- [INFO] File upload validation returns 400 not 500

### Data Scoping
- [CRITICAL] Every query scoped by creatorId/orgId/customerId in WHERE clause
- [CRITICAL] No post-fetch ownership checks (timing side-channel risk)
- [WARN] Admin re-fetch queries include soft-delete filter

### XSS Prevention
- [CRITICAL] No `{@html}` with unsanitized content — DOMPurify.sanitize() required
- [CRITICAL] `</script>` escaped in JSON-LD structured data
- [CRITICAL] SVG uploads sanitized via `sanitizeSvgContent()`
- [WARN] CSP headers applied to all workers

### CORS & Origins
- [CRITICAL] Dev-only domains (nip.io, lvh.me, localhost) gated behind environment check
- [WARN] CORS fallback returns null/empty when no origin matches (not first configured origin)

### Secrets & PII
- [CRITICAL] No hardcoded secrets in code
- [CRITICAL] No PII in log messages
- [WARN] Error context does not leak user roles or internal state
- [WARN] API keys hashed in cache keys, not stored as plaintext

### Session Management
- [WARN] Session KV caching with proper expiration validation
- [WARN] Cookie flags: HttpOnly, SameSite=Lax, Secure in production

### OWASP Top 10
- [CRITICAL] SQL injection: parameterized queries only (Drizzle)
- [CRITICAL] XSS: see above
- [CRITICAL] Broken access control: procedure policy enforcement
- [CRITICAL] Open redirect: login redirect validated (`startsWith('/')` and `!startsWith('//')`)
- [CRITICAL] Insecure deserialization: JSON.parse only after HMAC verification
- [CRITICAL] Path traversal: R2 keys validated with `isValidR2Key()`
- [WARN] Checkout redirect URLs validated against domain whitelist

## Output Requirements
- Severity ratings: Critical, High, Medium, Low, Info
- Positive findings section (what's working well)
- Cross-reference with workers and services reports
- Verify each finding against source code with exact line numbers
