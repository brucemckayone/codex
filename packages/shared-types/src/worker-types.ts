/**
 * Shared Worker Types
 *
 * Common type definitions for all Cloudflare Workers in the Codex platform.
 * These types ensure consistency across all API workers.
 */

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
};

/**
 * Context Variables
 * Data set during request processing by middleware
 */
export type Variables = {
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
  obs?: unknown; // Type from @codex/observability to avoid circular dependency

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
};

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
