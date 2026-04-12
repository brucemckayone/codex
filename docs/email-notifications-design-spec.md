# Email Notifications System Design Specification

**Version**: 1.0
**Date**: 2026-04-08
**Status**: Implementation-ready

---

## 1. Overview

### Purpose

Connect the existing `@codex/notifications` infrastructure to every meaningful event in the Codex platform. Today, the notification system has full template resolution (Creator > Org > Global), audit logging, retry with exponential backoff, branding injection, XSS protection, and provider abstraction -- but almost nothing uses it. Only email verification fires, and it bypasses the template system with hardcoded HTML in the auth worker.

### Scope

- 18 email templates across 4 priority tiers (P0-P3)
- Worker-to-worker integration for 6 workers (auth, ecom-api, organization-api, media-api, content-api, notifications-api)
- Unsubscribe system (HMAC-signed tokens, one-click, RFC 8058 compliance)
- Studio template management UI
- Enhanced notification preferences and audit log UI
- Weekly digest cron job

### What This Enables

- **Revenue compliance**: Purchase receipts, subscription confirmations, payment failure notices
- **User trust**: Password change confirmation, security notifications
- **Creator engagement**: Sale notifications, transcoding status, new subscriber alerts
- **Platform growth**: Welcome emails, content publish notifications, weekly digest
- **Org customization**: Template overrides per-org and per-creator via existing 3-tier system

### Architecture

```
                                    Codex Email Notification Flow
 ============================================================================

  auth (42069)          ecom-api (42072)       organization-api (42071)
  +-----------+         +--------------+       +-------------------+
  | register  |         | checkout     |       | inviteMember()    |
  | verify    |         | subscription |       | updateMemberRole()|
  | password  |         | refund       |       | removeMember()    |
  +-----------+         +--------------+       +-------------------+
       |                       |                        |
       |  waitUntil()          |  waitUntil()           |  waitUntil()
       v                       v                        v
  +------------------------------------------------------------------+
  |                                                                  |
  |          POST /internal/send  (HMAC worker-to-worker auth)       |
  |                                                                  |
  |                  notifications-api (42075)                       |
  |                                                                  |
  |  1. Validate request (Zod schema)                                |
  |  2. Check notification preferences (transactional = always)      |
  |  3. Resolve template (Creator > Org > Global)                    |
  |  4. Resolve org branding (logo, colors, support email)           |
  |  5. Render template (token substitution, XSS protection)         |
  |  6. Inject unsubscribe link (non-transactional only)             |
  |  7. Send via provider (Resend prod / Console dev / InMemory test)|
  |  8. Write audit log (emailAuditLogs table)                       |
  |  9. Retry on failure (exponential backoff, max 2 retries)        |
  |                                                                  |
  +------------------------------------------------------------------+
       ^                       ^                        ^
       |  waitUntil()          |  waitUntil()           |  cron
       |                       |                        |
  media-api (4002)       content-api (4001)       notifications-api
  +-----------+          +--------------+         +-----------------+
  | transcode |          | publish()    |         | weekly digest   |
  | complete  |          |              |         | (Cron Trigger)  |
  | failed    |          |              |         |                 |
  +-----------+          +--------------+         +-----------------+
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Single send endpoint on notifications-api | Centralizes audit logging, preference checking, and delivery -- no email logic scattered across workers |
| Fire-and-forget via `waitUntil()` | Email sending never blocks HTTP responses to users or Stripe |
| HMAC worker-to-worker auth | Same security model as media-api internal endpoints |
| Template seeding via database seed script | Global defaults exist immediately, overridable per-org/creator without code changes |
| Transactional emails ignore preferences | Receipts, password resets, and security notices always deliver (legal/compliance) |
| HMAC-signed unsubscribe tokens | No auth required to unsubscribe -- one-click from email link (RFC 8058) |

---

## 2. Email Catalogue

### Priority Definitions

| Priority | Criteria | SLA |
|---|---|---|
| **P0** | Revenue and compliance -- purchase receipts, subscription lifecycle, refunds | Must ship before any paid content goes live |
| **P1** | Core platform -- password reset, welcome, org invitations | Must ship before public launch |
| **P2** | Creator experience -- transcoding status, sale notifications, Connect status | Ship within first month post-launch |
| **P3** | Engagement -- content publish, weekly digest, member role changes | Ship as growth features |

---

### P0 -- Revenue and Compliance

These emails are legally required for paid transactions. All are **transactional** category (always sent regardless of preferences).

#### 1. `purchase-receipt`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `checkout.session.completed` (mode=payment) |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/checkout.ts` -- `handleCheckoutCompleted()` |
| **Recipient** | Customer (purchaser) |
| **Template tokens** | `userName`, `contentTitle`, `priceFormatted`, `purchaseDate`, `contentUrl`, `orgName` |

**Notes**: Price formatted in GBP (e.g., "9.99"). The `priceFormatted` token includes the currency symbol. Customer email resolved from Stripe session `customer_details.email` or DB lookup via `customerId` metadata.

#### 2. `subscription-created`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `checkout.session.completed` (mode=subscription) |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/subscription-webhook.ts` -- `handleSubscriptionWebhook()` |
| **Recipient** | Customer (subscriber) |
| **Template tokens** | `userName`, `planName`, `priceFormatted`, `billingInterval`, `nextBillingDate`, `manageUrl` |

**Notes**: `billingInterval` is "month" or "year". `manageUrl` links to the Stripe Customer Portal or account settings.

#### 3. `subscription-renewed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `invoice.payment_succeeded` (recurring, not first invoice) |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/subscription-webhook.ts` -- `handleSubscriptionWebhook()` |
| **Recipient** | Customer (subscriber) |
| **Template tokens** | `userName`, `planName`, `priceFormatted`, `billingDate`, `nextBillingDate`, `manageUrl` |

**Notes**: Must distinguish first invoice (handled by `subscription-created`) from recurring renewals. Check `invoice.billing_reason` -- only send on `subscription_cycle`, not `subscription_create`.

#### 4. `payment-failed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `invoice.payment_failed` |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/subscription-webhook.ts` -- `handleSubscriptionWebhook()` |
| **Recipient** | Customer (subscriber) |
| **Template tokens** | `userName`, `planName`, `priceFormatted`, `retryDate`, `updatePaymentUrl` |

**Notes**: Stripe retries failed payments automatically. `retryDate` is the next retry attempt. `updatePaymentUrl` links to Stripe Customer Portal for card update.

#### 5. `subscription-cancelled`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `customer.subscription.deleted` |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/subscription-webhook.ts` -- `handleSubscriptionWebhook()` |
| **Recipient** | Customer (subscriber) |
| **Template tokens** | `userName`, `planName`, `accessEndDate`, `resubscribeUrl` |

