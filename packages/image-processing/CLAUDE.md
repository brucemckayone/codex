# @codex/image-processing Package Documentation

## Overview

The `@codex/image-processing` package provides image upload validation, Wasm-based processing, and R2 storage coordination for static image assets in the Codex platform. This package handles:

- **Content Thumbnails**: Custom thumbnails for video/audio/written content (sm/md/lg WebP variants)
- **User Avatars**: Profile images with automatic resizing (sm/md/lg WebP variants)
- **Organization Logos**: Brand logos supporting both raster (WebP variants) and SVG formats

The package integrates with `@cf-wasm/photon` for browser/Workers-compatible image processing, converting uploads to optimized WebP format with multiple size variants.

---

## Public API

### Exported Services

| Export | Type | Purpose | Use When |
|--------|------|---------|----------|
| `ImageProcessingService` | Class | Coordinates image validation, R2 upload, and database updates | Processing thumbnails, avatars, or logos |

### Exported Error Classes

| Error | Extends | Purpose | Common Cause | HTTP Status |
|-------|---------|---------|--------------|-------------|
| `InvalidImageError` | `ValidationError` | Image validation failed | Corrupt image, wrong MIME type, signature mismatch | 400 |
| `ImageUploadError` | `ValidationError` | Upload processing failed | File too large, empty file, unsupported format | 400 |

### Exported Utilities (re-exported from @codex/validation)

| Export | Type | Purpose |
|--------|------|---------|
| `MAX_IMAGE_SIZE_BYTES` | Constant | Maximum file size (5MB) |
| `SUPPORTED_IMAGE_MIME_TYPES` | Set | PNG, JPEG, WebP, GIF |
| `validateImageSignature` | Function | Verify magic bytes match claimed MIME type |
| `validateImageUpload` | Function | Full upload validation (size, MIME, signature) |
| `extractMimeType` | Function | Extract MIME type from Content-Type header |

### Exported Types

| Type | Purpose |
|------|---------|
| `ImageProcessingResult` | Return type with url, size, mimeType |

---

## Core Service

### ImageProcessingService

Coordinates image validation, Wasm processing, R2 storage, and database updates.

#### Constructor

```typescript
constructor(config: ServiceConfig & { r2Service: R2Service; r2PublicUrlBase: string })
```

**Parameters:**
- `config.db` - Drizzle ORM database instance
- `config.environment` - Environment name
- `config.r2Service` - R2Service instance for storage operations
- `config.r2PublicUrlBase` - Base URL for public R2 access (e.g., `https://media.example.com`)

#### Methods

##### processContentThumbnail

```typescript
async processContentThumbnail(
  contentId: string,
  creatorId: string,
  file: File
): Promise<ImageProcessingResult>
```

Processes uploaded image into three WebP variants (sm: 200px, md: 400px, lg: 800px) and stores in R2.

**Flow:**
1. Validate file (MIME type, size, magic bytes)
2. Process through Wasm/Photon (resize, convert to WebP)
3. Upload three variants to R2 in parallel
4. Update content.thumbnailUrl in database
5. On DB failure: cleanup R2 files to prevent orphans

**R2 Keys:** `{creatorId}/content-thumbnails/{contentId}/{size}.webp`

---

##### processUserAvatar

```typescript
async processUserAvatar(
  userId: string,
  file: File
): Promise<ImageProcessingResult>
```

Processes user avatar into three WebP variants.

**R2 Keys:** `avatars/{userId}/{size}.webp`

---

##### processOrgLogo

```typescript
async processOrgLogo(
  organizationId: string,
  creatorId: string,
  file: File
): Promise<ImageProcessingResult>
```

Processes organization logo. SVG files are sanitized and stored as-is; raster images are converted to WebP variants.

**SVG Handling:**
- Sanitized via DOMPurify (removes scripts, event handlers, dangerous URIs)
- Stored as single file: `{creatorId}/branding/logo/logo.svg`
- Uses 1-hour cache (not immutable) to allow updates

