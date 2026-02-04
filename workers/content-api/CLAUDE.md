# Content API (4001)

Content & Media lifecycle.

## Endpoints
### Content
- **POST /content**: Create draft.
- **GET /content/:id**: Details.
- **PATCH /content/:id**: Update.
- **POST /content/:id/publish**: Live.
- **DELETE /content/:id**: Soft delete.
- **GET /content**: List (scoped).

### Media
- **POST /media**: Regsiter upload.
- **POST /media/:id/upload-complete**: Trigger transcode.
- **GET /media**: List.

### Access
- **GET /access/stream/:id**: Signed URL.
- **POST /access/progress/:id**: Save position.
- **GET /access/library**: User's content.

## Architecture
- **Services**: `ContentService`, `MediaItemService`, `ContentAccessService`.
- **Security**: Creator scoping. Auth required.
- **Flow**: Upload -> Media API (Transcode) -> Publish -> Stream.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
