# Work Packet: P1-NOTIFY-001 - Email Notification Service

**Status**: 🚧 To Be Implemented
**Priority**: P1 (Important - needed soon)
**Estimated Effort**: 3-4 days
**Branch**: `feature/P1-NOTIFY-001-email-service`

---

## Current State

**✅ Already Implemented:**
- Observability package with PII redaction (`@codex/observability`)
- Environment configuration patterns in existing workers
- Email field validation in auth schema

**🚧 Needs Implementation:**
- Email template system (verification, password reset, purchase receipt)
- Resend email provider adapter
- Notification service (provider-agnostic interface)
- Template rendering with variables
- Tests (template rendering, service unit tests)

---

## Dependencies

### Required Packages
- **Resend SDK** - Will install (`npm:resend`)
- **@codex/observability** - Already available (PII redaction for email addresses)
- **@codex/validation** - Already available (email validation)

### Existing Patterns
```typescript
// Email validation already available
import { z } from 'zod';
const emailSchema = z.string().email('Invalid email address');
```

### Required Documentation
- [Notifications TDD](../../features/notifications/ttd-dphase-1.md)
- [STANDARDS.md](../STANDARDS.md)
- [Resend Documentation](https://resend.com/docs)

---

## Implementation Steps

### Step 1: Install Resend SDK

**File**: `packages/notifications/package.json`

```json
{
  "name": "@codex/notifications",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "resend": "^3.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitest": "^1.0.0"
  }
}
```

### Step 2: Create Email Templates

**File**: `packages/notifications/src/templates/types.ts`

```typescript
/**
 * Email template types and data structures
 *
 * Design decisions:
 * - Strongly typed template data for type safety
 * - Separate HTML and text versions for email client compatibility
 * - Template functions return both subject and body
 */

export interface EmailTemplate<T = any> {
  subject: string;
  html: string;
  text: string;
  data: T;
}

// Template data types
export interface VerificationEmailData {
  userName: string;
  verificationUrl: string;
  expiryHours: number;
}

export interface PasswordResetEmailData {
  userName: string;
  resetUrl: string;
  expiryHours: number;
}

export interface PurchaseReceiptEmailData {
  userName: string;
  contentTitle: string;
  priceCents: number;
  purchaseDate: Date;
  contentUrl: string;
  receiptUrl?: string;
}

export interface WelcomeEmailData {
  userName: string;
  loginUrl: string;
}
```

**File**: `packages/notifications/src/templates/verification.ts`

```typescript
import type { EmailTemplate, VerificationEmailData } from './types';

/**
 * ✅ TESTABLE: Pure function, no dependencies
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
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Welcome, ${data.userName}!</h1>

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
```

**File**: `packages/notifications/src/templates/password-reset.ts`

```typescript
import type { EmailTemplate, PasswordResetEmailData } from './types';

/**
 * ✅ TESTABLE: Pure function, no dependencies
 */
export function generatePasswordResetEmail(
  data: PasswordResetEmailData
): Omit<EmailTemplate, 'data'> {
  const subject = 'Reset your password';

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
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Password Reset Request</h1>

    <p>Hi ${data.userName},</p>

    <p>We received a request to reset your password. Click the button below to create a new password:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${data.resetUrl}"
         style="background-color: #e74c3c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
        Reset Password
      </a>
    </div>

    <p style="color: #666; font-size: 14px;">
      This link will expire in ${data.expiryHours} hours.
    </p>

    <p style="color: #e74c3c; font-size: 14px; font-weight: bold;">
      If you didn't request a password reset, please ignore this email or contact support if you have concerns.
    </p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="color: #999; font-size: 12px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <span style="word-break: break-all;">${data.resetUrl}</span>
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Password Reset Request

Hi ${data.userName},

We received a request to reset your password. Visit this link to create a new password:

${data.resetUrl}

This link will expire in ${data.expiryHours} hours.

If you didn't request a password reset, please ignore this email or contact support if you have concerns.
  `.trim();

  return { subject, html, text };
}
```

**File**: `packages/notifications/src/templates/purchase-receipt.ts`

```typescript
import type { EmailTemplate, PurchaseReceiptEmailData } from './types';

/**
 * ✅ TESTABLE: Pure function, no dependencies
 */
