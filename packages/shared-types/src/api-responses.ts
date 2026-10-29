/**
 * API Response Types
 *
 * Standardized response type definitions for all Codex API endpoints.
 * Provides consistent response envelopes, pagination formats, and type definitions
 * for improved frontend integration and type safety.
 *
 * All endpoints use these types to ensure:
 * - Consistent pagination metadata
 * - Single-item responses wrapped in { data: T }
 * - List responses use { items: T[], pagination: PaginationMetadata }
 * - Special responses properly typed with JSDoc examples
 *
 * NOTE: Entity-specific response types (ContentResponse, MediaResponse, etc.)
 * are defined in their respective packages (@codex/content, @codex/identity)
 * to avoid circular dependencies.
 */

/**
 * Standard pagination metadata for all paginated responses
 * @example
 * {
 *   page: 1,
 *   limit: 20,
 *   total: 145,
 *   totalPages: 8
 * }
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Input-side pagination parameters (page + limit)
 * Distinct from PaginationMetadata which is the output envelope with total/totalPages
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Sort direction for list queries
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Generic wrapper for paginated list responses
 * All list endpoints return data in this format
 * @template T The type of items in the list
 * @example
 * {
 *   items: [{...}, {...}],
 *   pagination: { page: 1, limit: 20, total: 145, totalPages: 8 }
 * }
 */
export interface PaginatedListResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

// ============================================================================
// API Envelope Types (Wire Format)
// ============================================================================

/**
 * Wire format for single-item responses
 *
 * procedure() wraps handler return values in this envelope automatically.
 * The client `request<T>()` unwraps `.data` for single items.
 *
 * @example Wire: `{ "data": { "id": "...", "title": "..." } }`
 */
export type ApiSingleEnvelope<T> = { data: T };

/**
 * Wire format for list (paginated) responses
 *
 * procedure() emits this when a handler returns PaginatedResult.
 * `items` and `pagination` are top-level siblings — pagination is never
 * buried inside `data`.
 *
 * @example Wire: `{ "items": [...], "pagination": { "page": 1, ... } }`
 */
export type ApiListEnvelope<T> = {
  items: T[];
  pagination: PaginationMetadata;
};

/**
 * Wire format for error responses
 *
 * Produced by mapErrorToResponse() in @codex/service-errors.
 *
 * @example Wire: `{ "error": { "code": "NOT_FOUND", "message": "..." } }`
 */
export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/**
 * Generic wrapper for single-item responses
 * All single-item endpoints return data in this format
 * @template T The type of the item
 * @example
 * {
 *   data: {...}
 * }
 */
export interface SingleItemResponse<T> {
  data: T;
}

// ============================================================================
// Organization Response Types (generic, not entity-specific)
// ============================================================================

/**
 * Response for GET /api/organizations/check-slug/:slug
 * Indicates whether a slug is available for new organizations
 * @example
 * { available: true }
 */
export interface CheckSlugResponse {
  available: boolean;
}

// ============================================================================
// Membership Response Types
// ============================================================================

/**
 * Response for GET /api/organizations/:orgId/membership/:userId
 * Returns the user's role and join date within an organization
 * @example
 * { role: "admin", joinedAt: "2025-06-15T10:30:00.000Z" }
 * // or if not a member:
 * { role: null, joinedAt: null }
 */
// Maintenance: role union must match organizationMembers.role column CHECK constraint
// in packages/database schema. Update both locations if roles change.
export interface MembershipLookupResponse {
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null;
  joinedAt: string | null;
}

/**
 * Response for GET /api/organizations/:orgId/my-membership
 * Returns the authenticated user's own membership in an organization
 * Includes status field to show if membership is active, invited, or inactive
 * @example
 * { role: "admin", status: "active", joinedAt: "2025-06-15T10:30:00.000Z" }
 * // or if not a member:
 * { role: null, status: null, joinedAt: null }
 */
export interface MyMembershipResponse {
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null;
  status: 'active' | 'inactive' | 'invited' | null;
  joinedAt: string | null;
}

/**
 * Organization with user's role
 * Used in my-organizations list response
 */
export interface OrganizationWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member';
}

// ============================================================================
// Public Content Catalogue Types
// ============================================================================

/**
 * The media item on a catalogue row (`GET /api/content/public`, `/discover`,
 * `/api/content/browse`). Built field by field at the content-api boundary
 * (Codex-ve5eh): R2 keys are resolved to CDN URLs there, and no other
 * media_items column (raw keys, RunPod job id, transcoding error) is sent.
 */
