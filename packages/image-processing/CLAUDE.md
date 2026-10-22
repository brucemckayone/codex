# @codex/image-processing

Image upload validation, WASM-based resizing/conversion, and R2 storage. Handles content thumbnails, user avatars, category covers, and course cover/hero/signature stills.

**RASTER ONLY, and NOT org logos.** Org logos live entirely in `@codex/platform-settings` `BrandingSettingsService` (`uploadLogo` / `deleteLogo`, one object at `logos/{orgId}/logo.{ext}`, `brandingSettings.logoUrl`). This package used to carry a second, parallel org-logo implementation — `processOrgLogo` wrote three variants under `{orgId}/branding/logo/` and `organizations.logoUrl`, `deleteOrgLogo` removed them — with ZERO call sites anywhere in the repo; both were removed in Codex-z520h. If responsive logo variants are wanted, that is a feature to add to the live path, not dead code to revive.

## Key Exports

- **`ImageProcessingService`** — Primary service class
- **`OrphanedFileService`** — Tracks and cleans up R2 files that lost their DB record
- **`ImageUploadError`** — File too large or empty (400)
- **`InvalidImageError`** — Corrupt or undecodable file, a header whose size cannot be read, over `MAX_IMAGE_PIXELS`, wrong MIME type, magic byte mismatch (400)
- Re-exported from `@codex/validation`: `validateImageUpload`, `validateImageSignature`, `extractMimeType`, `MAX_IMAGE_SIZE_BYTES`, `SUPPORTED_IMAGE_MIME_TYPES`

## ImageProcessingService

**Constructor config**:
```ts
new ImageProcessingService({
  db: dbWs,
  environment: 'production',
  r2Service: r2,                   // R2Service instance (ASSETS_BUCKET)
  r2PublicUrlBase: 'https://...',  // Public URL base for constructing image URLs
  orphanedFileService?: svc,       // Optional in the type, MANDATORY in production
})
```

**The service registry passes `orphanedFileService` to every ImageProcessingService it builds** — `imageProcessing` directly, `identity` through to `uploadAvatar` (Codex-r85jo.3). Without it, failed R2 deletes are only logged and media-api's `OrphanedFileCleanupDO` drains a table nothing writes. Write orphan records through `recordOrphansOrLog` (`utils/upload-pipeline.ts`), never a bare `recordOrphanedFiles`: every caller is on a failure path, and an unguarded insert rejection replaces the original error or skips the DB clear.

| Method | Purpose | Output |
|---|---|---|
| `processContentThumbnail(contentId, userId, file)` | Validate → resize → upload | Four files in a new folder (see R2 Key Format); writes its `lg` URL, then deletes the thumbnail it replaced |
| `processUserAvatar(userId, file)` | Validate → resize → upload | Same, for `users.avatarUrl` |
| `processCategoryCover(categoryId, file)` | Validate → resize → upload | Four files in a new folder; returns the folder's key, does NOT write the DB |
| `processCourseCover(courseId, file)` / `processCourseHero` / `processCourseSignature` | Validate → resize → upload | Same as the category cover |
| `persistStillWithOrphanCleanup({ key, storedKey, imageType, entityType, entityId }, dbWrite)` | Run the CALLER's key write for one of the four stills above | A failed write deletes the new folder (unless its row names it after all, see DB update below) and rethrows; a successful one deletes `storedKey`'s folder. **Every caller of the four `process*` stills MUST wrap its DB write in this** (Codex-29fs0), with `storedKey` read BEFORE the upload |
| `deleteDroppedStill({ imageType, entityType, entityId, droppedKey })` | After the CALLER cleared or hand-changed one of those keys | Deletes the folder the old key named. **Every DELETE or PATCH that drops a still key MUST call it**, or the folder is kept forever |
| `deleteDroppedContentThumbnail(contentId, userId, droppedUrl)` | After a content update moved `thumbnailUrl` off an upload | The content-api PATCH route calls it with `ContentService.updateReportingDroppedThumbnail`'s `droppedThumbnailUrl` |
| `deleteContentThumbnail(contentId, userId)` | Clear the URL, then delete the folder it named | |
| `deleteUserAvatar(userId)` | Clear the URL, then delete the folder it named | `true` if there was an upload to remove. Reads the URL with `SELECT … FOR UPDATE` and clears it in the same transaction (Codex-kk9nv.17), so a concurrent upload either commits first and is the one removed, or waits and lands on the cleared row. Needs a db that runs transactions |
| `avatarCachePrefix(userId)` | The CDN prefix every avatar of the user is served under, current and replaced | `{host}{path}/avatars/{userId}`, no scheme, the form a prefix purge takes (Codex-kk9nv.15) |