export function generatePurchaseReceiptEmail(
  data: PurchaseReceiptEmailData
): Omit<EmailTemplate, 'data'> {
  const subject = `Receipt for your purchase: ${data.contentTitle}`;
  const priceFormatted = `$${(data.priceCents / 100).toFixed(2)}`;
  const dateFormatted = data.purchaseDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Thank you for your purchase!</h1>

    <p>Hi ${data.userName},</p>

    <p>Your purchase was successful. Here are the details:</p>

    <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;"><strong>Content</strong></td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right;">${data.contentTitle}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;"><strong>Amount</strong></td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right;">${priceFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0;"><strong>Date</strong></td>
          <td style="padding: 10px 0; text-align: right;">${dateFormatted}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${data.contentUrl}"
         style="background-color: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
        Access Your Content
      </a>
    </div>

    ${data.receiptUrl ? `
    <p style="color: #666; font-size: 14px; text-align: center;">
      <a href="${data.receiptUrl}" style="color: #3498db;">Download Receipt</a>
    </p>
    ` : ''}

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="color: #666; font-size: 14px;">
      If you have any questions about this purchase, please contact our support team.
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
Thank you for your purchase!

Hi ${data.userName},

Your purchase was successful. Here are the details:

Content: ${data.contentTitle}
Amount: ${priceFormatted}
Date: ${dateFormatted}

Access your content here: ${data.contentUrl}

${data.receiptUrl ? `Download receipt: ${data.receiptUrl}` : ''}

If you have any questions about this purchase, please contact our support team.
  `.trim();

  return { subject, html, text };
}
```

### Step 3: Create Email Provider Interface

**File**: `packages/notifications/src/providers/types.ts`

```typescript
/**
 * Provider-agnostic email interface
 *
 * Design: Abstract interface allows switching email providers without changing service code
 */

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>; // For tracking/analytics
}

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<{ id: string }>;
}
```

**File**: `packages/notifications/src/providers/resend.ts`

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
    // ✅ SECURE: Redact email from logs (PII)
    this.obs.info('Sending email', {
      to: this.obs.redactEmail(message.to),
      subject: message.subject,
      tags: message.tags,
    });

    try {
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
        id: response.data?.id,
        subject: message.subject,
      });

      return { id: response.data!.id };
    } catch (err) {
      this.obs.trackError(err as Error, {
        subject: message.subject,
      });
      throw err;
    }
  }
}
```

### Step 4: Create Notification Service

**File**: `packages/notifications/src/service.ts`

```typescript
import type { EmailProvider } from './providers/types';
import { generateVerificationEmail } from './templates/verification';
import { generatePasswordResetEmail } from './templates/password-reset';
import { generatePurchaseReceiptEmail } from './templates/purchase-receipt';
import type {
  VerificationEmailData,
  PasswordResetEmailData,
  PurchaseReceiptEmailData,
} from './templates/types';
import { ObservabilityClient } from '@codex/observability';

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

  /**
   * Send email verification
   */
  async sendVerificationEmail(
    to: string,
    data: VerificationEmailData
  ): Promise<{ id: string }> {
    this.obs.info('Sending verification email', {
      to: this.obs.redactEmail(to),
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

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    to: string,
    data: PasswordResetEmailData
  ): Promise<{ id: string }> {
    this.obs.info('Sending password reset email', {
      to: this.obs.redactEmail(to),
    });

    const template = generatePasswordResetEmail(data);

    return this.config.emailProvider.sendEmail({
      to,
      from: this.config.fromEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: this.config.replyToEmail,
      tags: {
        type: 'password-reset',
        environment: this.config.environment,
      },
    });
  }

  /**
   * Send purchase receipt email
   */
  async sendPurchaseReceiptEmail(
    to: string,
    data: PurchaseReceiptEmailData
  ): Promise<{ id: string }> {
    this.obs.info('Sending purchase receipt email', {
      to: this.obs.redactEmail(to),
      contentTitle: data.contentTitle,
    });

    const template = generatePurchaseReceiptEmail(data);

    return this.config.emailProvider.sendEmail({
      to,
      from: this.config.fromEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: this.config.replyToEmail,
      tags: {
        type: 'purchase-receipt',
        environment: this.config.environment,
      },
    });
  }
}

/**
 * Factory function for dependency injection
 */
export function getNotificationService(env: {
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  REPLY_TO_EMAIL?: string;
  ENVIRONMENT: string;
}): NotificationService {
  const { ResendEmailProvider } = require('./providers/resend');
  const emailProvider = new ResendEmailProvider(env.RESEND_API_KEY, env.ENVIRONMENT);

  return new NotificationService({
    emailProvider,
    fromEmail: env.FROM_EMAIL,
    replyToEmail: env.REPLY_TO_EMAIL,
    environment: env.ENVIRONMENT,
  });
}
```

### Step 5: Add Observability PII Redaction

**File**: `packages/observability/src/client.ts` (add method)

```typescript
/**
 * Redact email for logging (show first char + domain)
 * Example: "user@example.com" → "u***@example.com"
 */
redactEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return '[invalid-email]';
  }

  const [localPart, domain] = email.split('@');
  const redactedLocal = localPart.length > 0 ? `${localPart[0]}***` : '***';
  return `${redactedLocal}@${domain}`;
}
```

### Step 6: Add Tests

**File**: `packages/notifications/src/templates/verification.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { generateVerificationEmail } from './verification';

