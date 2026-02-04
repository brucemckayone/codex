# @codex/image-processing

Image upload validation, Wasm processing, and R2 storage. Handles content thumbnails, user avatars, and org logos (raster/SVG). Integrates with `@cf-wasm/photon`.

## API

### Service: `ImageProcessingService`
- **processContentThumbnail**: Validates, resizes to 3 variants (sm/md/lg WebP), uploads to R2, updates DB.
- **processUserAvatar**: Validates, resizes to 3 variants, uploads to R2, updates DB.
- **processOrgLogo**: Validates. SVGs sanitized/stored as-is. Raster converted to 3 WebP variants.
- **delete***: Removes R2 files and clears DB fields.

### Errors
- `InvalidImageError` (400): Corrupt, wrong MIME, signature mismatch.
- `ImageUploadError` (400): Too large, empty, unsupported.

### Config
- `MAX_IMAGE_SIZE_BYTES`: 5MB.
- `SUPPORTED_IMAGE_MIME_TYPES`: PNG, JPEG, WebP, GIF.

## Pipeline
1. **Validation**: Check size, MIME, magic bytes.
2. **Processing**: `@cf-wasm/photon` (safe wrapper) -> resize (Lanczos3) -> WebP. Never upscales.
3. **Storage**: R2.
   - Raster: Immutable cache (1yr).
   - SVG: Sanitized (DOMPurify), 1hr cache.
   - **Keys**: `{creatorId}/{type}/{id}/{size}.webp`.

## Integration
```ts
const proc = new ImageProcessingService({ db, r2Service, ... });
await proc.processContentThumbnail(contentId, userId, file);
```

## Standards
- **Assert**: `invariant()` for preconditions/state.
- **Scope**: MANDATORY `where(eq(creatorId, ...))`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