**Notes**: `accessEndDate` is the end of the current billing period (access continues until then). `resubscribeUrl` links back to the subscription page.

#### 6. `refund-processed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `charge.refunded` |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/payment-webhook.ts` -- `handlePaymentWebhook()` |
| **Recipient** | Customer (purchaser) |
| **Template tokens** | `userName`, `contentTitle`, `refundAmount`, `originalAmount`, `refundDate` |

**Notes**: Supports partial refunds. `refundAmount` and `originalAmount` both formatted in GBP with currency symbol.

---

### P1 -- Core Platform

#### 7. `org-member-invitation`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `OrganizationService.inviteMember()` |
| **Source worker** | organization-api |
| **Source handler** | `routes/members.ts` |
| **Recipient** | Invitee (email address, may not have account yet) |
| **Template tokens** | `inviterName`, `orgName`, `roleName`, `acceptUrl`, `expiryDays` |

**Notes**: Invitee may not exist in DB yet. `acceptUrl` includes a signed invitation token. `expiryDays` indicates how long the invitation remains valid.

#### 8. `password-reset`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | BetterAuth `send-reset-password-email` hook |
| **Source worker** | auth |
| **Source handler** | `auth-config.ts` -- BetterAuth config |
| **Recipient** | User requesting reset |
| **Template tokens** | `userName`, `resetUrl`, `expiryHours` |

**Notes**: BetterAuth does not currently have a custom `sendResetPassword` hook configured. This needs to be added alongside the email verification hook pattern. Token expiry is typically 1 hour.

#### 9. `password-changed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | After successful password reset |
| **Source worker** | auth |
| **Source handler** | `auth-config.ts` -- BetterAuth `afterPasswordReset` hook or similar |
| **Recipient** | User who changed password |
| **Template tokens** | `userName`, `supportUrl` |

**Notes**: Security notification -- confirms to the user their password was changed. If they did not initiate it, `supportUrl` directs them to contact support. This is a post-action confirmation, not a pre-action approval.

#### 10. `welcome`

| Field | Value |
|---|---|
| **Category** | marketing |
| **Trigger** | After email verification completes |
| **Source worker** | auth |
| **Source handler** | `auth-config.ts` -- BetterAuth `afterVerification` hook or email verification success path |
| **Recipient** | Newly verified user |
| **Template tokens** | `userName`, `loginUrl`, `exploreUrl` |

**Notes**: This is the first non-transactional email a user receives. Respects marketing opt-out. `exploreUrl` links to the platform's discovery page.

---

### P2 -- Creator Experience

#### 11. `transcoding-complete`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | RunPod webhook callback with `status=ready` |
| **Source worker** | media-api |
| **Source handler** | `routes/webhook.ts` -- RunPod webhook handler |
| **Recipient** | Creator (content owner) |
| **Template tokens** | `userName`, `contentTitle`, `contentUrl`, `duration` |

**Notes**: Requires DB lookup to resolve creator email from media item. `duration` is the transcoded video duration in human-readable format (e.g., "12:34").

#### 12. `transcoding-failed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | RunPod webhook callback with `status=failed` |
| **Source worker** | media-api |
| **Source handler** | `routes/webhook.ts` -- RunPod webhook handler |
| **Recipient** | Creator (content owner) |
| **Template tokens** | `userName`, `contentTitle`, `errorSummary`, `retryUrl` |

**Notes**: `errorSummary` is a user-friendly error message (never raw stack traces). `retryUrl` links to the studio media management page where the creator can retry.

#### 13. `new-sale`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | Purchase completed (after `completePurchase()`) |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/checkout.ts` -- `handleCheckoutCompleted()` |
| **Recipient** | Creator (content owner) |
| **Template tokens** | `creatorName`, `contentTitle`, `saleAmount`, `buyerName`, `dashboardUrl` |

**Notes**: `buyerName` is first name only (privacy). `saleAmount` is the creator's share after platform fee (90% of sale price). `dashboardUrl` links to the studio revenue dashboard.

#### 14. `connect-account-status`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `account.updated` Stripe Connect event |
| **Source worker** | ecom-api |
| **Source handler** | `handlers/connect-webhook.ts` -- `handleConnectWebhook()` |
| **Recipient** | Creator (Connect account owner) |
| **Template tokens** | `creatorName`, `accountStatus`, `actionRequired`, `dashboardUrl` |

**Notes**: `accountStatus` is human-readable ("Active", "Action Required", "Restricted"). `actionRequired` is a brief description of what the creator needs to do (e.g., "Verify your identity") or empty if no action needed.

---

### P3 -- Engagement

#### 15. `new-content-published`

| Field | Value |
|---|---|
| **Category** | marketing |
| **Trigger** | `ContentService.publish()` |
| **Source worker** | content-api |
| **Source handler** | Content publish route |
| **Recipient** | Subscribers (users who have accessed content from this creator/org) |
| **Template tokens** | `userName`, `contentTitle`, `creatorName`, `contentUrl`, `contentDescription` |

**Notes**: Requires a subscriber list query -- users with content access records in the same organization. Must batch sends to avoid overwhelming the notifications-api. Respects marketing opt-out.

#### 16. `weekly-digest`

| Field | Value |
|---|---|
| **Category** | digest |
| **Trigger** | Cloudflare Cron Trigger (weekly, e.g., Monday 9:00 UTC) |
| **Source worker** | notifications-api (self-triggered) |
| **Recipient** | All users who have not opted out of digest emails |
| **Template tokens** | `userName`, `newContentCount`, `topContent` (array), `platformUrl` |

**Notes**: `topContent` is a JSON-serialized array of `{ title, creatorName, url }` objects (max 5 items). The template iterates over them. Respects digest opt-out. No-ops if no new content since last digest.

#### 17. `member-role-changed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `OrganizationService.updateMemberRole()` |
| **Source worker** | organization-api |
| **Source handler** | `routes/members.ts` |
| **Recipient** | Member whose role changed |
| **Template tokens** | `userName`, `orgName`, `oldRole`, `newRole` |

#### 18. `member-removed`

| Field | Value |
|---|---|
| **Category** | transactional |
| **Trigger** | `OrganizationService.removeMember()` |
| **Source worker** | organization-api |
| **Source handler** | `routes/members.ts` |
| **Recipient** | Removed member |
| **Template tokens** | `userName`, `orgName` |

---

### Summary Table

