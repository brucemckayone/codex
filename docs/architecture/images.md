# Images: video posters and display

The platform has two sources of pictures. **Stills** are uploads: content thumbnails, avatars, category covers and course stills. `@codex/image-processing` makes them on the API worker, and `packages/image-processing/CLAUDE.md` describes them. **Posters** are frames cut from a video by the RunPod transcoder. The web app shows both the same way.

## Video posters (RunPod)

The poster is step 7 of a transcoding job, run only for video with a known duration (`infrastructure/runpod/handler/main.py:2047-2081`).

- **Frame**: one frame at `max(1, int(duration * 0.1))` seconds (`main.py:1585`). There is no I-frame selection, scene detection or quality scoring.
- **Encode**: FFmpeg `libwebp`, one file per size, never upscaled (`scale='min(width, iw)'`, `main.py:1600`). The ladder is at `main.py:1544-1549`:

  | size | width | quality | compression |
  |---|---|---|---|
  | sm | 200 | 75 | 6 |
  | md | 400 | 80 | 5 |
  | lg | 800 | 82 | 4 |
  | xl | 1600 | 82 | 4 |

- **Where**: ASSETS_BUCKET, under `{creatorId}/media-thumbnails/{mediaId}/`. A job sent with `contract >= 2` (`TRANSCODING_JOB_CONTRACT`, `packages/constants/src/transcoding.ts:288`) whose width and height are known gets a sized folder, `{w}x{h}-{8 hex}/{sm,md,lg,xl}.webp`. Any other job gets flat `{sm,md,lg}.webp` (`main.py:1551-1556, 2051-2077`).
- **Reported as**: `thumbnailKey` is the `lg` key (`main.py:2081`). `thumbnailVariants` carries every size (`packages/validation/src/schemas/transcoding.ts:153-158`). `getThumbnailKey` (`…/thumbnails/{mediaId}/auto-generated.jpg`, `packages/transcoding/src/paths.ts:211`) has no caller.
- **No Cache-Control on the object**: `upload_file` sets only ContentType (`main.py:505-516`). Stills, by contrast, are stored with `R2_IMMUTABLE_OBJECT_CACHE_CONTROL`. What a poster gets at the edge comes from the bucket's cache rule (`packages/constants/src/limits.ts:486-489`).
- **Failure**: a failed poster is a `TranscodeError` that fails the whole job. Partial uploads are deleted and a failure webhook is sent (`main.py:2152-2174`). There is no placeholder and no retry.
- **Webhook signature**: `X-Runpod-Signature` is an HMAC-SHA256 hex digest. The optional `X-Runpod-Timestamp` may be at most 300 s old and at most 60 s in the future (`workers/media-api/src/middleware/verify-runpod-signature.ts:13-30, 231-250`).

## Display (apps/web)

- **Which picture**: `getDisplayThumbnail` (`apps/web/src/lib/utils/thumbnail.ts:5-11, 36-42`). It returns `content.thumbnailUrl` first, then `mediaItem.thumbnailUrl`, then `null`. On `null` the caller draws its own fallback (waveform, icon). content-api builds `mediaItem.thumbnailUrl` as `R2_PUBLIC_URL_BASE` plus `thumbnailKey` (`workers/content-api/src/routes/media.ts:124, 238`). That base is `https://cdn-assets.revelations.studio` in production and the dev-cdn locally (`workers/content-api/wrangler.jsonc:120, 256`).
- **srcset**: `getThumbnailSrcset` (`apps/web/src/lib/utils/image.ts:67-108`) works only on a URL ending in `/{sm|md|lg|xl}.webp` (`image.ts:29`).
  - A sized folder lists all four sizes. Each width is `min(nominal, picture width)`, and a width two files share is listed once.
  - Any other matching URL lists sm, md and lg at 200, 400 and 800.
  - Anything else, such as a legacy `thumb.jpg`, gets no srcset.
  - `getThumbnailUrl(url, size)` swaps the file name (`image.ts:59-63`). The `sizes` helpers start at `image.ts:142`.
- Only WebP is served. There is no JPEG fallback and no `<picture>`.
