# Image Processing Pipeline

**Status**: In Progress (Phase 1 Complete)
**Created**: 2026-01-12
**Updated**: 2026-01-12
**Purpose**: Define the complete image processing pipeline for thumbnails and media assets
**Work Packet**: [P1-IMG-001](./roadmap/work-packets/backend/P1-IMG-001-image-processing.md)

---

## Overview

This document specifies how images are processed, optimized, stored, and served across the Codex platform. The pipeline handles **two distinct thumbnail types** plus other image assets:

> [!IMPORTANT]
> **Two Types of Thumbnails**
>
> | Type | Source | Database Field | Processing |
> |------|--------|----------------|------------|
> | **Media Thumbnail** | Auto-extracted from video at 10% mark | `media_items.thumbnailKey` | RunPod (FFmpeg) |
> | **Content Thumbnail** | User-uploaded custom image | `content.thumbnailUrl` | API Worker (Sharp) |
>
> **Frontend Priority**: `content.thumbnailUrl` → `mediaItem.thumbnailKey` → placeholder

### Current State

- ✅ **Implemented**: Video frame extraction via RunPod (media thumbnails)
- ❌ **Not Implemented**: Custom image upload pipeline (content thumbnails, logos, avatars)

---

## Architecture

```mermaid
graph TB
    subgraph "Upload Sources"
        VU[Video Upload] --> Extract[Frame Extraction]
        IU[Image Upload] --> Process[Image Processing]
    end

    subgraph "Processing (RunPod)"
        Extract --> FFmpeg[FFmpeg Processing]
        Process --> Sharp[Sharp/libvips]
        FFmpeg --> Resize[Resize to 3 sizes]
        Sharp --> Resize
        Resize --> Compress[WebP Compression]
        Compress --> JPEG[JPEG Fallback]
    end

    subgraph "Storage (R2)"
        Compress --> R2W[R2 /thumbnails/]
        JPEG --> R2W
    end

    subgraph "Delivery"
        R2W --> CDN[Cloudflare CDN]
        CDN --> Browser[Browser]
    end
```

---

## Thumbnail Specifications

### Size Variants

| Name | Width | Aspect Ratio | Use Cases |
|------|-------|--------------|-----------|
| `sm` | 200px | Preserve | Mobile grids, compact cards |
| `md` | 400px | Preserve | Standard cards, tablet |
| `lg` | 800px | Preserve | Featured content, desktop hero |

### Format Priority

**Decision**: WebP primary, JPEG fallback. AVIF deferred to Phase 2.

| Priority | Format | Browser Support | Rationale |
|----------|--------|-----------------|-----------|
| 1 | WebP | 95%+ (all modern) | Best balance of compression/support |
| 2 | JPEG | 100% | Universal fallback |
| Future | AVIF | 93%+ | Better compression, slower encode |

**Why not AVIF in Phase 1:**

| Factor | WebP | AVIF |
|--------|------|------|
| Browser support | 95.3% | 93.8% |
| Encode time | ~100ms | ~500-2000ms |
| Decode time | Fast | Slower |
| File size | Good | 20-30% smaller |
| RunPod cost | Lower | Higher (more GPU time) |

AVIF's better compression doesn't justify the encoding cost at our scale. Revisit when content volume grows.

### Quality Settings

| Format | Quality | Effort | Target File Size |
|--------|---------|--------|------------------|
| WebP | 82 | 6 | sm: <15KB, md: <40KB, lg: <100KB |
| JPEG | 85 | mozjpeg | ~20% larger than WebP |

### Quality Benchmarks

Target: **Visually lossless** at standard viewing distances.

| Metric | Target | Measurement |
|--------|--------|-------------|
| SSIM | > 0.95 | Structural similarity to source |
| PSNR | > 35 dB | Peak signal-to-noise ratio |
| File size | < 40KB (md) | Measured after compression |

**Validation Script:**

```bash
# Compare compressed vs original
ffmpeg -i original.png -i compressed.webp \
  -lavfi "ssim;[0:v][1:v]psnr" -f null -

# Output: SSIM:0.97 PSNR:38.2
```

### Quality Tuning Guidelines

| Content Type | WebP Quality | Notes |
|--------------|--------------|-------|
| Photography | 82-85 | Standard setting |
| Text/Graphics | 90 | Preserve sharp edges |
| Low motion video | 80 | Can be more aggressive |
| High motion video | 85 | Preserve detail |

