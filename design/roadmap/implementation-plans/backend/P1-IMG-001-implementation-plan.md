# P1-IMG-001: Image Processing Pipeline Implementation Plan

**Work Packet**: [P1-IMG-001-image-processing.md](../../work-packets/backend/P1-IMG-001-image-processing.md)
**Status**: 🚧 Phase 1 (Validation) Ready to Start
**Estimated Effort**: 4-5 days
**Priority**: P1

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [Implementation Phases](#implementation-phases)
- [Critical Files](#critical-files)
- [Verification Checklist](#verification-checklist)
- [Future Enhancements](#future-enhancements)

---

## Executive Summary

Implement a **comprehensive Image Processing Pipeline** to handle user-uploaded static assets: content thumbnails, organization logos, and user avatars. This system replaces the placeholder image handling with a robust, secure, and optimized pipeline.

**Architecture Philosophy**:
- **Validation-First**: Strict input validation (magic bytes, dimensions, aspect ratio) before any processing.
- **Micro-Service Pattern**: Dedicated `@codex/image-processing` package encapsulates Sharp logic and R2 interactions.
- **Optimized Delivery**: Always convert to WebP, generate multiple sizes (sm/md/lg), and use content-addressable storage paths where appropriate (or creator-scoped for overriding).
- **Separation of Concerns**: Validation logic in `@codex/validation`, processing in `@codex/image-processing`, API orchestration in workers.

**Key Decisions**:
- **Sharp on Workers**: Use Sharp (Wasm) within Cloudflare Workers for on-the-fly processing (no external queues for images < 5MB).
- **WebP Standardization**: All raster inputs (JPEG, PNG) converted to WebP for 30%+ size reduction.
- **SVG Passthrough**: SVGs (logos) are sanitized but not rasterized, ensuring crisp rendering at any size.
- **Two Thumbnail Types**:
    - `media_items.thumbnailKey`: Auto-extracted (backup)
    - `content.thumbnailUrl`: User-uploaded (primary)

---

## Architecture Overview

### Service Layer - Encapsulated Processing

```typescript
// @codex/image-processing/src/services/image-processing-service.ts
export class ImageProcessingService {
  constructor(private config: { r2: R2Bucket, db: Database }) {}

  // Main entry points
  async processContentThumbnail(contentId: string, file: ValidatedImage): Promise<ProcessedImageResult>;
  async processOrgLogo(orgId: string, file: ValidatedImage): Promise<ProcessedImageResult>;
  async processUserAvatar(userId: string, file: ValidatedImage): Promise<ProcessedImageResult>;

  // Internal pipeline steps
  private async validateDimensions(buffer: Buffer, config: DimensionConfig): Promise<void>;
  private async generateVariants(buffer: Buffer): Promise<Map<string, Buffer>>; // sm, md, lg
  private async uploadVariants(basePath: string, variants: Map<string, Buffer>): Promise<void>;
}
```

### Storage Structure (R2)

Paths follow the creator-scoped pattern for multi-tenancy validation:

```
MEDIA_BUCKET/
├── {creatorId}/
│   ├── content-thumbnails/
│   │   └── {contentId}/
│   │       ├── sm.webp  (200w)
│   │       ├── md.webp  (400w)
│   │       └── lg.webp  (800w)
│   └── branding/
│       └── logo/
│           ├── sm.webp
│           ├── md.webp
│           └── lg.webp
└── avatars/
    └── {userId}/
        ├── sm.webp
        ├── md.webp
        └── lg.webp
```

---

## Implementation Phases

### Phase 1: Validation Package Enhancements (2 hours)

Extend `@codex/validation` to support strict image constraints.

#### 1.1 Add Magic Byte Constants
**Modify**: `packages/validation/src/constants.ts` (create if needed or use `primitives.ts`)
- Add `IMAGE_MAGIC_NUMBERS` for GIF (0x47 0x49 0x46 0x38).
- Update `ALLOWED_MIME_TYPES`.

#### 1.2 Create Image Validation Schema
**Create**: `packages/validation/src/schemas/image.ts`

```typescript
export const imageUploadSchema = z.custom<File>((file) => {
    // 1. MIME check
    // 2. Size check
    return true;
});
```

#### 1.3 Create Image Validation Utility
**Create**: `packages/validation/src/image-validation.ts`
- Implement `validateImageUpload(formData, config)`
- Supports config interfaces:
    ```typescript
    interface ImageConfig {
        maxBytes: number;
        maxWidth?: number;
        maxHeight?: number;
        allowedMimeTypes: string[];
    }
    ```

#### 1.4 Test Validation Logic
**Create**: `packages/validation/src/__tests__/image-validation.test.ts`
- Test mime spoofing (rename .exe to .jpg)
- Test dimension limits
- Test SVG sanitization (confirm scripts are stripped)

---

### Phase 2: Image Processing Core (4 hours)

Create the dedicated processing package.

#### 2.1 Scaffold Package
**Create**: `packages/image-processing/`
- `package.json` (deps: `sharp`, `@codex/cloudflare-clients`, `@codex/service-errors`)
- `tsconfig.json`
- `src/index.ts`

#### 2.2 Implement Path Generators
**Create**: `packages/image-processing/src/paths.ts`
- Move/Extend logic from `packages/transcoding/src/paths.ts` if appropriate, or import it.
- `getContentThumbnailPath(creatorId, contentId, size)`
- `getAvatarPath(userId, size)`

#### 2.3 Implement Processing Logic
**Create**: `packages/image-processing/src/processor.ts`
- Function `processImage(buffer, options)`
- Uses `sharp(buffer).resize().webp().toBuffer()`
- Returns `Map<Size, Buffer>`

#### 2.4 Create Service Class
**Create**: `packages/image-processing/src/service.ts`
- `ImageProcessingService` class
- Integrates `Validation` (re-check), `Processor`, and `R2Service`
- Handles logic: verify owner -> process -> upload -> return URLs

---

### Phase 3: Database & Migration (1 hour)

#### 3.1 Update User Schema
**Modify**: `packages/database/src/schema/users.ts`
- Add `avatarUrl: text('avatar_url')`

#### 3.2 Generate Migration
- Run `pnpm db:gen:drizzle`
- Name: `add_user_avatar_url`

---

### Phase 4: API Integration (3 hours)

Wire up the worker endpoints.

#### 4.1 Content Thumbnail Endpoint
**Modify**: `workers/content-api/src/routes/content.ts`
- `POST /:id/thumbnail`
- Middleware: `requireCreator`
- Logic:
    ```typescript
    const file = await req.formData().get('thumbnail');
    const service = new ImageProcessingService(env, db);
    const result = await service.processContentThumbnail(contentId, file);
    await db.update(content).set({ thumbnailUrl: result.basePath });
    return result.urls;
    ```

#### 4.2 Organization Logo Endpoint
**Modify**: `workers/organization-api/src/routes/settings.ts` (or branding)
- `POST /:id/logo`
- Middleware: `requireOrgAdmin`

#### 4.3 User Avatar Endpoint
**Modify**: `workers/user-api/src/routes/profile.ts` (create if needed)
- `POST /avatar`
- Middleware: `requireAuth`

---

### Phase 5: Verification & Tests (2 hours)

#### 5.1 Unit Tests
- `packages/image-processing/src/__tests__/processor.test.ts`: Mock Sharp, verify output buffer types/sizes.
- `packages/image-processing/src/__tests__/service.test.ts`: Mock R2, verify upload calls.

#### 5.2 Integration Tests
- `workers/content-api/src/__tests__/thumbnail.test.ts`: Full flow mock R2.

---

## Critical Files

### New Package
```
packages/image-processing/
├── package.json
├── src/
│   ├── index.ts
│   ├── paths.ts         # R2 Key generators
│   ├── processor.ts     # Sharp logic
│   └── service.ts       # Orchestration
└── test/
```

### Affected Workers
- `workers/content-api`
- `workers/organization-api`
- `workers/user-api` (implied/new)

---

## Verification Checklist

### Phase 1: Validation
- [ ] Magic byte checks fail for renamed files
- [ ] SVG sanitization removes `<script>` tags
- [ ] Large files are rejected fast (before processing)

### Phase 2: Processing
- [ ] Sharp installed correctly in Worker environment (Wasm check)
- [ ] WebP conversion works for PNG/JPEG inputs
- [ ] Multi-size generation (sm, md, lg) produces correct dimensions

### Phase 3: Storage
- [ ] R2 paths follow `{creatorId}/...` pattern
- [ ] Cache-Control headers set (immutable for hashed/unique, revalidate for mutable)
- [ ] Content-Type headers correct (`image/webp` vs `image/svg+xml`)

---

## Future Enhancements
- **AVIF Support**: Add as content negotiation option when browser support >98%.
- **BlurHash**: Generate BlurHash during processing for skeleton loading states.
- **Animated WebP**: Support simple animations for avatars.
