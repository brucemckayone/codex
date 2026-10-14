# @codex/organization

Organization CRUD, membership management, follower relationships, and public profile queries.

## Key Exports

```typescript
import { OrganizationService } from '@codex/organization';
import {
  OrganizationNotFoundError, ConflictError, MemberNotFoundError,
  OwnershipTransferRequiredError, OwnershipOfferNotOpenError,
  IneligibleOwnershipRecipientError, NotOrganisationOwnerError,
} from '@codex/organization';
```

## `OrganizationService`

### Constructor

```typescript
const service = new OrganizationService({
  db, environment, r2PublicUrlBase,
  ownershipMailer, webAppUrl, waitUntil, // ownership emails; all optional
});
```

`r2PublicUrlBase` (the `R2_PUBLIC_URL_BASE` binding) is the ONLY host accepted
for `logoUrl` on `create`/`update` — an external image URL is rejected with
`ValidationError` (Codex-8so68). `websiteUrl` is unaffected. Omit the base and
the gate fails closed: no logo can be set at all.

### Core CRUD

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateOrganizationInput, userId: string)` | Transaction. Auto-creates `owner` membership AND the creator's ownership period (`source='created'`) for `userId`. Throws `ConflictError` on slug collision. |
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
| `getMyMembership` | `(organizationId: string, userId: string)` | Returns `{ role, joinedAt, pendingOwnershipOffer }` (nulls if not a member). |
| `getUserOrganizations` | `(userId: string)` | All orgs where user has active membership, sorted by name. |
| `inviteMember` | `(organizationId: string, input: { email, role }, invitedBy: string)` | Transaction. Looks up user by email. Throws `ConflictError` if already a member. |
| `updateMemberRole` | `(organizationId: string, userId: string, role: string)` | Transaction. Never touches the owner, never makes an owner (`OwnershipTransferRequiredError`, 409). A recipient of an open ownership offer who leaves admin/creator has it withdrawn in the same transaction. |
| `removeMember` | `(organizationId: string, userId: string)` | Sets status: `inactive`. Cannot remove the owner (`OwnershipTransferRequiredError`). Withdraws an open offer to the removed user. |

### Ownership (Codex-2hxff.2)

One owner per organisation — the DB enforces it (`uq_org_memberships_one_active_owner`). Data side: `src/services/ownership-transfer.ts`. Spec: `docs/payments/connect-and-payouts.md → Organisation ownership`.

| Method | Signature | Notes |
|---|---|---|
| `getOwnership` | `(organizationId, viewerId)` | Owner/admin/creator only. Owner-only fields omitted for others; the open offer shown to the owner and its recipient. |
| `offerOwnership` | `(organizationId, ownerUserId, { recipientUserId, confirmName })` | Owner only. Recipient: active admin/creator. `confirmName` matches the org name (trimmed, case-insensitive). One open offer; 7 days. Emails the recipient. |
| `withdrawOwnershipOffer` | `(organizationId, offerId, ownerUserId)` | Owner only. No email. |
| `acceptOwnershipOffer` | `(organizationId, offerId, recipientUserId)` | Demote then promote, close/open the period at one instant. Caller must bust BOTH users' membership caches. Emails owner + admins. |
| `declineOwnershipOffer` | `(organizationId, offerId, recipientUserId)` | Emails the owner. |
| `reassignOwner` | `(organizationId, newOwnerUserId)` | Platform support (admin-api). Withdraws an open offer (`support_reassigned`). |

- **MUST** write the membership role change and the ownership period in ONE transaction — the period table is who gets PAID (`resolveOrganisationPayee` in `@codex/purchase`), the membership is who may ACT.
- **MUST** demote the old owner before promoting the new one — the one-owner index is checked per statement.
- Expiry is lazy: every entry point marks this org's open offers past `expires_at` as `expired` first.

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
| `OwnershipTransferRequiredError` (409) | Changing the owner's role, making anyone owner, or removing the owner via the members routes |
| `OwnershipOfferNotOpenError` (409) | Offer accepted, declined, withdrawn or expired |
| `IneligibleOwnershipRecipientError` (422) | Recipient is not an active admin/creator, or is the owner |
| `NotOrganisationOwnerError` (403) | A non-owner offers or withdraws |
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
