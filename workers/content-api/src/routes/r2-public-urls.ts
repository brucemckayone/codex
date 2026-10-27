/**
 * The catalogue wire item, and the R2 key -> public URL resolution it needs.
 *
 * Shared by the anonymous public content routes (public.ts), the signed-in
 * browse route (content.ts) and the withdrawn read (content-access.ts,
 * Codex-ov2ii), so a withdrawn item draws its thumbnail and preview exactly as
 * it did on the storefront. It is a helper module, not a router, so those
 * routes do not import a router file to reach it.
 *
 * Every RELATION on the item is BUILT field by field, never spread
 * (Codex-ve5eh, Codex-567de, Codex-1bdx0). The routes used to spread the
 * service's rows, so whatever `listPublic` selected went on the wire: whole
 * media_items rows (the original upload's r2Key, the master playlist key, the
 * RunPod job id, the transcoder's free-text error, the raw thumbnail and
 * preview keys beside the URLs built from them) and whole organizations rows
 * (the payee's `primaryConnectAccountUserId`). The service now selects only
 * what is read here, and the allow-list is repeated HERE, at the boundary,
 * typed against the `@codex/shared-types` contract, so a wider relation select
 * later cannot widen the response.
 *
 * The content row's OWN columns pass through as the service selects them, so
 * the service is where a content column is kept off the wire (`listPublic` and
 * the browse list leave out `purchaseCount`). A new internal column on
 * `content` needs an exclusion there.
 *
 * Caches: the org list KV-caches `listPublic`'s ROWS and builds this after the
 * read (public.ts), so a change here alone needs no
 * `PUBLIC_CONTENT_SHAPE_VERSION` bump. apps/web's /explore KV-caches the browse
 * route's output of this function under `content:auth:vN` (180s), so removing a
 * field here needs a bump THERE.
 */

import type { PublicMediaItemSource } from '@codex/content';
import type { Logger } from '@codex/observability';
import type {
  PublicContentCreator,
  PublicContentOrganization,
  PublicMediaItem,
} from '@codex/shared-types';

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

/**
 * A key's public URL, or null when there is no key or no base to resolve it
 * against. The builder and the missing-base warning share it, so the warning
 * can never disagree with what was sent.
 */
function publicUrl(
  base: string | undefined,
  key: string | null
): string | null {
  if (!key || !base) return null;
  return `${base}/${key}`;
}

function buildMediaItem(
  mediaItem: PublicMediaItemSource,
  bases: R2PublicBases
): PublicMediaItem {
  return {
    durationSeconds: mediaItem.durationSeconds,
    thumbnailUrl: publicUrl(bases.assets, mediaItem.thumbnailKey),
    hlsPreviewUrl: publicUrl(bases.mediaPreview, mediaItem.hlsPreviewKey),
  };
}

/** One row to its wire item: each relation rebuilt from named fields. */
function buildPublicItem<T extends CatalogueRelations>(
  row: T,
  bases: R2PublicBases
): PublicItem<T> {
  const { mediaItem, organization, creator, ...rest } = row;
  return {
    ...rest,
    mediaItem: mediaItem ? buildMediaItem(mediaItem, bases) : null,
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
  obs: Logger | undefined
): void {
  let unresolvedThumbnails = 0;
  let unresolvedPreviews = 0;
  for (const { mediaItem } of rows) {
    if (!mediaItem) continue;
    const { thumbnailKey, hlsPreviewKey } = mediaItem;
    if (thumbnailKey && !publicUrl(bases.assets, thumbnailKey)) {
      unresolvedThumbnails++;
    }
    if (hlsPreviewKey && !publicUrl(bases.mediaPreview, hlsPreviewKey)) {
      unresolvedPreviews++;
    }
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

/**
 * One row to its wire item, warning when a key has no base to resolve it.
 * `obs` is required, though it may be undefined: a caller that leaves it out
 * is a compile error, not a silent null poster (it was, once, Codex-ve5eh).
 */
export function toPublicItem<T extends CatalogueRelations>(
  row: T,
  bases: R2PublicBases,
  obs: Logger | undefined
): PublicItem<T> {
  warnOnUnresolvedKeys([row], bases, obs);
  return buildPublicItem(row, bases);
}

/** A page of rows to wire items, with at most one warning for the page. */
export function toPublicItems<T extends CatalogueRelations>(
  rows: T[],
  bases: R2PublicBases,
  obs: Logger | undefined
): PublicItem<T>[] {
  warnOnUnresolvedKeys(rows, bases, obs);
  return rows.map((row) => buildPublicItem(row, bases));
}
