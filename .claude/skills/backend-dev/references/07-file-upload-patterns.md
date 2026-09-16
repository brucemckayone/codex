---
name: file-upload-patterns
description: >
  Deep reference for file uploads in Codex — decision tree between multipartProcedure,
  binaryUploadProcedure, and presigned R2 URLs; image processing pipeline; SVG sanitization;
  dev-cdn proxy.
type: reference
---

# File Upload Patterns

Codex has **three distinct upload patterns**, each for a different use case. Picking
the right one is the critical decision — the wrong choice breaks large uploads,
leaks bandwidth through the worker, or fails under real production load.

Reference implementations:
- `packages/worker-utils/src/procedure/multipart-procedure.ts`
- `packages/worker-utils/src/procedure/binary-upload-procedure.ts`
- `packages/cloudflare-clients/src/r2/services/r2-service.ts`
- `packages/content/src/services/media-service.ts`
- `packages/image-processing/src/service.ts`
- `workers/content-api/src/routes/media.ts`
- `workers/dev-cdn/src/index.ts`

---

## Decision Tree

```
What's being uploaded?
│
├─ Large media (video/audio ≤ 5GB)
│   → Presigned R2 URL flow
│     - POST /media creates the media record, returns presigned URL
│     - Client PUTs file directly to R2 (bypasses worker)
│     - POST /media/:id/upload-complete finalizes + triggers transcoding
│
├─ Image (logo, avatar, thumbnail ≤ 5MB)
│   → multipartProcedure + ImageProcessingService
│     - FormData multipart upload
│     - Worker receives bytes, validates MIME + magic bytes
│     - ImageProcessingService generates 3 WebP variants
│     - Uploads variants to R2 with 1-year immutable cache headers
│
└─ Raw binary body (dev fallback, rare)
    → binaryUploadProcedure
      - Request body IS the file (no FormData wrapper)
      - Worker receives ArrayBuffer
      - Used when presigned URLs aren't available locally
```

**The rule:** If the file is > 5MB or could be (video/audio), use presigned URLs.
If it's an image, use multipart. Binary upload is almost always a fallback, not
a primary pattern.

---

## Pattern 1: Multipart (Images)

This is the standard pattern for logos, avatars, thumbnails. FormData multipart,
synchronous worker processing, three resized variants.

### Worker route

```typescript
import { multipartProcedure } from '@codex/worker-utils';

app.post('/api/user/avatar',
  multipartProcedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    files: {
      avatar: {
        required: true,
        maxSize: 5 * 1024 * 1024,        // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
    },
    handler: async (ctx) => {
      const file = ctx.files.avatar;      // ValidatedFile
      return await ctx.services.identity.uploadAvatar(ctx.user.id, file);
    },
  })
);
```

The `files` config validates:
- MIME type against the allowlist (checked against `Content-Type` header)
- Size against `maxSize`
- `required` — whether to 400 if missing

### ValidatedFile shape

```typescript
interface ValidatedFile {
  name: string;          // original filename (don't trust for path building)
  type: string;          // MIME type (validated against allowlist)
  size: number;          // bytes
  buffer: ArrayBuffer;   // file content
}
```

### Service: image processing + R2 upload

```typescript
async uploadAvatar(userId: string, file: ValidatedFile) {
  // 1. Magic byte check — defense in depth
  if (!validateImageSignature(new Uint8Array(file.buffer), file.type)) {
    throw new ValidationError('File content does not match declared type');
  }

  // 2. SVG sanitization if applicable (logos only, not avatars usually)
  if (file.type === 'image/svg+xml') {
    const text = new TextDecoder().decode(file.buffer);
    await sanitizeSvgContent(text);  // throws if malicious
  }

  // 3. Process + upload
  const variants = await this.imageProcessingService.processToVariants(file, {
    sizes: ['sm', 'md', 'lg'],
    format: 'webp',
  });

  // 4. Upload each variant to R2 with correct key + cache headers
  for (const variant of variants) {
    const key = getUserAvatarKey(userId, variant.size);
    await this.r2.put(key, variant.buffer, {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  // 5. Update DB with CDN URL (just the base path — client picks size)
  await this.db.update(users).set({ avatarKey: baseKey }).where(...);
}
```

### Image processing via `@cf-wasm/photon`

