# @codex/notifications

Email template management and sending via Resend. 3-tier template resolution: Creator > Org > Global.

## API

### `NotificationsService`
| Method | Purpose | Notes |
|---|---|---|
| `sendEmail(params)` | Resolve template → render → send | Template resolution: Creator → Org → Global |
| `previewTemplate(name, data)` | Render template without sending | For template editor preview |

### `TemplateService` (CRUD)
| Method | Purpose |
|---|---|
| `create(input)` | Create template at any scope |
| `get(id)` | Get template by ID |
| `update(id, input)` | Update template content/metadata |
| `delete(id)` | Soft delete template |
| `list(scope, filters)` | List templates at scope level |

## Template Resolution Order

When sending an email, templates are resolved in priority order:
1. **Creator-level** — template specific to the content creator
2. **Org-level** — template specific to the organization
3. **Global** — platform-wide fallback

First match wins. This allows orgs/creators to customize emails while falling back to platform defaults.

## Providers
| Provider | Environment | Notes |
|---|---|---|
| **Resend** | Production | Real email delivery |
| **Console** | Development | Logs email to console |
| **InMemory** | Tests | Captures emails for assertions |

## Features

- **Branding injection**: Automatically injects `{{logoUrl}}`, `{{primaryColor}}` from platform settings
- **Token substitution**: `{{var}}` syntax, HTML-safe rendering
- **Audit logging**: All sent emails logged to `emailAuditLogs` table

## Strict Rules

- **MUST** use template resolution (Creator > Org > Global) — NEVER hardcode email content
- **MUST** log all sent emails to audit log — required for compliance
- **MUST** use the appropriate provider for the environment — NEVER send real emails in dev/test
- **NEVER** include raw user passwords or tokens in email templates
- **NEVER** skip branding injection — org emails must reflect org branding

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/platform-settings`
- **Used by**: notifications-api worker

## Reference Files

- `packages/notifications/src/services/notifications-service.ts` — NotificationsService
