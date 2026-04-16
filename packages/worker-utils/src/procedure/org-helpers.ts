/**
 * Organization Helper Functions
 *
 * Utilities for extracting organization context and checking membership.
 * Extracted to separate file to avoid circular dependencies.
 */

import { CacheType, VersionedCache } from '@codex/cache';
import { createDbClient, schema } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { and, eq } from 'drizzle-orm';

/**
 * Organization membership info
 */
export interface OrganizationMembership {
  role: string;
  status: string;
  joinedAt: Date;
}

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
export async function extractOrganizationFromSubdomain(
  hostname: string,
  env: Bindings,
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
      where: eq(schema.organizations.slug, subdomain),
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
 * Uses KV cache-aside (5min TTL) to avoid repeated Neon queries.
 * ~46 routes across 5 workers use requireOrgMembership, so caching
 * here eliminates ~200ms per request after the first cold miss.
 *
 * @param organizationId - Organization UUID
 * @param userId - User ID
 * @param env - Worker environment
 * @param obs - Optional observability client for structured logging
 * @returns Membership object or null if not a member
 */
export async function checkOrganizationMembership(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  const kv = env.CACHE_KV as
    | import('@cloudflare/workers-types').KVNamespace
    | undefined;

  if (kv) {
    try {
      const cache = new VersionedCache({ kv, obs });
      const cacheId = `org:${organizationId}:member:${userId}`;

      return await cache.get<OrganizationMembership | null>(
        cacheId,
        CacheType.ORG_MEMBERSHIP,
        () => fetchMembershipFromDB(organizationId, userId, env, obs),
        { ttl: 300 } // 5 minutes
      );
    } catch {
      // Graceful degradation — fall through to direct DB query
    }
  }

  // No KV available (dev without binding) — direct DB query
  return fetchMembershipFromDB(organizationId, userId, env, obs);
}

/**
 * Fetch membership from database (extracted for cache-aside fetcher)
 */
async function fetchMembershipFromDB(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  try {
    const db = createDbClient(env);
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.organizationId, organizationId),
        eq(schema.organizationMemberships.userId, userId),
        eq(schema.organizationMemberships.status, 'active')
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