---

## Frame Extraction (Video Thumbnails)

### Strategy Decision

**Decision**: Use **time-based extraction (10% of duration)** with **scene detection fallback** and **I-frame targeting** for quality.

| Strategy | When Used | Rationale |
|----------|-----------|-----------|
| Time-based (10%) | Primary | Skips intro sequences, shows actual content |
| Scene detection | If time-based yields black/low-contrast | Finds visually interesting frames |
| I-frame targeting | Always | I-frames are complete images, avoid blur |

### Implementation

```bash
# Step 1: Get video duration
DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 input.mp4)

# Step 2: Calculate 10% timestamp
TIMESTAMP=$(echo "$DURATION * 0.1" | bc)

# Step 3: Extract frame at timestamp, targeting nearest I-frame
ffmpeg -ss $TIMESTAMP -i input.mp4 \
  -vf "select='eq(pict_type,PICT_TYPE_I)'" \
  -vframes 1 \
  -q:v 2 \
  -f image2pipe \
  -vcodec png - | \
  # Pipe to Sharp for resizing
```

### Scene Detection Fallback

If primary extraction yields poor results (black frame, low contrast), use scene detection:

```bash
# Extract frame at scene change after 10% mark
ffmpeg -ss $TIMESTAMP -i input.mp4 \
  -vf "select='gt(scene,0.3)',thumbnail=100" \
  -frames:v 1 \
  -q:v 2 \
  scene_thumb.jpg
```

**Scene threshold**: `0.3` balances sensitivity (0=most sensitive, 1=least). Lower values catch more scene changes.

### Quality Detection (Optional Enhancement)

For Phase 2, add automatic quality scoring:

```typescript
// Evaluate thumbnail quality
interface ThumbnailScore {
  contrast: number;     // 0-1, higher = better
  brightness: number;   // 0-1, 0.5 = ideal
  sharpness: number;    // 0-1, higher = better
}

async function scoreThumbnail(buffer: Buffer): Promise<ThumbnailScore> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Calculate metrics from pixel data
  // ...implementation details...

  return { contrast, brightness, sharpness };
}

// Reject thumbnails below threshold
const MIN_SCORE = 0.4;
if (score.contrast < MIN_SCORE || score.brightness < 0.1) {
  // Try scene detection fallback
}
```

---

## Compression Pipeline

### WebP Generation

```bash
# Using FFmpeg for video frame → WebP
ffmpeg -i input.mp4 \
  -vf "select='eq(n,0)',scale=400:-1" \
  -vframes 1 \
  -c:v libwebp \
  -quality 82 \
  -compression_level 6 \
  thumb-md.webp

# Using Sharp for image → WebP (Node.js)
await sharp(input)
  .resize(400, null, { withoutEnlargement: true })
  .webp({ quality: 82, effort: 6 })
  .toFile('thumb-md.webp');
```

### JPEG Generation

```bash
# FFmpeg
ffmpeg -i input.mp4 \
  -vf "select='eq(n,0)',scale=400:-1" \
  -vframes 1 \
  -q:v 2 \
  thumb-md.jpg

# Sharp
await sharp(input)
  .resize(400, null, { withoutEnlargement: true })
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile('thumb-md.jpg');
```

---

## Storage Structure

### R2 Bucket Layout

> [!IMPORTANT]
> All paths are **creator-scoped** for security and multi-tenancy. The `{creatorId}` prefix ensures proper isolation.

```
MEDIA_BUCKET/
├── {creatorId}/
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── video.mp4           # Original upload
│   ├── hls/
│   │   └── {mediaId}/
│   │       ├── master.m3u8         # HLS master playlist
│   │       ├── 1080p/index.m3u8    # Quality variants
│   │       ├── 720p/index.m3u8
│   │       ├── 480p/index.m3u8
│   │       ├── 360p/index.m3u8
│   │       └── preview/
│   │           └── preview.m3u8    # 30s preview clip
│   ├── thumbnails/
│   │   └── {mediaId}/
│   │       └── auto-generated.jpg  # Auto-extracted thumbnail
│   └── waveforms/
│       └── {mediaId}/
│           ├── waveform.json       # Audio waveform data
│           └── waveform.png        # Audio waveform image
```

### Path Generation (Single Source of Truth)

