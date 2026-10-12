/**
 * A practice's picture, as a URL a browser can load (Codex-61zsk.52, Codex-e140e).
 *
 * Two places can hold it: the creator's own thumbnail (`content.thumbnailUrl`,
 * already a full CDN URL to the `lg` variant, host-checked on write) and the
 * frame the transcode took (`media_items.thumbnailKey`, a bare R2 KEY to the
 * `lg` variant). The key needs the env-owned CDN base in front of it, the way
 * `routes/public.ts` `resolveR2Urls` and the sell preview resolve it.
 *
 * Every curriculum loader reads its practices' pictures through this ONE
 * function. Two of them used to hand the raw key to an `<img>` when an item
 * had no custom thumbnail (`row.thumbnailUrl ?? row.mediaThumbnailKey`), which
 * the browser resolved as a relative path and drew as a broken image.
 *
 * No base (a worker not configured with one) gives `null`, never a key: the
 * surfaces draw their own no-picture state rather than a broken one.
 */
export function resolvePracticeThumbnail(
  customUrl: string | null | undefined,
  mediaThumbnailKey: string | null | undefined,
  r2PublicUrlBase: string | undefined
): string | null {
  if (customUrl) return customUrl;
  if (!mediaThumbnailKey || !r2PublicUrlBase) return null;
  const base = r2PublicUrlBase.endsWith('/')
    ? r2PublicUrlBase.slice(0, -1)
    : r2PublicUrlBase;
  return `${base}/${mediaThumbnailKey}`;
}
