/**
 * Notifications Service Errors
 *
 * Domain-specific error classes for notification management.
 * Extends base errors from @codex/service-errors.
 */

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isNotificationsServiceError,
  NotFoundError,
  ServiceError as NotificationsServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Notification-specific errors
 */
export class TemplateNotFoundError extends NotFoundError {
  constructor(templateId: string) {
    super('Email template not found', { templateId });
  }
}

export class TemplateAccessDeniedError extends ForbiddenError {
  constructor(templateId: string) {
    super('Access denied for email template', { templateId });
  }
}

export class TemplateConflictError extends ConflictError {
  constructor(name: string) {
    super('Email template name already exists in scope', { name });
  }
}
