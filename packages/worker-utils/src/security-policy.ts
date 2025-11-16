/**
 * Security Policy Types and Middleware
 *
 * Declarative security policies for route-level access control.
 * Provides a unified way to configure auth, RBAC, rate limiting, and network restrictions.
 */

import type { RATE_LIMIT_PRESETS } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import type { Context, MiddlewareHandler } from 'hono';

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
  rateLimit: 'api',
  allowedOrigins: [],
  allowedIPs: [],
};

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

    const user = c.get('user');

    // None: Skip auth checks
    if (mergedPolicy.auth === 'none') {
      await next();
      return;
    }

    // Optional: Auth attempted by middleware, but not required
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
      // TODO: Implement organization membership validation
      //
      // IMPLEMENTATION PLAN:
      // 1. Extract organizationId from multiple sources (priority order):
      //    a. c.get('organizationId') - Set by parent middleware
      //    b. c.req.param('organizationId') or c.req.param('orgId')
      //    c. Query params: c.req.query('organizationId')
      //
      // 2. Validate organizationId exists:
      //    - Return 400 if missing and requireOrgMembership is true
      //    - Error: "Organization ID is required for this operation"
      //
      // 3. Check user membership in organization:
      //    - Import: import { createOrganizationService } from '@codex/identity';
      //    - Call: await organizationService.getMember(organizationId, user.id)
      //    - Returns: { userId, organizationId, role, joinedAt } or throws NOT_FOUND
      //
      // 4. Cache membership checks for performance:
      //    - Key: `org:${organizationId}:member:${user.id}`
      //    - TTL: 5 minutes
      //    - Store: { isMember: boolean, role: string }
      //
      // 5. Store in context for downstream handlers:
      //    - c.set('organizationId', organizationId)
      //    - c.set('organizationRole', member.role) // owner, admin, member
      //    - Available in EnrichedAuthContext
      //
      // 6. Error responses:
      //    - 400: Missing organizationId when required
      //    - 404: Organization not found
      //    - 403: User not a member of this organization
      //
      // SECURITY CRITICAL:
      // - This prevents users from accessing resources in orgs they don't belong to
      // - Essential for multi-tenant data isolation
      // - MUST be applied to ALL routes that access org-scoped data
      //
      // EXAMPLE USAGE:
      // app.post('/api/organizations/:organizationId/content',
      //   withPolicy({
      //     auth: 'required',
      //     requireOrgMembership: true,  // Enforces membership
      //     roles: ['creator', 'admin'],  // User roles within app
      //   }),
      //   createAuthenticatedHandler({ ... })
      // );
      //
      // RELATED:
      // - packages/identity/src/services/organization-service.ts
      // - Database: organization_members table
      // - See: https://github.com/your-org/codex/issues/XXX
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
} as const;