export interface PublicMediaItem {
  durationSeconds: number | null;
  /** Resolved CDN URL for the transcoded poster frame */
  thumbnailUrl: string | null;
  /** Resolved CDN URL for the 30-second HLS preview clip */
  hlsPreviewUrl: string | null;
}

/**
 * The org on a catalogue row (Codex-567de): what the web reads, which is a
 * link (`slug`) and the creator profile's org cards (`id`, `name`,
 * `logoUrl`). The rest of the organizations row, the payee's
 * `primaryConnectAccountUserId` among it, is not sent.
 */
export interface PublicContentOrganization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** The creator on a catalogue row: never an email. */
export interface PublicContentCreator {
  id: string;
  name: string | null;
}

// ============================================================================
// Settings Response Types
// ============================================================================

/**
 * Branding settings response shape
 */
export interface BrandingSettingsResponse {
  logoUrl: string | null;
  primaryColorHex: string;
  secondaryColorHex: string | null;
  accentColorHex: string | null;
  backgroundColorHex: string | null;
  fontBody: string | null;
  fontHeading: string | null;
  radiusValue: number;
  densityValue: number;
  // Intro film: the media id only. Its URLs are built on each read
  // (Codex-376dl), so no stored URL can go stale.
  introVideoMediaItemId: string | null;
  // Brand Editor fine-tune fields — text/heading/body weight, shadow scale/color,
  // etc. are stored as keys inside tokenOverrides JSON. The previously
  // broken-out columns were dropped in Codex-g49b4.
  tokenOverrides: string | null;
  darkModeOverrides: string | null;
  /** Codex-wwedk: dark-theme tokenOverrides JSON (parallel to tokenOverrides). */
  darkTokenOverrides: string | null;
  // Hero layout
  heroLayout: string;
  // Pricing FAQ (JSON string: PricingFaqItem[])
  pricingFaq: string | null;
}

/**
 * Contact settings response shape
 */
export interface ContactSettingsResponse {
  platformName: string;
  supportEmail: string;
  contactUrl: string | null;
  timezone: string;
  // Social media URLs
  twitterUrl: string | null;
  youtubeUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}

/**
 * Feature settings response shape
 */
export interface FeatureSettingsResponse {
  enableSignups: boolean;
  enablePurchases: boolean;
  enableSubscriptions: boolean;
}

/**
 * All settings combined response shape
 */
export interface AllSettingsResponse {
  branding: BrandingSettingsResponse;
  contact: ContactSettingsResponse;
  features: FeatureSettingsResponse;
}

/**
 * Public organization statistics for hero section display.
 * Aggregated counts of published content, creators, and total duration.
 * All counts exclude soft-deleted and unpublished items.
 */
export interface OrganizationPublicStatsResponse {
  content: {
    total: number;
    video: number;
    audio: number;
    written: number;
  };
  totalDurationSeconds: number;
  creators: number;
  totalViews: number;
  categories: { name: string; count: number }[];
}

/**
 * Public branding response shape (for unauthenticated endpoints)
 */
export interface PublicBrandingResponse {
  logoUrl: string | null;
  primaryColorHex: string;
  secondaryColorHex: string | null;
  accentColorHex: string | null;
  backgroundColorHex: string | null;
  fontBody: string | null;
  fontHeading: string | null;
  radiusValue: number;
  densityValue: number;
  introFilm: IntroFilm | null;
  heroLayout: string;
}

/**
 * The org intro film, as the public landing page draws it (Codex-376dl).
 * `previewUrl` is its 30-second public preview on the CDN. `fullFilm` says
 * whether a press may ask the org film minter for the whole film; it is a
 * hint, and the minter re-checks on every press. Null on the org when there
 * is no film to show: none picked, or one no longer ready, a video, or by a
 * member of the team.
 */
export interface IntroFilm {
  title: string;
  posterUrl: string | null;
  previewUrl: string | null;
  durationSeconds: number | null;
  fullFilm: boolean;
}

/**
 * The org intro film as the brand studio shows it: what was picked, and
 * which version visitors get. `plays` is `full`, the 30-second `preview` (a
 * paid use, the only cut the rule makes), or `none` with the `reason`
 * visitors see no film.
 */
export interface StudioIntroFilm {
  mediaItemId: string;
  title: string;
  posterUrl: string | null;
  durationSeconds: number | null;
  plays: 'full' | 'preview' | 'none';
  reason?: 'paid' | 'not-ready' | 'not-video' | 'creator-left';
}
