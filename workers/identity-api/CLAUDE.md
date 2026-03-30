# Identity-API Worker (port 42074)

User identity, profiles, and user-facing platform settings lookup.

## Endpoints

| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/api/user/profile` | `auth: 'required'` | — | 200 | `{ data: UserProfile }` |
| PATCH | `/api/user/profile` | `auth: 'required'` | body: update schema | 200 | `{ data: UserProfile }` |

> Note: This worker handles user-facing identity operations. Organization CRUD and settings have been moved to the **organization-api** worker (port 42071).

## Services Used

- `IdentityService` (`@codex/identity`) — user profile management

## Strict Rules

- **MUST** scope all queries to the authenticated user
- **NEVER** expose other users' profile data

## Reference Files

- `workers/identity-api/src/routes/users.ts` — user profile routes
