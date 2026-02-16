# Security Agent Specification

## Domain
Authentication, authorization, rate limiting, XSS prevention, secrets handling, and input validation.

## File Patterns to Review
- `packages/security/src/**/*.ts`
- `packages/validation/src/**/*.ts`
- `workers/*/src/middleware/**/*.ts`
- `workers/*/src/routes/**/*.ts`
- `workers/auth/src/**/*.ts`

## Checklist

### Authentication & Authorization

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] All state-changing endpoints (POST, PATCH, DELETE) have `policy: { auth: 'required' }`
- [CRITICAL] Role checks enforced where needed (`roles: ['creator', 'admin']`)
- [CRITICAL] Public endpoints explicitly marked `policy: { auth: 'none' }`
- [WARN] Worker-to-worker calls use HMAC verification (`policy: { auth: 'worker' }`)
- [CRITICAL] No manual auth checks (use procedure policy instead)
- [CRITICAL] Session validation happens before any business logic

### Rate Limiting

- [CRITICAL] Auth endpoints (register, login) use `rateLimit: 'auth'` (5/15min)
- [WARN] API endpoints use `rateLimit: 'api'` (100/min)
- [WARN] Webhook endpoints use `rateLimit: 'webhook'` (1000/min)
- [CRITICAL] No missing rate limiting on sensitive operations
- [INFO] Rate limit keys scoped per-user where appropriate

### Input Validation & XSS Prevention

- [CRITICAL] All POST/PATCH use Zod schemas in `input: { body: schema }`
- [CRITICAL] SVG uploads use `sanitizeSvgContent()` from `@codex/validation`
- [CRITICAL] URL validation blocks `javascript:`, `data:`, `vbscript:` protocols
- [WARN] Image validation uses magic number checks, not just extension
- [CRITICAL] No `innerHTML` usage without sanitization
- [CRITICAL] User input never directly inserted into DOM without escaping
- [WARN] File upload size limits enforced
- [CRITICAL] SQL injection prevention via parameterized queries (Drizzle handles this)

### Secrets & PII Handling

- [CRITICAL] No hardcoded secrets, API keys, or credentials in code
- [CRITICAL] No PII in logs (emails, passwords, tokens, credit cards)
- [WARN] Error context contains only IDs, no sensitive data
- [CRITICAL] Stripe secrets use environment variables
- [CRITICAL] Webhook signatures verified (Stripe `stripe-webhook` header)
- [WARN] Sensitive config not committed to git

### Security Headers

- [WARN] CSP headers configured for API workers
- [WARN] HSTS enabled in production
- [WARN] Cookies use HttpOnly, Secure, SameSite=Strict
- [INFO] CORS properly configured

## Code Examples

### Correct: Auth Required with Rate Limiting
```typescript
// workers/content-api/src/routes/content.ts
import { procedure } from '@codex/worker-utils';
import { createContentSchema } from '@codex/validation';

export const createContentRoute = procedure({
  policy: { auth: 'required' },
  rateLimit: 'api',
  input: { body: createContentSchema }
}).handler(async ({ ctx, input }) => {
  // Business logic delegated to service
  return ctx.services.content.create(ctx.session.userId, input.body);
});
```

### Incorrect: Missing Auth
```typescript
// ❌ CRITICAL: No auth policy on state-changing operation
export const createContentRoute = procedure({
  // Missing: policy: { auth: 'required' }
  input: { body: createContentSchema }
}).handler(async ({ input }) => {
  return createContent(input.body);
});
```

### Correct: SVG Sanitization
```typescript
// packages/content/src/services/media-service.ts
import { sanitizeSvgContent } from '@codex/validation';

if (file.type === 'image/svg+xml') {
  const text = await file.text();
  const sanitized = sanitizeSvgContent(text);
  // Upload sanitized version
}
```

### Incorrect: Direct SVG Upload
```typescript
// ❌ CRITICAL: No sanitization of SVG (XSS risk)
if (file.type === 'image/svg+xml') {
  await r2.put(key, await file.arrayBuffer());
}
```

## Handoff Instructions

When you find issues that belong to other agents, use SendMessage:

| Finding | Send To |
|---------|---------|
| Unscoped database queries | `database-reviewer` |
| Auth issues in routes | `worker-reviewer` |
| Missing validation schemas | `worker-reviewer` |
| Business logic in routes | `service-reviewer` |

## Critical File References

- `packages/security/src/session-auth.ts:extractSessionCookie` - Cookie extraction
- `packages/security/src/worker-auth.ts:constantTimeEqual` - HMAC verification
- `packages/security/src/rate-limit.ts:rateLimitMiddleware` - Rate limiting
- `packages/validation/src/primitives.ts:sanitizeSvgContent` - SVG sanitization
- `packages/validation/src/primitives.ts:urlSchema` - URL validation
- `packages/validation/src/content.ts:createContentSchema` - Input schemas
- `packages/worker-utils/src/procedure.ts:procedure` - Procedure handler
