/**
 * Notifications domain constants
 */

export const TEMPLATE_SCOPES = {
  GLOBAL: 'global',
  ORGANIZATION: 'organization',
  CREATOR: 'creator',
} as const;

export const TEMPLATE_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;

export const EMAIL_PROVIDERS = {
  RESEND: 'resend',
  CONSOLE: 'console',
  MAILHOG: 'mailhog',
  IN_MEMORY: 'in-memory',
} as const;

export const EMAIL_SEND_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;
