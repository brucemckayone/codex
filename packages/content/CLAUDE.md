# @codex/content

Content & Media lifecycle management.

## API
### `ContentService`
- **create(input, creatorId)**: Creates draft. Validates media/slug.
- **get(id, creatorId)**: Returns content with relations. Scoped.
- **update(id, input, creatorId)**: Updates metadata. Slug check.
- **publish/unpublish(id, creatorId)**: State transition. Checks media ready.
- **delete(id, creatorId)**: Soft delete.
- **list(creatorId, filters)**: Paginated, scoped list.

### `MediaItemService`
- **create(input, creatorId)**: Regsiter upload. Status: 'uploading'.
- **updateStatus(id, status, creatorId)**: Transition (uploaded->transcoding->ready).
- **markAsReady(id, meta, creatorId)**: Set HLS/thumb keys. Status: 'ready'.
- **delete(id, creatorId)**: Soft delete.

## Lifecycle
- **Content**: Draft -> Published -> Deleted.
- **Media**: Uploading -> Uploaded -> Transcoding -> Ready/Failed.

## Key Logic
- **Transaction**: Create/Publish use `db.transaction`.
- **Scope**: All ops require `creatorId`.
- **Errors**: `SlugConflictError`, `MediaNotReadyError`, `ContentNotFoundError`.

## Standards
- **Assert**: `invariant()` for preconditions/state (`invariant(media.status === 'ready')`).
- **Scope**: MANDATORY `where(eq(creatorId, ...))`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
