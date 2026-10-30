/**
 * The two public hosts an R2 key resolves against, for every worker that
 * hands out a public poster or preview: content-api's catalogue
 * (`workers/content-api/src/routes/r2-public-urls.ts`) and the org intro
 * film's views (`./services/intro-film-views.ts`, read by organization-api).
 * One definition, so a preview moved to its own host moves everywhere.
 */

/**
 * The two public hosts.
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
 * not yet on `Bindings` in packages/shared-types/src/worker-types.ts; the
 * canonical declaration belongs there, by `R2_PUBLIC_URL_BASE`.
 */
export function resolveR2PublicBases(env: {
  R2_PUBLIC_URL_BASE?: string;
  R2_PUBLIC_MEDIA_URL_BASE?: string;
}): R2PublicBases {
  const assets = env.R2_PUBLIC_URL_BASE;
  return { assets, mediaPreview: env.R2_PUBLIC_MEDIA_URL_BASE ?? assets };
}
