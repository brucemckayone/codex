# Organization-API Worker (port 42071)

Organization CRUD, membership management, subscription tiers, follower relationships, and platform settings (branding, contact, features). Also serves several public (no-auth) endpoints used by the org layout and storefront.

## Endpoints

### Organization Routes (`/api/organizations/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/organizations` | `required`, roles: creator/admin/platform_owner | body: `createOrganizationSchema` | 201 | Warms brand KV cache via `waitUntil` |
| GET | `/api/organizations/check-slug/:slug` | `required` | params: `slug` | 200 `{ available }` | Checks against reserved subdomains |
| GET | `/api/organizations/slug/:slug` | `required` | params: `slug` | 200 | Get org by slug, without the payee's `primaryConnectAccountUserId` (Codex-kk6zx) |
| GET | `/api/organizations/my-organizations` | `required` | — | 200 | User's orgs with their role |
| GET | `/api/organizations/public/:slug` | `none` | params: `slug` | 200 | Public branding fields only (legacy) |
| GET | `/api/organizations/public/:slug/info` | `none` | params: `slug` | 200 | Full public org identity + branding; KV-cached 4h |
| GET | `/api/organizations/public/:slug/stats` | `none` | params: `slug` | 200 | Content counts, duration, creator count, views; KV-cached |
| GET | `/api/organizations/public/:slug/creators` | `none` | params + query: page/limit/search | 200 | Paginated public creator profiles; KV-cached, except a `search` (matched on name or username), which reads the DB as the content search does (Codex-pd8m1) |
| GET | `/api/organizations/public/:slug/members` | `none` | params + query: page/limit/role | 200 | Paginated public member profiles; not KV-cached |
| GET | `/api/organizations/:id` | `required` | params: `id` | 200 | Get org by ID, without the payee's user id |
| PATCH | `/api/organizations/:id` | `required`, `requireOrgManagement` | body: `updateOrganizationSchema` | 200 | Invalidates brand KV + VersionedCache on slug change |
| GET | `/api/organizations` | `required` | query: pagination + filters | 200 | List EVERY live org (not scoped to the user), each without the payee's user id |
| DELETE | `/api/organizations/:id` | `required`, `requireOrgManagement`, `rateLimit: 'strict'` | params: `id` | 204 | Soft delete; invalidates KV |

### Member Routes (`/api/organizations/:id/members/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:id/members` | `required`, `requireOrgManagement` | query: page/limit/role/status | 200 | Owner and admins only: items carry each member's email and `hasCreatorAccount` (Codex-2hxff.82) |
| POST | `/api/organizations/:id/members/invite` | `required`, `requireOrgManagement` | body: `inviteMemberSchema` | 201 | The member is active at once. Sends the invitation email fire-and-forget: it names the org, with an "Open {org}" link to the Studio (admin, creator) or the org home page (member), built with `buildOrgUrlFromEnv` (Codex-bnxhw) |
| PATCH | `/api/organizations/:id/members/:userId` | `required`, `requireOrgManagement` | body: `updateMemberRoleSchema` | 200 | `role` is admin/creator/member — never owner. 409 `OWNERSHIP_TRANSFER_REQUIRED` for the owner |
| DELETE | `/api/organizations/:id/members/:userId` | `required`, `requireOrgManagement` | params | 204 | 409 `OWNERSHIP_TRANSFER_REQUIRED` for the owner |
| GET | `/api/organizations/:id/members/my-membership` | `required` | params: `id` | 200 | No `requireOrgMembership` — non-members can check their status. Includes `pendingOwnershipOffer` (the Studio banner) |

### Ownership Routes (`/api/organizations/:id/ownership/*`) — Codex-2hxff.2

