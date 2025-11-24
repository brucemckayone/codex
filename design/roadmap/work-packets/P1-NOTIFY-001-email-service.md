# P1-NOTIFY-001: Email Notification Service

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 3-4 days

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [Implementation Patterns](#implementation-patterns)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

The Email Notification Service provides transactional email capabilities for the Codex platform. This is not a marketing email system—it sends critical user-initiated emails like email verification, password resets, and purchase receipts.

The service is designed provider-agnostic using the Strategy pattern. A unified `NotificationService` interface abstracts away the email provider implementation (Resend in production, MailHog for local development). This allows switching email providers without changing application code.

Email templates are pure functions that take typed data objects and return HTML/text email bodies. This separation of concerns enables easy unit testing (templates are tested independently from email sending), template versioning (change templates without touching service logic), and multi-language support in the future.

The service integrates with the auth system for verification emails, the e-commerce system for purchase receipts, and any future features requiring transactional emails. It's a foundational service that enables user communication without relying on third-party platforms for template hosting or rendering.

---

## System Context

### Upstream Dependencies

- **@codex/observability**: Provides PII redaction for email address logging. Critical for GDPR compliance—email addresses must never appear in plaintext logs.

- **@codex/validation**: Email format validation using Zod schemas (already available).

- **Resend SDK** (External): Third-party email delivery service with simple API and reliability guarantees.

### Downstream Consumers

- **P1-ECOM-002** (Stripe Webhook Handler): Triggers purchase receipt emails after successful payment.

- **Auth Worker** (Future): Sends email verification and password reset emails during registration and password recovery flows.

- **P1-ADMIN-001** (Admin Dashboard - Future): May send weekly revenue report emails to platform owners.

### External Services

- **Resend API**: Production email delivery (requires verified sender domain).

- **MailHog**: Local development SMTP server (captures emails for testing without sending).

### Integration Flow

```
Stripe Webhook Handler
    ↓ checkout.session.completed event
PurchaseService.completePurchase()
    ↓ Create purchase record in database
NotificationService.sendPurchaseReceiptEmail()
    ↓ Generate email template with purchase data
ResendEmailProvider.sendEmail()
    ↓ POST to Resend API with HTML/text email
Customer Inbox
```

---

## Database Schema

The notification service **does not add new tables**. It's a stateless service that sends emails based on data provided by calling services.

**Future Consideration** (Not in Phase 1):
- Add `email_logs` table to track sent emails for debugging and audit trail
- Columns: `id`, `to`, `subject`, `template_type`, `sent_at`, `provider_message_id`

---

## Service Architecture

### Service Responsibilities

**NotificationService** (NOT extending `BaseService` - stateless):
- **Primary Responsibility**: Send transactional emails with type-safe template rendering
- **Key Operations**:
  - `sendVerificationEmail(to, data)`: Email verification with time-limited link
  - `sendPasswordResetEmail(to, data)`: Password reset with secure token link
  - `sendPurchaseReceiptEmail(to, data)`: Purchase confirmation with content access link

**Template Functions** (Pure functions, no dependencies):
- **Primary Responsibility**: Generate HTML and text email bodies from typed data
- **Key Operations**:
  - `generateVerificationEmail(data)`: Returns `{ subject, html, text }`
  - `generatePasswordResetEmail(data)`: Returns `{ subject, html, text }`
  - `generatePurchaseReceiptEmail(data)`: Returns `{ subject, html, text }`

**EmailProvider Interface** (Strategy pattern):
- **Primary Responsibility**: Abstract email sending implementation
- **Implementations**:
  - `ResendEmailProvider`: Production email delivery via Resend API
  - `MockSMTPEmailProvider`: Local development email capture via MailHog

---

### Key Business Rules

**Transactional Emails Only**:
- This service is for user-initiated transactional emails (receipts, verification)
- NOT for marketing emails, newsletters, or bulk campaigns
- Each email triggered by a specific user action
- Must include unsubscribe mechanism (Resend handles this)

**PII Protection** (GDPR Compliance):
- Email addresses are PII and must NEVER appear in logs
- Use `obs.redactEmail(email)` to redact: `"user@example.com"` → `"u***@example.com"`
- Log only redacted emails and metadata (subject, template type, provider message ID)

**Email Accessibility**:
- ALL emails must include both HTML and text versions
- Text version for accessibility (screen readers) and email clients that block HTML
- HTML version for visual presentation and branding

**Template Data Type Safety**:
- All template data strongly typed with TypeScript interfaces
- Zod validation on email addresses (format validation)
- Template functions pure (no side effects, easy to test)

---

### Error Handling Approach

**No Custom Error Classes**:
- Email sending failures are infrastructure errors (not business logic errors)
- Throw standard JavaScript `Error` with descriptive messages
- Observability client tracks errors with context (subject, template type)

**Error Recovery**:
- No automatic retry (calling service decides retry strategy)
- Failed emails logged with `ObservabilityClient.trackError()`
- Provider-specific errors wrapped in generic error messages

**Error Logging**:
```typescript
try {
  await emailProvider.sendEmail(message);
} catch (err) {
  this.obs.trackError(err as Error, {
    to: this.obs.redactEmail(message.to), // ✅ PII redacted
    subject: message.subject,
    template: 'verification',
  });
  throw new Error(`Failed to send verification email: ${err.message}`);
}
```

---

### Transaction Boundaries

**No Database Transactions**:
- Notification service is stateless (no database writes)
- Email sending is NOT transactional (fire-and-forget)
- Calling service handles transaction boundaries for database operations

**Future Enhancement** (Email Logs):
- If `email_logs` table added, use `db.transaction()` to atomically create log entry + send email

---

## Implementation Patterns

### Pattern 1: Strategy Pattern (Provider-Agnostic Email)

Abstract email provider implementation to support multiple backends.

**Interface Definition**:
```typescript
export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>; // For analytics/tracking
}

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<{ id: string }>;
}
```

**Resend Implementation** (Production):
```typescript
import { Resend } from 'resend';
import type { EmailProvider, EmailMessage } from './types';
import { ObservabilityClient } from '@codex/observability';

export class ResendEmailProvider implements EmailProvider {
  private client: Resend;
  private obs: ObservabilityClient;

  constructor(apiKey: string, environment: string) {
    this.client = new Resend(apiKey);
    this.obs = new ObservabilityClient('resend-email-provider', environment);
  }

  async sendEmail(message: EmailMessage): Promise<{ id: string }> {
    // ✅ PII redaction: NEVER log raw email addresses
    this.obs.info('Sending email via Resend', {
      to: this.obs.redactEmail(message.to), // "user@example.com" → "u***@example.com"
      subject: message.subject,
      tags: message.tags,
    });

    const response = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
      tags: message.tags ? Object.entries(message.tags).map(([name, value]) => ({ name, value })) : undefined,
    });

    if (response.error) {
      this.obs.trackError(new Error(response.error.message), {
        subject: message.subject,
      });
      throw new Error(`Email send failed: ${response.error.message}`);
    }

    this.obs.info('Email sent successfully', {
      id: response.data!.id,
      subject: message.subject,
    });

    return { id: response.data!.id };
  }
}
```

**Mock Implementation** (Local Development):
```typescript
import * as nodemailer from 'nodemailer';
import type { EmailProvider, EmailMessage } from './types';

export class MockSMTPEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(smtpHost: string, smtpPort: number) {
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // MailHog doesn't use TLS
      ignoreTLS: true,
    });
  }

  async sendEmail(message: EmailMessage): Promise<{ id: string }> {
    const info = await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: `[LOCAL] ${message.subject}`, // Prefix to indicate local
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });

    return { id: info.messageId };
  }
}
```

**Factory Function** (Dependency Injection):
```typescript
export function getNotificationService(env: {
  USE_MOCK_EMAIL?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  RESEND_API_KEY?: string;
  FROM_EMAIL: string;
  REPLY_TO_EMAIL?: string;
  ENVIRONMENT: string;
}): NotificationService {
  let emailProvider: EmailProvider;

  if (env.USE_MOCK_EMAIL === 'true' && env.SMTP_HOST && env.SMTP_PORT) {
    // Local development: Use MailHog
    emailProvider = new MockSMTPEmailProvider(env.SMTP_HOST, parseInt(env.SMTP_PORT, 10));
  } else {
    // Production: Use Resend
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY required when USE_MOCK_EMAIL is not true');
    }
    emailProvider = new ResendEmailProvider(env.RESEND_API_KEY, env.ENVIRONMENT);
  }

  return new NotificationService({
    emailProvider,
    fromEmail: env.FROM_EMAIL,
    replyToEmail: env.REPLY_TO_EMAIL,
    environment: env.ENVIRONMENT,
  });
}
```

**Key Benefits**:
- **Testability**: Mock provider for unit tests (no external API calls)
- **Flexibility**: Switch from Resend to SendGrid/Postmark without changing service code
- **Local Development**: MailHog captures emails locally (no production API needed)

---

### Pattern 2: Pure Template Functions (Testable, Composable)

Email templates are pure functions for easy testing and composition.

**Template Function** (Pure - no side effects):
```typescript
import type { EmailTemplate, VerificationEmailData } from './types';

/**
 * ✅ TESTABLE: Pure function, no dependencies
 * ✅ TYPE-SAFE: Strongly typed input/output
 * ✅ COMPOSABLE: Returns data structure, service composes with provider
 */
export function generateVerificationEmail(
  data: VerificationEmailData
): Omit<EmailTemplate, 'data'> {
  const subject = 'Verify your email address';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px;">
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Welcome, ${escapeHtml(data.userName)}!</h1>

    <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${data.verificationUrl}"
         style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
        Verify Email Address
      </a>
    </div>

    <p style="color: #666; font-size: 14px;">
      This link will expire in ${data.expiryHours} hours.
    </p>

    <p style="color: #666; font-size: 14px;">
      If you didn't create this account, you can safely ignore this email.
    </p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="color: #999; font-size: 12px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <span style="word-break: break-all;">${data.verificationUrl}</span>
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Welcome, ${data.userName}!

Thank you for signing up. Please verify your email address by visiting this link:

${data.verificationUrl}

This link will expire in ${data.expiryHours} hours.

If you didn't create this account, you can safely ignore this email.
  `.trim();

  return { subject, html, text };
}