Returns `ImageProcessingResult: { url: string, size: number, mimeType: string }`. The picture's size is in the URL (see R2 Key Format).

**Only a folder of the entity's own is ever deleted** (`ownedStillFolder`, `ownContentThumbnailFolder`). `thumbnailUrl` and `coverImageKey` can be set by hand through PATCH, so a stored address may name a poster frame or another entity's picture; those are never touched.

## Processing Pipeline

1. **Validation**: size ≤ 5MB, MIME type must be in `SUPPORTED_IMAGE_MIME_TYPES` (PNG, JPEG, WebP, GIF — no SVG, no opt-out), magic bytes verified against MIME
2. **Size check, before any decode** (Codex-kk9nv.12): `readImageDimensions` (`image-dimensions.ts`) reads width x height from the JPEG/PNG/WebP/GIF header, and over `MAX_IMAGE_PIXELS` (1600 x 1600, from `@codex/validation`) is an `InvalidImageError`. A Worker isolate has **128 MB for the JS heap and Wasm together**, and Photon's decode alone peaks at about 11 bytes a pixel: a 12 MP phone photo needs 137 MB, so it killed the isolate (error 1102) where no handler or log could see it. The studio shrinks every photo in the browser first (`apps/web/src/lib/utils/shrink-photo.ts`), so only a caller that skips the studio meets the limit. **Never raise `MAX_IMAGE_PIXELS` without re-measuring the Wasm peak** (`chunk.initSync().memory.buffer.byteLength` after a run; Wasm memory never shrinks, so that is the peak).
3. **Processing**: `@cf-wasm/photon` (Cloudflare-compatible WASM) — Lanczos3 resize, WebP conversion. NEVER upscales. The LARGEST variant is made from the decode, the decode is freed at once, and every smaller variant is made from that largest one and freed as soon as it is encoded: `resize` clones its source and builds a 16-byte-a-pixel float intermediate as wide as the source, so holding the decode while making every variant from it peaked at 81 MB on a 2000x1280 page image (this order: 65). A file that will not decode is an `InvalidImageError` (400), not a 500. Every still goes through `processStillVariants`. The picture is turned upright from the JPEG's EXIF orientation (`exif-orientation.ts`, Codex-kk9nv.11): Photon ignores that tag and WebP drops it, so without this a phone portrait was stored sideways. Every size is the upright picture's; each variant is resized in the stored orientation and only that small output is turned. 2, 3 and 4 are exact in-place flips; a quarter turn (5-8) is a pixel remap in JS (`quarterTurned`). **Never use Photon's `rotate`**: at every angle it leaves the right two columns and the bottom row transparent.
4. **Storage** → R2 via `ASSETS_BUCKET` (falls back to `MEDIA_BUCKET`):
   - Raster variants: `cacheControl: R2_IMMUTABLE_OBJECT_CACHE_CONTROL` from
     `@codex/constants` — **never a string written in this package.**
   - **`immutable` is safe ONLY because no key is ever written twice**
     (Codex-kk9nv.5, owner: "Cache forever"). Until then every key was a pure
     function of `(entityId, size)` and was overwritten in place, so
     `immutable` served a replaced image for a year (Codex-p3rre) and the
     header was `R2_OVERWRITTEN_OBJECT_CACHE_CONTROL`. **Never write a still to
     a key it has used before.** The invariant and its premise are pinned by
     `src/__tests__/fresh-key-cache-control.test.ts`.
   - A failed put deletes whatever landed in the new folder; nothing references
     it yet, and the previous picture is in another folder.
5. **DB update**: writes the new folder's URL or key, then deletes the folder the row held before, in the same request (owner: "Inline, same request"). A failed write deletes the new folder instead, unless its row names it after all: a write can commit and still report failure (a lost COMMIT ack), and the discard would break the picture (Codex-kk9nv.16). So a failed write first asks `isStillFolderReferenced`, the sweep's own question. If the row names the new folder, it is kept and the replaced folder is deleted, as on success, and the error is still rethrown. If the row cannot be read either, the new folder is recorded as an orphan for the sweep, which asks again before deleting. Otherwise only a delete that fails writes an orphan row.

