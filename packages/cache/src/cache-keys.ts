/**
 * Cache Key Management
 *
 * Centralized cache key builders and constants.
 * Ensures consistency across the platform.
 */

/**
 * Default prefix for all cache keys
 */
const CACHE_PREFIX = 'cache';

/**
 * Version used for an entity that has never been invalidated.
 *
 * A version key exists ONLY once `invalidate()` has written one — the read path
 * never creates one (Codex-kgrdp.5). Until then every read and write for that
 * entity resolves to this fixed base version, so a first read still lands in a
 * durable data slot and the read after it hits, all without spending a KV write
 * on bookkeeping.
 *
 * `delete()` has always used `'0'` as its fallback, so this is the value the
 * key space was already built around — naming it makes `get()`, `set()` and
 * `delete()` provably agree on which slot they are talking about.
 */
export const BASE_VERSION = '0';

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

  /**
   * PUBLIC creator profile — the anonymous-readable subset only
   * (`id`, `name`, `image`, `bio`, `socialLinks`). Keyed by USER ID, so the
   * `invalidate(userId)` calls that `IdentityService` already makes on profile
   * update, avatar upload and creator upgrade clear it for free.
   *
   * Deliberately NOT `USER_PROFILE`: that entry carries the user's `email`,
   * and reusing it for an unauthenticated endpoint would put a PII-bearing
   * object one careless `return` away from the public. Nothing sensitive is
   * ever written into this slot, so the endpoint is safe by construction
   * rather than by the caller remembering to project.
   */
  USER_PUBLIC_PROFILE: 'user:public-profile',

  /**
   * `username` -> user id, for the public profile lookup. Separate hop because
   * the profile itself is keyed by id (see above); a username changes far less
   * often than a profile does, so this slot absorbs the repeated
   * username-resolution reads that would otherwise hit Neon on every
   * anonymous profile view.
   */
  USERNAME_TO_ID: 'user:username-to-id',

  /** User notification preferences */
  USER_PREFERENCES: 'user:preferences',

  /** Organization configuration and settings */
  ORG_CONFIG: 'org:config',

  /** Organization public aggregate statistics (content counts, creators, duration) */
  ORG_STATS: 'org:stats:v2',

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

  /**
   * Stripe Connect account status (per-org).
   * Includes `requirements` payload for the studio monetisation page so the
   * UI can render `currently_due` + `current_deadline` + `errors` without
   * hitting Stripe on every page view.
   *
   * TTL: 10 min. Invalidated by ecom-api on `account.updated` webhook so the
   * worst-case staleness is bounded by the webhook delivery latency.
   */
  CONNECT_STATUS: 'connect:status',

  /** User session data (complements BetterAuth KV cache) */
  USER_SESSION: 'user:session',

  /**
   * Fee config — platform singleton row.
   * Version-bumped on every UPDATE. Reads cached by entity version.
   * Used by FeeConfigService in @codex/purchase. (Codex-m644n)
   *
   * NOTE: "NO TTL" is what these three keys WANT, not what they get.
   * `FeeConfigService.readPlatformFees`/`readOrgFees`/`readCreatorOverride`
   * pass no options, so each slot expires on `DEFAULT_TTL` (600s) and every
   * 10-minute window with traffic in it costs another KV write — for config
   * that changes maybe monthly, and on a path that runs on every purchase.
   * Their invalidation is complete (every mutation calls `invalidateAsync`), so
   * a long explicit `ttl` is both safe and much cheaper. See Codex-kgrdp.5.
   */
  FEE_CONFIG_PLATFORM: 'fee:platform',

  /**
   * Fee config — per-org override row.
   * Version-bumped on every UPDATE. See the TTL note on FEE_CONFIG_PLATFORM.
   */
  FEE_CONFIG_ORG: 'fee:org',

  /**
   * Fee config — per-creator-per-org override row.
   * Version-bumped on every UPDATE. See the TTL note on FEE_CONFIG_PLATFORM.
   */
  FEE_CONFIG_OVERRIDE: 'fee:override',

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

  /**
   * Server KV only — per-space category taxonomy (org landing "Browse by
   * topic"). ORG space keys by `organizationId`; PERSONAL creator space keys by
   * `creatorId`. Bumped when a category is created/updated/deleted/reordered,
   * AND when content is published/unpublished/deleted (that changes the set of
   * topics with ≥1 published item on the public list). Not tracked in the
   * client manifest — public topic cards SSR from the server-authoritative KV
   * slot.
   */
  CATEGORIES: (
    organizationId: string | null | undefined,
    creatorId?: string
  ): string =>
    organizationId
      ? `categories:org:${organizationId}`
      : `categories:creator:${creatorId ?? ''}`,

  /**
   * Server KV only — an org's PUBLIC portal (journey) discovery lists: the
   * landing page's featured rail + portals rail, and /explore's portals rail.
   *
   * Bumped by BOTH sides, because a portal card is part page, part course and
   * part CONTENT:
   * - a journey write (page save/publish, offer price, featured toggle, cover
   *   put/delete, curriculum save) — the page/course half; and
   * - content publish/unpublish/delete — the content half. `practiceCount` and
   *   `stageCount` on each card come from `loadPublishedCurriculumCounts`, which
   *   counts only practices whose content is PUBLISHED, so unpublishing one
   *   practice changes a card that names no content at all.
   *
   * Deliberately a SEPARATE key from {@link COLLECTION_ORG_CONTENT} rather than
   * riding it, mirroring {@link CATEGORIES}: both are content-derived public
   * reads, and both want a content publish to reach them WITHOUT a portal
   * publish staling every cached content filter combo in the org.
   *
   * Not tracked in the client manifest — portal rails SSR from this
   * server-authoritative slot and carry no per-user state. The per-user reads
   * (`/api/journeys/enrolled`) are NOT cached here: enrolled progress changes on
   * every completion, so it is read live.
   */
  COLLECTION_ORG_JOURNEYS: (orgId: string): string => `org:${orgId}:journeys`,
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
