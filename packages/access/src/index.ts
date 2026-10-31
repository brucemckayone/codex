/**
 * @codex/access
 *
 * Content access control and playback tracking for Codex platform.
 *
 * Core Responsibilities:
 * - Verify user access to content (free vs purchased)
 * - Generate time-limited signed R2 URLs for streaming
 * - Track video/audio playback progress for resume functionality
 * - Provide user content library with watch history
 *
 * Integration Points:
 * - Used by: Auth worker (streaming URLs), Admin dashboard (analytics)
 * - Depends on: @codex/database (content, purchases), @codex/cloudflare-clients (R2)
 *
 * Security Model:
 * - All operations require authenticated user ID (from JWT)
 * - Row-level security: Users can only access their own data
 * - Access control: Paid content requires purchase verification
 */

// Entitlements read-resolution (Codex-2pryk.2.3 · WP-2). The frozen resolver
// contract lives in @codex/shared-types; re-exported here for consumers that
// already import @codex/access.
export type {
  Entitlement,
  EntitlementResolver,
  EntitlementSource,
  ResourceType,
} from '@codex/shared-types';
// Re-export validation schemas for convenience
export {
  type GetPlaybackProgressInput,
  type GetStreamingUrlInput,
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  type ListUserLibraryInput,
  listUserLibrarySchema,
  type SavePlaybackProgressInput,
  savePlaybackProgressSchema,
} from '@codex/validation';
// Export error classes
export {
  AccessDeniedError,
  ContentNotFoundError,
  CourseMediaDeletedError,
  type CourseMediaSlot,
  InvalidContentTypeError,
  MediaNotFoundError,
  MediaNotReadyForStreamingError,
  R2SigningError,
} from './errors';
// HLS playlist-proxy helpers (WP-14)
export {
  collectVariantSegments,
  type FilmScope,
  type RewriteMasterOptions,
  type RewriteVariantOptions,
  rewriteMasterPlaylist,
  rewriteVariantPlaylist,
} from './hls-rewrite';
export {
  type FilmTokenCheck,
  type FilmTokenPayload,
  type HlsTokenPayload,
  type OrgFilmTokenCheck,
  type OrgFilmTokenPayload,
  signFilmToken,
  signHlsToken,
  signOrgFilmToken,
  type TokenRefusal,
  verifyFilmToken,
  verifyHlsToken,
  verifyOrgFilmToken,
} from './hls-token';
// The two public R2 hosts a poster and a preview resolve against: shared by
// content-api's catalogue and the intro film's views.
export {
  publicUrl,
  type R2PublicBases,
  resolveR2PublicBases,
} from './r2-public-bases';
export type {
  Revocation,
  RevocationReason,
} from './services/access-revocation';
export {
  AccessRevocation,
  REVOCATION_KEY_PREFIX,
  REVOCATION_TTL_SECONDS,
} from './services/access-revocation';
export type {
  ContentAccessEnv,
  ContentAccessServiceConfig,
} from './services/ContentAccessService';
export {
  ContentAccessService,
  createContentAccessService,
  DEFAULT_STREAMING_URL_TTL_SECONDS,
} from './services/ContentAccessService';
// Course monetization: tier-access management (N1 guard) + offer read (WP-6).
export { CourseAccessService } from './services/course-access-service';
export type {
  CourseEngagement,
  InsightsPeriod,
  JourneyInsightsData,
  LiveFinancials,
  MetricSample,
  TrendPoint,
} from './services/course-insights-service';
// Course studio insights: financial + engagement aggregation (Round-D · WP-7).
export { CourseInsightsService } from './services/course-insights-service';
// Course member surfaces: dashboard + in-course player reads (Round-D · Codex-776gg).
export { CourseJourneyService } from './services/course-journey-service';
export { EntitlementsService } from './services/entitlements-service';
// The org intro film's one read (Codex-376dl): the public org info and the
// studio draw from it what the minter mints from.
export { toPublicIntroFilm } from './services/intro-film-views';
// Plan access by ticks (Codex-2hxff.91): the studio's tier-contents reads and
// the tier checklist's delta write.
export {
  PlanAccessService,
  type PlanAccessServiceConfig,
  type PlanItemAccess,
  type PlanItemKind,
  type PlanItemRef,
  type PlanItemRow,
  type PlanItemsDeltaResult,
  type TierAccessGap,
  type TierAccessSummary,
  type TierAccessSummaryRow,
  type TierDeleteImpact,
} from './services/plan-access-service';
// The intro film's resolver (Codex-376dl), which the minter mints from.
export {
  type IntroFilmMedia,
  type IntroFilmRefusal,
  type IntroFilmResolution,
  resolveIntroFilm,
} from './services/sales-films';
export type {
  ContentBodySource,
  ContentHeld,
  ContentHeldBy,
  CourseEntryResponse,
  CourseFilmStreamResponse,
  OrgFilmStreamResponse,
  PlaybackProgressResponse,
  StreamingUrlResponse,
  UpdatePlaybackProgressResponse,
  UserLibraryResponse,
  WithdrawnContent,
} from './types';
