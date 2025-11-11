/**
 * @codex/content
 *
 * Content Management Service Layer for Codex Platform
 *
 * This package provides type-safe, transaction-aware services for managing:
 * - Organizations (content grouping)
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
 * import { createContentService } from '@codex/content';
 * import { db } from '@codex/database';
 *
 * const service = createContentService({
 *   db,
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
  createContentService,
  MediaItemService,
  createMediaItemService,
  OrganizationService,
  createOrganizationService,
} from './services';

// ============================================================================
// Types
// ============================================================================

export type {
  Database,
  DatabaseTransaction,
  ServiceConfig,
  PaginationParams,
  PaginationMetadata,
  PaginatedResponse,
  SortOrder,
  ContentFilters,
  MediaItemFilters,
  OrganizationFilters,
  ContentWithRelations,
  MediaItemWithRelations,
  Content,
  MediaItem,
  Organization,
  NewContent,
  NewMediaItem,
  NewOrganization,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  ContentServiceError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  BusinessLogicError,
  InternalServiceError,
  MediaNotFoundError,
  MediaNotReadyError,
  ContentTypeMismatchError,
  OrganizationNotFoundError,
  ContentNotFoundError,
  SlugConflictError,
  ContentAlreadyPublishedError,
  MediaOwnershipError,
  isContentServiceError,
  wrapError,
} from './errors';

// ============================================================================
// Re-export Validation Schemas (for convenience)
// ============================================================================

export type {
  CreateContentInput,
  UpdateContentInput,
  CreateMediaItemInput,
  UpdateMediaItemInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  ContentQueryInput,
  MediaQueryInput,
  OrganizationQueryInput,
} from '@codex/validation';

export {
  createContentSchema,
  updateContentSchema,
  createMediaItemSchema,
  updateMediaItemSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  contentQuerySchema,
  mediaQuerySchema,
  organizationQuerySchema,
  contentStatusEnum,
  contentTypeEnum,
  visibilityEnum,
  mediaTypeEnum,
  mediaStatusEnum,
} from '@codex/validation';