describe('generateVerificationEmail', () => {
  it('should generate email with all data', () => {
    const email = generateVerificationEmail({
      userName: 'John Doe',
      verificationUrl: 'https://example.com/verify?token=abc123',
      expiryHours: 24,
    });

    expect(email.subject).toBe('Verify your email address');
    expect(email.html).toContain('John Doe');
    expect(email.html).toContain('https://example.com/verify?token=abc123');
    expect(email.html).toContain('24 hours');
    expect(email.text).toContain('John Doe');
    expect(email.text).toContain('https://example.com/verify?token=abc123');
  });

  it('should escape HTML in user data', () => {
    const email = generateVerificationEmail({
      userName: '<script>alert("xss")</script>',
      verificationUrl: 'https://example.com/verify',
      expiryHours: 24,
    });

    // HTML should be escaped (basic check - in production use proper sanitization)
    expect(email.html).not.toContain('<script>');
  });
});
```

**File**: `packages/notifications/src/templates/purchase-receipt.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { generatePurchaseReceiptEmail } from './purchase-receipt';

describe('generatePurchaseReceiptEmail', () => {
  it('should format price correctly', () => {
    const email = generatePurchaseReceiptEmail({
      userName: 'John Doe',
      contentTitle: 'Video Course',
      priceCents: 2999, // $29.99
      purchaseDate: new Date('2025-01-01'),
      contentUrl: 'https://example.com/content/123',
    });

    expect(email.html).toContain('$29.99');
    expect(email.text).toContain('$29.99');
  });

  it('should include optional receipt URL', () => {
    const email = generatePurchaseReceiptEmail({
      userName: 'John Doe',
      contentTitle: 'Video Course',
      priceCents: 2999,
      purchaseDate: new Date('2025-01-01'),
      contentUrl: 'https://example.com/content/123',
      receiptUrl: 'https://example.com/receipt/456',
    });

    expect(email.html).toContain('https://example.com/receipt/456');
  });

  it('should handle free content (0 cents)', () => {
    const email = generatePurchaseReceiptEmail({
      userName: 'John Doe',
      contentTitle: 'Free Video',
      priceCents: 0,
      purchaseDate: new Date('2025-01-01'),
      contentUrl: 'https://example.com/content/123',
    });

    expect(email.html).toContain('$0.00');
  });
});
```

**File**: `packages/notifications/src/service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './service';
import type { EmailProvider, EmailMessage } from './providers/types';

