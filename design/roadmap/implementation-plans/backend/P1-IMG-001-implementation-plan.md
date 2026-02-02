# P1-IMG-001: Image Processing Pipeline Implementation Plan

**Work Packet**: [P1-IMG-001-image-processing.md](../../work-packets/backend/P1-IMG-001-image-processing.md)
**Status**: ✅ Complete (Phase 1-3 Implemented)
**Estimated Effort**: 4-5 days
**Actual Effort**: ~5 days
**Priority**: P1
**Completed**: 2026-02-01

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [Storage Structure](#storage-structure)
- [Implementation Phases](#implementation-phases)
- [Critical Files](#critical-files)
- [Verification Checklist](#verification-checklist)

---

## Executive Summary

Implement a **Serverless Image Processing Pipeline** using **WebAssembly (Wasm)** directly within Cloudflare Workers. This handles user-uploaded static assets (thumbnails, logos, avatars) without external compute (RunPod) or heavy dependencies (Sharp).

**Architecture Philosophy**:
- **Native Wasm Processing**: Use `@cf-wasm/photon` (Rust-based) for high-performance image manipulation within the Worker's 128MB memory limit.
- **Zero-Infrastructure**: No external servers or containers. Logic lives alongside the API.
- **Fail-Fast**: Strict "Gatekeeper" validation (magic bytes, 5MB size limit) before processing.
- **Optimized Delivery**: Convert to WebP, generate standard sizes (sm/md/lg), store in R2.

**Key Decisions**:
- **Photon over Sharp**: `sharp` is too heavy for Workers. `photon` is a lightweight Rust crate compiled to Wasm, specifically designed for edge environments.
- **Validation-First**: Strict magic byte validation before loading into Wasm heap.
- **Memory Safety**: All Wasm objects must be freed via `.free()` to prevent leaks.

---

## Architecture Overview

### Service Layer - Wasm Integration

```typescript
// @codex/image-processing/src/services/image-processing-service.ts
import { PhotonImage, resize } from '@cf-wasm/photon';

export class ImageProcessingService {
  constructor(private config: { r2: R2Bucket, db: Database }) {}

  async processContentThumbnail(contentId: string, file: File): Promise<ProcessedImageResult> {
    // 1. Validation (Size & Magic Bytes)
    await this.validateInput(file);

    // 2. Load into Wasm (Careful memory mgmt)
    const arrayBuffer = await file.arrayBuffer();
    const inputImage = PhotonImage.new_from_byteslice(new Uint8Array(arrayBuffer));

    // 3. Generate Variants
    const variants = new Map<string, Uint8Array>();

    const lg = resize(inputImage, 800, 0, 1);
    variants.set('lg', lg.get_bytes_webp());

    const md = resize(inputImage, 400, 0, 1);
    variants.set('md', md.get_bytes_webp());

    const sm = resize(inputImage, 200, 0, 1);
    variants.set('sm', sm.get_bytes_webp());

    // 4. Cleanup Wasm Memory IMMEDIATELY
    inputImage.free();
    lg.free();
    md.free();
    sm.free();

    // 5. Upload to R2 (Parallel)
    await this.uploadVariants(basePath, variants);

    return result;
  }
}
```

---

## Storage Structure

> [!NOTE]
> **Avatar Location**: Avatars are user-centric, not content-centric. They live in `avatars/{userId}/` at the bucket root, separate from creator content.

**Bucket**: `MEDIA_BUCKET`

| Asset Type | Path Pattern | Scope |
|------------|--------------|-------|
| **Content Thumbnail** | `{creatorId}/content-thumbnails/{contentId}/{size}.webp` | Creator |
| **Org Logo** | `{creatorId}/branding/logo/{size}.webp` | Organization |
| **User Avatar** | `avatars/{userId}/{size}.webp` | User (Platform-wide) |

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
│           ├── sm.webp  (64px)
│           ├── md.webp  (128px)
│           └── lg.webp  (256px)
└── avatars/
    └── {userId}/
        ├── sm.webp  (32px)
        ├── md.webp  (64px)
        └── lg.webp  (128px)
```

---

## Implementation Phases

### Phase 1: Validation & Safety Gates (1 day)

#### 1.1 Strict Magic Byte Checks
**Modify**: `packages/validation/src/image.ts`
- Implement `validateImageSignature(buffer)`: check hex signatures for JPEG, PNG, GIF, WebP.

#### 1.2 Resource Guard
**Create**: `packages/validation/src/limits.ts`
- Define `MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;` (5MB).
- Check `Content-Length` header first, then buffer size post-load.

---

### Phase 2: Wasm Processing Core (2 days)

#### 2.1 Scaffold Package
**Create**: `packages/image-processing/`
- `package.json` with `@cf-wasm/photon`, `@codex/cloudflare-clients`

#### 2.2 Wasm Integration Wrapper
**Create**: `packages/image-processing/src/photon-wrapper.ts`
- Safe wrapper handling `Uint8Array` conversion
- Calling `.free()` on Rust structs (Manual Memory Management!)
- Error handling (Wasm panics can crash the worker)

#### 2.3 Processor Logic
**Create**: `packages/image-processing/src/processor.ts`
- `processImage(buffer): Record<size, Uint8Array>`
- Resize (Lanczos), output to WebP

---

### Phase 3: Service & API Integration (1 day)

#### 3.1 Content Thumbnail Endpoint
**Modify**: `workers/content-api/src/routes/content.ts`

```typescript
app.post('/api/content/:id/thumbnail',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async ({ input, context, req }) => {
      const formData = await req.formData();
      const file = formData.get('thumbnail') as File;

      const service = new ImageProcessingService(context);
      const result = await service.processContentThumbnail(input.id, file);

      await context.db.update(content)
        .set({ thumbnailUrl: result.basePath })
        .where(eq(content.id, input.id));

      return { data: result.urls };
    }
  })
);
```

#### 3.2 Avatar Endpoint
**Modify**: `workers/user-api/src/routes/profile.ts`
- `POST /avatar` using `service.processUserAvatar(userId, file)`

#### 3.3 Organization Logo Endpoint
**Modify**: `workers/organization-api/src/routes/settings.ts`
- `POST /:id/logo` using `service.processOrgLogo(orgId, file)`

---

### Phase 4: Verification (1 day)

#### 4.1 Memory Profiling
- Upload 4.9MB PNG, verify no OOM
- If 5MB is too high, lower to 3-4MB

#### 4.2 Quality Check
- Compare Photon WebP vs Sharp/Mac Preview
- Verify sRGB color preservation

---

## Critical Files

### New Package
```
packages/image-processing/
├── package.json
├── src/
│   ├── index.ts
│   ├── photon-wrapper.ts    # Safe Wasm wrapper
│   ├── processor.ts         # Resizing logic
│   └── service.ts           # Orchestration
```

### Affected Workers
- `workers/content-api`
- `workers/organization-api`
- `workers/user-api`

---

## Verification Checklist

### Wasm Stability
- [ ] Large images (4MB+) do not cause OOM
- [ ] Concurrent requests do not crash Worker isolate
- [ ] `.free()` called on all Wasm objects

### Functionality
- [ ] Magic byte validation rejects renamed .exe files
- [ ] SVG sanitization works (logos)
- [ ] WebP outputs valid and viewable
- [ ] Assets in correct R2 folders (`avatars/` vs `{creatorId}/`)

### Infrastructure
- [ ] Wasm binary correctly bundled by Wrangler/esbuild
