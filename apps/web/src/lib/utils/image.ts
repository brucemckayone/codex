/**
 * Image utility functions for thumbnail URL generation and srcset construction.
 *
 * Thumbnail URLs follow the convention: {directory}/{size}.webp
 * where size is one of: sm (200w), md (400w), lg (800w), xl (1600w).
 * The size is the filename, not a suffix — e.g. .../media-thumbnails/{id}/sm.webp
 *
 * Since Codex-kk9nv.5 a new upload's directory also names the picture's own
 * size: `.../{width}x{height}-{nonce}/{size}.webp`. Such a directory has `xl`,
 * and every file in it is at most as wide as the picture. A directory without
 * a size in its name (an older upload, a video poster) has sm/md/lg only.
 */
import { readStillFolderName } from '@codex/validation';

type ThumbnailSize = 'sm' | 'md' | 'lg' | 'xl';

const THUMBNAIL_WIDTHS: Record<ThumbnailSize, number> = {
  sm: 200,
  md: 400,
  lg: 800,
  xl: 1600,
};

/**
 * A thumbnail URL that has webp size variants (sm/md/lg/xl.webp): the
 * directory, and the size it names. Only URLs ending with a recognised size
 * filename have siblings to swap to.
 */
const SIZE_VARIANT = /^(.*)\/(sm|md|lg|xl)\.webp$/;

/**
 * The directory of a sized URL and the picture's own size, when the directory
 * records it; `null` for a URL with no sized siblings.
 */
function parseThumbnail(
  url: string
): { dir: string; size: { width: number; height: number } | null } | null {
  const dir = SIZE_VARIANT.exec(url)?.[1];
  if (dir === undefined) return null;
  return {
    dir,
    size: readStillFolderName(dir.slice(dir.lastIndexOf('/') + 1)),
  };
}

/**
 * Get thumbnail URL for a specific size.
 * Replaces the last path segment (filename) with {size}.webp.
 *
 * Any other URL comes back unchanged (Codex-kk9nv.4): an OAuth provider
 * avatar, a legacy seed image or an external picture has no `{size}.webp`
 * siblings, so rewriting its filename made a URL that 404'd. Asked for `xl`,
 * a directory that does not record its size answers `lg`, the largest it has.
 *
 * @example
 * getThumbnailUrl('http://localhost:4100/abc/media-thumbnails/xyz/md.webp', 'sm')
 * // => 'http://localhost:4100/abc/media-thumbnails/xyz/sm.webp'
 */
export function getThumbnailUrl(baseUrl: string, size: ThumbnailSize): string {
  const parsed = parseThumbnail(baseUrl);
  if (!parsed) return baseUrl;
  const stored = size === 'xl' && !parsed.size ? 'lg' : size;
  return `${parsed.dir}/${stored}.webp`;
}

/**
 * Generate srcset string from a thumbnail URL.
 *
 * A directory that records the picture's size lists all four files at the
 * widths they were written at, `min(nominal, picture width)`, so a small
 * upload is never offered as wider than it is; a width two files share is
 * listed once. Any other sized URL lists sm, md and lg at their nominal
 * widths. Returns empty string for URLs that don't follow the
 * {dir}/{size}.webp convention (e.g. legacy seed thumbnails like thumb.jpg)
 * to avoid 404s.
 *
 * @example
 * getThumbnailSrcset('http://localhost:4100/abc/media-thumbnails/xyz/md.webp')
 * // => '.../sm.webp 200w, .../md.webp 400w, .../lg.webp 800w'
 */
export function getThumbnailSrcset(baseUrl: string): string {
  return thumbnailCandidates(baseUrl)
    .map((candidate) => `${candidate.url} ${candidate.width}w`)
    .join(', ');
}

/** The files {@link getThumbnailSrcset} lists, narrowest first. */
function thumbnailCandidates(
  baseUrl: string
): { url: string; width: number }[] {
  const parsed = parseThumbnail(baseUrl);
  if (!parsed) return [];
  const { dir, size } = parsed;
  const names: ThumbnailSize[] = size
    ? ['sm', 'md', 'lg', 'xl']
    : ['sm', 'md', 'lg'];
  const candidates: { url: string; width: number }[] = [];
  for (const name of names) {
    const width = size
      ? Math.min(THUMBNAIL_WIDTHS[name], size.width)
      : THUMBNAIL_WIDTHS[name];
    if (candidates.some((candidate) => candidate.width === width)) continue;
    candidates.push({ url: `${dir}/${name}.webp`, width });
  }
  return candidates;
}

/**
 * The picture's own size, for an `<img>`'s `width`/`height` so the page does
 * not jump when it arrives; `null` when the URL does not record it.
 */
export function getThumbnailDimensions(
  url: string | null | undefined
): { width: number; height: number } | null {
  return url ? (parseThumbnail(url)?.size ?? null) : null;
}

/**
 * A `sizes` for a picture drawn with `object-fit: cover` into a frame of
 * `frameRatio` (width / height). A picture wider than its frame is drawn
 * wider than the frame, by (picture ratio / frame ratio), and a width-only
 * `sizes` cannot say so: a 16:9 picture in a 3:4 tile needs about 2.4x the
 * tile's width. With the picture's size unknown this is `slot` unchanged.
 */
export function coverCropSizes(
  slot: string,
  frameRatio: number,
  url: string | null | undefined
): string {
  const size = getThumbnailDimensions(url);
  if (!size) return slot;
  const scale = size.width / size.height / frameRatio;
  return scale > 1 ? `calc(${slot} * ${Math.round(scale * 100) / 100})` : slot;
}

/**
 * Default responsive sizes attribute for common layouts
 */
export const DEFAULT_SIZES =
  '(max-width: 640px) 200px, (max-width: 1024px) 400px, 800px';
