# Notifications-API Worker (port 42075)

Email template management and sending via Resend. Supports 3-tier template scoping.

## Endpoints

### Templates
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/templates/global` | `auth: 'required'` | query: pagination | 200 | `{ items, pagination }` |
| POST | `/templates/global` | `auth: 'required'` | body: template schema | 201 | `{ data: Template }` |
| GET | `/templates/organizations/:id` | `auth: 'required', requireOrgMembership: true` | params + query | 200 | `{ items, pagination }` |
| POST | `/templates/organizations/:id` | `auth: 'required', requireOrgMembership: true` | params + body | 201 | `{ data: Template }` |
| GET | `/templates/creator` | `auth: 'required'` | query: pagination | 200 | `{ items, pagination }` |
| POST | `/templates/creator` | `auth: 'required'` | body: template schema | 201 | `{ data: Template }` |
| POST | `/templates/:id/preview` | `auth: 'required'` | params + body: data | 200 | `{ data: { html } }` |
| POST | `/templates/:id/test-send` | `auth: 'required'` | params + body: recipient | 200 | `{ data: { sent } }` |

## Template Resolution

When sending email, templates resolve in priority order:
1. **Creator** scope — template owned by the content creator
2. **Organization** scope — template owned by the org
3. **Global** scope — platform-wide fallback

First match wins — allows customization while falling back to defaults.

## Providers

| Environment | Provider | Notes |
|---|---|---|
| Production | **Resend** | Real email delivery |
| Development | **Console** | Logs to terminal |
| Test | **InMemory** | Captures for assertions |

## Services Used

- `TemplateService` (`@codex/notifications`) — template CRUD
- `NotificationsService` (`@codex/notifications`) — template resolution and sending

## Strict Rules

- **MUST** use org membership check for org-scoped templates
- **MUST** resolve templates in priority order (Creator > Org > Global)
- **MUST** use appropriate provider per environment — NEVER send real emails in dev
- **NEVER** include sensitive data (passwords, tokens) in email templates

## Reference Files

- `workers/notifications-api/src/routes/templates.ts` — template routes