// Helper for XSS prevention
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

**Type Definitions**:
```typescript
export interface EmailTemplate<T = any> {
  subject: string;
  html: string;
  text: string;
  data: T;
}

export interface VerificationEmailData {
  userName: string;
  verificationUrl: string;
  expiryHours: number;
}
```

**Key Benefits**:
- **Pure Functions**: No dependencies, no side effects (easy to test)
- **Type Safety**: TypeScript ensures correct data shape
- **XSS Prevention**: Escape HTML in user-provided data
- **Accessibility**: Both HTML and text versions for all email clients

---

### Pattern 3: PII Redaction in Logs (GDPR Compliance)

Email addresses are PII and must be redacted in logs.

**ObservabilityClient Extension** (add to `@codex/observability`):
```typescript
/**
 * Redact email for logging (show first char + domain)
 * Example: "user@example.com" → "u***@example.com"
 */
export class ObservabilityClient {
  // ... existing methods ...

  redactEmail(email: string): string {
    if (!email || !email.includes('@')) {
      return '[invalid-email]';
    }

    const [localPart, domain] = email.split('@');
    const redactedLocal = localPart.length > 0 ? `${localPart[0]}***` : '***';
    return `${redactedLocal}@${domain}`;
  }
}
```

**Usage in Notification Service**:
```typescript
export class NotificationService {
  private obs: ObservabilityClient;

  constructor(private config: NotificationServiceConfig) {
    this.obs = new ObservabilityClient('notification-service', config.environment);
  }

  async sendVerificationEmail(to: string, data: VerificationEmailData): Promise<{ id: string }> {
    // ✅ SECURE: Redact PII before logging
    this.obs.info('Sending verification email', {
      to: this.obs.redactEmail(to), // "user@example.com" → "u***@example.com"
      userName: data.userName, // OK to log (not unique identifier)
    });

    const template = generateVerificationEmail(data);

    return this.config.emailProvider.sendEmail({
      to,
      from: this.config.fromEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: this.config.replyToEmail,
      tags: {
        type: 'verification',
        environment: this.config.environment,
      },
    });
  }
}
```

