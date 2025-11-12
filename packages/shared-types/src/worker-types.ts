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
  RATE_LIMIT_KV?: KVNamespace;
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
