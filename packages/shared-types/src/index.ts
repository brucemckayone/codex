/**
 * @codex/shared-types
 *
 * Shared TypeScript types for the Codex platform.
 * Provides common type definitions used across workers and services.
 *
 * NOTE: Entity-specific response types (ContentResponse, MediaResponse, etc.)
 * are defined in their respective packages (@codex/content, @codex/identity)
 * to avoid circular dependencies.
 */

// API query parameter types (for documentation - see api-queries.ts)
export type {
  AdminActivityQueryInput,
  AdminContentListQueryInput,
  AdminCustomerListQueryInput,
  AdminDashboardStatsQueryInput,
  AdminRevenueQueryInput,
  AdminTopContentQueryInput,
  ContentQueryInput,
  ListMembersQueryInput,
  ListTemplatesQuery,
  MediaQueryInput,
  OrganizationQueryInput,
  PaginationInput,
  PublicMembersQueryInput,
  PurchaseQueryInput,
} from './api-queries';

// API response types (generic wrappers and non-entity-specific types)
export type {
  ActivityFeedResponse,
  ActivityItem,
  ActivityItemType,
  AllSettingsResponse,
  AvatarUploadResponse,
  BrandingSettingsResponse,
  CheckSlugResponse,
  ContactSettingsResponse,
  CustomerListItem,
  DeleteOrganizationResponse,
  FeatureSettingsResponse,
  MembershipLookupResponse,
  MyMembershipResponse,
  NotificationPreferencesResponse,
  PaginatedListResponse,
  PaginationMetadata,
  PlaybackProgressResponse,
  PublicBrandingResponse,
  RevenueAnalyticsResponse,
  RevenueByDay,
  SingleItemResponse,
  StreamingUrlResponse,
  TopContentAnalyticsResponse,
  UpdatePlaybackProgressResponse,
  UserLibraryResponse,
} from './api-responses';

// Worker types
export type {
  AuthenticatedContext,
  Bindings,
  CheckoutResponse,
  EnrichedAuthContext,
  ErrorResponse,
  HonoEnv,
  ProgressData,
  SessionData,
  SuccessResponse,
  UserData,
  Variables,
} from './worker-types';