**Key Benefits**:
- **GDPR Compliance**: Email addresses never appear in plaintext logs
- **Debugging**: Still see enough information to trace emails (first char + domain)
- **Audit Trail**: Logs are safe to store and search

---

### Pattern 4: Service Composition (Not Inheritance)

NotificationService uses composition, not inheritance from BaseService.

**❌ BAD: Inherit from BaseService** (unnecessary dependency):
```typescript
import { BaseService } from '@codex/service-errors';

export class NotificationService extends BaseService {
  constructor(config: ServiceConfig & { emailProvider: EmailProvider }) {
    super(config); // Requires database, userId - not needed for email!
  }

  async sendEmail(...) {
    // BaseService provides this.db (unused), this.userId (unused)
    // Creates unnecessary coupling
  }
}
```

**✅ GOOD: Composition Pattern** (minimal dependencies):
```typescript
export interface NotificationServiceConfig {
  emailProvider: EmailProvider;
  fromEmail: string;
  replyToEmail?: string;
  environment: string;
}

export class NotificationService {
  private obs: ObservabilityClient;

  constructor(private config: NotificationServiceConfig) {
    this.obs = new ObservabilityClient('notification-service', config.environment);
  }

  async sendVerificationEmail(to: string, data: VerificationEmailData): Promise<{ id: string }> {
    const template = generateVerificationEmail(data);

    return this.config.emailProvider.sendEmail({
      to,
      from: this.config.fromEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: { type: 'verification' },
    });
  }
}
```