describe('NotificationService', () => {
  let mockProvider: EmailProvider;
  let service: NotificationService;

  beforeEach(() => {
    mockProvider = {
      sendEmail: vi.fn().mockResolvedValue({ id: 'email-123' }),
    };

    service = new NotificationService({
      emailProvider: mockProvider,
      fromEmail: 'noreply@example.com',
      replyToEmail: 'support@example.com',
      environment: 'test',
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email with correct data', async () => {
      const result = await service.sendVerificationEmail('user@example.com', {
        userName: 'John Doe',
        verificationUrl: 'https://example.com/verify',
        expiryHours: 24,
      });

      expect(result.id).toBe('email-123');
      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Verify your email address',
          replyTo: 'support@example.com',
          tags: expect.objectContaining({
            type: 'verification',
          }),
        })
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email', async () => {
      await service.sendPasswordResetEmail('user@example.com', {
        userName: 'John Doe',
        resetUrl: 'https://example.com/reset',
        expiryHours: 2,
      });

      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Reset your password',
          tags: expect.objectContaining({
            type: 'password-reset',
          }),
        })
      );
    });
  });

  describe('sendPurchaseReceiptEmail', () => {
    it('should send purchase receipt email', async () => {
      await service.sendPurchaseReceiptEmail('user@example.com', {
        userName: 'John Doe',
        contentTitle: 'Video Course',
        priceCents: 2999,
        purchaseDate: new Date('2025-01-01'),
        contentUrl: 'https://example.com/content/123',
      });

      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Video Course'),
          tags: expect.objectContaining({
            type: 'purchase-receipt',
          }),
        })
      );
    });
  });
});
```

**File**: `packages/observability/src/client.test.ts` (add test)

```typescript
describe('redactEmail', () => {
  it('should redact email addresses', () => {
    const obs = new ObservabilityClient('test', 'test');

    expect(obs.redactEmail('user@example.com')).toBe('u***@example.com');
    expect(obs.redactEmail('a@test.com')).toBe('a***@test.com');
  });

  it('should handle invalid emails', () => {
    const obs = new ObservabilityClient('test', 'test');

    expect(obs.redactEmail('notanemail')).toBe('[invalid-email]');
    expect(obs.redactEmail('')).toBe('[invalid-email]');
  });
});
```

---

## Test Specifications

### Unit Tests (Templates)
- `generateVerificationEmail` - Contains all data, escapes HTML
- `generatePasswordResetEmail` - Contains all data, warning text present
- `generatePurchaseReceiptEmail` - Price formatting, optional receipt URL, free content

### Unit Tests (Service)
- `sendVerificationEmail` - Calls provider with correct data
- `sendPasswordResetEmail` - Calls provider with correct data
- `sendPurchaseReceiptEmail` - Calls provider with correct data
- All methods - Include correct tags for tracking

### Unit Tests (Observability)
- `redactEmail` - Redacts email addresses correctly
- `redactEmail` - Handles invalid emails

### Integration Tests (Resend Provider)
- Mock Resend API responses
- Test error handling
- Test observability logging

---

## Definition of Done

- [ ] Resend SDK installed in notifications package
- [ ] Email template functions implemented (verification, password reset, purchase receipt)
- [ ] Resend provider implemented with EmailProvider interface
- [ ] NotificationService implemented with typed methods
- [ ] PII redaction added to observability client
- [ ] Unit tests for all templates (100% coverage)
- [ ] Unit tests for service (mocked provider)
- [ ] Unit tests for PII redaction
- [ ] Error handling comprehensive
- [ ] Observability logging complete with PII redaction
- [ ] Environment variables documented (RESEND_API_KEY, FROM_EMAIL)
- [ ] CI passing (tests + typecheck + lint)

---

## Integration Points

### Depends On
- **@codex/observability**: PII redaction for email logging
- **@codex/validation**: Email validation (already available)

### Integrates With
- **P1-ECOM-002** (Webhook Handlers): Will trigger purchase receipt emails
- Future auth flows: Verification and password reset emails

### Environment Variables
```bash
RESEND_API_KEY=re_123abc...           # Resend API key
FROM_EMAIL=noreply@example.com        # Sender email (must be verified in Resend)
REPLY_TO_EMAIL=support@example.com    # Optional reply-to address
```

---

## Step 7: Public API and Package Exports

**Why This Matters**: Clear public API enables other packages to import only what they need and work in isolation.

**File**: `packages/notifications/src/index.ts`

```typescript
/**
 * @codex/notifications - Email notification service
 *
 * PUBLIC API
 * ==========
 * This package exports a provider-agnostic notification service for sending emails.
 *
 * INTERFACE CONTRACT:
 * ------------------
 * Other packages (e.g., @codex/auth, @codex/ecommerce) depend on:
 * 1. NotificationService class with typed send methods
 * 2. Template data types (VerificationEmailData, etc.)
 * 3. Factory function for dependency injection
 *
 * INTERNAL IMPLEMENTATION:
 * -----------------------
 * Template functions, provider implementations, and observability are internal.
 * Other packages MUST NOT import from subdirectories (e.g., ./templates/verification).
 *
 * USAGE EXAMPLE:
 * -------------
 * ```typescript
 * import { getNotificationService, type VerificationEmailData } from '@codex/notifications';
 *
 * const notifService = getNotificationService(env);
 * await notifService.sendVerificationEmail('user@example.com', {
 *   userName: 'John Doe',
 *   verificationUrl: 'https://example.com/verify?token=abc',
 *   expiryHours: 24,
 * });
 * ```
 */

