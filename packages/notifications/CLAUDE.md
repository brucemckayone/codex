# @codex/notifications

Email template management and sending via Resend. 3-tier template resolution (Creator > Org > Global), notification preferences, unsubscribe token handling, and audit logging.

## Key Exports

```typescript
import {
  NotificationsService,
  TemplateService,
  NotificationPreferencesService,
  BrandingCache,
} from '@codex/notifications';
import { createEmailProvider, ResendProvider, ConsoleProvider, InMemoryEmailProvider, MailHogHttpProvider } from '@codex/notifications';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '@codex/notifications';
import { renderTemplate } from '@codex/notifications';
import { TemplateRepository } from '@codex/notifications';
```

## `NotificationsService`

### Constructor

```typescript
const service = new NotificationsService({
  db,
  environment,
  emailProvider,  // EmailProvider instance
  from: { email, name? },
  defaults?: { platformName, primaryColor, secondaryColor, supportEmail },
  brandTokenResolver?,  // Optional: resolves org branding tokens
});
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `sendEmail` | `(params: SendEmailParams)` | Resolves template (Creator → Org → Global), checks notification preferences if `userId`+`category` provided, injects branding tokens, renders, sends. Logs to `emailAuditLogs`. Retries up to `DEFAULT_RETRY_CONFIG.maxRetries` (2). |
| `previewTemplate` | `(templateName: string, data: TemplateData, organizationId?, creatorId?)` | Renders template without sending. Returns rendered HTML/text. |

### `sendEmail` Params

```typescript
{
  to: string;
  toName?: string;
  templateName: string;
  data: TemplateData;         // { [key: string]: TemplateDataValue }
  organizationId?: string | null;
  creatorId?: string | null;
  locale?: string;
  replyTo?: string;
  category?: EmailCategory;  // For preference checking
  userId?: string;           // Required for preference opt-out checking
}
```

## `TemplateService`

Manages template CRUD across 3 scopes. Access control is enforced inside service methods (org membership check).

### Constructor

```typescript
const service = new TemplateService({ db, environment });
```

### Methods

| Method | Scope | Notes |
|---|---|---|
| `getTemplateById` | Any | Direct lookup by ID, no scope check |
| `listGlobalTemplates` | Global | No auth required |
| `createGlobalTemplate` | Global | `CreateGlobalTemplateInput` |
| `getGlobalTemplate` | Global | |
| `updateGlobalTemplate` | Global | Transaction |
| `deleteGlobalTemplate` | Global | Soft delete |
| `listOrgTemplates` | Org | Scoped to `organizationId` |
| `createOrgTemplate` | Org | Validates org membership |
| `updateOrgTemplate` | Org | Transaction. Validates membership + role |
| `deleteOrgTemplate` | Org | Validates membership |
| `listCreatorTemplates` | Creator | Scoped to `creatorId` |
| `createCreatorTemplate` | Creator | `CreateCreatorTemplateInput` |
| `updateCreatorTemplate` | Creator | Transaction |
| `deleteCreatorTemplate` | Creator | |
| `previewTemplateById` | Any | Renders by ID |
| `checkTemplateAccess` | Any | Returns access metadata for a template |

## `NotificationPreferencesService`

Simple CRUD for `notificationPreferences` table.

| Method | Signature | Notes |
|---|---|---|
| `getPreferences` | `(userId: string)` | Creates defaults on first access (upsert). |
| `updatePreferences` | `(userId: string, input: UpdateNotificationPreferencesInput)` | Updates `emailMarketing`, `emailTransactional`, `emailDigest`. |

## Template Resolution Order

When `sendEmail()` resolves which template to use:
1. Creator-level template (if `creatorId` provided + template exists)
2. Org-level template (if `organizationId` provided + template exists)
3. Global template (platform fallback)

First match wins.

## Email Providers

| Provider | When to use |
|---|---|
| `ResendProvider` | Production |
| `ConsoleProvider` | Development (logs to console) |
| `MailHogHttpProvider` | Local dev with MailHog SMTP capture |
| `InMemoryEmailProvider` | Tests (captures emails for assertion) |

Use `createEmailProvider(config: ProviderConfig)` factory to create the appropriate provider.

## Branding Injection

`sendEmail()` automatically injects org branding tokens (`{{logoUrl}}`, `{{primaryColor}}`, etc.) fetched via `BrandingCache` (5min in-memory TTL). The `brandTokenResolver` config option is used to fetch org branding from DB/KV.

## Unsubscribe Tokens

```typescript
const token = await generateUnsubscribeToken(userId, email, secret);
const payload = await verifyUnsubscribeToken(token, secret); // { userId, email }
```

JWT-based. Used to generate one-click unsubscribe links in email footers.

## Custom Errors

| Error | When |
|---|---|
| `TemplateNotFoundError` | Template doesn't exist or soft-deleted |
| `TemplateAccessDeniedError` | User doesn't have permission to manage template |
| `TemplateConflictError` | Template name conflict at same scope |

## Rules

- **MUST** use template resolution (Creator > Org > Global) — NEVER hardcode email content
- **MUST** log all sent emails to `emailAuditLogs` table — required for compliance (handled inside `sendEmail()`)
- **MUST** use the appropriate provider — NEVER send real emails in dev/test (`ConsoleProvider` or `InMemoryEmailProvider`)
- **NEVER** include raw user passwords or tokens in template data

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/platform-settings`, `@codex/constants`
- **Used by**: notifications-api worker (port 42075)

## Reference Files

- `packages/notifications/src/services/notifications-service.ts`
- `packages/notifications/src/services/template-service.ts`
- `packages/notifications/src/services/notification-preferences-service.ts`
- `packages/notifications/src/templates/renderer.ts` — `renderTemplate()`
- `packages/notifications/src/unsubscribe.ts` — token generation/verification
