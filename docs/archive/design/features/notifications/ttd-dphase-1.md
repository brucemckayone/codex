# Notifications - Phase 1 TDD (Technical Design Document)

## Phase 1 Architecture Notes

> **Organization-Level Isolation**: In Phase 1, email templates are organization-scoped, allowing each organization to customize their notification templates. The notification service accepts an `organizationId` parameter to load the appropriate templates. System-wide default templates are stored with a null `organization_id` and serve as fallbacks.

## System Overview

The notification system provides email delivery with provider abstraction, ensuring business logic is decoupled from email service providers. Phase 1 implements Resend as the default provider but maintains flexibility for future provider changes.

**Architecture**: Three-layer design:

1. **Service Layer**: Provider-agnostic interface used by features
2. **Adapter Layer**: Provider-specific implementations (Resend, SendGrid, etc.)
3. **Template Layer**: Email templates with data interpolation

**Architecture Diagram**:

```d2
@import "design/features/notifications/d2-diagrams/notification-architecture.d2"
```

The diagram demonstrates the three-layer architecture: provider-agnostic service interface, email provider adapters (Resend), and template-based email rendering.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#7-notifications) document for details on how other features depend on Notifications. As a foundational service, it has no feature dependencies itself.

### Environment Configuration

- `RESEND_API_KEY`: Resend API key (dev and prod)
- `EMAIL_FROM_ADDRESS`: Sender email address (e.g., `noreply@yourdomain.com`)
- `EMAIL_FROM_NAME`: Sender display name (e.g., `Codex Platform`)

---

## Component List

### 1. Notification Service Interface (`packages/web/src/lib/server/notifications/service.ts`)

**Responsibility**: Provider-agnostic interface for sending emails

**Interface Definition**:

```typescript
/**
 * Email payload (provider-agnostic)
 */
export interface EmailPayload {
  /** Template identifier (e.g., 'email-verification', 'password-reset') */
  template: string;

  /** Recipient email address */
  recipient: string;

  /** Organization ID for template scoping (null for system-wide templates) */
  organizationId: string | null;

  /** Template data for interpolation */
  data: Record<string, any>;

  /** Optional: Reply-to address */
  replyTo?: string;
}

/**
 * Email send result
 */
export interface EmailResult {
  /** Whether email was sent successfully */
  success: boolean;

  /** Provider's email ID (for tracking) */
  emailId?: string;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Notification Service Interface
 * All features use this interface (never call adapters directly)
 */
export interface INotificationService {
  /**
   * Send an email using a template
   * @throws Error if template not found or sending fails after retry
   */
  sendEmail(payload: EmailPayload): Promise<EmailResult>;
}
```

**Implementation**:

```typescript
import { loadTemplate, renderTemplate } from './templates';
import { emailAdapter } from './adapters';
import { logger } from '$lib/server/logger';

export class NotificationService implements INotificationService {
  async sendEmail(payload: EmailPayload): Promise<EmailResult> {
    const { template, recipient, organizationId, data, replyTo } = payload;

    try {
      // 1. Load and render template (with organization scoping)
      const templateContent = await loadTemplate(template, organizationId);
      const { subject, html, text } = await renderTemplate(
        templateContent,
        data
      );

      // 2. Send via adapter (with retry)
      const result = await this.sendWithRetry({
        to: recipient,
        subject,
        html,
        text,
        replyTo,
      });

      // 3. Log success
      logger.info('Email sent successfully', {
        template,
        recipient: this.maskEmail(recipient),
        emailId: result.emailId,
      });

      return result;
    } catch (error) {
      // Log error with context
      logger.error('Email send failed', {
        template,
        recipient: this.maskEmail(recipient),
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send email with one retry on failure
   */
  private async sendWithRetry(payload: any): Promise<EmailResult> {
    try {
      return await emailAdapter.send(payload);
    } catch (error) {
      logger.warn('Email send failed, retrying...', { error: error.message });

      // Retry once
      try {
        return await emailAdapter.send(payload);
      } catch (retryError) {
        throw new Error(`Email send failed after retry: ${retryError.message}`);
      }
    }
  }

  /**
   * Mask email for logging (GDPR)
   * Example: user@example.com � u***@example.com
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }
}

// Singleton instance
export const notificationService = new NotificationService();
```

