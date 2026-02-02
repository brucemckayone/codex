# P1-IMG-001: Image Processing Pipeline

**Priority**: P1
**Status**: ✅ Complete (Phase 3)
**Estimated Effort**: 4-5 days
**Actual Effort**: ~5 days (Phase 1-3)
**Completed**: 2026-02-01

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

The Image Processing Pipeline handles validation, processing, and storage of user-uploaded static images across the platform. Unlike video thumbnails (auto-extracted via RunPod), this covers custom images that users manually upload: content thumbnails, organization logos, and user avatars.

This service bridges file upload validation in `@codex/validation` with image optimization (resize, format conversion) and R2 storage. Every uploaded image goes through magic byte validation (preventing MIME spoofing), size/dimension checks, and **Wasm-based optimization using `@cf-wasm/photon`** to generate multiple sizes in WebP format.

The pipeline supports three distinct image types with different requirements:
- **Content Thumbnails**: Custom thumbnails that override auto-extracted video frames (up to 5MB, 1920×1080 max)
- **Organization Logos**: Brand assets displayed across the platform (up to 2MB, 512×512 max, supports SVG)
- **User Avatars**: Profile pictures for user accounts (up to 1MB, 256×256 max)

Key capabilities:
- **Input Validation**: Magic byte verification, MIME type allowlist, size limits, dimension constraints
- **Image Processing**: Resize to multiple sizes (sm/md/lg), WebP conversion, quality optimization
- **Storage Integration**: Creator-scoped R2 paths following existing conventions
- **Security**: XSS prevention for SVG uploads via DOMPurify sanitization

This service is consumed by:
- **Content Creator Dashboard**: Upload custom thumbnails when publishing content
- **Organization Settings**: Upload/update organization logo
- **User Profile**: Upload/update avatar image
- **Frontend Components**: Render images with responsive `<picture>` elements

---

## System Context

### Upstream Dependencies

**Validation Package** (`@codex/validation`) (✅ Available):
- Existing `validateLogoUpload()` function provides foundation pattern
- SVG sanitization via `sanitizeSvgContent()` already implemented
- Magic byte validation for PNG, JPEG, WebP, SVG already exists in `file-upload.ts`

**Content Service** (P1-CONTENT-001) (✅ Complete):
- Content table has `thumbnailUrl` column for custom thumbnails
- Need to update content when thumbnail is uploaded

**Transcoding Package** (`@codex/transcoding`) (✅ Available):
- Path generation utilities in `paths.ts` to extend
- Existing pattern: `{creatorId}/thumbnails/{mediaId}/` for auto-generated

**Auth Service** (✅ Available):
- Session validation for all upload endpoints
- User and organization context for storage path generation

### Downstream Consumers

**Content API Worker** (Backend):
- POST endpoint for content thumbnail uploads
- Updates `content.thumbnailUrl` after processing

**Settings API Worker** (Backend):
- POST endpoint for organization logo uploads
- POST endpoint for user avatar uploads
- Updates respective database fields

**Frontend Components**:
- Responsive `<picture>` element rendering with srcset
- Fallback handling for missing images
- Upload components with drag-and-drop

### External Services

**Cloudflare R2**: Object storage for processed images
**@cf-wasm/photon**: Rust-based Wasm image processing library (resize, format conversion)
**DOMPurify**: SVG sanitization (already integrated)

> [!NOTE]
> **Why Photon over Sharp?**
> Sharp requires native binaries or a heavy Wasm build that risks exceeding Cloudflare Worker memory limits (128MB). Photon is a lightweight Rust crate compiled to Wasm, specifically designed for edge environments. It supports resize, WebP encoding, and runs efficiently within Worker constraints.

### Integration Flow

```
User Upload (FormData)
    ↓
Validation (magic bytes, size, dimensions)
    ↓
Photon Wasm Processing (resize to sm/md/lg, WebP conversion)
    ↓
R2 Upload (creator-scoped paths)
    ↓
Database Update (store base URL)
    ↓
Response (signed URLs for immediate display)
```

---

## Database Schema

### Existing Tables (No New Tables Required)

This work packet modifies existing columns, no new tables needed.

#### `content` (Existing)

**Modified Column**:
- `thumbnailUrl` (text): Currently stores external URL. Will store R2 base path for processed thumbnails.

**New Usage Pattern**:
```
BEFORE: 'https://external.com/image.jpg'
AFTER:  '{creatorId}/content-thumbnails/{contentId}/'  (base path)
```

Frontend derives full URLs: `${CDN_BASE}/${basePath}sm.webp`, `md.webp`, `lg.webp`

#### `organizations` (Existing)

**Existing Column**:
- `logoUrl` (text): Will store R2 base path for processed logos.

