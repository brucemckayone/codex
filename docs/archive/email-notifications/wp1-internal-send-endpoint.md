# WP1: Internal Send Endpoint & Preference Checking

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P0
**Dependencies**: None (foundation work)
**Estimated scope**: 7 files changed/created, ~300 lines of new code

---

## Goal

Create the central `POST /internal/send` endpoint on notifications-api that all other workers call to send emails, plus add preference checking to `NotificationsService` so marketing/digest emails respect user opt-out settings.

## Context

The `@codex/notifications` package already has full template resolution (Creator > Org > Global), retry with exponential backoff, branding injection, and audit logging. `NotificationPreferencesService` already has a `hasOptedOut(userId, type)` method. However, there is no internal HTTP endpoint for other workers to call -- the auth worker currently bypasses the entire system by instantiating email providers directly with hardcoded HTML (`workers/auth/src/email.ts`). This work packet creates the single ingress point for all email sending and a reusable helper so every worker can fire-and-forget emails via `waitUntil()`.

## Changes

### `packages/validation/src/schemas/notifications.ts` (update)

Add `internalSendEmailSchema` below the existing `sendEmailSchema`:

```typescript
// ============================================
// Internal Send Email Schema (worker-to-worker)
// ============================================

export const emailCategoryEnum = z.enum(['transactional', 'marketing', 'digest']);
export type EmailCategory = z.infer<typeof emailCategoryEnum>;

export const internalSendEmailSchema = z.object({
  to: z.string().email(),
  toName: z.string().optional(),
  templateName: templateNameSchema,
  data: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .refine(
      (obj) => Object.keys(obj).length <= 50,
      'Maximum 50 data keys allowed'
    ),
  organizationId: uuidSchema.optional().nullable(),
  creatorId: z.string().optional().nullable(),
  category: emailCategoryEnum,
  userId: z.string().optional(),
});
export type InternalSendEmailInput = z.infer<typeof internalSendEmailSchema>;
```

Also add these to the `templateDataSchemas` map and the barrel export in `packages/validation/src/index.ts` (or wherever `sendEmailSchema` is currently exported).

### `packages/notifications/src/types.ts` (update)

Add the `EmailCategory` type alongside the existing `NotificationPreferencesResponse`:

```typescript
/**
 * Email category for preference checking.
 * - transactional: Always sent (receipts, password resets, security)
 * - marketing: Opt-out respected (promotions, new content)
 * - digest: Opt-out respected (weekly summary)
 */
export type EmailCategory = 'transactional' | 'marketing' | 'digest';
```

Update `SendEmailParams` interface (currently defined locally in `notifications-service.ts`) to add:

```typescript
interface SendEmailParams {
  // ... existing fields ...
  category?: EmailCategory;
  userId?: string;
}
```

### `packages/notifications/src/services/notifications-service.ts` (update)

Update `sendEmail()` to check preferences before sending. Insert preference checking between the email validation step and template resolution step.

Before the `// 1. Resolve Template` comment, add:

```typescript
// 0. Check notification preferences (skip for transactional or when userId is unknown)
if (params.category && params.category !== 'transactional' && params.userId) {
  const preferencesService = new NotificationPreferencesService({
    db: this.db,
    environment: this.environment,
  });
  const optedOut = await preferencesService.hasOptedOut(params.userId, params.category);
  if (optedOut) {
    this.obs.info('Email skipped due to user opt-out', {
      templateName,
      category: params.category,
      userId: params.userId,
    });

    // Write audit log with 'skipped' status for compliance tracking
    await this.db
      .insert(schema.emailAuditLogs)
      .values({
        templateName,
        recipientEmail: to,
        organizationId: organizationId || null,
        creatorId: creatorId || null,
        status: EMAIL_SEND_STATUS.SKIPPED,
        metadata: JSON.stringify({ ...data, skipReason: 'opted_out', category: params.category }),
      });

    return { success: false, skipped: 'opted_out' } as SendResult;
  }
}
```

**Important**: `NotificationPreferencesService` is instantiated inline here rather than injected because `NotificationsService` is already constructed in the service registry. An alternative is to accept a `preferencesService` in the constructor config, but the inline approach avoids changing the constructor signature. The engineer should evaluate whether dependency injection is cleaner given the existing patterns in the codebase.

**Note**: `EMAIL_SEND_STATUS.SKIPPED` does not exist yet. Add it to `@codex/constants` alongside the existing `PENDING`, `SUCCESS`, `FAILED` values. If the constants enum is not easily extendable, use the string `'skipped'` directly in the insert and add a TODO to update the enum.

### `workers/notifications-api/src/routes/internal.ts` (new)

Create the internal route file:

