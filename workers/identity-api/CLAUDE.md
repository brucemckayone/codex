# Identity-API Worker (port 42074)

User identity, profiles, avatar management, role upgrades, notification preferences, and worker-to-worker membership lookup.

## Endpoints

### User Routes (`/api/user/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/user/profile` | `required` | — | 200 | Get authenticated user's profile |
| PATCH | `/api/user/profile` | `required` | body: `updateProfileSchema` | 200 | Update profile |
| POST | `/api/user/avatar` | `required` | multipart: `avatar` file | 200 | Upload/replace avatar; returns `{ avatarUrl, size, mimeType }` |
| DELETE | `/api/user/avatar` | `required` | — | 204 | Remove avatar, revert to default |
| POST | `/api/user/upgrade-to-creator` | `required`, `rateLimit: 'strict'` | body: `upgradeToCreatorSchema` | 200 | Upgrade customer → creator role; invalidates session KV immediately |
| GET | `/api/user/notification-preferences` | `required` | — | 200 | Get preferences; upserts defaults on first access |
| PUT | `/api/user/notification-preferences` | `required` | body: `updateNotificationPreferencesSchema` | 200 | Update preferences |

### Membership Routes (`/api/organizations/*`)

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/organizations/:orgId/membership/:userId` | `worker` | params: `orgId`, `userId` | 200 | Worker-to-worker: resolve user role in org; returns `{ role, joinedAt }` or `{ role: null, joinedAt: null }` |
| GET | `/api/organizations/:orgId/my-membership` | `required` | params: `orgId` | 200 | Get the authenticated user's own membership in an org |

## Bindings / Env

| Binding | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon DB connection |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `AUTH_SESSION_KV` | Yes | Session KV (read for auth; deleted on role upgrade) |
| `CACHE_KV` | Yes | VersionedCache (KV check on startup) |
| `WORKER_SHARED_SECRET` | Yes | HMAC secret for worker-to-worker auth |
| `ENVIRONMENT` | No | `development` / `production` |
| `WEB_APP_URL` | No | Web app base URL |
| `API_URL` | No | API base URL |
| `MEDIA_BUCKET` | No | R2 bucket for avatar storage |

## Key Packages

| Package | Why |
|---|---|
| `@codex/identity` | `IdentityService` — profile CRUD, creator upgrade, membership lookup |
| `@codex/image-processing` | Avatar upload/delete via `ImageProcessingService`; size/MIME constants |
| `@codex/worker-utils` | `procedure()`, `multipartProcedure()`, `checkOrganizationMembership()` |
| `@codex/validation` | `updateProfileSchema`, `upgradeToCreatorSchema`, `updateNotificationPreferencesSchema` |
| `@codex/shared-types` | `MembershipLookupResponse`, `HonoEnv` |

## Auth Patterns

- **Session auth** (`auth: 'required'`) — all user-facing routes
- **Worker HMAC** (`auth: 'worker'`) — membership lookup endpoint called by SvelteKit hooks
- **Rate limit `strict`** (20/min) — `upgrade-to-creator` (sensitive one-time op)

## Gotchas

- **Avatar upload** uses `multipartProcedure()` not `procedure()` — multipart form handling.
- **`upgrade-to-creator`** must `await` session KV deletion (not `waitUntil`) — the browser redirect immediately follows and needs the old session evicted before the next request arrives. Both key formats (`session:{token}` and raw token) are deleted.
- **Membership lookup** is called by SvelteKit `hooks.ts` `reroute()` via worker HMAC — it is performance-critical. Returns null-role rather than 404 when user is not a member.
- **`/api/organizations/:orgId/my-membership`** does NOT require `requireOrgMembership` — it intentionally allows non-members to check their own status (returns `null` if not a member).

## Reference Files

- `workers/identity-api/src/routes/users.ts` — profile and avatar routes
- `workers/identity-api/src/routes/membership.ts` — org membership lookup
