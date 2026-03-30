/**
 * Subdomain parsing utilities
 *
 * Used by the reroute hook to map subdomains to route groups
 */

import { RESERVED_SUBDOMAINS } from '$lib/constants';

// Re-export for potential legacy usage (or update callsites to use constants directly)
export { RESERVED_SUBDOMAINS };

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

  // lvh.me handling: {subdomain}.lvh.me (dev cross-subdomain cookies)
  if (host.endsWith('lvh.me')) {
    const parts = host.split('.');
    // bruce-studio.lvh.me → ['bruce-studio', 'lvh', 'me']
    if (parts.length > 2) {
      return parts[0];
    }
    return null;
  }

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

/**
 * Build a full URL on a different org subdomain.
 *
 * Cross-org navigation requires changing the hostname (different origin),
 * so we need a full URL rather than a root-relative path.
 *
 * @param currentUrl - The current page URL (used to derive protocol, port, and base domain)
 * @param slug - The org slug to navigate to
 * @param path - The path on the org subdomain (default: '/')
 * @returns Full URL string, e.g. "http://bruce-studio.lvh.me:3000/studio"
 */
export function buildOrgUrl(currentUrl: URL, slug: string, path = '/'): string {
  const host = currentUrl.hostname;
  const port = currentUrl.port;
  const protocol = currentUrl.protocol;

  let baseDomain: string;

  if (host.endsWith('lvh.me')) {
    baseDomain = 'lvh.me';
  } else if (host.includes('localhost')) {
    baseDomain = 'localhost';
  } else if (host.endsWith('revelations.studio')) {
    baseDomain = 'revelations.studio';
  } else {
    // Fallback: strip first segment as subdomain
    const parts = host.split('.');
    baseDomain = parts.length > 1 ? parts.slice(1).join('.') : host;
  }

  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//${slug}.${baseDomain}${portSuffix}${path}`;
}

/**
 * Build a URL to the creators subdomain.
 * E.g., buildCreatorsUrl(currentUrl, '/studio') → 'http://creators.lvh.me:3000/studio'
 */
export function buildCreatorsUrl(currentUrl: URL, path = '/'): string {
  return buildOrgUrl(currentUrl, 'creators', path);
}

/**
 * Build a URL to the root platform domain (no subdomain).
 * E.g., buildPlatformUrl(currentUrl, '/library') → 'http://lvh.me:3000/library'
 */
export function buildPlatformUrl(currentUrl: URL, path = '/'): string {
  const host = currentUrl.hostname;
  const port = currentUrl.port;
  const protocol = currentUrl.protocol;

  let baseDomain: string;

  if (host.endsWith('lvh.me')) {
    baseDomain = 'lvh.me';
  } else if (host.includes('localhost')) {
    baseDomain = 'localhost';
  } else if (host.endsWith('revelations.studio')) {
    baseDomain = 'revelations.studio';
  } else {
    const parts = host.split('.');
    baseDomain = parts.length > 1 ? parts.slice(1).join('.') : host;
  }

  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//${baseDomain}${portSuffix}${path}`;
}

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