#### `users` (Existing - Need to Add Column)

**New Column Required**:
- `avatarUrl` (text): R2 base path for avatar images

**Migration**:
```sql
ALTER TABLE users ADD COLUMN avatar_url text;
```

### Storage Path Structure

All paths follow existing creator-scoped pattern from `packages/transcoding/src/paths.ts`:

```
MEDIA_BUCKET/
├── {creatorId}/
│   ├── content-thumbnails/      ← NEW
│   │   └── {contentId}/
│   │       ├── sm.webp         (200px width)
│   │       ├── md.webp         (400px width)
│   │       └── lg.webp         (800px width)
│   └── branding/                ← NEW
│       └── logo/
│           ├── sm.webp         (64px)
│           ├── md.webp         (128px)
│           └── lg.webp         (256px)
└── avatars/                     ← NEW (user-scoped, not creator)
    └── {userId}/
        ├── sm.webp             (32px)
        ├── md.webp             (64px)
        └── lg.webp             (128px)
```

---

## Service Architecture

### Service Responsibilities

**ImageProcessingService** (new, extends `BaseService` from `@codex/service-errors`):
- **Primary Responsibility**: Validate, process, and store user-uploaded images
- **Key Operations**:
  - `processContentThumbnail(contentId, imageBuffer)`: Validate → resize → upload → update content
  - `processOrganizationLogo(orgId, imageBuffer)`: Validate → resize → upload → update org
  - `processUserAvatar(userId, imageBuffer)`: Validate → resize → upload → update user
  - `deleteContentThumbnail(contentId)`: Remove from R2, clear database field

### Key Business Rules

1. **Image Validation**:
   - Magic byte verification must match claimed MIME type (prevent spoofing)
   - File size limits: thumbnails 5MB, logos 2MB, avatars 1MB
   - Dimension limits: thumbnails 1920×1080, logos 512×512, avatars 256×256
   - Allowed formats: JPEG, PNG, WebP for all; SVG additionally for logos

2. **Processing Pipeline**:
   - Convert all raster formats to WebP for delivery
   - Generate 3 sizes: sm, md, lg (dimensions vary by image type)
   - Preserve aspect ratio, scale down only (never upscale)
   - Quality setting: 82 for WebP (matches video thumbnail spec)

3. **SVG Handling** (logos only):
   - Sanitize via DOMPurify to remove XSS vectors
   - Store original sanitized SVG (no rasterization)
   - Serve with correct `Content-Type: image/svg+xml`

4. **Storage**:
   - All paths creator-scoped for multi-tenancy
   - Avatars user-scoped (in separate `avatars/` prefix)
   - Overwrite previous versions (same path, new content)

### Error Handling Approach

**Custom Error Classes** (extend from `@codex/service-errors`):
- `InvalidImageFormatError`: MIME type not in allowlist → HTTP 400
- `ImageTooLargeError`: File exceeds size limit → HTTP 413
- `ImageDimensionError`: Exceeds dimension limits → HTTP 400
- `MagicBytesMismatchError`: Header doesn't match claimed type → HTTP 400
- `R2UploadError`: Storage failure → HTTP 500

**Error Recovery**:
- Validate before processing (fail fast)
- R2 upload failures: retry once with backoff
- No partial uploads (all sizes or none)

### Transaction Boundaries

**Operations requiring `db.transaction()`**:
- None required. Image upload and database update can be separate (eventual consistency acceptable).

**Sequence**:
1. Upload to R2 first
2. If success, update database
3. If database update fails, log orphaned R2 files for cleanup (edge case)

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| POST | `/api/content/:id/thumbnail` | Upload content thumbnail | `POLICY_PRESETS.creator()` |
| DELETE | `/api/content/:id/thumbnail` | Remove content thumbnail | `POLICY_PRESETS.creator()` |
| POST | `/api/organizations/:id/logo` | Upload organization logo | `POLICY_PRESETS.orgAdmin()` |
| DELETE | `/api/organizations/:id/logo` | Remove organization logo | `POLICY_PRESETS.orgAdmin()` |
| POST | `/api/user/avatar` | Upload user avatar | `POLICY_PRESETS.authenticated()` |
| DELETE | `/api/user/avatar` | Remove user avatar | `POLICY_PRESETS.authenticated()` |

### Standard Pattern

All endpoints use multipart/form-data for file upload:

```typescript
app.post('/api/content/:id/thumbnail',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async ({ input, context, req }) => {
      const formData = await req.formData();
      const validated = await validateImageUpload(formData, THUMBNAIL_CONFIG);

      const service = new ImageProcessingService(context);
      const result = await service.processContentThumbnail(input.id, validated);

      return { data: result };
    }
  })
);
```