`ImageProcessingService` uses WASM-compiled Photon for resizing. It runs **inside
the worker** — no external service. Three variants are standard:

| Variant | Size | Use |
|---------|------|-----|
| `sm` | 256px | Card thumbnails |
| `md` | 640px | Standard display |
| `lg` | 1280px | Hero / large display |

All output WebP (except SVG which stays SVG after sanitization).

### R2 key builders

From `@codex/transcoding`:

```typescript
getUserAvatarKey(userId, 'sm')     // → `${userId}/avatar/sm.webp`
getOrgLogoKey(orgId, 'png')         // → `logos/${orgId}/logo.png`
getContentThumbnailKey(creatorId, contentId, 'md')
  // → `${creatorId}/thumbnails/${contentId}/md.webp`
```

**Never hand-roll R2 keys.** The builders encode our conventions — changing them
across the platform means updating the builder in one place.

### Cache headers

| Asset | Cache-Control |
|-------|---------------|
| WebP variants | `public, max-age=31536000, immutable` (1 year) |
| SVG logos | `public, max-age=3600` (1 hour — mutable) |

Immutable + 1 year for raster because we key-version by upload time. SVG uses short
cache because we sanitize in-place (same key, changed content).

---

## Pattern 2: Presigned R2 URLs (Large Media)

For videos and audio up to 5GB. The worker never touches the file bytes — the
client uploads directly to R2.

### The two-step flow

```
Step 1: Create media record
  Client → POST /api/media { title, contentType: 'video/mp4', ... }
  Worker:
    - Creates media row (status: 'uploading')
    - Generates presigned PUT URL (1-hour validity)
    - Returns { mediaId, presignedUrl, r2Key }

Step 2: Client uploads directly to R2
  Client → PUT <presignedUrl> [video bytes]

Step 3: Upload complete
  Client → POST /api/media/:id/upload-complete
  Worker:
    - Verifies ownership
    - Transitions status: 'uploading' → 'uploaded'
    - Fire-and-forget: trigger transcoding via worker-to-worker HMAC
```

### Why presigned, not multipart?

| Consideration | Multipart | Presigned |
|---------------|-----------|-----------|
| File size limit | Worker memory (~100MB realistic) | R2 object limit (5GB, up to 5TB multipart) |
| Worker bandwidth | 2x file size (up + down) | 0 |
| Worker CPU | Full buffer in memory | Negligible (just signing) |
| Complexity | Simple | Two-step + idempotency |
| Use case | Images, small files | Video, audio, large data |

Multipart **bills your worker** for every byte of the file. Presigned lets the
client talk directly to R2, worker is just an authorization layer.

### Generating presigned URLs

```typescript
// packages/cloudflare-clients/src/r2/services/r2-service.ts
await r2Service.generateSignedUploadUrl(key, contentType, 3600);
// Returns: 'https://<account>.r2.cloudflarestorage.com/...?X-Amz-Signature=...'
```

Uses S3 SigV4 with 1-hour default expiry. The URL includes a content-type
constraint — client can't PUT a different MIME type than declared.

### Dev fallback

In local dev, R2 signing credentials usually aren't available. The service detects
this and returns `presignedUrl: null`. The client falls back to:

```
POST /api/media/:id/upload [raw binary body]
```

This is the **binary upload pattern** (below), used only in dev/test. Production
always uses presigned.

### Separating synchronous DB transition from async dispatch

A good shape for the upload-complete handler: flip DB status synchronously so
the HTTP 200 returns immediately and the frontend sees the new state, then fire
the external dispatch (RunPod, webhook, email) via `waitUntil`:

```typescript
async completeUpload(mediaId: string, userId: string) {
  // 1. Synchronous DB transition (user sees 'transcoding' on refresh)
  const updated = await this.db.update(schema.mediaItems)
    .set({ status: 'transcoding', updatedAt: new Date() })
    .where(and(eq(schema.mediaItems.id, mediaId), eq(schema.mediaItems.status, 'uploaded')))
    .returning();

  // 2. Return the dispatch promise — caller does waitUntil
  return {
    media: updated[0],
    dispatchPromise: this.transcoding.triggerJob(mediaId),
  };
}

// In the route handler:
const { media, dispatchPromise } = await ctx.services.media.completeUpload(id, userId);
ctx.executionCtx.waitUntil(dispatchPromise.catch((err) =>
  ctx.obs?.error('Transcoding dispatch failed', { mediaId: id, err })
));
return media;
```

