# WP3: Auth Email Migration

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P1
**Dependencies**: WP1 (internal send endpoint + `sendEmailToWorker` helper), WP2 (email-verification, password-reset, password-changed, welcome templates seeded in database)
**Estimated scope**: 3 files rewritten/updated, ~80 lines of new code replacing ~130 lines of legacy code

---

## Goal

Migrate the auth worker from hardcoded HTML emails with direct provider instantiation to the centralized template system via notifications-api, and add password reset, password changed, and welcome email hooks.

## Context

The auth worker (`workers/auth/src/email.ts`) currently sends verification emails by:
1. Creating its own `EmailProvider` instance via `createEmailProvider()` (cached per isolate)
2. Building HTML and text bodies inline with hardcoded template strings (`buildVerificationHtml`, `buildVerificationText`)
3. Calling `provider.send()` directly, bypassing the template system entirely

This means verification emails have no audit log entry, no branding injection, no org-scoped template overrides, and a completely different rendering pipeline from every other email. Additionally, password reset, password changed, and welcome emails are not implemented at all -- BetterAuth has hooks for them but they are not wired up.

After this migration:
- All 4 auth email types route through `POST /internal/send` on notifications-api
- The auth worker no longer imports `createEmailProvider` or any email provider code
- All auth emails appear in the `emailAuditLogs` table
- All auth emails use the responsive HTML templates from WP2
- All auth emails receive org branding when an `organizationId` is available

## Changes

### `workers/auth/src/email.ts` (rewrite)

Replace the entire file. Remove:
- `getEmailProvider()` function and provider caching (`cachedProvider`, `cachedProviderKey`)
- `escapeHtml()` helper
- `buildVerificationHtml()` function
- `buildVerificationText()` function
- Import of `createEmailProvider` from `@codex/notifications`
- Import of `EmailProvider` type from `@codex/notifications`

Replace with:

```typescript
/**
 * Auth Worker Email Helper
 *
 * Sends transactional auth emails via the notifications-api template system.
 * Uses sendEmailToWorker() which wraps calls in waitUntil() for fire-and-forget
 * delivery that never blocks the auth response.
 *
 * All emails are category: 'transactional' (always sent, never respect opt-out).
 */

import { sendEmailToWorker } from '@codex/worker-utils';
import type { AuthBindings } from './types';

/**
 * Send email verification link to a newly registered user.
 *
 * Called from BetterAuth's emailVerification.sendVerificationEmail hook.
 */
export function sendVerificationEmail(
  env: AuthBindings,
  executionCtx: ExecutionContext,
  user: { name?: string | null; email: string },
  token: string
): void {
  const verificationUrl = `${env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  sendEmailToWorker(env, executionCtx, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'email-verification',
    data: {
      userName: user.name || 'there',
      verificationUrl,
      expiryHours: '24',
    },
    category: 'transactional',
  });
}

/**
 * Send password reset link.
 *
 * Called from BetterAuth's emailAndPassword.sendResetPasswordEmail hook.
 */
export function sendPasswordResetEmail(
  env: AuthBindings,
  executionCtx: ExecutionContext,
  user: { name?: string | null; email: string },
  resetUrl: string
): void {
  sendEmailToWorker(env, executionCtx, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'password-reset',
    data: {
      userName: user.name || 'there',
      resetUrl,
      expiryHours: '1',
    },
    category: 'transactional',
  });
}

/**
 * Send password changed confirmation.
 *
 * Called from BetterAuth's post-password-change hook.
 * Security: Alerts user that their password was changed (detect unauthorized changes).
 */
export function sendPasswordChangedEmail(
  env: AuthBindings,
  executionCtx: ExecutionContext,
  user: { name?: string | null; email: string }
): void {
  const supportUrl = env.WEB_APP_URL
    ? `${env.WEB_APP_URL}/support`
    : 'https://support.codex.io';

  sendEmailToWorker(env, executionCtx, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'password-changed',
    data: {
      userName: user.name || 'there',
      supportUrl,
    },
    category: 'transactional',
  });
}

