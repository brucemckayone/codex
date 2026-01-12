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

Implement a **Serverless Image Processing Pipeline** using **WebAssembly (Wasm)** directly within Cloudflare Workers. This system handles user-uploaded static assets (thumbnails, logos, avatars) without requiring external compute (RunPod) or heavy dependencies (Sharp).

**Architecture Philosophy**:
- **Native Wasm Processing**: Use `@cf-wasm/photon` (Rust-based) for high-performance image manipulation within the Worker's 128MB memory limit.
- **Zero-Infrastructure**: No external servers or containers to manage. Logic lives alongside the API.
- **Strict Constraints**: Enforce strict file size limits (max 4MB for high-res inputs) to prevent OOM errors, utilizing streaming where possible.
- **Optimized Delivery**: Convert to WebP, generate standard sizes (sm/md/lg), and store in R2.

**Key Decisions**:
- **Photon over Sharp**: `sharp` is too heavy for Workers. `photon` is a lightweight Rust crate compiled to Wasm, specifically designed for this environment.
- **Validation-First**: strict "Gatekeeper" validation (magic bytes, strict size check) before loading the image into the Wasm heap.
- **Fail-Fast**: Reject images > 5MB immediately to protect Worker stability.

---

## Architecture Overview

### Service Layer - Wasm Integration

```typescript
// @codex/image-processing/src/services/image-processing-service.ts
import { PhotonImage, resize, sampling_artifact } from '@cf-wasm/photon';

export class ImageProcessingService {
  constructor(private config: { r2: R2Bucket, db: Database }) {}

  async processContentThumbnail(contentId: string, file: File): Promise<ProcessedImageResult> {
    // 1. Validation (Size & Magic Bytes)
    await this.validateInput(file);

    // 2. Load into Wasm (Careful memory mgmt)
    const arrayBuffer = await file.arrayBuffer();
    const inputImage = PhotonImage.new_from_byteslice(new Uint8Array(arrayBuffer));

    // 3. Generate Variants (In-Memory)
    // Photon operations are synchronous and CPU-bound
    const variants = new Map<string, Uint8Array>();

    // Large (1920w)
    const lg = resize(inputImage, 1920, 1080, 1);
    variants.set('lg', lg.get_bytes_webp());

    // Medium (800w) - Reuse 'lg' or 'input' depending on quality needs
    // Small (400w)

    // 4. Cleanup Wasm Memory immediately
    inputImage.free();
    lg.free();

    // 5. Upload to R2 (Parallel)
    await this.uploadVariants(basePath, variants);

    return result;
  }
}
```

### Storage Structure (R2)

*Unchanged from original plan.*

```
MEDIA_BUCKET/
├── {creatorId}/
│   ├── content-thumbnails/
│   │   └── {contentId}/
│   │       ├── sm.webp
│   │       ├── md.webp
│   │       └── lg.webp
...
```

---

## Implementation Phases

### Phase 1: Validation & Safety Gates (1 day)

Extend `@codex/validation` to support strict image constraints.

#### 1.1 Strict Magic Byte Checks
**Modify**: `packages/validation/src/image.ts`
- Implement `validateImageSignature(buffer)`: checking hex signatures for JPEG, PNG, GIF, WebP.
- **Crucial**: This must happen regarding the first few bytes *without* reading the whole file if possible, or immediately after buffering.

#### 1.2 Resource Guard
**Create**: `packages/validation/src/limits.ts`
- Define `MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;` (5MB).
- Implementing this check at the `request.formData()` level is tricky (it buffers).
- **Strategy**: Check `Content-Length` header first (weak), then check buffer size post-load.

---

### Phase 2: Wasm Processing Core (2 days)

Create the dedicated processing package using Photon.

#### 2.1 Scaffold Package
**Create**: `packages/image-processing/`
- `package.json`:
  - `dependencies`: `@cf-wasm/photon`, `@codex/cloudflare-clients`
  - **Note**: Ensure `wrangler` build config supports Wasm modules correctly.

#### 2.2 Wasm Integration Wrapper
**Create**: `packages/image-processing/src/photon-wrapper.ts`
- Photon's API is low-level. Create a safe wrapper that handles:
  - `Uint8Array` conversion.
  - Calling `free()` on Rust structs (Manual Memory Management is required in Wasm!).
  - Error handling (Wasm panics can crash the worker).

#### 2.3 Processor Logic
**Create**: `packages/image-processing/src/processor.ts`
- `processImage(buffer: ArrayBuffer): Record<size, Uint8Array>`
- Implement the resizing logic:
    - Resize (Lanczos or Nearest Neighbor depending on perf).
    - Output to WebP (Photon supports lightweight WebP encoding).

---

### Phase 3: Service & API Integration (1 day)

Connect the new package to the Workers.

#### 3.1 Service Class
**Create**: `packages/image-processing/src/service.ts`
- `ImageProcessingService`: Orchestrates Validation -> Wasm Processing -> R2 Upload.

#### 3.2 Worker Endpoints
**Modify**: `workers/content-api` (and others)
- Add endpoints.
- Integration Test: Ensure the Wasm module loads correctly in the deployed Worker environment (often the trickiest part of Wasm).

---

### Phase 4: Verification (1 day)

#### 4.1 Memory Profiling
- **Test**: Upload a 4.9MB complex PNG.
- **Monitor**: Check Worker RAM usage. If it hits 128MB, we fail.
- **Mitigation**: If 5MB is too high for Wasm overhead, lower limit to 3MB or 4MB.

#### 4.2 Quality Check
- Compare Photon WebP output vs Sharp/Mac Preview.
- Ensure colors aren't mangled (sRGB preservation).

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

---

## Verification Checklist

### Wasm Stability
- [ ] Large images (4MB+) do not cause OOM (Out of Memory).
- [ ] Concurrent requests do not crash the Worker isolate.
- [ ] manually calling `.free()` on all Wasm objects to prevent leaks.

### Functionality
- [ ] Magic byte validation rejects renamed .exe files.
- [ ] SVG sanitization works (for logos).
- [ ] WebP outputs are valid and viewable in browser.

### Infrastructure
- [ ] Wasm binary is correctly bundled by Wrangler/Esbuild.