This pattern is reusable for any trigger-then-external-call flow. See
`packages/transcoding/src/services/transcoding-service.ts:783-849` for the
canonical implementation.

### Upload-complete idempotency

```typescript
app.post('/api/media/:id/upload-complete',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      const media = await ctx.services.media.completeUpload(
        ctx.input.params.id,
        ctx.user.id
      );
      return media;
    },
  })
);
```

The service method:
1. Checks media exists, owned by user
2. Status-based dispatch:
   - `uploading` → transition to `uploaded`, trigger transcoding
   - `uploaded` → trigger transcoding (re-dispatch; prior attempt may have failed)
   - `transcoding` / `ready` / `failed` → return **200 no-op** with current status
     (flaky frontend retry should not get a 409)
3. Otherwise (truly unknown status) → 409 `ConflictError`
4. Fires transcoding trigger via `workerFetch` to media-api (fire-and-forget)

**Key rule:** idempotent completion endpoints return 200 with `{ status, alreadyCompleted: true }`
on already-advanced states — NOT 409. Frontend retries on flaky networks should see
success, not an error card.

The transcoding worker is also responsible for its own idempotency (WHERE-clause
state guards on updates; see ref 03 "Atomic state-guarded update").

### Media status transitions

```
uploading → uploaded → (transcoding triggered) → transcoding → ready
                                                            ↘ failed (retryable)
```

Never short-circuit. Every transition goes through the service layer, never inline
in a route.

---

## Pattern 3: Binary Upload (Dev Fallback)

Raw body is the file — no FormData wrapper. Used when presigned URLs aren't
available (dev mode, specific test paths).

```typescript
import { binaryUploadProcedure } from '@codex/worker-utils';

app.post('/api/media/:id/upload',
  binaryUploadProcedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { params: createIdParamsSchema() },
    file: {
      maxSize: FILE_SIZES.MEDIA_MAX_BYTES,  // 5GB
      minSize: FILE_SIZES.MEDIA_MIN_BYTES,  // 1KB (reject empty uploads)
      allowedMimeTypes: SUPPORTED_MEDIA_MIME_TYPES,
    },
    handler: async (ctx) => {
      // ctx.file: ValidatedBinaryFile { body, contentType, size }
      return await ctx.services.media.upload(
        ctx.input.params.id,
        ctx.file.body,
        ctx.file.contentType,
        ctx.user.id,
      );
    },
  })
);
```

### ValidatedBinaryFile shape

```typescript
interface ValidatedBinaryFile {
  body: ArrayBuffer;
  contentType: string;  // Stripped of charset/boundary params
  size: number;
}
```

### When NOT to use this pattern