**Key Benefits**:
- **Minimal Dependencies**: Only depends on what it needs (email provider, config)
- **No Database**: Stateless service (no DB dependency)
- **Easier Testing**: Mock only EmailProvider, not entire database
- **Composition over Inheritance**: More flexible, less coupled

---

## Pseudocode for Key Operations

### Pseudocode: sendVerificationEmail()

```
FUNCTION sendVerificationEmail(to, data):
  // Step 1: Log email send attempt (with PII redaction)
  LOG_INFO('Sending verification email', {
    to: redactEmail(to),  // "user@example.com" → "u***@example.com"
    userName: data.userName
  })

  // Step 2: Generate email template (pure function)
  template = generateVerificationEmail(data)
  // Returns: { subject, html, text }

  // Step 3: Send email via provider
  TRY:
    result = emailProvider.sendEmail({
      to: to,
      from: config.fromEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: config.replyToEmail,
      tags: {
        type: 'verification',
        environment: config.environment
      }
    })

    // Step 4: Log success
    LOG_INFO('Verification email sent', {
      id: result.id,
      to: redactEmail(to)
    })

    RETURN { id: result.id }

  CATCH error:
    // Step 5: Log failure (with PII redaction)
    LOG_ERROR('Failed to send verification email', {
      to: redactEmail(to),
      error: error.message
    })

    THROW new Error('Failed to send verification email: ' + error.message)
END FUNCTION
```

---

### Pseudocode: generatePurchaseReceiptEmail()

```
FUNCTION generatePurchaseReceiptEmail(data):
  // Step 1: Format price from cents to dollars
  priceFormatted = FORMAT_CURRENCY(data.priceCents / 100)
  // Example: 2999 cents → "$29.99"

  // Step 2: Format date
  dateFormatted = FORMAT_DATE(data.purchaseDate, 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  // Example: "November 24, 2025"

  // Step 3: Build email subject
  subject = 'Receipt for your purchase: ' + data.contentTitle

  // Step 4: Build HTML email body
  html = TEMPLATE_HTML({
    title: subject,
    userName: escapeHtml(data.userName),  // XSS prevention
    contentTitle: escapeHtml(data.contentTitle),
    priceFormatted: priceFormatted,
    dateFormatted: dateFormatted,
    contentUrl: data.contentUrl,
    receiptUrl: data.receiptUrl  // Optional
  })

  // Step 5: Build text email body (for accessibility)
  text = TEMPLATE_TEXT({
    userName: data.userName,
    contentTitle: data.contentTitle,
    priceFormatted: priceFormatted,
    dateFormatted: dateFormatted,
    contentUrl: data.contentUrl,
    receiptUrl: data.receiptUrl
  })

  // Step 6: Return email template
  RETURN {
    subject: subject,
    html: html,
    text: text
  }
END FUNCTION
```

---

### Pseudocode: ResendEmailProvider.sendEmail()

```
FUNCTION ResendEmailProvider.sendEmail(message):
  // Step 1: Log send attempt (with PII redaction)
  LOG_INFO('Sending email via Resend', {
    to: redactEmail(message.to),
    subject: message.subject,
    tags: message.tags
  })

  // Step 2: Call Resend API
  TRY:
    response = RESEND_API.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
      tags: convertTagsToResendFormat(message.tags)
    })

    // Step 3: Check for API error
    IF response.error:
      LOG_ERROR('Resend API error', {
        subject: message.subject,
        error: response.error.message
      })
      THROW new Error('Email send failed: ' + response.error.message)

    // Step 4: Log success
    LOG_INFO('Email sent successfully', {
      id: response.data.id,
      subject: message.subject
    })

    RETURN { id: response.data.id }

  CATCH error:
    // Step 5: Log and rethrow error
    LOG_ERROR('Failed to send email', {
      subject: message.subject,
      error: error.message
    })
    THROW error
END FUNCTION
```