**Raster Handling:**
- Converted to three WebP variants
- Uses immutable cache (1 year)

---

##### deleteContentThumbnail

```typescript
async deleteContentThumbnail(contentId: string, creatorId: string): Promise<void>
```

Deletes all three thumbnail variants from R2 and clears thumbnailUrl in database.

---

##### deleteUserAvatar

```typescript
async deleteUserAvatar(userId: string): Promise<void>
```

Deletes all three avatar variants from R2 and clears avatarUrl in database.

---

##### deleteOrgLogo

```typescript
async deleteOrgLogo(organizationId: string): Promise<void>
```

Deletes logo from R2 (handles both SVG single file and raster variants) and clears logoUrl in database.

---

## Image Processing Pipeline

### Wasm/Photon Integration

The package uses `@cf-wasm/photon` for image processing, wrapped in `SafePhotonImage` for memory safety.

```
Input Buffer (JPEG/PNG/WebP/GIF)
    ↓
SafePhotonImage.fromBuffer() — Load into Wasm
    ↓
Calculate dimensions (preserve aspect ratio, never upscale)
    ↓
Resize using Lanczos3 (high quality)
    ↓
getBytesWebP() — Convert to WebP
    ↓
.free() — Release Wasm memory
```

### Memory Safety

`SafePhotonImage` wraps Photon's `PhotonImage` to ensure:
- Explicit `.free()` calls release Wasm memory
- Double-free is safe (idempotent)
- Use-after-free throws descriptive error
- try/finally pattern ensures cleanup on exceptions

```typescript
const image = SafePhotonImage.fromBuffer(buffer);
try {
  const resized = image.resize(400, 300, 1);
  try {
    return resized.getBytesWebP();
  } finally {
    resized.free();
  }
} finally {
  image.free();
}
```

### Variant Sizes

| Variant | Width | Use Case |
|---------|-------|----------|
| `sm` | 200px | Thumbnails in lists, small previews |
| `md` | 400px | Cards, medium displays |
| `lg` | 800px | Full-size display, hero images |

Images are never upscaled. If original is smaller than target, original dimensions are used.

---

## SVG Security

SVG files are sanitized using DOMPurify with strict configuration:

**Allowed:** svg, path, circle, rect, g, defs, use, linearGradient, stop

**Blocked:**
- `<script>` tags
- Event handlers (onclick, onerror, etc.)
- `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`
- `javascript:` and `data:` URIs
- `<image>` tags (prevent SSRF)

Files that sanitize to empty content are rejected as potentially malicious.

---

## Validation

### File Size
- Maximum: 5MB (`MAX_IMAGE_SIZE_BYTES`)
- Empty files rejected

### MIME Types
- **Raster:** `image/png`, `image/jpeg`, `image/webp`, `image/gif`
- **SVG:** `image/svg+xml` (logos only, not thumbnails/avatars)

### Magic Byte Verification
- PNG: `\x89PNG\r\n\x1a\n`
- JPEG: `\xFF\xD8\xFF`
- WebP: `RIFF____WEBP`
- GIF: `GIF89a` or `GIF87a`
- SVG: `<?xml` or `<svg` (plus structure validation)

Files with mismatched MIME type and magic bytes are rejected (prevents spoofing attacks).

---

## R2 Storage

### Cache Headers

| Type | Cache-Control | Reason |
|------|---------------|--------|
| Raster variants | `public, max-age=31536000, immutable` | Content-addressed keys, never change |
| SVG logos | `public, max-age=3600` | Fixed filename, needs update propagation |

### Key Structure

```
{creatorId}/content-thumbnails/{contentId}/sm.webp
{creatorId}/content-thumbnails/{contentId}/md.webp
{creatorId}/content-thumbnails/{contentId}/lg.webp
avatars/{userId}/sm.webp
avatars/{userId}/md.webp
avatars/{userId}/lg.webp
{creatorId}/branding/logo/sm.webp
{creatorId}/branding/logo/md.webp
{creatorId}/branding/logo/lg.webp
{creatorId}/branding/logo/logo.svg
```

