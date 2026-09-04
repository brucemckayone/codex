# @codex/image-processing

Image upload validation, WASM-based resizing/conversion, and R2 storage. Handles content thumbnails, user avatars, and org logos (raster and SVG).

## Key Exports

- **`ImageProcessingService`** — Primary service class
- **`OrphanedFileService`** — Tracks and cleans up R2 files that lost their DB record
- **`ImageUploadError`** — File too large or empty (400)
- **`InvalidImageError`** — Corrupt file, wrong MIME type, magic byte mismatch (400)
- Re-exported from `@codex/validation`: `validateImageUpload`, `validateImageSignature`, `extractMimeType`, `MAX_IMAGE_SIZE_BYTES`, `SUPPORTED_IMAGE_MIME_TYPES`

## ImageProcessingService

**Constructor config**:
```ts
new ImageProcessingService({
  db: dbWs,
  environment: 'production',
  r2Service: r2,                   // R2Service instance (ASSETS_BUCKET)
  r2PublicUrlBase: 'https://...',  // Public URL base for constructing image URLs
  orphanedFileService?: svc,       // Optional — track R2 orphans
})
```

| Method | Purpose | Output |
|---|---|---|
| `processContentThumbnail(contentId, userId, file)` | Validate → resize → upload | 3 WebP variants (sm/md/lg) stored in R2 |
| `processUserAvatar(userId, file)` | Validate → resize → upload | 3 WebP variants |
| `processOrgLogo(orgId, userId, file)` | Validate → process → upload | SVG: sanitize + store; Raster: 3 WebP variants |
| `deleteContentThumbnail(contentId, userId)` | Delete R2 files + clear DB field | |
| `deleteUserAvatar(userId)` | Delete R2 files + clear DB field | |
| `deleteOrgLogo(orgId, userId)` | Delete R2 files + clear DB field | |

Returns `ImageProcessingResult: { url: string, size: number, mimeType: string }`.

## Processing Pipeline

1. **Validation**: size ≤ 5MB, MIME type must be in `SUPPORTED_IMAGE_MIME_TYPES` (PNG, JPEG, WebP, GIF — SVG only for logos), magic bytes verified against MIME
2. **Processing**: `@cf-wasm/photon` (Cloudflare-compatible WASM) — Lanczos3 resize, WebP conversion. NEVER upscales.
3. **Storage** → R2 via `ASSETS_BUCKET` (falls back to `MEDIA_BUCKET`):
   - Raster variants: `Cache-Control: public, max-age=31536000` (immutable, 1 year)
   - SVG logos: sanitized via `sanitizeSvgContent()`, `Cache-Control: public, max-age=3600`
4. **DB update**: writes URL to content/user/org record

## R2 Key Format

R2 key builders come from `@codex/transcoding`:
- `getContentThumbnailKey(creatorId, contentId, size)` → `{creatorId}/content-thumbnails/{contentId}/{size}.webp`
- `getUserAvatarKey(userId, size)` → `avatars/{userId}/{size}.webp`
- `getOrgLogoKey(orgId, size)` → `{orgId}/branding/logo/{size}.webp` (SVG variant written inline by `processOrgLogo` as `{orgId}/branding/logo/logo.svg`). Note: `@codex/platform-settings` `BrandingSettingsService` instead writes org logos inline to `logos/{orgId}/logo.{ext}`.

## Size Variants

| Variant | Use Case |
|---|---|
| `sm` | Card thumbnails, compact lists |
| `md` | Standard display, feeds |
| `lg` | Hero, full-size |

## Strict Rules

- **MUST** validate MIME type AND magic bytes — NEVER trust `Content-Type` header alone
- **MUST** sanitize ALL SVG uploads with `sanitizeSvgContent()` — unsanitized SVGs are XSS vectors
- **MUST** scope operations by `creatorId` / `userId` / `orgId`
- **MUST** use `ASSETS_BUCKET` binding (not `MEDIA_BUCKET`) for public images — see service-registry for binding fallback logic
- **MUST** provide `R2_PUBLIC_URL_BASE` env var — required to construct public image URLs
- **NEVER** upscale images
- **NEVER** store unsanitized SVG

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2), `@codex/validation` (SVG sanitization + image validation), `@codex/transcoding` (key builders), `@cf-wasm/photon`
- **Used by**: content-api (thumbnails), identity-api (avatars), organization-api (logos) — all via `ctx.services.imageProcessing` in `procedure()` handlers

## Reference Files

- `packages/image-processing/src/service.ts` — ImageProcessingService
- `packages/image-processing/src/processor.ts` — processImageVariants (WASM resize logic)
- `packages/image-processing/src/orphaned-file-service.ts` — OrphanedFileService
