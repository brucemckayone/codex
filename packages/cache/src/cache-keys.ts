/**
 * Cache Key Management
 *
 * Centralized cache key builders and constants.
 * Ensures consistency across the platform.
 */

/**
 * Default prefix for all cache keys
 */
export const CACHE_PREFIX = 'cache';

/**
 * Cache type identifiers for different data categories
 *
 * These are used as the "type" parameter in buildCacheKey()
 * to create namespaced cache keys like: cache:user:profile:{userId}
 */
export const CacheType = {
  // --- Entity-level types (data cache + client manifest) ---

  /** User profile data (name, email, username, bio, etc.) */
  USER_PROFILE: 'user:profile',

  /** User notification preferences */
  USER_PREFERENCES: 'user:preferences',

  /** Organization configuration and settings */
  ORG_CONFIG: 'org:config',

  /** Organization public aggregate statistics (content counts, creators, duration) */
  ORG_STATS: 'org:stats',

  /** Organization public creators (paginated, includes content counts + recent content) */
  ORG_CREATORS: 'org:creators',

  /** Organization member lists */
  ORG_MEMBERS: 'org:members',

  /** Content metadata (title, description, visibility, etc.) */
  CONTENT_METADATA: 'content:metadata',

  /** Content access control data */
  CONTENT_ACCESS: 'content:access',

  /** Organization subscription tiers (sorted list, public) */
  ORG_TIERS: 'org:tiers',

  /** Org content list with auth-only sort (popular, top-selling) — TTL-only, no event invalidation */
  ORG_CONTENT_SORTED: 'org:content:sorted',

  /** User session data (complements BetterAuth KV cache) */
  USER_SESSION: 'user:session',

  /** Organization membership (role, status per user per org) */
  ORG_MEMBERSHIP: 'org:membership',

  // --- Collection version identifiers ---
  // These IDs are passed to cache.invalidate() to bump a collection version.
  // They do NOT store cached data — they store a version timestamp used for
  // invalidating all cached items in that collection.

  /**
   * Server KV only — content catalogue is server-authoritative.
   * Bumped when any content is published, unpublished, or updated.
   * Not tracked in client manifest (SSR re-renders correctly on every request).
   */
  COLLECTION_CONTENT_PUBLISHED: 'content:published',

  /**
   * Server KV only — org-specific content list.
   * Bumped when content in this org is published/unpublished/updated.
   * Not tracked in client manifest.
   */
  COLLECTION_ORG_CONTENT: (orgId: string): string => `org:${orgId}:content`,

  /**
   * Client manifest + server KV — user-scoped library.
   * Bumped when a purchase completes, so another device's library goes stale.
   * Tracked in client manifest for cross-device staleness detection.
   */
  COLLECTION_USER_LIBRARY: (userId: string): string => `user:${userId}:library`,

  /**
   * Client manifest + server KV — user-scoped subscription per org.
   * Bumped when subscription changes (checkout, tier change, cancel, reactivate).
   * Tracked in client manifest for cross-device staleness detection.
   */
  COLLECTION_USER_SUBSCRIPTION: (userId: string, orgId: string): string =>
    `user:${userId}:subscription:${orgId}`,
} as const;

/**
 * Cache type enum for type safety — string values only (excludes function members)
 */
export type CacheType = Extract<
  (typeof CacheType)[keyof typeof CacheType],
  string
>;

/**
 * Build a cache key for a specific entity
 *
 * The version is NOT included here - VersionedCache adds it automatically.
 *
 * @param type - The type of data being cached (from CacheType)
 * @param id - The unique identifier for the entity (userId, orgId, etc.)
 * @returns A cache key without version (e.g., "cache:user:profile:abc123")
 *
 * @example
 * ```typescript
 * buildCacheKey(CacheType.USER_PROFILE, 'user-123');
 * // Returns: "cache:user:profile:user-123"
 * ```
 */
export function buildCacheKey(type: CacheType, id: string): string {
  return `${CACHE_PREFIX}:${type}:${id}`;
}

/**
 * Build the version key for an entity
 *
 * Version keys store the current version number for an entity.
 * When the version changes, all old cache keys become stale.
 *
 * @param id - The unique identifier for the entity
 * @returns A version key (e.g., "cache:version:user-123")
 *
 * @example
 * ```typescript
 * buildVersionKey('user-123');
 * // Returns: "cache:version:user-123"
 * ```
 */
export function buildVersionKey(id: string): string {
  return `${CACHE_PREFIX}:version:${id}`;
}

/**
 * Build a fully-versioned cache key
 *
 * This is used internally by VersionedCache to construct
 * the final key that includes the version number.
 *
 * @param prefix - Cache prefix (usually CACHE_PREFIX)
 * @param type - The type of data being cached
 * @param id - The unique identifier for the entity
 * @param version - The current version number
 * @returns A fully-qualified cache key (e.g., "cache:user:profile:user-123:v1712345678")
 *
 * @example
 * ```typescript
 * buildVersionedCacheKey('cache', 'user:profile', 'user-123', '1712345678');
 * // Returns: "cache:user:profile:user-123:v1712345678"
 * ```
 */
export function buildVersionedCacheKey(
  prefix: string,
  type: string,
  id: string,
  version: string
): string {
  return `${prefix}:${type}:${id}:v${version}`;
}