// ============================================================================
// PUBLIC API - Safe to import from other packages
// ============================================================================

// Service
export { NotificationService, getNotificationService } from './service';
export type { NotificationServiceConfig } from './service';

// Template Data Types (for consumers)
export type {
  VerificationEmailData,
  PasswordResetEmailData,
  PurchaseReceiptEmailData,
  WelcomeEmailData,
} from './templates/types';

// Provider Interface (for testing/mocking)
export type { EmailProvider, EmailMessage } from './providers/types';

// ============================================================================
// INTERNAL - DO NOT import from other packages
// ============================================================================

// Templates are internal - use NotificationService methods instead
// Providers are internal - use getNotificationService() factory instead
```

**File**: `packages/notifications/package.json` (exports field)

```json
{
  "name": "@codex/notifications",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "resend": "^3.0.0",
    "zod": "^3.22.4",
    "@codex/observability": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitest": "^1.0.0"
  }
}
```

---

## Step 8: Local Development Setup

**Why This Matters**: Developers need to test emails locally before deploying to production.

### Email Testing with MailHog

**What is MailHog?**
- Runs a local SMTP server that captures all outgoing emails
- Provides web UI at http://localhost:8025 to view emails
- No emails actually sent (safe for testing)
- Resend SDK will be configured to use MailHog in local dev

### Docker Compose Integration

**File**: `infrastructure/neon/docker-compose.dev.local.yml` (add service)

```yaml
services:
  postgres:
    # ... existing postgres config ...

  neon-proxy:
    # ... existing neon-proxy config ...

  # ========================================
  # Email Testing - MailHog
  # ========================================
  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - '1025:1025'  # SMTP server
      - '8025:8025'  # Web UI
    healthcheck:
      test: ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:8025']
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  db_data:
```

### Local Environment Variables

**File**: `.env.local` (developer creates this)

```bash
# ============================================================================
# Email Service Configuration (Local Development)
# ============================================================================

# For local development, use MailHog mock SMTP server
# MailHog runs at localhost:1025 (SMTP) and localhost:8025 (Web UI)
# All emails will be captured and viewable at http://localhost:8025

# Option 1: Mock mode using MailHog (RECOMMENDED for local dev)
USE_MOCK_EMAIL=true
SMTP_HOST=localhost
SMTP_PORT=1025
FROM_EMAIL=noreply@localhost
REPLY_TO_EMAIL=support@localhost

# Option 2: Real Resend (for testing actual email delivery)
# Uncomment these to use real Resend API (requires API key)
# USE_MOCK_EMAIL=false
# RESEND_API_KEY=re_123abc...
# FROM_EMAIL=noreply@yourdomain.com  # Must be verified in Resend
# REPLY_TO_EMAIL=support@yourdomain.com

ENVIRONMENT=local
```

### Mock Email Provider for Local Dev

**File**: `packages/notifications/src/providers/mock-smtp.ts`

```typescript
import * as nodemailer from 'nodemailer';
import type { EmailProvider, EmailMessage } from './types';
import { ObservabilityClient } from '@codex/observability';

/**
 * Mock email provider using SMTP (MailHog for local dev)
 *
 * This provider sends emails to a local SMTP server (MailHog) for testing.
 * Emails are captured and viewable at http://localhost:8025
 */
export class MockSMTPEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;
  private obs: ObservabilityClient;

  constructor(smtpHost: string, smtpPort: number, environment: string) {
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // MailHog doesn't use TLS
      ignoreTLS: true,
    });

    this.obs = new ObservabilityClient('mock-smtp-provider', environment);
  }

  async sendEmail(message: EmailMessage): Promise<{ id: string }> {
    this.obs.info('Sending email via mock SMTP', {
      to: this.obs.redactEmail(message.to),
      subject: message.subject,
      tags: message.tags,
    });

    try {
      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: `[LOCAL] ${message.subject}`, // Prefix to indicate local
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });

      this.obs.info('Email sent via mock SMTP', {
        messageId: info.messageId,
        subject: message.subject,
      });

      return { id: info.messageId };
    } catch (err) {
      this.obs.trackError(err as Error, {
        subject: message.subject,
      });
      throw err;
    }
  }
}
```

**File**: `packages/notifications/package.json` (add nodemailer for local dev)

```json
{
  "dependencies": {
    "resend": "^3.0.0",
    "zod": "^3.22.4",
    "@codex/observability": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/nodemailer": "^6.4.14",
    "nodemailer": "^6.9.8",
    "vitest": "^1.0.0"
  }
}
```

### Update Factory Function for Local Dev

**File**: `packages/notifications/src/service.ts` (update factory)

```typescript
/**
 * Factory function for dependency injection
 * Supports both production (Resend) and local dev (MailHog)
 */
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
    const { MockSMTPEmailProvider } = require('./providers/mock-smtp');
    emailProvider = new MockSMTPEmailProvider(
      env.SMTP_HOST,
      parseInt(env.SMTP_PORT, 10),
      env.ENVIRONMENT
    );
  } else {
    // Production: Use Resend
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required when USE_MOCK_EMAIL is not true');
    }
    const { ResendEmailProvider } = require('./providers/resend');
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