---

### 2. Email Adapter Interface (`packages/web/src/lib/server/notifications/adapters/interface.ts`)

**Responsibility**: Define contract for email provider adapters

**Interface Definition**:

```typescript
/**
 * Raw email payload (provider-agnostic)
 */
export interface RawEmailPayload {
  /** Recipient email */
  to: string;

  /** Email subject */
  subject: string;

  /** HTML body */
  html: string;

  /** Plain text body (fallback) */
  text: string;

  /** Optional: Reply-to address */
  replyTo?: string;
}

/**
 * Email Adapter Interface
 * Each provider (Resend, SendGrid, etc.) implements this interface
 */
export interface IEmailAdapter {
  /**
   * Send an email via the provider
   * @throws Error if sending fails
   */
  send(payload: RawEmailPayload): Promise<EmailResult>;

  /**
   * Verify adapter configuration (API key, domain, etc.)
   * @returns true if configuration is valid
   */
  verify(): Promise<boolean>;
}
```

---

### 3. Resend Adapter (`packages/web/src/lib/server/notifications/adapters/resend.ts`)

**Responsibility**: Implement Resend-specific email sending

**Implementation**:

```typescript
import { Resend } from 'resend';
import type { IEmailAdapter, RawEmailPayload } from './interface';
import type { EmailResult } from '../service';

export class ResendAdapter implements IEmailAdapter {
  private client: Resend;
  private fromAddress: string;
  private fromName: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }

    this.client = new Resend(apiKey);
    this.fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Codex Platform';
  }

  async send(payload: RawEmailPayload): Promise<EmailResult> {
    try {
      const result = await this.client.emails.send({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      });

      return {
        success: true,
        emailId: result.data?.id,
      };
    } catch (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }
  }

  async verify(): Promise<boolean> {
    try {
      // Send a test request to verify API key
      // (Resend doesn't have a dedicated verify endpoint)
      // We can check if we can list domains as a proxy
      await this.client.domains.list();
      return true;
    } catch (error) {
      return false;
    }
  }
}
```

---

### 4. Adapter Factory (`packages/web/src/lib/server/notifications/adapters/index.ts`)

**Responsibility**: Select and initialize the correct email adapter

**Implementation**:

```typescript
import type { IEmailAdapter } from './interface';
import { ResendAdapter } from './resend';
// Future adapters:
// import { SendGridAdapter } from './sendgrid';
// import { PostmarkAdapter } from './postmark';

/**
 * Email provider configuration
 * Change this to switch providers
 */
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'resend';

/**
 * Factory function to create email adapter
 */
function createEmailAdapter(): IEmailAdapter {
  switch (EMAIL_PROVIDER) {
    case 'resend':
      return new ResendAdapter();

    // Future providers:
    // case 'sendgrid':
    //   return new SendGridAdapter();
    // case 'postmark':
    //   return new PostmarkAdapter();

    default:
      throw new Error(`Unknown email provider: ${EMAIL_PROVIDER}`);
  }
}

// Singleton adapter instance
export const emailAdapter = createEmailAdapter();
```

**To Switch Providers**:

1. Implement new adapter (e.g., `sendgrid.ts`)
2. Add case to factory
3. Set `EMAIL_PROVIDER=sendgrid` in environment
4. Update API key environment variables

---

### 5. Template Loader (`packages/web/src/lib/server/notifications/templates/loader.ts`)

**Responsibility**: Load email templates from database (Cloudflare Workers compatible)

**Database Schema** (`email_templates` table):

