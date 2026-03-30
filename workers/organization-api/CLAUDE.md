# Organization-API Worker (port 42071)

Organization CRUD, membership management, and platform settings (branding, contact, features).

## Endpoints

### Organizations
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/api/organizations` | `auth: 'required'` | body: `createOrganizationSchema` | 201 | `{ data: Org }` |
| GET | `/api/organizations/:id` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: Org }` |
| GET | `/api/organizations/slug/:slug` | `auth: 'optional'` | params: `{ slug }` | 200 | `{ data: Org }` |
| GET | `/api/organizations/check-slug/:slug` | `auth: 'required'` | params: `{ slug }` | 200 | `{ data: { available } }` |
| PATCH | `/api/organizations/:id` | `auth: 'required'` | params + body: update schema | 200 | `{ data: Org }` |
| DELETE | `/api/organizations/:id` | `auth: 'required'` | params: `{ id: uuid }` | 204 | Empty |
| GET | `/api/organizations` | `auth: 'required'` | query: pagination | 200 | `{ items, pagination }` |

### Members
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/api/organizations/:id/members` | `auth: 'required', requireOrgMembership: true` | body: invite schema | 201 | `{ data: Member }` |
| GET | `/api/organizations/:id/members` | `auth: 'required', requireOrgMembership: true` | query: pagination | 200 | `{ items, pagination }` |

### Settings
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/organizations/:id/settings/branding` | `auth: 'required', requireOrgMembership: true` | params | 200 | `{ data: Branding }` |
| PUT | `/organizations/:id/settings/branding` | `auth: 'required', requireOrgMembership: true` | body: branding schema | 200 | `{ data: Branding }` |
| GET | `/organizations/:id/settings/contact` | `auth: 'required', requireOrgMembership: true` | params | 200 | `{ data: Contact }` |
| PUT | `/organizations/:id/settings/contact` | `auth: 'required', requireOrgMembership: true` | body: contact schema | 200 | `{ data: Contact }` |
| GET | `/organizations/:id/settings/features` | `auth: 'required', requireOrgMembership: true` | params | 200 | `{ data: Features }` |
| PUT | `/organizations/:id/settings/features` | `auth: 'required', requireOrgMembership: true` | body: features schema | 200 | `{ data: Features }` |

## Services Used

- `OrganizationService` (`@codex/organization`) — org CRUD, slug validation
- `PlatformSettingsFacade` (`@codex/platform-settings`) — branding, contact, features
- `ImageProcessingService` (`@codex/image-processing`) — logo uploads

## Key Patterns

- **Slug validation**: Checks against `RESERVED_SUBDOMAINS_SET` — slugs become subdomains
- **Settings endpoints**: Use `requireOrgMembership: true` — only org members can read/write settings
- **Logo upload**: Processed via `ImageProcessingService`, stored in R2

## Strict Rules

- **MUST** validate org slugs against reserved subdomains — they become live subdomains
- **MUST** require org membership for all settings endpoints
- **MUST** scope org queries by `creatorId`
- **NEVER** allow reserved subdomain names as org slugs

## Reference Files

- `workers/organization-api/src/routes/organizations.ts` — org CRUD
- `workers/organization-api/src/routes/members.ts` — membership
- `workers/organization-api/src/routes/settings.ts` — settings
