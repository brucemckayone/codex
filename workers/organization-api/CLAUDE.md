# Organization-API Worker (port 42071)

Organization CRUD, membership management, subscription tiers, follower relationships, and platform settings (branding, contact, features). Also serves several public (no-auth) endpoints used by the org layout and storefront.

## Endpoints

### Organization Routes (`/api/organizations/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/organizations` | `required`, roles: creator/admin/platform_owner | body: `createOrganizationSchema` | 201 | Warms brand KV cache via `waitUntil` |
| GET | `/api/organizations/check-slug/:slug` | `required` | params: `slug` | 200 `{ available }` | Checks against reserved subdomains |
| GET | `/api/organizations/slug/:slug` | `required` | params: `slug` | 200 | Get org by slug |
| GET | `/api/organizations/my-organizations` | `required` | — | 200 | User's orgs with their role |
| GET | `/api/organizations/public/:slug` | `none` | params: `slug` | 200 | Public branding fields only (legacy) |
| GET | `/api/organizations/public/:slug/info` | `none` | params: `slug` | 200 | Full public org identity + branding; KV-cached 30 min |
| GET | `/api/organizations/public/:slug/stats` | `none` | params: `slug` | 200 | Content counts, duration, creator count, views; KV-cached |
| GET | `/api/organizations/public/:slug/creators` | `none` | params + query: page/limit | 200 | Paginated public creator profiles; KV-cached |
| GET | `/api/organizations/public/:slug/members` | `none` | params + query: page/limit/role | 200 | Paginated public member profiles; KV-cached |
| GET | `/api/organizations/:id` | `required` | params: `id` | 200 | Get org by ID |
| PATCH | `/api/organizations/:id` | `required`, `requireOrgManagement` | body: `updateOrganizationSchema` | 200 | Invalidates brand KV + VersionedCache on slug change |
| GET | `/api/organizations` | `required` | query: pagination + filters | 200 | List orgs scoped to user |
| DELETE | `/api/organizations/:id` | `required`, `requireOrgManagement`, `rateLimit: 'strict'` | params: `id` | 204 | Soft delete; invalidates KV |

### Member Routes (`/api/organizations/:id/members/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:id/members` | `required`, `requireOrgMembership` | query: page/limit/role/status | 200 | |
| POST | `/api/organizations/:id/members/invite` | `required`, `requireOrgManagement` | body: `inviteMemberSchema` | 201 | Sends invitation email fire-and-forget |
| PATCH | `/api/organizations/:id/members/:userId` | `required`, `requireOrgManagement` | body: `updateMemberRoleSchema` | 200 | |
| DELETE | `/api/organizations/:id/members/:userId` | `required`, `requireOrgManagement` | params | 204 | |
| GET | `/api/organizations/:id/members/my-membership` | `required` | params: `id` | 200 | No `requireOrgMembership` — non-members can check their status |

### Settings Routes (`/api/organizations/:id/settings/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:id/settings` | `required`, `requireOrgManagement` | — | 200 | All settings in one response |
| GET | `/api/organizations/:id/settings/branding` | `required`, `requireOrgManagement` | — | 200 | |
| PUT | `/api/organizations/:id/settings/branding` | `required`, `requireOrgManagement` | body: `updateBrandingSchema` | 200 | Invalidates brand + version caches |
| POST | `/api/organizations/:id/settings/branding/logo` | `required`, `requireOrgManagement` | multipart: `logo` file | 200 | Max 5 MB; PNG/JPEG/WebP |
| DELETE | `/api/organizations/:id/settings/branding/logo` | `required`, `requireOrgManagement` | — | 200 | |
| POST | `/api/organizations/:id/settings/branding/intro-video` | `required`, `requireOrgManagement` | body: `linkIntroVideoSchema` | 200 | Links an existing media item as intro video |
| GET | `/api/organizations/:id/settings/branding/intro-video/status` | `required`, `requireOrgMembership` | — | 200 | Poll transcoding status; auto-finalizes URL when ready |
| DELETE | `/api/organizations/:id/settings/branding/intro-video` | `required`, `requireOrgManagement` | — | 200 | Soft-deletes media item |
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
| DELETE | `/api/organizations/:id/followers` | `required` | — | 204 | Unfollow org (idempotent) |
| GET | `/api/organizations/:id/followers/me` | `required` | — | 200 `{ following }` | Check if current user follows |
| GET | `/api/organizations/:id/followers/count` | `optional` | — | 200 `{ count }` | Public follower count |

## Bindings / Env

| Binding | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon DB connection |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `AUTH_SESSION_KV` | Yes | Session auth (KV check on startup) |
| `BRAND_KV` | No | Branding cache (`brand:{slug}` keys); used by org layout |
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
| `@codex/cache` | `VersionedCache` — KV cache for public endpoints; invalidated on mutations |
| `@codex/image-processing` | Logo upload via `ImageProcessingService`; MIME type/size constants |
| `@codex/worker-utils` | `procedure()`, `multipartProcedure()`, `PaginatedResult`, `sendEmailToWorker` |

## Auth Patterns

- **`auth: 'none'`** — public org info, stats, creators, members, tier list, follower count
- **`auth: 'optional'`** — tier list and follower count (user context enriches but not required)
- **`requireOrgMembership`** — read-only org-scoped endpoints (any member)
- **`requireOrgManagement`** — write/admin endpoints (owner/admin role only)

## Cache Invalidation

Two cache layers are maintained and must be invalidated on mutations:

| Layer | Key Pattern | Invalidated By |
|---|---|---|
| **`BRAND_KV`** | `brand:{slug}` | `updateBrandCache()` — re-fetches from DB and writes fresh value |
| **`CACHE_KV` (VersionedCache)** | org slug or org ID | `cache.invalidate(slug)` / `cache.invalidate(orgId)` |

All invalidation is fire-and-forget via `ctx.executionCtx.waitUntil(...)`. The `updateBrandCache()` helper in `settings.ts` is exported and also called by `organizations.ts` on create/update/delete.

## Gotchas

- **Slug = subdomain** — slugs are validated against `RESERVED_SUBDOMAINS_SET` before creation. A slug that passes becomes a live subdomain. Never skip this check.
- **Logo and intro-video uploads** use `multipartProcedure()` — not `procedure()`. Multipart form handling is incompatible with standard Zod body parsing.
- **Public endpoints create ad-hoc DB clients** — `fetchPublicOrgInfo()` instantiates `BrandingSettingsService` and `FeatureSettingsService` directly (not via service registry) because `ctx.services.settings` requires org membership context unavailable on public routes.
- **`my-membership` (members route)** intentionally omits `requireOrgMembership` so non-members can query their own status — returns `null` for non-members.
- **Membership mutation cache**: Member invite/update/delete also invalidates the slug-keyed public cache (creator profiles are part of public org info).

## Reference Files

- `workers/organization-api/src/routes/organizations.ts` — org CRUD + public endpoints
- `workers/organization-api/src/routes/members.ts` — membership management
- `workers/organization-api/src/routes/settings.ts` — branding/contact/features + `updateBrandCache`
- `workers/organization-api/src/routes/tiers.ts` — subscription tiers
- `workers/organization-api/src/routes/followers.ts` — follow/unfollow