- Production (you're burning worker bandwidth)
- For images (use multipart, get processing for free)
- For files > 100MB in prod (worker memory limits)

This pattern exists for dev-mode symmetry and local tooling. Don't introduce it
for production paths.

### Required: guard the route with an environment check

Even as a dev fallback, the route exists at runtime in prod unless gated. An
unintentional hit lets a client stream 5GB through the worker:

```typescript
app.post('/:id/upload',
  binaryUploadProcedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    handler: async (ctx) => {
      // Dev/test-only fallback. Prevent accidental use in production.
      if (ctx.env.ENVIRONMENT === 'production') {
        throw new NotFoundError('Endpoint not available');
      }
      return await ctx.services.media.upload(...);
    },
  })
);
```

Alternative: mount the route conditionally in the worker's `index.ts`. Either
works — pick the one your worker's style prefers.

---

## Magic Byte Validation

`validateImageSignature(buffer, mimeType)` reads the first few bytes and confirms
they match the declared MIME:

| Format | Magic bytes |
|--------|-------------|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| WebP | `52 49 46 46 ... WEBP` at offset 8 |
| GIF | `47 49 46 38` |
| SVG | `3C 3F 78 6D 6C` (`<?xml`) or `<svg` |

Without this, an attacker renames `exploit.html` to `exploit.png`, uploads it,
and when the browser is served it with a wrong MIME (or sniffs the content), it
renders as HTML. Magic byte validation closes that gap.

Call this in the service layer after `multipartProcedure` has done MIME validation.
Both layers matter — MIME is cheap and fast, magic bytes are definitive.

### Media container magic bytes (same rule for videos/audio)

Binary uploads for video/audio ALSO need signature validation. A 5GB text file
renamed with `Content-Type: video/mp4` gets stored at the creator's R2 key, then
fails noisily in transcoding — wasting RunPod budget and R2 quota. Add a
`validateMediaSignature()` helper analogous to the image one:

| Format | Magic bytes |
|--------|-------------|
| MP4 / MOV | `xx xx xx xx 66 74 79 70` (`ftyp` atom at offset 4) |
| WebM / Matroska | `1A 45 DF A3` (EBML) |
| AVI | `52 49 46 46 xx xx xx xx 41 56 49 20` (RIFF...AVI) |
| MP3 | `49 44 33` (`ID3`) or `FF FB`/`FF FA` (MPEG frame sync) |
| WAV | `52 49 46 46 xx xx xx xx 57 41 56 45` (RIFF...WAVE) |
| OGG | `4F 67 67 53` (`OggS`) |
| FLAC | `66 4C 61 43` (`fLaC`) |
| AAC (ADTS) | `FF F1` or `FF F9` (sync word) |

Call in `MediaItemService.upload` (the binary fallback path) and anywhere else
raw media bytes enter the system.

---

## SVG Sanitization

See `05-validation-patterns.md` for the full pattern. Short version:

```typescript
if (file.type === 'image/svg+xml') {
  const text = new TextDecoder().decode(file.buffer);
  const sanitized = await sanitizeSvgContent(text);
  // sanitized is safe to store/render
}
```

DOMPurify strips `<script>`, event handlers, `javascript:`/`data:` URIs, and a
handful of other XSS vectors. Throws if the result is empty (malicious file).

Used by: org logos (the only place we accept SVG currently).

---

## R2 Service

`@codex/cloudflare-clients` provides two clients:

| Client | When |
|--------|------|
| `R2Service` | Inside workers (uses R2Bucket binding) |
| `R2SigningClient` | Tests, scripts (standalone, uses S3 SDK) |

### R2Service API

```typescript
await r2.put(key, body, {
  httpMetadata: { contentType, cacheControl }
});
await r2.get(key);                    // returns R2Object | null
await r2.delete(key);
await r2.head(key);                   // metadata only
await r2.generateSignedUploadUrl(key, contentType, expirySeconds);
```

### File size constants

From `@codex/constants`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `LOGO_MAX_BYTES` | 5 MB | Org logos |
| `IMAGE_MAX_BYTES` | 5 MB | Avatars, thumbnails |
| `MEDIA_MAX_BYTES` | 5 GB | Video, audio |
| `MEDIA_MIN_BYTES` | 1 KB | Reject empty files |

Always use the constants — don't hardcode bytes. If limits change we want one place.

### Supported MIME types

From `@codex/constants` / `@codex/validation`:

**Images:** PNG, JPEG, WebP, GIF, SVG (logos only, sanitized)

**Media:** `video/mp4`, `video/quicktime`, `video/mpeg`, `video/x-msvideo`,
`video/webm`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/aac`, `audio/flac`

---

## Dev-CDN Worker

`workers/dev-cdn` (port 4100) is a local R2 proxy for two use cases:

### CDN mode (VideoPlayer, image serving)

```
GET  /{key}           → read from ASSETS_BUCKET or MEDIA_BUCKET
PUT  /media/{key}     → write to MEDIA_BUCKET
PUT  /assets/{key}    → write to ASSETS_BUCKET
DELETE /media/{key}   → delete
```

### S3-compatible mode (for RunPod / Docker transcoding)

```
GET  /{bucket}/{key}   → bucket name resolved (media → MEDIA_BUCKET, etc.)
PUT  /{bucket}/{key}   → with SigV4 headers accepted (and ignored)
HEAD /{bucket}/{key}
DELETE /{bucket}/{key}
```

Bucket aliases: `codex-media-test`, `codex-assets-test`, `media`, `assets`, and
production names for parity.

**Never deploy dev-cdn to production.** It's only referenced from dev environment
config — the prod CDN is Cloudflare directly.

### LAN mobile access

`src/hooks.server.ts` has a `cdnRewriteHook` that rewrites `localhost:4100` to
`<ip>.nip.io:4100` when serving to LAN devices. This lets phones on the same WiFi
reach the dev CDN.

---

## Adding a New Upload Endpoint

### Image (logo, avatar, thumbnail)

1. Define size + MIME allowlist in `@codex/constants` / `@codex/validation`
2. Add service method using `ImageProcessingService` for variants
3. Add route using `multipartProcedure` with appropriate `policy` + rate limit
4. Use R2 key builders from `@codex/transcoding` — don't invent a key format
5. Set `Cache-Control: immutable` for WebP variants

### Video / audio

1. Add creation endpoint — `procedure()` that creates DB row + returns presigned URL
2. Add upload-complete endpoint — transitions status, triggers transcoding
3. Implement dev fallback using `binaryUploadProcedure` (same handler, different transport)
4. Add RunPod webhook handler for transcoding completion
5. Update media status through the lifecycle

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| Using `multipartProcedure` for videos | Worker bandwidth + memory cost | Presigned R2 URL |
| Using `binaryUploadProcedure` in prod | Same as above | Presigned URL |
| Skipping magic byte validation | Defence has one layer, bypassable | `validateImageSignature` after MIME check |
| Skipping SVG sanitization | XSS on render | `sanitizeSvgContent` |
| Hand-rolled R2 keys | Inconsistent, hard to migrate | `getUserAvatarKey`/etc from `@codex/transcoding` |
| Storing raw images without WebP conversion | Larger files, slower delivery | `ImageProcessingService.processToVariants` |
| Mutable cache on immutable-keyed assets | Can't be fresh, but breaks if key reused | Match cache to mutation strategy |
| `Cache-Control: no-cache` on immutable assets | CDN hit rate dies | `public, max-age=31536000, immutable` |
| Trusting client-declared file name for path | Path traversal | Use UUID or opaque key |
| Trusting client-declared MIME | Lies | Magic byte validation |
| Returning presigned URL without size constraint | Abuse vector (upload anything) | `content-length-range` in signed URL policy (if supported) |
| Not invalidating status on upload failure | Stuck in 'uploading' forever | Status transition on failure + cleanup job |
| Mounting `binaryUploadProcedure` fallback route unconditionally | Lets any caller stream 5GB through the worker in prod | Gate with `env.ENVIRONMENT !== 'production'` inside the handler, or mount route conditionally |
| Idempotent-completion endpoint returning 409 on already-advanced state | Breaks legitimate retries on flaky networks | Return 200 `{ alreadyCompleted: true, status }` for already-finished states; 409 only for truly invalid transitions |
| Skipping magic-byte validation on media/binary uploads | Text renamed to `.mp4` eats RunPod budget + R2 quota | Add container signature check (`ftyp`, `RIFF`, `OggS`, etc.) before `r2.put` |
| No cron recovery path paired with async dispatch flow | Stuck-in-`transcoding` if the webhook never fires | Add `recoverStuckTranscoding`-style scheduled cleanup that transitions past a max-age threshold |

---

## Debugging Uploads

1. **413 Payload Too Large** — file exceeds `maxSize` or worker body limit (100MB). Switch to presigned.
2. **400 Invalid MIME** — header `Content-Type` doesn't match allowlist. Check client send.
3. **Presigned URL 403** — expired (1 hour). Regenerate.
4. **Upload succeeded but file not appearing** — client used different content-type than declared. R2 rejected but silently. Check R2 logs.
5. **WebP variants not generated** — check Photon WASM loaded (sometimes flaky in dev). Restart worker.
6. **SVG sanitization stripping everything** — real malicious content, or over-aggressive config. Check `sanitizeSvgContent` options.
7. **Dev CDN returning 404** — bucket binding mismatch. Check `dev-cdn/wrangler.toml`.
8. **Mobile device can't reach dev CDN** — `cdnRewriteHook` not applying. Check `hooks.server.ts` + nip.io DNS resolution.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/worker-utils/src/procedure/multipart-procedure.ts`
- `packages/worker-utils/src/procedure/binary-upload-procedure.ts`
- `packages/cloudflare-clients/src/r2/services/r2-service.ts`
- `packages/image-processing/src/service.ts`
- `packages/transcoding/src/paths.ts` (R2 key formats)
- `packages/constants/src/limits.ts` (file size limits)
- `workers/dev-cdn/src/index.ts` (local proxy)