```sql
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID,                         -- NULL for system-wide templates, FK to organizations for custom templates
  name VARCHAR(100) NOT NULL,                   -- e.g., 'email-verification', 'password-reset'
  subject TEXT NOT NULL,                        -- May contain {{variables}}
  html_body TEXT NOT NULL,                      -- HTML email body
  text_body TEXT NOT NULL,                      -- Plain text fallback
  description TEXT,                             -- Human-readable description
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: template name must be unique per organization (or system-wide)
  CONSTRAINT unique_template_per_org UNIQUE (organization_id, name),

  -- Foreign key to organizations table
  CONSTRAINT fk_organization FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE CASCADE
);

-- Index for fast lookups by organization and template name
CREATE INDEX idx_email_templates_org_name ON email_templates(organization_id, name);

-- Seed data for Phase 1 system-wide templates (organization_id = NULL)
INSERT INTO email_templates (organization_id, name, subject, html_body, text_body, description) VALUES
  (NULL, 'email-verification', 'Verify your email address for {{platformName}}', '...', '...', 'Sent after user registration'),
  (NULL, 'password-reset', 'Reset your password for {{platformName}}', '...', '...', 'Sent when user requests password reset'),
  (NULL, 'password-changed', 'Your password has been changed', '...', '...', 'Sent after successful password change'),
  (NULL, 'purchase-receipt', 'Receipt for your purchase (Order #{{orderNumber}})', '...', '...', 'Sent after successful purchase');
```

**Drizzle Schema** (`packages/web/src/lib/server/db/schema/notifications.ts`):

```typescript
import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  name: varchar('name', { length: 100 }).notNull(),
  subject: text('subject').notNull(),
  htmlBody: text('html_body').notNull(),
  textBody: text('text_body').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: template name must be unique per organization
  uniqueTemplatePerOrg: uniqueIndex('unique_template_per_org').on(
    table.organizationId,
    table.name
  ),
  // Index for fast lookups by organization and template name
  orgNameIdx: uniqueIndex('idx_email_templates_org_name').on(
    table.organizationId,
    table.name
  ),
}));
```

**Implementation**:

```typescript
import { db } from '$lib/server/db';
import { emailTemplates } from '$lib/server/db/schema/notifications';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Template content (metadata + body)
 */
export interface TemplateContent {
  /** Email subject (may contain {{variables}}) */
  subject: string;

  /** HTML body (may contain {{variables}}) */
  html: string;

  /** Plain text body (may contain {{variables}}) */
  text: string;
}

/**
 * Load template from database with organization scoping
 * Works in Cloudflare Workers (no filesystem access required)
 *
 * Fallback logic:
 * 1. Try to load organization-specific template (if organizationId provided)
 * 2. Fall back to system-wide template (organization_id IS NULL)
 */
export async function loadTemplate(
  templateName: string,
  organizationId: string | null
): Promise<TemplateContent> {
  let template;

  // 1. Try organization-specific template first (if organizationId provided)
  if (organizationId) {
    template = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.name, templateName),
        eq(emailTemplates.organizationId, organizationId)
      ),
    });
  }

  // 2. Fall back to system-wide template
  if (!template) {
    template = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.name, templateName),
        isNull(emailTemplates.organizationId)
      ),
    });
  }

  if (!template) {
    throw new Error(`Template not found: ${templateName}`);
  }

  return {
    subject: template.subject,
    html: template.htmlBody,
    text: template.textBody,
  };
}
```

**Benefits of Database Storage**:

- ✅ Works in Cloudflare Workers (no filesystem)
- ✅ Templates can be updated without redeploying code
- ✅ Organization-level customization (each org can have custom templates)
- ✅ Fallback to system-wide templates (graceful degradation)
- ✅ Can add admin UI to manage templates (Phase 2)
- ✅ Easy to version control via migrations
- ✅ Can cache templates in memory or KV for performance

---

### 6. Template Renderer (`packages/web/src/lib/server/notifications/templates/renderer.ts`)

**Responsibility**: Interpolate data into template

**Implementation**:

```typescript
import type { TemplateContent } from './loader';

/**
 * Render template by replacing {{variables}} with data
 * Simple string replacement for Phase 1
 * Future: Use proper template engine (Handlebars, Mustache, etc.)
 */
export async function renderTemplate(
  template: TemplateContent,
  data: Record<string, any>
): Promise<TemplateContent> {
  return {
    subject: interpolate(template.subject, data),
    html: interpolate(template.html, data),
    text: interpolate(template.text, data),
  };
}

/**
 * Replace {{key}} with data[key]
 * Escapes HTML in values (prevent XSS)
 */
function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key];
    if (value === undefined) {
      console.warn(`Template variable not provided: ${key}`);
      return match; // Keep {{key}} if data missing
    }
    return escapeHtml(String(value));
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
```

---

### 7. Email Template Seed Data (Database Storage)

**Storage**: Templates are stored in the `email_templates` database table (see Component #5) rather than filesystem. This ensures compatibility with Cloudflare Workers.

**Template Seeding** (`packages/web/src/lib/server/db/seeds/email-templates.ts`):

Templates are seeded during initial database setup. Each template includes:

- **name**: Unique identifier (e.g., `'email-verification'`)
- **subject**: Email subject line with variable placeholders
- **html_body**: Professional HTML email template
- **text_body**: Plain text fallback for email clients without HTML support

**Example Templates** (Phase 1):

1. **Email Verification** (`email-verification`)
   - Subject: `Verify your email address for {{platformName}}`
   - Use: After user registration
   - Variables: `userName`, `verificationUrl`, `platformName`, `year`

2. **Password Reset** (`password-reset`)
   - Subject: `Reset your password for {{platformName}}`
   - Use: When user requests password reset
   - Variables: `userName`, `resetUrl`, `platformName`, `year`

3. **Password Changed** (`password-changed`)
   - Subject: `Your password has been changed`
   - Use: After successful password change
   - Variables: `userName`, `changedAt`, `ipAddress`, `platformName`

4. **Purchase Receipt** (`purchase-receipt`)
   - Subject: `Receipt for your purchase (Order #{{orderNumber}})`
   - Use: After successful purchase
   - Variables: `customerName`, `orderNumber`, `items`, `totalAmount`, `receiptUrl`

**Template Management**:

- System-wide templates seeded via database migration or seed script (organization_id = NULL)
- Organization-specific templates can be created per organization
- Fallback logic ensures system templates are used when org-specific templates don't exist
- Can be updated directly in database (no code deployment required)
- Future: Admin UI for template editing (Phase 2)
- Future: Template caching in KV for performance (Phase 2)

---

### 8. Cloudflare Queue Integration (Async Email Sending)

**Responsibility**: Decouple email sending from HTTP request/response cycle

**Architecture**:

```
User Action (Auth, E-Commerce)
  → Queue Message to Cloudflare Queue
  → Return immediately (fast response)

Cloudflare Worker (Consumer)
  → Poll Queue for messages
  → Load template from DB
  → Render template
  → Send via Resend
  → Acknowledge message
```

**Benefits**:

- ✅ Fast HTTP responses (no waiting for email API)
- ✅ Automatic retries (Queue handles failures)
- ✅ Scales independently of web requests
- ✅ Resilient (Queue persists messages if Worker crashes)

**Queue Configuration** (`wrangler.jsonc`):

```toml
[[queues.producers]]
  queue = "email-notifications"
  binding = "EMAIL_QUEUE"

[[queues.consumers]]
  queue = "email-notifications"
  max_batch_size = 10
  max_batch_timeout = 30
  max_retries = 3
  dead_letter_queue = "email-notifications-dlq"
```

**Producer** (Push to Queue from Web App):

```typescript
// packages/web/src/lib/server/notifications/queue.ts
import type { EmailPayload } from './service';

/**
 * Enqueue email for async sending
 * Returns immediately (doesn't wait for email to send)
 */
export async function enqueueEmail(
  queue: Queue,
  payload: EmailPayload
): Promise<void> {
  await queue.send({
    type: 'send-email',
    payload,
  });
}
```

**Consumer** (Worker that processes queue):

```typescript
// workers/email-worker/src/index.ts
import { notificationService } from './notifications';

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { type, payload } = message.body;

        if (type === 'send-email') {
          await notificationService.sendEmail(payload);
          message.ack(); // Acknowledge success
        }
      } catch (error) {
        console.error('Email send failed:', error);
        message.retry(); // Retry (up to max_retries)
      }
    }
  },
};
```

**Usage from Auth** (enqueue instead of direct send):

```typescript
import { enqueueEmail } from '$lib/server/notifications/queue';

// Register user
const user = await createUser({ email, password, name });

// Enqueue verification email (non-blocking)
await enqueueEmail(event.platform.env.EMAIL_QUEUE, {
  template: 'email-verification',
  recipient: user.email,
  organizationId: user.organizationId, // Organization scoping
  data: { userName: user.name, verificationUrl: '...' },
});

// Return immediately (user doesn't wait for email)
return { success: true };
```

**Phase 1 Decision**:

- **Start Simple**: Phase 1 can use **synchronous email sending** (await notificationService.sendEmail)
- **Phase 2**: Add Queue for async sending (improved performance)
- Both approaches use the same `notificationService` interface (easy to migrate)

---

## Usage Examples

### Phase 1: Synchronous Email Sending

**From Auth Service** (wait for email to send):

```typescript
import { notificationService } from '$lib/server/notifications';
import { requireAuth } from '$lib/server/auth/guards';

// Get authenticated user context (includes organizationId)
const { user } = await requireAuth(event);

// Send email verification (blocks until sent)
await notificationService.sendEmail({
  template: 'email-verification',
  recipient: user.email,
  organizationId: user.organizationId, // Organization scoping
  data: {
    userName: user.name,
    verificationUrl: `${AUTH_URL}/verify-email?token=${token}`,
    platformName: 'Codex Platform',
    year: new Date().getFullYear(),
  },
});
```

### Phase 2: Async Email Sending (with Queue)

**From Auth Service** (enqueue and return immediately):

```typescript
import { notificationService } from '$lib/server/notifications';
import { requireAuth } from '$lib/server/auth/guards';

// Get authenticated user context (includes organizationId)
const { user } = await requireAuth(event);

// Send email verification
await notificationService.sendEmail({
  template: 'email-verification',
  recipient: user.email,
  organizationId: user.organizationId, // Organization scoping
  data: {
    userName: user.name,
    verificationUrl: `${AUTH_URL}/verify-email?token=${token}`,
    platformName: 'Codex Platform',
    year: new Date().getFullYear(),
  },
});

// Send password reset
await notificationService.sendEmail({
  template: 'password-reset',
  recipient: user.email,
  organizationId: user.organizationId, // Organization scoping
  data: {
    userName: user.name,
    resetUrl: `${AUTH_URL}/reset-password?token=${token}`,
    platformName: 'Codex Platform',
    year: new Date().getFullYear(),
  },
});
```

### From E-Commerce Service

```typescript
import { notificationService } from '$lib/server/notifications';
import { requireAuth } from '$lib/server/auth/guards';

// Get authenticated user context (includes organizationId)
const { user } = await requireAuth(event);

// Send purchase receipt
await notificationService.sendEmail({
  template: 'purchase-receipt',
  recipient: customer.email,
  organizationId: user.organizationId, // Organization scoping
  data: {
    customerName: customer.name,
    orderNumber: order.id,
    items: order.items
      .map((item) => `${item.name} - $${item.price}`)
      .join('\n'),
    totalAmount: order.total,
    receiptUrl: `${BASE_URL}/orders/${order.id}/receipt`,
    platformName: 'Codex Platform',
    year: new Date().getFullYear(),
  },
});
```

---

## Testing Strategy

### Unit Tests

**Test Notification Service** (`service.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from './service';
import type { IEmailAdapter } from './adapters/interface';

describe('NotificationService', () => {
  it('sends email successfully', async () => {
    const mockAdapter: IEmailAdapter = {
      send: vi.fn().mockResolvedValue({ success: true, emailId: '123' }),
      verify: vi.fn().mockResolvedValue(true),
    };

    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      organizationId: 'org-123', // Organization scoping
      data: {
        userName: 'Test User',
        verificationUrl: 'https://example.com/verify',
      },
    });

    expect(result.success).toBe(true);
    expect(mockAdapter.send).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: expect.any(String),
      html: expect.stringContaining('Test User'),
      text: expect.stringContaining('Test User'),
    });
  });

  it('retries on failure', async () => {
    const mockAdapter: IEmailAdapter = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error')) // First call fails
        .mockResolvedValueOnce({ success: true, emailId: '123' }), // Retry succeeds
      verify: vi.fn().mockResolvedValue(true),
    };

    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      organizationId: 'org-123', // Organization scoping
      data: {
        userName: 'Test User',
        verificationUrl: 'https://example.com/verify',
      },
    });

    expect(result.success).toBe(true);
    expect(mockAdapter.send).toHaveBeenCalledTimes(2); // Called twice (retry)
  });

  it('returns error if template not found', async () => {
    const mockAdapter: IEmailAdapter = {
      send: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
    };

    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'non-existent-template',
      recipient: 'test@example.com',
      organizationId: 'org-123', // Organization scoping
      data: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Template not found');
  });

  it('uses system-wide template when org-specific template not found', async () => {
    const mockAdapter: IEmailAdapter = {
      send: vi.fn().mockResolvedValue({ success: true, emailId: '123' }),
      verify: vi.fn().mockResolvedValue(true),
    };

    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      organizationId: null, // Falls back to system-wide template
      data: {
        userName: 'Test User',
        verificationUrl: 'https://example.com/verify',
      },
    });

    expect(result.success).toBe(true);
  });
});
```

**Test Resend Adapter** (`adapters/resend.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ResendAdapter } from './resend';

// Mock Resend SDK
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'email-123' } }),
    },
    domains: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  })),
}));

describe('ResendAdapter', () => {
  it('sends email via Resend API', async () => {
    const adapter = new ResendAdapter();

    const result = await adapter.send({
      to: 'test@example.com',
      subject: 'Test Email',
      html: '<p>Test</p>',
      text: 'Test',
    });

    expect(result.success).toBe(true);
    expect(result.emailId).toBe('email-123');
  });

  it('verifies API configuration', async () => {
    const adapter = new ResendAdapter();

    const isValid = await adapter.verify();

    expect(isValid).toBe(true);
  });
});
```

### Integration Tests

**Test End-to-End Email Flow** (`integration.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { notificationService } from './service';

describe('Notification Integration', () => {
  it('sends email verification end-to-end', async () => {
    const result = await notificationService.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com', // Use test email account
      organizationId: 'test-org-123', // Organization scoping
      data: {
        userName: 'Integration Test',
        verificationUrl: 'https://example.com/verify?token=test',
        platformName: 'Codex Platform',
        year: 2025,
      },
    });

    expect(result.success).toBe(true);
    expect(result.emailId).toBeDefined();

    // Optional: Check test email account to verify delivery
    // (requires test email API access, e.g., Mailinator, Mailtrap)
  });

  it('falls back to system template when org template not found', async () => {
    const result = await notificationService.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      organizationId: null, // Use system-wide template
      data: {
        userName: 'Integration Test',
        verificationUrl: 'https://example.com/verify?token=test',
        platformName: 'Codex Platform',
        year: 2025,
      },
    });

    expect(result.success).toBe(true);
    expect(result.emailId).toBeDefined();
  });
});
```

### E2E Tests

**Test Email Delivery in E2E Tests** (`auth.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';

test('user receives verification email', async ({ page }) => {
  // Register user
  await page.goto('/register');
  await page.fill('[name=email]', 'test@mailinator.com');
  await page.fill('[name=password]', 'Password123');
  await page.fill('[name=confirmPassword]', 'Password123');
  await page.fill('[name=name]', 'Test User');
  await page.click('button[type=submit]');

  // Check test email inbox (Mailinator API)
  const emails = await fetchMailinatorInbox('test');
  expect(emails).toHaveLength(1);
  expect(emails[0].subject).toContain('Verify your email');

  // Extract verification link from email
  const verificationLink = extractLinkFromEmail(
    emails[0].html,
    '/verify-email'
  );
  expect(verificationLink).toBeDefined();

  // Click verification link
  await page.goto(verificationLink);
  await expect(page).toHaveURL(/\/library/);
});
```

---

## Environment Configuration

### Development

```bash
# .env.dev
RESEND_API_KEY=re_dev_xxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM_ADDRESS=dev@example.com
EMAIL_FROM_NAME=Codex Dev
EMAIL_PROVIDER=resend
```

### Production

```bash
# .env.prod (managed via Cloudflare Pages environment variables)
RESEND_API_KEY=re_prod_xxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=Codex Platform
EMAIL_PROVIDER=resend
```

### Domain Verification (Resend)

1. Add domain in Resend dashboard
2. Add DNS records (SPF, DKIM) to your domain
3. Verify domain ownership
4. Use verified domain in `EMAIL_FROM_ADDRESS`

---

## Switching Email Providers

### Example: Switch to SendGrid

**1. Implement SendGrid Adapter** (`adapters/sendgrid.ts`):

```typescript
import sgMail from '@sendgrid/mail';
import type { IEmailAdapter, RawEmailPayload } from './interface';
import type { EmailResult } from '../service';

export class SendGridAdapter implements IEmailAdapter {
  constructor() {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY environment variable is required');
    }
    sgMail.setApiKey(apiKey);
  }

  async send(payload: RawEmailPayload): Promise<EmailResult> {
    try {
      const result = await sgMail.send({
        to: payload.to,
        from: {
          email: process.env.EMAIL_FROM_ADDRESS!,
          name: process.env.EMAIL_FROM_NAME || 'Codex Platform',
        },
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
      });

      return {
        success: true,
        emailId: result[0].headers['x-message-id'],
      };
    } catch (error) {
      throw new Error(`SendGrid API error: ${error.message}`);
    }
  }

  async verify(): Promise<boolean> {
    // SendGrid verify logic
    return true;
  }
}
```

**2. Update Adapter Factory** (`adapters/index.ts`):

```typescript
import { SendGridAdapter } from './sendgrid';

function createEmailAdapter(): IEmailAdapter {
  switch (EMAIL_PROVIDER) {
    case 'resend':
      return new ResendAdapter();
    case 'sendgrid':
      return new SendGridAdapter(); // Add this case
    default:
      throw new Error(`Unknown email provider: ${EMAIL_PROVIDER}`);
  }
}
```

**3. Update Environment Variables**:

```bash
# Remove Resend, add SendGrid
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
```

**Done!** No changes to Auth, E-Commerce, or any business logic.

---

## Performance & Scalability

### Phase 1 Performance Targets

- **Email send latency**: < 5 seconds (p95)
- **Template rendering**: < 50ms
- **Retry delay**: Immediate (no backoff in Phase 1)

### Future Optimizations (Phase 2+)

- **Email Queue**: Use Cloudflare Queue to send emails asynchronously
- **Batch Sending**: Support sending multiple emails in one API call
- **Template Caching**: Cache rendered templates in KV or memory to reduce database queries
- **Exponential Backoff**: Smarter retry logic

---

## Security Considerations

### Email Security

-  All emails sent over HTTPS (Resend API uses TLS)
-  SPF/DKIM records configured for domain (prevent spoofing)
-  HTML escaping in templates (prevent XSS)
-  Email masking in logs (GDPR compliance)

### API Key Management

-  API keys stored in environment variables (never in code)
-  Different API keys for dev and prod
-  Rotate API keys periodically

---

## Related Documents

- **PRD**: [Notifications Phase 1 PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth TDD](../auth/ttd-dphase-1.md) - Primary consumer
  - [E-Commerce TDD](../e-commerce/ttd-dphase-1.md) - Purchase receipts
- **Infrastructure**:
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)
  - [Environment Management](../../infrastructure/EnvironmentManagement.md)

---

**Document Version**: 1.1
**Last Updated**: 2025-11-06
**Status**: Updated - Phase 1 Architecture Alignment