| # | Template Name | Category | Source Worker | Recipient | Priority |
|---|---|---|---|---|---|
| 1 | `purchase-receipt` | transactional | ecom-api | customer | P0 |
| 2 | `subscription-created` | transactional | ecom-api | customer | P0 |
| 3 | `subscription-renewed` | transactional | ecom-api | customer | P0 |
| 4 | `payment-failed` | transactional | ecom-api | customer | P0 |
| 5 | `subscription-cancelled` | transactional | ecom-api | customer | P0 |
| 6 | `refund-processed` | transactional | ecom-api | customer | P0 |
| 7 | `org-member-invitation` | transactional | organization-api | invitee | P1 |
| 8 | `password-reset` | transactional | auth | user | P1 |
| 9 | `password-changed` | transactional | auth | user | P1 |
| 10 | `welcome` | marketing | auth | user | P1 |
| 11 | `transcoding-complete` | transactional | media-api | creator | P2 |
| 12 | `transcoding-failed` | transactional | media-api | creator | P2 |
| 13 | `new-sale` | transactional | ecom-api | creator | P2 |
| 14 | `connect-account-status` | transactional | ecom-api | creator | P2 |
| 15 | `new-content-published` | marketing | content-api | subscribers | P3 |
| 16 | `weekly-digest` | digest | notifications-api | opted-in users | P3 |
| 17 | `member-role-changed` | transactional | organization-api | member | P3 |
| 18 | `member-removed` | transactional | organization-api | member | P3 |

---

## 3. Work Packets

### WP1: Internal Send Endpoint and Preference Checking

**Goal**: Create the central email sending endpoint that all workers call, with preference enforcement.

#### Changes

**`workers/notifications-api/src/routes/internal.ts`** (new file)
- Add `POST /internal/send` route using `procedure({ policy: { auth: 'worker' } })`
- Input schema: `internalSendEmailSchema` (see below)
- Handler calls `NotificationsService.sendEmail()` after preference check
- Returns `{ data: { success, messageId } }`

**`packages/validation/src/schemas/notifications.ts`**
- Add `internalSendEmailSchema`:
  ```typescript
  export const internalSendEmailSchema = z.object({
    to: z.string().email(),
    toName: z.string().optional(),
    templateName: templateNameSchema,
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    organizationId: uuidSchema.optional().nullable(),
    creatorId: z.string().optional().nullable(),
    category: z.enum(['transactional', 'marketing', 'digest']),
    userId: z.string().optional(), // For preference lookup (null = skip preference check)
  });
  ```

**`packages/notifications/src/services/notifications-service.ts`**
- Add `category` field to `SendEmailParams`
- Before sending, check `NotificationPreferencesService.hasOptedOut(userId, category)`
- Skip preference check when `category === 'transactional'` (always send)
- Skip preference check when `userId` is undefined (e.g., invitation to non-existent user)
- Return early with `{ success: false, skipped: 'opted_out' }` if opted out
- Still write audit log entry with status `skipped` for opted-out emails

**`packages/notifications/src/types.ts`**
- Add `'skipped'` to email send status if not already present
- Add `EmailCategory = 'transactional' | 'marketing' | 'digest'` type

**`workers/notifications-api/src/index.ts`**
- Mount internal routes: `app.route('/internal', internalRoutes)`

