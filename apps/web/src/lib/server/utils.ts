/**
 * Shared server-side utilities for page server loads.
 */

/**
 * Map URL sort param to API sortBy value (must match listUserLibrarySchema).
 * Used by both platform and org library server loads.
 */
export function parseSortParam(
  sort: string | null
): 'recent' | 'title' | 'duration' {
  switch (sort) {
    case 'az':
    case 'za':
      return 'title';
    default:
      return 'recent';
  }
}
