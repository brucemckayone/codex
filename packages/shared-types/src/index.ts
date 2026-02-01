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

// API response types (generic wrappers and non-entity-specific types)
export type {
  CheckSlugResponse,
  DeleteOrganizationResponse,
  PaginatedListResponse,
  PaginationMetadata,
  PlaybackProgressResponse,
  SingleItemResponse,
  StreamingUrlResponse,
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
