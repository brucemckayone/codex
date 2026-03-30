/**
 * Type definitions for Notifications Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { dbHttp, dbWs } from '@codex/database';
import type {
  EmailTemplate,
  NewEmailTemplate,
  TemplateScope,
  TemplateStatus,
} from '@codex/database/schema';
import type {
  PaginationParams,
  SingleItemResponse,
  SortOrder,
} from '@codex/shared-types';
import type { EmailProvider, SendResult } from './providers/types';

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response for template preview endpoint
 */
export type TemplatePreviewResponse = SingleItemResponse<RenderedTemplate>;

/**
 * Response for test send endpoint
 */
export type TestSendResponse = SingleItemResponse<SendResult>;

export type Database = typeof dbHttp | typeof dbWs;

import type { ServiceConfig } from '@codex/service-errors';
export type { ServiceConfig };

/**
 * Configuration for NotificationsService initialization
 */
export interface NotificationsServiceConfig extends ServiceConfig {
  emailProvider: EmailProvider;
  fromEmail?: string;
  fromName?: string;
  replyToEmail?: string;
  /**
   * Default branding and support configuration
   */
  defaults?: {
    platformName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    supportEmail?: string;
    logoUrl?: string;
  };
}

export type { PaginationParams, SortOrder };

/**
 * Template query filters
 */
export interface TemplateFilters {
  status?: TemplateStatus;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: SortOrder;
}

/**
 * Template data values for rendering
 */
export type TemplateDataValue = string | number | boolean | null;

/**
 * Template data map used for token replacement
 */
export type TemplateData = Record<string, TemplateDataValue>;

/**
 * Rendered email payload
 */
export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

// Email definitions are imported from ./providers/types
// to avoid duplication and ensure consistency
export type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './providers/types';

/**
 * Re-export database types for convenience
 */
export type { EmailTemplate, NewEmailTemplate, TemplateScope, TemplateStatus };

/**
 * Response for GET/PUT /api/user/notification-preferences
 */
export interface NotificationPreferencesResponse {
  emailMarketing: boolean;
  emailTransactional: boolean;
  emailDigest: boolean;
}
