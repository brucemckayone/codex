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

export { createOrganizationService, OrganizationService } from './services';

// ============================================================================
// Types
// ============================================================================

export type {
  Database,
  DatabaseTransaction,
  NewOrganization,
  Organization,
  OrganizationFilters,
  PaginatedResponse,
  PaginationMetadata,
  PaginationParams,
  ServiceConfig,
  SortOrder,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  IdentityServiceError,
  InternalServiceError,
  isIdentityServiceError,
  NotFoundError,
  OrganizationNotFoundError,
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
  CreateOrganizationInput,
  OrganizationQueryInput,
  UpdateOrganizationInput,
} from '@codex/validation';

export {
  createOrganizationSchema,
  organizationQuerySchema,
  updateOrganizationSchema,
} from '@codex/validation';