One owner per organisation; it moves only by the owner's offer being accepted. Who may act (the owner, the recipient) is enforced in `OrganizationService`. Spec: `docs/payments/connect-and-payouts.md → Organisation ownership`.

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:id/ownership` | `required`, `requireOrgMembership` | params | 200 | Owner/admin/creator. Composes `activeAgreements` (+ owner's `ownerHasSubscriptionAgreement`) from `ctx.services.agreements` for the owner and the recipient |
| POST | `/api/organizations/:id/ownership/offers` | same, `rateLimit: 'strict'` | body: `offerOwnershipSchema` | 201 | Owner only. Emails the recipient |
| POST | `/api/organizations/:id/ownership/offers/:offerId/withdraw` | same, `strict` | params | 200 | Owner only |
| POST | `/api/organizations/:id/ownership/offers/:offerId/accept` | same, `strict` | params | 200 | Recipient only. Busts BOTH users' membership caches (`invalidateMemberCaches`, `@codex/worker-utils` cache-fanout.ts) |
| POST | `/api/organizations/:id/ownership/offers/:offerId/decline` | same, `strict` | params | 200 | Recipient only. Emails the owner |

### Settings Routes (`/api/organizations/:id/settings/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:id/settings` | `required`, `requireOrgManagement` | — | 200 | All settings in one response |
| GET | `/api/organizations/:id/settings/branding` | `required`, `requireOrgManagement` | — | 200 | |
| PUT | `/api/organizations/:id/settings/branding` | `required`, `requireOrgManagement` | body: `updateBrandingSchema` | 200 | Invalidates brand + version caches |
| POST | `/api/organizations/:id/settings/branding/logo` | `required`, `requireOrgManagement` | multipart: `logo` file | 200 | Max 5 MB; PNG/JPEG/WebP |
| DELETE | `/api/organizations/:id/settings/branding/logo` | `required`, `requireOrgManagement` | — | 200 | |
| POST | `/api/organizations/:id/settings/branding/intro-video` | `required`, `requireOrgManagement` | body: `linkIntroVideoSchema` | 200 | Picks the org's intro film: one of the caller's own `ready` videos (audio → 400, unfinished → 422, another user's → 403) |
| GET | `/api/organizations/:id/settings/branding/intro-video` | `required`, `requireOrgManagement` | — | 200 | `StudioIntroFilm \| null`: what was picked and whether visitors get the full film, its preview, or none (and why). Read via `ctx.services.access.getStudioIntroFilm`, the minter's own check (Codex-376dl) |
| DELETE | `/api/organizations/:id/settings/branding/intro-video` | `required`, `requireOrgManagement` | — | 200 | Unlinks only — the media item stays in the creator's library |
| GET | `/api/organizations/:id/settings/contact` | `required`, `requireOrgManagement` | — | 200 | |
| PUT | `/api/organizations/:id/settings/contact` | `required`, `requireOrgManagement` | body: `updateContactSchema` | 200 | |
| GET | `/api/organizations/:id/settings/features` | `required`, `requireOrgManagement` | — | 200 | |
| PUT | `/api/organizations/:id/settings/features` | `required`, `requireOrgManagement` | body: `updateFeaturesSchema` | 200 | |

### Tier Routes (`/api/organizations/:id/tiers/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/organizations/:id/tiers` | `required`, `requireOrgManagement` | body: `createTierSchema` | 201 | |
| GET | `/api/organizations/:id/tiers` | `optional` | — | 200 | Public — used by storefront pricing page |
| PATCH | `/api/organizations/:id/tiers/:tierId` | `required`, `requireOrgManagement` | body: `updateTierSchema` | 200 | |
| DELETE | `/api/organizations/:id/tiers/:tierId` | `required`, `requireOrgManagement` | — | 204 | Fails if active subscribers exist |
| POST | `/api/organizations/:id/tiers/reorder` | `required`, `requireOrgManagement` | body: `reorderTiersSchema` | 204 | |

### Follower Routes (`/api/organizations/:id/followers/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/organizations/:id/followers` | `required` | — | 201 | Follow org (idempotent) |
| DELETE | `/api/organizations/:id/followers` | `required` | — | 200 | Unfollow org (idempotent) — returns `null` without `successStatus: 204`, so the envelope is 200 `{ data: null }` |
| GET | `/api/organizations/:id/followers/me` | `required` | — | 200 `{ following }` | Check if current user follows |
| GET | `/api/organizations/:id/followers/count` | `optional` | — | 200 `{ count }` | Public follower count |

## Bindings / Env

| Binding | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon DB connection |
| `RATE_LIMIT_STRICT` / `RATE_LIMIT_API` | Yes | Native per-preset rate-limit bindings — `RATE_LIMIT_KV` was removed (Codex-kgrdp.17) |
| `AUTH_SESSION_KV` | Yes | Session auth (KV check on startup) |
| `CACHE_KV` | No | `VersionedCache` for public endpoints (org info, stats, creators) |
| `MEDIA_BUCKET` | No | R2 bucket for logo storage |
| `WORKER_SHARED_SECRET` | No | Used by `sendEmailToWorker` for member invite emails |
| `ENVIRONMENT` | No | `development` / `production` |
| `WEB_APP_URL` | No | Used in invite email accept URL |

## Key Packages

| Package | Why |
|---|---|
| `@codex/organization` | `OrganizationService` — org CRUD, members, followers, tiers, slug validation |
| `@codex/platform-settings` | `PlatformSettingsFacade`, `BrandingSettingsService`, `FeatureSettingsService` |
| `@codex/access` | `resolveIntroFilm` / `toPublicIntroFilm` for public info; `ctx.services.access.getStudioIntroFilm` for the studio read |
| `@codex/cache` | `VersionedCache` — KV cache for public endpoints; invalidated on mutations |
| `@codex/image-processing` | Logo upload via `ImageProcessingService`; MIME type/size constants |
| `@codex/worker-utils` | `procedure()`, `multipartProcedure()`, `PaginatedResult`, `sendEmailToWorker` |

## Auth Patterns

- **`auth: 'none'`** — public org info, stats, creators, members, tier list, follower count
- **`auth: 'optional'`** — tier list and follower count (user context enriches but not required)
- **`requireOrgMembership`** — read-only org-scoped endpoints (any member)
- **`requireOrgManagement`** — write/admin endpoints (owner/admin role only)

## Cache Invalidation

Branding and org-info reads go through a single cache layer (`CACHE_KV` via `VersionedCache`). The org layout calls `api.org.getPublicInfo(slug)` → `/public/:slug/info`, which reads `CACHE_KV` keyed by org slug.

| Layer | Key Pattern | Invalidated By |
|---|---|---|
| **`CACHE_KV` (VersionedCache)** | org slug or org ID | `invalidateOrgPublicCaches(cache, slug)` / `cache.invalidate(orgId)` |
| **`CACHE_KV`, the public creators list** | `CacheType.COLLECTION_ORG_CREATORS(slug)` (`org:{slug}:creators`) | `invalidateOrgPublicCaches(cache, slug)`; a listed member's own profile write (identity-api) bumps only this id |

`invalidateBrandAndCache()` in `settings.ts` runs the slug-keyed invalidation INLINE (awaited) — that is the read-critical path. The orgId-keyed version bump is fire-and-forget via `ctx.executionCtx.waitUntil(...)`. The PATCH /:id and DELETE /:id handlers in `organizations.ts` invalidate the slug cache via `waitUntil`.

`GET /public/:slug/creators` reads under its own id, not the slug (Codex-kk9nv.9). The list changes on every listed member's profile write, and sharing the slug's version made each of those writes evict the org's config and stats too. So anything that changes the org or its membership must bump BOTH ids, through `invalidateOrgPublicCaches` (`invalidateOrgSlugCache` in worker-utils does). A bare `cache.invalidate(slug)` leaves the creators list stale for its 4h TTL. `organizations-creators-cache-id.test.ts` pins the read id.

> **Removed (Codex-fopbo):** A second KV namespace `BRAND_KV` (`brand:{slug}` keys) was previously written on every branding mutation by `updateBrandCache()` and `BRAND_KV.delete()` calls. The `apps/web` reader (`brand-cache.ts`) was never wired to a real consumer — only its own tests imported it. The binding, the writer, and the dead reader module were removed because nothing read the cache.

## Gotchas

- **Slug = subdomain** — slugs are validated against `RESERVED_SUBDOMAINS_SET` before creation. A slug that passes becomes a live subdomain. Never skip this check.
- **Logo uploads** use `multipartProcedure()` — not `procedure()`. Multipart form handling is incompatible with standard Zod body parsing. The intro film is not uploaded here: it is picked from the media library (a JSON body).
- **`introFilm` on public info** comes from `resolveIntroFilm` + `toPublicIntroFilm` (`@codex/access`), the same check the content-api org-film minter runs. A payload cached before Codex-376dl has no `introFilm` key, so readers treat it as `?? null`.
- **Public endpoints create ad-hoc DB clients** — `fetchPublicOrgInfo()` instantiates `BrandingSettingsService` and `FeatureSettingsService` directly (not via service registry) because `ctx.services.settings` requires org membership context unavailable on public routes.
- **`my-membership` (members route)** intentionally omits `requireOrgMembership` so non-members can query their own status — returns `null` for non-members.
- **Membership mutation cache**: Member invite/update/delete also invalidates the slug-keyed public cache (creator profiles are part of public org info).

## Reference Files

- `workers/organization-api/src/routes/organizations.ts` — org CRUD + public endpoints
- `workers/organization-api/src/routes/members.ts` — membership management
- `workers/organization-api/src/routes/settings.ts` — branding/contact/features + `updateBrandCache`
- `workers/organization-api/src/routes/tiers.ts` — subscription tiers
- `workers/organization-api/src/routes/followers.ts` — follow/unfollow
