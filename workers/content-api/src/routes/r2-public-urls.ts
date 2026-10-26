/**
 * The catalogue wire item, and the R2 key -> public URL resolution it needs.
 *
 * Shared by the anonymous public content routes (public.ts), the signed-in
 * browse route (content.ts) and the withdrawn read (content-access.ts,
 * Codex-ov2ii), so a withdrawn item draws its thumbnail and preview exactly as
 * it did on the storefront. It is a helper module, not a router, so those
 * routes do not import a router file to reach it.
 *
 * Every relation on the item is BUILT field by field, never spread
 * (Codex-ve5eh, Codex-567de, Codex-1bdx0). The routes used to spread the
 * service's rows, so whatever `listPublic` selected went on the wire: whole
 * media_items rows (the original upload's r2Key, the master playlist key, the
 * RunPod job id, the transcoder's free-text error, the raw thumbnail and
 * preview keys beside the URLs built from them) and whole organizations rows
 * (the payee's `primaryConnectAccountUserId`). The service now selects only
 * what is read here, and the allow-list is repeated HERE, at the boundary,
 * typed against the `@codex/shared-types` contract, so a wider select later
 * cannot widen the response.
 *
 * The org list KV-caches this output, so removing a field here needs a
 * `PUBLIC_CONTENT_SHAPE_VERSION` bump (public-cache.ts), and apps/web's
 * /explore caches the browse output under `content:auth:v*`.
 */

import type { PublicMediaItemSource } from '@codex/content';
import type { Logger } from '@codex/observability';
import type {
  PublicContentCreator,
  PublicContentOrganization,
  PublicMediaItem,
} from '@codex/shared-types';

/**
 * The two public hosts this route resolves keys against.
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

/** The three relations a catalogue row carries out of the service. */
type CatalogueRelations = {
  mediaItem: PublicMediaItemSource | null;
  organization: PublicContentOrganization | null;
  creator: PublicContentCreator;
};

/** A catalogue row as the client receives it. */
export type PublicItem<T extends CatalogueRelations> = Omit<
  T,
  keyof CatalogueRelations
> & {
  mediaItem: PublicMediaItem | null;
  organization: PublicContentOrganization | null;
  creator: PublicContentCreator;
};

/** One row to its wire item: each relation rebuilt from named fields. */
function buildPublicItem<T extends CatalogueRelations>(
  row: T,
  bases: R2PublicBases
): PublicItem<T> {
  const { mediaItem, organization, creator, ...rest } = row;
  return {
    ...rest,
    mediaItem: mediaItem
      ? {
          durationSeconds: mediaItem.durationSeconds,
          thumbnailUrl:
            mediaItem.thumbnailKey && bases.assets
              ? `${bases.assets}/${mediaItem.thumbnailKey}`
              : null,
          hlsPreviewUrl:
            mediaItem.hlsPreviewKey && bases.mediaPreview
              ? `${bases.mediaPreview}/${mediaItem.hlsPreviewKey}`
              : null,
        }
      : null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logoUrl: organization.logoUrl,
        }
      : null,
    creator: { id: creator.id, name: creator.name },
  };
}

/**
 * A key with no base to resolve it against is sent as a null URL, which reads
 * on the page as "no poster" or "no preview", not as an error, so a missing
 * binding would otherwise go unnoticed. One warning per call (per request),
 * never per row.
 */
function warnOnUnresolvedKeys(
  rows: readonly CatalogueRelations[],
  bases: R2PublicBases,
  obs?: Logger
): void {
  let unresolvedThumbnails = 0;
  let unresolvedPreviews = 0;
  for (const { mediaItem } of rows) {
    if (mediaItem?.thumbnailKey && !bases.assets) unresolvedThumbnails++;
    if (mediaItem?.hlsPreviewKey && !bases.mediaPreview) unresolvedPreviews++;
  }
  if (unresolvedThumbnails > 0 || unresolvedPreviews > 0) {
    obs?.warn('r2_public_base.missing', {
      assetsBaseSet: Boolean(bases.assets),
      mediaPreviewBaseSet: Boolean(bases.mediaPreview),
      unresolvedThumbnails,
      unresolvedPreviews,
    });
  }
}

/** One row to its wire item, warning when a key has no base to resolve it. */
export function toPublicItem<T extends CatalogueRelations>(
  row: T,
  bases: R2PublicBases,
  obs?: Logger
): PublicItem<T> {
  warnOnUnresolvedKeys([row], bases, obs);
  return buildPublicItem(row, bases);
}

/** A page of rows to wire items, with at most one warning for the page. */
export function toPublicItems<T extends CatalogueRelations>(
  rows: T[],
  bases: R2PublicBases,
  obs?: Logger
): PublicItem<T>[] {
  warnOnUnresolvedKeys(rows, bases, obs);
  return rows.map((row) => buildPublicItem(row, bases));
}