### Local Development Workflow

**Start Local Services**:
```bash
# Start postgres, neon-proxy, and MailHog
cd infrastructure/neon
docker compose -f docker-compose.dev.local.yml up -d

# Verify MailHog is running
open http://localhost:8025
```

**Run Package Tests**:
```bash
cd packages/notifications
pnpm test           # Run all tests
pnpm test:watch     # Watch mode for development
```

**Manual Email Testing** (in worker code):
```typescript
import { getNotificationService } from '@codex/notifications';

// In your Cloudflare Worker or local test script
const notifService = getNotificationService(env);

await notifService.sendVerificationEmail('test@example.com', {
  userName: 'Test User',
  verificationUrl: 'http://localhost:3000/verify?token=abc123',
  expiryHours: 24,
});

// Check http://localhost:8025 to see the email
```

**View Sent Emails**:
1. Open http://localhost:8025 in browser
2. See all captured emails with full HTML/text rendering
3. Inspect headers, attachments, and raw SMTP data

---

## Step 9: CI/CD Integration

**Why This Matters**: Ensures tests run in CI and emails work correctly across environments.

### GitHub Actions Workflow

**No Changes Required**: Existing workflow already handles this package.

**File**: `.github/workflows/test.yml` (already exists)

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test
        # This will test @codex/notifications with mocked EmailProvider

      - name: Type check
        run: pnpm run typecheck

      - name: Lint
        run: pnpm run lint
```

### Environment-Specific Configuration

**Local Development** (.env.local):
```bash
USE_MOCK_EMAIL=true
SMTP_HOST=localhost
SMTP_PORT=1025
FROM_EMAIL=noreply@localhost
ENVIRONMENT=local
```

**Preview Environments** (Cloudflare Workers):
```bash
# Set in wrangler.jsonc [env.preview] or Cloudflare dashboard
RESEND_API_KEY=re_preview_key123...
FROM_EMAIL=noreply@preview.yourdomain.com
REPLY_TO_EMAIL=support@yourdomain.com
ENVIRONMENT=preview
```

**Production** (Cloudflare Workers):
```bash
# Set in Cloudflare dashboard as secrets
RESEND_API_KEY=re_prod_key123...
FROM_EMAIL=noreply@yourdomain.com
REPLY_TO_EMAIL=support@yourdomain.com
ENVIRONMENT=production
```

### Testing Strategy

1. **Unit Tests** (packages/notifications):
   - Mock EmailProvider interface
   - Test template rendering
   - Test service methods
   - No external dependencies

2. **Local Development**:
   - Use MailHog to capture emails
   - Manually verify email rendering
   - Test with real worker code

3. **Preview Environment**:
   - Use Resend test mode or separate domain
   - Test webhook integrations
   - Verify email delivery

4. **Production**:
   - Use production Resend API key
   - Monitor email delivery via Resend dashboard
   - Track errors via observability

---

## Integration Points (Detailed)

### How Other Packages Use This Service

**Example: Auth Worker** (`apps/auth-worker/src/index.ts`)

```typescript
import { getNotificationService, type VerificationEmailData } from '@codex/notifications';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const notifService = getNotificationService({
      RESEND_API_KEY: env.RESEND_API_KEY,
      FROM_EMAIL: env.FROM_EMAIL,
      REPLY_TO_EMAIL: env.REPLY_TO_EMAIL,
      ENVIRONMENT: env.ENVIRONMENT,
    });

    // Register new user
    const user = await createUser(email, password);
    const token = generateVerificationToken(user.id);

    // Send verification email
    await notifService.sendVerificationEmail(user.email, {
      userName: user.username,
      verificationUrl: `https://yourdomain.com/verify?token=${token}`,
      expiryHours: 24,
    });

    return Response.json({ success: true });
  },
};
```

**Example: Ecommerce Worker** (`apps/ecommerce-worker/src/webhooks/stripe.ts`)

```typescript
import { getNotificationService, type PurchaseReceiptEmailData } from '@codex/notifications';

