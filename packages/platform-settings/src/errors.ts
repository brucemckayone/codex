/**
 * Platform Settings Error Classes
 *
 * Domain-specific errors for platform settings operations.
 * Extends base errors from @codex/service-errors.
 */

import { InternalServiceError, ValidationError } from '@codex/service-errors';

/**
 * Thrown when logo file type is not allowed
 * HTTP 400 Bad Request
 */
export class InvalidFileTypeError extends ValidationError {
  constructor(mimeType: string, allowedTypes: readonly string[]) {
    super(
      `Invalid file type: ${mimeType}. Allowed types: ${allowedTypes.join(', ')}`,
      {
        mimeType,
        allowedTypes,
      }
    );
  }
}

/**
 * Thrown when logo file exceeds maximum size
 * HTTP 400 Bad Request
 */
export class FileTooLargeError extends ValidationError {
  constructor(sizeBytes: number, maxSizeBytes: number) {
    super(
      `File size ${Math.round(sizeBytes / 1024 / 1024)}MB exceeds maximum ${Math.round(maxSizeBytes / 1024 / 1024)}MB`,
      {
        sizeBytes,
        maxSizeBytes,
      }
    );
  }
}

/**
 * Settings table type for error context
 */
export type SettingsTable = 'branding' | 'contact' | 'feature';

/**
 * Thrown when a settings upsert operation returns no rows.
 * This should never happen with a proper upsert, indicates a database issue.
 * HTTP 500 Internal Server Error
 */
export class SettingsUpsertError extends InternalServiceError {
  constructor(
    settingsType: SettingsTable,
    organizationId: string,
    operation: 'update' | 'logo_upload' = 'update'
  ) {
    super(
      `${settingsType} settings ${operation} returned no rows for organization ${organizationId}`,
      {
        settingsType,
        organizationId,
        operation,
        hint: 'Upsert with RETURNING should always return a row. Check database constraints.',
      }
    );
  }
}
