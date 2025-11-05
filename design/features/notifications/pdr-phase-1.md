# Notifications - Phase 1 PRD

## Core Architecture References

This feature builds on core platform patterns. For foundational architecture details, see:

- **[Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)** - Organization context for emails (if organization-specific notifications needed)

---

## Feature Summary

Email notification service with provider abstraction layer, enabling transactional emails (authentication, purchases, content access) without vendor lock-in. Phase 1 uses Resend but maintains flexibility to switch providers.

## Problem Statement

The platform needs to send transactional emails for critical user flows:

- **Authentication**: Email verification, password reset, account security alerts
- **E-Commerce**: Purchase receipts, payment confirmations
- **Content Access**: Content unlock notifications, access grants

Without a notification system:

- Users cannot verify email addresses (blocks password recovery)
- Users don't receive purchase confirmations (poor UX, support burden)
- Platform cannot send security alerts (password changes, suspicious activity)

**Critical Requirement**: Must use **abstraction layer** to avoid vendor lock-in. If Resend changes pricing or terms, we need easy migration to alternatives (SendGrid, Postmark, AWS SES, etc.).

## Goals / Success Criteria

### Primary Goals

1. **Email Abstraction** - All email sending goes through a unified interface
2. **Template Management** - Centralized email templates with data interpolation
3. **Reliable Delivery** - 99%+ delivery rate for transactional emails
4. **Easy Provider Swap** - Switch from Resend to another provider in < 1 hour
5. **Error Handling** - Graceful failures, retry logic, logging

### Success Metrics

-  100% of email calls use abstraction (zero direct Resend calls)
-  Email delivery rate > 99%
-  Email sent within 60 seconds of trigger event
-  Can switch providers by changing 1 config file + 1 adapter file
-  All email errors logged with context (template, recipient, error)
-  Unit tests pass with mocked email service

## Scope

### In Scope (Phase 1 MVP)

-  Email service abstraction layer (provider-agnostic interface)
-  Resend adapter (default provider)
-  Transactional email templates:
  - Email verification
  - Password reset
  - Password changed confirmation
  - Purchase receipt (placeholder for E-Commerce)
-  Template rendering (interpolate data into templates)
-  Error handling and logging
-  Basic retry logic (1 retry on failure)
-  Environment-based configuration (dev vs prod API keys)

### Explicitly Out of Scope (Future Phases)

- L In-app notifications (bell icon, notification center) - Phase 2
- L SMS notifications - Phase 3
- L Push notifications (web push, mobile) - Phase 3
- L Email preferences/unsubscribe (marketing emails) - Phase 2
- L Email analytics (open rate, click rate) - Phase 2
- L Batch email sending (newsletters, campaigns) - Phase 3
- L Advanced retry logic (exponential backoff) - Phase 2
- L Email queue (Cloudflare Queue / Worker) - Phase 2

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#7-notifications) document for details.

---

## User Stories & Use Cases

### US-NOTIF-001: Send Email Verification (Auth Integration)

**As a** system (triggered by Auth feature)
**I want to** send an email verification link
**So that** users can confirm their email address

**Flow:**

1. User registers on platform (see [Auth PRD - US-AUTH-001](../auth/pdr-phase-1.md))
2. Auth service calls notification service:
   ```typescript
   await notificationService.sendEmail({
     template: 'email-verification',
     recipient: user.email,
     data: {
       userName: user.name,
       verificationUrl: 'https://example.com/verify-email?token=...',
     },
   });
   ```
3. Notification service:
   - Loads 'email-verification' template
   - Interpolates data (userName, verificationUrl)
   - Calls Resend adapter to send email
4. Resend delivers email to user's inbox
5. User clicks link and verifies email

**Acceptance Criteria:**

- Email arrives within 60 seconds
- Email contains correct verification link
- Email is branded (platform name, logo)
- Email is mobile-responsive
- If email fails, error is logged with context
- Auth service receives success/error response

---

### US-NOTIF-002: Send Password Reset Email (Auth Integration)

**As a** system (triggered by Auth feature)
**I want to** send a password reset link
**So that** users can recover their accounts

**Flow:**

1. User requests password reset (see [Auth PRD - US-AUTH-003](../auth/pdr-phase-1.md))
2. Auth service calls notification service:
   ```typescript
   await notificationService.sendEmail({
     template: 'password-reset',
     recipient: user.email,
     data: {
       userName: user.name,
       resetUrl: 'https://example.com/reset-password?token=...',
     },
   });
   ```
3. Notification service sends email via Resend adapter
4. User receives email and clicks reset link

**Acceptance Criteria:**

- Email arrives within 60 seconds
- Email contains correct reset link
- Email includes security note ("If you didn't request this...")
- Link expires after 1 hour (handled by Auth, displayed in email)

---

### US-NOTIF-003: Provider Abstraction (Non-Functional Requirement)

**As a** developer
**I want** all email sending to use a unified interface
**So that** I can easily switch email providers without changing business logic

**Requirement:**

- **Bad** (direct Resend call):

  ```typescript
  // L Direct Resend call - vendor lock-in
  await resend.emails.send({
    from: 'noreply@example.com',
    to: user.email,
    subject: 'Verify your email',
    html: '<p>Click here...</p>',
  });
  ```

