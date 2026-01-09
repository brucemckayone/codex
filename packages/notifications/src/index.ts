/**
 * Notifications Library Entry Point
 */

// ============================================================================
// Types
// ============================================================================

// Export provider types
export type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './providers/types';
export type {
  Database,
  DatabaseTransaction,
  // Re-exported from @codex/database/schema via types.ts
  EmailTemplate,
  NewEmailTemplate,
  NotificationsServiceConfig,
  PaginatedResponse,
  PaginationMetadata,
  PaginationParams,
  RenderedTemplate,
  ServiceConfig,
  SortOrder,
  TemplateData,
  TemplateDataValue,
  TemplateFilters,
  TemplatePreviewResponse,
  TemplateScope,
  TemplateStatus,
  TestSendResponse,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  isNotificationsServiceError,
  NotFoundError,
  NotificationsServiceError,
  TemplateAccessDeniedError,
  TemplateConflictError,
  TemplateNotFoundError,
  ValidationError,
  wrapError,
} from './errors';

// ============================================================================
// Services
// ============================================================================

export {
  BrandingCache,
  NotificationsService,
  TemplateService,
  type TemplateServiceConfig,
} from './services';

// ============================================================================
// Providers
// ============================================================================

export {
  ConsoleProvider,
  createEmailProvider,
  InMemoryEmailProvider,
  MailHogHttpProvider,
  type ProviderConfig,
  ResendProvider,
} from './providers';

// ============================================================================
// Repositories (if needed externally, likely not, but good for testing)
// ============================================================================
export { TemplateRepository } from './repositories/template-repository';

// ============================================================================
// Template Rendering
// ============================================================================

export { renderTemplate } from './templates/renderer';
