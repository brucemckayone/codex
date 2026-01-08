/**
 * Procedure Helper Functions
 *
 * Utilities for input validation and policy enforcement in procedures.
 * These helpers throw errors instead of returning Responses, allowing
 * the procedure() function to handle all errors uniformly via mapErrorToResponse().
 */

import type { ObservabilityClient } from '@codex/observability';
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { uuidSchema } from '@codex/validation';
import type { Context } from 'hono';
import type { ZodError, ZodSchema } from 'zod';
import { z } from 'zod';
import { createSessionMiddleware } from '../auth-middleware';
import type {
  AuthLevel,
  InferInput,
  InputSchema,
  ProcedurePolicy,
} from './types';

// ============================================================================
// Request ID & IP Extraction
// ============================================================================

/**
 * Generate a UUID v4 request ID
 */
export function generateRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extract client IP from request headers
 *
 * Priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For > 'unknown'
 */
export function getClientIP(c: Context<HonoEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Real-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// ============================================================================
// Validation Error Formatting
// ============================================================================

/**
 * Format Zod validation errors into standardized structure
 * (Internal helper - not exported from package)
 */
function formatValidationError(zodError: ZodError): {
  code: string;
  message: string;
  details: Array<{ path: string; message: string }>;
} {
  return {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request data',
    details: zodError.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
    })),
  };
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate and parse request input against schemas
 *
 * @throws ValidationError if validation fails
 */
export async function validateInput<T extends InputSchema | undefined>(
  c: Context<HonoEnv>,
  schema: T,
  needsBody: boolean
): Promise<InferInput<T>> {
  if (!schema) {
    return {} as InferInput<T>;
  }

  const rawData: Record<string, unknown> = {};

  // Always extract params and query
  if (schema.params) {
    rawData.params = c.req.param();
  }
  if (schema.query) {
    rawData.query = c.req.query();
  }

  // Parse body only if schema requires it
  if (needsBody && schema.body) {
    try {
      rawData.body = await c.req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON', {
        code: 'INVALID_JSON',
      });
    }
  }

  // Build combined schema from provided parts
  const schemaShape: Record<string, ZodSchema> = {};
  if (schema.params) schemaShape.params = schema.params;
  if (schema.query) schemaShape.query = schema.query;
  if (schema.body) schemaShape.body = schema.body;

  const combinedSchema = z.object(schemaShape);
  const result = combinedSchema.safeParse(rawData);

  if (!result.success) {
    const formatted = formatValidationError(result.error);
    throw new ValidationError(formatted.message, {
      details: formatted.details,
    });
  }

  return result.data as InferInput<T>;
}

// ============================================================================
// IP Whitelist Check
// ============================================================================

/**
 * Check if IP address matches whitelist
 *
 * @throws ForbiddenError if IP is not whitelisted
 */
export function enforceIPWhitelist(
  clientIP: string,
  allowedIPs: string[]
): void {
  if (allowedIPs.length === 0) return; // No restrictions

  // Simple exact match for now
  // TODO: Add CIDR support using a library
  if (!allowedIPs.includes(clientIP)) {
    throw new ForbiddenError('Access denied: IP not whitelisted', {
      clientIP,
    });
  }
}

// ============================================================================
// Organization Membership Helpers
// ============================================================================

// Import organization-related functions dynamically to avoid circular deps
// These are used by enforcePolicyInline when checking org membership

/**
 * Membership info returned from org check
 */
export interface OrganizationMembership {
  role: string;
  status: string;
  joinedAt: Date;
}

// ============================================================================
// Policy Enforcement
// ============================================================================

/**
 * Enforce security policy inline (throws errors instead of returning Response)
 *
 * This function validates:
 * - IP whitelist
 * - Authentication (none, optional, required, worker, platform_owner)
 * - Role-based access control
 * - Organization membership
 * - Organization management privileges
 *
 * @throws UnauthorizedError for authentication failures
 * @throws ForbiddenError for authorization failures
 * @throws ValidationError for missing required context
 */
