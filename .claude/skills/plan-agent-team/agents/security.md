# Security Planning Agent Specification

## Domain
Authentication, authorization, rate limiting, XSS prevention, secrets handling, input validation.

## Purpose
Generate implementation plans for security-related work including auth policies, rate limiting, input validation, and XSS prevention. Ensures compliance with the Security PR review agent.

## File Patterns to Review
- `packages/security/src/**/*.ts` - Security utilities
- `packages/validation/src/**/*.ts` - Validation schemas
- `workers/*/src/middleware/**/*.ts` - Auth middleware
- `workers/*/src/routes/**/*.ts` - Route security
- `workers/auth/src/**/*.ts` - Auth worker

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Security Agent**: `.claude/skills/pr-review-agent-team/agents/security.md`

## Checklist

### Authentication & Authorization (CRITICAL)

- [CRITICAL] All state-changing endpoints (POST, PATCH, DELETE) have `policy: { auth: 'required' }`
- [CRITICAL] Role checks enforced where needed (`roles: ['creator', 'admin']`)
- [CRITICAL] Public endpoints explicitly marked `policy: { auth: 'none' }`
- [WARN] Worker-to-worker calls use HMAC verification (`policy: { auth: 'worker' }`)
- [CRITICAL] No manual auth checks (use procedure policy instead)
- [CRITICAL] Session validation happens before any business logic

### Rate Limiting (CRITICAL)

- [CRITICAL] Auth endpoints (register, login) use `rateLimit: 'auth'` (5/15min)
- [WARN] API endpoints use `rateLimit: 'api'` (100/min)
- [WARN] Webhook endpoints use `rateLimit: 'webhook'` (1000/min)
- [CRITICAL] No missing rate limiting on sensitive operations
- [INFO] Rate limit keys scoped per-user where appropriate

### Input Validation & XSS Prevention (CRITICAL)

- [CRITICAL] All POST/PATCH use Zod schemas in `input: { body: schema }`
- [CRITICAL] SVG uploads use `sanitizeSvgContent()` from `@codex/validation`
- [CRITICAL] URL validation blocks `javascript:`, `data:`, `vbscript:` protocols
- [WARN] Image validation uses magic number checks, not just extension
- [CRITICAL] No `innerHTML` usage without sanitization
- [CRITICAL] User input never directly inserted into DOM without escaping
- [WARN] File upload size limits enforced
- [CRITICAL] SQL injection prevention via parameterized queries (Drizzle handles this)

### Secrets & PII Handling (CRITICAL)

- [CRITICAL] No hardcoded secrets, API keys, or credentials in code
- [CRITICAL] No PII in logs (emails, passwords, tokens, credit cards)
- [WARN] Error context contains only IDs, no sensitive data
- [CRITICAL] Stripe secrets use environment variables
- [CRITICAL] Webhook signatures verified (Stripe `stripe-webhook` header)
- [WARN] Sensitive config not committed to git

## Code Examples

### Correct: Auth Required with Rate Limiting

```typescript
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

## Plan Output Format

```markdown
## Security Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- Security Agent: `.claude/skills/pr-review-agent-team/agents/security.md`

---

## Phase 1: Authentication & Authorization

### Files to Modify
- List route files that need auth policies

### Implementation Instructions
**Read this pattern first**:
- `workers/content-api/src/routes/content.ts`

**Security Agent Requirements** (CRITICAL):
- State-changing endpoints require `auth: 'required'`
- Role checks via `roles: ['creator', 'admin']`
- No manual auth checks in handler

**Route Template**:
```typescript
export const routeName = procedure({
  policy: {
    auth: 'required',
    roles: ['creator', 'admin']  // If role-restricted
  },
  rateLimit: 'api',
  input: { body: validationSchema }
}).handler(async ({ ctx, input }) => {
  return ctx.services.service.method(ctx.session.userId, input.body);
});
```

**Acceptance Criteria**:
- [ ] Has auth policy
- [ ] Has rate limiting
- [ ] Has input validation
- [ ] Delegates to service

---

## Phase 2: Input Validation

### Files to Modify/Create
- `packages/validation/src/schemas/[domain].ts`

### Implementation Instructions
**Read this pattern first**:
- `packages/validation/src/schemas/content.ts`
- `packages/validation/src/primitives.ts`

**Security Agent Requirements** (CRITICAL):
- All inputs validated via Zod
- URL validation blocks dangerous protocols
- Sanitized strings prevent XSS

**Schema Template**:
```typescript
import { z } from 'zod';
import { uuidSchema, urlSchema, sanitizedStringSchema } from '../primitives';

export const schemaName = z.object({
  field1: sanitizedStringSchema(1, 500, 'Field Label'),
  field2: urlSchema.optional(),
  // ... other fields
});
```

**Acceptance Criteria**:
- [ ] All inputs validated
- [ ] Uses primitives where possible
- [ ] Has appropriate refinements

---

## Phase 3: Rate Limiting Configuration

### Rate Limit Levels
- `auth`: 5 requests per 15 minutes (register, login)
- `api`: 100 requests per minute (standard API)
- `webhook`: 1000 requests per minute (webhook endpoints)
- `strict`: 10 requests per minute (sensitive operations)
- `streaming`: Specialized for media streaming

### Implementation
Add `rateLimit` to procedure config:
```typescript
procedure({
  policy: { auth: 'required' },
  rateLimit: 'api',  // or 'auth', 'webhook', etc.
  // ...
})
```

---

## Deep Dive References
- Cookie extraction: `packages/security/src/session-auth.ts:extractSessionCookie`
- HMAC verification: `packages/security/src/worker-auth.ts:constantTimeEqual`
- Rate limiting: `packages/security/src/rate-limit.ts:rateLimitMiddleware`
- SVG sanitization: `packages/validation/src/primitives.ts:sanitizeSvgContent`
- URL validation: `packages/validation/src/primitives.ts:urlSchema`
- Input schemas: `packages/validation/src/content.ts:createContentSchema`
- Procedure handler: `packages/worker-utils/src/procedure.ts:procedure`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Unscoped database queries | `database-planner` |
| Missing validation schemas | `backend-planner` |
| Business logic in routes | `service-planner` |
| XSS risks in components | `frontend-planner` |

## Critical File References

- `packages/security/src/session-auth.ts` - Cookie extraction
- `packages/security/src/worker-auth.ts` - HMAC verification
- `packages/security/src/rate-limit.ts` - Rate limiting
- `packages/validation/src/primitives.ts` - SVG sanitization, URL validation
- `packages/validation/src/content.ts` - Input schemas
- `packages/worker-utils/src/procedure.ts` - Procedure handler
