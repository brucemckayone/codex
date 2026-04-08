/**
 * Image utility functions for thumbnail URL generation and srcset construction.
 *
 * Thumbnail URLs follow the convention: {directory}/{size}.webp
 * where size is one of: sm (200w), md (400w), lg (800w).
 * The size is the filename, not a suffix — e.g. .../media-thumbnails/{id}/sm.webp
 */

export type ThumbnailSize = 'sm' | 'md' | 'lg';

const THUMBNAIL_WIDTHS: Record<ThumbnailSize, number> = {
  sm: 200,
  md: 400,
  lg: 800,
};

/**
 * Get thumbnail URL for a specific size.
 * Replaces the last path segment (filename) with {size}.webp.
 *
 * @example
 * getThumbnailUrl('http://localhost:4100/abc/media-thumbnails/xyz/md.webp', 'sm')
 * // => 'http://localhost:4100/abc/media-thumbnails/xyz/sm.webp'
 */
export function getThumbnailUrl(baseUrl: string, size: ThumbnailSize): string {
  return baseUrl.replace(/\/[^/]+$/, `/${size}.webp`);
}

/**
 * Generate srcset string from a thumbnail URL.
 * Produces sm, md, lg variants by replacing the filename.
 *
 * @example
 * getThumbnailSrcset('http://localhost:4100/abc/media-thumbnails/xyz/md.webp')
 * // => '.../sm.webp 200w, .../md.webp 400w, .../lg.webp 800w'
 */
export function getThumbnailSrcset(baseUrl: string): string {
  return (Object.entries(THUMBNAIL_WIDTHS) as [ThumbnailSize, number][])
    .map(([size, width]) => `${getThumbnailUrl(baseUrl, size)} ${width}w`)
    .join(', ');
}

/**
 * Default responsive sizes attribute for common layouts
 */
export const DEFAULT_SIZES =
  '(max-width: 640px) 200px, (max-width: 1024px) 400px, 800px';
