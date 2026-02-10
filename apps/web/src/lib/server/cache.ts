/**
 * Standard cache header presets for server-side load functions.
 */
export const CACHE_HEADERS = {
  /** Public static pages: 1 hour browser + CDN */
  STATIC_PUBLIC: {
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    Vary: 'Accept-Language',
  },
  /** Dynamic public content: 5 min browser + CDN */
  DYNAMIC_PUBLIC: {
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    Vary: 'Accept-Language',
  },
  /** Authenticated/private: no caching */
  PRIVATE: {
    'Cache-Control': 'private, no-cache',
  },
} as const;
