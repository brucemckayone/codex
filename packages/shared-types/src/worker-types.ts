/**
 * Shared Worker Types
 *
 * Common type definitions for all Cloudflare Workers in the Codex platform.
 * These types ensure consistency across all API workers.
 */

import type { ObservabilityClient } from '@codex/observability';

/**
 * Standard Cloudflare Workers Bindings
 * Environment variables and resources available to all workers
 */
export type Bindings = {
  /**
   * Environment name (development, staging, production)
   */
  ENVIRONMENT?: string;

  /**
   * Database connection URL (Neon PostgreSQL)
   */
  DATABASE_URL?: string;

  /**
   * Database method (PRODUCTION for connection pooling, LOCAL for direct)
   */
  DB_METHOD?: string;

  /**
   * Web application URL for CORS
   */
  WEB_APP_URL?: string;

  /**
   * API URL for CORS
   */
  API_URL?: string;

  /**
   * Rate limiting KV namespace
   */
  RATE_LIMIT_KV?: import('@cloudflare/workers-types').KVNamespace;

  /**
   * Session caching KV namespace
   * Used for caching authenticated sessions to reduce database load
   */
  AUTH_SESSION_KV?: import('@cloudflare/workers-types').KVNamespace;

  /**
   * R2 bucket binding for media storage
   */
  MEDIA_BUCKET?: import('@cloudflare/workers-types').R2Bucket;

  /**
   * Cloudflare Account ID for R2 endpoint
   */
  R2_ACCOUNT_ID?: string;

  /**
   * R2 API token Access Key ID
   */
  R2_ACCESS_KEY_ID?: string;

  /**
   * R2 API token Secret Access Key
   */
  R2_SECRET_ACCESS_KEY?: string;

  /**
   * R2 bucket name for media storage
   */
  R2_BUCKET_MEDIA?: string;

  /**
   * Public URL base for R2 bucket (e.g., https://pub-codex-media.r2.dev)
   * Used to generate public URLs for logo uploads and other static assets
   */
  R2_PUBLIC_URL_BASE?: string;

  /**
   * Backblaze B2 Endpoint
   */
  B2_ENDPOINT?: string;

  /**
   * Backblaze B2 Key ID
   */
  B2_KEY_ID?: string;

  /**
   * Backblaze B2 Application Key
   */
  B2_APP_KEY?: string;

  /**
   * Backblaze B2 Bucket Name
   */
  B2_BUCKET?: string;

  /**
   * Stripe API secret key
   */
  STRIPE_SECRET_KEY?: string;

  /**
   * Stripe webhook signing secret for payment events
   */
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;

  /**
   * Stripe webhook signing secret for subscription events
   */
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;

  /**
   * Stripe webhook signing secret for Connect account events
   */
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;

  /**
   * Stripe webhook signing secret for customer events
   */
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;

  /**
   * Stripe webhook signing secret for booking/checkout events
   */
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;

  /**
   * Stripe webhook signing secret for dispute events
   */
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;

  // ==========================================================================
  // Email / Notifications
  // ==========================================================================

  /**
   * Email sender address for notifications
   */
  FROM_EMAIL?: string;

  /**
   * Email sender name for notifications
   */
  FROM_NAME?: string;

  /**
   * Resend API key for email delivery (production)
   */
  RESEND_API_KEY?: string;

  /**
   * MailHog URL for email testing (development)
   */
  MAILHOG_URL?: string;

  /**
   * Use mock email provider (console logging)
   */
  USE_MOCK_EMAIL?: string;

  // ==========================================================================
  // RunPod Transcoding Service
  // ==========================================================================

  /**
   * RunPod API key for authentication
   */
  RUNPOD_API_KEY?: string;

  /**
   * RunPod serverless endpoint ID
   */
  RUNPOD_ENDPOINT_ID?: string;

  /**
   * RunPod webhook signing secret (HMAC-SHA256)
   * Used to verify incoming webhook callbacks from RunPod
   */
  RUNPOD_WEBHOOK_SECRET?: string;

  /**
   * Base URL for RunPod webhook callbacks
   * e.g., https://api.example.com - used to construct webhook URLs
   */
  RUNPOD_WEBHOOK_BASE_URL?: string;

  /**
   * Shared secret for worker-to-worker HMAC authentication
   */
  WORKER_SHARED_SECRET?: string;

  // ==========================================================================
  // Worker-to-Worker Communication
  // ==========================================================================

  /**
   * Media API worker URL for triggering transcoding
   * Used by content-api to call media-api internal endpoints
   */
  MEDIA_API_URL?: string;
};