```typescript
/**
 * Internal Routes (Worker-to-Worker)
 *
 * POST /internal/send — Central email sending endpoint.
 * All workers call this to send emails via the template system.
 *
 * Security: HMAC worker-to-worker auth (X-Worker-Signature + X-Worker-Timestamp)
 */

import type { HonoEnv } from '@codex/shared-types';
import { internalSendEmailSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /internal/send
 *
 * Send an email using the template system.
 * Validates input, checks preferences (non-transactional), resolves template,
 * renders with branding, sends via provider, writes audit log.
 *
 * Security: worker HMAC auth (policy.auth = 'worker')
 * Rate Limit: N/A (internal only, already rate-limited at originating worker)
 */
app.post(
  '/send',
  procedure({
    policy: { auth: 'worker' },
    input: { body: internalSendEmailSchema },
    handler: async (ctx) => {
      const { to, toName, templateName, data, organizationId, creatorId, category, userId } =
        ctx.input.body;

      const result = await ctx.services.notifications.sendEmail({
        to,
        toName,
        templateName,
        data,
        organizationId,
        creatorId,
        category,
        userId,
      });

      return {
        success: result.success,
        messageId: result.messageId,
        skipped: result.skipped,
      };
    },
  })
);

export default app;
```

### `workers/notifications-api/src/index.ts` (update)

Mount the internal routes. Add import and route mount:

```typescript
import internalRoutes from './routes/internal';

// After existing route mounts:
app.route('/internal', internalRoutes);
```

Ensure the environment validation middleware includes `WORKER_SHARED_SECRET` in the `required` array (it is already on the shared `Bindings` type, but the env validation middleware currently only checks `DATABASE_URL` and `RATE_LIMIT_KV`). Add it:

```typescript
createEnvValidationMiddleware({
  required: ['DATABASE_URL', 'RATE_LIMIT_KV', 'WORKER_SHARED_SECRET'],
  // ... existing optional fields
})
```

### `packages/worker-utils/src/email/send-email.ts` (new)

Create the reusable helper that all workers import:

```typescript
/**
 * Worker-to-Worker Email Sending Helper
 *
 * Wraps the fire-and-forget pattern for sending emails via notifications-api.
 * All workers should use this instead of directly constructing email provider calls.
 *
 * Usage:
 *   sendEmailToWorker(env, executionCtx, {
 *     to: user.email,
 *     templateName: 'purchase-receipt',
 *     data: { userName: user.name, ... },
 *     category: 'transactional',
 *   });
 */

import { getServiceUrl } from '@codex/constants';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import type { InternalSendEmailInput } from '@codex/validation';

export interface SendEmailToWorkerParams
  extends Omit<InternalSendEmailInput, 'data'> {
  data: Record<string, string | number | boolean>;
}

/**
 * Send an email via the notifications-api internal endpoint.
 *
 * Wraps the call in executionCtx.waitUntil() so the email never blocks
 * the HTTP response to the user. Errors are caught and suppressed --
 * email failures must never break the calling worker's response.
 *
 * @param env - Worker environment bindings (needs WORKER_SHARED_SECRET)
 * @param executionCtx - Cloudflare execution context (for waitUntil)
 * @param params - Email parameters matching internalSendEmailSchema
 */
export function sendEmailToWorker(
  env: Bindings,
  executionCtx: ExecutionContext,
  params: SendEmailToWorkerParams
): void {
  const url = `${getServiceUrl('notifications', env)}/internal/send`;
  const body = JSON.stringify(params);

  executionCtx.waitUntil(
    workerFetch(url, { method: 'POST', body }, env.WORKER_SHARED_SECRET).catch(
      () => {
        // Silently swallow -- email failures must not break calling worker.
        // The notifications-api audit log captures failures on its side.
      }
    )
  );
}
```

**Key design decisions**:
- `workerFetch` from `@codex/security` handles HMAC signature generation, timestamp header, and Content-Type header automatically.
- `getServiceUrl('notifications', env)` resolves to `http://localhost:42075` in dev or the production URL in prod.
- Errors are swallowed with `.catch(() => {})` because email must never block or break the calling worker's response. The notifications-api audit log captures failures on its end.
- The function is synchronous (returns `void`) -- the actual fetch runs in the background via `waitUntil()`.

### `packages/worker-utils/src/index.ts` (update)

Re-export the new helper:

```typescript
// Email sending helper (worker-to-worker)
export { sendEmailToWorker, type SendEmailToWorkerParams } from './email/send-email';
```

## Verification

### Unit Tests

File: `packages/notifications/src/services/__tests__/notifications-service-preferences.test.ts`

