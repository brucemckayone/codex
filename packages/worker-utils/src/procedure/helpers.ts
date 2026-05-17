/**
 * Procedure Helper Functions
 *
 * Utilities for input validation and policy enforcement in procedures.
 * These helpers throw errors instead of returning Responses, allowing
 * the procedure() function to handle all errors uniformly via mapErrorToResponse().
 */

import { AUTH_ROLES, ERROR_CODES } from '@codex/constants';
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
function formatValidationError(zodError: ZodError<unknown>): {
  code: string;
  message: string;
  details: Array<{ path: string; message: string }>;
} {
  return {
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Invalid request data',
    details: zodError.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
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
// Policy Enforcement — Per-Phase Helpers
// ============================================================================

type UserLike = { id: string; role?: string } | undefined;

/**
 * Authenticate a worker-to-worker request via HMAC-SHA256.
 *
 * @throws UnauthorizedError when the secret is missing or the middleware rejects
 */
async function authenticateWorker(c: Context<HonoEnv>): Promise<void> {
  if (c.get('workerAuth')) return;

  const secret = c.env.WORKER_SHARED_SECRET;
  if (!secret) {
    throw new UnauthorizedError('Worker authentication not configured');
  }

  const { workerAuth } = await import('@codex/security');

  let authFailed = false;
  let authError: string | undefined;

  await new Promise<void>((resolve) => {
    const middleware = workerAuth({ secret });
    middleware(c, async () => {
      resolve();
    })
      .then((response) => {
        if (!response) {
          resolve();
          return;
        }
        authFailed = true;
        response
          .json()
          .then((body) => {
            authError = (body as { error?: string }).error;
            resolve();
          })
          .catch(() => resolve());
      })
      .catch(() => {
        authFailed = true;
        resolve();
      });
  });

  if (authFailed) {
    throw new UnauthorizedError(authError || 'Worker authentication failed');
  }
}

/**
 * Run session middleware inline, populating `c.get('user')` when successful.
 * Does nothing if a user is already present in context.
 *
 * @throws UnauthorizedError when authentication is required but fails
 */
async function authenticateSession(
  c: Context<HonoEnv>,
  required: boolean
): Promise<void> {
  if (c.get('user')) return;

  const sessionMiddleware = createSessionMiddleware({ required });

  let authFailed = false;

  await new Promise<void>((resolve) => {
    sessionMiddleware(c, async () => {
      resolve();
    })
      .then((response) => {
        if (response) authFailed = true;
        resolve();
      })
      .catch(() => {
        authFailed = true;
        resolve();
      });
  });

  if (authFailed) {
    throw new UnauthorizedError('Authentication required');
  }
}

/**
 * For platform owners without an org in context, look up their org from
 * membership and store it. Idempotent when organizationId is already set.
 */
async function resolvePlatformOwnerOrganization(
  c: Context<HonoEnv>,
  user: NonNullable<UserLike>,
  obs?: ObservabilityClient
): Promise<void> {
  if (c.get('organizationId')) return;

  const { createDbClient, schema } = await import('@codex/database');
  const { eq } = await import('drizzle-orm');

  const db = createDbClient(c.env);
  const membership = await db.query.organizationMemberships.findFirst({
    where: eq(schema.organizationMemberships.userId, user.id),
    columns: { organizationId: true },
  });

  if (!membership) return;

  c.set('organizationId', membership.organizationId);
  c.set('organizationRole', AUTH_ROLES.PLATFORM_OWNER);
  obs?.info('Platform owner organization resolved from membership', {
    organizationId: membership.organizationId,
    userId: user.id,
  });
}

/**
 * @throws ForbiddenError when the user's role is not in the allowed list
 */
function enforceRole(
  user: NonNullable<UserLike>,
  allowedRoles: string[]
): void {
  if (allowedRoles.length === 0) return;
  if (!user.role || !allowedRoles.includes(user.role)) {
    throw new ForbiddenError('Insufficient permissions');
  }
}

/**
 * Resolve an organization ID from (in order): URL param, subdomain, query param.
 *
 * Returns the resolved org ID and whether the platform-owner bypass applies
 * (only when the URL param carries a valid UUID and the user is a platform owner).
 */
async function resolveOrganizationId(
  c: Context<HonoEnv>,
  user: NonNullable<UserLike>,
  obs?: ObservabilityClient
): Promise<{ organizationId: string | null; skipMembershipCheck: boolean }> {
  const params = c.req.param();
  const idParam = params.id || params.orgId || params.organizationId;

  if (idParam && uuidSchema.safeParse(idParam).success) {
    const isPlatformOwner = user.role === AUTH_ROLES.PLATFORM_OWNER;
    if (isPlatformOwner) {
      obs?.info('Platform owner accessing org via param', {
        organizationId: idParam,
        userId: user.id,
      });
    }
    return {
      organizationId: idParam,
      skipMembershipCheck: isPlatformOwner,
    };
  }

  const { extractOrganizationFromSubdomain } = await import('./org-helpers');
  const hostname = c.req.header('host') || '';
  const subdomainOrg = await extractOrganizationFromSubdomain(
    hostname,
    c.env,
    obs
  );
  if (subdomainOrg) {
    return { organizationId: subdomainOrg, skipMembershipCheck: false };
  }

  const queryOrgId = c.req.query('organizationId');
  if (queryOrgId && uuidSchema.safeParse(queryOrgId).success) {
    obs?.info('Organization resolved from query parameter', {
      organizationId: queryOrgId,
      userId: user.id,
    });
    return { organizationId: queryOrgId, skipMembershipCheck: false };
  }

  return { organizationId: null, skipMembershipCheck: false };
}

/**
 * Enforce org membership (and optionally management) for a resolved org ID.
 * Sets `organizationId`, `organizationRole`, and `organizationMembership` in context.
 *
 * @throws ForbiddenError when user is not a member, or lacks management when required
 */
async function enforceOrganizationAccess(
  c: Context<HonoEnv>,
  user: NonNullable<UserLike>,
  organizationId: string,
  opts: { requireManagement: boolean; skipMembershipCheck: boolean },
  obs?: ObservabilityClient
): Promise<void> {
  if (opts.skipMembershipCheck) {
    c.set('organizationRole', AUTH_ROLES.PLATFORM_OWNER);
    c.set('organizationId', organizationId);
    return;
  }

  const { checkOrganizationMembership } = await import('./org-helpers');
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

  if (
    opts.requireManagement &&
    membership.role !== 'owner' &&
    membership.role !== 'admin'
  ) {
    throw new ForbiddenError('Organization management access required', {
      organizationId,
      userRole: membership.role,
      required: ['owner', 'admin'],
    });
  }

  c.set('organizationRole', membership.role);
  c.set('organizationMembership', membership);
  c.set('organizationId', organizationId);
}

/**
 * Enforce security policy inline (throws errors instead of returning Response).
 *
 * This is the orchestrator — each phase is delegated to a per-concern helper
 * so that individual branches are testable and readable. Execution order:
 *
 *   1. IP whitelist
 *   2. `auth: 'none'`            → short-circuit return
 *   3. `auth: 'worker'`          → HMAC via workerAuth, return
 *   4. Session auth              → required|optional|platform_owner
 *   5. `auth: 'optional'`        → short-circuit return
 *   6. Platform-owner role gate + auto-resolve org
 *   7. Role-based access control
 *   8. Organization membership (+management)
 *
 * @throws UnauthorizedError | ForbiddenError | ValidationError
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

  if (mergedPolicy.allowedIPs.length > 0) {
    enforceIPWhitelist(getClientIP(c), mergedPolicy.allowedIPs);
  }

  if (mergedPolicy.auth === 'none') return;

  if (mergedPolicy.auth === 'worker') {
    await authenticateWorker(c);
    return;
  }

  const requiresSession =
    mergedPolicy.auth === 'required' ||
    mergedPolicy.auth === AUTH_ROLES.PLATFORM_OWNER;
  await authenticateSession(c, requiresSession);

  if (mergedPolicy.auth === 'optional') return;

  const user = c.get('user') as UserLike;
  if (!user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (mergedPolicy.auth === AUTH_ROLES.PLATFORM_OWNER) {
    if (user.role !== AUTH_ROLES.PLATFORM_OWNER) {
      throw new ForbiddenError('Platform owner access required');
    }
    await resolvePlatformOwnerOrganization(c, user, obs);
  }

  enforceRole(user, mergedPolicy.roles);

  const needsOrg =
    mergedPolicy.requireOrgMembership || mergedPolicy.requireOrgManagement;
  if (!needsOrg) return;

  const { organizationId, skipMembershipCheck } = await resolveOrganizationId(
    c,
    user,
    obs
  );
  if (!organizationId) {
    throw new ValidationError('Organization context required', {
      code: 'ORG_CONTEXT_REQUIRED',
      message: 'Organization context could not be determined from subdomain',
    });
  }

  await enforceOrganizationAccess(
    c,
    user,
    organizationId,
    {
      requireManagement: mergedPolicy.requireOrgManagement,
      skipMembershipCheck,
    },
    obs
  );
}
