# WP6: Unsubscribe System

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P1
**Dependencies**: WP1, WP2
**Estimated scope**: 8 files created/changed, ~400 lines of new code

---

## Goal

Implement HMAC-signed unsubscribe links, public one-click unsubscribe endpoints, a SvelteKit confirmation page, and RFC 8058 `List-Unsubscribe` headers so non-transactional emails comply with CAN-SPAM and GDPR requirements.

## Context

The notification system (from WP1) sends emails in three categories: `transactional` (always delivered), `marketing` (respects opt-out), and `digest` (respects opt-out). The `notificationPreferences` table already exists with `emailMarketing`, `emailTransactional`, and `emailDigest` boolean columns keyed by `userId`. WP1 added preference checking to `NotificationsService.sendEmail()` so opted-out users are skipped for non-transactional categories.

However, there is currently no way for users to unsubscribe from within an email. Non-transactional templates (from WP2) include an `{{unsubscribeUrl}}` token in their footer, but nothing generates the URL or processes the unsubscribe action. There are no public unsubscribe endpoints and no SvelteKit page to handle the flow. The `List-Unsubscribe` header (required by Gmail and other ESPs for bulk sender compliance) is also missing.

The web app currently has no `(public)` route group -- this will be the first route that requires no authentication and no org context.

## Changes

### `packages/notifications/src/unsubscribe.ts` (new)

HMAC-signed unsubscribe token utility. Tokens are self-contained (no DB lookup needed to verify), tamper-proof, and time-limited:

```typescript
import { timingSafeEqual } from 'node:crypto';

export interface UnsubscribePayload {
  userId: string;
  category: 'marketing' | 'digest';
  expiresAt: number; // Unix timestamp (seconds)
}

const EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Generate an HMAC-signed unsubscribe token.
 *
 * Token format: base64url(JSON(payload)).base64url(HMAC-SHA256(payload, secret))
 *
 * The payload is NOT encrypted -- it is readable (base64url). The HMAC
 * signature prevents tampering. The expiry prevents replay after 30 days.
 *
 * @param payload - userId and category to unsubscribe from
 * @param secret  - WORKER_SHARED_SECRET (same across all workers)
 * @returns Signed token string
 */
export async function generateUnsubscribeToken(
  payload: Omit<UnsubscribePayload, 'expiresAt'>,
  secret: string
): Promise<string> {
  const fullPayload: UnsubscribePayload = {
    ...payload,
    expiresAt: Math.floor(Date.now() / 1000) + EXPIRY_SECONDS,
  };

  const payloadJson = JSON.stringify(fullPayload);
  const payloadB64 = base64UrlEncode(payloadJson);

  // HMAC-SHA256 signature
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64)
  );
  const signatureB64 = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify and decode an unsubscribe token.
 *
 * @returns Decoded payload if valid, null if invalid/expired/tampered
 */
export async function verifyUnsubscribeToken(
  token: string,
  secret: string
): Promise<UnsubscribePayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  // Verify HMAC signature (timing-safe)
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = Uint8Array.from(
      base64UrlDecode(signatureB64),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(payloadB64)
    );

    if (!valid) return null;
  } catch {
    return null;
  }

  // Decode payload
  let payload: UnsubscribePayload;
  try {
    const decoded = base64UrlDecode(payloadB64);
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }

  // Validate structure
  if (
    !payload.userId ||
    !payload.category ||
    typeof payload.expiresAt !== 'number'
  ) {
    return null;
  }

  // Reject transactional category (should never be in a token, but defense in depth)
  if (payload.category !== 'marketing' && payload.category !== 'digest') {
    return null;
  }

  // Check expiry
  if (Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return null;
  }

  return payload;
}

// --- Helpers ---

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}
```

Also update `packages/notifications/src/index.ts` to export:

```typescript
export {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  type UnsubscribePayload,
} from './unsubscribe';
```

### `workers/notifications-api/src/routes/unsubscribe.ts` (new)

Public endpoints -- no authentication required. These handle the unsubscribe flow from email links:

