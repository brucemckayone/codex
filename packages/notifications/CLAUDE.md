# @codex/notifications

Email notification service with database-backed templates, provider abstraction, and three-scope access control.

## Quick Start

```typescript
import { NotificationsService, createEmailProvider } from '@codex/notifications';
import { createDbClient } from '@codex/database';

const db = createDbClient(env);
const emailProvider = createEmailProvider({
  useMock: env.USE_MOCK_EMAIL === 'true',
  resendApiKey: env.RESEND_API_KEY,
});

const service = new NotificationsService({
  db,
  emailProvider,
  fromEmail: env.FROM_EMAIL,
  fromName: env.FROM_NAME,
  environment: env.ENVIRONMENT,
});

// Send email
const result = await service.sendEmail({
  templateName: 'email-verification',
  to: 'user@example.com',
  data: {
    userName: 'John',
    verificationUrl: 'https://example.com/verify?token=abc',
  },
  organizationId: 'org-123', // Optional - for org branding
});
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           NotificationsService              │
├──────────┬──────────────┬───────────────────┤
│ Template │   Branding   │   Email          │
│ Repo     │   Integration│   Provider       │
├──────────┼──────────────┼───────────────────┤
│ Database │ platform-    │ Resend/Console/  │
│          │ settings     │ MailHog          │
└──────────┴──────────────┴───────────────────┘
```

## Public API

### NotificationsService
```typescript
// Send email using template
sendEmail(input: SendEmailParams): Promise<SendResult>

// Preview template rendering
previewTemplate(name, data, orgId?, creatorId?): Promise<RenderedTemplate>
```

### Email Providers
```typescript
createEmailProvider(config: ProviderConfig): EmailProvider

// Providers
ResendProvider      // Production
ConsoleProvider     // Development
MailHogHttpProvider // Integration tests (stub only)
InMemoryEmailProvider // Unit tests with assertions
```

### Template Renderer
```typescript
renderTemplate(template, subject, html, text, data): RenderedTemplate
```

## Template Scopes

| Scope | Access | Resolution Priority |
|-------|--------|---------------------|
| Global | Platform owner | 3rd (fallback) |
| Organization | Org admins | 1st |
| Creator | Template owner | 2nd |

## Brand Tokens (Auto-Injected)

- `{{platformName}}` - Platform display name
- `{{logoUrl}}` - Platform logo URL
- `{{primaryColor}}` - Primary brand color
- `{{supportEmail}}` - Support email

## Error Classes

```typescript
TemplateNotFoundError    // 404 - Template missing
TemplateAccessDeniedError // 403 - No permission
TemplateConflictError     // 409 - Duplicate name
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| RESEND_API_KEY | Production | Resend API key |
| FROM_EMAIL | Yes | Sender email |
| FROM_NAME | No | Sender name |
| USE_MOCK_EMAIL | No | "true" for Console |

## Testing

```bash
pnpm test           # Run tests
pnpm test:watch     # Watch mode
```

### InMemoryEmailProvider for Tests
```typescript
const provider = new InMemoryEmailProvider();
await service.sendEmail({ ... });

expect(provider.count).toBe(1);
expect(provider.getLastEmail()?.message.to).toBe('user@example.com');
provider.clear();
```

## Dependencies

- `@codex/database` - Template storage
- `@codex/platform-settings` - Branding tokens
- `@codex/validation` - Input schemas
- `@codex/service-errors` - Base service class
