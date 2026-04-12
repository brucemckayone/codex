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
/**
 * Brand tokens resolved for an organization (used in email template rendering)
 */
export interface OrgBrandTokens {
  primaryColor: string;
  logoUrl: string;
  supportEmail: string;
}

/**
 * Factory that resolves brand tokens for a given organization.
 * Injected at construction so the service registry controls creation.
 */
export type BrandTokenResolver = (
  orgId: string
) => Promise<OrgBrandTokens | null>;

export interface NotificationsServiceConfig extends ServiceConfig {
  emailProvider: EmailProvider;
  fromEmail?: string;
  fromName?: string;
  replyToEmail?: string;
  /**
   * Optional factory to resolve org-scoped brand tokens.
   * When provided, replaces the ad-hoc BrandingSettingsService/ContactSettingsService
   * instantiation, letting the service registry control settings access.
   */
  brandTokenResolver?: BrandTokenResolver;
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
 * Email category for preference checking.
 * - transactional: Always sent (receipts, password resets, security)
 * - marketing: Opt-out respected (promotions, new content)
 * - digest: Opt-out respected (weekly summary)
 */
export type EmailCategory = 'transactional' | 'marketing' | 'digest';

/**
 * Response for GET/PUT /api/user/notification-preferences
 */
export interface NotificationPreferencesResponse {
  emailMarketing: boolean;
  emailTransactional: boolean;
  emailDigest: boolean;
}