All R2 paths are generated via `packages/transcoding/src/paths.ts`. Example functions:

```typescript
// Thumbnail path
getThumbnailKey(creatorId, mediaId)
// Returns: '{creatorId}/thumbnails/{mediaId}/auto-generated.jpg'

// HLS master playlist
getHlsMasterKey(creatorId, mediaId)
// Returns: '{creatorId}/hls/{mediaId}/master.m3u8'

// Original upload
getOriginalKey(creatorId, mediaId, filename)
// Returns: '{creatorId}/originals/{mediaId}/video.mp4'
```

### Current Implementation vs Future Multi-Size

| Aspect | Current (Phase 1) | Future (Phase 2) |
|--------|-------------------|------------------|
| Sizes | Single auto-generated | sm (200px), md (400px), lg (800px) |
| Formats | JPEG only | WebP primary, JPEG fallback |
| Naming | `auto-generated.jpg` | `{size}.webp`, `{size}.jpg` |
| Path | `{creatorId}/thumbnails/{mediaId}/` | Same structure, multiple files |

---

## CDN Configuration

### Cache Headers

```
Cache-Control: public, max-age=31536000, immutable
```

Thumbnails are immutable (content-addressed by ID). 1-year cache is safe.

### URL Pattern

```
https://content.revelations.studio/thumbnails/{contentId}-{size}.webp
```

### Browser Selection

Frontend uses `<picture>` or srcset for format selection:

```html
<picture>
  <source
    srcset="thumb-sm.webp 200w, thumb-md.webp 400w, thumb-lg.webp 800w"
    type="image/webp"
  />
  <img
    srcset="thumb-sm.jpg 200w, thumb-md.jpg 400w, thumb-lg.jpg 800w"
    src="thumb-md.jpg"
    alt="Content thumbnail"
  />
</picture>
```

---

## Integration with Transcoding Pipeline

### Transcoding Flow (Implemented)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Content-API
    participant M as Media-API
    participant R as RunPod
    participant S as R2 Storage

    U->>C: Upload video
    C->>S: Store original in {creatorId}/originals/{mediaId}/
    C->>C: Create media_item (status: uploading → uploaded)
    C->>M: POST /api/transcoding/trigger (HMAC auth)
    M->>R: POST /v2/{endpoint}/run
    R-->>M: { id: "job-xxx", status: "IN_QUEUE" }
    M->>M: Update status: transcoding

    Note over R: Async processing on GPU
    R->>S: Upload HLS to {creatorId}/hls/{mediaId}/
    R->>S: Upload thumbnail to {creatorId}/thumbnails/{mediaId}/
    R->>M: POST /api/transcoding/webhook (HMAC signed)

    M->>M: Verify HMAC signature
    M->>M: Update media_item atomically
    M-->>R: 200 OK
```

### Webhook Callback Payload

RunPod sends an HMAC-signed callback to `/api/transcoding/webhook`:

```typescript
// Validated by runpodWebhookSchema in @codex/validation
interface RunPodWebhookPayload {
  jobId: string;                    // RunPod job ID
  status: 'completed' | 'failed';
  output?: {
    mediaId: string;                // Links back to DB record
    type: 'video' | 'audio';
    hlsMasterKey?: string;          // '{creatorId}/hls/{mediaId}/master.m3u8'
    hlsPreviewKey?: string;         // '{creatorId}/hls/{mediaId}/preview/preview.m3u8'
    thumbnailKey?: string;          // '{creatorId}/thumbnails/{mediaId}/auto-generated.jpg'
    waveformKey?: string;           // Audio only: '{creatorId}/waveforms/{mediaId}/waveform.json'
    waveformImageKey?: string;      // Audio only: '{creatorId}/waveforms/{mediaId}/waveform.png'
    durationSeconds?: number;       // Media duration
    width?: number;                 // Video dimensions
    height?: number;
    readyVariants?: string[];       // ['1080p', '720p', '480p', '360p']
    loudnessIntegrated?: number;    // LUFS × 100
    loudnessPeak?: number;          // dBTP × 100
    loudnessRange?: number;         // LU × 100
  };
  error?: string;                   // Present on failure (max 2000 chars)
}
```

### Webhook Security

- **HMAC-SHA256 verification**: All webhooks verified via `x-runpod-signature` header
- **Timestamp validation**: Max 5-minute clock skew allowed
- **Atomic updates**: Uses conditional WHERE clause to prevent race conditions
- **See**: `workers/media-api/src/middleware/verify-runpod-signature.ts`

---

## Database Schema Updates

### Content Table

```sql
-- Add thumbnail URL field (stores base URL, sizes derived)
ALTER TABLE content ADD COLUMN thumbnail_base_url TEXT;

