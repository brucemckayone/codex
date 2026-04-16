# @codex/organization

Organization CRUD, membership management, follower relationships, and public profile queries.

## Key Exports

```typescript
import { OrganizationService } from '@codex/organization';
import { OrganizationNotFoundError, ConflictError, LastOwnerError, MemberNotFoundError } from '@codex/organization';
```

## `OrganizationService`

### Constructor

```typescript
const service = new OrganizationService({ db, environment });
```

### Core CRUD

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateOrganizationInput, userId: string)` | Transaction. Auto-creates `owner` membership for `userId`. Throws `ConflictError` on slug collision. |
| `get` | `(id: string)` | Returns `Organization \| null`. Not scoped by user — caller must check ownership. |
| `getBySlug` | `(slug: string)` | Used for subdomain resolution. Normalizes to lowercase. |
| `update` | `(id: string, input: UpdateOrganizationInput)` | Transaction. Throws `ConflictError` on slug collision. Caller must verify ownership. |
| `delete` | `(id: string)` | Soft delete via `deletedAt`. Caller must verify ownership. |
| `list` | `(filters: OrganizationFilters, pagination?)` | Paginated. Supports search (name/description) + sort. NOT scoped by user — caller applies membership filter. |
| `isSlugAvailable` | `(slug: string)` | Checks `RESERVED_SUBDOMAINS_SET` + DB uniqueness. |

### Membership Management

| Method | Signature | Notes |
|---|---|---|
| `listMembers` | `(organizationId: string, query)` | Paginated. Filters: role, status. Returns name/email/avatarUrl/role/status/joinedAt. |
| `getMyMembership` | `(organizationId: string, userId: string)` | Returns `{ role, joinedAt }` or nulls if not a member. Never throws. |
| `getUserOrganizations` | `(userId: string)` | All orgs where user has active membership, sorted by name. |
| `inviteMember` | `(organizationId: string, input: { email, role }, invitedBy: string)` | Transaction. Looks up user by email. Throws `ConflictError` if already a member. |
| `updateMemberRole` | `(organizationId: string, userId: string, role: string)` | Transaction. Cannot demote last owner (`LastOwnerError`). |
| `removeMember` | `(organizationId: string, userId: string)` | Sets status: `inactive`. Cannot remove last owner. |

### Public Profile Queries

| Method | Signature | Notes |
|---|---|---|
| `getPublicMembers` | `(slug: string, query?)` | Public-safe: name/avatarUrl/role/joinedAt only. No emails. |
| `getPublicCreators` | `(slug: string, pagination?)` | Active creators (owner/admin/creator roles) with content counts, recent content (up to 4), and other org memberships. |
| `getPublicStats` | `(slug: string)` | Aggregate stats: content counts by type, total duration, creator count, total views, categories. |

### Follower Operations

| Method | Signature | Notes |
|---|---|---|
| `followOrganization` | `(orgId: string, userId: string)` | Idempotent — `onConflictDoNothing`. |
| `unfollowOrganization` | `(orgId: string, userId: string)` | Idempotent — silently no-ops if not following. |
| `isFollowing` | `(orgId: string, userId: string)` | Returns boolean. |
| `getFollowerCount` | `(orgId: string)` | Returns count. Public. |

## Slug Rules

- Org slugs become subdomains (e.g., `my-org.revelations.studio`)
- Checked against `RESERVED_SUBDOMAINS_SET` from `@codex/constants` (includes `api`, `cdn`, `admin`, `www`, `platform`, etc.)
- DB unique constraint is the safety net; service validates first

## Custom Errors

| Error | When |
|---|---|
| `OrganizationNotFoundError` | Org doesn't exist or soft-deleted |
| `ConflictError` | Slug already taken |
| `LastOwnerError` | Demoting/removing last org owner |
| `MemberNotFoundError` | Target user not in org |

## Rules

- **MUST** validate slugs against `RESERVED_SUBDOMAINS_SET` before creating/updating
- **MUST** soft delete only — NEVER hard-delete organizations
- **NEVER** allow reserved subdomains as org slugs
- `get()` and `update()` are NOT user-scoped — route handlers must enforce ownership via `getMyMembership()`
- `getPublicCreators()` returns `avatarUrl ?? image` (handles both R2 and legacy image URLs)

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/constants`, `@codex/shared-types`
- **Used by**: organization-api worker

## Reference Files

- `packages/organization/src/services/organization-service.ts`
- `packages/organization/src/services/__tests__/organization-service.test.ts` — reference tests
