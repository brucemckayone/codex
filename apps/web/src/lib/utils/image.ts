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
 * The file a share card (`og:image`) should use: the largest a still has, xl
 * when its address records the picture's size, else lg (Codex-kk9nv.2). That
 * file's own width and height come with it when known, for
 * `og:image:width`/`og:image:height`.
 */
export function getShareImage(url: string): {
  url: string;
  width?: number;
  height?: number;
} {
  const shareUrl = getThumbnailUrl(url, 'xl');
  const size = getThumbnailDimensions(url);
  if (!size) return { url: shareUrl };
  const width = Math.min(THUMBNAIL_WIDTHS.xl, size.width);
  return {
    url: shareUrl,
    width,
    height: Math.round((size.height * width) / size.width),
  };
}

/**
 * A `sizes` for a picture drawn with `object-fit: cover` into a frame of
 * `frameRatio` (width / height). A picture wider than its frame is drawn
 * wider than the frame, by (picture ratio / frame ratio), and a width-only
 * `sizes` cannot say so: a 16:9 picture in a 3:4 tile needs about 2.4x the
 * tile's width.
 *
 * When the address does not record the picture's size (every video poster,
 * every upload from before Codex-kk9nv.5), `assumedRatio` stands in: what
 * that slot's pictures are drawn as, e.g. 16:9 for a poster. Without one this
 * is `slots` unchanged.
 *
 * `slots` may be a whole `sizes` list: each entry's length is scaled and its
 * media condition kept, since a condition cannot sit inside `calc()`.
 */
export function coverCropSizes(
  slots: string,
  frameRatio: number,
  url: string | null | undefined,
  assumedRatio?: number
): string {
  const size = getThumbnailDimensions(url);
  const pictureRatio = size ? size.width / size.height : assumedRatio;
  if (pictureRatio === undefined) return slots;
  const scale = Math.round((pictureRatio / frameRatio) * 100) / 100;
  // Also a ratio that is not a number: a NaN scale would void every entry.
  if (!(scale > 1)) return slots;
  return splitTopLevel(slots)
    .map((entry) => {
      const { condition, length } = splitSizesEntry(entry);
      return `${condition}calc(${length} * ${scale})`;
    })
    .join(', ');
}

/** A `sizes` list split on the commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * One `sizes` entry as its media condition (with its trailing space, or '')
 * and its length. The length is the last token outside parentheses, so a
 * condition of any shape is kept whole: `(a) and (b)`, `not (a)`.
 */
function splitSizesEntry(entry: string): { condition: string; length: string } {
  let depth = 0;
  let lastSpace = -1;
  for (let i = 0; i < entry.length; i++) {
    const char = entry.charAt(i);
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && /\s/.test(char)) lastSpace = i;
  }
  return {
    condition: entry.slice(0, lastSpace + 1),
    length: entry.slice(lastSpace + 1),
  };
}

/**
 * `sizes` for a card in the 1→2→3-column `.content-grid` (utilities.css):
 * one column below 40rem, two from 40rem, three from 64rem in the 80rem
 * container (Codex-kk9nv.1). It used to describe the page, not the card:
 * 200px for a 290-360px phone card (soft), and 800px for a 210-400px desktop
 * card (wasted). A rail or grid of another shape passes its own.
 */
export const DEFAULT_SIZES =
  '(min-width: 64rem) min(calc((100vw - 6rem) / 3), 25rem), (min-width: 40rem) calc((100vw - 4.5rem) / 2), calc(100vw - 2rem)';
