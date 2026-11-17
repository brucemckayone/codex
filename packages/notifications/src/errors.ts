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
  constructor(templateId: string, message?: string) {
    super(message ?? 'Email template not found', { templateId });
  }
}

export class TemplateAccessDeniedError extends ForbiddenError {
  constructor(templateId: string) {
    super('Access denied for email template', { templateId });
  }
}

/**
 * A test send of a creator template that names an org, to an address that
 * is not the sender's own (owner decision 2026-11-09, Codex-tgkgb).
 */
export class TestSendRecipientError extends ForbiddenError {
  constructor(templateId: string) {
    super(
      'Test sends of an organization-branded template go only to your own email address',
      { templateId }
    );
  }
}

export class TemplateConflictError extends ConflictError {
  constructor(name: string) {
    super('Email template name already exists in scope', { name });
  }
}