### Orphan Prevention

If database update fails after R2 upload:
1. R2 files are deleted in cleanup
2. Error is logged if cleanup fails
3. Original error is re-thrown

---

## Error Handling

### Validation Errors

| Scenario | Error |
|----------|-------|
| File too large (>5MB) | `ValidationError: File size exceeds maximum...` |
| Empty file | `ValidationError: File cannot be empty` |
| Unsupported MIME | `ValidationError: Unsupported MIME type...` |
| Magic byte mismatch | `ValidationError: File content does not match...` |
| Too small (<4 bytes) | `ValidationError: File is too small to validate...` |

### Processing Errors

| Scenario | Error |
|----------|-------|
| Corrupt image | `Error: Failed to load image in Photon...` |
| SVG sanitizes empty | `Error: SVG sanitization resulted in empty content...` |

---

## Integration

### Worker Integration

```typescript
import { ImageProcessingService } from '@codex/image-processing';
import { R2Service } from '@codex/cloudflare-clients';

// In worker setup
const imageProcessing = new ImageProcessingService({
  db: dbHttp,
  environment: 'production',
  r2Service: new R2Service(env.MEDIA_BUCKET),
  r2PublicUrlBase: env.R2_PUBLIC_URL_BASE,
});

// In route handler
const result = await imageProcessing.processContentThumbnail(
  contentId,
  user.id,
  file
);
```

### Service Registry

Add to `createServiceRegistry()` in worker-utils:

```typescript
imageProcessing: createLazy(() =>
  new ImageProcessingService({
    db: c.get('db'),
    environment: c.var.environment,
    r2Service: new R2Service(c.env.MEDIA_BUCKET),
    r2PublicUrlBase: c.env.R2_PUBLIC_URL_BASE,
  })
),
```

---

## Testing

### Unit Tests (44 total)

**service.test.ts (34 tests):**
- Content thumbnail processing
- User avatar processing
- Organization logo processing (raster + SVG)
- Delete operations
- Error handling (size, MIME, magic bytes, R2, database)
- Edge cases (empty files, Unicode names, formats)

**stability.test.ts (10 tests):**
- Memory safety patterns
- Variant configuration
- Error handling patterns
- Format validation

### Running Tests

```bash
cd packages/image-processing
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage
```

---

## Dependencies

### Internal Packages

| Package | Purpose |
|---------|---------|
| `@codex/cloudflare-clients` | R2Service for storage |
| `@codex/database` | Database schema and client |
| `@codex/service-errors` | BaseService, ValidationError |
| `@codex/transcoding` | R2 key generation functions |
| `@codex/validation` | Image validation utilities |

### External Packages

| Package | Purpose |
|---------|---------|
| `@cf-wasm/photon` | Wasm image processing |
| `isomorphic-dompurify` | SVG sanitization |

---

## Quick Reference

### Common Operations

```typescript
// Process content thumbnail
const result = await imageProcessing.processContentThumbnail(contentId, creatorId, file);
// Returns: { url, size, mimeType }

// Process user avatar
const result = await imageProcessing.processUserAvatar(userId, file);

// Process org logo (supports SVG)
const result = await imageProcessing.processOrgLogo(orgId, creatorId, file);

// Delete operations
await imageProcessing.deleteContentThumbnail(contentId, creatorId);
await imageProcessing.deleteUserAvatar(userId);
await imageProcessing.deleteOrgLogo(orgId);
```

### Supported Formats

| Format | Thumbnail | Avatar | Logo |
|--------|-----------|--------|------|
| PNG | ✓ | ✓ | ✓ |
| JPEG | ✓ | ✓ | ✓ |
| WebP | ✓ | ✓ | ✓ |
| GIF | ✓ | ✓ | ✓ |
| SVG | ✗ | ✗ | ✓ |

---

**Last Updated:** 2025-02-01
**Test Coverage:** 44 tests (34 service + 10 stability)
