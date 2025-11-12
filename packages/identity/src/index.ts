/**
 * @codex/identity
 *
 * Identity and Organization Management Service Layer
 *
 * This package provides type-safe services for managing:
 * - Organizations (multi-tenant grouping for content and users)
 * - User profiles (future)
 * - Identity-related operations
 *
 * Core Principles:
 * 1. NO `any` types - all types properly inferred from Drizzle ORM
 * 2. Transaction safety for multi-step operations
 * 3. Soft deletes only (preserves data integrity)
 * 4. Custom error classes for clear error handling
 *
 * Usage Example:
 * ```typescript
 * import { createOrganizationService } from '@codex/identity';
 * import { dbHttp } from '@codex/database';
 *
 * const service = createOrganizationService({
 *   db: dbHttp,
 *   environment: 'production',
 * });
 *
 * // Create organization
 * const org = await service.create({
 *   name: 'My Organization',
 *   slug: 'my-org',
 *   description: 'An example organization',
 * });
 *
 * // List organizations
 * const { items, pagination } = await service.list({
 *   search: 'example',
 *   page: 1,
 *   limit: 20,
 * });
 * ```
 *
 * Integration Points:
 * - Database: @codex/database (Drizzle ORM + Neon)
 * - Validation: @codex/validation (Zod schemas)
 * - Used by: @codex/content, workers/auth, workers/content-api
 *
 * Security Model:
 * - Slug uniqueness enforced
 * - Soft Deletes: deleted_at timestamp preserves data
 * - Authorization: Caller responsible for user permission checks
 *
 * @packageDocumentation
 */

// ============================================================================
// Services
// ============================================================================

export { OrganizationService, createOrganizationService } from './services';

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
  OrganizationFilters,
  Organization,
  NewOrganization,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  IdentityServiceError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  BusinessLogicError,
  InternalServiceError,
  OrganizationNotFoundError,
  isIdentityServiceError,
  wrapError,
} from './errors';

// ============================================================================
// Utilities
// ============================================================================

export { mapErrorToResponse, isKnownError } from './utils/error-mapper';

export type { ErrorResponse, MappedError } from './utils/error-mapper';

// ============================================================================
// Re-export Validation Schemas (for convenience)
// ============================================================================

export type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  OrganizationQueryInput,
} from '@codex/validation';

export {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationQuerySchema,
} from '@codex/validation';