/**
 * Send welcome email after email verification completes.
 *
 * Called from BetterAuth's post-verification hook.
 * Only sent once (after verification, not on every login).
 */
export function sendWelcomeEmail(
  env: AuthBindings,
  executionCtx: ExecutionContext,
  user: { name?: string | null; email: string }
): void {
  const baseUrl = env.WEB_APP_URL || '';

  sendEmailToWorker(env, executionCtx, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'welcome',
    data: {
      userName: user.name || 'there',
      loginUrl: `${baseUrl}/login`,
      exploreUrl: baseUrl,
    },
    category: 'transactional',
  });
}
```

**Key changes**:
- All functions are now synchronous (return `void`) because `sendEmailToWorker` handles the `waitUntil` internally.
- All functions accept `executionCtx: ExecutionContext` as a parameter (required by `sendEmailToWorker`).
- No email provider imports, no HTML construction, no direct sending.
- All emails are `category: 'transactional'` (always sent).

### `workers/auth/src/auth-config.ts` (update)

The core challenge: BetterAuth hooks need access to both `env` (already available via closure) and `executionCtx` (not currently available). The `createAuthInstance` function only receives `{ env }` but needs the execution context for `waitUntil()`.

**Option A (recommended)**: Expand `AuthConfigOptions` to include `executionCtx`:

```typescript
interface AuthConfigOptions {
  env: AuthBindings;
  executionCtx: ExecutionContext;
}

export function createAuthInstance(options: AuthConfigOptions) {
  const { env, executionCtx } = options;
  // ... rest of config
}
```

Then update the call site in `workers/auth/src/index.ts` to pass `c.executionCtx`:

```typescript
const auth = createAuthInstance({ env: c.env, executionCtx: c.executionCtx });
```

**Option B (if BetterAuth caches the instance)**: If `createAuthInstance` is cached per-isolate and `executionCtx` changes per-request, this approach won't work. In that case, use a mutable ref:

```typescript
let _currentExecutionCtx: ExecutionContext | null = null;

