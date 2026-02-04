# @codex/access

Content access control, streaming URL generation, and playback tracking. Used by `content-api`.

## API

### `ContentAccessService`
- **getStreamingUrl(userId, contentId)**: Verifies access, returns R2 signed URL + expiry.
  - Access: Free (price=0) OR Purchased OR Org Member.
- **savePlaybackProgress(userId, contentId, pos, dur)**: Upsert progress. Auto-completes at 95%.
- **getPlaybackProgress(userId, contentId)**: Returns position/status.
- **listUserLibrary(userId, options)**: Lists purchased content + progress.

### Factory
- `createContentAccessService(env)`: Inject DB, R2, PurchaseService.

## Access Logic
1. **Free**: Granted.
2. **Paid**: Check `PurchaseService` OR Org Membership.
3. **Private**: Deny unless owner (via other flows).
- **Errors**: `AccessDeniedError` (403), `ContentNotFoundError` (404).

## Integrations
- **DB**: `content`, `purchases`, `videoPlayback`, `organizationMemberships`.
- **R2**: Generates signed URLs (AWS SigV4).
- **Purchase**: Verifies ownership.

## Usage
```ts
const { service } = createContentAccessService(env);
const { streamingUrl } = await service.getStreamingUrl(uid, { contentId });
```

## Standards
- **Assert**: `invariant()` for preconditions/state.
- **Scope**: MANDATORY `where(eq(userId, ...))`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