## R2 Key Format

R2 key builders come from `@codex/transcoding`:
- `getContentThumbnailKey(creatorId, contentId, size)` → `{creatorId}/content-thumbnails/{contentId}/{size}.webp`
- `getUserAvatarKey(userId, size)` → `avatars/{userId}/{size}.webp`
- `getOrgLogoKey(orgId, size)` → `{orgId}/branding/logo/{size}.webp` — **this package no longer writes or reads it** (Codex-z520h). It survives because the local dev seeds (`packages/database/scripts/seed/{r2,organizations}.ts`) still populate that key shape and `organizations.logoUrl`, whereas the live upload path writes `logos/{orgId}/logo.{ext}` and `brandingSettings.logoUrl`. Two shapes, two columns — a pre-existing divergence, not something this package arbitrates.
- `getContentThumbnailBaseKey` / `getUserAvatarBaseKey` give a still's BASE; category and course bases (`categories/{id}/cover`, `courses/{id}/{cover,hero,signature}`) are `CALLER_OWNED_STILL_BASE` in `service.ts`.
- **Each upload writes a new folder under the base: `{base}/{w}x{h}-{8 hex}/{sm,md,lg,xl}.webp`** (Codex-kk9nv.5), the picture's upright size and a nonce. The row's URL or key names that folder, so the size travels with the address and no column holds it (owner: "shouldnt it be prat of the file name"). `stillFolderName` / `readStillFolderName` in `@codex/validation` are the one definition of the name, for the server and the web.
- An image uploaded before kk9nv.5 has its files directly at `{base}/{size}.webp` (sm/md/lg only) and no size in its address: "size unknown". It stays until the backfill; replacing or deleting it removes exactly those files, never the folders beside them.
- `stillVariantKeys(folder)` names every file in a folder (one definition for upload and cleanup).

## Size Variants

| Variant | Use Case |
|---|---|
| `sm` | 200px: card thumbnails, compact lists |
| `md` | 400px: standard display, feeds |
| `lg` | 800px: hero, full-size (the URL every old image has) |
| `xl` | min(1600, width): full-bleed at 1440 and 2x (Codex-kk9nv.5) |

Every cleanup list goes through `variantKeyList(stillVariantKeys(folder))`, so it names all four, or `xl` leaks.

**The upload itself is NOT kept** (owner, 2026-10-21: "Defer originals (Recommended)"). The assets bucket is public and every served URL shows its base key, so `{base}/original` would serve the photo's raw EXIF (GPS, capture time, device serial) to anyone who swaps `lg.webp` for `original`. Keeping originals needs its own design, in a private store.

## Strict Rules

- **MUST** validate MIME type AND magic bytes — NEVER trust `Content-Type` header alone
- **MUST** reject SVG. `validateImageFile` is raster-only with no opt-out, because `processStillVariants` decodes via Photon which cannot rasterise SVG. The one path on this platform that accepts SVG is `BrandingSettingsService.uploadLogo`, and it **MUST** sanitize with `sanitizeSvgContent()` — unsanitized SVGs are stored XSS vectors
- **MUST** scope operations by `creatorId` / `userId` / `orgId`
- **MUST** use `ASSETS_BUCKET` binding (not `MEDIA_BUCKET`) for public images — see service-registry for binding fallback logic
- **MUST** provide `R2_PUBLIC_URL_BASE` env var — required to construct public image URLs
- **NEVER** upscale images
- **NEVER** store unsanitized SVG

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2), `@codex/constants` (`R2_IMMUTABLE_OBJECT_CACHE_CONTROL`), `@codex/validation` (image validation, still folder names), `@codex/transcoding` (key builders), `@cf-wasm/photon`
- **Used by**: content-api (thumbnails, category covers, course stills), identity-api (avatars) — via `ctx.services.imageProcessing` in `procedure()` handlers. NOT organization-api: its `POST/DELETE /branding/logo` routes go to `ctx.services.settings` (`@codex/platform-settings`), which owns org logos end to end.

## Reference Files

- `packages/image-processing/src/service.ts` — ImageProcessingService
- `packages/image-processing/src/processor.ts` — processStillVariants (WASM resize logic)
- `packages/image-processing/src/orphaned-file-service.ts` — OrphanedFileService
