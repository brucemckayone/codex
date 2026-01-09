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
import type { SingleItemResponse } from '@codex/shared-types';
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

/**
 * Transaction type for Drizzle ORM
 * Used for multi-step database operations
 */
export type DatabaseTransaction = Parameters<
  Parameters<typeof dbHttp.transaction>[0]
>[0];

/**
 * Configuration for service initialization
 */
export interface ServiceConfig {
  db: Database;
  environment: string;
}

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

/**
 * Pagination parameters for list queries
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Pagination metadata in responses
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response structure
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

/**
 * Sort order enum
 */
export type SortOrder = 'asc' | 'desc';

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
