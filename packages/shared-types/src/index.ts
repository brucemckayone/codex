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

// API response types (generic wrappers and cross-cutting types)
export type {
  AllSettingsResponse,
  ApiErrorEnvelope,
  ApiListEnvelope,
  ApiSingleEnvelope,
  BrandingSettingsResponse,
  CheckSlugResponse,
  ContactSettingsResponse,
  FeatureSettingsResponse,
  MembershipLookupResponse,
  MyMembershipResponse,
  OrganizationPublicStatsResponse,
  OrganizationWithRole,
  PaginatedListResponse,
  PaginationMetadata,
  PaginationParams,
  PublicBrandingResponse,
  SingleItemResponse,
  SortOrder,
} from './api-responses';

// Financial types (revenue splits, fees, payouts)
export type { RevenueSplit } from './financial';

// Journeys / Landing-Page-Builder contracts (Codex-2pryk · WP-0 freeze).
// Page model (D1/§4), content access policy + entitlements + the resolver
// signature (D2/§6). Consumed by @codex/database (schema jsonb $type),
// @codex/access (resolver impl), and apps/web via $lib/page-builder.
export type {
  BrandTokenOverrides,
  CompletionSource,
  ContentAccessPolicy,
  ContentCourseLinks,
  CourseAccessPath,
  CourseCardSummary,
  CourseDashboardData,
  CourseOffer,
  CourseSectionType,
  CourseSellPreview,
  CourseSellPreviewClip,
  CourseTierOffer,
  EditorCurriculum,
  EditorPracticeView,
  EditorStageView,
  EnrolledCourseProgress,
  EnrolledCourseSummary,
  EnrolledJourneyCard,
  Entitlement,
  EntitlementResolver,
  EntitlementSource,
  InCoursePracticeData,
  JourneyCardView,
  JourneyCoursePage,
  JourneyCourseSummary,
  JourneyCourseView,
  JourneyEnrollment,
  JourneyListItem,
  JourneyPageRecord,
  JourneyPractice,
  JourneyPracticeView,
  JourneyProgressStatus,
  JourneySellMedia,
  JourneyStage,
  JourneyStageView,
  JourneyTestimonialView,
  PageBuilderState,
  PageOffer,
  PageSection,
  PageSeo,
  PageStatus,
  PlaylistEntry,
  PracticeCompletionRecord,
  PracticeContentType,
  ResolvedSectionDesign,
  ResourceType,
  SectionDesign,
  SectionProps,
  StoredEntitlementSource,
} from './journeys';

// Organization and Member types
export type { OrgMemberContext, OrgMemberRole } from './member-types';

// Studio UI filter primitives (lookback windows, etc.)
export type { DateRange } from './studio-filters';

// Worker types
export type {
  AuthenticatedContext,
  Bindings,
  CheckoutResponse,
  EnrichedAuthContext,
  ErrorResponse,
  HonoEnv,
  ProgressData,
  PublicCreatorProfile,
  SessionData,
  UserData,
  UserProfile,
  Variables,
} from './worker-types';