- **Transactional ignores preferences**: Send with `category: 'transactional'` and user opted out of transactional -- email still sends.
- **Marketing skipped on opt-out**: Send with `category: 'marketing'` and user opted out of marketing -- returns `{ success: false, skipped: 'opted_out' }`.
- **Digest skipped on opt-out**: Send with `category: 'digest'` and user opted out of digest -- returns `{ success: false, skipped: 'opted_out' }`.
- **Default preferences = opted in**: Send with `category: 'marketing'` for user with no preference record -- email sends normally.
- **No userId = skip preference check**: Send with `category: 'marketing'` but no `userId` -- email sends normally (preference check requires userId).
- **Audit log written with 'skipped' status**: After marketing skip, verify `emailAuditLogs` row has status `skipped` and metadata includes `skipReason: 'opted_out'`.

### Integration Tests

File: `workers/notifications-api/src/routes/__tests__/internal.test.ts`

- **Valid HMAC + valid template**: `POST /internal/send` with HMAC headers and valid `email-verification` template data returns 200 with `{ data: { success: true, messageId: ... } }`.
- **Missing HMAC**: `POST /internal/send` without HMAC headers returns 401.
- **Invalid body**: `POST /internal/send` with HMAC but missing `templateName` returns 400.
- **Unknown template**: `POST /internal/send` with HMAC and `templateName: 'nonexistent-template'` returns 404 (TemplateNotFoundError mapped by procedure).
- **Marketing opt-out respected**: `POST /internal/send` with `category: 'marketing'` for user who opted out returns 200 with `{ data: { success: false, skipped: 'opted_out' } }`.

### Manual Verification

1. Start all services: `pnpm dev` (from monorepo root)
2. Generate HMAC headers for a test request:
   ```bash
   # Use the WORKER_SHARED_SECRET from .dev.vars
   # Timestamp: current Unix seconds
   # Payload: the JSON body
   ```
3. Send curl request:
   ```bash
   curl -X POST http://localhost:42075/internal/send \
     -H "Content-Type: application/json" \
     -H "X-Worker-Signature: <generated>" \
     -H "X-Worker-Timestamp: <timestamp>" \
     -d '{
       "to": "test@example.com",
       "templateName": "email-verification",
       "data": { "userName": "Test", "verificationUrl": "https://example.com/verify", "expiryHours": "24" },
       "category": "transactional"
     }'
   ```
4. Verify console shows email output (ConsoleProvider in dev).
5. Check database for `emailAuditLogs` entry with status `success`.
6. Send without HMAC headers -- verify 401 response.

## Review Checklist

- [ ] No `as any` casts anywhere in new code
- [ ] Uses `ObservabilityClient` (via `this.obs`) for logging, not `console.log`
- [ ] `waitUntil()` promise has `.catch()` for fire-and-forget error suppression
- [ ] HMAC auth enforced on `/internal/send` via `policy: { auth: 'worker' }` -- no session auth
- [ ] Preference check skipped for `category: 'transactional'` (legal/compliance requirement)
- [ ] Preference check skipped when `userId` is undefined (anonymous/system sends)
- [ ] Audit log entry created for every send attempt, including opted-out skips
- [ ] `sendEmailToWorker` uses `getServiceUrl('notifications', env)` -- no hardcoded URLs/ports
- [ ] `sendEmailToWorker` uses `workerFetch` from `@codex/security` for HMAC -- no manual signature generation
- [ ] `WORKER_SHARED_SECRET` added to notifications-api env validation middleware required list
- [ ] `internalSendEmailSchema` reuses existing `templateNameSchema` and `uuidSchema` primitives
- [ ] `SendResult` type updated to include optional `skipped` field, or return type documented
- [ ] No business logic in the route handler -- handler delegates entirely to `NotificationsService`

## Acceptance Criteria

- [ ] `POST /internal/send` returns 200 with `{ data: { success: true, messageId: ... } }` for valid HMAC + valid template
- [ ] `POST /internal/send` returns 401 without HMAC headers
- [ ] `POST /internal/send` returns 400 for invalid request body (missing required fields)
- [ ] `POST /internal/send` returns 404 for unknown template name
- [ ] Marketing emails skipped (not sent) when user has opted out, response includes `skipped: 'opted_out'`
- [ ] Digest emails skipped (not sent) when user has opted out
- [ ] Transactional emails always sent regardless of user preference settings
- [ ] Audit log entry created in `emailAuditLogs` for every send attempt (success, failed, and skipped)
- [ ] `sendEmailToWorker` helper exported from `@codex/worker-utils` and callable from any worker
- [ ] `sendEmailToWorker` wraps call in `waitUntil()` so email never blocks the HTTP response
- [ ] All new Zod schemas exported from `@codex/validation`