**Shared helper** -- `packages/worker-utils/src/email/send-email.ts` (new file)
- Export `sendEmailToWorker(env, executionCtx, params)`:
  ```typescript
  export async function sendEmailToWorker(
    env: Bindings,
    executionCtx: ExecutionContext,
    params: InternalSendEmailParams
  ): Promise<void> {
    const url = getServiceUrl('NOTIFICATIONS', env);
    executionCtx.waitUntil(
      fetch(`${url}/internal/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createWorkerAuthHeaders(env.WORKER_SHARED_SECRET),
        },
        body: JSON.stringify(params),
      }).catch((err) => {
        // Fire-and-forget -- log error but don't throw
        console.error('Failed to send email via notifications-api:', err);
      })
    );
  }
  ```
- This wraps `waitUntil()`, HMAC header generation, and error suppression
- Workers import this single function instead of each building the fetch call

**`packages/worker-utils/src/index.ts`**
- Re-export `sendEmailToWorker` from the new email module

#### Verification

**Unit tests** (`packages/notifications/src/services/__tests__/notifications-service.test.ts`):
- Test: transactional email sends regardless of `emailTransactional: false` preference
- Test: marketing email skipped when `emailMarketing: false`
- Test: digest email skipped when `emailDigest: false`
- Test: email sends when no preference record exists (defaults = opted in)
- Test: audit log written with `skipped` status when preference blocks send

**Integration tests** (`workers/notifications-api/src/__tests__/internal-send.test.ts`):
- Test: `POST /internal/send` with valid HMAC returns 200
- Test: `POST /internal/send` without HMAC returns 401
- Test: `POST /internal/send` with invalid body returns 400
- Test: `POST /internal/send` with unknown template name returns 404

---

### WP2: Template Token Registry and Global Seed

**Goal**: Define token schemas for all 18 templates, create responsive default HTML/text templates, and seed them in the database.

#### Changes

**`packages/notifications/src/templates/renderer.ts`**
- Expand `TEMPLATE_TOKENS` registry to include all 18 templates:
  ```typescript
  export const TEMPLATE_TOKENS: Record<string, string[]> = {
    _brand: ['platformName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'contactUrl'],
    _unsubscribe: ['unsubscribeUrl'],

    // P0 -- Revenue
    'purchase-receipt': ['userName', 'contentTitle', 'priceFormatted', 'purchaseDate', 'contentUrl', 'orgName'],
    'subscription-created': ['userName', 'planName', 'priceFormatted', 'billingInterval', 'nextBillingDate', 'manageUrl'],
    'subscription-renewed': ['userName', 'planName', 'priceFormatted', 'billingDate', 'nextBillingDate', 'manageUrl'],
    'payment-failed': ['userName', 'planName', 'priceFormatted', 'retryDate', 'updatePaymentUrl'],
    'subscription-cancelled': ['userName', 'planName', 'accessEndDate', 'resubscribeUrl'],
    'refund-processed': ['userName', 'contentTitle', 'refundAmount', 'originalAmount', 'refundDate'],

    // P1 -- Core
    'email-verification': ['userName', 'verificationUrl', 'expiryHours'],
    'org-member-invitation': ['inviterName', 'orgName', 'roleName', 'acceptUrl', 'expiryDays'],
    'password-reset': ['userName', 'resetUrl', 'expiryHours'],
    'password-changed': ['userName', 'supportUrl'],
    'welcome': ['userName', 'loginUrl', 'exploreUrl'],

    // P2 -- Creator
    'transcoding-complete': ['userName', 'contentTitle', 'contentUrl', 'duration'],
    'transcoding-failed': ['userName', 'contentTitle', 'errorSummary', 'retryUrl'],
    'new-sale': ['creatorName', 'contentTitle', 'saleAmount', 'buyerName', 'dashboardUrl'],
    'connect-account-status': ['creatorName', 'accountStatus', 'actionRequired', 'dashboardUrl'],

    // P3 -- Engagement
    'new-content-published': ['userName', 'contentTitle', 'creatorName', 'contentUrl', 'contentDescription'],
    'weekly-digest': ['userName', 'newContentCount', 'topContent', 'platformUrl'],
    'member-role-changed': ['userName', 'orgName', 'oldRole', 'newRole'],
    'member-removed': ['userName', 'orgName'],
  };
  ```

**`packages/validation/src/schemas/notifications.ts`**
- Add Zod data schemas for all 18 templates (extending existing 4):
  ```typescript
  export const templateDataSchemas = {
    'email-verification': emailVerificationDataSchema,
    'password-reset': passwordResetDataSchema,
    'password-changed': passwordChangedDataSchema,
    'purchase-receipt': purchaseReceiptDataSchema,
    'subscription-created': subscriptionCreatedDataSchema,
    'subscription-renewed': subscriptionRenewedDataSchema,
    'payment-failed': paymentFailedDataSchema,
    'subscription-cancelled': subscriptionCancelledDataSchema,
    'refund-processed': refundProcessedDataSchema,
    'org-member-invitation': orgMemberInvitationDataSchema,
    'welcome': welcomeDataSchema,
    'transcoding-complete': transcodingCompleteDataSchema,
    'transcoding-failed': transcodingFailedDataSchema,
    'new-sale': newSaleDataSchema,
    'connect-account-status': connectAccountStatusDataSchema,
    'new-content-published': newContentPublishedDataSchema,
    'weekly-digest': weeklyDigestDataSchema,
    'member-role-changed': memberRoleChangedDataSchema,
    'member-removed': memberRemovedDataSchema,
  } as const;
  ```

**`packages/database/scripts/seed/templates.ts`** (new file)
- Seed function that inserts all 18 global templates with `scope: 'global'`, `status: 'active'`
- Each template has: `name`, `subject`, `htmlBody`, `textBody`, `description`
- HTML templates use responsive email design (600px max-width table layout)
- Templates include `{{primaryColor}}`, `{{logoUrl}}`, `{{platformName}}` brand tokens
- Non-transactional templates include `{{unsubscribeUrl}}` in footer
- Use upsert pattern (ON CONFLICT DO NOTHING) so re-seeding is safe

**Template HTML design principles:**
- Single-column table layout, 600px max-width (Gmail/Outlook safe)
- System font stack (no web fonts -- email client support is poor)
- Inline styles only (email clients strip `<style>` blocks)
- Brand tokens: `{{primaryColor}}` for CTA buttons, `{{logoUrl}}` for header logo
- Footer: `{{platformName}}`, `{{supportEmail}}`, unsubscribe link (non-transactional)
- Dark mode support via `@media (prefers-color-scheme: dark)` in `<style>` (progressive enhancement)

**`packages/database/scripts/seed/index.ts`** (or equivalent entry point)
- Import and call the new template seed function

#### Verification

**Unit tests** (`packages/validation/src/__tests__/notifications.test.ts`):
- Test: each of the 18 data schemas validates correctly with valid data
- Test: each schema rejects invalid data (missing required fields, wrong types)

**Unit tests** (`packages/notifications/src/templates/__tests__/renderer.test.ts`):
- Test: `getAllowedTokens()` returns correct tokens for each of the 18 templates
- Test: `_unsubscribe` tokens merge with template-specific tokens

**Seed verification**:
- Run `pnpm db:seed` -- verify all 18 templates exist in `email_templates` table
- Run `pnpm db:seed` again -- verify no duplicates (upsert idempotency)
- Query: `SELECT name, scope, status FROM email_templates WHERE scope = 'global' ORDER BY name`

---

### WP3: Auth Email Migration

**Goal**: Migrate the auth worker from hardcoded HTML to the template system via notifications-api.

#### Changes

**`workers/auth/src/email.ts`**
- Replace `sendVerificationEmail()` to call `sendEmailToWorker()`:
  ```typescript
  export async function sendVerificationEmail(
    env: AuthBindings,
    executionCtx: ExecutionContext,
    user: { name?: string | null; email: string },
    token: string
  ): Promise<void> {
    const verificationUrl = `${env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

    await sendEmailToWorker(env, executionCtx, {
      to: user.email,
      toName: user.name ?? undefined,
      templateName: 'email-verification',
      category: 'transactional',
      data: {
        userName: user.name || 'there',
        verificationUrl,
        expiryHours: '24',
      },
    });
  }
  ```
- Remove `buildVerificationHtml()` and `buildVerificationText()` functions
- Remove local `escapeHtml()` function (template renderer handles XSS)
- Remove `getEmailProvider()` and provider caching (notifications-api owns providers)
- Add `sendPasswordResetEmail()` function calling `password-reset` template
- Add `sendPasswordChangedEmail()` function calling `password-changed` template
- Add `sendWelcomeEmail()` function calling `welcome` template

**`workers/auth/src/auth-config.ts`**
- Update `emailVerification.sendVerificationEmail` hook to pass `executionCtx`
- Add `emailAndPassword.sendResetPasswordEmail` hook (BetterAuth config):
  ```typescript
  sendResetPasswordEmail: async ({ user, url }, request) => {
    await sendPasswordResetEmail(env, executionCtx, user, url);
  },
  ```
- Add hook for post-password-change notification (if BetterAuth supports it; otherwise, add a post-reset success callback)
- Add hook for post-verification welcome email

**`workers/auth/src/types.ts`**
- Add `WORKER_SHARED_SECRET` to `AuthBindings` (needed for HMAC calls to notifications-api)

**`workers/auth/wrangler.toml`** (or `.dev.vars`)
- Ensure `WORKER_SHARED_SECRET` is available in auth worker environment

#### Important Consideration

BetterAuth's `sendVerificationEmail` and `sendResetPasswordEmail` hooks run synchronously within the request lifecycle. The `sendEmailToWorker` helper wraps the fetch in `waitUntil()`, but we need access to `executionCtx` in the BetterAuth config. The auth worker already passes env via closure; `executionCtx` needs the same treatment. Review how `createAuthConfig()` receives execution context.

#### Verification

**Manual verification checklist:**

1. **Registration flow**:
   - `POST /api/auth/email/register` with new email
   - Verify verification email arrives via template system (check console in dev mode)
   - Verify `emailAuditLogs` entry: `template_name = 'email-verification'`, `status = 'success'`

2. **Password reset flow**:
   - `POST /api/auth/email/send-reset-password-email` with existing email
   - Verify reset email arrives with correct `resetUrl`
   - Verify audit log entry

3. **Password changed confirmation**:
   - Complete password reset flow
   - Verify confirmation email arrives
   - Verify audit log entry

4. **Welcome email**:
   - Complete email verification for new user
   - Verify welcome email arrives
   - Verify audit log entry

5. **No hardcoded HTML**:
   - Verify `workers/auth/src/email.ts` contains no `<html>`, `<body>`, or `<table>` tags
   - Verify auth worker no longer imports `createEmailProvider`

---

### WP4: Ecom Revenue Emails (P0)

**Goal**: Wire all 6 P0 revenue emails to their Stripe webhook triggers.

#### Changes

**`workers/ecom-api/src/handlers/checkout.ts`**
- After `purchaseService.completePurchase()` succeeds, call:
  ```typescript
  // Send purchase receipt to customer
  c.executionCtx.waitUntil(
    sendEmailToWorker(c.env, c.executionCtx, {
      to: customerEmail,
      toName: customerName,
      templateName: 'purchase-receipt',
      category: 'transactional',
      userId: validatedMetadata.customerId,
      organizationId: validatedMetadata.organizationId,
      data: {
        userName: customerName,
        contentTitle: contentTitle,
        priceFormatted: formatGBP(amountTotal),
        purchaseDate: new Date().toLocaleDateString('en-GB'),
        contentUrl: `${c.env.WEB_APP_URL}/content/${validatedMetadata.contentId}`,
        orgName: orgName,
      },
    })
  );
  ```
- Also send `new-sale` to creator (P2, but fires from same handler):
  ```typescript
  c.executionCtx.waitUntil(
    sendEmailToWorker(c.env, c.executionCtx, {
      to: creatorEmail,
      templateName: 'new-sale',
      category: 'transactional',
      data: {
        creatorName: creatorName,
        contentTitle: contentTitle,
        saleAmount: formatGBP(creatorShareCents),
        buyerName: customerFirstName,
        dashboardUrl: `${c.env.WEB_APP_URL}/studio/revenue`,
      },
    })
  );
  ```

**Data resolution challenge**: The webhook handlers currently have minimal context. They need to resolve:
- Customer email and name (from Stripe session `customer_details` or DB `users` table)
- Content title (from DB `content` table via `contentId` metadata)
- Creator email and name (from DB `users` table via content's `creatorId`)
- Organization name (from DB `organizations` table via `organizationId` metadata)

**Approach**: Add a lightweight data resolution step in each handler that fetches required email context from the DB. This is a single query joining `users`, `content`, and `organizations`. The DB client already exists in the handler scope.

**`workers/ecom-api/src/handlers/subscription-webhook.ts`**
- In `CHECKOUT_COMPLETED` (subscription mode): send `subscription-created`
- In `INVOICE_PAYMENT_SUCCEEDED`: check `invoice.billing_reason === 'subscription_cycle'` then send `subscription-renewed`
- In `INVOICE_PAYMENT_FAILED`: send `payment-failed`
- In `SUBSCRIPTION_DELETED`: send `subscription-cancelled`

**`workers/ecom-api/src/handlers/payment-webhook.ts`**
- In `CHARGE_REFUNDED`: send `refund-processed`

**`workers/ecom-api/src/handlers/connect-webhook.ts`**
- In `ACCOUNT_UPDATED`: send `connect-account-status` (P2, included here since the handler already exists)

**Currency formatting utility** -- `packages/constants/src/format.ts` (new):
- `formatGBP(cents: number): string` -- converts pence to formatted string (e.g., 999 -> "9.99")
- Prefix with currency symbol from `CURRENCY` constant

**`workers/ecom-api/src/types.ts`**
- Ensure `WORKER_SHARED_SECRET` is available in `StripeWebhookEnv`

#### Verification

**Stripe CLI triggers** (run from monorepo root):
```bash
# Test purchase receipt
stripe trigger checkout.session.completed

# Test subscription created
stripe trigger customer.subscription.created

# Test subscription renewed (recurring invoice)
stripe trigger invoice.payment_succeeded

# Test payment failed
stripe trigger invoice.payment_failed

# Test subscription cancelled
stripe trigger customer.subscription.deleted

# Test refund
stripe trigger charge.refunded
```

After each trigger:
1. Check console output for email send (dev mode)
2. Query `email_audit_logs` for matching `template_name` and `status = 'success'`
3. Verify template tokens in audit log `metadata` column are populated

**Unit tests** (`workers/ecom-api/src/handlers/__tests__/`):
- Test: `handleCheckoutCompleted` calls `sendEmailToWorker` with correct template and tokens
- Test: `handleSubscriptionWebhook` sends correct template for each event type
- Test: Webhook handler still returns 200 even if email send fails (fire-and-forget)

---

### WP5: Organization and Creator Emails (P1-P2)

**Goal**: Wire organization membership and media transcoding emails.

#### Changes

**Organization emails (organization-api)**

**`packages/organization/src/services/organization-service.ts`**
- `inviteMember()`: Return invitation details (invitee email, org name, inviter name, role, accept URL) so the route handler can fire the email
- `updateMemberRole()`: Return old and new role so the route handler can fire the email
- `removeMember()`: Return removed member details so the route handler can fire the email

**`workers/organization-api/src/routes/members.ts`**
- After `inviteMember()`: call `sendEmailToWorker()` with `org-member-invitation` template
- After `updateMemberRole()`: call `sendEmailToWorker()` with `member-role-changed` template (P3, but wired here since handler exists)
- After `removeMember()`: call `sendEmailToWorker()` with `member-removed` template (P3, but wired here)

**Media transcoding emails (media-api)**

**`workers/media-api/src/routes/webhook.ts`**
- After `service.handleWebhook(result.data)` completes successfully:
  - If status is `ready`: resolve creator email from media item, send `transcoding-complete`
  - If status is `failed`: resolve creator email from media item, send `transcoding-failed`
- Data resolution: query `media_items` -> `content` -> `users` to get creator email and content title
- Email send is wrapped in `waitUntil()` and must not affect the 200 response to RunPod

**`workers/media-api/wrangler.toml`** (or `.dev.vars`)
- Ensure `WORKER_SHARED_SECRET` is available for HMAC calls to notifications-api

#### Verification

**Organization email verification:**
1. As org admin, invite a member via API: `POST /api/organizations/:id/members` with `{ email, role }`
2. Verify invitation email in console output with correct `acceptUrl`, `orgName`, `roleName`
3. Query `email_audit_logs` for `template_name = 'org-member-invitation'`

**Transcoding email verification:**
1. Upload media via content-api (triggers transcode via media-api)
2. Wait for RunPod webhook callback (or simulate with `curl`)
3. Verify `transcoding-complete` or `transcoding-failed` email in console
4. Query `email_audit_logs` for matching template name

**Unit tests:**
- `packages/organization/src/services/__tests__/`: verify `inviteMember()` returns invitation details
- `workers/media-api/src/routes/__tests__/`: verify webhook handler sends email after successful transcode

---

### WP6: Unsubscribe System

**Goal**: HMAC-signed unsubscribe links, one-click unsubscribe endpoint, and SvelteKit confirmation page.

#### Changes

**Unsubscribe token utility** -- `packages/notifications/src/unsubscribe.ts` (new)
```typescript
export interface UnsubscribePayload {
  userId: string;
  category: 'marketing' | 'digest';
  expiresAt: number; // Unix timestamp
}

/**
 * Generate HMAC-signed unsubscribe token
 * Encodes userId + category + expiry, signed with HMAC-SHA256
 */
export function generateUnsubscribeToken(
  payload: UnsubscribePayload,
  secret: string
): string { ... }

/**
 * Verify and decode unsubscribe token
 * Returns null if invalid, expired, or tampered
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string
): UnsubscribePayload | null { ... }
```

- Token format: `base64url(JSON(payload)).base64url(HMAC-SHA256(payload, secret))`
- 30-day expiry from generation time
- Only encodes `marketing` and `digest` categories -- `transactional` cannot be unsubscribed

**`workers/notifications-api/src/routes/unsubscribe.ts`** (new)
- `GET /unsubscribe/:token` -- public, no auth required
  - Verifies token signature and expiry
  - Returns JSON with `{ userId, category, valid: true }` or `{ valid: false, reason }` on GET (used by SvelteKit page to display confirmation)
- `POST /unsubscribe/:token` -- public, no auth required
  - Verifies token, updates `notificationPreferences` table
  - Returns `{ success: true, category }` or error
  - Idempotent (re-unsubscribing same category is a no-op)

**`workers/notifications-api/src/index.ts`**
- Mount: `app.route('/unsubscribe', unsubscribeRoutes)`

**`packages/notifications/src/services/notifications-service.ts`**
- In `sendEmail()`, after rendering template, inject `{{unsubscribeUrl}}` for non-transactional emails
- Generate unsubscribe token using the shared secret
- Build URL: `${env.WEB_APP_URL}/unsubscribe/${token}`
- Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers to email (RFC 8058)

**`apps/web/src/routes/(public)/unsubscribe/[token]/+page.server.ts`** (new)
- Server load: call `GET /unsubscribe/:token` to validate token
- Return token validity and category to page

**`apps/web/src/routes/(public)/unsubscribe/[token]/+page.svelte`** (new)
- If token valid: show confirmation message with category name and "Unsubscribe" button
- If token invalid/expired: show "This link has expired or is invalid" message
- On button click: `POST /unsubscribe/:token`, show success state
- Minimal page -- no auth required, no org branding, platform branding only

**Email provider changes** -- `packages/notifications/src/providers/resend-provider.ts`
- Add `List-Unsubscribe` header to Resend `send()` call:
  ```typescript
  headers: {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  ```

#### Verification

**Manual verification:**
1. Send a marketing email (e.g., `welcome` template)
2. Verify email footer contains unsubscribe link
3. Open unsubscribe link in browser -- verify confirmation page loads
4. Click "Unsubscribe" button -- verify success message
5. Query `notification_preferences` -- verify `email_marketing = false` for that user
6. Send another marketing email to same user -- verify it is skipped (audit log `status = 'skipped'`)
7. Send a transactional email to same user -- verify it still sends

**Edge cases:**
- Expired token (30+ days old) -- verify "expired" message
- Tampered token -- verify "invalid" message
- Re-unsubscribe -- verify idempotent (no error)

**Unit tests** (`packages/notifications/src/__tests__/unsubscribe.test.ts`):
- Test: `generateUnsubscribeToken()` produces valid token
- Test: `verifyUnsubscribeToken()` accepts valid token
- Test: `verifyUnsubscribeToken()` rejects expired token
- Test: `verifyUnsubscribeToken()` rejects tampered token
- Test: `verifyUnsubscribeToken()` rejects token with `transactional` category

---

### WP7: Frontend -- Studio Template Management

**Goal**: Studio UI for managing email templates (list, edit, preview, test send).

#### Changes

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/+page.server.ts`** (new)
- Server load: fetch templates for current org via `GET /api/templates/organizations/:orgId`
- Return paginated template list

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/+page.svelte`** (new)
- Template list view with columns: Name, Status (draft/active/archived), Last Updated
- "Create Template" button (links to editor)
- Status filter tabs
- Each row links to editor page

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/[id]/+page.server.ts`** (new)
- Server load: fetch template by ID

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/[id]/+page.svelte`** (new)
- Split pane: editor (left) + live preview (right)
- Editor fields: subject, HTML body, text body, description, status
- Preview pane: rendered HTML via `POST /api/templates/:id/preview`
- "Test Send" button: opens modal for recipient email, calls `POST /api/templates/:id/test-send`
- "Save" button: calls `PATCH /api/templates/organizations/:orgId/:id`
- Token reference panel: shows allowed tokens for the template name

**Navigation integration:**
- Add "Email Templates" item to studio settings sidebar navigation

#### Verification

**Playwright tests** (`apps/web/e2e/studio-email-templates.spec.ts`):
1. Navigate to studio settings > email templates
2. Verify template list loads with global templates visible
3. Create a new org-scoped template: fill form, save, verify appears in list
4. Edit template: change subject, save, verify update persists
5. Preview template: click preview, verify rendered HTML appears in preview pane
6. Test send: enter test email, click send, verify success toast
7. Delete template: click delete, confirm, verify removed from list

---

### WP8: Frontend -- Enhanced Preferences and Audit

**Goal**: Expand notification preferences UI and add email audit log viewer for studio.

#### Changes

**`apps/web/src/routes/(platform)/_org/[slug]/account/notifications/+page.svelte`** (update existing or new)
- Three toggle sections:
  - **Marketing emails**: "Receive promotional content, new release announcements, and platform updates"
  - **Transactional emails**: Always on, toggle disabled, tooltip: "Receipts, security notices, and account alerts cannot be disabled"
  - **Weekly digest**: "Receive a weekly summary of new content and activity"
- Each toggle calls `PUT /api/preferences` on change
- Show confirmation toast on save

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-audit/+page.server.ts`** (new)
- Server load: fetch audit logs for current org
- Requires new endpoint on notifications-api: `GET /internal/audit-logs?organizationId=:id` (worker auth)

**`apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-audit/+page.svelte`** (new)
- Paginated table: Date, Recipient (masked: j***@example.com), Template Name, Status (success/failed/skipped)
- Filter by status
- Filter by date range
- Click row to see details (template data, error message if failed)

**`workers/notifications-api/src/routes/internal.ts`** (extend)
- Add `GET /internal/audit-logs` endpoint with `policy: { auth: 'worker' }`:
  - Query params: `organizationId`, `page`, `limit`, `status`, `dateFrom`, `dateTo`
  - Returns paginated audit log entries

**`packages/validation/src/schemas/notifications.ts`** (extend)
- Add `auditLogQuerySchema` with pagination, status filter, date range

**i18n** (`apps/web/src/paraglide/messages/en.js`):
- Add keys for all notification preference labels, descriptions, and audit log UI

#### Verification

**Playwright tests:**
1. Navigate to account > notifications
2. Verify all three toggles render with correct initial state
3. Toggle marketing off -- verify API call and toast
4. Toggle marketing on -- verify API call and toast
5. Verify transactional toggle is disabled
6. Navigate to studio > email audit
7. Verify audit log table loads with entries (requires emails to have been sent)
8. Filter by status -- verify table updates
9. Click row -- verify details panel shows template data

---

### WP9: Engagement Emails (P3)

**Goal**: Content publish notifications, weekly digest, and remaining org lifecycle emails.

#### Changes

**Content publish notification (content-api)**

**`workers/content-api/src/routes/content.ts`** (or wherever publish is handled)
- After `ContentService.publish()` succeeds:
  - Query subscribers: users with `contentAccess` records for content in the same organization
  - For each subscriber (batched), send `new-content-published` via `sendEmailToWorker()`
  - Use `category: 'marketing'` (respects opt-out)
  - Batch limit: max 50 emails per `waitUntil()` call to avoid overwhelming notifications-api
  - For large subscriber lists, consider a dedicated endpoint on notifications-api that accepts a batch

**Weekly digest (notifications-api)**

**`workers/notifications-api/src/index.ts`**
- Add Cloudflare Cron Trigger handler:
  ```typescript
  export default {
    fetch: app.fetch,
    scheduled: async (event, env, ctx) => {
      ctx.waitUntil(handleWeeklyDigest(env));
    },
  };
  ```

**`workers/notifications-api/src/handlers/weekly-digest.ts`** (new)
- Query all users with `emailDigest: true` preference (or no preference record = defaults on)
- Query new content published in the last 7 days
- If no new content, skip entirely
- For each user, render `weekly-digest` template with top 5 new content items
- Send in batches to respect rate limits
- Log digest run to audit log

**`workers/notifications-api/wrangler.toml`**
- Add cron trigger: `crons = ["0 9 * * 1"]` (every Monday at 09:00 UTC)

**Remaining org emails** (already wired in WP5 handlers):
- `member-role-changed` and `member-removed` are wired in WP5 since the handler modifications happen there. WP9 only adds the templates to the seed (already done in WP2).

#### Verification

**Content publish notification:**
1. As creator, publish content via API
2. Verify subscriber notification emails in console
3. Verify marketing opt-out users do NOT receive email
4. Verify audit log entries

**Weekly digest:**
1. Manually trigger cron: `curl -X POST http://localhost:42075/internal/trigger-digest` (add dev-only endpoint)
2. Verify digest emails sent to opted-in users
3. Verify digest emails NOT sent to opted-out users
4. Verify digest skips if no new content

---

## 4. Verification Protocol

### Per-Work-Packet Verification

Every work packet follows this verification sequence before merge:

#### Backend Work Packets (WP1, WP2, WP4, WP5, WP6-backend, WP9)

1. **Unit tests pass**: `pnpm test -- --filter=@codex/notifications --filter=@codex/validation`
2. **Type check passes**: `pnpm typecheck`
3. **Integration test**: Start all services (`pnpm dev`), run the specific flow end-to-end
4. **Audit log verification**: After every email send, query:
   ```sql
   SELECT template_name, recipient_email, status, created_at
   FROM email_audit_logs
   ORDER BY created_at DESC
   LIMIT 10;
   ```
5. **Preference enforcement**: Send email to user who has opted out, verify `status = 'skipped'` in audit log
6. **Error resilience**: Kill notifications-api while sending, verify calling worker still returns 200 (fire-and-forget)

#### Frontend Work Packets (WP7, WP8)

1. **Type check passes**: `pnpm typecheck`
2. **Visual inspection**: Navigate to each new page in the browser, verify layout matches design
3. **Playwright tests**: Run the specific test file
4. **Accessibility**: Tab through all interactive elements, verify focus management
5. **SSR disabled**: Verify studio pages still work (studio uses `ssr = false`)

#### Cross-Cutting Verification

After all WPs are merged:

1. **Full registration-to-purchase flow**:
   - Register -> verify email -> welcome email -> purchase content -> receipt email -> refund -> refund email
   - Verify 4 emails sent with correct templates

2. **Subscription lifecycle**:
   - Subscribe -> subscription-created email -> renewal -> subscription-renewed email -> cancel -> subscription-cancelled email
   - Verify 3 emails sent

3. **Creator flow**:
   - Upload content -> transcode -> transcoding-complete email -> publish -> new-content-published to subscribers
   - Verify 2+ emails sent

4. **Preference enforcement**:
   - Opt out of marketing -> publish content -> verify NO email received
   - Opt out of digest -> trigger digest -> verify NO email received
   - Verify transactional emails still arrive regardless of preferences

5. **Template override**:
   - Create org-level `purchase-receipt` template with custom branding
   - Make a purchase -> verify receipt uses org template, not global
   - Delete org template -> verify falls back to global

---

## 5. Review Process

After each work packet, the following review checks are performed:

### 1. Code Review

- All changed files pass linting and formatting (`pnpm lint`, `pnpm format:check`)
- No `as any` type casts introduced
- No `console.log` -- use `ObservabilityClient` for all logging
- No hardcoded URLs or ports -- use `getServiceUrl()`
- No unscoped database queries -- verify `scopedNotDeleted()` or equivalent on all queries
- Fire-and-forget patterns use `waitUntil()` with `.catch()` -- no unhandled rejections

### 2. Silent Failure Analysis

- Every `sendEmailToWorker()` call is wrapped in `waitUntil()` with error suppression
- Webhook handlers still return 200/`{ received: true }` even if email send fails
- Unsubscribe endpoint returns clear error messages for expired/invalid tokens
- Template resolution gracefully falls back (Creator -> Org -> Global -> TemplateNotFoundError)

### 3. Type Design Review

- `InternalSendEmailParams` type matches the `internalSendEmailSchema` Zod schema
- `EmailCategory` type is used consistently across service layer and validation
- `UnsubscribePayload` type encodes only valid categories (`marketing` | `digest`)
- No orphaned types introduced

### 4. Test Coverage Analysis

- Every new public method on `NotificationsService` has unit test coverage
- Every new endpoint has integration test coverage
- Every webhook email integration has a test verifying the email is sent with correct data
- Preference checking has dedicated tests for each category

### 5. Documentation Review

- `TEMPLATE_TOKENS` registry matches the Zod data schemas (no mismatches)
- Template seed data matches the tokens declared in the registry
- CLAUDE.md files updated if new endpoints, services, or patterns are introduced
- Worker CLAUDE.md files list new endpoints in their endpoint tables

---

## 6. Dependencies

### Work Packet Dependency Graph

```
WP1 (Internal Send) ──┬──────────> WP3 (Auth Migration)
                       |
                       ├──────────> WP4 (Ecom Revenue Emails)
                       |
WP2 (Templates/Seed) ─┤            ├──> WP5 (Org/Creator Emails)
                       |            |
                       |            └──> WP9 (Engagement Emails)
                       |
                       └──────────> WP6 (Unsubscribe) ──> WP7 (Studio Templates)
                                                      |
                                                      └──> WP8 (Enhanced Prefs)
```

### Execution Order

| Phase | Work Packets | Parallelizable | Estimated Scope |
|---|---|---|---|
| **Phase 1** | WP1 + WP2 | Yes (independent) | Foundation: endpoint + templates |
| **Phase 2** | WP3 + WP6 | Yes (independent, both depend on Phase 1) | Auth migration + unsubscribe |
| **Phase 3** | WP4 + WP5 | Yes (independent, both depend on Phase 1) | Revenue + org/creator emails |
| **Phase 4** | WP7 + WP8 | Yes (independent, both depend on WP6) | Frontend |
| **Phase 5** | WP9 | Sequential (depends on WP4 + WP5) | Engagement + digest |

### Rationale

- **WP1 and WP2** have no dependencies on each other: WP1 creates the endpoint, WP2 creates the templates. Both must exist before any worker can send emails.
- **WP3** (auth migration) and **WP6** (unsubscribe) are independent of each other but both need WP1+WP2.
- **WP4** (ecom) and **WP5** (org/creator) are independent of each other but both need WP1+WP2.
- **WP7** (studio templates) and **WP8** (enhanced prefs) both need the unsubscribe system (WP6) because templates in the editor must include unsubscribe links, and the preferences UI needs to reflect the unsubscribe categories.
- **WP9** (engagement) depends on WP4+WP5 being stable because the content publish notification pattern is similar to the ecom email pattern, and the weekly digest queries content that should already have working notifications.

---

## 7. Non-Goals / Out of Scope

| Feature | Reason | When to revisit |
|---|---|---|
| Email open/click tracking | Requires tracking pixel infrastructure and privacy considerations (GDPR) | Post-launch analytics phase |
| Bulk/batch sending API | Single sends via `sendEmailToWorker()` are sufficient at current scale | When subscriber lists exceed 1000+ per org |
| SMS notifications | Email only for now; SMS requires additional provider (Twilio) and phone number collection | When mobile engagement metrics warrant it |
| Push notifications | Requires service worker registration and push subscription management | When PWA features are prioritized |
| Template A/B testing | Requires split testing infrastructure and statistical significance tracking | Post-launch growth phase |
| Scheduled/delayed sends | All sends are immediate via `waitUntil()`; delayed sends need a queue (Durable Objects or Queue) | When drip campaigns are needed |
| Email design builder (drag-and-drop) | Template editor is code-based (HTML + tokens); visual builder is a major UI effort | When non-technical creators need email customization |
| Internationalization of templates | Templates are English-only; i18n requires per-locale template variants | When platform launches in non-English markets |
| Bounce/complaint handling | Resend handles bounces internally; feedback loops need webhook integration | When deliverability issues arise at scale |

---

## Appendix A: Existing Infrastructure Reference

### Database Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `email_templates` | Template storage (3-tier scoping) | `name`, `scope`, `organizationId`, `creatorId`, `subject`, `htmlBody`, `textBody`, `status` |
| `email_audit_logs` | Send history and debugging | `templateName`, `recipientEmail`, `status`, `error`, `metadata` |
| `notification_preferences` | Per-user opt-in/out | `userId`, `emailMarketing`, `emailTransactional`, `emailDigest` |

### Template Resolution (Existing)

`TemplateRepository.findTemplate(name, orgId, creatorId)`:
1. Single SQL query fetches up to 3 candidates (Org, Creator, Global)
2. In-memory priority: Organization > Creator > Global
3. First match wins

### Provider Abstraction (Existing)

| Provider | Environment | Behavior |
|---|---|---|
| `ResendProvider` | Production | Real email via Resend API |
| `MailHogHttpProvider` | Development | Local SMTP testing (MailHog UI on port 8025) |
| `ConsoleProvider` | Development (fallback) | Logs email to worker console |
| `InMemoryEmailProvider` | Tests | Captures emails for assertion |

### Retry Logic (Existing)

`NotificationsService.sendWithRetry()`:
- Max 2 retries (3 total attempts)
- Exponential backoff: 1000ms, 2000ms
- Non-transient errors (ValidationError, TemplateNotFoundError) skip retry
- Audit log updated to `failed` on final failure

### Branding Injection (Existing)

`NotificationsService.resolveBrandTokens(organizationId)`:
- Resolves `primaryColor`, `logoUrl`, `supportEmail` from org settings
- 5-minute in-memory cache via `BrandingCache`
- Falls back to platform defaults if org settings unavailable

### Service Registry (Existing)

Services available via `ctx.services` in `procedure()` handlers:
- `ctx.services.notifications` -- `NotificationsService`
- `ctx.services.templates` -- `TemplateService`
- `ctx.services.preferences` -- `NotificationPreferencesService`

### Validation Schemas (Existing)

Templates with data schemas already defined in `packages/validation/src/schemas/notifications.ts`:
- `email-verification`
- `password-reset`
- `password-changed`
- `purchase-receipt`

The remaining 14 templates need schemas added (WP2).