---

## API Integration

The notification service is a **library package**, not an API worker. It's imported and used by other workers.

### Usage in Workers

**Stripe Webhook Handler** (P1-ECOM-002):
```typescript
import { getNotificationService, type PurchaseReceiptEmailData } from '@codex/notifications';

export async function handleCheckoutComplete(session: Stripe.Checkout.Session, env: Env) {
  const notifService = getNotificationService({
    RESEND_API_KEY: env.RESEND_API_KEY,
    FROM_EMAIL: env.FROM_EMAIL,
    REPLY_TO_EMAIL: env.REPLY_TO_EMAIL,
    ENVIRONMENT: env.ENVIRONMENT,
  });

  await notifService.sendPurchaseReceiptEmail(session.customer_email!, {
    userName: session.metadata.userName,
    contentTitle: session.metadata.contentTitle,
    priceCents: session.amount_total!,
    purchaseDate: new Date(),
    contentUrl: `https://yourdomain.com/content/${session.metadata.contentId}`,
  });
}
```

**Auth Worker** (Future):
```typescript
import { getNotificationService, type VerificationEmailData } from '@codex/notifications';

app.post('/api/auth/register', async (c) => {
  const user = await createUser(email, password);
  const token = generateVerificationToken(user.id);

  const notifService = getNotificationService(c.env);
  await notifService.sendVerificationEmail(user.email, {
    userName: user.username,
    verificationUrl: `https://yourdomain.com/verify?token=${token}`,
    expiryHours: 24,
  });

  return c.json({ success: true });
});
```

---

### Public API

**Exported Types and Functions**:
```typescript
// Service
export { NotificationService, getNotificationService } from './service';
export type { NotificationServiceConfig } from './service';

// Template Data Types
export type {
  VerificationEmailData,
  PasswordResetEmailData,
  PurchaseReceiptEmailData,
} from './templates/types';

// Provider Interface (for testing/mocking)
export type { EmailProvider, EmailMessage } from './providers/types';
```

**NOT Exported** (Internal Implementation):
- Template functions (`generateVerificationEmail`, etc.) - use service methods instead
- Provider implementations (`ResendEmailProvider`, `MockSMTPEmailProvider`) - use factory instead
- ObservabilityClient usage (internal logging)

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/observability`
- **PII Redaction**:
  - `redactEmail(email)`: Redact email addresses for logging (`"user@example.com"` → `"u***@example.com"`)
  - `info(message, metadata)`: Info logs (use for email send attempts)
  - `trackError(error, metadata)`: Error logs with stack traces

**When to use**: ALL logs that might contain email addresses

---

#### `@codex/validation`
- **Email Validation**:
  - `z.string().email()`: Zod schema for email format validation
  - Type-safe validation with automatic error messages

**When to use**: Validate email addresses before sending

---

### Utility Packages

#### Resend SDK
- **Email Sending**:
  - `client.emails.send()`: Send email via Resend API
  - `tags`: Track email categories for analytics
  - `reply_to`: Set custom reply-to address

**When to use**: Production email delivery

---

#### Nodemailer (Dev Only)
- **Local Email Testing**:
  - `createTransport()`: SMTP client for MailHog
  - `sendMail()`: Send email to local SMTP server

**When to use**: Local development email capture

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| @codex/observability | ✅ Available | PII redaction for email logging |
| Resend SDK | ❌ Not Installed | Production email delivery (will install via pnpm) |
| Nodemailer | ❌ Not Installed | Local dev email testing (will install as devDependency) |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| Email Template Library | 🚧 Future | Use React Email or MJML for advanced templates |

### Infrastructure Ready

- ✅ Observability package with logging
- ✅ Validation package with email schemas
- ✅ MailHog Docker container setup (local dev)

---

## Implementation Checklist

- [ ] **Package Setup**
  - [ ] Create `packages/notifications/` directory
  - [ ] Install Resend SDK (`pnpm add resend`)
  - [ ] Install Nodemailer for dev (`pnpm add -D nodemailer @types/nodemailer`)
  - [ ] Configure `package.json` with exports

