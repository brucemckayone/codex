/**
 * @codex/content
 *
 * Content Management Service Layer for Codex Platform
 *
 * This package provides type-safe, transaction-aware services for managing:
 * - Media Items (uploaded videos/audio)
 * - Content (published content with metadata)
 *
 * Core Principles:
 * 1. NO `any` types - all types properly inferred from Drizzle ORM
 * 2. Organization/Creator scoping on ALL queries
 * 3. Transaction safety for multi-step operations
 * 4. Soft deletes only (preserves data integrity)
 * 5. Custom error classes for clear error handling
 *
 * Usage Example:
 * ```typescript
 * import { ContentService } from '@codex/content';
 * import { dbHttp } from '@codex/database';
 *
 * const service = new ContentService({
 *   db: dbHttp,
 *   environment: 'production',
 * });
 *
 * // Create content
 * const content = await service.create({
 *   title: 'My Video',
 *   slug: 'my-video',
 *   contentType: 'video',
 *   mediaItemId: 'media-id',
 *   visibility: 'public',
 *   priceCents: 999, // $9.99
 * }, creatorId);
 *
 * // List content
 * const { items, pagination } = await service.list(creatorId, {
 *   status: 'published',
 *   page: 1,
 *   limit: 20,
 * });
 * ```
 *
 * Integration Points:
 * - Database: @codex/database (Drizzle ORM + Neon)
 * - Validation: @codex/validation (Zod schemas)
 * - Observability: @codex/observability (optional, for logging)
 *
 * Security Model:
 * - Creator Scoping: All queries filtered by creatorId
 * - Organization Scoping: Content can belong to org or be personal (null)
 * - Soft Deletes: deleted_at timestamp preserves data
 * - Authorization: Services enforce ownership before mutations
 *
 * @packageDocumentation
 */

// ============================================================================
// Services
// ============================================================================

export {
  ContentService,
  MediaItemService,
} from './services';

// ============================================================================
// Types
// ============================================================================

export type {
  Content,
  ContentFilters,
  ContentListResponse,
  ContentResponse,
  ContentWithRelations,
  CreateContentResponse,
  CreateMediaResponse,
  Database,
  DatabaseTransaction,
  DeleteContentResponse,
  DeleteMediaResponse,
  MediaItem,
  MediaItemFilters,
  MediaItemWithRelations,
  MediaListResponse,
  MediaResponse,
  NewContent,
  NewMediaItem,
  PaginatedResponse,
  PaginationMetadata,
  PaginationParams,
  PublishContentResponse,
  ServiceConfig,
  SortOrder,
  UnpublishContentResponse,
  UpdateContentResponse,
  UpdateMediaResponse,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  BusinessLogicError,
  ConflictError,
  ContentAlreadyPublishedError,
  ContentNotFoundError,
  ContentServiceError,
  ContentTypeMismatchError,
  ForbiddenError,
  InternalServiceError,
  isContentServiceError,
  MediaNotFoundError,
  MediaNotReadyError,
  MediaOwnershipError,
  NotFoundError,
  SlugConflictError,
  ValidationError,
  wrapError,
} from './errors';

// ============================================================================
// Utilities
// ============================================================================

export {
  type ErrorResponse,
  isKnownError,
  type MappedError,
  mapErrorToResponse,
} from '@codex/service-errors';

// ============================================================================
// Re-export Validation Schemas (for convenience)
// ============================================================================

export type {
  ContentQueryInput,
  CreateContentInput,
  CreateMediaItemInput,
  MediaQueryInput,
  UpdateContentInput,
  UpdateMediaItemInput,
} from '@codex/validation';

export {
  contentQuerySchema,
  contentStatusEnum,
  contentTypeEnum,
  createContentSchema,
  createMediaItemSchema,
  mediaQuerySchema,
  mediaStatusEnum,
  mediaTypeEnum,
  updateContentSchema,
  updateMediaItemSchema,
  visibilityEnum,
} from '@codex/validation';