-- Example value: "https://content.revelations.studio/thumbnails/abc123"
-- Frontend constructs: "{base}-{size}.webp"
```

### Alternative: Store All URLs

```sql
ALTER TABLE content ADD COLUMN thumbnails JSONB;

-- Example value:
-- {
--   "sm": "https://.../abc123-sm.webp",
--   "md": "https://.../abc123-md.webp",
--   "lg": "https://.../abc123-lg.webp"
-- }
```

**Recommendation**: Store base URL only, derive sizes in application code.

---

## Error Handling

### Generation Failures

| Failure | Handling |
|---------|----------|
| Frame extraction fails | Use placeholder, log error |
| Compression fails | Retry once, then placeholder |
| R2 upload fails | Retry with backoff, fail job if persistent |

### Missing Thumbnails

Frontend must handle null/missing thumbnails gracefully:

```typescript
function getThumbnailUrl(content: Content, size: Size): string {
  if (!content.thumbnailBaseUrl) {
    return '/images/placeholder-content.svg';
  }
  return `${content.thumbnailBaseUrl}-${size}.webp`;
}
```

---

## Other Image Types

### Organization Logos

| Aspect | Specification |
|--------|---------------|
| Sizes | 64px, 128px, 256px |
| Format | WebP, PNG fallback (transparency) |
| Upload | Via platform settings |
| Processing | Sharp on API worker (no RunPod needed) |

### User Avatars

| Aspect | Specification |
|--------|---------------|
| Sizes | 32px, 64px, 128px |
| Format | WebP, JPEG fallback |
| Upload | Via account settings |
| Processing | Sharp on API worker |

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Thumbnail generation time | <5s per video |
| File size (md WebP) | <40KB |
| CDN cache hit rate | >95% |
| First paint with thumbnail | <500ms (cached) |

---

## Cost Analysis

### Storage (R2)

```
Per content item:
- 6 thumbnail files × ~50KB average = 300KB
- 1000 content items = 300MB
- R2 cost: $0.015/GB/month = $0.0045/month

Negligible storage cost.
```

### Processing (RunPod)

```
Thumbnail generation adds ~5 seconds to transcoding job.
Marginal cost increase per video.
```

### Egress (Cloudflare CDN)

```
R2 → Cloudflare CDN: Free (same network)
CDN → User: Included in Cloudflare plan
```

---

## Implementation Phases

### Phase 1: Basic Thumbnails ✅ (Implemented)
- [x] Add thumbnail extraction to RunPod worker
- [x] Generate single auto-extracted JPEG thumbnail
- [x] Store in R2 at `{creatorId}/thumbnails/{mediaId}/auto-generated.jpg`
- [x] Webhook returns `thumbnailKey` in payload
- [x] Database stores key in `media_items.thumbnail_key`
- [ ] Frontend displays thumbnails (pending)

### Phase 2: Multi-Size + Format Optimization (Planned)
- [ ] Generate 3 sizes: sm (200px), md (400px), lg (800px)
- [ ] Primary format: WebP (quality 82, effort 6)
- [ ] Fallback format: JPEG (quality 85, mozjpeg)
- [ ] Implement scene detection for better frame selection
- [ ] Add quality scoring to reject poor thumbnails
- [ ] Update path structure to support multiple files per thumbnail

### Phase 3: Other Images (Planned)
- [ ] Org logo upload and processing (Sharp on API worker)
- [ ] User avatar upload and processing (Sharp on API worker)
- [ ] Generic image upload component

---

## Related Issues

- Codex-zjq: Add thumbnail generation to transcoding pipeline
- Codex-iew: Optimize thumbnail compression
- Codex-8zx: Configure R2 CDN caching
- Codex-gg9: WP-13 Image Optimization (frontend)

---

## Related Documents

- [INFRASTRUCTURE.md](./frontend/INFRASTRUCTURE.md) - CDN and caching
- [COMPONENTS.md](./frontend/COMPONENTS.md) - Image components
- [DATA.md](./frontend/DATA.md) - Thumbnail URL patterns