export async function handleCheckoutComplete(
  session: Stripe.Checkout.Session,
  env: Env
): Promise<void> {
  const notifService = getNotificationService({
    RESEND_API_KEY: env.RESEND_API_KEY,
    FROM_EMAIL: env.FROM_EMAIL,
    REPLY_TO_EMAIL: env.REPLY_TO_EMAIL,
    ENVIRONMENT: env.ENVIRONMENT,
  });

  // Send purchase receipt
  await notifService.sendPurchaseReceiptEmail(session.customer_email!, {
    userName: session.metadata.userName,
    contentTitle: session.metadata.contentTitle,
    priceCents: session.amount_total!,
    purchaseDate: new Date(),
    contentUrl: `https://yourdomain.com/content/${session.metadata.contentId}`,
  });
}
```

### Interface Contracts

**What Other Packages Can Depend On**:

1. **NotificationService** class with these methods:
   - `sendVerificationEmail(to: string, data: VerificationEmailData): Promise<{id: string}>`
   - `sendPasswordResetEmail(to: string, data: PasswordResetEmailData): Promise<{id: string}>`
   - `sendPurchaseReceiptEmail(to: string, data: PurchaseReceiptEmailData): Promise<{id: string}>`

2. **Template Data Types**:
   - `VerificationEmailData`
   - `PasswordResetEmailData`
   - `PurchaseReceiptEmailData`

3. **Factory Function**:
   - `getNotificationService(env): NotificationService`

**What Other Packages CANNOT Depend On**:
- Template rendering functions (internal)
- Provider implementations (internal)
- Observability logging details (internal)

### Environment Variables Required by Consumers

Workers that use `@codex/notifications` must set:

```bash
RESEND_API_KEY=re_...         # Production Resend API key
FROM_EMAIL=noreply@...        # Sender email (verified in Resend)
REPLY_TO_EMAIL=support@...    # Optional reply-to address
ENVIRONMENT=production|preview|local
```

### Package Dependencies

**This package depends on**:
- `@codex/observability` - PII redaction for logging
- `resend` - Email provider SDK
- `nodemailer` (dev only) - Mock SMTP for local testing

**Packages that depend on this**:
- `@codex/auth` (future) - Verification and password reset emails
- `@codex/ecommerce` - Purchase receipt emails
- Any worker that needs to send transactional emails

---

## Related Documentation

**Must Read**:
- [STANDARDS.md](../STANDARDS.md) - § 7 Observability (PII redaction)
- [Resend Documentation](https://resend.com/docs/send-with-nodejs)
- [Notifications TDD](../../features/notifications/ttd-dphase-1.md)

**Reference**:
- [Testing Strategy](../../infrastructure/Testing.md)
- [Environment Management](../../infrastructure/EnvironmentManagement.md)

**Code Examples**:
- Observability package: `packages/observability/src/client.ts`

---

## Notes for LLM Developer

1. **Provider-Agnostic Design**: EmailProvider interface allows switching from Resend to SendGrid/Postmark/etc. without changing NotificationService
2. **Pure Template Functions**: Template generators are pure functions (no dependencies) for easy unit testing
3. **PII Redaction**: ALWAYS use `obs.redactEmail()` when logging email addresses
4. **HTML Escaping**: Ensure user data is escaped in HTML templates to prevent XSS (use template engine or manual escaping)
5. **Email Verification in Resend**: FROM_EMAIL must be verified in Resend dashboard before sending
6. **Test Mode**: Resend has test mode for CI - use test API key
7. **Transactional Emails Only**: This service is for transactional emails (receipts, verification), not marketing

**Common Pitfalls**:
- Don't log raw email addresses (use PII redaction)
- Don't forget text version of emails (required for accessibility)
- Test email rendering in multiple clients (Gmail, Outlook, etc.)
- Handle Resend API errors gracefully

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or Resend documentation.

---

**Last Updated**: 2025-11-05