export async function enforcePolicyInline(
  c: Context<HonoEnv>,
  policy: ProcedurePolicy,
  obs?: ObservabilityClient
): Promise<void> {
  const mergedPolicy = {
    auth: policy.auth ?? ('required' as AuthLevel),
    roles: policy.roles ?? [],
    requireOrgMembership: policy.requireOrgMembership ?? false,
    requireOrgManagement: policy.requireOrgManagement ?? false,
    rateLimit: policy.rateLimit ?? 'api',
    allowedIPs: policy.allowedIPs ?? [],
  };

  // ========================================================================
  // IP Whitelist Check
  // ========================================================================
  if (mergedPolicy.allowedIPs.length > 0) {
    const clientIP = getClientIP(c);
    enforceIPWhitelist(clientIP, mergedPolicy.allowedIPs);
  }

  // ========================================================================
  // Auth: none - Skip auth checks
  // ========================================================================
  if (mergedPolicy.auth === 'none') {
    return;
  }

  // ========================================================================
  // Auth: worker - Check worker auth flag or apply workerAuth inline
  // ========================================================================
  if (mergedPolicy.auth === 'worker') {
    // If workerAuth flag is already set (by earlier middleware), we're authenticated
    if (c.get('workerAuth')) {
      return;
    }

    // Apply workerAuth middleware inline
    // Requires WORKER_SHARED_SECRET in environment
    const secret = c.env.WORKER_SHARED_SECRET;
    if (!secret) {
      throw new UnauthorizedError('Worker authentication not configured');
    }

    // Import workerAuth dynamically to avoid circular deps
    const { workerAuth } = await import('@codex/security');

    // Execute workerAuth middleware inline
    let authFailed = false;
    let authError: string | undefined;

    await new Promise<void>((resolve) => {
      const middleware = workerAuth({ secret });
      middleware(c, async () => {
        // workerAuth succeeded - flag should now be set
        resolve();
      })
        .then((response) => {
          // If middleware returned a Response (401/403), auth failed
          if (response) {
            authFailed = true;
            response
              .json()
              .then((body) => {
                authError = (body as { error?: string }).error;
                resolve();
              })
              .catch(() => resolve());
          } else {
            resolve();
          }
        })
        .catch(() => {
          authFailed = true;
          resolve();
        });
    });

    if (authFailed) {
      throw new UnauthorizedError(authError || 'Worker authentication failed');
    }

    return;
  }

  // ========================================================================
  // Auth: required/optional/platform_owner - Validate session
  // ========================================================================
  let user = c.get('user');

  if (!user) {
    // Run session middleware inline
    const sessionMiddleware = createSessionMiddleware({
      required:
        mergedPolicy.auth === 'required' ||
        mergedPolicy.auth === 'platform_owner',
    });

    // Execute middleware and check result
    // Session middleware returns a Response (401) when auth fails, not an error
    let authFailed = false;

    await new Promise<void>((resolve) => {
      sessionMiddleware(c, async () => {
        // Session validated successfully, user is in context
        user = c.get('user');
        resolve();
      })
        .then((response) => {
          // If middleware returned a Response (401), auth failed
          if (response) {
            authFailed = true;
          }
          resolve();
        })
        .catch(() => {
          // If middleware threw, auth failed
          authFailed = true;
          resolve();
        });
    });

    // Re-get user after middleware execution
    user = c.get('user');

    if (authFailed) {
      throw new UnauthorizedError('Authentication required');
    }
  }

  // ========================================================================
  // Auth: optional - Proceed with or without user
  // ========================================================================
  if (mergedPolicy.auth === 'optional') {
    return;
  }

  // ========================================================================
  // Auth: required/platform_owner - Must have user
  // ========================================================================
  if (!user) {
    throw new UnauthorizedError('Authentication required');
  }

  // ========================================================================
  // Platform Owner Check
  // ========================================================================
  if (mergedPolicy.auth === 'platform_owner') {
    if (user.role !== 'platform_owner') {
      throw new ForbiddenError('Platform owner access required', {
        userRole: user.role,
        required: 'platform_owner',
      });
    }

    // For platform owners, automatically look up their organization
    // This enables admin-api routes that don't have :id param
    if (!c.get('organizationId')) {
      const { createDbClient, schema } = await import('@codex/database');
      const { eq } = await import('drizzle-orm');

      const db = createDbClient(c.env);
      const membership = await db.query.organizationMemberships.findFirst({
        where: eq(schema.organizationMemberships.userId, user.id),
        columns: { organizationId: true },
      });

      if (membership) {
        c.set('organizationId', membership.organizationId);
        c.set('organizationRole', 'platform_owner');
        obs?.info('Platform owner organization resolved from membership', {
          organizationId: membership.organizationId,
          userId: user.id,
        });
      }
    }
  }

  // ========================================================================
  // Role-Based Access Control
  // ========================================================================
  if (mergedPolicy.roles.length > 0) {
    const userRoles = user.role ? [user.role] : [];
    const hasRequiredRole = mergedPolicy.roles.some((role) =>
      userRoles.includes(role)
    );

    if (!hasRequiredRole) {
      throw new ForbiddenError('Insufficient permissions', {
        userRoles,
        required: mergedPolicy.roles,
      });
    }
  }

  // ========================================================================
  // Organization Membership Check
  // ========================================================================
  if (mergedPolicy.requireOrgMembership || mergedPolicy.requireOrgManagement) {
    // Import inline to avoid circular deps
    const { checkOrganizationMembership, extractOrganizationFromSubdomain } =
      await import('./org-helpers');

    let organizationId: string | null = null;
    let skipMembershipCheck = false;

    // Check if org ID is provided via URL param (e.g., :id in path)
    const params = c.req.param();
    const idParam = params.id;

    if (idParam && uuidSchema.safeParse(idParam).success) {
      // URL param org access is ONLY allowed for platform owners (superadmin)
      if (user?.role !== 'platform_owner') {
        throw new ForbiddenError(
          'Organization access via URL parameter is not allowed',
          {
            organizationId: idParam,
            userId: user.id,
          }
        );
      }

      // Platform owner - allow access to any org without membership check
      organizationId = idParam;
      skipMembershipCheck = true;
      obs?.info('Platform owner accessing org via param', {
        organizationId,
        userId: user.id,
      });
    }

    // Fall back to subdomain extraction for regular users
    if (!organizationId) {
      const hostname = c.req.header('host') || '';
      organizationId = await extractOrganizationFromSubdomain(
        hostname,
        c.env,
        obs
      );
    }

    if (!organizationId) {
      throw new ValidationError('Organization context required', {
        code: 'ORG_CONTEXT_REQUIRED',
        message: 'Organization context could not be determined from subdomain',
      });
    }

    // Skip membership check for platform owners using param-based access
    if (!skipMembershipCheck) {
      const membership = await checkOrganizationMembership(
        organizationId,
        user.id,
        c.env,
        obs
      );

      if (!membership) {
        throw new ForbiddenError('You are not a member of this organization', {
          organizationId,
          userId: user.id,
        });
      }

      // Check management access if required
      if (mergedPolicy.requireOrgManagement) {
        if (membership.role !== 'owner' && membership.role !== 'admin') {
          throw new ForbiddenError('Organization management access required', {
            organizationId,
            userRole: membership.role,
            required: ['owner', 'admin'],
          });
        }
      }

      // Store membership context
      c.set('organizationRole', membership.role);
      c.set('organizationMembership', membership);
    } else {
      // Platform owner - set role as 'platform_owner' for context
      c.set('organizationRole', 'platform_owner');
    }

    // Store organization context for downstream handlers
    c.set('organizationId', organizationId);
  }

  // All checks passed
}