export function setExecutionContext(ctx: ExecutionContext) {
  _currentExecutionCtx = ctx;
}
```

The engineer should check whether `createAuthInstance()` is called per-request (it currently is -- see `index.ts` line 67: `const auth = createAuthInstance({ env: c.env })` inside the handler) or cached. Since it is called per-request, **Option A is correct**.

**Hook changes**:

1. Update `emailVerification.sendVerificationEmail` to pass `executionCtx`:

```typescript
emailVerification: {
  sendVerificationEmail: async ({ user, token }, _request?: Request) => {
    // Store token in KV for E2E tests (development/test only)
    if (
      env.AUTH_SESSION_KV &&
      (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT ||
        env.ENVIRONMENT === ENV_NAMES.TEST)
    ) {
      await env.AUTH_SESSION_KV.put(`verification:${user.email}`, token, {
        expirationTtl: 300,
      });
    }

    // Send via template system (fire-and-forget via waitUntil)
    sendVerificationEmail(env, executionCtx, user, token);
  },
  // ... rest unchanged
},
```

2. Add `sendResetPassword` hook to `emailAndPassword`:

```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  autoSignIn: true,
  sendResetPassword: async ({ user, url }, _request?: Request) => {
    sendPasswordResetEmail(env, executionCtx, user, url);
  },
},
```

**Important**: Check BetterAuth's documentation for the exact hook name and signature. The hook may be called `sendResetPasswordEmail` or `sendResetPassword` -- verify against the BetterAuth version pinned in `package.json`. The callback receives `{ user, url }` where `url` is the full reset URL including the token.

3. Add post-password-change hook. BetterAuth may expose this as an `onPasswordChange` or `afterPasswordReset` callback. Check the BetterAuth API. If no direct hook exists, add it as an `onAfterPasswordChange` plugin hook or use the `databaseHooks` option:

```typescript
databaseHooks: {
  session: {
    // ... existing hooks if any
  },
},
// Or if BetterAuth supports:
hooks: {
  after: [
    {
      matcher: (context) => context.path === '/api/auth/change-password',
      handler: async (ctx) => {
        // ctx.context.session.userId → look up user → send email
        if (ctx.context?.session?.userId) {
          const user = await db.query.users.findFirst({
            where: eq(schema.users.id, ctx.context.session.userId),
          });
          if (user) {
            sendPasswordChangedEmail(env, executionCtx, user);
          }
        }
      },
    },
  ],
},
```

The exact implementation depends on the BetterAuth version's hook system. The engineer must verify the correct approach.

4. Add post-verification hook for welcome email. BetterAuth's `emailVerification.autoSignInAfterVerification` already fires after verification. Check if there is an `onEmailVerified` or `afterEmailVerification` hook. If not, use `databaseHooks` to detect when `emailVerified` flips from `false` to `true`:

```typescript
databaseHooks: {
  user: {
    update: {
      after: async (user) => {
        // Detect email verification (emailVerified changed to true)
        if (user.emailVerified) {
          // Check if this is the first verification (not a re-verification)
          // by checking if the user was recently created
          sendWelcomeEmail(env, executionCtx, {
            name: user.name,
            email: user.email,
          });
        }
      },
    },
  },
},
```

**Caution**: The `databaseHooks.user.update.after` hook fires on every user update, not just verification. The engineer must add a guard to only send the welcome email once. Options:
- Check if the update specifically changed `emailVerified` (compare before/after)
- Use a flag or timestamp column to track whether welcome email was sent
- Check `emailAuditLogs` for an existing `welcome` template send to this user (query via notifications-api or direct DB check)

The simplest approach: check if the update sets `emailVerified = true` and the user's `createdAt` is within the last hour (new users only, not resets).

### `workers/auth/src/types.ts` (update)

`WORKER_SHARED_SECRET` is already on the shared `Bindings` type in `@codex/shared-types/src/worker-types.ts` (line 32). The `AuthBindings` type extends `SharedBindings`, so it already has access. No type changes are needed.

However, verify that the auth worker's `wrangler.toml` and `.dev.vars` include `WORKER_SHARED_SECRET`. The auth worker's env validation middleware should also be updated to include it in the required list, but the auth worker uses BetterAuth's custom middleware chain (not standard `procedure()`), so the validation is in `createEnvValidationMiddleware`:

```typescript
// In workers/auth/src/index.ts
createEnvValidationMiddleware({
  required: ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ENVIRONMENT', 'WORKER_SHARED_SECRET'],
  optional: ['WEB_APP_URL', 'API_URL'],
})
```

### `workers/auth/wrangler.toml` / `.dev.vars` (update)

Ensure `WORKER_SHARED_SECRET` is configured. It is likely already present since it is a shared binding used by media-api. Verify:

```toml
# wrangler.toml (if using vars)
[vars]
WORKER_SHARED_SECRET = "..."

# Or in .dev.vars (if using secrets)
WORKER_SHARED_SECRET=dev-shared-secret-for-hmac
```

Check other workers' `.dev.vars` or `wrangler.toml` files to confirm the value matches across all workers.

## Verification

### Unit Tests

File: `workers/auth/src/__tests__/email.test.ts`

- **sendVerificationEmail calls sendEmailToWorker**: Mock `sendEmailToWorker`, call `sendVerificationEmail(env, executionCtx, user, token)`, verify mock was called with correct template name (`email-verification`), correct data tokens, and `category: 'transactional'`.
- **sendPasswordResetEmail calls sendEmailToWorker**: Same pattern, verify `templateName: 'password-reset'`, `resetUrl` passed through, `expiryHours: '1'`.
- **sendPasswordChangedEmail calls sendEmailToWorker**: Verify `templateName: 'password-changed'`, `supportUrl` constructed from `env.WEB_APP_URL`.
- **sendWelcomeEmail calls sendEmailToWorker**: Verify `templateName: 'welcome'`, `loginUrl` and `exploreUrl` constructed from `env.WEB_APP_URL`.
- **No HTML in email.ts**: Static analysis -- verify the file contains no `<html>`, `<body>`, `<table>`, or `<td>` strings (confirms hardcoded templates are removed).
- **No provider imports**: Verify the file does not import `createEmailProvider`, `EmailProvider`, or any provider class.

### Integration Tests

File: `workers/auth/src/__tests__/auth-email-integration.test.ts`

These require `pnpm dev` (or test harness) with both auth and notifications-api workers running:

- **Registration sends verification email**: Register a new user via `POST /api/auth/sign-up/email`, verify `emailAuditLogs` table has a row with `templateName: 'email-verification'` and the user's email.
- **Password reset sends email**: Call `POST /api/auth/email/send-reset-password-email` with a registered user's email, verify `emailAuditLogs` has `templateName: 'password-reset'`.
- **Email verification sends welcome email**: Verify a user's email, verify `emailAuditLogs` has `templateName: 'welcome'`.

### Manual Verification

1. Start all services: `pnpm dev`
2. **Registration flow**:
   - Register a new user at `http://lvh.me:3000/register`
   - Check the notifications-api terminal output for the verification email (ConsoleProvider logs the full rendered email)
   - Verify the email uses the responsive HTML template from WP2 (not the old hardcoded HTML)
   - Check the database: `SELECT * FROM email_audit_logs WHERE template_name = 'email-verification' ORDER BY created_at DESC LIMIT 1;`
