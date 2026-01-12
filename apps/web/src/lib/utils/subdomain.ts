/**
 * Subdomain parsing utilities
 *
 * Used by the reroute hook to map subdomains to route groups
 */

/**
 * Reserved subdomains that cannot be used as org slugs
 * These are infrastructure, API, or special-purpose subdomains
 */
export const RESERVED_SUBDOMAINS = new Set([
  // Infrastructure
  'www',
  'auth',
  'api',
  'content-api',
  'organization-api',
  'ecom-api',
  'identity-api',
  'media-api',
  'notifications-api',
  // Special routes
  'creators',
  'admin',
  'platform',
  // Environments
  'staging',
  'dev',
  'test',
  'localhost',
]);

/**
 * Extract subdomain from hostname
 *
 * Handles:
 * - localhost variants (e.g., test-org.localhost:3000)
 * - Production domains (e.g., yoga-studio.revelations.studio)
 *
 * @param hostname - The hostname from URL
 * @returns The subdomain or null if none
 */
export function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];

  // localhost handling: {subdomain}.localhost
  if (host.includes('localhost')) {
    const parts = host.split('.');
    if (parts.length > 1 && parts[0] !== 'localhost') {
      return parts[0];
    }
    return null;
  }

  // Production: {subdomain}.revelations.studio
  const match = host.match(/^([^.]+)\.revelations\.studio$/);
  return match ? match[1] : null;
}

/**
 * Check if a subdomain is reserved (cannot be an org slug)
 */
export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

/**
 * Determine the context type from a subdomain
 */
export type SubdomainContext =
  | { type: 'platform' }
  | { type: 'creators' }
  | { type: 'organization'; slug: string }
  | { type: 'reserved'; subdomain: string };

export function getSubdomainContext(hostname: string): SubdomainContext {
  const subdomain = extractSubdomain(hostname);

  // No subdomain or www → platform
  if (!subdomain || subdomain === 'www') {
    return { type: 'platform' };
  }

  // Creators subdomain
  if (subdomain === 'creators') {
    return { type: 'creators' };
  }

  // Reserved subdomains (APIs, admin, etc.)
  if (isReservedSubdomain(subdomain)) {
    return { type: 'reserved', subdomain };
  }

  // Otherwise, it's an organization subdomain
  return { type: 'organization', slug: subdomain };
}
