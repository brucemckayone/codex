/**
 * Security Policy Types and Middleware
 *
 * Declarative security policies for route-level access control.
 * Provides a unified way to configure auth, RBAC, rate limiting, and network restrictions.
 */

/// <reference types="@cloudflare/workers-types" />

import { createDbClient } from '@codex/database';
import {
  organizationMemberships,
  organizations,
  sessions,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { RATE_LIMIT_PRESETS } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Cached session data structure stored in KV
 */
interface CachedSessionData {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    updatedAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
}

function isCachedSessionData(value: unknown): value is CachedSessionData {
  if (!value || typeof value !== 'object') return false;
  const data = value as { session?: unknown; user?: unknown };
  return Boolean(data.session && data.user);
}

/**
 * Retrieve session from KV cache
 */
async function getSessionFromCache(
  kv: KVNamespace,
  sessionToken: string,
  obs?: ObservabilityClient
): Promise<CachedSessionData | null> {
  try {
    const keys = [`session:${sessionToken}`, sessionToken];
    for (const key of keys) {
      const cached = await kv.get(key, 'json');
      if (isCachedSessionData(cached)) {
        return cached;
      }
    }
    return null;
  } catch (error) {
    obs?.error('[withPolicy] Failed to read session from KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Cache session data in KV with TTL based on session expiration
 */
async function cacheSessionInKV(
  kv: KVNamespace,
  sessionToken: string,
  data: CachedSessionData,
  obs?: ObservabilityClient
): Promise<void> {
  try {
    const expiresAt = new Date(data.session.expiresAt);
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (ttl > 0) {
      await kv.put(`session:${sessionToken}`, JSON.stringify(data), {
        expirationTtl: ttl,
      });
    }
  } catch (error) {
    obs?.error('[withPolicy] Failed to cache session in KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Security policy configuration for individual routes
 *
 * Policies are applied via withPolicy() middleware before route handlers.
 * Provides declarative security configuration at the route level.
 */
export interface RouteSecurityPolicy {
  /**
   * Authentication requirement level
   *
   * - 'none': No authentication required (public endpoint)
   * - 'optional': Auth attempted but not required (context.user may be null)
   * - 'required': Must be authenticated user (default)
   * - 'worker': Worker-to-worker auth required (HMAC signature)
   */
  auth?: 'none' | 'optional' | 'required' | 'worker';

  /**
   * Role-based access control
   *
   * If specified, user must have at least one of these roles.
   * Checked after authentication succeeds.
   *
   * Common roles:
   * - 'user': Basic authenticated user
   * - 'creator': Content creator (can publish)
   * - 'admin': Administrative access
   * - 'system': System-level operations
   */
  roles?: Array<'user' | 'creator' | 'admin' | 'system'>;

  /**
   * Require organization membership
   *
   * If true, validates that user belongs to organization specified in:
   * - Request body: organizationId field
   * - Request params: organizationId or orgId
   * - Route context: organization scope
   *
   * Requires auth: 'required'
   */
  requireOrgMembership?: boolean;

  /**
   * Require organization management privileges (owner/admin role)
   *
   * If true, validates that user has 'owner' or 'admin' role in the organization.
   * Organization ID is extracted from route params (:id).
   *
   * Use for endpoints that modify organization settings.
   *
   * Requires auth: 'required'
   */
  requireOrgManagement?: boolean;

  /**
   * Rate limiting preset
   *
   * Overrides default rate limit for this route.
   * Uses presets from @codex/security/RATE_LIMIT_PRESETS:
   * - 'api': 100 req/min (default)
   * - 'strict': 20 req/min (sensitive operations)
   * - 'auth': 10 req/min (login/signup)
   * - 'public': 300 req/min (public content)
   */
  rateLimit?: keyof typeof RATE_LIMIT_PRESETS;

  /**
   * Allowed origins for CORS
   *
   * Overrides global CORS configuration for this specific route.
   * Useful for webhooks or partner integrations.
   *
   * @example ['https://partner.example.com']
   */
  allowedOrigins?: string[];

  /**
   * IP whitelist
   *
   * Only allow requests from these IP addresses.
   * Useful for internal APIs or trusted partner integrations.
   *
   * Cloudflare provides: c.req.header('CF-Connecting-IP')
   *
   * @example ['10.0.0.0/8', '192.168.1.100']
   */
  allowedIPs?: string[];
}

/**
 * Default security policy applied to all routes
 *
 * Secure by default: Authentication required, moderate rate limiting
 */
export const DEFAULT_SECURITY_POLICY: Required<RouteSecurityPolicy> = {
  auth: 'required',
  roles: [],
  requireOrgMembership: false,
  requireOrgManagement: false,
  rateLimit: 'api',
  allowedOrigins: [],
  allowedIPs: [],
};

/**
 * Extract organization ID from subdomain
 *
 * Resolves organization slug from subdomain (e.g., "acme.revelations.studio" → acme)
 * and looks up the organization ID in the database.
 *
 * @param hostname - Request hostname (from Host header)
 * @param env - Worker environment with DATABASE_URL
 * @returns Organization ID or null if not found
 */
async function extractOrganizationFromSubdomain(
  hostname: string,
  env: HonoEnv['Bindings'],
  obs?: ObservabilityClient
): Promise<string | null> {
  // Parse subdomain from hostname
  // Examples:
  //   "acme.revelations.studio" → "acme"
  //   "localhost:3000" → null (local development)
  //   "content-api.revelations.studio" → null (not an org subdomain)

  const parts = hostname.split('.');

  // Local development or IP address - no organization context
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return null;
  }

  // Need at least subdomain.domain.tld (3 parts)
  if (parts.length < 3) {
    return null;
  }

  const subdomain = parts[0];
  if (!subdomain) {
    return null;
  }

  // Infrastructure subdomains (not organizations)
  const infraSubdomains = [
    'www',
    'api',
    'content-api',
    'identity-api',
    'auth',
    'admin',
  ];
  if (infraSubdomains.includes(subdomain)) {
    return null;
  }

  // Query database for organization by slug
  try {
    const db = createDbClient(env);
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.slug, subdomain),
      columns: {
        id: true,
      },
    });

    return org?.id || null;
  } catch (error) {
    obs?.error('Error looking up organization from subdomain', {
      hostname,
      subdomain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if user is a member of an organization
 *
 * Queries organization_memberships table with optional caching.
 *
 * @param organizationId - Organization UUID
 * @param userId - User ID
 * @param env - Worker environment (for KV caching if available)
 * @param obs - Optional observability client for structured logging
 * @returns Membership object or null if not a member
 */
async function checkOrganizationMembership(
  organizationId: string,
  userId: string,
  env: HonoEnv['Bindings'],
  obs?: ObservabilityClient
): Promise<{
  role: string;
  status: string;
  joinedAt: Date;
} | null> {
  // TODO: Add KV caching here for performance
  // Cache key: `org:${organizationId}:member:${userId}`
  // TTL: 5 minutes

  try {
    const db = createDbClient(env);
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active') // Only active memberships
      ),
      columns: {
        role: true,
        status: true,
        createdAt: true,
      },
    });

    if (!membership) {
      return null;
    }

    return {
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt,
    };
  } catch (error) {
    obs?.error('Error checking organization membership', {
      organizationId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if user has organization management privileges (owner/admin role)
 *
 * @param organizationId - Organization UUID
 * @param userId - User ID
 * @param env - Worker environment with DATABASE_URL
 * @param obs - Optional observability client for structured logging
 * @returns True if user has owner/admin role, false otherwise
 */
async function checkOrganizationManagementAccess(
  organizationId: string,
  userId: string,
  env: HonoEnv['Bindings'],
  obs?: ObservabilityClient
): Promise<boolean> {
  try {
    const db = createDbClient(env);
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active')
      ),
      columns: {
        role: true,
      },
    });

    if (!membership) {
      return false;
    }

    // Only owner and admin roles can manage the organization
    return membership.role === 'owner' || membership.role === 'admin';
  } catch (error) {
    obs?.error('Error checking organization management access', {
      organizationId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Merge route policy with defaults
 */
export function mergePolicy(
  policy?: Partial<RouteSecurityPolicy>
): Required<RouteSecurityPolicy> {
  return {
    ...DEFAULT_SECURITY_POLICY,
    ...policy,
  };
}

/**
 * Check if IP address matches whitelist
 *
 * Supports CIDR notation and exact IP matches
 */
function isIPAllowed(ip: string, allowedIPs: string[]): boolean {
  if (allowedIPs.length === 0) return true; // No restrictions

  // Simple exact match for now
  // TODO: Add CIDR support using a library
  return allowedIPs.includes(ip);
}

/**
 * Policy enforcement middleware
 *
 * Validates security policy before route handler executes.
 * Checks authentication, authorization, IP restrictions, etc.
 *
 * @example
 * ```typescript
 * app.post('/api/content',
 *   withPolicy({
 *     auth: 'required',
 *     roles: ['creator'],
 *     rateLimit: 'strict',
 *   }),
 *   createAuthenticatedHandler({
 *     schema: { body: createContentSchema },
 *     handler: async (c, ctx) => { ... }
 *   })
 * );
 * ```
 */
export function withPolicy(
  policy: Partial<RouteSecurityPolicy> = {}
): MiddlewareHandler<HonoEnv> {
  const mergedPolicy = mergePolicy(policy);

  return async (c: Context<HonoEnv>, next) => {
    // Get observability client from context if available
    const obs = c.get('obs');

    // ========================================================================
    // IP Whitelist Check
    // ========================================================================

    if (mergedPolicy.allowedIPs.length > 0) {
      const clientIP =
        c.req.header('CF-Connecting-IP') ||
        c.req.header('X-Real-IP') ||
        c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
        '';

      if (!isIPAllowed(clientIP, mergedPolicy.allowedIPs)) {
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied: IP not whitelisted',
            },
          },
          403
        );
      }
    }

    // ========================================================================
    // Authentication Check
    // ========================================================================

    // None: Skip auth checks
    if (mergedPolicy.auth === 'none') {
      await next();
      return;
    }

    // Check if auth middleware already ran (enableGlobalAuth: true case)
    let user = c.get('user');

    // If no user yet, perform session validation here
    // This allows withPolicy() to work with enableGlobalAuth: false
    if (
      !user &&
      (mergedPolicy.auth === 'optional' || mergedPolicy.auth === 'required')
    ) {
      const sessionCookie = c.req.header('cookie');
      console.log(
        '[withPolicy] Cookie header:',
        sessionCookie ? 'present' : 'missing'
      );

      if (sessionCookie) {
        // Extract session token from cookie
        // Try codex-session first (configured name), then better-auth.session_token
        console.log(
          '[withPolicy] Full cookie header:',
          sessionCookie.substring(0, 200)
        );
        let match = sessionCookie.match(/codex-session=([^;]+)/);
        if (!match) {
          match = sessionCookie.match(/__Secure-codex-session=([^;]+)/);
        }
        if (!match) {
          match = sessionCookie.match(/better-auth\.session_token=([^;]+)/);
        }
        if (!match) {
          match = sessionCookie.match(
            /__Secure-better-auth\.session_token=([^;]+)/
          );
        }
        const rawToken = match?.[1];
        console.log(
          '[withPolicy] Session token:',
          rawToken ? `found (${rawToken.substring(0, 50)}...)` : 'not found'
        );

        if (rawToken) {
          // URL-decode the token (cookies are URL-encoded)
          const fullToken = decodeURIComponent(rawToken);
          // Better Auth tokens may be in format: token.signature
          // Try both the split token (before dot) and full token
          const splitToken = fullToken.split('.')[0] || fullToken;
          console.log(
            '[withPolicy] Decoded token:',
            `${splitToken.substring(0, 20)}...`
          );

          try {
            // Get KV namespace for caching (if available)
            const kv = c.env.AUTH_SESSION_KV as KVNamespace | undefined;

            // Try cache first (if KV available)
            if (kv) {
              const cachedSession = await getSessionFromCache(
                kv,
                splitToken,
                obs
              );

              if (cachedSession) {
                // Validate expiration (defense in depth)
                const expiresAt = new Date(cachedSession.session.expiresAt);
                if (expiresAt > new Date()) {
                  // Valid cached session - set context
                  c.set('session', cachedSession.session);
                  c.set('user', cachedSession.user);
                  user = cachedSession.user;
                  console.log('[withPolicy] Session found in KV cache');
                  obs?.info('[withPolicy] User set from cache', {
                    userId: cachedSession.user.id,
                    role: cachedSession.user.role,
                  });
                } else {
                  // Expired session in cache - clear it
                  console.log('[withPolicy] Cached session expired, clearing');
                  kv.delete(`session:${splitToken}`).catch(() => {});
                }
              }
            }

            // If still no user, query database
            if (!user) {
              console.log(
                '[withPolicy] Querying database with splitToken:',
                `${splitToken.substring(0, 30)}...`
              );
              console.log(
                '[withPolicy] fullToken differs:',
                splitToken !== fullToken
              );

              // Create database client with request environment
              const db = createDbClient(c.env);

              // Query session from database - try split token first
              let sessionData = await db.query.sessions.findFirst({
                where: and(
                  eq(sessions.token, splitToken),
                  gt(sessions.expiresAt, new Date())
                ),
                with: {
                  user: true,
                },
              });

              // If not found and tokens differ, try full token
              if (!sessionData && splitToken !== fullToken) {
                console.log(
                  '[withPolicy] Split token not found, trying full token:',
                  `${fullToken.substring(0, 30)}...`
                );
                sessionData = await db.query.sessions.findFirst({
                  where: and(
                    eq(sessions.token, fullToken),
                    gt(sessions.expiresAt, new Date())
                  ),
                  with: {
                    user: true,
                  },
                });
              }

              console.log(
                '[withPolicy] Session query result:',
                sessionData
                  ? `found (user: ${sessionData.user?.id})`
                  : 'not found'
              );
              if (sessionData) {
                // Valid session found - set context
                c.set('session', sessionData);
                c.set('user', sessionData.user);
                user = sessionData.user;
                obs?.info('[withPolicy] User set from database', {
                  userId: sessionData.user.id,
                  role: sessionData.user.role,
                });

                // Cache it for next time (if KV available)
                if (kv) {
                  const cacheData: CachedSessionData = {
                    session: {
                      id: sessionData.id,
                      userId: sessionData.userId,
                      token: sessionData.token,
                      expiresAt:
                        sessionData.expiresAt instanceof Date
                          ? sessionData.expiresAt.toISOString()
                          : sessionData.expiresAt,
                      ipAddress: sessionData.ipAddress ?? null,
                      userAgent: sessionData.userAgent ?? null,
                      createdAt:
                        sessionData.createdAt instanceof Date
                          ? sessionData.createdAt.toISOString()
                          : sessionData.createdAt,
                      updatedAt:
                        sessionData.updatedAt instanceof Date
                          ? sessionData.updatedAt.toISOString()
                          : sessionData.updatedAt,
                    },
                    user: {
                      id: sessionData.user.id,
                      email: sessionData.user.email,
                      name: sessionData.user.name,
                      emailVerified: sessionData.user.emailVerified,
                      image: sessionData.user.image ?? null,
                      role: sessionData.user.role,
                      createdAt:
                        sessionData.user.createdAt instanceof Date
                          ? sessionData.user.createdAt.toISOString()
                          : sessionData.user.createdAt,
                      updatedAt:
                        sessionData.user.updatedAt instanceof Date
                          ? sessionData.user.updatedAt.toISOString()
                          : sessionData.user.updatedAt,
                    },
                  };
                  // Fire and forget - don't wait for cache
                  cacheSessionInKV(kv, splitToken, cacheData, obs).catch(
                    () => {}
                  );
                }
              }
            }
          } catch (error) {
            obs?.error('[withPolicy] Session validation error', {
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue without auth - will be caught below if required
          }
        }
      }
    }

    // Optional: Auth attempted but not required
    if (mergedPolicy.auth === 'optional') {
      // User may or may not exist, proceed either way
      await next();
      return;
    }

    // Worker: Require worker auth (handled by separate middleware)
    if (mergedPolicy.auth === 'worker') {
      // Worker auth middleware should run before this
      // Just verify it succeeded
      if (!c.get('workerAuth')) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Worker authentication required',
            },
          },
          401
        );
      }
      await next();
      return;
    }

    // Required: Must have authenticated user
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    // ========================================================================
    // Role-Based Access Control
    // ========================================================================

    if (mergedPolicy.roles.length > 0) {
      // User roles should be in user object
      const userRoles = user.role ? [user.role] : [];

      const hasRequiredRole = mergedPolicy.roles.some((role) =>
        userRoles.includes(role)
      );

      if (!hasRequiredRole) {
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Insufficient permissions',
              required: mergedPolicy.roles,
            },
          },
          403
        );
      }
    }

    // ========================================================================
    // Organization Membership Check
    // ========================================================================

    if (mergedPolicy.requireOrgMembership) {
      // Step 1: Extract organizationId from subdomain
      const hostname = c.req.header('host') || '';
      const organizationId = await extractOrganizationFromSubdomain(
        hostname,
        c.env,
        obs
      );

      if (!organizationId) {
        return c.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message:
                'Organization context required but could not be determined from subdomain',
            },
          },
          400
        );
      }

      // Step 2: Check user membership in organization
      const membership = await checkOrganizationMembership(
        organizationId,
        user.id,
        c.env,
        obs
      );

      if (!membership) {
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'You are not a member of this organization',
            },
          },
          403
        );
      }

      // Step 3: Store organization context for downstream handlers
      c.set('organizationId', organizationId);
      c.set('organizationRole', membership.role);
      c.set('organizationMembership', membership);
    }

    // ========================================================================
    // Organization Management Check (owner/admin role required)
    // ========================================================================

    if (mergedPolicy.requireOrgManagement) {
      // Extract organization ID from route params (:id)
      const organizationId = c.req.param('id') || '';

      if (!organizationId) {
        return c.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message:
                'Organization ID required but not found in route parameters',
            },
          },
          400
        );
      }

      // Check if user has owner/admin role in this organization
      const hasManagementAccess = await checkOrganizationManagementAccess(
        organizationId,
        user.id,
        c.env,
        obs
      );

      if (!hasManagementAccess) {
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have permission to manage this organization',
            },
          },
          403
        );
      }

      // Store organization context for downstream handlers
      c.set('organizationId', organizationId);
    }

    // Policy checks passed, proceed to handler
    await next();
  };
}

