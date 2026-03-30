# Content-API Worker (port 4001)

Content CRUD, media lifecycle, access control, and streaming. The largest worker — handles the core content platform functionality.

## Endpoints

### Content
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/api/content` | `auth: 'required'` | body: `createContentSchema` | 201 | `{ data: Content }` |
| GET | `/api/content/:id` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: Content }` |
| PATCH | `/api/content/:id` | `auth: 'required'` | params + body: `updateContentSchema` | 200 | `{ data: Content }` |
| POST | `/api/content/:id/publish` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: Content }` |
| POST | `/api/content/:id/unpublish` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: Content }` |
| DELETE | `/api/content/:id` | `auth: 'required'` | params: `{ id: uuid }` | 204 | Empty |
| GET | `/api/content` | `auth: 'required'` | query: `contentQuerySchema` | 200 | `{ items, pagination }` |

### Media
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/api/media` | `auth: 'required'` | body: `createMediaItemSchema` | 201 | `{ data: MediaItem }` |
| POST | `/api/media/:id/upload-complete` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: MediaItem }` |
| GET | `/api/media` | `auth: 'required'` | query: `mediaQuerySchema` | 200 | `{ items, pagination }` |

### Access & Streaming
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/api/access/streaming-url/:contentId` | `auth: 'required'` | params: `{ contentId: uuid }` | 200 | `{ data: { streamingUrl, expiresAt } }` |
| POST | `/api/access/playback-progress/:contentId` | `auth: 'required'` | params + body: progress data | 204 | Empty |
| GET | `/api/access/library` | `auth: 'required'` | query: pagination | 200 | `{ items, pagination }` |

## Key Flows

### Media Upload → Transcode → Publish
```
1. POST /api/media (register upload, status: uploading)
2. Client uploads file to R2 (presigned URL or direct)
3. POST /api/media/:id/upload-complete (status: uploaded)
4. Content-API calls media-api via workerFetch (HMAC) to start transcoding
5. RunPod processes → calls media-api webhook → status: ready
6. POST /api/content/:id/publish (checks all media ready)
```

### Streaming URL Generation
```
1. GET /api/access/streaming-url/:contentId
2. Check content exists and is published
3. Check access: free → granted, paid → check purchase/membership
4. Generate signed R2 URL (SigV4, time-limited)
5. Return { streamingUrl, expiresAt }
```

## Services Used

- `ContentService` (`@codex/content`) — content CRUD, publish/unpublish
- `MediaItemService` (`@codex/content`) — media registration, status transitions
- `ContentAccessService` (`@codex/access`) — access control, streaming URLs, playback progress

## Strict Rules

- **MUST** scope all content queries by `creatorId` — NEVER return other creators' content
- **MUST** check media ready status before allowing publish
- **MUST** verify access before generating streaming URLs
- **MUST** use `successStatus: 201` for POST create, `204` for DELETE
- **NEVER** return raw R2 keys — only signed URLs

## Reference Files

- `workers/content-api/src/routes/content.ts` — content CRUD routes
- `workers/content-api/src/routes/media.ts` — media routes
- `workers/content-api/src/routes/content-access.ts` — streaming and access routes
