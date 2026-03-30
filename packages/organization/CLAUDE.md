# @codex/organization

Organization CRUD, slug management, and membership.

## API

### `OrganizationService`
| Method | Purpose | Notes |
|---|---|---|
| `create(input, creatorId)` | Create org | Validates slug against reserved subdomains |
| `get(id, creatorId)` | Get by ID | Scoped by creatorId |
| `getBySlug(slug)` | Get by slug | Used for subdomain resolution |
| `update(id, input, creatorId)` | Partial update | Validates slug if changed |
| `delete(id, creatorId)` | Soft delete | Sets `deletedAt` |
| `list(creatorId, filters)` | Paginated list | Creator's orgs only |
| `isSlugAvailable(slug)` | Check uniqueness | Also checks reserved subdomains |

## Slug Validation

Org slugs become subdomains (e.g., `my-org.lvh.me` in dev, `my-org.revelations.studio` in prod).

**Rules**:
- Lowercase alphanumeric + hyphens only
- Cannot start/end with hyphen
- Checked against `RESERVED_SUBDOMAINS_SET` from `@codex/constants` (includes `api`, `cdn`, `admin`, `www`, `platform`, `creators`, etc.)
- Must be unique across all orgs (checked at service level + DB unique constraint)
- Validation schema: `organizationSlugSchema` in `@codex/validation`

## Membership

Organizations have members via `organizationMemberships` table:
- Each membership links a user to an org with a role
- Roles determine access to studio, settings, billing, etc.
- The org creator is automatically the first member

## Data Model

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | string | Display name |
| `slug` | string | Unique, used as subdomain |
| `creatorId` | UUID | FK to users, owner |
| `description` | string? | Optional |
| `deletedAt` | timestamp? | Soft delete |

## Strict Rules

- **MUST** scope all queries with `scopedNotDeleted(organizations, creatorId)` or equivalent
- **MUST** validate slugs against `RESERVED_SUBDOMAINS_SET` before creating/updating
- **MUST** soft delete only — NEVER hard-delete organizations
- **MUST** check slug uniqueness at both service level AND rely on DB unique constraint as safety net
- **NEVER** allow reserved subdomains as org slugs — they conflict with platform infrastructure

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`
- **Used by**: organization-api worker

## Reference Files

- `packages/organization/src/services/organization-service.ts` — OrganizationService
- `packages/organization/src/services/__tests__/organization-service.test.ts` — reference tests
