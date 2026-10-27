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
| `get` | `(id: string)` | Returns `ReadableOrganization \| null`: every column but the payee's `primaryConnectAccountUserId` (Codex-kk6zx). Not scoped by user — caller must check ownership. |
| `getBySlug` | `(slug: string)` | Used for subdomain resolution. Normalizes to lowercase. Returns `ReadableOrganization \| null`, as `get` does. |
| `update` | `(id: string, input: UpdateOrganizationInput)` | Transaction. Throws `ConflictError` on slug collision. Caller must verify ownership. `create` and `update` return the WHOLE row, payee id included: `create` answers the org's new owner, and `update`'s route requires org management, so only the org's own owner or admin reads it. |
| `delete` | `(id: string)` | Soft delete via `deletedAt`. Caller must verify ownership. |
| `list` | `(filters: OrganizationFilters, pagination?)` | Paginated `ReadableOrganization`s. Supports search (name/description) + sort. NOT scoped by user — caller applies membership filter. |
| `isSlugAvailable` | `(slug: string)` | Checks `RESERVED_SUBDOMAINS_SET` + DB uniqueness. |

### Membership Management

| Method | Signature | Notes |
|---|---|---|
| `listMembers` | `(organizationId: string, query)` | Paginated. Filters: role, status. Returns name/email/avatarUrl/role/status/joinedAt. |
| `getMyMembership` | `(organizationId: string, userId: string)` | Returns `{ role, joinedAt, pendingOwnershipOffer }` (nulls if not a member). |
| `getUserOrganizations` | `(userId: string)` | All orgs where user has active membership, sorted by name. |
| `inviteMember` | `(organizationId: string, input: { email, role }, invitedBy: string)` | Transaction. Looks up the live user by email under `FOR KEY SHARE`, so an invite racing an account deletion either waits and finds no user, or commits first and the deletion ends it. Throws `ConflictError` if already a member. |
| `updateMemberRole` | `(organizationId: string, userId: string, role: string)` | Transaction. Never touches the owner, never makes an owner (`OwnershipTransferRequiredError`, 409). The owner guard is also on the write, so a member made owner while it waited is refused. A recipient of an open ownership offer who leaves admin/creator has it withdrawn in the same transaction (lock, then write: below). |
| `removeMember` | `(organizationId: string, userId: string)` | Sets status: `inactive`. Cannot remove the owner (`OwnershipTransferRequiredError`), guarded on the write too. Withdraws the removed user's open proposals and an open offer to them (lock, then write: below). |

`create` also reads its creator under `FOR KEY SHARE`, so an org created while that account is being deleted never gets a deleted owner.

**Lock order (Codex-kk9nv.8).** A member's rows are locked as: a proposal, then an ownership offer, then the membership, then the organisation's agreement-share lock (`pg_advisory_xact_lock` on `agreement-shares:<org>:<revenueType>`, taken by propose, counter and accept, Codex-2hxff.19), then the creator's agreements. A row inserted naming a user takes a KEY SHARE on that user's row through its foreign key. Two transactions that take the same rows in different orders wait on each other until Postgres aborts one (40P01, a 500). Keep any new path in this order. These follow it: accept, counter and terminate of agreements; accept, decline, withdraw and reassign of offers; `removeMember`; `updateMemberRole`; and identity's `deleteAccount`.
- **Lock, then write.** A path that changes a membership locks what it will withdraw first, changes the membership, then withdraws by fresh reads:
  - `removeMember` locks the member's proposals (`lockProposalsOnDeparture`) and their offer (`lockOfferToRecipient`);
  - `updateMemberRole` locks only the offer, and only when the new role leaves admin/creator;
  - identity's `deleteAccount` locks every row it writes first, memberships included, with its own lock on offers across every org.

  The reason is that `createOwnershipOffer` holds the recipient's membership while it inserts its new offer, and `proposeAgreement` holds it while it inserts a proposal. Something committed while the membership change waited is withdrawn too. Locking rather than updating the offer early also keeps that insert from waiting on the unique index.
- **Several rows of one table in id order** (`.orderBy(table.id)` before `.for('update')`). Two paths that lock some of the same rows through different indexes would otherwise take them in different orders.
- **Guard the write, not only the read.** An UPDATE that waited on a row re-checks only its own WHERE. So a write that must never touch the owner carries the owner condition itself (`notTheActiveOwner`). A missing row means the member was made owner meanwhile, by an accept or a support reassign.
- **Known exception:** a fresh write after a wait can lock a row that the transaction it waited on has just committed, while an accept of that new row holds it. That window is milliseconds, and Postgres resolves it with a 40P01.
- **The subscription webhook keeps the order too** (Codex-kk9nv.20): `ensureSubscriptionDataPresent` upserts the membership before inserting the subscription and follower rows that name the user, so it waits on a deletion's membership lock without holding a KEY SHARE on the user. `subscription-drift.integration.test.ts` pins it with this file's harness.

### Ownership (Codex-2hxff.2)

One owner per organisation — the DB enforces it (`uq_org_memberships_one_active_owner`). Data side: `src/services/ownership-transfer.ts`. Spec: `docs/payments/connect-and-payouts.md → Organisation ownership`.

| Method | Signature | Notes |
|---|---|---|
| `getOwnership` | `(organizationId, viewerId)` | Owner/admin/creator only. Owner-only fields omitted for others; the open offer shown to the owner and its recipient. |
| `offerOwnership` | `(organizationId, ownerUserId, { recipientUserId, confirmName })` | Owner only. Recipient: active admin/creator. `confirmName` matches the org name (trimmed, case-insensitive). One open offer; 7 days. Emails the recipient. |
| `withdrawOwnershipOffer` | `(organizationId, offerId, ownerUserId)` | Owner only. No email. Locks the offer before the owner's membership (lock order, above). |
| `acceptOwnershipOffer` | `(organizationId, offerId, recipientUserId)` | Demote then promote, close/open the period at one instant. Caller must bust BOTH users' membership caches. Emails owner + admins. |
| `declineOwnershipOffer` | `(organizationId, offerId, recipientUserId)` | Emails the owner. |
| `reassignOwner` | `(organizationId, newOwnerUserId)` | Platform support (admin-api). Locks the open offer before any membership, then withdraws every open offer (`support_reassigned`), re-read so one created while it waited is closed too. |

- **MUST** write the membership role change and the ownership period in ONE transaction — the period table is who gets PAID (`resolveOrganisationPayee` in `@codex/purchase`), the membership is who may ACT.
- **MUST** demote the old owner before promoting the new one — the one-owner index is checked per statement.
- Expiry is lazy: every entry point marks this org's open offers past `expires_at` as `expired` first.

### Public Profile Queries

| Method | Signature | Notes |
|---|---|---|
| `getPublicMembers` | `(slug: string, query?)` | Public-safe: name/avatarUrl/role/joinedAt only. No emails. |
| `getPublicCreators` | `(slug: string, query?: { page, limit, search? })` | Active creators (owner/admin/creator roles) with content counts, recent content (up to 4), and other org memberships. A course-only practice is neither counted nor listed (Codex-ot6vj). `search` keeps only the creators whose name or username contains it, case-insensitively, and the total counts only those (the search palette's, Codex-pd8m1). |
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
