/**
 * tRPC-style Procedure Pattern - Type Definitions
 *
 * Provides compile-time type safety for:
 * - Authentication levels with conditional user types
 * - Input schema inference from Zod
 * - Service registry for lazy-loaded services
 * - Procedure context with full typing
 */

import type { ContentAccessService } from '@codex/access';
import type {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
// Service type imports (for typing only)
import type { ContentService, MediaItemService } from '@codex/content';
import type { ImageProcessingService } from '@codex/image-processing';
import type {
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import type { ObservabilityClient } from '@codex/observability';
import type { OrganizationService } from '@codex/organization';
import type { PlatformSettingsFacade } from '@codex/platform-settings';
import type { PurchaseService } from '@codex/purchase';
import type {
  Bindings,
  HonoEnv,
  SessionData,
  UserData,
} from '@codex/shared-types';
import type { TranscodingService } from '@codex/transcoding';
import type { MiddlewareHandler } from 'hono';
import type { ZodSchema, z } from 'zod';

// ============================================================================
// Auth Level Types
// ============================================================================

/**
 * Authentication level for procedure
 */
export type AuthLevel =
  | 'none'
  | 'optional'
  | 'required'
  | 'worker'
  | 'platform_owner';

/**
 * User type based on auth level - conditional typing
 * - 'required' | 'platform_owner' → UserData (guaranteed)
 * - 'optional' → UserData | undefined (may or may not exist)
 * - 'none' | 'worker' → undefined (no user context)
 */
export type UserForAuth<T extends AuthLevel> = T extends
  | 'required'
  | 'platform_owner'
  ? UserData
  : T extends 'optional'
    ? UserData | undefined
    : undefined;

/**
 * Session type based on auth level
 */
export type SessionForAuth<T extends AuthLevel> = T extends
  | 'required'
  | 'optional'
  | 'platform_owner'
  ? SessionData | undefined
  : undefined;

// ============================================================================
// Input Schema Types
// ============================================================================

/**
 * Input schema definition - supports params, query, body
 */
export interface InputSchema {
  params?: ZodSchema;
  query?: ZodSchema;
  body?: ZodSchema;
}

/**
 * Infer validated input types from schema
 * Maps each schema key to its inferred Zod type
 */
export type InferInput<T extends InputSchema | undefined> =
  T extends InputSchema
    ? {
        [K in keyof T]: T[K] extends ZodSchema ? z.infer<T[K]> : never;
      }
    : Record<string, never>;

// ============================================================================
// Service Registry
// ============================================================================

/**
 * All available services - lazy-loaded via getters
 *
 * Services are instantiated on first access to avoid creating unused instances.
 * Each service is typed to its actual implementation.
 */
export interface ServiceRegistry {
  // Content domain
  content: ContentService;
  media: MediaItemService;
  access: ContentAccessService;

  // Organization domain
  organization: OrganizationService;
  settings: PlatformSettingsFacade;

  // Commerce domain
  purchase: PurchaseService;

  // Media & Processing domain
  transcoding: TranscodingService;
  images: ImageProcessingService;

  // Admin domain
  adminAnalytics: AdminAnalyticsService;
  adminContent: AdminContentManagementService;
  adminCustomer: AdminCustomerManagementService;

  // Notification domain
  templates: TemplateService;
  notifications: NotificationsService;
}

// ============================================================================
// Procedure Policy
// ============================================================================

/**
 * Policy configuration for procedure security
 */
export interface ProcedurePolicy {
  /**
   * Authentication requirement
   * - 'none': Public endpoint
   * - 'optional': Auth attempted but not required
   * - 'required': Must have valid session (default)
   * - 'worker': Worker-to-worker HMAC auth
   * - 'platform_owner': Must be platform owner role
   */
  auth?: AuthLevel;

  /**
   * Role-based access control
   */
  roles?: Array<'user' | 'creator' | 'admin' | 'system'>;

  /**
   * Require organization membership
   */
  requireOrgMembership?: boolean;

  /**
   * Require organization management privileges (owner/admin)
   */
  requireOrgManagement?: boolean;

  /**
   * Rate limiting preset
   */
  rateLimit?: 'api' | 'auth' | 'strict' | 'public' | 'webhook' | 'streaming';

  /**
   * IP whitelist
   */
  allowedIPs?: string[];
}

// ============================================================================
// Procedure Context
// ============================================================================

/**
 * Full context provided to procedure handlers
 * Types are conditional based on policy auth level
 */
export interface ProcedureContext<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
> {
  // Auth context - type depends on policy.auth
  user: UserForAuth<
    TPolicy['auth'] extends AuthLevel ? TPolicy['auth'] : 'required'
  >;
  session: SessionForAuth<
    TPolicy['auth'] extends AuthLevel ? TPolicy['auth'] : 'required'
  >;

  // Validated input from schema
  input: InferInput<TInput>;

  // Request metadata (always available)
  requestId: string;
  clientIP: string;
  userAgent: string;

  // Organization context
  // organizationId is guaranteed for:
  // - requireOrgMembership: true (extracted from subdomain/params + membership check)
  // - auth: 'platform_owner' (automatically looked up from user's membership)
  organizationId: TPolicy['requireOrgMembership'] extends true
    ? string
    : TPolicy['auth'] extends 'platform_owner'
      ? string
      : string | undefined;
  organizationRole: string | undefined;

  // Environment bindings
  env: Bindings;

  // Observability client
  obs: ObservabilityClient | undefined;

  // Service registry (lazy-loaded)
  services: ServiceRegistry;
}

// ============================================================================
// Procedure Configuration
// ============================================================================

/**
 * Main procedure configuration
 */
export interface ProcedureConfig<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
> {
  /**
   * Security policy configuration
   * @default { auth: 'required' }
   */
  policy?: TPolicy;

  /**
   * Input validation schemas
   */
  input?: TInput;

  /**
   * Handler function with fully typed context
   * Return value is automatically wrapped in { data: T }
   */
  handler: (ctx: ProcedureContext<TPolicy, TInput>) => Promise<TOutput>;

  /**
   * Success HTTP status code
   * @default 200
   */
  successStatus?: 200 | 201 | 204;
}

/**
 * Return type of procedure() function
 */
export type ProcedureHandler = MiddlewareHandler<HonoEnv>;