### Security Policies

- **`POLICY_PRESETS.creator()`**: User must own the content
- **`POLICY_PRESETS.orgAdmin()`**: User must be admin of organization
- **`POLICY_PRESETS.authenticated()`**: Any authenticated user (for own avatar)

### Response Format

**Upload Success**:
```typescript
{
  data: {
    basePath: string,              // R2 base path
    urls: {
      sm: string,                  // Full CDN URL for small size
      md: string,                  // Full CDN URL for medium size
      lg: string                   // Full CDN URL for large size
    }
  }
}
```

**Validation Error**:
```typescript
{
  error: {
    code: 'INVALID_IMAGE_FORMAT',
    message: 'File type not allowed. Accepted: JPEG, PNG, WebP',
    details: { providedType: 'image/gif', allowedTypes: [...] }
  }
}
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/validation`

**Existing Utilities to Extend**:
- `validateLogoUpload()`: Current logo validation (base pattern)
- `sanitizeSvgContent()`: XSS prevention for SVG files
- `isValidImageHeader()`: Magic byte verification (PNG, JPEG, WebP, SVG)

**New Utilities to Create**:
- `validateImageUpload(formData, config)`: Generalized image validator
- `ImageValidationConfig`: Type for size/dimension/format limits

**When to use**: All upload endpoints call validation before processing.

---

#### `@codex/cloudflare-clients`

**R2 Storage**:
- `R2Service.put(bucket, key, data, contentType)`: Upload processed images
- `R2Service.delete(bucket, key)`: Remove images on delete endpoint
- `R2Service.generateSignedUrl()`: Not needed for images (public bucket via CDN)

**When to use**: After Sharp processing, upload each size variant.

---

#### `packages/transcoding/src/paths.ts`

**Extend with New Path Generators**:
```typescript
getContentThumbnailKey(creatorId, contentId, size): string
getOrgLogoKey(orgId, size): string
getUserAvatarKey(userId, size): string
```

**When to use**: Consistent path generation for all image types.

---

### External Libraries

#### @cf-wasm/photon

**Image Processing (Wasm)**:
```typescript
import { PhotonImage, resize } from '@cf-wasm/photon';

// Load image into Wasm memory
const inputImage = PhotonImage.new_from_byteslice(new Uint8Array(buffer));

// Resize (maintains aspect ratio)
const resized = resize(inputImage, 400, 0, 1); // width=400, height=auto

// Convert to WebP
const webpBytes = resized.get_bytes_webp();

// CRITICAL: Free Wasm memory to prevent leaks
inputImage.free();
resized.free();
```

**When to use**: Process each uploaded image into multiple sizes directly in Cloudflare Workers.

> [!CAUTION]
> **Wasm Memory Management**: Always call `.free()` on PhotonImage objects after use. Wasm memory is not garbage collected. Failure to free will cause memory leaks and eventual OOM.

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| `@codex/validation` | ✅ Available | Extend existing validation patterns |
| `@codex/database` | ✅ Available | Content, organizations, users tables |
| `@codex/cloudflare-clients` | ✅ Available | R2 upload utilities |
| Content Service (P1-CONTENT-001) | ✅ Complete | Content table with thumbnailUrl column |
| Settings Service (P1-SETTINGS-001) | ✅ Complete | Organization logo handling |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| Frontend Image Components | 🚧 Future | Responsive `<picture>` rendering |

### Infrastructure Ready

- ✅ R2 bucket configured (MEDIA_BUCKET)
- ✅ CDN routing for R2 assets
- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline
- ✅ Wasm support in Wrangler/esbuild build pipeline

---

## Implementation Checklist

- [x] **Validation Layer** ✅
  - [x] Extend `@codex/validation` with `validateImageUpload()` function
  - [x] Add `ImageValidationConfig` type and presets
  - [x] Add GIF magic byte support
  - [x] Add SVG signature validation with structure check
  - [x] Add unit tests for all validation scenarios (16 tests in image.test.ts)

- [x] **Path Generation** ✅
  - [x] Add `getContentThumbnailKey()` to `paths.ts`
  - [x] Add `getOrgLogoKey()` to `paths.ts`
  - [x] Add `getUserAvatarKey()` to `paths.ts`
  - [x] Ensure consistent {size}.webp naming

- [x] **Service Layer** ✅
  - [x] Create `ImageProcessingService`
  - [x] Create `@codex/image-processing` package with `@cf-wasm/photon` dependency
  - [x] Implement `SafePhotonImage` Wasm wrapper with proper `.free()` memory management
  - [x] Implement multi-size generation (sm/md/lg) with WebP output
  - [x] Add R2 upload for all sizes (parallel)
  - [x] Add SVG passthrough for logos (DOMPurify sanitization)
  - [x] Add unit tests (34 service tests + 10 stability tests)

