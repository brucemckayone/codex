/**
 * Raw R2 keys to public CDN URLs, for every route that returns content rows
 * to a client: the public list (`public.ts`) and the withdrawn read
 * (`content-access.ts`, Codex-ov2ii), so a withdrawn item draws its thumbnail
 * and preview exactly as it did on the storefront. It ADDS the URLs; it does
 * not remove the media row's other columns, raw keys included (Codex-ve5eh).
 */

import type { ContentWithRelations } from '@codex/content';

/**
 * The two public hosts these routes resolve keys against.
 *
 * TWO, NOT ONE, and that split is the point of the type (Codex-1g5lh.13).
 * `thumbnailKey` genuinely lives in the PUBLIC assets bucket. `hlsPreviewKey`
 * is `{creatorId}/hls/{mediaId}/preview/preview.m3u8` and lives in the PRIVATE
 * media bucket — packages/transcoding/src/paths.ts:7 documents the whole HLS
 * tree as "a single MEDIA_BUCKET", and the RunPod handler proves it by
 * uploading the entire hls_dir (preview included) to R2_BUCKET_NAME
 * (= codex-media-*) while sending only thumbnails to the assets bucket.
 *
 * Building BOTH fields from `R2_PUBLIC_URL_BASE` is what broke every public HLS
 * preview in production: that base is the assets host, served by apps/web's
 * cdn-proxy from ASSETS_BUCKET alone, so `ASSETS_BUCKET.get(previewKey)`
 * returned null and the manifest 404'd while the poster loaded fine — a play
 * affordance that does nothing, on the highest-traffic public surface.
 */
export type R2PublicBases = {
  /** Public assets host — thumbnails, logos. `R2_PUBLIC_URL_BASE`. */
  assets: string | undefined;
  /** Host that serves the public 30s HLS preview prefix. */
  mediaPreview: string | undefined;
};

/**
 * Resolve the two bases from the worker bindings.
 *
 * DEFAULT, and what production runs: both are `R2_PUBLIC_URL_BASE`, because
 * apps/web's cdn-proxy now serves `{creatorId}/hls/{mediaId}/preview/` — and
 * ONLY that prefix — from a read-only media binding, so the assets host finally
 * answers for previews.
 *
 * `R2_PUBLIC_MEDIA_URL_BASE` is the seam for the other shape: a preview-only
 * host or worker route, for if the owner declines to bind the private bucket
 * into apps/web. Set it and previews move with no code change, while thumbnails
 * stay on the assets host. NEVER point both at a media host — that would 404
 * every thumbnail platform-wide, which is the trap this signature exists to
 * make hard to fall into.
 *
 * The parameter type is declared locally because `R2_PUBLIC_MEDIA_URL_BASE` is
 * not yet on `Bindings` in packages/shared-types/src/worker-types.ts (outside
 * this change); the canonical declaration belongs there, by `R2_PUBLIC_URL_BASE`.
 */
export function resolveR2PublicBases(env: {
  R2_PUBLIC_URL_BASE?: string;
  R2_PUBLIC_MEDIA_URL_BASE?: string;
}): R2PublicBases {
  const assets = env.R2_PUBLIC_URL_BASE;
  return { assets, mediaPreview: env.R2_PUBLIC_MEDIA_URL_BASE ?? assets };
}

/** Resolve one row's raw R2 keys to full CDN URLs */
export function resolveR2Url<T extends ContentWithRelations>(
  item: T,
  bases: R2PublicBases
) {
  return {
    ...item,
    mediaItem: item.mediaItem
      ? {
          ...item.mediaItem,
          thumbnailUrl:
            item.mediaItem.thumbnailKey && bases.assets
              ? `${bases.assets}/${item.mediaItem.thumbnailKey}`
              : null,
          hlsPreviewUrl:
            item.mediaItem.hlsPreviewKey && bases.mediaPreview
              ? `${bases.mediaPreview}/${item.mediaItem.hlsPreviewKey}`
              : null,
        }
      : null,
  };
}

/**
 * Resolve each row's thumbnail and preview keys to CDN URLs. The rest of the
 * media row passes through as selected: narrowing it is the query's job
 * (Codex-ve5eh).
 */
export function resolveR2Urls<T extends ContentWithRelations>(
  items: T[],
  bases: R2PublicBases
) {
  return items.map((item) => resolveR2Url(item, bases));
}
