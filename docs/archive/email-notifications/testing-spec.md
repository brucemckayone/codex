# Email Notification System — Testing Spec

**Date**: 2026-04-09
**Status**: Implementation-ready
**Parent**: `docs/email-notifications-design-spec.md`

---

## Problem

All 9 work packets were implemented with typecheck verification only. Zero new unit/integration tests were written. The 65 existing tests are pre-existing and don't cover any new code. This spec defines the 5 critical test packages needed.

---

## TP1: Unsubscribe Token Tests (CRITICAL)

**File**: `packages/notifications/src/__tests__/unsubscribe.test.ts`
**Tests**: ~10 test cases
**Risk**: Token forgery → GDPR/CAN-SPAM violation

### Test Cases

1. `generateUnsubscribeToken()` produces a string with two dot-separated parts
2. `verifyUnsubscribeToken()` returns valid payload for freshly generated token
3. `verifyUnsubscribeToken()` returns null for tampered payload (changed userId)
4. `verifyUnsubscribeToken()` returns null for tampered signature
5. `verifyUnsubscribeToken()` returns null for expired token (expiresAt in past)
6. `verifyUnsubscribeToken()` returns null for invalid format (no dot separator)
7. `verifyUnsubscribeToken()` returns null for empty string
8. `verifyUnsubscribeToken()` rejects `category: 'transactional'` (only marketing/digest allowed)
9. Round-trip: generate with `category: 'marketing'` → verify → payload.category === 'marketing'
10. Round-trip: generate with `category: 'digest'` → verify → payload.category === 'digest'

### Implementation Notes

- Uses Web Crypto API (`crypto.subtle`) — available in Vitest via `@cloudflare/vitest-pool-workers` or polyfill
- Token format: `base64url(payload).base64url(hmac)`
- Secret: use a fixed test secret like `'test-secret-key'`
- For expiry tests: mock `Date.now()` or generate token with custom `expiryDays: 0`

---

## TP2: Preference Checking in NotificationsService (CRITICAL)

**File**: `packages/notifications/src/services/__tests__/notifications-service.test.ts` (extend existing)
**Tests**: ~6 test cases
**Risk**: Opted-out users receive marketing emails → compliance violation

### Test Cases

1. `sendEmail({ category: 'marketing', userId: 'user-1' })` skips when user opted out of marketing → returns `{ success: false, skipped: 'opted_out' }`
2. `sendEmail({ category: 'digest', userId: 'user-1' })` skips when user opted out of digest
3. `sendEmail({ category: 'transactional', userId: 'user-1' })` ALWAYS sends regardless of preferences
4. `sendEmail({ category: 'marketing' })` (no userId) sends normally — preference check requires userId
5. `sendEmail({})` (no category) sends normally — preference check requires category
6. Skipped email writes audit log with `status: 'skipped'` and `metadata` containing `skipReason: 'opted_out'`

### Implementation Notes

- Existing test file already has mock setup for `NotificationsService` with `InMemoryEmailProvider`
- Need to mock `NotificationPreferencesService.hasOptedOut()` — it's instantiated inline in `sendEmail()`
- The inline instantiation means we need to either:
  - Mock the module import (`vi.mock`)
  - Or inject the preferences service via constructor config
- Check existing mock patterns in the file before choosing approach
- The `EMAIL_SEND_STATUS.SKIPPED` constant must be used (added in WP1)
- Verify the audit log insert uses the correct `emailAuditLogs` schema

---

## TP3: Unsubscribe Route Tests (CRITICAL)

**File**: `workers/notifications-api/src/routes/__tests__/unsubscribe.test.ts` (new)
**Tests**: ~8 test cases
**Risk**: Broken unsubscribe → users can't opt out → legal risk

### Test Cases

1. `GET /unsubscribe/:token` with valid token → 200 `{ valid: true, category: 'marketing', userId: '...' }`
2. `GET /unsubscribe/:token` with expired token → 200 `{ valid: false, reason: '...' }`
3. `GET /unsubscribe/:token` with tampered token → 200 `{ valid: false, reason: '...' }`
4. `POST /unsubscribe/:token` with valid marketing token → 200 `{ success: true, category: 'marketing' }` + `emailMarketing` set to false in DB
5. `POST /unsubscribe/:token` with valid digest token → 200 `{ success: true, category: 'digest' }` + `emailDigest` set to false in DB
6. `POST /unsubscribe/:token` idempotent — second POST returns same result, no error
7. `POST /unsubscribe/:token` upserts — creates preferences record if user has none
8. `POST /unsubscribe/:token` with invalid token → 400 `{ success: false, error: '...' }`

### Implementation Notes

- These are Hono route tests — follow patterns in `templates.test.ts` and `preferences.test.ts`
- The routes use `createDbClient(c.env)` directly (not procedure), so need to mock DB
- Need to generate real tokens using `generateUnsubscribeToken()` with the test secret
- The `WORKER_SHARED_SECRET` env var must be set in test context
- For DB assertions: mock `notificationPreferences` table insert/update operations

---

## TP4: Internal Send Endpoint Tests (HIGH)

**File**: `workers/notifications-api/src/routes/__tests__/internal.test.ts` (new)
**Tests**: ~6 test cases
**Risk**: Auth bypass → unauthorized email sending

### Test Cases

1. `POST /internal/send` with valid HMAC + valid payload → 200 `{ data: { success: true } }`
2. `POST /internal/send` without HMAC headers → 401
3. `POST /internal/send` with invalid HMAC signature → 401
4. `POST /internal/send` with invalid body (missing templateName) → 400
5. `POST /internal/send` with unknown template name → 404 (TemplateNotFoundError)
6. `POST /internal/send` with `category: 'marketing'` + opted-out user → 200 `{ data: { skipped: 'opted_out' } }`

### Implementation Notes

- Uses `procedure({ policy: { auth: 'worker' } })` — tests need HMAC header generation
- Follow pattern from existing `templates.test.ts` for route test setup
- Need `generateWorkerSignature` from `@codex/security` for test HMAC headers
- Mock `NotificationsService.sendEmail()` to avoid real email delivery
- The `internalSendEmailSchema` validates the body — test schema rejection

---

## TP5: sendEmailToWorker Helper Tests (HIGH)

**File**: `packages/worker-utils/src/email/__tests__/send-email.test.ts` (new)
**Tests**: ~5 test cases
**Risk**: Silent failures, emails never actually sent

### Test Cases

1. Calls `workerFetch()` with correct URL (`getServiceUrl('notifications', env)/internal/send`)
2. Wraps call in `executionCtx.waitUntil()` (verify waitUntil is called)
3. Request body matches `SendEmailToWorkerParams` structure
4. Network error is silently caught (function doesn't throw)
5. Returns void synchronously (doesn't await the fetch)

### Implementation Notes

- Mock `workerFetch` from `@codex/security`
- Mock `getServiceUrl` from `@codex/constants`
- Create mock `ExecutionContext` with `waitUntil: vi.fn()`
- Create mock `Bindings` with `WORKER_SHARED_SECRET: 'test-secret'`
- The `.catch(() => {})` error suppression is critical — verify with rejecting promise

---

## Dependencies

```
TP1 (tokens)  ──→ TP3 (unsubscribe routes — needs real tokens)
TP2 (prefs)   ──→ TP4 (internal send — tests preference forwarding)
TP5 (helper)     (independent)
```

TP1, TP2, TP5 can all run in parallel.
TP3 depends on TP1 (uses generateUnsubscribeToken in tests).
TP4 depends on TP2 (tests preference checking end-to-end).
