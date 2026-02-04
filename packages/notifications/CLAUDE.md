# @codex/notifications

Email templates & sending (Resend). 3-Tier Scoping: Creator > Org > Global.

## API
### `NotificationsService`
- **sendEmail(params)**: Resolves template (Creator->Org->Global), renders, sends.
- **previewTemplate(name, data)**: Renders without sending.

### `TemplateService` (CRUD)
- Manage templates at Global, Org, or Creator scope.

## Providers
- **Resend**: Prod.
- **Console**: Dev.
- **InMemory**: Tests.

## Features
- **Branding**: Injects `{{logoUrl}}`, `{{primaryColor}}` from platform settings.
- **Tokens**: `{{var}}` substitution. HTML safe.
- **Audit**: Logs to `emailAuditLogs`.

## Usage
```ts
await service.sendEmail({
  templateName: 'welcome',
  to: 'u@ex.com',
  data: { name: 'User' },
  organizationId: 'org-1'
});
```

## Standards
- **Assert**: `invariant()` for preconditions/state.
- **Scope**: MANDATORY `where(eq(creatorId, ...))` or `orgId`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