- [ ] **Email Templates**
  - [ ] Create `src/templates/types.ts` with template data interfaces
  - [ ] Implement `generateVerificationEmail()` (pure function)
  - [ ] Implement `generatePasswordResetEmail()` (pure function)
  - [ ] Implement `generatePurchaseReceiptEmail()` (pure function)
  - [ ] Add HTML escape helper for XSS prevention

- [ ] **Email Providers**
  - [ ] Create `src/providers/types.ts` with `EmailProvider` interface
  - [ ] Implement `ResendEmailProvider` (production)
  - [ ] Implement `MockSMTPEmailProvider` (local dev)
  - [ ] Add PII redaction to all log statements

- [ ] **Notification Service**
  - [ ] Create `src/service.ts` with `NotificationService` class
  - [ ] Implement `sendVerificationEmail()`
  - [ ] Implement `sendPasswordResetEmail()`
  - [ ] Implement `sendPurchaseReceiptEmail()`
  - [ ] Create factory function `getNotificationService()`

- [ ] **Observability Extension**
  - [ ] Add `redactEmail()` method to `ObservabilityClient`
  - [ ] Add tests for PII redaction

- [ ] **Tests**
  - [ ] Unit tests for all template functions (100% coverage)
  - [ ] Unit tests for NotificationService (mocked provider)
  - [ ] Unit tests for PII redaction
  - [ ] Integration tests for Resend provider (mocked API)

- [ ] **Local Development**
  - [ ] Add MailHog service to `docker-compose.dev.local.yml`
  - [ ] Document local dev workflow (README.md)
  - [ ] Test email capture with MailHog UI

- [ ] **Documentation**
  - [ ] Update public API exports in `src/index.ts`
  - [ ] Document environment variables
  - [ ] Add usage examples for workers

---

## Testing Strategy

### Unit Tests
- **Template Functions**: Test pure functions in isolation
  - Verify HTML/text output contains expected data
  - Test HTML escaping (XSS prevention)
  - Test price formatting (cents to dollars)
  - Test date formatting

### Integration Tests
- **NotificationService**: Test with mocked EmailProvider
  - Verify correct template data passed to provider
  - Verify PII redaction in logs
  - Test error handling (provider failures)

### Local Development Testing
- **MailHog Capture**:
  - Start MailHog Docker container
  - Send test emails via MockSMTPEmailProvider
  - View emails in MailHog UI (http://localhost:8025)
  - Verify HTML rendering, text fallback

### E2E Scenarios
- **Purchase Receipt Flow**: Stripe webhook → purchase record → email sent → customer receives email
- **Email Verification Flow**: User registers → verification email sent → user clicks link → email verified

---

## Notes

### Architectural Decisions

**Why Not BaseService?**
- NotificationService is stateless (no database, no userId)
- Composition over inheritance (minimal dependencies)
- Easier testing (no need to mock database)

**Why Pure Template Functions?**
- Easy unit testing (no side effects)
- Type-safe with TypeScript interfaces
- Composable (can reuse for other providers)

**Why Strategy Pattern for Providers?**
- Swap providers without changing service code (Resend → SendGrid)
- Mock provider for local dev (MailHog) and tests
- Flexibility for future requirements

### Security Considerations

**PII Protection**:
- Email addresses MUST be redacted in logs (`redactEmail()`)
- GDPR compliance: email addresses are personal data
- Log only metadata (subject, template type, provider message ID)

**XSS Prevention**:
- Escape HTML in user-provided data (userName, contentTitle)
- Use `escapeHtml()` helper in templates
- Never trust user input in HTML templates

**Email Verification**:
- Resend requires sender domain verification (DNS records)
- Use environment-specific sender emails (noreply@yourdomain.com)

### Performance Notes

**Expected Latency**:
- Resend API: ~200-500ms per email
- MailHog SMTP: ~50-100ms (local)

**Rate Limiting**:
- Resend free tier: 100 emails/day (sufficient for local dev)
- Production tier: 50,000+ emails/month
- No rate limiting in code (Resend handles this)

### Future Enhancements

**Phase 2+**:
- Email logs table (`email_logs`) for audit trail
- Template versioning (store templates in database)
- Multi-language support (i18n for templates)
- Advanced templates with React Email or MJML
- Email scheduling (delayed sends)

---

**Last Updated**: 2025-11-24
**Template Version**: 1.0