/**
 * Context Variables
 * Data set during request processing by middleware
 *
 * NOTE: This is an interface (not type) to allow declaration merging.
 * Service packages augment this interface to add their service types:
 * - @codex/content adds: contentService, mediaItemService
 * - @codex/access adds: contentAccessService
 */
export interface Variables {
  /**
   * Authenticated user session
   * Set by requireAuth middleware
   */
  session?: SessionData;

  /**
   * Authenticated user data
   * Set by requireAuth middleware
   */
  user?: UserData;

  /**
   * Observability client
   * Set by observability middleware
   */
  obs?: ObservabilityClient;

  /**
   * Request ID for tracking and correlation
   * Set by request tracking middleware
   */
  requestId?: string;

  /**
   * Client IP address
   * Extracted from Cloudflare headers
   */
  clientIP?: string;

  /**
   * User agent string
   * For security auditing and analytics
   */
  userAgent?: string;

  /**
   * Worker authentication flag
   * Set when request authenticated via worker-to-worker HMAC
   */
  workerAuth?: boolean;

  /**
   * Organization context (for multi-tenant operations)
   * Set when route is organization-scoped
   */
  organizationId?: string;

  /**
   * User's role within the organization
   * Set by withPolicy middleware when requireOrgMembership is true
   */
  organizationRole?: string;

  /**
   * Full organization membership details
   * Set by withPolicy middleware when requireOrgMembership is true
   */
  organizationMembership?: {
    role: string;
    status: string;
    joinedAt: Date;
  };

  /**
   * Raw request body stored by middleware
   * Used by webhook handlers that need to verify signatures before parsing JSON
   * Set by signature verification middleware (e.g., verifyRunpodSignature)
   */
  rawBody?: string;
}

/**
 * User session data
 * Minimal session information from auth system
 */
export type SessionData = {
  id: string;
  userId: string;
  expiresAt: Date | string;
  token?: string;
  [key: string]: unknown;
};

/**
 * User data
 * User information needed for API operations
 */
export type UserData = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: Date | string;
  [key: string]: unknown;
};

/**
 * Standard API Error Response
 */
export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/**
 * Standard API Success Response
 */
export type SuccessResponse<T> = {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
    [key: string]: unknown;
  };
};

/**
 * Hono Environment Type
 * Combines Bindings and Variables for type-safe context
 */
export type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Authenticated Context
 * Context that guarantees user is present (post-auth middleware)
 */
export type AuthenticatedContext<TEnv = HonoEnv> = {
  user: Required<NonNullable<Variables['user']>>;
  session: Variables['session'];
  env: TEnv extends { Bindings: infer B } ? B : Bindings;
};

/**
 * Enriched Authenticated Context
 * Extended context with request metadata for security auditing and tracking
 *
 * Includes all standard auth context plus:
 * - Request ID for correlation
 * - Client IP for security logging
 * - User agent for analytics
 * - Organization scope (if applicable)
 *
 * Use this type in route handlers that need full request context.
 */
export type EnrichedAuthContext<TEnv = HonoEnv> = AuthenticatedContext<TEnv> & {
  /**
   * Unique request identifier
   * For tracking requests across logs and services
   */
  requestId: string;

  /**
   * Client IP address
   * Extracted from Cloudflare headers (CF-Connecting-IP)
   */
  clientIP: string;

  /**
   * User agent string
   * For security auditing and bot detection
   */
  userAgent: string;

  /**
   * Organization ID if request is organization-scoped
   * Set by middleware or extracted from request params/body
   */
  organizationId?: string;

  /**
   * User permissions/roles
   * Derived from user.role and organization membership
   */
  permissions: string[];
};
