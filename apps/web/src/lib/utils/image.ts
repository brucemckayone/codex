/**
 * Image utility functions for thumbnail URL generation and srcset construction.
 *
 * Thumbnail URLs follow the convention: {base}-{size}.webp
 * where size is one of: sm (200w), md (400w), lg (800w)
 */

export type ThumbnailSize = 'sm' | 'md' | 'lg';

const THUMBNAIL_WIDTHS: Record<ThumbnailSize, number> = {
  sm: 200,
  md: 400,
  lg: 800,
};

/**
 * Get thumbnail URL for a specific size
 *
 * @param baseUrl - Base thumbnail URL (without size suffix)
 * @param size - Thumbnail size variant
 * @returns Sized thumbnail URL
 *
 * @example
 * getThumbnailUrl('/media/thumb-abc123', 'md')
 * // => '/media/thumb-abc123-md.webp'
 */
export function getThumbnailUrl(baseUrl: string, size: ThumbnailSize): string {
  // Strip any existing extension
  const base = baseUrl.replace(/\.[^.]+$/, '');
  return `${base}-${size}.webp`;
}

/**
 * Generate srcset string from a base thumbnail URL
 *
 * @param baseUrl - Base thumbnail URL (without size suffix)
 * @returns srcset string with sm, md, lg variants
 *
 * @example
 * getThumbnailSrcset('/media/thumb-abc123')
 * // => '/media/thumb-abc123-sm.webp 200w, /media/thumb-abc123-md.webp 400w, /media/thumb-abc123-lg.webp 800w'
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
