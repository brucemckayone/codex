# @codex/image-processing

Image upload validation, WASM-based resizing/conversion, and R2 storage. Handles content thumbnails, user avatars, category covers, and course cover/hero/signature stills.

**RASTER ONLY, and NOT org logos.** Org logos live entirely in `@codex/platform-settings` `BrandingSettingsService` (`uploadLogo` / `deleteLogo`, one object at `logos/{orgId}/logo.{ext}`, `brandingSettings.logoUrl`). This package used to carry a second, parallel org-logo implementation — `processOrgLogo` wrote three variants under `{orgId}/branding/logo/` and `organizations.logoUrl`, `deleteOrgLogo` removed them — with ZERO call sites anywhere in the repo; both were removed in Codex-z520h. If responsive logo variants are wanted, that is a feature to add to the live path, not dead code to revive.

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
| `processCategoryCover(categoryId, file)` | Validate → resize → upload | 3 WebP variants; returns the base key, does NOT write the DB |
| `processCourseCover(courseId, file)` / `processCourseHero` / `processCourseSignature` | Validate → resize → upload | 3 WebP variants; returns the base key, does NOT write the DB |
| `deleteContentThumbnail(contentId, userId)` | Delete R2 files + clear DB field | |
| `deleteUserAvatar(userId)` | Delete R2 files + clear DB field | |

Returns `ImageProcessingResult: { url: string, size: number, mimeType: string }`.

## Processing Pipeline

1. **Validation**: size ≤ 5MB, MIME type must be in `SUPPORTED_IMAGE_MIME_TYPES` (PNG, JPEG, WebP, GIF — no SVG, no opt-out), magic bytes verified against MIME
2. **Processing**: `@cf-wasm/photon` (Cloudflare-compatible WASM) — Lanczos3 resize, WebP conversion. NEVER upscales.
3. **Storage** → R2 via `ASSETS_BUCKET` (falls back to `MEDIA_BUCKET`):
   - Raster variants: `Cache-Control: public, max-age=3600, must-revalidate`
   - **NEVER `immutable`, and NEVER a multi-hour window.** Every key this
     package writes is a pure function of `(entityId, size)` and is overwritten
     in place on re-upload, and the public URL carries no version or hash — so a
     cache told not to revalidate keeps serving the REPLACED image with no purge
     path. This was `max-age=31536000, immutable` (one year) until Codex-p3rre;
     the full reasoning for the value, and for the deliberately absent
     `s-maxage`, is on `IMAGE_VARIANT_PUT_OPTIONS` in
     `src/utils/upload-pipeline.ts`, and the invariant is pinned by
     `src/__tests__/deterministic-key-cache-control.test.ts`.
4. **DB update**: writes URL to content/user/org record

## R2 Key Format

R2 key builders come from `@codex/transcoding`:
- `getContentThumbnailKey(creatorId, contentId, size)` → `{creatorId}/content-thumbnails/{contentId}/{size}.webp`
- `getUserAvatarKey(userId, size)` → `avatars/{userId}/{size}.webp`
- `getOrgLogoKey(orgId, size)` → `{orgId}/branding/logo/{size}.webp` — **this package no longer writes or reads it** (Codex-z520h). It survives because the local dev seeds (`packages/database/scripts/seed/{r2,organizations}.ts`) still populate that key shape and `organizations.logoUrl`, whereas the live upload path writes `logos/{orgId}/logo.{ext}` and `brandingSettings.logoUrl`. Two shapes, two columns — a pre-existing divergence, not something this package arbitrates.
- Category and course stills are built inline, not via `@codex/transcoding`: `categories/{id}/cover/{size}.webp`, `courses/{id}/{cover,hero,signature}/{size}.webp`.

## Size Variants

| Variant | Use Case |
|---|---|
| `sm` | Card thumbnails, compact lists |
| `md` | Standard display, feeds |
| `lg` | Hero, full-size |

## Strict Rules

- **MUST** validate MIME type AND magic bytes — NEVER trust `Content-Type` header alone
- **MUST** reject SVG. `validateImageFile` is raster-only with no opt-out, because `processImageVariants` decodes via Photon which cannot rasterise SVG. The one path on this platform that accepts SVG is `BrandingSettingsService.uploadLogo`, and it **MUST** sanitize with `sanitizeSvgContent()` — unsanitized SVGs are stored XSS vectors
- **MUST** scope operations by `creatorId` / `userId` / `orgId`
- **MUST** use `ASSETS_BUCKET` binding (not `MEDIA_BUCKET`) for public images — see service-registry for binding fallback logic
- **MUST** provide `R2_PUBLIC_URL_BASE` env var — required to construct public image URLs
- **NEVER** upscale images
- **NEVER** store unsanitized SVG

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2), `@codex/validation` (image validation), `@codex/transcoding` (key builders), `@cf-wasm/photon`
- **Used by**: content-api (thumbnails, category covers, course stills), identity-api (avatars) — via `ctx.services.imageProcessing` in `procedure()` handlers. NOT organization-api: its `POST/DELETE /branding/logo` routes go to `ctx.services.settings` (`@codex/platform-settings`), which owns org logos end to end.

## Reference Files

- `packages/image-processing/src/service.ts` — ImageProcessingService
- `packages/image-processing/src/processor.ts` — processImageVariants (WASM resize logic)
- `packages/image-processing/src/orphaned-file-service.ts` — OrphanedFileService
