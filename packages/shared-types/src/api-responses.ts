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
  // Intro video
  introVideoMediaItemId: string | null;
  introVideoUrl: string | null;
  // Brand Editor fine-tune fields
  tokenOverrides: string | null;
  darkModeOverrides: string | null;
  textColorHex: string | null;
  shadowScale: string | null;
  shadowColor: string | null;
  textScale: string | null;
  headingWeight: string | null;
  bodyWeight: string | null;
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
  introVideoUrl: string | null;
  heroLayout: string;
}