```typescript
import type { HonoEnv } from '@codex/shared-types';
import { verifyUnsubscribeToken } from '@codex/notifications';
import { createDbClient } from '@codex/database';
import { notificationPreferences } from '@codex/database/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * GET /unsubscribe/:token
 *
 * Validates an unsubscribe token without side effects.
 * Used by the SvelteKit page to display the confirmation UI.
 *
 * Public endpoint -- no auth required.
 */
app.get('/:token', async (c) => {
  const { token } = c.req.param();
  const secret = c.env.WORKER_SHARED_SECRET;

  const payload = await verifyUnsubscribeToken(token, secret);

  if (!payload) {
    return c.json({
      valid: false,
      reason: 'This unsubscribe link has expired or is invalid.',
    });
  }

  return c.json({
    valid: true,
    userId: payload.userId,
    category: payload.category,
  });
});

/**
 * POST /unsubscribe/:token
 *
 * Processes the unsubscribe action. Updates the notificationPreferences
 * table to opt the user out of the specified category.
 *
 * Idempotent -- re-unsubscribing the same category is a no-op.
 *
 * Public endpoint -- no auth required.
 */
app.post('/:token', async (c) => {
  const { token } = c.req.param();
  const secret = c.env.WORKER_SHARED_SECRET;

  const payload = await verifyUnsubscribeToken(token, secret);

  if (!payload) {
    return c.json(
      {
        success: false,
        reason: 'This unsubscribe link has expired or is invalid.',
      },
      400
    );
  }

  const db = createDbClient(c.env);

  // Map category to DB column
  const columnUpdate =
    payload.category === 'marketing'
      ? { emailMarketing: false }
      : { emailDigest: false };

  // Upsert: create preferences row if it doesn't exist, or update if it does
  await db
    .insert(notificationPreferences)
    .values({
      userId: payload.userId,
      ...columnUpdate,
      // Defaults for other columns (true) handled by DB schema
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...columnUpdate,
        updatedAt: new Date(),
      },
    });

  return c.json({
    success: true,
    category: payload.category,
  });
});

export default app;
```

### `workers/notifications-api/src/index.ts` (update)

Mount the unsubscribe routes. These are public (no auth middleware):

```typescript
import unsubscribeRoutes from './routes/unsubscribe';

// After existing route mounts:
app.route('/unsubscribe', unsubscribeRoutes);
```

### `packages/notifications/src/services/notifications-service.ts` (update)

In the `sendEmail()` method, after rendering the template and before sending, inject the unsubscribe URL for non-transactional emails and add RFC 8058 headers:

```typescript
import { generateUnsubscribeToken } from '../unsubscribe';

// --- Inside sendEmail(), after template rendering (step 4), before send (step 5) ---

// 4b. Inject unsubscribe URL for non-transactional emails
let unsubscribeUrl: string | undefined;
let emailHeaders: Record<string, string> | undefined;

if (
  params.category &&
  params.category !== 'transactional' &&
  params.userId
) {
  const secret = this.unsubscribeSecret; // Injected via config
  if (secret) {
    const token = await generateUnsubscribeToken(
      { userId: params.userId, category: params.category },
      secret
    );
    unsubscribeUrl = `${this.webAppUrl}/unsubscribe/${token}`;

    // Replace {{unsubscribeUrl}} in rendered HTML and text
    htmlResult.content = htmlResult.content.replace(
      /\{\{unsubscribeUrl\}\}/g,
      unsubscribeUrl
    );
    textResult.content = textResult.content.replace(
      /\{\{unsubscribeUrl\}\}/g,
      unsubscribeUrl
    );

    // RFC 8058 List-Unsubscribe headers
    emailHeaders = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
}
```

The `NotificationsServiceConfig` interface needs two new optional fields:

```typescript
// In packages/notifications/src/types.ts
export interface NotificationsServiceConfig extends BaseServiceConfig {
  // ... existing fields ...
  /** Secret for signing unsubscribe tokens (WORKER_SHARED_SECRET) */
  unsubscribeSecret?: string;
  /** Web app base URL for building unsubscribe links */
  webAppUrl?: string;
}
```

