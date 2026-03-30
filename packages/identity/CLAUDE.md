# @codex/identity

User identity and profile management service.

## API

### `IdentityService`
| Method | Purpose |
|---|---|
| `getProfile(userId)` | Get user profile |
| `updateProfile(userId, input)` | Update user profile |

## Strict Rules

- **MUST** scope all queries to the authenticated user — NEVER expose other users' data
- **MUST** invalidate cache after profile updates

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`
- **Used by**: identity-api worker (port 42074)

## Reference Files

- `packages/identity/src/services/identity-service.ts`