- [x] **Database Updates** ✅
  - [x] `avatarUrl` column exists in users table
  - [x] `logoUrl` column exists in organizations table
  - [x] `thumbnailUrl` column exists in content table

- [x] **API Endpoints** ✅
  - [x] Add `POST /api/content/:id/thumbnail` to content-api
  - [x] Add `DELETE /api/content/:id/thumbnail` to content-api
  - [x] Organization logo endpoints (via organization-api/identity-api)
  - [x] User avatar endpoints
  - [x] Orphan prevention: R2 cleanup on DB failure

- [x] **Documentation** ✅
  - [x] Update IMAGE_PROCESSING_PIPELINE.md with implementation details
  - [x] Create CLAUDE.md for @codex/image-processing package
  - [x] Document R2 path structure in paths.ts

---

## Testing Strategy

### Unit Tests

**Validation Layer** (`packages/validation/src/__tests__/`):
- Test magic byte validation for each format (JPEG, PNG, WebP, GIF)
- Test MIME type spoofing detection (wrong header for claimed type)
- Test file size limits (accept at limit, reject over)
- Test dimension limits
- Test SVG sanitization removes malicious content

**Service Layer**:
- Mock Photon to test resize pipeline
- Mock R2 to test upload sequence
- Test error handling (invalid format, upload failure)
- Test multi-size generation produces all required sizes
- Test `.free()` is called on all Wasm objects

### Integration Tests

**API Endpoints**:
- Upload valid JPEG → verify R2 has sm/md/lg WebP files
- Upload oversized file → verify 413 response
- Upload spoofed file (GIF with .jpg extension) → verify 400 response
- Delete thumbnail → verify R2 files removed
- Test authorization (non-owner cannot upload to content)

**Database Tests**:
- Verify `thumbnailUrl` updated after successful upload
- Verify field cleared after delete

### E2E Scenarios

**Content Thumbnail Upload**:
1. Creator uploads JPEG for their content
2. System validates magic bytes and size
3. Photon (Wasm) processes to sm/md/lg WebP
4. R2 receives all three files
5. Database `thumbnailUrl` updated with base path
6. Frontend displays new thumbnail immediately

**SVG Logo Upload**:
1. Admin uploads SVG logo for organization
2. System validates it's actually SVG (magic bytes)
3. DOMPurify sanitizes XSS vectors
4. Sanitized SVG stored in R2 (no rasterization)
5. Frontend renders SVG with proper content-type

### Local Development Testing

**Tools**:
- `pnpm test`: Run all tests
- `pnpm --filter @codex/validation test`: Validation tests only
- Sample images in `test-media/` directory for manual testing

---

## Notes

### Design Decisions

**WebP as Output Format**: Matches video thumbnail spec in IMAGE_PROCESSING_PIPELINE.md. 95%+ browser support, good compression.

**Photon (Wasm) in Workers**: Using `@cf-wasm/photon`, a lightweight Rust library compiled to Wasm, for image processing directly in Cloudflare Workers. This avoids external dependencies (RunPod) and heavy binaries (Sharp).

**Memory Constraints**: Cloudflare Workers have a 128MB memory limit. Strict file size limits (5MB) prevent OOM. All Wasm objects must be freed after use.

**No Upscaling**: Preserve aspect ratio, only scale down. Prevents blurry upscaled images.

**Overwrite Pattern**: Same path for updates (no versioning). CDN cache invalidation happens automatically on R2 update.

### Content vs Media Thumbnail Clarification

**`media_items.thumbnailKey`**: Auto-extracted from video at 10% mark by RunPod. Always JPEG.

**`content.thumbnailUrl`**: Custom user-uploaded thumbnail. Overrides auto-extracted when present. WebP output.

Frontend priority: `content.thumbnailUrl` > `mediaItem.thumbnailKey` > placeholder.

### Performance Considerations

**Processing Time**:
- Small image (< 1MB): ~200ms total
- Large image (5MB): ~800ms total
- Acceptable for synchronous API response

**R2 Upload**:
- 3 parallel uploads (sm/md/lg) for faster completion
- ~50ms per file

**CDN Caching**:
- Images have long cache TTL (1 year, immutable content)
- Updates create same path (CDN sees as new content)

### Future Enhancements

- **AVIF Support**: Add AVIF as additional output format when browser support improves
- **Image Cropping**: Allow user to specify crop area during upload
- **BlurHash**: Generate BlurHash during processing for skeleton loading states

---

**Last Updated**: 2026-01-12
**Version**: 1.0