The `sendEmail` params type also needs the new fields (these may already exist from WP1):

```typescript
interface SendEmailParams {
  // ... existing fields ...
  category?: 'transactional' | 'marketing' | 'digest';
  userId?: string;
}
```

### `packages/notifications/src/providers/resend-provider.ts` (update)

Accept and pass custom headers (for `List-Unsubscribe`) to the Resend SDK:

```typescript
export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>; // NEW: custom headers
}

// In ResendProvider.send():
async send(message: EmailMessage, from: EmailFrom): Promise<SendResult> {
  try {
    const result = await this.client.emails.send({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: message.toName ? `${message.toName} <${message.to}>` : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers, // Pass List-Unsubscribe headers
    });
    // ... existing error handling ...
  }
}
```

Also update `packages/notifications/src/providers/types.ts` to add `headers?` to `EmailMessage`:

```typescript
export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}
```

### `apps/web/src/routes/(public)/unsubscribe/[token]/+page.server.ts` (new)

Server load function that validates the unsubscribe token by calling the notifications-api:

```typescript
import { getServiceUrl } from '@codex/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
  const { token } = params;

  try {
    const apiUrl = getServiceUrl('NOTIFICATIONS', {
      ENVIRONMENT: 'development', // Will use env in production
    });

    const response = await fetch(`${apiUrl}/unsubscribe/${token}`);
    const data = await response.json();

    return {
      token,
      valid: data.valid ?? false,
      category: data.category ?? null,
      reason: data.reason ?? null,
    };
  } catch {
    return {
      token,
      valid: false,
      category: null,
      reason: 'Unable to verify this unsubscribe link. Please try again later.',
    };
  }
};
```

### `apps/web/src/routes/(public)/unsubscribe/[token]/+page.svelte` (new)

Minimal public page with no auth requirement and platform-only branding:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  let status: 'idle' | 'loading' | 'success' | 'error' = $state('idle');
  let errorMessage = $state('');

  async function handleUnsubscribe() {
    status = 'loading';

    try {
      const response = await fetch(`/api/unsubscribe/${data.token}`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success) {
        status = 'success';
      } else {
        status = 'error';
        errorMessage = result.reason || m.unsubscribe_error_generic();
      }
    } catch {
      status = 'error';
      errorMessage = m.unsubscribe_error_generic();
    }
  }

  const categoryLabel =
    data.category === 'marketing'
      ? m.unsubscribe_category_marketing()
      : data.category === 'digest'
        ? m.unsubscribe_category_digest()
        : m.unsubscribe_category_unknown();
</script>

<svelte:head>
  <title>{m.unsubscribe_page_title()}</title>
</svelte:head>

<div class="unsubscribe-page">
  <div class="unsubscribe-card">
    <h1 class="unsubscribe-heading">{m.unsubscribe_heading()}</h1>

    {#if !data.valid}
      <!-- Invalid or expired token -->
      <p class="unsubscribe-message unsubscribe-message--error">
        {data.reason || m.unsubscribe_invalid_link()}
      </p>

    {:else if status === 'success'}
      <!-- Successfully unsubscribed -->
      <p class="unsubscribe-message unsubscribe-message--success">
        {m.unsubscribe_success({ category: categoryLabel })}
      </p>

    {:else if status === 'error'}
      <!-- Error during unsubscribe -->
      <p class="unsubscribe-message unsubscribe-message--error">
        {errorMessage}
      </p>

    {:else}
      <!-- Confirmation prompt -->
      <p class="unsubscribe-message">
        {m.unsubscribe_confirm({ category: categoryLabel })}
      </p>

      <button
        class="unsubscribe-button"
        onclick={handleUnsubscribe}
        disabled={status === 'loading'}
      >
        {#if status === 'loading'}
          {m.unsubscribe_button_loading()}
        {:else}
          {m.unsubscribe_button()}
        {/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .unsubscribe-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--spacing-lg);
    background: var(--color-surface-primary);
  }

  .unsubscribe-card {
    max-width: 28rem;
    width: 100%;
    padding: var(--spacing-xl);
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    text-align: center;
  }

  .unsubscribe-heading {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    margin-block-end: var(--spacing-md);
  }

  .unsubscribe-message {
    font-size: var(--font-size-md);
    color: var(--color-text-secondary);
    margin-block-end: var(--spacing-lg);
    line-height: var(--line-height-relaxed);
  }

  .unsubscribe-message--success {
    color: var(--color-success);
  }

  .unsubscribe-message--error {
    color: var(--color-error);
  }

  .unsubscribe-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-sm) var(--spacing-lg);
    border-radius: var(--radius-md);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-medium);
    border: none;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .unsubscribe-button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .unsubscribe-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
