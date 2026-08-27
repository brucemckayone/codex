/**
 * tRPC-style Procedure Pattern - Type Definitions
 *
 * Provides compile-time type safety for:
 * - Authentication levels with conditional user types
 * - Input schema inference from Zod
 * - Service registry for lazy-loaded services
 * - Procedure context with full typing
 */

import type {
  ContentAccessService,
  CourseAccessService,
  CourseInsightsService,
  CourseJourneyService,
  EntitlementsService,
} from '@codex/access';
import type {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
import type { AgreementService } from '@codex/agreements';
// Service type imports (for typing only)
import type {
  CategoriesService,
  ContentService,
  MediaItemService,
} from '@codex/content';
import type { IdentityService } from '@codex/identity';
import type { ImageProcessingService } from '@codex/image-processing';
import type {
  NotificationPreferencesService,
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import type { ObservabilityClient } from '@codex/observability';
import type {
  DevDomainService,
  OrganizationService,
} from '@codex/organization';
import type { PlatformSettingsFacade } from '@codex/platform-settings';
import type { FeeConfigService, PurchaseService } from '@codex/purchase';
import type { RateLimitPresetName } from '@codex/security';
import type {
  Bindings,
  HonoEnv,
  SessionData,
  UserData,
} from '@codex/shared-types';
import type {
  ConnectAccountService,
  CourseSubscriptionService,
  SubscriptionService,
  TierService,
} from '@codex/subscription';
import type { TranscodingService } from '@codex/transcoding';
import type { ExecutionContext, MiddlewareHandler } from 'hono';
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
  /**
   * Per-space topic taxonomy (org landing "Browse by topic"). Scoped CRUD +
   * reorder, mirroring `content` scoping (org space shared across creators;
   * personal space per-creator).
   */
  categories: CategoriesService;
  access: ContentAccessService;
  /**
   * Read-resolution of stored `entitlements` grants (Codex-2pryk.2.3 · WP-2).
   * READ-ONLY — the grant write path (purchase / course-subscription) is WP-6.
   * The access DECISION (`canView` / `canEnterCourse`) lives on `access`.
   */
  entitlements: EntitlementsService;
  imageProcessing: ImageProcessingService;

  // Organization domain
  organization: OrganizationService;
  settings: PlatformSettingsFacade;
  /**
   * Dev-only Cloudflare Custom Domain provisioner (Codex Phase 7).
   * No-op outside `ENVIRONMENT === 'dev'`. Creates per-org HTTPS bindings
   * for hostnames at two levels deep where Universal SSL doesn't reach.
   */
  devDomain: DevDomainService;

  // Commerce domain
  purchase: PurchaseService;
  /**
   * Fee configuration (Codex-m644n) — 3-tier DB-configurable fees with
   * version-cache invalidation. Lazily read by purchase + subscription.
   */
  feeConfig: FeeConfigService;
  /**
   * Revenue-share agreements (Codex-tnft0, WP-2 of Codex-nk4km). State
   * machine for propose / counter / accept / decline / withdraw +
   * agreement termination. Reads platform fee fresh from feeConfig at
   * propose/accept time (per epic decision #2).
   */
  agreements: AgreementService;

  // Subscription domain
  subscription: SubscriptionService;
  tier: TierService;
  connect: ConnectAccountService;
  /**
   * Course-specific subscriptions (Codex-2pryk WP-6 · SPEC §7): plan Stripe
   * sync, checkout, and the course-sub webhook lifecycle + payout fan-out.
   * Stripe-backed, so lazily constructed with the deferred Stripe client.
   */
  courseSubscription: CourseSubscriptionService;
  /**
   * Course monetization access surface (Codex-2pryk WP-6): tier→course grant
   * management (N1 guard) + the `getCourseOffer` read composing all three §7
   * paths. Pure DB — no Stripe.
   */
  courseAccess: CourseAccessService;
  /**
   * Course MEMBER-surface reads (Codex-2pryk Round-D): the dashboard curriculum
   * + progress rollup and the in-course practice/playlist projections (SPEC §11
   * / §14). Pure DB — the entitlement decision + stream signing stay on `access`.
   */
  courseJourney: CourseJourneyService;
  /**
   * Course STUDIO-reporting reads (Codex-2pryk Round-D · WP-7): course-scoped
   * financial (`live`) + engagement (`course`) aggregation for the owner/admin
   * insights surface. Pure DB — owner/admin gated at the route via
   * `requireOrgManagement`; the service re-scopes the course to the managed org.
   */
  courseInsights: CourseInsightsService;

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
  preferences: NotificationPreferencesService;

  // Identity domain
  identity: IdentityService;
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
  roles?: Array<'user' | 'creator' | 'admin' | 'system' | 'platform_owner'>;

  /**
   * Require organization membership
   */
  requireOrgMembership?: boolean;

  /**
   * Require organization management privileges (owner/admin)
   */
  requireOrgManagement?: boolean;

  /**
   * Rate limiting preset, enforced by `enforcePolicyInline`.
   *
   * Typed as `RateLimitPresetName` rather than a hand-written union so the two
   * cannot drift: the previous literals included 'public' (never a preset) and
   * 'webhook' (deleted — Stripe and RunPod are HMAC-authenticated), which the
   * type would have accepted on a route and the limiter could not honour.
   *
   * Omitted means 'api' (100/min per subject), not "unlimited". `auth:
   * 'worker'` routes are exempt whatever this says.
   */
  rateLimit?: RateLimitPresetName;

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
  // - requireOrgManagement: true (gates the same `needsOrg` resolver as membership;
  //   enforcePolicy throws ValidationError if organizationId can't be resolved)
  // - auth: 'platform_owner' (automatically looked up from user's membership)
  organizationId: TPolicy['requireOrgMembership'] extends true
    ? string
    : TPolicy['requireOrgManagement'] extends true
      ? string
      : TPolicy['auth'] extends 'platform_owner'
        ? string
        : string | undefined;
  organizationRole: string | undefined;

  // Environment bindings
  env: Bindings;

  // Execution context for non-blocking operations
  executionCtx: ExecutionContext;

  /**
   * Register background work that must finish BEFORE the service registry's
   * DB clients are torn down.
   *
   * `ctx.executionCtx.waitUntil()` is NOT safe for background work that
   * touches the database. procedure() schedules its own
   * `waitUntil(cleanup())` when the handler returns, and cleanup calls
   * `pool.end()` on the shared per-request client — so the two race, and
   * cleanup (being near-instant) reliably wins. Any DB write attempted after
   * that fails with a bare "Failed query", and if it was an error-reporting
   * write the failure vanishes entirely.
   *
   * Use this instead whenever the background task reads or writes the DB;
   * cleanup is chained after everything registered here settles. Plain
   * `waitUntil` remains correct for work that never touches the DB.
   *
   * Returns the promise it was given, so it can be used inline.
   */
  background: <T>(promise: Promise<T>) => Promise<T>;

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