/**
 * Convenience policy presets for common scenarios
 */
export const POLICY_PRESETS = {
  /**
   * Public endpoint (no auth)
   * @example Health checks, public content
   */
  public: (): Partial<RouteSecurityPolicy> => ({
    auth: 'none',
    rateLimit: 'web', // 300 req/min
  }),

  /**
   * Standard authenticated API endpoint
   * @example GET /api/content/:id
   */
  authenticated: (): Partial<RouteSecurityPolicy> => ({
    auth: 'required',
    rateLimit: 'api', // 100 req/min
  }),

  /**
   * Creator-only endpoint
   * @example POST /api/content (create content)
   */
  creator: (): Partial<RouteSecurityPolicy> => ({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'api', // 100 req/min
  }),

  /**
   * Admin-only endpoint
   * @example DELETE /api/users/:id
   */
  admin: (): Partial<RouteSecurityPolicy> => ({
    auth: 'required',
    roles: ['admin'],
    rateLimit: 'auth', // 5 req/15min (strict)
  }),

  /**
   * Internal worker-to-worker endpoint
   * @example POST /internal/webhook
   */
  internal: (): Partial<RouteSecurityPolicy> => ({
    auth: 'worker',
    rateLimit: 'webhook', // 1000 req/min
  }),

  /**
   * Sensitive operation (strict rate limiting)
   * @example POST /api/auth/login
   */
  sensitive: (): Partial<RouteSecurityPolicy> => ({
    auth: 'required',
    rateLimit: 'auth', // 5 req/15min (strict)
  }),

  /**
   * Organization management endpoint (owner/admin role required)
   * @example PATCH /api/organizations/:id
   * @example DELETE /api/organizations/:id
   */
  orgManagement: (): Partial<RouteSecurityPolicy> => ({
    auth: 'required',
    requireOrgManagement: true,
    rateLimit: 'api', // 100 req/min
  }),
} as const;