3. **Password reset flow**:
   - Go to `http://lvh.me:3000/login` and click "Forgot password"
   - Enter a registered email
   - Check the notifications-api terminal for the password reset email
   - Verify the audit log entry
4. **Password change flow** (if hook is implemented):
   - Log in, change password via settings
   - Check for password-changed email in notifications-api terminal
5. **Welcome email flow**:
   - Complete email verification for a newly registered user
   - Check for welcome email in notifications-api terminal
6. **Verify no hardcoded HTML remains**:
   ```bash
   grep -c '<html>\|<body>\|<table>' workers/auth/src/email.ts
   ```
   Expected output: `0`
7. **Verify no provider imports**:
   ```bash
   grep -c 'createEmailProvider\|EmailProvider' workers/auth/src/email.ts
   ```
   Expected output: `0`

## Review Checklist

- [ ] `workers/auth/src/email.ts` contains no `<html>`, `<body>`, `<table>`, or `<td>` tags
- [ ] `workers/auth/src/email.ts` does not import `createEmailProvider` or any email provider
- [ ] All 4 email functions (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendPasswordChangedEmail`, `sendWelcomeEmail`) use `sendEmailToWorker` from `@codex/worker-utils`
- [ ] All 4 emails use `category: 'transactional'`
- [ ] `executionCtx` is properly threaded from `index.ts` through `createAuthInstance` to BetterAuth hooks
- [ ] `createAuthInstance` is called per-request (not cached), confirming `executionCtx` is fresh per request
- [ ] KV token storage for E2E tests is preserved (development/test only)
- [ ] `WORKER_SHARED_SECRET` is in auth worker's env validation and `.dev.vars`
- [ ] BetterAuth hook names and signatures match the pinned BetterAuth version
- [ ] Welcome email has a guard to prevent sending on every user update (only on first verification)
- [ ] No `as any` casts
- [ ] No `console.log` -- uses `ObservabilityClient` where logging is needed
- [ ] Password reset `expiryHours` matches BetterAuth's actual token expiry (verify configuration)

## Acceptance Criteria

- [ ] Auth worker sends all 4 email types (verification, password reset, password changed, welcome) via notifications-api template system
- [ ] No hardcoded HTML remains in `workers/auth/src/email.ts`
- [ ] Auth worker no longer directly instantiates email providers (`createEmailProvider` not imported)
- [ ] All 4 email types create audit log entries in `emailAuditLogs` table
- [ ] `executionCtx` is properly threaded through BetterAuth config hooks so `waitUntil()` works
- [ ] Registration flow: user registers, receives verification email rendered from database template with responsive HTML
- [ ] Password reset flow: user requests reset, receives email with correct reset URL
- [ ] Password change flow: user changes password, receives confirmation email
- [ ] Email verification flow: user verifies email, receives welcome email
- [ ] E2E test KV token storage still works (development/test environments)
- [ ] Auth worker's `wrangler.toml` / `.dev.vars` includes `WORKER_SHARED_SECRET`