```

### `apps/web/src/paraglide/messages/en.js` (update)

Add i18n keys for the unsubscribe page:

```javascript
// Unsubscribe page
export const unsubscribe_page_title = () => 'Unsubscribe';
export const unsubscribe_heading = () => 'Email Preferences';
export const unsubscribe_confirm = ({ category }) =>
  `You're about to unsubscribe from ${category} emails.`;
export const unsubscribe_success = ({ category }) =>
  `You've been successfully unsubscribed from ${category} emails.`;
export const unsubscribe_button = () => 'Unsubscribe';
export const unsubscribe_button_loading = () => 'Processing...';
export const unsubscribe_invalid_link = () =>
  'This unsubscribe link has expired or is invalid.';
export const unsubscribe_error_generic = () =>
  'Something went wrong. Please try again later.';
export const unsubscribe_category_marketing = () => 'marketing';
export const unsubscribe_category_digest = () => 'weekly digest';
export const unsubscribe_category_unknown = () => 'notification';
```

---

## Verification

### Unit Tests

**`packages/notifications/src/__tests__/unsubscribe.test.ts`** (new):

- `generateUnsubscribeToken()` produces a string in `payload.signature` format (two dot-separated parts)
- `verifyUnsubscribeToken()` accepts a freshly generated valid token and returns correct payload
- `verifyUnsubscribeToken()` rejects an expired token (mock `Date.now` to be 31 days later)
- `verifyUnsubscribeToken()` rejects a tampered token (modify one character in the payload portion)
- `verifyUnsubscribeToken()` rejects a tampered signature (modify one character in the signature portion)
- `verifyUnsubscribeToken()` rejects a token with `category` not in `['marketing', 'digest']` (e.g., `transactional`)
- `verifyUnsubscribeToken()` returns null for empty string, malformed strings, missing dot separator
- Round-trip: generate then verify returns the original `userId` and `category`

**`workers/notifications-api/src/routes/__tests__/unsubscribe.test.ts`** (new):

- `GET /unsubscribe/:token` with valid token returns `{ valid: true, userId, category }`
- `GET /unsubscribe/:token` with expired token returns `{ valid: false, reason }`
- `GET /unsubscribe/:token` with tampered token returns `{ valid: false, reason }`
- `POST /unsubscribe/:token` with valid token updates `notificationPreferences` and returns `{ success: true }`
- `POST /unsubscribe/:token` twice (idempotent): second call succeeds, preference still `false`
- `POST /unsubscribe/:token` with expired token returns 400 with `{ success: false, reason }`
- `POST /unsubscribe/:token` creates preferences row if none exists (new user who never had a row)

**`packages/notifications/src/services/__tests__/notifications-service.test.ts`** (extend):

- Non-transactional email: `{{unsubscribeUrl}}` replaced with actual URL in rendered HTML and text
- Non-transactional email: `List-Unsubscribe` header present in message passed to provider
- Transactional email: `{{unsubscribeUrl}}` NOT replaced, no `List-Unsubscribe` header
- Missing `unsubscribeSecret` config: unsubscribe injection skipped gracefully

### Integration Tests

- Send marketing email via `POST /internal/send` with `category: 'marketing'` and `userId`
- Verify rendered HTML contains `/unsubscribe/` URL
- Extract token from URL, call `GET /unsubscribe/:token`, verify `valid: true`
- Call `POST /unsubscribe/:token`, verify `notification_preferences` row updated
- Send another marketing email to same user, verify `status: 'skipped'` in audit log
- Send transactional email to same user, verify it still delivers (status: success)

### Manual Verification

1. Send a marketing email (e.g., `welcome` template to a test user)
2. In console output (dev mode), locate the unsubscribe URL in the email footer
3. Open the URL in a browser -- verify the unsubscribe confirmation page renders
4. Click "Unsubscribe" -- verify success message displays
5. Query DB: `SELECT * FROM notification_preferences WHERE user_id = '<userId>'` -- verify `email_marketing = false`
6. Send another marketing email to the same user -- verify it is skipped (audit log: `status = 'skipped'`)
7. Send a transactional email (e.g., `purchase-receipt`) -- verify it still sends

### Playwright/Chrome DevTools (for frontend)

**`apps/web/e2e/unsubscribe.spec.ts`** (new):

- Navigate to `/unsubscribe/<valid-token>` -- verify heading "Email Preferences" renders
- Verify confirmation text includes category name ("marketing" or "weekly digest")
- Click "Unsubscribe" button -- verify success message replaces the button
- Navigate to `/unsubscribe/<expired-token>` -- verify error message about expired/invalid link
- Navigate to `/unsubscribe/<tampered-token>` -- verify error message
- Navigate to `/unsubscribe/not-a-real-token` -- verify error message

---

## Review Checklist

- [ ] Unsubscribe tokens use HMAC-SHA256 via Web Crypto API (Cloudflare Workers compatible, not Node.js `crypto`)
- [ ] Token verification is timing-safe (`crypto.subtle.verify` handles this internally)
- [ ] 30-day expiry is hardcoded in the token generator, not configurable (security decision)
- [ ] `transactional` category is explicitly rejected in `verifyUnsubscribeToken` -- defense in depth
- [ ] `POST /unsubscribe/:token` is idempotent (upsert pattern with `onConflictDoUpdate`)
- [ ] Unsubscribe endpoints are public (no auth middleware) -- users click from email without logging in
- [ ] `List-Unsubscribe` header follows RFC 8058 format: `<url>` angle brackets required
- [ ] `List-Unsubscribe-Post` header value is exactly `List-Unsubscribe=One-Click` (RFC 8058)
- [ ] SvelteKit page uses design tokens for all styling -- no hardcoded hex colors or pixel values
- [ ] SvelteKit page uses Svelte 5 runes (`$props`, `$state`) -- no legacy `export let` or stores
- [ ] No `as any` type casts
- [ ] No `console.log` -- structured logging only
- [ ] i18n keys added for all user-facing strings
- [ ] `EmailMessage` type change (`headers?` field) is backward-compatible -- existing calls omit it

---

## Acceptance Criteria

- [ ] Unsubscribe tokens are HMAC-SHA256 signed with 30-day expiry
- [ ] `GET /unsubscribe/:token` validates token without side effects (no DB writes)
- [ ] `POST /unsubscribe/:token` updates `notificationPreferences` and is idempotent
- [ ] Non-transactional emails include unsubscribe footer link (resolved `{{unsubscribeUrl}}`)
- [ ] `List-Unsubscribe` and `List-Unsubscribe-Post` headers present in non-transactional emails
- [ ] Transactional emails do NOT include unsubscribe link or headers
- [ ] SvelteKit page renders confirmation UI without authentication
- [ ] SvelteKit page shows success state after unsubscribe
- [ ] Expired tokens show clear "expired or invalid" message
- [ ] Tampered tokens show clear "expired or invalid" message
- [ ] Token with `transactional` category is rejected
- [ ] Re-unsubscribing is a no-op (idempotent, no error)