- **Good** (abstraction):
  ```typescript
  //  Abstraction - provider-agnostic
  await notificationService.sendEmail({
    template: 'email-verification',
    recipient: user.email,
    data: { userName: user.name, verificationUrl: '...' },
  });
  ```

**Acceptance Criteria:**

- Zero direct calls to Resend API in business logic (Auth, E-Commerce, etc.)
- All email sending goes through `notificationService.sendEmail()`
- Switching providers requires changing only:
  1. Adapter file (`adapters/resend.ts` � `adapters/sendgrid.ts`)
  2. Configuration (`RESEND_API_KEY` � `SENDGRID_API_KEY`)
- No changes to business logic (Auth, E-Commerce, etc.)

---

### US-NOTIF-004: Purchase Receipt Email (E-Commerce Integration)

**As a** system (triggered by E-Commerce feature)
**I want to** send purchase receipt emails
**So that** customers have proof of purchase

**Flow:**

1. User completes purchase (see [E-Commerce PRD](../e-commerce/pdr-phase-1.md))
2. E-Commerce service calls notification service:
   ```typescript
   await notificationService.sendEmail({
     template: 'purchase-receipt',
     recipient: customer.email,
     data: {
       customerName: customer.name,
       orderNumber: order.id,
       items: order.items,
       totalAmount: order.total,
       receiptUrl: 'https://example.com/orders/123/receipt',
     },
   });
   ```
3. Notification service sends email via Resend adapter
4. Customer receives receipt email

**Acceptance Criteria:**

- Email arrives within 60 seconds of purchase
- Email contains all purchase details
- Email includes receipt PDF link
- Email is formatted as proper receipt (itemized list, totals)

---

## User Flows (Visual)

See diagram: [Notification Email Flow](../_assets/notification-email-flow.png)

---

## Dependencies

### Internal Dependencies

- None (notifications is a foundational service used by other features)

### External Dependencies

- **Resend API**: Email delivery provider (Phase 1)
  - API Key required: `RESEND_API_KEY`
  - Verified domain required for production
- **Future Providers** (Phase 2+):
  - SendGrid, Postmark, AWS SES, Mailgun, etc.

### Database Dependencies

- **None required for Phase 1** (emails are fire-and-forget)
- **Future (Phase 2)**: Optional `email_logs` table for delivery tracking

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements

-  Notification service provides `sendEmail()` method
-  Email templates support data interpolation
-  All auth emails work end-to-end:
  - Email verification
  - Password reset
  - Password changed confirmation
-  Purchase receipt emails work (E-Commerce integration)
-  Errors are caught and logged (don't crash calling service)

### Non-Functional Requirements

-  **Abstraction**: Zero direct Resend calls outside adapter
-  **Provider Swap**: Can switch providers in < 1 hour
-  **Performance**: Emails sent in < 5 seconds (p95)
-  **Reliability**: Retry once on failure
-  **Logging**: All email attempts logged (success + failure)

### Testing Requirements

-  Unit tests for notification service (mocked adapter)
-  Unit tests for Resend adapter (mocked Resend API)
-  Integration tests with real Resend (dev account)
-  E2E tests verify email delivery (test email accounts)
-  Test coverage > 80% for notification module

---

## Related Documents

- **TDD**: [Notifications Technical Design Document](./ttd-dphase-1.md)
- **Full Feature**: [Notifications Full Feature Overview](./full-feature-overview.md)
- **Cross-Feature Dependencies**:
  - [Auth PRD](../auth/pdr-phase-1.md) - Primary consumer of notifications
  - [E-Commerce PRD](../e-commerce/pdr-phase-1.md) - Purchase receipts
- **Infrastructure**:
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)
  - [Environment Management](../../infrastructure/EnvironmentManagement.md)

---

## Notes

### Why Abstraction Layer?

**Problem**: Resend (or any provider) could:

- Increase prices dramatically
- Change API without notice
- Experience prolonged outages
- Get acquired and shut down
- Implement unfavorable terms

**Solution**: Abstraction layer isolates business logic from provider:

```
Auth Service � Notification Service (Interface) � Resend Adapter � Resend API
                                                � SendGrid Adapter � SendGrid API (swap)
```

**Benefit**: Switch providers without touching Auth, E-Commerce, or other features.

### Why Resend (Phase 1)?

- **Developer-Friendly**: Modern API, good docs
- **Generous Free Tier**: 100 emails/day (enough for dev/MVP)
- **Domain Verification**: Easy setup
- **Transactional Focus**: Built for transactional emails (vs marketing)
- **Relatively New**: Could become unreliable � abstraction protects us

### Email Templates

Phase 1 uses **simple HTML templates** with variable interpolation:

```html
<!-- templates/email-verification.html -->
<p>Hi {{userName}},</p>
<p>Please verify your email by clicking the link below:</p>
<a href="{{verificationUrl}}">Verify Email</a>
```

**Future (Phase 2)**: Use proper template engine (MJML, React Email, etc.) for:

- Complex layouts
- Mobile responsiveness
- Brand consistency

### Error Handling Philosophy

**Emails are non-critical**: If an email fails, don't crash the calling service.

- Log error with context
- Retry once
- Return error to caller (let them decide if it's critical)

**Example**:

```typescript
// Auth can continue even if verification email fails
try {
  await notificationService.sendEmail({ template: 'email-verification', ... });
} catch (error) {
  console.error('Verification email failed:', error);
  // User can still log in; they'll see "resend verification" prompt
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
