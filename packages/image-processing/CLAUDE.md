# @codex/image-processing

Image validation, WASM-based processing, and R2 storage. Handles content thumbnails, user avatars, and org logos (raster and SVG).

## API

### `ImageProcessingService`
| Method | Purpose | Notes |
|---|---|---|
| `processContentThumbnail(contentId, userId, file)` | Validate → resize → upload | 3 WebP variants (sm/md/lg) |
| `processUserAvatar(userId, file)` | Validate → resize → upload | 3 WebP variants |
| `processOrgLogo(orgId, userId, file)` | Validate → process → upload | SVG: sanitize + store as-is. Raster: 3 WebP variants |
| `delete*(id, userId)` | Remove R2 files + clear DB fields | |

### Error Classes
| Error | Code | When |
|---|---|---|
| `InvalidImageError` | 400 | Corrupt file, wrong MIME type, magic byte mismatch |
| `ImageUploadError` | 400 | Too large, empty, unsupported format |

## Processing Pipeline

1. **Validation**: Check file size (max 5MB), MIME type, magic bytes signature match
2. **Processing**: `@cf-wasm/photon` (Cloudflare-compatible WASM) → Lanczos3 resize → WebP conversion. Never upscales.
3. **Storage** → R2:
   - **Raster**: 3 size variants, immutable cache (1 year: `Cache-Control: public, max-age=31536000`)
   - **SVG**: Sanitized via DOMPurify (`sanitizeSvgContent()` from `@codex/validation`), shorter cache (1hr)
   - **Key format**: `{creatorId}/{type}/{id}/{size}.webp`

### Supported Formats
- Input: PNG, JPEG, WebP, GIF (+ SVG for logos)
- Output: WebP (raster) or sanitized SVG

### Size Variants
| Variant | Typical Max Dimension |
|---|---|
| `sm` | Small thumbnail |
| `md` | Medium display |
| `lg` | Full-size/hero |

## Strict Rules

- **MUST** validate MIME type AND magic bytes — NEVER trust Content-Type header alone
- **MUST** sanitize ALL SVG uploads with `sanitizeSvgContent()` — unsanitized SVGs are XSS vectors
- **MUST** set immutable cache headers on raster images (they're content-addressed)
- **MUST** scope all operations by `creatorId` or `userId`
- **NEVER** upscale images — only downscale
- **NEVER** store unsanitized SVG content
- **NEVER** exceed 5MB file size limit

## Integration

- **Depends on**: `@codex/database`, `@codex/cloudflare-clients` (R2), `@codex/validation` (SVG sanitization), `@cf-wasm/photon`
- **Used by**: content-api worker (thumbnails), identity-api worker (avatars), organization-api worker (logos)

## Reference Files

- `packages/image-processing/src/services/image-processing-service.ts` — ImageProcessingService
